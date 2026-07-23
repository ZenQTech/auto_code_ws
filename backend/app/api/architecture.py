"""
# ============================================================
# 架构设计批判迭代 API
# ============================================================
# 核心作用：提供架构设计生成、批判审查、迭代精炼、人工确认
#           的 REST API 接口
# 运行流程：
#   - POST /api/architecture/design: 生成架构设计方案
#   - POST /api/architecture/critique: 执行架构批判审查
#   - POST /api/architecture/iterate: 执行一次批判迭代（批判 + 精炼）
#   - GET  /api/architecture/status: 获取当前架构工作流状态
#   - POST /api/architecture/confirm: 人工确认架构方案
#   - POST /api/architecture/reject: 人工驳回架构方案（含反馈）
# 输入参数：通过请求体传递（JSON 格式）
# 输出结果：各接口对应的 JSON 响应
# 修改记录：
#   - 2026-06-24 | v1.0.0 | 初始版本，实现架构设计批判迭代完整 API
#   - 2026-07-01 | v2.0.0 | 新增架构设计阶段端点：start-design-phase / confirm-design /
#     reject-design / finalize-design，串联 ArchitectureWorkflowService 完整工作流
# ============================================================
"""

import logging
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field

from ..services.architecture_designer import ArchitectureDesigner
from ..services.architecture_critic import ArchitectureCritic

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# 请求/响应模型
# ============================================================

class DesignRequest(BaseModel):
    """
    架构设计请求
    字段说明：
      - requirements_doc: str，用户需求文档（Markdown 格式）
    """
    requirements_doc: str = Field(..., min_length=1, description="用户需求文档（Markdown 格式）")


class DesignResponse(BaseModel):
    """
    架构设计响应
    字段说明：
      - success: bool，是否成功
      - architecture_doc: dict，生成的架构设计文档
      - error_message: str，错误信息
    """
    success: bool = Field(default=False, description="是否成功")
    architecture_doc: Dict[str, Any] = Field(default_factory=dict, description="架构设计文档")
    error_message: str = Field(default="", description="错误信息")


class CritiqueRequest(BaseModel):
    """
    架构批判请求
    字段说明：
      - architecture_doc: dict，待审查的架构设计文档
    """
    architecture_doc: Dict[str, Any] = Field(..., description="待审查的架构设计文档")


class CritiqueResponse(BaseModel):
    """
    架构批判响应
    字段说明：
      - success: bool，是否成功
      - critique_report: dict，批判报告（三章）
      - error_message: str，错误信息
    """
    success: bool = Field(default=False, description="是否成功")
    critique_report: Dict[str, Any] = Field(default_factory=dict, description="批判报告")
    error_message: str = Field(default="", description="错误信息")


class IterateRequest(BaseModel):
    """
    架构迭代请求
    字段说明：
      - architecture_doc: dict，当前架构设计文档
      - critic_feedback: dict，批判反馈（缺陷列表 + 总体结论）
    """
    architecture_doc: Dict[str, Any] = Field(..., description="当前架构设计文档")
    critic_feedback: Dict[str, Any] = Field(..., description="批判反馈")


class IterateResponse(BaseModel):
    """
    架构迭代响应
    字段说明：
      - success: bool，是否成功
      - refined_doc: dict，精炼后的架构文档
      - iteration_info: dict，迭代状态信息
      - reached_limit: bool，是否已达迭代上限
      - error_message: str，错误信息
    """
    success: bool = Field(default=False, description="是否成功")
    refined_doc: Dict[str, Any] = Field(default_factory=dict, description="精炼后的架构文档")
    iteration_info: Dict[str, Any] = Field(default_factory=dict, description="迭代状态信息")
    reached_limit: bool = Field(default=False, description="是否已达迭代上限")
    error_message: str = Field(default="", description="错误信息")


class StatusResponse(BaseModel):
    """
    架构工作流状态响应
    字段说明：
      - designer_info: dict，设计器状态信息
      - critic_info: dict，批判器状态信息
    """
    designer_info: Dict[str, Any] = Field(default_factory=dict, description="设计器状态")
    critic_info: Dict[str, Any] = Field(default_factory=dict, description="批判器状态")


class ConfirmRequest(BaseModel):
    """
    人工确认请求
    字段说明：
      - architecture_doc: dict，待确认的架构文档
      - reviewer: str，审核人标识
      - comment: str，审核意见
    """
    architecture_doc: Dict[str, Any] = Field(..., description="待确认的架构文档")
    reviewer: str = Field(default="", description="审核人标识")
    comment: str = Field(default="", description="审核意见")


