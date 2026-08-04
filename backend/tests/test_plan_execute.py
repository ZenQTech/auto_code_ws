"""
# ============================================================
# Plan Execute API 单元测试 (v1.0.0)
# Cycle 61 G61-04
# ============================================================
# 测试覆盖：
#   - POST /api/plan-execute (auto_decompose + LLM mock)
#   - POST /api/plan-execute/from-json
#   - POST /api/plan-execute/from-plan/{plan_id}
#   - GET /api/plan-execute/{execution_id}
#   - POST /api/plan-execute/llm-caller/inject
#   - _build_steps_from_dict: 依赖索引转换
#   - ExecutionState 数据模型
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 61 G61-04 初次创建
# ====================================
"""

import sys
import os
import asyncio
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.plan_execute import (
    ExecutionState,
    _build_steps_from_dict,
    _save_execution_state,
    _execution_states,
    get_execution_state,
)
from app.services.composer_plan import get_service
from app.services.plan_executor import (
    LLMCaller,
    PlanExecutor,
    get_executor,
    reset_executor,
    set_executor,
)


# ============================================================
# 辅助：自定义 LLMCaller
# ============================================================


class FixedResponseLLMCaller(LLMCaller):
    """固定返回的 LLMCaller（用于测试）"""
    def __init__(self, response: str = ""):
        self.response = response
        self.call_count = 0

    async def call(self, prompt, system="", max_tokens=4096, timeout=120, model=""):
        self.call_count += 1
        return self.response


# ============================================================
# 步骤构建函数测试
# ============================================================


class TestBuildStepsFromDict:
    """_build_steps_from_dict 测试"""

    def test_empty_steps(self):
        result = _build_steps_from_dict({"steps": []})
        assert result == []

    def test_single_step(self):
        result = _build_steps_from_dict({
            "steps": [
                {"title": "Step 1", "action": "llm_call", "params": {"prompt": "p"}}
            ]
        })
        assert len(result) == 1
        assert result[0]["step_id"] == "step-0"
        assert result[0]["title"] == "Step 1"
        assert result[0]["depends_on"] == []

    def test_multiple_steps_with_dependencies(self):
        result = _build_steps_from_dict({
            "steps": [
                {"title": "A", "action": "llm_call", "params": {"prompt": "p"}, "depends_on": []},
                {"title": "B", "action": "llm_call", "params": {"prompt": "p"}, "depends_on": ["0"]},
                {"title": "C", "action": "llm_call", "params": {"prompt": "p"}, "depends_on": ["0", "1"]},
            ]
        })
        assert len(result) == 3
        assert result[0]["depends_on"] == []
        assert result[1]["depends_on"] == ["step-0"]
        assert sorted(result[2]["depends_on"]) == ["step-0", "step-1"]

    def test_self_dependency_filtered(self):
        result = _build_steps_from_dict({
            "steps": [
                {"title": "A", "action": "noop", "depends_on": ["0"]},  # 自我依赖
            ]
        })
        assert result[0]["depends_on"] == []

    def test_invalid_dep_index_ignored(self):
        result = _build_steps_from_dict({
            "steps": [
                {"title": "A", "action": "noop", "depends_on": ["99"]},  # 越界
            ]
        })
        assert result[0]["depends_on"] == []


# ============================================================
# ExecutionState 测试
# ============================================================


class TestExecutionState:
    """ExecutionState 数据模型测试"""

    def test_default_values(self):
        state = ExecutionState(
            execution_id="exec-1",
            plan_id="plan-1",
            status="running",
        )
        assert state.execution_id == "exec-1"
        assert state.plan_id == "plan-1"
        assert state.status == "running"
        assert state.current_step is None
        assert state.progress == 0.0
        assert state.step_results == []
        assert state.started_at == 0.0
        assert state.finished_at is None
        assert state.error is None

    def test_to_dict_via_pydantic(self):
        state = ExecutionState(
            execution_id="exec-1",
            plan_id="plan-1",
            status="completed",
            progress=1.0,
        )
        d = state.model_dump()
        assert d["execution_id"] == "exec-1"
        assert d["status"] == "completed"


class TestExecutionStateStore:
    """执行状态内存存储测试"""

    def test_save_and_get(self):
        state = ExecutionState(
            execution_id="exec-test-1",
            plan_id="plan-test-1",
            status="running",
        )
        _save_execution_state(state)
        retrieved = get_execution_state("exec-test-1")
        assert retrieved is not None
        assert retrieved.execution_id == "exec-test-1"

    def test_get_nonexistent(self):
        result = get_execution_state("exec-does-not-exist")
        assert result is None


# ============================================================
# LLMCaller 注入测试
# ============================================================


class TestLLMCallerInjection:
    """LLMCaller 注入测试"""

    def test_inject_default_caller(self):
        reset_executor()
        executor = get_executor()
        assert isinstance(executor.llm_caller, type(executor.llm_caller))

    def test_inject_custom_caller(self):
        caller = FixedResponseLLMCaller("test response")
        executor = PlanExecutor(llm_caller=caller)
        set_executor(executor)
        assert get_executor().llm_caller is caller
        reset_executor()


# ============================================================
# API 端点测试（使用 TestClient + 注入 mock）
# ============================================================


