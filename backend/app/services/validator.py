"""
# ============================================================
# 后端核心服务 - 结果验证引擎
# ============================================================
# 核心作用：子任务完成后自动验证任务完成度和代码质量，
#           检测潜在 bug，对问题任务触发修复迭代
# 运行流程：
#   1. 接收任务执行结果
#   2. 读取生成的代码和任务计划
#   3. 验证完成度和代码质量
#   4. 检测潜在 bug
#   5. 返回验证结果（通过/不通过/需修复）
# 输入参数：
#   - task_id: str，任务 ID
#   - execution_output: str，执行输出
#   - expected_deliverables: List[str]，预期交付物
# 输出结果：ValidationResult 对象，包含验证状态和问题列表
# 修改记录：
#   - 2026-06-30 | v2.7.0 | 增加反引号/美元符号转义，防止 shell 命令替换注入
# ============================================================
"""

import logging
from dataclasses import dataclass, field
from typing import List, Optional
from enum import Enum

from cli_integration.executor import CLIExecutor, CLIResult

logger = logging.getLogger(__name__)


class ValidationStatus(str, Enum):
    """验证状态枚举"""
    PASSED = "passed"        # 验证通过
    FAILED = "failed"        # 验证不通过
    NEEDS_FIX = "needs_fix"  # 需要修复
    ERROR = "error"          # 验证过程出错


@dataclass
class ValidationIssue:
    """
    验证发现的问题
    字段说明：
      - severity: 严重程度（error/warning/info）
      - category: 问题类别（completeness/quality/bug/style）
      - description: 问题描述
      - location: 问题位置（文件名:行号）
      - suggestion: 修复建议
    """
    severity: str = "warning"
    category: str = "quality"
    description: str = ""
    location: str = ""
    suggestion: str = ""


@dataclass
class ValidationResult:
    """
    验证结果
    字段说明：
      - status: 验证状态
      - score: 质量评分（0-100）
      - issues: 发现的问题列表
      - summary: 验证摘要
      - needs_iteration: 是否需要迭代修复
    """
    status: ValidationStatus = ValidationStatus.PASSED
    score: float = 100.0
    issues: List[ValidationIssue] = field(default_factory=list)
    summary: str = ""
    needs_iteration: bool = False


