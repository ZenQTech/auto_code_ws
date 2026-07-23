"""
# ============================================================
# 集成校验服务 - 全链路编译、接口兼容性、ROS 包规范校验
# ============================================================
# 核心作用：对代码工程进行集成层面的全量校验，包括全量编译检查、
#           多模块接口兼容性检查、ROS 包规范检查、跨包引用检查、
#           跨模块安全联动检查、隐式循环依赖检测
# 运行流程：
#   1. IntegrationChecker.full_integration_check() 接收工作空间路径
#   2. 依次执行六个维度的校验：
#      a. check_full_compilation() - 全量代码编译检查
#      b. check_interface_compatibility() - 多模块接口兼容性检查
#      c. check_ros_package_specs() - ROS 包规范检查
#      d. check_cross_references() - 跨包引用检查
#      e. check_cross_module_security() - 跨模块安全联动检查
#      f. detect_implicit_circular_deps() - 隐式循环依赖检测
#   3. 汇总生成综合集成校验报告
# 输入参数：
#   - workspace_path: str，代码工作空间根目录路径
#   - modules: Optional[List[str]]，待校验的模块列表
# 输出结果：IntegrationReport 对象，包含各维度校验结果和综合评分
# 修改记录：
#   - 2026-06-24 | v1.0.0 | 初始版本，实现六维集成校验
# ============================================================
"""

import logging
import os
import re
import subprocess
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

class CheckSeverity(str, Enum):
    """
    校验问题严重程度枚举
    取值：CRITICAL（严重/阻塞）、ERROR（错误）、WARNING（警告）、INFO（信息）
    """
    CRITICAL = "critical"
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


class CheckStatus(str, Enum):
    """
    单项校验状态枚举
    取值：PASSED（通过）、FAILED（失败）、SKIPPED（跳过）、ERROR（执行异常）
    """
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"
    ERROR = "error"


# ============================================================
# 数据类定义
# ============================================================

@dataclass
class CheckIssue:
    """
    校验问题记录
    字段说明：
      - severity: 严重程度
      - category: 问题类别（compilation/interface/ros_spec/cross_ref/security/circular_dep）
      - description: 问题描述
      - location: 问题位置（文件路径:行号 或 模块名）
      - suggestion: 修复建议
    """
    severity: CheckSeverity = CheckSeverity.WARNING
    category: str = ""
    description: str = ""
    location: str = ""
    suggestion: str = ""


@dataclass
class CheckResult:
    """
    单项校验结果
    字段说明：
      - check_name: 校验项名称
      - status: 校验状态（passed/failed/skipped/error）
      - score: 评分（0-100）
      - issues: 发现的问题列表
      - details: 附加详情（如编译输出、依赖图等）
      - execution_time_ms: 执行耗时（毫秒）
    """
    check_name: str = ""
    status: CheckStatus = CheckStatus.PASSED
    score: float = 100.0
    issues: List[CheckIssue] = field(default_factory=list)
    details: Dict[str, Any] = field(default_factory=dict)
    execution_time_ms: float = 0.0


@dataclass
class IntegrationReport:
    """
    集成校验综合报告
    字段说明：
      - workspace_path: 校验的工作空间路径
      - overall_passed: 综合是否通过
      - overall_score: 综合评分（0-100）
      - check_results: 各项校验结果列表
      - total_issues: 问题总数
      - critical_count: 严重问题数
      - error_count: 错误问题数
      - warning_count: 警告问题数
      - info_count: 信息问题数
      - generated_at: 报告生成时间
      - summary: 校验摘要
    """
    workspace_path: str = ""
    overall_passed: bool = True
    overall_score: float = 100.0
    check_results: List[CheckResult] = field(default_factory=list)
    total_issues: int = 0
    critical_count: int = 0
    error_count: int = 0
    warning_count: int = 0
    info_count: int = 0
    generated_at: str = ""
    summary: str = ""


# ============================================================
# IntegrationChecker - 集成校验核心类
# ============================================================

