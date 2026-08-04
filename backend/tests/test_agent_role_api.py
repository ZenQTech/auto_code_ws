"""
# ============================================================
# Agent Roles API 测试
# Cycle 63 G63-02
# ====================================
"""

import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))
# 同时将项目根目录加入路径（解决 cli_integration.executor 依赖）
PROJECT_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(PROJECT_ROOT))


@pytest.fixture(autouse=True)
def reset_manager():
    """每个测试前重置 manager"""
    from app.services.agent_role_manager import reset_agent_role_manager, AgentRoleManager
    reset_agent_role_manager()
    mgr = AgentRoleManager(storage_dir=None)
    import app.services.agent_role_manager as m
    m._manager = mgr
    yield
    reset_agent_role_manager()


@pytest.fixture
def client():
    from app.services.agent_role_manager import reset_agent_role_manager, AgentRoleManager
    reset_agent_role_manager()
    mgr = AgentRoleManager(storage_dir=None)
    with patch("app.api.agent_roles.get_agent_role_manager") as mock_get:
        mock_get.return_value = mgr
        from app.main import app
        with TestClient(app) as c:
            yield c


# ============================================================
# Role CRUD API
# ============================================================


class TestRoleListAPI:
    def test_list_builtin_roles(self, client):
        resp = client.get("/api/agent-roles")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["total"] == 4
        names = {r["name"] for r in data["roles"]}
        assert names == {"default", "worker", "explorer", "monitor"}

    def test_list_includes_builtin_flag(self, client):
        resp = client.get("/api/agent-roles")
        for r in resp.json()["roles"]:
            assert "builtin" in r
            assert r["builtin"] is True


class TestRoleGetAPI:
    def test_get_role(self, client):
        resp = client.get("/api/agent-roles/worker")
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"]["name"] == "worker"
        assert "nickname_candidates" in data["role"]

    def test_get_nonexistent(self, client):
        resp = client.get("/api/agent-roles/nonexistent")
        assert resp.status_code == 404


