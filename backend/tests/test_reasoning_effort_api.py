"""
# ============================================================
# Reasoning Effort API 单元测试 (v1.0.0)
# Cycle 66 G66-01
# ====================================
# 核心作用：覆盖 reasoning effort REST API 端点
# 测试维度：
#   1. PUT /instances/{id}/reasoning  正常切换
#   2. PUT /instances/{id}/reasoning  无效 effort (400)
#   3. PUT /instances/{id}/reasoning  agent 不存在 (404)
#   4. GET /instances/{id}/reasoning  查询
#   5. GET /instances/{id}/reasoning  agent 不存在 (404)
#   6. GET /instances/{id}/reasoning/history  历史
#   7. GET /reasoning/stats  统计
#   8. 与 AgentRoleManager 集成
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 66 G66-01 初次创建
# ====================================
"""

import time

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.agent_role_manager import (
    get_agent_role_manager,
    reset_agent_role_manager,
)
from app.services.reasoning_effort import (
    DEFAULT_EFFORT,
    get_reasoning_controller,
    reset_reasoning_controller,
)


@pytest.fixture
def client():
    """FastAPI test client"""
    return TestClient(app)


@pytest.fixture
def fresh_state():
    """重置所有单例"""
    reset_agent_role_manager()
    reset_reasoning_controller()
    yield
    reset_agent_role_manager()
    reset_reasoning_controller()


@pytest.fixture
def sample_agent(fresh_state):
    """创建一个测试 agent"""
    manager = get_agent_role_manager()
    instance = manager.spawn_instance(
        role_name="default",
        task="Test task for reasoning effort",
        nickname="TestAgent",
    )
    return instance


# ============================================================
# PUT /instances/{id}/reasoning
# ============================================================


