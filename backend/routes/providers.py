from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from typing import Optional
from sqlmodel import Session, select

from auth import get_request_user_id
from database import get_session
from models import ProviderConfig, utcnow
from provider_access import normalize_provider_owner_id, owned_provider_filter
from provider_secrets import (
    ProviderSecretError,
    byok_encryption_ready,
    encrypt_provider_api_key,
    migrate_legacy_provider_key,
)

router = APIRouter(prefix="/api/providers", tags=["providers"])


PROVIDER_PRESETS = {
    "openai": {
        "label": "OpenAI",
        "base_url": "https://api.openai.com/v1",
    },
    "openrouter": {
        "label": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
    },
    "groq": {
        "label": "Groq",
        "base_url": "https://api.groq.com/openai/v1",
    },
    "together": {
        "label": "Together",
        "base_url": "https://api.together.xyz/v1",
    },
    "custom_openai": {
        "label": "Custom (OpenAI-compatible)",
        "base_url": "",
    },
}


class ProviderCreate(BaseModel):
    name: str
    provider: str
    model: str
    api_key: str
    base_url: Optional[str] = None
    is_active: bool = False


class ProviderUpdate(BaseModel):
    name: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    is_active: Optional[bool] = None


def _mask_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return f"{key[:4]}...{key[-4:]}"


def _provider_has_api_key(provider: ProviderConfig) -> bool:
    return bool((provider.api_key_encrypted or "").strip() or (provider.api_key or "").strip())


def _provider_masked_key(provider: ProviderConfig) -> str:
    if provider.api_key_encrypted:
        return "****encrypted****"
    return _mask_key(provider.api_key or "")


def serialize_provider(provider: ProviderConfig) -> dict:
    return {
        "id": provider.id,
        "name": provider.name,
        "provider": provider.provider,
        "model": provider.model,
        "base_url": provider.base_url,
        "is_active": provider.is_active,
        "created_at": provider.created_at,
        "updated_at": provider.updated_at,
        "has_api_key": _provider_has_api_key(provider),
        "api_key_masked": _provider_masked_key(provider),
    }


def resolve_base_url(provider_name: str, requested_base_url: Optional[str]) -> str:
    preset = PROVIDER_PRESETS.get(provider_name, {})
    return (requested_base_url or preset.get("base_url") or "").strip()


def _require_byok_encryption_or_503():
    if not byok_encryption_ready():
        raise HTTPException(
            status_code=503,
            detail=(
                "BYOK is disabled. Configure BYOK_ENCRYPTION_KEY to use external providers."
            ),
        )


def _resolve_provider_for_user(
    session: Session,
    provider_id: str,
    user_id: str,
) -> ProviderConfig:
    provider = session.exec(
        select(ProviderConfig).where(
            ProviderConfig.id == provider_id,
            owned_provider_filter(user_id),
        )
    ).first()
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    return provider


def _migrate_provider_list_if_needed(session: Session, providers: list[ProviderConfig]):
    changed = False
    for provider in providers:
        if migrate_legacy_provider_key(provider, session):
            changed = True
    if changed:
        session.commit()


@router.get("")
def list_providers(request: Request, session: Session = Depends(get_session)):
    user_id = normalize_provider_owner_id(get_request_user_id(request))
    providers = session.exec(
        select(ProviderConfig)
        .where(owned_provider_filter(user_id))
        .order_by(ProviderConfig.created_at.asc())
    ).all()
    _migrate_provider_list_if_needed(session, providers)
    return {
        "providers": [serialize_provider(provider) for provider in providers],
        "presets": PROVIDER_PRESETS,
        "encryption_ready": byok_encryption_ready(),
    }


@router.get("/paged")
def list_providers_paged(
    request: Request,
    session: Session = Depends(get_session),
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    search: Optional[str] = Query(default=None),
):
    user_id = normalize_provider_owner_id(get_request_user_id(request))
    providers = session.exec(
        select(ProviderConfig)
        .where(owned_provider_filter(user_id))
        .order_by(ProviderConfig.created_at.asc())
    ).all()
    _migrate_provider_list_if_needed(session, providers)
    serialized = [serialize_provider(provider) for provider in providers]

    if search and search.strip():
        token = search.strip().lower()
        serialized = [
            provider
            for provider in serialized
            if token in provider["name"].lower()
            or token in provider["provider"].lower()
            or token in provider["model"].lower()
        ]

    total = len(serialized)
    items = serialized[offset : offset + limit]
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": (offset + len(items)) < total,
        "presets": PROVIDER_PRESETS,
        "encryption_ready": byok_encryption_ready(),
    }


