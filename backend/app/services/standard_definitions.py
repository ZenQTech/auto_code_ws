"""
# ============================================================
# 全流程核心概念与统计口径统一定义模块（V4.1 新增）
# ============================================================
# 核心作用：统一定义全流程中所有核心枚举类型、判定函数、数据类、
#           阶段校验点、关键词库，消除各模块间的概念不一致与重复定义，
#           确保全流程统计口径统一、判定标准一致
# 运行流程：
#   1. 各模块导入所需的枚举类型（ChangeLevel / DefectLevel / RiskLevel / HookType）
#   2. 调用判定函数 is_core_change() / is_architecture_defect() / classify_risk_level()
#      获取标准化判定结果
#   3. 阶段流转时引用 STAGE_CHECKPOINTS 校验点字典进行前置条件检查
#   4. Hook 事件触发时使用 HookPayload 数据类封装标准载荷结构
# 输入参数：
#   - is_core_change(changes, affected_module_count, context): 变更描述列表、影响模块数、上下文
#   - is_architecture_defect(defects): 缺陷列表
#   - classify_risk_level(module_name, module_description, task_type): 模块名、描述、任务类型
# 输出结果：
#   - is_core_change: Tuple[bool, List[str]]（是否核心变更, 命中的标准列表）
#   - is_architecture_defect: Tuple[bool, List[str]]（是否架构缺陷, 命中的标准列表）
#   - classify_risk_level: RiskLevel（风险等级枚举值）
# 修改记录：
#   - 2026-06-29 | v1.0.0 | 初始版本，统一定义 ChangeLevel、DefectLevel（架构级/代码级）、
#     RiskLevel、HookType 枚举，实现 is_core_change、is_architecture_defect、
#     classify_risk_level 判定函数，定义 StageCheckpoint、HookPayload 数据类，
#     预设 4 个阶段边界校验点，建立 3 组核心关键词库
# ============================================================
"""

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 枚举类型定义
# ============================================================

class ChangeLevel(str, Enum):
    """
    需求变更等级枚举
    用于判定需求变更的影响范围和严重程度，区分核心变更与局部变更
    取值：
      - CORE: 核心变更（影响整体架构设计、接口规范、全局约束、技术栈等）
      - LOCAL: 局部变更（仅影响部分模块的功能或实现细节）
    引用标准：Section 5.11 变更分级处理规则
    """
    CORE = "core"
    LOCAL = "local"


class DefectLevel(str, Enum):
    """
    缺陷等级枚举（SOP 5.11 标准 - 架构级/代码级二级分类）
    用于判定缺陷是架构层面问题还是代码层面问题，与架构批判器中的
    四等级缺陷（FATAL/SERIOUS/GENERAL/SUGGESTION）是不同维度：
      - 本枚举用于缺陷的层级分类（架构 vs 代码）
      - architecture_critic.DefectLevel 用于批判审查的严重程度分级
    取值：
      - ARCHITECTURE: 架构级缺陷（涉及模块间接口、系统架构设计、多模块联动）
      - CODE: 代码级缺陷（涉及单一模块内的实现细节、编码规范、逻辑错误）
    """
    ARCHITECTURE = "architecture"
    CODE = "code"


class RiskLevel(str, Enum):
    """
    任务风险等级枚举（三级界定标准）
    用于对开发任务进行风险等级分类，决定后续安全校验流程和资源分配
    取值：
      - VERY_HIGH: 极高风险（急停/安全保护/故障兜底/安全回路等安全关键模块）
      - HIGH: 高风险（运动控制/避障/轨迹生成/路径规划等控制核心模块）
      - GENERAL: 一般风险（运动学/传感器/状态估计/数据融合等感知计算模块）
      - LOW: 低风险（工具函数/数据预处理/辅助脚本等非核心模块）
    默认规则：边界模糊的模块一律标记为 HIGH
    """
    VERY_HIGH = "very_high"
    HIGH = "high"
    GENERAL = "general"
    LOW = "low"


class HookType(str, Enum):
    """
    Hook 信号类型枚举
    用于定义全流程中各个关键节点的 Hook 触发信号类型，
    确保事件通知机制的类型统一
    取值：
      - TASK_COMPLETE: 任务完成信号（单个任务执行完毕）
      - GIT_COMMIT: Git 提交信号（代码变更已提交到版本库）
      - CHECK_COMPLETE: 校验完成信号（阶段校验通过）
      - TEST_COMPLETE: 测试完成信号（测试全量通过）
    """
    TASK_COMPLETE = "task_complete"
    GIT_COMMIT = "git_commit"
    CHECK_COMPLETE = "check_complete"
    TEST_COMPLETE = "test_complete"