class TestSetReasoning:
    """PUT reasoning 端点测试"""

    def test_set_effort_success(self, client, sample_agent):
        """正常设置 effort"""
        response = client.put(
            f"/api/agent-roles/instances/{sample_agent.agent_id}/reasoning",
            json={"effort": "high"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["effort"] == "high"
        assert data["previous_effort"] == DEFAULT_EFFORT
        assert data["agent_id"] == sample_agent.agent_id

    def test_set_effort_all_values(self, client, sample_agent):
        """测试所有合法 effort 值"""
        for effort in ["low", "medium", "high"]:
            response = client.put(
                f"/api/agent-roles/instances/{sample_agent.agent_id}/reasoning",
                json={"effort": effort},
            )
            assert response.status_code == 200
            assert response.json()["effort"] == effort

    def test_set_effort_invalid(self, client, sample_agent):
        """无效 effort 返回 400"""
        response = client.put(
            f"/api/agent-roles/instances/{sample_agent.agent_id}/reasoning",
            json={"effort": "xhigh"},
        )
        assert response.status_code == 400
        assert "xhigh" in response.json()["detail"]

    def test_set_effort_empty(self, client, sample_agent):
        """空 effort 返回 400（pydantic min_length=1）"""
        response = client.put(
            f"/api/agent-roles/instances/{sample_agent.agent_id}/reasoning",
            json={"effort": ""},
        )
        assert response.status_code == 422  # pydantic validation

    def test_set_effort_agent_not_found(self, client, fresh_state):
        """agent 不存在返回 404"""
        response = client.put(
            "/api/agent-roles/instances/nonexistent/reasoning",
            json={"effort": "low"},
        )
        assert response.status_code == 404


# ============================================================
# GET /instances/{id}/reasoning
# ============================================================


class TestGetReasoning:
    """GET reasoning 端点测试"""

    def test_get_default_effort(self, client, sample_agent):
        """未设置时返回默认值"""
        response = client.get(
            f"/api/agent-roles/instances/{sample_agent.agent_id}/reasoning"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["effort"] == DEFAULT_EFFORT
        assert data["agent_id"] == sample_agent.agent_id
        assert data["default_effort"] == DEFAULT_EFFORT

    def test_get_after_set(self, client, sample_agent):
        """设置后能查询到"""
        client.put(
            f"/api/agent-roles/instances/{sample_agent.agent_id}/reasoning",
            json={"effort": "high"},
        )
        response = client.get(
            f"/api/agent-roles/instances/{sample_agent.agent_id}/reasoning"
        )
        data = response.json()
        assert data["effort"] == "high"

    def test_get_agent_not_found(self, client, fresh_state):
        """agent 不存在返回 404"""
        response = client.get(
            "/api/agent-roles/instances/nonexistent/reasoning"
        )
        assert response.status_code == 404


# ============================================================
# GET /instances/{id}/reasoning/history
# ============================================================


class TestReasoningHistory:
    """GET reasoning history 端点测试"""

    def test_empty_history(self, client, sample_agent):
        """空历史"""
        response = client.get(
            f"/api/agent-roles/instances/{sample_agent.agent_id}/reasoning/history"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["history"] == []
        assert data["count"] == 0
        assert data["agent_id"] == sample_agent.agent_id

    def test_history_with_changes(self, client, sample_agent):
        """多次切换后历史"""
        for effort in ["low", "medium", "high"]:
            client.put(
                f"/api/agent-roles/instances/{sample_agent.agent_id}/reasoning",
                json={"effort": effort},
            )
        response = client.get(
            f"/api/agent-roles/instances/{sample_agent.agent_id}/reasoning/history"
        )
        data = response.json()
        assert data["count"] == 3
        # 最近的在最前
        assert data["history"][0]["effort"] == "high"
        assert data["history"][2]["effort"] == "low"

    def test_history_limit(self, client, sample_agent):
        """limit 参数限制返回条数"""
        # 创建 10 条历史
        for i in range(10):
            effort = "low" if i % 2 == 0 else "high"
            client.put(
                f"/api/agent-roles/instances/{sample_agent.agent_id}/reasoning",
                json={"effort": effort},
            )
        response = client.get(
            f"/api/agent-roles/instances/{sample_agent.agent_id}/reasoning/history",
            params={"limit": 3},
        )
        data = response.json()
        assert data["count"] == 3

    def test_history_limit_bounds(self, client, sample_agent):
        """limit 边界检查（1-50）"""
        # limit=0 应被拒绝
        response = client.get(
            f"/api/agent-roles/instances/{sample_agent.agent_id}/reasoning/history",
            params={"limit": 0},
        )
        assert response.status_code == 422
        # limit=100 应被拒绝（> 50）
        response = client.get(
            f"/api/agent-roles/instances/{sample_agent.agent_id}/reasoning/history",
            params={"limit": 100},
        )
        assert response.status_code == 422

    def test_history_agent_not_found(self, client, fresh_state):
        """agent 不存在返回 404"""
        response = client.get(
            "/api/agent-roles/instances/nonexistent/reasoning/history"
        )
        assert response.status_code == 404


# ============================================================
# GET /reasoning/stats
# ============================================================


class TestReasoningStats:
    """GET reasoning stats 端点测试"""

    def test_stats_empty(self, client, fresh_state):
        """空状态统计"""
        response = client.get("/api/agent-roles/reasoning/stats")
        assert response.status_code == 200
        data = response.json()
        assert data["stats"]["total_agents"] == 0
        assert data["stats"]["total_changes"] == 0
        assert data["stats"]["default_effort"] == DEFAULT_EFFORT

    def test_stats_with_agents(self, client, fresh_state):
        """有 agent 时的统计"""
        # 创建 2 个 agent
        manager = get_agent_role_manager()
        agent1 = manager.spawn_instance(role_name="default", task="Task 1")
        agent2 = manager.spawn_instance(role_name="default", task="Task 2")

        # 设置不同 effort
        client.put(
            f"/api/agent-roles/instances/{agent1.agent_id}/reasoning",
            json={"effort": "low"},
        )
        client.put(
            f"/api/agent-roles/instances/{agent2.agent_id}/reasoning",
            json={"effort": "high"},
        )

        response = client.get("/api/agent-roles/reasoning/stats")
        data = response.json()
        assert data["stats"]["total_agents"] == 2
        assert data["stats"]["total_changes"] == 2
        assert data["stats"]["by_effort"]["low"] == 1
        assert data["stats"]["by_effort"]["high"] == 1


# ============================================================
# 集成测试
# ============================================================


class TestReasoningIntegration:
    """集成测试：reasoning effort 与其他模块的集成"""

    def test_reasoning_independent_per_agent(self, client, fresh_state):
        """每个 agent 独立的 effort"""
        manager = get_agent_role_manager()
        agent1 = manager.spawn_instance(role_name="default", task="Task 1")
        agent2 = manager.spawn_instance(role_name="default", task="Task 2")

        # agent1 -> high
        client.put(
            f"/api/agent-roles/instances/{agent1.agent_id}/reasoning",
            json={"effort": "high"},
        )
        # agent2 -> low
        client.put(
            f"/api/agent-roles/instances/{agent2.agent_id}/reasoning",
            json={"effort": "low"},
        )

        # 各自独立
        r1 = client.get(
            f"/api/agent-roles/instances/{agent1.agent_id}/reasoning"
        )
        r2 = client.get(
            f"/api/agent-roles/instances/{agent2.agent_id}/reasoning"
        )
        assert r1.json()["effort"] == "high"
        assert r2.json()["effort"] == "low"

    def test_rapid_changes(self, client, sample_agent):
        """快速多次切换"""
        for effort in ["low", "medium", "high", "low", "medium", "high"]:
            response = client.put(
                f"/api/agent-roles/instances/{sample_agent.agent_id}/reasoning",
                json={"effort": effort},
            )
            assert response.status_code == 200
            assert response.json()["effort"] == effort

        # 历史应有 5 条（最后一次切换 unchanged 不计入）
        history_response = client.get(
            f"/api/agent-roles/instances/{sample_agent.agent_id}/reasoning/history"
        )
        assert history_response.json()["count"] == 6

    def test_persistence_across_requests(self, client, sample_agent):
        """状态在多个请求间保持"""
        client.put(
            f"/api/agent-roles/instances/{sample_agent.agent_id}/reasoning",
            json={"effort": "high"},
        )
        # 多次查询，状态应保持
        for _ in range(3):
            r = client.get(
                f"/api/agent-roles/instances/{sample_agent.agent_id}/reasoning"
            )
            assert r.json()["effort"] == "high"
