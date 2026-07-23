"""
# ============================================================
# 系统评测服务 - 架构、代码质量、核心算法、实时性、安全、工程化评测
# ============================================================
# 核心作用：对代码工程进行全维度系统评测，包括架构合理性、全局代码质量、
#           核心算法、全链路实时性、安全性、工程化与可维护性六个维度，
#           输出结构化评测报告（8 章）
# 运行流程：
#   1. SystemEvaluator.full_evaluation() 接收工作空间路径
#   2. 依次执行六个维度的评测：
#      a. evaluate_architecture() - 架构合理性评测
#      b. evaluate_code_quality() - 全局代码质量评测
#      c. evaluate_core_algorithms() - 核心算法评测
#      d. evaluate_realtime() - 全链路实时性评测
#      e. evaluate_security() - 安全性评测
#      f. evaluate_engineering() - 工程化与可维护性评测
#   3. 汇总生成结构化评测报告（8 章）
#   4. 跟踪迭代次数，从 settings 读取 max_iterations（默认 2）
# 输入参数：
#   - workspace_path: str，代码工作空间根目录路径
#   - project: Optional[Dict]，项目信息（架构描述、模块列表等）
#   - modules: Optional[List[str]]，模块路径列表
# 输出结果：EvaluationReport 对象，包含 8 章结构化评测报告
# 修改记录：
#   - 2026-06-24 | v1.0.0 | 初始版本，实现六维系统评测 + 8 章报告
# ============================================================
"""

import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from backend.app.config import settings

logger = logging.getLogger(__name__)


# ============================================================
# 枚举类型定义
# ============================================================

class EvalGrade(str, Enum):
    """
    评测等级枚举
    取值：A（优秀）、B（良好）、C（合格）、D（不合格）、F（严重缺陷）
    """
    A = "A"
    B = "B"
    C = "C"
    D = "D"
    F = "F"


class EvalDimension(str, Enum):
    """
    评测维度枚举
    取值：ARCHITECTURE（架构）、CODE_QUALITY（代码质量）、
          CORE_ALGORITHMS（核心算法）、REALTIME（实时性）、
          SECURITY（安全性）、ENGINEERING（工程化）
    """
    ARCHITECTURE = "architecture"
    CODE_QUALITY = "code_quality"
    CORE_ALGORITHMS = "core_algorithms"
    REALTIME = "realtime"
    SECURITY = "security"
    ENGINEERING = "engineering"


# ============================================================
# 数据类定义
# ============================================================

@dataclass
class EvalFinding:
    """
    评测发现记录
    字段说明：
      - dimension: 评测维度
      - grade: 单项评级（A-F）
      - score: 单项评分（0-100）
      - strength: 优点描述
      - weakness: 缺陷描述
      - suggestion: 改进建议
      - details: 详细发现列表
    """
    dimension: str = ""
    grade: EvalGrade = EvalGrade.C
    score: float = 60.0
    strength: str = ""
    weakness: str = ""
    suggestion: str = ""
    details: List[str] = field(default_factory=list)


@dataclass
class DimensionResult:
    """
    单维度评测结果
    字段说明：
      - dimension: 评测维度
      - grade: 评级（A-F）
      - score: 评分（0-100）
      - findings: 评测发现列表
      - metrics: 量化指标字典
      - execution_time_ms: 执行耗时（毫秒）
    """
    dimension: str = ""
    grade: EvalGrade = EvalGrade.C
    score: float = 60.0
    findings: List[EvalFinding] = field(default_factory=list)
    metrics: Dict[str, Any] = field(default_factory=dict)
    execution_time_ms: float = 0.0


@dataclass
class EvaluationReport:
    """
    系统评测综合报告（8 章结构化输出）
    字段说明：
      - workspace_path: 评测的工作空间路径
      - generated_at: 报告生成时间
      - iteration_count: 当前迭代次数
      - max_iterations: 最大迭代次数
      - overall_grade: 综合评级（A-F）
      - overall_score: 综合评分（0-100）
      - dimension_results: 各维度评测结果
      - chapter_1_summary: 第 1 章 - 评测总览
      - chapter_2_architecture: 第 2 章 - 架构评测详情
      - chapter_3_code_quality: 第 3 章 - 代码质量评测详情
      - chapter_4_algorithms: 第 4 章 - 核心算法评测详情
      - chapter_5_realtime: 第 5 章 - 实时性评测详情
      - chapter_6_security: 第 6 章 - 安全性评测详情
      - chapter_7_engineering: 第 7 章 - 工程化评测详情
      - chapter_8_recommendations: 第 8 章 - 改进建议与行动计划
    """
    workspace_path: str = ""
    generated_at: str = ""
    iteration_count: int = 0
    max_iterations: int = 2
    overall_grade: EvalGrade = EvalGrade.C
    overall_score: float = 60.0
    dimension_results: List[DimensionResult] = field(default_factory=list)
    chapter_1_summary: Dict[str, Any] = field(default_factory=dict)
    chapter_2_architecture: Dict[str, Any] = field(default_factory=dict)
    chapter_3_code_quality: Dict[str, Any] = field(default_factory=dict)
    chapter_4_algorithms: Dict[str, Any] = field(default_factory=dict)
    chapter_5_realtime: Dict[str, Any] = field(default_factory=dict)
    chapter_6_security: Dict[str, Any] = field(default_factory=dict)
    chapter_7_engineering: Dict[str, Any] = field(default_factory=dict)
    chapter_8_recommendations: Dict[str, Any] = field(default_factory=dict)


# ============================================================
# SystemEvaluator - 系统评测核心类
# ============================================================