# ============================================================
# 核心关键词库
# ============================================================

# 核心变更判定关键词库
# 用于 is_core_change() 函数匹配变更描述中的核心变更特征
CORE_CHANGE_KEYWORDS: Dict[str, List[str]] = {
    # 标准1：系统核心技术栈/架构模式变更
    "tech_stack_architecture": [
        "技术栈", "架构模式", "技术选型", "技术架构", "系统架构",
        "分层架构", "微服务", "单体", "分布式", "中间件", "消息队列",
        "数据库", "缓存", "容器化", "虚拟化", "云原生", "框架更换",
        "编程语言", "运行时", "平台迁移", "技术路线",
        "tech_stack", "architecture_pattern", "microservice",
        "monolithic", "distributed", "middleware", "message_queue",
        "database", "cache", "containerization", "framework",
        "programming_language", "runtime", "platform_migration",
    ],
    # 标准2：核心功能模块新增/删除
    "core_module_change": [
        "新增模块", "删除模块", "核心功能", "新增功能", "移除功能",
        "模块拆分", "模块合并", "功能重组", "子系统",
        "new_module", "remove_module", "core_functionality",
        "module_split", "module_merge", "subsystem",
    ],
    # 标准3：核心算法选型与技术路径变更
    "algorithm_change": [
        "算法选型", "算法替换", "技术路径", "算法方案", "算法架构",
        "模型替换", "模型升级", "推理引擎", "深度学习", "机器学习",
        "algorithm_selection", "algorithm_replacement", "technical_route",
        "model_replacement", "inference_engine", "deep_learning",
    ],
    # 标准4：核心性能指标/环境约束/安全要求变更
    "performance_constraint_change": [
        "性能指标", "延迟要求", "吞吐量", "响应时间", "实时性",
        "环境约束", "硬件要求", "操作系统", "安全要求", "安全等级",
        "合规要求", "认证标准", "性能目标",
        "performance_metric", "latency_requirement", "throughput",
        "response_time", "real_time", "environment_constraint",
        "hardware_requirement", "safety_requirement", "compliance",
    ],
    # 标准5-6辅助：混合变更识别关键词
    "mixed_change": [
        "同时涉及", "混合变更", "既包括", "既涉及", "既包含",
        "全局影响", "跨模块", "多模块", "连锁影响", "级联变更",
        "mixed_change", "cross_module", "cascade", "global_impact",
    ],
}

# 架构级缺陷判定关键词库
# 用于 is_architecture_defect() 函数匹配缺陷描述中的架构级特征
ARCHITECTURE_DEFECT_KEYWORDS: Dict[str, List[str]] = {
    # 标准1：模块间接口设计错误/依赖关系矛盾
    "interface_dependency_error": [
        "接口设计", "接口定义", "接口不兼容", "接口冲突", "接口缺失",
        "依赖关系", "循环依赖", "依赖矛盾", "依赖缺失", "依赖冗余",
        "模块间通信", "消息格式", "数据契约", "API设计",
        "interface_design", "interface_incompatible", "circular_dependency",
        "dependency_conflict", "module_communication", "message_format",
        "data_contract", "api_design",
    ],
    # 标准2：系统整体架构无法满足性能/实时性/安全性要求
    "architecture_performance_safety": [
        "架构无法满足", "性能瓶颈", "实时性不足", "安全性不足",
        "架构缺陷", "设计缺陷", "系统瓶颈", "可扩展性", "可维护性",
        "architecture_insufficient", "performance_bottleneck",
        "real_time_insufficient", "safety_insufficient",
        "design_flaw", "system_bottleneck", "scalability",
    ],
    # 标准3：多模块联动逻辑存在系统性缺陷
    "multi_module_systematic_defect": [
        "多模块联动", "联动逻辑", "系统性缺陷", "模块协作", "数据流",
        "控制流", "事件传递", "状态同步", "时序问题", "竞态条件",
        "multi_module_interaction", "systematic_defect",
        "module_collaboration", "data_flow", "control_flow",
        "event_propagation", "state_synchronization", "race_condition",
    ],
    # 标准4：技术栈选型与场景不匹配
    "tech_stack_mismatch": [
        "技术栈不匹配", "选型不当", "场景不匹配", "技术不适合",
        "过度设计", "设计不足", "技术债务", "维护成本",
        "tech_stack_mismatch", "inappropriate_selection",
        "over_engineering", "under_engineering", "technical_debt",
    ],
}

