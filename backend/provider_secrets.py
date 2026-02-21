from __future__ import annotations

import base64
import hashlib
import os
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from sqlmodel import Session

from models import ProviderConfig, utcnow


class ProviderSecretError(RuntimeError):
    pass


def _raw_encryption_value() -> str:
    return os.getenv("BYOK_ENCRYPTION_KEY", "").strip()


@lru_cache(maxsize=1)
def _get_fernet() -> Fernet | None:
    raw_value = _raw_encryption_value()
    if not raw_value:
        return None

    candidate = raw_value.encode("utf-8")

    # Accept a direct Fernet key.
    try:
        return Fernet(candidate)
    except Exception:
        pass

    # Also accept a passphrase and derive a Fernet key from SHA-256.
    digest = hashlib.sha256(candidate).digest()
    derived_key = base64.urlsafe_b64encode(digest)
    return Fernet(derived_key)


def byok_encryption_ready() -> bool:
    return _get_fernet() is not None


def require_byok_encryption() -> Fernet:
    cipher = _get_fernet()
    if cipher is None:
        raise ProviderSecretError(
            "BYOK_ENCRYPTION_KEY is not configured. External provider keys are disabled."
        )
    return cipher


def encrypt_provider_api_key(api_key: str) -> str:
    value = (api_key or "").strip()
    if not value:
        raise ProviderSecretError("API key is required.")
    cipher = require_byok_encryption()
    return cipher.encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_provider_api_key(encrypted_value: str) -> str:
    value = (encrypted_value or "").strip()
    if not value:
        raise ProviderSecretError("Stored provider key is empty.")

    cipher = require_byok_encryption()
    try:
        return cipher.decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ProviderSecretError(
            "Stored provider key could not be decrypted. Check BYOK_ENCRYPTION_KEY."
        ) from exc


def resolve_provider_api_key(provider: ProviderConfig) -> str:
    if provider.api_key_encrypted:
        return decrypt_provider_api_key(provider.api_key_encrypted)

    legacy_value = (provider.api_key or "").strip()
    if legacy_value:
        if not byok_encryption_ready():
            raise ProviderSecretError(
                "Legacy plaintext provider key detected. Configure BYOK_ENCRYPTION_KEY and re-save the provider."
            )
        return legacy_value
    return ""


def migrate_legacy_provider_key(
    provider: ProviderConfig,
    session: Session,
) -> bool:
    if provider.api_key_encrypted:
        return False

    legacy_key = (provider.api_key or "").strip()
    if not legacy_key:
        return False
    if not byok_encryption_ready():
        return False

    provider.api_key_encrypted = encrypt_provider_api_key(legacy_key)
    provider.api_key = ""
    provider.updated_at = utcnow()
    session.add(provider)
    return True
