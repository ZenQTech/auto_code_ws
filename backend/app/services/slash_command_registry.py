"""
# ============================================================
# Slash Commands Registry (v1.0.0) - Cycle 8 P0-12
# ============================================================
# 核心作用：注册/查询/分类所有可用的 Slash Commands
# 借鉴 Codex v0.150+ 40+ commands + TRAE /plan /spec 模式
#
# 命令分类:
#   - navigation: 导航与会话（/new /resume /quit）
#   - workspace: 工作区与项目（/init /status /diff /review）
#   - mode: 模式切换（/plan /spec /solve /code）
#   - agent: 智能体管理（/agents /mcp /skills /hooks）
#   - ux: 显示与设置（/model /theme /approvals /help）
#   - loop: Loop Engineering（/loop /next /goal）
#
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 8 P0-12
# ============================================================
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


class CommandCategory(str, Enum):
    """命令分类"""

    NAVIGATION = "navigation"  # 导航与会话
    WORKSPACE = "workspace"   # 工作区与项目
    MODE = "mode"             # 模式切换
    AGENT = "agent"           # 智能体管理
    UX = "ux"                 # 显示与设置
    LOOP = "loop"             # Loop Engineering
    CUSTOM = "custom"         # 用户自定义


@dataclass
class SlashCommandArg:
    """命令参数定义"""

    name: str                              # 参数名
    description: str = ""                  # 参数描述
    required: bool = False                 # 是否必填
    default: Optional[Any] = None          # 默认值
    choices: Optional[List[str]] = None    # 可选值列表


@dataclass
class SlashCommand:
    """
    Slash Command 定义

    Attributes:
        name: 命令名（不含 /），如 "plan"
        description: 命令描述
        category: 命令分类
        args: 参数定义列表
        aliases: 命令别名列表
        handler: 处理函数路径（如 "open_plan_modal"）
        enabled: 是否启用
        built_in: 是否内置命令
        permission: 所需权限（如 "user", "admin"）
        icon: 命令图标（emoji）
        shortcut: 快捷键提示
    """

    name: str
    description: str
    category: CommandCategory = CommandCategory.UX
    args: List[SlashCommandArg] = field(default_factory=list)
    aliases: List[str] = field(default_factory=list)
    handler: str = ""
    enabled: bool = True
    built_in: bool = True
    permission: str = "user"
    icon: str = "💬"
    shortcut: str = ""

    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典"""
        return {
            "name": self.name,
            "description": self.description,
            "category": self.category.value,
            "args": [asdict(a) for a in self.args],
            "aliases": self.aliases,
            "handler": self.handler,
            "enabled": self.enabled,
            "built_in": self.built_in,
            "permission": self.permission,
            "icon": self.icon,
            "shortcut": self.shortcut,
        }


