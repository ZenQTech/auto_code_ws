"""
# ============================================================
# 后端核心服务 - 合规审查器
# ============================================================
# 核心作用：对核心阶段（架构设计、高风险模块代码、系统评测）
#           执行严格的合规审查，审查不通过时阻断下游流程，
#           并推送详细的校验失败信息
# 运行流程：
#   1. 接收审查目标（角色类型、输出内容、关联的格式/内容校验结果）
#   2. 判断当前阶段是否为核心阶段（需合规审查的阶段）
#   3. 执行合规审查（格式 + 内容 + 安全 + 项目规范四维度）
#   4. 若审查不通过，阻断下游流程并推送失败详情
#   5. 若审查通过，放行下游流程
# 输入参数：
#   - stage: str，当前阶段标识（architecture_design / coding_high_risk /
#            system_evaluation）
#   - content: str，阶段输出内容
#   - format_result: FormatValidationResult（可选），格式校验结果
#   - content_result: ContentValidationResult（可选），内容校验结果
#   - task_id: str（可选），关联任务 ID，用于日志追踪
# 输出结果：ComplianceReviewResult 对象，包含审查状态、阻断标记、失败详情
# 修改记录：
#   - 2026-06-24 | v1.0.0 | 初始版本，支持架构设计、高风险代码、
#     系统评测三个核心阶段的合规审查
# ============================================================
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

from backend.app.config import settings

logger = logging.getLogger(__name__)


# ============================================================
# 枚举与数据结构定义
# ============================================================

class ReviewStatus(str, Enum):
    """
    合规审查状态枚举
    取值：
      - APPROVED: 审查通过，允许下游流程继续
      - REJECTED: 审查不通过，阻断下游流程
      - PENDING_MANUAL: 需要人工审核
      - ERROR: 审查过程异常
    """
    APPROVED = "approved"
    REJECTED = "rejected"
    PENDING_MANUAL = "pending_manual"
    ERROR = "error"


class ReviewDimension(str, Enum):
    """
    审查维度枚举
    取值：
      - FORMAT: 格式规范审查
      - CONTENT: 内容质量审查
      - SECURITY: 安全合规审查
      - PROJECT_SPEC: 项目专属规范审查
    """
    FORMAT = "format"
    CONTENT = "content"
    SECURITY = "security"
    PROJECT_SPEC = "project_spec"


@dataclass
class ReviewFailure:
    """
    审查失败详情
    字段说明：
      - dimension: 失败维度
      - rule_id: 违反的规则 ID
      - rule_name: 规则名称
      - description: 失败描述
      - severity: 严重程度（critical / high / medium / low）
      - evidence: 违规证据（截取相关文本片段）
      - fix_suggestion: 修复建议
    """
    dimension: str = ""
    rule_id: str = ""
    rule_name: str = ""
    description: str = ""
    severity: str = "medium"
    evidence: str = ""
    fix_suggestion: str = ""


@dataclass
class ComplianceReviewResult:
    """
    合规审查结果
    字段说明：
      - status: 审查状态（approved / rejected / pending_manual / error）
      - stage: 审查的阶段
      - task_id: 关联任务 ID
      - is_blocked: 是否阻断下游流程
      - score: 综合评分（0-100）
      - dimension_scores: 各维度评分
      - failures: 失败详情列表
      - summary: 审查摘要
      - reviewed_at: 审查时间戳
      - reviewer_version: 审查器版本
    """
    status: ReviewStatus = ReviewStatus.APPROVED
    stage: str = ""
    task_id: str = ""
    is_blocked: bool = False
    score: float = 100.0
    dimension_scores: Dict[str, float] = field(default_factory=dict)
    failures: List[ReviewFailure] = field(default_factory=list)
    summary: str = ""
    reviewed_at: str = ""
    reviewer_version: str = "1.0.0"


# ============================================================
# 核心阶段定义与审查规则
# ============================================================

# 需要合规审查的核心阶段
CORE_STAGES: List[str] = [
    "architecture_design",   # 架构设计阶段
    "coding_high_risk",      # 高风险模块代码阶段
    "system_evaluation",     # 系统评测阶段
]

# 架构设计阶段审查规则
ARCHITECTURE_REVIEW_RULES: List[Dict[str, Any]] = [
    {
        "rule_id": "ARCH-001",
        "name": "模块划分合理性",
        "description": "架构设计必须包含清晰的模块划分，每个模块职责单一、边界明确",
        "dimension": ReviewDimension.CONTENT,
        "severity": "high",
        "check_pattern": r'模块|组件|module|component',
    },
    {
        "rule_id": "ARCH-002",
        "name": "接口定义完整性",
        "description": "必须明确定义模块间的接口规范、数据格式、通信协议",
        "dimension": ReviewDimension.CONTENT,
        "severity": "high",
        "check_pattern": r'接口|API|interface|协议|protocol',
    },
    {
        "rule_id": "ARCH-003",
        "name": "技术选型合规性",
        "description": "技术选型必须符合项目技术栈约束（ROS/ROS2、C++/Python）",
        "dimension": ReviewDimension.PROJECT_SPEC,
        "severity": "critical",
        "check_pattern": r'ROS|C\+\+|Python|技术栈|依赖',
    },
    {
        "rule_id": "ARCH-004",
        "name": "安全架构设计",
        "description": "架构设计必须包含安全机制设计（急停、故障兜底、权限控制）",
        "dimension": ReviewDimension.SECURITY,
        "severity": "critical",
        "check_pattern": r'安全|急停|故障|兜底|权限|security|safety',
    },
    {
        "rule_id": "ARCH-005",
        "name": "数据流设计完整性",
        "description": "必须包含完整的数据流设计，明确数据来源、处理、存储、输出",
        "dimension": ReviewDimension.CONTENT,
        "severity": "medium",
        "check_pattern": r'数据流|数据流向|数据流转|data.?flow',
    },
    {
        "rule_id": "ARCH-006",
        "name": "实时性约束说明",
        "description": "机器人控制系统架构必须说明实时性约束与线程优先级设计",
        "dimension": ReviewDimension.PROJECT_SPEC,
        "severity": "high",
        "check_pattern": r'实时|线程|优先级|realtime|thread|priority',
    },
]

# 高风险模块代码审查规则
HIGH_RISK_CODE_REVIEW_RULES: List[Dict[str, Any]] = [
    {
        "rule_id": "HRC-001",
        "name": "禁止动态内存分配",
        "description": "实时控制循环代码中严禁动态内存分配/释放（new/delete/malloc/free）",
        "dimension": ReviewDimension.SECURITY,
        "severity": "critical",
        "check_pattern": r'\b(new|delete|malloc|free|realloc|calloc)\s*[\(<]',
    },
    {
        "rule_id": "HRC-002",
        "name": "禁止阻塞调用",
        "description": "实时控制循环中严禁阻塞调用（sleep、wait、锁等待）",
        "dimension": ReviewDimension.SECURITY,
        "severity": "critical",
        "check_pattern": r'\b(sleep|usleep|nanosleep|wait|lock|mutex)\s*\(',
    },
    {
        "rule_id": "HRC-003",
        "name": "禁止文件 IO",
        "description": "实时控制循环中严禁文件 IO 操作（fopen、fwrite、fprintf）",
        "dimension": ReviewDimension.SECURITY,
        "severity": "critical",
        "check_pattern": r'\b(fopen|fwrite|fread|fprintf|fscanf|ofstream|ifstream)\b',
    },
    {
        "rule_id": "HRC-004",
        "name": "双层极限值约束",
        "description": "运动控制指令必须包含双层极限值约束和输出限幅",
        "dimension": ReviewDimension.SECURITY,
        "severity": "critical",
        "check_pattern": r'(?:limit|clamp|bound|约束|限幅|max|min)',
    },
    {
        "rule_id": "HRC-005",
        "name": "输入合法性校验",
        "description": "传感器数据使用前必须进行有效性校验和异常兜底",
        "dimension": ReviewDimension.SECURITY,
        "severity": "critical",
        "check_pattern": r'(?:valid|校验|检查|check|isnan|isfinite|isinf)',
    },
    {
        "rule_id": "HRC-006",
        "name": "禁止日志打印",
        "description": "高频循环/实时回调中严禁打印 DEBUG/INFO 级别日志",
        "dimension": ReviewDimension.PROJECT_SPEC,
        "severity": "high",
        "check_pattern": r'\b(ROS_DEBUG|ROS_INFO|std::cout|printf|logger\.debug|logger\.info|print)\b',
    },
    {
        "rule_id": "HRC-007",
        "name": "参数配置化",
        "description": "核心算法参数必须通过 ROS 参数服务器或 YAML 配置文件管理，禁止硬编码",
        "dimension": ReviewDimension.PROJECT_SPEC,
        "severity": "high",
        "check_pattern": r'(?:rosparam|param|config|yaml|参数)',
    },
    {
        "rule_id": "HRC-008",
        "name": "急停逻辑完整性",
        "description": "高风险模块必须包含完整的急停逻辑和故障恢复机制",
        "dimension": ReviewDimension.SECURITY,
        "severity": "critical",
        "check_pattern": r'(?:急停|emergency|estop|shutdown|halt|abort)',
    },
]

# 系统评测阶段审查规则
SYSTEM_EVALUATION_REVIEW_RULES: List[Dict[str, Any]] = [
    {
        "rule_id": "EVAL-001",
        "name": "功能完整性评测",
        "description": "必须对需求功能的实现完整度进行逐项评测",
        "dimension": ReviewDimension.CONTENT,
        "severity": "high",
        "check_pattern": r'功能|需求|覆盖|completeness|coverage',
    },
    {
        "rule_id": "EVAL-002",
        "name": "安全评测完整性",
        "description": "必须包含安全机制有效性验证（故障注入、急停触发、极限工况）",
        "dimension": ReviewDimension.SECURITY,
        "severity": "critical",
        "check_pattern": r'安全|故障注入|急停|极限|security|fault.?injection',
    },
    {
        "rule_id": "EVAL-003",
        "name": "性能评测完整性",
        "description": "必须包含实时性、延迟、吞吐量等性能指标评测",
        "dimension": ReviewDimension.CONTENT,
        "severity": "high",
        "check_pattern": r'性能|延迟|吞吐|实时|performance|latency|throughput',
    },
    {
        "rule_id": "EVAL-004",
        "name": "鲁棒性评测",
        "description": "必须包含异常工况下的系统稳定性评测",
        "dimension": ReviewDimension.CONTENT,
        "severity": "high",
        "check_pattern": r'鲁棒|稳定|异常|容错|robust|stability|fault.?tolerant',
    },
    {
        "rule_id": "EVAL-005",
        "name": "评测结论明确性",
        "description": "评测结论必须明确（通过/不通过），不得含糊其辞",
        "dimension": ReviewDimension.FORMAT,
        "severity": "critical",
        "check_pattern": r'通过|不通过|PASSED|FAILED|结论',
    },
    {
        "rule_id": "EVAL-006",
        "name": "问题汇总完整性",
        "description": "评测发现的所有问题必须汇总并分级（严重/一般/建议）",
        "dimension": ReviewDimension.CONTENT,
        "severity": "medium",
        "check_pattern": r'问题|缺陷|严重|issue|defect|severity',
    },
]

# 阶段到审查规则的映射
STAGE_RULES_MAP: Dict[str, List[Dict[str, Any]]] = {
    "architecture_design": ARCHITECTURE_REVIEW_RULES,
    "coding_high_risk": HIGH_RISK_CODE_REVIEW_RULES,
    "system_evaluation": SYSTEM_EVALUATION_REVIEW_RULES,
}

# 各阶段的审查通过阈值
STAGE_PASS_THRESHOLD: Dict[str, float] = {
    "architecture_design": 80.0,
    "coding_high_risk": 90.0,  # 高风险代码要求更严格
    "system_evaluation": 80.0,
}


# ============================================================
# 合规审查器主类
# ============================================================

class ComplianceReviewer:
    """
    合规审查器
    作用：对核心阶段执行严格的合规审查，不通过时阻断下游流程
    调用方：调度引擎（scheduler）、任务执行引擎
    被调用方：FormatValidator、ContentValidator（可选的依赖模块）
    """

    def __init__(self):
        """
        初始化合规审查器
        运行步骤：
          1. 加载安全配置
          2. 加载架构配置（最大批判迭代次数）
          3. 初始化日志记录器
        """
        self._security_config = settings.security
        self._architecture_config = settings.architecture
        self._max_review_iterations = self._security_config.get(
            "max_review_iterations", 3
        )
        self._max_critic_iterations = self._architecture_config.get(
            "max_critic_iterations", 3
        )
        logger.info(
            f"合规审查器初始化完成，"
            f"最大审查迭代: {self._max_review_iterations}，"
            f"最大批判迭代: {self._max_critic_iterations}"
        )

    def review(
        self,
        stage: str,
        content: str,
        format_result: Optional[Any] = None,
        content_result: Optional[Any] = None,
        task_id: str = "",
    ) -> ComplianceReviewResult:
        """
        执行合规审查
        运行步骤：
          1. 校验阶段是否为核心阶段
          2. 校验内容非空
          3. 加载该阶段的审查规则
          4. 逐规则执行审查
          5. 汇总失败项并计算评分
          6. 判定是否阻断下游流程
          7. 返回审查结果
        参数：
          - stage: 当前阶段标识
          - content: 阶段输出内容
          - format_result: 格式校验结果（可选）
          - content_result: 内容校验结果（可选）
          - task_id: 关联任务 ID
        返回值：ComplianceReviewResult 对象
        """
        # 步骤 1：校验阶段是否为核心阶段
        if stage not in CORE_STAGES:
            logger.info(f"阶段 '{stage}' 非核心阶段，跳过合规审查")
            return ComplianceReviewResult(
                status=ReviewStatus.APPROVED,
                stage=stage,
                task_id=task_id,
                is_blocked=False,
                score=100.0,
                summary=f"阶段 '{stage}' 非核心阶段，无需合规审查",
                reviewed_at=datetime.now(timezone.utc).isoformat(),
            )

        # 步骤 2：校验内容非空
        if not content or not content.strip():
            return ComplianceReviewResult(
                status=ReviewStatus.REJECTED,
                stage=stage,
                task_id=task_id,
                is_blocked=True,
                score=0.0,
                failures=[
                    ReviewFailure(
                        dimension=ReviewDimension.CONTENT,
                        rule_id="GEN-001",
                        rule_name="内容为空",
                        description="阶段输出内容为空，无法执行合规审查",
                        severity="critical",
                        evidence="空内容",
                        fix_suggestion="请确保阶段输出非空的文本内容",
                    )
                ],
                summary="输出内容为空，合规审查不通过，下游流程已阻断",
                reviewed_at=datetime.now(timezone.utc).isoformat(),
            )

        # 步骤 3：加载审查规则
        rules = STAGE_RULES_MAP.get(stage, [])
        if not rules:
            logger.warning(f"阶段 '{stage}' 无对应的审查规则")
            return ComplianceReviewResult(
                status=ReviewStatus.APPROVED,
                stage=stage,
                task_id=task_id,
                is_blocked=False,
                score=100.0,
                summary=f"阶段 '{stage}' 无审查规则，默认通过",
                reviewed_at=datetime.now(timezone.utc).isoformat(),
            )

        # 步骤 4：逐规则执行审查
        failures: List[ReviewFailure] = []
        dimension_scores: Dict[str, float] = {
            ReviewDimension.FORMAT: 100.0,
            ReviewDimension.CONTENT: 100.0,
            ReviewDimension.SECURITY: 100.0,
            ReviewDimension.PROJECT_SPEC: 100.0,
        }

        # 汇总格式校验和内容校验的结果
        if format_result is not None:
            format_failures = self._convert_format_result(format_result)
            failures.extend(format_failures)

        if content_result is not None:
            content_failures = self._convert_content_result(content_result)
            failures.extend(content_failures)

        # 执行阶段专属规则审查
        for rule in rules:
            rule_failures = self._evaluate_rule(rule, content)
            failures.extend(rule_failures)

        # 步骤 5：计算各维度评分
        dimension_scores = self._calculate_dimension_scores(failures)

        # 计算综合评分（各维度等权平均）
        if dimension_scores:
            overall_score = round(
                sum(dimension_scores.values()) / len(dimension_scores), 1
            )
        else:
            overall_score = 100.0

        # 步骤 6：判定是否阻断
        pass_threshold = STAGE_PASS_THRESHOLD.get(stage, 80.0)
        has_critical = any(f.severity == "critical" for f in failures)
        is_blocked = overall_score < pass_threshold or has_critical

        # 判定审查状态
        if has_critical:
            status = ReviewStatus.REJECTED
        elif overall_score < pass_threshold:
            status = ReviewStatus.REJECTED
        elif failures:
            # 有非关键问题但评分达标 -> 需要人工确认
            status = ReviewStatus.PENDING_MANUAL
        else:
            status = ReviewStatus.APPROVED

        # 步骤 7：构建结果
        stage_display_names = {
            "architecture_design": "架构设计",
            "coding_high_risk": "高风险模块代码",
            "system_evaluation": "系统评测",
        }
        stage_display = stage_display_names.get(stage, stage)

        if is_blocked:
            summary = (
                f"【{stage_display}】合规审查不通过，下游流程已阻断。"
                f"综合评分: {overall_score:.1f}，"
                f"通过阈值: {pass_threshold:.1f}，"
                f"失败项: {len(failures)} 项"
            )
            logger.warning(f"合规审查阻断: {summary}")
        else:
            summary = (
                f"【{stage_display}】合规审查通过。"
                f"综合评分: {overall_score:.1f}"
            )

        return ComplianceReviewResult(
            status=status,
            stage=stage,
            task_id=task_id,
            is_blocked=is_blocked,
            score=overall_score,
            dimension_scores=dimension_scores,
            failures=failures,
            summary=summary,
            reviewed_at=datetime.now(timezone.utc).isoformat(),
        )

    def get_blocked_downstream_stages(self, stage: str) -> List[str]:
        """
        获取被阻断的下游阶段列表
        运行步骤：
          1. 根据当前阶段查找其下游依赖阶段
          2. 返回所有受影响的下游阶段
        参数：
          - stage: 当前被阻断的阶段
        返回值：下游阶段标识列表
        """
        # 定义阶段依赖链
        stage_chain = [
            "requirement_clarification",
            "architecture_design",
            "task_planning",
            "coding",
            "coding_high_risk",
            "security_check",
            "test_script",
            "integration_check",
            "system_evaluation",
            "delivery_archive",
        ]

        try:
            current_idx = stage_chain.index(stage)
            downstream = stage_chain[current_idx + 1:]
            logger.info(
                f"阶段 '{stage}' 阻断，下游受影响阶段: {downstream}"
            )
            return downstream
        except ValueError:
            # 非标准阶段名称，尝试映射
            stage_mapping = {
                "architecture_design": 1,
                "coding_high_risk": 4,
                "system_evaluation": 8,
            }
            idx = stage_mapping.get(stage, -1)
            if idx >= 0:
                downstream = stage_chain[idx + 1:]
                return downstream
            return []

    def push_failure_details(
        self,
        result: ComplianceReviewResult,
    ) -> Dict[str, Any]:
        """
        推送审查失败详情（供调度引擎和通知系统使用）
        运行步骤：
          1. 检查审查是否被阻断
          2. 构建结构化的失败详情
          3. 按严重程度分组
          4. 生成修复建议汇总
        参数：
          - result: 合规审查结果
        返回值：结构化的失败详情字典
        """
        if not result.is_blocked:
            return {
                "blocked": False,
                "message": "审查通过，无需推送失败详情",
            }

        # 按严重程度分组
        critical_failures = [
            f for f in result.failures if f.severity == "critical"
        ]
        high_failures = [
            f for f in result.failures if f.severity == "high"
        ]
        medium_failures = [
            f for f in result.failures if f.severity == "medium"
        ]
        low_failures = [
            f for f in result.failures if f.severity == "low"
        ]

        # 构建推送详情
        details: Dict[str, Any] = {
            "blocked": True,
            "stage": result.stage,
            "task_id": result.task_id,
            "reviewed_at": result.reviewed_at,
            "overall_score": result.score,
            "dimension_scores": result.dimension_scores,
            "failure_summary": {
                "total": len(result.failures),
                "critical": len(critical_failures),
                "high": len(high_failures),
                "medium": len(medium_failures),
                "low": len(low_failures),
            },
            "critical_failures": [
                {
                    "dimension": f.dimension,
                    "rule_id": f.rule_id,
                    "rule_name": f.rule_name,
                    "description": f.description,
                    "evidence": f.evidence[:200],
                    "fix_suggestion": f.fix_suggestion,
                }
                for f in critical_failures
            ],
            "high_failures": [
                {
                    "dimension": f.dimension,
                    "rule_id": f.rule_id,
                    "rule_name": f.rule_name,
                    "description": f.description,
                    "fix_suggestion": f.fix_suggestion,
                }
                for f in high_failures
            ],
            "downstream_blocked_stages": self.get_blocked_downstream_stages(
                result.stage
            ),
            "recommended_actions": self._generate_recommended_actions(
                result.failures
            ),
        }

        logger.warning(
            f"推送合规审查失败详情: "
            f"阶段={result.stage}, "
            f"严重={len(critical_failures)}, "
            f"高={len(high_failures)}, "
            f"中={len(medium_failures)}"
        )

        return details

    # ============================================================
    # 规则评估方法
    # ============================================================

    def _evaluate_rule(
        self,
        rule: Dict[str, Any],
        content: str,
    ) -> List[ReviewFailure]:
        """
        评估单条审查规则
        运行步骤：
          1. 使用规则的正则模式匹配内容
          2. 若匹配成功（符合要求），返回空列表
          3. 若匹配失败（不符合要求），生成 ReviewFailure
        参数：
          - rule: 审查规则定义
          - content: 审查内容
        返回值：失败项列表（符合规则时为空）
        """
        failures: List[ReviewFailure] = []
        rule_id = rule["rule_id"]
        rule_name = rule["name"]
        description = rule["description"]
        dimension = rule.get("dimension", ReviewDimension.CONTENT)
        severity = rule.get("severity", "medium")
        check_pattern = rule.get("check_pattern", "")

        if not check_pattern:
            return failures

        # 检查内容是否满足规则要求
        match = re.search(check_pattern, content, re.IGNORECASE)

        if not match:
            # 内容不满足规则要求，生成失败项
            failures.append(
                ReviewFailure(
                    dimension=str(dimension),
                    rule_id=rule_id,
                    rule_name=rule_name,
                    description=description,
                    severity=severity,
                    evidence=f"未在输出中找到与 '{rule_name}' 相关的内容",
                    fix_suggestion=(
                        f"请在输出中补充 {rule_name} 相关内容：{description}"
                    ),
                )
            )

        return failures

    # ============================================================
    # 结果转换方法
    # ============================================================

    def _convert_format_result(self, format_result: Any) -> List[ReviewFailure]:
        """
        将格式校验结果转换为合规审查失败项
        运行步骤：
          1. 检查格式校验状态
          2. 将格式问题映射为审查失败项
        参数：
          - format_result: FormatValidationResult 对象
        返回值：ReviewFailure 列表
        """
        failures: List[ReviewFailure] = []

        # 尝试访问 format_result 的属性
        try:
            status = getattr(format_result, "status", None)
            if status is not None:
                status_str = str(status)
                if status_str in ("failed", "FAILED"):
                    failures.append(
                        ReviewFailure(
                            dimension=ReviewDimension.FORMAT,
                            rule_id="FMT-001",
                            rule_name="格式校验不通过",
                            description="角色输出格式不符合统一输出规范",
                            severity="high",
                            evidence=getattr(format_result, "summary", ""),
                            fix_suggestion="请按照统一输出规范修正输出格式",
                        )
                    )

            # 提取具体问题
            issues = getattr(format_result, "issues", [])
            for issue in issues:
                severity = getattr(issue, "severity", "warning")
                description = getattr(issue, "description", "")
                chapter = getattr(issue, "chapter", "")
                expected = getattr(issue, "expected", "")
                actual = getattr(issue, "actual", "")

                failures.append(
                    ReviewFailure(
                        dimension=ReviewDimension.FORMAT,
                        rule_id="FMT-002",
                        rule_name=f"格式问题: {chapter}",
                        description=description,
                        severity=severity if severity == "error" else "medium",
                        evidence=f"期望: {expected}，实际: {actual}",
                        fix_suggestion=f"请修正「{chapter}」章节的格式问题",
                    )
                )
        except Exception as e:
            logger.warning(f"转换格式校验结果时出错: {e}")

        return failures

    def _convert_content_result(self, content_result: Any) -> List[ReviewFailure]:
        """
        将内容校验结果转换为合规审查失败项
        运行步骤：
          1. 检查内容校验状态
          2. 将内容问题映射为审查失败项
        参数：
          - content_result: ContentValidationResult 对象
        返回值：ReviewFailure 列表
        """
        failures: List[ReviewFailure] = []

        try:
            status = getattr(content_result, "status", None)
            if status is not None:
                status_str = str(status)
                if status_str in ("failed", "FAILED"):
                    failures.append(
                        ReviewFailure(
                            dimension=ReviewDimension.CONTENT,
                            rule_id="CNT-001",
                            rule_name="内容校验不通过",
                            description="角色输出内容存在完整性、一致性或合规性问题",
                            severity="high",
                            evidence=getattr(content_result, "summary", ""),
                            fix_suggestion="请根据内容校验结果修正输出内容",
                        )
                    )

            issues = getattr(content_result, "issues", [])
            for issue in issues:
                severity = getattr(issue, "severity", "warning")
                description = getattr(issue, "description", "")
                dimension = getattr(issue, "dimension", "completeness")
                suggestion = getattr(issue, "suggestion", "")

                failures.append(
                    ReviewFailure(
                        dimension=dimension,
                        rule_id="CNT-002",
                        rule_name=f"内容问题",
                        description=description,
                        severity=severity if severity == "error" else "medium",
                        evidence="",
                        fix_suggestion=suggestion,
                    )
                )
        except Exception as e:
            logger.warning(f"转换内容校验结果时出错: {e}")

        return failures

    # ============================================================
    # 辅助方法
    # ============================================================

    def _calculate_dimension_scores(
        self,
        failures: List[ReviewFailure],
    ) -> Dict[str, float]:
        """
        计算各维度的审查评分
        运行步骤：
          1. 按维度分组失败项
          2. 每个维度独立计算扣分
          3. critical 扣 30 分，high 扣 20 分，medium 扣 10 分，low 扣 5 分
        参数：
          - failures: 失败项列表
        返回值：各维度评分字典
        """
        # 初始化所有维度为满分
        scores: Dict[str, float] = {
            ReviewDimension.FORMAT: 100.0,
            ReviewDimension.CONTENT: 100.0,
            ReviewDimension.SECURITY: 100.0,
            ReviewDimension.PROJECT_SPEC: 100.0,
        }

        # 按维度分组
        dimension_failures: Dict[str, List[ReviewFailure]] = {}
        for f in failures:
            dim = f.dimension
            if dim not in dimension_failures:
                dimension_failures[dim] = []
            dimension_failures[dim].append(f)

        # 计算每个维度的扣分
        severity_deduction = {
            "critical": 30,
            "high": 20,
            "medium": 10,
            "low": 5,
        }

        for dim, dim_failures in dimension_failures.items():
            deduction = sum(
                severity_deduction.get(f.severity, 10) for f in dim_failures
            )
            scores[dim] = max(0.0, 100.0 - deduction)

        return scores

    def _generate_recommended_actions(
        self,
        failures: List[ReviewFailure],
    ) -> List[str]:
        """
        生成修复建议汇总
        运行步骤：
          1. 提取所有失败项的修复建议
          2. 去重并排序（按严重程度）
          3. 返回建议列表
        参数：
          - failures: 失败项列表
        返回值：修复建议列表
        """
        actions: List[str] = []
        seen: set = set()

        # 按严重程度排序：critical > high > medium > low
        severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        sorted_failures = sorted(
            failures, key=lambda f: severity_order.get(f.severity, 99)
        )

        for f in sorted_failures:
            if f.fix_suggestion and f.fix_suggestion not in seen:
                actions.append(f"[{f.severity.upper()}] {f.fix_suggestion}")
                seen.add(f.fix_suggestion)

        return actions
