from __future__ import annotations

import math
import os
import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Deque

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

DEFAULT_EXEMPT_PATHS = (
    "/health",
    "/api/health",
    "/docs",
    "/redoc",
    "/openapi.json",
)


def _parse_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_int(value: str | None, default: int, minimum: int) -> int:
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return max(minimum, parsed)


@dataclass(frozen=True)
class RateLimitConfig:
    enabled: bool
    max_requests: int
    window_seconds: int
    exempt_paths: tuple[str, ...]


def load_rate_limit_config() -> RateLimitConfig:
    raw_exempt = os.getenv("RATE_LIMIT_EXEMPT_PATHS", "")
    extra_paths = [path.strip() for path in raw_exempt.split(",") if path.strip()]

    exempt = list(DEFAULT_EXEMPT_PATHS)
    for path in extra_paths:
        if path not in exempt:
            exempt.append(path)

    return RateLimitConfig(
        enabled=_parse_bool(os.getenv("RATE_LIMIT_ENABLED"), True),
        max_requests=_parse_int(os.getenv("RATE_LIMIT_MAX_REQUESTS"), 180, 1),
        window_seconds=_parse_int(os.getenv("RATE_LIMIT_WINDOW_SECONDS"), 60, 1),
        exempt_paths=tuple(exempt),
    )


class InMemoryRateLimiter:
    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._buckets: dict[str, Deque[float]] = {}
        self._lock = threading.Lock()

    def evaluate(self, key: str, now: float | None = None) -> tuple[bool, int, int]:
        ts = now if now is not None else time.time()
        cutoff = ts - self.window_seconds

        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                bucket = deque()
                self._buckets[key] = bucket

            while bucket and bucket[0] <= cutoff:
                bucket.popleft()

            if len(bucket) >= self.max_requests:
                retry_after = math.ceil((bucket[0] + self.window_seconds) - ts)
                return False, 0, max(1, retry_after)

            bucket.append(ts)
            remaining = max(0, self.max_requests - len(bucket))
            reset_after = math.ceil((bucket[0] + self.window_seconds) - ts)
            return True, remaining, max(1, reset_after)

    def snapshot(self) -> dict:
        now = time.time()
        active_keys = 0
        total_in_window = 0

        with self._lock:
            for key, bucket in list(self._buckets.items()):
                cutoff = now - self.window_seconds
                while bucket and bucket[0] <= cutoff:
                    bucket.popleft()
                if not bucket:
                    del self._buckets[key]
                    continue
                active_keys += 1
                total_in_window += len(bucket)

        return {
            "max_requests": self.max_requests,
            "window_seconds": self.window_seconds,
            "active_keys": active_keys,
            "requests_in_window": total_in_window,
        }


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        *,
        limiter: InMemoryRateLimiter,
        config: RateLimitConfig,
    ):
        super().__init__(app)
        self.limiter = limiter
        self.config = config

    def _is_exempt(self, path: str) -> bool:
        for exempt in self.config.exempt_paths:
            if exempt.endswith("*"):
                if path.startswith(exempt[:-1]):
                    return True
                continue
            if path == exempt:
                return True
        return False

    @staticmethod
    def _client_key(request: Request) -> str:
        forwarded_for = request.headers.get("x-forwarded-for", "").strip()
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        if request.client and request.client.host:
            return request.client.host
        return "unknown"

    def _limit_headers(self, remaining: int, reset_after: int) -> dict[str, str]:
        return {
            "X-RateLimit-Limit": str(self.config.max_requests),
            "X-RateLimit-Remaining": str(remaining),
            "X-RateLimit-Reset": str(reset_after),
        }

    async def dispatch(self, request: Request, call_next):
        if not self.config.enabled:
            return await call_next(request)

        if request.method.upper() == "OPTIONS" or self._is_exempt(request.url.path):
            return await call_next(request)

        key = self._client_key(request)
        allowed, remaining, reset_after = self.limiter.evaluate(key)
        headers = self._limit_headers(remaining, reset_after)

        if not allowed:
            headers["Retry-After"] = str(reset_after)
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Please retry later."},
                headers=headers,
            )

        response = await call_next(request)
        for header, value in headers.items():
            response.headers[header] = value
        return response
