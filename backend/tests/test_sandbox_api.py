"""
# ============================================================
# Sandbox API 测试 (v1.0.0)
# Cycle 69 G69-01
# ============================================================
# 测试覆盖：
#   - POST   /api/sandbox/create
#   - POST   /api/sandbox/{id}/start
#   - POST   /api/sandbox/{id}/exec
#   - POST   /api/sandbox/{id}/stop
#   - DELETE /api/sandbox/{id}
#   - GET    /api/sandbox/list
#   - GET    /api/sandbox/{id}/audit
#   - GET    /api/sandbox/stats
#   - POST   /api/sandbox/retention/apply
# ====================================
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 69 G69-01 初次创建
# ====================================
"""

import os
import tempfile
from pathlib import Path
from typing import Generator
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.sandbox_executor import (
    BackendType,
    SandboxExecutor,
    reset_sandbox_executor_for_test,
)


@pytest.fixture(scope="module")
def client() -> Generator[TestClient, None, None]:
    """FastAPI 测试客户端（module scope 加速）"""
    with TestClient(app) as c:
        yield c


@pytest.fixture
def tmp_base_dir() -> Generator[Path, None, None]:
    with tempfile.TemporaryDirectory() as tmp:
        yield Path(tmp)


@pytest.fixture
def tmp_work_dir() -> Generator[Path, None, None]:
    with tempfile.TemporaryDirectory() as tmp:
        yield Path(tmp)


@pytest.fixture(autouse=True)
def reset_executor_between_tests(tmp_base_dir, monkeypatch):
    """每个测试前重置 executor + 注入 mock 后端"""
    reset_sandbox_executor_for_test()
    ex = SandboxExecutor(base_dir=tmp_base_dir, backend=BackendType.MOCK)
    # 通过 monkeypatch 替换 module-level getter
    monkeypatch.setattr("app.api.sandbox.get_sandbox_executor", lambda: ex)
    yield ex
    reset_sandbox_executor_for_test()