# 风险等级分类关键词库
# 用于 classify_risk_level() 函数匹配模块描述中的风险特征
RISK_CLASSIFICATION_KEYWORDS: Dict[str, List[str]] = {
    "very_high": [
        "急停", "紧急停止", "emergency_stop", "e_stop", "安全保护",
        "故障兜底", "故障恢复", "fault_recovery", "安全状态", "safe_state",
        "紧急制动", "emergency_brake", "安全联锁", "safety_interlock",
        "看门狗", "watchdog", "心跳检测", "heartbeat", "安全回路",
        "碰撞检测", "collision_detection", "力限制", "force_limit",
        "安全限位", "safety_limit", "防护停止", "protective_stop",
    ],
    "high": [
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
    ],
    "general": [
        "运动学", "kinematics", "传感器", "sensor", "数据预处理",
        "data_preprocessing", "状态估计", "state_estimation", "卡尔曼",
        "kalman", "滤波", "filter", "融合", "fusion", "标定",
        "calibration", "里程计", "odometry", "定位", "localization",
        "建图", "mapping", "SLAM", "slam", "点云", "pointcloud",
        "图像处理", "image_processing", "特征提取", "feature_extraction",
        "坐标变换", "tf", "transform", "消息转换", "message_converter",
    ],
}


# ============================================================
# 判定函数
# ============================================================

def is_core_change(
    changes: List[str],
    affected_module_count: int,
    context: Dict[str, Any],
) -> Tuple[bool, List[str]]:
    """
    按 Section 5.11 定义的 6 条标准逐一判定是否为核心变更
    判定标准：
      1. 改变系统核心技术栈/架构模式
      2. 新增/删除核心功能模块
      3. 改变核心算法选型与技术路径
      4. 变更核心性能指标、环境约束、安全要求
      5. 局部变更影响 3 个及以上模块（含直接/间接影响）
      6. 混合变更同时包含核心与局部调整
    运行步骤：
      1. 合并所有变更描述文本为统一分析文本
      2. 逐标准匹配关键词库 CORE_CHANGE_KEYWORDS
      3. 标准 1-4：命中关键词则记录为标准命中
      4. 标准 5：检查 affected_module_count >= 3
      5. 标准 6：检查 context 中是否有混合变更标记
      6. 汇总所有命中标准，返回判定结果
    参数：
      - changes: List[str]，变更描述列表（每条变更的文本描述）
      - affected_module_count: int，受影响的模块数量（含直接/间接影响）
      - context: Dict[str, Any]，变更上下文信息
        {
          "has_mixed_change": bool,       # 是否包含混合变更标记
          "changed_interfaces": List[str], # 变更涉及的接口列表
          "change_description": str,       # 完整的变更描述
        }
    返回值：Tuple[bool, List[str]]
      - bool: 是否为核心变更
      - List[str]: 命中的标准编号与描述列表（如 ["标准1: 改变核心技术栈", "标准5: 影响>=3个模块"]）
    """
    # 合并所有变更描述为统一分析文本
    combined_text = " ".join(changes)
    if context:
        combined_text += " " + context.get("change_description", "")
        for iface in context.get("changed_interfaces", []):
            combined_text += " " + str(iface)

    combined_lower = combined_text.lower()
    hit_criteria: List[str] = []

    # 标准1：改变系统核心技术栈/架构模式
    kw_tech = CORE_CHANGE_KEYWORDS["tech_stack_architecture"]
    for kw in kw_tech:
        if kw.lower() in combined_lower:
            hit_criteria.append(f"标准1: 改变系统核心技术栈/架构模式（命中关键词: {kw}）")
            break

    # 标准2：新增/删除核心功能模块
    kw_module = CORE_CHANGE_KEYWORDS["core_module_change"]
    for kw in kw_module:
        if kw.lower() in combined_lower:
            hit_criteria.append(f"标准2: 新增/删除核心功能模块（命中关键词: {kw}）")
            break

    # 标准3：改变核心算法选型与技术路径
    kw_algo = CORE_CHANGE_KEYWORDS["algorithm_change"]
    for kw in kw_algo:
        if kw.lower() in combined_lower:
            hit_criteria.append(f"标准3: 改变核心算法选型与技术路径（命中关键词: {kw}）")
            break

    # 标准4：变更核心性能指标、环境约束、安全要求
    kw_perf = CORE_CHANGE_KEYWORDS["performance_constraint_change"]
    for kw in kw_perf:
        if kw.lower() in combined_lower:
            hit_criteria.append(f"标准4: 变更核心性能指标/环境约束/安全要求（命中关键词: {kw}）")
            break

    # 标准5：局部变更影响 3 个及以上模块（含直接/间接影响）
    if affected_module_count >= 3:
        hit_criteria.append(f"标准5: 局部变更影响 {affected_module_count} 个模块（>=3，含直接/间接影响）")

    # 标准6：混合变更同时包含核心与局部调整
    # 通过关键词匹配或 context 中的标记判断
    is_mixed = context.get("has_mixed_change", False) if context else False
    if not is_mixed:
        kw_mixed = CORE_CHANGE_KEYWORDS["mixed_change"]
        for kw in kw_mixed:
            if kw.lower() in combined_lower:
                is_mixed = True
                break
    if is_mixed:
        hit_criteria.append("标准6: 混合变更同时包含核心与局部调整")

    is_core = len(hit_criteria) > 0

    logger.info(
        "核心变更判定完成 | 结果=%s | 命中标准数=%d | 标准列表=%s",
        "核心变更" if is_core else "局部变更",
        len(hit_criteria),
        hit_criteria,
    )

    return is_core, hit_criteria


