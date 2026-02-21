import json
import re
from html import unescape
import ipaddress
import socket
from urllib.parse import urlparse

import httpx

from linter import run_typecheck
from models import ProjectFile

DEFAULT_TOOL_CONFIG: dict[str, bool] = {
    "web_search": False,
    "url_reader": True,
    "project_analyzer": True,
    "typecheck": False,
    "task_planner": True,
}


def normalize_tool_config(payload: object) -> dict[str, bool]:
    normalized = dict(DEFAULT_TOOL_CONFIG)
    if not isinstance(payload, dict):
        return normalized

    for key in DEFAULT_TOOL_CONFIG:
        value = payload.get(key)
        if isinstance(value, bool):
            normalized[key] = value
        elif isinstance(value, str):
            normalized[key] = value.strip().lower() in {"1", "true", "yes", "on"}

    return normalized


def build_project_analyzer_context(files: list[ProjectFile]) -> str:
    if not files:
        return ""

    filenames = [file.filename for file in files]
    components = sorted(
        {
            filename.split("/")[-1].replace(".tsx", "").replace(".ts", "")
            for filename in filenames
            if filename.startswith("src/components/")
        }
    )
    pages = sorted(
        {
            filename.split("/")[-1].replace(".tsx", "").replace(".ts", "")
            for filename in filenames
            if filename.startswith("src/pages/")
        }
    )

    package_file = next((file for file in files if file.filename == "package.json"), None)
    dependencies: list[str] = []
    if package_file and package_file.content:
        try:
            package_json = json.loads(package_file.content)
            deps = package_json.get("dependencies") or {}
            dev_deps = package_json.get("devDependencies") or {}
            dependencies = sorted(
                set(list(deps.keys()) + list(dev_deps.keys()))
            )[:20]
        except Exception:
            dependencies = []

    lines = [
        "Project Analyzer Context:",
        f"- Total files: {len(files)}",
        f"- Component files: {len([f for f in filenames if f.startswith('src/components/')])}",
        f"- Page files: {len([f for f in filenames if f.startswith('src/pages/')])}",
    ]

    if components:
        lines.append(f"- Components: {', '.join(components[:15])}")
    if pages:
        lines.append(f"- Pages: {', '.join(pages[:10])}")
    if dependencies:
        lines.append(f"- Dependencies: {', '.join(dependencies)}")

    return "\n".join(lines)


URL_PATTERN = re.compile(r"https?://[^\s)>\]}\"']+", re.IGNORECASE)
SAFE_FETCH_SCHEMES = {"http", "https"}
SAFE_FETCH_PORTS = {80, 443, None}
REDIRECT_STATUS_CODES = {301, 302, 303, 307, 308}
MAX_URL_REDIRECTS = 4


def extract_urls(text: str, max_urls: int = 2) -> list[str]:
    if not text:
        return []
    urls: list[str] = []
    for match in URL_PATTERN.findall(text):
        cleaned = match.rstrip(".,;:!?)")
        if cleaned not in urls:
            urls.append(cleaned)
        if len(urls) >= max_urls:
            break
    return urls


def _strip_html(html: str) -> str:
    cleaned = re.sub(r"<script\b[^>]*>.*?</script>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"<style\b[^>]*>.*?</style>", " ", cleaned, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = unescape(cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def _is_public_ip_address(value: str) -> bool:
    ip = ipaddress.ip_address(value)
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _validate_public_fetch_url(url: str):
    parsed = urlparse(url)
    if parsed.scheme.lower() not in SAFE_FETCH_SCHEMES:
        raise RuntimeError("Only HTTP/HTTPS URLs are allowed.")
    if parsed.username or parsed.password:
        raise RuntimeError("Credentialed URLs are not allowed.")
    if parsed.port not in SAFE_FETCH_PORTS:
        raise RuntimeError("Only standard HTTP/HTTPS ports are allowed.")

    host = (parsed.hostname or "").strip()
    if not host:
        raise RuntimeError("URL host is missing.")
    if host.lower() == "localhost":
        raise RuntimeError("Localhost URLs are not allowed.")

    try:
        if not _is_public_ip_address(host):
            raise RuntimeError("Non-public network URLs are not allowed.")
        return
    except ValueError:
        pass

    try:
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
        }
    except socket.gaierror as exc:
        raise RuntimeError(f"Could not resolve host: {exc}") from exc

    if not addresses:
        raise RuntimeError("Could not resolve host.")

    for address in addresses:
        if not _is_public_ip_address(address):
            raise RuntimeError("Resolved host points to a non-public network address.")


async def _safe_http_get(client: httpx.AsyncClient, url: str, headers: dict[str, str]) -> httpx.Response:
    current_url = url
    for _ in range(MAX_URL_REDIRECTS + 1):
        _validate_public_fetch_url(current_url)
        response = await client.get(current_url, headers=headers, follow_redirects=False)
        if response.status_code in REDIRECT_STATUS_CODES:
            location = response.headers.get("location")
            if not location:
                raise RuntimeError("Redirect response missing Location header.")
            current_url = str(httpx.URL(current_url).join(location))
            continue
        return response
    raise RuntimeError("Too many redirects.")


async def fetch_url_snapshot(url: str, max_chars: int = 1800) -> tuple[str, str | None]:
    timeout = httpx.Timeout(20.0, connect=8.0)
    headers = {
        "User-Agent": "ForgeLocal/1.0 (+http://localhost:5173)",
    }
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        response = await _safe_http_get(client, url, headers)

    if response.status_code != 200:
        raise RuntimeError(f"{url} returned {response.status_code}")

    content_type = response.headers.get("content-type", "").lower()
    raw_text = response.text
    title: str | None = None

    if "html" in content_type:
        title_match = re.search(r"<title[^>]*>(.*?)</title>", raw_text, flags=re.IGNORECASE | re.DOTALL)
        if title_match:
            title = re.sub(r"\s+", " ", unescape(title_match.group(1))).strip()
        text = _strip_html(raw_text)
    else:
        text = raw_text
        text = re.sub(r"\s+", " ", text).strip()

    if len(text) > max_chars:
        text = text[:max_chars].rstrip() + "..."

    return text, title


async def build_url_reader_context(user_message: str, max_urls: int = 2) -> tuple[str, list[str]]:
    urls = extract_urls(user_message, max_urls=max_urls)
    if not urls:
        return "", []

    sections: list[str] = ["URL Reader Context:"]
    failures: list[str] = []

    for url in urls:
        try:
            snippet, title = await fetch_url_snapshot(url)
            if not snippet:
                continue
            heading = title or url
            sections.append(f"- Source: {heading}\n  URL: {url}\n  Snippet: {snippet}")
        except Exception as exc:
            failures.append(f"{url} ({str(exc)[:120]})")

    if len(sections) == 1:
        return "", failures
    return "\n".join(sections), failures


async def build_typecheck_context(project_id: str, max_errors: int = 8) -> tuple[str, int]:
    result = await run_typecheck(project_id)
    if not result.has_errors:
        return "Typecheck Context:\n- No TypeScript errors found.", 0

    lines = ["Typecheck Context:"]
    for err in result.errors[:max_errors]:
        lines.append(f"- {err.file}:{err.line}:{err.column} {err.code}: {err.message}")
    remaining = len(result.errors) - max_errors
    if remaining > 0:
        lines.append(f"- ...and {remaining} more TypeScript errors")

    return "\n".join(lines), len(result.errors)
