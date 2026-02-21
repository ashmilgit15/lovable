from __future__ import annotations

import re
import threading
import time
import uuid
from collections import Counter, deque

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

UUID_SEGMENT_RE = re.compile(
    r"/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}"
)
NUMERIC_SEGMENT_RE = re.compile(r"/\d+")


def normalize_path(path: str) -> str:
    normalized = UUID_SEGMENT_RE.sub("/:id", path)
    normalized = NUMERIC_SEGMENT_RE.sub("/:id", normalized)
    return normalized


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    index = int(round((len(sorted_values) - 1) * percentile))
    return sorted_values[max(0, min(index, len(sorted_values) - 1))]


class RequestMetricsRegistry:
    def __init__(self):
        self._lock = threading.Lock()
        self.started_at = time.time()
        self.total_requests = 0
        self.total_errors = 0
        self.in_flight = 0
        self.total_latency_ms = 0.0
        self.max_latency_ms = 0.0
        self.status_counts: Counter[str] = Counter()
        self.method_counts: Counter[str] = Counter()
        self.path_counts: Counter[str] = Counter()
        self._latency_samples = deque(maxlen=2000)

    def start_request(self):
        with self._lock:
            self.in_flight += 1

    def observe(
        self,
        *,
        method: str,
        path: str,
        status_code: int,
        duration_ms: float,
    ):
        with self._lock:
            self.in_flight = max(0, self.in_flight - 1)
            self.total_requests += 1
            if status_code >= 500:
                self.total_errors += 1

            self.total_latency_ms += duration_ms
            self.max_latency_ms = max(self.max_latency_ms, duration_ms)
            self._latency_samples.append(duration_ms)

            self.status_counts[str(status_code)] += 1
            self.method_counts[method.upper()] += 1
            self.path_counts[normalize_path(path)] += 1

    def snapshot(self) -> dict:
        with self._lock:
            avg_latency = (
                self.total_latency_ms / self.total_requests
                if self.total_requests > 0
                else 0.0
            )
            latency_values = list(self._latency_samples)
            p95 = _percentile(latency_values, 0.95)
            p99 = _percentile(latency_values, 0.99)

            return {
                "started_at": self.started_at,
                "uptime_seconds": round(time.time() - self.started_at, 2),
                "total_requests": self.total_requests,
                "total_errors": self.total_errors,
                "in_flight_requests": self.in_flight,
                "avg_latency_ms": round(avg_latency, 2),
                "max_latency_ms": round(self.max_latency_ms, 2),
                "p95_latency_ms": round(p95, 2),
                "p99_latency_ms": round(p99, 2),
                "status_counts": dict(self.status_counts),
                "method_counts": dict(self.method_counts),
                "top_paths": dict(self.path_counts.most_common(20)),
            }


metrics_registry = RequestMetricsRegistry()


class RequestObservabilityMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, registry: RequestMetricsRegistry):
        super().__init__(app)
        self.registry = registry

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = request_id
        self.registry.start_request()
        started = time.perf_counter()

        try:
            response = await call_next(request)
        except Exception:
            duration_ms = (time.perf_counter() - started) * 1000
            self.registry.observe(
                method=request.method,
                path=request.url.path,
                status_code=500,
                duration_ms=duration_ms,
            )
            raise

        duration_ms = (time.perf_counter() - started) * 1000
        self.registry.observe(
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=duration_ms,
        )

        response.headers["X-Request-ID"] = request_id
        response.headers["X-Response-Time-Ms"] = f"{duration_ms:.2f}"
        return response