class ConfirmResponse(BaseModel):
    """
    人工确认响应
    字段说明：
      - success: bool，是否成功
      - status: str，确认状态
      - message: str，确认消息
    """
    success: bool = Field(default=False, description="是否成功")
    status: str = Field(default="pending", description="确认状态")
    message: str = Field(default="", description="确认消息")


class RejectRequest(BaseModel):
    """
    人工驳回请求
    字段说明：
      - architecture_doc: dict，被驳回的架构文档
      - reviewer: str，审核人标识
      - rejection_reason: str，驳回原因
      - feedback: dict，详细反馈（可选）
    """
    architecture_doc: Dict[str, Any] = Field(..., description="被驳回的架构文档")
    reviewer: str = Field(default="", description="审核人标识")
    rejection_reason: str = Field(..., min_length=1, description="驳回原因")
    feedback: Dict[str, Any] = Field(default_factory=dict, description="详细反馈")


class RejectResponse(BaseModel):
    """
    人工驳回响应
    字段说明：
      - success: bool，是否成功
      - status: str，驳回状态
      - message: str，驳回消息
      - rejection_record: dict，驳回记录
    """
    success: bool = Field(default=False, description="是否成功")
    status: str = Field(default="rejected", description="驳回状态")
    message: str = Field(default="", description="驳回消息")
    rejection_record: Dict[str, Any] = Field(default_factory=dict, description="驳回记录")


# ============================================================
# 服务实例（请求级别，通过 app.state 获取）
# ============================================================

def _get_designer(request: Request) -> ArchitectureDesigner:
    """
    获取或创建 ArchitectureDesigner 实例
    作用：从 app.state 获取全局单例，若不存在则创建
    调用方：所有需要设计器的 API 端点
    被调用方：无
    参数：
      - request: Request，FastAPI 请求对象
    返回值：ArchitectureDesigner 实例
    """
    if not hasattr(request.app.state, "architecture_designer"):
        request.app.state.architecture_designer = ArchitectureDesigner()
    return request.app.state.architecture_designer


def _get_critic(request: Request) -> ArchitectureCritic:
    """
    获取或创建 ArchitectureCritic 实例
    作用：从 app.state 获取全局单例，若不存在则创建
    调用方：所有需要批判器的 API 端点
    被调用方：无
    参数：
      - request: Request，FastAPI 请求对象
    返回值：ArchitectureCritic 实例
    """
    if not hasattr(request.app.state, "architecture_critic"):
        request.app.state.architecture_critic = ArchitectureCritic()
    return request.app.state.architecture_critic


# ============================================================
# API 端点
# ============================================================

@router.post("/design", response_model=DesignResponse)
async def design_architecture(request: Request, body: DesignRequest):
    """
    生成架构设计方案
    运行步骤：
      1. 获取 ArchitectureDesigner 实例
      2. 调用 generate_architecture() 生成五章架构方案
      3. 返回结构化架构文档
    调用方：前端架构设计界面
    被调用方：ArchitectureDesigner.generate_architecture()
    参数：
      - body: DesignRequest，含 requirements_doc
    返回值：DesignResponse，含架构设计文档
    """
    logger.info(f"收到架构设计请求，需求文档长度={len(body.requirements_doc)} 字符")
    try:
        designer = _get_designer(request)
        architecture_doc = designer.generate_architecture(body.requirements_doc)
        logger.info(f"架构设计完成，doc_id={architecture_doc.get('doc_id', 'N/A')}")
        return DesignResponse(
            success=True,
            architecture_doc=architecture_doc,
        )
    except Exception as e:
        logger.error(f"架构设计失败：{e}", exc_info=True)
        return DesignResponse(
            success=False,
            error_message=f"架构设计失败：{str(e)}",
        )