class TestCreateSandbox:
    def test_create_sandbox_success(self, client,  tmp_work_dir):
        resp = client.post(
            "/api/sandbox/create",
            json={
                "work_dir": str(tmp_work_dir),
                "resource_preset": "small",
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "sandbox_id" in data
        assert data["status"] in ("created", "running")
        assert data["work_dir"] == str(tmp_work_dir)
        assert data["backend"] == "mock"

    def test_create_sandbox_missing_work_dir(self, client):
        resp = client.post(
            "/api/sandbox/create",
            json={"resource_preset": "default"},
        )
        assert resp.status_code == 422  # Pydantic 验证

    def test_create_sandbox_nonexistent_path(self, client):
        resp = client.post(
            "/api/sandbox/create",
            json={"work_dir": "/this/does/not/exist/12345"},
        )
        assert resp.status_code == 400

    def test_create_sandbox_invalid_preset(self, client,  tmp_work_dir):
        resp = client.post(
            "/api/sandbox/create",
            json={"work_dir": str(tmp_work_dir), "resource_preset": "invalid"},
        )
        assert resp.status_code == 400

    def test_create_sandbox_with_network_policy(self, client,  tmp_work_dir):
        resp = client.post(
            "/api/sandbox/create",
            json={
                "work_dir": str(tmp_work_dir),
                "network_policy": {
                    "mode": "deny",
                    "allowed_domains": ["custom.example.com"],
                    "allowed_ports": [443],
                },
            },
        )
        assert resp.status_code == 201


class TestStartSandbox:
    def test_start_sandbox(self, client,  tmp_work_dir):
        # create
        create_resp = client.post(
            "/api/sandbox/create",
            json={"work_dir": str(tmp_work_dir)},
        )
        sb_id = create_resp.json()["sandbox_id"]
        # start
        resp = client.post(f"/api/sandbox/{sb_id}/start")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "running"

    def test_start_unknown_sandbox(self, client):
        resp = client.post("/api/sandbox/nonexistent-xyz/start")
        assert resp.status_code == 404


class TestExecSandbox:
    def test_exec_echo(self, client,  tmp_work_dir):
        create_resp = client.post(
            "/api/sandbox/create",
            json={"work_dir": str(tmp_work_dir)},
        )
        sb_id = create_resp.json()["sandbox_id"]
        resp = client.post(
            f"/api/sandbox/{sb_id}/exec",
            json={"command": ["echo", "hello-api"], "timeout": 5},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "hello-api" in data["stdout"]
        assert data["exit_code"] == 0
        assert data["duration_ms"] >= 0

    def test_exec_unknown_sandbox(self, client):
        resp = client.post(
            "/api/sandbox/nonexistent-xyz/exec",
            json={"command": ["echo", "hi"], "timeout": 5},
        )
        assert resp.status_code == 404

    def test_exec_empty_command(self, client,  tmp_work_dir):
        create_resp = client.post(
            "/api/sandbox/create",
            json={"work_dir": str(tmp_work_dir)},
        )
        sb_id = create_resp.json()["sandbox_id"]
        resp = client.post(
            f"/api/sandbox/{sb_id}/exec",
            json={"command": [], "timeout": 5},
        )
        assert resp.status_code in (400, 422)

    def test_exec_with_env(self, client,  tmp_work_dir):
        create_resp = client.post(
            "/api/sandbox/create",
            json={"work_dir": str(tmp_work_dir)},
        )
        sb_id = create_resp.json()["sandbox_id"]
        resp = client.post(
            f"/api/sandbox/{sb_id}/exec",
            json={
                "command": ["bash", "-c", "echo $CUSTOM_VAR"],
                "timeout": 5,
                "env": {"CUSTOM_VAR": "env-test-123"},
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "env-test-123" in data["stdout"]


class TestStopAndDelete:
    def test_stop_sandbox(self, client,  tmp_work_dir):
        create_resp = client.post(
            "/api/sandbox/create",
            json={"work_dir": str(tmp_work_dir)},
        )
        sb_id = create_resp.json()["sandbox_id"]
        resp = client.post(f"/api/sandbox/{sb_id}/stop")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "stopped"

    def test_stop_unknown_sandbox(self, client):
        resp = client.post("/api/sandbox/nonexistent-xyz/stop")
        assert resp.status_code == 404

    def test_delete_sandbox(self, client,  tmp_work_dir):
        create_resp = client.post(
            "/api/sandbox/create",
            json={"work_dir": str(tmp_work_dir)},
        )
        sb_id = create_resp.json()["sandbox_id"]
        resp = client.delete(f"/api/sandbox/{sb_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "destroyed"

    def test_delete_unknown_sandbox(self, client):
        resp = client.delete("/api/sandbox/nonexistent-xyz")
        assert resp.status_code == 404


class TestListSandboxes:
    def test_list_empty(self, client):
        resp = client.get("/api/sandbox/list")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["sandboxes"] == []

    def test_list_with_sandboxes(self, client,  tmp_work_dir):
        for _ in range(3):
            client.post("/api/sandbox/create", json={"work_dir": str(tmp_work_dir)})
        resp = client.get("/api/sandbox/list")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 3

    def test_list_filter_by_status(self, client,  tmp_work_dir):
        create_resp = client.post(
            "/api/sandbox/create",
            json={"work_dir": str(tmp_work_dir)},
        )
        sb_id = create_resp.json()["sandbox_id"]
        resp = client.get("/api/sandbox/list?status=running")
        assert resp.status_code == 200
        data = resp.json()
        if data["total"] > 0:
            assert all(s["status"] == "running" for s in data["sandboxes"])

    def test_list_invalid_status(self, client):
        resp = client.get("/api/sandbox/list?status=invalid_status")
        assert resp.status_code == 400


class TestAuditLog:
    def test_audit_log(self, client,  tmp_work_dir):
        create_resp = client.post(
            "/api/sandbox/create",
            json={"work_dir": str(tmp_work_dir)},
        )
        sb_id = create_resp.json()["sandbox_id"]
        # exec 触发审计
        client.post(
            f"/api/sandbox/{sb_id}/exec",
            json={"command": ["echo", "audit-test"], "timeout": 5},
        )
        resp = client.get(f"/api/sandbox/{sb_id}/audit")
        assert resp.status_code == 200
        data = resp.json()
        assert data["sandbox_id"] == sb_id
        assert data["total"] >= 2  # create + exec
        events = [e["event"] for e in data["events"]]
        assert "create" in events

    def test_audit_log_unknown_sandbox(self, client):
        resp = client.get("/api/sandbox/nonexistent-xyz/audit")
        assert resp.status_code == 404


class TestStats:
    def test_stats(self, client,  tmp_work_dir):
        client.post("/api/sandbox/create", json={"work_dir": str(tmp_work_dir)})
        resp = client.get("/api/sandbox/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert "total" in data
        assert "by_status" in data
        assert "by_backend" in data
        assert data["total"] >= 1


class TestRetention:
    def test_retention(self, client,  tmp_work_dir):
        client.post("/api/sandbox/create", json={"work_dir": str(tmp_work_dir)})
        resp = client.post("/api/sandbox/retention/apply?max_age_days=30")
        assert resp.status_code == 200
        data = resp.json()
        assert "cleaned" in data
        assert "max_age_days" in data
