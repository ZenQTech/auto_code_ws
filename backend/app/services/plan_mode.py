"""
# ============================================================
# Plan 模式服务 - 用户确认式任务计划
# ============================================================
# 核心作用：在工作流 prompting 阶段之前，提供 AI 生成 + 用户确认的任务计划
#           （Plan Mode），确保开发方向符合用户预期。
#           与 task_planner.py 区别：
#             - task_planner: 任务自动分解为可执行子任务（无用户确认）
#             - plan_mode:    生成结构化 Plan → 用户确认 → 进入执行
# 运行流程：
#   1. 接收 workflow_id + 阶段输出（spec/architecture）
#   2. 调用 LLM 生成结构化 Plan（含任务列表、风险、依赖）
#   3. 持久化 Plan 到 workflow.error_message (__PLAN__ 标记)
#   4. 用户可查看/编辑/确认 Plan
#   5. 用户确认后才推进到 executing 阶段
# 输入参数：
#   - workflow_id: 工作流 ID
#   - spec_doc: spec.md 内容（可选，用于上下文）
#   - architecture_doc: 架构文档内容（可选）
# 输出结果：PlanDocument 对象
# 修改记录：
#   - 2026-07-27 | v1.0.0 | P0-4 Plan 模式后端实现
#     1) 新增 PlanDocument / PlanStage / PlanTask / PlanRisk dataclass
#     2) 新增 PlanModeService.generate_plan / confirm_plan / modify_plan 方法
#     3) 与 task_planner 复用相同的 CLIExecutor
#     4) Plan 持久化到 workflow.error_message 的 __PLAN__ 标记段
# ============================================================
"""

import json
import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Literal

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models import Workflow, WorkflowStatus

logger = logging.getLogger(__name__)


# ============================================================
# Plan 数据模型
# ============================================================

@dataclass
class PlanRisk:
    """
    Plan 风险点
    字段说明：
      - risk_id: 风险唯一 ID
      - description: 风险描述
      - severity: 严重等级 (low/medium/high/extreme)
      - mitigation: 缓解措施
    """
    risk_id: str = ""
    description: str = ""
    severity: Literal["low", "medium", "high", "extreme"] = "medium"
    mitigation: str = ""


@dataclass
class PlanTask:
    """
    Plan 单个任务
    字段说明：
      - task_id: 任务唯一 ID
      - title: 任务标题
      - description: 任务描述
      - stage: 所属阶段 (analysis/planning/coding/testing/reviewing)
      - estimated_minutes: 预估耗时（分钟）
      - risk_level: 风险等级
      - files_involved: 涉及的文件列表
      - dependencies: 依赖的其他 task_id
      - acceptance_criteria: 验收标准
    """
    task_id: str = ""
    title: str = ""
    description: str = ""
    stage: str = "coding"
    estimated_minutes: int = 30
    risk_level: Literal["low", "medium", "high", "extreme"] = "medium"
    files_involved: List[str] = field(default_factory=list)
    dependencies: List[str] = field(default_factory=list)
    acceptance_criteria: str = ""


@dataclass
class PlanStage:
    """
    Plan 单个阶段
    字段说明：
      - stage: 阶段名
      - tasks: 该阶段的任务列表
      - risks: 该阶段的风险列表
      - alternatives: 替代方案
    """
    stage: str = "coding"
    tasks: List[PlanTask] = field(default_factory=list)
    risks: List[PlanRisk] = field(default_factory=list)
    alternatives: List[str] = field(default_factory=list)


