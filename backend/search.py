import asyncio
import os
import re
from dataclasses import dataclass

import httpx


SERP_API_URL = os.getenv("SERP_API_URL", "https://serpapi.com/search.json")

SEARCH_INTENT_PATTERNS = (
    re.compile(r"\bsearch\b", re.IGNORECASE),
    re.compile(r"\bgoogle\b", re.IGNORECASE),
    re.compile(r"\bweb\s+search\b", re.IGNORECASE),
    re.compile(r"\blook\s+up\b", re.IGNORECASE),
    re.compile(r"\bon\s+the\s+web\b", re.IGNORECASE),
    re.compile(r"\bfind\s+online\b", re.IGNORECASE),
    re.compile(r"\blatest\s+news\b", re.IGNORECASE),
)


@dataclass
class SearchResult:
    title: str
    snippet: str
    link: str
    source: str | None = None


def get_serp_api_key() -> str:
    return os.getenv("SERP_API_KEY", "").strip()


def should_use_web_search(message: str) -> bool:
    if not message:
        return False
    return any(pattern.search(message) for pattern in SEARCH_INTENT_PATTERNS)


def _safe_text(value: object) -> str:
    return str(value or "").strip()


def _collect_results(payload: dict, max_results: int) -> list[SearchResult]:
    results: list[SearchResult] = []

    answer_box = payload.get("answer_box") or {}
    answer_snippet = (
        _safe_text(answer_box.get("answer"))
        or _safe_text(answer_box.get("snippet"))
        or _safe_text(answer_box.get("snippet_highlighted_words"))
    )
    answer_title = _safe_text(answer_box.get("title")) or "Answer Box"
    answer_link = _safe_text(answer_box.get("link"))
    if answer_snippet:
        results.append(
            SearchResult(
                title=answer_title,
                snippet=answer_snippet,
                link=answer_link,
                source="answer_box",
            )
        )

    organic_results = payload.get("organic_results") or []
    for item in organic_results:
        title = _safe_text(item.get("title"))
        snippet = _safe_text(item.get("snippet")) or _safe_text(item.get("snippet_highlighted_words"))
        link = _safe_text(item.get("link"))
        if not title and not snippet:
            continue
        results.append(
            SearchResult(
                title=title or "Result",
                snippet=snippet or "No snippet provided.",
                link=link,
                source="organic",
            )
        )
        if len(results) >= max_results:
            break

    if len(results) < max_results:
        news_results = payload.get("news_results") or []
        for item in news_results:
            title = _safe_text(item.get("title"))
            snippet = _safe_text(item.get("snippet"))
            link = _safe_text(item.get("link"))
            if not title and not snippet:
                continue
            results.append(
                SearchResult(
                    title=title or "News Result",
                    snippet=snippet or "No snippet provided.",
                    link=link,
                    source="news",
                )
            )
            if len(results) >= max_results:
                break

    return results[:max_results]


async def search_web(query: str, max_results: int = 6) -> tuple[list[SearchResult], str | None]:
    api_key = get_serp_api_key()
    if not api_key:
        return [], "SERP_API_KEY is not configured."

    params = {
        "engine": "google",
        "q": query,
        "api_key": api_key,
        "hl": "en",
        "gl": "us",
        "num": max_results,
    }

    timeout = httpx.Timeout(65.0, connect=15.0)
    attempts = 3
    last_error: str | None = None

    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(1, attempts + 1):
            try:
                response = await client.get(SERP_API_URL, params=params)
            except httpx.HTTPError as exc:
                detail = str(exc).strip() or repr(exc)
                last_error = f"Web search request failed: {detail}"
                if attempt < attempts:
                    await asyncio.sleep(1.2 * attempt)
                    continue
                return [], last_error

            if response.status_code != 200:
                last_error = f"Web search returned {response.status_code}."
                if response.status_code >= 500 and attempt < attempts:
                    await asyncio.sleep(1.2 * attempt)
                    continue
                return [], last_error

            try:
                payload = response.json()
            except ValueError:
                last_error = "Web search response was not valid JSON."
                if attempt < attempts:
                    await asyncio.sleep(1.2 * attempt)
                    continue
                return [], last_error

            if payload.get("error"):
                return [], str(payload["error"])

            results = _collect_results(payload, max_results=max_results)
            if results:
                return results, None

            last_error = "No usable web results were returned."
            if attempt < attempts:
                await asyncio.sleep(1.2 * attempt)
                continue

    return [], last_error or "No usable web results were returned."


def format_web_results_for_prompt(query: str, results: list[SearchResult]) -> str:
    if not results:
        return ""

    lines = [f'Web search results for query: "{query}"']
    for index, result in enumerate(results, start=1):
        lines.append(
            "\n".join(
                [
                    f"{index}. {result.title}",
                    f"URL: {result.link or 'N/A'}",
                    f"Snippet: {result.snippet}",
                ]
            )
        )
    return "\n\n".join(lines)
