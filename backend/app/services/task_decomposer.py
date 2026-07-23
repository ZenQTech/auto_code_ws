"""
# ============================================================
# 任务分解与风险标记服务（V4.1 新增）
# ============================================================
# 核心作用：基于已确认的架构设计文档，生成标准化的 JSON 任务列表，
#           并对每个任务进行三级风险分类标记、依赖合理性审查、
#           循环依赖检测、全局接口优先级设置、综合校验
# 运行流程：
#   1. decompose() 接收架构设计文档，解析模块依赖关系
#   2. 按模块拆分生成标准化 task_list，分配 task_id、task_type、依赖等
#   3. mark_risk_levels() 对每个任务按三级风险分类规则标记风险等级
#   4. review_task_list() 审查风险标记准确性、依赖合理性、检测循环依赖
#   5. set_global_interface_priority() 将全局接口/消息定义任务设为最高优先级
#   6. validate_task_list() 综合校验依赖存在性、无循环依赖、模型白名单、
#      验收标准清晰度、超时合规性
# 输入参数：
#   - architecture_doc: dict，已确认的架构设计文档（JSON 格式）
# 输出结果：标准化 JSON 任务列表，包含 project_info、global_interface_spec、
#           task_list、parallel_execution_rule、delivery_requirement
# 修改记录：
#   - 2026-06-24 | v4.1.0 | 初始版本，实现任务分解、风险标记、审查、
#     全局接口优先级设置、综合校验五大核心功能
#   - 2026-06-29 | v4.1.1 | 将 RiskLevel 枚举统一迁移至 standard_definitions
#     模块，值从中文（极高安全风险/高安全风险/一般风险/低风险）统一为英文
#     （very_high/high/general/low），与全流程统一定义保持一致
# ============================================================
"""

import copy
import json
import logging
import re
from collections import defaultdict, deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple

from backend.app.config import settings
from backend.app.services.standard_definitions import RiskLevel

logger = logging.getLogger(__name__)


# ============================================================
# 枚举类型定义
# ============================================================

class TaskType(str, Enum):
    """
    任务类型枚举
    取值：
      - CORE_ALGORITHM: 核心算法开发
      - CPP_PERF_OPT: C++性能优化
      - ROS_ENGINEERING: ROS工程化开发
      - SIMULATION: 仿真环境开发
      - LIGHTWEIGHT_CODE: 轻量代码开发
      - LOCAL_ARCH_ADAPT: 局部架构适配
      - GLOBAL_INTERFACE: 全局接口定义
      - BUG_FIX: bug修复
    """
    CORE_ALGORITHM = "核心算法开发"
    CPP_PERF_OPT = "C++性能优化"
    ROS_ENGINEERING = "ROS工程化开发"
    SIMULATION = "仿真环境开发"
    LIGHTWEIGHT_CODE = "轻量代码开发"
    LOCAL_ARCH_ADAPT = "局部架构适配"
    GLOBAL_INTERFACE = "全局接口定义"
    BUG_FIX = "bug修复"


# RiskLevel 枚举已统一迁移至 backend.app.services.standard_definitions
# 从该模块导入使用：from backend.app.services.standard_definitions import RiskLevel
# 取值（与统一定义完全一致）：
#   - RiskLevel.VERY_HIGH = "very_high"  # 极高风险
#   - RiskLevel.HIGH = "high"            # 高风险
#   - RiskLevel.GENERAL = "general"      # 一般风险
#   - RiskLevel.LOW = "low"              # 低风险
# 引用标准：三级风险界定标准（Section 5.11）


class TaskPriority(str, Enum):
    """
    任务优先级枚举
    取值：高、中、低
    """
    HIGH = "高"
    MEDIUM = "中"
    LOW = "低"


# ============================================================
# 数据类定义
# ============================================================

@dataclass
class TaskItem:
    """
    单个任务项数据结构
    字段说明：
      - task_id: 任务唯一标识符（字符串）
      - task_name: 任务名称
      - task_type: 任务类型（枚举：TaskType）
      - depend_task_id: 依赖的任务 ID 列表
      - adapt_model: 适配的模型名称
      - acceptance_criteria: 验收标准描述
      - preconditions: 前置条件描述
      - timeout: 超时时间（分钟）
      - risk_level: 风险等级（枚举：RiskLevel）
      - priority: 优先级（枚举：TaskPriority）
    """
    task_id: str = ""
    task_name: str = ""
    task_type: str = ""
    depend_task_id: List[str] = field(default_factory=list)
    adapt_model: str = ""
    acceptance_criteria: str = ""
    preconditions: str = ""
    timeout: int = 60
    risk_level: str = RiskLevel.LOW.value
    priority: str = TaskPriority.MEDIUM.value

    def to_dict(self) -> Dict[str, Any]:
        """
        将 TaskItem 转换为字典格式（符合 JSON schema）
        返回值：标准化的字典对象
        """
        return {
            "task_id": self.task_id,
            "task_name": self.task_name,
            "task_type": self.task_type,
            "depend_task_id": self.depend_task_id,
            "adapt_model": self.adapt_model,
            "acceptance_criteria": self.acceptance_criteria,
            "preconditions": self.preconditions,
            "timeout": self.timeout,
            "risk_level": self.risk_level,
            "priority": self.priority,
        }


@dataclass
class TaskListResult:
    """
    任务列表完整结果数据结构
    字段说明：
      - project_info: 项目基本信息（project_name、architecture_version、global_constraint）
      - global_interface_spec: 全局接口规范描述
      - task_list: 任务项列表
      - parallel_execution_rule: 并行执行规则描述
      - delivery_requirement: 交付要求描述
    """
    project_info: Dict[str, str] = field(default_factory=dict)
    global_interface_spec: str = ""
    task_list: List[TaskItem] = field(default_factory=list)
    parallel_execution_rule: str = ""
    delivery_requirement: str = ""

    def to_dict(self) -> Dict[str, Any]:
        """
        将 TaskListResult 转换为符合 JSON schema 的字典
        返回值：标准化的字典对象
        """
        return {
            "project_info": self.project_info,
            "global_interface_spec": self.global_interface_spec,
            "task_list": [t.to_dict() for t in self.task_list],
            "parallel_execution_rule": self.parallel_execution_rule,
            "delivery_requirement": self.delivery_requirement,
        }

    def to_json(self, indent: int = 2) -> str:
        """
        将 TaskListResult 序列化为 JSON 字符串
        参数：
          - indent: JSON 缩进空格数
        返回值：格式化的 JSON 字符串
        """
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)


# ============================================================
# TaskDecomposer - 任务分解与风险标记核心类
# ============================================================

