"""
# ============================================================
# 后端核心服务 - 交付物结构管理服务
# ============================================================
# 核心作用：自动生成符合标准化目录结构的项目交付物框架，
#           支持 ROS 全栈项目、纯算法项目、单功能代码片段三种交付模式，
#           提供交付物完整性自动校验和 README/CHANGELOG 模板生成功能
# 运行流程：
#   1. 接收项目类型、名称、版本、基础路径等参数
#   2. 根据项目类型选择对应的目录结构模板
#   3. 在目标路径下创建完整的目录树和模板文件
#   4. 可选执行交付物完整性校验，报告缺失项
#   5. 返回创建结果（成功/失败 + 详情）
# 输入参数：
#   - project_name: str，项目名称
#   - version: str，项目版本号（如 "1.0.0"）
#   - base_path: str，交付物根目录路径
#   - project_type: str，项目类型（"ros" / "algorithm" / "single_function"）
#   - description: str，项目描述（用于生成 README）
# 输出结果：
#   - DeliveryResult 对象，包含创建状态、路径列表、缺失项报告
# 修改记录：
#   - 2026-06-24 | v1.0.0 | 初始版本，实现 ROS 全栈项目、纯算法项目、
#     单功能代码片段三种交付结构生成、完整性校验、README/CHANGELOG 模板生成
# ============================================================
"""

import os
import logging
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 枚举与数据结构定义
# ============================================================

@dataclass
class DeliveryResult:
    """
    交付物创建结果
    字段说明：
      - success: 是否创建成功
      - project_name: 项目名称
      - project_type: 项目类型（ros / algorithm / single_function）
      - base_path: 交付物根目录的绝对路径
      - created_paths: 成功创建的所有文件/目录路径列表
      - failed_paths: 创建失败的文件/目录路径列表
      - missing_items: 完整性校验发现的缺失项列表
      - error_message: 错误信息（成功时为空字符串）
    """
    success: bool = False
    project_name: str = ""
    project_type: str = ""
    base_path: str = ""
    created_paths: List[str] = field(default_factory=list)
    failed_paths: List[str] = field(default_factory=list)
    missing_items: List[str] = field(default_factory=list)
    error_message: str = ""


# ============================================================
# 交付物结构管理器主类
# ============================================================

