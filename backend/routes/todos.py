from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session

from database import get_session
from auth import get_request_user_id
from project_access import require_project_for_user
from todo_planner import (
    create_plan,
    ensure_plan,
    load_todo_state,
    mark_project_complete,
    progress_plan,
    reset_todo_state,
    set_task_status,
)

router = APIRouter(prefix="/api/todos", tags=["todos"])


def _require_project(session: Session, project_id: str, request: Request):
    require_project_for_user(session, project_id, get_request_user_id(request))


class PlanRequest(BaseModel):
    objective: str
    reset: bool = False


class TaskStatusUpdate(BaseModel):
    status: str


@router.get("/{project_id}")
def get_todo_state(
    project_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    _require_project(session, project_id, request)
    return load_todo_state(project_id)


@router.post("/{project_id}/plan")
def create_or_update_plan(
    project_id: str,
    payload: PlanRequest,
    request: Request,
    session: Session = Depends(get_session),
):
    _require_project(session, project_id, request)
    if payload.reset:
        return create_plan(project_id, payload.objective)
    return ensure_plan(project_id, payload.objective)


@router.patch("/{project_id}/tasks/{task_id}")
def update_task_status(
    project_id: str,
    task_id: str,
    payload: TaskStatusUpdate,
    request: Request,
    session: Session = Depends(get_session),
):
    _require_project(session, project_id, request)
    normalized = payload.status.strip().lower()
    if normalized not in {"pending", "in_progress", "done"}:
        raise HTTPException(status_code=400, detail="Invalid todo status")
    return set_task_status(project_id, task_id, normalized)  # type: ignore[arg-type]


@router.post("/{project_id}/progress/{percent}")
def update_progress(
    project_id: str,
    percent: int,
    request: Request,
    session: Session = Depends(get_session),
):
    _require_project(session, project_id, request)
    ratio = max(0.0, min(100.0, float(percent))) / 100.0
    return progress_plan(project_id, ratio)


@router.post("/{project_id}/complete")
def complete_project(
    project_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    _require_project(session, project_id, request)
    return mark_project_complete(project_id)


@router.delete("/{project_id}")
def clear_plan(
    project_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    _require_project(session, project_id, request)
    return reset_todo_state(project_id)
