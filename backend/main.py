import os
import time
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from contextlib import asynccontextmanager
from pathlib import Path

from auth import ClerkAuthMiddleware
from observability import RequestObservabilityMiddleware, metrics_registry
from rate_limit import (
    InMemoryRateLimiter,
    RateLimitMiddleware,
    load_rate_limit_config,
)
from security_headers import SecurityHeadersMiddleware
from cors_config import load_cors_settings

from database import init_db
from routes.projects import router as projects_router
from routes.chat import router as chat_router
from routes.terminal import router as terminal_router
from routes.devserver import router as devserver_router
from routes.memory import router as memory_router
from routes.lint import router as lint_router
from routes.templates import router as templates_router
from routes.collab import router as collab_router
from routes.router import router as router_settings_router
from routes.providers import router as providers_router
from routes.todos import router as todos_router

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # print("DEBUG: Backend starting...")
    init_db()
    yield

app = FastAPI(title="One API", version="0.1.0", lifespan=lifespan)
STARTED_AT = time.time()
rate_limit_config = load_rate_limit_config()
rate_limiter = InMemoryRateLimiter(
    max_requests=rate_limit_config.max_requests,
    window_seconds=rate_limit_config.window_seconds,
)
cors_settings = load_cors_settings()

# CORS configuration
# Clerk auth middleware (no-op when CLERK_SECRET_KEY is not set)
app.add_middleware(ClerkAuthMiddleware)
app.add_middleware(
    RateLimitMiddleware,
    limiter=rate_limiter,
    config=rate_limit_config,
)
app.add_middleware(RequestObservabilityMiddleware, registry=metrics_registry)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_settings.allow_origins,
    allow_origin_regex=cors_settings.allow_origin_regex,
    allow_credentials=cors_settings.allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
@app.head("/")
async def root():
    return {"status": "ok", "message": "One API is running"}


# Health endpoints
@app.get("/health")
@app.get("/api/health")
async def health():
    metrics = metrics_registry.snapshot()
    return {
        "status": "ok",
        "version": "1.0.0",
        "uptime_seconds": round(time.time() - STARTED_AT, 2),
        "in_flight_requests": metrics["in_flight_requests"],
        "rate_limit_enabled": rate_limit_config.enabled,
    }


@app.get("/api/metrics")
async def metrics():
    return {
        "requests": metrics_registry.snapshot(),
        "rate_limit": {
            "enabled": rate_limit_config.enabled,
            **rate_limiter.snapshot(),
        },
    }

# Include Routers
app.include_router(projects_router)
app.include_router(chat_router)
app.include_router(terminal_router)
app.include_router(devserver_router)
app.include_router(memory_router)
app.include_router(lint_router)
app.include_router(templates_router)
app.include_router(collab_router)
app.include_router(router_settings_router)
app.include_router(providers_router)
app.include_router(todos_router)
