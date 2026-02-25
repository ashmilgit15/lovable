import os
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import auth


def _build_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(auth.ClerkAuthMiddleware)

    @app.get("/")
    @app.head("/")
    async def root():
        return {"ok": True}

    @app.get("/private")
    async def private():
        return {"ok": True}

    return app


class TestClerkAuthMiddleware:
    def test_head_root_is_public_when_auth_enabled(self, monkeypatch):
        monkeypatch.setattr(auth, "AUTH_ENABLED", True)
        client = TestClient(_build_app(), raise_server_exceptions=False)

        response = client.head("/")
        assert response.status_code == 200

    def test_missing_token_returns_401_response(self, monkeypatch):
        monkeypatch.setattr(auth, "AUTH_ENABLED", True)
        client = TestClient(_build_app(), raise_server_exceptions=False)

        response = client.get("/private")
        assert response.status_code == 401
        assert response.json() == {"detail": "Missing authentication token"}