@pytest.fixture(autouse=True)
def reset_state():
    """每个测试前清理状态"""
    _execution_states.clear()
    reset_executor()
    yield
    _execution_states.clear()
    reset_executor()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def mock_llm_caller():
    """注入返回标准 JSON 的 mock LLM"""
    mock_response = json.dumps({
        "title": "Test Plan",
        "description": "Test description",
        "steps": [
            {
                "title": "Step 1",
                "description": "First step",
                "action": "noop",
                "params": {},
                "depends_on": [],
                "max_attempts": 1,
            },
            {
                "title": "Step 2",
                "description": "Second step",
                "action": "noop",
                "params": {},
                "depends_on": ["0"],
                "max_attempts": 1,
            },
        ]
    })
    caller = FixedResponseLLMCaller(mock_response)
    executor = PlanExecutor(llm_caller=caller)
    set_executor(executor)
    return caller


class TestPlanExecuteFromJson:
    """POST /api/plan-execute/from-json 测试"""

    def test_execute_from_json_success(self, client):
        req = {
            "title": "Test Plan",
            "description": "Test",
            "steps": [
                {"step_id": "s1", "title": "S1", "action": "noop", "params": {}},
                {"step_id": "s2", "title": "S2", "action": "noop", "params": {}, "depends_on": ["s1"]},
            ]
        }
        resp = client.post("/api/plan-execute/from-json", json=req)
        assert resp.status_code == 200
        data = resp.json()
        assert "execution_id" in data
        assert "plan_id" in data
        assert data["status"] in ("running", "completed", "pending")

    def test_execute_from_json_empty_steps(self, client):
        req = {"title": "Empty", "description": "", "steps": []}
        resp = client.post("/api/plan-execute/from-json", json=req)
        assert resp.status_code == 422  # Pydantic validation


class TestPlanExecuteAutoDecompose:
    """POST /api/plan-execute (auto_decompose=True) 测试"""

    def test_execute_with_llm_decompose(self, client, mock_llm_caller):
        req = {
            "prompt": "实现一个 hello world 函数",
            "auto_decompose": True,
        }
        resp = client.post("/api/plan-execute", json=req)
        assert resp.status_code == 200
        data = resp.json()
        assert "execution_id" in data
        assert "plan_id" in data
        # LLM 至少被调用一次（分解）
        assert mock_llm_caller.call_count >= 1

    def test_execute_invalid_json_from_llm(self, client):
        # LLM 返回无效 JSON → 500
        bad_caller = FixedResponseLLMCaller("not valid json {")
        set_executor(PlanExecutor(llm_caller=bad_caller))
        req = {"prompt": "test"}
        resp = client.post("/api/plan-execute", json=req)
        assert resp.status_code == 500
        assert "Plan 分解失败" in resp.json()["detail"]

    def test_execute_no_steps(self, client):
        caller = FixedResponseLLMCaller(json.dumps({"title": "T", "steps": []}))
        set_executor(PlanExecutor(llm_caller=caller))
        req = {"prompt": "test"}
        resp = client.post("/api/plan-execute", json=req)
        assert resp.status_code == 400
        assert "没有任何 step" in resp.json()["detail"]


class TestPlanExecuteFromPlan:
    """POST /api/plan-execute/from-plan/{plan_id} 测试"""

    def test_execute_existing_plan(self, client):
        # 先创建一个 plan
        service = get_service()
        plan = asyncio.run(
            service.create_plan(
                title="Existing",
                steps=[{"step_id": "s1", "title": "S1", "action": "noop"}],
            )
        )
        # 然后执行
        resp = client.post(f"/api/plan-execute/from-plan/{plan.plan_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["plan_id"] == plan.plan_id

    def test_execute_nonexistent_plan(self, client):
        resp = client.post("/api/plan-execute/from-plan/nonexistent-plan-id")
        assert resp.status_code == 404


class TestGetExecution:
    """GET /api/plan-execute/{execution_id} 测试"""

    def test_get_existing_execution(self, client):
        # 先创建一个 execution
        req = {
            "title": "Test",
            "steps": [{"step_id": "s1", "title": "S1", "action": "noop"}]
        }
        create_resp = client.post("/api/plan-execute/from-json", json=req)
        assert create_resp.status_code == 200
        exec_id = create_resp.json()["execution_id"]
        # 获取
        resp = client.get(f"/api/plan-execute/{exec_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["execution_id"] == exec_id

    def test_get_nonexistent_execution(self, client):
        resp = client.get("/api/plan-execute/nonexistent-exec-id")
        assert resp.status_code == 404


class TestInjectLLMCaller:
    """POST /api/plan-execute/llm-caller/inject 测试"""

    def test_inject_default(self, client):
        resp = client.post(
            "/api/plan-execute/llm-caller/inject",
            json={"caller_type": "default"},
        )
        assert resp.status_code == 200
        assert resp.json()["caller_type"] == "default"

    def test_inject_echo(self, client):
        resp = client.post(
            "/api/plan-execute/llm-caller/inject",
            json={"caller_type": "echo", "response_text": "hello"},
        )
        assert resp.status_code == 200
        assert resp.json()["caller_type"] == "echo"

    def test_inject_mock(self, client):
        resp = client.post(
            "/api/plan-execute/llm-caller/inject",
            json={"caller_type": "mock", "response_text": "{}"},
        )
        assert resp.status_code == 200
        assert resp.json()["caller_type"] == "mock"
