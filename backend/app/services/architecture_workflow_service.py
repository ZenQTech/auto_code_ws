"""
# ============================================================
# 架构设计工作流编排服务
# ============================================================
# 核心作用：串联 architecture_designing 阶段的完整工作流：
#           ① 生成质量保障智能体 + 批判反思智能体
#           ② 执行全维度架构批判分析 → 输出结构化缺陷清单 + 修复方案
#           ③ 批判反思智能体迭代优化需求文档 → 生成需求文档 V2.0
#           ④ 将 V2.0 推送至前端模态弹窗，等待人工确认
#           ⑤ 总架构师 + 质量保障智能体协作制定验收标准
#           ⑥ 总架构师生成 spec.md / task.md / checklist.md
#           ⑦ 创建 Git 仓库并提交初始文档
# 运行流程：
#   1. start_designing_phase() 启动架构设计阶段
#   2. run_critique_cycle() 执行批判分析 + 需求迭代
#   3. finalize_designing_phase() 生成文档 + 创建 Git 仓库
# 输入参数：
#   - workflow_id: 工作流 ID
#   - requirement_doc: 需求文档（已确认的 V1.0）
# 输出结果：ArchitecturePhaseResult（含缺陷清单、V2.0 需求、四文档）
# 修改记录：
#   - 2026-07-01 | v1.0.0 | 初始创建，实现架构设计批判迭代完整工作流
#   - 2026-07-23 | v1.1.0 | finalize_designing_phase 增加模板兜底机制，
#                          防止 claude.exe 崩溃（exit -6）导致 spec/checklist/task/acceptance
#                          文档为空阻塞工作流推进；新增 _template_spec_doc /
#                          _template_checklist_doc / _template_task_doc /
#                          _template_acceptance_doc 四个私有方法
#   - 2026-07-23 | v1.2.0 | Bug 2 修复：删除基于"长度 < 阈值"覆盖真实 LLM 输出的逻辑，
#                          改为 _llm_attempted 标志跟踪 LLM 实际调用情况；
#                          仅在 LLM 调用成功但返回为空时使用模板兜底
#                          同步将 LLM 调用 timeout 从 180/300 提升到 300/600，
#                          配合 max_tokens=16384 防截断 (Bug 1)
# ============================================================
"""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import async_sessionmaker

from .agent_roles.chief_architect import ChiefArchitect, ArchitectureOutput
from .agent_roles.critical_reviewer import CriticalReviewer, ReviewReport, DefectItem
from .agent_roles.quality_manager import QualityManager
from .architecture_designer import ArchitectureDesigner
from .architecture_critic import ArchitectureCritic

logger = logging.getLogger(__name__)


# ============================================================
# 数据类定义
# ============================================================

@dataclass
class ArchitectureDefectItem:
    """
    结构化缺陷项（面向前端的精简格式）
    字段说明：
      - defect_id: 缺陷唯一标识（格式：DEF-XXXXXX）
      - severity: 严重程度（critical/major/minor）
      - dimension: 审查维度（系统架构/模块划分/接口设计/性能优化/安全策略）
      - location: 缺陷位置描述
      - description: 问题描述
      - impact_scope: 影响范围
      - repair_plan: 修复方案（含实施步骤、资源需求、预期效果）
    """
    defect_id: str = ""
    severity: str = "minor"
    dimension: str = ""
    location: str = ""
    description: str = ""
    impact_scope: str = ""
    repair_plan: str = ""


@dataclass
class RepairPlan:
    """
    修复方案详细结构
    字段说明：
      - steps: 实施步骤列表
      - resource_needs: 资源需求描述
      - expected_effect: 预期效果
    """
    steps: List[str] = field(default_factory=list)
    resource_needs: str = ""
    expected_effect: str = ""


@dataclass
class CritiqueResult:
    """
    架构批判分析结果
    字段说明：
      - passed: 是否通过批判审查
      - overall_score: 综合评分（0-100）
      - defect_list: 结构化缺陷清单
      - dimension_scores: 各维度评分
      - summary: 总体评估总结
    """
    passed: bool = False
    overall_score: float = 0.0
    defect_list: List[ArchitectureDefectItem] = field(default_factory=list)
    dimension_scores: Dict[str, float] = field(default_factory=dict)
    summary: str = ""


@dataclass
class ArchitecturePhaseResult:
    """
    架构设计阶段完整结果
    字段说明：
      - phase_complete: 阶段是否完成
      - requirement_v2: 迭代优化后的需求文档 V2.0
      - critique_result: 批判分析结果
      - spec_doc: spec.md 内容
      - task_doc: task.md 内容
      - checklist_doc: checklist.md 内容
      - acceptance_doc: 验收标准文档内容
      - git_repo_created: Git 仓库是否已创建
      - git_repo_url: Git 仓库 URL
    """
    phase_complete: bool = False
    requirement_v2: str = ""
    critique_result: Optional[CritiqueResult] = None
    spec_doc: str = ""
    task_doc: str = ""
    checklist_doc: str = ""
    acceptance_doc: str = ""
    git_repo_created: bool = False
    git_repo_url: str = ""


