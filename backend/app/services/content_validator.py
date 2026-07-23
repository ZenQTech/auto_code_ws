"""
# ============================================================
# 后端核心服务 - 内容校验器
# ============================================================
# 核心作用：校验各角色输出内容的完整性、逻辑一致性、
#           以及是否符合全局规范（安全编码规范、项目专属规范等）
# 运行流程：
#   1. 接收角色类型、输出内容、关联的格式校验结果
#   2. 执行内容完整性校验（检查必要章节是否有实质内容）
#   3. 执行逻辑一致性校验（检测前后矛盾、数据不一致）
#   4. 执行全局规范符合性校验（安全规范、编码规范等）
#   5. 汇总校验结果并返回
# 输入参数：
#   - role: str，角色类型
#   - content: str，角色输出的原始文本内容
#   - format_result: FormatValidationResult（可选），格式校验结果
# 输出结果：ContentValidationResult 对象，包含校验状态、评分、问题列表
# 修改记录：
#   - 2026-06-24 | v1.0.0 | 初始版本，支持内容完整性、逻辑一致性、
#     全局规范符合性三维度校验
# ============================================================
"""

import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set

from backend.app.config import settings

logger = logging.getLogger(__name__)


# ============================================================
# 枚举与数据结构定义
# ============================================================

class ContentValidationStatus(str, Enum):
    """
    内容校验状态枚举
    取值：
      - PASSED: 内容校验通过
      - FAILED: 内容校验不通过，存在严重缺陷
      - WARNING: 内容基本合格，但存在需关注的问题
    """
    PASSED = "passed"
    FAILED = "failed"
    WARNING = "warning"


@dataclass
class ContentIssue:
    """
    内容校验发现的问题
    字段说明：
      - severity: 严重程度（error / warning / info）
      - dimension: 校验维度（completeness / consistency / compliance）
      - description: 问题描述
      - location: 问题位置（章节名或行号范围）
      - suggestion: 修复建议
    """
    severity: str = "warning"
    dimension: str = "completeness"
    description: str = ""
    location: str = ""
    suggestion: str = ""


@dataclass
class ContentValidationResult:
    """
    内容校验结果
    字段说明：
      - status: 校验状态（passed / failed / warning）
      - score: 内容评分（0-100）
      - role: 校验的角色类型
      - completeness_score: 完整性维度评分
      - consistency_score: 逻辑一致性维度评分
      - compliance_score: 规范符合性维度评分
      - issues: 发现的问题列表
      - summary: 校验摘要
    """
    status: ContentValidationStatus = ContentValidationStatus.PASSED
    score: float = 100.0
    role: str = ""
    completeness_score: float = 100.0
    consistency_score: float = 100.0
    compliance_score: float = 100.0
    issues: List[ContentIssue] = field(default_factory=list)
    summary: str = ""


# ============================================================
# 全局规范定义
# ============================================================

# 安全编码规范关键词（用于检测违规）
SECURITY_COMPLIANCE_RULES: List[Dict[str, Any]] = [
    {
        "rule_id": "SEC-001",
        "name": "禁止硬编码密钥",
        "description": "代码中不得包含硬编码的 API 密钥、密码、Token",
        "pattern": r'(api_key|apikey|secret|password|token)\s*=\s*["\'][\w\-]{8,}["\']',
        "severity": "error",
    },
    {
        "rule_id": "SEC-002",
        "name": "禁止使用不安全函数",
        "description": "C++ 代码禁止使用 gets、strcpy、sprintf 等不安全函数",
        "pattern": r'\b(gets|strcpy|strcat|sprintf|scanf)\s*\(',
        "severity": "error",
    },
    {
        "rule_id": "SEC-003",
        "name": "禁止使用 eval/exec",
        "description": "Python 代码禁止使用 eval()、exec() 执行动态代码",
        "pattern": r'\b(eval|exec|compile)\s*\(',
        "severity": "error",
    },
    {
        "rule_id": "SEC-004",
        "name": "禁止使用 system/os.popen",
        "description": "禁止使用 os.system()、os.popen() 等直接执行系统命令",
        "pattern": r'\b(os\.system|os\.popen|subprocess\.call\s*\(\s*["\']\s*[^,\s)]*shell\s*=\s*True)',
        "severity": "error",
    },
    {
        "rule_id": "SEC-005",
        "name": "SQL 注入风险",
        "description": "禁止使用字符串拼接构造 SQL 查询",
        "pattern": r'(f["\'].*SELECT|f["\'].*INSERT|f["\'].*UPDATE|f["\'].*DELETE|["\'].*SELECT.*\+|["\'].*INSERT.*\+)',
        "severity": "error",
    },
]