def is_architecture_defect(defects: List[Dict[str, Any]]) -> Tuple[bool, List[str]]:
    """
    按 4 条标准判定缺陷列表是否包含架构级缺陷
    判定标准：
      1. 模块间接口设计错误、依赖关系矛盾
      2. 系统整体架构无法满足性能/实时性/安全性要求
      3. 多模块联动逻辑存在系统性缺陷
      4. 技术栈选型与场景不匹配
    运行步骤：
      1. 遍历每个缺陷的 problem_description 和 influence_scope 字段
      2. 逐标准匹配关键词库 ARCHITECTURE_DEFECT_KEYWORDS
      3. 任一标准命中即判定为架构级缺陷
      4. 汇总所有命中的标准列表
    参数：
      - defects: List[Dict]，缺陷列表，每个缺陷包含：
        {
          "problem_description": str,   # 问题描述
          "influence_scope": str,       # 影响范围
          "root_cause_analysis": str,   # 根因分析（可选）
        }
    返回值：Tuple[bool, List[str]]
      - bool: 是否包含架构级缺陷
      - List[str]: 命中的标准编号与描述列表
    """
    if not defects:
        return False, []

    hit_criteria: List[str] = []
    # 收集所有缺陷描述文本
    combined_text_parts: List[str] = []
    for defect in defects:
        if isinstance(defect, dict):
            combined_text_parts.append(defect.get("problem_description", ""))
            combined_text_parts.append(defect.get("influence_scope", ""))
            combined_text_parts.append(defect.get("root_cause_analysis", ""))
    combined_text = " ".join(combined_text_parts).lower()

    # 标准1：模块间接口设计错误、依赖关系矛盾
    kw_interface = ARCHITECTURE_DEFECT_KEYWORDS["interface_dependency_error"]
    for kw in kw_interface:
        if kw.lower() in combined_text:
            hit_criteria.append(f"标准1: 模块间接口设计错误/依赖关系矛盾（命中关键词: {kw}）")
            break

    # 标准2：系统整体架构无法满足性能/实时性/安全性要求
    kw_perf = ARCHITECTURE_DEFECT_KEYWORDS["architecture_performance_safety"]
    for kw in kw_perf:
        if kw.lower() in combined_text:
            hit_criteria.append(f"标准2: 系统架构无法满足性能/实时性/安全性要求（命中关键词: {kw}）")
            break

    # 标准3：多模块联动逻辑存在系统性缺陷
    kw_multi = ARCHITECTURE_DEFECT_KEYWORDS["multi_module_systematic_defect"]
    for kw in kw_multi:
        if kw.lower() in combined_text:
            hit_criteria.append(f"标准3: 多模块联动逻辑存在系统性缺陷（命中关键词: {kw}）")
            break

    # 标准4：技术栈选型与场景不匹配
    kw_tech = ARCHITECTURE_DEFECT_KEYWORDS["tech_stack_mismatch"]
    for kw in kw_tech:
        if kw.lower() in combined_text:
            hit_criteria.append(f"标准4: 技术栈选型与场景不匹配（命中关键词: {kw}）")
            break

    is_arch = len(hit_criteria) > 0

    logger.info(
        "架构缺陷判定完成 | 结果=%s | 命中标准数=%d | 标准列表=%s",
        "架构级缺陷" if is_arch else "代码级缺陷",
        len(hit_criteria),
        hit_criteria,
    )

    return is_arch, hit_criteria


