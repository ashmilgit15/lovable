from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
]


@dataclass(frozen=True)
class CORSSettings:
    allow_origins: list[str]
    allow_origin_regex: str | None
    allow_credentials: bool


def _normalize_origin(origin: str) -> str:
    return origin.strip().rstrip("/")


def parse_cors_origins(raw_value: str | None) -> list[str]:
    if raw_value is None:
        candidates = DEFAULT_CORS_ORIGINS
    else:
        candidates = raw_value.split(",")

    normalized: list[str] = []
    for item in candidates:
        origin = _normalize_origin(item)
        if not origin:
            continue
        if origin not in normalized:
            normalized.append(origin)

    return normalized


def load_cors_settings() -> CORSSettings:
    allow_origins = parse_cors_origins(os.getenv("CORS_ORIGINS"))
    if not allow_origins:
        allow_origins = DEFAULT_CORS_ORIGINS.copy()

    allow_origin_regex = (os.getenv("CORS_ORIGIN_REGEX") or "").strip() or None
    allow_credentials = "*" not in allow_origins

    return CORSSettings(
        allow_origins=allow_origins,
        allow_origin_regex=allow_origin_regex,
        allow_credentials=allow_credentials,
    )