class TaskDecomposer:
    """
    任务分解与风险标记核心类
    作用：将已确认的架构设计文档分解为标准化的任务列表，
          并对每个任务进行风险分类、依赖审查、循环依赖检测、
          全局接口优先级设置和综合校验
    调用方：工作流引擎、任务调度模块
    被调用方：无（独立服务）
    """

    # ---- 风险分类关键词映射表 ----
    # 极高安全风险关键词：急停逻辑、安全保护、故障兜底核心机制
    _VERY_HIGH_RISK_KEYWORDS: Set[str] = {
        "急停", "紧急停止", "emergency_stop", "e_stop", "安全保护",
        "故障兜底", "故障恢复", "fault_recovery", "安全状态", "safe_state",
        "紧急制动", "emergency_brake", "安全联锁", "safety_interlock",
        "看门狗", "watchdog", "心跳检测", "heartbeat", "安全回路",
        "碰撞检测", "collision_detection", "力限制", "force_limit",
        "安全限位", "safety_limit", "防护停止", "protective_stop",
    }

    # 高安全风险关键词：运动控制、避障、轨迹生成、力矩限制、关节控制、硬件驱动安全
    _HIGH_RISK_KEYWORDS: Set[str] = {
        "运动控制", "motion_control", "轨迹生成", "trajectory",
        "避障", "obstacle_avoidance", "路径规划", "path_planning",
        "力矩", "torque", "关节控制", "joint_control", "电机控制",
        "motor_control", "硬件驱动", "hardware_driver", "伺服",
        "servo", "PID", "pid", "速度控制", "velocity_control",
        "位置控制", "position_control", "力控", "force_control",
        "阻抗控制", "impedance_control", "导纳控制", "admittance_control",
        "逆运动学", "inverse_kinematics", "正运动学", "forward_kinematics",
        "动力学", "dynamics", "末端执行器", "end_effector",
        "驱动安全", "driver_safety", "功率限制", "power_limit",
    }

    # 一般风险关键词：运动学求解、传感器数据预处理、状态估计（安全相关）
    _GENERAL_RISK_KEYWORDS: Set[str] = {
        "运动学", "kinematics", "传感器", "sensor", "数据预处理",
        "data_preprocessing", "状态估计", "state_estimation", "卡尔曼",
        "kalman", "滤波", "filter", "融合", "fusion", "标定",
        "calibration", "里程计", "odometry", "定位", "localization",
        "建图", "mapping", "SLAM", "slam", "点云", "pointcloud",
        "图像处理", "image_processing", "特征提取", "feature_extraction",
        "坐标变换", "tf", "transform", "消息转换", "message_converter",
    }

    # ---- 模型白名单 ----
    # 从配置中获取可用模型列表，兜底使用默认白名单
    _MODEL_WHITELIST: Set[str] = {
        "deepseek-v4-pro[1m]",
        "deepseek-v4-flash",
        "deepseek-v4-pro",
        "deepseek-v4",
        "deepseek-v3",
        "claude-sonnet-4-20250514",
        "claude-3-5-sonnet",
        "claude-3-opus",
        "gpt-4o",
        "gpt-4-turbo",
    }

    # ---- 任务类型与超时配置的映射 ----
    # 从全局配置读取，兜底使用默认值
    _TASK_TYPE_TIMEOUT_MAP: Dict[str, Dict[str, int]] = {
        TaskType.CORE_ALGORITHM.value: {"default": 90, "max": 180},
        TaskType.CPP_PERF_OPT.value: {"default": 90, "max": 180},
        TaskType.ROS_ENGINEERING.value: {"default": 60, "max": 120},
        TaskType.SIMULATION.value: {"default": 60, "max": 120},
        TaskType.LIGHTWEIGHT_CODE.value: {"default": 30, "max": 60},
        TaskType.LOCAL_ARCH_ADAPT.value: {"default": 60, "max": 120},
        TaskType.GLOBAL_INTERFACE.value: {"default": 30, "max": 60},
        TaskType.BUG_FIX.value: {"default": 30, "max": 60},
    }

    def __init__(self):
        """
        初始化任务分解器
        运行步骤：
          1. 从全局配置读取任务超时标准
          2. 初始化模型白名单（合并配置中的模型）
          3. 初始化风险关键词映射表
        """
        # 从全局配置读取任务超时配置，合并到默认映射表
        config_timeout = settings.task_timeout
        if config_timeout:
            # 配置中的 key 到 TaskType 的映射
            config_key_map = {
                "global_interface": TaskType.GLOBAL_INTERFACE.value,
                "lightweight_code": TaskType.LIGHTWEIGHT_CODE.value,
                "lightweight_bugfix": TaskType.BUG_FIX.value,
                "single_module_coding": TaskType.ROS_ENGINEERING.value,
                "engineering_implementation": TaskType.ROS_ENGINEERING.value,
                "simulation_engineering": TaskType.SIMULATION.value,
                "core_algorithm": TaskType.CORE_ALGORITHM.value,
                "cpp_performance_optimization": TaskType.CPP_PERF_OPT.value,
                "architecture_design": TaskType.GLOBAL_INTERFACE.value,
            }
            for config_key, task_type in config_key_map.items():
                if config_key in config_timeout:
                    timeout_cfg = config_timeout[config_key]
                    if isinstance(timeout_cfg, dict):
                        self._TASK_TYPE_TIMEOUT_MAP[task_type] = {
                            "default": timeout_cfg.get("default", 60),
                            "max": timeout_cfg.get("max", 120),
                        }

        # 合并 CLI 配置中的模型到白名单
        cli_config = settings.cli
        if cli_config and "env" in cli_config:
            env = cli_config["env"]
            for model_key in ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL",
                              "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL",
                              "CLAUDE_CODE_SUBAGENT_MODEL"]:
                model_val = env.get(model_key, "")
                if model_val and model_val.strip():
                    self._MODEL_WHITELIST.add(model_val.strip())

        logger.info(
            f"任务分解器初始化完成 | 模型白名单数量={len(self._MODEL_WHITELIST)} | "
            f"超时配置任务类型数={len(self._TASK_TYPE_TIMEOUT_MAP)}"
        )

    # ============================================================
    # decompose - 生成标准化 JSON 任务列表
    # ============================================================

    def decompose(self, architecture_doc: Dict[str, Any]) -> TaskListResult:
        """
        从已确认的架构设计文档生成标准化 JSON 任务列表
        运行步骤：
          1. 校验输入 architecture_doc 的合法性
          2. 提取项目基本信息（project_name、architecture_version、global_constraint）
          3. 提取全局接口规范
          4. 遍历架构文档中的模块列表，为每个模块生成 TaskItem
          5. 根据模块依赖关系设置 depend_task_id
          6. 按模块功能自动推断 task_type
          7. 调用 mark_risk_levels 标记风险等级
          8. 调用 set_global_interface_priority 设置全局接口优先级
          9. 生成并行执行规则和交付要求
          10. 返回 TaskListResult
        参数：
          - architecture_doc: 已确认的架构设计文档（dict 格式）
        返回值：TaskListResult 对象，包含完整的标准化任务列表
        """
        if not architecture_doc or not isinstance(architecture_doc, dict):
            logger.error("架构设计文档无效或为空")
            return TaskListResult(
                project_info={"project_name": "", "architecture_version": "", "global_constraint": ""},
                global_interface_spec="",
                task_list=[],
                parallel_execution_rule="",
                delivery_requirement="",
            )

        logger.info("开始从架构文档分解任务...")

        # ---- 提取项目基本信息 ----
        project_info = self._extract_project_info(architecture_doc)

        # ---- 提取全局接口规范 ----
        global_interface_spec = self._extract_global_interface_spec(architecture_doc)

        # ---- 提取模块列表并生成任务 ----
        modules = architecture_doc.get("modules", [])
        if not modules:
            # 尝试从其他可能的字段提取模块信息
            modules = architecture_doc.get("components", [])
        if not modules:
            modules = architecture_doc.get("tasks", [])

        task_list: List[TaskItem] = []
        # 建立模块名称到 task_id 的映射（用于解析依赖关系）
        module_name_to_id: Dict[str, str] = {}

        for idx, module in enumerate(modules):
            # 生成唯一 task_id
            task_id = self._generate_task_id(module, idx)

            # 提取模块名称
            module_name = module.get("name", module.get("module_name", f"module_{idx}"))
            module_name_to_id[module_name] = task_id

            # 推断任务类型
            task_type = self._infer_task_type(module)

            # 提取描述和验收标准
            description = module.get("description", module.get("desc", ""))
            acceptance = module.get("acceptance_criteria", module.get("acceptance", ""))
            if not acceptance:
                acceptance = f"完成 {module_name} 模块的开发、测试与集成验证"

            # 提取前置条件
            preconditions = module.get("preconditions", module.get("prerequisites", ""))
            if not preconditions:
                preconditions = f"依赖模块已完成开发并通过单元测试"

            # 获取超时配置
            timeout = self._get_timeout_for_task_type(task_type)

            # 获取适配模型
            adapt_model = module.get("adapt_model", module.get("model", ""))
            if not adapt_model:
                adapt_model = self._get_default_model()

            # 创建 TaskItem
            task_item = TaskItem(
                task_id=task_id,
                task_name=module_name,
                task_type=task_type,
                depend_task_id=[],  # 后续解析依赖关系时填充
                adapt_model=adapt_model,
                acceptance_criteria=acceptance,
                preconditions=preconditions,
                timeout=timeout,
                risk_level=RiskLevel.LOW.value,  # 后续由 mark_risk_levels 标记
                priority=TaskPriority.MEDIUM.value,  # 后续由 set_global_interface_priority 调整
            )
            task_list.append(task_item)

        # ---- 解析模块依赖关系 ----
        self._resolve_dependencies(task_list, modules, module_name_to_id)

        # ---- 标记风险等级 ----
        self.mark_risk_levels(task_list)

        # ---- 设置全局接口优先级 ----
        self.set_global_interface_priority(task_list)

        # ---- 生成并行执行规则 ----
        parallel_execution_rule = self._generate_parallel_rule(task_list)

        # ---- 生成交付要求 ----
        delivery_requirement = self._generate_delivery_requirement(architecture_doc)

        result = TaskListResult(
            project_info=project_info,
            global_interface_spec=global_interface_spec,
            task_list=task_list,
            parallel_execution_rule=parallel_execution_rule,
            delivery_requirement=delivery_requirement,
        )

        logger.info(
            f"任务分解完成 | 项目={project_info.get('project_name', '未知')} | "
            f"任务总数={len(task_list)}"
        )
        return result

    def _extract_project_info(self, architecture_doc: Dict[str, Any]) -> Dict[str, str]:
        """
        从架构文档中提取项目基本信息
        运行步骤：
          1. 尝试从 architecture_doc 顶层字段提取 project_name
          2. 尝试从 project_info 子字段提取
          3. 提取 architecture_version
          4. 提取 global_constraint
        参数：
          - architecture_doc: 架构设计文档
        返回值：包含 project_name、architecture_version、global_constraint 的字典
        """
        # 尝试从多个可能的字段提取项目名称
        project_name = (
            architecture_doc.get("project_name", "")
            or architecture_doc.get("name", "")
            or architecture_doc.get("title", "")
            or "未命名项目"
        )

        # 提取架构版本
        architecture_version = (
            architecture_doc.get("architecture_version", "")
            or architecture_doc.get("version", "")
            or "1.0.0"
        )

        # 提取全局约束
        global_constraint = (
            architecture_doc.get("global_constraint", "")
            or architecture_doc.get("constraints", "")
            or ""
        )
        if isinstance(global_constraint, list):
            global_constraint = "; ".join(str(c) for c in global_constraint)
        if isinstance(global_constraint, dict):
            global_constraint = json.dumps(global_constraint, ensure_ascii=False)

        return {
            "project_name": project_name,
            "architecture_version": architecture_version,
            "global_constraint": global_constraint,
        }

    def _extract_global_interface_spec(self, architecture_doc: Dict[str, Any]) -> str:
        """
        从架构文档中提取全局接口规范
        运行步骤：
          1. 尝试从 global_interface_spec 字段提取
          2. 尝试从 interfaces 字段提取
          3. 尝试从 messages 字段提取
          4. 汇总为字符串
        参数：
          - architecture_doc: 架构设计文档
        返回值：全局接口规范描述字符串
        """
        spec = architecture_doc.get("global_interface_spec", "")
        if spec:
            return spec if isinstance(spec, str) else json.dumps(spec, ensure_ascii=False)

        # 从 interfaces 字段提取
        interfaces = architecture_doc.get("interfaces", [])
        messages = architecture_doc.get("messages", [])
        ros_interfaces = architecture_doc.get("ros_interfaces", [])

        spec_parts: List[str] = []

        if interfaces:
            spec_parts.append("## 接口定义")
            for iface in interfaces:
                if isinstance(iface, dict):
                    spec_parts.append(
                        f"- {iface.get('name', '未命名')}: {iface.get('description', '')}"
                    )
                else:
                    spec_parts.append(f"- {iface}")

        if messages:
            spec_parts.append("## 消息定义")
            for msg in messages:
                if isinstance(msg, dict):
                    spec_parts.append(
                        f"- {msg.get('name', '未命名')}: {msg.get('description', '')}"
                    )
                else:
                    spec_parts.append(f"- {msg}")

        if ros_interfaces:
            spec_parts.append("## ROS 接口")
            for riface in ros_interfaces:
                if isinstance(riface, dict):
                    spec_parts.append(
                        f"- {riface.get('name', '未命名')}: {riface.get('type', '')}"
                    )
                else:
                    spec_parts.append(f"- {riface}")

        return "\n".join(spec_parts) if spec_parts else "无全局接口定义"

    def _generate_task_id(self, module: Dict[str, Any], index: int) -> str:
        """
        为模块生成唯一任务 ID
        运行步骤：
          1. 优先使用模块中已有的 id 字段
          2. 其次使用模块名称的拼音首字母缩写 + 序号
          3. 兜底使用 TASK_ + 序号
        参数：
          - module: 模块字典
          - index: 模块在列表中的索引
        返回值：唯一任务 ID 字符串
        """
        # 优先使用模块中已有的 ID
        existing_id = module.get("id", module.get("task_id", ""))
        if existing_id:
            return str(existing_id)

        # 使用模块名称生成 ID
        module_name = module.get("name", module.get("module_name", ""))
        if module_name:
            # 提取英文单词首字母或中文拼音首字母
            # 先尝试提取英文单词
            english_words = re.findall(r'[a-zA-Z]+', module_name)
            if english_words:
                # 取每个单词的首字母，大写
                prefix = "".join(w[0].upper() for w in english_words if w)
                if len(prefix) >= 2:
                    return f"{prefix}_{index + 1:03d}"
            # 中文名称：使用模块类型的缩写
            type_abbr = {
                "控制": "CTRL", "感知": "PERC", "规划": "PLAN",
                "驱动": "DRV", "通信": "COMM", "接口": "IFACE",
                "算法": "ALGO", "仿真": "SIM", "测试": "TEST",
                "配置": "CFG", "工具": "UTIL", "数据": "DATA",
            }
            for cn_key, abbr in type_abbr.items():
                if cn_key in module_name:
                    return f"{abbr}_{index + 1:03d}"

        # 兜底：使用 TASK_ + 序号
        return f"TASK_{index + 1:03d}"

    def _infer_task_type(self, module: Dict[str, Any]) -> str:
        """
        根据模块描述自动推断任务类型
        运行步骤：
          1. 优先使用模块中已有的 task_type 字段
          2. 根据模块名称和描述中的关键词匹配推断
          3. 兜底使用 ROS工程化开发
        参数：
          - module: 模块字典
        返回值：任务类型字符串（TaskType 枚举值）
        """
        # 优先使用已有的类型标记
        existing_type = module.get("task_type", module.get("type", ""))
        if existing_type:
            # 尝试匹配枚举值
            for tt in TaskType:
                if tt.value == existing_type:
                    return tt.value
            # 尝试模糊匹配
            type_keywords_map = {
                TaskType.CORE_ALGORITHM.value: ["算法", "algorithm", "核心"],
                TaskType.CPP_PERF_OPT.value: ["性能优化", "performance", "优化", "加速"],
                TaskType.ROS_ENGINEERING.value: ["ROS", "ros", "节点", "node", "工程"],
                TaskType.SIMULATION.value: ["仿真", "simulation", "gazebo", "模拟"],
                TaskType.LIGHTWEIGHT_CODE.value: ["轻量", "脚本", "script", "工具"],
                TaskType.LOCAL_ARCH_ADAPT.value: ["适配", "adapt", "迁移", "兼容"],
                TaskType.GLOBAL_INTERFACE.value: ["接口", "interface", "消息", "message", "定义"],
                TaskType.BUG_FIX.value: ["修复", "bug", "fix", "缺陷"],
            }
            for task_type, keywords in type_keywords_map.items():
                for kw in keywords:
                    if kw.lower() in existing_type.lower():
                        return task_type

        # 根据模块名称和描述推断
        module_name = module.get("name", module.get("module_name", ""))
        description = module.get("description", module.get("desc", ""))
        combined_text = f"{module_name} {description}".lower()

        # 按优先级匹配关键词
        type_keywords_map = {
            TaskType.GLOBAL_INTERFACE.value: ["接口定义", "消息定义", "interface", "msg", "srv", "action", "全局"],
            TaskType.CORE_ALGORITHM.value: ["核心算法", "算法", "algorithm", "core"],
            TaskType.CPP_PERF_OPT.value: ["性能优化", "优化", "performance", "加速", "实时"],
            TaskType.SIMULATION.value: ["仿真", "simulation", "gazebo", "模拟", "场景"],
            TaskType.LIGHTWEIGHT_CODE.value: ["脚本", "script", "工具", "辅助", "配置生成"],
            TaskType.LOCAL_ARCH_ADAPT.value: ["适配", "adapt", "迁移", "兼容", "重构"],
            TaskType.BUG_FIX.value: ["修复", "bug", "fix", "缺陷", "错误"],
        }

        for task_type, keywords in type_keywords_map.items():
            for kw in keywords:
                if kw.lower() in combined_text:
                    return task_type

        # 兜底：ROS工程化开发
        return TaskType.ROS_ENGINEERING.value

    def _get_timeout_for_task_type(self, task_type: str) -> int:
        """
        根据任务类型获取默认超时时间（分钟）
        运行步骤：
          1. 查找 _TASK_TYPE_TIMEOUT_MAP 中的配置
          2. 返回 default 值
          3. 兜底返回 60 分钟
        参数：
          - task_type: 任务类型字符串
        返回值：超时时间（分钟）
        """
        timeout_cfg = self._TASK_TYPE_TIMEOUT_MAP.get(task_type, {})
        return timeout_cfg.get("default", 60)

    def _get_default_model(self) -> str:
        """
        获取默认适配模型
        运行步骤：
          1. 从 CLI 配置中读取 ANTHROPIC_MODEL
          2. 兜底返回 deepseek-v4-pro[1m]
        返回值：模型名称字符串
        """
        cli_config = settings.cli
        if cli_config and "env" in cli_config:
            env = cli_config["env"]
            model = env.get("ANTHROPIC_MODEL", "")
            if model and model.strip():
                return model.strip()
        return "deepseek-v4-pro[1m]"

    def _resolve_dependencies(
        self,
        task_list: List[TaskItem],
        modules: List[Dict[str, Any]],
        module_name_to_id: Dict[str, str],
    ):
        """
        解析模块间的依赖关系，填充每个 TaskItem 的 depend_task_id
        运行步骤：
          1. 遍历每个模块，提取其 dependencies 字段
          2. 将依赖的模块名称转换为 task_id
          3. 填充到对应 TaskItem 的 depend_task_id 中
        参数：
          - task_list: 任务项列表
          - modules: 原始模块列表
          - module_name_to_id: 模块名称到 task_id 的映射
        """
        for idx, module in enumerate(modules):
            if idx >= len(task_list):
                break

            # 提取依赖关系
            deps = module.get("dependencies", module.get("deps", []))
            if isinstance(deps, str):
                deps = [d.strip() for d in deps.split(",") if d.strip()]

            depend_ids: List[str] = []
            for dep in deps:
                if isinstance(dep, dict):
                    dep_name = dep.get("name", dep.get("module_name", ""))
                else:
                    dep_name = str(dep)

                # 尝试通过模块名称映射找到 task_id
                if dep_name in module_name_to_id:
                    depend_ids.append(module_name_to_id[dep_name])
                else:
                    # 尝试模糊匹配
                    for mod_name, tid in module_name_to_id.items():
                        if dep_name.lower() in mod_name.lower() or mod_name.lower() in dep_name.lower():
                            if tid not in depend_ids:
                                depend_ids.append(tid)
                            break

            task_list[idx].depend_task_id = depend_ids

    def _generate_parallel_rule(self, task_list: List[TaskItem]) -> str:
        """
        根据任务依赖关系生成并行执行规则
        运行步骤：
          1. 对任务列表执行拓扑排序，识别可并行执行的任务组
          2. 生成并行执行规则描述
        参数：
          - task_list: 任务项列表
        返回值：并行执行规则描述字符串
        """
        if not task_list:
            return "无任务，无需并行执行规则"

        # 构建依赖图
        in_degree: Dict[str, int] = {t.task_id: 0 for t in task_list}
        adjacency: Dict[str, List[str]] = {t.task_id: [] for t in task_list}

        for task in task_list:
            for dep_id in task.depend_task_id:
                if dep_id in adjacency:
                    adjacency[dep_id].append(task.task_id)
                    in_degree[task.task_id] = in_degree.get(task.task_id, 0) + 1

        # 拓扑排序分层
        queue: deque = deque()
        for tid, degree in in_degree.items():
            if degree == 0:
                queue.append(tid)

        layers: List[List[str]] = []
        while queue:
            layer: List[str] = []
            for _ in range(len(queue)):
                tid = queue.popleft()
                layer.append(tid)
                for neighbor in adjacency.get(tid, []):
                    in_degree[neighbor] -= 1
                    if in_degree[neighbor] == 0:
                        queue.append(neighbor)
            if layer:
                layers.append(layer)

        # 生成规则描述
        rules: List[str] = []
        rules.append("## 并行执行规则")
        rules.append(f"共 {len(layers)} 个执行层级，同层级内任务可并行执行：")
        for i, layer in enumerate(layers):
            task_names = []
            for tid in layer:
                for t in task_list:
                    if t.task_id == tid:
                        task_names.append(f"{t.task_name}({tid})")
                        break
            rules.append(f"  第 {i + 1} 层: {', '.join(task_names)}")
        rules.append("")
        rules.append("约束：高/极高安全风险任务不允许与其他高风险任务并行执行，需独占资源。")

        return "\n".join(rules)

    def _generate_delivery_requirement(self, architecture_doc: Dict[str, Any]) -> str:
        """
        生成交付要求描述
        运行步骤：
          1. 从架构文档中提取交付要求
          2. 补充默认交付标准
        参数：
          - architecture_doc: 架构设计文档
        返回值：交付要求描述字符串
        """
        delivery = architecture_doc.get("delivery_requirement", "")
        if not delivery:
            delivery = architecture_doc.get("delivery", "")

        if delivery:
            return delivery if isinstance(delivery, str) else json.dumps(delivery, ensure_ascii=False)

        # 默认交付要求
        return (
            "## 交付要求\n"
            "1. 所有模块代码完整可编译、可运行\n"
            "2. 每个模块附带单元测试脚本，测试覆盖率 >= 80%\n"
            "3. 高风险模块需通过全流程安全校验（本地校验→安全校验→单元测试→人工安全审核）\n"
            "4. 代码注释完整，修改记录可追溯\n"
            "5. 交付物包含：代码包、测试报告、版本日志、部署运行说明\n"
            "6. 全局接口定义任务必须最先完成，作为下游模块的接口契约"
        )

    # ============================================================
    # mark_risk_levels - 三级风险分类标记
    # ============================================================

    def mark_risk_levels(self, task_list: List[TaskItem]):
        """
        对任务列表中的每个任务应用三级风险分类标记
        分类规则：
          - 极高安全风险：急停逻辑、安全保护、故障兜底核心机制
          - 高安全风险：运动控制、避障、轨迹生成、力矩限制、关节控制、硬件驱动安全
          - 一般风险：运动学求解、传感器数据预处理、状态估计（安全相关）
          - 低风险：工具函数、数据预处理、辅助脚本、非核心模块
          - 默认规则：边界模糊的模块一律标记为高安全风险
        运行步骤：
          1. 遍历每个任务
          2. 提取任务名称和描述文本
          3. 按极高→高→一般→低的优先级匹配关键词
          4. 边界模糊（匹配到多个等级关键词）时标记为高安全风险
          5. 无匹配时标记为低风险
        参数：
          - task_list: 任务项列表（原地修改 risk_level 字段）
        """
        if not task_list:
            logger.warning("任务列表为空，跳过风险标记")
            return

        logger.info(f"开始标记风险等级，任务总数={len(task_list)}")

        for task in task_list:
            # 组合任务名称和验收标准作为分析文本
            analysis_text = f"{task.task_name} {task.acceptance_criteria} {task.preconditions}"

            # 统计各等级关键词命中次数
            very_high_hits = self._count_keyword_hits(analysis_text, self._VERY_HIGH_RISK_KEYWORDS)
            high_hits = self._count_keyword_hits(analysis_text, self._HIGH_RISK_KEYWORDS)
            general_hits = self._count_keyword_hits(analysis_text, self._GENERAL_RISK_KEYWORDS)

            # 按优先级确定风险等级
            if very_high_hits > 0:
                task.risk_level = RiskLevel.VERY_HIGH.value
            elif high_hits > 0:
                task.risk_level = RiskLevel.HIGH.value
            elif general_hits > 0:
                task.risk_level = RiskLevel.GENERAL.value
            else:
                task.risk_level = RiskLevel.LOW.value

            # 边界模糊检测：如果同时命中多个等级的关键词，按默认规则标记为高安全风险
            hit_levels = sum([
                1 if very_high_hits > 0 else 0,
                1 if high_hits > 0 else 0,
                1 if general_hits > 0 else 0,
            ])
            if hit_levels >= 2:
                # 边界模糊：升级到高安全风险
                original_level = task.risk_level
                task.risk_level = RiskLevel.HIGH.value
                logger.info(
                    f"任务 {task.task_id}({task.task_name}) 边界模糊（命中 {hit_levels} 个等级关键词），"
                    f"从 {original_level} 升级为 {RiskLevel.HIGH.value}"
                )

            logger.debug(
                f"任务 {task.task_id}({task.task_name}) 风险等级={task.risk_level} | "
                f"极高命中={very_high_hits} 高命中={high_hits} 一般命中={general_hits}"
            )

        # 统计各风险等级任务数量
        level_counts: Dict[str, int] = defaultdict(int)
        for task in task_list:
            level_counts[task.risk_level] += 1
        logger.info(
            f"风险标记完成 | 极高={level_counts.get(RiskLevel.VERY_HIGH.value, 0)} "
            f"高={level_counts.get(RiskLevel.HIGH.value, 0)} "
            f"一般={level_counts.get(RiskLevel.GENERAL.value, 0)} "
            f"低={level_counts.get(RiskLevel.LOW.value, 0)}"
        )

    def _count_keyword_hits(self, text: str, keywords: Set[str]) -> int:
        """
        统计文本中关键词命中次数
        运行步骤：
          1. 将文本转为小写进行不区分大小写匹配
          2. 遍历关键词集合，统计命中次数
        参数：
          - text: 待分析文本
          - keywords: 关键词集合
        返回值：命中次数
        """
        text_lower = text.lower()
        hits = 0
        for kw in keywords:
            if kw.lower() in text_lower:
                hits += 1
        return hits

    # ============================================================
    # review_task_list - 审查任务列表
    # ============================================================

    def review_task_list(self, task_list: List[TaskItem]) -> Dict[str, Any]:
        """
        审查任务列表的质量，包括风险标记准确性、依赖合理性、循环依赖检测
        运行步骤：
          1. 审查风险标记准确性（基于关键词二次校验）
          2. 审查依赖合理性（依赖是否存在、是否合理）
          3. 使用拓扑排序检测循环依赖
          4. 汇总审查结果
        参数：
          - task_list: 任务项列表
        返回值：审查结果字典，包含：
          - passed: bool，是否通过审查
          - risk_review: dict，风险审查结果
          - dependency_review: dict，依赖审查结果
          - circular_dependency: dict，循环依赖检测结果
          - issues: list，发现的问题列表
          - warnings: list，警告信息列表
        """
        if not task_list:
            return {
                "passed": True,
                "risk_review": {"passed": True, "issues": []},
                "dependency_review": {"passed": True, "issues": []},
                "circular_dependency": {"passed": True, "cycles": []},
                "issues": [],
                "warnings": ["任务列表为空"],
            }

        logger.info(f"开始审查任务列表，任务总数={len(task_list)}")

        issues: List[str] = []
        warnings: List[str] = []

        # ---- 1. 审查风险标记准确性 ----
        risk_review = self._review_risk_accuracy(task_list)
        if not risk_review["passed"]:
            issues.extend(risk_review["issues"])
        if risk_review.get("warnings"):
            warnings.extend(risk_review["warnings"])

        # ---- 2. 审查依赖合理性 ----
        dependency_review = self._review_dependency_rationality(task_list)
        if not dependency_review["passed"]:
            issues.extend(dependency_review["issues"])
        if dependency_review.get("warnings"):
            warnings.extend(dependency_review["warnings"])

        # ---- 3. 循环依赖检测（拓扑排序） ----
        circular_result = self._detect_circular_dependencies(task_list)
        if not circular_result["passed"]:
            issues.extend(circular_result["issues"])

        passed = len(issues) == 0

        result = {
            "passed": passed,
            "risk_review": risk_review,
            "dependency_review": dependency_review,
            "circular_dependency": circular_result,
            "issues": issues,
            "warnings": warnings,
        }

        logger.info(
            f"任务列表审查完成 | 通过={passed} | 问题数={len(issues)} | 警告数={len(warnings)}"
        )
        return result

    def _review_risk_accuracy(self, task_list: List[TaskItem]) -> Dict[str, Any]:
        """
        审查风险标记准确性
        运行步骤：
          1. 对每个任务重新执行关键词匹配
          2. 比较当前标记与关键词匹配结果
          3. 检测是否存在漏标（应标高风险但标为低风险）
          4. 检测是否存在过度标记（低风险任务标为高风险）
        参数：
          - task_list: 任务项列表
        返回值：审查结果字典
        """
        issues: List[str] = []
        warnings: List[str] = []

        for task in task_list:
            analysis_text = f"{task.task_name} {task.acceptance_criteria} {task.preconditions}"

            very_high_hits = self._count_keyword_hits(analysis_text, self._VERY_HIGH_RISK_KEYWORDS)
            high_hits = self._count_keyword_hits(analysis_text, self._HIGH_RISK_KEYWORDS)
            general_hits = self._count_keyword_hits(analysis_text, self._GENERAL_RISK_KEYWORDS)

            # 检测漏标：关键词命中高风险但标记为低风险
            if (very_high_hits > 0 or high_hits > 0) and task.risk_level == RiskLevel.LOW.value:
                issues.append(
                    f"任务 {task.task_id}({task.task_name}) 风险标记可能不准确："
                    f"命中高风险关键词（极高={very_high_hits}, 高={high_hits}），"
                    f"但标记为 {RiskLevel.LOW.value}"
                )

            # 检测漏标：极高风险关键词命中但标记非极高
            if very_high_hits > 0 and task.risk_level != RiskLevel.VERY_HIGH.value:
                warnings.append(
                    f"任务 {task.task_id}({task.task_name}) 命中极高风险关键词，"
                    f"当前标记为 {task.risk_level}，建议升级为 {RiskLevel.VERY_HIGH.value}"
                )

        return {
            "passed": len(issues) == 0,
            "issues": issues,
            "warnings": warnings,
        }

    def _review_dependency_rationality(self, task_list: List[TaskItem]) -> Dict[str, Any]:
        """
        审查依赖关系合理性
        运行步骤：
          1. 收集所有 task_id 到集合
          2. 检查每个任务的依赖是否指向存在的任务
          3. 检查是否存在自依赖（任务依赖自身）
          4. 检查是否存在冗余依赖（A→B 且 B→A 的情况由循环检测处理）
        参数：
          - task_list: 任务项列表
        返回值：审查结果字典
        """
        issues: List[str] = []
        warnings: List[str] = []

        # 收集所有 task_id
        all_ids: Set[str] = {t.task_id for t in task_list}

        for task in task_list:
            # 检查依赖是否存在
            for dep_id in task.depend_task_id:
                if dep_id not in all_ids:
                    issues.append(
                        f"任务 {task.task_id}({task.task_name}) 依赖了不存在的任务: {dep_id}"
                    )

                # 检查自依赖
                if dep_id == task.task_id:
                    issues.append(
                        f"任务 {task.task_id}({task.task_name}) 存在自依赖（依赖自身）"
                    )

            # 检查依赖列表是否有重复
            if len(task.depend_task_id) != len(set(task.depend_task_id)):
                warnings.append(
                    f"任务 {task.task_id}({task.task_name}) 的依赖列表中存在重复项"
                )

        return {
            "passed": len(issues) == 0,
            "issues": issues,
            "warnings": warnings,
        }

    def _detect_circular_dependencies(self, task_list: List[TaskItem]) -> Dict[str, Any]:
        """
        使用拓扑排序检测循环依赖
        运行步骤：
          1. 构建有向图（邻接表 + 入度表）
          2. 执行 Kahn 算法拓扑排序
          3. 若排序后仍有节点未访问，说明存在循环依赖
          4. 使用 DFS 找出具体的循环路径
        参数：
          - task_list: 任务项列表
        返回值：检测结果字典，包含：
          - passed: bool，是否通过（无循环依赖）
          - cycles: list，检测到的循环依赖路径列表
          - topological_order: list，拓扑排序结果
          - issues: list，问题描述列表
        """
        issues: List[str] = []
        cycles: List[List[str]] = []

        if not task_list:
            return {
                "passed": True,
                "cycles": [],
                "topological_order": [],
                "issues": [],
            }

        # 构建有向图
        all_ids: Set[str] = {t.task_id for t in task_list}
        in_degree: Dict[str, int] = {tid: 0 for tid in all_ids}
        adjacency: Dict[str, List[str]] = {tid: [] for tid in all_ids}

        for task in task_list:
            for dep_id in task.depend_task_id:
                if dep_id in adjacency:
                    adjacency[dep_id].append(task.task_id)
                    in_degree[task.task_id] = in_degree.get(task.task_id, 0) + 1

        # Kahn 算法拓扑排序
        queue: deque = deque()
        for tid, degree in in_degree.items():
            if degree == 0:
                queue.append(tid)

        topological_order: List[str] = []
        while queue:
            tid = queue.popleft()
            topological_order.append(tid)
            for neighbor in adjacency.get(tid, []):
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        # 检测是否存在未访问节点（循环依赖）
        unvisited = all_ids - set(topological_order)
        if unvisited:
            # 使用 DFS 找出具体的循环路径
            cycles = self._find_cycles(list(unvisited), adjacency)
            for cycle in cycles:
                cycle_str = " → ".join(cycle)
                issues.append(f"检测到循环依赖: {cycle_str}")

        return {
            "passed": len(unvisited) == 0,
            "cycles": cycles,
            "topological_order": topological_order,
            "issues": issues,
        }

    def _find_cycles(
        self, start_nodes: List[str], adjacency: Dict[str, List[str]]
    ) -> List[List[str]]:
        """
        使用 DFS 在指定起始节点中查找循环依赖路径
        运行步骤：
          1. 对每个起始节点执行 DFS
          2. 使用 visited 集合跟踪已访问节点
          3. 使用 path 列表跟踪当前路径
          4. 当遇到已在 path 中的节点时，记录循环
        参数：
          - start_nodes: 起始节点列表（拓扑排序后未访问的节点）
          - adjacency: 邻接表
        返回值：循环路径列表
        """
        cycles: List[List[str]] = []

        for start in start_nodes:
            visited: Set[str] = set()
            path: List[str] = []
            self._dfs_find_cycle(start, adjacency, visited, path, cycles)

        return cycles

    def _dfs_find_cycle(
        self,
        current: str,
        adjacency: Dict[str, List[str]],
        visited: Set[str],
        path: List[str],
        cycles: List[List[str]],
    ):
        """
        DFS 辅助函数：在图中查找循环路径
        运行步骤：
          1. 将当前节点加入 visited 和 path
          2. 遍历当前节点的所有邻居
          3. 若邻居已在 path 中，找到循环
          4. 若邻居未访问，递归搜索
          5. 回溯时从 path 中移除当前节点
        参数：
          - current: 当前节点 ID
          - adjacency: 邻接表
          - visited: 已访问节点集合
          - path: 当前路径列表
          - cycles: 循环路径列表（输出参数）
        """
        visited.add(current)
        path.append(current)

        for neighbor in adjacency.get(current, []):
            if neighbor in path:
                # 找到循环：从 neighbor 到 current 的路径
                cycle_start = path.index(neighbor)
                cycle = path[cycle_start:] + [neighbor]
                if cycle not in cycles:
                    cycles.append(cycle)
            elif neighbor not in visited:
                self._dfs_find_cycle(neighbor, adjacency, visited, path, cycles)

        path.pop()

    # ============================================================
    # set_global_interface_priority - 全局接口优先级设置
    # ============================================================

    def set_global_interface_priority(self, task_list: List[TaskItem]):
        """
        将全局接口/消息定义任务设置为最高优先级
        运行步骤：
          1. 遍历任务列表，识别 task_type 为 GLOBAL_INTERFACE 的任务
          2. 将识别到的任务优先级设置为 HIGH
          3. 同时检查任务名称/描述中包含接口定义关键词的任务
          4. 确保全局接口任务无上游依赖（或依赖最少）
        参数：
          - task_list: 任务项列表（原地修改 priority 字段）
        """
        if not task_list:
            logger.warning("任务列表为空，跳过全局接口优先级设置")
            return

        logger.info("开始设置全局接口任务优先级...")

        global_interface_keywords = [
            "接口定义", "消息定义", "全局接口", "interface", "msg", "srv",
            "action", "服务定义", "话题定义", "通信协议", "数据格式",
        ]

        count = 0
        for task in task_list:
            # 条件1：task_type 为 GLOBAL_INTERFACE
            if task.task_type == TaskType.GLOBAL_INTERFACE.value:
                task.priority = TaskPriority.HIGH.value
                # 全局接口任务应无上游依赖（或依赖最少），清除非全局接口的依赖
                # 保留对同类型全局接口任务的依赖
                global_interface_ids = {
                    t.task_id for t in task_list
                    if t.task_type == TaskType.GLOBAL_INTERFACE.value
                }
                task.depend_task_id = [
                    dep for dep in task.depend_task_id
                    if dep in global_interface_ids
                ]
                count += 1
                logger.debug(
                    f"全局接口任务 {task.task_id}({task.task_name}) 优先级设为 HIGH"
                )
                continue

            # 条件2：任务名称或描述中包含接口定义关键词
            combined_text = f"{task.task_name} {task.acceptance_criteria}"
            is_interface_task = any(
                kw.lower() in combined_text.lower()
                for kw in global_interface_keywords
            )
            if is_interface_task:
                task.priority = TaskPriority.HIGH.value
                # 同样清理非全局接口的依赖
                global_interface_ids = {
                    t.task_id for t in task_list
                    if t.task_type == TaskType.GLOBAL_INTERFACE.value
                }
                task.depend_task_id = [
                    dep for dep in task.depend_task_id
                    if dep in global_interface_ids
                ]
                count += 1
                logger.debug(
                    f"接口相关任务 {task.task_id}({task.task_name}) 优先级设为 HIGH"
                )

        logger.info(f"全局接口优先级设置完成 | 提升任务数={count}")

    # ============================================================
    # validate_task_list - 综合校验
    # ============================================================

    def validate_task_list(self, task_list: List[TaskItem]) -> Dict[str, Any]:
        """
        对任务列表执行综合校验
        校验项：
          1. 依赖存在性：所有 depend_task_id 指向的任务必须存在
          2. 无循环依赖：任务依赖图必须是无环有向图
          3. 模型白名单：adapt_model 必须在白名单中
          4. 验收标准清晰度：acceptance_criteria 不能为空或过于简短
          5. 超时合规性：timeout 不能超过对应任务类型的 max 值
        运行步骤：
          1. 执行各项校验
          2. 汇总校验结果
          3. 返回结构化校验报告
        参数：
          - task_list: 任务项列表
        返回值：校验结果字典，包含：
          - passed: bool，是否通过所有校验
          - dependency_exist: dict，依赖存在性校验结果
          - no_circular: dict，循环依赖校验结果
          - model_whitelist: dict，模型白名单校验结果
          - acceptance_clarity: dict，验收标准清晰度校验结果
          - timeout_compliance: dict，超时合规性校验结果
          - issues: list，所有问题列表
        """
        if not task_list:
            return {
                "passed": False,
                "dependency_exist": {"passed": False, "issues": ["任务列表为空"]},
                "no_circular": {"passed": True, "issues": []},
                "model_whitelist": {"passed": True, "issues": []},
                "acceptance_clarity": {"passed": False, "issues": ["任务列表为空"]},
                "timeout_compliance": {"passed": True, "issues": []},
                "issues": ["任务列表为空"],
            }

        logger.info(f"开始综合校验任务列表，任务总数={len(task_list)}")

        all_issues: List[str] = []

        # ---- 1. 依赖存在性校验 ----
        dep_exist_result = self._validate_dependency_existence(task_list)
        if not dep_exist_result["passed"]:
            all_issues.extend(dep_exist_result["issues"])

        # ---- 2. 循环依赖校验 ----
        circular_result = self._detect_circular_dependencies(task_list)
        if not circular_result["passed"]:
            all_issues.extend(circular_result["issues"])

        # ---- 3. 模型白名单校验 ----
        model_result = self._validate_model_whitelist(task_list)
        if not model_result["passed"]:
            all_issues.extend(model_result["issues"])

        # ---- 4. 验收标准清晰度校验 ----
        acceptance_result = self._validate_acceptance_clarity(task_list)
        if not acceptance_result["passed"]:
            all_issues.extend(acceptance_result["issues"])

        # ---- 5. 超时合规性校验 ----
        timeout_result = self._validate_timeout_compliance(task_list)
        if not timeout_result["passed"]:
            all_issues.extend(timeout_result["issues"])

        passed = len(all_issues) == 0

        result = {
            "passed": passed,
            "dependency_exist": dep_exist_result,
            "no_circular": circular_result,
            "model_whitelist": model_result,
            "acceptance_clarity": acceptance_result,
            "timeout_compliance": timeout_result,
            "issues": all_issues,
        }

        logger.info(
            f"综合校验完成 | 通过={passed} | 问题总数={len(all_issues)}"
        )
        return result

    def _validate_dependency_existence(self, task_list: List[TaskItem]) -> Dict[str, Any]:
        """
        校验所有依赖任务是否存在
        运行步骤：
          1. 收集所有 task_id 到集合
          2. 遍历每个任务的 depend_task_id
          3. 检查每个依赖 ID 是否在集合中
        参数：
          - task_list: 任务项列表
        返回值：校验结果字典
        """
        issues: List[str] = []
        all_ids: Set[str] = {t.task_id for t in task_list}

        for task in task_list:
            for dep_id in task.depend_task_id:
                if dep_id not in all_ids:
                    issues.append(
                        f"任务 {task.task_id} 依赖了不存在的任务: {dep_id}"
                    )

        return {
            "passed": len(issues) == 0,
            "issues": issues,
        }

    def _validate_model_whitelist(self, task_list: List[TaskItem]) -> Dict[str, Any]:
        """
        校验所有任务的 adapt_model 是否在白名单中
        运行步骤：
          1. 遍历每个任务
          2. 检查 adapt_model 是否在 _MODEL_WHITELIST 中
          3. 空模型名称视为通过（使用默认模型）
        参数：
          - task_list: 任务项列表
        返回值：校验结果字典
        """
        issues: List[str] = []

        for task in task_list:
            model = task.adapt_model.strip()
            if not model:
                # 空模型名称：使用默认模型，视为通过
                continue
            if model not in self._MODEL_WHITELIST:
                issues.append(
                    f"任务 {task.task_id} 的适配模型 '{model}' 不在白名单中。"
                    f"白名单: {sorted(self._MODEL_WHITELIST)}"
                )

        return {
            "passed": len(issues) == 0,
            "issues": issues,
        }

    def _validate_acceptance_clarity(self, task_list: List[TaskItem]) -> Dict[str, Any]:
        """
        校验验收标准清晰度
        运行步骤：
          1. 检查 acceptance_criteria 是否为空
          2. 检查是否过于简短（少于 10 个字符）
          3. 检查是否包含明确的验证动作关键词
        参数：
          - task_list: 任务项列表
        返回值：校验结果字典
        """
        issues: List[str] = []
        # 验收标准应包含的验证动作关键词
        verification_keywords = [
            "验证", "测试", "通过", "完成", "确认", "检查", "校验",
            "verify", "test", "pass", "complete", "check", "validate",
        ]

        for task in task_list:
            criteria = task.acceptance_criteria.strip()

            # 检查是否为空
            if not criteria:
                issues.append(
                    f"任务 {task.task_id}({task.task_name}) 的验收标准为空"
                )
                continue

            # 检查是否过于简短
            if len(criteria) < 10:
                issues.append(
                    f"任务 {task.task_id}({task.task_name}) 的验收标准过于简短（{len(criteria)} 字符），"
                    f"请提供更详细的验收标准"
                )
                continue

            # 检查是否包含验证动作关键词
            has_verification = any(
                kw.lower() in criteria.lower() for kw in verification_keywords
            )
            if not has_verification:
                issues.append(
                    f"任务 {task.task_id}({task.task_name}) 的验收标准缺少明确的验证动作，"
                    f"建议包含'验证'、'测试'、'通过'等关键词"
                )

        return {
            "passed": len(issues) == 0,
            "issues": issues,
        }

    def _validate_timeout_compliance(self, task_list: List[TaskItem]) -> Dict[str, Any]:
        """
        校验超时合规性
        运行步骤：
          1. 获取每个任务类型的超时上限
          2. 检查任务 timeout 是否超过上限
          3. 检查 timeout 是否合理（不低于 5 分钟）
        参数：
          - task_list: 任务项列表
        返回值：校验结果字典
        """
        issues: List[str] = []

        for task in task_list:
            timeout_cfg = self._TASK_TYPE_TIMEOUT_MAP.get(task.task_type, {})
            max_timeout = timeout_cfg.get("max", 120)

            # 检查是否超过上限
            if task.timeout > max_timeout:
                issues.append(
                    f"任务 {task.task_id}({task.task_name}) 的超时时间 {task.timeout} 分钟 "
                    f"超过任务类型 '{task.task_type}' 的上限 {max_timeout} 分钟"
                )

            # 检查是否过低（低于 5 分钟可能不合理）
            if task.timeout < 5:
                issues.append(
                    f"任务 {task.task_id}({task.task_name}) 的超时时间 {task.timeout} 分钟 "
                    f"过低，建议至少设置为 10 分钟"
                )

        return {
            "passed": len(issues) == 0,
            "issues": issues,
        }
