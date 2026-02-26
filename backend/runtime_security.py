import os


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


# Untrusted local code execution must always be an explicit opt-in.
# This prevents accidental remote RCE exposure when auth is not configured.
ENABLE_UNTRUSTED_CODE_EXECUTION = _env_flag(
    "ENABLE_UNTRUSTED_CODE_EXECUTION",
    default=False,
)


def is_untrusted_code_execution_enabled() -> bool:
    return ENABLE_UNTRUSTED_CODE_EXECUTION
