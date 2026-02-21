from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import List
from sqlmodel import Session, select
import json

from database import get_session
from models import FileSnapshot, Generation
from auth import get_request_user_id
from project_access import require_project_for_user
from linter import lint_project

router = APIRouter(prefix="/api/lint", tags=["linting"])


def parse_files_changed(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return [str(item) for item in parsed]
    except (json.JSONDecodeError, TypeError):
        pass

    # Backward compatibility for old non-JSON rows.
    return [item.strip(" '\"") for item in value.strip("[]").split(",") if item.strip()]


class LintResponse(BaseModel):
    has_errors: bool
    errors: List[dict]
    error_count: int
    raw_output: str


@router.get("/{project_id}", response_model=LintResponse)
async def lint_project_endpoint(
    project_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    require_project_for_user(session, project_id, get_request_user_id(request))

    result = await lint_project(project_id)
    return LintResponse(**result)


@router.get("/{project_id}/snapshots")
def get_snapshots(
    project_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    require_project_for_user(session, project_id, get_request_user_id(request))

    snapshots = session.exec(
        select(FileSnapshot)
        .where(FileSnapshot.project_id == project_id)
        .order_by(FileSnapshot.created_at.desc())
        .limit(50)
    ).all()

    generations = session.exec(
        select(Generation)
        .where(Generation.project_id == project_id)
        .order_by(Generation.created_at.desc())
        .limit(20)
    ).all()

    return {
        "snapshots": [
            {
                "id": s.id,
                "filename": s.filename,
                "created_at": s.created_at.isoformat(),
                "generation_id": s.generation_id,
            }
            for s in snapshots
        ],
        "generations": [
            {
                "id": g.id,
                "user_message": g.user_message,
                "files_changed": parse_files_changed(g.files_changed),
                "created_at": g.created_at.isoformat(),
            }
            for g in generations
        ],
    }


@router.get("/{project_id}/snapshots/{snapshot_id}")
def get_snapshot_content(
    project_id: str,
    snapshot_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    require_project_for_user(session, project_id, get_request_user_id(request))
    snapshot = session.get(FileSnapshot, snapshot_id)
    if not snapshot or snapshot.project_id != project_id:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    return {
        "id": snapshot.id,
        "filename": snapshot.filename,
        "content": snapshot.content,
        "created_at": snapshot.created_at.isoformat(),
    }


@router.get("/{project_id}/generations/{generation_id}")
def get_generation_files(
    project_id: str,
    generation_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    require_project_for_user(session, project_id, get_request_user_id(request))
    generation = session.get(Generation, generation_id)
    if not generation or generation.project_id != project_id:
        raise HTTPException(status_code=404, detail="Generation not found")

    snapshots = session.exec(
        select(FileSnapshot).where(FileSnapshot.generation_id == generation_id)
    ).all()

    return {
        "generation": {
            "id": generation.id,
            "user_message": generation.user_message,
            "files_changed": parse_files_changed(generation.files_changed),
            "created_at": generation.created_at.isoformat(),
        },
        "snapshots": [
            {
                "id": s.id,
                "filename": s.filename,
                "content": s.content,
                "created_at": s.created_at.isoformat(),
            }
            for s in snapshots
        ],
    }
