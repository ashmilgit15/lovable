"""
Clerk JWT authentication middleware for FastAPI.

Verifies Clerk-issued session tokens (JWTs) using Clerk's JWKS endpoint.
If CLERK_SECRET_KEY is not set, auth is disabled (local-only mode).
"""

import os
import json
import time
from typing import Optional, Any
from urllib.request import urlopen
from urllib.request import Request as UrlRequest
from base64 import urlsafe_b64decode

from fastapi import Request, WebSocket, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

# ------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------

CLERK_SECRET_KEY = os.getenv("CLERK_SECRET_KEY", "")
CLERK_PUBLISHABLE_KEY = os.getenv("CLERK_PUBLISHABLE_KEY", "")

# If no secret key is set, auth is disabled (backward-compatible local mode)
AUTH_ENABLED = bool(CLERK_SECRET_KEY)
ALLOW_UNVERIFIED_LOCAL_AUTH = os.getenv(
    "ALLOW_UNVERIFIED_LOCAL_AUTH",
    "false",
).strip().lower() in {"1", "true", "yes", "on"}
# Local/dev fallback toggle for clients that pass `user_id` directly on websocket URLs.

# Endpoints that never require auth
PUBLIC_PATHS = {"/", "/health", "/api/health", "/docs", "/openapi.json", "/redoc"}
_NORMALIZED_PUBLIC_PATHS = {
    path.rstrip("/") if path != "/" else "/" for path in PUBLIC_PATHS
}


# ------------------------------------------------------------------
# JWKS cache
# ------------------------------------------------------------------

_jwks_cache: Optional[dict] = None
_jwks_cache_time: float = 0.0
_JWKS_CACHE_TTL = 3600  # 1 hour


def _get_clerk_jwks_url() -> str:
    """Derive the JWKS URL from the publishable key or secret key."""
    # Clerk's JWKS endpoint follows the pattern:
    # https://<clerk-frontend-api>/.well-known/jwks.json
    if CLERK_PUBLISHABLE_KEY.startswith("pk_"):
        # Extract frontend API from the publishable key
        # pk_test_xxx or pk_live_xxx -> the base64 part encodes the frontend API
        import base64

        parts = CLERK_PUBLISHABLE_KEY.split("_")
        if len(parts) >= 3:
            encoded = parts[2]
            # Add padding
            padding = 4 - len(encoded) % 4
            if padding != 4:
                encoded += "=" * padding
            try:
                frontend_api = base64.b64decode(encoded).decode("utf-8").rstrip("$")
                return f"https://{frontend_api}/.well-known/jwks.json"
            except Exception:
                pass

    # Fallback: Use Clerk API
    return "https://api.clerk.com/v1/jwks"


def _fetch_jwks() -> dict:
    """Fetch and cache Clerk's JWKS keys."""
    global _jwks_cache, _jwks_cache_time

    now = time.time()
    if _jwks_cache and (now - _jwks_cache_time) < _JWKS_CACHE_TTL:
        return _jwks_cache

    url = _get_clerk_jwks_url()
    headers = {}
    if CLERK_SECRET_KEY:
        headers["Authorization"] = f"Bearer {CLERK_SECRET_KEY}"

    req = UrlRequest(url, headers=headers)  # noqa: S310 — URL is config-derived
    with urlopen(req, timeout=8.0) as response:
        data = json.loads(response.read())

    _jwks_cache = data
    _jwks_cache_time = now
    return data


def _verify_token(token: str) -> dict:
    """Verify a Clerk JWT and return the decoded payload."""
    try:
        import jwt as pyjwt  # PyJWT
        from jwt import PyJWKClient
    except ImportError:
        raise RuntimeError(
            "PyJWT with cryptography is required for Clerk auth. "
            "Install with: pip install PyJWT[crypto]"
        )

    jwks_url = _get_clerk_jwks_url()
    jwks_client = PyJWKClient(jwks_url)

    signing_key = jwks_client.get_signing_key_from_jwt(token)
    decoded = pyjwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        options={"verify_aud": False},  # Clerk doesn't always set aud
    )

    # Verify the token hasn't expired
    if decoded.get("exp", 0) < time.time():
        raise ValueError("Token expired")

    return decoded


def extract_token_from_request(request: Request) -> Optional[str]:
    """Extract Bearer token from Authorization header."""
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return None


