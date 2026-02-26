import os
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import auth


def _build_app_with_cors() -> FastAPI:
    app = FastAPI()
    app.add_middleware(auth.ClerkAuthMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["https://lovable-rose.vercel.app"],
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=True,
    )

    @app.get("/private")
    async def private():
        return {"ok": True}

    return app


def test_auth_401_response_keeps_cors_headers(monkeypatch):
    monkeypatch.setattr(auth, "AUTH_ENABLED", True)
    client = TestClient(_build_app_with_cors(), raise_server_exceptions=False)

    response = client.get(
        "/private",
        headers={"Origin": "https://lovable-rose.vercel.app"},
    )

    assert response.status_code == 401
    assert (
        response.headers.get("access-control-allow-origin")
        == "https://lovable-rose.vercel.app"
    )
