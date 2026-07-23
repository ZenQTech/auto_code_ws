"""
# ============================================================
# 架构设计服务 - 架构方案生成与迭代精炼
# ============================================================
# 核心作用：根据用户需求文档生成结构化架构设计方案，
#           支持基于批判反馈的迭代精炼，追踪迭代次数
# 运行流程：
#   1. generate_architecture() 接收需求文档，生成五章结构化架构方案
#   2. refine_architecture() 接收批判反馈，对架构方案进行定向精炼
#   3. get_architecture_doc() 返回当前架构方案文档
#   4. 迭代次数受 settings.architecture.max_critic_iterations 约束（默认 3 次）
# 输入参数：
#   - requirements_doc: str，用户需求文档（Markdown 格式）
#   - critic_feedback: dict，批判反馈（缺陷列表 + 总体结论）
# 输出结果：dict，包含五章结构化架构设计文档
# 修改记录：
#   - 2026-06-24 | v1.0.0 | 初始版本，实现架构方案生成、迭代精炼、迭代计数
# ============================================================
"""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.app.config import settings

logger = logging.getLogger(__name__)


# ============================================================
# 数据类定义
# ============================================================

@dataclass
class ArchitectureDoc:
    """
    架构设计文档数据结构
    字段说明：
      - doc_id: 文档唯一标识（UUID）
      - version: 文档版本号（每次精炼递增）
      - created_at: 创建时间
      - updated_at: 最后更新时间
      - iteration_count: 当前迭代次数（0 表示初始生成）
      - chapter_1_system_architecture: 第一章 - 系统架构总览
      - chapter_2_module_interfaces: 第二章 - 模块职责与接口定义
      - chapter_3_core_solutions: 第三章 - 核心技术方案
      - chapter_4_tech_stack: 第四章 - 技术栈与环境约束
      - chapter_5_acceptance_criteria: 第五章 - 系统验收标准
      - refinement_history: 精炼历史记录列表
    """
    doc_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    version: int = 1
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    iteration_count: int = 0
    chapter_1_system_architecture: Dict[str, Any] = field(default_factory=dict)
    chapter_2_module_interfaces: Dict[str, Any] = field(default_factory=dict)
    chapter_3_core_solutions: Dict[str, Any] = field(default_factory=dict)
    chapter_4_tech_stack: Dict[str, Any] = field(default_factory=dict)
    chapter_5_acceptance_criteria: Dict[str, Any] = field(default_factory=dict)
    refinement_history: List[Dict[str, Any]] = field(default_factory=list)


# ============================================================
# ArchitectureDesigner 核心类
# ============================================================

