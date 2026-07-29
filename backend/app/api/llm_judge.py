"""
# ============================================================
# Hermes LLM-as-Judge 验证层 - REST API
# ============================================================
# 核心作用：提供 LLM-as-Judge 验证层的 REST API 端点
# 端点：
#   - GET    /api/llm-judge/health                健康检查
#   - POST   /api/llm-judge/judge                 提交评分任务（同步）
#   - GET    /api/llm-judge/judge/{task_id}       获取评分结果
#   - GET    /api/llm-judge/judge/{task_id}/report 评分报告
#   - GET    /api/llm-judge/tasks                 列出任务
#   - GET    /api/llm-judge/pool                  Judge 模型池
#   - POST   /api/llm-judge/pool                  注册 Judge
#   - DELETE /api/llm-judge/pool/{judge_id}       注销 Judge
#   - POST   /api/llm-judge/consensus             多 Judge 共识评分
#   - GET    /api/llm-judge/stats                 统计信息
#   - POST   /api/llm-judge/verify                与 P1-10 集成
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 13 P0-3 新建
# ============================================================
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.llm_judge import (
    ConsensusStrategy,
    DEFAULT_RUBRIC,
    Difficulty,
    Domain,
    Judge,
    JudgeAdapterType,
    JudgeEngine,
    JudgePool,
    JudgeStore,
    JudgeTask,
    JudgeTaskStatus,
    LLMJudgeVerifier,
    get_judge_engine,
    get_judge_pool,
    get_judge_store,
    get_llm_judge_verifier,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/llm-judge", tags=["LLM-as-Judge 验证层"])


# ============================================================
# Pydantic 模型
# ============================================================
class JudgeRequest(BaseModel):
    """提交 Judge 任务请求"""
    task_description: str = Field(..., description="任务描述")
    code_diff: str = Field("", description="代码差异")
    test_results: str = Field("", description="测试结果")
    context: Dict[str, Any] = Field(default_factory=dict, description="上下文")
    rubric: List[str] = Field(default_factory=lambda: list(DEFAULT_RUBRIC), description="评分维度")
    difficulty: str = Field("medium", description="难度: easy/medium/hard")
    domain: str = Field("general", description="领域")
    use_consensus: bool = Field(True, description="是否使用多 Judge 共识")
    execute_sync: bool = Field(True, description="是否同步执行")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="元数据")
    tags: List[str] = Field(default_factory=list, description="标签")


class RegisterJudgeRequest(BaseModel):
    """注册 Judge 请求"""
    name: str = Field(..., description="Judge 名称")
    model: str = Field(..., description="模型名称")
    weight: float = Field(1.0, description="权重")
    adapter: str = Field("mock", description="适配器类型")
    specialties: List[str] = Field(default_factory=list, description="专长领域")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="元数据")


class ConsensusRequest(BaseModel):
    """共识评分请求"""
    task_description: str = Field(..., description="任务描述")
    code_diff: str = Field("", description="代码差异")
    test_results: str = Field("", description="测试结果")
    rubric: List[str] = Field(default_factory=list, description="评分维度")
    domain: str = Field("general", description="领域")
    difficulty: str = Field("medium", description="难度")
    strategy: str = Field("weighted_average", description="共识策略")
    judge_count: int = Field(3, description="Judge 数量")


class IntegrationRequest(BaseModel):
    """与 P1-10 VerificationLoop 集成请求"""
    task_description: str = Field(..., description="任务描述")
    code_diff: str = Field("", description="代码差异")
    test_results: str = Field("", description="测试结果")
    domain: str = Field("general", description="领域")
    difficulty: str = Field("medium", description="难度")
    use_consensus: bool = Field(True, description="是否使用共识")


# ============================================================
# 辅助函数
# ============================================================
def _get_engine() -> JudgeEngine:
    return get_judge_engine()


def _get_pool() -> JudgePool:
    return get_judge_pool()


def _get_store() -> JudgeStore:
    return get_judge_store()


# ============================================================
# 端点
# ============================================================
@router.get("/health")
async def health() -> Dict[str, Any]:
    """健康检查"""
    pool = _get_pool()
    store = _get_store()
    verifier = get_llm_judge_verifier()
    return {
        "success": True,
        "service": "llm-judge",
        "version": "1.0.0",
        "pool_stats": pool.get_stats(),
        "store_stats": store.get_stats(),
        "verifier_healthy": verifier.health_check().get("healthy", False),
        "features": [
            "5_dimension_scoring",
            "judge_pool",
            "multi_judge_consensus",
            "safety_veto",
            "divergence_detection",
            "verification_loop_integration",
        ],
    }


@router.post("/judge")
async def submit_judge(req: JudgeRequest) -> Dict[str, Any]:
    """提交 Judge 任务"""
    engine = _get_engine()
    # 校验 difficulty
    if req.difficulty not in [d.value for d in Difficulty]:
        raise HTTPException(status_code=400, detail=f"Invalid difficulty: {req.difficulty}")
    # 校验 domain
    if req.domain not in [d.value for d in Domain]:
        raise HTTPException(status_code=400, detail=f"Invalid domain: {req.domain}")

    # 创建任务
    task = JudgeTask(
        task_description=req.task_description,
        code_diff=req.code_diff,
        test_results=req.test_results,
        context=req.context,
        rubric=req.rubric,
        difficulty=req.difficulty,
        domain=req.domain,
        use_consensus=req.use_consensus,
        metadata=req.metadata,
        tags=req.tags,
    )

    if req.execute_sync:
        # 同步执行
        task = engine.execute_sync(task)
        return {
            "success": True,
            "task_id": task.task_id,
            "status": task.status,
            "consensus": task.consensus.to_dict() if task.consensus else None,
            "reports": [r.to_dict() for r in task.reports],
            "message": f"Task executed: {task.status}",
        }
    else:
        # 异步提交
        task = engine.submit(task)
        return {
            "success": True,
            "task_id": task.task_id,
            "status": task.status,
            "message": "Task submitted (use GET /judge/{id} to poll)",
        }


@router.get("/judge/{task_id}")
async def get_judge(task_id: str) -> Dict[str, Any]:
    """获取 Judge 任务结果"""
    store = _get_store()
    task = store.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
    return {
        "success": True,
        "task": task.to_dict(),
    }


@router.get("/judge/{task_id}/report")
async def get_judge_report(task_id: str) -> Dict[str, Any]:
    """获取详细评分报告（Markdown 格式）"""
    store = _get_store()
    task = store.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
    # 生成 Markdown 报告
    md_lines = [
        f"# Judge Report - {task.task_id}",
        "",
        f"**Status**: {task.status}",
        f"**Domain**: {task.domain}",
        f"**Difficulty**: {task.difficulty}",
        f"**Use Consensus**: {task.use_consensus}",
        f"**Created At**: {task.created_at}",
        f"**Completed At**: {task.completed_at}",
        "",
        "## Task Description",
        "",
        task.task_description or "(empty)",
        "",
    ]
    if task.consensus:
        c = task.consensus
        md_lines.extend([
            "## Consensus Result",
            "",
            f"**Overall Pass**: {c.overall_pass}",
            f"**Overall Score**: {c.overall_score}",
            f"**Safety Veto**: {c.safety_veto}",
            f"**Needs Review**: {c.needs_review}",
            f"**Strategy**: {c.strategy}",
            f"**Judge Count**: {c.judge_count}",
            "",
            "### Aggregated Scores",
            "",
            f"| Dimension | Score |",
            f"| --- | --- |",
        ])
        for dim, score in c.aggregated_scores.to_dict().items():
            md_lines.append(f"| {dim} | {score} |")
        md_lines.extend([
            "",
            "### Divergence",
            "",
            f"| Dimension | Divergence |",
            f"| --- | --- |",
        ])
        for dim, d in c.divergence.items():
            md_lines.append(f"| {dim} | {d} |")
        md_lines.append("")

    if task.reports:
        md_lines.extend([
            "## Individual Judge Reports",
            "",
        ])
        for r in task.reports:
            md_lines.extend([
                f"### {r.judge_name} ({r.model})",
                "",
                f"**Judge ID**: {r.judge_id}",
                f"**Overall Pass**: {r.overall_pass}",
                f"**Overall Score**: {r.overall_score}",
                f"**Latency**: {r.latency_ms}ms",
                "",
                "**Scores**:",
            ])
            for dim, score in r.scores.to_dict().items():
                md_lines.append(f"- {dim}: {score}")
            md_lines.extend([
                "",
                "**Issues**:",
            ])
            for issue in r.issues:
                md_lines.append(f"- {issue}")
            md_lines.extend([
                "",
                "**Suggestions**:",
            ])
            for sug in r.suggestions:
                md_lines.append(f"- {sug}")
            md_lines.append("")

    return {
        "success": True,
        "task_id": task_id,
        "report": "\n".join(md_lines),
    }


@router.get("/tasks")
async def list_tasks(
    status: Optional[str] = Query(None, description="按状态过滤"),
    limit: int = Query(50, description="数量限制"),
) -> Dict[str, Any]:
    """列出 Judge 任务"""
    store = _get_store()
    tasks = store.list(status=status, limit=limit)
    return {
        "success": True,
        "total": len(tasks),
        "tasks": [t.to_dict() for t in tasks],
    }


@router.get("/pool")
async def get_pool() -> Dict[str, Any]:
    """获取 Judge 模型池"""
    pool = _get_pool()
    judges = pool.list(enabled_only=False)
    return {
        "success": True,
        "total": len(judges),
        "judges": [j.to_dict() for j in judges],
    }


@router.post("/pool")
async def register_judge(req: RegisterJudgeRequest) -> Dict[str, Any]:
    """注册 Judge"""
    pool = _get_pool()
    # 校验 adapter
    if req.adapter not in ["mock", "claude", "gpt", "gemini", "custom"]:
        raise HTTPException(status_code=400, detail=f"Invalid adapter: {req.adapter}")
    judge = Judge(
        name=req.name,
        model=req.model,
        weight=req.weight,
        adapter=req.adapter,
        specialties=req.specialties,
        metadata=req.metadata,
    )
    judge = pool.register(judge)
    return {
        "success": True,
        "judge": judge.to_dict(),
        "message": f"Judge registered: {judge.judge_id}",
    }


@router.delete("/pool/{judge_id}")
async def unregister_judge(judge_id: str) -> Dict[str, Any]:
    """注销 Judge"""
    pool = _get_pool()
    success = pool.unregister(judge_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Judge not found: {judge_id}")
    return {
        "success": True,
        "judge_id": judge_id,
        "message": "Judge unregistered",
    }


@router.post("/consensus")
async def consensus_score(req: ConsensusRequest) -> Dict[str, Any]:
    """多 Judge 共识评分（直接执行并返回）"""
    engine = _get_engine()
    # 创建任务
    task = JudgeTask(
        task_description=req.task_description,
        code_diff=req.code_diff,
        test_results=req.test_results,
        rubric=req.rubric,
        domain=req.domain,
        difficulty=req.difficulty,
        use_consensus=True,
    )
    # 执行
    task = engine.execute_sync(task, consensus_strategy=req.strategy)
    return {
        "success": True,
        "task_id": task.task_id,
        "consensus": task.consensus.to_dict() if task.consensus else None,
        "reports": [r.to_dict() for r in task.reports],
    }


@router.get("/stats")
async def get_stats() -> Dict[str, Any]:
    """统计信息"""
    pool = _get_pool()
    store = _get_store()
    return {
        "success": True,
        "pool_stats": pool.get_stats(),
        "store_stats": store.get_stats(),
    }


@router.post("/verify")
async def verify_with_loop(req: IntegrationRequest) -> Dict[str, Any]:
    """与 P1-10 VerificationLoop 集成"""
    verifier = get_llm_judge_verifier()
    result = verifier.verify(
        task_description=req.task_description,
        code_diff=req.code_diff,
        test_results=req.test_results,
        domain=req.domain,
        difficulty=req.difficulty,
        use_consensus=req.use_consensus,
    )
    return {
        "success": True,
        "verified": result.get("passed", False),
        "verifier_result": result,
    }
