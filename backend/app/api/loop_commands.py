"""
# ============================================================
# Loop Commands API - /loop 命令 REST 端点 (Cycle 8 P1-4)
# ============================================================
# 核心作用：提供 /loop slash command 的 REST API 端点
# 端点：
#   - POST /api/loop-commands/triage - 任务优先级分析
#   - POST /api/loop-commands/plan - 生成 spec + branch
#   - POST /api/loop-commands/execute - 执行 task
#   - POST /api/loop-commands/verify - 验证任务
#   - GET /api/loop-commands/status/{id} - 查询异步状态
#   - GET /api/loop-commands/list - 列出所有工作流
#   - DELETE /api/loop-commands/{id} - 取消工作流
# 输入参数：通过请求体传递 project_path
# 输出结果：JSON 格式的执行结果
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 8 P1-4 新建
# ============================================================
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.loop_commands import (
    TriageService,
    PlanService,
    ExecuteService,
    VerifyService,
    get_async_runner,
    LoopWorkflowStatus,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/loop-commands", tags=["Loop Commands"])


# ============================================================
# 请求/响应模型
# ============================================================


class BaseRequest(BaseModel):
    """基础请求"""

    project_path: str = Field(..., description="项目根目录绝对路径")


class TriageRequest(BaseRequest):
    """triage 请求"""

    pass


class PlanRequest(BaseRequest):
    """plan 请求"""

    max_iterations: int = Field(default=3, description="最大迭代次数")


class ExecuteRequest(BaseRequest):
    """execute 请求"""

    task_id: Optional[str] = Field(default=None, description="任务 ID")


class VerifyRequest(BaseRequest):
    """verify 请求"""

    run_unit: bool = Field(default=True, description="运行单元测试")
    run_e2e: bool = Field(default=True, description="运行 E2E 测试")
    run_typescript: bool = Field(default=True, description="运行 TypeScript 编译")
    run_vite: bool = Field(default=False, description="运行 Vite 构建")


class LoopResponse(BaseModel):
    """统一响应"""

    success: bool
    action: str
    data: Dict[str, Any]


# ============================================================
# 路径白名单校验
# ============================================================

ALLOWED_PROJECT_PATHS = [
    "/home/qizheng/auto_code_ws",
    "/home/qizheng/auto_code_data",
    "/tmp/test-projects",
]


def _validate_project_path(project_path: str) -> str:
    """校验项目路径在白名单内

    Args:
        project_path: 项目路径

    Returns:
        规范化后的路径

    Raises:
        HTTPException: 路径不在白名单
    """
    import os
    abs_path = os.path.abspath(project_path)

    for allowed in ALLOWED_PROJECT_PATHS:
        if abs_path.startswith(allowed):
            return abs_path

    raise HTTPException(
        status_code=403,
        detail=f"Project path not in whitelist: {abs_path}",
    )


# ============================================================
# 端点实现
# ============================================================


@router.post("/triage", response_model=LoopResponse)
async def triage_tasks(req: TriageRequest) -> LoopResponse:
    """任务优先级分析

    解析 tasks.md 文件，提取所有任务并按 P0/P1/P2 排序。
    """
    project_path = _validate_project_path(req.project_path)

    try:
        service = TriageService(project_path)
        result = service.analyze()
        return LoopResponse(success=True, action="triage", data=result)
    except Exception as e:
        logger.error(f"triage failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/plan", response_model=LoopResponse)
async def plan_workflow(req: PlanRequest) -> LoopResponse:
    """生成 spec + checklist + git 分支

    调用 Loop Engineering v7 生成文档，并创建 git 分支。
    """
    project_path = _validate_project_path(req.project_path)

    try:
        # 异步执行
        runner = get_async_runner()
        workflow_id = runner.submit(
            action="plan",
            project_path=project_path,
            params={"max_iterations": req.max_iterations},
        )

        # 等待完成（最多 30s）
        import asyncio
        for _ in range(60):
            status = runner.get_status(workflow_id)
            if status and status.status in ("completed", "failed"):
                break
            await asyncio.sleep(0.5)

        status = runner.get_status(workflow_id)
        if status is None:
            raise HTTPException(status_code=500, detail="Workflow not found")

        if status.status == "failed":
            raise HTTPException(
                status_code=500, detail=status.error or "Plan workflow failed"
            )

        return LoopResponse(
            success=True,
            action="plan",
            data={
                "workflow_id": workflow_id,
                "status": status.status,
                "result": status.result,
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"plan failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/execute", response_model=LoopResponse)
async def execute_task(req: ExecuteRequest) -> LoopResponse:
    """执行 task

    调用 Loop Engineering v7 执行步骤，并自动 git commit。
    """
    project_path = _validate_project_path(req.project_path)

    try:
        runner = get_async_runner()
        workflow_id = runner.submit(
            action="execute",
            project_path=project_path,
            params={"task_id": req.task_id},
        )

        # 等待完成
        import asyncio
        for _ in range(120):
            status = runner.get_status(workflow_id)
            if status and status.status in ("completed", "failed"):
                break
            await asyncio.sleep(0.5)

        status = runner.get_status(workflow_id)
        if status is None:
            raise HTTPException(status_code=500, detail="Workflow not found")

        if status.status == "failed":
            raise HTTPException(
                status_code=500, detail=status.error or "Execute workflow failed"
            )

        return LoopResponse(
            success=True,
            action="execute",
            data={
                "workflow_id": workflow_id,
                "status": status.status,
                "result": status.result,
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"execute failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/verify", response_model=LoopResponse)
async def verify_task(req: VerifyRequest) -> LoopResponse:
    """验证任务完成情况

    运行单元测试 + E2E 测试 + TypeScript 编译检查。
    """
    project_path = _validate_project_path(req.project_path)

    try:
        runner = get_async_runner()
        workflow_id = runner.submit(
            action="verify",
            project_path=project_path,
            params={
                "run_unit": req.run_unit,
                "run_e2e": req.run_e2e,
                "run_typescript": req.run_typescript,
                "run_vite": req.run_vite,
            },
        )

        # 等待完成（verify 可能耗时较长）
        import asyncio
        for _ in range(600):  # 最多 5min
            status = runner.get_status(workflow_id)
            if status and status.status in ("completed", "failed"):
                break
            await asyncio.sleep(0.5)

        status = runner.get_status(workflow_id)
        if status is None:
            raise HTTPException(status_code=500, detail="Workflow not found")

        return LoopResponse(
            success=status.status == "completed",
            action="verify",
            data={
                "workflow_id": workflow_id,
                "status": status.status,
                "result": status.result,
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"verify failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status/{workflow_id}")
async def get_workflow_status(workflow_id: str) -> Dict[str, Any]:
    """查询工作流状态"""
    runner = get_async_runner()
    status = runner.get_status(workflow_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return status.to_dict()


@router.get("/list")
async def list_workflows() -> Dict[str, Any]:
    """列出所有工作流"""
    runner = get_async_runner()
    workflows = runner.list_workflows()
    return {
        "count": len(workflows),
        "workflows": [w.to_dict() for w in workflows],
    }


@router.delete("/{workflow_id}")
async def cancel_workflow(workflow_id: str) -> Dict[str, Any]:
    """取消工作流"""
    runner = get_async_runner()
    cancelled = await runner.cancel(workflow_id)
    if not cancelled:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {"success": True, "workflow_id": workflow_id, "status": "cancelled"}


@router.get("/health")
async def health_check() -> Dict[str, Any]:
    """健康检查"""
    return {
        "status": "ok",
        "service": "loop-commands",
        "version": "1.0.0",
    }