@router.post("/critique", response_model=CritiqueResponse)
async def critique_architecture(request: Request, body: CritiqueRequest):
    """
    执行架构批判审查
    运行步骤：
      1. 获取 ArchitectureCritic 实例
      2. 调用 critique() 执行全维度批判审查
      3. 返回三章批判报告
    调用方：前端架构批判界面
    被调用方：ArchitectureCritic.critique()
    参数：
      - body: CritiqueRequest，含 architecture_doc
    返回值：CritiqueResponse，含批判报告
    """
    logger.info("收到架构批判审查请求")
    try:
        critic = _get_critic(request)
        critique_report = critic.critique(body.architecture_doc)
        overall = critique_report.get("chapter_1_overall_assessment", {})
        logger.info(
            f"架构批判完成，评分={overall.get('score', 'N/A')}，"
            f"状态={overall.get('status_label', 'N/A')}"
        )
        return CritiqueResponse(
            success=True,
            critique_report=critique_report,
        )
    except Exception as e:
        logger.error(f"架构批判失败：{e}", exc_info=True)
        return CritiqueResponse(
            success=False,
            error_message=f"架构批判失败：{str(e)}",
        )


@router.post("/iterate", response_model=IterateResponse)
async def iterate_architecture(request: Request, body: IterateRequest):
    """
    执行一次架构批判迭代（批判 + 精炼）
    运行步骤：
      1. 获取 ArchitectureCritic 实例，执行批判审查
      2. 获取 ArchitectureDesigner 实例，基于批判反馈精炼架构
      3. 返回精炼后的架构文档和迭代状态
    调用方：前端架构迭代界面
    被调用方：ArchitectureCritic.critique() + ArchitectureDesigner.refine_architecture()
    参数：
      - body: IterateRequest，含 architecture_doc 和 critic_feedback
    返回值：IterateResponse，含精炼后文档和迭代状态
    """
    logger.info("收到架构批判迭代请求")
    try:
        designer = _get_designer(request)

        # 检查迭代次数上限
        iteration_info = designer.get_iteration_info()
        if not iteration_info.get("can_refine", False):
            logger.warning(
                f"已达迭代上限 ({iteration_info.get('current_iteration')}/"
                f"{iteration_info.get('max_iterations')})，无法继续迭代"
            )
            return IterateResponse(
                success=False,
                reached_limit=True,
                iteration_info=iteration_info,
                error_message=(
                    f"已达到最大批判迭代次数上限 "
                    f"({iteration_info.get('current_iteration')}/"
                    f"{iteration_info.get('max_iterations')})"
                ),
            )

        # 先执行批判审查
        critic = _get_critic(request)
        critique_report = critic.critique(body.architecture_doc)

        # 提取批判反馈中的缺陷列表和总体结论
        critic_feedback = {
            "defect_list": critique_report.get("chapter_2_structured_defect_list", []),
            "overall_conclusion": critique_report.get("chapter_1_overall_assessment", {}),
        }

        # 基于批判反馈精炼架构
        refined_doc = designer.refine_architecture(
            body.architecture_doc, critic_feedback
        )

        if refined_doc is None:
            # 已达迭代上限
            iteration_info = designer.get_iteration_info()
            return IterateResponse(
                success=False,
                reached_limit=True,
                iteration_info=iteration_info,
                error_message="精炼失败：已达到最大批判迭代次数上限",
            )

        iteration_info = designer.get_iteration_info()
        logger.info(
            f"架构迭代完成，当前迭代 {iteration_info.get('current_iteration')}/"
            f"{iteration_info.get('max_iterations')}"
        )
        return IterateResponse(
            success=True,
            refined_doc=refined_doc,
            iteration_info=iteration_info,
            reached_limit=False,
        )

    except Exception as e:
        logger.error(f"架构迭代失败：{e}", exc_info=True)
        return IterateResponse(
            success=False,
            error_message=f"架构迭代失败：{str(e)}",
        )