def classify_risk_level(
    module_name: str,
    module_description: str,
    task_type: str,
) -> RiskLevel:
    """
    按三级界定标准对模块进行风险等级分类
    分类规则：
      - VERY_HIGH: 急停/安全保护/故障兜底/安全回路等安全关键模块
      - HIGH: 运动控制/避障/轨迹生成/路径规划等控制核心模块
      - GENERAL: 运动学/传感器/状态估计/数据融合等感知计算模块
      - LOW: 其他非核心模块
    默认规则：边界模糊（同时命中多个等级关键词）时标记为 HIGH
    运行步骤：
      1. 合并模块名称、描述、任务类型为统一分析文本
      2. 按 VERY_HIGH → HIGH → GENERAL 优先级匹配关键词
      3. 统计各等级关键词命中次数
      4. 按优先级确定风险等级
      5. 边界模糊检测：同时命中多个等级时升级为 HIGH
      6. 无匹配时标记为 LOW
    参数：
      - module_name: str，模块名称
      - module_description: str，模块功能描述
      - task_type: str，任务类型（如 "核心算法开发"、"ROS工程化开发" 等）
    返回值：RiskLevel 枚举值
    """
    # 合并分析文本
    analysis_text = f"{module_name} {module_description} {task_type}".lower()

    # 统计各等级关键词命中次数
    very_high_hits = _count_keyword_hits(
        analysis_text, RISK_CLASSIFICATION_KEYWORDS["very_high"]
    )
    high_hits = _count_keyword_hits(
        analysis_text, RISK_CLASSIFICATION_KEYWORDS["high"]
    )
    general_hits = _count_keyword_hits(
        analysis_text, RISK_CLASSIFICATION_KEYWORDS["general"]
    )

    # 按优先级确定风险等级
    if very_high_hits > 0:
        risk_level = RiskLevel.VERY_HIGH
    elif high_hits > 0:
        risk_level = RiskLevel.HIGH
    elif general_hits > 0:
        risk_level = RiskLevel.GENERAL
    else:
        risk_level = RiskLevel.LOW

    # 边界模糊检测：同时命中多个等级的关键词时升级为 HIGH
    hit_levels = sum([
        1 if very_high_hits > 0 else 0,
        1 if high_hits > 0 else 0,
        1 if general_hits > 0 else 0,
    ])
    if hit_levels >= 2:
        original_level = risk_level
        risk_level = RiskLevel.HIGH
        logger.info(
            "模块 '%s' 边界模糊（命中 %d 个等级关键词），从 %s 升级为 %s",
            module_name, hit_levels, original_level.value, RiskLevel.HIGH.value,
        )

    logger.debug(
        "风险等级分类 | 模块=%s | 等级=%s | 极高命中=%d 高命中=%d 一般命中=%d",
        module_name, risk_level.value, very_high_hits, high_hits, general_hits,
    )

    return risk_level


def _count_keyword_hits(text: str, keywords: List[str]) -> int:
    """
    统计文本中关键词命中次数（内部辅助函数）
    运行步骤：
      1. 将文本转为小写进行不区分大小写匹配
      2. 遍历关键词列表，统计命中次数
    参数：
      - text: str，待分析文本（已转为小写）
      - keywords: List[str]，关键词列表
    返回值：int，命中次数
    """
    hits = 0
    for kw in keywords:
        if kw.lower() in text:
            hits += 1
    return hits


# ============================================================
# 数据类定义
# ============================================================

@dataclass
class StageCheckpoint:
    """
    阶段校验点数据类
    用于定义流程阶段间的校验点，包含必须存在的文档、必须的人工确认、
    前置条件和校验规则，确保阶段流转前满足所有前置要求
    字段说明：
      - stage_name: 阶段名称（如 "clarifying_to_designing"）
      - required_docs: 必须存在的文档字段列表（如 ["requirement_doc"]）
      - required_confirmations: 必须的人工确认列表（如 ["human_confirm_requirement"]）
      - pre_conditions: 前置条件描述列表（如 ["critique_iteration_passed"]）
      - validation_rules: 校验规则函数字典，key 为规则名称，value 为校验函数
    """
    stage_name: str = ""
    required_docs: List[str] = field(default_factory=list)
    required_confirmations: List[str] = field(default_factory=list)
    pre_conditions: List[str] = field(default_factory=list)
    validation_rules: Dict[str, Callable[[Dict[str, Any]], bool]] = field(default_factory=dict)


