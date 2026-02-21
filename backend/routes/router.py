from fastapi import APIRouter, Request
from pydantic import BaseModel
from typing import Optional

from auth import get_request_user_id
from router import (
    get_routing_config,
    load_routing_overrides,
    save_routing_overrides,
    get_available_models,
    DEFAULT_MODEL_ROUTING,
)

router = APIRouter(prefix="/api/router", tags=["router"])


class RoutingOverrideUpdate(BaseModel):
    code: Optional[str] = None
    debug: Optional[str] = None
    explain: Optional[str] = None
    design: Optional[str] = None
    default: Optional[str] = None


@router.get("/config")
async def get_router_config(request: Request):
    user_id = get_request_user_id(request)
    base = get_routing_config()
    overrides = load_routing_overrides(user_id=user_id)
    available_models = await get_available_models()

    effective = dict(DEFAULT_MODEL_ROUTING)
    effective.update(overrides)

    return {
        **base,
        "overrides": overrides,
        "effective_routing": effective,
        "available_models": available_models,
    }


@router.patch("/overrides")
async def update_router_overrides(payload: RoutingOverrideUpdate, request: Request):
    user_id = get_request_user_id(request)
    current = load_routing_overrides(user_id=user_id)

    for key, value in payload.model_dump(exclude_none=True).items():
        if value.strip():
            current[key] = value.strip()

    overrides = save_routing_overrides(current, user_id=user_id)
    return {"ok": True, "overrides": overrides}


@router.delete("/overrides")
async def reset_router_overrides(request: Request):
    user_id = get_request_user_id(request)
    overrides = save_routing_overrides({}, user_id=user_id)
    return {"ok": True, "overrides": overrides}