@router.post("")
def create_provider(
    data: ProviderCreate,
    request: Request,
    session: Session = Depends(get_session),
):
    provider_name = data.provider.strip().lower()
    if provider_name not in PROVIDER_PRESETS:
        raise HTTPException(status_code=400, detail="Unsupported provider")

    if not data.name.strip():
        raise HTTPException(status_code=400, detail="Provider name is required")
    if not data.model.strip():
        raise HTTPException(status_code=400, detail="Model is required")
    if not data.api_key.strip():
        raise HTTPException(status_code=400, detail="API key is required")

    _require_byok_encryption_or_503()

    user_id = normalize_provider_owner_id(get_request_user_id(request))
    try:
        encrypted_api_key = encrypt_provider_api_key(data.api_key.strip())
    except ProviderSecretError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    provider = ProviderConfig(
        owner_id=user_id,
        name=data.name.strip(),
        provider=provider_name,
        model=data.model.strip(),
        api_key_encrypted=encrypted_api_key,
        api_key="",
        base_url=resolve_base_url(provider_name, data.base_url),
        is_active=bool(data.is_active),
    )

    if provider.is_active:
        active_providers = session.exec(
            select(ProviderConfig).where(
                owned_provider_filter(user_id),
                ProviderConfig.is_active == True,  # noqa: E712
            )
        ).all()
        for existing in active_providers:
            existing.is_active = False
            existing.updated_at = utcnow()
            session.add(existing)

    session.add(provider)
    session.commit()
    session.refresh(provider)
    return serialize_provider(provider)


@router.patch("/{provider_id}")
def update_provider(
    provider_id: str,
    data: ProviderUpdate,
    request: Request,
    session: Session = Depends(get_session),
):
    user_id = normalize_provider_owner_id(get_request_user_id(request))
    provider = _resolve_provider_for_user(session, provider_id, user_id)

    payload = data.model_dump(exclude_none=True)
    if "provider" in payload:
        normalized_provider = payload["provider"].strip().lower()
        if normalized_provider not in PROVIDER_PRESETS:
            raise HTTPException(status_code=400, detail="Unsupported provider")
        provider.provider = normalized_provider

    if "name" in payload:
        provider.name = payload["name"].strip() or provider.name
    if "model" in payload:
        provider.model = payload["model"].strip() or provider.model
    if "api_key" in payload:
        api_key = payload["api_key"].strip()
        if api_key:
            _require_byok_encryption_or_503()
            try:
                provider.api_key_encrypted = encrypt_provider_api_key(api_key)
            except ProviderSecretError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
            provider.api_key = ""
    if "base_url" in payload:
        provider.base_url = resolve_base_url(provider.provider, payload["base_url"])

    if payload.get("is_active") is True:
        active_providers = session.exec(
            select(ProviderConfig).where(
                owned_provider_filter(user_id),
                ProviderConfig.is_active == True,  # noqa: E712
            )
        ).all()
        for existing in active_providers:
            existing.is_active = False
            existing.updated_at = utcnow()
            session.add(existing)
        provider.is_active = True
    elif payload.get("is_active") is False:
        provider.is_active = False

    provider.updated_at = utcnow()
    session.add(provider)
    session.commit()
    session.refresh(provider)
    return serialize_provider(provider)


@router.post("/{provider_id}/activate")
def activate_provider(
    provider_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    user_id = normalize_provider_owner_id(get_request_user_id(request))
    provider = _resolve_provider_for_user(session, provider_id, user_id)

    providers = session.exec(
        select(ProviderConfig).where(owned_provider_filter(user_id))
    ).all()
    for item in providers:
        item.is_active = item.id == provider_id
        item.updated_at = utcnow()
        session.add(item)

    session.commit()
    session.refresh(provider)
    return {"ok": True, "active_provider_id": provider.id}


@router.delete("/{provider_id}")
def delete_provider(
    provider_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    user_id = normalize_provider_owner_id(get_request_user_id(request))
    provider = _resolve_provider_for_user(session, provider_id, user_id)
    session.delete(provider)
    session.commit()
    return {"ok": True}


@router.get("/active")
def get_active_provider(request: Request, session: Session = Depends(get_session)):
    user_id = normalize_provider_owner_id(get_request_user_id(request))
    provider = session.exec(
        select(ProviderConfig).where(
            owned_provider_filter(user_id),
            ProviderConfig.is_active == True,  # noqa: E712
        )
    ).first()
    if not provider:
        return {"provider": None, "encryption_ready": byok_encryption_ready()}
    migrate_legacy_provider_key(provider, session)
    session.commit()
    session.refresh(provider)
    return {
        "provider": serialize_provider(provider),
        "encryption_ready": byok_encryption_ready(),
    }