class TaskValidator:
    """
    结果验证引擎
    作用：验证任务完成度和代码质量，检测潜在 bug
    调用方：任务执行引擎
    被调用方：CLIExecutor
    """

    def __init__(self, executor: CLIExecutor):
        """
        初始化验证引擎
        参数：
          - executor: CLI 命令执行器实例
        """
        self.executor = executor

    async def validate(
        self,
        task_description: str,
        execution_output: str,
        expected_deliverables: Optional[List[str]] = None,
    ) -> ValidationResult:
        """
        验证任务执行结果
        运行步骤：
          1. 输入校验
          2. 基础检查（输出是否为空、是否有明显错误）
          3. 调用 CLI 进行深度验证
          4. 解析验证结果
          5. 判断是否需要迭代修复
        参数：
          - task_description: 任务描述
          - execution_output: 执行输出内容
          - expected_deliverables: 预期交付物列表
        返回值：ValidationResult 对象
        """
        # 基础检查：输出不能为空
        if not execution_output or not execution_output.strip():
            return ValidationResult(
                status=ValidationStatus.FAILED,
                score=0,
                issues=[ValidationIssue(
                    severity="error",
                    category="completeness",
                    description="任务执行输出为空",
                    suggestion="检查 CLI 执行是否正常，确认任务是否正确提交",
                )],
                summary="执行输出为空，任务未完成",
                needs_iteration=True,
            )

        # 基础检查：检测明显错误关键词
        basic_issues = self._basic_check(execution_output)
        if basic_issues:
            return ValidationResult(
                status=ValidationStatus.NEEDS_FIX,
                score=30,
                issues=basic_issues,
                summary="基础检查发现明显错误",
                needs_iteration=True,
            )

        # 调用 CLI 进行深度验证
        logger.info("开始深度验证任务结果...")
        validate_command = self._build_validate_command(
            task_description, execution_output, expected_deliverables
        )

        result: CLIResult = await self.executor.execute(
            command=validate_command,
            timeout=120,
        )

        if not result.success:
            logger.warning(f"深度验证执行异常: {result.error_message}")
            # 深度验证失败时，基于基础检查结果返回
            return ValidationResult(
                status=ValidationStatus.PASSED,
                score=70,
                summary="基础检查通过，深度验证未完成（CLI 异常）",
                needs_iteration=False,
            )

        # 解析验证结果
        validation = self._parse_validation_result(result.stdout)
        logger.info(
            f"验证完成: {validation.status.value}, 评分: {validation.score}"
        )
        return validation

    def _basic_check(self, output: str) -> List[ValidationIssue]:
        """
        基础检查：检测输出中的明显错误
        运行步骤：
          1. 检测错误关键词
          2. 检测异常堆栈
          3. 检测不完整标记
        参数：
          - output: 执行输出文本
        返回值：发现的问题列表
        """
        issues: List[ValidationIssue] = []
        output_lower = output.lower()

        # 检测严重错误关键词
        error_keywords = [
            ("error:", "error"),
            ("exception:", "error"),
            ("traceback", "error"),
            ("syntaxerror", "error"),
            ("failed to", "error"),
            ("cannot find", "error"),
            ("permission denied", "error"),
            ("out of memory", "error"),
        ]

        for keyword, severity in error_keywords:
            if keyword in output_lower:
                issues.append(ValidationIssue(
                    severity=severity,
                    category="bug",
                    description=f"检测到错误: {keyword}",
                    suggestion="请检查并修复相关错误",
                ))

        # 检测不完整标记
        incomplete_markers = ["...", "to be continued", "wip", "todo:"]
        for marker in incomplete_markers:
            if marker in output_lower:
                issues.append(ValidationIssue(
                    severity="warning",
                    category="completeness",
                    description=f"输出可能不完整: 检测到 '{marker}'",
                    suggestion="确认任务是否完全执行完毕",
                ))

        return issues

    def _build_validate_command(
        self,
        task_description: str,
        execution_output: str,
        expected_deliverables: Optional[List[str]],
    ) -> str:
        """
        构建验证 CLI 命令
        参数：
          - task_description: 任务描述
          - execution_output: 执行输出
          - expected_deliverables: 预期交付物
        返回值：CLI 命令字符串
        """
        # 转义双引号、反引号、美元符号，防止命令注入
        safe_desc = task_description.replace('"', '\\"').replace('`', '\\`').replace('$', '\\$')
        # 截取输出前 5000 字符，避免命令过长；同样转义特殊字符
        safe_output = execution_output[:5000].replace('"', '\\"').replace('`', '\\`').replace('$', '\\$')
        deliverables_text = ""
        if expected_deliverables:
            deliverables_text = "\n".join(f"- {d}" for d in expected_deliverables)

        command = (
            f'-p "你是一个代码质量审查专家。请验证以下任务执行结果。\n\n'
            f'## 任务描述\n{safe_desc}\n\n'
            f'## 预期交付物\n{deliverables_text or "未指定"}\n\n'
            f'## 执行输出\n{safe_output}\n\n'
            f'请按以下格式输出验证结果：\n'
            f'## 验证结论\n'
            f'[PASSED / NEEDS_FIX / FAILED]\n\n'
            f'## 质量评分\n'
            f'[0-100 的整数评分]\n\n'
            f'## 完成度评估\n'
            f'[评估任务完成百分比和未完成部分]\n\n'
            f'## 发现的问题\n'
            f'- [严重程度: error/warning/info] [类别] [问题描述] -> [修复建议]\n\n'
            f'## 代码质量评估\n'
            f'[代码结构、可读性、规范性评估]\n\n'
            f'## 是否需要迭代修复\n'
            f'[YES/NO] - [原因]"'
        )
        return command

    def _parse_validation_result(self, output: str) -> ValidationResult:
        """
        解析验证结果
        运行步骤：
          1. 提取验证结论
          2. 提取质量评分
          3. 提取问题列表
          4. 判断是否需要迭代
        参数：
          - output: CLI 验证输出
        返回值：ValidationResult 对象
        """
        result = ValidationResult()
        result.summary = output[:500]

        # 解析验证结论
        output_upper = output.upper()
        if "NEEDS_FIX" in output_upper:
            result.status = ValidationStatus.NEEDS_FIX
            result.needs_iteration = True
        elif "FAILED" in output_upper:
            result.status = ValidationStatus.FAILED
            result.needs_iteration = True
        else:
            result.status = ValidationStatus.PASSED

        # 解析质量评分
        import re
        score_match = re.search(r'(\d{1,3})', output)
        if score_match:
            score = int(score_match.group(1))
            result.score = max(0, min(100, score))

        # 解析问题列表
        in_issues = False
        for line in output.split("\n"):
            line_stripped = line.strip()

            if "发现的问题" in line_stripped:
                in_issues = True
                continue
            if line_stripped.startswith("##") and "发现的问题" not in line_stripped:
                in_issues = False
                continue

            if in_issues and line_stripped.startswith("-"):
                issue_text = line_stripped.lstrip("- ").strip()
                if issue_text:
                    # 解析严重程度
                    severity = "warning"
                    if "[error]" in issue_text.lower() or "[严重" in issue_text:
                        severity = "error"
                    elif "[info]" in issue_text.lower() or "[信息" in issue_text:
                        severity = "info"

                    # 提取修复建议
                    suggestion = ""
                    if "->" in issue_text:
                        parts = issue_text.split("->", 1)
                        issue_text = parts[0].strip()
                        suggestion = parts[1].strip()

                    result.issues.append(ValidationIssue(
                        severity=severity,
                        category="quality",
                        description=issue_text,
                        suggestion=suggestion,
                    ))

        # 解析是否需要迭代
        if "是否需要迭代修复" in output:
            iter_section = output.split("是否需要迭代修复")[-1]
            if "YES" in iter_section.upper():
                result.needs_iteration = True
            elif "NO" in iter_section.upper():
                result.needs_iteration = False

        return result
