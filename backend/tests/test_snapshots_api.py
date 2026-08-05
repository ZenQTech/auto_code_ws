"""
# ============================================================
# Snapshots REST API 单元测试
# Cycle 66 G66-02
# ============================================================
# 测试覆盖：
#   1. POST /api/snapshots - 创建快照
#   2. GET /api/snapshots - 列出会话快照
#   3. GET /api/snapshots/{id} - 快照详情
#   4. DELETE /api/snapshots/{id} - 删除快照
#   5. GET /api/snapshots/{id}/preview - 预览
#   6. POST /api/snapshots/{id}/restore - 恢复
#   7. GET /api/snapshots/_stats - 统计
#   8. 错误处理（400/404/409/413）
# ====================================
"""

import os
import tempfile
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.services.file_storage import FileStorage, reset_file_storage
from app.services.snapshot_store import (
    SnapshotStore,
    reset_snapshot_store,
)
from app.services.undo_controller import (
    UndoController,
    reset_undo_controller,
)


# ============================================================
# Fixtures
# ============================================================


@pytest.fixture
def tmp_workspace(tmp_path):
    workdir = tmp_path / "workspace"
    workdir.mkdir()
    return workdir


@pytest.fixture
def tmp_snapshot_root(tmp_path):
    root = tmp_path / "snapshots"
    root.mkdir()
    return root


@pytest.fixture
def patched_services(tmp_workspace, tmp_snapshot_root, monkeypatch):
    """替换全局单例为测试实例"""
    fs = FileStorage(allowed_prefixes=[str(tmp_workspace)])
    store = SnapshotStore(
        storage_root=str(tmp_snapshot_root),
        file_storage=fs,
    )
    controller = UndoController(snapshot_store=store, file_storage=fs)
    # 重置单例
    reset_file_storage()
    reset_snapshot_store()
    reset_undo_controller()
    # 直接替换模块级单例
    from app.services import snapshot_store as ss_mod
    from app.services import undo_controller as uc_mod
    from app.services import file_storage as fs_mod

    monkeypatch.setattr(ss_mod, "_snapshot_store", store)
    monkeypatch.setattr(uc_mod, "_undo_controller", controller)
    monkeypatch.setattr(fs_mod, "_file_storage", fs)
    return store, controller, fs


@pytest.fixture
def client(patched_services):
    """FastAPI 测试客户端"""
    from app.main import app
    return TestClient(app)


# ============================================================
# POST /api/snapshots
# ============================================================