@router.get("/status", response_model=StatusResponse)
async def get_architecture_status(request: Request):
    """
    获取当前架构工作流状态
    运行步骤：
      1. 获取 ArchitectureDesigner 实例，查询迭代状态
      2. 获取 ArchitectureCritic 实例，查询批判状态
      3. 返回综合状态信息
    调用方：前端架构状态面板
    被调用方：ArchitectureDesigner.get_iteration_info() + ArchitectureCritic.get_overall_conclusion()
    参数：无
    返回值：StatusResponse，含设计器和批判器状态
    """
    logger.info("查询架构工作流状态")
    try:
        designer = _get_designer(request)
        critic = _get_critic(request)

        designer_info = designer.get_iteration_info()
        critic_info = {
            "has_conclusion": bool(critic.get_overall_conclusion().get("status") != "no_review"),
            "overall_conclusion": critic.get_overall_conclusion(),
            "defect_count": len(critic.get_defect_list()),
        }

        return StatusResponse(
            designer_info=designer_info,
            critic_info=critic_info,
        )
    except Exception as e:
        logger.error(f"查询架构状态失败：{e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"查询架构状态失败：{str(e)}")


@router.post("/confirm", response_model=ConfirmResponse)
async def confirm_architecture(request: Request, body: ConfirmRequest):
    """
    人工确认架构方案
    运行步骤：
      1. 记录审核人信息和审核意见
      2. 标记架构方案为已确认
      3. 返回确认结果
    调用方：前端人工确认界面
    被调用方：无（纯状态记录）
    参数：
      - body: ConfirmRequest，含 architecture_doc、reviewer、comment
    返回值：ConfirmResponse，含确认状态
    """
    logger.info(
        f"收到架构确认请求，审核人={body.reviewer or '未指定'}，"
        f"doc_id={body.architecture_doc.get('doc_id', 'N/A')}"
    )
    try:
        doc_id = body.architecture_doc.get("doc_id", "unknown")
        doc_version = body.architecture_doc.get("version", "unknown")

        logger.info(
            f"架构方案已确认：doc_id={doc_id}，version={doc_version}，"
            f"审核人={body.reviewer or '未指定'}，意见={body.comment[:100] if body.comment else '无'}"
        )

        return ConfirmResponse(
            success=True,
            status="confirmed",
            message=(
                f"架构方案 v{doc_version} 已通过人工确认。"
                f"审核人：{body.reviewer or '未指定'}。"
                f"可进入下一阶段。"
            ),
        )
    except Exception as e:
        logger.error(f"架构确认失败：{e}", exc_info=True)
        return ConfirmResponse(
            success=False,
            status="error",
            message=f"架构确认失败：{str(e)}",
        )


@router.post("/reject", response_model=RejectResponse)
async def reject_architecture(request: Request, body: RejectRequest):
    """
    人工驳回架构方案（含反馈）
    运行步骤：
      1. 记录驳回原因和详细反馈
      2. 生成驳回记录
      3. 返回驳回结果（含反馈信息供后续精炼使用）
    调用方：前端人工驳回界面
    被调用方：无（纯状态记录）
    参数：
      - body: RejectRequest，含 architecture_doc、reviewer、rejection_reason、feedback
    返回值：RejectResponse，含驳回记录
    """
    logger.info(
        f"收到架构驳回请求，审核人={body.reviewer or '未指定'}，"
        f"原因={body.rejection_reason[:100]}"
    )
    try:
        from datetime import datetime, timezone

        doc_id = body.architecture_doc.get("doc_id", "unknown")
        doc_version = body.architecture_doc.get("version", "unknown")

        # 构建驳回记录
        rejection_record = {
            "doc_id": doc_id,
            "doc_version": doc_version,
            "reviewer": body.reviewer or "未指定",
            "rejection_reason": body.rejection_reason,
            "feedback": body.feedback,
            "rejected_at": datetime.now(timezone.utc).isoformat(),
        }

        logger.info(
            f"架构方案已驳回：doc_id={doc_id}，version={doc_version}，"
            f"原因={body.rejection_reason[:100]}"
        )

        return RejectResponse(
            success=True,
            status="rejected",
            message=(
                f"架构方案 v{doc_version} 已被驳回。"
                f"驳回原因：{body.rejection_reason[:200]}。"
                f"请根据反馈进行修改后重新提交。"
            ),
            rejection_record=rejection_record,
        )
    except Exception as e:
        logger.error(f"架构驳回失败：{e}", exc_info=True)
        return RejectResponse(
            success=False,
            status="error",
            message=f"架构驳回失败：{str(e)}",
        )


# ============================================================
# 架构设计阶段端点（v2.0.0 新增）
# 对应工作流第二部分：需求澄清后 → 架构设计批判迭代
# ============================================================

class StartDesignPhaseRequest(BaseModel):
    """
    启动架构设计阶段请求
    字段说明：
      - workflow_id: str，工作流 ID
    """
    workflow_id: str = Field(..., min_length=1, description="工作流 ID")


class StartDesignPhaseResponse(BaseModel):
    """
    启动架构设计阶段响应
    字段说明：
      - success: bool，是否成功
      - requirement_v2: str，迭代优化后的需求文档 V2.0
      - critique_result: dict，批判分析结果（含缺陷清单）
      - phase_complete: bool，阶段是否完成
      - error_message: str，错误信息
    """
    success: bool = Field(default=False, description="是否成功")
    requirement_v2: str = Field(default="", description="需求文档 V2.0")
    critique_result: Optional[Dict[str, Any]] = Field(default=None, description="批判分析结果")
    phase_complete: bool = Field(default=False, description="阶段是否完成")
    error_message: str = Field(default="", description="错误信息")


class DesignConfirmRequest(BaseModel):
    """
    架构设计确认请求（V2.0 需求确认）
    字段说明：
      - workflow_id: str，工作流 ID
      - confirmed: bool，是否确认通过
    """
    workflow_id: str = Field(..., min_length=1, description="工作流 ID")
    confirmed: bool = Field(..., description="是否确认通过")


class DesignConfirmResponse(BaseModel):
    """
    架构设计确认响应
    字段说明：
      - success: bool，是否成功
      - message: str，确认消息
      - spec_doc: str，spec.md 内容（确认通过时返回）
      - task_doc: str，task.md 内容（确认通过时返回）
      - checklist_doc: str，checklist.md 内容（确认通过时返回）
      - acceptance_doc: str，验收标准内容（确认通过时返回）
      - git_repo_created: bool，Git 仓库是否创建成功
      - git_repo_url: str，Git 仓库 URL
    """
    success: bool = Field(default=False, description="是否成功")
    message: str = Field(default="", description="确认消息")
    spec_doc: str = Field(default="", description="spec.md 内容")
    task_doc: str = Field(default="", description="task.md 内容")
    checklist_doc: str = Field(default="", description="checklist.md 内容")
    acceptance_doc: str = Field(default="", description="验收标准内容")
    git_repo_created: bool = Field(default=False, description="Git 仓库是否创建")
    git_repo_url: str = Field(default="", description="Git 仓库 URL")


class DesignRejectRequest(BaseModel):
    """
    架构设计驳回请求（V2.0 需求驳回）
    字段说明：
      - workflow_id: str，工作流 ID
      - reject_reason: str，驳回原因
    """
    workflow_id: str = Field(..., min_length=1, description="工作流 ID")
    reject_reason: str = Field(..., min_length=1, description="驳回原因")


class DesignRejectResponse(BaseModel):
    """
    架构设计驳回响应
    字段说明：
      - success: bool，是否成功
      - message: str，驳回消息
      - requirement_v2: str，重新迭代后的需求文档 V2.0
      - critique_result: dict，更新后的批判分析结果
    """
    success: bool = Field(default=False, description="是否成功")
    message: str = Field(default="", description="驳回消息")
    requirement_v2: str = Field(default="", description="重新迭代后的需求文档 V2.0")
    critique_result: Optional[Dict[str, Any]] = Field(default=None, description="更新后的批判分析结果")


class FinalizeDesignRequest(BaseModel):
    """
    完成架构设计阶段请求
    字段说明：
      - workflow_id: str，工作流 ID
    """
    workflow_id: str = Field(..., min_length=1, description="工作流 ID")


@router.post("/start-design-phase", response_model=StartDesignPhaseResponse)
async def start_design_phase(request: Request, body: StartDesignPhaseRequest):
    """
    启动架构设计阶段
    运行步骤：
      1. 获取 WorkflowEngine 实例
      2. 调用 start_designing_phase() 启动架构设计批判迭代工作流
      3. 返回 V2.0 需求文档和批判分析结果供前端渲染模态弹窗
    调用方：前端"跳过不确定项，进入架构设计"按钮
    被调用方：WorkflowEngine.start_designing_phase() →
              ArchitectureWorkflowService.start_designing_phase()
    参数：
      - body: StartDesignPhaseRequest，含 workflow_id
    返回值：StartDesignPhaseResponse，含 V2.0 需求文档和批判分析结果
    """
    logger.info(f"收到架构设计阶段启动请求: workflow_id={body.workflow_id[:8]}...")
    try:
        workflow_engine = request.app.state.workflow_engine
        result = await workflow_engine.start_designing_phase(body.workflow_id)

        if not result.get("success"):
            return StartDesignPhaseResponse(
                success=False,
                error_message=result.get("error", "启动架构设计阶段失败"),
            )

        return StartDesignPhaseResponse(
            success=True,
            requirement_v2=result.get("requirement_v2", ""),
            critique_result=result.get("critique_result"),
            phase_complete=result.get("phase_complete", False),
        )
    except Exception as e:
        logger.error(f"启动架构设计阶段失败: {e}", exc_info=True)
        return StartDesignPhaseResponse(
            success=False,
            error_message=f"启动架构设计阶段失败: {str(e)}",
        )


@router.post("/confirm-design", response_model=DesignConfirmResponse)
async def confirm_design_phase(request: Request, body: DesignConfirmRequest):
    """
    确认架构设计（V2.0 需求确认）
    运行步骤：
      1. 若 confirmed=True：
         a. 调用 WorkflowEngine.finalize_designing_phase() 生成最终文档
         b. 创建 Git 仓库并提交初始文档
         c. 调用 WorkflowEngine.confirm_stage("designing") 完成阶段确认
         d. 推进到下一阶段（prompting）
      2. 若 confirmed=False：返回提示继续修改
    调用方：前端架构设计模态弹窗确认按钮
    被调用方：WorkflowEngine.finalize_designing_phase() + confirm_stage()
    参数：
      - body: DesignConfirmRequest，含 workflow_id 和 confirmed
    返回值：DesignConfirmResponse，含四文档和 Git 信息
    """
    logger.info(
        f"收到架构设计确认请求: workflow_id={body.workflow_id[:8]}..., "
        f"confirmed={body.confirmed}"
    )
    try:
        workflow_engine = request.app.state.workflow_engine

        if body.confirmed:
            # 步骤 1：生成最终架构文档 + 创建 Git 仓库
            finalize_result = await workflow_engine.finalize_designing_phase(
                body.workflow_id
            )

            # 步骤 2：确认 designing 阶段
            confirm_result = await workflow_engine.confirm_stage(
                body.workflow_id, "designing"
            )

            return DesignConfirmResponse(
                success=True,
                message=f"架构设计阶段已完成确认。{confirm_result.get('message', '')}",
                spec_doc=finalize_result.get("spec_doc", ""),
                task_doc=finalize_result.get("task_doc", ""),
                checklist_doc=finalize_result.get("checklist_doc", ""),
                acceptance_doc=finalize_result.get("acceptance_doc", ""),
                git_repo_created=finalize_result.get("git_repo_created", False),
                git_repo_url=finalize_result.get("git_repo_url", ""),
            )
        else:
            return DesignConfirmResponse(
                success=True,
                message="请继续修改架构设计方案",
            )
    except Exception as e:
        logger.error(f"架构设计确认失败: {e}", exc_info=True)
        return DesignConfirmResponse(
            success=False,
            message=f"架构设计确认失败: {str(e)}",
        )


@router.post("/reject-design", response_model=DesignRejectResponse)
async def reject_design_phase(request: Request, body: DesignRejectRequest):
    """
    驳回架构设计（V2.0 需求驳回，触发重新迭代）
    运行步骤：
      1. 调用 WorkflowEngine.reject_stage() 记录驳回
      2. 调用 WorkflowEngine.run_critique_iteration() 重新执行批判迭代
      3. 返回重新迭代后的 V2.0 需求文档和批判结果
    调用方：前端架构设计模态弹窗"返回修改"按钮
    被调用方：WorkflowEngine.reject_stage() + run_critique_iteration()
    参数：
      - body: DesignRejectRequest，含 workflow_id 和 reject_reason
    返回值：DesignRejectResponse，含更新后的 V2.0 需求文档和批判结果
    """
    logger.info(
        f"收到架构设计驳回请求: workflow_id={body.workflow_id[:8]}..., "
        f"reason={body.reject_reason[:100]}"
    )
    try:
        workflow_engine = request.app.state.workflow_engine

        # 步骤 1：记录驳回
        reject_result = await workflow_engine.reject_stage(
            body.workflow_id, "designing", body.reject_reason
        )

        # 步骤 2：重新执行批判迭代
        iterate_result = await workflow_engine.run_critique_iteration(
            body.workflow_id
        )

        return DesignRejectResponse(
            success=True,
            message=(
                f"架构设计方案已驳回（第 {reject_result.get('rejection_count', 0)} 次），"
                f"已重新执行批判迭代。驳回原因: {body.reject_reason[:200]}"
            ),
            requirement_v2=iterate_result.get("requirement_v2", ""),
            critique_result=iterate_result.get("critique_result"),
        )
    except Exception as e:
        logger.error(f"架构设计驳回失败: {e}", exc_info=True)
        return DesignRejectResponse(
            success=False,
            message=f"架构设计驳回失败: {str(e)}",
        )
