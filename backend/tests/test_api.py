"""
Integration tests for the REST API endpoints.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Override database before app import
os.environ["DATABASE_URL"] = "sqlite://"

from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine
from sqlalchemy.pool import StaticPool
import database
from routes import devserver as devserver_routes


def _make_client() -> TestClient:
    database.engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(database.engine)

    from main import app

    return TestClient(app)


class TestHealthEndpoint:
    def test_health(self):
        client = _make_client()
        res = client.get("/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert res.headers.get("X-Content-Type-Options") == "nosniff"
        assert res.headers.get("X-Frame-Options") == "DENY"

    def test_api_health(self):
        client = _make_client()
        res = client.get("/api/health")
        assert res.status_code == 200
        assert res.headers.get("Cache-Control") == "no-store"
        assert res.headers.get("Permissions-Policy") is not None


class TestProjectsCRUD:
    def test_create_project(self):
        client = _make_client()
        res = client.post(
            "/api/projects",
            json={"name": "Test Project", "description": "test"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["name"] == "Test Project"
        assert "id" in data

    def test_list_projects(self):
        client = _make_client()
        # Create a project first
        client.post("/api/projects", json={"name": "List Test"})
        res = client.get("/api/projects")
        assert res.status_code == 200
        projects = res.json()
        assert isinstance(projects, list)
        assert len(projects) >= 1

    def test_get_project(self):
        client = _make_client()
        create_res = client.post("/api/projects", json={"name": "Get Test"})
        project_id = create_res.json()["id"]

        res = client.get(f"/api/projects/{project_id}")
        assert res.status_code == 200
        data = res.json()
        assert data["project"]["name"] == "Get Test"

    def test_delete_project(self):
        client = _make_client()
        create_res = client.post("/api/projects", json={"name": "Delete Test"})
        project_id = create_res.json()["id"]

        res = client.delete(f"/api/projects/{project_id}")
        assert res.status_code == 200

        # Verify it's gone
        res = client.get(f"/api/projects/{project_id}")
        assert res.status_code == 404

    def test_update_project(self):
        client = _make_client()
        create_res = client.post("/api/projects", json={"name": "Update Test"})
        project_id = create_res.json()["id"]

        res = client.patch(
            f"/api/projects/{project_id}",
            json={"name": "Updated Name"},
        )
        assert res.status_code == 200
        assert res.json()["name"] == "Updated Name"

    def test_update_file_rejects_path_traversal(self):
        client = _make_client()
        create_res = client.post("/api/projects", json={"name": "Path Safety Test"})
        project_id = create_res.json()["id"]

        update_res = client.put(
            f"/api/projects/{project_id}/files",
            json={"filename": "../escape.txt", "content": "bad"},
        )
        assert update_res.status_code == 400

        project_res = client.get(f"/api/projects/{project_id}")
        assert project_res.status_code == 200
        files = project_res.json()["files"]
        assert not any(file["filename"] == "../escape.txt" for file in files)

    def test_list_projects_paged(self):
        client = _make_client()
        for idx in range(4):
            client.post("/api/projects", json={"name": f"Paged Test {idx}"})

        res = client.get("/api/projects/paged?limit=2&offset=0")
        assert res.status_code == 200
        payload = res.json()
        assert payload["limit"] == 2
        assert payload["offset"] == 0
        assert payload["total"] >= 4
        assert len(payload["items"]) <= 2
        assert isinstance(payload["has_more"], bool)


class TestOperationalEndpoints:
    def test_metrics_endpoint(self):
        client = _make_client()
        res = client.get("/api/metrics")
        assert res.status_code == 200
        data = res.json()
        assert "requests" in data
        assert "rate_limit" in data


class TestDevServerStatus:
    def test_status_reports_disabled_flag(self, monkeypatch):
        client = _make_client()
        created = client.post("/api/projects", json={"name": "Status Disabled"})
        project_id = created.json()["id"]

        monkeypatch.setattr(
            devserver_routes,
            "is_untrusted_code_execution_enabled",
            lambda: False,
        )

        response = client.get(f"/api/projects/{project_id}/devserver/status")
        assert response.status_code == 200
        assert response.json() == {
            "running": False,
            "port": None,
            "disabled": True,
        }
