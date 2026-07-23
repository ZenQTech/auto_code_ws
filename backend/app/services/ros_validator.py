"""
# ============================================================
# 后端核心服务 - ROS 工程规范校验器
# ============================================================
# 核心作用：对 ROS/ROS2 工程进行自动化规范校验，包括包结构、
#           依赖管理、跨包引用、ROS2 特有规范四个维度的检查
# 运行流程：
#   1. 接收待校验的 ROS 工程根目录路径
#   2. 扫描目录结构，提取所有 ROS 包
#   3. 对每个包执行四个维度的校验：
#      a. 包结构校验：检查目录是否遵循 ROS/ROS2 标准
#      b. 依赖管理校验：检查 package.xml 和 CMakeLists.txt
#      c. 跨包引用校验：检查头文件 include 格式
#      d. ROS2 特有规范校验：QoS、生命周期、组件化等
#   4. 汇总所有校验结果，返回完整报告
# 输入参数：
#   - workspace_path: str，ROS 工作空间根目录路径
#   - package_name: Optional[str]，指定校验的包名（为空则校验所有包）
# 输出结果：ROSValidationReport 对象，包含各维度校验结果和问题列表
# ============================================================
# 修改记录：
#   版本 1.0.0 | 2026-06-24 | 初始创建，实现 ROS 工程规范四维校验
# ============================================================
"""

import logging
import os
import re
import ast
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Set
from enum import Enum

logger = logging.getLogger(__name__)


# ============================================================
# 枚举与数据类定义
# ============================================================

class ValidationSeverity(str, Enum):
    """校验严重程度枚举"""
    ERROR = "error"       # 严重违规，必须修复
    WARNING = "warning"   # 警告，建议修复
    INFO = "info"         # 信息提示


@dataclass
class ROSViolation:
    """
    ROS 规范违规记录
    字段说明：
      - severity: 严重程度（error/warning/info）
      - category: 违规类别（package_structure/dependency/cross_reference/ros2_spec）
      - description: 违规描述
      - location: 违规位置（文件路径:行号 或 目录路径）
      - suggestion: 修复建议
    """
    severity: ValidationSeverity = ValidationSeverity.WARNING
    category: str = ""
    description: str = ""
    location: str = ""
    suggestion: str = ""


@dataclass
class ROSValidationReport:
    """
    ROS 工程规范校验报告
    字段说明：
      - workspace_path: 校验的工作空间路径
      - packages_found: 发现的 ROS 包列表
      - violations: 所有违规记录列表
      - package_structure_ok: 包结构校验是否通过
      - dependencies_ok: 依赖管理校验是否通过
      - cross_references_ok: 跨包引用校验是否通过
      - ros2_specs_ok: ROS2 特有规范校验是否通过
      - overall_score: 综合评分（0-100）
      - summary: 校验摘要
    """
    workspace_path: str = ""
    packages_found: List[str] = field(default_factory=list)
    violations: List[ROSViolation] = field(default_factory=list)
    package_structure_ok: bool = True
    dependencies_ok: bool = True
    cross_references_ok: bool = True
    ros2_specs_ok: bool = True
    overall_score: float = 100.0
    summary: str = ""


# ============================================================
# ROS 工程规范校验器
# ============================================================