def extract_token_from_websocket(websocket: WebSocket) -> Optional[str]:
    """Extract token from WebSocket query params or headers."""
    # Try query param first (used by WebSocket connections)
    token = websocket.query_params.get("token")
    if token:
        return token

    # Then try Authorization header
    auth_header = websocket.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]

    return None


def _decode_token_unverified(token: str) -> Optional[dict]:
    """
    Decode JWT payload without signature verification.

    Used only when AUTH_ENABLED is false (local/dev mode) to preserve
    per-user isolation without requiring Clerk backend secret configuration.
    """
    try:
        import jwt as pyjwt  # PyJWT

        decoded = pyjwt.decode(
            token,
            options={
                "verify_signature": False,
                "verify_exp": False,
                "verify_aud": False,
            },
        )
        if isinstance(decoded, dict):
            return decoded
    except Exception:
        pass

    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None

        payload = parts[1]
        padding = "=" * ((4 - len(payload) % 4) % 4)
        decoded_bytes = urlsafe_b64decode(payload + padding)
        parsed = json.loads(decoded_bytes.decode("utf-8"))
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        return None

    return None


def _local_user_from_token(token: Optional[str]) -> str:
    if not token:
        return "local"
    decoded = _decode_token_unverified(token)
    if isinstance(decoded, dict):
        subject = decoded.get("sub")
        if subject:
            return str(subject)

    return "local"


def _normalize_path(path: str) -> str:
    normalized = (path or "").rstrip("/")
    return normalized or "/"


class ClerkAuthMiddleware(BaseHTTPMiddleware):
    """Middleware that verifies Clerk JWTs on incoming HTTP requests."""

    async def dispatch(self, request: Request, call_next):
        # Skip auth if not enabled
        if not AUTH_ENABLED:
            # In local mode, derive per-user identity from bearer token when available.
            request.state.user_id = _local_user_from_token(
                extract_token_from_request(request)
            )
            request.state.session_id = "local"
            return await call_next(request)

        # Always allow preflight requests to reach CORS middleware.
        if request.method.upper() == "OPTIONS":
            return await call_next(request)

        # Skip public paths
        request_path = _normalize_path(request.url.path)
        if request_path in _NORMALIZED_PUBLIC_PATHS:
            return await call_next(request)

        # Skip WebSocket upgrades (handled separately in the WS endpoints)
        if request.headers.get("upgrade", "").lower() == "websocket":
            return await call_next(request)

        token = extract_token_from_request(request)
        if not token:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Missing authentication token"},
            )

        try:
            claims = _verify_token(token)
            # Attach user info to request state
            request.state.user_id = claims.get("sub", "")
            request.state.session_id = claims.get("sid", "")
        except Exception:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Invalid authentication token"},
            )

        return await call_next(request)


async def verify_websocket_token(websocket: WebSocket) -> Optional[dict]:
    """Verify a Clerk JWT from a WebSocket connection. Returns claims or None."""
    if not AUTH_ENABLED:
        token = extract_token_from_websocket(websocket)
        local_user = _local_user_from_token(token)
        if local_user == "local" and ALLOW_UNVERIFIED_LOCAL_AUTH:
            # Final fallback for local/dev clients that pass user_id directly.
            local_user = websocket.query_params.get("user_id", "local")
        return {"sub": local_user, "sid": "local"}

    token = extract_token_from_websocket(websocket)
    if not token:
        return None

    try:
        return _verify_token(token)
    except Exception:
        return None


async def authorize_websocket_or_close(websocket: WebSocket) -> Optional[dict]:
    """
    Validate websocket auth and close with 4401 when unauthorized.
    Returns decoded claims when successful.
    """
    claims = await verify_websocket_token(websocket)
    if claims is not None:
        return claims

    await websocket.close(code=4401)
    return None


def get_request_user_id(request: Request) -> str:
    """
    Resolve current user id from request state.

    Returns "local" when auth is disabled or user id is unavailable.
    """
    user_id = getattr(request.state, "user_id", None)
    if user_id:
        return str(user_id)
    return "local"


def get_claim_user_id(claims: Optional[dict[str, Any]]) -> str:
    """
    Resolve current user id from websocket auth claims.

    Returns "local" when auth is disabled or user id is unavailable.
    """
    if isinstance(claims, dict):
        user_id = claims.get("sub")
        if user_id:
            return str(user_id)
    return "local"
