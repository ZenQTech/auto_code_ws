"""
# ============================================================
# 安全校验服务 - 三层安全验证系统
# ============================================================
# 核心作用：为调度平台提供三层安全校验能力，
#           包括工具自动校验、AST 规则校验、算法边界与安全逻辑校验，
#           以及高风险模块的人工审核流程管理
# 运行流程：
#   1. SecurityChecker.full_validate() 接收代码路径、语言、风险等级
#   2. 根据风险等级决定执行哪些校验层
#   3. Layer1: 调用外部工具（cppcheck/clang-tidy/pylint/roslint）自动校验
#   4. Layer2: 基于 AST/正则进行代码结构规则校验
#   5. Layer3: 基于模式匹配进行安全逻辑与边界条件校验
#   6. 汇总生成结构化校验报告
#   7. 高风险模块通过 SecurityReviewManager 进入人工审核流程
# 输入参数：
#   - code_path: str，代码文件或目录路径
#   - language: str，编程语言（cpp/python）
#   - risk_level: str，风险等级（low/medium/high/very_high）
# 输出结果：SecurityReport 对象，包含各层校验结果和综合评分
# 修改记录：
#   - 2026-06-24 | v1.0.0 | 初始版本，实现三层安全校验 + 人工审核管理
# ============================================================
"""

import logging
import os
import re
import subprocess
import ast as py_ast
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from backend.app.config import settings

logger = logging.getLogger(__name__)


# ============================================================
# 枚举类型定义
# ============================================================

class Severity(str, Enum):
    """
    问题严重程度枚举
    取值：CRITICAL（严重）、ERROR（错误）、WARNING（警告）、INFO（信息）
    """
    CRITICAL = "critical"
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


class RiskLevel(str, Enum):
    """
    模块风险等级枚举
    取值：LOW（低）、MEDIUM（中）、HIGH（高）、VERY_HIGH（极高）
    """
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    VERY_HIGH = "very_high"


class ReviewStatus(str, Enum):
    """
    人工审核状态枚举
    取值：PENDING（待审核）、IN_REVIEW（审核中）、APPROVED（已通过）、
          REJECTED（已驳回）、CANCELLED（已取消）
    """
    PENDING = "pending"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class ValidationLayer(str, Enum):
    """
    校验层枚举
    取值：LAYER1（工具自动校验）、LAYER2（AST 规则校验）、
          LAYER3（安全逻辑校验）
    """
    LAYER1 = "layer1"
    LAYER2 = "layer2"
    LAYER3 = "layer3"


# ============================================================
# 数据类定义
# ============================================================

@dataclass
class SecurityIssue:
    """
    安全问题数据结构
    字段说明：
      - layer: 发现问题的校验层（layer1/layer2/layer3）
      - severity: 严重程度（critical/error/warning/info）
      - category: 问题类别（如 memory_safety/real_time_violation/code_style）
      - rule_id: 规则标识符
      - description: 问题描述
      - location: 问题位置（文件路径:行号）
      - code_snippet: 问题代码片段
      - suggestion: 修复建议
    """
    layer: str = ""
    severity: Severity = Severity.WARNING
    category: str = ""
    rule_id: str = ""
    description: str = ""
    location: str = ""
    code_snippet: str = ""
    suggestion: str = ""


@dataclass
class LayerResult:
    """
    单层校验结果
    字段说明：
      - layer: 校验层名称
      - passed: 是否通过
      - score: 评分（0-100）
      - issues: 发现的问题列表
      - tool_output: 工具原始输出（仅 layer1）
      - execution_time_ms: 执行耗时（毫秒）
    """
    layer: str = ""
    passed: bool = True
    score: float = 100.0
    issues: List[SecurityIssue] = field(default_factory=list)
    tool_output: str = ""
    execution_time_ms: float = 0.0


@dataclass
class SecurityReport:
    """
    安全校验综合报告
    字段说明：
      - code_path: 被校验的代码路径
      - language: 编程语言
      - risk_level: 风险等级
      - overall_passed: 综合是否通过
      - overall_score: 综合评分（0-100）
      - layer_results: 各层校验结果
      - total_issues: 问题总数
      - critical_count: 严重问题数
      - error_count: 错误问题数
      - warning_count: 警告问题数
      - info_count: 信息问题数
      - requires_human_review: 是否需要人工审核
      - generated_at: 报告生成时间
    """
    code_path: str = ""
    language: str = ""
    risk_level: str = ""
    overall_passed: bool = True
    overall_score: float = 100.0
    layer_results: List[LayerResult] = field(default_factory=list)
    total_issues: int = 0
    critical_count: int = 0
    error_count: int = 0
    warning_count: int = 0
    info_count: int = 0
    requires_human_review: bool = False
    generated_at: str = ""


@dataclass
class ReviewRecord:
    """
    人工审核记录
    字段说明：
      - review_id: 审核记录唯一标识
      - module_name: 被审核模块名称
      - code_path: 代码路径
      - risk_level: 风险等级
      - iteration: 当前审核轮次
      - status: 审核状态
      - reviewer: 审核人
      - check_items: 审核检查项及结果
      - comments: 审核意见
      - created_at: 创建时间
      - updated_at: 更新时间
      - resolved_at: 完成时间
    """
    review_id: str = ""
    module_name: str = ""
    code_path: str = ""
    risk_level: str = ""
    iteration: int = 1
    status: ReviewStatus = ReviewStatus.PENDING
    reviewer: str = ""
    check_items: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    comments: str = ""
    created_at: str = ""
    updated_at: str = ""
    resolved_at: str = ""


# ============================================================
# SecurityChecker - 三层安全校验核心类
# ============================================================

