import os
import httpx
import json
import time
from typing import Optional
from dataclasses import dataclass
from enum import Enum


OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
CLASSIFIER_MODEL = os.getenv("CLASSIFIER_MODEL", "mistral:7b")
ROUTING_OVERRIDES_PATH = os.getenv(
    "ROUTING_OVERRIDES_PATH", os.path.abspath("./data/routing_overrides.json")
)
ROUTING_OVERRIDES_DIR = os.path.dirname(ROUTING_OVERRIDES_PATH) or os.path.abspath("./data")
ROUTING_OVERRIDES_BASENAME = os.path.basename(ROUTING_OVERRIDES_PATH)

DEFAULT_MODEL_ROUTING = {
    "code": "qwen2.5-coder:7b",
    "debug": "deepseek-coder:6.7b",
    "explain": "mistral:7b",
    "design": "llama3.1:8b",
    "default": "llama3.1:8b",
}

_MODELS_CACHE: dict[str, object] = {
    "models": [],
    "expires_at": 0.0,
}


class Intent(Enum):
    CODE = "code"
    DEBUG = "debug"
    EXPLAIN = "explain"
    DESIGN = "design"
    DEFAULT = "default"


@dataclass
class IntentResult:
    intent: Intent
    confidence: float
    model: str


INTENT_KEYWORDS = {
    Intent.CODE: [
        "build",
        "create",
        "add feature",
        "implement",
        "generate",
        "make",
        "new component",
        "new page",
        "add a",
        "create a",
        "develop",
        "write",
        "scaffold",
        "set up",
        "setup",
        "build me",
    ],
    Intent.DEBUG: [
        "fix",
        "debug",
        "error",
        "bug",
        "broken",
        "not working",
        "crash",
        "issue",
        "problem",
        "solve",
        "resolve",
        "exception",
        "failed",
        "doesn't work",
        "dont work",
        "help fix",
    ],
    Intent.EXPLAIN: [
        "explain",
        "how does",
        "what is",
        "why does",
        "tell me",
        "describe",
        "what are",
        "how do",
        "clarify",
        "understand",
        "show me how",
        "walk me through",
    ],
    Intent.DESIGN: [
        "design",
        "make it look",
        "style",
        "appearance",
        "ui",
        "ux",
        "prettier",
        "beautiful",
        "modern",
        "animate",
        "color",
        "theme",
        "layout",
        "responsive",
        "mobile",
    ],
}


def classify_intent_simple(message: str) -> IntentResult:
    message_lower = message.lower()

    scores = {}
    for intent, keywords in INTENT_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in message_lower)
        scores[intent] = score

    max_score = max(scores.values())
    if max_score == 0:
        return IntentResult(
            intent=Intent.DEFAULT,
            confidence=0.5,
            model=DEFAULT_MODEL_ROUTING["default"],
        )

    best_intent = max(scores, key=scores.get)
    confidence = min(0.9, 0.5 + (max_score * 0.1))

    return IntentResult(
        intent=best_intent,
        confidence=confidence,
        model=DEFAULT_MODEL_ROUTING[best_intent.value],
    )


async def classify_intent_ai(
    message: str, available_models: list[str] = None
) -> IntentResult:
    simple_result = classify_intent_simple(message)

    if len(message.split()) < 5:
        return simple_result

    # Shortcut when keyword classifier is already decisive.
    if simple_result.intent != Intent.DEFAULT and simple_result.confidence >= 0.75:
        return simple_result

    try:
        prompt = f"""Classify this message as: code|debug|explain|design.
Reply with one word only.
Message: {message}"""

        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": CLASSIFIER_MODEL,
                    "prompt": prompt,
                    "stream": False,
                },
            )

            if response.status_code == 200:
                data = response.json()
                result_text = data.get("response", "").strip().lower()

                intent_map = {
                    "code": Intent.CODE,
                    "debug": Intent.DEBUG,
                    "explain": Intent.EXPLAIN,
                    "design": Intent.DESIGN,
                }

                if result_text in intent_map:
                    return IntentResult(
                        intent=intent_map[result_text],
                        confidence=0.85,
                        model=DEFAULT_MODEL_ROUTING[result_text],
                    )
    except Exception:
        pass

    return simple_result


async def get_available_models(force_refresh: bool = False) -> list[str]:
    now = time.time()
    cached_models = _MODELS_CACHE.get("models") or []
    expires_at = float(_MODELS_CACHE.get("expires_at") or 0.0)
    if not force_refresh and cached_models and expires_at > now:
        return list(cached_models)

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if response.status_code == 200:
                payload = response.json()
                models = [
                    m.get("name", "")
                    for m in payload.get("models", [])
                    if m.get("name")
                ]
                _MODELS_CACHE["models"] = models
                _MODELS_CACHE["expires_at"] = now + 30
                return models
    except Exception:
        pass
    return list(cached_models)


def get_model_for_intent(
    intent: Intent, available_models: list[str] = None, user_overrides: dict = None
) -> str:
    if user_overrides and intent.value in user_overrides:
        return user_overrides[intent.value]

    preferred = DEFAULT_MODEL_ROUTING[intent.value]

    if available_models:
        for model in available_models:
            if preferred.split(":")[0] in model:
                return model

        for model in available_models:
            if "coder" in model and intent in [Intent.CODE, Intent.DEBUG]:
                return model

        if available_models:
            return available_models[0]

    return preferred


def get_routing_config() -> dict:
    return {
        "default_routing": DEFAULT_MODEL_ROUTING,
        "classifier_model": CLASSIFIER_MODEL,
        "intent_keywords": {k.value: v for k, v in INTENT_KEYWORDS.items()},
    }


def _normalize_user_id(user_id: str | None) -> str:
    return (user_id or "local").strip() or "local"


def _safe_user_id_for_filename(user_id: str | None) -> str:
    normalized = _normalize_user_id(user_id)
    safe = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in normalized)[:80]
    return safe or "user"


def _routing_overrides_path_for_user(user_id: str | None = None) -> str:
    normalized = _normalize_user_id(user_id)
    if normalized == "local":
        return ROUTING_OVERRIDES_PATH

    base_name, ext = os.path.splitext(ROUTING_OVERRIDES_BASENAME)
    suffix = _safe_user_id_for_filename(normalized)
    extension = ext or ".json"
    return os.path.join(ROUTING_OVERRIDES_DIR, f"{base_name}.{suffix}{extension}")


def load_routing_overrides(user_id: str | None = None) -> dict[str, str]:
    overrides_path = _routing_overrides_path_for_user(user_id)
    if not os.path.exists(overrides_path):
        return {}

    try:
        with open(overrides_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}

    if not isinstance(data, dict):
        return {}

    normalized: dict[str, str] = {}
    for key, value in data.items():
        if key in DEFAULT_MODEL_ROUTING and isinstance(value, str) and value.strip():
            normalized[key] = value.strip()
    return normalized


def save_routing_overrides(
    overrides: dict[str, str],
    user_id: str | None = None,
) -> dict[str, str]:
    overrides_path = _routing_overrides_path_for_user(user_id)
    os.makedirs(os.path.dirname(overrides_path), exist_ok=True)

    normalized: dict[str, str] = {}
    for key, value in overrides.items():
        if key in DEFAULT_MODEL_ROUTING and isinstance(value, str) and value.strip():
            normalized[key] = value.strip()

    with open(overrides_path, "w", encoding="utf-8") as f:
        json.dump(normalized, f, indent=2)

    return normalized
