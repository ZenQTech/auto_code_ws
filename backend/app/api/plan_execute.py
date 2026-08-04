"""
# ============================================================
# Plan Execution API - 一键执行 LLM Plan (v1.0.0)
# Cycle 61 G61-04
# ============================================================
# 核心作用：提供"用户输入 prompt → 自动生成 plan → 执行 plan → 返回结果"
#           的端到端 API
# 运行流程：
#   1. POST /api/plan-execute/                    一步执行：prompt → plan → 执行 → 结果
#   2. POST /api/plan-execute/from-json           使用客户端提供的 step JSON 执行
#   3. POST /api/plan-execute/from-plan/{plan_id}  使用已存在 plan 执行
#   4. GET  /api/plan-execute/{execution_id}      获取执行状态
#   5. GET  /api/plan-execute/{execution_id}/events  SSE 事件流
# 输入参数：HTTP 请求
# 输出结果：JSON 响应 + SSE 流
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 61 G61-04 初次创建
# ====================================
"""

import asyncio
import json
import logging
import time
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..services.composer_plan import (
    ComposerPlan,
    ComposerStep,
    PlanStatus,
    StepStatus,
    get_service,
    stream_plan_events,
)
from ..services.plan_executor import (
    LLMCaller,
    PlanExecutor,
    PlanExecutorConfig,
    get_executor,
    set_executor,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/plan-execute", tags=["plan-execute"])


# ============================================================
# 数据模型
# ============================================================


class ExecuteRequest(BaseModel):
    """
    一步执行请求
    字段说明：
      - prompt: 用户需求描述
      - system: LLM 系统提示
      - max_steps: 最大 step 数（默认 8）
      - auto_decompose: 是否自动用 LLM 分解为 steps（默认 True）
      - pre_steps: 预定义 step 列表（auto_decompose=False 时使用）
      - model: LLM 模型
      - timeout: LLM 单次调用超时
    """
    prompt: str = Field(..., min_length=1, max_length=8000)
    system: str = Field(default="你是一名软件工程师，擅长将用户需求分解为可执行步骤。", max_length=4000)
    max_steps: int = Field(default=8, ge=1, le=20)
    auto_decompose: bool = Field(default=True)
    pre_steps: Optional[List[Dict[str, Any]]] = Field(default=None)
    model: str = Field(default="")
    timeout: int = Field(default=120, ge=10, le=600)


class ExecuteFromJsonRequest(BaseModel):
    """使用预定义 steps 执行"""
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    steps: List[Dict[str, Any]] = Field(..., min_items=1, max_items=20)


class ExecutionState(BaseModel):
    """执行状态"""
    execution_id: str
    plan_id: str
    status: str
    current_step: Optional[str] = None
    progress: float = 0.0
    step_results: List[Dict[str, Any]] = Field(default_factory=list)
    started_at: float = 0.0
    finished_at: Optional[float] = None
    error: Optional[str] = None
    plan: Optional[Dict[str, Any]] = None


# ============================================================
# 内存中的执行状态表
# ============================================================


_execution_states: Dict[str, ExecutionState] = {}
_step_results: Dict[str, Dict[str, Dict[str, Any]]] = {}  # exec_id -> {step_id -> result}


def _save_execution_state(state: ExecutionState) -> None:
    _execution_states[state.execution_id] = state


def get_execution_state(execution_id: str) -> Optional[ExecutionState]:
    return _execution_states.get(execution_id)


# ============================================================
# Plan 分解（LLM）
# ============================================================


DECOMPOSE_PROMPT_TEMPLATE = """请将以下用户需求分解为可执行的步骤列表（每步一个 action）：

【用户需求】
{prompt}

【输出格式】
严格按照 JSON 格式输出，结构如下（不要包含任何额外文本）：
```json
{{
  "title": "简短的执行计划标题",
  "description": "计划描述",
  "steps": [
    {{
      "title": "步骤 1 标题",
      "description": "步骤 1 详细说明",
      "action": "llm_call",
      "params": {{
        "prompt": "该步骤要发送给 LLM 的具体指令",
        "system": "该步骤的系统提示（可选）",
        "max_tokens": 2048
      }},
      "depends_on": [],
      "max_attempts": 1
    }}
  ]
}}
```

【约束】
- 最多 {max_steps} 个步骤
- 每个步骤的 action 必须是 "llm_call" / "run_shell" / "edit_file" / "read_file" / "verify_command" / "noop" 之一
- 步骤之间用 depends_on 表达依赖关系（使用 step 的顺序索引 0-based 字符串，例如 "0"）
- 第一步 depends_on 必须为空数组
- 如果某一步是"读取用户输入"或"分析需求"，可以省略
"""


async def _decompose_with_llm(
    prompt: str,
    system: str,
    max_steps: int,
    model: str,
    timeout: int,
) -> Dict[str, Any]:
    """
    使用 LLM 将用户 prompt 分解为 Plan dict
    """
    executor = get_executor()
    decompose_prompt = DECOMPOSE_PROMPT_TEMPLATE.format(
        prompt=prompt,
        max_steps=max_steps,
    )
    try:
        raw = await asyncio.wait_for(
            executor.llm_caller.call(
                prompt=decompose_prompt,
                system=system,
                max_tokens=4096,
                timeout=timeout,
                model=model,
            ),
            timeout=timeout,
        )
    except asyncio.TimeoutError as e:
        raise RuntimeError(f"Plan 分解 LLM 调用超时: {timeout}s") from e

    # 解析 JSON
    # 1. 尝试提取 ```json ... ``` 块
    import re
    m = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", raw)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    # 2. 尝试直接解析
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    # 3. 提取第一个 {...} 块
    m = re.search(r"\{[\s\S]*\}", raw)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    raise RuntimeError(f"LLM 输出无法解析为 JSON: {raw[:200]}")


def _build_steps_from_dict(plan_dict: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    将 LLM 输出的 plan_dict 转换为 ComposerStep dict 列表
    转换 depends_on 从索引到 step_id
    """
    raw_steps = plan_dict.get("steps", [])
    # 先生成 step_id 列表（用顺序索引）
    indexed_ids = [f"step-{i}" for i in range(len(raw_steps))]

    result: List[Dict[str, Any]] = []
    for i, s in enumerate(raw_steps):
        if not isinstance(s, dict):
            continue
        # 转换 depends_on 从索引到 step_id
        raw_deps = s.get("depends_on", [])
        new_deps: List[str] = []
        for dep in raw_deps:
            try:
                dep_idx = int(dep)
                if 0 <= dep_idx < len(indexed_ids) and dep_idx != i:
                    new_deps.append(indexed_ids[dep_idx])
            except (ValueError, TypeError):
                # 已经是 step_id
                if dep in indexed_ids and dep != indexed_ids[i]:
                    new_deps.append(dep)
        step_dict = {
            "step_id": indexed_ids[i],
            "title": s.get("title", f"Step {i+1}"),
            "description": s.get("description", ""),
            "action": s.get("action", "llm_call"),
            "params": s.get("params", {}),
            "depends_on": new_deps,
            "max_attempts": s.get("max_attempts", 1),
        }
        result.append(step_dict)
    return result


# ============================================================
# 端点
# ============================================================


@router.post("", response_model=ExecutionState)
async def execute(req: ExecuteRequest):
    """
    一键执行：用户 prompt → LLM 分解为 plan → 执行

    输入参数：ExecuteRequest
    输出结果：ExecutionState
    """
    execution_id = f"exec-{uuid.uuid4().hex[:12]}"

    # 1. 构造 plan
    try:
        if req.auto_decompose:
            plan_dict = await _decompose_with_llm(
                prompt=req.prompt,
                system=req.system,
                max_steps=req.max_steps,
                model=req.model,
                timeout=req.timeout,
            )
            title = plan_dict.get("title", "Auto-generated plan")
            description = plan_dict.get("description", req.prompt[:200])
            steps_dict = _build_steps_from_dict(plan_dict)
        else:
            if not req.pre_steps:
                raise HTTPException(
                    status_code=400,
                    detail="auto_decompose=False 时必须提供 pre_steps",
                )
            title = "Pre-defined plan"
            description = req.prompt[:200]
            steps_dict = req.pre_steps
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"execute: 分解失败 err={e}")
        raise HTTPException(status_code=500, detail=f"Plan 分解失败: {e}")

    if not steps_dict:
        raise HTTPException(status_code=400, detail="生成的 plan 没有任何 step")

    # 2. 创建 plan
    try:
        plan = await get_service().create_plan(
            title=title,
            description=description,
            steps=steps_dict,
            metadata={"execution_id": execution_id, "source": "plan-execute"},
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Plan 创建失败: {e}")

    # 3. 启动执行
    try:
        await get_service().start_plan(plan.plan_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # 4. 初始化 execution state
    state = ExecutionState(
        execution_id=execution_id,
        plan_id=plan.plan_id,
        status=PlanStatus.RUNNING.value,
        started_at=time.time(),
        plan=plan.to_dict(),
    )
    _save_execution_state(state)
    _step_results[execution_id] = {}

    return state


@router.post("/from-json", response_model=ExecutionState)
async def execute_from_json(req: ExecuteFromJsonRequest):
    """使用预定义 steps 执行（不调 LLM 分解）"""
    execution_id = f"exec-{uuid.uuid4().hex[:12]}"

    try:
        plan = await get_service().create_plan(
            title=req.title,
            description=req.description,
            steps=req.steps,
            metadata={"execution_id": execution_id, "source": "from-json"},
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        await get_service().start_plan(plan.plan_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    state = ExecutionState(
        execution_id=execution_id,
        plan_id=plan.plan_id,
        status=PlanStatus.RUNNING.value,
        started_at=time.time(),
        plan=plan.to_dict(),
    )
    _save_execution_state(state)
    _step_results[execution_id] = {}

    return state


@router.post("/from-plan/{plan_id}", response_model=ExecutionState)
async def execute_from_plan(plan_id: str):
    """使用已存在 plan 执行"""
    plan = await get_service().get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Plan {plan_id} 不存在")

    execution_id = f"exec-{uuid.uuid4().hex[:12]}"
    try:
        await get_service().start_plan(plan_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    state = ExecutionState(
        execution_id=execution_id,
        plan_id=plan_id,
        status=PlanStatus.RUNNING.value,
        started_at=time.time(),
        plan=plan.to_dict(),
    )
    _save_execution_state(state)
    _step_results[execution_id] = {}

    return state


@router.get("/{execution_id}", response_model=ExecutionState)
async def get_execution(execution_id: str):
    """获取执行状态"""
    state = get_execution_state(execution_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Execution {execution_id} 不存在")

    # 刷新最新 plan 状态
    plan = await get_service().get_plan(state.plan_id)
    if plan is not None:
        state.status = plan.status.value
        state.progress = plan.progress()
        state.plan = plan.to_dict()
        # 找到当前 running step
        for s in plan.steps:
            if s.status == StepStatus.RUNNING:
                state.current_step = s.step_id
                break
        # 收集 step results
        step_results = []
        for s in plan.steps:
            step_results.append({
                "step_id": s.step_id,
                "title": s.title,
                "status": s.status.value,
                "progress": s.progress,
                "error": s.error,
                "attempts": s.attempts,
                "output": s.output,
            })
        state.step_results = step_results
        if plan.status in (
            PlanStatus.COMPLETED, PlanStatus.FAILED, PlanStatus.CANCELLED
        ):
            state.finished_at = plan.finished_at
    _save_execution_state(state)
    return state


@router.get("/{execution_id}/events")
async def execution_events(execution_id: str):
    """SSE 订阅执行事件"""
    state = get_execution_state(execution_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Execution {execution_id} 不存在")

    plan_id = state.plan_id

    async def event_generator():
        try:
            async for event in stream_plan_events(plan_id):
                yield f"event: {event.get('type', 'message')}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
        except asyncio.CancelledError:
            logger.info(f"plan-execute events: client disconnected exec={execution_id}")
            raise

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ============================================================
# LLMCaller 注入辅助（用于测试和扩展）
# ============================================================


class InjectLLMCallerRequest(BaseModel):
    """注入 LLMCaller（测试 / 调试用）"""
    caller_type: str = Field(default="default", description="default | mock | echo")
    response_text: str = Field(default="", description="mock 模式下的固定返回")


@router.post("/llm-caller/inject")
async def inject_llm_caller(req: InjectLLMCallerRequest):
    """
    注入 LLMCaller（用于测试 / 调试）

    调用此接口后，PlanExecutor 将使用新的 LLMCaller
    """
    if req.caller_type == "echo":
        class EchoCaller(LLMCaller):
            async def call(self, prompt, system="", max_tokens=4096, timeout=120, model=""):
                return req.response_text or f"echo: {prompt[:100]}"
        set_executor(PlanExecutor(llm_caller=EchoCaller()))
    elif req.caller_type == "mock":
        # 模拟 LLM 返回固定 JSON（用于测试分解）
        class MockCaller(LLMCaller):
            async def call(self, prompt, system="", max_tokens=4096, timeout=120, model=""):
                return req.response_text
        set_executor(PlanExecutor(llm_caller=MockCaller()))
    else:
        # default
        set_executor(PlanExecutor())

    return {"success": True, "caller_type": req.caller_type}