@dataclass
class PlanDocument:
    """
    完整 Plan 文档
    字段说明：
      - plan_id: Plan 唯一 ID
      - workflow_id: 关联工作流 ID
      - objective: 总体目标
      - stages: 阶段列表（含任务、风险、替代方案）
      - generated_at: 生成时间
      - status: 状态 (pending/confirmed/modified/rejected)
      - user_modifications: 用户修改说明
      - total_estimated_minutes: 总预估时长
    """
    plan_id: str = ""
    workflow_id: str = ""
    objective: str = ""
    stages: List[PlanStage] = field(default_factory=list)
    generated_at: str = ""
    status: Literal["pending", "confirmed", "modified", "rejected"] = "pending"
    user_modifications: str = ""
    total_estimated_minutes: int = 0

    def to_dict(self) -> Dict[str, Any]:
        """序列化为 dict"""
        return {
            "plan_id": self.plan_id,
            "workflow_id": self.workflow_id,
            "objective": self.objective,
            "stages": [
                {
                    "stage": s.stage,
                    "tasks": [
                        {
                            "task_id": t.task_id,
                            "title": t.title,
                            "description": t.description,
                            "stage": t.stage,
                            "estimated_minutes": t.estimated_minutes,
                            "risk_level": t.risk_level,
                            "files_involved": t.files_involved,
                            "dependencies": t.dependencies,
                            "acceptance_criteria": t.acceptance_criteria,
                        }
                        for t in s.tasks
                    ],
                    "risks": [
                        {
                            "risk_id": r.risk_id,
                            "description": r.description,
                            "severity": r.severity,
                            "mitigation": r.mitigation,
                        }
                        for r in s.risks
                    ],
                    "alternatives": s.alternatives,
                }
                for s in self.stages
            ],
            "generated_at": self.generated_at,
            "status": self.status,
            "user_modifications": self.user_modifications,
            "total_estimated_minutes": self.total_estimated_minutes,
        }

    def to_json(self) -> str:
        """序列化为 JSON 字符串"""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PlanDocument":
        """从 dict 反序列化"""
        stages = []
        for s in data.get("stages", []):
            tasks = [PlanTask(**t) for t in s.get("tasks", [])]
            risks = [PlanRisk(**r) for r in s.get("risks", [])]
            stages.append(PlanStage(
                stage=s.get("stage", "coding"),
                tasks=tasks,
                risks=risks,
                alternatives=s.get("alternatives", []),
            ))
        return cls(
            plan_id=data.get("plan_id", ""),
            workflow_id=data.get("workflow_id", ""),
            objective=data.get("objective", ""),
            stages=stages,
            generated_at=data.get("generated_at", ""),
            status=data.get("status", "pending"),
            user_modifications=data.get("user_modifications", ""),
            total_estimated_minutes=data.get("total_estimated_minutes", 0),
        )

    @classmethod
    def from_json(cls, json_str: str) -> "PlanDocument":
        """从 JSON 字符串反序列化"""
        if not json_str or not json_str.strip():
            return cls()
        try:
            return cls.from_dict(json.loads(json_str))
        except (json.JSONDecodeError, TypeError):
            return cls()


# ============================================================
# Plan Mode 服务
# ============================================================

