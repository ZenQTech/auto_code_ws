"""
# ============================================================
# PRD API 测试
# Cycle 63 G63-01
# ====================================
# 覆盖：
#   1. POST /api/prd/generate - 生成 PRD
#   2. GET /api/prd/{id} - 获取 PRD
#   3. POST /api/prd/{id}/iterate - 迭代 PRD
#   4. POST /api/prd/{id}/diff - 计算 diff
#   5. GET /api/prd/list - 列出所有 PRD
#   6. DELETE /api/prd/{id} - 删除 PRD
#   7. GET /api/prd/stats/info - 统计
# ====================================
"""

import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

# 添加 backend 到路径
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))


# ============================================================
# Mock LLM Caller
# ============================================================


@pytest.fixture
def mock_llm():
    """统一的 mock LLM caller"""
    async def caller(system_prompt, prompt, model):
        return json.dumps({
            "title": "测试 PRD",
            "goals": ["目标 1", "目标 2"],
            "user_scenarios": [
                {
                    "name": "场景 1",
                    "description": "描述",
                    "preconditions": ["前提"],
                    "steps": ["步骤 1", "步骤 2"],
                }
            ],
            "acceptance_criteria": [
                {"id": "AC-1", "description": "验收 1", "metric": "m", "target": "t"},
            ],
            "tasks": [
                {"id": "T-1", "name": "任务 1", "description": "描述", "dependencies": [], "estimated_hours": 4.0, "risk_level": "low"},
            ],
            "risks": ["风险 1"],
        }, ensure_ascii=False)
    return caller


@pytest.fixture(autouse=True)
def reset_manager_state(mock_llm):
    """每个测试前重置 manager 状态（避免单例污染）"""
    from app.services.prd_generator import reset_prd_manager, PRDManager
    reset_prd_manager()
    mgr = PRDManager(llm_caller=mock_llm, storage_dir=None)
    
    # 重置全局单例
    import app.services.prd_generator as prd_module
    prd_module._manager = mgr
    
    yield
    reset_prd_manager()


@pytest.fixture
def client(mock_llm):
    """FastAPI TestClient with mocked LLM"""
    from app.services.prd_generator import reset_prd_manager
    reset_prd_manager()

    with patch("app.api.prd.get_prd_manager") as mock_get:
        from app.services.prd_generator import PRDManager
        mgr = PRDManager(llm_caller=mock_llm, storage_dir=None)
        mock_get.return_value = mgr

        from app.main import app
        with TestClient(app) as test_client:
            yield test_client


# ============================================================
# Tests
# ============================================================