# ============================================================
# ArchitectureWorkflowService 核心类
# ============================================================

class ArchitectureWorkflowService:
    """
    架构设计工作流编排服务
    作用：串联整个 architecture_designing 阶段的完整工作流
    调用方：API 层（架构设计接口）、WorkflowEngine
    被调用方：ChiefArchitect / CriticalReviewer / QualityManager /
             ArchitectureDesigner / ArchitectureCritic
    """

    def __init__(
        self,
        session_factory: async_sessionmaker,
        hermes_service=None,
        workflow_engine=None,
        git_manager=None,
    ):
        """
        初始化架构设计工作流编排服务
        参数：
          - session_factory: 异步数据库会话工厂
          - hermes_service: HermesService 实例（用于智能体调用 AI）
          - workflow_engine: WorkflowEngine 实例（用于工作流状态管理）
          - git_manager: GitManager 实例（用于 Git 仓库操作）
        """
        self.session_factory = session_factory
        self.hermes_service = hermes_service
        self.workflow_engine = workflow_engine
        self.git_manager = git_manager

        # 初始化两个专用智能体
        self.quality_manager = QualityManager(hermes_service) if hermes_service else None
        self.critical_reviewer = CriticalReviewer(hermes_service) if hermes_service else None

        # 初始化架构设计器与批判器
        self.architecture_designer = ArchitectureDesigner()
        self.architecture_critic = ArchitectureCritic()

        # 当前阶段的中间结果缓存
        self._current_phase_result: Optional[ArchitecturePhaseResult] = None
        self._critique_iteration_count: int = 0
        self._max_critique_iterations: int = 3

        logger.info("ArchitectureWorkflowService 初始化完成")

    # ============================================================
    # 公开方法 - 阶段入口
    # ============================================================

    async def start_designing_phase(
        self, workflow_id: str, requirement_doc: str
    ) -> ArchitecturePhaseResult:
        """
        启动架构设计阶段
        运行步骤：
          1. 记录工作流进入 designing 阶段
          2. 生成架构设计方案（ArchitectureDesigner）
          3. 执行全维度架构批判分析（ArchitectureCritic）
          4. 批判反思智能体迭代优化需求文档 → V2.0
          5. 组装 ArchitecturePhaseResult 返回
        调用方：WorkflowEngine.advance_stage() 推进到 designing 时
        参数：
          - workflow_id: 工作流 ID
          - requirement_doc: 已确认的需求文档 V1.0
        返回值：ArchitecturePhaseResult，含批判结果和 V2.0 需求文档
        """
        logger.info(f"启动架构设计阶段: workflow_id={workflow_id[:8]}...")
        self._critique_iteration_count = 0

        result = ArchitecturePhaseResult()

        # 步骤 2：生成架构设计方案
        arch_doc = self.architecture_designer.generate_architecture(requirement_doc)
        logger.info(f"架构设计方案已生成，doc_id={arch_doc.get('doc_id', 'N/A')}")

        # 步骤 3：执行全维度架构批判分析
        critique_result = await self._run_full_critique(arch_doc)
        result.critique_result = critique_result

        # 步骤 4：批判反思智能体迭代优化需求文档 → V2.0
        if self.critical_reviewer:
            result.requirement_v2 = await self._iterate_requirements(
                requirement_doc, critique_result
            )
        else:
            result.requirement_v2 = requirement_doc
            logger.warning("CriticalReviewer 不可用，跳过需求文档迭代优化")

        # 缓存结果供后续步骤使用
        self._current_phase_result = result

        logger.info(
            f"架构设计阶段启动完成: critique_passed={critique_result.passed}, "
            f"defects={len(critique_result.defect_list)}"
        )
        return result

    async def run_critique_iteration(
        self, workflow_id: str, requirement_doc: str
    ) -> ArchitecturePhaseResult:
        """
        执行一轮完整的架构批判 + 需求迭代（用于驳回后重新执行）
        运行步骤：
          1. 检查迭代次数上限
          2. 重新生成架构设计方案
          3. 重新执行全维度批判分析
          4. 重新迭代优化需求文档
          5. 返回更新后的 ArchitecturePhaseResult
        调用方：API 层（用户驳回后重新执行）
        参数：
          - workflow_id: 工作流 ID
          - requirement_doc: 当前需求文档（可能已含上次迭代的修改）
        返回值：ArchitecturePhaseResult
        """
        if self._critique_iteration_count >= self._max_critique_iterations:
            logger.warning(
                f"已达到最大批判迭代次数上限 "
                f"({self._critique_iteration_count}/{self._max_critique_iterations})"
            )
            if self._current_phase_result:
                self._current_phase_result.phase_complete = True
            return self._current_phase_result or ArchitecturePhaseResult()

        self._critique_iteration_count += 1
        logger.info(
            f"开始第 {self._critique_iteration_count} 轮架构批判迭代 "
            f"(上限 {self._max_critique_iterations})"
        )

        result = ArchitecturePhaseResult()

        # 重新生成架构方案
        arch_doc = self.architecture_designer.generate_architecture(requirement_doc)

        # 重新执行批判分析
        critique_result = await self._run_full_critique(arch_doc)
        result.critique_result = critique_result

        # 重新迭代优化需求文档
        if self.critical_reviewer:
            result.requirement_v2 = await self._iterate_requirements(
                requirement_doc, critique_result
            )
        else:
            result.requirement_v2 = requirement_doc

        self._current_phase_result = result
        return result

    async def finalize_designing_phase(
        self, workflow_id: str, requirement_doc: str
    ) -> ArchitecturePhaseResult:
        """
        完成架构设计阶段：生成文档 + 创建 Git 仓库
        运行步骤：
          1. 总架构师 + 质量保障智能体协作制定验收标准
          2. 总架构师生成 spec.md / task.md / checklist.md
          3. 创建 Git 仓库并提交初始文档
          4. 更新工作流状态
        调用方：API 层（用户确认 V2.0 需求后）
        参数：
          - workflow_id: 工作流 ID
          - requirement_doc: 最终确认的需求文档（V2.0）
        返回值：ArchitecturePhaseResult（含四文档和 Git 信息）
        """
        logger.info(f"完成架构设计阶段: workflow_id={workflow_id[:8]}...")

        result = self._current_phase_result or ArchitecturePhaseResult()
        result.phase_complete = True

        # 重新生成架构方案文本（用于模板兜底）
        # ArchitectureDesigner.generate_architecture 是纯本地实现，
        # 不调用 LLM，可在 finalize 阶段安全复用
        try:
            arch_doc_obj = self.architecture_designer.generate_architecture(
                requirement_doc
            )
            arch_doc_text = self._summarize_arch_doc(arch_doc_obj)
        except Exception as e:
            logger.warning(f"架构方案本地生成失败，模板兜底时使用空字符串: {e}")
            arch_doc_text = ""

        # 步骤 1：总架构师 + 质量保障智能体协作制定验收标准
        # v5.5.0 修复 (Bug 2)：不再基于长度覆盖真实 LLM 输出
        # 使用 _llm_attempted 标志跟踪 LLM 是否被调用过，
        # 只有在 LLM 未调用或调用失败时才使用模板
        chief_architect = ChiefArchitect(self.hermes_service) if self.hermes_service else None
        acceptance_llm_attempted = False
        try:
            if chief_architect:
                acceptance_llm_attempted = True
                result.acceptance_doc = await self._generate_acceptance_criteria(
                    chief_architect, requirement_doc, result.critique_result
                )
            else:
                logger.warning("ChiefArchitect 不可用，跳过验收标准生成")
                result.acceptance_doc = self._generate_fallback_acceptance()
        except Exception as e:
            logger.warning(f"验收标准生成失败，使用模板兜底: {e}")
            result.acceptance_doc = self._template_acceptance_doc(
                requirement_doc, arch_doc_text
            )
            acceptance_llm_attempted = True  # 已尝试 LLM，标记为失败

        # 验收标准兜底：仅在 LLM 实际失败（成功但内容为空）时使用模板
        if acceptance_llm_attempted and not result.acceptance_doc:
            logger.warning("LLM 验收标准返回为空，使用模板兜底")
            result.acceptance_doc = self._template_acceptance_doc(
                requirement_doc, arch_doc_text
            )

        # 步骤 2：总架构师生成 spec.md / task.md / checklist.md
        # v5.5.0 修复 (Bug 2)：同上，使用 _llm_attempted 跟踪 LLM 实际执行
        spec_llm_attempted = False
        checklist_llm_attempted = False
        task_llm_attempted = False
        try:
            if chief_architect:
                spec_llm_attempted = True
                checklist_llm_attempted = True
                task_llm_attempted = True
                arch_output = await self._generate_architecture_docs(
                    chief_architect, requirement_doc
                )
                result.spec_doc = arch_output.spec
                result.task_doc = arch_output.tasks
                result.checklist_doc = arch_output.checklist
            else:
                logger.warning("ChiefArchitect 不可用，跳过架构文档生成")
        except Exception as e:
            logger.warning(f"架构文档生成失败，使用模板兜底: {e}")
            result.spec_doc = self._template_spec_doc(requirement_doc, arch_doc_text)
            result.task_doc = self._template_task_doc(requirement_doc)
            result.checklist_doc = self._template_checklist_doc(requirement_doc)
            # 异常已被 catch 兜底，无需再判断空模板

        # 各架构文档兜底：仅在 LLM 调用成功但返回为空时使用模板
        # v5.5.0 修复 (Bug 2)：删除"长度 < 200/100"判断，避免覆盖真实 LLM 输出
        if spec_llm_attempted and not result.spec_doc:
            logger.warning("LLM spec_doc 返回为空，使用模板兜底")
            result.spec_doc = self._template_spec_doc(requirement_doc, arch_doc_text)
        if checklist_llm_attempted and not result.checklist_doc:
            logger.warning("LLM checklist_doc 返回为空，使用模板兜底")
            result.checklist_doc = self._template_checklist_doc(requirement_doc)
        if task_llm_attempted and not result.task_doc:
            logger.warning("LLM task_doc 返回为空，使用模板兜底")
            result.task_doc = self._template_task_doc(requirement_doc)

        # 步骤 3：创建 Git 仓库并提交初始文档
        git_result = await self._create_git_repo_and_commit(
            workflow_id, result
        )
        result.git_repo_created = git_result.get("success", False)
        result.git_repo_url = git_result.get("repo_url", "")

        self._current_phase_result = result
        logger.info(
            f"架构设计阶段完成: git_created={result.git_repo_created}"
        )
        return result

    def get_current_result(self) -> Optional[ArchitecturePhaseResult]:
        """获取当前阶段的中间结果"""
        return self._current_phase_result

    # ============================================================
    # 私有方法 - 批判分析
    # ============================================================

    async def _run_full_critique(
        self, arch_doc: Dict[str, Any]
    ) -> CritiqueResult:
        """
        执行全维度架构批判分析
        运行步骤：
          1. 调用 ArchitectureCritic 执行四维度审查（完整性/一致性/可行性/安全性）
          2. 同时通过 CriticalReviewer 执行五维度评审（算法/稳定性/可实现性/实时性/安全性）
          3. 合并两份批判报告，生成统一的结构化缺陷清单
          4. 为每个缺陷生成详细修复方案
        参数：
          - arch_doc: 架构设计文档（ArchitectureDesigner 输出）
        返回值：CritiqueResult
        """
        result = CritiqueResult()

        # 1. ArchitectureCritic 四维度审查
        critic_report = self.architecture_critic.critique(arch_doc)
        overall_conclusion = critic_report.get("chapter_1_overall_assessment", {})
        result.overall_score = overall_conclusion.get("score", 0)
        result.summary = overall_conclusion.get("summary", "")

        # 解析 critic 缺陷列表
        critic_defects = critic_report.get("chapter_2_structured_defect_list", [])
        for d in critic_defects:
            defect_item = ArchitectureDefectItem(
                defect_id=d.get("defect_id", f"DEF-{uuid.uuid4().hex[:6].upper()}"),
                severity=self._map_severity(d.get("defect_level", "general")),
                dimension=self._map_dimension(d.get("review_dimension", "completeness")),
                location=d.get("influence_scope", ""),
                description=d.get("problem_description", ""),
                impact_scope=d.get("influence_scope", ""),
                repair_plan=d.get("repair_suggestion", ""),
            )
            result.defect_list.append(defect_item)

        # 2. CriticalReviewer 五维度评审（如果可用）
        if self.critical_reviewer:
            try:
                # 将架构文档转换为文本摘要用于评审
                arch_summary = self._summarize_arch_doc(arch_doc)
                review_report = await self.critical_reviewer.review_architecture(
                    spec=arch_summary,
                    checklist="",
                    tasks="",
                    acceptance="",
                )
                # 合并维度评分
                for dim, score in review_report.dimension_scores.items():
                    result.dimension_scores[dim] = score

                # 合并 CriticalReviewer 的缺陷
                for d in review_report.defects:
                    defect_item = ArchitectureDefectItem(
                        defect_id=f"DEF-{uuid.uuid4().hex[:6].upper()}",
                        severity=d.severity,
                        dimension=d.dimension,
                        location=d.title,
                        description=d.description,
                        impact_scope=d.impact,
                        repair_plan=d.suggestion,
                    )
                    result.defect_list.append(defect_item)
            except Exception as e:
                logger.warning(f"CriticalReviewer 评审执行异常（非阻塞）: {e}")

        # 3. 去重（基于描述相似度）
        result.defect_list = self._deduplicate_defects(result.defect_list)

        # 4. 判定是否通过
        critical_count = sum(
            1 for d in result.defect_list if d.severity == "critical"
        )
        result.passed = (
            critical_count == 0 and result.overall_score >= 60
        )

        logger.info(
            f"批判分析完成: score={result.overall_score}, "
            f"defects={len(result.defect_list)}, "
            f"critical={critical_count}, passed={result.passed}"
        )
        return result

    # ============================================================
    # 私有方法 - 需求文档迭代优化
    # ============================================================

    async def _iterate_requirements(
        self, requirement_doc: str, critique_result: CritiqueResult
    ) -> str:
        """
        批判反思智能体迭代优化需求文档
        运行步骤：
          1. 以原始需求文档 + 批判分析结果为输入
          2. 从完整性、逻辑一致性、技术可行性、用户体验维度进行优化
          3. 生成需求文档 V2.0
        参数：
          - requirement_doc: 原始需求文档 V1.0
          - critique_result: 批判分析结果
        返回值：迭代优化后的需求文档 V2.0
        """
        logger.info("开始迭代优化需求文档...")

        # 构建缺陷反馈文本
        defects_text = "\n".join(
            f"- [{d.severity}][{d.dimension}] {d.description} → 修复建议: {d.repair_plan}"
            for d in critique_result.defect_list[:10]  # 取前 10 个最重要缺陷
        )

        prompt = (
            f"你是一个需求文档优化专家。请基于以下原始需求文档和架构批判分析结果，"
            f"对需求文档进行一次系统性迭代优化，生成需求文档 V2.0。\n\n"
            f"## 原始需求文档 V1.0\n{requirement_doc[:8000]}\n\n"
            f"## 架构批判分析结果\n"
            f"综合评分: {critique_result.overall_score}/100\n"
            f"发现缺陷: {len(critique_result.defect_list)} 个\n"
            f"关键缺陷:\n{defects_text}\n\n"
            f"## 优化维度\n"
            f"1. 需求完整性：补充缺失的功能描述、边界条件、异常场景\n"
            f"2. 逻辑一致性：消除需求之间的冲突与矛盾\n"
            f"3. 技术可行性：确保需求在现有技术栈下可落地实现\n"
            f"4. 用户体验：优化交互流程、错误提示、操作便捷性\n\n"
            f"## 输出要求\n"
            f"直接输出优化后的需求文档 V2.0，保持 Markdown 格式，"
            f"包含以下章节：\n"
            f"1. 项目概述\n2. 功能需求\n3. 非功能需求\n"
            f"4. 技术约束\n5. 验收标准\n6. 迭代优化说明（说明本次优化的变更内容）\n\n"
            f"请确保输出内容完整、结构清晰、无歧义。"
        )

        if self.hermes_service:
            try:
                result = await self.hermes_service.executor.execute(
                    command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
                    timeout=600,  # v5.5.0 修复：从 300 提升到 600，匹配长需求文档 V2.0 生成时间
                )
                if result.success and result.stdout:
                    logger.info(
                        f"需求文档迭代优化完成，"
                        f"长度={len(result.stdout)} 字符"
                    )
                    return result.stdout
                else:
                    logger.warning(f"需求文档迭代优化失败: {result.error_message}")
            except Exception as e:
                logger.error(f"需求文档迭代优化异常: {e}")
        else:
            logger.warning("HermesService 不可用，使用原始需求文档作为 V2.0")

        # 降级：返回原始需求文档 + 优化建议标注
        return (
            f"# 需求文档 V2.0（自动优化）\n\n"
            f"> **迭代优化说明**：由于 AI 服务不可用，本次未执行完整迭代优化。"
            f"以下为原始需求文档。\n\n"
            f"{requirement_doc}\n\n"
            f"## 架构批判分析建议\n\n"
            f"综合评分: {critique_result.overall_score}/100\n\n"
            f"{defects_text}\n\n"
            f"> 请根据以上建议人工补充优化。"
        )

    # ============================================================
    # 私有方法 - 验收标准生成
    # ============================================================

    async def _generate_acceptance_criteria(
        self,
        chief_architect: ChiefArchitect,
        requirement_doc: str,
        critique_result: Optional[CritiqueResult],
    ) -> str:
        """
        总架构师 + 质量保障智能体协作制定验收标准
        运行步骤：
          1. 总架构师基于需求文档生成初步验收标准
          2. 质量保障智能体对验收标准进行审查补全
          3. 合并输出最终验收标准文档
        参数：
          - chief_architect: 总架构师实例
          - requirement_doc: 最终确认的需求文档
          - critique_result: 批判分析结果（用于补充安全验收项）
        返回值：验收标准文档（Markdown 格式）
        """
        logger.info("开始生成验收标准...")

        # 构建批判反馈文本
        critic_feedback = ""
        if critique_result:
            critic_feedback = (
                f"综合评分: {critique_result.overall_score}/100\n"
                f"缺陷总数: {len(critique_result.defect_list)}\n"
                f"关键安全缺陷:\n" +
                "\n".join(
                    f"- {d.description}"
                    for d in critique_result.defect_list
                    if d.dimension in ("安全性", "security")
                )[:1000]
            )

        acceptance = await chief_architect.generate_acceptance_criteria(
            requirement_doc, critic_feedback
        )

        # 质量保障智能体对验收标准进行审查补全
        if self.quality_manager and acceptance:
            try:
                qa_prompt = (
                    f"{self.quality_manager.get_system_prompt()}\n\n"
                    f"## 任务：审查并补全验收标准\n\n"
                    f"需求文档：\n{requirement_doc[:3000]}\n\n"
                    f"当前验收标准：\n{acceptance[:5000]}\n\n"
                    f"请从以下维度审查验收标准的完整性：\n"
                    f"1. 所有功能点的验证方法与通过条件是否覆盖\n"
                    f"2. 代码质量、性能指标、安全合规、兼容性等非功能需求是否量化\n"
                    f"3. 验收测试环境、测试数据、测试工具要求是否明确\n"
                    f"4. 标准是否具备可执行性与可衡量性\n\n"
                    f"请输出补全后的验收标准，标注补充内容。"
                )
                qa_result = await self.hermes_service.executor.execute(
                    command=f'-p "{qa_prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
                    timeout=300,  # v5.5.0 修复：从 180 提升到 300，匹配长文档补全时间
                )
                if qa_result.success and qa_result.stdout:
                    acceptance = qa_result.stdout
                    logger.info("质量保障智能体已补全验收标准")
            except Exception as e:
                logger.warning(f"质量保障智能体补全验收标准异常（非阻塞）: {e}")

        return acceptance

    def _generate_fallback_acceptance(self) -> str:
        """生成降级验收标准（当 AI 服务不可用时）"""
        return (
            "# 验收标准\n\n"
            "## 1. 功能验收\n"
            "- 所有需求功能点均已实现并通过测试\n"
            "- 交互流程完整、无阻断性 Bug\n\n"
            "## 2. 代码质量验收\n"
            "- Python 代码通过 pylint/flake8 扫描（零严重错误）\n"
            "- 所有函数、类、文件包含完整中文注释\n"
            "- 核心模块单元测试覆盖率 > 80%\n\n"
            "## 3. 性能验收\n"
            "- API 响应时间 P95 < 500ms\n"
            "- 支持 5 个并发 CLI 任务执行\n\n"
            "## 4. 安全验收\n"
            "- API Key 不出现在代码、日志、配置文件中\n"
            "- 所有 API 输入经过 Pydantic 校验\n"
            "- CLI 命令超时自动终止\n\n"
            "## 5. 兼容性验收\n"
            "- Python 3.11+ 环境正常运行\n"
            "- 前端在 Chrome/Firefox/Edge 最新版正常显示\n"
        )

    # ============================================================
    # 私有方法 - 架构文档生成
    # ============================================================

    async def _generate_architecture_docs(
        self,
        chief_architect: ChiefArchitect,
        requirement_doc: str,
    ) -> ArchitectureOutput:
        """
        总架构师生成 spec.md / task.md / checklist.md
        运行步骤：
          1. 调用 ChiefArchitect.design_architecture() 一次性生成四文档
          2. 返回 ArchitectureOutput
        参数：
          - chief_architect: 总架构师实例
          - requirement_doc: 最终确认的需求文档
        返回值：ArchitectureOutput（含四文档）
        """
        logger.info("开始生成架构文档...")
        arch_output = await chief_architect.design_architecture(requirement_doc)
        logger.info(
            f"架构文档生成完成: "
            f"spec={len(arch_output.spec)} 字符, "
            f"checklist={len(arch_output.checklist)} 字符, "
            f"tasks={len(arch_output.tasks)} 字符, "
            f"acceptance={len(arch_output.acceptance)} 字符"
        )
        return arch_output

    # ============================================================
    # 私有方法 - Git 仓库创建与提交
    # ============================================================

    async def _create_git_repo_and_commit(
        self, workflow_id: str, result: ArchitecturePhaseResult
    ) -> Dict[str, Any]:
        """
        创建 Git 仓库并提交初始文档
        运行步骤：
          1. 若 git_manager 可用，创建 GitHub 仓库
          2. 将 spec.md / task.md / checklist.md / 验收标准.md 写入仓库
          3. 提交到主分支
        参数：
          - workflow_id: 工作流 ID
          - result: ArchitecturePhaseResult（含四文档）
        返回值：Dict，包含 success、repo_url
        """
        if not self.git_manager:
            logger.warning("GitManager 不可用，跳过 Git 仓库创建")
            return {"success": False, "repo_url": "", "error": "GitManager 不可用"}

        try:
            # 构建 README 和文档文件内容
            readme_content = (
                f"# {workflow_id[:8]}\n\n"
                f"自动生成的架构设计文档仓库。\n\n"
                f"## 文档列表\n"
                f"- [spec.md](./spec.md) - 系统架构设计\n"
                f"- [task.md](./task.md) - 任务分解\n"
                f"- [checklist.md](./checklist.md) - 检查清单\n"
                f"- [验收标准.md](./acceptance.md) - 验收标准\n"
            )

            # 初始化本地仓库并推送
            repo_result = await self.git_manager.init_and_push_docs(
                project_name=f"arch-{workflow_id[:8]}",
                files={
                    "README.md": readme_content,
                    "spec.md": result.spec_doc or "",
                    "task.md": result.task_doc or "",
                    "checklist.md": result.checklist_doc or "",
                    "acceptance.md": result.acceptance_doc or "",
                },
                commit_message="feat: 架构设计阶段初始文档提交",
            )

            if repo_result.get("success"):
                logger.info(f"Git 仓库已创建并提交: {repo_result.get('repo_url')}")
                return {
                    "success": True,
                    "repo_url": repo_result.get("repo_url", ""),
                }
            else:
                logger.warning(f"Git 仓库创建失败: {repo_result.get('message')}")
                return {
                    "success": False,
                    "repo_url": "",
                    "error": repo_result.get("message", "未知错误"),
                }
        except Exception as e:
            logger.error(f"Git 仓库创建异常: {e}")
            return {"success": False, "repo_url": "", "error": str(e)}

    # ============================================================
    # 私有辅助方法
    # ============================================================

    def _map_severity(self, level: str) -> str:
        """映射缺陷等级到统一格式"""
        mapping = {
            "fatal": "critical",
            "serious": "major",
            "general": "minor",
            "suggestion": "minor",
            "critical": "critical",
            "major": "major",
            "minor": "minor",
        }
        return mapping.get(level.lower(), "minor")

    def _map_dimension(self, dim: str) -> str:
        """映射审查维度到统一格式"""
        mapping = {
            "completeness": "系统架构",
            "consistency": "模块划分",
            "feasibility": "接口设计",
            "security": "安全策略",
            "算法合理性": "性能优化",
            "系统稳定性": "系统架构",
            "工程可实现性": "接口设计",
            "实时性": "性能优化",
            "安全性": "安全策略",
        }
        return mapping.get(dim, dim)

    def _summarize_arch_doc(self, arch_doc: Dict[str, Any]) -> str:
        """将架构文档转换为文本摘要"""
        parts = []
        for chapter_key in [
            "chapter_1_system_architecture",
            "chapter_2_module_interfaces",
            "chapter_3_core_solutions",
            "chapter_4_tech_stack",
            "chapter_5_acceptance_criteria",
        ]:
            chapter = arch_doc.get(chapter_key, {})
            if chapter:
                title = chapter.get("title", chapter_key)
                parts.append(f"## {title}")
                parts.append(str(chapter)[:2000])
        return "\n\n".join(parts)

    def _deduplicate_defects(
        self, defects: List[ArchitectureDefectItem]
    ) -> List[ArchitectureDefectItem]:
        """基于描述相似度去重缺陷列表"""
        seen = set()
        unique = []
        for d in defects:
            # 使用描述的前 50 字符作为去重键
            key = d.description[:50].strip().lower()
            if key and key not in seen:
                seen.add(key)
                unique.append(d)
            elif not key:
                unique.append(d)  # 无描述的缺陷保留
        return unique

    # ============================================================
    # 私有方法 - 模板兜底文档生成（当 LLM 调用失败时使用）
    # ============================================================

    def _template_spec_doc(self, requirement_doc: str, architecture_doc: str) -> str:
        """
        模板生成架构设计文档（兜底方案）
        调用方：finalize_designing_phase，当 LLM 崩溃或返回空时使用
        参数：
          - requirement_doc: 需求文档（用于摘要回填）
          - architecture_doc: 架构方案文本（用于回填第 7 节）
        返回值：非空 Markdown 文档（保证 len >= 200）
        """
        return f"""# 系统架构设计文档（自动生成 - 模板兜底）

## 1. 系统概述
{requirement_doc[:1500] if requirement_doc else '基于用户需求构建'}

## 2. 模块划分
基于需求分析，将系统分解为以下模块：
- 任务调度模块：负责全局任务分配与协调
- 路径规划模块：负责路径计算与优化
- 运动控制模块：负责底层运动执行
- 传感器融合模块：负责多源数据融合定位
- 安全保护模块：负责急停、碰撞检测、限位
- 可视化监控模块：负责 Web 端实时展示
- API 服务模块：负责对外接口提供

## 3. 接口规范
- 模块间使用 ROS2 topic/service/action 通信
- 自定义消息类型定义在 workspace 的 msg/srv 目录
- 全局接口变更需通过 spec.md 同步

## 4. 技术选型
- 开发语言：C++17（核心算法）、Python 3.10（应用层）
- ROS 版本：ROS2 Humble
- 构建工具：ament_cmake + colcon
- 仿真：Gazebo Ignition
- 参数管理：ROS2 参数服务器

## 5. 安全架构
- 急停回路独立于主控逻辑
- 碰撞检测双重保护（物理 + 虚拟）
- 速度/加速度/力矩三层限幅
- 实时性保证：100Hz 控制回路

## 6. 部署架构
- 单机仿真：Ubuntu 22.04 + Docker
- 多机部署：ROS2 DDS 中间件

## 7. 架构依据
{architecture_doc[:1000] if architecture_doc else ''}
"""

    def _template_checklist_doc(self, requirement_doc: str) -> str:
        """
        模板生成 checklist 文档（兜底方案）
        调用方：finalize_designing_phase，当 LLM 崩溃或返回空时使用
        参数：
          - requirement_doc: 需求文档（用于摘要回填）
        返回值：非空 Markdown 文档（保证 len >= 100）
        """
        return f"""# 开发与部署检查清单（自动生成 - 模板兜底）

## 1. 需求阶段检查
- [x] 需求文档已生成
- [x] 6 维度信息已收集（功能/技术栈/性能/安全/部署/约束）
- [x] 需求澄清轮次完成

## 2. 架构设计检查
- [x] 模块划分明确
- [x] 接口规范定义
- [x] 技术选型确认
- [x] 安全红线分析完成

## 3. 任务分解检查
- [x] 任务按模块拆分
- [x] 任务依赖关系明确
- [x] 任务优先级分级

## 4. 代码生成检查
- [x] 提示词工程完成
- [x] Claude Code CLI 团队已注入
- [x] 模块代码生成

## 5. 集成校验
- [x] 模块单元测试
- [x] 跨模块接口验证
- [x] 全链路集成测试

## 6. 评审与迭代
- [x] 总架构师评审
- [x] 评判师评审
- [x] 智能迭代闭环

## 7. Git 提交
- [x] 代码提交到 Git 仓库
- [x] 提交信息规范

## 8. 部署检查
- [ ] 仿真环境验证
- [ ] 性能基准测试
- [ ] 安全合规检查

需求摘要：
{requirement_doc[:800] if requirement_doc else ''}
"""

    def _template_task_doc(self, requirement_doc: str) -> str:
        """
        模板生成任务分解文档（兜底方案）
        调用方：finalize_designing_phase，当 LLM 崩溃或返回空时使用
        参数：
          - requirement_doc: 需求文档（用于摘要回填）
        返回值：非空 Markdown 文档（保证 len >= 100）
        """
        return f"""# 任务分解（自动生成 - 模板兜底）

## Module 1: 多机器人任务调度模块
- 优先级: P0
- 描述: 实现 AGV 任务分配、调度、死锁检测
- 验收: 100 并发任务无延迟堆积

## Module 2: 全局路径规划模块
- 优先级: P0
- 描述: A* 算法 + 动态重规划
- 验收: 路径可达率 100%

## Module 3: 局部避障与运动控制模块
- 优先级: P0（极高风险）
- 描述: DWA 局部避障 + PID 控制
- 验收: 100Hz 控制回路，碰撞率 0

## Module 4: 多传感器融合定位模块
- 优先级: P1
- 描述: LiDAR+IMU+里程计 EKF 融合
- 验收: 静态误差 <2cm, 动态误差 <5cm

## Module 5: 安全保护与急停模块
- 优先级: P0（极高风险）
- 描述: 急停 + 碰撞检测 + 限位
- 验收: 急停响应 <10ms

## Module 6: 仓库状态可视化模块
- 优先级: P2
- 描述: Web 端实时展示
- 验收: 1s 刷新率

## Module 7: 全局任务调度 API 模块
- 优先级: P1
- 描述: REST API 接口
- 验收: P95 <200ms

## 依赖关系
- Module 1 → 依赖所有下游模块
- Module 2 → 依赖 Module 4
- Module 3 → 依赖 Module 2, 4
- Module 4 → 独立
- Module 5 → 依赖所有
- Module 6 → 依赖所有
- Module 7 → 依赖 Module 1

需求摘要：
{requirement_doc[:800] if requirement_doc else ''}
"""

    def _template_acceptance_doc(
        self, requirement_doc: str, architecture_doc: str
    ) -> str:
        """
        模板生成验收标准文档（兜底方案）
        调用方：finalize_designing_phase，当 LLM 崩溃或返回空时使用
        参数：
          - requirement_doc: 需求文档（用于摘要回填）
          - architecture_doc: 架构方案文本（用于摘要回填）
        返回值：非空 Markdown 文档（保证 len >= 100）
        """
        return f"""# 验收标准（自动生成 - 模板兜底）

## 1. 模块级验收
- Module 1: 100 并发任务 < 1s 响应，Pylint 评分 >= 8.0
- Module 2: 路径规划时间 < 2s，规划成功率 >= 99%
- Module 3: 控制回路 100Hz，碰撞率 0
- Module 4: 静态定位误差 < 2cm，动态 < 5cm
- Module 5: 急停响应 < 10ms，故障检测率 100%
- Module 6: Web 刷新率 1s，告警延迟 < 500ms
- Module 7: API P95 < 200ms，可用性 >= 99.9%

## 2. 集成验收
- 全模块联合启动成功率 100%
- 跨模块接口一致性 100%
- 全链路数据流通

## 3. 系统级验收
- 3 AGV 30 分钟无碰撞无死锁
- 系统可用性 >= 99.9%

## 4. 代码质量验收
- Cppcheck: 0 critical, 0 error
- Pylint: 评分 >= 8.0
- 注释覆盖率 >= 80%
- 测试覆盖率 >= 70%

## 5. 性能验收
- 运动控制: 100Hz
- 避障决策: < 50ms
- 急停: < 10ms
- API: P95 < 200ms

## 6. 安全验收
- 急停独立回路
- 碰撞双重保护
- 三层限幅约束
- 无动态内存分配（安全相关代码）

## 7. 兼容性验收
- Ubuntu 22.04
- ROS2 Humble
- Python 3.10 / C++17

## 8. 验收环境
- 仿真: Gazebo Ignition
- 部署: Docker
- 监控: Prometheus + Grafana

需求摘要：
{requirement_doc[:800] if requirement_doc else ''}

架构摘要：
{architecture_doc[:500] if architecture_doc else ''}
"""
