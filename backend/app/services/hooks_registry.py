"""
# ============================================================
# Hooks 配置管理 (v1.1.0) - Cycle 5 P0-6 Hook 事件深度集成
# ============================================================
# 核心作用：定义和管理 10 类 Hook 事件配置，支持 TOML/JSON 加载
#           仿照 Codex v0.150+ Hooks 规范设计
# 运行流程：
#   1. 定义 10 种 HookEventType 事件类型
#   2. HookConfig 描述单个 hook（matcher + hooks 列表）
#   3. HooksRegistry 管理多个 hook 配置 + 事件分发
#   4. v1.1.0 新增：Codex 风格 hookSpecificOutput 解析
#      - additionalContext 注入到 LLM context
#      - permissionDecision 覆盖默认权限决策
# 输入参数：见各 dataclass
# 输出结果：HooksRegistry 实例
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 4 P0-4 新建 - 仿照 Codex Hooks 设计
#   - 2026-07-27 | v1.1.0 | Cycle 5 P0-6 新增 hookSpecificOutput 解析 + hook_name 字段
# ============================================================
"""

import json
import logging
import os
import re
import subprocess
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Union

logger = logging.getLogger(__name__)


# ============================================================
# HookEventType - 10 类事件类型
# ============================================================
class HookEventType(str, Enum):
    """
    Hook 事件类型枚举（仿照 Codex v0.150+ Hooks 规范）

    10 类事件覆盖整个 LLM 工具调用生命周期：
      - 会话级：SessionStart / UserPromptSubmit / SessionEnd
      - 工具级：PreToolUse / PostToolUse / PermissionRequest
      - 上下文级：PreCompact / PostCompact
      - SubAgent 级：SubagentStart / SubagentStop
    """
    SESSION_START = "SessionStart"        # 会话开始时触发
    USER_PROMPT_SUBMIT = "UserPromptSubmit"  # 用户消息提交时触发
    PRE_TOOL_USE = "PreToolUse"          # 工具调用前触发
    POST_TOOL_USE = "PostToolUse"        # 工具调用后触发
    PERMISSION_REQUEST = "PermissionRequest"  # 权限请求时触发
    PRE_COMPACT = "PreCompact"           # 上下文压缩前触发
    POST_COMPACT = "PostCompact"         # 上下文压缩后触发
    SUBAGENT_START = "SubagentStart"     # SubAgent 启动时触发
    SUBAGENT_STOP = "SubagentStop"       # SubAgent 停止时触发
    SESSION_END = "SessionEnd"           # 会话结束时触发

    @classmethod
    def all_events(cls) -> List[str]:
        """返回所有事件名列表"""
        return [e.value for e in cls]


# ============================================================
# HookAction - Hook 执行结果
# ============================================================
@dataclass
class HookAction:
    """
    Hook 执行结果对象

    字段：
      - exit_code: 进程退出码（0=成功，2=阻塞强制 retry，其他=警告）
      - stdout: 标准输出
      - stderr: 标准错误
      - json_output: 结构化输出（如果 hook 输出 JSON）
      - hook_specific_output: Codex 风格 hookSpecificOutput JSON
          (例: {"hookEventName": "PreToolUse", "additionalContext": "...", "permissionDecision": "allow"})
      - additional_context: 从 hook_specific_output 提取的额外上下文
      - permission_decision: 从 hook_specific_output 提取的权限决策 (allow/deny/ask)
      - duration_ms: 执行耗时（毫秒）
      - error: 错误信息（异常时填充）
    """
    exit_code: int = 0
    stdout: str = ""
    stderr: str = ""
    json_output: Optional[Dict[str, Any]] = None
    # v1.1.0 Cycle 5 P0-6 新增：Codex 风格 hookSpecificOutput 支持
    hook_specific_output: Optional[Dict[str, Any]] = None
    additional_context: Optional[str] = None
    permission_decision: Optional[str] = None
    duration_ms: float = 0.0
    error: Optional[str] = None
    # v1.1.0 Cycle 5 P0-6 新增：触发该 action 的 hook 名称（dispatch 时填充）
    hook_name: Optional[str] = None

    @property
    def is_blocking(self) -> bool:
        """是否阻塞（exit code 2 = 强制 retry）"""
        return self.exit_code == 2

    @property
    def is_success(self) -> bool:
        """是否成功（exit code 0）"""
        return self.exit_code == 0

    @property
    def is_error(self) -> bool:
        """是否错误（exit code != 0）"""
        return self.exit_code != 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "exit_code": self.exit_code,
            "stdout": self.stdout[:500] if self.stdout else "",
            "stderr": self.stderr[:500] if self.stderr else "",
            "json_output": self.json_output,
            "hook_specific_output": self.hook_specific_output,
            "additional_context": self.additional_context,
            "permission_decision": self.permission_decision,
            "duration_ms": self.duration_ms,
            "error": self.error,
            "is_blocking": self.is_blocking,
            "is_success": self.is_success,
            "hook_name": self.hook_name,
        }


