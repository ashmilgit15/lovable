"""
Tests for scaling middleware primitives (rate limiting + observability).
"""

import os
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from observability import RequestMetricsRegistry, RequestObservabilityMiddleware
from rate_limit import InMemoryRateLimiter, RateLimitConfig, RateLimitMiddleware


def _build_test_app(
    *,
    limit: int = 2,
    window_seconds: int = 60,
    exempt_paths: tuple[str, ...] = (),
):
    app = FastAPI()
    registry = RequestMetricsRegistry()
    limiter = InMemoryRateLimiter(max_requests=limit, window_seconds=window_seconds)
    config = RateLimitConfig(
        enabled=True,
        max_requests=limit,
        window_seconds=window_seconds,
        exempt_paths=exempt_paths,
    )

    app.add_middleware(RateLimitMiddleware, limiter=limiter, config=config)
    app.add_middleware(RequestObservabilityMiddleware, registry=registry)

    @app.get("/ping")
    def ping():
        return {"ok": True}

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/explode")
    def explode():
        raise RuntimeError("boom")

    return app, registry


class TestRateLimitMiddleware:
    def test_requests_are_limited(self):
        app, _ = _build_test_app(limit=2, exempt_paths=())
        client = TestClient(app)

        assert client.get("/ping").status_code == 200
        assert client.get("/ping").status_code == 200

        blocked = client.get("/ping")
        assert blocked.status_code == 429
        assert blocked.headers.get("x-ratelimit-limit") == "2"
        assert blocked.headers.get("x-ratelimit-remaining") == "0"

    def test_exempt_paths_bypass_limits(self):
        app, _ = _build_test_app(limit=1, exempt_paths=("/health",))
        client = TestClient(app)

        assert client.get("/health").status_code == 200
        assert client.get("/health").status_code == 200
        assert client.get("/health").status_code == 200


class TestObservabilityMiddleware:
    def test_metrics_registry_collects_requests(self):
        app, registry = _build_test_app(limit=10, exempt_paths=())
        client = TestClient(app, raise_server_exceptions=False)

        assert client.get("/ping").status_code == 200
        assert client.get("/ping").status_code == 200
        assert client.get("/explode").status_code == 500

        snapshot = registry.snapshot()
        assert snapshot["total_requests"] >= 3
        assert snapshot["total_errors"] >= 1
        assert "GET" in snapshot["method_counts"]
