from __future__ import annotations

from sqlalchemy import or_

from models import ProviderConfig


def normalize_provider_owner_id(user_id: str | None) -> str:
    return (user_id or "local").strip() or "local"


def owned_provider_filter(user_id: str | None):
    normalized_user_id = normalize_provider_owner_id(user_id)
    if normalized_user_id == "local":
        return or_(
            ProviderConfig.owner_id == "local",
            ProviderConfig.owner_id.is_(None),
        )
    return ProviderConfig.owner_id == normalized_user_id

