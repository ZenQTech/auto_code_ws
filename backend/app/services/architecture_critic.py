"""
# ============================================================
# 架构批判服务 - 全维度架构方案批判与缺陷分析
# ============================================================
# 核心作用：对架构设计方案进行全维度批判性审查，
#           生成结构化缺陷列表和优化优先级建议
# 运行流程：
#   1. critique() 接收架构文档，执行全维度批判审查
#   2. 从四个维度进行审查：完整性、一致性、可行性、安全性
#   3. 生成结构化缺陷列表（含缺陷等级、影响范围、根因分析、修复建议）
#   4. 输出三章批判报告：总体评估、结构化缺陷列表、优化优先级
#   5. get_defect_list() 返回当前缺陷列表
#   6. get_overall_conclusion() 返回总体批判结论
# 输入参数：
#   - architecture_doc: dict，五章结构化架构设计文档
# 输出结果：dict，包含三章批判报告（总体评估、缺陷列表、优化优先级）
# 修改记录：
#   - 2026-06-24 | v1.0.0 | 初始版本，实现全维度架构批判审查
#   - 2026-06-29 | v1.0.1 | 导入统一定义模块的 StandardDefectLevel（ARCHITECTURE/CODE
#     二级分类）和 is_architecture_defect 判定函数；补充两个 DefectLevel 枚举的
#     维度说明（批判审查维度 vs 层级分类维度），确保概念清晰不混淆
# ============================================================
"""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

from backend.app.config import settings
from backend.app.services.standard_definitions import DefectLevel as StandardDefectLevel, is_architecture_defect

logger = logging.getLogger(__name__)


# ============================================================
# 枚举类型定义
# ============================================================

class DefectLevel(str, Enum):
    """
    缺陷等级枚举（批判审查维度 - 严重程度分级）
    本枚举用于架构批判审查中的缺陷严重程度分级，与 standard_definitions 中的
    DefectLevel（ARCHITECTURE/CODE 二级层级分类）是不同维度：
      - 本枚举（批判审查维度）：按缺陷严重程度分为 FATAL/SERIOUS/GENERAL/SUGGESTION
      - standard_definitions.DefectLevel（层级分类维度）：按缺陷层级分为 ARCHITECTURE/CODE
    两者可组合使用，例如：一个 FATAL 级别的 ARCHITECTURE 缺陷
    取值：
      - FATAL: 致命缺陷（架构方案不可行，必须重新设计）
      - SERIOUS: 严重缺陷（存在重大设计漏洞，必须修复）
      - GENERAL: 一般缺陷（存在设计不合理，建议修复）
      - SUGGESTION: 优化建议（可改进项，非阻塞）
    """
    FATAL = "fatal"
    SERIOUS = "serious"
    GENERAL = "general"
    SUGGESTION = "suggestion"


class Priority(str, Enum):
    """
    修复优先级枚举
    取值：
      - HIGH: 高优先级（阻塞性问题，必须立即修复）
      - MEDIUM: 中优先级（重要问题，应在当前迭代修复）
      - LOW: 低优先级（优化项，可在后续迭代修复）
    """
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ReviewDimension(str, Enum):
    """
    批判审查维度枚举
    取值：
      - COMPLETENESS: 完整性维度（五章内容是否完整、无缺失）
      - CONSISTENCY: 一致性维度（各章节之间是否逻辑一致、无矛盾）
      - FEASIBILITY: 可行性维度（技术方案是否可落地、资源是否充足）
      - SECURITY: 安全性维度（安全设计是否完备、风险是否可控）
    """
    COMPLETENESS = "completeness"
    CONSISTENCY = "consistency"
    FEASIBILITY = "feasibility"
    SECURITY = "security"


# ============================================================
# 数据类定义
# ============================================================