@dataclass
class HookPayload:
    """
    Hook 载荷标准结构数据类
    用于标准化各阶段 Hook 信号的数据载荷格式，确保事件通知机制的一致性
    字段说明：
      - hook_type: HookType，Hook 信号类型（任务完成/Git提交/校验完成/测试完成）
      - task_id: str，关联的任务 ID
      - module_name: str，关联的模块名称
      - status: str，当前状态描述（如 "success"、"failed"、"in_progress"）
      - data: Dict[str, Any]，附加数据载荷（如任务结果、校验报告等）
      - timestamp: str，事件时间戳（ISO 8601 格式）
    """
    hook_type: HookType = HookType.TASK_COMPLETE
    task_id: str = ""
    module_name: str = ""
    status: str = ""
    data: Dict[str, Any] = field(default_factory=dict)
    timestamp: str = ""


# ============================================================
# 阶段校验点预设
# ============================================================

# 阶段边界校验点字典
# 定义 4 个关键阶段边界的校验点，用于确保阶段流转前满足所有前置条件
# key: 阶段边界名称（"源阶段_to_目标阶段"格式）
# value: StageCheckpoint 对象，包含必需的文档、确认、前置条件、校验规则
STAGE_CHECKPOINTS: Dict[str, StageCheckpoint] = {
    # 阶段1: 需求澄清 → 架构设计
    # 必须有需求文档和人工确认需求
    "clarifying_to_designing": StageCheckpoint(
        stage_name="clarifying_to_designing",
        required_docs=["requirement_doc"],
        required_confirmations=["human_confirm_requirement"],
        pre_conditions=[],
        validation_rules={
            # 校验规则：需求文档必须非空且包含关键字段
            "requirement_doc_not_empty": lambda ctx: bool(
                ctx.get("requirement_doc") and len(str(ctx.get("requirement_doc", ""))) > 0
            ),
        },
    ),

    # 阶段2: 架构设计 → 提示词生成
    # 必须有规格文档、检查清单、任务文档、验收文档，且架构已通过人工确认
    # 前置条件：批判迭代已通过
    "designing_to_prompting": StageCheckpoint(
        stage_name="designing_to_prompting",
        required_docs=["spec_doc", "checklist_doc", "task_doc", "acceptance_doc"],
        required_confirmations=["human_confirm_architecture"],
        pre_conditions=["critique_iteration_passed"],
        validation_rules={
            # 校验规则：架构文档必须包含五章完整内容
            "architecture_five_chapters_complete": lambda ctx: all(
                ctx.get(ch, "") for ch in [
                    "chapter_1_system_architecture",
                    "chapter_2_module_interfaces",
                    "chapter_3_core_solutions",
                    "chapter_4_tech_stack",
                    "chapter_5_acceptance_criteria",
                ]
            ),
        },
    ),

    # 阶段3: 提示词生成 → 任务执行
    # 无必需文档和人工确认，但必须满足前置条件
    # 前置条件：提示词已优化、CLI 实例已注入
    "prompting_to_executing": StageCheckpoint(
        stage_name="prompting_to_executing",
        required_docs=[],
        required_confirmations=[],
        pre_conditions=["prompts_optimized", "cli_instances_injected"],
        validation_rules={
            # 校验规则：提示词列表非空
            "prompts_not_empty": lambda ctx: bool(
                ctx.get("optimized_prompts") and len(ctx.get("optimized_prompts", [])) > 0
            ),
            # 校验规则：CLI 实例已初始化
            "cli_instances_ready": lambda ctx: bool(ctx.get("cli_instances_ready", False)),
        },
    ),

    # 阶段4: 任务执行 → 代码审查
    # 无必需文档和人工确认，但必须满足前置条件
    # 前置条件：所有任务已完成、原子列表已清空、所有变更已提交
    "executing_to_reviewing": StageCheckpoint(
        stage_name="executing_to_reviewing",
        required_docs=[],
        required_confirmations=[],
        pre_conditions=["all_tasks_completed", "atomic_list_clear", "all_git_committed"],
        validation_rules={
            # 校验规则：所有任务状态为已完成
            "all_tasks_done": lambda ctx: all(
                t.get("status") == "completed"
                for t in ctx.get("task_list", [])
            ),
            # 校验规则：无未提交的 Git 变更
            "no_uncommitted_changes": lambda ctx: not ctx.get("has_uncommitted_changes", True),
        },
    ),
}
