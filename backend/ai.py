import os
import re
import json
from dataclasses import dataclass
from typing import AsyncGenerator, Optional

import httpx

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_DEFAULT_MODEL = os.getenv("OLLAMA_DEFAULT_MODEL", "llama3.1")

SYSTEM_PROMPT = """You are an expert AI app builder for One.
You build production-ready web apps using the configured external AI provider.

You help users build React web applications by chatting with them and generating 
real, complete code in real-time. You are fast, precise, and never lazy.

---

## INTERFACE LAYOUT
- Left panel: Chat window where the user talks to you
- Center panel: Monaco code editor showing generated files with a file tree
- Right panel: Live preview (Sandpack) + Terminal (runs real shell commands)
- Bottom bar: Status, model name, terminal output

---

## TECHNOLOGY STACK YOU GENERATE
Every app you build uses ONLY this stack:
- React 18 + TypeScript + Vite
- TailwindCSS for all styling (no inline styles, no CSS modules)
- shadcn/ui for components
- react-hook-form + zod for forms
- React Query for server state
- Zustand for client state
- No backend unless user asks — frontend-only by default

You NEVER generate:
- Angular, Vue, Svelte, Next.js, native mobile
- Plain CSS files or styled-components
- Class components (always use functional components + hooks)

---

## HOW YOU RESPOND

When the user describes a feature or app, you IMMEDIATELY generate code.
You do NOT ask clarifying questions — you make smart assumptions and build.
You do NOT explain what you're about to do — you just do it.
You do NOT write partial code or placeholders like "// add logic here".

You respond in this EXACT format every single time:

FILE: src/App.tsx
```tsx
[complete file, no omissions]
```

FILE: src/components/ComponentName.tsx
```tsx
[complete file, no omissions]
```

EXPLANATION:
[maximum 2 sentences on what was built]

---

## CODE RULES
- Every file must be 100% complete and immediately runnable
- TailwindCSS only — never write custom CSS or inline styles
- Always use semantic HTML (header, main, section, article, nav, footer)
- All images need descriptive alt text
- Components must be small and focused — one responsibility per file
- Never put everything in App.tsx — split into proper components
- Use TypeScript strictly — no `any` types
- Always handle loading and error states
- Forms always use react-hook-form + zod

---

## DESIGN RULES
- Generate beautiful, modern, dark-first designs by default
- Use TailwindCSS design tokens consistently
- Responsive by default — mobile first
- Add subtle animations using Tailwind's transition and animate classes
- Use shadcn/ui components as the base — customize via variants
- Never use white/black directly — use Tailwind semantic colors

---

## ITERATION BEHAVIOR
When the user asks to change something:
- Only modify what they asked — never touch unrelated code
- Keep all existing functionality intact
- If a component needs to be refactored for the change, refactor it cleanly

---

## DEBUGGING BEHAVIOR  
When the user pastes an error:
- Read it carefully
- Identify the exact file and line causing it
- Generate the fixed file immediately
- Explain the fix in one sentence

---

## PERFORMANCE
- You generate files as fast as possible, one after another, no pausing
- You never repeat yourself
- You never summarize what you already said
- Every response moves the project forward

You are One Builder. You build fast. You build clean."""


@dataclass
class ParsedFile:
    filename: str
    content: str
    language: str


@dataclass
class ParsedResponse:
    files: list[ParsedFile]
    explanation: str


def parse_ai_response(text: str) -> ParsedResponse:
    """Extract FILE blocks from AI response text.
    Supports both:
    1. FILE: path/to/file
       ```lang
       content
       ```
    2. ```lang FILE: path/to/file
       content
       ```
    """
    files = []

    # Pattern 1: FILE: path line before code block
    pattern1 = r"FILE:\s*(.+?)\n```(\w*)\n(.*?)```"
    matches1 = re.findall(pattern1, text, re.DOTALL)
    for filename, lang, content in matches1:
        files.append(ParsedFile(
            filename=filename.strip(),
            content=content.strip(),
            language=lang.strip() or "tsx"
        ))

    # Pattern 2: FILE path inside code block header
    pattern2 = r"```(\w+)\s+FILE:\s*(.+?)\n(.*?)```"
    matches2 = re.findall(pattern2, text, re.DOTALL)
    for lang, filename, content in matches2:
        # Avoid duplicates if both patterns match (though unlikely with these regexes)
        if not any(f.filename == filename.strip() for f in files):
            files.append(ParsedFile(
                filename=filename.strip(),
                content=content.strip(),
                language=lang.strip()
            ))

    # Remove all file blocks to get explanation text
    explanation = text
    explanation = re.sub(r"FILE:\s*.+?\n```\w*\n.*?```", "", explanation, flags=re.DOTALL)
    explanation = re.sub(r"```\w+\s+FILE:\s*.+?\n.*?```", "", explanation, flags=re.DOTALL)

    return ParsedResponse(files=files, explanation=explanation.strip())


