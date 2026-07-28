"""
# ============================================================
# Slash Command Executor (v1.0.0) - Cycle 8 P0-12
# ============================================================
# 核心作用：执行 Slash Commands，处理参数 + 错误 + 权限
#
# 架构：
#   SlashCommandRegistry → 注册命令
#   SlashCommandExecutor → 执行命令
#   Handler Functions   → 具体实现
#
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 8 P0-12
# ============================================================
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, asdict
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

from backend.app.services.slash_command_registry import (
    CommandCategory,
    SlashCommand,
    SlashCommandArg,
    SlashCommandRegistry,
)

logger = logging.getLogger(__name__)


class ExecutionStatus(str, Enum):
    """执行状态"""

    SUCCESS = "success"       # 成功
    FAILED = "failed"         # 失败
    PENDING = "pending"       # 异步执行中
    CANCELLED = "cancelled"   # 取消
    UNAUTHORIZED = "unauthorized"  # 权限不足


@dataclass
class ExecutionResult:
    """执行结果"""

    command: str                          # 命令名
    status: ExecutionStatus               # 状态
    message: str = ""                     # 消息
    data: Optional[Dict[str, Any]] = None # 返回数据
    duration_ms: float = 0.0              # 执行耗时（毫秒）
    error: Optional[str] = None           # 错误信息

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ExecutionContext:
    """执行上下文"""

    user_id: Optional[str] = None         # 用户 ID
    session_id: Optional[str] = None      # 会话 ID
    project: Optional[str] = None         # 项目名
    app_mode: Optional[str] = None        # 模式 (chat/coding)
    extra: Dict[str, Any] = None          # 额外上下文

    def __post_init__(self) -> None:
        if self.extra is None:
            self.extra = {}


# ============================================================
# Handler 类型定义
# ============================================================
HandlerFunction = Callable[[SlashCommand, List[str], ExecutionContext], ExecutionResult]


# ============================================================
# 内置 Handlers
# ============================================================

def handler_create_agents_md(
    command: SlashCommand, args: List[str], context: ExecutionContext
) -> ExecutionResult:
    """创建 AGENTS.md 文件"""
    return ExecutionResult(
        command=command.name,
        status=ExecutionStatus.SUCCESS,
        message="AGENTS.md 创建已触发（前端会弹出项目分析对话框）",
        data={"action": "open_agents_md_panel", "args": args},
    )


def handler_show_status(
    command: SlashCommand, args: List[str], context: ExecutionContext
) -> ExecutionResult:
    """显示当前会话状态"""
    return ExecutionResult(
        command=command.name,
        status=ExecutionStatus.SUCCESS,
        message="会话状态查询已触发",
        data={
            "action": "show_status_panel",
            "session_id": context.session_id,
            "user_id": context.user_id,
            "app_mode": context.app_mode,
        },
    )


def handler_open_plan_modal(
    command: SlashCommand, args: List[str], context: ExecutionContext
) -> ExecutionResult:
    """打开 Plan 模式"""
    task = " ".join(args) if args else ""
    return ExecutionResult(
        command=command.name,
        status=ExecutionStatus.SUCCESS,
        message=f"Plan 模式已启动 (task={task or '无'})",
        data={"action": "open_plan_modal", "task": task},
    )


def handler_open_spec_modal(
    command: SlashCommand, args: List[str], context: ExecutionContext
) -> ExecutionResult:
    """打开 Spec 模式"""
    task = " ".join(args) if args else ""
    return ExecutionResult(
        command=command.name,
        status=ExecutionStatus.SUCCESS,
        message=f"Spec 模式已启动 (task={task or '无'})",
        data={"action": "open_spec_modal", "task": task},
    )


def handler_trigger_review(
    command: SlashCommand, args: List[str], context: ExecutionContext
) -> ExecutionResult:
    """触发代码审查"""
    focus = " ".join(args) if args else ""
    return ExecutionResult(
        command=command.name,
        status=ExecutionStatus.SUCCESS,
        message=f"代码审查已触发 (focus={focus or '默认'})",
        data={"action": "trigger_review", "focus": focus},
    )


def handler_open_mcp_panel(
    command: SlashCommand, args: List[str], context: ExecutionContext
) -> ExecutionResult:
    """打开 MCP 面板"""
    return ExecutionResult(
        command=command.name,
        status=ExecutionStatus.SUCCESS,
        message="MCP 管理面板已打开",
        data={"action": "open_mcp_panel"},
    )


def handler_open_agents_panel(
    command: SlashCommand, args: List[str], context: ExecutionContext
) -> ExecutionResult:
    """打开 Agents 面板"""
    return ExecutionResult(
        command=command.name,
        status=ExecutionStatus.SUCCESS,
        message="Multi-Agent 管理面板已打开",
        data={"action": "open_agents_panel"},
    )


def handler_open_skills_panel(
    command: SlashCommand, args: List[str], context: ExecutionContext
) -> ExecutionResult:
    """打开 Skills 面板"""
    return ExecutionResult(
        command=command.name,
        status=ExecutionStatus.SUCCESS,
        message="Skills 管理面板已打开",
        data={"action": "open_skills_panel"},
    )


def handler_open_hooks_panel(
    command: SlashCommand, args: List[str], context: ExecutionContext
) -> ExecutionResult:
    """打开 Hooks 面板"""
    return ExecutionResult(
        command=command.name,
        status=ExecutionStatus.SUCCESS,
        message="Hooks 事件管理面板已打开",
        data={"action": "open_hooks_panel"},
    )


def handler_open_model_selector(
    command: SlashCommand, args: List[str], context: ExecutionContext
) -> ExecutionResult:
    """打开模型选择器"""
    return ExecutionResult(
        command=command.name,
        status=ExecutionStatus.SUCCESS,
        message="模型选择器已打开",
        data={"action": "open_model_selector"},
    )


def handler_set_approval_mode(
    command: SlashCommand, args: List[str], context: ExecutionContext
) -> ExecutionResult:
    """设置批准模式"""
    valid_modes = ["ask", "auto", "sandbox"]
    if not args:
        # 切换/显示当前模式
        return ExecutionResult(
            command=command.name,
            status=ExecutionStatus.SUCCESS,
            message="批准模式已打开（前端会显示当前模式）",
            data={"action": "show_approval_mode"},
        )

    mode = args[0].lower()
    if mode not in valid_modes:
        return ExecutionResult(
            command=command.name,
            status=ExecutionStatus.FAILED,
            message=f"无效的批准模式: {mode}（可选: {', '.join(valid_modes)}）",
            error=f"Invalid mode: {mode}",
        )

    return ExecutionResult(
        command=command.name,
        status=ExecutionStatus.SUCCESS,
        message=f"批准模式已切换为: {mode}",
        data={"action": "set_approval_mode", "mode": mode},
    )


def handler_show_help(
    command: SlashCommand, args: List[str], context: ExecutionContext
) -> ExecutionResult:
    """显示所有命令帮助"""
    registry = SlashCommandRegistry.get_instance()
    commands = registry.list_all()
    return ExecutionResult(
        command=command.name,
        status=ExecutionStatus.SUCCESS,
        message=f"找到 {len(commands)} 个可用命令",
        data={
            "action": "show_help",
            "commands": [c.to_dict() for c in commands],
        },
    )


def handler_continue_next_task(
    command: SlashCommand, args: List[str], context: ExecutionContext
) -> ExecutionResult:
    """根据任务清单继续"""
    return ExecutionResult(
        command=command.name,
        status=ExecutionStatus.SUCCESS,
        message="已触发 next 任务（前端会读取 tasks.md 并执行下一项）",
        data={"action": "continue_next_task"},
    )


def handler_set_long_term_goal(
    command: SlashCommand, args: List[str], context: ExecutionContext
) -> ExecutionResult:
    """设置长期目标"""
    if not args:
        return ExecutionResult(
            command=command.name,
            status=ExecutionStatus.FAILED,
            message="缺少目标描述 (usage: /goal \"<goal>\")",
            error="Missing required argument: goal",
        )

    goal = " ".join(args)
    return ExecutionResult(
        command=command.name,
        status=ExecutionStatus.SUCCESS,
        message=f"长期目标已设置: {goal}",
        data={"action": "set_goal", "goal": goal},
    )


def handler_start_new_chat(
    command: SlashCommand, args: List[str], context: ExecutionContext
) -> ExecutionResult:
    """开始新对话"""
    return ExecutionResult(
        command=command.name,
        status=ExecutionStatus.SUCCESS,
        message="新对话已启动",
        data={"action": "new_chat"},
    )


def handler_resume_chat(
    command: SlashCommand, args: List[str], context: ExecutionContext
) -> ExecutionResult:
    """恢复历史会话"""
    return ExecutionResult(
        command=command.name,
        status=ExecutionStatus.SUCCESS,
        message="会话选择器已打开",
        data={"action": "open_session_selector"},
    )


def handler_show_git_diff(
    command: SlashCommand, args: List[str], context: ExecutionContext
) -> ExecutionResult:
    """显示 git diff"""
    return ExecutionResult(
        command=command.name,
        status=ExecutionStatus.SUCCESS,
        message="git diff 已加载（前端会显示 diff 视图）",
        data={"action": "show_git_diff"},
    )


def handler_run_loop(
    command: SlashCommand, args: List[str], context: ExecutionContext
) -> ExecutionResult:
    """Loop Engineering 控制（v1.1.0 Cycle 8 P1-4 增强版）

    支持子命令:
      - triage: 分析 tasks.md 任务优先级
      - plan: 生成 spec + branch
      - execute: 执行 task + git commit
      - verify: 验证任务
    """
    if not args:
        return ExecutionResult(
            command=command.name,
            status=ExecutionStatus.FAILED,
            message="缺少 loop action (triage/plan/execute/verify)",
            error="Missing required argument: action",
        )

    action = args[0].lower()
    valid_actions = ["triage", "plan", "execute", "verify"]
    if action not in valid_actions:
        return ExecutionResult(
            command=command.name,
            status=ExecutionStatus.FAILED,
            message=f"无效的 loop action: {action}，可选: {', '.join(valid_actions)}",
            error=f"Invalid action: {action}",
        )

    # 集成 loop_commands 服务
    try:
        from .loop_commands import (
            TriageService, PlanService, ExecuteService, VerifyService,
        )

        project_path = context.metadata.get("project_path") if context.metadata else None
        if not project_path:
            project_path = "."  # 默认当前目录

        # 根据 action 路由到对应服务
        if action == "triage":
            service = TriageService(project_path)
            result = service.analyze()
        elif action == "plan":
            service = PlanService(project_path)
            result = service.execute(max_iterations=3)
        elif action == "execute":
            service = ExecuteService(project_path)
            result = service.execute(task_id=None)
        elif action == "verify":
            service = VerifyService(project_path)
            result = service.verify()
        else:
            result = {}

        return ExecutionResult(
            command=command.name,
            status=ExecutionStatus.SUCCESS,
            message=f"Loop Engineering: {action} 已执行",
            data={"action": "run_loop", "loop_action": action, "result": result},
        )
    except Exception as e:
        logger.error(f"Loop {action} failed: {e}")
        return ExecutionResult(
            command=command.name,
            status=ExecutionStatus.FAILED,
            message=f"Loop Engineering: {action} 执行失败: {e}",
            error=str(e),
        )


# ============================================================
# SlashCommandExecutor
# ============================================================

class SlashCommandExecutor:
    """
    Slash Command 执行器

    职责：
    1. 接收命令 + 参数
    2. 验证参数
    3. 调用对应 handler
    4. 记录执行历史
    5. 返回执行结果
    """

    def __init__(self, registry: Optional[SlashCommandRegistry] = None) -> None:
        self._registry = registry or SlashCommandRegistry.get_instance()
        self._history: List[ExecutionResult] = []
        self._handlers: Dict[str, HandlerFunction] = {
            "create_agents_md": handler_create_agents_md,
            "show_status": handler_show_status,
            "open_plan_modal": handler_open_plan_modal,
            "open_spec_modal": handler_open_spec_modal,
            "trigger_review": handler_trigger_review,
            "open_mcp_panel": handler_open_mcp_panel,
            "open_agents_panel": handler_open_agents_panel,
            "open_skills_panel": handler_open_skills_panel,
            "open_hooks_panel": handler_open_hooks_panel,
            "open_model_selector": handler_open_model_selector,
            "set_approval_mode": handler_set_approval_mode,
            "show_help": handler_show_help,
            "continue_next_task": handler_continue_next_task,
            "set_long_term_goal": handler_set_long_term_goal,
            "start_new_chat": handler_start_new_chat,
            "resume_chat": handler_resume_chat,
            "show_git_diff": handler_show_git_diff,
            "run_loop": handler_run_loop,
        }

    # ============================================================
    # 公共 API
    # ============================================================

    def execute(
        self,
        command_name: str,
        args: Optional[List[str]] = None,
        context: Optional[ExecutionContext] = None,
    ) -> ExecutionResult:
        """
        执行一个命令

        Args:
            command_name: 命令名（不含 /）
            args: 参数列表
            context: 执行上下文

        Returns:
            ExecutionResult
        """
        start_time = time.time()
        args = args or []
        context = context or ExecutionContext()

        # 1. 查找命令
        command = self._registry.get(command_name)
        if command is None:
            return self._record_result(ExecutionResult(
                command=command_name,
                status=ExecutionStatus.FAILED,
                message=f"未知命令: /{command_name}",
                error=f"Command not found: {command_name}",
                duration_ms=(time.time() - start_time) * 1000,
            ))

        # 2. 检查是否启用
        if not command.enabled:
            return self._record_result(ExecutionResult(
                command=command_name,
                status=ExecutionStatus.FAILED,
                message=f"命令 /{command_name} 已被禁用",
                error="Command disabled",
                duration_ms=(time.time() - start_time) * 1000,
            ))

        # 3. 验证参数
        validation_error = self._validate_args(command, args)
        if validation_error:
            return self._record_result(ExecutionResult(
                command=command_name,
                status=ExecutionStatus.FAILED,
                message=validation_error,
                error="Invalid arguments",
                duration_ms=(time.time() - start_time) * 1000,
            ))

        # 4. 调用 handler
        handler = self._handlers.get(command.handler)
        if handler is None:
            return self._record_result(ExecutionResult(
                command=command_name,
                status=ExecutionStatus.FAILED,
                message=f"命令 /{command_name} 的 handler 未注册: {command.handler}",
                error=f"Handler not found: {command.handler}",
                duration_ms=(time.time() - start_time) * 1000,
            ))

        try:
            result = handler(command, args, context)
            result.command = command_name
            result.duration_ms = (time.time() - start_time) * 1000
            return self._record_result(result)
        except Exception as e:
            logger.exception(f"执行命令 /{command_name} 失败: {e}")
            return self._record_result(ExecutionResult(
                command=command_name,
                status=ExecutionStatus.FAILED,
                message=f"执行命令 /{command_name} 时发生异常: {str(e)}",
                error=str(e),
                duration_ms=(time.time() - start_time) * 1000,
            ))

    def get_history(self, limit: int = 50) -> List[ExecutionResult]:
        """获取执行历史"""
        return self._history[-limit:]

    def clear_history(self) -> None:
        """清空历史"""
        self._history.clear()

    # ============================================================
    # 内部方法
    # ============================================================

    def _validate_args(
        self, command: SlashCommand, args: List[str]
    ) -> Optional[str]:
        """验证参数，返回错误消息或 None"""
        required = [a for a in command.args if a.required]
        if len(args) < len(required):
            missing = ", ".join(a.name for a in required[len(args):])
            return f"缺少必需参数: {missing} (usage: {command.shortcut})"

        # 验证 choices
        for i, arg_def in enumerate(command.args):
            if i < len(args) and arg_def.choices:
                if args[i] not in arg_def.choices:
                    return f"参数 {arg_def.name} 的值 {args[i]} 不在可选范围内: {arg_def.choices}"

        return None

    def _record_result(self, result: ExecutionResult) -> ExecutionResult:
        """记录结果到历史"""
        self._history.append(result)
        # 限制历史大小
        if len(self._history) > 500:
            self._history = self._history[-500:]
        return result


# 全局单例
_executor_instance: Optional[SlashCommandExecutor] = None


def get_executor() -> SlashCommandExecutor:
    """获取全局执行器单例"""
    global _executor_instance
    if _executor_instance is None:
        _executor_instance = SlashCommandExecutor()
    return _executor_instance