class SecurityChecker:
    """
    三层安全校验核心类
    作用：对代码执行三层递进式安全校验，生成结构化报告
    调用方：任务执行引擎、代码审查模块
    被调用方：外部工具（cppcheck/clang-tidy/pylint/roslint）、
              Python AST 模块、正则引擎
    """

    # ---- 第 2 层：C++ 实时性违规检测正则模式 ----
    # 动态内存分配模式（new/delete/malloc/free/calloc/realloc）
    _CPP_DYNAMIC_ALLOC_PATTERN = re.compile(
        r'\b(new\s+|delete\s+|delete\[\]\s*|malloc\s*\(|free\s*\(|calloc\s*\(|realloc\s*\()',
    )
    # 阻塞调用模式（sleep/usleep/nanosleep/wait/lock/mutex_lock/pthread_join）
    _CPP_BLOCKING_CALL_PATTERN = re.compile(
        r'\b(sleep\s*\(|usleep\s*\(|nanosleep\s*\(|std::this_thread::sleep_for|'
        r'wait\s*\(|pthread_join\s*\(|pthread_mutex_lock\s*\(|'
        r'std::mutex::lock\s*\(|std::unique_lock|std::lock_guard)',
    )
    # 高频日志打印模式（ROS_INFO/ROS_DEBUG/printf/cout/cerr）
    _CPP_LOG_IN_LOOP_PATTERN = re.compile(
        r'\b(ROS_INFO|ROS_DEBUG|ROS_INFO_STREAM|ROS_DEBUG_STREAM|'
        r'printf\s*\(|std::cout|std::cerr|fprintf\s*\()',
    )
    # 硬编码魔法数字模式（等号/比较后的纯数字，排除 0/1/-1 常见值）
    _CPP_MAGIC_NUMBER_PATTERN = re.compile(
        r'(?<![a-zA-Z_0-9])(?<![\w.])(\d{2,}|-\d{2,})(?![a-zA-Z_0-9])'
    )
    # ROS 跨包引用格式违规（相对路径引用，如 #include "other_pkg/xxx.h" 而非 <pkg/xxx.h>）
    _CPP_RELATIVE_INCLUDE_PATTERN = re.compile(
        r'#include\s+"[^"]*pkg[^"]*\.h"'
    )
    # ROS2 QoS 配置缺失检测（创建 publisher/subscriber 时未指定 QoS）
    _CPP_QOS_MISSING_PATTERN = re.compile(
        r'(create_publisher\s*<|create_subscription\s*<|create_wall_timer\s*<)'
        r'(?!.*?rclcpp::QoS|.*?rmw_qos_profile)'
    )

    # ---- 第 2 层：Python 违规检测模式 ----
    # 裸 except 子句（except: 或 except Exception: 不带具体类型）
    _PY_BARE_EXCEPT_PATTERN = re.compile(r'except\s*:')
    # 不安全函数（eval/exec/compile/os.system/subprocess 无安全参数）
    _PY_UNSAFE_FUNC_PATTERN = re.compile(
        r'\b(eval\s*\(|exec\s*\(|compile\s*\(|os\.system\s*\(|'
        r'subprocess\.call\s*\(\s*shell\s*=\s*True|'
        r'__import__\s*\()'
    )
    # 硬编码参数（非注释行中的数字常量赋值）
    _PY_HARDCODED_PARAM_PATTERN = re.compile(
        r'^\s*[A-Z_][A-Z_0-9]*\s*=\s*\d+(\.\d+)?\s*$',
        re.MULTILINE,
    )

    def __init__(self):
        """
        初始化安全校验器
        运行步骤：
          1. 从全局配置中读取安全相关配置
          2. 初始化各层校验结果缓存
          3. 设置默认超时时间
        """
        # 从全局配置读取安全相关配置
        self._security_config: Dict[str, Any] = settings.security
        self._max_review_iterations: int = self._security_config.get(
            "max_review_iterations", 3
        )
        self._tools_config: Dict[str, bool] = self._security_config.get("tools", {
            "cppcheck_enabled": True,
            "clang_tidy_enabled": True,
            "pylint_enabled": True,
            "roslint_enabled": True,
        })

        # 工具执行超时时间（秒）
        self._tool_timeout: int = 120
        # 校验结果缓存（用于 get_validation_report 返回最近一次结果）
        self._last_report: Optional[SecurityReport] = None

        logger.info(
            f"安全校验器初始化完成 | 最大审核轮次={self._max_review_iterations} | "
            f"工具配置={self._tools_config}"
        )

    # ============================================================
    # 第 1 层：工具自动校验
    # ============================================================

    def validate_layer1(self, code_path: str, language: str) -> LayerResult:
        """
        第 1 层校验：调用外部工具进行自动代码检查
        运行步骤：
          1. 根据语言选择对应的检查工具
          2. 调用 subprocess 执行工具命令
          3. 解析工具输出，按严重程度分类问题
          4. 汇总生成 LayerResult
        参数：
          - code_path: 代码文件或目录的绝对路径
          - language: 编程语言（cpp/python）
        返回值：LayerResult 对象，包含工具校验结果
        """
        import time
        start_time = time.time()

        result = LayerResult(layer=ValidationLayer.LAYER1.value)
        all_issues: List[SecurityIssue] = []
        tool_outputs: List[str] = []

        # 根据语言选择工具链
        if language == "cpp":
            # C++ 工具链：cppcheck + clang-tidy + roslint
            if self._tools_config.get("cppcheck_enabled", True):
                cppcheck_issues, cppcheck_output = self._run_cppcheck(code_path)
                all_issues.extend(cppcheck_issues)
                tool_outputs.append(cppcheck_output)

            if self._tools_config.get("clang_tidy_enabled", True):
                clang_tidy_issues, clang_tidy_output = self._run_clang_tidy(code_path)
                all_issues.extend(clang_tidy_issues)
                tool_outputs.append(clang_tidy_output)

            if self._tools_config.get("roslint_enabled", True):
                roslint_issues, roslint_output = self._run_roslint(code_path)
                all_issues.extend(roslint_issues)
                tool_outputs.append(roslint_output)

        elif language == "python":
            # Python 工具链：pylint
            if self._tools_config.get("pylint_enabled", True):
                pylint_issues, pylint_output = self._run_pylint(code_path)
                all_issues.extend(pylint_issues)
                tool_outputs.append(pylint_output)

        # 汇总结果
        result.issues = all_issues
        result.tool_output = "\n".join(tool_outputs)
        result.execution_time_ms = (time.time() - start_time) * 1000

        # 计算评分：每个 critical 扣 20 分，error 扣 10 分，warning 扣 3 分，info 扣 1 分
        penalty = 0.0
        for issue in all_issues:
            if issue.severity == Severity.CRITICAL:
                penalty += 20.0
            elif issue.severity == Severity.ERROR:
                penalty += 10.0
            elif issue.severity == Severity.WARNING:
                penalty += 3.0
            elif issue.severity == Severity.INFO:
                penalty += 1.0
        result.score = max(0.0, 100.0 - penalty)
        # 存在 critical 或 error 级别问题时判定不通过
        result.passed = not any(
            i.severity in (Severity.CRITICAL, Severity.ERROR) for i in all_issues
        )

        logger.info(
            f"Layer1 校验完成 | 语言={language} | 问题数={len(all_issues)} | "
            f"评分={result.score:.1f} | 通过={result.passed}"
        )
        return result

    def _run_cppcheck(self, code_path: str) -> Tuple[List[SecurityIssue], str]:
        """
        执行 cppcheck 静态分析工具
        运行步骤：
          1. 检查 cppcheck 是否可用
          2. 构建命令行参数（--enable=all --xml）
          3. 通过 subprocess 执行
          4. 解析 XML 输出，提取问题信息
        参数：
          - code_path: 代码路径
        返回值：(问题列表, 工具原始输出文本)
        """
        issues: List[SecurityIssue] = []
        output = ""

        # 检查 cppcheck 是否可用
        if not self._tool_available("cppcheck"):
            output = "[cppcheck] 工具不可用，跳过校验"
            logger.warning(output)
            return issues, output

        try:
            # 构建 cppcheck 命令：启用所有检查，输出 XML 格式
            cmd = [
                "cppcheck",
                "--enable=all",
                "--inconclusive",
                "--xml",
                "--xml-version=2",
                str(code_path),
            ]
            proc_result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self._tool_timeout,
            )
            output = proc_result.stderr or proc_result.stdout or ""

            # 解析 cppcheck XML 输出
            issues = self._parse_cppcheck_output(output)

        except subprocess.TimeoutExpired:
            output = f"[cppcheck] 执行超时（>{self._tool_timeout}s）"
            logger.warning(output)
        except FileNotFoundError:
            output = "[cppcheck] 未找到 cppcheck 可执行文件"
            logger.warning(output)
        except Exception as e:
            output = f"[cppcheck] 执行异常: {e}"
            logger.error(output)

        return issues, f"=== cppcheck 输出 ===\n{output}"

    def _parse_cppcheck_output(self, output: str) -> List[SecurityIssue]:
        """
        解析 cppcheck XML 输出
        运行步骤：
          1. 尝试用 xml.etree 解析 XML
          2. 提取 error 元素中的 id、severity、msg、location
          3. 映射 cppcheck 严重程度到内部 Severity 枚举
        参数：
          - output: cppcheck 的 stderr 输出（XML 格式）
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []
        try:
            import xml.etree.ElementTree as ET
            root = ET.fromstring(output)
            # cppcheck XML v2 格式：results/errors/error
            for error_elem in root.iter("error"):
                cppcheck_severity = error_elem.get("severity", "warning")
                # 映射 cppcheck 严重程度
                severity_map = {
                    "error": Severity.ERROR,
                    "warning": Severity.WARNING,
                    "style": Severity.INFO,
                    "performance": Severity.WARNING,
                    "portability": Severity.WARNING,
                    "information": Severity.INFO,
                }
                severity = severity_map.get(cppcheck_severity, Severity.WARNING)

                msg = error_elem.get("msg", "")
                error_id = error_elem.get("id", "unknown")
                verbose = error_elem.get("verbose", "")

                # 提取位置信息
                location = ""
                code_snippet = ""
                for loc_elem in error_elem.iter("location"):
                    file_path = loc_elem.get("file", "")
                    line_num = loc_elem.get("line", "0")
                    location = f"{file_path}:{line_num}"
                    break

                issues.append(SecurityIssue(
                    layer=ValidationLayer.LAYER1.value,
                    severity=severity,
                    category=f"cppcheck_{cppcheck_severity}",
                    rule_id=f"cppcheck:{error_id}",
                    description=msg,
                    location=location,
                    code_snippet=code_snippet,
                    suggestion=verbose or "请根据 cppcheck 提示修复",
                ))
        except Exception as e:
            logger.debug(f"解析 cppcheck XML 输出失败: {e}，使用文本解析兜底")
            # XML 解析失败时，使用文本行解析兜底
            issues = self._parse_cppcheck_text(output)

        return issues

    def _parse_cppcheck_text(self, output: str) -> List[SecurityIssue]:
        """
        文本方式解析 cppcheck 输出（XML 解析失败时的兜底方案）
        参数：
          - output: cppcheck 文本输出
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []
        # cppcheck 文本格式：[file:line]: (severity) message
        text_pattern = re.compile(
            r'\[(.+?):(\d+)\]:\s*\((\w+)\)\s*(.+)'
        )
        for match in text_pattern.finditer(output):
            file_path = match.group(1)
            line_num = match.group(2)
            sev_text = match.group(3)
            message = match.group(4)

            severity_map = {
                "error": Severity.ERROR,
                "warning": Severity.WARNING,
                "style": Severity.INFO,
                "performance": Severity.WARNING,
                "portability": Severity.WARNING,
                "information": Severity.INFO,
            }
            severity = severity_map.get(sev_text, Severity.WARNING)

            issues.append(SecurityIssue(
                layer=ValidationLayer.LAYER1.value,
                severity=severity,
                category=f"cppcheck_{sev_text}",
                rule_id="cppcheck:text_parse",
                description=message,
                location=f"{file_path}:{line_num}",
                suggestion="请根据 cppcheck 提示修复",
            ))
        return issues

    def _run_clang_tidy(self, code_path: str) -> Tuple[List[SecurityIssue], str]:
        """
        执行 clang-tidy 静态分析工具
        运行步骤：
          1. 检查 clang-tidy 是否可用
          2. 对指定路径下的 C/C++ 文件执行检查
          3. 解析输出，提取警告和错误
        参数：
          - code_path: 代码路径
        返回值：(问题列表, 工具原始输出文本)
        """
        issues: List[SecurityIssue] = []
        output = ""

        if not self._tool_available("clang-tidy"):
            output = "[clang-tidy] 工具不可用，跳过校验"
            logger.warning(output)
            return issues, output

        try:
            # 收集 C/C++ 源文件
            cpp_files = self._collect_source_files(code_path, [".cpp", ".cc", ".cxx", ".c", ".h", ".hpp"])
            if not cpp_files:
                output = "[clang-tidy] 未找到 C/C++ 源文件"
                return issues, output

            # 对每个文件执行 clang-tidy
            for cpp_file in cpp_files[:20]:  # 限制最多检查 20 个文件，避免超时
                cmd = [
                    "clang-tidy",
                    str(cpp_file),
                    "--",  # 分隔符，后面是编译器参数
                    "-std=c++17",
                ]
                proc_result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=self._tool_timeout,
                )
                file_output = proc_result.stdout or proc_result.stderr or ""
                output += f"\n--- {cpp_file} ---\n{file_output}"

                # 解析 clang-tidy 输出
                file_issues = self._parse_clang_tidy_output(file_output)
                issues.extend(file_issues)

        except subprocess.TimeoutExpired:
            output += f"\n[clang-tidy] 执行超时（>{self._tool_timeout}s）"
            logger.warning(f"clang-tidy 执行超时: {code_path}")
        except FileNotFoundError:
            output = "[clang-tidy] 未找到 clang-tidy 可执行文件"
            logger.warning(output)
        except Exception as e:
            output += f"\n[clang-tidy] 执行异常: {e}"
            logger.error(f"clang-tidy 执行异常: {e}")

        return issues, f"=== clang-tidy 输出 ===\n{output}"

    def _parse_clang_tidy_output(self, output: str) -> List[SecurityIssue]:
        """
        解析 clang-tidy 文本输出
        参数：
          - output: clang-tidy 输出文本
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []
        # clang-tidy 格式：file:line:col: warning: message [check-name]
        pattern = re.compile(
            r'(.+?):(\d+):(\d+):\s*(warning|error):\s*(.+?)\s*\[(.+?)\]'
        )
        for match in pattern.finditer(output):
            file_path = match.group(1)
            line_num = match.group(2)
            sev_text = match.group(4)
            message = match.group(5)
            check_name = match.group(6)

            severity = Severity.ERROR if sev_text == "error" else Severity.WARNING

            issues.append(SecurityIssue(
                layer=ValidationLayer.LAYER1.value,
                severity=severity,
                category=f"clang_tidy_{sev_text}",
                rule_id=f"clang-tidy:{check_name}",
                description=message,
                location=f"{file_path}:{line_num}",
                suggestion=f"请根据 clang-tidy 检查 '{check_name}' 的建议修复",
            ))
        return issues

    def _run_roslint(self, code_path: str) -> Tuple[List[SecurityIssue], str]:
        """
        执行 roslint ROS 代码风格检查
        运行步骤：
          1. 检查 roslint 是否可用
          2. 对 ROS 包目录执行 roslint
          3. 解析输出
        参数：
          - code_path: 代码路径
        返回值：(问题列表, 工具原始输出文本)
        """
        issues: List[SecurityIssue] = []
        output = ""

        if not self._tool_available("roslint"):
            output = "[roslint] 工具不可用，跳过校验"
            logger.warning(output)
            return issues, output

        try:
            cmd = ["roslint", str(code_path)]
            proc_result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self._tool_timeout,
            )
            output = proc_result.stdout or proc_result.stderr or ""

            # 解析 roslint 输出
            issues = self._parse_roslint_output(output)

        except subprocess.TimeoutExpired:
            output = f"[roslint] 执行超时（>{self._tool_timeout}s）"
            logger.warning(output)
        except FileNotFoundError:
            output = "[roslint] 未找到 roslint 可执行文件"
            logger.warning(output)
        except Exception as e:
            output = f"[roslint] 执行异常: {e}"
            logger.error(output)

        return issues, f"=== roslint 输出 ===\n{output}"

    def _parse_roslint_output(self, output: str) -> List[SecurityIssue]:
        """
        解析 roslint 文本输出
        参数：
          - output: roslint 输出文本
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []
        # roslint 格式：file:line:  message
        pattern = re.compile(r'(.+?):(\d+):\s*(.+)')
        for match in pattern.finditer(output):
            file_path = match.group(1)
            line_num = match.group(2)
            message = match.group(3)

            issues.append(SecurityIssue(
                layer=ValidationLayer.LAYER1.value,
                severity=Severity.WARNING,
                category="ros_style",
                rule_id="roslint:style",
                description=message,
                location=f"{file_path}:{line_num}",
                suggestion="请根据 ROS 代码规范修复",
            ))
        return issues

    def _run_pylint(self, code_path: str) -> Tuple[List[SecurityIssue], str]:
        """
        执行 pylint Python 代码静态分析
        运行步骤：
          1. 检查 pylint 是否可用
          2. 对 Python 文件执行 pylint
          3. 解析输出，按消息类型分类
        参数：
          - code_path: 代码路径
        返回值：(问题列表, 工具原始输出文本)
        """
        issues: List[SecurityIssue] = []
        output = ""

        if not self._tool_available("pylint"):
            output = "[pylint] 工具不可用，跳过校验"
            logger.warning(output)
            return issues, output

        try:
            cmd = [
                "pylint",
                "--output-format=text",
                str(code_path),
            ]
            proc_result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self._tool_timeout,
            )
            output = proc_result.stdout or proc_result.stderr or ""

            # 解析 pylint 输出
            issues = self._parse_pylint_output(output)

        except subprocess.TimeoutExpired:
            output = f"[pylint] 执行超时（>{self._tool_timeout}s）"
            logger.warning(output)
        except FileNotFoundError:
            output = "[pylint] 未找到 pylint 可执行文件"
            logger.warning(output)
        except Exception as e:
            output = f"[pylint] 执行异常: {e}"
            logger.error(output)

        return issues, f"=== pylint 输出 ===\n{output}"

    def _parse_pylint_output(self, output: str) -> List[SecurityIssue]:
        """
        解析 pylint 文本输出
        参数：
          - output: pylint 输出文本
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []
        # pylint 格式：file:line:col: message_type: message (message-id)
        pattern = re.compile(
            r'(.+?):(\d+):(\d+):\s*([A-Z]\d+):\s*(.+?)\s*\((.+?)\)'
        )
        for match in pattern.finditer(output):
            file_path = match.group(1)
            line_num = match.group(2)
            msg_type = match.group(4)  # 如 C0114, E0602, W0611
            message = match.group(5)
            msg_id = match.group(6)

            # 根据 pylint 消息类型首字母确定严重程度
            severity_char = msg_type[0] if msg_type else "W"
            severity_map = {
                "E": Severity.ERROR,     # Error
                "F": Severity.CRITICAL,  # Fatal
                "W": Severity.WARNING,   # Warning
                "C": Severity.INFO,      # Convention
                "R": Severity.INFO,      # Refactor
                "I": Severity.INFO,      # Information
            }
            severity = severity_map.get(severity_char, Severity.WARNING)

            issues.append(SecurityIssue(
                layer=ValidationLayer.LAYER1.value,
                severity=severity,
                category=f"pylint_{msg_type[0].lower()}",
                rule_id=f"pylint:{msg_id}",
                description=message,
                location=f"{file_path}:{line_num}",
                suggestion=f"请根据 pylint 规则 '{msg_id}' 修复",
            ))
        return issues

    def _tool_available(self, tool_name: str) -> bool:
        """
        检查外部工具是否在系统 PATH 中可用
        参数：
          - tool_name: 工具名称
        返回值：True 表示可用，False 表示不可用
        """
        import shutil
        return shutil.which(tool_name) is not None

    def _collect_source_files(self, code_path: str, extensions: List[str]) -> List[Path]:
        """
        收集指定路径下的源代码文件
        参数：
          - code_path: 根路径
          - extensions: 文件扩展名列表（如 ['.cpp', '.h']）
        返回值：Path 对象列表
        """
        root = Path(code_path)
        if root.is_file():
            return [root] if root.suffix in extensions else []
        files = []
        for ext in extensions:
            files.extend(root.rglob(f"*{ext}"))
        return sorted(files)[:50]  # 限制最多 50 个文件

    # ============================================================
    # 第 2 层：AST 规则校验
    # ============================================================

    def validate_layer2(self, code_path: str, language: str) -> LayerResult:
        """
        第 2 层校验：基于 AST/正则的代码结构规则校验
        运行步骤：
          1. 收集源代码文件
          2. 根据语言选择对应的分析策略
          3. C++：使用正则检测实时性违规、魔法数字、跨包引用、QoS 配置
          4. Python：使用 ast 模块检测裸 except、不安全函数、硬编码参数
          5. 汇总生成 LayerResult
        参数：
          - code_path: 代码路径
          - language: 编程语言（cpp/python）
        返回值：LayerResult 对象
        """
        import time
        start_time = time.time()

        result = LayerResult(layer=ValidationLayer.LAYER2.value)
        all_issues: List[SecurityIssue] = []

        if language == "cpp":
            # 收集 C++ 源文件
            cpp_files = self._collect_source_files(
                code_path, [".cpp", ".cc", ".cxx", ".c", ".h", ".hpp"]
            )
            for cpp_file in cpp_files:
                try:
                    content = cpp_file.read_text(encoding="utf-8", errors="ignore")
                    file_issues = self._analyze_cpp_layer2(cpp_file, content)
                    all_issues.extend(file_issues)
                except Exception as e:
                    logger.warning(f"读取文件失败 {cpp_file}: {e}")

        elif language == "python":
            py_files = self._collect_source_files(code_path, [".py"])
            for py_file in py_files:
                try:
                    content = py_file.read_text(encoding="utf-8", errors="ignore")
                    file_issues = self._analyze_python_layer2(py_file, content)
                    all_issues.extend(file_issues)
                except Exception as e:
                    logger.warning(f"读取文件失败 {py_file}: {e}")

        result.issues = all_issues
        result.execution_time_ms = (time.time() - start_time) * 1000

        # 计算评分
        penalty = 0.0
        for issue in all_issues:
            if issue.severity == Severity.CRITICAL:
                penalty += 25.0
            elif issue.severity == Severity.ERROR:
                penalty += 15.0
            elif issue.severity == Severity.WARNING:
                penalty += 5.0
            elif issue.severity == Severity.INFO:
                penalty += 1.0
        result.score = max(0.0, 100.0 - penalty)
        result.passed = not any(
            i.severity in (Severity.CRITICAL, Severity.ERROR) for i in all_issues
        )

        logger.info(
            f"Layer2 校验完成 | 语言={language} | 问题数={len(all_issues)} | "
            f"评分={result.score:.1f} | 通过={result.passed}"
        )
        return result

    def _analyze_cpp_layer2(self, file_path: Path, content: str) -> List[SecurityIssue]:
        """
        对 C++ 代码执行第 2 层 AST/正则规则校验
        检测项：
          1. 实时循环中的动态内存分配
          2. 实时循环中的阻塞调用
          3. 循环中的高频日志打印
          4. 硬编码魔法数字
          5. ROS 跨包引用格式违规
          6. ROS2 QoS 配置缺失
        参数：
          - file_path: 文件路径
          - content: 文件内容字符串
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []
        lines = content.split("\n")
        file_str = str(file_path)

        # ---- 检测循环体内的违规代码 ----
        issues.extend(self._check_loop_body_violations(
            file_str, lines, content
        ))

        # ---- 检测硬编码魔法数字 ----
        issues.extend(self._check_magic_numbers(file_str, lines))

        # ---- 检测 ROS 跨包引用格式违规 ----
        issues.extend(self._check_ros_include_format(file_str, lines))

        # ---- 检测 ROS2 QoS 配置缺失 ----
        issues.extend(self._check_ros2_qos(file_str, lines))

        return issues

    def _check_loop_body_violations(
        self, file_str: str, lines: List[str], content: str
    ) -> List[SecurityIssue]:
        """
        检测循环体（while/for）内的实时性违规代码
        检测项：
          - 动态内存分配（new/delete/malloc/free）
          - 阻塞调用（sleep/wait/lock）
          - 高频日志打印（ROS_INFO/printf/cout）
        运行步骤：
          1. 遍历每一行，识别循环起始行（while/for）
          2. 通过大括号匹配确定循环体范围
          3. 在循环体范围内检测违规模式
        参数：
          - file_str: 文件路径字符串
          - lines: 代码行列表
          - content: 完整文件内容
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []

        # 识别循环体范围
        loop_ranges = self._find_loop_ranges(lines)

        for loop_start, loop_end in loop_ranges:
            # 提取循环体内容
            loop_body_lines = lines[loop_start:loop_end + 1]
            loop_body_text = "\n".join(loop_body_lines)

            # 检测动态内存分配
            alloc_matches = list(self._CPP_DYNAMIC_ALLOC_PATTERN.finditer(loop_body_text))
            for match in alloc_matches:
                # 计算在原始文件中的行号
                line_offset = loop_body_text[:match.start()].count("\n")
                actual_line = loop_start + line_offset + 1
                issues.append(SecurityIssue(
                    layer=ValidationLayer.LAYER2.value,
                    severity=Severity.CRITICAL,
                    category="real_time_violation",
                    rule_id="rt:dynamic_alloc_in_loop",
                    description=f"实时循环体内检测到动态内存分配: {match.group(0).strip()}",
                    location=f"{file_str}:{actual_line}",
                    code_snippet=lines[actual_line - 1].strip() if actual_line <= len(lines) else "",
                    suggestion="实时控制循环严禁动态内存分配，请使用预分配内存池或栈上分配",
                ))

            # 检测阻塞调用
            blocking_matches = list(self._CPP_BLOCKING_CALL_PATTERN.finditer(loop_body_text))
            for match in blocking_matches:
                line_offset = loop_body_text[:match.start()].count("\n")
                actual_line = loop_start + line_offset + 1
                issues.append(SecurityIssue(
                    layer=ValidationLayer.LAYER2.value,
                    severity=Severity.CRITICAL,
                    category="real_time_violation",
                    rule_id="rt:blocking_call_in_loop",
                    description=f"实时循环体内检测到阻塞调用: {match.group(0).strip()}",
                    location=f"{file_str}:{actual_line}",
                    code_snippet=lines[actual_line - 1].strip() if actual_line <= len(lines) else "",
                    suggestion="实时控制循环严禁阻塞调用，请使用非阻塞异步机制或移至独立线程",
                ))

            # 检测高频日志打印
            log_matches = list(self._CPP_LOG_IN_LOOP_PATTERN.finditer(loop_body_text))
            for match in log_matches:
                line_offset = loop_body_text[:match.start()].count("\n")
                actual_line = loop_start + line_offset + 1
                issues.append(SecurityIssue(
                    layer=ValidationLayer.LAYER2.value,
                    severity=Severity.WARNING,
                    category="real_time_violation",
                    rule_id="rt:log_in_loop",
                    description=f"实时循环体内检测到日志打印: {match.group(0).strip()}",
                    location=f"{file_str}:{actual_line}",
                    code_snippet=lines[actual_line - 1].strip() if actual_line <= len(lines) else "",
                    suggestion="高频循环中禁止打印 DEBUG/INFO 日志，仅允许异常场景打印有限次数错误日志",
                ))

        return issues

    def _find_loop_ranges(self, lines: List[str]) -> List[Tuple[int, int]]:
        """
        识别代码中的循环体范围（while/for）
        运行步骤：
          1. 遍历每一行，查找 while/for 关键字
          2. 从循环起始行开始，通过大括号计数确定循环体结束行
          3. 返回 (起始行号, 结束行号) 列表（0-based）
        参数：
          - lines: 代码行列表
        返回值：(start_line, end_line) 元组列表
        """
        loop_ranges: List[Tuple[int, int]] = []
        # 循环起始行模式（while (...)、for (...;...;...)）
        loop_start_pattern = re.compile(r'\b(while|for)\s*\(')

        for i, line in enumerate(lines):
            if loop_start_pattern.search(line):
                # 查找循环体范围：从当前行开始匹配大括号
                start_line = i
                # 合并从当前行开始的所有内容，用于大括号匹配
                combined = "\n".join(lines[i:])
                brace_count = 0
                found_open = False
                end_offset = 0

                for j, ch in enumerate(combined):
                    if ch == "{":
                        brace_count += 1
                        found_open = True
                    elif ch == "}":
                        brace_count -= 1
                        if found_open and brace_count == 0:
                            # 计算结束行号
                            end_offset = combined[:j].count("\n")
                            break

                if found_open and brace_count == 0:
                    end_line = start_line + end_offset
                    loop_ranges.append((start_line, end_line))
                else:
                    # 大括号不匹配，保守估计循环体为后续 50 行
                    end_line = min(start_line + 50, len(lines) - 1)
                    loop_ranges.append((start_line, end_line))

        return loop_ranges

    def _check_magic_numbers(
        self, file_str: str, lines: List[str]
    ) -> List[SecurityIssue]:
        """
        检测硬编码魔法数字
        运行步骤：
          1. 跳过注释行和字符串字面量
          2. 使用正则匹配独立的数字字面量（排除 0/1/-1 等常见值）
          3. 排除已定义为常量的行
        参数：
          - file_str: 文件路径字符串
          - lines: 代码行列表
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []
        # 已定义常量/枚举/宏的行模式（排除这些行中的数字）
        const_line_pattern = re.compile(
            r'^\s*(const|constexpr|#define|enum\s+class|enum\s+\w+)',
        )

        for i, line in enumerate(lines):
            # 跳过注释行
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("/*") or stripped.startswith("*"):
                continue
            # 跳过常量定义行
            if const_line_pattern.search(line):
                continue

            # 检测魔法数字（排除 0、1、-1 以及数组索引中的小数字）
            for match in self._CPP_MAGIC_NUMBER_PATTERN.finditer(line):
                num_str = match.group(1)
                # 排除常见非魔法数字
                if num_str in ("0", "1", "-1", "2", "10", "100", "1000"):
                    continue
                # 排除行号类数字（如 __LINE__ 附近）
                if "__LINE__" in line:
                    continue

                issues.append(SecurityIssue(
                    layer=ValidationLayer.LAYER2.value,
                    severity=Severity.WARNING,
                    category="code_quality",
                    rule_id="style:magic_number",
                    description=f"检测到可能的硬编码魔法数字: {num_str}",
                    location=f"{file_str}:{i + 1}",
                    code_snippet=stripped,
                    suggestion="请将魔法数字定义为命名常量或通过 ROS 参数服务器配置",
                ))

        return issues

    def _check_ros_include_format(
        self, file_str: str, lines: List[str]
    ) -> List[SecurityIssue]:
        """
        检测 ROS 跨包引用格式违规（使用相对路径引用而非 <pkg/header.h>）
        参数：
          - file_str: 文件路径字符串
          - lines: 代码行列表
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []
        for i, line in enumerate(lines):
            if self._CPP_RELATIVE_INCLUDE_PATTERN.search(line):
                issues.append(SecurityIssue(
                    layer=ValidationLayer.LAYER2.value,
                    severity=Severity.ERROR,
                    category="ros_compliance",
                    rule_id="ros:include_format",
                    description="ROS 跨包头文件引用使用了相对路径格式，应使用 <pkg/header.h> 标准格式",
                    location=f"{file_str}:{i + 1}",
                    code_snippet=line.strip(),
                    suggestion="请将 #include \"other_pkg/xxx.h\" 改为 #include <other_pkg/xxx.h>",
                ))
        return issues

    def _check_ros2_qos(
        self, file_str: str, lines: List[str]
    ) -> List[SecurityIssue]:
        """
        检测 ROS2 QoS 配置缺失（创建 publisher/subscriber 时未指定 QoS）
        参数：
          - file_str: 文件路径字符串
          - lines: 代码行列表
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []
        for i, line in enumerate(lines):
            if self._CPP_QOS_MISSING_PATTERN.search(line):
                issues.append(SecurityIssue(
                    layer=ValidationLayer.LAYER2.value,
                    severity=Severity.WARNING,
                    category="ros2_compliance",
                    rule_id="ros2:qos_missing",
                    description="ROS2 创建 publisher/subscriber 时未显式指定 QoS 配置",
                    location=f"{file_str}:{i + 1}",
                    code_snippet=line.strip(),
                    suggestion="请根据场景显式配置 QoS 策略（如 rclcpp::QoS(10).reliable()）",
                ))
        return issues

    def _analyze_python_layer2(
        self, file_path: Path, content: str
    ) -> List[SecurityIssue]:
        """
        对 Python 代码执行第 2 层 AST/正则规则校验
        检测项：
          1. 裸 except 子句
          2. 不安全函数调用（eval/exec/os.system 等）
          3. 硬编码参数
        参数：
          - file_path: 文件路径
          - content: 文件内容字符串
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []
        lines = content.split("\n")
        file_str = str(file_path)

        # ---- 使用 AST 模块进行结构化分析 ----
        try:
            tree = py_ast.parse(content, filename=file_str)
            issues.extend(self._check_py_bare_except_ast(file_str, tree, lines))
            issues.extend(self._check_py_unsafe_calls_ast(file_str, tree, lines))
        except SyntaxError as e:
            logger.warning(f"Python AST 解析失败 {file_str}: {e}")
            # AST 解析失败时使用正则兜底
            issues.extend(self._check_py_bare_except_regex(file_str, lines))
            issues.extend(self._check_py_unsafe_calls_regex(file_str, lines))

        # ---- 检测硬编码参数 ----
        issues.extend(self._check_py_hardcoded_params(file_str, lines))

        return issues

    def _check_py_bare_except_ast(
        self, file_str: str, tree: py_ast.AST, lines: List[str]
    ) -> List[SecurityIssue]:
        """
        使用 AST 检测 Python 裸 except 子句
        运行步骤：
          1. 遍历 AST 节点树
          2. 查找 ExceptHandler 节点
          3. 检查其 type 属性是否为空（裸 except）
        参数：
          - file_str: 文件路径字符串
          - tree: AST 语法树
          - lines: 代码行列表
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []
        for node in py_ast.walk(tree):
            if isinstance(node, py_ast.ExceptHandler):
                # type 为 None 表示裸 except: 或 except Exception as e: 未指定具体异常类型
                if node.type is None:
                    line_num = node.lineno
                    issues.append(SecurityIssue(
                        layer=ValidationLayer.LAYER2.value,
                        severity=Severity.WARNING,
                        category="exception_handling",
                        rule_id="py:bare_except",
                        description="检测到裸 except 子句，可能捕获过多异常",
                        location=f"{file_str}:{line_num}",
                        code_snippet=lines[line_num - 1].strip() if line_num <= len(lines) else "",
                        suggestion="请指定具体的异常类型，如 except ValueError:",
                    ))
        return issues

    def _check_py_unsafe_calls_ast(
        self, file_str: str, tree: py_ast.AST, lines: List[str]
    ) -> List[SecurityIssue]:
        """
        使用 AST 检测 Python 不安全函数调用
        检测项：eval、exec、compile、os.system、subprocess.call(shell=True)
        参数：
          - file_str: 文件路径字符串
          - tree: AST 语法树
          - lines: 代码行列表
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []
        unsafe_funcs = {"eval", "exec", "compile"}

        for node in py_ast.walk(tree):
            if isinstance(node, py_ast.Call):
                # 检测 eval/exec/compile 直接调用
                if isinstance(node.func, py_ast.Name) and node.func.id in unsafe_funcs:
                    line_num = node.lineno
                    issues.append(SecurityIssue(
                        layer=ValidationLayer.LAYER2.value,
                        severity=Severity.CRITICAL,
                        category="unsafe_function",
                        rule_id=f"py:unsafe_{node.func.id}",
                        description=f"检测到不安全的函数调用: {node.func.id}()",
                        location=f"{file_str}:{line_num}",
                        code_snippet=lines[line_num - 1].strip() if line_num <= len(lines) else "",
                        suggestion=f"请避免使用 {node.func.id}()，寻找更安全的替代方案",
                    ))

                # 检测 os.system 调用
                if (
                    isinstance(node.func, py_ast.Attribute) and
                    isinstance(node.func.value, py_ast.Name) and
                    node.func.value.id == "os" and
                    node.func.attr == "system"
                ):
                    line_num = node.lineno
                    issues.append(SecurityIssue(
                        layer=ValidationLayer.LAYER2.value,
                        severity=Severity.CRITICAL,
                        category="unsafe_function",
                        rule_id="py:unsafe_os_system",
                        description="检测到不安全的 os.system() 调用",
                        location=f"{file_str}:{line_num}",
                        code_snippet=lines[line_num - 1].strip() if line_num <= len(lines) else "",
                        suggestion="请使用 subprocess.run() 并避免 shell=True",
                    ))

                # 检测 subprocess.call(shell=True)
                if (
                    isinstance(node.func, py_ast.Attribute) and
                    isinstance(node.func.value, py_ast.Name) and
                    node.func.value.id == "subprocess" and
                    node.func.attr in ("call", "Popen")
                ):
                    for kw in node.keywords:
                        if kw.arg == "shell" and getattr(kw.value, "value", None) is True:
                            line_num = node.lineno
                            issues.append(SecurityIssue(
                                layer=ValidationLayer.LAYER2.value,
                                severity=Severity.CRITICAL,
                                category="unsafe_function",
                                rule_id="py:unsafe_subprocess_shell",
                                description="检测到 subprocess 调用使用了 shell=True",
                                location=f"{file_str}:{line_num}",
                                code_snippet=lines[line_num - 1].strip() if line_num <= len(lines) else "",
                                suggestion="请避免 shell=True，使用列表参数传递命令",
                            ))
        return issues

    def _check_py_bare_except_regex(
        self, file_str: str, lines: List[str]
    ) -> List[SecurityIssue]:
        """
        正则方式检测裸 except（AST 解析失败时的兜底方案）
        参数：
          - file_str: 文件路径字符串
          - lines: 代码行列表
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []
        for i, line in enumerate(lines):
            if self._PY_BARE_EXCEPT_PATTERN.search(line):
                issues.append(SecurityIssue(
                    layer=ValidationLayer.LAYER2.value,
                    severity=Severity.WARNING,
                    category="exception_handling",
                    rule_id="py:bare_except",
                    description="检测到裸 except 子句",
                    location=f"{file_str}:{i + 1}",
                    code_snippet=line.strip(),
                    suggestion="请指定具体的异常类型",
                ))
        return issues

    def _check_py_unsafe_calls_regex(
        self, file_str: str, lines: List[str]
    ) -> List[SecurityIssue]:
        """
        正则方式检测不安全函数（AST 解析失败时的兜底方案）
        参数：
          - file_str: 文件路径字符串
          - lines: 代码行列表
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []
        for i, line in enumerate(lines):
            if self._PY_UNSAFE_FUNC_PATTERN.search(line):
                issues.append(SecurityIssue(
                    layer=ValidationLayer.LAYER2.value,
                    severity=Severity.CRITICAL,
                    category="unsafe_function",
                    rule_id="py:unsafe_function",
                    description=f"检测到不安全的函数调用: {line.strip()}",
                    location=f"{file_str}:{i + 1}",
                    code_snippet=line.strip(),
                    suggestion="请使用更安全的替代方案",
                ))
        return issues

    def _check_py_hardcoded_params(
        self, file_str: str, lines: List[str]
    ) -> List[SecurityIssue]:
        """
        检测 Python 代码中的硬编码参数（模块级常量赋值）
        参数：
          - file_str: 文件路径字符串
          - lines: 代码行列表
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []
        for i, line in enumerate(lines):
            # 跳过注释行和文档字符串
            stripped = line.strip()
            if stripped.startswith("#") or stripped.startswith('"""') or stripped.startswith("'''"):
                continue

            match = self._PY_HARDCODED_PARAM_PATTERN.match(line)
            if match:
                # 提取常量名和值
                const_name = match.group(0).split("=")[0].strip()
                issues.append(SecurityIssue(
                    layer=ValidationLayer.LAYER2.value,
                    severity=Severity.INFO,
                    category="code_quality",
                    rule_id="py:hardcoded_param",
                    description=f"检测到硬编码参数: {const_name}",
                    location=f"{file_str}:{i + 1}",
                    code_snippet=stripped,
                    suggestion="请将可调参数移至 ROS 参数服务器或独立 YAML 配置文件",
                ))
        return issues

    # ============================================================
    # 第 3 层：算法边界与安全逻辑校验
    # ============================================================

    def validate_layer3(self, code_content: str) -> LayerResult:
        """
        第 3 层校验：算法边界条件与安全逻辑校验
        检测项：
          1. 安全兜底机制是否存在
          2. 边界条件处理是否完备
          3. 异常分支覆盖率
          4. 急停逻辑完整性
        运行步骤：
          1. 检测安全兜底机制（默认值、限幅、fallback）
          2. 检测边界条件处理（范围检查、空值检查）
          3. 检测异常处理分支覆盖
          4. 检测急停/紧急停止逻辑
          5. 汇总生成 LayerResult
        参数：
          - code_content: 代码内容字符串（可以是单文件或多文件拼接）
        返回值：LayerResult 对象
        """
        import time
        start_time = time.time()

        result = LayerResult(layer=ValidationLayer.LAYER3.value)
        all_issues: List[SecurityIssue] = []

        # ---- 检测安全兜底机制 ----
        all_issues.extend(self._check_safety_fallback(code_content))

        # ---- 检测边界条件处理 ----
        all_issues.extend(self._check_boundary_conditions(code_content))

        # ---- 检测异常分支覆盖 ----
        all_issues.extend(self._check_exception_coverage(code_content))

        # ---- 检测急停逻辑完整性 ----
        all_issues.extend(self._check_emergency_stop(code_content))

        result.issues = all_issues
        result.execution_time_ms = (time.time() - start_time) * 1000

        # 计算评分：第 3 层问题权重更高
        penalty = 0.0
        for issue in all_issues:
            if issue.severity == Severity.CRITICAL:
                penalty += 30.0
            elif issue.severity == Severity.ERROR:
                penalty += 20.0
            elif issue.severity == Severity.WARNING:
                penalty += 8.0
            elif issue.severity == Severity.INFO:
                penalty += 2.0
        result.score = max(0.0, 100.0 - penalty)
        result.passed = not any(
            i.severity in (Severity.CRITICAL, Severity.ERROR) for i in all_issues
        )

        logger.info(
            f"Layer3 校验完成 | 问题数={len(all_issues)} | "
            f"评分={result.score:.1f} | 通过={result.passed}"
        )
        return result

    def _check_safety_fallback(self, content: str) -> List[SecurityIssue]:
        """
        检测安全兜底机制是否存在
        检测项：
          - 是否有默认安全值/限幅逻辑
          - 是否有 fallback/降级处理
          - 是否有 try-except 保护关键路径
        参数：
          - content: 代码内容
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []

        # 检测是否存在限幅/钳位逻辑（clamp、limit、bound、saturate）
        has_clamp = bool(re.search(
            r'\b(clamp|limit|bound|saturate|min\s*\(|max\s*\(|std::clamp)',
            content, re.IGNORECASE,
        ))
        # 检测是否存在默认安全值
        has_default = bool(re.search(
            r'\b(default|fallback|safe_value|DEFAULT_|FALLBACK_)',
            content,
        ))
        # 检测是否存在异常保护
        has_try_catch = bool(re.search(r'\btry\s*\{', content))
        has_try_except = bool(re.search(r'\btry\s*:', content))

        if not has_clamp and not has_default:
            issues.append(SecurityIssue(
                layer=ValidationLayer.LAYER3.value,
                severity=Severity.WARNING,
                category="safety_fallback",
                rule_id="safety:no_clamp_or_default",
                description="未检测到限幅逻辑或默认安全值，缺少安全兜底机制",
                location="",
                suggestion="请为关键变量添加限幅约束（clamp/limit）和默认安全值",
            ))

        if not has_try_catch and not has_try_except:
            issues.append(SecurityIssue(
                layer=ValidationLayer.LAYER3.value,
                severity=Severity.WARNING,
                category="safety_fallback",
                rule_id="safety:no_exception_protection",
                description="未检测到异常保护机制（try-catch/try-except），关键路径缺少异常兜底",
                location="",
                suggestion="请为关键执行路径添加异常捕获和降级处理逻辑",
            ))

        return issues

    def _check_boundary_conditions(self, content: str) -> List[SecurityIssue]:
        """
        检测边界条件处理是否完备
        检测项：
          - 输入合法性校验（空值检查、范围检查）
          - 数组/容器越界保护
          - 除零保护
        参数：
          - content: 代码内容
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []

        # 检测空值检查
        has_null_check = bool(re.search(
            r'\b(nullptr|NULL|None|if\s*\(!\w+\)|if\s+\w+\s*==\s*(nullptr|NULL|None)|'
            r'\.empty\(\)|\.size\(\)\s*==\s*0)',
            content,
        ))

        # 检测范围检查
        has_range_check = bool(re.search(
            r'\b(range|bounds|>\s*=|<\s*=|\bin\s+range\b|between)',
            content, re.IGNORECASE,
        ))

        # 检测除零保护
        has_div_zero_protection = bool(re.search(
            r'\b(denominator|divisor|if\s*\(.*!=\s*0\)|if\s+.*\b0\b)',
            content,
        ))

        if not has_null_check:
            issues.append(SecurityIssue(
                layer=ValidationLayer.LAYER3.value,
                severity=Severity.WARNING,
                category="boundary_condition",
                rule_id="boundary:no_null_check",
                description="未检测到空值/空指针检查逻辑",
                location="",
                suggestion="请为指针、引用、容器访问添加空值检查",
            ))

        if not has_range_check:
            issues.append(SecurityIssue(
                layer=ValidationLayer.LAYER3.value,
                severity=Severity.WARNING,
                category="boundary_condition",
                rule_id="boundary:no_range_check",
                description="未检测到范围/边界检查逻辑",
                location="",
                suggestion="请为数组索引、数值范围添加边界检查",
            ))

        if not has_div_zero_protection:
            issues.append(SecurityIssue(
                layer=ValidationLayer.LAYER3.value,
                severity=Severity.INFO,
                category="boundary_condition",
                rule_id="boundary:no_div_zero_check",
                description="未检测到显式的除零保护逻辑",
                location="",
                suggestion="请在除法运算前检查分母是否为零",
            ))

        return issues

    def _check_exception_coverage(self, content: str) -> List[SecurityIssue]:
        """
        检测异常分支覆盖率
        检测项：
          - 关键函数是否有异常处理
          - 是否有错误状态传播机制
          - 是否有超时处理
        参数：
          - content: 代码内容
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []

        # 检测错误状态传播（return error code、throw、raise）
        has_error_propagation = bool(re.search(
            r'\b(return\s+-?\d+|throw\s+|raise\s+\w+Error|return\s+false|'
            r'return\s+Result|return\s+Status)',
            content,
        ))

        # 检测超时处理
        has_timeout = bool(re.search(
            r'\b(timeout|TIME_OUT|TIMEOUT|deadline|max_wait)',
            content, re.IGNORECASE,
        ))

        if not has_error_propagation:
            issues.append(SecurityIssue(
                layer=ValidationLayer.LAYER3.value,
                severity=Severity.WARNING,
                category="exception_coverage",
                rule_id="exception:no_error_propagation",
                description="未检测到错误状态传播机制（返回值/异常抛出）",
                location="",
                suggestion="请确保关键函数有明确的错误返回或异常传播机制",
            ))

        if not has_timeout:
            issues.append(SecurityIssue(
                layer=ValidationLayer.LAYER3.value,
                severity=Severity.INFO,
                category="exception_coverage",
                rule_id="exception:no_timeout",
                description="未检测到超时处理机制",
                location="",
                suggestion="请为网络/IO 操作添加超时保护",
            ))

        return issues

    def _check_emergency_stop(self, content: str) -> List[SecurityIssue]:
        """
        检测急停逻辑完整性
        检测项：
          - 是否有急停/紧急停止信号处理
          - 是否有安全状态切换逻辑
          - 是否有故障恢复流程
        参数：
          - content: 代码内容
        返回值：SecurityIssue 列表
        """
        issues: List[SecurityIssue] = []

        # 检测急停相关关键词
        has_emergency_stop = bool(re.search(
            r'\b(emergency_stop|e_stop|E_STOP|emergency|halt|shutdown|'
            r'SAFE_STATE|safe_mode|DISABLE|ABORT)',
            content, re.IGNORECASE,
        ))

        # 检测状态机安全状态
        has_safe_state = bool(re.search(
            r'\b(SAFE|safe_state|STATE_SAFE|IDLE|DISABLED|ERROR_STATE)',
            content,
        ))

        if not has_emergency_stop:
            issues.append(SecurityIssue(
                layer=ValidationLayer.LAYER3.value,
                severity=Severity.CRITICAL,
                category="emergency_stop",
                rule_id="safety:no_emergency_stop",
                description="未检测到急停/紧急停止逻辑",
                location="",
                suggestion="机器人控制代码必须实现急停逻辑，包括紧急停止信号处理和电机断电",
            ))

        if not has_safe_state:
            issues.append(SecurityIssue(
                layer=ValidationLayer.LAYER3.value,
                severity=Severity.WARNING,
                category="emergency_stop",
                rule_id="safety:no_safe_state",
                description="未检测到安全状态定义或状态切换逻辑",
                location="",
                suggestion="请定义安全状态（SAFE_STATE），确保异常时能切换到安全状态",
            ))

        return issues

    # ============================================================
    # 综合校验
    # ============================================================

    def full_validate(
        self, code_path: str, language: str, risk_level: str
    ) -> SecurityReport:
        """
        执行完整的三层安全校验
        运行步骤：
          1. 校验输入参数合法性
          2. 读取代码内容（供 Layer3 使用）
          3. 根据风险等级决定执行哪些校验层：
             - low: 仅 Layer1
             - medium: Layer1 + Layer2
             - high/very_high: Layer1 + Layer2 + Layer3
          4. 依次执行各层校验
          5. 汇总生成综合报告
          6. 缓存报告供 get_validation_report 使用
        参数：
          - code_path: 代码文件或目录的绝对路径
          - language: 编程语言（cpp/python）
          - risk_level: 风险等级（low/medium/high/very_high）
        返回值：SecurityReport 对象
        """
        # 参数校验
        if not code_path or not os.path.exists(code_path):
            logger.error(f"代码路径不存在: {code_path}")
            return SecurityReport(
                code_path=code_path,
                language=language,
                risk_level=risk_level,
                overall_passed=False,
                overall_score=0.0,
                generated_at=datetime.now(timezone.utc).isoformat(),
            )

        if language not in ("cpp", "python"):
            logger.error(f"不支持的语言类型: {language}")
            return SecurityReport(
                code_path=code_path,
                language=language,
                risk_level=risk_level,
                overall_passed=False,
                overall_score=0.0,
                generated_at=datetime.now(timezone.utc).isoformat(),
            )

        logger.info(
            f"开始全量安全校验 | 路径={code_path} | 语言={language} | 风险等级={risk_level}"
        )

        layer_results: List[LayerResult] = []

        # 读取代码内容（供 Layer3 使用）
        code_content = self._read_code_content(code_path, language)

        # ---- Layer1: 工具自动校验（所有风险等级都执行） ----
        layer1_result = self.validate_layer1(code_path, language)
        layer_results.append(layer1_result)

        # ---- Layer2: AST 规则校验（medium 及以上执行） ----
        if risk_level in (RiskLevel.MEDIUM.value, RiskLevel.HIGH.value, RiskLevel.VERY_HIGH.value):
            layer2_result = self.validate_layer2(code_path, language)
            layer_results.append(layer2_result)

        # ---- Layer3: 安全逻辑校验（high/very_high 执行） ----
        if risk_level in (RiskLevel.HIGH.value, RiskLevel.VERY_HIGH.value):
            layer3_result = self.validate_layer3(code_content)
            layer_results.append(layer3_result)

        # 汇总生成综合报告
        report = self._build_report(
            code_path, language, risk_level, layer_results
        )

        # 缓存最近一次报告
        self._last_report = report

        logger.info(
            f"全量安全校验完成 | 综合评分={report.overall_score:.1f} | "
            f"通过={report.overall_passed} | 问题总数={report.total_issues}"
        )
        return report

    def _read_code_content(self, code_path: str, language: str) -> str:
        """
        读取代码路径下的所有源代码内容（拼接为单一字符串供 Layer3 使用）
        运行步骤：
          1. 根据语言确定文件扩展名
          2. 收集所有源文件
          3. 读取并拼接文件内容
        参数：
          - code_path: 代码路径
          - language: 编程语言
        返回值：拼接后的代码内容字符串
        """
        if language == "cpp":
            extensions = [".cpp", ".cc", ".cxx", ".c", ".h", ".hpp"]
        else:
            extensions = [".py"]

        files = self._collect_source_files(code_path, extensions)
        contents: List[str] = []
        for f in files:
            try:
                contents.append(f.read_text(encoding="utf-8", errors="ignore"))
            except Exception as e:
                logger.warning(f"读取文件失败 {f}: {e}")
        return "\n".join(contents)

    def _build_report(
        self,
        code_path: str,
        language: str,
        risk_level: str,
        layer_results: List[LayerResult],
    ) -> SecurityReport:
        """
        汇总各层校验结果，生成综合安全报告
        运行步骤：
          1. 统计各严重程度问题数量
          2. 计算综合评分（各层评分的加权平均）
          3. 判断是否需要人工审核
          4. 构建 SecurityReport 对象
        参数：
          - code_path: 代码路径
          - language: 编程语言
          - risk_level: 风险等级
          - layer_results: 各层校验结果列表
        返回值：SecurityReport 对象
        """
        report = SecurityReport(
            code_path=code_path,
            language=language,
            risk_level=risk_level,
            layer_results=layer_results,
            generated_at=datetime.now(timezone.utc).isoformat(),
        )

        # 统计各严重程度问题数量
        for lr in layer_results:
            for issue in lr.issues:
                report.total_issues += 1
                if issue.severity == Severity.CRITICAL:
                    report.critical_count += 1
                elif issue.severity == Severity.ERROR:
                    report.error_count += 1
                elif issue.severity == Severity.WARNING:
                    report.warning_count += 1
                elif issue.severity == Severity.INFO:
                    report.info_count += 1

        # 计算综合评分：各层评分的加权平均
        if layer_results:
            # 各层权重：Layer1=0.3, Layer2=0.35, Layer3=0.35
            weights = {
                ValidationLayer.LAYER1.value: 0.3,
                ValidationLayer.LAYER2.value: 0.35,
                ValidationLayer.LAYER3.value: 0.35,
            }
            total_weight = 0.0
            weighted_score = 0.0
            for lr in layer_results:
                w = weights.get(lr.layer, 0.3)
                weighted_score += lr.score * w
                total_weight += w
            report.overall_score = (
                weighted_score / total_weight if total_weight > 0 else 0.0
            )
        else:
            report.overall_score = 0.0

        # 综合通过判定：所有层都通过且综合评分 >= 60
        all_layers_passed = all(lr.passed for lr in layer_results)
        report.overall_passed = all_layers_passed and report.overall_score >= 60.0

        # 高风险/极高风险模块需要人工审核
        report.requires_human_review = risk_level in (
            RiskLevel.HIGH.value,
            RiskLevel.VERY_HIGH.value,
        )

        return report

    def get_validation_report(self) -> Optional[SecurityReport]:
        """
        获取最近一次校验的结构化报告
        返回值：SecurityReport 对象或 None（未执行过校验时）
        """
        return self._last_report


# ============================================================
# SecurityReviewManager - 人工审核流程管理
# ============================================================

class SecurityReviewManager:
    """
    人工审核流程管理器
    作用：管理高风险/极高风险模块的强制人工审核流程，
          包括审核记录持久化、检查项管理、迭代次数控制
    调用方：任务执行引擎、安全校验模块
    被调用方：数据库（审核记录持久化）
    """

    # ---- 默认审核检查项定义 ----
    # 每个检查项包含：名称、描述、是否必须通过
    DEFAULT_CHECK_ITEMS: Dict[str, Dict[str, Any]] = {
        "emergency_stop": {
            "name": "急停逻辑",
            "description": "验证急停/紧急停止逻辑的完整性和正确性",
            "required": True,
            "passed": False,
            "comment": "",
        },
        "motion_control_limits": {
            "name": "运动控制限幅",
            "description": "验证运动控制指令的双层极限值约束和输出限幅",
            "required": True,
            "passed": False,
            "comment": "",
        },
        "exception_handling": {
            "name": "异常处理",
            "description": "验证异常分支覆盖率、异常兜底逻辑和降级处理",
            "required": True,
            "passed": False,
            "comment": "",
        },
        "boundary_conditions": {
            "name": "边界条件",
            "description": "验证输入合法性校验、数组越界保护、除零保护等边界处理",
            "required": True,
            "passed": False,
            "comment": "",
        },
        "security_coding_compliance": {
            "name": "安全编码合规",
            "description": "验证代码是否符合安全编码规范（无内存泄漏、无空指针解引用等）",
            "required": True,
            "passed": False,
            "comment": "",
        },
        "test_coverage": {
            "name": "测试覆盖",
            "description": "验证安全机制的测试覆盖率（故障注入、急停触发、极限工况、异常数据注入）",
            "required": True,
            "passed": False,
            "comment": "",
        },
    }

    def __init__(self):
        """
        初始化人工审核管理器
        运行步骤：
          1. 从全局配置读取审核相关配置
          2. 初始化审核记录存储（内存字典，生产环境应替换为数据库）
          3. 设置最大审核轮次
        """
        # 从全局配置读取安全审核配置
        self._security_config: Dict[str, Any] = settings.security
        self._max_iterations: int = self._security_config.get(
            "max_review_iterations", 3
        )

        # 审核记录存储（key: review_id, value: ReviewRecord）
        # 生产环境应替换为数据库持久化
        self._review_records: Dict[str, ReviewRecord] = {}

        # 审核记录持久化目录
        self._persist_dir: Path = (
            settings.get_project_root() / "data" / "security_reviews"
        )
        self._persist_dir.mkdir(parents=True, exist_ok=True)

        logger.info(
            f"人工审核管理器初始化完成 | 最大审核轮次={self._max_iterations} | "
            f"持久化目录={self._persist_dir}"
        )

    def create_review(
        self,
        module_name: str,
        code_path: str,
        risk_level: str,
        reviewer: str = "",
    ) -> ReviewRecord:
        """
        创建新的人工审核记录
        运行步骤：
          1. 生成唯一审核 ID
          2. 初始化检查项（全部标记为未通过）
          3. 创建 ReviewRecord 并存入内存
          4. 持久化到磁盘
        参数：
          - module_name: 模块名称
          - code_path: 代码路径
          - risk_level: 风险等级
          - reviewer: 审核人（可选）
        返回值：ReviewRecord 对象
        """
        import uuid

        review_id = str(uuid.uuid4())[:8]
        now = datetime.now(timezone.utc).isoformat()

        # 深拷贝默认检查项，避免共享引用
        import copy
        check_items = copy.deepcopy(self.DEFAULT_CHECK_ITEMS)

        record = ReviewRecord(
            review_id=review_id,
            module_name=module_name,
            code_path=code_path,
            risk_level=risk_level,
            iteration=1,
            status=ReviewStatus.PENDING,
            reviewer=reviewer,
            check_items=check_items,
            comments="",
            created_at=now,
            updated_at=now,
            resolved_at="",
        )

        self._review_records[review_id] = record
        self._persist_record(record)

        logger.info(
            f"创建审核记录 | ID={review_id} | 模块={module_name} | "
            f"风险等级={risk_level} | 审核人={reviewer or '未指定'}"
        )
        return record

    def get_review(self, review_id: str) -> Optional[ReviewRecord]:
        """
        获取审核记录
        参数：
          - review_id: 审核记录 ID
        返回值：ReviewRecord 对象或 None
        """
        return self._review_records.get(review_id)

    def start_review(self, review_id: str, reviewer: str) -> Optional[ReviewRecord]:
        """
        开始审核（将状态从 PENDING 变更为 IN_REVIEW）
        参数：
          - review_id: 审核记录 ID
          - reviewer: 审核人
        返回值：更新后的 ReviewRecord 或 None
        """
        record = self._review_records.get(review_id)
        if not record:
            logger.error(f"审核记录不存在: {review_id}")
            return None

        if record.status != ReviewStatus.PENDING:
            logger.warning(
                f"审核记录状态不允许开始审核 | ID={review_id} | 当前状态={record.status.value}"
            )
            return None

        record.status = ReviewStatus.IN_REVIEW
        record.reviewer = reviewer
        record.updated_at = datetime.now(timezone.utc).isoformat()
        self._persist_record(record)

        logger.info(f"审核已开始 | ID={review_id} | 审核人={reviewer}")
        return record

    def update_check_item(
        self,
        review_id: str,
        item_key: str,
        passed: bool,
        comment: str = "",
    ) -> Optional[ReviewRecord]:
        """
        更新单个审核检查项的结果
        运行步骤：
          1. 查找审核记录
          2. 验证检查项是否存在
          3. 更新检查项的 passed 和 comment
          4. 持久化
        参数：
          - review_id: 审核记录 ID
          - item_key: 检查项键名
          - passed: 是否通过
          - comment: 审核意见
        返回值：更新后的 ReviewRecord 或 None
        """
        record = self._review_records.get(review_id)
        if not record:
            logger.error(f"审核记录不存在: {review_id}")
            return None

        if record.status != ReviewStatus.IN_REVIEW:
            logger.warning(
                f"审核记录状态不允许更新检查项 | ID={review_id} | 当前状态={record.status.value}"
            )
            return None

        if item_key not in record.check_items:
            logger.error(f"检查项不存在: {item_key}")
            return None

        record.check_items[item_key]["passed"] = passed
        record.check_items[item_key]["comment"] = comment
        record.updated_at = datetime.now(timezone.utc).isoformat()
        self._persist_record(record)

        logger.info(
            f"检查项已更新 | ID={review_id} | 检查项={item_key} | 通过={passed}"
        )
        return record

    def approve_review(self, review_id: str, comments: str = "") -> Optional[ReviewRecord]:
        """
        批准审核（将状态变更为 APPROVED）
        运行步骤：
          1. 查找审核记录
          2. 验证所有必须通过的检查项都已通过
          3. 更新状态为 APPROVED
          4. 持久化
        参数：
          - review_id: 审核记录 ID
          - comments: 审核总结意见
        返回值：更新后的 ReviewRecord 或 None
        """
        record = self._review_records.get(review_id)
        if not record:
            logger.error(f"审核记录不存在: {review_id}")
            return None

        if record.status != ReviewStatus.IN_REVIEW:
            logger.warning(
                f"审核记录状态不允许批准 | ID={review_id} | 当前状态={record.status.value}"
            )
            return None

        # 验证所有必须通过的检查项
        failed_required = [
            key for key, item in record.check_items.items()
            if item.get("required", False) and not item.get("passed", False)
        ]
        if failed_required:
            logger.warning(
                f"存在未通过的必须检查项，无法批准 | ID={review_id} | "
                f"未通过项={failed_required}"
            )
            return None

        record.status = ReviewStatus.APPROVED
        record.comments = comments
        record.resolved_at = datetime.now(timezone.utc).isoformat()
        record.updated_at = record.resolved_at
        self._persist_record(record)

        logger.info(f"审核已批准 | ID={review_id} | 审核轮次={record.iteration}")
        return record

    def reject_review(
        self, review_id: str, comments: str = ""
    ) -> Optional[ReviewRecord]:
        """
        驳回审核（将状态变更为 REJECTED，允许重新提交）
        运行步骤：
          1. 查找审核记录
          2. 检查是否超过最大迭代次数
          3. 若未超过，状态变更为 REJECTED，迭代次数 +1
          4. 若超过，状态变更为 REJECTED 并标记不可再迭代
          5. 持久化
        参数：
          - review_id: 审核记录 ID
          - comments: 驳回原因
        返回值：更新后的 ReviewRecord 或 None
        """
        record = self._review_records.get(review_id)
        if not record:
            logger.error(f"审核记录不存在: {review_id}")
            return None

        if record.status != ReviewStatus.IN_REVIEW:
            logger.warning(
                f"审核记录状态不允许驳回 | ID={review_id} | 当前状态={record.status.value}"
            )
            return None

        # 检查是否超过最大迭代次数
        if record.iteration >= self._max_iterations:
            logger.warning(
                f"审核已达到最大迭代次数 | ID={review_id} | "
                f"当前轮次={record.iteration}/{self._max_iterations}"
            )
            # 超过最大迭代次数，标记为 CANCELLED
            record.status = ReviewStatus.CANCELLED
            record.comments = (
                f"已达到最大审核轮次（{self._max_iterations}），审核已取消。"
                f"驳回原因: {comments}"
            )
        else:
            record.status = ReviewStatus.REJECTED
            record.iteration += 1
            record.comments = comments

        record.updated_at = datetime.now(timezone.utc).isoformat()
        self._persist_record(record)

        logger.info(
            f"审核已驳回 | ID={review_id} | 新轮次={record.iteration} | "
            f"状态={record.status.value}"
        )
        return record

    def resubmit_review(self, review_id: str) -> Optional[ReviewRecord]:
        """
        重新提交审核（将状态从 REJECTED 变更为 IN_REVIEW）
        运行步骤：
          1. 查找审核记录
          2. 验证状态为 REJECTED 且未超过最大迭代次数
          3. 重置所有检查项为未通过
          4. 状态变更为 IN_REVIEW
          5. 持久化
        参数：
          - review_id: 审核记录 ID
        返回值：更新后的 ReviewRecord 或 None
        """
        record = self._review_records.get(review_id)
        if not record:
            logger.error(f"审核记录不存在: {review_id}")
            return None

        if record.status != ReviewStatus.REJECTED:
            logger.warning(
                f"审核记录状态不允许重新提交 | ID={review_id} | 当前状态={record.status.value}"
            )
            return None

        if record.iteration > self._max_iterations:
            logger.warning(
                f"审核已超过最大迭代次数，无法重新提交 | ID={review_id}"
            )
            return None

        # 重置所有检查项
        for item in record.check_items.values():
            item["passed"] = False
            item["comment"] = ""

        record.status = ReviewStatus.IN_REVIEW
        record.updated_at = datetime.now(timezone.utc).isoformat()
        self._persist_record(record)

        logger.info(f"审核已重新提交 | ID={review_id} | 当前轮次={record.iteration}")
        return record

    def cancel_review(self, review_id: str, reason: str = "") -> Optional[ReviewRecord]:
        """
        取消审核
        参数：
          - review_id: 审核记录 ID
          - reason: 取消原因
        返回值：更新后的 ReviewRecord 或 None
        """
        record = self._review_records.get(review_id)
        if not record:
            logger.error(f"审核记录不存在: {review_id}")
            return None

        record.status = ReviewStatus.CANCELLED
        record.comments = reason or "审核已取消"
        record.updated_at = datetime.now(timezone.utc).isoformat()
        self._persist_record(record)

        logger.info(f"审核已取消 | ID={review_id} | 原因={reason}")
        return record

    def get_review_summary(self, review_id: str) -> Dict[str, Any]:
        """
        获取审核摘要信息
        运行步骤：
          1. 查找审核记录
          2. 统计检查项通过情况
          3. 生成摘要字典
        参数：
          - review_id: 审核记录 ID
        返回值：审核摘要字典
        """
        record = self._review_records.get(review_id)
        if not record:
            return {"error": f"审核记录不存在: {review_id}"}

        total_items = len(record.check_items)
        passed_items = sum(
            1 for item in record.check_items.values() if item.get("passed", False)
        )
        required_items = sum(
            1 for item in record.check_items.values() if item.get("required", False)
        )
        required_passed = sum(
            1 for key, item in record.check_items.items()
            if item.get("required", False) and item.get("passed", False)
        )

        return {
            "review_id": record.review_id,
            "module_name": record.module_name,
            "code_path": record.code_path,
            "risk_level": record.risk_level,
            "iteration": record.iteration,
            "max_iterations": self._max_iterations,
            "status": record.status.value,
            "reviewer": record.reviewer,
            "total_check_items": total_items,
            "passed_items": passed_items,
            "required_items": required_items,
            "required_passed": required_passed,
            "all_required_passed": required_passed == required_items,
            "can_resubmit": (
                record.status == ReviewStatus.REJECTED
                and record.iteration <= self._max_iterations
            ),
            "created_at": record.created_at,
            "updated_at": record.updated_at,
            "resolved_at": record.resolved_at,
        }

    def list_reviews(
        self, status: Optional[str] = None, risk_level: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        列出审核记录（支持按状态和风险等级筛选）
        参数：
          - status: 审核状态筛选（可选）
          - risk_level: 风险等级筛选（可选）
        返回值：审核摘要列表
        """
        summaries = []
        for record in self._review_records.values():
            if status and record.status.value != status:
                continue
            if risk_level and record.risk_level != risk_level:
                continue
            summaries.append(self.get_review_summary(record.review_id))
        return summaries

    def _persist_record(self, record: ReviewRecord):
        """
        持久化审核记录到磁盘（JSON 文件）
        运行步骤：
          1. 构建 JSON 序列化数据
          2. 写入到 persist_dir 下的 JSON 文件
        参数：
          - record: ReviewRecord 对象
        """
        import json

        try:
            data = {
                "review_id": record.review_id,
                "module_name": record.module_name,
                "code_path": record.code_path,
                "risk_level": record.risk_level,
                "iteration": record.iteration,
                "status": record.status.value,
                "reviewer": record.reviewer,
                "check_items": record.check_items,
                "comments": record.comments,
                "created_at": record.created_at,
                "updated_at": record.updated_at,
                "resolved_at": record.resolved_at,
            }
            file_path = self._persist_dir / f"{record.review_id}.json"
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"持久化审核记录失败 | ID={record.review_id} | 错误={e}")

    def load_persisted_records(self):
        """
        从磁盘加载已持久化的审核记录（系统重启恢复用）
        运行步骤：
          1. 扫描 persist_dir 下的 JSON 文件
          2. 反序列化为 ReviewRecord
          3. 加载到内存
        """
        import json

        count = 0
        for json_file in self._persist_dir.glob("*.json"):
            try:
                with open(json_file, "r", encoding="utf-8") as f:
                    data = json.load(f)

                record = ReviewRecord(
                    review_id=data.get("review_id", ""),
                    module_name=data.get("module_name", ""),
                    code_path=data.get("code_path", ""),
                    risk_level=data.get("risk_level", ""),
                    iteration=data.get("iteration", 1),
                    status=ReviewStatus(data.get("status", "pending")),
                    reviewer=data.get("reviewer", ""),
                    check_items=data.get("check_items", {}),
                    comments=data.get("comments", ""),
                    created_at=data.get("created_at", ""),
                    updated_at=data.get("updated_at", ""),
                    resolved_at=data.get("resolved_at", ""),
                )
                self._review_records[record.review_id] = record
                count += 1
            except Exception as e:
                logger.error(f"加载审核记录失败 {json_file}: {e}")

        logger.info(f"已从磁盘加载 {count} 条审核记录")
        return []