def sanitize_assistant_message_text(text: str) -> str:
    """
    Remove generated code/file payloads from assistant output and keep user-facing summary text.
    """
    raw = (text or "").strip()
    if not raw:
        return ""

    parsed = parse_ai_response(raw)
    candidate = (parsed.explanation or raw).strip()
    candidate = re.sub(r"^\s*EXPLANATION:\s*", "", candidate, flags=re.IGNORECASE)
    candidate = re.sub(r"(?im)^FILE:\s*.+$", "", candidate)
    candidate = re.sub(r"```[\w-]*\n.*?```", "", candidate, flags=re.DOTALL)
    candidate = re.sub(r"\n{3,}", "\n\n", candidate)
    return candidate.strip()


async def stream_from_ollama(messages: list[dict], model: str | None = None) -> AsyncGenerator[str, None]:
    """Stream response from Ollama using httpx."""
    model = model or OLLAMA_DEFAULT_MODEL
    url = f"{OLLAMA_BASE_URL}/api/chat"

    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0)) as client:
        async with client.stream("POST", url, json=payload) as response:
            if response.status_code != 200:
                error_text = await response.aread()
                raise AIProviderError(f"Ollama returned {response.status_code}: {error_text.decode()}")

            async for line in response.aiter_lines():
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    if "message" in data and "content" in data["message"]:
                        yield data["message"]["content"]
                    if data.get("done"):
                        break
                except json.JSONDecodeError:
                    continue


async def stream_from_openai_compatible(
    messages: list[dict],
    model: str,
    base_url: str,
    api_key: str,
    extra_headers: Optional[dict[str, str]] = None,
) -> AsyncGenerator[str, None]:
    """Stream response from OpenAI-compatible chat completion endpoints."""

    if not base_url:
        raise AIProviderError("External provider base URL is missing")
    if not api_key:
        raise AIProviderError("External provider API key is missing")

    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}"}
    if extra_headers:
        headers.update(extra_headers)

    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "temperature": 0.2,
    }

    timeout = httpx.Timeout(300.0, connect=15.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as response:
            if response.status_code != 200:
                error_text = (await response.aread()).decode(errors="ignore")
                raise AIProviderError(
                    f"Provider returned {response.status_code}: {error_text[:500]}"
                )

            async for line in response.aiter_lines():
                if not line:
                    continue
                if not line.startswith("data:"):
                    continue

                payload_str = line[5:].strip()
                if payload_str == "[DONE]":
                    break

                try:
                    data = json.loads(payload_str)
                except json.JSONDecodeError:
                    continue

                choices = data.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                token = delta.get("content")
                if token:
                    yield token


async def generate_project_title(message: str, model: str | None = None) -> str:
    """Generate a short 3-word title for the project based on the user's message."""

    model = model or OLLAMA_DEFAULT_MODEL
    url = f"{OLLAMA_BASE_URL}/api/generate"

    prompt = f"Give this project a short 3-word name based on: {message}. Reply with only the name, no punctuation."

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(url, json=payload)
            if response.status_code == 200:
                data = response.json()
                title = data.get("response", "").strip().strip('"').strip("'")
                return title
    except Exception as e:
        print(f"Error generating title: {e}")
        return ""
    return ""

class AIProviderError(Exception):
    pass


class AIConnectionError(AIProviderError):
    pass


class AIModelError(AIProviderError):
    pass


# Backward-compatible aliases
OllamaError = AIProviderError
OllamaConnectionError = AIConnectionError
OllamaModelError = AIModelError
