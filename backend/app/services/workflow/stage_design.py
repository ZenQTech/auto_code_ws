# ============================================================
# 架构设计阶段 (designing) - 真实实现
# ============================================================
# 核心作用：从 workflow_engine.py 迁移 start_designing_phase /
#          run_critique_iteration / finalize_designing_phase /
#          _serialize_designing_phase 等架构设计阶段核心方法。
#          通过 Mixin 多继承注入到 WorkflowEngine，行为完全等价。
# 拆分日期：2026-07-27
# 来源方法（已迁移）:
#   - start_designing_phase       (原 workflow_engine.py 第 3130 行)
#   - run_critique_iteration      (原 workflow_engine.py 第 3182 行)
#   - finalize_designing_phase    (原 workflow_engine.py 第 3226 行)
#   - _serialize_designing_result (原 workflow_engine.py 第 3283 行)
# 模块版本：v6.2.0 - C1 重构第三阶段（方法真实迁移）
# 修改记录：
#   - 2026-07-27 | v6.2.0 | 从 workflow_engine.py 真实迁移 4 个方法
# ============================================================

import logging
from datetime import datetime, timezone
from typing import Dict, Any

logger = logging.getLogger(__name__)


class DesignStageMixin:
    """
    架构设计阶段 Mixin（v6.2.0 真实实现）

    阶段职责：
      1. 调用总架构师生成架构文档
      2. 调用批判反思智能体进行架构批判
      3. 迭代优化架构（最多 N 轮）
      4. 等待用户确认架构
      5. 创建 Git 仓库
      6. 推进到 prompting 阶段

    状态机：
      clarifying → designing → (critique loop) → prompting
    """

    async def start_designing_phase(
        self, workflow_id: str
    ) -> Dict[str, Any]:
        """
        启动架构设计阶段
        作用：当工作流推进到 designing 阶段时，启动完整的架构设计批判迭代工作流
        调用方：advance_stage（推进到 designing 时自动调用）、API 层
        被调用方：ArchitectureWorkflowService
        运行步骤：
          1. 加载工作流，获取已确认的需求文档
          2. 调用 ArchitectureWorkflowService.start_designing_phase()
          3. 将中间结果（V2.0 需求文档、批判结果）持久化到 workflow
          4. 返回结果供前端渲染模态弹窗
        参数：
          - workflow_id: 工作流 ID
        返回值：Dict，包含 V2.0 需求文档、批判结果、缺陷清单
        """
        if not self.architecture_workflow_service:
            return {
                "success": False,
                "error": "ArchitectureWorkflowService 未初始化，无法启动架构设计阶段",
            }

        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                return {"success": False, "error": f"工作流不存在: {workflow_id}"}

            requirement_doc = workflow.requirement_doc or ""
            if not requirement_doc.strip():
                return {
                    "success": False,
                    "error": "需求文档为空，请先完成需求澄清阶段",
                }

        # 调用架构设计工作流编排服务
        result = await self.architecture_workflow_service.start_designing_phase(
            workflow_id, requirement_doc
        )

        # 持久化 V2.0 需求文档到 workflow
        if result.requirement_v2:
            async with self.session_factory() as db:
                wf = await self._get_workflow(db, workflow_id)
                if wf:
                    wf.requirement_doc_v2 = result.requirement_v2
                    wf.updated_at = datetime.now(timezone.utc)
                    await db.commit()

        # 序列化返回结果
        return self._serialize_designing_result(result)

    async def run_critique_iteration(
        self, workflow_id: str
    ) -> Dict[str, Any]:
        """
        执行一轮架构批判迭代（用户驳回后重新执行）
        作用：当用户驳回 V2.0 需求文档时，重新执行批判分析 + 需求迭代
        调用方：API 层（用户驳回后）
        参数：
          - workflow_id: 工作流 ID
        返回值：Dict，更新后的 V2.0 需求文档和批判结果
        """
        if not self.architecture_workflow_service:
            return {
                "success": False,
                "error": "ArchitectureWorkflowService 未初始化",
            }

        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                return {"success": False, "error": f"工作流不存在: {workflow_id}"}

            # 使用最新的需求文档（优先使用 V2.0，回退到 V1.0）
            requirement_doc = (
                workflow.requirement_doc_v2
                or workflow.requirement_doc
                or ""
            )

        result = await self.architecture_workflow_service.run_critique_iteration(
            workflow_id, requirement_doc
        )

        # 持久化更新后的 V2.0
        if result.requirement_v2:
            async with self.session_factory() as db:
                wf = await self._get_workflow(db, workflow_id)
                if wf:
                    wf.requirement_doc_v2 = result.requirement_v2
                    wf.updated_at = datetime.now(timezone.utc)
                    await db.commit()

        return self._serialize_designing_result(result)

    async def finalize_designing_phase(
        self, workflow_id: str
    ) -> Dict[str, Any]:
        """
        完成架构设计阶段：生成文档 + 创建 Git 仓库
        作用：用户确认 V2.0 需求后，生成最终架构文档并创建 Git 仓库
        调用方：API 层（用户确认 V2.0 后）
        参数：
          - workflow_id: 工作流 ID
        返回值：Dict，含四文档内容和 Git 仓库信息
        """
        if not self.architecture_workflow_service:
            return {
                "success": False,
                "error": "ArchitectureWorkflowService 未初始化",
            }

        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                return {"success": False, "error": f"工作流不存在: {workflow_id}"}

            requirement_doc = (
                workflow.requirement_doc_v2
                or workflow.requirement_doc
                or ""
            )

        result = await self.architecture_workflow_service.finalize_designing_phase(
            workflow_id, requirement_doc
        )

        # 持久化所有文档到 workflow
        async with self.session_factory() as db:
            wf = await self._get_workflow(db, workflow_id)
            if wf:
                wf.spec_doc = result.spec_doc or ""
                wf.task_doc = result.task_doc or ""
                wf.checklist_doc = result.checklist_doc or ""
                wf.acceptance_doc = result.acceptance_doc or ""
                wf.critique_passed = True
                wf.updated_at = datetime.now(timezone.utc)
                await db.commit()
                logger.info(
                    f"架构设计阶段文档已持久化: workflow_id={workflow_id[:8]}..."
                )

        return {
            "success": True,
            "spec_doc": result.spec_doc,
            "task_doc": result.task_doc,
            "checklist_doc": result.checklist_doc,
            "acceptance_doc": result.acceptance_doc,
            "git_repo_created": result.git_repo_created,
            "git_repo_url": result.git_repo_url,
        }

    def _serialize_designing_result(
        self, result
    ) -> Dict[str, Any]:
        """
        序列化架构设计阶段结果为前端可用的 JSON 格式
        参数：
          - result: ArchitecturePhaseResult 对象
        返回值：Dict，JSON 可序列化的结果
        """
        from backend.app.services.architecture_workflow_service import (
            ArchitecturePhaseResult,
        )

        critique_data = None
        if result.critique_result:
            critique_data = {
                "passed": result.critique_result.passed,
                "overall_score": result.critique_result.overall_score,
                "summary": result.critique_result.summary,
                "dimension_scores": result.critique_result.dimension_scores,
                "defect_list": [
                    {
                        "defect_id": d.defect_id,
                        "severity": d.severity,
                        "dimension": d.dimension,
                        "location": d.location,
                        "description": d.description,
                        "impact_scope": d.impact_scope,
                        "repair_plan": d.repair_plan,
                    }
                    for d in result.critique_result.defect_list
                ],
            }

        return {
            "success": True,
            "requirement_v2": result.requirement_v2,
            "critique_result": critique_data,
            "phase_complete": result.phase_complete,
        }


__all__ = ["DesignStageMixin"]