# ============================================================
# HookDefinition - 单个 hook 定义
# ============================================================
@dataclass
class HookDefinition:
    """
    单个 hook 定义

    字段：
      - type: hook 类型（"command" / "prompt" / "function"）
          - command: 执行 shell 命令
          - prompt: 通过 LLM 决定行为
          - function: 内置 Python 函数（高级用法）
      - command: shell 命令字符串
      - timeout: 超时时间（秒，默认 60s）
      - env: 附加环境变量
      - cwd: 工作目录（可选）
      - name: 友好名称（用于日志/调试）
    """
    type: str = "command"  # command / prompt / function
    command: str = ""
    timeout: int = 60
    env: Dict[str, str] = field(default_factory=dict)
    cwd: Optional[str] = None
    name: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type,
            "command": self.command,
            "timeout": self.timeout,
            "env": self.env,
            "cwd": self.cwd,
            "name": self.name or self.command[:30],
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "HookDefinition":
        return cls(
            type=data.get("type", "command"),
            command=data.get("command", ""),
            timeout=data.get("timeout", 60),
            env=data.get("env", {}),
            cwd=data.get("cwd"),
            name=data.get("name"),
        )


# ============================================================
# HookConfig - 事件 + matcher + hooks 列表
# ============================================================
@dataclass
class HookConfig:
    """
    事件级别 hook 配置

    字段：
      - event: HookEventType 事件类型
      - matcher: 匹配模式（正则表达式，可选）
          - 工具类事件：匹配 tool_name
          - 用户类事件：匹配用户输入
          - 空字符串 = 全部匹配
      - hooks: 该 matcher 下挂载的 hook 列表
      - block_on_error: v1.2.0 Cycle 9 P0-18 新增：任何 hook 失败时是否阻塞
                       失败包括 exit_code != 0 与异常
    """
    event: str  # HookEventType value
    matcher: str = ""
    hooks: List[HookDefinition] = field(default_factory=list)
    block_on_error: bool = False  # v1.2.0 Cycle 9 P0-18 新增

    def matches(self, payload: Dict[str, Any]) -> bool:
        """
        判断 payload 是否匹配该 hook 配置

        参数：
          - payload: 事件 payload（包含 tool_name / user_input 等字段）
        返回值：是否匹配
        """
        if not self.matcher:
            return True  # 空 matcher = 全部匹配

        # 工具类事件：匹配 tool_name
        if "tool_name" in payload:
            return bool(re.search(self.matcher, str(payload["tool_name"])))

        # 用户类事件：匹配用户输入
        if "user_input" in payload:
            return bool(re.search(self.matcher, str(payload["user_input"])))

        return False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "event": self.event,
            "matcher": self.matcher,
            "hooks": [h.to_dict() for h in self.hooks],
            "block_on_error": self.block_on_error,  # v1.2.0 Cycle 9 P0-18 新增
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "HookConfig":
        return cls(
            event=data.get("event", ""),
            matcher=data.get("matcher", ""),
            hooks=[HookDefinition.from_dict(h) for h in data.get("hooks", [])],
            block_on_error=bool(data.get("block_on_error", False)),  # v1.2.0
        )