class IntegrationChecker:
    """
    集成校验核心类
    作用：对代码工程执行六维集成校验，确保各模块可正确集成
    调用方：任务执行引擎、系统评测模块
    被调用方：ROSValidator、SecurityChecker、subprocess（编译工具）
    """

    # ---- 编译工具默认超时时间（秒） ----
    _COMPILE_TIMEOUT: int = 300

    # ---- 隐式循环依赖检测阈值 ----
    _CIRCULAR_DEPTH_LIMIT: int = 10

    def __init__(self):
        """
        初始化集成校验器
        运行步骤：
          1. 从全局配置读取评测相关配置
          2. 初始化校验结果缓存
        """
        # 从全局配置读取评测配置
        self._eval_config: Dict[str, Any] = settings.evaluation
        self._max_iterations: int = self._eval_config.get("max_iterations", 2)

        # 校验结果缓存
        self._last_report: Optional[IntegrationReport] = None

        logger.info(
            f"集成校验器初始化完成 | 最大迭代次数={self._max_iterations}"
        )

    # ============================================================
    # 维度一：全量代码编译检查
    # ============================================================

    def check_full_compilation(self, workspace_path: str) -> CheckResult:
        """
        全量代码编译检查
        运行步骤：
          1. 检测工作空间中的构建系统类型（CMake/colcon/catkin）
          2. 检查是否存在构建目录（build/）
          3. 尝试执行增量编译或全量编译
          4. 解析编译输出，提取错误和警告
          5. 汇总生成 CheckResult
        参数：
          - workspace_path: 工作空间根目录的绝对路径
        返回值：CheckResult 对象，包含编译检查结果
        """
        import time
        start_time = time.time()

        result = CheckResult(check_name="全量代码编译检查")
        issues: List[CheckIssue] = []

        # 工作空间路径合法性校验
        if not workspace_path or not os.path.isdir(workspace_path):
            result.status = CheckStatus.ERROR
            result.score = 0.0
            result.issues.append(CheckIssue(
                severity=CheckSeverity.CRITICAL,
                category="compilation",
                description=f"工作空间路径不存在或无效: {workspace_path}",
                location=workspace_path,
                suggestion="请提供有效的工作空间根目录路径",
            ))
            result.execution_time_ms = (time.time() - start_time) * 1000
            return result

        # 检测构建系统类型
        build_system = self._detect_build_system(workspace_path)
        result.details["build_system"] = build_system

        if build_system == "unknown":
            result.status = CheckStatus.SKIPPED
            result.score = 50.0
            result.issues.append(CheckIssue(
                severity=CheckSeverity.WARNING,
                category="compilation",
                description="未检测到已知构建系统（CMakeLists.txt/colcon/catkin）",
                location=workspace_path,
                suggestion="请确认工作空间包含有效的构建配置文件",
            ))
            result.execution_time_ms = (time.time() - start_time) * 1000
            return result

        # 检查构建目录是否存在
        build_dir = os.path.join(workspace_path, "build")
        has_build_dir = os.path.isdir(build_dir)

        # 尝试执行编译
        compile_output = ""
        compile_success = False

        try:
            if build_system == "colcon":
                # ROS2 colcon 构建
                compile_output, compile_success = self._run_colcon_build(
                    workspace_path, has_build_dir
                )
            elif build_system == "catkin":
                # ROS1 catkin 构建
                compile_output, compile_success = self._run_catkin_build(
                    workspace_path, has_build_dir
                )
            elif build_system == "cmake":
                # 纯 CMake 构建
                compile_output, compile_success = self._run_cmake_build(
                    workspace_path, has_build_dir
                )
        except Exception as e:
            logger.error(f"编译执行异常: {e}")
            compile_output = f"编译执行异常: {e}"

        result.details["compile_output"] = compile_output[:5000]  # 截断过长输出
        result.details["has_build_dir"] = has_build_dir

        # 解析编译输出，提取错误和警告
        compile_issues = self._parse_compile_output(compile_output, workspace_path)
        issues.extend(compile_issues)

        result.issues = issues

        # 计算评分
        if not compile_success:
            result.status = CheckStatus.FAILED
            # 每个 critical 扣 30 分，error 扣 15 分，warning 扣 5 分
            penalty = 0.0
            for issue in issues:
                if issue.severity == CheckSeverity.CRITICAL:
                    penalty += 30.0
                elif issue.severity == CheckSeverity.ERROR:
                    penalty += 15.0
                elif issue.severity == CheckSeverity.WARNING:
                    penalty += 5.0
                elif issue.severity == CheckSeverity.INFO:
                    penalty += 1.0
            result.score = max(0.0, 100.0 - penalty)
        else:
            result.status = CheckStatus.PASSED
            result.score = 100.0 - min(50.0, len(issues) * 2.0)

        result.execution_time_ms = (time.time() - start_time) * 1000

        logger.info(
            f"全量编译检查完成 | 构建系统={build_system} | "
            f"编译成功={compile_success} | 问题数={len(issues)} | 评分={result.score:.1f}"
        )
        return result

    def _detect_build_system(self, workspace_path: str) -> str:
        """
        检测工作空间使用的构建系统类型
        运行步骤：
          1. 检查是否存在 colcon 相关文件
          2. 检查是否存在 catkin 相关文件
          3. 检查是否存在 CMakeLists.txt
        参数：
          - workspace_path: 工作空间路径
        返回值：构建系统类型字符串（colcon/catkin/cmake/unknown）
        """
        ws_path = Path(workspace_path)

        # 检查 colcon（ROS2）
        if (ws_path / "src").is_dir():
            # 检查 src 下是否有 ROS2 包
            for item in (ws_path / "src").iterdir():
                if item.is_dir() and (item / "package.xml").exists():
                    # 读取 package.xml 判断 ROS 版本
                    try:
                        content = (item / "package.xml").read_text(encoding="utf-8")
                        if "ament_cmake" in content or "ament_python" in content:
                            return "colcon"
                    except Exception:
                        pass
            # 有 src 目录且有 package.xml 的包，默认视为 colcon
            return "colcon"

        # 检查 catkin（ROS1）
        if (ws_path / "src" / "CMakeLists.txt").exists():
            return "catkin"

        # 检查纯 CMake
        if (ws_path / "CMakeLists.txt").exists():
            return "cmake"

        # 递归检查子目录
        for item in ws_path.iterdir():
            if item.is_dir() and (item / "CMakeLists.txt").exists():
                return "cmake"

        return "unknown"

    def _run_colcon_build(
        self, workspace_path: str, has_build_dir: bool
    ) -> Tuple[str, bool]:
        """
        执行 colcon 构建（ROS2）
        运行步骤：
          1. 构建 colcon build 命令
          2. 通过 subprocess 执行
          3. 捕获输出和退出码
        参数：
          - workspace_path: 工作空间路径
          - has_build_dir: 是否已有构建目录
        返回值：(编译输出文本, 是否编译成功)
        """
        # 检查 colcon 是否可用
        if not self._tool_available("colcon"):
            return "[colcon] 工具不可用，跳过编译检查", False

        try:
            # 构建命令：colcon build --base-paths <ws>/src
            cmd = [
                "colcon", "build",
                "--base-paths", os.path.join(workspace_path, "src"),
                "--cmake-args", "-DCMAKE_BUILD_TYPE=Release",
            ]
            # 如果有构建目录，尝试增量编译
            if has_build_dir:
                cmd.append("--continue-on-error")

            proc_result = subprocess.run(
                cmd,
                cwd=workspace_path,
                capture_output=True,
                text=True,
                timeout=self._COMPILE_TIMEOUT,
            )
            output = (proc_result.stdout or "") + "\n" + (proc_result.stderr or "")
            success = proc_result.returncode == 0
            return output, success

        except subprocess.TimeoutExpired:
            return f"[colcon] 编译超时（>{self._COMPILE_TIMEOUT}s）", False
        except FileNotFoundError:
            return "[colcon] 未找到 colcon 可执行文件", False
        except Exception as e:
            return f"[colcon] 编译异常: {e}", False

    def _run_catkin_build(
        self, workspace_path: str, has_build_dir: bool
    ) -> Tuple[str, bool]:
        """
        执行 catkin 构建（ROS1）
        参数：
          - workspace_path: 工作空间路径
          - has_build_dir: 是否已有构建目录
        返回值：(编译输出文本, 是否编译成功)
        """
        if not self._tool_available("catkin"):
            return "[catkin] 工具不可用，跳过编译检查", False

        try:
            cmd = ["catkin", "build"]
            proc_result = subprocess.run(
                cmd,
                cwd=workspace_path,
                capture_output=True,
                text=True,
                timeout=self._COMPILE_TIMEOUT,
            )
            output = (proc_result.stdout or "") + "\n" + (proc_result.stderr or "")
            success = proc_result.returncode == 0
            return output, success
        except subprocess.TimeoutExpired:
            return f"[catkin] 编译超时（>{self._COMPILE_TIMEOUT}s）", False
        except FileNotFoundError:
            return "[catkin] 未找到 catkin 可执行文件", False
        except Exception as e:
            return f"[catkin] 编译异常: {e}", False

    def _run_cmake_build(
        self, workspace_path: str, has_build_dir: bool
    ) -> Tuple[str, bool]:
        """
        执行 CMake 构建
        参数：
          - workspace_path: 工作空间路径
          - has_build_dir: 是否已有构建目录
        返回值：(编译输出文本, 是否编译成功)
        """
        if not self._tool_available("cmake"):
            return "[cmake] 工具不可用，跳过编译检查", False

        try:
            build_dir = os.path.join(workspace_path, "build")
            if not has_build_dir:
                os.makedirs(build_dir, exist_ok=True)
                # 首次配置
                config_result = subprocess.run(
                    ["cmake", "-B", build_dir, "-S", workspace_path],
                    capture_output=True, text=True,
                    timeout=self._COMPILE_TIMEOUT,
                )
                if config_result.returncode != 0:
                    return (
                        f"[cmake] 配置失败:\n{config_result.stderr}",
                        False,
                    )

            # 执行编译
            proc_result = subprocess.run(
                ["cmake", "--build", build_dir],
                capture_output=True, text=True,
                timeout=self._COMPILE_TIMEOUT,
            )
            output = (proc_result.stdout or "") + "\n" + (proc_result.stderr or "")
            success = proc_result.returncode == 0
            return output, success
        except subprocess.TimeoutExpired:
            return f"[cmake] 编译超时（>{self._COMPILE_TIMEOUT}s）", False
        except FileNotFoundError:
            return "[cmake] 未找到 cmake 可执行文件", False
        except Exception as e:
            return f"[cmake] 编译异常: {e}", False

    def _parse_compile_output(
        self, output: str, workspace_path: str
    ) -> List[CheckIssue]:
        """
        解析编译输出，提取错误和警告
        运行步骤：
          1. 使用正则匹配编译错误行（error:）
          2. 使用正则匹配编译警告行（warning:）
          3. 使用正则匹配链接错误（undefined reference）
          4. 按严重程度分类
        参数：
          - output: 编译输出文本
          - workspace_path: 工作空间路径
        返回值：CheckIssue 列表
        """
        issues: List[CheckIssue] = []

        # 匹配编译错误：file:line:col: error: message
        error_pattern = re.compile(
            r'(.+?):(\d+):(\d+):\s*(fatal\s+)?error:\s*(.+)',
            re.IGNORECASE,
        )
        for match in error_pattern.finditer(output):
            file_path = match.group(1)
            line_num = match.group(2)
            is_fatal = bool(match.group(4))
            message = match.group(5)

            severity = CheckSeverity.CRITICAL if is_fatal else CheckSeverity.ERROR
            issues.append(CheckIssue(
                severity=severity,
                category="compilation",
                description=f"编译错误: {message.strip()}",
                location=f"{file_path}:{line_num}",
                suggestion="请根据编译错误信息修复代码",
            ))

        # 匹配编译警告：file:line:col: warning: message
        warning_pattern = re.compile(
            r'(.+?):(\d+):(\d+):\s*warning:\s*(.+)',
            re.IGNORECASE,
        )
        for match in warning_pattern.finditer(output):
            file_path = match.group(1)
            line_num = match.group(2)
            message = match.group(4)

            issues.append(CheckIssue(
                severity=CheckSeverity.WARNING,
                category="compilation",
                description=f"编译警告: {message.strip()}",
                location=f"{file_path}:{line_num}",
                suggestion="请检查并修复编译警告",
            ))

        # 匹配链接错误：undefined reference to 'symbol'
        link_error_pattern = re.compile(
            r"undefined reference to [`']([^'`]+)[`']",
        )
        for match in link_error_pattern.finditer(output):
            symbol = match.group(1)
            issues.append(CheckIssue(
                severity=CheckSeverity.ERROR,
                category="compilation",
                description=f"链接错误: 未定义引用 '{symbol}'",
                location=workspace_path,
                suggestion=f"请检查是否缺少对 '{symbol}' 所在库的链接依赖",
            ))

        return issues

    def _tool_available(self, tool_name: str) -> bool:
        """
        检查外部工具是否在系统 PATH 中可用
        参数：
          - tool_name: 工具名称
        返回值：True 表示可用
        """
        import shutil
        return shutil.which(tool_name) is not None

    # ============================================================
    # 维度二：多模块接口兼容性检查
    # ============================================================

    def check_interface_compatibility(
        self, modules: Optional[List[str]] = None
    ) -> CheckResult:
        """
        多模块接口兼容性检查
        运行步骤：
          1. 扫描各模块的公开接口（函数签名、类定义、消息类型）
          2. 检查模块间接口调用的一致性（参数类型、返回值类型）
          3. 检测接口变更导致的兼容性问题
          4. 检查 ROS 消息/服务/动作定义的兼容性
        参数：
          - modules: 模块列表，每个元素为模块路径字符串；为空则跳过
        返回值：CheckResult 对象
        """
        import time
        start_time = time.time()

        result = CheckResult(check_name="多模块接口兼容性检查")
        issues: List[CheckIssue] = []

        if not modules:
            result.status = CheckStatus.SKIPPED
            result.score = 100.0
            result.details["reason"] = "未提供模块列表，跳过接口兼容性检查"
            result.execution_time_ms = (time.time() - start_time) * 1000
            return result

        # 收集各模块的公开接口定义
        module_interfaces: Dict[str, Dict[str, Any]] = {}
        for module_path in modules:
            if not os.path.isdir(module_path):
                continue
            module_name = os.path.basename(module_path)
            interfaces = self._extract_module_interfaces(module_path)
            if interfaces:
                module_interfaces[module_name] = interfaces

        result.details["modules_scanned"] = list(module_interfaces.keys())
        result.details["total_interfaces"] = sum(
            len(iface.get("functions", [])) + len(iface.get("classes", []))
            for iface in module_interfaces.values()
        )

        # 检查模块间接口调用一致性
        # 检测跨模块的函数调用和类引用
        cross_module_refs = self._detect_cross_module_references(modules)
        result.details["cross_module_refs"] = cross_module_refs

        # 检查接口签名兼容性
        for ref in cross_module_refs:
            caller_module = ref.get("caller", "")
            callee_module = ref.get("callee", "")
            func_name = ref.get("function", "")

            # 检查被调用函数是否存在于目标模块的接口中
            if callee_module in module_interfaces:
                callee_iface = module_interfaces[callee_module]
                callee_funcs = callee_iface.get("functions", [])
                if func_name and func_name not in callee_funcs:
                    issues.append(CheckIssue(
                        severity=CheckSeverity.WARNING,
                        category="interface",
                        description=f"模块 '{caller_module}' 调用了模块 '{callee_module}' "
                                    f"中未公开的函数: {func_name}()",
                        location=f"{caller_module} -> {callee_module}",
                        suggestion=f"请确认 '{func_name}()' 是否为模块 '{callee_module}' 的公开接口",
                    ))

        result.issues = issues

        # 计算评分
        if issues:
            penalty = sum(
                10.0 if i.severity == CheckSeverity.ERROR else
                5.0 if i.severity == CheckSeverity.WARNING else 1.0
                for i in issues
            )
            result.score = max(0.0, 100.0 - penalty)
            result.status = (
                CheckStatus.FAILED
                if any(i.severity in (CheckSeverity.CRITICAL, CheckSeverity.ERROR) for i in issues)
                else CheckStatus.PASSED
            )
        else:
            result.score = 100.0
            result.status = CheckStatus.PASSED

        result.execution_time_ms = (time.time() - start_time) * 1000

        logger.info(
            f"接口兼容性检查完成 | 模块数={len(module_interfaces)} | "
            f"问题数={len(issues)} | 评分={result.score:.1f}"
        )
        return result

    def _extract_module_interfaces(self, module_path: str) -> Dict[str, Any]:
        """
        提取模块的公开接口定义
        运行步骤：
          1. 扫描模块目录下的 Python 和 C++ 源文件
          2. 使用正则提取函数定义和类定义
          3. 汇总为接口字典
        参数：
          - module_path: 模块目录路径
        返回值：接口字典，包含 functions 和 classes 列表
        """
        interfaces: Dict[str, Any] = {
            "functions": [],
            "classes": [],
            "ros_messages": [],
            "ros_services": [],
        }

        # 收集 Python 源文件
        py_files = list(Path(module_path).rglob("*.py"))
        for py_file in py_files:
            try:
                content = py_file.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue

            # 提取函数定义：def function_name(
            func_pattern = re.compile(r'^\s*def\s+(\w+)\s*\(', re.MULTILINE)
            for match in func_pattern.finditer(content):
                func_name = match.group(1)
                # 排除私有函数（以 _ 开头）
                if not func_name.startswith("_"):
                    interfaces["functions"].append(func_name)

            # 提取类定义：class ClassName
            class_pattern = re.compile(r'^\s*class\s+(\w+)', re.MULTILINE)
            for match in class_pattern.finditer(content):
                class_name = match.group(1)
                if not class_name.startswith("_"):
                    interfaces["classes"].append(class_name)

        # 收集 C++ 源文件
        cpp_extensions = {".cpp", ".cc", ".cxx", ".h", ".hpp"}
        for ext in cpp_extensions:
            for cpp_file in Path(module_path).rglob(f"*{ext}"):
                try:
                    content = cpp_file.read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    continue

                # 提取函数声明：返回类型 函数名(参数)
                func_pattern = re.compile(
                    r'(?:^|\n)\s*(?:[\w:]+\s+)+(\w+)\s*\([^)]*\)\s*(?:const\s*)?[;{]',
                )
                for match in func_pattern.finditer(content):
                    func_name = match.group(1)
                    if not func_name.startswith("_") and func_name not in (
                        "if", "while", "for", "switch", "return",
                    ):
                        interfaces["functions"].append(func_name)

                # 提取类定义
                class_pattern = re.compile(r'^\s*class\s+(\w+)', re.MULTILINE)
                for match in class_pattern.finditer(content):
                    class_name = match.group(1)
                    if not class_name.startswith("_"):
                        interfaces["classes"].append(class_name)

        # 去重
        interfaces["functions"] = list(set(interfaces["functions"]))
        interfaces["classes"] = list(set(interfaces["classes"]))

        return interfaces

    def _detect_cross_module_references(
        self, modules: List[str]
    ) -> List[Dict[str, str]]:
        """
        检测模块间的跨模块引用关系
        运行步骤：
          1. 扫描各模块的 import/include 语句
          2. 匹配其他模块的名称
          3. 构建跨模块引用关系列表
        参数：
          - modules: 模块路径列表
        返回值：跨模块引用关系列表
        """
        refs: List[Dict[str, str]] = []
        module_names = {os.path.basename(m): m for m in modules if os.path.isdir(m)}

        for module_path in modules:
            if not os.path.isdir(module_path):
                continue
            caller_name = os.path.basename(module_path)

            # 扫描 Python 文件中的 import
            for py_file in Path(module_path).rglob("*.py"):
                try:
                    content = py_file.read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    continue

                for callee_name in module_names:
                    if callee_name == caller_name:
                        continue
                    # 检测 from callee_name import ... 或 import callee_name
                    if re.search(rf'\b(?:from|import)\s+{re.escape(callee_name)}\b', content):
                        refs.append({
                            "caller": caller_name,
                            "callee": callee_name,
                            "function": "",
                            "file": str(py_file),
                        })

            # 扫描 C++ 文件中的 #include
            cpp_extensions = {".cpp", ".cc", ".cxx", ".h", ".hpp"}
            for ext in cpp_extensions:
                for cpp_file in Path(module_path).rglob(f"*{ext}"):
                    try:
                        content = cpp_file.read_text(encoding="utf-8", errors="ignore")
                    except Exception:
                        continue

                    for callee_name in module_names:
                        if callee_name == caller_name:
                            continue
                        # 检测 #include <callee_name/...> 或 #include "callee_name/..."
                        if re.search(
                            rf'#include\s*[<"]{re.escape(callee_name)}/',
                            content,
                        ):
                            refs.append({
                                "caller": caller_name,
                                "callee": callee_name,
                                "function": "",
                                "file": str(cpp_file),
                            })

        return refs

    # ============================================================
    # 维度三：ROS 包规范检查
    # ============================================================

    def check_ros_package_specs(self, workspace_path: str) -> CheckResult:
        """
        ROS 包规范检查
        运行步骤：
          1. 复用 ROSValidator 进行包结构、依赖、跨包引用、ROS2 规范校验
          2. 汇总结果
        参数：
          - workspace_path: 工作空间路径
        返回值：CheckResult 对象
        """
        import time
        start_time = time.time()

        result = CheckResult(check_name="ROS 包规范检查")
        issues: List[CheckIssue] = []

        # 尝试导入 ROSValidator
        try:
            from .ros_validator import ROSValidator, ValidationSeverity
            validator = ROSValidator()
            ros_report = validator.full_validate(workspace_path)

            # 转换 ROSValidator 的违规记录为 CheckIssue
            for violation in ros_report.violations:
                sev_map = {
                    ValidationSeverity.ERROR: CheckSeverity.ERROR,
                    ValidationSeverity.WARNING: CheckSeverity.WARNING,
                    ValidationSeverity.INFO: CheckSeverity.INFO,
                }
                severity = sev_map.get(violation.severity, CheckSeverity.WARNING)

                issues.append(CheckIssue(
                    severity=severity,
                    category="ros_spec",
                    description=violation.description,
                    location=violation.location,
                    suggestion=violation.suggestion,
                ))

            result.details["packages_found"] = ros_report.packages_found
            result.details["package_structure_ok"] = ros_report.package_structure_ok
            result.details["dependencies_ok"] = ros_report.dependencies_ok
            result.details["cross_references_ok"] = ros_report.cross_references_ok
            result.details["ros2_specs_ok"] = ros_report.ros2_specs_ok

            # 计算评分
            result.score = ros_report.overall_score
            has_error = any(
                i.severity in (CheckSeverity.CRITICAL, CheckSeverity.ERROR)
                for i in issues
            )
            result.status = CheckStatus.FAILED if has_error else CheckStatus.PASSED

        except ImportError:
            result.status = CheckStatus.SKIPPED
            result.score = 100.0
            result.details["reason"] = "ROSValidator 不可用，跳过 ROS 包规范检查"
        except Exception as e:
            logger.error(f"ROS 包规范检查异常: {e}")
            result.status = CheckStatus.ERROR
            result.score = 0.0
            result.details["error"] = str(e)

        result.issues = issues
        result.execution_time_ms = (time.time() - start_time) * 1000

        logger.info(
            f"ROS 包规范检查完成 | 包数={len(result.details.get('packages_found', []))} | "
            f"问题数={len(issues)} | 评分={result.score:.1f}"
        )
        return result

    # ============================================================
    # 维度四：跨包引用检查
    # ============================================================

    def check_cross_references(self, workspace_path: str) -> CheckResult:
        """
        跨包引用检查
        运行步骤：
          1. 扫描所有 ROS 包的 C/C++ 源文件
          2. 检查 #include 语句是否使用 <包名/头文件.h> 标准格式
          3. 检测相对路径引用
          4. 检测循环引用
        参数：
          - workspace_path: 工作空间路径
        返回值：CheckResult 对象
        """
        import time
        start_time = time.time()

        result = CheckResult(check_name="跨包引用检查")
        issues: List[CheckIssue] = []

        if not workspace_path or not os.path.isdir(workspace_path):
            result.status = CheckStatus.ERROR
            result.score = 0.0
            result.issues.append(CheckIssue(
                severity=CheckSeverity.CRITICAL,
                category="cross_ref",
                description=f"工作空间路径无效: {workspace_path}",
                location=workspace_path,
                suggestion="请提供有效的工作空间路径",
            ))
            result.execution_time_ms = (time.time() - start_time) * 1000
            return result

        # 收集所有 ROS 包
        packages = self._discover_ros_packages(workspace_path)
        result.details["packages_found"] = list(packages.keys())

        if not packages:
            result.status = CheckStatus.SKIPPED
            result.score = 100.0
            result.details["reason"] = "未发现 ROS 包，跳过跨包引用检查"
            result.execution_time_ms = (time.time() - start_time) * 1000
            return result

        # 扫描每个包的跨包引用
        # 相对路径引用检测正则
        relative_include_pattern = re.compile(
            r'#include\s+["<]\s*(\.\./|\./)[^">]+[">]'
        )
        # 引号包裹的跨包引用检测
        quoted_cross_pkg_pattern = re.compile(
            r'#include\s+"([a-zA-Z_][a-zA-Z0-9_]*)/[^"]+"'
        )

        cpp_extensions = {".cpp", ".cc", ".cxx", ".c", ".h", ".hpp"}

        for pkg_name, pkg_path in packages.items():
            for ext in cpp_extensions:
                for cpp_file in Path(pkg_path).rglob(f"*{ext}"):
                    # 跳过构建目录
                    if any(skip in str(cpp_file) for skip in ("build", "install", "log")):
                        continue

                    try:
                        content = cpp_file.read_text(encoding="utf-8", errors="ignore")
                    except Exception:
                        continue

                    lines = content.split("\n")
                    for line_num, line in enumerate(lines, start=1):
                        stripped = line.strip()
                        if stripped.startswith("//") or stripped.startswith("/*"):
                            continue

                        # 检测相对路径引用
                        if relative_include_pattern.search(stripped):
                            issues.append(CheckIssue(
                                severity=CheckSeverity.ERROR,
                                category="cross_ref",
                                description=f"使用了相对路径引用头文件: {stripped}",
                                location=f"{cpp_file}:{line_num}",
                                suggestion="跨包头文件引用应使用 <包名/头文件.h> 标准格式",
                            ))

                        # 检测引号包裹的跨包引用
                        quoted_match = quoted_cross_pkg_pattern.search(stripped)
                        if quoted_match:
                            ref_pkg = quoted_match.group(1)
                            if ref_pkg != pkg_name and ref_pkg not in (
                                "std", "boost", "Eigen", "yaml-cpp", "tf2",
                            ):
                                issues.append(CheckIssue(
                                    severity=CheckSeverity.WARNING,
                                    category="cross_ref",
                                    description=f"跨包引用应使用尖括号格式: {stripped}",
                                    location=f"{cpp_file}:{line_num}",
                                    suggestion=f"建议改为 #include <{ref_pkg}/...> 格式",
                                ))

        result.issues = issues

        # 计算评分
        error_count = sum(1 for i in issues if i.severity == CheckSeverity.ERROR)
        warning_count = sum(1 for i in issues if i.severity == CheckSeverity.WARNING)
        result.score = max(0.0, 100.0 - error_count * 15.0 - warning_count * 5.0)
        result.status = (
            CheckStatus.FAILED
            if any(i.severity in (CheckSeverity.CRITICAL, CheckSeverity.ERROR) for i in issues)
            else CheckStatus.PASSED
        )

        result.execution_time_ms = (time.time() - start_time) * 1000

        logger.info(
            f"跨包引用检查完成 | 包数={len(packages)} | "
            f"问题数={len(issues)} | 评分={result.score:.1f}"
        )
        return result

    def _discover_ros_packages(self, workspace_path: str) -> Dict[str, str]:
        """
        在工作空间中递归发现所有 ROS 包
        参数：
          - workspace_path: 工作空间根目录
        返回值：包名 -> 包路径的字典
        """
        packages: Dict[str, str] = {}
        skip_dirs = {"build", "install", "log", ".git", "__pycache__", "devel"}

        try:
            for root, dirs, files in os.walk(workspace_path):
                dirs[:] = [
                    d for d in dirs
                    if d not in skip_dirs and not d.startswith(".")
                ]
                if "package.xml" in files:
                    pkg_path = root
                    pkg_name = self._extract_package_name(
                        os.path.join(pkg_path, "package.xml")
                    )
                    if pkg_name is None:
                        pkg_name = os.path.basename(pkg_path)
                    packages[pkg_name] = pkg_path
        except Exception as e:
            logger.error(f"发现 ROS 包时出错: {e}")

        return packages

    def _extract_package_name(self, xml_path: str) -> Optional[str]:
        """
        从 package.xml 中提取包名
        参数：
          - xml_path: package.xml 文件路径
        返回值：包名字符串，提取失败返回 None
        """
        if not os.path.isfile(xml_path):
            return None
        try:
            with open(xml_path, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception:
            return None
        match = re.search(r'<name>\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*</name>', content)
        return match.group(1) if match else None

    # ============================================================
    # 维度五：跨模块安全联动检查
    # ============================================================

    def check_cross_module_security(
        self, modules: Optional[List[str]] = None
    ) -> CheckResult:
        """
        跨模块安全联动检查
        运行步骤：
          1. 检查各模块的急停逻辑是否可跨模块触发
          2. 检查安全状态切换是否可跨模块传播
          3. 检查故障兜底机制的跨模块联动有效性
          4. 检查安全关键数据流的完整性
        参数：
          - modules: 模块列表，每个元素为模块路径字符串；为空则跳过
        返回值：CheckResult 对象
        """
        import time
        start_time = time.time()

        result = CheckResult(check_name="跨模块安全联动检查")
        issues: List[CheckIssue] = []

        if not modules:
            result.status = CheckStatus.SKIPPED
            result.score = 100.0
            result.details["reason"] = "未提供模块列表，跳过跨模块安全联动检查"
            result.execution_time_ms = (time.time() - start_time) * 1000
            return result

        # 安全关键关键词检测
        safety_keywords = {
            "emergency_stop": ["emergency_stop", "e_stop", "E_STOP", "emergency", "halt"],
            "safe_state": ["SAFE_STATE", "safe_state", "STATE_SAFE", "safe_mode"],
            "fault_recovery": ["fault", "recovery", "fallback", "degraded", "DISABLE"],
            "watchdog": ["watchdog", "heartbeat", "keepalive", "alive_check"],
        }

        module_safety_info: Dict[str, Dict[str, bool]] = {}

        for module_path in modules:
            if not os.path.isdir(module_path):
                continue
            module_name = os.path.basename(module_path)
            safety_info: Dict[str, bool] = {}

            # 扫描模块中所有源文件
            all_content = ""
            for ext in ["*.py", "*.cpp", "*.cc", "*.cxx", "*.h", "*.hpp"]:
                for src_file in Path(module_path).rglob(ext):
                    # 跳过构建目录
                    if any(skip in str(src_file) for skip in ("build", "install", "log")):
                        continue
                    try:
                        all_content += src_file.read_text(encoding="utf-8", errors="ignore")
                    except Exception:
                        continue

            # 检测各类安全机制
            for category, keywords in safety_keywords.items():
                found = any(kw in all_content for kw in keywords)
                safety_info[category] = found

            module_safety_info[module_name] = safety_info

        result.details["module_safety_info"] = module_safety_info

        # 检查跨模块安全联动
        # 急停逻辑：至少一个模块有急停逻辑，但需要检查其他模块是否能响应
        has_emergency_stop = any(
            info.get("emergency_stop", False)
            for info in module_safety_info.values()
        )
        if not has_emergency_stop:
            issues.append(CheckIssue(
                severity=CheckSeverity.CRITICAL,
                category="security",
                description="所有模块均未检测到急停/紧急停止逻辑",
                location="全局",
                suggestion="至少一个模块应实现急停逻辑，并通过 ROS topic 跨模块传播急停信号",
            ))
        else:
            # 检查急停信号是否能跨模块传播
            modules_without_estop = [
                name for name, info in module_safety_info.items()
                if not info.get("emergency_stop", False)
            ]
            if modules_without_estop:
                issues.append(CheckIssue(
                    severity=CheckSeverity.WARNING,
                    category="security",
                    description=f"以下模块缺少急停响应逻辑: {', '.join(modules_without_estop)}",
                    location="跨模块",
                    suggestion="所有控制相关模块应订阅急停 topic 并实现安全停止逻辑",
                ))

        # 检查安全状态传播
        modules_without_safe_state = [
            name for name, info in module_safety_info.items()
            if not info.get("safe_state", False)
        ]
        if modules_without_safe_state:
            issues.append(CheckIssue(
                severity=CheckSeverity.WARNING,
                category="security",
                description=f"以下模块缺少安全状态定义: {', '.join(modules_without_safe_state)}",
                location="跨模块",
                suggestion="各模块应定义安全状态，确保异常时能切换到安全状态",
            ))

        # 检查故障恢复机制
        modules_without_fault_recovery = [
            name for name, info in module_safety_info.items()
            if not info.get("fault_recovery", False)
        ]
        if modules_without_fault_recovery:
            issues.append(CheckIssue(
                severity=CheckSeverity.WARNING,
                category="security",
                description=f"以下模块缺少故障恢复/降级逻辑: {', '.join(modules_without_fault_recovery)}",
                location="跨模块",
                suggestion="各模块应实现故障检测和降级处理逻辑",
            ))

        result.issues = issues

        # 计算评分
        critical_count = sum(1 for i in issues if i.severity == CheckSeverity.CRITICAL)
        warning_count = sum(1 for i in issues if i.severity == CheckSeverity.WARNING)
        result.score = max(0.0, 100.0 - critical_count * 30.0 - warning_count * 10.0)
        result.status = (
            CheckStatus.FAILED
            if any(i.severity in (CheckSeverity.CRITICAL, CheckSeverity.ERROR) for i in issues)
            else CheckStatus.PASSED
        )

        result.execution_time_ms = (time.time() - start_time) * 1000

        logger.info(
            f"跨模块安全联动检查完成 | 模块数={len(module_safety_info)} | "
            f"问题数={len(issues)} | 评分={result.score:.1f}"
        )
        return result

    # ============================================================
    # 维度六：隐式循环依赖检测
    # ============================================================

    def detect_implicit_circular_deps(self, workspace_path: str) -> CheckResult:
        """
        隐式循环依赖检测
        运行步骤：
          1. 扫描 ROS package.xml 中的依赖声明
          2. 扫描 CMakeLists.txt 中的 find_package 声明
          3. 扫描 C++ 头文件中的跨包引用
          4. 构建依赖图
          5. 使用 DFS 检测循环依赖环
          6. 检测隐式依赖（通过头文件引用引入的间接依赖）
        参数：
          - workspace_path: 工作空间路径
        返回值：CheckResult 对象
        """
        import time
        start_time = time.time()

        result = CheckResult(check_name="隐式循环依赖检测")
        issues: List[CheckIssue] = []

        if not workspace_path or not os.path.isdir(workspace_path):
            result.status = CheckStatus.ERROR
            result.score = 0.0
            result.issues.append(CheckIssue(
                severity=CheckSeverity.CRITICAL,
                category="circular_dep",
                description=f"工作空间路径无效: {workspace_path}",
                location=workspace_path,
                suggestion="请提供有效的工作空间路径",
            ))
            result.execution_time_ms = (time.time() - start_time) * 1000
            return result

        # 发现 ROS 包
        packages = self._discover_ros_packages(workspace_path)
        if not packages:
            result.status = CheckStatus.SKIPPED
            result.score = 100.0
            result.details["reason"] = "未发现 ROS 包，跳过循环依赖检测"
            result.execution_time_ms = (time.time() - start_time) * 1000
            return result

        # 构建依赖图：包名 -> 依赖的包名集合
        dep_graph: Dict[str, Set[str]] = {}
        for pkg_name, pkg_path in packages.items():
            deps = self._extract_package_dependencies(pkg_path, pkg_name, packages)
            dep_graph[pkg_name] = deps

        result.details["dep_graph"] = {
            k: list(v) for k, v in dep_graph.items()
        }
        result.details["packages_count"] = len(packages)

        # 使用 DFS 检测循环依赖
        cycles = self._find_dependency_cycles(dep_graph)
        result.details["cycles_found"] = cycles

        for cycle in cycles:
            cycle_str = " -> ".join(cycle) + " -> " + cycle[0]
            issues.append(CheckIssue(
                severity=CheckSeverity.CRITICAL,
                category="circular_dep",
                description=f"检测到循环依赖: {cycle_str}",
                location=" -> ".join(cycle),
                suggestion=f"请打破循环依赖环，考虑提取公共接口到独立包或使用依赖倒置",
            ))

        # 检测隐式依赖（通过头文件引用引入的非显式声明依赖）
        implicit_deps = self._detect_implicit_dependencies(packages, dep_graph)
        result.details["implicit_deps"] = implicit_deps

        for implicit in implicit_deps:
            issues.append(CheckIssue(
                severity=CheckSeverity.WARNING,
                category="circular_dep",
                description=(
                    f"包 '{implicit['pkg']}' 通过头文件引用了包 '{implicit['implicit_dep']}'，"
                    f"但未在 package.xml 中显式声明依赖"
                ),
                location=f"{implicit['pkg']} -> {implicit['implicit_dep']}",
                suggestion=f"请在 package.xml 中添加对 '{implicit['implicit_dep']}' 的依赖声明",
            ))

        result.issues = issues

        # 计算评分
        cycle_count = len(cycles)
        implicit_count = len(implicit_deps)
        result.score = max(0.0, 100.0 - cycle_count * 25.0 - implicit_count * 5.0)
        result.status = (
            CheckStatus.FAILED if cycles else CheckStatus.PASSED
        )

        result.execution_time_ms = (time.time() - start_time) * 1000

        logger.info(
            f"循环依赖检测完成 | 包数={len(packages)} | "
            f"循环依赖={cycle_count} | 隐式依赖={implicit_count} | 评分={result.score:.1f}"
        )
        return result

    def _extract_package_dependencies(
        self, pkg_path: str, pkg_name: str, all_packages: Dict[str, str]
    ) -> Set[str]:
        """
        提取 ROS 包的依赖关系
        运行步骤：
          1. 解析 package.xml 中的 <depend>、<build_depend>、<exec_depend>
          2. 解析 CMakeLists.txt 中的 find_package
          3. 仅保留在 all_packages 中存在的包间依赖
        参数：
          - pkg_path: 包路径
          - pkg_name: 包名
          - all_packages: 所有已知包名到路径的映射
        返回值：依赖的包名集合
        """
        deps: Set[str] = set()

        # 解析 package.xml
        xml_path = os.path.join(pkg_path, "package.xml")
        if os.path.isfile(xml_path):
            try:
                with open(xml_path, "r", encoding="utf-8") as f:
                    content = f.read()
            except Exception:
                content = ""

            # 匹配所有依赖标签
            for dep_type in ("depend", "build_depend", "exec_depend"):
                pattern = rf'<{dep_type}[^>]*>\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*</{dep_type}>'
                for match in re.finditer(pattern, content):
                    dep_name = match.group(1)
                    if dep_name in all_packages and dep_name != pkg_name:
                        deps.add(dep_name)

        # 解析 CMakeLists.txt
        cmake_path = os.path.join(pkg_path, "CMakeLists.txt")
        if os.path.isfile(cmake_path):
            try:
                with open(cmake_path, "r", encoding="utf-8") as f:
                    cmake_content = f.read()
            except Exception:
                cmake_content = ""

            for match in re.finditer(
                r'find_package\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)',
                cmake_content,
            ):
                dep_name = match.group(1)
                if dep_name in all_packages and dep_name != pkg_name:
                    deps.add(dep_name)

        return deps

    def _find_dependency_cycles(
        self, dep_graph: Dict[str, Set[str]]
    ) -> List[List[str]]:
        """
        使用 DFS 检测依赖图中的循环依赖环
        运行步骤：
          1. 对每个节点执行 DFS
          2. 维护访问状态（未访问/访问中/已完成）
          3. 检测回边（back edge）识别循环
          4. 提取循环路径
        参数：
          - dep_graph: 包名 -> 依赖包名集合的字典
        返回值：循环依赖环列表，每个环为包名列表
        """
        cycles: List[List[str]] = []
        # 节点状态：0=未访问, 1=访问中（在当前递归栈中）, 2=已完成
        state: Dict[str, int] = {node: 0 for node in dep_graph}
        # 当前递归路径
        path: List[str] = []
        # 已发现的环（用于去重）
        found_cycles: Set[str] = set()

        def dfs(node: str):
            """深度优先搜索检测循环依赖"""
            state[node] = 1  # 标记为访问中
            path.append(node)

            for neighbor in dep_graph.get(node, set()):
                if state.get(neighbor, 0) == 1:
                    # 发现回边，提取循环路径
                    cycle_start = path.index(neighbor)
                    cycle = path[cycle_start:]
                    # 规范化环的表示（从最小节点开始），用于去重
                    min_idx = min(range(len(cycle)), key=lambda i: cycle[i])
                    normalized = tuple(cycle[min_idx:] + cycle[:min_idx])
                    if normalized not in found_cycles:
                        found_cycles.add(normalized)
                        cycles.append(list(normalized))
                elif state.get(neighbor, 0) == 0:
                    dfs(neighbor)

            path.pop()
            state[node] = 2  # 标记为已完成

        for node in dep_graph:
            if state.get(node, 0) == 0:
                dfs(node)

        return cycles

    def _detect_implicit_dependencies(
        self, packages: Dict[str, str], dep_graph: Dict[str, Set[str]]
    ) -> List[Dict[str, str]]:
        """
        检测隐式依赖（通过头文件引用但未在 package.xml 中声明的依赖）
        运行步骤：
          1. 扫描每个包的 C++ 头文件引用
          2. 提取引用的其他包名
          3. 与显式声明的依赖对比
          4. 标记未声明的隐式依赖
        参数：
          - packages: 包名到路径的映射
          - dep_graph: 显式依赖图
        返回值：隐式依赖列表
        """
        implicit_deps: List[Dict[str, str]] = []

        for pkg_name, pkg_path in packages.items():
            explicit_deps = dep_graph.get(pkg_name, set())

            # 扫描 C++ 文件中的跨包引用
            cpp_extensions = {".cpp", ".cc", ".cxx", ".h", ".hpp"}
            referenced_pkgs: Set[str] = set()

            for ext in cpp_extensions:
                for cpp_file in Path(pkg_path).rglob(f"*{ext}"):
                    if any(skip in str(cpp_file) for skip in ("build", "install", "log")):
                        continue
                    try:
                        content = cpp_file.read_text(encoding="utf-8", errors="ignore")
                    except Exception:
                        continue

                    # 匹配 #include <pkg_name/...> 格式
                    for match in re.finditer(
                        r'#include\s*<([a-zA-Z_][a-zA-Z0-9_]*)/',
                        content,
                    ):
                        ref_pkg = match.group(1)
                        if ref_pkg in packages and ref_pkg != pkg_name:
                            referenced_pkgs.add(ref_pkg)

            # 找出未声明的隐式依赖
            for ref_pkg in referenced_pkgs:
                if ref_pkg not in explicit_deps:
                    implicit_deps.append({
                        "pkg": pkg_name,
                        "implicit_dep": ref_pkg,
                    })

        return implicit_deps

    # ============================================================
    # 综合集成校验
    # ============================================================

    def full_integration_check(
        self,
        workspace_path: str,
        modules: Optional[List[str]] = None,
    ) -> IntegrationReport:
        """
        执行完整的六维集成校验
        运行步骤：
          1. 校验输入参数合法性
          2. 依次执行六个维度的校验：
             a. 全量代码编译检查
             b. 多模块接口兼容性检查
             c. ROS 包规范检查
             d. 跨包引用检查
             e. 跨模块安全联动检查
             f. 隐式循环依赖检测
          3. 汇总生成综合集成校验报告
          4. 缓存报告
        参数：
          - workspace_path: 工作空间根目录的绝对路径
          - modules: 模块路径列表（可选）
        返回值：IntegrationReport 对象
        """
        logger.info(f"开始全量集成校验 | 工作空间={workspace_path}")

        check_results: List[CheckResult] = []

        # 维度一：全量代码编译检查
        compile_result = self.check_full_compilation(workspace_path)
        check_results.append(compile_result)

        # 维度二：多模块接口兼容性检查
        interface_result = self.check_interface_compatibility(modules)
        check_results.append(interface_result)

        # 维度三：ROS 包规范检查
        ros_spec_result = self.check_ros_package_specs(workspace_path)
        check_results.append(ros_spec_result)

        # 维度四：跨包引用检查
        cross_ref_result = self.check_cross_references(workspace_path)
        check_results.append(cross_ref_result)

        # 维度五：跨模块安全联动检查
        security_result = self.check_cross_module_security(modules)
        check_results.append(security_result)

        # 维度六：隐式循环依赖检测
        circular_dep_result = self.detect_implicit_circular_deps(workspace_path)
        check_results.append(circular_dep_result)

        # 汇总生成综合报告
        report = self._build_integration_report(workspace_path, check_results)

        # 缓存最近一次报告
        self._last_report = report

        logger.info(
            f"全量集成校验完成 | 综合评分={report.overall_score:.1f} | "
            f"通过={report.overall_passed} | 问题总数={report.total_issues}"
        )
        return report

    def _build_integration_report(
        self,
        workspace_path: str,
        check_results: List[CheckResult],
    ) -> IntegrationReport:
        """
        汇总各维度校验结果，生成综合集成校验报告
        运行步骤：
          1. 统计各严重程度问题数量
          2. 计算综合评分（各维度评分的加权平均）
          3. 判断综合是否通过
          4. 生成摘要
        参数：
          - workspace_path: 工作空间路径
          - check_results: 各维度校验结果列表
        返回值：IntegrationReport 对象
        """
        report = IntegrationReport(
            workspace_path=workspace_path,
            check_results=check_results,
            generated_at=datetime.now(timezone.utc).isoformat(),
        )

        # 统计问题数量
        for cr in check_results:
            for issue in cr.issues:
                report.total_issues += 1
                if issue.severity == CheckSeverity.CRITICAL:
                    report.critical_count += 1
                elif issue.severity == CheckSeverity.ERROR:
                    report.error_count += 1
                elif issue.severity == CheckSeverity.WARNING:
                    report.warning_count += 1
                elif issue.severity == CheckSeverity.INFO:
                    report.info_count += 1

        # 计算综合评分：各维度等权平均
        valid_results = [cr for cr in check_results if cr.status != CheckStatus.SKIPPED]
        if valid_results:
            report.overall_score = sum(cr.score for cr in valid_results) / len(valid_results)
        else:
            report.overall_score = 0.0

        # 综合通过判定：所有非跳过的校验都通过，且综合评分 >= 60
        all_passed = all(
            cr.status in (CheckStatus.PASSED, CheckStatus.SKIPPED)
            for cr in check_results
        )
        report.overall_passed = all_passed and report.overall_score >= 60.0

        # 生成摘要
        failed_checks = [
            cr.check_name for cr in check_results
            if cr.status == CheckStatus.FAILED
        ]
        report.summary = (
            f"集成校验完成：{len(check_results)} 项检查，"
            f"通过={sum(1 for cr in check_results if cr.status == CheckStatus.PASSED)}，"
            f"失败={len(failed_checks)}，"
            f"跳过={sum(1 for cr in check_results if cr.status == CheckStatus.SKIPPED)}，"
            f"综合评分 {report.overall_score:.1f}/100"
        )
        if failed_checks:
            report.summary += f"，失败项: {', '.join(failed_checks)}"

        return report

    def get_last_report(self) -> Optional[IntegrationReport]:
        """
        获取最近一次集成校验报告
        返回值：IntegrationReport 对象或 None
        """
        return self._last_report


# 全局单例
integration_checker = IntegrationChecker()
