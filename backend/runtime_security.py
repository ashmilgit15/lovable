import os


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


_auth_is_configured = bool(os.getenv("CLERK_SECRET_KEY", "").strip())

# In local mode (no Clerk backend auth), keep current dev UX.
# In hosted/authenticated mode, default to safer behavior unless explicitly enabled.
ENABLE_UNTRUSTED_CODE_EXECUTION = _env_flag(
    "ENABLE_UNTRUSTED_CODE_EXECUTION",
    default=not _auth_is_configured,
)


def is_untrusted_code_execution_enabled() -> bool:
    return ENABLE_UNTRUSTED_CODE_EXECUTION