# ============================================================
# HooksRegistry - Hooks 注册表（核心）
# ============================================================
class HooksRegistry:
    """
    Hooks 注册表

    核心功能：
      1. 加载 hooks 配置（from JSON / TOML / dict）
      2. 触发事件（dispatch）：根据 event + payload 调用匹配的 hooks
      3. 支持 match 模式（tool_name / user_input 正则）
      4. 支持 4 种输出：exit code 0/2/其他/异常

    使用方式：
      registry = HooksRegistry()
      registry.load_from_dict({
          "hooks": [
              {
                  "event": "PreToolUse",
                  "matcher": "Bash|Write",
                  "hooks": [
                      {"type": "command", "command": "echo 'blocked' >&2", "timeout": 5}
                  ]
              }
          ]
      })
      result = await registry.dispatch("PreToolUse", {"tool_name": "Bash"})
    """

    def __init__(self, config_path: Optional[Union[str, Path]] = None):
        """
        初始化 Hooks 注册表

        参数：
          - config_path: 配置文件路径（可选，支持 .json / .toml）
        """
        self._configs: List[HookConfig] = []
        self._history: List[Dict[str, Any]] = []  # 触发历史
        self._max_history = 200
        if config_path:
            self.load_from_file(config_path)

    def load_from_file(self, path: Union[str, Path]) -> None:
        """
        从文件加载 hook 配置

        支持格式：
          - .json：标准 JSON
          - .toml：TOML 格式（需 tomli 或 tomllib）
          - 其他：尝试 JSON 解析
        """
        path = Path(path)
        if not path.exists():
            logger.warning(f"Hooks 配置文件不存在: {path}")
            return

        content = path.read_text(encoding="utf-8")
        if path.suffix == ".toml":
            try:
                # Python 3.11+ tomllib, fallback tomli
                try:
                    import tomllib
                    data = tomllib.loads(content)
                except ImportError:
                    import tomli
                    data = tomli.loads(content)
            except ImportError:
                logger.warning("TOML 库不可用，尝试作为 JSON 解析")
                data = json.loads(content)
        else:
            data = json.loads(content)

        self.load_from_dict(data)
        logger.info(f"已加载 Hooks 配置: {path}, 共 {len(self._configs)} 个事件配置")

    def load_from_dict(self, data: Dict[str, Any]) -> None:
        """
        从 dict 加载 hook 配置

        参数：
          - data: 形如 {"hooks": [{"event": "...", "matcher": "...", "hooks": [...]}]}
        """
        # 支持直接是 list 或 dict
        if isinstance(data, list):
            items = data
        else:
            items = data.get("hooks", [])

        for item in items:
            try:
                config = HookConfig.from_dict(item)
                if config.event:
                    self._configs.append(config)
            except Exception as e:
                logger.error(f"加载 hook 配置失败: {e}, item={item}")

    def add(self, config: HookConfig) -> None:
        """添加单个 hook 配置"""
        self._configs.append(config)

    def load_from_directory(
        self,
        project_path: Union[str, Path],
        clear_existing: bool = False,
    ) -> int:
        """v1.2.0 Cycle 9 P0-18 新增：从 .trae/hooks/ 目录加载

        Args:
            project_path: 项目根目录
            clear_existing: 是否先清空已有配置

        Returns:
            加载的 hook 配置数量
        """
        # 局部导入避免循环依赖
        from .trae_hooks_loader import TraeHooksLoader

        if clear_existing:
            self._configs.clear()

        loader = TraeHooksLoader(project_path)
        configs = loader.load()
        for cfg in configs:
            self._configs.append(cfg)
        return len(configs)

    def clear(self) -> None:
        """清空所有配置"""
        self._configs.clear()
        self._history.clear()

    @property
    def configs(self) -> List[HookConfig]:
        """返回所有 hook 配置（只读视图）"""
        return list(self._configs)

    def get_configs_for_event(self, event: str) -> List[HookConfig]:
        """返回某事件的所有配置（已按 matcher 顺序）"""
        return [c for c in self._configs if c.event == event]

    async def dispatch(
        self,
        event: str,
        payload: Dict[str, Any],
    ) -> List[HookAction]:
        """
        触发一个事件，同步执行所有匹配的 hook

        参数：
          - event: HookEventType value
          - payload: 事件数据
              - PreToolUse: {"tool_name": "...", "arguments": {...}}
              - PostToolUse: {"tool_name": "...", "result": ..., "duration_ms": ...}
              - SessionStart: {"session_id": "...", "user_id": "..."}
              - UserPromptSubmit: {"user_input": "...", "session_id": "..."}
              - PermissionRequest: {"tool_name": "...", "arguments": {...}}
              - PreCompact / PostCompact: {"trigger": "...", "context_size": ...}
              - SubagentStart / SubagentStop: {"subagent_id": "...", "task": "..."}
              - SessionEnd: {"session_id": "...", "duration_ms": ...}

        返回值：所有执行的 hook 的 HookAction 列表
        """
        if event not in HookEventType.all_events():
            logger.warning(f"未知 Hook 事件类型: {event}")
            return []

        results: List[HookAction] = []
        matched_configs = self.get_configs_for_event(event)

        for config in matched_configs:
            if not config.matches(payload):
                continue

            for hook_def in config.hooks:
                action = await self._execute_hook(hook_def, event, payload)
                # v1.1.0 Cycle 5 P0-6 新增：在 action 上记录 hook_name 供链路追溯
                action.hook_name = hook_def.name or hook_def.command[:30]
                results.append(action)

                # 记录到历史
                self._record_history(event, payload, hook_def, action)

                # 如果是阻塞（exit code 2），停止后续 hook
                if action.is_blocking:
                    logger.warning(
                        f"Hook 阻塞（exit=2）: event={event}, "
                        f"command={hook_def.command[:50]}"
                    )
                    return results

                # v1.2.0 Cycle 9 P0-18 新增：block_on_error 检查
                # 任一 hook 失败（非 0 退出或异常）时停止后续 hook
                if config.block_on_error and not action.is_success:
                    logger.warning(
                        f"Hook 失败且配置 block_on_error: event={event}, "
                        f"hook={action.hook_name}, exit={action.exit_code}, "
                        f"error={action.error}"
                    )
                    return results

        return results

    async def _execute_hook(
        self,
        hook_def: HookDefinition,
        event: str,
        payload: Dict[str, Any],
    ) -> HookAction:
        """
        执行单个 hook

        支持 3 种类型：
          - command: shell 命令
          - prompt: 暂不实现（仅占位）
          - function: 暂不实现（仅占位）

        参数：
          - hook_def: hook 定义
          - event: 事件名
          - payload: 事件数据
        返回值：HookAction
        """
        import asyncio
        import time

        if hook_def.type != "command":
            return HookAction(
                exit_code=0,
                error=f"Hook 类型 {hook_def.type} 暂不支持（仅支持 command）",
            )

        if not hook_def.command:
            return HookAction(exit_code=0, error="空命令")

        # 构造 payload JSON（通过 stdin 传递）
        payload_json = json.dumps(payload, ensure_ascii=False)

        # 构造环境变量
        env = os.environ.copy()
        env["HERMES_HOOK_EVENT"] = event
        env["HERMES_PAYLOAD"] = payload_json
        env["HERMES_HOOK_TYPE"] = hook_def.type
        env["HERMES_HOOK_NAME"] = hook_def.name or "unnamed"
        env.update(hook_def.env)

        start_time = time.time()
        try:
            proc = await asyncio.create_subprocess_shell(
                hook_def.command,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                cwd=hook_def.cwd,
            )
            try:
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    proc.communicate(input=payload_json.encode("utf-8")),
                    timeout=hook_def.timeout,
                )
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                duration = (time.time() - start_time) * 1000
                return HookAction(
                    exit_code=124,  # timeout exit code
                    error=f"Hook 超时（>{hook_def.timeout}s）",
                    duration_ms=duration,
                )

            stdout = stdout_bytes.decode("utf-8", errors="replace").strip()
            stderr = stderr_bytes.decode("utf-8", errors="replace").strip()
            duration = (time.time() - start_time) * 1000

            # 尝试解析 JSON 输出
            json_output = None
            hook_specific_output = None
            additional_context = None
            permission_decision = None
            if stdout and stdout.startswith("{"):
                try:
                    json_output = json.loads(stdout)
                    # v1.1.0 Cycle 5 P0-6 新增：解析 Codex 风格 hookSpecificOutput
                    if isinstance(json_output, dict):
                        hso = json_output.get("hookSpecificOutput")
                        if isinstance(hso, dict):
                            hook_specific_output = hso
                            additional_context = hso.get("additionalContext")
                            permission_decision = hso.get("permissionDecision")
                except json.JSONDecodeError:
                    pass

            return HookAction(
                exit_code=proc.returncode or 0,
                stdout=stdout,
                stderr=stderr,
                json_output=json_output,
                hook_specific_output=hook_specific_output,
                additional_context=additional_context,
                permission_decision=permission_decision,
                duration_ms=duration,
            )

        except Exception as e:
            duration = (time.time() - start_time) * 1000
            logger.error(f"Hook 执行异常: {e}")
            return HookAction(
                exit_code=1,
                error=str(e),
                duration_ms=duration,
            )

    def _record_history(
        self,
        event: str,
        payload: Dict[str, Any],
        hook_def: HookDefinition,
        action: HookAction,
    ) -> None:
        """记录到历史（用于调试和审计）"""
        entry = {
            "event": event,
            "payload_keys": list(payload.keys()),
            "hook_name": hook_def.name or hook_def.command[:30],
            "exit_code": action.exit_code,
            "duration_ms": action.duration_ms,
            "error": action.error,
        }
        self._history.append(entry)
        if len(self._history) > self._max_history:
            self._history = self._history[-self._max_history:]

    @property
    def history(self) -> List[Dict[str, Any]]:
        """返回触发历史（最近 200 条）"""
        return list(self._history)

    def get_summary(self) -> Dict[str, Any]:
        """
        返回注册表摘要信息

        返回值：{
            "total_configs": int,
            "events": List[str],
            "hooks_per_event": Dict[str, int],
            "history_count": int
        }
        """
        events = HookEventType.all_events()
        hooks_per_event = {
            event: sum(
                len(c.hooks)
                for c in self._configs
                if c.event == event
            )
            for event in events
        }
        return {
            "total_configs": len(self._configs),
            "events": events,
            "hooks_per_event": hooks_per_event,
            "history_count": len(self._history),
        }


# ============================================================
# 全局单例
# ============================================================
_global_registry: Optional[HooksRegistry] = None


def get_hooks_registry() -> HooksRegistry:
    """
    获取全局 Hooks 注册表（单例）

    返回值：HooksRegistry 实例
    """
    global _global_registry
    if _global_registry is None:
        _global_registry = HooksRegistry()
        # 尝试加载默认配置
        default_path = Path.home() / ".hermes" / "hooks.json"
        if default_path.exists():
            _global_registry.load_from_file(default_path)
    return _global_registry


def reset_hooks_registry() -> None:
    """重置全局注册表（用于测试）"""
    global _global_registry
    _global_registry = None


# ============================================================
# 便捷装饰器
# ============================================================
def hook(event: str, matcher: str = ""):
    """
    装饰器：注册一个函数为 hook

    使用方式：
        @hook("PreToolUse", matcher="Bash")
        async def my_hook(payload: dict) -> dict:
            return {"exit_code": 0, "message": "ok"}
    """
    def decorator(func: Callable):
        config = HookConfig(
            event=event,
            matcher=matcher,
            hooks=[HookDefinition(
                type="function",
                command=func.__name__,
                name=func.__name__,
            )],
        )
        get_hooks_registry().add(config)
        return func
    return decorator
