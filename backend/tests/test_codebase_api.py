"""
# ============================================================
# Codebase API 测试
# Cycle 68 G68-01
# ====================================
"""

import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.codebase_indexer import reset_codebase_indexer


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def tmp_project():
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        (root / "main.py").write_text("def hello():\n    pass\n")
        (root / "auth.py").write_text("def login(u, p):\n    return True\n")
        (root / "app.ts").write_text("export class App {}\nexport function main() {}\n")
        yield str(root)


@pytest.fixture(autouse=True)
def reset_indexer():
    """每个测试前重置单例"""
    reset_codebase_indexer()
    yield
    reset_codebase_indexer()


# ============================================================
# Test: POST /api/codebase/index
# ============================================================


class TestBuildIndexAPI:
    def test_build_index_success(self, client, tmp_project):
        """成功构建索引"""
        resp = client.post(
            "/api/codebase/index",
            json={"project_root": tmp_project, "force_rebuild": False},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "session_id" in data
        assert data["status"] == "completed"
        assert data["total_files"] >= 3

    def test_build_index_nonexistent(self, client):
        """不存在的项目"""
        resp = client.post(
            "/api/codebase/index",
            json={"project_root": "/nonexistent/12345"},
        )
        assert resp.status_code == 404
        assert "PROJECT_NOT_FOUND" in resp.json()["detail"]

    def test_build_index_missing_field(self, client):
        """缺少必填字段"""
        resp = client.post("/api/codebase/index", json={})
        assert resp.status_code == 422


# ============================================================
# Test: POST /api/codebase/search
# ============================================================


class TestSearchAPI:
    def test_search_success(self, client, tmp_project):
        """成功搜索"""
        # 1. 先建索引
        idx_resp = client.post(
            "/api/codebase/index",
            json={"project_root": tmp_project},
        )
        session_id = idx_resp.json()["session_id"]

        # 2. 搜索
        resp = client.post(
            "/api/codebase/search",
            json={
                "session_id": session_id,
                "query": "hello",
                "top_k": 10,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] > 0
        assert len(data["results"]) > 0

    def test_search_with_file_pattern(self, client, tmp_project):
        """按文件模式过滤"""
        idx_resp = client.post(
            "/api/codebase/index",
            json={"project_root": tmp_project},
        )
        session_id = idx_resp.json()["session_id"]

        resp = client.post(
            "/api/codebase/search",
            json={
                "session_id": session_id,
                "query": "function",
                "file_pattern": "*.ts",
            },
        )
        assert resp.status_code == 200
        for r in resp.json()["results"]:
            assert r["file"].endswith(".ts")

    def test_search_empty_query(self, client, tmp_project):
        """空查询"""
        idx_resp = client.post(
            "/api/codebase/index",
            json={"project_root": tmp_project},
        )
        session_id = idx_resp.json()["session_id"]

        resp = client.post(
            "/api/codebase/search",
            json={"session_id": session_id, "query": ""},
        )
        # Pydantic min_length 校验返回 422
        assert resp.status_code in (400, 422)

    def test_search_too_long_query(self, client, tmp_project):
        """过长查询"""
        idx_resp = client.post(
            "/api/codebase/index",
            json={"project_root": tmp_project},
        )
        session_id = idx_resp.json()["session_id"]

        resp = client.post(
            "/api/codebase/search",
            json={"session_id": session_id, "query": "x" * 501},
        )
        # Pydantic max_length 校验返回 422
        assert resp.status_code in (400, 422)

    def test_search_nonexistent_session(self, client):
        """不存在的 session"""
        resp = client.post(
            "/api/codebase/search",
            json={"session_id": "nonexistent", "query": "test"},
        )
        assert resp.status_code == 404
        assert "INDEX_NOT_FOUND" in resp.json()["detail"]

    def test_search_top_k_limit(self, client, tmp_project):
        """top_k 限制"""
        idx_resp = client.post(
            "/api/codebase/index",
            json={"project_root": tmp_project},
        )
        session_id = idx_resp.json()["session_id"]

        resp = client.post(
            "/api/codebase/search",
            json={"session_id": session_id, "query": "def", "top_k": 1},
        )
        assert resp.status_code == 200
        assert len(resp.json()["results"]) <= 1


# ============================================================
# Test: GET /api/codebase/file
# ============================================================


class TestGetFileAPI:
    def test_get_file_success(self, client, tmp_project):
        """成功读取文件"""
        idx_resp = client.post(
            "/api/codebase/index",
            json={"project_root": tmp_project},
        )
        session_id = idx_resp.json()["session_id"]

        resp = client.get(
            "/api/codebase/file",
            params={
                "session_id": session_id,
                "path": "main.py",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["path"] == "main.py"
        assert data["language"] == "python"
        assert len(data["lines"]) > 0

    def test_get_file_range(self, client, tmp_project):
        """读取文件片段"""
        idx_resp = client.post(
            "/api/codebase/index",
            json={"project_root": tmp_project},
        )
        session_id = idx_resp.json()["session_id"]

        resp = client.get(
            "/api/codebase/file",
            params={
                "session_id": session_id,
                "path": "main.py",
                "line_start": 0,
                "line_end": 1,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["lines"]) == 1

    def test_get_file_not_found(self, client, tmp_project):
        """文件不在索引中"""
        idx_resp = client.post(
            "/api/codebase/index",
            json={"project_root": tmp_project},
        )
        session_id = idx_resp.json()["session_id"]

        resp = client.get(
            "/api/codebase/file",
            params={"session_id": session_id, "path": "nonexistent.py"},
        )
        assert resp.status_code == 404

    def test_get_file_nonexistent_session(self, client):
        """session 不存在"""
        resp = client.get(
            "/api/codebase/file",
            params={"session_id": "nonexistent", "path": "main.py"},
        )
        assert resp.status_code == 404


# ============================================================
# Test: GET /api/codebase/stats
# ============================================================


class TestStatsAPI:
    def test_get_stats_success(self, client, tmp_project):
        """获取统计"""
        idx_resp = client.post(
            "/api/codebase/index",
            json={"project_root": tmp_project},
        )
        session_id = idx_resp.json()["session_id"]

        resp = client.get(
            "/api/codebase/stats",
            params={"session_id": session_id},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_files"] >= 3
        assert "python" in data["languages"]

    def test_get_stats_nonexistent(self, client):
        """不存在的 session"""
        resp = client.get(
            "/api/codebase/stats",
            params={"session_id": "nonexistent"},
        )
        assert resp.status_code == 404


# ============================================================
# Test: DELETE /api/codebase/{id}
# ============================================================


class TestDeleteAPI:
    def test_delete_success(self, client, tmp_project):
        """删除索引"""
        idx_resp = client.post(
            "/api/codebase/index",
            json={"project_root": tmp_project},
        )
        session_id = idx_resp.json()["session_id"]

        resp = client.delete(f"/api/codebase/{session_id}")
        assert resp.status_code == 200
        assert resp.json()["success"] is True

        # 再次查询应失败
        resp = client.get(
            "/api/codebase/stats",
            params={"session_id": session_id},
        )
        assert resp.status_code == 404

    def test_delete_nonexistent(self, client):
        """删除不存在的 session"""
        resp = client.delete("/api/codebase/nonexistent")
        assert resp.status_code == 200
        assert resp.json()["success"] is False


# ============================================================
# Test: GET /api/codebase/sessions
# ============================================================


class TestListSessionsAPI:
    def test_list_sessions(self, client, tmp_project):
        """列出所有 session"""
        client.post("/api/codebase/index", json={"project_root": tmp_project})
        client.post("/api/codebase/index", json={"project_root": tmp_project})

        resp = client.get("/api/codebase/sessions")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 2
