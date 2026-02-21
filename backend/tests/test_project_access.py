"""
Tests for per-user project ownership guards.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine, select
from sqlalchemy.pool import StaticPool

from models import Project
from project_access import require_project_for_user, owned_project_filter


@pytest.fixture
def ownership_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def test_require_project_for_user_allows_owner(ownership_session: Session):
    project = Project(name="owner test", owner_id="user_a")
    ownership_session.add(project)
    ownership_session.commit()

    resolved = require_project_for_user(ownership_session, project.id, "user_a")
    assert resolved.id == project.id


def test_require_project_for_user_blocks_other_user(ownership_session: Session):
    project = Project(name="owner test", owner_id="user_a")
    ownership_session.add(project)
    ownership_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        require_project_for_user(ownership_session, project.id, "user_b")

    assert exc_info.value.status_code == 404


def test_owned_project_filter_returns_only_matching_owner(ownership_session: Session):
    ownership_session.add(Project(name="a1", owner_id="user_a"))
    ownership_session.add(Project(name="a2", owner_id="user_a"))
    ownership_session.add(Project(name="b1", owner_id="user_b"))
    ownership_session.add(Project(name="local1", owner_id="local"))
    ownership_session.commit()

    user_a_projects = ownership_session.exec(
        select(Project).where(owned_project_filter("user_a"))
    ).all()
    local_projects = ownership_session.exec(
        select(Project).where(owned_project_filter("local"))
    ).all()

    assert {project.owner_id for project in user_a_projects} == {"user_a"}
    assert {project.owner_id for project in local_projects} == {"local"}
