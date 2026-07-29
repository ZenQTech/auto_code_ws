"""
# ============================================================
# Hermes /goal 长时域模式 - REST API
# ============================================================
# 核心作用：提供 /goal 系统的 REST API 端点
# 端点：
#   - GET  /health                                  健康检查
#   - POST /goals                                   创建 Goal
#   - GET  /goals                                   列出 Goal
#   - GET  /goals/{goal_id}                         Goal 详情
#   - PUT  /goals/{goal_id}                         更新 Goal
#   - DELETE /goals/{goal_id}                       删除 Goal
#   - POST /goals/{goal_id}/start                   启动
#   - POST /goals/{goal_id}/pause                   暂停
#   - POST /goals/{goal_id}/resume                  恢复
#   - POST /goals/{goal_id}/complete                完成
#   - POST /goals/{goal_id}/fail                    失败
#   - POST /goals/{goal_id}/abandon                 放弃
#   - POST /goals/{goal_id}/tokens                  添加 token
#   - GET  /goals/{goal_id}/budget                  预算状态
#   - POST /goals/{goal_id}/acceptance              添加 AC
#   - PUT  /goals/{goal_id}/acceptance/{ac_id}      更新 AC
#   - GET  /goals/{goal_id}/verify                  列出验证项
#   - POST /goals/{goal_id}/verify                  添加验证项
#   - POST /goals/{goal_id}/verify/run              执行验证
#   - PUT  /goals/{goal_id}/verify/{item_id}        更新验证项
#   - GET  /goals/{goal_id}/progress                获取进度
#   - POST /goals/{goal_id}/progress                添加进度
#   - GET  /goals/{goal_id}/markdown/{file_type}    渲染 Markdown
#   - GET  /stats                                   统计信息
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 12 P0-2 新建
# ============================================================
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.goal import (
    AcceptanceCriterion,
    AcceptanceStatus,
    Goal,
    GoalStatus,
    ProgressEntry,
    ProgressStatus,
    TokenBudget,
    VerifyItem,
    VerifyStatus,
    VerifyType,
    get_manager,
    get_verifier,
    parse_goal_md,
    render_goal_md,
    render_progress_md,
    render_verify_md,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["/goal 长时域模式"])


# ============================================================
# Pydantic 模型
# ============================================================
class AcceptanceCriterionModel(BaseModel):
    """AC 请求模型"""
    title: str
    description: str = ""
    priority: int = 1
    verify_items: List[str] = []


class TokenBudgetModel(BaseModel):
    """Token 预算模型"""
    soft_limit: int = 40000
    hard_limit: int = 60000
    used: int = 0
    warning_threshold: int = 35000


class CreateGoalRequest(BaseModel):
    """创建 Goal 请求"""
    title: str
    objective: str = ""
    acceptance_criteria: List[AcceptanceCriterionModel] = []
    constraints: List[str] = []
    token_budget: Optional[TokenBudgetModel] = None
    tags: List[str] = []
    owner: str = "system"


class UpdateGoalRequest(BaseModel):
    """更新 Goal 请求"""
    title: Optional[str] = None
    objective: Optional[str] = None
    constraints: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    token_budget: Optional[TokenBudgetModel] = None


class AddTokensRequest(BaseModel):
    """添加 token 请求"""
    count: int = Field(..., ge=0, description="添加的 token 数")


class UpdateACRequest(BaseModel):
    """更新 AC 请求"""
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[int] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class VerifyItemModel(BaseModel):
    """验证项模型"""
    title: str
    description: str = ""
    verify_type: str = "command"
    target: str = ""
    expected: str = ""
    timeout: int = 60
    retry_count: int = 0
    ac_id: Optional[str] = None


class UpdateVerifyItemRequest(BaseModel):
    """更新验证项请求"""
    title: Optional[str] = None
    description: Optional[str] = None
    verify_type: Optional[str] = None
    target: Optional[str] = None
    expected: Optional[str] = None
    timeout: Optional[int] = None
    retry_count: Optional[int] = None
    status: Optional[str] = None


class ProgressActionModel(BaseModel):
    """进度动作模型"""
    description: str = ""
    target: str = ""
    result: str = ""


class AddProgressRequest(BaseModel):
    """添加进度请求"""
    status: str = "info"
    ac_id: Optional[str] = None
    action: ProgressActionModel = Field(default_factory=ProgressActionModel)
    tokens_used: int = 0
    duration_ms: int = 0
    notes: str = ""


class FailRequest(BaseModel):
    """失败请求"""
    reason: str = ""


class AbandonRequest(BaseModel):
    """放弃请求"""
    reason: str = ""


# ============================================================
# 工具函数
# ============================================================
def _ac_from_model(model: AcceptanceCriterionModel) -> AcceptanceCriterion:
    """从 Pydantic 模型构建 AC"""
    return AcceptanceCriterion(
        title=model.title,
        description=model.description,
        priority=model.priority,
        verify_items=model.verify_items,
    )


def _verify_item_from_model(goal_id: str, model: VerifyItemModel) -> VerifyItem:
    """从 Pydantic 模型构建 VerifyItem"""
    try:
        vt = VerifyType(model.verify_type)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid verify_type: {model.verify_type}")
    return VerifyItem(
        title=model.title,
        description=model.description,
        verify_type=vt,
        target=model.target,
        expected=model.expected,
        timeout=model.timeout,
        retry_count=model.retry_count,
        ac_id=model.ac_id,
    )


# ============================================================
# 端点
# ============================================================
@router.get("/health")
async def health() -> Dict[str, Any]:
    """健康检查"""
    manager = get_manager()
    return {
        "success": True,
        "service": "goal",
        "version": "1.0.0",
        "cycle": "Cycle 12 P0-2",
        "stats": manager.get_stats(),
        "features": [
            "three_file_trust",
            "state_machine",
            "token_budget",
            "checkpoint_resume",
            "auto_verification",
            "progress_tracking",
            "markdown_rendering",
        ],
    }


@router.post("/goals")
async def create_goal(request: CreateGoalRequest) -> Dict[str, Any]:
    """创建 Goal"""
    manager = get_manager()
    try:
        goal = Goal(
            title=request.title,
            objective=request.objective,
            constraints=request.constraints,
            tags=request.tags,
            owner=request.owner,
        )
        # 添加 AC
        for ac_model in request.acceptance_criteria:
            goal.acceptance_criteria.append(_ac_from_model(ac_model))
        # Token 预算
        if request.token_budget:
            goal.token_budget = TokenBudget(
                soft_limit=request.token_budget.soft_limit,
                hard_limit=request.token_budget.hard_limit,
                used=request.token_budget.used,
                warning_threshold=request.token_budget.warning_threshold,
            )
        goal = manager.create(goal)
        return {
            "success": True,
            "goal": goal.to_dict(),
            "message": f"Goal {goal.id} created",
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/goals")
async def list_goals(
    status: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    owner: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """列出 Goal"""
    manager = get_manager()
    goal_status = None
    if status:
        try:
            goal_status = GoalStatus(status)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")
    goals = manager.list_all(status=goal_status, tag=tag, owner=owner)
    return {
        "success": True,
        "count": len(goals),
        "goals": [g.to_dict() for g in goals],
    }


@router.get("/goals/{goal_id}")
async def get_goal(goal_id: str) -> Dict[str, Any]:
    """获取 Goal 详情"""
    manager = get_manager()
    goal = manager.get(goal_id)
    if goal is None:
        raise HTTPException(status_code=404, detail=f"Goal not found: {goal_id}")
    return {
        "success": True,
        "goal": goal.to_dict(),
    }


@router.put("/goals/{goal_id}")
async def update_goal(goal_id: str, request: UpdateGoalRequest) -> Dict[str, Any]:
    """更新 Goal"""
    manager = get_manager()
    try:
        kwargs: Dict[str, Any] = {}
        if request.title is not None:
            kwargs["title"] = request.title
        if request.objective is not None:
            kwargs["objective"] = request.objective
        if request.constraints is not None:
            kwargs["constraints"] = request.constraints
        if request.tags is not None:
            kwargs["tags"] = request.tags
        if request.token_budget is not None:
            kwargs["token_budget"] = {
                "soft_limit": request.token_budget.soft_limit,
                "hard_limit": request.token_budget.hard_limit,
                "used": request.token_budget.used,
                "warning_threshold": request.token_budget.warning_threshold,
            }
        goal = manager.update(goal_id, **kwargs)
        return {
            "success": True,
            "goal": goal.to_dict(),
            "message": f"Goal {goal_id} updated",
        }
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/goals/{goal_id}")
async def delete_goal(goal_id: str) -> Dict[str, Any]:
    """删除 Goal"""
    manager = get_manager()
    try:
        manager.delete(goal_id)
        return {
            "success": True,
            "message": f"Goal {goal_id} deleted",
        }
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/goals/{goal_id}/start")
async def start_goal(goal_id: str) -> Dict[str, Any]:
    """启动 Goal"""
    manager = get_manager()
    try:
        goal = manager.start(goal_id)
        return {"success": True, "goal": goal.to_dict(), "message": f"Goal {goal_id} started"}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/goals/{goal_id}/pause")
async def pause_goal(goal_id: str) -> Dict[str, Any]:
    """暂停 Goal"""
    manager = get_manager()
    try:
        goal = manager.pause(goal_id)
        return {"success": True, "goal": goal.to_dict(), "message": f"Goal {goal_id} paused"}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/goals/{goal_id}/resume")
async def resume_goal(goal_id: str) -> Dict[str, Any]:
    """恢复 Goal"""
    manager = get_manager()
    try:
        goal = manager.resume(goal_id)
        return {"success": True, "goal": goal.to_dict(), "message": f"Goal {goal_id} resumed"}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/goals/{goal_id}/complete")
async def complete_goal(goal_id: str) -> Dict[str, Any]:
    """完成 Goal"""
    manager = get_manager()
    try:
        goal = manager.complete(goal_id)
        return {"success": True, "goal": goal.to_dict(), "message": f"Goal {goal_id} completed"}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/goals/{goal_id}/fail")
async def fail_goal(goal_id: str, request: FailRequest) -> Dict[str, Any]:
    """标记失败"""
    manager = get_manager()
    try:
        goal = manager.fail(goal_id, request.reason)
        return {"success": True, "goal": goal.to_dict(), "message": f"Goal {goal_id} failed"}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/goals/{goal_id}/abandon")
async def abandon_goal(goal_id: str, request: AbandonRequest) -> Dict[str, Any]:
    """放弃 Goal"""
    manager = get_manager()
    try:
        goal = manager.abandon(goal_id, request.reason)
        return {"success": True, "goal": goal.to_dict(), "message": f"Goal {goal_id} abandoned"}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/goals/{goal_id}/tokens")
async def add_tokens(goal_id: str, request: AddTokensRequest) -> Dict[str, Any]:
    """添加 token 使用"""
    manager = get_manager()
    try:
        budget = manager.add_tokens(goal_id, request.count)
        return {
            "success": True,
            "goal_id": goal_id,
            "token_budget": budget.to_dict(),
        }
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/goals/{goal_id}/budget")
async def get_budget(goal_id: str) -> Dict[str, Any]:
    """获取预算状态"""
    manager = get_manager()
    try:
        return {
            "success": True,
            "budget": manager.check_budget(goal_id),
        }
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/goals/{goal_id}/acceptance")
async def add_acceptance(goal_id: str, request: AcceptanceCriterionModel) -> Dict[str, Any]:
    """添加 AC"""
    manager = get_manager()
    try:
        ac = _ac_from_model(request)
        goal = manager.add_acceptance_criterion(goal_id, ac)
        return {
            "success": True,
            "ac": ac.to_dict(),
            "goal": goal.to_dict(),
        }
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/goals/{goal_id}/acceptance/{ac_id}")
async def update_acceptance(goal_id: str, ac_id: str, request: UpdateACRequest) -> Dict[str, Any]:
    """更新 AC"""
    manager = get_manager()
    try:
        kwargs: Dict[str, Any] = {}
        if request.title is not None:
            kwargs["title"] = request.title
        if request.description is not None:
            kwargs["description"] = request.description
        if request.priority is not None:
            kwargs["priority"] = request.priority
        if request.status is not None:
            kwargs["status"] = request.status
        if request.notes is not None:
            kwargs["notes"] = request.notes
        ac = manager.update_acceptance_criterion(goal_id, ac_id, **kwargs)
        return {
            "success": True,
            "ac": ac.to_dict(),
        }
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/goals/{goal_id}/verify")
async def list_verify(goal_id: str) -> Dict[str, Any]:
    """列出验证项"""
    manager = get_manager()
    try:
        items = manager.list_verify_items(goal_id)
        return {
            "success": True,
            "count": len(items),
            "items": [item.to_dict() for item in items],
        }
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/goals/{goal_id}/verify")
async def add_verify(goal_id: str, request: VerifyItemModel) -> Dict[str, Any]:
    """添加验证项"""
    manager = get_manager()
    try:
        item = _verify_item_from_model(goal_id, request)
        manager.add_verify_item(goal_id, item)
        return {
            "success": True,
            "item": item.to_dict(),
        }
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/goals/{goal_id}/verify/{item_id}")
async def update_verify(goal_id: str, item_id: str, request: UpdateVerifyItemRequest) -> Dict[str, Any]:
    """更新验证项"""
    manager = get_manager()
    try:
        kwargs: Dict[str, Any] = {}
        for k, v in request.model_dump(exclude_unset=True).items():
            if v is not None:
                kwargs[k] = v
        item = manager.update_verify_item(goal_id, item_id, **kwargs)
        return {
            "success": True,
            "item": item.to_dict(),
        }
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/goals/{goal_id}/verify/run")
async def run_verify(goal_id: str) -> Dict[str, Any]:
    """执行所有验证项"""
    manager = get_manager()
    verifier = get_verifier()
    try:
        items = manager.list_verify_items(goal_id)
        report = verifier.verify_all(items, goal_id)
        # 记录进度
        manager.add_progress(
            goal_id,
            ProgressEntry(
                status=ProgressStatus.COMPLETED if report.is_all_passed else ProgressStatus.FAILED,
                action=__import__('app.core.goal', fromlist=['ProgressAction']).ProgressAction(
                    description=f"Verification run: {report.passed}/{report.total} passed",
                    target=goal_id,
                ),
                duration_ms=report.duration_ms,
            ),
        )
        # 自动更新 AC 状态
        for item in items:
            if item.ac_id and item.status == VerifyStatus.PASSED:
                ac = next((a for a in manager.get(goal_id).acceptance_criteria if a.id == item.ac_id), None)
                if ac and ac.status == AcceptanceStatus.PENDING:
                    manager.update_acceptance_criterion(goal_id, ac.id, status="in_progress")
        return {
            "success": True,
            "report": report.to_dict(),
        }
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/goals/{goal_id}/progress")
async def get_progress(goal_id: str) -> Dict[str, Any]:
    """获取进度"""
    manager = get_manager()
    try:
        log = manager.get_progress(goal_id)
        return {
            "success": True,
            "progress": log.to_dict(),
        }
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/goals/{goal_id}/progress")
async def add_progress(goal_id: str, request: AddProgressRequest) -> Dict[str, Any]:
    """添加进度"""
    manager = get_manager()
    try:
        try:
            status = ProgressStatus(request.status)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {request.status}")
        entry = ProgressEntry(
            status=status,
            ac_id=request.ac_id,
            action=__import__('app.core.goal', fromlist=['ProgressAction']).ProgressAction(
                description=request.action.description,
                target=request.action.target,
                result=request.action.result,
            ),
            tokens_used=request.tokens_used,
            duration_ms=request.duration_ms,
            notes=request.notes,
        )
        entry = manager.add_progress(goal_id, entry)
        return {
            "success": True,
            "entry": entry.to_dict(),
        }
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/goals/{goal_id}/markdown/{file_type}")
async def get_markdown(goal_id: str, file_type: str) -> Dict[str, Any]:
    """渲染 Markdown"""
    manager = get_manager()
    try:
        goal = manager.get_or_raise(goal_id)
        if file_type == "goal":
            content = render_goal_md(goal)
        elif file_type == "verify":
            items = manager.list_verify_items(goal_id)
            content = render_verify_md(goal, items)
        elif file_type == "progress":
            log = manager.get_progress(goal_id)
            content = render_progress_md(log)
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file_type: {file_type}. Must be goal/verify/progress",
            )
        return {
            "success": True,
            "goal_id": goal_id,
            "file_type": file_type,
            "content": content,
        }
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/stats")
async def stats() -> Dict[str, Any]:
    """统计信息"""
    manager = get_manager()
    return {
        "success": True,
        "stats": manager.get_stats(),
    }