class DeliveryStructureManager:
    """
    交付物结构管理器
    作用：自动生成标准化项目交付物目录结构，校验交付物完整性，
          生成 README.md 和 CHANGELOG.md 模板
    调用方：调度引擎（scheduler）、交付归档角色
    被调用方：无（独立服务模块）
    """

    # ============================================================
    # 类常量：ROS 全栈项目标准目录结构定义
    # ============================================================
    # 每个元素为 (相对路径, 是否为文件) 的元组
    # 文件路径用 True 标记，目录路径用 False 标记
    ROS_PROJECT_STRUCTURE: List[Tuple[str, bool]] = [
        # 根目录模板文件
        ("CHANGELOG.md", True),
        ("README.md", True),
        ("requirements.txt", True),
        ("rosdep.yaml", True),
        ("LICENSE", True),
        # src 目录（核心代码与 ROS 包源码）
        ("src/", False),
        # docs 目录（完整项目文档，11 份标准文档）
        ("docs/", False),
        ("docs/01-需求文档.md", True),
        ("docs/02-系统架构设计.md", True),
        ("docs/03-接口说明文档.md", True),
        ("docs/04-编译运行手册.md", True),
        ("docs/05-仿真环境说明.md", True),
        ("docs/06-核心参数调优指南.md", True),
        ("docs/07-测试报告.md", True),
        ("docs/08-系统评测报告.md", True),
        ("docs/09-安全审核记录.md", True),
        ("docs/10-故障排查与常见问题.md", True),
        ("docs/11-真机适配指南.md", True),
        # simulation 目录（仿真环境文件）
        ("simulation/", False),
        # scripts 目录（辅助脚本）
        ("scripts/", False),
        # config 目录（全局参数配置文件）
        ("config/", False),
        # test 目录（单元/集成/仿真测试脚本）
        ("test/", False),
    ]

    # ============================================================
    # 类常量：纯算法项目标准目录结构定义
    # ============================================================
    ALGORITHM_PROJECT_STRUCTURE: List[Tuple[str, bool]] = [
        # 根目录模板文件
        ("CHANGELOG.md", True),
        ("README.md", True),
        ("requirements.txt", True),
        ("CMakeLists.txt", True),
        ("LICENSE", True),
        # include 目录（C++ 头文件）
        ("include/", False),
        # src 目录（核心算法源码）
        ("src/", False),
        # docs 目录（算法文档、接口文档、编译指南、调优指南、测试报告）
        ("docs/", False),
        ("docs/01-算法设计文档.md", True),
        ("docs/02-接口说明文档.md", True),
        ("docs/03-编译运行手册.md", True),
        ("docs/04-参数调优指南.md", True),
        ("docs/05-测试报告.md", True),
        # scripts 目录（Python 原型脚本、辅助工具、测试脚本）
        ("scripts/", False),
        # config 目录（算法参数配置文件）
        ("config/", False),
        # test 目录（单元/性能测试脚本与报告）
        ("test/", False),
        # examples 目录（使用示例、演示代码）
        ("examples/", False),
    ]

    # ============================================================
    # 类常量：ROS 项目 docs 目录下所有必需文档文件名列表
    # ============================================================
    ROS_REQUIRED_DOCS: List[str] = [
        "01-需求文档.md",
        "02-系统架构设计.md",
        "03-接口说明文档.md",
        "04-编译运行手册.md",
        "05-仿真环境说明.md",
        "06-核心参数调优指南.md",
        "07-测试报告.md",
        "08-系统评测报告.md",
        "09-安全审核记录.md",
        "10-故障排查与常见问题.md",
        "11-真机适配指南.md",
    ]

    # ============================================================
    # 类常量：算法项目 docs 目录下所有必需文档文件名列表
    # ============================================================
    ALGORITHM_REQUIRED_DOCS: List[str] = [
        "01-算法设计文档.md",
        "02-接口说明文档.md",
        "03-编译运行手册.md",
        "04-参数调优指南.md",
        "05-测试报告.md",
    ]

    # ============================================================
    # 类常量：ROS 项目根目录必需文件列表
    # ============================================================
    ROS_REQUIRED_ROOT_FILES: List[str] = [
        "CHANGELOG.md",
        "README.md",
        "requirements.txt",
        "rosdep.yaml",
        "LICENSE",
    ]

    # ============================================================
    # 类常量：算法项目根目录必需文件列表
    # ============================================================
    ALGORITHM_REQUIRED_ROOT_FILES: List[str] = [
        "CHANGELOG.md",
        "README.md",
        "requirements.txt",
        "CMakeLists.txt",
        "LICENSE",
    ]

    # ============================================================
    # 类常量：ROS 项目必需子目录列表
    # ============================================================
    ROS_REQUIRED_DIRS: List[str] = [
        "src",
        "docs",
        "simulation",
        "scripts",
        "config",
        "test",
    ]

    # ============================================================
    # 类常量：算法项目必需子目录列表
    # ============================================================
    ALGORITHM_REQUIRED_DIRS: List[str] = [
        "include",
        "src",
        "docs",
        "scripts",
        "config",
        "test",
        "examples",
    ]

    def __init__(self):
        """
        初始化交付物结构管理器
        运行步骤：
          1. 初始化日志记录器
          2. 无额外配置依赖（纯本地操作）
        """
        logger.info("交付物结构管理器初始化完成")

    # ============================================================
    # 核心方法 1：生成 ROS 全栈项目标准目录结构
    # ============================================================

    def generate_ros_project_structure(
        self,
        project_name: str,
        version: str,
        base_path: str,
    ) -> DeliveryResult:
        """
        生成 ROS 全栈项目标准目录结构
        运行步骤：
          1. 校验输入参数（项目名称、版本号、基础路径）
          2. 构建项目根目录路径：{base_path}/robot_project_v{version}
          3. 遍历 ROS_PROJECT_STRUCTURE 模板，创建所有目录和文件
          4. 生成 README.md 和 CHANGELOG.md 模板内容
          5. 生成 rosdep.yaml 和 requirements.txt 模板内容
          6. 返回创建结果
        参数：
          - project_name: 项目名称（如 "robot_navigation"）
          - version: 项目版本号（如 "1.0.0"）
          - base_path: 交付物根目录的绝对路径
        返回值：DeliveryResult 对象，包含创建状态和路径列表
        """
        result = DeliveryResult(
            project_name=project_name,
            project_type="ros",
        )

        # 步骤 1：输入参数校验
        if not project_name or not project_name.strip():
            result.error_message = "项目名称不能为空"
            logger.error(result.error_message)
            return result

        if not version or not version.strip():
            result.error_message = "版本号不能为空"
            logger.error(result.error_message)
            return result

        if not base_path or not base_path.strip():
            result.error_message = "基础路径不能为空"
            logger.error(result.error_message)
            return result

        # 步骤 2：构建项目根目录路径
        project_dir_name = f"robot_project_v{version}"
        project_root = os.path.join(base_path, project_dir_name)
        result.base_path = project_root

        logger.info(
            "开始生成 ROS 项目结构: project=%s, version=%s, path=%s",
            project_name, version, project_root,
        )

        # 步骤 3：遍历模板创建目录和文件
        created_paths: List[str] = []
        failed_paths: List[str] = []

        for rel_path, is_file in self.ROS_PROJECT_STRUCTURE:
            abs_path = os.path.join(project_root, rel_path)
            try:
                if is_file:
                    # 创建文件（含父目录）
                    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
                    # 根据文件类型写入对应的模板内容
                    content = self._get_ros_file_content(
                        rel_path, project_name, version
                    )
                    with open(abs_path, "w", encoding="utf-8") as f:
                        f.write(content)
                else:
                    # 创建目录
                    os.makedirs(abs_path, exist_ok=True)
                created_paths.append(abs_path)
                logger.debug("创建成功: %s", abs_path)
            except OSError as e:
                failed_paths.append(abs_path)
                logger.error("创建失败: %s | 错误: %s", abs_path, e)

        result.created_paths = created_paths
        result.failed_paths = failed_paths
        result.success = len(failed_paths) == 0

        if result.success:
            logger.info(
                "ROS 项目结构生成完成: 共创建 %d 个路径",
                len(created_paths),
            )
        else:
            result.error_message = (
                f"部分路径创建失败: {len(failed_paths)} 个失败"
            )
            logger.warning(result.error_message)

        return result

    # ============================================================
    # 核心方法 2：生成纯算法项目标准目录结构
    # ============================================================

    def generate_algorithm_project_structure(
        self,
        project_name: str,
        version: str,
        base_path: str,
    ) -> DeliveryResult:
        """
        生成纯算法项目标准目录结构
        运行步骤：
          1. 校验输入参数（项目名称、版本号、基础路径）
          2. 构建项目根目录路径：{base_path}/algorithm_project_v{version}
          3. 遍历 ALGORITHM_PROJECT_STRUCTURE 模板，创建所有目录和文件
          4. 生成 README.md、CHANGELOG.md、CMakeLists.txt 模板内容
          5. 返回创建结果
        参数：
          - project_name: 项目名称（如 "path_planning"）
          - version: 项目版本号（如 "1.0.0"）
          - base_path: 交付物根目录的绝对路径
        返回值：DeliveryResult 对象，包含创建状态和路径列表
        """
        result = DeliveryResult(
            project_name=project_name,
            project_type="algorithm",
        )

        # 步骤 1：输入参数校验
        if not project_name or not project_name.strip():
            result.error_message = "项目名称不能为空"
            logger.error(result.error_message)
            return result

        if not version or not version.strip():
            result.error_message = "版本号不能为空"
            logger.error(result.error_message)
            return result

        if not base_path or not base_path.strip():
            result.error_message = "基础路径不能为空"
            logger.error(result.error_message)
            return result

        # 步骤 2：构建项目根目录路径
        project_dir_name = f"algorithm_project_v{version}"
        project_root = os.path.join(base_path, project_dir_name)
        result.base_path = project_root

        logger.info(
            "开始生成算法项目结构: project=%s, version=%s, path=%s",
            project_name, version, project_root,
        )

        # 步骤 3：遍历模板创建目录和文件
        created_paths: List[str] = []
        failed_paths: List[str] = []

        for rel_path, is_file in self.ALGORITHM_PROJECT_STRUCTURE:
            abs_path = os.path.join(project_root, rel_path)
            try:
                if is_file:
                    # 创建文件（含父目录）
                    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
                    # 根据文件类型写入对应的模板内容
                    content = self._get_algorithm_file_content(
                        rel_path, project_name, version
                    )
                    with open(abs_path, "w", encoding="utf-8") as f:
                        f.write(content)
                else:
                    # 创建目录
                    os.makedirs(abs_path, exist_ok=True)
                created_paths.append(abs_path)
                logger.debug("创建成功: %s", abs_path)
            except OSError as e:
                failed_paths.append(abs_path)
                logger.error("创建失败: %s | 错误: %s", abs_path, e)

        result.created_paths = created_paths
        result.failed_paths = failed_paths
        result.success = len(failed_paths) == 0

        if result.success:
            logger.info(
                "算法项目结构生成完成: 共创建 %d 个路径",
                len(created_paths),
            )
        else:
            result.error_message = (
                f"部分路径创建失败: {len(failed_paths)} 个失败"
            )
            logger.warning(result.error_message)

        return result

    # ============================================================
    # 核心方法 3：生成单功能代码片段交付
    # ============================================================

    def generate_single_function_delivery(
        self,
        code_file: str,
        description: str,
        base_path: str,
    ) -> DeliveryResult:
        """
        生成单功能代码片段交付物
        运行步骤：
          1. 校验输入参数
          2. 在 base_path 下创建以代码文件名命名的交付目录
          3. 复制代码文件到交付目录
          4. 生成使用说明文档（USAGE.md）
          5. 生成依赖说明文档（DEPENDENCIES.md）
          6. 生成测试方法文档（TEST_METHOD.md）
          7. 生成注意事项文档（NOTES.md）
          8. 返回创建结果
        参数：
          - code_file: 代码文件的绝对路径
          - description: 代码功能描述
          - base_path: 交付物根目录的绝对路径
        返回值：DeliveryResult 对象，包含创建状态和路径列表
        """
        # 步骤 1：输入参数校验
        if not code_file or not code_file.strip():
            return DeliveryResult(
                project_type="single_function",
                error_message="代码文件路径不能为空",
            )

        if not os.path.isfile(code_file):
            return DeliveryResult(
                project_type="single_function",
                error_message=f"代码文件不存在: {code_file}",
            )

        if not base_path or not base_path.strip():
            return DeliveryResult(
                project_type="single_function",
                error_message="基础路径不能为空",
            )

        # 步骤 2：构建交付目录路径
        code_filename = os.path.basename(code_file)
        code_name = os.path.splitext(code_filename)[0]
        delivery_dir = os.path.join(base_path, f"{code_name}_delivery")

        logger.info(
            "开始生成单功能代码交付: file=%s, desc=%s, path=%s",
            code_filename, description[:50], delivery_dir,
        )

        result = DeliveryResult(
            project_name=code_name,
            project_type="single_function",
            base_path=delivery_dir,
        )

        created_paths: List[str] = []
        failed_paths: List[str] = []

        try:
            # 步骤 3：创建交付目录
            os.makedirs(delivery_dir, exist_ok=True)
            created_paths.append(delivery_dir)

            # 步骤 4：复制代码文件到交付目录
            dest_code_path = os.path.join(delivery_dir, code_filename)
            with open(code_file, "r", encoding="utf-8") as src:
                code_content = src.read()
            with open(dest_code_path, "w", encoding="utf-8") as dst:
                dst.write(code_content)
            created_paths.append(dest_code_path)

            # 步骤 5：生成使用说明文档
            usage_path = os.path.join(delivery_dir, "USAGE.md")
            usage_content = self._generate_usage_doc(code_name, description)
            with open(usage_path, "w", encoding="utf-8") as f:
                f.write(usage_content)
            created_paths.append(usage_path)

            # 步骤 6：生成依赖说明文档
            dep_path = os.path.join(delivery_dir, "DEPENDENCIES.md")
            dep_content = self._generate_dependencies_doc(code_name)
            with open(dep_path, "w", encoding="utf-8") as f:
                f.write(dep_content)
            created_paths.append(dep_path)

            # 步骤 7：生成测试方法文档
            test_path = os.path.join(delivery_dir, "TEST_METHOD.md")
            test_content = self._generate_test_method_doc(code_name)
            with open(test_path, "w", encoding="utf-8") as f:
                f.write(test_content)
            created_paths.append(test_path)

            # 步骤 8：生成注意事项文档
            notes_path = os.path.join(delivery_dir, "NOTES.md")
            notes_content = self._generate_notes_doc(code_name, description)
            with open(notes_path, "w", encoding="utf-8") as f:
                f.write(notes_content)
            created_paths.append(notes_path)

            result.created_paths = created_paths
            result.success = True
            logger.info(
                "单功能代码交付生成完成: 共创建 %d 个文件",
                len(created_paths),
            )

        except OSError as e:
            result.failed_paths = failed_paths
            result.error_message = f"文件操作失败: {e}"
            logger.error(result.error_message)

        return result

    # ============================================================
    # 核心方法 4：交付物完整性校验
    # ============================================================

    def verify_delivery_completeness(
        self,
        delivery_path: str,
        project_type: str,
    ) -> DeliveryResult:
        """
        自动校验交付物完整性，报告缺失项
        运行步骤：
          1. 校验交付路径是否存在
          2. 根据项目类型加载对应的必需目录和文件清单
          3. 逐一检查每个必需目录是否存在
          4. 逐一检查每个必需文件是否存在
          5. 汇总缺失项列表
          6. 返回校验结果
        参数：
          - delivery_path: 交付物根目录的绝对路径
          - project_type: 项目类型（"ros" / "algorithm"）
        返回值：DeliveryResult 对象，missing_items 包含缺失项列表
        """
        result = DeliveryResult(
            project_type=project_type,
            base_path=delivery_path,
        )

        # 步骤 1：校验交付路径
        if not delivery_path or not os.path.isdir(delivery_path):
            result.error_message = f"交付路径不存在或不是目录: {delivery_path}"
            result.missing_items = [result.error_message]
            logger.error(result.error_message)
            return result

        # 步骤 2：根据项目类型加载校验清单
        if project_type == "ros":
            required_dirs = self.ROS_REQUIRED_DIRS
            required_root_files = self.ROS_REQUIRED_ROOT_FILES
            required_docs = self.ROS_REQUIRED_DOCS
        elif project_type == "algorithm":
            required_dirs = self.ALGORITHM_REQUIRED_DIRS
            required_root_files = self.ALGORITHM_REQUIRED_ROOT_FILES
            required_docs = self.ALGORITHM_REQUIRED_DOCS
        else:
            result.error_message = f"不支持的项目类型: {project_type}"
            result.missing_items = [result.error_message]
            logger.error(result.error_message)
            return result

        missing_items: List[str] = []

        # 步骤 3：校验必需子目录
        for dir_name in required_dirs:
            dir_path = os.path.join(delivery_path, dir_name)
            if not os.path.isdir(dir_path):
                missing_items.append(f"缺失目录: {dir_name}/")

        # 步骤 4：校验根目录必需文件
        for file_name in required_root_files:
            file_path = os.path.join(delivery_path, file_name)
            if not os.path.isfile(file_path):
                missing_items.append(f"缺失根目录文件: {file_name}")

        # 步骤 5：校验 docs 目录下的必需文档
        docs_dir = os.path.join(delivery_path, "docs")
        if os.path.isdir(docs_dir):
            for doc_name in required_docs:
                doc_path = os.path.join(docs_dir, doc_name)
                if not os.path.isfile(doc_path):
                    missing_items.append(f"缺失文档: docs/{doc_name}")
        else:
            # docs 目录本身缺失，所有文档都标记为缺失
            for doc_name in required_docs:
                missing_items.append(f"缺失文档: docs/{doc_name}")

        # 步骤 6：汇总结果
        result.missing_items = missing_items
        result.success = len(missing_items) == 0

        if result.success:
            logger.info(
                "交付物完整性校验通过: path=%s, type=%s",
                delivery_path, project_type,
            )
        else:
            logger.warning(
                "交付物完整性校验未通过: 缺失 %d 项 | path=%s",
                len(missing_items), delivery_path,
            )
            result.error_message = (
                f"交付物不完整，共缺失 {len(missing_items)} 项"
            )

        return result

    # ============================================================
    # 核心方法 5：生成 README.md 模板
    # ============================================================

    def generate_readme(
        self,
        project_name: str,
        project_type: str,
        description: str,
    ) -> str:
        """
        生成 README.md 模板内容
        包含章节：项目概述、核心功能、环境依赖、快速开始（3 步）、
                 常见问题、许可证
        运行步骤：
          1. 根据项目类型确定标题前缀
          2. 构建标准 README 模板
          3. 填充项目名称、描述等动态内容
          4. 返回完整的 Markdown 文本
        参数：
          - project_name: 项目名称
          - project_type: 项目类型（"ros" / "algorithm"）
          - description: 项目描述文本
        返回值：完整的 README.md Markdown 字符串
        """
        # 步骤 1：确定项目类型中文标签
        type_label = "ROS 全栈项目" if project_type == "ros" else "纯算法项目"

        # 步骤 2：构建 README 模板
        readme_content = f"""# {project_name}

> **项目类型**: {type_label}
> **生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

---

## 项目概述

{description if description else '（请在此处填写项目概述）'}

---

## 核心功能

- **功能 1**: （请在此处描述核心功能 1）
- **功能 2**: （请在此处描述核心功能 2）
- **功能 3**: （请在此处描述核心功能 3）

---

## 环境依赖

### 系统要求
- 操作系统: Ubuntu 22.04 / 24.04（推荐）
- Python: >= 3.10
- CMake: >= 3.22

### 主要依赖
- （请在此处列出主要依赖库及版本要求）

---

## 快速开始

### 步骤 1：克隆项目

```bash
git clone <仓库地址>
cd {project_name}
```

### 步骤 2：安装依赖

```bash
pip install -r requirements.txt
```

### 步骤 3：运行项目

```bash
# （请在此处填写运行命令）
```

---

## 常见问题

### Q1: （常见问题 1）
**A**: （答案）

### Q2: （常见问题 2）
**A**: （答案）

### Q3: （常见问题 3）
**A**: （答案）

---

## 许可证

本项目采用 MIT 许可证，详见 [LICENSE](./LICENSE) 文件。

---

> 本文档由交付物结构管理服务自动生成
"""
        return readme_content

    # ============================================================
    # 核心方法 6：生成 CHANGELOG.md 模板
    # ============================================================

    def generate_changelog_template(self, version: str) -> str:
        """
        生成 CHANGELOG.md 模板，严格遵循语义化版本标准
        包含分类：新增、优化、修复、废弃、移除、安全
        运行步骤：
          1. 校验版本号格式
          2. 构建语义化版本 CHANGELOG 模板
          3. 填充版本号和日期
          4. 返回完整的 Markdown 文本
        参数：
          - version: 语义化版本号（如 "1.0.0"）
        返回值：完整的 CHANGELOG.md Markdown 字符串
        """
        # 步骤 1：校验版本号格式
        if not version or not version.strip():
            version = "0.1.0"

        # 步骤 2：构建 CHANGELOG 模板
        today = datetime.now().strftime("%Y-%m-%d")
        changelog_content = f"""# CHANGELOG

本文档遵循 [语义化版本](https://semver.org/lang/zh-CN/) 标准。

---

## [{version}] - {today}

### 新增
- （请在此处记录新增的功能、模块、接口）

### 优化
- （请在此处记录性能优化、代码重构、体验改进）

### 修复
- （请在此处记录 Bug 修复、异常处理改进）

### 废弃
- （请在此处记录已废弃但尚未移除的功能）

### 移除
- （请在此处记录已完全移除的功能、模块、接口）

### 安全
- （请在此处记录安全漏洞修复、安全机制增强）

---

## 版本格式说明

版本号格式: MAJOR.MINOR.PATCH

- **MAJOR**: 不兼容的 API 修改
- **MINOR**: 向下兼容的功能新增
- **PATCH**: 向下兼容的问题修复

---

> 本文档由交付物结构管理服务自动生成
"""
        return changelog_content

    # ============================================================
    # 私有辅助方法：获取 ROS 项目模板文件内容
    # ============================================================

    def _get_ros_file_content(
        self,
        rel_path: str,
        project_name: str,
        version: str,
    ) -> str:
        """
        根据文件相对路径返回对应的 ROS 项目模板内容
        参数：
          - rel_path: 文件在项目中的相对路径
          - project_name: 项目名称
          - version: 项目版本号
        返回值：文件内容字符串
        """
        # 根目录模板文件
        if rel_path == "README.md":
            return self.generate_readme(
                project_name, "ros",
                f"{project_name} - ROS 全栈机器人项目 v{version}",
            )
        elif rel_path == "CHANGELOG.md":
            return self.generate_changelog_template(version)
        elif rel_path == "requirements.txt":
            return self._generate_ros_requirements()
        elif rel_path == "rosdep.yaml":
            return self._generate_rosdep_yaml()
        elif rel_path == "LICENSE":
            return self._generate_license()

        # docs 目录文档模板
        elif rel_path.startswith("docs/"):
            doc_name = os.path.basename(rel_path)
            return self._generate_doc_template(doc_name, project_name, version)

        # 未知文件返回空模板
        return ""

    # ============================================================
    # 私有辅助方法：获取算法项目模板文件内容
    # ============================================================

    def _get_algorithm_file_content(
        self,
        rel_path: str,
        project_name: str,
        version: str,
    ) -> str:
        """
        根据文件相对路径返回对应的算法项目模板内容
        参数：
          - rel_path: 文件在项目中的相对路径
          - project_name: 项目名称
          - version: 项目版本号
        返回值：文件内容字符串
        """
        # 根目录模板文件
        if rel_path == "README.md":
            return self.generate_readme(
                project_name, "algorithm",
                f"{project_name} - 纯算法项目 v{version}",
            )
        elif rel_path == "CHANGELOG.md":
            return self.generate_changelog_template(version)
        elif rel_path == "requirements.txt":
            return self._generate_algorithm_requirements()
        elif rel_path == "CMakeLists.txt":
            return self._generate_cmake_template(project_name, version)
        elif rel_path == "LICENSE":
            return self._generate_license()

        # docs 目录文档模板
        elif rel_path.startswith("docs/"):
            doc_name = os.path.basename(rel_path)
            return self._generate_doc_template(doc_name, project_name, version)

        # 未知文件返回空模板
        return ""

    # ============================================================
    # 私有辅助方法：生成 ROS 项目 requirements.txt
    # ============================================================

    def _generate_ros_requirements(self) -> str:
        """
        生成 ROS 项目的 requirements.txt 模板
        返回值：requirements.txt 内容字符串
        """
        return """# ROS 项目 Python 依赖
# 生成时间: {timestamp}

# ROS 核心依赖（通过系统包管理器安装，此处仅作参考）
# rospy / rclpy

# 通用工具库
numpy>=1.24.0
scipy>=1.10.0
PyYAML>=6.0

# 数据处理与可视化
matplotlib>=3.7.0
pandas>=2.0.0

# 测试框架
pytest>=7.0.0
pytest-cov>=4.0.0

# 代码质量
flake8>=6.0.0
pylint>=2.17.0
""".format(timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

    # ============================================================
    # 私有辅助方法：生成算法项目 requirements.txt
    # ============================================================

    def _generate_algorithm_requirements(self) -> str:
        """
        生成算法项目的 requirements.txt 模板
        返回值：requirements.txt 内容字符串
        """
        return """# 算法项目 Python 依赖
# 生成时间: {timestamp}

# 数值计算
numpy>=1.24.0
scipy>=1.10.0

# 数据处理与可视化
matplotlib>=3.7.0
pandas>=2.0.0

# 配置管理
PyYAML>=6.0

# 测试框架
pytest>=7.0.0
pytest-cov>=4.0.0

# 代码质量
flake8>=6.0.0
""".format(timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

    # ============================================================
    # 私有辅助方法：生成 rosdep.yaml 模板
    # ============================================================

    def _generate_rosdep_yaml(self) -> str:
        """
        生成 ROS 项目的 rosdep.yaml 依赖声明模板
        返回值：rosdep.yaml 内容字符串
        """
        return """# ROS 系统依赖声明文件
# 生成时间: {timestamp}
#
# 使用方式:
#   rosdep install --from-paths src --ignore-src -r -y

# 示例依赖（请根据实际项目修改）:
# 传感器驱动
# - ros-humble-librealsense2
# - ros-humble-velodyne-driver
#
# 导航与定位
# - ros-humble-nav2-bringup
# - ros-humble-slam-toolbox
#
# 控制
# - ros-humble-ros2-control
# - ros-humble-ros2-controllers
""".format(timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

    # ============================================================
    # 私有辅助方法：生成 CMakeLists.txt 模板
    # ============================================================

    def _generate_cmake_template(
        self,
        project_name: str,
        version: str,
    ) -> str:
        """
        生成算法项目的 CMakeLists.txt 模板
        参数：
          - project_name: 项目名称
          - version: 项目版本号
        返回值：CMakeLists.txt 内容字符串
        """
        return f"""# CMakeLists.txt - {project_name} 算法项目构建配置
# 生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
# 版本: v{version}

cmake_minimum_required(VERSION 3.22)
project({project_name} VERSION {version} LANGUAGES CXX)

# C++ 标准
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 查找依赖库（请根据实际项目修改）
# find_package(Eigen3 REQUIRED)
# find_package(OpenCV REQUIRED)

# 包含头文件目录
include_directories(${{CMAKE_SOURCE_DIR}}/include)

# 添加可执行文件或库（请根据实际项目修改）
# add_library(${{PROJECT_NAME}} src/core.cpp)
# target_include_directories(${{PROJECT_NAME}} PUBLIC include)

# 测试（可选）
# enable_testing()
# add_subdirectory(test)
"""

    # ============================================================
    # 私有辅助方法：生成 LICENSE 模板
    # ============================================================

    def _generate_license(self) -> str:
        """
        生成 MIT LICENSE 模板
        返回值：LICENSE 内容字符串
        """
        year = datetime.now().year
        return f"""MIT License

Copyright (c) {year}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""

    # ============================================================
    # 私有辅助方法：生成文档模板
    # ============================================================

    def _generate_doc_template(
        self,
        doc_name: str,
        project_name: str,
        version: str,
    ) -> str:
        """
        根据文档名称生成对应的文档模板
        参数：
          - doc_name: 文档文件名（如 "01-需求文档.md"）
          - project_name: 项目名称
          - version: 项目版本号
        返回值：文档模板内容字符串
        """
        # 提取文档标题（去除序号前缀和 .md 后缀）
        title = doc_name
        if title.endswith(".md"):
            title = title[:-3]
        # 去除 "01-" 这样的序号前缀
        if len(title) > 3 and title[2] == "-":
            title = title[3:]

        today = datetime.now().strftime("%Y-%m-%d")
        return f"""# {title}

> **项目**: {project_name} v{version}
> **生成时间**: {today}
> **状态**: 待完善

---

## 概述

（请在此处填写 {title} 的概述内容）

---

## 详细内容

（请在此处填写 {title} 的详细内容）

---

## 相关文档

- [README.md](../README.md)
- [CHANGELOG.md](../CHANGELOG.md)

---

> 本文档为自动生成的模板，请根据项目实际情况完善内容
"""

    # ============================================================
    # 私有辅助方法：生成使用说明文档（单功能交付）
    # ============================================================

    def _generate_usage_doc(
        self,
        code_name: str,
        description: str,
    ) -> str:
        """
        生成单功能代码片段的使用说明文档
        参数：
          - code_name: 代码名称（不含扩展名）
          - description: 代码功能描述
        返回值：USAGE.md 内容字符串
        """
        return f"""# 使用说明 - {code_name}

> **功能描述**: {description if description else '（请补充功能描述）'}
> **生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

---

## 功能概述

（请在此处详细描述代码片段的核心功能和使用场景）

---

## 输入参数

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| （参数1） | （类型） | 是/否 | （默认值） | （说明） |

---

## 输出结果

| 字段名 | 类型 | 说明 |
|--------|------|------|
| （字段1） | （类型） | （说明） |

---

## 使用示例

```python
# （请在此处填写使用示例代码）
```

---

## 注意事项

- （请在此处填写使用注意事项）
"""

    # ============================================================
    # 私有辅助方法：生成依赖说明文档（单功能交付）
    # ============================================================

    def _generate_dependencies_doc(
        self,
        code_name: str,
    ) -> str:
        """
        生成单功能代码片段的依赖说明文档
        参数：
          - code_name: 代码名称（不含扩展名）
        返回值：DEPENDENCIES.md 内容字符串
        """
        return f"""# 依赖说明 - {code_name}

> **生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

---

## Python 依赖

| 包名 | 最低版本 | 说明 |
|------|----------|------|
| （包名） | （版本） | （说明） |

---

## 系统依赖

| 依赖项 | 最低版本 | 说明 |
|--------|----------|------|
| （依赖项） | （版本） | （说明） |

---

## 安装命令

```bash
pip install -r requirements.txt
```

---

## 环境要求

- Python >= 3.10
- 操作系统: Ubuntu 22.04+ / macOS 12+ / Windows 10+
"""

    # ============================================================
    # 私有辅助方法：生成测试方法文档（单功能交付）
    # ============================================================

    def _generate_test_method_doc(
        self,
        code_name: str,
    ) -> str:
        """
        生成单功能代码片段的测试方法文档
        参数：
          - code_name: 代码名称（不含扩展名）
        返回值：TEST_METHOD.md 内容字符串
        """
        return f"""# 测试方法 - {code_name}

> **生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

---

## 测试环境

- Python 版本: （请填写）
- 操作系统: （请填写）
- 依赖版本: 见 [DEPENDENCIES.md](./DEPENDENCIES.md)

---

## 单元测试

### 测试用例 1: （用例名称）

**输入**: （输入数据）
**预期输出**: （预期结果）
**验证方法**: （验证步骤）

### 测试用例 2: （用例名称）

**输入**: （输入数据）
**预期输出**: （预期结果）
**验证方法**: （验证步骤）

---

## 运行测试

```bash
# 运行所有测试
pytest test_{code_name}.py -v

# 运行单个测试
pytest test_{code_name}.py::test_function_name -v
```

---

## 测试覆盖率

（请在此处记录测试覆盖率报告）
"""

    # ============================================================
    # 私有辅助方法：生成注意事项文档（单功能交付）
    # ============================================================

    def _generate_notes_doc(
        self,
        code_name: str,
        description: str,
    ) -> str:
        """
        生成单功能代码片段的注意事项文档
        参数：
          - code_name: 代码名称（不含扩展名）
          - description: 代码功能描述
        返回值：NOTES.md 内容字符串
        """
        return f"""# 注意事项 - {code_name}

> **功能**: {description if description else '（请补充功能描述）'}
> **生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

---

## 使用限制

- （请在此处填写使用限制条件）

---

## 已知问题

- （请在此处填写已知问题及规避方案）

---

## 性能说明

- （请在此处填写性能指标和优化建议）

---

## 安全注意事项

- （请在此处填写安全相关的注意事项）

---

## 版本兼容性

- （请在此处填写版本兼容性说明）
"""
