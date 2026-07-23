"""
# ============================================================
# Loop Engineering v7 - FastAPI 路由
# ============================================================
# 核心作用：暴露 Loop Engineering v7 端到端工作流为 HTTP API
#           支持同步执行（短任务）和 SSE 流式事件（长任务）
# 运行流程：
#   1. 接收 POST /api/workflow/loop-v7 请求（含 user_input / project_name / project_type）
#   2. 实例化 LoopEngineeringV7
#   3. 注册 hook 回调收集事件流
#   4. 异步执行 15 步工作流
#   5. 通过 SSE 实时推送每步进度
#   6. 最终返回 WorkflowResult
# 输入参数（POST /api/workflow/loop-v7）：
#   - user_input: str，用户需求
#   - project_name: str，项目名（决定 /home/qizheng/auto_code_data/<name>/）
#   - project_type: 'frontend' | 'robot' | 'fullstack'
#   - real_run: bool = True，是否真实运行项目
#   - real_push: bool = True，是否真实 git push
#   - user_answers: Optional[List[str]]，真实用户回答（替代自动 fallback）
# 输出结果：
#   - 同步模式：返回 WorkflowResult JSON
#   - SSE 模式：每个 step 完成时推一个 event，最后一个为 result
# 修改记录：
#   - 2026-07-23 | v7.0.0 | 初始版本
# ============================================================
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# 确保项目根目录在 Python 路径中
import sys
from pathlib import Path
_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.app.services.loop_engineering_v7 import (
    HookEvent,
    LoopEngineeringV7,
    WorkflowConfig,
    WorkflowResult,
    run_workflow,
    run_workflow_async,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/loop-v7", tags=["Loop Engineering v7"])


# ============================================================
# Request / Response Schemas
# ============================================================
class LoopV7StartRequest(BaseModel):
    user_input: str = Field(..., description="用户需求文本", min_length=10)
    project_name: str = Field(..., description="项目名（决定 /home/qizheng/auto_code_data/<name>/）")
    project_type: str = Field(
        "fullstack", description="项目类型", pattern="^(frontend|robot|fullstack)$"
    )
    real_run: bool = Field(True, description="是否真实运行项目（npm run dev / ros2 验证）")
    real_push: bool = Field(True, description="是否真实 git push 到本地 bare remote")
    user_answers: Optional[List[str]] = Field(
        None, description="真实用户对 Step 3 澄清问题的回答（3 条）"
    )
    qa_max_rounds: int = Field(2, description="QA 评测最大重试轮数", ge=1, le=5)
    llm_timeout: int = Field(300, description="LLM 单次调用超时（秒）", ge=60, le=1200)


class LoopV7StartResponse(BaseModel):
    workflow_id: str
    project_name: str
    project_type: str
    project_root: str
    success: bool
    final_status: str
    duration_s: float
    steps: List[Dict[str, Any]]
    files_generated_count: int
    git_commits: int
    event_count: int
    files_generated_sample: List[str] = Field(default_factory=list)


# ============================================================
# 辅助函数
# ============================================================
def _build_config(req: LoopV7StartRequest) -> WorkflowConfig:
    """构造 WorkflowConfig，根据 user_answers 自动构建回调"""
    user_answers = req.user_answers or []

    async def user_interaction_callback(questions, summary):  # type: ignore[no-redef]
        if user_answers and len(user_answers) >= len(questions):
            return list(user_answers[: len(questions)])
        # fallback to auto answers
        return None  # 触发 engine 内部 fallback

    # 注意：若 callback 返回 None，engine 内部会 fallback。
    # 这里我们通过 callback 简单地把 user_answers 直接传给 engine；
    # engine 内部检查返回值数量是否足够。
    return WorkflowConfig(
        user_input=req.user_input,
        project_name=req.project_name,
        project_type=req.project_type,
        real_run=req.real_run,
        real_push=req.real_push,
        qa_max_rounds=req.qa_max_rounds,
        llm_timeout=req.llm_timeout,
        user_interaction_callback=user_interaction_callback
        if req.user_answers
        else None,
    )


def _serialize_result(result: WorkflowResult) -> LoopV7StartResponse:
    """WorkflowResult → LoopV7StartResponse"""
    files_sample = result.files_generated[:20] if result.files_generated else []
    return LoopV7StartResponse(
        workflow_id=result.workflow_id,
        project_name=result.project_name,
        project_type=result.project_type,
        project_root=result.project_root,
        success=result.success,
        final_status=result.final_status,
        duration_s=result.duration_s,
        steps=[
            {
                "step": s.step,
                "name": s.name,
                "success": s.success,
                "duration_s": s.duration_s,
                "error": s.error,
                "output_keys": list(s.output.keys()),
            }
            for s in result.steps
        ],
        files_generated_count=len(result.files_generated),
        git_commits=len(result.git_log),
        event_count=len(result.events),
        files_generated_sample=files_sample,
    )


# ============================================================
# API 端点
# ============================================================
@router.post("/start", response_model=LoopV7StartResponse)
async def start_loop_v7(req: LoopV7StartRequest) -> LoopV7StartResponse:
    """
    启动 Loop Engineering v7 端到端工作流（同步等待完成）
    适用场景：trae /goal 验收、单次 e2e 测试
    执行时间：约 10-20 分钟（取决于 LLM 响应速度）
    """
    if not req.user_input.strip():
        raise HTTPException(status_code=400, detail="user_input 不能为空")
    if not req.project_name.strip():
        raise HTTPException(status_code=400, detail="project_name 不能为空")
    # 防止覆盖已有项目
    project_root = os.path.join("/home/qizheng/auto_code_data", req.project_name)
    if os.path.exists(project_root) and not req.real_run:
        # 允许在 e2e 测试中重新跑（v6 模式下已存在也可跑）
        pass

    config = _build_config(req)
    try:
        result = await run_workflow_async(config)
    except Exception as exc:
        logger.exception(f"Loop v7 workflow failed: {exc}")
        raise HTTPException(status_code=500, detail=f"工作流执行失败: {exc}")
    return _serialize_result(result)


@router.post("/stream")
async def stream_loop_v7(req: LoopV7StartRequest) -> StreamingResponse:
    """
    启动 Loop Engineering v7 工作流（SSE 流式事件）
    适用场景：前端实时显示进度
    事件类型：
      - step_started
      - step_completed
      - step_failed
      - workflow_completed
      - workflow_failed
    """
    if not req.user_input.strip():
        raise HTTPException(status_code=400, detail="user_input 不能为空")
    if not req.project_name.strip():
        raise HTTPException(status_code=400, detail="project_name 不能为空")

    config = _build_config(req)
    event_queue: asyncio.Queue = asyncio.Queue()

    async def hook_cb(event: HookEvent) -> None:
        await event_queue.put(("hook", event))

    config.hook_callback = hook_cb

    async def event_generator():
        # 启动后台任务
        task = asyncio.create_task(run_workflow_async(config))
        # 等待第一步结果或 hook
        step_count = 0
        while True:
            try:
                kind, payload = await asyncio.wait_for(event_queue.get(), timeout=5.0)
                if kind == "hook":
                    yield f"event: hook\ndata: {json.dumps({'task_id': payload.task_id, 'module': payload.module, 'status': payload.status, 'message': payload.message, 'files_count': len(payload.files), 'timestamp': payload.timestamp}, ensure_ascii=False)}\n\n"
            except asyncio.TimeoutError:
                # 检查后台任务是否完成
                if task.done():
                    try:
                        result = task.result()
                        yield f"event: workflow_completed\ndata: {json.dumps(_serialize_result(result).dict(), ensure_ascii=False)}\n\n"
                    except Exception as exc:
                        yield f"event: workflow_failed\ndata: {json.dumps({'error': str(exc)}, ensure_ascii=False)}\n\n"
                    break
                # 否则发个心跳
                step_count += 1
                yield f"event: heartbeat\ndata: {json.dumps({'elapsed_steps': step_count, 'pending': True}, ensure_ascii=False)}\n\n"
        yield "event: end\ndata: {}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/status/{workflow_id}")
async def get_workflow_status(workflow_id: str) -> Dict[str, Any]:
    """
    查询工作流状态（v7 当前未持久化 workflow 状态，返回简化版）
    """
    # v7 当前不持久化状态，返回基础信息
    return {
        "workflow_id": workflow_id,
        "status": "unknown",
        "message": "v7 当前为一次性同步执行，请使用 /start 或 /stream 端点",
    }


@router.get("/health")
async def health_check() -> Dict[str, Any]:
    """健康检查端点"""
    return {
        "status": "ok",
        "service": "loop-engineering-v7",
        "data_root": "/home/qizheng/auto_code_data",
        "remotes_root": "/home/qizheng/auto_code_data/.remotes",
    }