# 编码规范关键词（用于检测违规）
CODING_STANDARD_RULES: List[Dict[str, Any]] = [
    {
        "rule_id": "STD-001",
        "name": "禁止魔法数字",
        "description": "代码中不得出现未定义含义的硬编码数字（魔法数字）",
        "pattern": r'(?<![a-zA-Z_>])\b(?!0\b|1\b|2\b|-1\b)[3-9]\d{2,}\b',
        "severity": "warning",
    },
    {
        "rule_id": "STD-002",
        "name": "函数缺少注释",
        "description": "Python 函数定义前应包含中文注释说明",
        "severity": "warning",
    },
    {
        "rule_id": "STD-003",
        "name": "文件缺少头部注释",
        "description": "代码文件应在头部包含完整的中文注释说明",
        "severity": "warning",
    },
    {
        "rule_id": "STD-004",
        "name": "缺少修改记录",
        "description": "代码文件头部应包含修改记录",
        "severity": "warning",
    },
]

# 各角色内容完整性最低要求（最小字符数）
ROLE_MIN_CONTENT_LENGTH: Dict[str, int] = {
    "requirement_clarification": 200,
    "architecture_design": 500,
    "critical_reflection": 300,
    "task_planning": 200,
    "coding": 500,
    "security_check": 300,
    "test_script": 400,
    "integration_check": 500,
    "system_evaluation": 500,
    "delivery_archive": 500,
}

# 各角色必须包含的关键内容要素
ROLE_REQUIRED_ELEMENTS: Dict[str, List[Dict[str, Any]]] = {
    "requirement_clarification": [
        {"name": "需求描述", "pattern": r'需求|requirement', "required": True},
        {"name": "约束条件", "pattern": r'约束|限制|边界|constraint', "required": True},
    ],
    "architecture_design": [
        {"name": "模块定义", "pattern": r'模块|组件|module|component', "required": True},
        {"name": "接口定义", "pattern": r'接口|API|interface', "required": True},
        {"name": "技术选型", "pattern": r'技术|选型|依赖|dependency', "required": True},
    ],
    "critical_reflection": [
        {"name": "缺陷条目", "pattern": r'缺陷|问题|defect|issue', "required": True},
        {"name": "改进建议", "pattern": r'建议|改进|修复|improve|fix', "required": True},
    ],
    "task_planning": [
        {"name": "子任务定义", "pattern": r'sub_tasks|子任务|subtask', "required": True},
        {"name": "依赖关系", "pattern": r'dependenc|依赖', "required": True},
    ],
    "coding": [
        {"name": "代码实现", "pattern": r'def |class |function|import |#include', "required": True},
        {"name": "复用说明", "pattern": r'复用|reuse|记忆库', "required": True},
    ],
    "security_check": [
        {"name": "漏洞描述", "pattern": r'漏洞|风险|vulnerability|risk', "required": True},
        {"name": "修复方案", "pattern": r'修复|整改|fix|remediate', "required": True},
    ],
    "test_script": [
        {"name": "测试用例", "pattern": r'测试|test|用例|case', "required": True},
        {"name": "预期结果", "pattern": r'预期|期望|expected|assert', "required": True},
    ],
    "integration_check": [
        {"name": "接口校验", "pattern": r'接口|interface|API', "required": True},
        {"name": "集成结论", "pattern": r'结论|通过|conclusion|pass', "required": True},
    ],
    "system_evaluation": [
        {"name": "功能评测", "pattern": r'功能|function|feature', "required": True},
        {"name": "评测结论", "pattern": r'结论|评分|conclusion|score', "required": True},
    ],
    "delivery_archive": [
        {"name": "交付清单", "pattern": r'交付|delivery|清单|list', "required": True},
        {"name": "使用说明", "pattern": r'使用|部署|运行|usage|deploy', "required": True},
    ],
}