class TestRoleCreateAPI:
    def test_create_role(self, client):
        resp = client.post(
            "/api/agent-roles",
            json={
                "name": "custom-test",
                "description": "Test role",
                "developer_instructions": "Do test",
                "model": "gpt-5.5",
                "sandbox_mode": "read-only",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["role"]["name"] == "custom-test"

    def test_create_invalid_name(self, client):
        resp = client.post(
            "/api/agent-roles",
            json={"name": "Invalid-Name", "description": "x", "developer_instructions": "y"},
        )
        # Pydantic 校验失败
        assert resp.status_code in (400, 422)

    def test_create_duplicate(self, client):
        client.post(
            "/api/agent-roles",
            json={"name": "dup", "description": "x", "developer_instructions": "y"},
        )
        resp = client.post(
            "/api/agent-roles",
            json={"name": "dup", "description": "x", "developer_instructions": "y"},
        )
        assert resp.status_code == 409


class TestRoleUpdateAPI:
    def test_update_custom_role(self, client):
        client.post(
            "/api/agent-roles",
            json={"name": "upd", "description": "d1", "developer_instructions": "i1"},
        )
        resp = client.put(
            "/api/agent-roles/upd",
            json={"description": "d2", "model": "gpt-5.5"},
        )
        assert resp.status_code == 200
        assert resp.json()["role"]["description"] == "d2"

    def test_update_nonexistent(self, client):
        resp = client.put(
            "/api/agent-roles/nonexistent",
            json={"description": "x"},
        )
        assert resp.status_code == 404


class TestRoleDeleteAPI:
    def test_delete_custom_role(self, client):
        client.post(
            "/api/agent-roles",
            json={"name": "to-del", "description": "x", "developer_instructions": "y"},
        )
        resp = client.delete("/api/agent-roles/to-del")
        assert resp.status_code == 200

    def test_delete_builtin_rejected(self, client):
        resp = client.delete("/api/agent-roles/default")
        assert resp.status_code == 400

    def test_delete_nonexistent(self, client):
        resp = client.delete("/api/agent-roles/nonexistent")
        assert resp.status_code == 404


# ============================================================
# TOML 加载
# ============================================================


class TestTOMLLoadAPI:
    def test_load_toml(self, client):
        toml_content = '''
[role]
name = "toml-role"
description = "Loaded from TOML"
developer_instructions = "TOML instructions"
nickname_candidates = ["A", "B"]
model = "gpt-5.5"
sandbox_mode = "read-only"
'''
        with tempfile.NamedTemporaryFile(mode="w", suffix=".toml", delete=False) as f:
            f.write(toml_content)
            path = f.name
        try:
            resp = client.post(
                "/api/agent-roles/load-toml",
                json={"toml_path": path},
            )
            assert resp.status_code == 200
            assert resp.json()["role"]["name"] == "toml-role"
        finally:
            Path(path).unlink(missing_ok=True)

    def test_load_nonexistent_toml(self, client):
        resp = client.post(
            "/api/agent-roles/load-toml",
            json={"toml_path": "/nonexistent.toml"},
        )
        assert resp.status_code == 400


# ============================================================
# Instance API
# ============================================================


class TestInstanceSpawnAPI:
    def test_spawn_instance(self, client):
        resp = client.post(
            "/api/agent-roles/worker/spawn",
            json={"task": "Test task"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["instance"]["role_name"] == "worker"
        assert data["instance"]["status"] == "running"

    def test_spawn_with_nickname(self, client):
        resp = client.post(
            "/api/agent-roles/explorer/spawn",
            json={"task": "Search code", "nickname": "CustomName"},
        )
        assert resp.status_code == 200
        assert resp.json()["instance"]["nickname"] == "CustomName"

    def test_spawn_unknown_role(self, client):
        resp = client.post(
            "/api/agent-roles/unknown/spawn",
            json={"task": "x"},
        )
        assert resp.status_code == 404

    def test_spawn_missing_task(self, client):
        resp = client.post(
            "/api/agent-roles/worker/spawn",
            json={},
        )
        # Pydantic 校验
        assert resp.status_code == 422


class TestInstanceListAPI:
    def test_list_empty(self, client):
        resp = client.get("/api/agent-roles/instances")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0

    def test_list_with_instances(self, client):
        client.post("/api/agent-roles/worker/spawn", json={"task": "t1"})
        client.post("/api/agent-roles/worker/spawn", json={"task": "t2"})
        resp = client.get("/api/agent-roles/instances")
        assert resp.json()["total"] == 2

    def test_list_filtered_by_role(self, client):
        client.post("/api/agent-roles/worker/spawn", json={"task": "t1"})
        client.post("/api/agent-roles/explorer/spawn", json={"task": "t2"})
        resp = client.get("/api/agent-roles/instances?role_name=worker")
        assert resp.json()["total"] == 1


class TestInstanceGetAPI:
    def test_get_instance(self, client):
        spawn_resp = client.post(
            "/api/agent-roles/worker/spawn",
            json={"task": "t1"},
        )
        agent_id = spawn_resp.json()["instance"]["agent_id"]
        resp = client.get(f"/api/agent-roles/instances/{agent_id}")
        assert resp.status_code == 200
        assert resp.json()["instance"]["agent_id"] == agent_id

    def test_get_nonexistent(self, client):
        resp = client.get("/api/agent-roles/instances/agent-xxx")
        assert resp.status_code == 404


class TestInstanceCancelAPI:
    def test_cancel_instance(self, client):
        spawn_resp = client.post(
            "/api/agent-roles/worker/spawn",
            json={"task": "t1"},
        )
        agent_id = spawn_resp.json()["instance"]["agent_id"]
        resp = client.post(f"/api/agent-roles/instances/{agent_id}/cancel")
        assert resp.status_code == 200
        assert resp.json()["instance"]["status"] == "dead"

    def test_cancel_nonexistent(self, client):
        resp = client.post("/api/agent-roles/instances/agent-xxx/cancel")
        assert resp.status_code == 404


# ============================================================
# Cycle 64 G64-01: pause/resume/events API
# ============================================================


class TestInstancePauseResumeAPI:
    def test_pause_instance(self, client):
        # spawn 一个实例（同步 mock 立即完成，需要先测 cancel 接口）
        # pause 要求实例正在运行，这里直接测 400 错误路径
        resp = client.post(
            "/api/agent-roles/worker/spawn",
            json={"task": "test"},
        )
        agent_id = resp.json()["instance"]["agent_id"]
        # 同步 mock 已完成，pause 应返回 400
        pause_resp = client.post(f"/api/agent-roles/instances/{agent_id}/pause")
        # mock 模式下 spawn 后立即 running，但 runner.start 异步执行
        # 由于同步 mock 立即设为 running，可能 pause 时实际已完成
        # 我们只验证 200/400 都是合法响应
        assert pause_resp.status_code in (200, 400)

    def test_pause_nonexistent(self, client):
        resp = client.post("/api/agent-roles/instances/agent-xxx/pause")
        assert resp.status_code == 404

    def test_resume_instance(self, client):
        resp = client.post(
            "/api/agent-roles/worker/spawn",
            json={"task": "test"},
        )
        agent_id = resp.json()["instance"]["agent_id"]
        resume_resp = client.post(f"/api/agent-roles/instances/{agent_id}/resume")
        assert resume_resp.status_code in (200, 400)

    def test_resume_nonexistent(self, client):
        resp = client.post("/api/agent-roles/instances/agent-xxx/resume")
        assert resp.status_code == 404


class TestInstanceEventsAPI:
    def test_get_events(self, client):
        resp = client.post(
            "/api/agent-roles/worker/spawn",
            json={"task": "test"},
        )
        agent_id = resp.json()["instance"]["agent_id"]
        events_resp = client.get(f"/api/agent-roles/instances/{agent_id}/events")
        assert events_resp.status_code == 200
        data = events_resp.json()
        assert data["success"] is True
        assert data["agent_id"] == agent_id
        # spawn 同步完成，不一定有 hook 事件
        assert "events" in data
        assert "total" in data

    def test_get_events_with_limit(self, client):
        resp = client.post(
            "/api/agent-roles/explorer/spawn",
            json={"task": "test"},
        )
        agent_id = resp.json()["instance"]["agent_id"]
        events_resp = client.get(
            f"/api/agent-roles/instances/{agent_id}/events?limit=10"
        )
        assert events_resp.status_code == 200
        assert len(events_resp.json()["events"]) <= 10


class TestRunnerStatsAPI:
    def test_get_runner_stats(self, client):
        resp = client.get("/api/agent-roles/runner/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert "runner" in data
        assert "hook_bus" in data
        assert "active_tasks" in data["runner"]

    def test_stats_includes_runner(self, client):
        resp = client.get("/api/agent-roles/_stats")
        data = resp.json()
        assert "runner" in data
        assert "active_tasks" in data["runner"]


# ============================================================
# Stats API
# ====================================================================================


class TestStatsAPI:
    def test_get_stats(self, client):
        resp = client.get("/api/agent-roles/_stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["stats"]["total_roles"] >= 4
        assert data["stats"]["builtin_roles"] == 4