class SlashCommandRegistry:
    """
    Slash Command 注册表

    职责：
    1. 注册内置命令 + 自定义命令
    2. 提供查询/过滤/搜索 API
    3. 按分类组织命令
    4. 提供统计摘要
    """

    def __init__(self) -> None:
        self._commands: Dict[str, SlashCommand] = {}
        self._categories: Dict[CommandCategory, List[str]] = {
            cat: [] for cat in CommandCategory
        }
        # 注册所有内置命令
        self._register_builtin_commands()

    # ============================================================
    # 注册 API
    # ============================================================

    def register(self, command: SlashCommand) -> None:
        """注册一个命令"""
        if not command.name:
            raise ValueError("命令名不能为空")

        # 检查冲突
        if command.name in self._commands:
            logger.warning(f"命令 {command.name} 已存在，将被覆盖")

        self._commands[command.name] = command

        # 添加到分类列表
        if command.name not in self._categories[command.category]:
            self._categories[command.category].append(command.name)

        # 注册别名
        for alias in command.aliases:
            self._commands[alias] = command

        logger.info(
            f"注册命令: /{command.name} ({command.category.value}, "
            f"{len(command.args)} args)"
        )

    def unregister(self, name: str) -> bool:
        """注销一个命令"""
        if name not in self._commands:
            return False

        cmd = self._commands[name]
        del self._commands[name]

        # 同时删除别名
        for alias in cmd.aliases:
            if alias in self._commands and self._commands[alias] is cmd:
                del self._commands[alias]

        # 从分类中移除
        if name in self._categories[cmd.category]:
            self._categories[cmd.category].remove(name)

        return True

    # ============================================================
    # 查询 API
    # ============================================================

    def get(self, name: str) -> Optional[SlashCommand]:
        """根据名称获取命令（支持别名）"""
        return self._commands.get(name)

    def list_all(self, enabled_only: bool = True) -> List[SlashCommand]:
        """列出所有命令"""
        seen = set()
        result = []
        for name, cmd in self._commands.items():
            # 避免别名重复
            if id(cmd) in seen:
                continue
            seen.add(id(cmd))
            if enabled_only and not cmd.enabled:
                continue
            result.append(cmd)
        return result

    def list_by_category(
        self, category: CommandCategory, enabled_only: bool = True
    ) -> List[SlashCommand]:
        """按分类列出命令"""
        names = self._categories.get(category, [])
        result = []
        for name in names:
            cmd = self._commands.get(name)
            if cmd and (not enabled_only or cmd.enabled):
                result.append(cmd)
        return result

    def search(self, query: str) -> List[SlashCommand]:
        """
        搜索命令（按名称/描述/别名模糊匹配）

        Args:
            query: 搜索关键词

        Returns:
            匹配的命令列表（按相关性排序）
        """
        if not query:
            return self.list_all()

        query_lower = query.lower()
        scored = []

        for cmd in self.list_all():
            score = 0
            # 名称完全匹配
            if cmd.name.lower() == query_lower:
                score += 100
            # 名称前缀匹配
            elif cmd.name.lower().startswith(query_lower):
                score += 50
            # 名称包含
            elif query_lower in cmd.name.lower():
                score += 20
            # 别名匹配
            for alias in cmd.aliases:
                if alias.lower() == query_lower:
                    score += 40
                elif alias.lower().startswith(query_lower):
                    score += 15
            # 描述包含
            if query_lower in cmd.description.lower():
                score += 10
            # 参数匹配
            for arg in cmd.args:
                if query_lower in arg.name.lower():
                    score += 5

            if score > 0:
                scored.append((score, cmd))

        # 按分数降序
        scored.sort(key=lambda x: -x[0])
        return [cmd for _, cmd in scored]

    # ============================================================
    # 统计 API
    # ============================================================

    def summary(self) -> Dict[str, Any]:
        """返回注册表摘要"""
        all_cmds = self.list_all(enabled_only=False)
        enabled = [c for c in all_cmds if c.enabled]
        built_in = [c for c in all_cmds if c.built_in]
        custom = [c for c in all_cmds if not c.built_in]

        by_category = {}
        for cat in CommandCategory:
            by_category[cat.value] = len(self._categories[cat])

        return {
            "total": len(all_cmds),
            "enabled": len(enabled),
            "disabled": len(all_cmds) - len(enabled),
            "built_in": len(built_in),
            "custom": len(custom),
            "by_category": by_category,
        }

    # ============================================================
    # 内置命令注册 (12+ 核心命令)
    # ============================================================

    def _register_builtin_commands(self) -> None:
        """注册所有内置命令"""

        # 1. /init - 创建 AGENTS.md
        self.register(SlashCommand(
            name="init",
            description="初始化项目，自动分析结构并生成 AGENTS.md 项目记忆文件",
            category=CommandCategory.WORKSPACE,
            handler="create_agents_md",
            icon="📝",
            shortcut="/init",
        ))

        # 2. /status - 显示当前会话状态
        self.register(SlashCommand(
            name="status",
            description="显示当前会话配置、上下文使用、token 统计、限速信息",
            category=CommandCategory.WORKSPACE,
            handler="show_status",
            icon="📊",
            shortcut="/status",
        ))

        # 3. /plan - 进入 Plan 模式
        self.register(SlashCommand(
            name="plan",
            description="进入 Plan 模式，AI 分析需求并生成结构化计划",
            category=CommandCategory.MODE,
            args=[SlashCommandArg(
                name="task",
                description="任务描述",
                required=False,
            )],
            handler="open_plan_modal",
            icon="📋",
            shortcut="/plan [task]",
        ))

        # 4. /spec - 进入 Spec 模式
        self.register(SlashCommand(
            name="spec",
            description="进入 Spec 模式，生成 spec.md + tasks.md + checklist.md 三件套",
            category=CommandCategory.MODE,
            args=[SlashCommandArg(
                name="task",
                description="任务描述",
                required=False,
            )],
            handler="open_spec_modal",
            icon="📑",
            shortcut="/spec [task]",
        ))

        # 5. /review - 触发代码审查
        self.register(SlashCommand(
            name="review",
            description="触发代码审查，分析当前代码并生成审查报告",
            category=CommandCategory.MODE,
            args=[SlashCommandArg(
                name="focus",
                description="审查焦点（可选）",
                required=False,
            )],
            handler="trigger_review",
            icon="🔍",
            shortcut="/review [focus]",
        ))

        # 6. /mcp - MCP 服务器管理
        self.register(SlashCommand(
            name="mcp",
            description="打开 MCP 服务器管理面板，查看/启用/禁用 MCP 工具",
            category=CommandCategory.AGENT,
            handler="open_mcp_panel",
            icon="🔌",
            shortcut="/mcp",
        ))

        # 7. /agents - 智能体管理
        self.register(SlashCommand(
            name="agents",
            description="打开 Multi-Agent 管理面板，查看 SubAgent 树形结构",
            category=CommandCategory.AGENT,
            handler="open_agents_panel",
            icon="🤖",
            shortcut="/agents",
        ))

        # 8. /skills - 技能管理
        self.register(SlashCommand(
            name="skills",
            description="打开 Skills 管理面板，查看/管理项目级和全局级技能",
            category=CommandCategory.AGENT,
            handler="open_skills_panel",
            icon="🧩",
            shortcut="/skills",
        ))

        # 9. /hooks - Hooks 事件管理
        self.register(SlashCommand(
            name="hooks",
            description="打开 Hooks 事件管理面板，配置 10 种事件触发器",
            category=CommandCategory.AGENT,
            handler="open_hooks_panel",
            icon="🪝",
            shortcut="/hooks",
        ))

        # 10. /model - 选择模型
        self.register(SlashCommand(
            name="model",
            description="打开模型选择器，切换 LLM 模型（含自定义模型）",
            category=CommandCategory.UX,
            handler="open_model_selector",
            icon="🤖",
            shortcut="/model",
        ))

        # 11. /approvals - 切换批准模式
        self.register(SlashCommand(
            name="approvals",
            description="切换批准模式 (ask/auto/sandbox)，控制智能体操作权限",
            category=CommandCategory.UX,
            args=[SlashCommandArg(
                name="mode",
                description="批准模式",
                required=False,
                choices=["ask", "auto", "sandbox"],
            )],
            handler="set_approval_mode",
            icon="🛡️",
            shortcut="/approvals [mode]",
        ))

        # 12. /help - 显示命令帮助
        self.register(SlashCommand(
            name="help",
            description="显示所有可用的 Slash Commands 列表",
            category=CommandCategory.UX,
            handler="show_help",
            icon="❓",
            shortcut="/help",
        ))

        # 13. /next - 根据任务清单继续
        self.register(SlashCommand(
            name="next",
            description="根据 tasks.md 中的下一步列表继续推进任务",
            category=CommandCategory.LOOP,
            handler="continue_next_task",
            icon="⏭️",
            shortcut="/next",
        ))

        # 14. /goal - 设置长期目标
        self.register(SlashCommand(
            name="goal",
            description="设置长期目标，启动持久会话（可跨多天运行）",
            category=CommandCategory.LOOP,
            args=[SlashCommandArg(
                name="goal",
                description="目标描述",
                required=True,
            )],
            handler="set_long_term_goal",
            icon="🎯",
            shortcut="/goal \"<goal>\"",
        ))

        # 15. /new - 新对话
        self.register(SlashCommand(
            name="new",
            description="开启新对话",
            category=CommandCategory.NAVIGATION,
            handler="start_new_chat",
            icon="✨",
            shortcut="/new",
        ))

        # 16. /resume - 恢复历史会话
        self.register(SlashCommand(
            name="resume",
            description="恢复历史会话",
            category=CommandCategory.NAVIGATION,
            handler="resume_chat",
            icon="⏪",
            shortcut="/resume",
        ))

        # 17. /diff - 显示 git diff
        self.register(SlashCommand(
            name="diff",
            description="显示 git diff（含未跟踪文件）",
            category=CommandCategory.WORKSPACE,
            handler="show_git_diff",
            icon="📊",
            shortcut="/diff",
        ))

        # 18. /loop - Loop Engineering 控制
        self.register(SlashCommand(
            name="loop",
            description="Loop Engineering 控制（triage/plan/execute/verify）",
            category=CommandCategory.LOOP,
            args=[SlashCommandArg(
                name="action",
                description="loop 动作",
                required=True,
                choices=["triage", "plan", "execute", "verify"],
            )],
            handler="run_loop",
            icon="🔁",
            shortcut="/loop <action>",
        ))

    # ============================================================
    # 单例
    # ============================================================

    @classmethod
    def get_instance(cls) -> "SlashCommandRegistry":
        """获取全局单例"""
        global _registry_instance
        if _registry_instance is None:
            _registry_instance = cls()
        return _registry_instance


_registry_instance: Optional[SlashCommandRegistry] = None
