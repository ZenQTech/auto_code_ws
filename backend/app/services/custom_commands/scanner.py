"""
# ============================================================
# Custom Commands Scanner - TRAE .trae/commands/ 目录扫描器
# ============================================================
# 核心作用：扫描项目级 + 全局级 .trae/commands/ 目录
# 特性：
#   1. 项目级: <project>/.trae/commands/
#   2. 全局级: ~/.trae/commands/
#   3. 支持 3 级嵌套目录分类
#   4. 启动时自动扫描 + 缓存
#   5. 优雅降级（目录不存在时返回空列表）
#
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 8 P0-13
# ============================================================
"""

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from .parser import (
    CustomCommand,
    parse_command_file,
)

logger = logging.getLogger(__name__)


# ============================================================
# 常量
# ============================================================

# 项目级命令目录（相对于项目根目录）
PROJECT_COMMANDS_DIR = ".trae/commands"
# 全局级命令目录（相对于用户主目录）
GLOBAL_COMMANDS_DIR = ".trae/commands"

# 支持的文件扩展名
SUPPORTED_EXTENSIONS = (".md", ".markdown")

# 最大嵌套目录深度（3 级）
MAX_CATEGORY_DEPTH = 3


# ============================================================
# 扫描器
# ============================================================

@dataclass
class ScanResult:
    """扫描结果"""
    commands: List[CustomCommand] = field(default_factory=list)
    errors: List[Dict[str, str]] = field(default_factory=list)
    project_count: int = 0
    global_count: int = 0
    categories: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "commands": [c.to_dict() for c in self.commands],
            "errors": self.errors,
            "project_count": self.project_count,
            "global_count": self.global_count,
            "categories": self.categories,
            "total": len(self.commands),
        }


