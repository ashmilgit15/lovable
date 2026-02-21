"""
Test configuration — provides fixtures for FastAPI test client with in-memory DB.
"""

import os
import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy.pool import StaticPool

# Override database URL before importing the app
os.environ["DATABASE_URL"] = "sqlite://"  # in-memory


@pytest.fixture(scope="session")
def test_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


@pytest.fixture
def session(test_engine):
    with Session(test_engine) as session:
        yield session


@pytest.fixture
def client():
    # Need to override the database engine before importing the app
    import database

    database.engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(database.engine)

    from main import app

    with TestClient(app) as c:
        yield c