class PlanModeService:
    """
    Plan 模式服务（P0-4 核心实现）
    作用：生成 AI Plan → 用户确认 → 推进到下一阶段
    调用方：API 层（plan.py）
    被调用方：CLIExecutor (用于 LLM 调用)
    """

    # Plan 持久化标记
    PLAN_MARKER_PREFIX = "__PLAN__"
    PLAN_MARKER_SUFFIX = "__/PLAN__"

    def __init__(self, session_factory, executor=None):
        """
        初始化 Plan 模式服务
        参数：
          - session_factory: 异步数据库会话工厂
          - executor: CLIExecutor 实例（可选），用于 LLM 调用
        """
        self.session_factory = session_factory
        self.executor = executor

    async def generate_plan(
        self,
        workflow_id: str,
        objective: str = "",
        spec_doc: str = "",
        architecture_doc: str = ""
    ) -> PlanDocument:
        """
        生成 Plan 文档
        运行步骤：
          1. 加载工作流（如不存在则 ValueError）
          2. 构造 LLM Prompt
          3. 调用 LLM 生成结构化 Plan
          4. 解析 LLM 输出为 PlanDocument
          5. 持久化到 workflow.error_message 的 __PLAN__ 标记段
          6. 返回 PlanDocument
        参数：
          - workflow_id: 工作流 ID
          - objective: 目标描述（从 spec 提取）
          - spec_doc: spec.md 内容（可选）
          - architecture_doc: 架构文档内容（可选）
        返回值：PlanDocument 对象
        异常：ValueError 当工作流不存在时
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                raise ValueError(f"工作流不存在: {workflow_id}")

            # 构造 LLM Prompt
            prompt = self._build_plan_prompt(objective, spec_doc, architecture_doc)

            # 调用 LLM 生成 Plan
            plan = await self._call_llm_for_plan(workflow_id, prompt, objective)

            # 持久化 Plan
            await self._persist_plan(db, workflow, plan)

            logger.info(
                f"Plan 已生成: workflow={workflow_id[:8]}..., "
                f"plan_id={plan.plan_id[:8]}..., "
                f"stages={len(plan.stages)}, "
                f"tasks={sum(len(s.tasks) for s in plan.stages)}"
            )

            return plan

    async def get_plan(self, workflow_id: str) -> Optional[PlanDocument]:
        """
        获取当前工作流的 Plan
        从 workflow.error_message 的 __PLAN__ 标记段解析
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                return None
            plan_json = self._extract_plan_json(workflow.error_message or "")
            if not plan_json:
                return None
            return PlanDocument.from_json(plan_json)

    async def confirm_plan(
        self,
        workflow_id: str,
        plan_id: str,
        user_modifications: str = ""
    ) -> PlanDocument:
        """
        确认 Plan
        1. 加载工作流
        2. 加载当前 Plan
        3. 校验 plan_id 匹配
        4. 设置 status=confirmed
        5. 持久化
        6. 设置 workflow 的 plan_confirmed=True
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                raise ValueError(f"工作流不存在: {workflow_id}")

            plan = await self.get_plan(workflow_id)
            if plan is None:
                raise ValueError(f"工作流 {workflow_id} 没有 Plan")

            if plan.plan_id != plan_id:
                raise ValueError(
                    f"Plan ID 不匹配: 传入 {plan_id}, 实际 {plan.plan_id}"
                )

            plan.status = "confirmed"
            plan.user_modifications = user_modifications

            await self._persist_plan(db, workflow, plan)

            # 标记 plan_confirmed
            await db.execute(
                text(
                    "UPDATE workflows SET plan_confirmed = 1 "
                    "WHERE id = :wid"
                ),
                {"wid": workflow_id},
            )
            await db.commit()

            logger.info(f"Plan 已确认: workflow={workflow_id[:8]}..., plan_id={plan_id[:8]}...")
            return plan

    async def modify_plan(
        self,
        workflow_id: str,
        modified_plan: PlanDocument,
        user_modifications: str = ""
    ) -> PlanDocument:
        """
        修改 Plan
        1. 加载工作流
        2. 替换为用户修改的 Plan
        3. 标记 status=modified
        4. 持久化
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                raise ValueError(f"工作流不存在: {workflow_id}")

            modified_plan.status = "modified"
            modified_plan.user_modifications = user_modifications

            await self._persist_plan(db, workflow, modified_plan)

            logger.info(
                f"Plan 已修改: workflow={workflow_id[:8]}..., "
                f"plan_id={modified_plan.plan_id[:8]}..."
            )
            return modified_plan

    async def reject_plan(self, workflow_id: str, reason: str = "") -> bool:
        """
        拒绝 Plan（触发重新生成）
        """
        async with self.session_factory() as db:
            workflow = await self._get_workflow(db, workflow_id)
            if workflow is None:
                raise ValueError(f"工作流不存在: {workflow_id}")

            plan = await self.get_plan(workflow_id)
            if plan is None:
                return False

            plan.status = "rejected"
            plan.user_modifications = reason

            await self._persist_plan(db, workflow, plan)
            logger.info(f"Plan 已拒绝: workflow={workflow_id[:8]}..., 原因={reason[:50]}")
            return True

    # ============================================================
    # 私有方法
    # ============================================================

    async def _get_workflow(self, db: AsyncSession, workflow_id: str) -> Optional[Workflow]:
        """加载工作流"""
        result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
        return result.scalar_one_or_none()

    def _build_plan_prompt(
        self, objective: str, spec_doc: str, architecture_doc: str
    ) -> str:
        """
        构造 Plan 生成 Prompt
        要求 LLM 输出结构化 JSON
        """
        parts = [
            "# 任务：生成结构化 Plan 文档\n",
            "\n## 项目目标\n",
            objective or "（无明确目标）",
        ]

        if spec_doc:
            parts.extend([
                "\n\n## spec.md 内容\n",
                spec_doc[:2000],  # 限制长度
            ])

        if architecture_doc:
            parts.extend([
                "\n\n## 架构文档\n",
                architecture_doc[:2000],
            ])

        parts.extend([
            "\n\n## 输出要求\n",
            "请输出 JSON 格式的 Plan 文档，包含以下字段：\n",
            "```\n",
            json.dumps({
                "objective": "项目目标",
                "stages": [
                    {
                        "stage": "阶段名（analysis/planning/coding/testing/reviewing）",
                        "tasks": [
                            {
                                "task_id": "task_1",
                                "title": "任务标题",
                                "description": "任务描述",
                                "stage": "coding",
                                "estimated_minutes": 30,
                                "risk_level": "low/medium/high/extreme",
                                "files_involved": ["file1.py", "file2.py"],
                                "dependencies": [],
                                "acceptance_criteria": "验收标准"
                            }
                        ],
                        "risks": [
                            {
                                "risk_id": "risk_1",
                                "description": "风险描述",
                                "severity": "low/medium/high/extreme",
                                "mitigation": "缓解措施"
                            }
                        ],
                        "alternatives": ["替代方案 1"]
                    }
                ]
            }, ensure_ascii=False, indent=2),
            "\n```\n",
            "\n请只输出 JSON，不要包含其他说明文字。\n"
        ])

        return "".join(parts)

    async def _call_llm_for_plan(
        self, workflow_id: str, prompt: str, objective: str
    ) -> PlanDocument:
        """
        调用 LLM 生成 Plan
        如果 executor 可用，使用真实 LLM；否则返回默认 Plan
        """
        if self.executor is None:
            logger.warning(
                f"PlanModeService.executor 为空，返回默认 Plan: workflow={workflow_id[:8]}..."
            )
            return self._build_default_plan(workflow_id, objective)

        try:
            result = await self.executor.execute(
                prompt=prompt,
                system="你是项目规划专家，擅长将复杂项目分解为结构化任务计划。",
                max_tokens=4096,
            )
            plan_dict = self._parse_llm_output(result.output if hasattr(result, "output") else str(result))
            if plan_dict is None:
                logger.warning("LLM 输出无法解析为 Plan JSON，使用默认 Plan")
                return self._build_default_plan(workflow_id, objective)
            plan = PlanDocument.from_dict(plan_dict)
            plan.workflow_id = workflow_id
            plan.plan_id = str(uuid.uuid4())
            plan.generated_at = datetime.now(timezone.utc).isoformat()
            plan.total_estimated_minutes = sum(
                t.estimated_minutes
                for s in plan.stages
                for t in s.tasks
            )
            return plan
        except Exception as e:
            logger.error(f"LLM Plan 生成失败: {e}", exc_info=True)
            return self._build_default_plan(workflow_id, objective)

    def _parse_llm_output(self, output: str) -> Optional[Dict[str, Any]]:
        """解析 LLM 输出为 JSON"""
        if not output:
            return None
        # 尝试提取 ```json ... ``` 块
        json_match = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", output)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass
        # 尝试直接解析
        try:
            return json.loads(output)
        except json.JSONDecodeError:
            return None

    def _build_default_plan(self, workflow_id: str, objective: str) -> PlanDocument:
        """生成默认 Plan（当 LLM 不可用时）"""
        return PlanDocument(
            plan_id=str(uuid.uuid4()),
            workflow_id=workflow_id,
            objective=objective or "执行用户需求",
            stages=[
                PlanStage(
                    stage="analysis",
                    tasks=[PlanTask(
                        task_id="task_analyze_1",
                        title="需求分析",
                        description="分析用户需求，提取关键功能点和验收标准",
                        stage="analysis",
                        estimated_minutes=15,
                        risk_level="low",
                        acceptance_criteria="输出结构化需求文档",
                    )],
                    risks=[PlanRisk(
                        risk_id="risk_analyze_1",
                        description="需求不明确",
                        severity="medium",
                        mitigation="与用户多轮澄清",
                    )],
                ),
                PlanStage(
                    stage="coding",
                    tasks=[PlanTask(
                        task_id="task_code_1",
                        title="核心代码实现",
                        description="根据需求实现核心功能模块",
                        stage="coding",
                        estimated_minutes=120,
                        risk_level="high",
                        files_involved=["src/main.py"],
                        acceptance_criteria="代码可运行，关键功能测试通过",
                    )],
                    risks=[PlanRisk(
                        risk_id="risk_code_1",
                        description="代码生成可能不符合预期",
                        severity="high",
                        mitigation="迭代修复 + DiffView 确认",
                    )],
                ),
                PlanStage(
                    stage="testing",
                    tasks=[PlanTask(
                        task_id="task_test_1",
                        title="功能测试",
                        description="执行单元测试和集成测试",
                        stage="testing",
                        estimated_minutes=30,
                        risk_level="medium",
                        acceptance_criteria="所有测试通过",
                    )],
                ),
            ],
            generated_at=datetime.now(timezone.utc).isoformat(),
            status="pending",
            total_estimated_minutes=165,
        )

    async def _persist_plan(
        self, db: AsyncSession, workflow: Workflow, plan: PlanDocument
    ):
        """将 Plan 持久化到 workflow.error_message 的 __PLAN__ 标记段"""
        plan_json = plan.to_json()
        plan_segment = f"{self.PLAN_MARKER_PREFIX}\n{plan_json}\n{self.PLAN_MARKER_SUFFIX}"

        existing = workflow.error_message or ""
        # 替换已有的 __PLAN__ 段
        if self.PLAN_MARKER_PREFIX in existing:
            new_error = re.sub(
                rf"{re.escape(self.PLAN_MARKER_PREFIX)}[\s\S]*?{re.escape(self.PLAN_MARKER_SUFFIX)}",
                plan_segment,
                existing,
            )
        else:
            new_error = (existing + "\n" + plan_segment) if existing else plan_segment

        await db.execute(
            text("UPDATE workflows SET error_message = :em WHERE id = :wid"),
            {"em": new_error, "wid": workflow.id},
        )
        await db.commit()

    def _extract_plan_json(self, error_message: str) -> Optional[str]:
        """从 error_message 提取 Plan JSON"""
        match = re.search(
            rf"{re.escape(self.PLAN_MARKER_PREFIX)}\s*([\s\S]*?)\s*{re.escape(self.PLAN_MARKER_SUFFIX)}",
            error_message,
        )
        if match:
            return match.group(1)
        return None


# ============================================================
# Re-export
# ============================================================

__all__ = [
    "PlanTask",
    "PlanRisk",
    "PlanStage",
    "PlanDocument",
    "PlanModeService",
]
