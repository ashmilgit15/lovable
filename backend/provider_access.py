from __future__ import annotations

from sqlalchemy import or_
from sqlmodel import Session, select

from models import ProviderConfig, utcnow


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


def _can_claim_legacy_owner(
    provider: ProviderConfig,
    normalized_user_id: str,
) -> bool:
    owner_id = normalize_provider_owner_id(provider.owner_id)
    return owner_id == "local" and normalized_user_id != "local"


def claim_legacy_providers_for_user(session: Session, user_id: str | None) -> int:
    """
    Migrate legacy local providers to the current authenticated user.

    Returns number of migrated provider records.
    """
    normalized_user_id = normalize_provider_owner_id(user_id)
    if normalized_user_id == "local":
        return 0

    providers = session.exec(
        select(ProviderConfig).where(
            or_(
                ProviderConfig.owner_id == "local",
                ProviderConfig.owner_id.is_(None),
            )
        )
    ).all()
    if not providers:
        return 0

    migrated = 0
    for provider in providers:
        if not _can_claim_legacy_owner(provider, normalized_user_id):
            continue
        provider.owner_id = normalized_user_id
        provider.updated_at = utcnow()
        session.add(provider)
        migrated += 1

    if migrated:
        session.commit()
    return migrated