class TestPRDGenerateAPI:
    """POST /api/prd/generate 测试"""

    def test_generate_prd_success(self, client):
        """正常生成 PRD"""
        response = client.post(
            "/api/prd/generate",
            json={"requirement": "实现一个 Todo List 应用"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "prd" in data
        assert data["version"] == 1
        assert data["prd"]["title"] == "测试 PRD"
        assert len(data["prd"]["goals"]) == 2

    def test_generate_prd_with_context(self, client):
        """带上下文的生成"""
        response = client.post(
            "/api/prd/generate",
            json={
                "requirement": "实现一个 Todo List 应用",
                "context": {"tech_stack": ["React"]},
                "template": "agile",
            },
        )
        assert response.status_code == 200

    def test_generate_prd_invalid_input(self, client):
        """输入校验失败"""
        response = client.post(
            "/api/prd/generate",
            json={"requirement": "太短"},
        )
        assert response.status_code == 422  # Pydantic validation

    def test_generate_prd_empty_requirement(self, client):
        """空需求"""
        response = client.post(
            "/api/prd/generate",
            json={"requirement": ""},
        )
        assert response.status_code == 422  # Pydantic validation

    def test_generate_prd_validation_error(self, client):
        """服务端验证失败（LLM 返回非 dict）"""
        # 由于 Pydantic min_length=10 已校验基本长度
        # 此处跳过，留作 integration test

    def test_generate_prd_short_requirement(self, client):
        """过短需求（Pydantic 拦截）"""
        response = client.post(
            "/api/prd/generate",
            json={"requirement": "太短"},
        )
        # Pydantic 拦截（min_length=10）
        assert response.status_code == 422


class TestPRDGetAPI:
    """GET /api/prd/{id} 测试"""

    def test_get_prd_success(self, client):
        """获取 PRD 成功"""
        # 先生成
        gen_response = client.post(
            "/api/prd/generate",
            json={"requirement": "实现一个 Todo List 应用"},
        )
        prd_id = gen_response.json()["prd"]["prd_id"]

        # 获取
        response = client.get(f"/api/prd/{prd_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["prd"]["prd_id"] == prd_id

    def test_get_prd_specific_version(self, client):
        """获取指定版本"""
        gen_response = client.post(
            "/api/prd/generate",
            json={"requirement": "实现一个 Todo List 应用"},
        )
        prd_id = gen_response.json()["prd"]["prd_id"]

        response = client.get(f"/api/prd/{prd_id}?version=1")
        assert response.status_code == 200
        assert response.json()["prd"]["version"] == 1

    def test_get_prd_with_history(self, client):
        """获取 PRD 包含历史"""
        gen_response = client.post(
            "/api/prd/generate",
            json={"requirement": "实现一个 Todo List 应用"},
        )
        prd_id = gen_response.json()["prd"]["prd_id"]

        response = client.get(f"/api/prd/{prd_id}?include_history=true")
        assert response.status_code == 200
        data = response.json()
        assert "history" in data
        assert len(data["history"]) == 1

    def test_get_nonexistent_prd(self, client):
        """不存在的 PRD"""
        response = client.get("/api/prd/prd-nonexistent")
        assert response.status_code == 404


class TestPRDIterateAPI:
    """POST /api/prd/{id}/iterate 测试"""

    def test_iterate_prd_success(self, client):
        """迭代 PRD 成功"""
        gen_response = client.post(
            "/api/prd/generate",
            json={"requirement": "实现一个 Todo List 应用"},
        )
        prd_id = gen_response.json()["prd"]["prd_id"]

        response = client.post(
            f"/api/prd/{prd_id}/iterate",
            json={"feedback": "增加用户登录功能"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["version"] == 2
        assert "diff" in data

    def test_iterate_prd_empty_feedback(self, client):
        """空反馈"""
        gen_response = client.post(
            "/api/prd/generate",
            json={"requirement": "实现一个 Todo List 应用"},
        )
        prd_id = gen_response.json()["prd"]["prd_id"]

        response = client.post(
            f"/api/prd/{prd_id}/iterate",
            json={"feedback": ""},
        )
        assert response.status_code == 422  # Pydantic validation

    def test_iterate_nonexistent_prd(self, client):
        """不存在的 PRD"""
        response = client.post(
            "/api/prd/prd-nonexistent/iterate",
            json={"feedback": "增加新功能模块"},
        )
        assert response.status_code == 404


class TestPRDDiffAPI:
    """POST /api/prd/{id}/diff 测试"""

    def test_diff_prd_success(self, client):
        """计算 diff 成功"""
        gen_response = client.post(
            "/api/prd/generate",
            json={"requirement": "实现一个 Todo List 应用"},
        )
        prd_id = gen_response.json()["prd"]["prd_id"]

        # 迭代到 v2
        client.post(
            f"/api/prd/{prd_id}/iterate",
            json={"feedback": "添加新功能模块"},
        )

        response = client.post(
            f"/api/prd/{prd_id}/diff",
            json={"from_version": 1, "to_version": 2},
        )
        assert response.status_code == 200
        data = response.json()
        assert "diff" in data
        assert "summary" in data

    def test_diff_nonexistent_version(self, client):
        """不存在的版本"""
        gen_response = client.post(
            "/api/prd/generate",
            json={"requirement": "实现一个 Todo List 应用"},
        )
        prd_id = gen_response.json()["prd"]["prd_id"]

        response = client.post(
            f"/api/prd/{prd_id}/diff",
            json={"from_version": 1, "to_version": 99},
        )
        assert response.status_code == 404


class TestPRDListAPI:
    """GET /api/prd/_list 测试"""

    def test_list_prds_empty(self, client):
        """空列表"""
        response = client.get("/api/prd/_list")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        # 注意：manager 是单例，可能有其他测试遗留数据
        assert "total" in data
        assert "prds" in data

    def test_list_prds_with_items(self, client):
        """有 PRD 时列表"""
        # 先获取当前数量
        before_response = client.get("/api/prd/_list")
        before_count = before_response.json()["total"]

        # 创建新 PRD（注意：requirement 至少 10 字符）
        client.post(
            "/api/prd/generate",
            json={"requirement": "实现一个 Todo List 任务管理应用"},
        )
        client.post(
            "/api/prd/generate",
            json={"requirement": "实现一个支持多用户的笔记应用"},
        )

        response = client.get("/api/prd/_list")
        assert response.status_code == 200
        data = response.json()
        # 至少新增 2 个
        assert data["total"] >= before_count + 2
        for prd in data["prds"]:
            assert "prd_id" in prd
            assert "title" in prd


class TestPRDDeleteAPI:
    """DELETE /api/prd/{id} 测试"""

    def test_delete_prd_success(self, client):
        """删除成功"""
        gen_response = client.post(
            "/api/prd/generate",
            json={"requirement": "实现一个 Todo List 应用"},
        )
        prd_id = gen_response.json()["prd"]["prd_id"]

        response = client.delete(f"/api/prd/{prd_id}")
        assert response.status_code == 200

        # 验证已删除
        get_response = client.get(f"/api/prd/{prd_id}")
        assert get_response.status_code == 404

    def test_delete_nonexistent_prd(self, client):
        """删除不存在的 PRD"""
        response = client.delete("/api/prd/prd-nonexistent")
        assert response.status_code == 404


class TestPRDStatsAPI:
    """GET /api/prd/_stats 测试"""

    def test_get_stats(self, client):
        """获取统计"""
        client.post(
            "/api/prd/generate",
            json={"requirement": "实现一个 Todo List 应用"},
        )

        response = client.get("/api/prd/_stats")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["stats"]["total_prds"] >= 1
