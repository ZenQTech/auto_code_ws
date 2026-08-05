"""
# ============================================================
# Thinking REST API 单元测试 (v1.0.0)
# Cycle 67 G67-01
# ====================================
# 覆盖：
#   1. GET /api/thinking/{session_id} - step 列表
#   2. GET /api/thinking/{session_id}/current - 当前 step
#   3. GET /api/thinking/{session_id}/stats - 统计
#   4. GET /api/thinking/{session_id}/export - 导出（json/markdown）
#   5. DELETE /api/thinking/{session_id} - 清空
# ====================================
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 67 G67-01 初次创建
# ====================================
"""

import json
import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

from app.main import app
from app.services.thinking_stream import (
    get_thinking_stream_service,
    reset_thinking_stream_service,
)


# ============================================================
# Fixtures
# ====================================


@pytest.fixture(autouse=True)
def reset_singleton():
    """每个测试前重置单例"""
    reset_thinking_stream_service()
    yield
    reset_thinking_stream_service()


@pytest.fixture
def client():
    """FastAPI TestClient"""
    return TestClient(app)


@pytest_asyncio.fixture
async def populated_service():
    """预填充一些 step 数据"""
    svc = get_thinking_stream_service()
    s1 = await svc.start_step("session-A", "agent-1", model="claude-opus")
    await svc.append_delta(s1.step_id, "Analyzing ")
    await svc.append_delta(s1.step_id, "the problem...")
    await svc.end_step(s1.step_id, summary="Identified X")

    s2 = await svc.start_step("session-A", "agent-1", model="claude-opus")
    await svc.append_delta(s2.step_id, "Planning solution")
    await svc.end_step(s2.step_id, summary="Plan Y")

    s3 = await svc.start_step("session-B", "agent-2", model="claude-opus")
    await svc.append_delta(s3.step_id, "Executing")
    # 故意不结束（保持 running 状态）
    return svc, [s1, s2, s3]


# ============================================================
# 测试：GET /api/thinking/{session_id}
# ====================================


class TestListThinkingSteps:
    """step 列表端点测试"""

    def test_list_steps_success(self, client, populated_service):
        """获取 step 列表成功"""
        resp = client.get("/api/thinking/session-A?limit=10")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["session_id"] == "session-A"
        assert data["total"] == 2
        assert len(data["steps"]) == 2
        # 默认 reverse=True，最新的在前
        assert data["steps"][0]["summary"] == "Plan Y"
        assert data["steps"][1]["summary"] == "Identified X"

    def test_list_steps_empty_session(self, client):
        """空 session 应返回空列表"""
        resp = client.get("/api/thinking/nonexistent")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["steps"] == []

    def test_list_steps_limit(self, client, populated_service):
        """limit 参数应生效"""
        resp = client.get("/api/thinking/session-A?limit=1")
        data = resp.json()
        assert len(data["steps"]) == 1

    def test_list_steps_limit_validation(self, client):
        """limit 应在 1-200 之间"""
        resp = client.get("/api/thinking/s1?limit=0")
        assert resp.status_code == 422
        resp = client.get("/api/thinking/s1?limit=201")
        assert resp.status_code == 422

    def test_list_steps_includes_metadata(self, client, populated_service):
        """step 应包含完整字段"""
        resp = client.get("/api/thinking/session-A")
        data = resp.json()
        step = data["steps"][0]
        assert "step_id" in step
        assert "session_id" in step
        assert "agent_id" in step
        assert "content" in step
        assert "status" in step
        assert "started_at" in step
        assert "duration_ms" in step
        assert "model" in step
        assert step["model"] == "claude-opus"


# ============================================================
# 测试：GET /api/thinking/{session_id}/current
# ====================================