class CustomCommandsScanner:
    """
    自定义命令扫描器（单例）

    使用方式：
        scanner = CustomCommandsScanner.get_instance()
        result = scanner.scan_all(project_path="/path/to/project")
    """

    _instance: Optional["CustomCommandsScanner"] = None

    def __init__(self) -> None:
        self._cache: Dict[str, List[CustomCommand]] = {}
        self._last_scan: Optional[ScanResult] = None

    @classmethod
    def get_instance(cls) -> "CustomCommandsScanner":
        """获取单例"""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # ============================================================
    # 路径解析
    # ============================================================

    def get_project_commands_path(self, project_path: str) -> Path:
        """获取项目级命令目录的绝对路径"""
        return Path(project_path) / PROJECT_COMMANDS_DIR

    def get_global_commands_path(self) -> Path:
        """获取全局级命令目录的绝对路径"""
        return Path.home() / GLOBAL_COMMANDS_DIR

    # ============================================================
    # 扫描
    # ============================================================

    def scan_directory(
        self,
        directory: Path,
        scope: str,
    ) -> List[CustomCommand]:
        """
        扫描指定目录

        Args:
            directory: 目录绝对路径
            scope: 'project' | 'global'

        Returns:
            CustomCommand 列表
        """
        if not directory.exists():
            logger.debug(f"目录不存在，跳过: {directory}")
            return []
        if not directory.is_dir():
            logger.debug(f"不是目录，跳过: {directory}")
            return []

        commands: List[CustomCommand] = []

        for file_path in directory.rglob("*"):
            if not file_path.is_file():
                continue
            if file_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
                continue

            # 计算相对于目录的路径，用于提取分类
            rel_path = file_path.relative_to(directory)
            parts = rel_path.parts[:-1]  # 去掉文件名

            # 限制嵌套目录深度为 3 级
            if len(parts) > MAX_CATEGORY_DEPTH:
                logger.debug(f"嵌套深度超限，跳过: {file_path}")
                continue

            parent_category = "/".join(parts) if parts else ""

            command = parse_command_file(
                file_path=str(file_path),
                scope=scope,
                parent_category=parent_category,
            )
            if command is not None:
                commands.append(command)
            else:
                logger.debug(f"解析失败，跳过: {file_path}")

        return commands

    def scan_project(self, project_path: str) -> List[CustomCommand]:
        """
        扫描项目级命令目录

        Args:
            project_path: 项目根目录绝对路径

        Returns:
            CustomCommand 列表
        """
        commands_path = self.get_project_commands_path(project_path)
        return self.scan_directory(commands_path, scope="project")

    def scan_global(self) -> List[CustomCommand]:
        """
        扫描全局级命令目录

        Returns:
            CustomCommand 列表
        """
        commands_path = self.get_global_commands_path()
        return self.scan_directory(commands_path, scope="global")

    def scan_all(
        self,
        project_path: Optional[str] = None,
    ) -> ScanResult:
        """
        扫描项目级 + 全局级命令（项目优先，名称冲突时项目级覆盖）

        Args:
            project_path: 项目根目录绝对路径（可选）

        Returns:
            ScanResult 实例
        """
        result = ScanResult()

        # 扫描项目级
        project_commands: List[CustomCommand] = []
        if project_path:
            try:
                project_commands = self.scan_project(project_path)
                result.project_count = len(project_commands)
                logger.info(f"扫描项目级命令: {len(project_commands)} 个 ({project_path})")
            except Exception as e:
                logger.error(f"扫描项目级命令失败: {e}")
                result.errors.append({
                    "scope": "project",
                    "path": str(project_path),
                    "error": str(e),
                })

        # 扫描全局级
        global_commands: List[CustomCommand] = []
        try:
            global_commands = self.scan_global()
            result.global_count = len(global_commands)
            logger.info(f"扫描全局级命令: {len(global_commands)} 个")
        except Exception as e:
            logger.error(f"扫描全局级命令失败: {e}")
            result.errors.append({
                "scope": "global",
                "path": str(self.get_global_commands_path()),
                "error": str(e),
            })

        # 合并：项目级优先
        seen_names = set()
        merged: List[CustomCommand] = []
        for cmd in project_commands:
            if cmd.name in seen_names:
                # 同名重复：项目级优先
                logger.debug(f"自定义命令名称重复（项目级覆盖）: {cmd.name}")
                continue
            seen_names.add(cmd.name)
            merged.append(cmd)

        for cmd in global_commands:
            if cmd.name in seen_names:
                # 项目级已有同名命令，跳过全局级
                continue
            seen_names.add(cmd.name)
            merged.append(cmd)

        result.commands = merged

        # 收集所有分类
        categories = set()
        for cmd in merged:
            if cmd.parent_category:
                categories.add(cmd.parent_category)
            else:
                categories.add(cmd.category)
        result.categories = sorted(categories)

        # 缓存
        self._last_scan = result
        if project_path:
            self._cache[project_path] = merged

        return result

    def get_cached(self, project_path: str) -> Optional[List[CustomCommand]]:
        """获取缓存的扫描结果"""
        return self._cache.get(project_path)

    def get_last_scan(self) -> Optional[ScanResult]:
        """获取最近一次扫描结果"""
        return self._last_scan

    def clear_cache(self) -> None:
        """清空缓存"""
        self._cache.clear()
        self._last_scan = None


# ============================================================
# 辅助函数
# ============================================================

def create_sample_command(
    name: str,
    description: str,
    instructions: str,
    category: str = "general",
    icon: str = "📦",
    scope: str = "project",
    project_path: Optional[str] = None,
) -> Optional[Path]:
    """
    创建示例命令文件（用于测试 + 用户引导）

    Args:
        name: 命令名
        description: 描述
        instructions: 提示词内容
        category: 分类
        icon: 图标
        scope: 'project' | 'global'
        project_path: 项目路径（scope=project 时必需）

    Returns:
        创建的文件路径，失败返回 None
    """
    content = f"""---
Name: {name}
Description: {description}
Category: {category}
Icon: {icon}
---

Instructions: |
{instructions}
"""

    try:
        if scope == "project":
            if not project_path:
                raise ValueError("project_path required for project scope")
            target_dir = Path(project_path) / PROJECT_COMMANDS_DIR / category
        else:
            target_dir = Path.home() / GLOBAL_COMMANDS_DIR / category

        target_dir.mkdir(parents=True, exist_ok=True)
        target_file = target_dir / f"{name}.md"
        target_file.write_text(content, encoding="utf-8")
        logger.info(f"创建示例命令: {target_file}")
        return target_file
    except Exception as e:
        logger.error(f"创建示例命令失败: {e}")
        return None
