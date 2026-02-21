from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import or_
from sqlmodel import Session

from models import Project


def normalize_user_id(user_id: str | None) -> str:
    return (user_id or "local").strip() or "local"


def owned_project_filter(user_id: str | None):
    normalized_user_id = normalize_user_id(user_id)
    if normalized_user_id == "local":
        return or_(Project.owner_id == "local", Project.owner_id.is_(None))
    return Project.owner_id == normalized_user_id


def require_project_for_user(
    session: Session,
    project_id: str,
    user_id: str | None,
) -> Project:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    owner_id = normalize_user_id(project.owner_id)
    normalized_user_id = normalize_user_id(user_id)
    if owner_id != normalized_user_id:
        raise HTTPException(status_code=404, detail="Project not found")

    return project
