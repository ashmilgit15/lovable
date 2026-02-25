from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import or_
from sqlmodel import Session, select

from models import Project, utcnow


def normalize_user_id(user_id: str | None) -> str:
    return (user_id or "local").strip() or "local"


def owned_project_filter(user_id: str | None):
    normalized_user_id = normalize_user_id(user_id)
    if normalized_user_id == "local":
        return or_(Project.owner_id == "local", Project.owner_id.is_(None))
    return Project.owner_id == normalized_user_id


def _can_claim_legacy_owner(project: Project, normalized_user_id: str) -> bool:
    owner_id = normalize_user_id(project.owner_id)
    return owner_id == "local" and normalized_user_id != "local"


def claim_legacy_projects_for_user(session: Session, user_id: str | None) -> int:
    """
    Migrate legacy local projects to the current authenticated user.

    Returns number of migrated projects.
    """
    normalized_user_id = normalize_user_id(user_id)
    if normalized_user_id == "local":
        return 0

    legacy_projects = session.exec(
        select(Project).where(or_(Project.owner_id == "local", Project.owner_id.is_(None)))
    ).all()
    if not legacy_projects:
        return 0

    migrated = 0
    for project in legacy_projects:
        project.owner_id = normalized_user_id
        project.updated_at = utcnow()
        session.add(project)
        migrated += 1

    session.commit()
    return migrated


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
    if owner_id == normalized_user_id:
        return project

    if _can_claim_legacy_owner(project, normalized_user_id):
        project.owner_id = normalized_user_id
        project.updated_at = utcnow()
        session.add(project)
        session.commit()
        session.refresh(project)
        return project

    raise HTTPException(status_code=404, detail="Project not found")