class SystemEvaluator:
    """
    系统评测核心类
    作用：对代码工程执行六维系统评测，输出结构化 8 章评测报告
    调用方：任务执行引擎、评测 API 端点
    被调用方：IntegrationChecker、SecurityChecker、ROSValidator
    """

    # ---- 评分到等级的映射阈值 ----
    _GRADE_THRESHOLDS: List[Tuple[float, EvalGrade]] = [
        (90.0, EvalGrade.A),
        (75.0, EvalGrade.B),
        (60.0, EvalGrade.C),
        (40.0, EvalGrade.D),
        (0.0, EvalGrade.F),
    ]

    # ---- 各维度权重（用于综合评分计算） ----
    _DIMENSION_WEIGHTS: Dict[str, float] = {
        EvalDimension.ARCHITECTURE.value: 0.20,
        EvalDimension.CODE_QUALITY.value: 0.15,
        EvalDimension.CORE_ALGORITHMS.value: 0.20,
        EvalDimension.REALTIME.value: 0.15,
        EvalDimension.SECURITY.value: 0.20,
        EvalDimension.ENGINEERING.value: 0.10,
    }

    def __init__(self):
        """
        初始化系统评测器
        运行步骤：
          1. 从全局配置读取评测相关配置
          2. 初始化迭代计数器
          3. 初始化评测结果缓存
        """
        # 从全局配置读取评测配置
        self._eval_config: Dict[str, Any] = settings.evaluation
        self._max_iterations: int = self._eval_config.get("max_iterations", 2)

        # 迭代计数器
        self._iteration_count: int = 0

        # 评测结果缓存
        self._last_report: Optional[EvaluationReport] = None

        logger.info(
            f"系统评测器初始化完成 | 最大迭代次数={self._max_iterations}"
        )

    @property
    def iteration_count(self) -> int:
        """公开的迭代计数属性，供外部读取当前迭代次数"""
        return self._iteration_count

    # ============================================================
    # 评分工具方法
    # ============================================================

    def _score_to_grade(self, score: float) -> EvalGrade:
        """
        将评分（0-100）转换为等级（A-F）
        运行步骤：
          1. 按阈值从高到低遍历
          2. 返回第一个匹配的等级
        参数：
          - score: 评分值（0-100）
        返回值：EvalGrade 枚举值
        """
        for threshold, grade in self._GRADE_THRESHOLDS:
            if score >= threshold:
                return grade
        return EvalGrade.F

    def _calculate_weighted_score(
        self, dimension_results: List[DimensionResult]
    ) -> float:
        """
        计算各维度加权综合评分
        参数：
          - dimension_results: 各维度评测结果列表
        返回值：加权综合评分（0-100）
        """
        total_weight = 0.0
        weighted_sum = 0.0
        for dr in dimension_results:
            weight = self._DIMENSION_WEIGHTS.get(dr.dimension, 0.1)
            weighted_sum += dr.score * weight
            total_weight += weight
        return weighted_sum / total_weight if total_weight > 0 else 0.0

    # ============================================================
    # 维度一：架构合理性评测
    # ============================================================

    def evaluate_architecture(
        self, project: Optional[Dict[str, Any]] = None
    ) -> DimensionResult:
        """
        架构合理性评测
        运行步骤：
          1. 分析项目模块划分是否合理（高内聚低耦合）
          2. 检查分层架构是否清晰（算法层/接口层/ROS 封装层分离）
          3. 评估接口设计的一致性
          4. 检查是否遵循 ROS 包分包规则
          5. 评估架构的可扩展性
        参数：
          - project: 项目信息字典，包含 modules、description、architecture 等字段
        返回值：DimensionResult 对象
        """
        import time
        start_time = time.time()

        result = DimensionResult(dimension=EvalDimension.ARCHITECTURE.value)
        findings: List[EvalFinding] = []
        metrics: Dict[str, Any] = {}

        if not project:
            # 无项目信息时的兜底评测
            finding = EvalFinding(
                dimension=EvalDimension.ARCHITECTURE.value,
                grade=EvalGrade.C,
                score=60.0,
                strength="",
                weakness="未提供项目架构信息，无法进行深度架构评测",
                suggestion="请提供项目架构描述、模块列表等信息以进行完整评测",
                details=["缺少项目架构信息输入"],
            )
            findings.append(finding)
            result.findings = findings
            result.score = 60.0
            result.grade = EvalGrade.C
            result.metrics = metrics
            result.execution_time_ms = (time.time() - start_time) * 1000
            return result

        # 提取项目信息
        modules = project.get("modules", [])
        description = project.get("description", "")
        arch_info = project.get("architecture", {})

        metrics["module_count"] = len(modules)
        metrics["has_architecture_desc"] = bool(description or arch_info)

        # 检查项 1：模块划分合理性
        module_names = [m.get("name", "") if isinstance(m, dict) else str(m) for m in modules]
        metrics["module_names"] = module_names

        # 检查是否有明确的模块职责划分
        has_clear_modules = len(modules) > 0
        if not has_clear_modules:
            findings.append(EvalFinding(
                dimension=EvalDimension.ARCHITECTURE.value,
                grade=EvalGrade.D,
                score=40.0,
                strength="",
                weakness="未检测到明确的模块划分",
                suggestion="建议按功能职责将代码拆分为独立模块（感知/规划/控制/通信等）",
                details=["缺少模块化结构"],
            ))

        # 检查项 2：分层架构清晰度（算法层/接口层/ROS 封装层）
        has_layered_arch = arch_info.get("layered", False) or any(
            layer in description.lower()
            for layer in ["算法层", "接口层", "封装层", "algorithm", "interface", "wrapper"]
        )
        metrics["has_layered_architecture"] = has_layered_arch

        if not has_layered_arch:
            findings.append(EvalFinding(
                dimension=EvalDimension.ARCHITECTURE.value,
                grade=EvalGrade.C,
                score=60.0,
                strength="",
                weakness="未检测到明确的分层架构设计（算法层/接口层/ROS 封装层）",
                suggestion="建议将核心算法与 ROS 接口分离，提高代码可移植性和复用性",
                details=["缺少分层架构设计"],
            ))

        # 检查项 3：接口设计一致性
        has_interface_spec = arch_info.get("interfaces", False) or any(
            kw in description.lower()
            for kw in ["接口", "interface", "api", "协议", "protocol"]
        )
        metrics["has_interface_specification"] = has_interface_spec

        if not has_interface_spec:
            findings.append(EvalFinding(
                dimension=EvalDimension.ARCHITECTURE.value,
                grade=EvalGrade.C,
                score=65.0,
                strength="",
                weakness="未检测到明确的接口规范定义",
                suggestion="建议定义模块间接口规范（ROS 消息类型、服务定义、函数签名）",
                details=["缺少接口规范文档"],
            ))

        # 计算架构维度评分
        if findings:
            avg_score = sum(f.score for f in findings) / len(findings)
        else:
            avg_score = 85.0  # 无明显问题，给予良好评分

        result.findings = findings
        result.score = avg_score
        result.grade = self._score_to_grade(avg_score)
        result.metrics = metrics
        result.execution_time_ms = (time.time() - start_time) * 1000

        logger.info(
            f"架构评测完成 | 模块数={len(modules)} | "
            f"评分={result.score:.1f} | 等级={result.grade.value}"
        )
        return result

    # ============================================================
    # 维度二：全局代码质量评测
    # ============================================================

    def evaluate_code_quality(self, workspace_path: str) -> DimensionResult:
        """
        全局代码质量评测
        运行步骤：
          1. 统计代码规模（文件数、行数、语言分布）
          2. 检查代码注释覆盖率
          3. 检查编码规范遵循度（命名规范、缩进一致性）
          4. 检测代码重复度
          5. 评估错误处理覆盖率
        参数：
          - workspace_path: 工作空间路径
        返回值：DimensionResult 对象
        """
        import time
        start_time = time.time()

        result = DimensionResult(dimension=EvalDimension.CODE_QUALITY.value)
        findings: List[EvalFinding] = []
        metrics: Dict[str, Any] = {}

        if not workspace_path or not os.path.isdir(workspace_path):
            finding = EvalFinding(
                dimension=EvalDimension.CODE_QUALITY.value,
                grade=EvalGrade.F,
                score=0.0,
                strength="",
                weakness=f"工作空间路径无效: {workspace_path}",
                suggestion="请提供有效的工作空间路径",
                details=["路径无效"],
            )
            findings.append(finding)
            result.findings = findings
            result.score = 0.0
            result.grade = EvalGrade.F
            result.metrics = metrics
            result.execution_time_ms = (time.time() - start_time) * 1000
            return result

        # 统计代码规模
        code_stats = self._collect_code_statistics(workspace_path)
        metrics.update(code_stats)

        total_files = code_stats.get("total_files", 0)
        total_lines = code_stats.get("total_lines", 0)

        # 检查项 1：代码注释覆盖率
        comment_coverage = self._estimate_comment_coverage(workspace_path)
        metrics["comment_coverage_pct"] = comment_coverage

        if comment_coverage < 10.0:
            findings.append(EvalFinding(
                dimension=EvalDimension.CODE_QUALITY.value,
                grade=EvalGrade.D,
                score=40.0,
                strength="",
                weakness=f"代码注释覆盖率过低: {comment_coverage:.1f}%",
                suggestion="建议为核心函数、类、复杂逻辑添加中文注释，目标覆盖率 > 30%",
                details=[f"当前注释覆盖率: {comment_coverage:.1f}%"],
            ))
        elif comment_coverage < 20.0:
            findings.append(EvalFinding(
                dimension=EvalDimension.CODE_QUALITY.value,
                grade=EvalGrade.C,
                score=60.0,
                strength="",
                weakness=f"代码注释覆盖率偏低: {comment_coverage:.1f}%",
                suggestion="建议增加关键逻辑的行内注释和函数级注释",
                details=[f"当前注释覆盖率: {comment_coverage:.1f}%"],
            ))

        # 检查项 2：编码规范遵循度
        style_issues = self._check_coding_style(workspace_path)
        metrics["style_issues_count"] = len(style_issues)

        if style_issues:
            findings.append(EvalFinding(
                dimension=EvalDimension.CODE_QUALITY.value,
                grade=EvalGrade.C,
                score=max(40.0, 80.0 - len(style_issues) * 2.0),
                strength="",
                weakness=f"检测到 {len(style_issues)} 处编码规范问题",
                suggestion="建议遵循 Google C++ Style Guide 和 PEP8 规范",
                details=style_issues[:10],  # 最多展示 10 条
            ))

        # 检查项 3：错误处理覆盖率
        error_handling_coverage = self._estimate_error_handling_coverage(workspace_path)
        metrics["error_handling_coverage_pct"] = error_handling_coverage

        if error_handling_coverage < 30.0:
            findings.append(EvalFinding(
                dimension=EvalDimension.CODE_QUALITY.value,
                grade=EvalGrade.D,
                score=35.0,
                strength="",
                weakness=f"错误处理覆盖率过低: {error_handling_coverage:.1f}%",
                suggestion="建议为关键执行路径添加 try-except/try-catch 异常处理",
                details=[f"当前错误处理覆盖率: {error_handling_coverage:.1f}%"],
            ))

        # 计算代码质量维度评分
        if findings:
            avg_score = sum(f.score for f in findings) / len(findings)
        else:
            avg_score = 85.0

        # 根据代码规模微调
        if total_files == 0:
            avg_score = 0.0

        result.findings = findings
        result.score = avg_score
        result.grade = self._score_to_grade(avg_score)
        result.metrics = metrics
        result.execution_time_ms = (time.time() - start_time) * 1000

        logger.info(
            f"代码质量评测完成 | 文件数={total_files} | 行数={total_lines} | "
            f"评分={result.score:.1f} | 等级={result.grade.value}"
        )
        return result

    def _collect_code_statistics(self, workspace_path: str) -> Dict[str, Any]:
        """
        收集代码规模统计信息
        运行步骤：
          1. 递归遍历工作空间
          2. 统计 Python/C++ 文件数和行数
          3. 跳过构建目录和隐藏目录
        参数：
          - workspace_path: 工作空间路径
        返回值：统计信息字典
        """
        stats: Dict[str, Any] = {
            "total_files": 0,
            "total_lines": 0,
            "python_files": 0,
            "python_lines": 0,
            "cpp_files": 0,
            "cpp_lines": 0,
            "other_files": 0,
            "other_lines": 0,
        }

        skip_dirs = {"build", "install", "log", ".git", "__pycache__", "devel", "node_modules"}
        py_extensions = {".py"}
        cpp_extensions = {".cpp", ".cc", ".cxx", ".c", ".h", ".hpp", ".hxx"}

        try:
            for root, dirs, files in os.walk(workspace_path):
                dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith(".")]
                for f in files:
                    ext = os.path.splitext(f)[1].lower()
                    file_path = os.path.join(root, f)
                    try:
                        with open(file_path, "r", encoding="utf-8", errors="ignore") as fh:
                            line_count = sum(1 for _ in fh)
                    except Exception:
                        line_count = 0

                    stats["total_files"] += 1
                    stats["total_lines"] += line_count

                    if ext in py_extensions:
                        stats["python_files"] += 1
                        stats["python_lines"] += line_count
                    elif ext in cpp_extensions:
                        stats["cpp_files"] += 1
                        stats["cpp_lines"] += line_count
                    else:
                        stats["other_files"] += 1
                        stats["other_lines"] += line_count
        except Exception as e:
            logger.error(f"收集代码统计信息失败: {e}")

        return stats

    def _estimate_comment_coverage(self, workspace_path: str) -> float:
        """
        估算代码注释覆盖率
        运行步骤：
          1. 扫描 Python 和 C++ 源文件
          2. 统计注释行数（#、//、/* */）
          3. 计算注释行占总行数的比例
        参数：
          - workspace_path: 工作空间路径
        返回值：注释覆盖率百分比（0-100）
        """
        total_lines = 0
        comment_lines = 0

        # Python 注释模式
        py_comment_pattern = re.compile(r'^\s*(#|"""|\'\'\')')
        # C++ 注释模式
        cpp_comment_pattern = re.compile(r'^\s*(//|/\*|\*|/\*\*)')

        skip_dirs = {"build", "install", "log", ".git", "__pycache__", "devel"}

        try:
            for root, dirs, files in os.walk(workspace_path):
                dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith(".")]
                for f in files:
                    ext = os.path.splitext(f)[1].lower()
                    file_path = os.path.join(root, f)

                    try:
                        with open(file_path, "r", encoding="utf-8", errors="ignore") as fh:
                            lines = fh.readlines()
                    except Exception:
                        continue

                    for line in lines:
                        total_lines += 1
                        if ext == ".py":
                            if py_comment_pattern.match(line):
                                comment_lines += 1
                        elif ext in (".cpp", ".cc", ".cxx", ".c", ".h", ".hpp", ".hxx"):
                            if cpp_comment_pattern.match(line):
                                comment_lines += 1
        except Exception as e:
            logger.error(f"估算注释覆盖率失败: {e}")

        return (comment_lines / total_lines * 100.0) if total_lines > 0 else 0.0

    def _check_coding_style(self, workspace_path: str) -> List[str]:
        """
        检查编码规范遵循度
        运行步骤：
          1. 检查 Python 文件的 PEP8 基础规范（行长度、缩进）
          2. 检查 C++ 文件的基础规范（命名风格）
        参数：
          - workspace_path: 工作空间路径
        返回值：规范问题描述列表
        """
        issues: List[str] = []

        skip_dirs = {"build", "install", "log", ".git", "__pycache__", "devel"}

        try:
            for root, dirs, files in os.walk(workspace_path):
                dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith(".")]
                for f in files[:100]:  # 限制检查文件数
                    ext = os.path.splitext(f)[1].lower()
                    file_path = os.path.join(root, f)

                    try:
                        with open(file_path, "r", encoding="utf-8", errors="ignore") as fh:
                            lines = fh.readlines()
                    except Exception:
                        continue

                    for line_num, line in enumerate(lines, start=1):
                        # 检查行长度（超过 120 字符）
                        if len(line.rstrip()) > 120:
                            issues.append(
                                f"{file_path}:{line_num}: 行长度超过 120 字符"
                            )
                            break  # 每个文件只报告一次

                        # 检查 Tab 缩进（Python 文件）
                        if ext == ".py" and "\t" in line:
                            issues.append(
                                f"{file_path}:{line_num}: 使用了 Tab 缩进，应使用空格"
                            )
                            break
        except Exception as e:
            logger.error(f"编码规范检查失败: {e}")

        return issues

    def _estimate_error_handling_coverage(self, workspace_path: str) -> float:
        """
        估算错误处理覆盖率
        运行步骤：
          1. 统计 try-except/try-catch 块数量
          2. 统计函数/方法总数
          3. 计算比例
        参数：
          - workspace_path: 工作空间路径
        返回值：错误处理覆盖率百分比（0-100）
        """
        total_functions = 0
        functions_with_error_handling = 0

        skip_dirs = {"build", "install", "log", ".git", "__pycache__", "devel"}

        try:
            for root, dirs, files in os.walk(workspace_path):
                dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith(".")]
                for f in files[:200]:  # 限制检查文件数
                    ext = os.path.splitext(f)[1].lower()
                    file_path = os.path.join(root, f)

                    try:
                        with open(file_path, "r", encoding="utf-8", errors="ignore") as fh:
                            content = fh.read()
                    except Exception:
                        continue

                    if ext == ".py":
                        # 统计函数定义
                        func_count = len(re.findall(r'^\s*def\s+\w+\s*\(', content, re.MULTILINE))
                        total_functions += func_count
                        # 统计 try-except 块
                        try_count = len(re.findall(r'\btry\s*:', content))
                        functions_with_error_handling += min(try_count, func_count)

                    elif ext in (".cpp", ".cc", ".cxx", ".h", ".hpp"):
                        # 统计函数定义（简化估算）
                        func_count = len(re.findall(
                            r'(?:^|\n)\s*(?:[\w:]+\s+)+(\w+)\s*\([^)]*\)\s*(?:const\s*)?\{',
                            content,
                        ))
                        total_functions += func_count
                        # 统计 try-catch 块
                        try_count = len(re.findall(r'\btry\s*\{', content))
                        functions_with_error_handling += min(try_count, func_count)
        except Exception as e:
            logger.error(f"估算错误处理覆盖率失败: {e}")

        return (
            (functions_with_error_handling / total_functions * 100.0)
            if total_functions > 0 else 0.0
        )

    # ============================================================
    # 维度三：核心算法评测
    # ============================================================

    def evaluate_core_algorithms(
        self, modules: Optional[List[str]] = None
    ) -> DimensionResult:
        """
        核心算法评测（算法选择合理性、性能、鲁棒性）
        运行步骤：
          1. 识别项目中的核心算法模块
          2. 评估算法选择的合理性（是否适合应用场景）
          3. 评估算法性能（时间复杂度、空间复杂度）
          4. 评估算法鲁棒性（边界条件处理、异常输入处理）
        参数：
          - modules: 模块路径列表
        返回值：DimensionResult 对象
        """
        import time
        start_time = time.time()

        result = DimensionResult(dimension=EvalDimension.CORE_ALGORITHMS.value)
        findings: List[EvalFinding] = []
        metrics: Dict[str, Any] = {}

        if not modules:
            finding = EvalFinding(
                dimension=EvalDimension.CORE_ALGORITHMS.value,
                grade=EvalGrade.C,
                score=60.0,
                strength="",
                weakness="未提供模块列表，无法进行核心算法评测",
                suggestion="请提供模块路径列表以进行算法评测",
                details=["缺少模块信息"],
            )
            findings.append(finding)
            result.findings = findings
            result.score = 60.0
            result.grade = EvalGrade.C
            result.metrics = metrics
            result.execution_time_ms = (time.time() - start_time) * 1000
            return result

        # 算法相关关键词检测
        algorithm_keywords = {
            "path_planning": ["path_plan", "trajectory", "a_star", "dijkstra", "rrt", "规划"],
            "control": ["pid", "mpc", "lqr", "control", "控制器", "控制"],
            "perception": ["detection", "segmentation", "tracking", "yolo", "感知", "检测"],
            "fusion": ["kalman", "ekf", "ukf", "particle_filter", "融合", "滤波"],
            "optimization": ["optimize", "gradient", "solver", "优化", "求解"],
        }

        algo_metrics: Dict[str, Dict[str, bool]] = {}

        for module_path in modules:
            if not os.path.isdir(module_path):
                continue
            module_name = os.path.basename(module_path)
            module_algos: Dict[str, bool] = {}

            # 扫描模块内容
            all_content = ""
            for ext in ["*.py", "*.cpp", "*.cc", "*.cxx", "*.h", "*.hpp"]:
                for src_file in Path(module_path).rglob(ext):
                    if any(skip in str(src_file) for skip in ("build", "install", "log")):
                        continue
                    try:
                        all_content += src_file.read_text(encoding="utf-8", errors="ignore")
                    except Exception:
                        continue

            for algo_type, keywords in algorithm_keywords.items():
                found = any(kw.lower() in all_content.lower() for kw in keywords)
                module_algos[algo_type] = found

            algo_metrics[module_name] = module_algos

        metrics["algorithm_detection"] = algo_metrics

        # 评估算法选择合理性
        has_path_planning = any(
            m.get("path_planning", False) for m in algo_metrics.values()
        )
        has_control = any(m.get("control", False) for m in algo_metrics.values())
        has_perception = any(m.get("perception", False) for m in algo_metrics.values())
        has_fusion = any(m.get("fusion", False) for m in algo_metrics.values())

        metrics["has_path_planning"] = has_path_planning
        metrics["has_control"] = has_control
        metrics["has_perception"] = has_perception
        metrics["has_fusion"] = has_fusion

        # 检查算法鲁棒性（边界条件、输入校验）
        robustness_score = self._evaluate_algorithm_robustness(modules)
        metrics["robustness_score"] = robustness_score

        if robustness_score < 50.0:
            findings.append(EvalFinding(
                dimension=EvalDimension.CORE_ALGORITHMS.value,
                grade=EvalGrade.D,
                score=40.0,
                strength="",
                weakness=f"算法鲁棒性不足: {robustness_score:.1f}/100",
                suggestion="建议为算法添加输入合法性校验、边界条件处理、异常兜底逻辑",
                details=["缺少输入校验", "缺少边界条件处理", "缺少异常兜底"],
            ))

        # 检查算法性能优化（是否有复杂度优化）
        has_optimization = any(
            m.get("optimization", False) for m in algo_metrics.values()
        )
        metrics["has_optimization"] = has_optimization

        # 计算核心算法维度评分
        base_score = 70.0
        if has_path_planning or has_control or has_perception:
            base_score = 75.0  # 有核心算法模块
        if has_fusion:
            base_score += 5.0  # 有数据融合加分
        if has_optimization:
            base_score += 5.0  # 有优化加分

        # 鲁棒性调整
        base_score = base_score * 0.6 + robustness_score * 0.4

        if findings:
            avg_finding_score = sum(f.score for f in findings) / len(findings)
            final_score = min(base_score, avg_finding_score)
        else:
            final_score = base_score

        result.findings = findings
        result.score = final_score
        result.grade = self._score_to_grade(final_score)
        result.metrics = metrics
        result.execution_time_ms = (time.time() - start_time) * 1000

        logger.info(
            f"核心算法评测完成 | 模块数={len(algo_metrics)} | "
            f"评分={result.score:.1f} | 等级={result.grade.value}"
        )
        return result

    def _evaluate_algorithm_robustness(self, modules: List[str]) -> float:
        """
        评估算法鲁棒性
        运行步骤：
          1. 检测输入合法性校验（空值检查、范围检查）
          2. 检测边界条件处理
          3. 检测异常兜底逻辑
          4. 检测输出限幅约束
        参数：
          - modules: 模块路径列表
        返回值：鲁棒性评分（0-100）
        """
        checks_passed = 0
        total_checks = 4  # 四项检查

        all_content = ""
        for module_path in modules:
            if not os.path.isdir(module_path):
                continue
            for ext in ["*.py", "*.cpp", "*.cc", "*.cxx", "*.h", "*.hpp"]:
                for src_file in Path(module_path).rglob(ext):
                    if any(skip in str(src_file) for skip in ("build", "install", "log")):
                        continue
                    try:
                        all_content += src_file.read_text(encoding="utf-8", errors="ignore")
                    except Exception:
                        continue

        # 检查 1：输入合法性校验
        if re.search(
            r'\b(nullptr|NULL|None|if\s*\(!\w+\)|\.empty\(\)|\.size\(\)\s*==\s*0|'
            r'isinstance|type\s*\(|assert\s+)',
            all_content,
        ):
            checks_passed += 1

        # 检查 2：边界条件处理
        if re.search(
            r'\b(clamp|limit|bound|saturate|min\s*\(|max\s*\(|std::clamp|'
            r'range|bounds|>\s*=|<\s*=)',
            all_content, re.IGNORECASE,
        ):
            checks_passed += 1

        # 检查 3：异常兜底逻辑
        if re.search(
            r'\b(try\s*[:{]|except\s+|catch\s*\(|fallback|default|safe_value)',
            all_content,
        ):
            checks_passed += 1

        # 检查 4：输出限幅约束
        if re.search(
            r'\b(clamp|limit|saturate|clip|constrain|bound|max_speed|max_force|max_torque)',
            all_content, re.IGNORECASE,
        ):
            checks_passed += 1

        return (checks_passed / total_checks) * 100.0

    # ============================================================
    # 维度四：全链路实时性评测
    # ============================================================

    def evaluate_realtime(
        self, modules: Optional[List[str]] = None
    ) -> DimensionResult:
        """
        全链路实时性评测（控制延迟、时序稳定性）
        运行步骤：
          1. 检测实时控制循环的频率设置
          2. 检查控制延迟（从传感器到执行器的端到端延迟）
          3. 评估时序稳定性（是否存在阻塞调用、动态内存分配）
          4. 检查线程优先级设置
        参数：
          - modules: 模块路径列表
        返回值：DimensionResult 对象
        """
        import time
        start_time = time.time()

        result = DimensionResult(dimension=EvalDimension.REALTIME.value)
        findings: List[EvalFinding] = []
        metrics: Dict[str, Any] = {}

        if not modules:
            finding = EvalFinding(
                dimension=EvalDimension.REALTIME.value,
                grade=EvalGrade.C,
                score=60.0,
                strength="",
                weakness="未提供模块列表，无法进行实时性评测",
                suggestion="请提供模块路径列表以进行实时性评测",
                details=["缺少模块信息"],
            )
            findings.append(finding)
            result.findings = findings
            result.score = 60.0
            result.grade = EvalGrade.C
            result.metrics = metrics
            result.execution_time_ms = (time.time() - start_time) * 1000
            return result

        # 收集所有源文件内容
        all_content = ""
        for module_path in modules:
            if not os.path.isdir(module_path):
                continue
            for ext in ["*.py", "*.cpp", "*.cc", "*.cxx", "*.h", "*.hpp"]:
                for src_file in Path(module_path).rglob(ext):
                    if any(skip in str(src_file) for skip in ("build", "install", "log")):
                        continue
                    try:
                        all_content += src_file.read_text(encoding="utf-8", errors="ignore")
                    except Exception:
                        continue

        # 检查项 1：控制循环频率设置
        loop_frequencies = re.findall(
            r'(?:rate|frequency|hz|Hz|freq|interval)\s*[=:]\s*(\d+(?:\.\d+)?)',
            all_content, re.IGNORECASE,
        )
        metrics["detected_frequencies"] = loop_frequencies

        # 检查项 2：实时性违规检测（动态内存分配）
        has_dynamic_alloc = bool(re.search(
            r'\b(new\s+|delete\s+|malloc\s*\(|free\s*\(|calloc\s*\(|realloc\s*\()',
            all_content,
        ))
        metrics["has_dynamic_allocation"] = has_dynamic_alloc

        if has_dynamic_alloc:
            findings.append(EvalFinding(
                dimension=EvalDimension.REALTIME.value,
                grade=EvalGrade.D,
                score=35.0,
                strength="",
                weakness="检测到动态内存分配操作（new/delete/malloc/free），可能影响实时性",
                suggestion="实时控制循环中严禁动态内存分配，请使用预分配内存池或栈上分配",
                details=["存在动态内存分配操作"],
            ))

        # 检查项 3：阻塞调用检测
        has_blocking_call = bool(re.search(
            r'\b(sleep\s*\(|usleep\s*\(|nanosleep\s*\(|std::this_thread::sleep_for|'
            r'wait\s*\(|pthread_join\s*\(|pthread_mutex_lock\s*\()',
            all_content,
        ))
        metrics["has_blocking_call"] = has_blocking_call

        if has_blocking_call:
            findings.append(EvalFinding(
                dimension=EvalDimension.REALTIME.value,
                grade=EvalGrade.D,
                score=35.0,
                strength="",
                weakness="检测到阻塞调用（sleep/wait/lock），可能影响控制时序稳定性",
                suggestion="实时控制循环中严禁阻塞调用，请使用非阻塞异步机制",
                details=["存在阻塞调用"],
            ))

        # 检查项 4：线程优先级设置
        has_thread_priority = bool(re.search(
            r'\b(thread_priority|set_priority|SCHED_FIFO|SCHED_RR|nice\s*\()',
            all_content, re.IGNORECASE,
        ))
        metrics["has_thread_priority"] = has_thread_priority

        if not has_thread_priority:
            findings.append(EvalFinding(
                dimension=EvalDimension.REALTIME.value,
                grade=EvalGrade.C,
                score=65.0,
                strength="",
                weakness="未检测到线程优先级设置",
                suggestion="建议按安全优先级最高、控制次之、感知再次之的原则设置线程优先级",
                details=["缺少线程优先级配置"],
            ))

        # 检查项 5：日志打印检测（高频循环中的日志）
        has_log_in_loop = bool(re.search(
            r'\b(ROS_INFO|ROS_DEBUG|ROS_INFO_STREAM|ROS_DEBUG_STREAM|'
            r'printf\s*\(|std::cout|std::cerr)',
            all_content,
        ))
        metrics["has_potential_log_in_loop"] = has_log_in_loop

        if has_log_in_loop:
            findings.append(EvalFinding(
                dimension=EvalDimension.REALTIME.value,
                grade=EvalGrade.C,
                score=60.0,
                strength="",
                weakness="检测到日志打印语句，若位于高频循环中可能影响实时性",
                suggestion="高频循环中禁止打印 DEBUG/INFO 日志，仅允许异常场景打印有限次数错误日志",
                details=["存在日志打印语句"],
            ))

        # 计算实时性维度评分
        if findings:
            avg_score = sum(f.score for f in findings) / len(findings)
        else:
            avg_score = 85.0

        result.findings = findings
        result.score = avg_score
        result.grade = self._score_to_grade(avg_score)
        result.metrics = metrics
        result.execution_time_ms = (time.time() - start_time) * 1000

        logger.info(
            f"实时性评测完成 | 动态内存={has_dynamic_alloc} | "
            f"阻塞调用={has_blocking_call} | 评分={result.score:.1f} | 等级={result.grade.value}"
        )
        return result

    # ============================================================
    # 维度五：安全性评测
    # ============================================================

    def evaluate_security(
        self, project: Optional[Dict[str, Any]] = None
    ) -> DimensionResult:
        """
        安全性评测（安全架构、急停逻辑、故障兜底）
        运行步骤：
          1. 评估安全架构设计（是否有安全层/安全状态机）
          2. 检查急停逻辑完整性
          3. 检查故障检测与降级处理
          4. 检查安全关键数据流保护
        参数：
          - project: 项目信息字典
        返回值：DimensionResult 对象
        """
        import time
        start_time = time.time()

        result = DimensionResult(dimension=EvalDimension.SECURITY.value)
        findings: List[EvalFinding] = []
        metrics: Dict[str, Any] = {}

        # 收集项目中的安全相关信息
        modules = project.get("modules", []) if project else []
        arch_info = project.get("architecture", {}) if project else {}

        # 检查安全架构设计
        has_security_arch = arch_info.get("security", False) or (
            project and any(
                kw in str(project).lower()
                for kw in ["安全", "security", "safety", "急停", "emergency"]
            )
        )
        metrics["has_security_architecture"] = has_security_arch

        if not has_security_arch:
            findings.append(EvalFinding(
                dimension=EvalDimension.SECURITY.value,
                grade=EvalGrade.D,
                score=35.0,
                strength="",
                weakness="未检测到安全架构设计",
                suggestion="机器人系统必须设计安全架构，包括安全状态机、急停逻辑、故障降级",
                details=["缺少安全架构设计"],
            ))

        # 检查急停逻辑
        has_emergency_stop = False
        has_safe_state = False
        has_fault_recovery = False

        if modules:
            all_content = ""
            for module in modules:
                module_path = module.get("path", "") if isinstance(module, dict) else str(module)
                if not os.path.isdir(module_path):
                    continue
                for ext in ["*.py", "*.cpp", "*.cc", "*.cxx", "*.h", "*.hpp"]:
                    for src_file in Path(module_path).rglob(ext):
                        if any(skip in str(src_file) for skip in ("build", "install", "log")):
                            continue
                        try:
                            all_content += src_file.read_text(encoding="utf-8", errors="ignore")
                        except Exception:
                            continue

            has_emergency_stop = bool(re.search(
                r'\b(emergency_stop|e_stop|E_STOP|emergency|halt|shutdown)',
                all_content, re.IGNORECASE,
            ))
            has_safe_state = bool(re.search(
                r'\b(SAFE_STATE|safe_state|STATE_SAFE|safe_mode|DISABLE)',
                all_content,
            ))
            has_fault_recovery = bool(re.search(
                r'\b(fault|recovery|fallback|degraded|error_state|ERROR_STATE)',
                all_content, re.IGNORECASE,
            ))

        metrics["has_emergency_stop"] = has_emergency_stop
        metrics["has_safe_state"] = has_safe_state
        metrics["has_fault_recovery"] = has_fault_recovery

        if not has_emergency_stop:
            findings.append(EvalFinding(
                dimension=EvalDimension.SECURITY.value,
                grade=EvalGrade.F,
                score=20.0,
                strength="",
                weakness="未检测到急停/紧急停止逻辑",
                suggestion="机器人控制代码必须实现急停逻辑，包括紧急停止信号处理和电机断电",
                details=["缺少急停逻辑"],
            ))

        if not has_safe_state:
            findings.append(EvalFinding(
                dimension=EvalDimension.SECURITY.value,
                grade=EvalGrade.D,
                score=40.0,
                strength="",
                weakness="未检测到安全状态定义或状态切换逻辑",
                suggestion="请定义安全状态（SAFE_STATE），确保异常时能切换到安全状态",
                details=["缺少安全状态定义"],
            ))

        if not has_fault_recovery:
            findings.append(EvalFinding(
                dimension=EvalDimension.SECURITY.value,
                grade=EvalGrade.C,
                score=55.0,
                strength="",
                weakness="未检测到故障恢复/降级处理逻辑",
                suggestion="建议实现故障检测和降级处理逻辑，确保单点故障不影响整体安全",
                details=["缺少故障恢复机制"],
            ))

        # 计算安全性维度评分
        if findings:
            avg_score = sum(f.score for f in findings) / len(findings)
        else:
            avg_score = 90.0

        result.findings = findings
        result.score = avg_score
        result.grade = self._score_to_grade(avg_score)
        result.metrics = metrics
        result.execution_time_ms = (time.time() - start_time) * 1000

        logger.info(
            f"安全性评测完成 | 急停={has_emergency_stop} | "
            f"安全状态={has_safe_state} | 故障恢复={has_fault_recovery} | "
            f"评分={result.score:.1f} | 等级={result.grade.value}"
        )
        return result

    # ============================================================
    # 维度六：工程化与可维护性评测
    # ============================================================

    def evaluate_engineering(self, workspace_path: str) -> DimensionResult:
        """
        工程化与可维护性评测
        运行步骤：
          1. 检查项目目录结构规范性
          2. 检查构建系统配置完整性
          3. 检查依赖管理规范性
          4. 检查文档完整性
          5. 检查版本管理规范性
        参数：
          - workspace_path: 工作空间路径
        返回值：DimensionResult 对象
        """
        import time
        start_time = time.time()

        result = DimensionResult(dimension=EvalDimension.ENGINEERING.value)
        findings: List[EvalFinding] = []
        metrics: Dict[str, Any] = {}

        if not workspace_path or not os.path.isdir(workspace_path):
            finding = EvalFinding(
                dimension=EvalDimension.ENGINEERING.value,
                grade=EvalGrade.F,
                score=0.0,
                strength="",
                weakness=f"工作空间路径无效: {workspace_path}",
                suggestion="请提供有效的工作空间路径",
                details=["路径无效"],
            )
            findings.append(finding)
            result.findings = findings
            result.score = 0.0
            result.grade = EvalGrade.F
            result.metrics = metrics
            result.execution_time_ms = (time.time() - start_time) * 1000
            return result

        ws_path = Path(workspace_path)

        # 检查项 1：目录结构规范性
        has_src_dir = (ws_path / "src").is_dir()
        has_config_dir = (ws_path / "config").is_dir()
        has_docs_dir = (ws_path / "docs").is_dir() or (ws_path / "doc").is_dir()
        has_tests_dir = (ws_path / "tests").is_dir() or (ws_path / "test").is_dir()

        metrics["has_src_dir"] = has_src_dir
        metrics["has_config_dir"] = has_config_dir
        metrics["has_docs_dir"] = has_docs_dir
        metrics["has_tests_dir"] = has_tests_dir

        structure_score = 0
        if has_src_dir:
            structure_score += 30
        if has_config_dir:
            structure_score += 25
        if has_docs_dir:
            structure_score += 25
        if has_tests_dir:
            structure_score += 20

        if structure_score < 50:
            findings.append(EvalFinding(
                dimension=EvalDimension.ENGINEERING.value,
                grade=EvalGrade.D,
                score=float(structure_score),
                strength="",
                weakness=f"项目目录结构不完整（src={has_src_dir}, config={has_config_dir}, "
                         f"docs={has_docs_dir}, tests={has_tests_dir}）",
                suggestion="建议完善项目目录结构，至少包含 src/、config/、docs/、tests/ 目录",
                details=["目录结构不完整"],
            ))

        # 检查项 2：构建系统配置完整性
        has_cmake = (ws_path / "CMakeLists.txt").exists() or any(
            "CMakeLists.txt" in str(p)
            for p in ws_path.rglob("CMakeLists.txt")
            if "build" not in str(p) and "install" not in str(p)
        )
        has_package_json = (ws_path / "package.json").exists()
        has_requirements = (ws_path / "requirements.txt").exists()

        metrics["has_cmake"] = has_cmake
        metrics["has_package_json"] = has_package_json
        metrics["has_requirements"] = has_requirements

        if not has_cmake and not has_package_json:
            findings.append(EvalFinding(
                dimension=EvalDimension.ENGINEERING.value,
                grade=EvalGrade.D,
                score=35.0,
                strength="",
                weakness="未检测到构建系统配置文件（CMakeLists.txt/package.json）",
                suggestion="请添加构建系统配置文件",
                details=["缺少构建配置"],
            ))

        # 检查项 3：依赖管理规范性
        has_package_xml = any(
            "package.xml" in str(p)
            for p in ws_path.rglob("package.xml")
            if "build" not in str(p) and "install" not in str(p)
        )
        metrics["has_ros_package_xml"] = has_package_xml

        # 检查项 4：文档完整性
        has_readme = (ws_path / "README.md").exists() or (ws_path / "readme.md").exists()
        has_changelog = (
            (ws_path / "CHANGELOG.md").exists() or
            (ws_path / "代码修改日志.md").exists()
        )
        metrics["has_readme"] = has_readme
        metrics["has_changelog"] = has_changelog

        if not has_readme:
            findings.append(EvalFinding(
                dimension=EvalDimension.ENGINEERING.value,
                grade=EvalGrade.C,
                score=60.0,
                strength="",
                weakness="缺少 README 文档",
                suggestion="建议添加 README.md，包含项目说明、构建方法、运行说明",
                details=["缺少 README"],
            ))

        # 检查项 5：版本管理规范性
        has_git = (ws_path / ".git").exists()
        metrics["has_git"] = has_git

        if not has_git:
            findings.append(EvalFinding(
                dimension=EvalDimension.ENGINEERING.value,
                grade=EvalGrade.C,
                score=65.0,
                strength="",
                weakness="未检测到 Git 版本管理",
                suggestion="建议使用 Git 进行版本管理，遵循语义化版本规范",
                details=["缺少 Git 版本管理"],
            ))

        # 计算工程化维度评分
        if findings:
            avg_score = sum(f.score for f in findings) / len(findings)
        else:
            avg_score = 85.0

        # 综合目录结构评分
        final_score = avg_score * 0.5 + structure_score * 0.5

        result.findings = findings
        result.score = final_score
        result.grade = self._score_to_grade(final_score)
        result.metrics = metrics
        result.execution_time_ms = (time.time() - start_time) * 1000

        logger.info(
            f"工程化评测完成 | 结构评分={structure_score} | "
            f"评分={result.score:.1f} | 等级={result.grade.value}"
        )
        return result

    # ============================================================
    # 综合系统评测
    # ============================================================

    def full_evaluation(
        self,
        workspace_path: str,
        project: Optional[Dict[str, Any]] = None,
        modules: Optional[List[str]] = None,
    ) -> EvaluationReport:
        """
        执行完整的六维系统评测，输出结构化 8 章评测报告
        运行步骤：
          1. 检查迭代次数是否超限
          2. 依次执行六个维度的评测
          3. 汇总生成 8 章结构化评测报告
          4. 缓存报告
          5. 递增迭代计数器
        参数：
          - workspace_path: 工作空间根目录的绝对路径
          - project: 项目信息字典（可选）
          - modules: 模块路径列表（可选）
        返回值：EvaluationReport 对象，包含 8 章结构化报告
        """
        # 检查迭代次数
        if self._iteration_count >= self._max_iterations:
            logger.warning(
                f"已达到最大评测迭代次数 | "
                f"当前={self._iteration_count}/{self._max_iterations}"
            )
            if self._last_report:
                return self._last_report

        logger.info(
            f"开始全量系统评测 | 工作空间={workspace_path} | "
            f"迭代={self._iteration_count + 1}/{self._max_iterations}"
        )

        dimension_results: List[DimensionResult] = []

        # 维度一：架构合理性评测
        arch_result = self.evaluate_architecture(project)
        dimension_results.append(arch_result)

        # 维度二：全局代码质量评测
        quality_result = self.evaluate_code_quality(workspace_path)
        dimension_results.append(quality_result)

        # 维度三：核心算法评测
        algo_result = self.evaluate_core_algorithms(modules)
        dimension_results.append(algo_result)

        # 维度四：全链路实时性评测
        realtime_result = self.evaluate_realtime(modules)
        dimension_results.append(realtime_result)

        # 维度五：安全性评测
        security_result = self.evaluate_security(project)
        dimension_results.append(security_result)

        # 维度六：工程化与可维护性评测
        engineering_result = self.evaluate_engineering(workspace_path)
        dimension_results.append(engineering_result)

        # 计算加权综合评分
        overall_score = self._calculate_weighted_score(dimension_results)
        overall_grade = self._score_to_grade(overall_score)

        # 构建 8 章结构化报告
        report = EvaluationReport(
            workspace_path=workspace_path,
            generated_at=datetime.now(timezone.utc).isoformat(),
            iteration_count=self._iteration_count + 1,
            max_iterations=self._max_iterations,
            overall_grade=overall_grade,
            overall_score=overall_score,
            dimension_results=dimension_results,
        )

        # 第 1 章：评测总览
        report.chapter_1_summary = self._build_chapter_1(report)

        # 第 2 章：架构评测详情
        report.chapter_2_architecture = self._build_chapter_2(arch_result)

        # 第 3 章：代码质量评测详情
        report.chapter_3_code_quality = self._build_chapter_3(quality_result)

        # 第 4 章：核心算法评测详情
        report.chapter_4_algorithms = self._build_chapter_4(algo_result)

        # 第 5 章：实时性评测详情
        report.chapter_5_realtime = self._build_chapter_5(realtime_result)

        # 第 6 章：安全性评测详情
        report.chapter_6_security = self._build_chapter_6(security_result)

        # 第 7 章：工程化评测详情
        report.chapter_7_engineering = self._build_chapter_7(engineering_result)

        # 第 8 章：改进建议与行动计划
        report.chapter_8_recommendations = self._build_chapter_8(dimension_results)

        # 缓存报告
        self._last_report = report

        # 递增迭代计数器
        self._iteration_count += 1

        logger.info(
            f"全量系统评测完成 | 综合评分={overall_score:.1f} | "
            f"等级={overall_grade.value} | 迭代={self._iteration_count}/{self._max_iterations}"
        )
        return report

    # ============================================================
    # 8 章报告构建方法
    # ============================================================

    def _build_chapter_1(self, report: EvaluationReport) -> Dict[str, Any]:
        """
        构建第 1 章：评测总览
        内容：综合评分、各维度评分雷达图数据、迭代信息、评测时间
        参数：
          - report: EvaluationReport 对象
        返回值：第 1 章内容字典
        """
        return {
            "title": "第 1 章 - 评测总览",
            "overall_grade": report.overall_grade.value,
            "overall_score": report.overall_score,
            "iteration": f"{report.iteration_count}/{report.max_iterations}",
            "generated_at": report.generated_at,
            "workspace_path": report.workspace_path,
            "dimension_scores": {
                dr.dimension: {
                    "score": dr.score,
                    "grade": dr.grade.value,
                }
                for dr in report.dimension_results
            },
            "radar_data": {
                dr.dimension: dr.score
                for dr in report.dimension_results
            },
            "pass_status": "通过" if report.overall_score >= 60.0 else "未通过",
        }

    def _build_chapter_2(self, result: DimensionResult) -> Dict[str, Any]:
        """
        构建第 2 章：架构评测详情
        参数：
          - result: 架构评测 DimensionResult
        返回值：第 2 章内容字典
        """
        return {
            "title": "第 2 章 - 架构合理性评测",
            "grade": result.grade.value,
            "score": result.score,
            "metrics": result.metrics,
            "findings": [
                {
                    "grade": f.grade.value,
                    "score": f.score,
                    "strength": f.strength,
                    "weakness": f.weakness,
                    "suggestion": f.suggestion,
                    "details": f.details,
                }
                for f in result.findings
            ],
            "summary": (
                f"架构评测等级: {result.grade.value}，评分: {result.score:.1f}/100。"
                f"模块数: {result.metrics.get('module_count', 'N/A')}。"
            ),
        }

    def _build_chapter_3(self, result: DimensionResult) -> Dict[str, Any]:
        """
        构建第 3 章：代码质量评测详情
        参数：
          - result: 代码质量评测 DimensionResult
        返回值：第 3 章内容字典
        """
        return {
            "title": "第 3 章 - 全局代码质量评测",
            "grade": result.grade.value,
            "score": result.score,
            "metrics": result.metrics,
            "findings": [
                {
                    "grade": f.grade.value,
                    "score": f.score,
                    "strength": f.strength,
                    "weakness": f.weakness,
                    "suggestion": f.suggestion,
                    "details": f.details,
                }
                for f in result.findings
            ],
            "summary": (
                f"代码质量评测等级: {result.grade.value}，评分: {result.score:.1f}/100。"
                f"总文件数: {result.metrics.get('total_files', 'N/A')}，"
                f"总行数: {result.metrics.get('total_lines', 'N/A')}，"
                f"注释覆盖率: {result.metrics.get('comment_coverage_pct', 0):.1f}%。"
            ),
        }

    def _build_chapter_4(self, result: DimensionResult) -> Dict[str, Any]:
        """
        构建第 4 章：核心算法评测详情
        参数：
          - result: 核心算法评测 DimensionResult
        返回值：第 4 章内容字典
        """
        return {
            "title": "第 4 章 - 核心算法评测",
            "grade": result.grade.value,
            "score": result.score,
            "metrics": result.metrics,
            "findings": [
                {
                    "grade": f.grade.value,
                    "score": f.score,
                    "strength": f.strength,
                    "weakness": f.weakness,
                    "suggestion": f.suggestion,
                    "details": f.details,
                }
                for f in result.findings
            ],
            "summary": (
                f"核心算法评测等级: {result.grade.value}，评分: {result.score:.1f}/100。"
                f"鲁棒性评分: {result.metrics.get('robustness_score', 'N/A')}。"
            ),
        }

    def _build_chapter_5(self, result: DimensionResult) -> Dict[str, Any]:
        """
        构建第 5 章：实时性评测详情
        参数：
          - result: 实时性评测 DimensionResult
        返回值：第 5 章内容字典
        """
        return {
            "title": "第 5 章 - 全链路实时性评测",
            "grade": result.grade.value,
            "score": result.score,
            "metrics": result.metrics,
            "findings": [
                {
                    "grade": f.grade.value,
                    "score": f.score,
                    "strength": f.strength,
                    "weakness": f.weakness,
                    "suggestion": f.suggestion,
                    "details": f.details,
                }
                for f in result.findings
            ],
            "summary": (
                f"实时性评测等级: {result.grade.value}，评分: {result.score:.1f}/100。"
                f"动态内存分配: {result.metrics.get('has_dynamic_allocation', 'N/A')}，"
                f"阻塞调用: {result.metrics.get('has_blocking_call', 'N/A')}。"
            ),
        }

    def _build_chapter_6(self, result: DimensionResult) -> Dict[str, Any]:
        """
        构建第 6 章：安全性评测详情
        参数：
          - result: 安全性评测 DimensionResult
        返回值：第 6 章内容字典
        """
        return {
            "title": "第 6 章 - 安全性评测",
            "grade": result.grade.value,
            "score": result.score,
            "metrics": result.metrics,
            "findings": [
                {
                    "grade": f.grade.value,
                    "score": f.score,
                    "strength": f.strength,
                    "weakness": f.weakness,
                    "suggestion": f.suggestion,
                    "details": f.details,
                }
                for f in result.findings
            ],
            "summary": (
                f"安全性评测等级: {result.grade.value}，评分: {result.score:.1f}/100。"
                f"急停逻辑: {result.metrics.get('has_emergency_stop', 'N/A')}，"
                f"安全状态: {result.metrics.get('has_safe_state', 'N/A')}，"
                f"故障恢复: {result.metrics.get('has_fault_recovery', 'N/A')}。"
            ),
        }

    def _build_chapter_7(self, result: DimensionResult) -> Dict[str, Any]:
        """
        构建第 7 章：工程化评测详情
        参数：
          - result: 工程化评测 DimensionResult
        返回值：第 7 章内容字典
        """
        return {
            "title": "第 7 章 - 工程化与可维护性评测",
            "grade": result.grade.value,
            "score": result.score,
            "metrics": result.metrics,
            "findings": [
                {
                    "grade": f.grade.value,
                    "score": f.score,
                    "strength": f.strength,
                    "weakness": f.weakness,
                    "suggestion": f.suggestion,
                    "details": f.details,
                }
                for f in result.findings
            ],
            "summary": (
                f"工程化评测等级: {result.grade.value}，评分: {result.score:.1f}/100。"
                f"Git: {result.metrics.get('has_git', 'N/A')}，"
                f"README: {result.metrics.get('has_readme', 'N/A')}，"
                f"变更日志: {result.metrics.get('has_changelog', 'N/A')}。"
            ),
        }

    def _build_chapter_8(
        self, dimension_results: List[DimensionResult]
    ) -> Dict[str, Any]:
        """
        构建第 8 章：改进建议与行动计划
        运行步骤：
          1. 汇总所有维度的改进建议
          2. 按优先级排序（安全性 > 实时性 > 算法 > 架构 > 代码质量 > 工程化）
          3. 生成行动计划
        参数：
          - dimension_results: 各维度评测结果列表
        返回值：第 8 章内容字典
        """
        # 优先级排序权重
        priority_order = {
            EvalDimension.SECURITY.value: 0,
            EvalDimension.REALTIME.value: 1,
            EvalDimension.CORE_ALGORITHMS.value: 2,
            EvalDimension.ARCHITECTURE.value: 3,
            EvalDimension.CODE_QUALITY.value: 4,
            EvalDimension.ENGINEERING.value: 5,
        }

        all_recommendations: List[Dict[str, Any]] = []

        for dr in dimension_results:
            for finding in dr.findings:
                if finding.suggestion:
                    all_recommendations.append({
                        "dimension": dr.dimension,
                        "priority": priority_order.get(dr.dimension, 99),
                        "grade": finding.grade.value,
                        "weakness": finding.weakness,
                        "suggestion": finding.suggestion,
                    })

        # 按优先级排序
        all_recommendations.sort(key=lambda x: (x["priority"], x["grade"]))

        # 生成行动计划
        action_plan: List[Dict[str, Any]] = []
        for i, rec in enumerate(all_recommendations, start=1):
            action_plan.append({
                "step": i,
                "dimension": rec["dimension"],
                "action": rec["suggestion"],
                "target": rec["weakness"],
                "estimated_effort": (
                    "高" if rec["grade"] in ("F", "D") else
                    "中" if rec["grade"] == "C" else "低"
                ),
            })

        return {
            "title": "第 8 章 - 改进建议与行动计划",
            "total_recommendations": len(all_recommendations),
            "priority_summary": (
                f"共 {len(all_recommendations)} 条改进建议，"
                f"按安全性 > 实时性 > 算法 > 架构 > 代码质量 > 工程化优先级排序"
            ),
            "recommendations": all_recommendations,
            "action_plan": action_plan,
        }

    def get_last_report(self) -> Optional[EvaluationReport]:
        """
        获取最近一次系统评测报告
        返回值：EvaluationReport 对象或 None
        """
        return self._last_report

    def reset_iteration(self):
        """
        重置迭代计数器（用于新一轮评测）
        """
        self._iteration_count = 0
        logger.info("迭代计数器已重置")


# 全局单例
system_evaluator = SystemEvaluator()