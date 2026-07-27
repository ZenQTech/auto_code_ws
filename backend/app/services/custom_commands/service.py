"""
# ============================================================
# Custom Commands Service - 自定义命令服务层
# ============================================================
# 核心作用：提供 CustomCommand 的 CRUD + 执行 + 与 SlashCommandRegistry 集成
# 运行流程：
#   1. 启动时扫描 .trae/commands/ 目录
#   2. 缓存到内存
#   3. 提供 list/get/execute API
#   4. 同步到 SlashCommandRegistry
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 8 P0-13
# ============================================================
"""

import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from .parser import CustomCommand
from .scanner import (
    CustomCommandsScanner,
    ScanResult,
)

logger = logging.getLogger(__name__)


# ============================================================
# 数据模型
# ============================================================

@dataclass
class CommandExecutionResult:
    """命令执行结果"""
    name: str
    success: bool
    instructions: str  # 渲染后的提示词
    raw_instructions: str
    args: Dict[str, str]
    message: str = ""
    error: Optional[str] = None
    duration_ms: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "success": self.success,
            "instructions": self.instructions,
            "args": self.args,
            "message": self.message,
            "error": self.error,
            "duration_ms": self.duration_ms,
        }


# ============================================================
# 服务层
# ============================================================

class CustomCommandsService:
    """
    自定义命令服务（单例）

    使用方式：
        service = CustomCommandsService.get_instance()
        service.refresh(project_path="/path/to/project")
        commands = service.list_commands()
    """

    _instance: Optional["CustomCommandsService"] = None

    def __init__(self) -> None:
        self._scanner = CustomCommandsScanner.get_instance()
        self._commands: Dict[str, CustomCommand] = {}
        self._categories: List[str] = []
        self._project_path: Optional[str] = None
        self._last_refresh_ts: float = 0.0

    @classmethod
    def get_instance(cls) -> "CustomCommandsService":
        """获取单例"""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # ============================================================
    # 刷新 / 重新扫描
    # ============================================================

    def refresh(
        self,
        project_path: Optional[str] = None,
    ) -> ScanResult:
        """
        重新扫描并刷新内存缓存

        Args:
            project_path: 项目根目录（可选）

        Returns:
            ScanResult 实例
        """
        result = self._scanner.scan_all(project_path=project_path)

        # 清空并重建索引
        self._commands.clear()
        for cmd in result.commands:
            self._commands[cmd.name] = cmd
        self._categories = result.categories
        self._project_path = project_path
        self._last_refresh_ts = time.time()

        # 同步到 SlashCommandRegistry（如果可用）
        self._sync_to_slash_registry()

        return result

    def _sync_to_slash_registry(self) -> None:
        """将自定义命令注册到 SlashCommandRegistry"""
        try:
            # 延迟导入避免循环依赖
            from app.services.slash_command_registry import (
                SlashCommandRegistry,
                CommandCategory,
                SlashCommand,
                SlashCommandArg,
            )

            registry = SlashCommandRegistry.get_instance()
            for cmd in self._commands.values():
                slash_cmd = SlashCommand(
                    name=f"user-{cmd.name}",  # 加 user- 前缀避免冲突
                    description=cmd.description,
                    category=CommandCategory.CUSTOM,
                    icon=cmd.icon,
                    aliases=cmd.aliases,
                    args=[
                        SlashCommandArg(
                            name=a.name,
                            required=a.required,
                            description=a.description,
                        )
                        for a in cmd.args
                    ],
                    handler=f"custom_command:{cmd.name}",
                    built_in=False,
                )
                registry.register(slash_cmd)
            logger.info(f"已同步 {len(self._commands)} 个自定义命令到 SlashCommandRegistry")
        except Exception as e:
            logger.warning(f"同步到 SlashCommandRegistry 失败: {e}")

    # ============================================================
    # 查询
    # ============================================================

    def list_commands(
        self,
        scope: Optional[str] = None,
        category: Optional[str] = None,
    ) -> List[CustomCommand]:
        """
        列出命令

        Args:
            scope: 'project' | 'global' | None（所有）
            category: 分类名（可选）

        Returns:
            CustomCommand 列表
        """
        result = []
        for cmd in self._commands.values():
            if scope and cmd.scope != scope:
                continue
            if category and cmd.category != category and cmd.parent_category != category:
                continue
            result.append(cmd)
        return result

    def get_command(self, name: str) -> Optional[CustomCommand]:
        """按名称获取命令（支持 user- 前缀）"""
        # 去除 user- 前缀
        bare_name = name[5:] if name.startswith("user-") else name
        return self._commands.get(bare_name)

    def list_categories(self) -> List[str]:
        """列出所有分类"""
        return self._categories

    def get_summary(self) -> Dict[str, Any]:
        """获取摘要信息"""
        return {
            "total": len(self._commands),
            "categories": self._categories,
            "project_path": self._project_path,
            "last_refresh": self._last_refresh_ts,
            "by_scope": {
                "project": sum(1 for c in self._commands.values() if c.scope == "project"),
                "global": sum(1 for c in self._commands.values() if c.scope == "global"),
            },
        }

    # ============================================================
    # 执行
    # ============================================================

    def execute_command(
        self,
        name: str,
        args: Optional[Dict[str, str]] = None,
    ) -> CommandExecutionResult:
        """
        执行命令（生成 LLM 提示词）

        Args:
            name: 命令名（支持 user- 前缀）
            args: 参数字典

        Returns:
            CommandExecutionResult 实例
        """
        start = time.time()
        args = args or {}

        cmd = self.get_command(name)
        if cmd is None:
            return CommandExecutionResult(
                name=name,
                success=False,
                instructions="",
                raw_instructions="",
                args=args,
                error=f"命令不存在: {name}",
                duration_ms=(time.time() - start) * 1000,
            )

        # 校验必填参数
        missing = []
        for arg_def in cmd.args:
            if arg_def.required and arg_def.name not in args:
                missing.append(arg_def.name)
        if missing:
            return CommandExecutionResult(
                name=name,
                success=False,
                instructions="",
                raw_instructions=cmd.instructions,
                args=args,
                error=f"缺少必填参数: {', '.join(missing)}",
                duration_ms=(time.time() - start) * 1000,
            )

        # 渲染 instructions
        rendered = cmd.instructions
        for key, value in args.items():
            rendered = rendered.replace(f"{{{key}}}", str(value))

        return CommandExecutionResult(
            name=cmd.name,
            success=True,
            instructions=rendered,
            raw_instructions=cmd.instructions,
            args=args,
            message=f"已生成 {cmd.name} 的执行提示词",
            duration_ms=(time.time() - start) * 1000,
        )

    # ============================================================
    # CRUD（仅用于测试 + 用户管理界面）
    # ============================================================

    def register_command(self, command: CustomCommand) -> None:
        """注册命令到内存（不影响磁盘文件）"""
        self._commands[command.name] = command
        if command.category not in self._categories:
            self._categories.append(command.category)
            self._categories.sort()

    def unregister_command(self, name: str) -> bool:
        """注销命令"""
        bare_name = name[5:] if name.startswith("user-") else name
        if bare_name in self._commands:
            del self._commands[bare_name]
            return True
        return False