@dataclass
class ArchitectureDefect:
    """
    架构缺陷数据结构
    字段说明：
      - defect_id: 缺陷唯一标识（格式：DEF-XXXXXX）
      - defect_level: 缺陷等级（fatal/serious/general/suggestion）
      - influence_scope: 影响范围描述（如"系统架构总览"、"模块接口定义"）
      - problem_description: 问题描述（详细说明缺陷内容）
      - root_cause_analysis: 根因分析（缺陷产生的根本原因）
      - repair_suggestion: 修复建议（具体的修复方案）
      - priority: 修复优先级（high/medium/low）
      - review_dimension: 审查维度（completeness/consistency/feasibility/security）
      - created_at: 创建时间
    """
    defect_id: str = field(default_factory=lambda: f"DEF-{uuid.uuid4().hex[:6].upper()}")
    defect_level: DefectLevel = DefectLevel.GENERAL
    influence_scope: str = ""
    problem_description: str = ""
    root_cause_analysis: str = ""
    repair_suggestion: str = ""
    priority: Priority = Priority.MEDIUM
    review_dimension: ReviewDimension = ReviewDimension.COMPLETENESS
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ============================================================
# ArchitectureCritic 核心类
# ============================================================

class ArchitectureCritic:
    """
    架构批判器
    作用：对架构设计方案进行全维度批判性审查，生成结构化缺陷列表
    调用方：API 层（架构批判接口）
    被调用方：无（顶层服务，依赖 config.settings）
    审查维度：
      - 完整性：五章内容是否完整、无缺失
      - 一致性：各章节之间是否逻辑一致、无矛盾
      - 可行性：技术方案是否可落地、资源是否充足
      - 安全性：安全设计是否完备、风险是否可控
    """

    def __init__(self):
        """
        初始化架构批判器
        运行步骤：
          1. 从 settings 读取架构配置
          2. 初始化缺陷列表为空
          3. 初始化总体结论为空
        """
        # 从全局配置读取架构相关配置
        arch_config: Dict[str, Any] = settings.architecture
        # 最大批判迭代次数（用于参考，批判器本身不限制迭代）
        self._max_critic_iterations: int = arch_config.get("max_critic_iterations", 3)
        # 当前缺陷列表
        self._defect_list: List[ArchitectureDefect] = []
        # 总体批判结论
        self._overall_conclusion: Dict[str, Any] = {}
        # 上次批判的架构文档 ID（用于追踪）
        self._last_critiqued_doc_id: str = ""
        logger.info(
            f"ArchitectureCritic 初始化完成，"
            f"max_critic_iterations={self._max_critic_iterations}"
        )

    # ============================================================
    # 公开方法
    # ============================================================

    def critique(self, architecture_doc: Dict[str, Any]) -> Dict[str, Any]:
        """
        对架构设计方案执行全维度批判审查
        运行步骤：
          1. 重置缺陷列表
          2. 从四个维度依次执行审查：
             a. 完整性审查（_review_completeness）
             b. 一致性审查（_review_consistency）
             c. 可行性审查（_review_feasibility）
             d. 安全性审查（_review_security）
          3. 汇总生成总体评估结论
          4. 按优先级排序缺陷列表
          5. 生成优化优先级建议
          6. 返回三章批判报告
        调用方：API 层 POST /api/architecture/critique
        被调用方：无（纯逻辑审查）
        参数：
          - architecture_doc: dict，五章结构化架构设计文档
        返回值：dict，包含三章批判报告
        """
        logger.info("开始执行全维度架构批判审查...")

        # 重置缺陷列表
        self._defect_list = []
        self._last_critiqued_doc_id = architecture_doc.get("doc_id", "")

        # 依次执行四个维度的审查
        self._review_completeness(architecture_doc)
        self._review_consistency(architecture_doc)
        self._review_feasibility(architecture_doc)
        self._review_security(architecture_doc)

        # 按优先级排序缺陷列表（高 > 中 > 低）
        self._defect_list.sort(
            key=lambda d: {"high": 0, "medium": 1, "low": 2}.get(
                d.priority.value, 3
            )
        )

        # 生成总体评估结论
        self._overall_conclusion = self._generate_overall_conclusion()

        # 统计缺陷分布
        fatal_count = sum(1 for d in self._defect_list if d.defect_level == DefectLevel.FATAL)
        serious_count = sum(1 for d in self._defect_list if d.defect_level == DefectLevel.SERIOUS)
        general_count = sum(1 for d in self._defect_list if d.defect_level == DefectLevel.GENERAL)
        suggestion_count = sum(1 for d in self._defect_list if d.defect_level == DefectLevel.SUGGESTION)

        logger.info(
            f"架构批判审查完成：共发现 {len(self._defect_list)} 个缺陷 "
            f"(致命 {fatal_count} / 严重 {serious_count} / "
            f"一般 {general_count} / 建议 {suggestion_count})"
        )

        return self._build_critique_report()

    def get_defect_list(self) -> List[Dict[str, Any]]:
        """
        获取当前缺陷列表
        作用：返回最近一次批判审查生成的结构化缺陷列表
        调用方：API 层（架构批判接口）
        被调用方：无
        参数：无
        返回值：List[dict]，结构化缺陷列表
        """
        return [
            {
                "defect_id": d.defect_id,
                "defect_level": d.defect_level.value,
                "influence_scope": d.influence_scope,
                "problem_description": d.problem_description,
                "root_cause_analysis": d.root_cause_analysis,
                "repair_suggestion": d.repair_suggestion,
                "priority": d.priority.value,
                "review_dimension": d.review_dimension.value,
                "created_at": d.created_at,
            }
            for d in self._defect_list
        ]

    def get_overall_conclusion(self) -> Dict[str, Any]:
        """
        获取总体批判结论
        作用：返回最近一次批判审查的总体评估结论
        调用方：API 层（架构批判接口）
        被调用方：无
        参数：无
        返回值：dict，总体批判结论
        """
        if not self._overall_conclusion:
            return {
                "status": "no_review",
                "summary": "尚未执行架构批判审查",
                "score": 0,
                "recommendation": "请先执行 critique() 方法",
            }
        return self._overall_conclusion

    # ============================================================
    # 私有方法 - 四维度审查
    # ============================================================

    def _review_completeness(self, architecture_doc: Dict[str, Any]) -> None:
        """
        完整性维度审查
        作用：检查五章内容是否完整、无缺失，各章节关键字段是否填充
        调用方：critique()
        被调用方：无
        参数：
          - architecture_doc: dict，架构设计文档
        返回值：无（直接追加缺陷到 self._defect_list）
        """
        dimension = ReviewDimension.COMPLETENESS

        # 定义五章必需字段映射
        required_chapters = {
            "chapter_1_system_architecture": {
                "label": "系统架构总览",
                "required_keys": ["title", "architecture_style", "layer_design", "data_flow"],
            },
            "chapter_2_module_interfaces": {
                "label": "模块职责与接口定义",
                "required_keys": ["title", "module_list", "interface_standards"],
            },
            "chapter_3_core_solutions": {
                "label": "核心技术方案",
                "required_keys": ["title", "key_algorithms", "data_model_design"],
            },
            "chapter_4_tech_stack": {
                "label": "技术栈与环境约束",
                "required_keys": ["title", "backend_tech_stack", "frontend_tech_stack"],
            },
            "chapter_5_acceptance_criteria": {
                "label": "系统验收标准",
                "required_keys": ["title", "functional_acceptance", "performance_acceptance"],
            },
        }

        for chapter_key, chapter_info in required_chapters.items():
            chapter = architecture_doc.get(chapter_key, {})
            chapter_label = chapter_info["label"]

            # 检查章节是否存在
            if not chapter:
                self._defect_list.append(ArchitectureDefect(
                    defect_level=DefectLevel.FATAL,
                    influence_scope=chapter_label,
                    problem_description=f"缺失 {chapter_label} 章节，架构文档不完整",
                    root_cause_analysis="架构生成过程中未正确填充该章节内容",
                    repair_suggestion=f"重新执行架构生成流程，确保 {chapter_label} 章节被正确填充",
                    priority=Priority.HIGH,
                    review_dimension=dimension,
                ))
                continue

            # 检查章节内必需字段
            for required_key in chapter_info["required_keys"]:
                value = chapter.get(required_key)
                if value is None or (isinstance(value, (dict, list, str)) and not value):
                    self._defect_list.append(ArchitectureDefect(
                        defect_level=DefectLevel.SERIOUS,
                        influence_scope=f"{chapter_label} > {required_key}",
                        problem_description=f"{chapter_label} 中缺失必需字段 '{required_key}'",
                        root_cause_analysis="架构生成逻辑未覆盖该字段的填充",
                        repair_suggestion=f"补充 {chapter_label} 中的 '{required_key}' 字段内容",
                        priority=Priority.HIGH,
                        review_dimension=dimension,
                    ))

        # 检查模块列表是否为空
        chapter_2 = architecture_doc.get("chapter_2_module_interfaces", {})
        module_list = chapter_2.get("module_list", [])
        if isinstance(module_list, list) and len(module_list) == 0:
            self._defect_list.append(ArchitectureDefect(
                defect_level=DefectLevel.SERIOUS,
                influence_scope="模块职责与接口定义 > module_list",
                problem_description="模块列表为空，未定义任何系统模块",
                root_cause_analysis="需求解析未提取到足够的模块信息",
                repair_suggestion="重新分析需求文档，补充至少 3 个核心模块定义",
                priority=Priority.HIGH,
                review_dimension=dimension,
            ))

        # 检查验收标准是否为空
        chapter_5 = architecture_doc.get("chapter_5_acceptance_criteria", {})
        func_acceptance = chapter_5.get("functional_acceptance", {})
        func_criteria = func_acceptance.get("criteria", []) if isinstance(func_acceptance, dict) else []
        if isinstance(func_criteria, list) and len(func_criteria) == 0:
            self._defect_list.append(ArchitectureDefect(
                defect_level=DefectLevel.GENERAL,
                influence_scope="系统验收标准 > functional_acceptance",
                problem_description="功能验收标准列表为空，无法评估功能完成度",
                root_cause_analysis="验收标准生成逻辑未根据需求生成足够的验收项",
                repair_suggestion="根据需求文档中的功能点，补充至少 3 项功能验收标准",
                priority=Priority.MEDIUM,
                review_dimension=dimension,
            ))

    def _review_consistency(self, architecture_doc: Dict[str, Any]) -> None:
        """
        一致性维度审查
        作用：检查各章节之间逻辑是否一致，是否存在矛盾或冲突
        调用方：critique()
        被调用方：无
        参数：
          - architecture_doc: dict，架构设计文档
        返回值：无（直接追加缺陷到 self._defect_list）
        """
        dimension = ReviewDimension.CONSISTENCY

        # 检查模块列表与技术栈的一致性
        chapter_2 = architecture_doc.get("chapter_2_module_interfaces", {})
        chapter_4 = architecture_doc.get("chapter_4_tech_stack", {})
        module_list = chapter_2.get("module_list", [])

        if isinstance(module_list, list) and len(module_list) > 0:
            # 检查模块依赖是否在技术栈中有对应支持
            backend_stack = chapter_4.get("backend_tech_stack", {})
            frontend_stack = chapter_4.get("frontend_tech_stack", {})

            # 检查是否有模块依赖了未在技术栈中声明的组件
            declared_deps = set()
            if isinstance(backend_stack, dict):
                declared_deps.update(
                    backend_stack.get("key_dependencies", [])
                )

            for module in module_list:
                if not isinstance(module, dict):
                    continue
                module_deps = module.get("dependencies", [])
                for dep in module_deps:
                    # 检查依赖是否在技术栈中有体现
                    dep_lower = dep.lower()
                    found = any(
                        dep_lower in str(d).lower()
                        for d in declared_deps
                    )
                    if not found and dep not in ["CLI 执行器", "智能体管理器", "任务调度模块",
                                                   "配置管理模块", "外部校验工具（cppcheck/clang-tidy/pylint/roslint）"]:
                        self._defect_list.append(ArchitectureDefect(
                            defect_level=DefectLevel.GENERAL,
                            influence_scope=f"模块职责与接口定义 > {module.get('module_name', '未知模块')}",
                            problem_description=(
                                f"模块 '{module.get('module_name', '未知')}' 依赖 '{dep}'，"
                                f"但该依赖未在技术栈（第四章）中明确声明"
                            ),
                            root_cause_analysis="模块依赖分析与技术栈声明未进行交叉校验",
                            repair_suggestion=f"在技术栈章节中补充 '{dep}' 的版本和配置说明",
                            priority=Priority.MEDIUM,
                            review_dimension=dimension,
                        ))

        # 检查核心算法与模块职责的一致性
        chapter_3 = architecture_doc.get("chapter_3_core_solutions", {})
        key_algorithms = chapter_3.get("key_algorithms", [])
        if isinstance(key_algorithms, list) and isinstance(module_list, list):
            # 检查是否有算法未被任何模块引用
            for algo in key_algorithms:
                if not isinstance(algo, dict):
                    continue
                algo_name = algo.get("name", "")
                algo_found = any(
                    algo_name.lower() in str(m.get("responsibility", "")).lower()
                    for m in module_list
                    if isinstance(m, dict)
                )
                if not algo_found:
                    self._defect_list.append(ArchitectureDefect(
                        defect_level=DefectLevel.SUGGESTION,
                        influence_scope="核心技术方案 > key_algorithms",
                        problem_description=(
                            f"核心算法 '{algo_name}' 未在任何模块职责中体现，"
                            f"可能导致实现时遗漏"
                        ),
                        root_cause_analysis="算法设计与模块职责未进行关联映射",
                        repair_suggestion=f"在对应模块的职责描述中明确引用 '{algo_name}' 算法",
                        priority=Priority.LOW,
                        review_dimension=dimension,
                    ))

        # 检查架构风格与模块设计的一致性
        chapter_1 = architecture_doc.get("chapter_1_system_architecture", {})
        arch_style = chapter_1.get("architecture_style", "")
        if "分层" in arch_style or "layered" in arch_style.lower():
            layer_design = chapter_1.get("layer_design", {})
            if isinstance(layer_design, dict) and len(layer_design) < 3:
                self._defect_list.append(ArchitectureDefect(
                    defect_level=DefectLevel.GENERAL,
                    influence_scope="系统架构总览 > layer_design",
                    problem_description=(
                        f"架构风格声明为 '{arch_style}'，但仅定义了 "
                        f"{len(layer_design)} 层，分层设计不够充分"
                    ),
                    root_cause_analysis="分层设计未覆盖表现层、业务逻辑层、数据层等核心层次",
                    repair_suggestion="补充至少 3 层架构分层（表现层、业务逻辑层、数据层）",
                    priority=Priority.MEDIUM,
                    review_dimension=dimension,
                ))

    def _review_feasibility(self, architecture_doc: Dict[str, Any]) -> None:
        """
        可行性维度审查
        作用：检查技术方案是否可落地、资源是否充足、依赖是否可获取
        调用方：critique()
        被调用方：无
        参数：
          - architecture_doc: dict，架构设计文档
        返回值：无（直接追加缺陷到 self._defect_list）
        """
        dimension = ReviewDimension.FEASIBILITY

        chapter_4 = architecture_doc.get("chapter_4_tech_stack", {})

        # 检查环境约束的合理性
        env_constraints = chapter_4.get("environment_constraints", {})
        if isinstance(env_constraints, dict):
            # 检查 Python 版本要求
            python_version = env_constraints.get("python_version", "")
            if python_version and "3.11" in str(python_version):
                # Python 3.11 是合理的，但需要确认是否有不兼容的依赖
                pass

            # 检查内存要求
            memory = env_constraints.get("memory", "")
            if memory and "GB" in str(memory):
                try:
                    mem_val = float(str(memory).replace("GB", "").replace(">=", "").strip())
                    if mem_val > 16:
                        self._defect_list.append(ArchitectureDefect(
                            defect_level=DefectLevel.SUGGESTION,
                            influence_scope="技术栈与环境约束 > environment_constraints",
                            problem_description=f"内存要求 {memory} 偏高，可能限制部署场景",
                            root_cause_analysis="未对资源需求进行优化评估",
                            repair_suggestion="评估是否可通过优化降低内存需求，或标注为推荐配置而非最低配置",
                            priority=Priority.LOW,
                            review_dimension=dimension,
                        ))
                except (ValueError, AttributeError):
                    pass

        # 检查技术栈依赖的可获取性
        backend_stack = chapter_4.get("backend_tech_stack", {})
        if isinstance(backend_stack, dict):
            key_deps = backend_stack.get("key_dependencies", [])
            # 检查是否有已知的废弃或不推荐使用的依赖
            deprecated_deps = {
                "python 2": "Python 2 已于 2020 年停止维护",
                "tensorflow 1": "TensorFlow 1.x 已停止维护",
            }
            for dep in key_deps:
                dep_lower = str(dep).lower()
                for deprecated_name, reason in deprecated_deps.items():
                    if deprecated_name in dep_lower:
                        self._defect_list.append(ArchitectureDefect(
                            defect_level=DefectLevel.SERIOUS,
                            influence_scope="技术栈与环境约束 > backend_tech_stack",
                            problem_description=f"依赖 '{dep}' 存在问题：{reason}",
                            root_cause_analysis="技术选型未考虑依赖的生命周期状态",
                            repair_suggestion=f"替换 '{dep}' 为当前维护中的替代方案",
                            priority=Priority.HIGH,
                            review_dimension=dimension,
                        ))

        # 检查并发模型与硬件约束的匹配
        chapter_3 = architecture_doc.get("chapter_3_core_solutions", {})
        concurrency_model = chapter_3.get("concurrency_model", {})
        if isinstance(concurrency_model, dict) and isinstance(env_constraints, dict):
            if "asyncio" in str(concurrency_model).lower():
                # asyncio 单线程模型，确认 CPU 核心数要求合理
                # 对于 I/O 密集型任务，asyncio 是合理的
                pass

        # 检查是否有 CLI 工具依赖但未声明
        cli_integration = chapter_4.get("cli_integration", {})
        if isinstance(cli_integration, dict):
            if not cli_integration.get("claude_code_cli") and not cli_integration.get("hermes_cli"):
                self._defect_list.append(ArchitectureDefect(
                    defect_level=DefectLevel.GENERAL,
                    influence_scope="技术栈与环境约束 > cli_integration",
                    problem_description="CLI 集成配置中未声明任何 CLI 工具依赖",
                    root_cause_analysis="技术栈章节未覆盖 CLI 工具链的声明",
                    repair_suggestion="补充 Claude Code CLI 和 Hermes CLI 的版本与配置说明",
                    priority=Priority.MEDIUM,
                    review_dimension=dimension,
                ))

    def _review_security(self, architecture_doc: Dict[str, Any]) -> None:
        """
        安全性维度审查
        作用：检查安全设计是否完备、风险是否可控、是否遵循安全最佳实践
        调用方：critique()
        被调用方：无
        参数：
          - architecture_doc: dict，架构设计文档
        返回值：无（直接追加缺陷到 self._defect_list）
        """
        dimension = ReviewDimension.SECURITY

        chapter_4 = architecture_doc.get("chapter_4_tech_stack", {})
        security_constraints = chapter_4.get("security_constraints", {})

        # 检查安全约束是否定义
        if not security_constraints or not isinstance(security_constraints, dict):
            self._defect_list.append(ArchitectureDefect(
                defect_level=DefectLevel.SERIOUS,
                influence_scope="技术栈与环境约束 > security_constraints",
                problem_description="未定义安全约束，架构方案缺乏安全设计考量",
                root_cause_analysis="架构生成流程未包含安全约束的默认填充",
                repair_suggestion="补充安全约束章节，至少包含 API Key 管理、代码执行隔离、数据隔离、输入校验",
                priority=Priority.HIGH,
                review_dimension=dimension,
            ))
        else:
            # 检查关键安全约束是否缺失
            required_security_items = {
                "api_key_management": "API Key 管理策略",
                "code_execution": "代码执行隔离策略",
                "data_isolation": "数据隔离策略",
                "input_validation": "输入校验策略",
            }
            for key, label in required_security_items.items():
                if key not in security_constraints or not security_constraints[key]:
                    self._defect_list.append(ArchitectureDefect(
                        defect_level=DefectLevel.SERIOUS,
                        influence_scope=f"技术栈与环境约束 > security_constraints > {key}",
                        problem_description=f"缺失关键安全约束：{label}",
                        root_cause_analysis="安全约束定义不完整",
                        repair_suggestion=f"补充 {label} 的具体策略和实施方案",
                        priority=Priority.HIGH,
                        review_dimension=dimension,
                    ))

        # 检查验收标准中是否包含安全验收
        chapter_5 = architecture_doc.get("chapter_5_acceptance_criteria", {})
        security_acceptance = chapter_5.get("security_acceptance", {})
        if isinstance(security_acceptance, dict):
            sec_criteria = security_acceptance.get("criteria", [])
            if isinstance(sec_criteria, list) and len(sec_criteria) == 0:
                self._defect_list.append(ArchitectureDefect(
                    defect_level=DefectLevel.GENERAL,
                    influence_scope="系统验收标准 > security_acceptance",
                    problem_description="安全验收标准为空，无法验证安全设计有效性",
                    root_cause_analysis="验收标准生成未覆盖安全维度",
                    repair_suggestion="补充至少 3 项安全验收标准（API Key 安全、输入校验、执行隔离）",
                    priority=Priority.MEDIUM,
                    review_dimension=dimension,
                ))

        # 检查架构设计中是否考虑了认证授权
        chapter_1 = architecture_doc.get("chapter_1_system_architecture", {})
        layer_design = chapter_1.get("layer_design", {})
        if isinstance(layer_design, dict):
            presentation = layer_design.get("presentation_layer", {})
            if isinstance(presentation, dict):
                components = presentation.get("components", [])
                if isinstance(components, list):
                    has_auth = any("认证" in str(c) or "auth" in str(c).lower() for c in components)
                    if not has_auth:
                        self._defect_list.append(ArchitectureDefect(
                            defect_level=DefectLevel.SUGGESTION,
                            influence_scope="系统架构总览 > layer_design > presentation_layer",
                            problem_description="表现层未包含认证授权组件，存在未授权访问风险",
                            root_cause_analysis="架构分层设计未考虑安全边界",
                            repair_suggestion="在表现层增加 API 认证/授权组件（如 JWT Token 验证）",
                            priority=Priority.LOW,
                            review_dimension=dimension,
                        ))

    # ============================================================
    # 私有方法 - 总体结论与报告构建
    # ============================================================

    def _generate_overall_conclusion(self) -> Dict[str, Any]:
        """
        生成总体批判结论
        作用：基于缺陷列表汇总生成总体评估
        调用方：critique()
        被调用方：无
        参数：无
        返回值：dict，总体批判结论
        """
        total_defects = len(self._defect_list)

        # 统计各等级缺陷数量
        fatal_count = sum(1 for d in self._defect_list if d.defect_level == DefectLevel.FATAL)
        serious_count = sum(1 for d in self._defect_list if d.defect_level == DefectLevel.SERIOUS)
        general_count = sum(1 for d in self._defect_list if d.defect_level == DefectLevel.GENERAL)
        suggestion_count = sum(1 for d in self._defect_list if d.defect_level == DefectLevel.SUGGESTION)

        # 统计各维度缺陷数量
        completeness_count = sum(1 for d in self._defect_list if d.review_dimension == ReviewDimension.COMPLETENESS)
        consistency_count = sum(1 for d in self._defect_list if d.review_dimension == ReviewDimension.CONSISTENCY)
        feasibility_count = sum(1 for d in self._defect_list if d.review_dimension == ReviewDimension.FEASIBILITY)
        security_count = sum(1 for d in self._defect_list if d.review_dimension == ReviewDimension.SECURITY)

        # 计算综合评分（100 分制，致命 -25/个，严重 -10/个，一般 -5/个，建议 -1/个）
        score = max(0, 100 - fatal_count * 25 - serious_count * 10 - general_count * 5 - suggestion_count * 1)

        # 判定总体状态
        if fatal_count > 0:
            status = "rejected"
            status_label = "不通过（存在致命缺陷）"
            recommendation = "架构方案存在致命缺陷，建议重新设计后再提交审查"
        elif serious_count > 3:
            status = "major_revision"
            status_label = "需重大修改（存在多项严重缺陷）"
            recommendation = "架构方案存在多项严重缺陷，建议逐项修复后重新提交审查"
        elif serious_count > 0 or general_count > 5:
            status = "minor_revision"
            status_label = "需小幅修改"
            recommendation = "架构方案基本可行，建议修复严重和一般缺陷后进入下一阶段"
        elif general_count > 0 or suggestion_count > 0:
            status = "approved_with_suggestions"
            status_label = "有条件通过（存在优化建议）"
            recommendation = "架构方案整体合格，建议在后续迭代中采纳优化建议"
        else:
            status = "approved"
            status_label = "通过（无缺陷）"
            recommendation = "架构方案审查通过，可进入下一阶段"

        return {
            "status": status,
            "status_label": status_label,
            "score": score,
            "summary": (
                f"架构批判审查完成，综合评分 {score}/100。"
                f"共发现 {total_defects} 个缺陷："
                f"致命 {fatal_count}、严重 {serious_count}、"
                f"一般 {general_count}、建议 {suggestion_count}。"
                f"审查维度分布：完整性 {completeness_count}、"
                f"一致性 {consistency_count}、可行性 {feasibility_count}、"
                f"安全性 {security_count}。"
            ),
            "recommendation": recommendation,
            "defect_statistics": {
                "total": total_defects,
                "fatal": fatal_count,
                "serious": serious_count,
                "general": general_count,
                "suggestion": suggestion_count,
            },
            "dimension_statistics": {
                "completeness": completeness_count,
                "consistency": consistency_count,
                "feasibility": feasibility_count,
                "security": security_count,
            },
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
            "reviewed_doc_id": self._last_critiqued_doc_id,
        }

    def _build_critique_report(self) -> Dict[str, Any]:
        """
        构建三章批判报告
        作用：组装总体评估、结构化缺陷列表、优化优先级三章内容
        调用方：critique()
        被调用方：无
        参数：无
        返回值：dict，三章批判报告
        """
        # 第一章：总体评估
        chapter_1_overall_assessment = self._overall_conclusion

        # 第二章：结构化缺陷列表
        chapter_2_defect_list = self.get_defect_list()

        # 第三章：优化优先级
        high_priority = [d for d in self._defect_list if d.priority == Priority.HIGH]
        medium_priority = [d for d in self._defect_list if d.priority == Priority.MEDIUM]
        low_priority = [d for d in self._defect_list if d.priority == Priority.LOW]

        chapter_3_optimization_priorities = {
            "title": "优化优先级",
            "description": "按优先级排列的修复建议，建议按高→中→低顺序逐项修复",
            "high_priority": {
                "count": len(high_priority),
                "description": "高优先级缺陷（阻塞性问题，必须立即修复）",
                "items": [
                    {
                        "defect_id": d.defect_id,
                        "problem": d.problem_description,
                        "repair_suggestion": d.repair_suggestion,
                    }
                    for d in high_priority
                ],
            },
            "medium_priority": {
                "count": len(medium_priority),
                "description": "中优先级缺陷（重要问题，应在当前迭代修复）",
                "items": [
                    {
                        "defect_id": d.defect_id,
                        "problem": d.problem_description,
                        "repair_suggestion": d.repair_suggestion,
                    }
                    for d in medium_priority
                ],
            },
            "low_priority": {
                "count": len(low_priority),
                "description": "低优先级缺陷（优化项，可在后续迭代修复）",
                "items": [
                    {
                        "defect_id": d.defect_id,
                        "problem": d.problem_description,
                        "repair_suggestion": d.repair_suggestion,
                    }
                    for d in low_priority
                ],
            },
            "suggested_fix_order": (
                "建议修复顺序："
                "1. 首先修复所有高优先级缺陷（致命 + 严重等级）；"
                "2. 然后修复中优先级缺陷（一般等级）；"
                "3. 最后在后续迭代中采纳低优先级优化建议。"
            ),
        }

        return {
            "chapter_1_overall_assessment": chapter_1_overall_assessment,
            "chapter_2_structured_defect_list": chapter_2_defect_list,
            "chapter_3_optimization_priorities": chapter_3_optimization_priorities,
        }
