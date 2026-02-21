from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from typing import Optional, List
from sqlmodel import Session

from database import get_session
from auth import get_request_user_id
from memory import load_memory, save_memory, clear_memory
from project_access import require_project_for_user

router = APIRouter(prefix="/api/memory", tags=["memory"])


class MemoryResponse(BaseModel):
    stack: List[str]
    components: List[str]
    color_scheme: str
    auth: bool
    database: str
    key_decisions: List[str]
    last_10_changes: List[str]
    features: List[str]
    styling: str
    state_management: str


class MemoryUpdate(BaseModel):
    color_scheme: Optional[str] = None
    auth: Optional[bool] = None
    database: Optional[str] = None


@router.get("/{project_id}", response_model=MemoryResponse)
def get_memory(
    project_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    require_project_for_user(session, project_id, get_request_user_id(request))

    memory = load_memory(project_id)
    return MemoryResponse(
        stack=memory.stack,
        components=memory.components,
        color_scheme=memory.color_scheme,
        auth=memory.auth,
        database=memory.database,
        key_decisions=memory.key_decisions,
        last_10_changes=memory.last_10_changes,
        features=memory.features,
        styling=memory.styling,
        state_management=memory.state_management,
    )


@router.patch("/{project_id}", response_model=MemoryResponse)
def update_memory_endpoint(
    project_id: str,
    data: MemoryUpdate,
    request: Request,
    session: Session = Depends(get_session),
):
    require_project_for_user(session, project_id, get_request_user_id(request))

    memory = load_memory(project_id)

    if data.color_scheme is not None:
        memory.color_scheme = data.color_scheme
    if data.auth is not None:
        memory.auth = data.auth
    if data.database is not None:
        memory.database = data.database

    save_memory(project_id, memory)

    return MemoryResponse(
        stack=memory.stack,
        components=memory.components,
        color_scheme=memory.color_scheme,
        auth=memory.auth,
        database=memory.database,
        key_decisions=memory.key_decisions,
        last_10_changes=memory.last_10_changes,
        features=memory.features,
        styling=memory.styling,
        state_management=memory.state_management,
    )


@router.delete("/{project_id}")
def reset_memory(
    project_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    require_project_for_user(session, project_id, get_request_user_id(request))

    clear_memory(project_id)
    return {"ok": True, "message": "Memory cleared"}