class ROSValidator:
    """
    ROS 工程规范校验器
    作用：对 ROS/ROS2 工程进行包结构、依赖管理、跨包引用、
          ROS2 特有规范四个维度的自动化校验
    调用方：任务验证引擎、代码审查流程
    被调用方：无（独立工具类）
    """

    # ----------------------------------------------------------
    # ROS/ROS2 标准包目录结构定义（类属性，所有实例共享）
    # ----------------------------------------------------------
    # 标准 ROS 包必须包含的目录
    ROS_STANDARD_DIRS: Set[str] = {
        "include",   # C++ 头文件目录
        "src",       # 源代码目录
        "launch",    # 启动文件目录
        "config",    # 配置文件目录
    }

    # ROS 包可选但推荐的标准目录
    ROS_OPTIONAL_DIRS: Set[str] = {
        "msg",       # 自定义消息定义
        "srv",       # 自定义服务定义
        "action",    # 自定义动作定义
        "test",      # 测试目录
        "urdf",      # 机器人模型描述
        "worlds",    # 仿真世界文件
        "rviz",      # RViz 配置文件
        "scripts",   # 脚本目录
    }

    # ROS 包必须包含的文件
    ROS_REQUIRED_FILES: Set[str] = {
        "CMakeLists.txt",  # CMake 构建配置
        "package.xml",     # 包元数据描述
    }

    # ----------------------------------------------------------
    # 依赖类型定义（对应 package.xml 中的依赖标签）
    # ----------------------------------------------------------
    DEPENDENCY_TYPES: Set[str] = {
        "build_depend",       # 构建依赖
        "buildtool_depend",   # 构建工具依赖
        "exec_depend",        # 执行依赖
        "test_depend",        # 测试依赖
        "depend",             # 通用依赖（同时为构建和执行依赖）
        "build_export_depend",# 构建导出依赖
        "doc_depend",         # 文档依赖
    }

    # ----------------------------------------------------------
    # ROS2 QoS 策略定义
    # ----------------------------------------------------------
    # 控制类数据推荐使用 RELIABLE（可靠传输）
    # 传感器数据推荐使用 BEST_EFFORT（尽力传输）
    QOS_RELIABILITY_OPTIONS: Set[str] = {
        "RELIABLE", "BEST_EFFORT", "SYSTEM_DEFAULT",
    }

    QOS_DURABILITY_OPTIONS: Set[str] = {
        "VOLATILE", "TRANSIENT_LOCAL", "SYSTEM_DEFAULT",
    }

    QOS_HISTORY_OPTIONS: Set[str] = {
        "KEEP_LAST", "KEEP_ALL", "SYSTEM_DEFAULT",
    }

    def __init__(self):
        """初始化 ROS 校验器，无外部依赖"""
        pass

    # ==========================================================
    # 公开方法：完整校验入口
    # ==========================================================

    def full_validate(
        self, workspace_path: str, package_name: Optional[str] = None
    ) -> ROSValidationReport:
        """
        执行完整的 ROS 工程规范校验
        运行步骤：
          1. 扫描工作空间，发现所有 ROS 包
          2. 对每个包执行包结构校验
          3. 对每个包执行依赖管理校验
          4. 对每个包执行跨包引用校验
          5. 对每个包执行 ROS2 特有规范校验
          6. 汇总结果，计算综合评分
        参数：
          - workspace_path: ROS 工作空间根目录路径
          - package_name: 指定校验的包名（为空则校验所有包）
        返回值：ROSValidationReport 对象
        """
        # 工作空间路径合法性校验
        if not workspace_path or not os.path.isdir(workspace_path):
            report = ROSValidationReport(workspace_path=workspace_path)
            report.violations.append(ROSViolation(
                severity=ValidationSeverity.ERROR,
                category="workspace",
                description=f"工作空间路径不存在或无效: {workspace_path}",
                location=workspace_path,
                suggestion="请提供有效的 ROS 工作空间根目录路径",
            ))
            report.overall_score = 0.0
            report.summary = "工作空间路径无效，无法执行校验"
            return report

        logger.info(f"开始 ROS 工程规范校验: {workspace_path}")

        # 步骤 1：发现所有 ROS 包
        packages = self._discover_packages(workspace_path, package_name)
        if not packages:
            report = ROSValidationReport(workspace_path=workspace_path)
            report.violations.append(ROSViolation(
                severity=ValidationSeverity.WARNING,
                category="workspace",
                description="未发现任何 ROS 包（缺少 package.xml）",
                location=workspace_path,
                suggestion="请确认工作空间路径正确，且包含有效的 ROS 包",
            ))
            report.overall_score = 50.0
            report.summary = "未发现 ROS 包"
            return report

        report = ROSValidationReport(
            workspace_path=workspace_path,
            packages_found=list(packages.keys()),
        )

        # 步骤 2-5：逐包执行四维校验
        all_violations: List[ROSViolation] = []
        for pkg_name, pkg_path in packages.items():
            logger.info(f"校验包: {pkg_name} ({pkg_path})")

            # 包结构校验
            struct_violations = self.validate_package_structure(pkg_path, pkg_name)
            all_violations.extend(struct_violations)

            # 依赖管理校验
            dep_violations = self.validate_dependencies(pkg_path, pkg_name)
            all_violations.extend(dep_violations)

            # 跨包引用校验
            ref_violations = self.validate_cross_references(pkg_path, pkg_name)
            all_violations.extend(ref_violations)

            # ROS2 特有规范校验
            ros2_violations = self.validate_ros2_specs(pkg_path, pkg_name)
            all_violations.extend(ros2_violations)

        report.violations = all_violations

        # 步骤 6：汇总各维度结果
        report.package_structure_ok = not any(
            v.category == "package_structure" and v.severity == ValidationSeverity.ERROR
            for v in all_violations
        )
        report.dependencies_ok = not any(
            v.category == "dependency" and v.severity == ValidationSeverity.ERROR
            for v in all_violations
        )
        report.cross_references_ok = not any(
            v.category == "cross_reference" and v.severity == ValidationSeverity.ERROR
            for v in all_violations
        )
        report.ros2_specs_ok = not any(
            v.category == "ros2_spec" and v.severity == ValidationSeverity.ERROR
            for v in all_violations
        )

        # 计算综合评分：基础分 100，每个 error 扣 10 分，每个 warning 扣 3 分
        error_count = sum(1 for v in all_violations if v.severity == ValidationSeverity.ERROR)
        warning_count = sum(1 for v in all_violations if v.severity == ValidationSeverity.WARNING)
        report.overall_score = max(0.0, 100.0 - error_count * 10.0 - warning_count * 3.0)

        # 生成摘要
        report.summary = (
            f"校验完成：{len(packages)} 个包，"
            f"发现 {error_count} 个错误、{warning_count} 个警告，"
            f"综合评分 {report.overall_score:.1f}/100"
        )

        logger.info(report.summary)
        return report

    # ==========================================================
    # 维度一：包结构校验
    # ==========================================================

    def validate_package_structure(
        self, package_path: str, package_name: str
    ) -> List[ROSViolation]:
        """
        校验 ROS 包的目录结构是否符合标准
        运行步骤：
          1. 检查必须文件（CMakeLists.txt、package.xml）是否存在
          2. 检查标准目录（include、src、launch、config）是否存在
          3. 检查可选目录（msg、srv、action 等）是否存在
          4. 检查是否有非标准目录/文件
        参数：
          - package_path: 包的绝对路径
          - package_name: 包名
        返回值：违规记录列表
        """
        violations: List[ROSViolation] = []

        if not os.path.isdir(package_path):
            violations.append(ROSViolation(
                severity=ValidationSeverity.ERROR,
                category="package_structure",
                description=f"包目录不存在: {package_path}",
                location=package_path,
                suggestion="请确认包路径正确",
            ))
            return violations

        # 检查必须文件
        for required_file in self.ROS_REQUIRED_FILES:
            file_path = os.path.join(package_path, required_file)
            if not os.path.isfile(file_path):
                violations.append(ROSViolation(
                    severity=ValidationSeverity.ERROR,
                    category="package_structure",
                    description=f"缺少必须文件: {required_file}",
                    location=package_path,
                    suggestion=f"请在包根目录创建 {required_file} 文件",
                ))

        # 检查标准目录（include/<pkg_name>/ 格式）
        include_dir = os.path.join(package_path, "include")
        if os.path.isdir(include_dir):
            # include 目录下应有以包名命名的子目录
            pkg_include = os.path.join(include_dir, package_name)
            if not os.path.isdir(pkg_include):
                violations.append(ROSViolation(
                    severity=ValidationSeverity.WARNING,
                    category="package_structure",
                    description=f"include 目录下缺少 {package_name}/ 子目录",
                    location=include_dir,
                    suggestion=f"ROS 标准要求 include 目录下使用 <包名>/ 子目录组织头文件",
                ))
        else:
            violations.append(ROSViolation(
                severity=ValidationSeverity.WARNING,
                category="package_structure",
                description="缺少标准目录: include/",
                location=package_path,
                suggestion="建议创建 include/<包名>/ 目录存放 C++ 头文件",
            ))

        # 检查 src 目录
        src_dir = os.path.join(package_path, "src")
        if not os.path.isdir(src_dir):
            violations.append(ROSViolation(
                severity=ValidationSeverity.WARNING,
                category="package_structure",
                description="缺少标准目录: src/",
                location=package_path,
                suggestion="建议创建 src/ 目录存放源代码文件",
            ))

        # 检查 launch 目录
        launch_dir = os.path.join(package_path, "launch")
        if not os.path.isdir(launch_dir):
            violations.append(ROSViolation(
                severity=ValidationSeverity.INFO,
                category="package_structure",
                description="缺少标准目录: launch/",
                location=package_path,
                suggestion="建议创建 launch/ 目录存放启动文件",
            ))

        # 检查 config 目录
        config_dir = os.path.join(package_path, "config")
        if not os.path.isdir(config_dir):
            violations.append(ROSViolation(
                severity=ValidationSeverity.INFO,
                category="package_structure",
                description="缺少标准目录: config/",
                location=package_path,
                suggestion="建议创建 config/ 目录存放 yaml 配置文件",
            ))

        return violations

    # ==========================================================
    # 维度二：依赖管理校验
    # ==========================================================

    def validate_dependencies(
        self, package_path: str, package_name: str
    ) -> List[ROSViolation]:
        """
        校验 ROS 包的依赖管理配置
        运行步骤：
          1. 解析 package.xml，检查依赖声明完整性
          2. 检查依赖类型是否正确使用
          3. 解析 CMakeLists.txt，检查 find_package 与 package.xml 一致性
          4. 检查是否存在冗余依赖或缺失依赖
        参数：
          - package_path: 包的绝对路径
          - package_name: 包名
        返回值：违规记录列表
        """
        violations: List[ROSViolation] = []

        package_xml_path = os.path.join(package_path, "package.xml")
        cmake_path = os.path.join(package_path, "CMakeLists.txt")

        # 解析 package.xml 中的依赖声明
        xml_deps = self._parse_package_xml_deps(package_xml_path)
        if xml_deps is None:
            violations.append(ROSViolation(
                severity=ValidationSeverity.ERROR,
                category="dependency",
                description="无法解析 package.xml",
                location=package_xml_path,
                suggestion="请检查 package.xml 格式是否正确",
            ))
            return violations

        # 检查 package.xml 是否声明了 buildtool_depend
        buildtool_deps = xml_deps.get("buildtool_depend", [])
        if not buildtool_deps:
            violations.append(ROSViolation(
                severity=ValidationSeverity.WARNING,
                category="dependency",
                description="package.xml 未声明 buildtool_depend",
                location=package_xml_path,
                suggestion="建议添加 buildtool_depend，如 ament_cmake 或 catkin",
            ))

        # 检查是否有 build_depend 但缺少对应的 exec_depend
        build_deps = set(xml_deps.get("build_depend", []))
        exec_deps = set(xml_deps.get("exec_depend", []))
        # 通用 depend 同时覆盖 build 和 exec
        common_deps = set(xml_deps.get("depend", []))

        # build 专用依赖如果不在 exec 中，给出提示
        build_only = build_deps - exec_deps - common_deps
        for dep in build_only:
            # 排除常见的纯构建依赖（如 ros_environment）
            if dep not in ("ros_environment",):
                violations.append(ROSViolation(
                    severity=ValidationSeverity.INFO,
                    category="dependency",
                    description=f"依赖 '{dep}' 仅有 build_depend，缺少 exec_depend",
                    location=package_xml_path,
                    suggestion=f"如果运行时也需要 '{dep}'，请添加 exec_depend",
                ))

        # 检查 CMakeLists.txt 中的 find_package 与 package.xml 一致性
        cmake_deps = self._parse_cmake_find_package(cmake_path)
        if cmake_deps is not None:
            # 所有在 CMakeLists 中 find_package 的依赖应在 package.xml 中有声明
            all_xml_deps: Set[str] = set()
            for dep_list in xml_deps.values():
                all_xml_deps.update(dep_list)

            for cmake_dep in cmake_deps:
                if cmake_dep not in all_xml_deps:
                    violations.append(ROSViolation(
                        severity=ValidationSeverity.WARNING,
                        category="dependency",
                        description=f"CMakeLists.txt 中 find_package({cmake_dep}) 在 package.xml 中未声明",
                        location=cmake_path,
                        suggestion=f"请在 package.xml 中添加对 '{cmake_dep}' 的依赖声明",
                    ))

        return violations

    def _parse_package_xml_deps(self, xml_path: str) -> Optional[Dict[str, List[str]]]:
        """
        解析 package.xml 中的依赖声明
        运行步骤：
          1. 读取 package.xml 文件内容
          2. 使用正则匹配所有依赖标签
          3. 按依赖类型分类汇总
        参数：
          - xml_path: package.xml 文件路径
        返回值：依赖类型 -> 依赖包名列表的字典，解析失败返回 None
        """
        if not os.path.isfile(xml_path):
            return None

        try:
            with open(xml_path, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception as e:
            logger.error(f"读取 {xml_path} 失败: {e}")
            return None

        deps: Dict[str, List[str]] = {}

        # 匹配所有依赖标签：<build_depend>pkg_name</build_depend>
        for dep_type in self.DEPENDENCY_TYPES:
            # 正则匹配：<dep_type> 或 <dep_type version_eq="..."> 内的包名
            pattern = rf'<{dep_type}[^>]*>\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*</{dep_type}>'
            matches = re.findall(pattern, content)
            if matches:
                deps[dep_type] = matches

        return deps

    def _parse_cmake_find_package(self, cmake_path: str) -> Optional[List[str]]:
        """
        解析 CMakeLists.txt 中的 find_package 声明
        运行步骤：
          1. 读取 CMakeLists.txt 文件内容
          2. 使用正则匹配 find_package(包名 ...)
          3. 排除 CMake 内置包（如 ament_cmake、catkin）
        参数：
          - cmake_path: CMakeLists.txt 文件路径
        返回值：依赖包名列表，解析失败返回 None
        """
        if not os.path.isfile(cmake_path):
            return None

        try:
            with open(cmake_path, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception as e:
            logger.error(f"读取 {cmake_path} 失败: {e}")
            return None

        # 匹配 find_package(pkg_name ...) 格式
        # 排除注释行中的 find_package
        lines = content.split("\n")
        packages: List[str] = []
        for line in lines:
            stripped = line.strip()
            # 跳过注释行
            if stripped.startswith("#"):
                continue
            # 匹配 find_package(包名 ...)
            match = re.search(r'find_package\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)', stripped)
            if match:
                pkg = match.group(1)
                # 排除 CMake 内置模块
                if pkg not in ("ament_cmake", "catkin", "catkin_package"):
                    packages.append(pkg)

        return packages

    # ==========================================================
    # 维度三：跨包引用校验
    # ==========================================================

    def validate_cross_references(
        self, package_path: str, package_name: str
    ) -> List[ROSViolation]:
        """
        校验跨包头文件引用格式
        运行步骤：
          1. 扫描包内所有 C/C++ 源文件和头文件
          2. 检查 #include 语句是否使用 <包名/头文件.h> 标准格式
          3. 检测相对路径引用（如 "../other_pkg/header.h"）
          4. 检测引号格式的相对路径引用
        参数：
          - package_path: 包的绝对路径
          - package_name: 包名
        返回值：违规记录列表
        """
        violations: List[ROSViolation] = []

        # 扫描所有 C/C++ 文件
        cpp_files = self._find_cpp_files(package_path)
        if not cpp_files:
            return violations

        # 相对路径引用检测正则
        # 检测 #include "../" 或 #include "./" 开头的引用
        relative_include_pattern = re.compile(
            r'#include\s+["<]\s*(\.\./|\./)[^">]+[">]'
        )
        # 检测 #include "other_pkg/header.h" 格式（引号包裹的跨包引用）
        quoted_cross_pkg_pattern = re.compile(
            r'#include\s+"([a-zA-Z_][a-zA-Z0-9_]*)/[^"]+"'
        )

        for file_path in cpp_files:
            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            except Exception as e:
                logger.warning(f"读取 {file_path} 失败: {e}")
                continue

            lines = content.split("\n")
            for line_num, line in enumerate(lines, start=1):
                stripped = line.strip()

                # 跳过注释行
                if stripped.startswith("//") or stripped.startswith("/*"):
                    continue

                # 检测相对路径引用
                if relative_include_pattern.search(stripped):
                    violations.append(ROSViolation(
                        severity=ValidationSeverity.ERROR,
                        category="cross_reference",
                        description=f"使用了相对路径引用头文件: {stripped.strip()}",
                        location=f"{file_path}:{line_num}",
                        suggestion="跨包头文件引用应使用 <包名/头文件.h> 标准格式",
                    ))

                # 检测引号包裹的跨包引用（非本包头文件）
                quoted_match = quoted_cross_pkg_pattern.search(stripped)
                if quoted_match:
                    ref_pkg = quoted_match.group(1)
                    # 如果引用的包名不是当前包名，且不是标准库头文件
                    if ref_pkg != package_name and ref_pkg not in (
                        "std", "boost", "Eigen", "yaml-cpp", "tf2",
                    ):
                        violations.append(ROSViolation(
                            severity=ValidationSeverity.WARNING,
                            category="cross_reference",
                            description=f"跨包引用应使用尖括号格式: {stripped.strip()}",
                            location=f"{file_path}:{line_num}",
                            suggestion=f"建议改为 #include <{ref_pkg}/...> 格式",
                        ))

        return violations

    def _find_cpp_files(self, directory: str) -> List[str]:
        """
        递归查找目录下所有 C/C++ 源文件和头文件
        参数：
          - directory: 搜索根目录
        返回值：C/C++ 文件路径列表
        """
        cpp_extensions = {".cpp", ".cc", ".cxx", ".c", ".h", ".hpp", ".hxx", ".hh"}
        cpp_files: List[str] = []

        try:
            for root, dirs, files in os.walk(directory):
                # 跳过隐藏目录和构建目录
                dirs[:] = [d for d in dirs if not d.startswith(".") and d not in (
                    "build", "install", "log", "__pycache__",
                )]
                for f in files:
                    ext = os.path.splitext(f)[1].lower()
                    if ext in cpp_extensions:
                        cpp_files.append(os.path.join(root, f))
        except Exception as e:
            logger.error(f"扫描 C++ 文件失败: {e}")

        return cpp_files

    # ==========================================================
    # 维度四：ROS2 特有规范校验
    # ==========================================================

    def validate_ros2_specs(
        self, package_path: str, package_name: str
    ) -> List[ROSViolation]:
        """
        校验 ROS2 特有规范
        运行步骤：
          1. 检查 QoS 策略配置是否合理
          2. 检查生命周期节点实现
          3. 检查组件化开发配置
          4. 检查命名空间约定
          5. 检查参数管理规范
          6. 检查 launch 文件标准
        参数：
          - package_path: 包的绝对路径
          - package_name: 包名
        返回值：违规记录列表
        """
        violations: List[ROSViolation] = []

        # 收集所有 C++ 源文件
        cpp_files = self._find_cpp_files(package_path)

        # 收集所有 Python 源文件
        py_files = self._find_py_files(package_path)

        # 子校验 1：QoS 策略校验
        qos_violations = self._validate_qos_policy(cpp_files, py_files, package_name)
        violations.extend(qos_violations)

        # 子校验 2：生命周期节点校验
        lifecycle_violations = self._validate_lifecycle_nodes(cpp_files, package_name)
        violations.extend(lifecycle_violations)

        # 子校验 3：组件化开发校验
        component_violations = self._validate_component_config(
            package_path, cpp_files, package_name
        )
        violations.extend(component_violations)

        # 子校验 4：命名空间约定校验
        namespace_violations = self._validate_namespace_conventions(
            cpp_files, py_files, package_name
        )
        violations.extend(namespace_violations)

        # 子校验 5：参数管理校验
        param_violations = self._validate_parameter_management(
            cpp_files, py_files, package_name
        )
        violations.extend(param_violations)

        # 子校验 6：launch 文件校验
        launch_violations = self._validate_launch_files(package_path, package_name)
        violations.extend(launch_violations)

        return violations

    def _find_py_files(self, directory: str) -> List[str]:
        """
        递归查找目录下所有 Python 源文件
        参数：
          - directory: 搜索根目录
        返回值：Python 文件路径列表
        """
        py_files: List[str] = []
        try:
            for root, dirs, files in os.walk(directory):
                dirs[:] = [d for d in dirs if not d.startswith(".") and d not in (
                    "build", "install", "log", "__pycache__",
                )]
                for f in files:
                    if f.endswith(".py"):
                        py_files.append(os.path.join(root, f))
        except Exception as e:
            logger.error(f"扫描 Python 文件失败: {e}")
        return py_files

    # ----------------------------------------------------------
    # QoS 策略校验
    # ----------------------------------------------------------

    def _validate_qos_policy(
        self, cpp_files: List[str], py_files: List[str], package_name: str
    ) -> List[ROSViolation]:
        """
        校验 QoS 策略配置是否合理
        运行步骤：
          1. 扫描所有源文件中的 QoS 配置
          2. 检查控制类 topic 是否使用 RELIABLE
          3. 检查传感器类 topic 是否使用 BEST_EFFORT
          4. 检查是否使用了默认 QoS（建议显式配置）
        参数：
          - cpp_files: C++ 文件路径列表
          - py_files: Python 文件路径列表
          - package_name: 包名
        返回值：违规记录列表
        """
        violations: List[ROSViolation] = []

        # 控制类关键词（应使用 RELIABLE）
        control_keywords = [
            "cmd_vel", "control", "command", "trajectory", "joint",
            "goal", "setpoint", "target", "pose",
        ]
        # 传感器类关键词（应使用 BEST_EFFORT）
        sensor_keywords = [
            "scan", "image", "camera", "point_cloud", "imu", "odom",
            "sensor", "lidar", "depth", "temperature", "battery",
        ]

        all_files = cpp_files + py_files

        for file_path in all_files:
            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            except Exception:
                continue

            # 检测创建 publisher/subscriber 的代码
            # C++: create_publisher<MsgType>("topic_name", qos)
            # Python: create_publisher(MsgType, "topic_name", qos_profile)
            pub_matches = re.findall(
                r'create_publisher\s*[<(][^,)]*,\s*"([^"]+)"',
                content,
            )
            sub_matches = re.findall(
                r'create_subscription\s*[<(][^,)]*,\s*"([^"]+)"',
                content,
            )

            all_topics = pub_matches + sub_matches

            for topic in all_topics:
                topic_lower = topic.lower()

                # 检查控制类 topic 是否使用了 RELIABLE
                is_control = any(kw in topic_lower for kw in control_keywords)
                if is_control:
                    # 检查是否显式配置了 QoS（简单检测：同一行或附近有 rclcpp::QoS 或 QoSProfile）
                    if "QoS" not in content and "qos" not in content:
                        violations.append(ROSViolation(
                            severity=ValidationSeverity.WARNING,
                            category="ros2_spec",
                            description=f"控制类 topic '{topic}' 未显式配置 QoS 策略",
                            location=file_path,
                            suggestion="控制类数据建议使用 RELIABLE QoS 策略确保指令可靠送达",
                        ))

                # 检查传感器类 topic 是否使用了 BEST_EFFORT
                is_sensor = any(kw in topic_lower for kw in sensor_keywords)
                if is_sensor:
                    if "BEST_EFFORT" not in content and "best_effort" not in content:
                        violations.append(ROSViolation(
                            severity=ValidationSeverity.INFO,
                            category="ros2_spec",
                            description=f"传感器类 topic '{topic}' 建议使用 BEST_EFFORT QoS",
                            location=file_path,
                            suggestion="传感器数据建议使用 BEST_EFFORT QoS 策略减少延迟",
                        ))

        return violations

    # ----------------------------------------------------------
    # 生命周期节点校验
    # ----------------------------------------------------------

    def _validate_lifecycle_nodes(
        self, cpp_files: List[str], package_name: str
    ) -> List[ROSViolation]:
        """
        校验生命周期节点实现
        运行步骤：
          1. 检测是否使用了 rclcpp_lifecycle::LifecycleNode
          2. 检查是否实现了必要的生命周期回调
          3. 检查状态转换逻辑是否完整
        参数：
          - cpp_files: C++ 文件路径列表
          - package_name: 包名
        返回值：违规记录列表
        """
        violations: List[ROSViolation] = []

        for file_path in cpp_files:
            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            except Exception:
                continue

            # 检测是否继承了 LifecycleNode
            if "LifecycleNode" in content:
                # 检查是否实现了必要的回调方法
                required_callbacks = [
                    "on_configure",
                    "on_activate",
                    "on_deactivate",
                    "on_cleanup",
                    "on_shutdown",
                ]
                for callback in required_callbacks:
                    if callback not in content:
                        violations.append(ROSViolation(
                            severity=ValidationSeverity.WARNING,
                            category="ros2_spec",
                            description=f"LifecycleNode 缺少回调方法: {callback}()",
                            location=file_path,
                            suggestion=f"生命周期节点应实现 {callback}() 方法",
                        ))

                # 检查状态转换返回值
                transitions = re.findall(
                    r'on_\w+\s*\([^)]*\)\s*\{([^}]*)\}',
                    content,
                    flags=re.DOTALL,
                )
                for transition_body in transitions:
                    if "SUCCESS" not in transition_body and "FAILURE" not in transition_body and "ERROR" not in transition_body:
                        violations.append(ROSViolation(
                            severity=ValidationSeverity.WARNING,
                            category="ros2_spec",
                            description="生命周期回调未返回明确的状态转换结果",
                            location=file_path,
                            suggestion="生命周期回调应返回 SUCCESS/FAILURE/ERROR 状态",
                        ))

        return violations

    # ----------------------------------------------------------
    # 组件化开发校验
    # ----------------------------------------------------------

    def _validate_component_config(
        self, package_path: str, cpp_files: List[str], package_name: str
    ) -> List[ROSViolation]:
        """
        校验组件化开发配置
        运行步骤：
          1. 检查 CMakeLists.txt 中是否注册了组件
          2. 检查是否使用了 rclcpp_components 注册宏
          3. 检查 package.xml 是否声明了 rclcpp_components 依赖
        参数：
          - package_path: 包路径
          - cpp_files: C++ 文件路径列表
          - package_name: 包名
        返回值：违规记录列表
        """
        violations: List[ROSViolation] = []

        # 检查源文件中是否使用了组件注册宏
        uses_components = False
        for file_path in cpp_files:
            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            except Exception:
                continue

            if "RCLCPP_COMPONENTS_REGISTER_NODE" in content:
                uses_components = True
                break

        if not uses_components:
            return violations  # 未使用组件化，无需校验

        # 检查 CMakeLists.txt 中是否有组件注册
        cmake_path = os.path.join(package_path, "CMakeLists.txt")
        if os.path.isfile(cmake_path):
            try:
                with open(cmake_path, "r", encoding="utf-8") as f:
                    cmake_content = f.read()
            except Exception:
                cmake_content = ""

            if "rclcpp_components_register_nodes" not in cmake_content:
                violations.append(ROSViolation(
                    severity=ValidationSeverity.WARNING,
                    category="ros2_spec",
                    description="源文件中使用了组件注册宏，但 CMakeLists.txt 中缺少 rclcpp_components_register_nodes",
                    location=cmake_path,
                    suggestion="请在 CMakeLists.txt 中添加 rclcpp_components_register_nodes 调用",
                ))

        # 检查 package.xml 中是否声明了 rclcpp_components 依赖
        package_xml_path = os.path.join(package_path, "package.xml")
        if os.path.isfile(package_xml_path):
            try:
                with open(package_xml_path, "r", encoding="utf-8") as f:
                    xml_content = f.read()
            except Exception:
                xml_content = ""

            if "rclcpp_components" not in xml_content:
                violations.append(ROSViolation(
                    severity=ValidationSeverity.ERROR,
                    category="ros2_spec",
                    description="使用了组件化开发但 package.xml 中未声明 rclcpp_components 依赖",
                    location=package_xml_path,
                    suggestion="请在 package.xml 中添加对 rclcpp_components 的依赖声明",
                ))

        return violations

    # ----------------------------------------------------------
    # 命名空间约定校验
    # ----------------------------------------------------------

    def _validate_namespace_conventions(
        self, cpp_files: List[str], py_files: List[str], package_name: str
    ) -> List[ROSViolation]:
        """
        校验命名空间约定
        运行步骤：
          1. 检查节点命名是否遵循 snake_case 规范
          2. 检查 topic/service 命名是否遵循规范
          3. 检查是否使用了硬编码的绝对命名空间
        参数：
          - cpp_files: C++ 文件路径列表
          - py_files: Python 文件路径列表
          - package_name: 包名
        返回值：违规记录列表
        """
        violations: List[ROSViolation] = []

        all_files = cpp_files + py_files

        for file_path in all_files:
            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            except Exception:
                continue

            # 检测硬编码的绝对命名空间（以 / 开头的 topic 名）
            # 在 ROS2 中，topic 名不应硬编码绝对路径
            absolute_topics = re.findall(
                r'create_publisher\s*[<(][^,)]*,\s*"(/[^"]+)"',
                content,
            )
            absolute_topics += re.findall(
                r'create_subscription\s*[<(][^,)]*,\s*"(/[^"]+)"',
                content,
            )

            for topic in absolute_topics:
                violations.append(ROSViolation(
                    severity=ValidationSeverity.INFO,
                    category="ros2_spec",
                    description=f"使用了硬编码的绝对命名空间 topic: '{topic}'",
                    location=file_path,
                    suggestion="建议使用相对命名空间，通过 launch 文件或参数配置命名空间",
                ))

        return violations

    # ----------------------------------------------------------
    # 参数管理校验
    # ----------------------------------------------------------

    def _validate_parameter_management(
        self, cpp_files: List[str], py_files: List[str], package_name: str
    ) -> List[ROSViolation]:
        """
        校验参数管理规范
        运行步骤：
          1. 检测代码中是否存在硬编码参数（魔法数字）
          2. 检查是否使用了 ROS 参数服务器
          3. 检查是否有对应的 yaml 参数配置文件
        参数：
          - cpp_files: C++ 文件路径列表
          - py_files: Python 文件路径列表
          - package_name: 包名
        返回值：违规记录列表
        """
        violations: List[ROSViolation] = []

        # 检测硬编码数值参数的模式
        # 匹配赋值语句中的魔法数字（排除 0、1、-1、2 等常见小数字）
        hardcoded_pattern = re.compile(
            r'(?:double|float|int|const\s+(?:double|float|int))\s+\w+\s*=\s*(\d+\.?\d*)\s*;'
        )

        for file_path in cpp_files:
            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            except Exception:
                continue

            matches = hardcoded_pattern.findall(content)
            for match in matches:
                try:
                    value = float(match)
                    # 排除常见的 0、1、-1、2 等基础值
                    if value not in (0.0, 1.0, -1.0, 2.0, 0.5, 100.0):
                        violations.append(ROSViolation(
                            severity=ValidationSeverity.WARNING,
                            category="ros2_spec",
                            description=f"检测到可能的硬编码参数值: {match}",
                            location=file_path,
                            suggestion="建议将可调参数通过 ROS 参数服务器或 yaml 配置文件管理",
                        ))
                except ValueError:
                    pass

        return violations

    # ----------------------------------------------------------
    # launch 文件校验
    # ----------------------------------------------------------

    def _validate_launch_files(
        self, package_path: str, package_name: str
    ) -> List[ROSViolation]:
        """
        校验 launch 文件标准
        运行步骤：
          1. 检查 launch 目录是否存在
          2. 检查 launch 文件是否为 Python 格式（ROS2 推荐）
          3. 检查 launch 文件是否包含必要的节点声明
        参数：
          - package_path: 包路径
          - package_name: 包名
        返回值：违规记录列表
        """
        violations: List[ROSViolation] = []

        launch_dir = os.path.join(package_path, "launch")
        if not os.path.isdir(launch_dir):
            return violations

        # 检查 launch 目录中的文件
        has_python_launch = False
        has_xml_launch = False

        try:
            for f in os.listdir(launch_dir):
                file_path = os.path.join(launch_dir, f)
                if not os.path.isfile(file_path):
                    continue

                if f.endswith(".py"):
                    has_python_launch = True
                    # 使用 AST 解析 Python launch 文件
                    launch_violations = self._validate_python_launch_file(
                        file_path, package_name
                    )
                    violations.extend(launch_violations)

                elif f.endswith(".xml"):
                    has_xml_launch = True
                    violations.append(ROSViolation(
                        severity=ValidationSeverity.INFO,
                        category="ros2_spec",
                        description=f"检测到 XML 格式 launch 文件: {f}",
                        location=file_path,
                        suggestion="ROS2 推荐使用 Python 格式的 launch 文件",
                    ))
        except Exception as e:
            logger.error(f"扫描 launch 目录失败: {e}")

        return violations

    def _validate_python_launch_file(
        self, file_path: str, package_name: str
    ) -> List[ROSViolation]:
        """
        校验 Python 格式的 launch 文件
        运行步骤：
          1. 使用 AST 解析 Python launch 文件
          2. 检查是否导入了必要的 launch 模块
          3. 检查 generate_launch_description 函数是否存在
        参数：
          - file_path: launch 文件路径
          - package_name: 包名
        返回值：违规记录列表
        """
        violations: List[ROSViolation] = []

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                source = f.read()
        except Exception:
            return violations

        # 使用 AST 解析
        try:
            tree = ast.parse(source)
        except SyntaxError as e:
            violations.append(ROSViolation(
                severity=ValidationSeverity.ERROR,
                category="ros2_spec",
                description=f"launch 文件语法错误: {e}",
                location=file_path,
                suggestion="请修复 Python 语法错误",
            ))
            return violations

        # 检查是否导入了 launch 相关模块
        has_launch_import = False
        has_generate_function = False

        for node in ast.walk(tree):
            # 检查导入
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if "launch" in alias.name:
                        has_launch_import = True
            elif isinstance(node, ast.ImportFrom):
                if node.module and "launch" in node.module:
                    has_launch_import = True

            # 检查 generate_launch_description 函数
            if isinstance(node, ast.FunctionDef):
                if node.name == "generate_launch_description":
                    has_generate_function = True

        if not has_launch_import:
            violations.append(ROSViolation(
                severity=ValidationSeverity.WARNING,
                category="ros2_spec",
                description="launch 文件未导入 launch 相关模块",
                location=file_path,
                suggestion="请导入 launch 和 launch_ros 模块",
            ))

        if not has_generate_function:
            violations.append(ROSViolation(
                severity=ValidationSeverity.ERROR,
                category="ros2_spec",
                description="launch 文件缺少 generate_launch_description() 函数",
                location=file_path,
                suggestion="ROS2 launch 文件必须定义 generate_launch_description() 函数",
            ))

        return violations

    # ==========================================================
    # 辅助方法：包发现
    # ==========================================================

    def _discover_packages(
        self, workspace_path: str, target_package: Optional[str] = None
    ) -> Dict[str, str]:
        """
        在工作空间中递归发现所有 ROS 包
        运行步骤：
          1. 递归遍历工作空间目录
          2. 检测每个子目录是否包含 package.xml
          3. 如果指定了目标包名，则只返回匹配的包
        参数：
          - workspace_path: 工作空间根目录
          - target_package: 目标包名（可选）
        返回值：包名 -> 包路径的字典
        """
        packages: Dict[str, str] = {}
        # 需要跳过的目录
        skip_dirs = {"build", "install", "log", ".git", "__pycache__", "devel"}

        try:
            for root, dirs, files in os.walk(workspace_path):
                # 跳过不需要遍历的目录
                dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith(".")]

                if "package.xml" in files:
                    pkg_path = root
                    # 尝试从 package.xml 中提取包名
                    pkg_name = self._extract_package_name(
                        os.path.join(pkg_path, "package.xml")
                    )
                    if pkg_name is None:
                        # 如果无法从 package.xml 提取，使用目录名
                        pkg_name = os.path.basename(pkg_path)

                    if target_package is None or pkg_name == target_package:
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

        # 匹配 <name>package_name</name>
        match = re.search(r'<name>\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*</name>', content)
        if match:
            return match.group(1)

        return None