class TestCurrentThinkingStep:
    """current step 端点测试"""

    def test_current_running_step(self, client, populated_service):
        """应返回当前 running 的 step"""
        resp = client.get("/api/thinking/session-B/current")
        assert resp.status_code == 200
        data = resp.json()
        assert data["step"] is not None
        assert data["step"]["status"] == "running"
        assert data["step"]["content"] == "Executing"

    def test_current_none_when_no_running(self, client, populated_service):
        """全部完成时应返回 None"""
        resp = client.get("/api/thinking/session-A/current")
        data = resp.json()
        assert data["step"] is None

    def test_current_empty_session(self, client):
        """空 session 应返回 None"""
        resp = client.get("/api/thinking/empty/current")
        data = resp.json()
        assert data["step"] is None


# ============================================================
# 测试：GET /api/thinking/{session_id}/stats
# ====================================


class TestThinkingStats:
    """统计端点测试"""

    def test_stats_success(self, client, populated_service):
        """统计应正确聚合"""
        resp = client.get("/api/thinking/session-A/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["session_id"] == "session-A"
        assert data["total_steps"] == 2
        assert data["completed_steps"] == 2
        assert data["running_steps"] == 0
        assert data["total_tokens"] > 0
        assert data["total_duration_ms"] >= 0

    def test_stats_with_running(self, client, populated_service):
        """统计应包含 running step"""
        resp = client.get("/api/thinking/session-B/stats")
        data = resp.json()
        assert data["running_steps"] == 1
        assert data["total_steps"] == 1

    def test_stats_empty_session(self, client):
        """空 session 统计全为 0"""
        resp = client.get("/api/thinking/empty/stats")
        data = resp.json()
        assert data["total_steps"] == 0
        assert data["total_tokens"] == 0


# ============================================================
# 测试：GET /api/thinking/{session_id}/export
# ====================================


class TestExportThinking:
    """导出端点测试"""

    def test_export_json(self, client, populated_service):
        """导出 JSON 格式"""
        resp = client.get("/api/thinking/session-A/export?format=json")
        assert resp.status_code == 200
        data = resp.json()
        assert data["session_id"] == "session-A"
        assert data["total"] == 2
        assert len(data["steps"]) == 2
        # Content-Disposition 头
        assert "attachment" in resp.headers.get("Content-Disposition", "")

    def test_export_markdown(self, client, populated_service):
        """导出 Markdown 格式"""
        resp = client.get("/api/thinking/session-A/export?format=markdown")
        assert resp.status_code == 200
        data = resp.json()
        assert data["format"] == "markdown"
        content = data["content"]
        assert "# Thinking Stream: session-A" in content
        assert "## Step" in content
        assert "Identified X" in content or "Plan Y" in content
        assert "```" in content  # 代码块包裹

    def test_export_invalid_format(self, client):
        """无效 format 应被 422 拒绝"""
        resp = client.get("/api/thinking/s1/export?format=xml")
        assert resp.status_code == 422

    def test_export_empty_session(self, client):
        """空 session 导出应正常返回"""
        resp = client.get("/api/thinking/empty/export?format=json")
        data = resp.json()
        assert data["total"] == 0
        assert data["steps"] == []


# ============================================================
# 测试：DELETE /api/thinking/{session_id}
# ====================================


class TestClearThinking:
    """清空端点测试"""

    def test_clear_session(self, client, populated_service):
        """清空应删除全部 step"""
        resp = client.delete("/api/thinking/session-A")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["cleared"] == 2
        # 验证已清空
        resp = client.get("/api/thinking/session-A")
        assert resp.json()["total"] == 0

    def test_clear_other_session_unchanged(self, client, populated_service):
        """清空 A 不应影响 B"""
        client.delete("/api/thinking/session-A")
        resp = client.get("/api/thinking/session-B")
        data = resp.json()
        assert data["total"] == 1

    def test_clear_nonexistent_session(self, client):
        """清空不存在的 session 应返回 0"""
        resp = client.delete("/api/thinking/nonexistent")
        data = resp.json()
        assert data["cleared"] == 0