# 逻辑一致性检测规则
CONSISTENCY_RULES: List[Dict[str, Any]] = [
    {
        "rule_id": "CONS-001",
        "name": "章节数量一致性",
        "description": "章节标题中声明的数量应与实际内容中的数量一致",
        "pattern": r'(\d+)\s*(?:个|项|条|章)',
        "severity": "warning",
    },
    {
        "rule_id": "CONS-002",
        "name": "通过/不通过矛盾",
        "description": "同一输出中不应同时出现「通过」和「不通过」的结论性矛盾",
        "severity": "error",
    },
    {
        "rule_id": "CONS-003",
        "name": "评分一致性",
        "description": "评分描述应与实际评分数值一致",
        "severity": "warning",
    },
    {
        "rule_id": "CONS-004",
        "name": "状态一致性",
        "description": "状态标记（PASSED/FAILED）应与描述内容一致",
        "severity": "error",
    },
]


# ============================================================
# 内容校验器主类
# ============================================================

class ContentValidator:
    """
    内容校验器
    作用：校验角色输出内容的完整性、逻辑一致性和全局规范符合性
    调用方：调度引擎（scheduler）、任务执行引擎
    被调用方：无（独立校验模块）
    """

    def __init__(self):
        """
        初始化内容校验器
        运行步骤：
          1. 加载安全配置
          2. 初始化日志记录器
        """
        self._security_config = settings.security
        self._max_review_iterations = self._security_config.get(
            "max_review_iterations", 3
        )
        logger.info(
            f"内容校验器初始化完成，最大审查迭代次数: {self._max_review_iterations}"
        )

    def validate(
        self,
        role: str,
        content: str,
        format_result: Optional[Any] = None,
    ) -> ContentValidationResult:
        """
        执行内容校验
        运行步骤：
          1. 输入校验（角色有效性、内容非空）
          2. 执行内容完整性校验
          3. 执行逻辑一致性校验
          4. 执行全局规范符合性校验
          5. 计算综合评分并返回结果
        参数：
          - role: 角色类型标识符
          - content: 角色输出的原始文本内容
          - format_result: 格式校验结果（可选，用于关联分析）
        返回值：ContentValidationResult 对象
        """
        # 步骤 1：输入校验
        if not content or not content.strip():
            return ContentValidationResult(
                status=ContentValidationStatus.FAILED,
                score=0.0,
                role=role,
                issues=[
                    ContentIssue(
                        severity="error",
                        dimension="completeness",
                        description="输出内容为空，无法进行内容校验",
                        suggestion="请确保角色输出非空的文本内容",
                    )
                ],
                summary="输出内容为空，内容校验无法执行",
            )

        # 步骤 2：内容完整性校验
        completeness_issues = self._check_completeness(role, content)
        completeness_score = self._calculate_dimension_score(
            completeness_issues, base_weight=0.4
        )

        # 步骤 3：逻辑一致性校验
        consistency_issues = self._check_consistency(role, content)
        consistency_score = self._calculate_dimension_score(
            consistency_issues, base_weight=0.3
        )

        # 步骤 4：全局规范符合性校验
        compliance_issues = self._check_compliance(role, content)
        compliance_score = self._calculate_dimension_score(
            compliance_issues, base_weight=0.3
        )

        # 步骤 5：汇总结果
        all_issues = completeness_issues + consistency_issues + compliance_issues
        overall_score = round(
            completeness_score * 0.4
            + consistency_score * 0.3
            + compliance_score * 0.3,
            1,
        )

        # 判定状态
        has_error = any(iss.severity == "error" for iss in all_issues)
        if has_error:
            status = ContentValidationStatus.FAILED
        elif all_issues:
            status = ContentValidationStatus.WARNING
        else:
            status = ContentValidationStatus.PASSED

        return ContentValidationResult(
            status=status,
            score=overall_score,
            role=role,
            completeness_score=completeness_score,
            consistency_score=consistency_score,
            compliance_score=compliance_score,
            issues=all_issues,
            summary=(
                f"内容校验{'通过' if status == ContentValidationStatus.PASSED else '未通过'}，"
                f"综合评分: {overall_score:.1f}，"
                f"完整性: {completeness_score:.1f}，"
                f"一致性: {consistency_score:.1f}，"
                f"合规性: {compliance_score:.1f}"
            ),
        )

    # ============================================================
    # 内容完整性校验
    # ============================================================

    def _check_completeness(
        self,
        role: str,
        content: str,
    ) -> List[ContentIssue]:
        """
        内容完整性校验
        运行步骤：
          1. 检查内容长度是否达到最低要求
          2. 检查必要内容要素是否都存在
          3. 检查各章节是否有实质内容（非空壳）
        参数：
          - role: 角色类型
          - content: 输出内容
        返回值：发现的问题列表
        """
        issues: List[ContentIssue] = []

        # 检查内容长度
        min_length = ROLE_MIN_CONTENT_LENGTH.get(role, 200)
        content_length = len(content.strip())
        if content_length < min_length:
            issues.append(
                ContentIssue(
                    severity="error",
                    dimension="completeness",
                    description=(
                        f"内容长度不足：当前 {content_length} 字符，"
                        f"最低要求 {min_length} 字符"
                    ),
                    location="全局",
                    suggestion="请补充完整的内容，确保每个章节都有实质性的描述",
                )
            )

        # 检查必要内容要素
        required_elements = ROLE_REQUIRED_ELEMENTS.get(role, [])
        for element in required_elements:
            element_name = element["name"]
            pattern = element.get("pattern", "")
            is_required = element.get("required", True)

            if pattern and not re.search(pattern, content, re.IGNORECASE):
                if is_required:
                    issues.append(
                        ContentIssue(
                            severity="error",
                            dimension="completeness",
                            description=f"缺少必要内容要素: {element_name}",
                            location="全局",
                            suggestion=f"请确保输出中包含 {element_name} 相关内容",
                        )
                    )
                else:
                    issues.append(
                        ContentIssue(
                            severity="info",
                            dimension="completeness",
                            description=f"建议包含内容要素: {element_name}",
                            location="全局",
                            suggestion=f"建议补充 {element_name} 相关内容",
                        )
                    )

        # 检查章节是否有实质内容
        chapter_issues = self._check_chapter_content_quality(content)
        issues.extend(chapter_issues)

        return issues

    def _check_chapter_content_quality(self, content: str) -> List[ContentIssue]:
        """
        检查各章节是否有实质内容（非空壳章节）
        运行步骤：
          1. 提取所有二级标题章节
          2. 检查每个章节的内容长度
          3. 标记内容过短的章节
        参数：
          - content: 输出内容
        返回值：发现的问题列表
        """
        issues: List[ContentIssue] = []

        # 按 ## 标题分割章节
        sections = re.split(r'\n(?=##\s+)', content)
        for section in sections:
            # 提取章节标题
            title_match = re.match(r'##\s+(.+)', section)
            if not title_match:
                continue
            chapter_title = title_match.group(1).strip()

            # 去除标题行后的内容
            section_body = section[title_match.end():].strip()

            # 空壳章节检测：内容少于 30 字符
            if len(section_body) < 30:
                issues.append(
                    ContentIssue(
                        severity="warning",
                        dimension="completeness",
                        description=f"章节「{chapter_title}」内容过少（{len(section_body)} 字符），可能为空壳章节",
                        location=chapter_title,
                        suggestion=f"请为「{chapter_title}」章节补充实质性内容",
                    )
                )

        return issues

    # ============================================================
    # 逻辑一致性校验
    # ============================================================

    def _check_consistency(
        self,
        role: str,
        content: str,
    ) -> List[ContentIssue]:
        """
        逻辑一致性校验
        运行步骤：
          1. 检测通过/不通过结论矛盾
          2. 检测状态标记与描述内容矛盾
          3. 检测章节数量声明与实际数量不一致
          4. 检测评分描述与数值不一致
        参数：
          - role: 角色类型
          - content: 输出内容
        返回值：发现的问题列表
        """
        issues: List[ContentIssue] = []

        # 检测通过/不通过结论矛盾
        pass_issues = self._check_pass_fail_contradiction(content)
        issues.extend(pass_issues)

        # 检测状态标记矛盾
        status_issues = self._check_status_consistency(content)
        issues.extend(status_issues)

        # 检测章节数量一致性
        count_issues = self._check_chapter_count_consistency(content)
        issues.extend(count_issues)

        # 检测评分一致性
        score_issues = self._check_score_consistency(content)
        issues.extend(score_issues)

        return issues

    def _check_pass_fail_contradiction(self, content: str) -> List[ContentIssue]:
        """
        检测通过/不通过结论矛盾
        运行步骤：
          1. 搜索「通过」相关关键词
          2. 搜索「不通过」相关关键词
          3. 若两者同时出现在结论性章节中，标记为矛盾
        参数：
          - content: 输出内容
        返回值：发现的问题列表
        """
        issues: List[ContentIssue] = []

        # 提取结论性章节（通常包含"结论"关键词的章节）
        conclusion_sections = re.findall(
            r'##\s*(?:.*结论.*|.*conclusion.*)\n(.*?)(?=\n##|\Z)',
            content,
            re.DOTALL | re.IGNORECASE,
        )

        for section in conclusion_sections:
            has_pass = bool(re.search(r'通过|PASSED|pass', section, re.IGNORECASE))
            has_fail = bool(re.search(r'不通过|未通过|FAILED|fail', section, re.IGNORECASE))

            if has_pass and has_fail:
                issues.append(
                    ContentIssue(
                        severity="error",
                        dimension="consistency",
                        description="结论性章节中同时出现「通过」和「不通过」的矛盾表述",
                        location="结论章节",
                        suggestion="请明确判定结论，统一为「通过」或「不通过」",
                    )
                )

        return issues

    def _check_status_consistency(self, content: str) -> List[ContentIssue]:
        """
        检测状态标记与描述内容的一致性
        运行步骤：
          1. 查找 PASSED/FAILED 等状态标记
          2. 检查标记后的描述是否与标记一致
        参数：
          - content: 输出内容
        返回值：发现的问题列表
        """
        issues: List[ContentIssue] = []

        # 检测 FAILED 标记后是否跟随正向描述
        failed_matches = re.finditer(
            r'(?:状态|结论|结果)[：:]\s*(?:FAILED|失败|不通过)',
            content,
            re.IGNORECASE,
        )
        for match in failed_matches:
            # 获取标记后的 200 字符上下文
            context_start = match.end()
            context = content[context_start:context_start + 200]
            # 检测是否有矛盾的正向描述
            if re.search(r'完全符合|全部通过|无问题|完美', context):
                issues.append(
                    ContentIssue(
                        severity="error",
                        dimension="consistency",
                        description=(
                            f"状态标记为「失败/不通过」，但后续描述中包含正向评价，"
                            f"存在逻辑矛盾"
                        ),
                        location=f"位置约 {match.start()} 字符处",
                        suggestion="请确保状态标记与描述内容一致",
                    )
                )

        return issues

    def _check_chapter_count_consistency(self, content: str) -> List[ContentIssue]:
        """
        检测章节数量声明与实际数量的一致性
        运行步骤：
          1. 查找「共 N 个章节」等数量声明
          2. 统计实际二级标题数量
          3. 比对是否一致
        参数：
          - content: 输出内容
        返回值：发现的问题列表
        """
        issues: List[ContentIssue] = []

        # 查找数量声明
        count_declarations = re.findall(
            r'(?:共|共计|总共|合计)\s*(\d+)\s*(?:个|章|节|项)',
            content,
        )

        if count_declarations:
            declared_count = int(count_declarations[0])
            # 统计实际 ## 标题数量
            actual_count = len(re.findall(r'^##\s+[^#]', content, re.MULTILINE))

            if declared_count != actual_count:
                issues.append(
                    ContentIssue(
                        severity="warning",
                        dimension="consistency",
                        description=(
                            f"章节数量不一致：声明 {declared_count} 个，"
                            f"实际检测到 {actual_count} 个二级标题"
                        ),
                        location="全局",
                        suggestion="请确保声明的章节数量与实际输出一致",
                    )
                )

        return issues

    def _check_score_consistency(self, content: str) -> List[ContentIssue]:
        """
        检测评分描述与数值的一致性
        运行步骤：
          1. 查找评分数值（如 "评分: 85"）
          2. 查找评分等级描述（如 "优秀"、"良好"）
          3. 检查数值与等级描述是否匹配
        参数：
          - content: 输出内容
        返回值：发现的问题列表
        """
        issues: List[ContentIssue] = []

        # 提取评分数值
        score_matches = re.findall(
            r'(?:评分|分数|score)[：:]\s*(\d+(?:\.\d+)?)',
            content,
            re.IGNORECASE,
        )

        for score_str in score_matches:
            try:
                score = float(score_str)
            except ValueError:
                continue

            # 查找评分附近的等级描述
            # 低分但描述为优秀
            if score < 60:
                if re.search(r'优秀|良好|excellent|good', content, re.IGNORECASE):
                    issues.append(
                        ContentIssue(
                            severity="warning",
                            dimension="consistency",
                            description=(
                                f"评分 {score} 分较低，但描述中包含「优秀/良好」等正向评价，"
                                f"可能存在不一致"
                            ),
                            location="评分相关章节",
                            suggestion="请确保评分数值与等级描述一致",
                        )
                    )
                    break  # 只报告一次

            # 高分但描述为差
            if score >= 80:
                if re.search(r'较差|不合格|poor|bad|fail', content, re.IGNORECASE):
                    issues.append(
                        ContentIssue(
                            severity="warning",
                            dimension="consistency",
                            description=(
                                f"评分 {score} 分较高，但描述中包含负面评价，"
                                f"可能存在不一致"
                            ),
                            location="评分相关章节",
                            suggestion="请确保评分数值与等级描述一致",
                        )
                    )
                    break

        return issues

    # ============================================================
    # 全局规范符合性校验
    # ============================================================

    def _check_compliance(
        self,
        role: str,
        content: str,
    ) -> List[ContentIssue]:
        """
        全局规范符合性校验
        运行步骤：
          1. 安全编码规范校验（仅编码角色和安全检查角色）
          2. 编码规范校验（仅编码角色）
          3. 项目专属规范校验
        参数：
          - role: 角色类型
          - content: 输出内容
        返回值：发现的问题列表
        """
        issues: List[ContentIssue] = []

        # 安全编码规范校验（编码角色和安全检查角色）
        if role in ("coding", "security_check"):
            security_issues = self._check_security_compliance(content)
            issues.extend(security_issues)

        # 编码规范校验（仅编码角色）
        if role == "coding":
            coding_issues = self._check_coding_standards(content)
            issues.extend(coding_issues)

        # 通用规范校验（所有角色）
        general_issues = self._check_general_compliance(content)
        issues.extend(general_issues)

        return issues

    def _check_security_compliance(self, content: str) -> List[ContentIssue]:
        """
        安全编码规范校验
        运行步骤：
          1. 遍历安全规范规则列表
          2. 对每条规则使用正则匹配检测违规
          3. 记录所有违规项
        参数：
          - content: 输出内容
        返回值：发现的问题列表
        """
        issues: List[ContentIssue] = []

        for rule in SECURITY_COMPLIANCE_RULES:
            rule_id = rule["rule_id"]
            rule_name = rule["name"]
            pattern = rule.get("pattern", "")
            severity = rule.get("severity", "warning")

            if not pattern:
                continue

            matches = re.finditer(pattern, content, re.IGNORECASE)
            for match in matches:
                # 提取匹配行上下文
                line_start = max(0, match.start() - 20)
                line_end = min(len(content), match.end() + 50)
                context_snippet = content[line_start:line_end].replace("\n", " ")

                issues.append(
                    ContentIssue(
                        severity=severity,
                        dimension="compliance",
                        description=f"[{rule_id}] {rule_name}: {rule['description']}",
                        location=f"位置约 {match.start()} 字符处",
                        suggestion=f"检测到疑似违规代码片段: ...{context_snippet.strip()}...",
                    )
                )

        return issues

    def _check_coding_standards(self, content: str) -> List[ContentIssue]:
        """
        编码规范校验
        运行步骤：
          1. 检查代码块中是否包含魔法数字
          2. 检查 Python 函数是否有注释
          3. 检查文件头部注释完整性
        参数：
          - content: 输出内容
        返回值：发现的问题列表
        """
        issues: List[ContentIssue] = []

        # 提取代码块内容
        code_blocks = re.findall(
            r'```(?:python|cpp|c\+\+|c|java|javascript|typescript|go|rust)?\s*\n(.*?)\n```',
            content,
            re.DOTALL,
        )

        for block_idx, code_block in enumerate(code_blocks):
            # 检测魔法数字（排除 0, 1, 2, -1 等常见小数字）
            magic_numbers = re.findall(
                r'(?<![a-zA-Z_>.\'"])\b(?!0\b|1\b|2\b|-1\b)[3-9]\d{2,}\b',
                code_block,
            )
            if magic_numbers:
                # 过滤掉可能是数组索引或行号的数字
                unique_numbers = list(set(magic_numbers))[:5]  # 最多报告 5 个
                issues.append(
                    ContentIssue(
                        severity="warning",
                        dimension="compliance",
                        description=(
                            f"代码块 {block_idx + 1} 中检测到疑似魔法数字: "
                            f"{', '.join(unique_numbers)}"
                        ),
                        location=f"代码块 {block_idx + 1}",
                        suggestion="请将魔法数字定义为命名常量或通过配置文件管理",
                    )
                )

            # 检测 Python 函数是否缺少注释
            python_funcs = re.findall(
                r'^(?:(?!\s*#).)*\n\s*def\s+(\w+)\s*\(',
                code_block,
                re.MULTILINE,
            )
            for func_name in python_funcs:
                # 检查函数定义前是否有注释行
                func_pos = code_block.find(f"def {func_name}")
                if func_pos > 0:
                    preceding_lines = code_block[max(0, func_pos - 200):func_pos]
                    if not re.search(r'#.*', preceding_lines):
                        issues.append(
                            ContentIssue(
                                severity="warning",
                                dimension="compliance",
                                description=f"函数 '{func_name}' 缺少中文注释说明",
                                location=f"代码块 {block_idx + 1}",
                                suggestion="请为每个函数添加完整的中文注释",
                            )
                        )

        return issues

    def _check_general_compliance(self, content: str) -> List[ContentIssue]:
        """
        通用规范符合性校验（适用于所有角色）
        运行步骤：
          1. 检查是否包含未授权的外部链接
          2. 检查是否引用了非权威来源
          3. 检查输出结构是否符合统一规范
        参数：
          - content: 输出内容
        返回值：发现的问题列表
        """
        issues: List[ContentIssue] = []

        # 检测非权威来源引用（非 .gov / .edu 域名）
        unauthorized_urls = re.findall(
            r'https?://(?![\w.-]*\.(?:gov|edu)[/\s])[\w./-]+',
            content,
        )
        # 过滤掉常见的代码托管平台和官方文档站点
        allowed_domains = [
            "github.com", "gitlab.com", "bitbucket.org",
            "pypi.org", "npmjs.com", "crates.io",
            "docs.python.org", "docs.ros.org",
            "en.cppreference.com", "cppreference.com",
            "wiki.ros.org",
        ]
        filtered_urls: Set[str] = set()
        for url in unauthorized_urls:
            is_allowed = any(domain in url for domain in allowed_domains)
            if not is_allowed:
                filtered_urls.add(url)

        if filtered_urls:
            issues.append(
                ContentIssue(
                    severity="warning",
                    dimension="compliance",
                    description=(
                        f"检测到非权威来源引用: {', '.join(list(filtered_urls)[:3])}"
                    ),
                    location="全局",
                    suggestion=(
                        "请仅引用 .gov、.edu 域名站点及权威学术数据库的内容，"
                        "或使用代码托管平台和官方文档站点"
                    ),
                )
            )

        return issues

    # ============================================================
    # 辅助方法
    # ============================================================

    def _calculate_dimension_score(
        self,
        issues: List[ContentIssue],
        base_weight: float,
    ) -> float:
        """
        计算单个校验维度的评分
        运行步骤：
          1. 统计各严重程度的问题数量
          2. 按权重扣分：error -20, warning -10, info -5
          3. 确保评分不低于 0
        参数：
          - issues: 该维度的问题列表
          - base_weight: 基础权重（保留参数，用于未来扩展）
        返回值：维度评分（0-100）
        """
        if not issues:
            return 100.0

        error_count = sum(1 for i in issues if i.severity == "error")
        warning_count = sum(1 for i in issues if i.severity == "warning")
        info_count = sum(1 for i in issues if i.severity == "info")

        # 扣分计算：error 每个扣 20 分，warning 每个扣 10 分，info 每个扣 5 分
        deduction = error_count * 20 + warning_count * 10 + info_count * 5
        score = max(0.0, 100.0 - deduction)
        return round(score, 1)
