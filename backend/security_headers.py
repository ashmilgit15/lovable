from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request


API_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "Cross-Origin-Resource-Policy": "same-site",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path

        if path.startswith("/api") or path in {"/health", "/api/health"}:
            for key, value in API_SECURITY_HEADERS.items():
                response.headers.setdefault(key, value)
            if path.startswith("/api"):
                response.headers.setdefault("Cache-Control", "no-store")

        return response