class TestCreateSnapshot:
    """创建快照端点测试"""

    def test_create_success(self, client, tmp_workspace):
        f = tmp_workspace / "test.py"
        f.write_text("content")
        resp = client.post(
            "/api/snapshots",
            json={
                "session_id": "s1",
                "agent_id": "a1",
                "paths": [str(f)],
                "trigger": "manual",
                "description": "before refactor",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["snapshot"]["session_id"] == "s1"
        assert data["snapshot"]["file_count"] == 1
        assert "snapshot_id" in data["snapshot"]

    def test_create_multiple_files(self, client, tmp_workspace):
        f1 = tmp_workspace / "a.py"
        f1.write_text("a")
        f2 = tmp_workspace / "b.py"
        f2.write_text("bb")
        resp = client.post(
            "/api/snapshots",
            json={
                "session_id": "s1",
                "agent_id": "a1",
                "paths": [str(f1), str(f2)],
            },
        )
        assert resp.status_code == 200
        assert resp.json()["snapshot"]["file_count"] == 2

    def test_create_invalid_request_400(self, client):
        resp = client.post(
            "/api/snapshots",
            json={
                "session_id": "s1",
                "agent_id": "a1",
                "paths": [],  # 空路径
            },
        )
        # Pydantic 验证 422
        assert resp.status_code == 422

    def test_create_missing_session_400(self, client):
        resp = client.post(
            "/api/snapshots",
            json={
                "session_id": "",
                "agent_id": "a1",
                "paths": ["/tmp/x.py"],
            },
        )
        assert resp.status_code == 422  # Pydantic min_length=1


# ============================================================
# GET /api/snapshots
# ============================================================


class TestListSnapshots:
    """列出快照测试"""

    def test_list_empty(self, client):
        resp = client.get("/api/snapshots", params={"session_id": "empty"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["snapshots"] == []

    def test_list_with_data(self, client, tmp_workspace):
        # 创建两个快照
        for i in range(2):
            f = tmp_workspace / f"f{i}.py"
            f.write_text(f"c{i}")
            client.post(
                "/api/snapshots",
                json={
                    "session_id": "s1",
                    "agent_id": "a1",
                    "paths": [str(f)],
                },
            )
            time.sleep(0.01)
        resp = client.get("/api/snapshots", params={"session_id": "s1"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2

    def test_list_pagination(self, client, tmp_workspace):
        for i in range(3):
            f = tmp_workspace / f"f{i}.py"
            f.write_text(f"c{i}")
            client.post(
                "/api/snapshots",
                json={
                    "session_id": "s1",
                    "agent_id": "a1",
                    "paths": [str(f)],
                },
            )
            time.sleep(0.01)
        resp = client.get(
            "/api/snapshots",
            params={"session_id": "s1", "limit": 2, "offset": 0},
        )
        data = resp.json()
        assert data["total"] == 3
        assert len(data["snapshots"]) == 2

    def test_list_missing_session_id_422(self, client):
        resp = client.get("/api/snapshots")
        assert resp.status_code == 422


# ============================================================
# GET /api/snapshots/{id}
# ============================================================


class TestGetSnapshot:
    """获取快照详情测试"""

    def test_get_existing(self, client, tmp_workspace):
        f = tmp_workspace / "x.py"
        f.write_text("data")
        create = client.post(
            "/api/snapshots",
            json={
                "session_id": "s1",
                "agent_id": "a1",
                "paths": [str(f)],
            },
        )
        sid = create.json()["snapshot"]["snapshot_id"]

        resp = client.get(f"/api/snapshots/{sid}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["snapshot"]["snapshot_id"] == sid

    def test_get_nonexistent_404(self, client):
        resp = client.get("/api/snapshots/nonexistent-id")
        assert resp.status_code == 404


# ============================================================
# DELETE /api/snapshots/{id}
# ============================================================


class TestDeleteSnapshot:
    """删除快照测试"""

    def test_delete_existing(self, client, tmp_workspace):
        f = tmp_workspace / "x.py"
        f.write_text("data")
        create = client.post(
            "/api/snapshots",
            json={
                "session_id": "s1",
                "agent_id": "a1",
                "paths": [str(f)],
            },
        )
        sid = create.json()["snapshot"]["snapshot_id"]

        resp = client.delete(f"/api/snapshots/{sid}")
        assert resp.status_code == 200
        # 二次查询 → 404
        resp2 = client.get(f"/api/snapshots/{sid}")
        assert resp2.status_code == 404

    def test_delete_nonexistent_404(self, client):
        resp = client.delete("/api/snapshots/nonexistent")
        assert resp.status_code == 404


# ============================================================
# GET /api/snapshots/{id}/preview
# ============================================================


class TestPreviewSnapshot:
    """预览快照测试"""

    def test_preview_existing(self, client, tmp_workspace):
        f = tmp_workspace / "x.py"
        f.write_text("data")
        create = client.post(
            "/api/snapshots",
            json={
                "session_id": "s1",
                "agent_id": "a1",
                "paths": [str(f)],
            },
        )
        sid = create.json()["snapshot"]["snapshot_id"]

        # 修改文件以触发 diff
        f.write_text("modified")
        resp = client.get(f"/api/snapshots/{sid}/preview")
        assert resp.status_code == 200
        data = resp.json()
        assert "preview" in data
        assert "files" in data["preview"]

    def test_preview_with_paths(self, client, tmp_workspace):
        f1 = tmp_workspace / "a.py"
        f1.write_text("a")
        f2 = tmp_workspace / "b.py"
        f2.write_text("b")
        create = client.post(
            "/api/snapshots",
            json={
                "session_id": "s1",
                "agent_id": "a1",
                "paths": [str(f1), str(f2)],
            },
        )
        sid = create.json()["snapshot"]["snapshot_id"]

        resp = client.get(
            f"/api/snapshots/{sid}/preview",
            params={"paths": str(f1)},
        )
        assert resp.status_code == 200

    def test_preview_nonexistent_404(self, client):
        resp = client.get("/api/snapshots/nonexistent/preview")
        assert resp.status_code == 404


# ============================================================
# POST /api/snapshots/{id}/restore
# ============================================================


class TestRestoreSnapshot:
    """恢复快照端点测试"""

    def test_restore_no_conflict(self, client, tmp_workspace):
        f = tmp_workspace / "x.py"
        f.write_text("original")
        create = client.post(
            "/api/snapshots",
            json={
                "session_id": "s1",
                "agent_id": "a1",
                "paths": [str(f)],
            },
        )
        sid = create.json()["snapshot"]["snapshot_id"]

        resp = client.post(
            f"/api/snapshots/{sid}/restore",
            json={},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["result"]["status"] == "completed"

    def test_restore_with_conflict_409(self, client, tmp_workspace):
        f = tmp_workspace / "x.py"
        f.write_text("original")
        create = client.post(
            "/api/snapshots",
            json={
                "session_id": "s1",
                "agent_id": "a1",
                "paths": [str(f)],
            },
        )
        sid = create.json()["snapshot"]["snapshot_id"]
        # 修改文件
        f.write_text("modified")
        # 不 force → 409
        resp = client.post(
            f"/api/snapshots/{sid}/restore",
            json={"force": False},
        )
        assert resp.status_code == 409
        data = resp.json()
        assert data["success"] is False
        assert len(data["result"]["conflicts"]) >= 1

    def test_restore_force(self, client, tmp_workspace):
        f = tmp_workspace / "x.py"
        f.write_text("original")
        create = client.post(
            "/api/snapshots",
            json={
                "session_id": "s1",
                "agent_id": "a1",
                "paths": [str(f)],
            },
        )
        sid = create.json()["snapshot"]["snapshot_id"]
        f.write_text("modified")
        resp = client.post(
            f"/api/snapshots/{sid}/restore",
            json={"force": True},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["result"]["status"] == "completed"
        assert f.read_text() == "original"

    def test_restore_paths_filter(self, client, tmp_workspace):
        f1 = tmp_workspace / "a.py"
        f1.write_text("a")
        f2 = tmp_workspace / "b.py"
        f2.write_text("b")
        create = client.post(
            "/api/snapshots",
            json={
                "session_id": "s1",
                "agent_id": "a1",
                "paths": [str(f1), str(f2)],
            },
        )
        sid = create.json()["snapshot"]["snapshot_id"]
        resp = client.post(
            f"/api/snapshots/{sid}/restore",
            json={"paths": [str(f1)]},
        )
        assert resp.status_code == 200
        result = resp.json()["result"]
        assert len(result["applied"]) == 1

    def test_restore_actor(self, client, tmp_workspace):
        f = tmp_workspace / "x.py"
        f.write_text("data")
        create = client.post(
            "/api/snapshots",
            json={
                "session_id": "s1",
                "agent_id": "a1",
                "paths": [str(f)],
            },
        )
        sid = create.json()["snapshot"]["snapshot_id"]
        resp = client.post(
            f"/api/snapshots/{sid}/restore",
            json={"actor": "test-actor"},
        )
        data = resp.json()
        assert "test-actor" in data["result"]["message"]

    def test_restore_nonexistent_404(self, client):
        resp = client.post(
            "/api/snapshots/nonexistent/restore",
            json={},
        )
        assert resp.status_code == 404


# ============================================================
# GET /api/snapshots/_stats
# ============================================================


class TestStatsEndpoint:
    """统计端点测试"""

    def test_get_stats(self, client):
        resp = client.get("/api/snapshots/_stats")
        assert resp.status_code == 200
        data = resp.json()
        assert "store" in data
        assert "controller" in data

    def test_get_stats_after_create(self, client, tmp_workspace):
        f = tmp_workspace / "x.py"
        f.write_text("data")
        client.post(
            "/api/snapshots",
            json={
                "session_id": "s1",
                "agent_id": "a1",
                "paths": [str(f)],
            },
        )
        resp = client.get("/api/snapshots/_stats")
        data = resp.json()
        assert data["store"]["total_snapshots"] == 1


# ============================================================
# 完整工作流
# ============================================================


class TestFullWorkflow:
    """完整工作流测试"""

    def test_create_list_get_restore_delete(self, client, tmp_workspace):
        # 1. 创建
        f = tmp_workspace / "workflow.py"
        f.write_text("v1")
        create = client.post(
            "/api/snapshots",
            json={
                "session_id": "wf",
                "agent_id": "a1",
                "paths": [str(f)],
            },
        )
        assert create.status_code == 200
        sid = create.json()["snapshot"]["snapshot_id"]

        # 2. 列表
        lst = client.get("/api/snapshots", params={"session_id": "wf"})
        assert lst.json()["total"] == 1

        # 3. 详情
        detail = client.get(f"/api/snapshots/{sid}")
        assert detail.status_code == 200

        # 4. 恢复
        restore = client.post(
            f"/api/snapshots/{sid}/restore",
            json={},
        )
        assert restore.status_code == 200

        # 5. 删除
        delete = client.delete(f"/api/snapshots/{sid}")
        assert delete.status_code == 200
        # 二次查询 → 404
        detail2 = client.get(f"/api/snapshots/{sid}")
        assert detail2.status_code == 404
