"""
# ============================================================
# Stage Detector API 测试
# Cycle 63 G63-03
# ====================================
"""

import sys
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
def reset_detector():
    from app.services.stage_detector import reset_stage_detector, StageDetector
    reset_stage_detector()
    detector = StageDetector(storage_dir=None)
    import app.services.stage_detector as m
    m._detector = detector
    yield
    reset_stage_detector()


@pytest.fixture
def client():
    from app.services.stage_detector import reset_stage_detector, StageDetector
    reset_stage_detector()
    detector = StageDetector(storage_dir=None)
    with patch("app.api.stage.get_stage_detector") as mock_get:
        mock_get.return_value = detector
        from app.main import app
        with TestClient(app) as c:
            yield c


# ============================================================
# 状态查询
# ============================================================


class TestGetStateAPI:
    def test_get_state_initial(self, client):
        resp = client.get("/api/stage/sess-1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["state"]["stage"] == "idle"

    def test_get_state_persists(self, client):
        client.post(
            "/api/stage/force",
            json={"session_id": "sess-1", "stage": "prd"},
        )
        resp = client.get("/api/stage/sess-1")
        assert resp.json()["state"]["stage"] == "prd"


# ============================================================
# 阶段检测
# ============================================================


class TestDetectAPI:
    def test_detect_coding(self, client):
        resp = client.post(
            "/api/stage/detect",
            json={"session_id": "sess-1", "text": "def hello():\n    print('hi')"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["state"]["stage"] == "coding"

    def test_detect_prd(self, client):
        resp = client.post(
            "/api/stage/detect",
            json={"session_id": "sess-1", "text": "We need a PRD with user stories"},
        )
        assert resp.status_code == 200
        assert resp.json()["state"]["stage"] == "prd"

    def test_detect_with_llm(self, client):
        resp = client.post(
            "/api/stage/detect",
            json={
                "session_id": "sess-1",
                "text": "deploy to vercel",
                "use_llm": True,
            },
        )
        assert resp.status_code == 200
        # 状态可能因状态机阻止跳跃
        assert resp.json()["state"]["stage"] in ("idle", "coding", "deploy")

    def test_detect_missing_text(self, client):
        resp = client.post(
            "/api/stage/detect",
            json={"session_id": "sess-1", "text": ""},
        )
        # Pydantic 校验
        assert resp.status_code == 422


# ============================================================
# 强制设置
# ============================================================


class TestForceAPI:
    def test_force_valid_stage(self, client):
        resp = client.post(
            "/api/stage/force",
            json={"session_id": "sess-1", "stage": "prd"},
        )
        assert resp.status_code == 200
        assert resp.json()["state"]["stage"] == "prd"

    def test_force_invalid_stage(self, client):
        resp = client.post(
            "/api/stage/force",
            json={"session_id": "sess-1", "stage": "invalid"},
        )
        assert resp.status_code == 400

    def test_force_with_reason(self, client):
        resp = client.post(
            "/api/stage/force",
            json={"session_id": "sess-1", "stage": "coding", "reason": "test"},
        )
        assert resp.status_code == 200
        assert resp.json()["state"]["reason"] == "test"


# ============================================================
# Auto-Follow
# ============================================================


class TestAutoFollowAPI:
    def test_disable(self, client):
        resp = client.post(
            "/api/stage/auto-follow",
            json={"session_id": "sess-1", "enabled": False},
        )
        assert resp.status_code == 200
        assert resp.json()["state"]["auto_follow"] is False

    def test_enable(self, client):
        resp = client.post(
            "/api/stage/auto-follow",
            json={"session_id": "sess-1", "enabled": True},
        )
        assert resp.status_code == 200
        assert resp.json()["state"]["auto_follow"] is True


# ============================================================
# 历史
# ============================================================


class TestHistoryAPI:
    def test_empty_history(self, client):
        resp = client.get("/api/stage/sess-1/history")
        assert resp.status_code == 200
        assert resp.json()["total"] == 0

    def test_history_after_changes(self, client):
        client.post("/api/stage/force", json={"session_id": "sess-1", "stage": "prd"})
        client.post("/api/stage/force", json={"session_id": "sess-1", "stage": "coding"})
        resp = client.get("/api/stage/sess-1/history")
        data = resp.json()
        assert data["total"] >= 2

    def test_history_with_limit(self, client):
        for _ in range(5):
            client.post(
                "/api/stage/force",
                json={"session_id": "sess-1", "stage": "prd"},
            )
            client.post(
                "/api/stage/force",
                json={"session_id": "sess-1", "stage": "idle"},
            )
        resp = client.get("/api/stage/sess-1/history?limit=3")
        assert resp.json()["total"] <= 3


# ============================================================
# 统计
# ============================================================


class TestStatsAPI:
    def test_get_stats(self, client):
        resp = client.get("/api/stage/_stats")
        assert resp.status_code == 200
        data = resp.json()
        assert "total_sessions" in data["stats"]
        assert "stage_distribution" in data["stats"]