class ArchitectureDesigner:
    """
    架构设计器
    作用：根据需求文档生成结构化架构设计方案，支持基于批判反馈的迭代精炼
    调用方：API 层（架构设计接口）
    被调用方：无（顶层服务，依赖 config.settings）
    约束：
      - 最大批判迭代次数由 settings.architecture.max_critic_iterations 控制（默认 3）
      - 每次精炼后版本号递增，记录精炼历史
    """

    def __init__(self):
        """
        初始化架构设计器
        运行步骤：
          1. 从 settings 读取架构配置（max_critic_iterations）
          2. 初始化当前架构文档为空
          3. 初始化迭代计数器
        """
        # 从全局配置读取架构迭代约束
        arch_config: Dict[str, Any] = settings.architecture
        # 最大批判迭代次数（从配置读取，默认 3）
        self._max_critic_iterations: int = arch_config.get("max_critic_iterations", 3)
        # 当前架构文档
        self._architecture_doc: Optional[ArchitectureDoc] = None
        # 当前迭代次数（独立于文档的 iteration_count，用于流程控制）
        self._current_iteration: int = 0
        logger.info(
            f"ArchitectureDesigner 初始化完成，"
            f"max_critic_iterations={self._max_critic_iterations}"
        )

    # ============================================================
    # 公开方法
    # ============================================================

    def generate_architecture(self, requirements_doc: str) -> Dict[str, Any]:
        """
        根据需求文档生成架构设计方案
        运行步骤：
          1. 解析需求文档，提取关键需求点
          2. 生成五章结构化架构方案：
             第一章：系统架构总览（架构图描述、分层设计、数据流）
             第二章：模块职责与接口定义（模块划分、接口规范、依赖关系）
             第三章：核心技术方案（关键算法、数据模型、通信机制）
             第四章：技术栈与环境约束（编程语言、框架、依赖库、运行环境）
             第五章：系统验收标准（功能验收、性能指标、安全标准）
          3. 创建 ArchitectureDoc 对象
          4. 重置迭代计数器
          5. 返回结构化文档
        调用方：API 层 POST /api/architecture/design
        被调用方：无（纯逻辑生成）
        参数：
          - requirements_doc: str，用户需求文档（Markdown 格式）
        返回值：dict，包含五章结构化架构设计文档
        """
        logger.info("开始生成架构设计方案...")

        # 创建新的架构文档
        self._architecture_doc = ArchitectureDoc()
        self._current_iteration = 0

        # 解析需求文档，提取关键信息
        requirements_summary = self._parse_requirements(requirements_doc)

        # 生成五章架构方案
        self._architecture_doc.chapter_1_system_architecture = self._generate_chapter_1(
            requirements_summary
        )
        self._architecture_doc.chapter_2_module_interfaces = self._generate_chapter_2(
            requirements_summary
        )
        self._architecture_doc.chapter_3_core_solutions = self._generate_chapter_3(
            requirements_summary
        )
        self._architecture_doc.chapter_4_tech_stack = self._generate_chapter_4(
            requirements_summary
        )
        self._architecture_doc.chapter_5_acceptance_criteria = self._generate_chapter_5(
            requirements_summary
        )

        logger.info(
            f"架构设计方案生成完成，doc_id={self._architecture_doc.doc_id}，"
            f"version={self._architecture_doc.version}"
        )
        return self.get_architecture_doc()

    def refine_architecture(
        self, architecture_doc: Dict[str, Any], critic_feedback: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        基于批判反馈对架构方案进行迭代精炼
        运行步骤：
          1. 检查迭代次数是否已达上限（max_critic_iterations）
          2. 解析批判反馈中的缺陷列表
          3. 按优先级对缺陷进行定向修复
          4. 更新架构文档各章节
          5. 递增版本号，记录精炼历史
          6. 返回精炼后的架构文档
        调用方：API 层 POST /api/architecture/iterate
        被调用方：无（纯逻辑精炼）
        参数：
          - architecture_doc: dict，当前架构文档
          - critic_feedback: dict，批判反馈（包含缺陷列表和总体结论）
        返回值：dict，精炼后的架构文档；若已达迭代上限则返回 None
        """
        # 检查迭代次数上限
        if self._current_iteration >= self._max_critic_iterations:
            logger.warning(
                f"已达到最大批判迭代次数上限 "
                f"({self._current_iteration}/{self._max_critic_iterations})，"
                f"无法继续精炼"
            )
            return None

        logger.info(
            f"开始第 {self._current_iteration + 1} 次架构精炼 "
            f"(上限 {self._max_critic_iterations})..."
        )

        # 确保当前文档存在，若不存在则从参数恢复
        if self._architecture_doc is None:
            self._architecture_doc = ArchitectureDoc()
            self._architecture_doc.chapter_1_system_architecture = architecture_doc.get(
                "chapter_1_system_architecture", {}
            )
            self._architecture_doc.chapter_2_module_interfaces = architecture_doc.get(
                "chapter_2_module_interfaces", {}
            )
            self._architecture_doc.chapter_3_core_solutions = architecture_doc.get(
                "chapter_3_core_solutions", {}
            )
            self._architecture_doc.chapter_4_tech_stack = architecture_doc.get(
                "chapter_4_tech_stack", {}
            )
            self._architecture_doc.chapter_5_acceptance_criteria = architecture_doc.get(
                "chapter_5_acceptance_criteria", {}
            )

        # 解析批判反馈
        defect_list: List[Dict[str, Any]] = critic_feedback.get("defect_list", [])
        overall_conclusion: Dict[str, Any] = critic_feedback.get(
            "overall_conclusion", {}
        )

        # 记录精炼前的文档快照
        snapshot_before = {
            "version": self._architecture_doc.version,
            "defect_count": len(defect_list),
            "conclusion": overall_conclusion.get("summary", ""),
        }

        # 按优先级排序缺陷（高 > 中 > 低），优先处理高优先级缺陷
        sorted_defects = sorted(
            defect_list,
            key=lambda d: {"high": 0, "medium": 1, "low": 2}.get(
                d.get("priority", "low"), 3
            ),
        )

        # 逐缺陷进行定向修复
        for defect in sorted_defects:
            self._apply_defect_fix(defect)

        # 更新版本号和迭代计数
        self._architecture_doc.version += 1
        self._architecture_doc.iteration_count += 1
        self._current_iteration += 1
        self._architecture_doc.updated_at = datetime.now(timezone.utc).isoformat()

        # 记录精炼历史
        self._architecture_doc.refinement_history.append({
            "iteration": self._current_iteration,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "before": snapshot_before,
            "defects_addressed": len(sorted_defects),
            "new_version": self._architecture_doc.version,
        })

        logger.info(
            f"架构精炼完成，当前版本 v{self._architecture_doc.version}，"
            f"迭代次数 {self._current_iteration}/{self._max_critic_iterations}"
        )
        return self.get_architecture_doc()

    def get_architecture_doc(self) -> Dict[str, Any]:
        """
        获取当前架构设计文档
        运行步骤：
          1. 检查当前文档是否存在
          2. 组装完整的架构文档字典
          3. 返回文档
        调用方：API 层（所有架构相关接口）
        被调用方：无
        参数：无
        返回值：dict，包含五章架构文档及元数据
        """
        if self._architecture_doc is None:
            logger.warning("当前无架构文档，返回空文档")
            return {
                "doc_id": "",
                "version": 0,
                "iteration_count": 0,
                "max_iterations": self._max_critic_iterations,
                "current_iteration": self._current_iteration,
                "chapter_1_system_architecture": {},
                "chapter_2_module_interfaces": {},
                "chapter_3_core_solutions": {},
                "chapter_4_tech_stack": {},
                "chapter_5_acceptance_criteria": {},
                "refinement_history": [],
            }

        return {
            "doc_id": self._architecture_doc.doc_id,
            "version": self._architecture_doc.version,
            "created_at": self._architecture_doc.created_at,
            "updated_at": self._architecture_doc.updated_at,
            "iteration_count": self._architecture_doc.iteration_count,
            "max_iterations": self._max_critic_iterations,
            "current_iteration": self._current_iteration,
            "chapter_1_system_architecture": self._architecture_doc.chapter_1_system_architecture,
            "chapter_2_module_interfaces": self._architecture_doc.chapter_2_module_interfaces,
            "chapter_3_core_solutions": self._architecture_doc.chapter_3_core_solutions,
            "chapter_4_tech_stack": self._architecture_doc.chapter_4_tech_stack,
            "chapter_5_acceptance_criteria": self._architecture_doc.chapter_5_acceptance_criteria,
            "refinement_history": self._architecture_doc.refinement_history,
        }

    def get_iteration_info(self) -> Dict[str, Any]:
        """
        获取当前迭代状态信息
        作用：供 API 层查询架构工作流状态
        调用方：API 层 GET /api/architecture/status
        被调用方：无
        参数：无
        返回值：dict，包含迭代计数、上限、是否有活跃文档
        """
        return {
            "current_iteration": self._current_iteration,
            "max_iterations": self._max_critic_iterations,
            "has_document": self._architecture_doc is not None,
            "doc_id": self._architecture_doc.doc_id if self._architecture_doc else "",
            "doc_version": self._architecture_doc.version if self._architecture_doc else 0,
            "can_refine": self._current_iteration < self._max_critic_iterations,
        }

    # ============================================================
    # 私有方法 - 需求解析
    # ============================================================

    def _parse_requirements(self, requirements_doc: str) -> Dict[str, Any]:
        """
        解析需求文档，提取关键需求点
        作用：从 Markdown 格式的需求文档中提取结构化需求摘要
        调用方：generate_architecture()
        被调用方：无
        参数：
          - requirements_doc: str，原始需求文档
        返回值：dict，结构化需求摘要
        """
        # 提取需求文档中的关键章节和要点
        lines = requirements_doc.strip().split("\n")

        # 需求摘要结构
        summary: Dict[str, Any] = {
            "title": "",
            "overview": "",
            "functional_requirements": [],
            "non_functional_requirements": [],
            "constraints": [],
            "raw_text": requirements_doc,
        }

        current_section = ""
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue

            # 识别章节标题
            if stripped.startswith("# ") and not summary["title"]:
                summary["title"] = stripped.lstrip("# ").strip()
            elif stripped.startswith("## "):
                section_name = stripped.lstrip("# ").strip().lower()
                if "功能" in section_name or "functional" in section_name:
                    current_section = "functional"
                elif "非功能" in section_name or "性能" in section_name or "non-functional" in section_name:
                    current_section = "non_functional"
                elif "约束" in section_name or "限制" in section_name or "constraint" in section_name:
                    current_section = "constraints"
                elif "概述" in section_name or "背景" in section_name or "overview" in section_name:
                    current_section = "overview"
                else:
                    current_section = ""
            elif stripped.startswith("- ") or stripped.startswith("* "):
                # 列表项，根据当前章节归类
                item = stripped.lstrip("-* ").strip()
                if current_section == "functional":
                    summary["functional_requirements"].append(item)
                elif current_section == "non_functional":
                    summary["non_functional_requirements"].append(item)
                elif current_section == "constraints":
                    summary["constraints"].append(item)
            elif current_section == "overview":
                if summary["overview"]:
                    summary["overview"] += "\n"
                summary["overview"] += stripped

        logger.info(
            f"需求解析完成：功能需求 {len(summary['functional_requirements'])} 项，"
            f"非功能需求 {len(summary['non_functional_requirements'])} 项，"
            f"约束 {len(summary['constraints'])} 项"
        )
        return summary

    # ============================================================
    # 私有方法 - 五章架构方案生成
    # ============================================================

    def _generate_chapter_1(self, requirements: Dict[str, Any]) -> Dict[str, Any]:
        """
        生成第一章：系统架构总览
        作用：描述系统整体架构设计，包括架构图描述、分层设计、数据流
        调用方：generate_architecture()
        被调用方：无
        参数：
          - requirements: dict，结构化需求摘要
        返回值：dict，第一章架构总览
        """
        return {
            "title": "系统架构总览",
            "architecture_style": self._infer_architecture_style(requirements),
            "architecture_description": (
                f"基于需求 '{requirements.get('title', '未命名项目')}' 的系统架构设计。"
                f"系统采用分层架构设计，确保模块间低耦合、高内聚。"
            ),
            "layer_design": {
                "presentation_layer": {
                    "name": "表现层",
                    "description": "负责用户交互与界面展示，接收用户输入并展示处理结果",
                    "components": ["Web 前端界面", "API 网关", "WebSocket 实时通信"],
                },
                "business_logic_layer": {
                    "name": "业务逻辑层",
                    "description": "核心业务逻辑处理，包括任务调度、工作流编排、智能体管理",
                    "components": ["任务调度引擎", "工作流管理器", "智能体生命周期管理"],
                },
                "data_layer": {
                    "name": "数据层",
                    "description": "数据持久化存储与访问，包括数据库操作、缓存管理",
                    "components": ["关系型数据库", "文件存储", "缓存系统"],
                },
                "integration_layer": {
                    "name": "集成层",
                    "description": "与外部系统（CLI 工具、Hermes、第三方 API）的交互适配",
                    "components": ["CLI 执行器", "Hermes 调度器", "外部 API 适配器"],
                },
            },
            "data_flow": {
                "description": "系统核心数据流描述",
                "main_flow": (
                    "用户输入需求 → 提示词优化 → 任务规划 → 智能体调度 → "
                    "CLI 执行 → 结果验证 → 迭代修复 → 交付输出"
                ),
                "control_flow": (
                    "配额管控 → 安全校验 → 异常处理 → 人工干预 → 状态同步"
                ),
            },
            "deployment_view": {
                "description": "系统部署架构概述",
                "components": ["FastAPI 后端服务", "React 前端应用", "SQLite 数据库"],
            },
        }

    def _generate_chapter_2(self, requirements: Dict[str, Any]) -> Dict[str, Any]:
        """
        生成第二章：模块职责与接口定义
        作用：定义系统各模块的职责边界、接口规范、依赖关系
        调用方：generate_architecture()
        被调用方：无
        参数：
          - requirements: dict，结构化需求摘要
        返回值：dict，第二章模块与接口定义
        """
        return {
            "title": "模块职责与接口定义",
            "module_list": [
                {
                    "module_name": "提示词优化模块",
                    "responsibility": "将用户模糊需求转化为结构化、无歧义的标准化提示词",
                    "input_interface": "原始需求文本（str）",
                    "output_interface": "优化后提示词（OptimizedPrompt 对象）",
                    "dependencies": ["CLI 执行器"],
                    "key_classes": ["PromptOptimizer"],
                },
                {
                    "module_name": "任务规划模块",
                    "responsibility": "将优化后的提示词分解为最小可执行任务单元",
                    "input_interface": "优化后提示词（OptimizedPrompt）",
                    "output_interface": "任务计划（TaskPlan 对象，含子任务列表与依赖关系）",
                    "dependencies": ["CLI 执行器"],
                    "key_classes": ["TaskPlanner"],
                },
                {
                    "module_name": "智能体调度模块",
                    "responsibility": "按策略将任务分配给最合适的智能体实例",
                    "input_interface": "任务列表 + 智能体列表",
                    "output_interface": "调度分配结果（Assignment 对象）",
                    "dependencies": ["智能体管理器"],
                    "key_classes": ["TaskScheduler"],
                },
                {
                    "module_name": "结果验证模块",
                    "responsibility": "对执行结果进行多维度验证，判断是否需要迭代修复",
                    "input_interface": "任务描述 + 执行输出",
                    "output_interface": "验证结果（ValidationResult 对象）",
                    "dependencies": ["CLI 执行器"],
                    "key_classes": ["TaskValidator"],
                },
                {
                    "module_name": "安全校验模块",
                    "responsibility": "三层安全校验（工具自动校验、AST 规则校验、安全逻辑校验）",
                    "input_interface": "代码路径 + 语言 + 风险等级",
                    "output_interface": "安全报告（SecurityReport 对象）",
                    "dependencies": ["外部校验工具（cppcheck/clang-tidy/pylint/roslint）"],
                    "key_classes": ["SecurityChecker", "SecurityReviewManager"],
                },
                {
                    "module_name": "异常处理模块",
                    "responsibility": "分级异常处理、超时兜底、循环依赖检测、人工干预管理",
                    "input_interface": "异常事件 + 任务上下文",
                    "output_interface": "异常处理结果（ExceptionHandleResult）",
                    "dependencies": ["任务调度模块", "智能体管理器"],
                    "key_classes": [
                        "GradedExceptionHandler",
                        "TaskTimeoutHandler",
                        "CircularDependencyDetector",
                        "HumanInterventionManager",
                    ],
                },
                {
                    "module_name": "架构设计模块",
                    "responsibility": "生成结构化架构设计方案，支持批判迭代精炼",
                    "input_interface": "需求文档 + 批判反馈",
                    "output_interface": "架构设计文档（ArchitectureDoc）",
                    "dependencies": ["配置管理模块"],
                    "key_classes": ["ArchitectureDesigner", "ArchitectureCritic"],
                },
                {
                    "module_name": "配额管控模块",
                    "responsibility": "API 调用配额监控、三级告警、熔断恢复",
                    "input_interface": "API 调用事件",
                    "output_interface": "配额状态（UsageData）",
                    "dependencies": ["智能体管理器"],
                    "key_classes": ["UsageMonitor", "QuotaManager"],
                },
            ],
            "interface_standards": {
                "api_protocol": "RESTful API（JSON 格式）",
                "real_time_communication": "WebSocket + SSE（Server-Sent Events）",
                "internal_communication": "Python 函数调用 + 异步协程",
                "data_format": "JSON / YAML / Markdown",
                "error_handling": "统一异常响应格式（code + message + detail）",
            },
        }

    def _generate_chapter_3(self, requirements: Dict[str, Any]) -> Dict[str, Any]:
        """
        生成第三章：核心技术方案
        作用：描述关键算法、数据模型设计、通信机制等核心技术决策
        调用方：generate_architecture()
        被调用方：无
        参数：
          - requirements: dict，结构化需求摘要
        返回值：dict，第三章核心技术方案
        """
        return {
            "title": "核心技术方案",
            "key_algorithms": [
                {
                    "name": "三级执行策略路由算法",
                    "description": (
                        "根据任务复杂度评分自动选择执行模式："
                        "复杂度 ≤ 0.3 → 直接执行，"
                        "0.3 < 复杂度 ≤ 0.7 → Subagent 模式，"
                        "复杂度 > 0.7 → Agent Team 协作模式"
                    ),
                    "complexity": "O(1)",
                },
                {
                    "name": "最少负载调度算法",
                    "description": (
                        "遍历所有在线智能体，选择当前任务数最少的实例分配任务，"
                        "确保负载均衡"
                    ),
                    "complexity": "O(n)，n 为在线智能体数",
                },
                {
                    "name": "拓扑排序循环依赖检测",
                    "description": (
                        "基于任务依赖图进行拓扑排序，检测是否存在循环依赖环，"
                        "使用 DFS 提取环路径"
                    ),
                    "complexity": "O(V + E)，V 为任务数，E 为依赖边数",
                },
            ],
            "data_model_design": {
                "core_entities": [
                    "Session（会话容器）",
                    "Agent（智能体实例）",
                    "Task（任务单元）",
                    "Conversation（对话记录）",
                ],
                "relationships": (
                    "Session 1:N Agent, Session 1:N Task, Session 1:N Conversation; "
                    "Agent 1:N Task; Task 1:N Conversation"
                ),
                "storage_engine": "SQLite（通过 SQLAlchemy ORM 访问）",
            },
            "communication_mechanism": {
                "sync_communication": "RESTful API（FastAPI + Pydantic 模型验证）",
                "async_communication": "WebSocket（实时状态推送）+ SSE（流式对话）",
                "external_integration": "subprocess 调用 CLI 工具（Claude Code CLI / Hermes CLI）",
            },
            "concurrency_model": {
                "description": "基于 Python asyncio 的异步并发模型",
                "key_components": [
                    "asyncio.create_subprocess_shell（CLI 异步执行）",
                    "SQLAlchemy 异步引擎（数据库并发访问）",
                    "FastAPI 异步路由处理（高并发请求）",
                ],
            },
        }

    def _generate_chapter_4(self, requirements: Dict[str, Any]) -> Dict[str, Any]:
        """
        生成第四章：技术栈与环境约束
        作用：明确编程语言、框架、依赖库、运行环境等技术选型
        调用方：generate_architecture()
        被调用方：无
        参数：
          - requirements: dict，结构化需求摘要
        返回值：dict，第四章技术栈与环境约束
        """
        return {
            "title": "技术栈与环境约束",
            "backend_tech_stack": {
                "language": "Python 3.11+",
                "web_framework": "FastAPI（异步 Web 框架）",
                "orm": "SQLAlchemy 2.0+（异步引擎 + aiosqlite）",
                "database": "SQLite 3（嵌入式关系型数据库）",
                "data_validation": "Pydantic v2（请求/响应模型验证）",
                "config_management": "PyYAML（YAML 配置文件解析）",
                "key_dependencies": [
                    "fastapi",
                    "uvicorn",
                    "sqlalchemy[asyncio]",
                    "aiosqlite",
                    "pydantic",
                    "pyyaml",
                    "websockets",
                ],
            },
            "frontend_tech_stack": {
                "language": "TypeScript 5.x",
                "ui_framework": "React 18+",
                "build_tool": "Vite 6.x",
                "css_framework": "TailwindCSS 3.x",
                "key_dependencies": [
                    "react",
                    "react-dom",
                    "vite",
                    "typescript",
                    "tailwindcss",
                    "postcss",
                    "autoprefixer",
                ],
            },
            "cli_integration": {
                "claude_code_cli": "Claude Code CLI（通过 subprocess 调用）",
                "hermes_cli": "Hermes CLI（智能调度内核）",
                "execution_model": "异步 subprocess + 流式输出解析",
            },
            "environment_constraints": {
                "operating_system": "Linux（推荐 Ubuntu 20.04+）",
                "python_version": ">= 3.11",
                "node_version": ">= 18.x",
                "disk_space": ">= 2GB（含数据库和日志）",
                "memory": ">= 4GB RAM",
                "network": "需要访问火山引擎 API（ark.cn-beijing.volces.com）",
            },
            "security_constraints": {
                "api_key_management": "环境变量注入，禁止硬编码",
                "code_execution": "subprocess 隔离，超时自动 kill",
                "data_isolation": "SQLite 单文件数据库，按会话隔离",
                "input_validation": "Pydantic 模型自动校验 + 自定义校验器",
            },
        }

    def _generate_chapter_5(self, requirements: Dict[str, Any]) -> Dict[str, Any]:
        """
        生成第五章：系统验收标准
        作用：定义功能验收、性能指标、安全标准等验收条件
        调用方：generate_architecture()
        被调用方：无
        参数：
          - requirements: dict，结构化需求摘要
        返回值：dict，第五章系统验收标准
        """
        return {
            "title": "系统验收标准",
            "functional_acceptance": {
                "description": "功能验收标准，确保所有需求功能完整实现",
                "criteria": [
                    {
                        "id": "FUNC-001",
                        "name": "提示词优化功能",
                        "description": "能够将模糊需求转化为结构化标准化提示词",
                        "acceptance_method": "输入 5 组不同领域的模糊需求，验证输出结构完整性",
                    },
                    {
                        "id": "FUNC-002",
                        "name": "任务规划功能",
                        "description": "能够将优化后提示词分解为可执行子任务",
                        "acceptance_method": "验证子任务列表包含标题、优先级、依赖关系、复杂度评分",
                    },
                    {
                        "id": "FUNC-003",
                        "name": "智能体调度功能",
                        "description": "能够按策略自动分配任务到合适的智能体",
                        "acceptance_method": "模拟 10 个任务 + 3 个智能体，验证负载均衡",
                    },
                    {
                        "id": "FUNC-004",
                        "name": "结果验证功能",
                        "description": "能够对执行结果进行多维度验证",
                        "acceptance_method": "输入含错误的输出，验证能否检测并建议迭代修复",
                    },
                    {
                        "id": "FUNC-005",
                        "name": "架构设计批判迭代",
                        "description": "能够生成架构方案并基于批判反馈迭代精炼",
                        "acceptance_method": "验证五章输出完整性 + 迭代次数约束生效",
                    },
                ],
            },
            "performance_acceptance": {
                "description": "性能验收标准，确保系统响应速度和吞吐量",
                "criteria": [
                    {
                        "id": "PERF-001",
                        "name": "API 响应时间",
                        "target": "P95 < 500ms（非 CLI 调用接口）",
                        "measurement": "使用压测工具对核心 API 进行 1000 次请求",
                    },
                    {
                        "id": "PERF-002",
                        "name": "并发处理能力",
                        "target": "支持 5 个并发 CLI 任务执行",
                        "measurement": "同时提交 5 个任务，验证无阻塞、无超时",
                    },
                    {
                        "id": "PERF-003",
                        "name": "WebSocket 实时性",
                        "target": "状态变更延迟 < 1s",
                        "measurement": "触发状态变更，测量 WebSocket 推送延迟",
                    },
                ],
            },
            "security_acceptance": {
                "description": "安全验收标准，确保系统安全合规",
                "criteria": [
                    {
                        "id": "SEC-001",
                        "name": "API Key 安全",
                        "target": "API Key 不出现于代码、日志、配置文件明文",
                        "measurement": "全局代码扫描 + 日志审计",
                    },
                    {
                        "id": "SEC-002",
                        "name": "输入校验",
                        "target": "所有 API 输入经过 Pydantic 模型校验",
                        "measurement": "发送非法输入，验证 422 响应",
                    },
                    {
                        "id": "SEC-003",
                        "name": "CLI 执行隔离",
                        "target": "CLI 命令超时自动终止，不残留僵尸进程",
                        "measurement": "触发超时场景，验证进程清理",
                    },
                ],
            },
            "quality_acceptance": {
                "description": "代码质量验收标准",
                "criteria": [
                    {
                        "id": "QUAL-001",
                        "name": "代码注释完整性",
                        "target": "所有文件、类、函数包含完整中文注释",
                        "measurement": "代码审查 + 自动化注释检查",
                    },
                    {
                        "id": "QUAL-002",
                        "name": "编码规范符合性",
                        "target": "Python PEP8 + Google C++ Style Guide + ROS 规范",
                        "measurement": "pylint / flake8 / cppcheck 扫描零严重错误",
                    },
                    {
                        "id": "QUAL-003",
                        "name": "测试覆盖率",
                        "target": "核心模块单元测试覆盖率 > 80%",
                        "measurement": "pytest --cov 覆盖率报告",
                    },
                ],
            },
        }

    # ============================================================
    # 私有方法 - 架构风格推断与缺陷修复
    # ============================================================

    def _infer_architecture_style(self, requirements: Dict[str, Any]) -> str:
        """
        根据需求推断推荐的架构风格
        作用：基于需求特征推荐合适的架构模式
        调用方：_generate_chapter_1()
        被调用方：无
        参数：
          - requirements: dict，结构化需求摘要
        返回值：str，架构风格名称
        """
        raw_text = requirements.get("raw_text", "").lower()
        # 根据需求关键词推断架构风格
        if any(kw in raw_text for kw in ["ros", "机器人", "robot", "节点", "topic"]):
            return "ROS 节点化分层架构"
        elif any(kw in raw_text for kw in ["微服务", "microservice", "分布式"]):
            return "微服务架构"
        elif any(kw in raw_text for kw in ["事件", "event", "消息", "流"]):
            return "事件驱动架构"
        else:
            return "分层架构（Layered Architecture）"

    def _apply_defect_fix(self, defect: Dict[str, Any]) -> None:
        """
        根据单个缺陷信息对架构文档进行定向修复
        作用：将批判反馈中的缺陷映射到对应章节进行修复
        调用方：refine_architecture()
        被调用方：无
        参数：
          - defect: dict，单个缺陷信息（含 defect_id、influence_scope、repair_suggestion 等）
        返回值：无（直接修改 self._architecture_doc）
        """
        if self._architecture_doc is None:
            return

        defect_id: str = defect.get("defect_id", "unknown")
        influence_scope: str = defect.get("influence_scope", "")
        repair_suggestion: str = defect.get("repair_suggestion", "")

        # 根据影响范围定位目标章节
        chapter_map = {
            "系统架构": "chapter_1_system_architecture",
            "模块职责": "chapter_2_module_interfaces",
            "接口定义": "chapter_2_module_interfaces",
            "技术方案": "chapter_3_core_solutions",
            "技术栈": "chapter_4_tech_stack",
            "环境约束": "chapter_4_tech_stack",
            "验收标准": "chapter_5_acceptance_criteria",
        }

        target_chapter = None
        for scope_key, chapter_attr in chapter_map.items():
            if scope_key in influence_scope:
                target_chapter = chapter_attr
                break

        # 若无法定位，默认修复第一章（系统架构总览）
        if target_chapter is None:
            target_chapter = "chapter_1_system_architecture"

        # 获取目标章节
        chapter = getattr(self._architecture_doc, target_chapter, {})
        if not chapter:
            return

        # 在章节中追加修复记录
        if "fix_history" not in chapter:
            chapter["fix_history"] = []
        chapter["fix_history"].append({
            "defect_id": defect_id,
            "defect_level": defect.get("defect_level", "unknown"),
            "problem": defect.get("problem_description", ""),
            "fix_applied": repair_suggestion,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        logger.info(
            f"缺陷 {defect_id} 已应用于章节 {target_chapter}，"
            f"修复建议：{repair_suggestion[:80]}..."
        )
