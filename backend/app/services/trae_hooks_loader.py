"""
# ============================================================
# Trae Hooks Directory Loader (Cycle 9 P0-18)
# ============================================================
# 核心作用：实现 TRAE v3.5.66 / Codex 规范的 .trae/hooks/ 目录加载
#           将项目级 .sh shell 命令注册为 HookDefinition
# 目录结构：
#   .trae/hooks/
#   ├── pre-tool/
#   │   ├── security-check.sh
#   │   └── format-validator.sh
#   ├── post-tool/
#   │   └── log-execution.sh
#   ├── pre-commit/
#   │   └── run-tests.sh
#   ├── session-start/
#   │   └── load-context.sh
#   └── ...
# 文件格式（frontmatter，可选）：
#   ---
#   matcher: "Write|Edit"             # 工具名正则
#   timeout: 30                       # 超时秒数
#   block_on_error: true              # 错误时是否阻塞
#   env:                              # 附加环境变量
#     LOG_LEVEL: info
#   ---
#   #!/bin/bash
#   echo "Running security check..."
#   exit 0
# 输入参数：项目根目录或 .trae/hooks/ 目录
# 输出结果：HookConfig 列表
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 9 P0-18 初始化
# ============================================================
"""

from __future__ import annotations

import logging
import re
import shlex
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from .hooks_registry import HookConfig, HookDefinition, HookEventType

logger = logging.getLogger(__name__)


# ============================================================
# Frontmatter 解析（与 project_agents/parser.py 类似但更轻量）
# ============================================================
_TRAE_FRONTMATTER_RE = re.compile(
    r"\A---\s*\n(?P<fm>.*?)\n---\s*\n?(?P<body>.*)\Z", re.DOTALL
)


def _parse_trae_frontmatter(content: str) -> Dict[str, Any]:
    """解析 .trae/hooks/ shell 脚本的 frontmatter"""
    m = _TRAE_FRONTMATTER_RE.match(content)
    if not m:
        return {}
    fm_text = m.group("fm")
    result: Dict[str, Any] = {}
    for line in fm_text.split("\n"):
        line = line.rstrip()
        if not line.strip() or line.strip().startswith("#"):
            continue
        if line.startswith(" ") or line.startswith("\t"):
            continue
        kv = re.match(r"^([A-Za-z_][A-Za-z0-9_\-]*)\s*:\s*(.*)$", line)
        if not kv:
            continue
        key = kv.group(1)
        val = kv.group(2).strip()
        # 布尔
        if val.lower() in ("true", "yes", "on"):
            result[key] = True
        elif val.lower() in ("false", "no", "off"):
            result[key] = False
        # 数字
        elif re.match(r"^-?\d+$", val):
            result[key] = int(val)
        # 引号字符串
        elif (val.startswith('"') and val.endswith('"')) or (
            val.startswith("'") and val.endswith("'")
        ):
            result[key] = val[1:-1]
        else:
            result[key] = val
    return result


# ============================================================
# 事件类型目录名映射
# ============================================================
# .trae/hooks/<dir_name>/ -> HookEventType
# 支持 kebab-case 与原值两种形式
EVENT_DIR_MAP: Dict[str, str] = {
    "pre-tool": HookEventType.PRE_TOOL_USE.value,
    "post-tool": HookEventType.POST_TOOL_USE.value,
    "pre-commit": HookEventType.PRE_TOOL_USE.value,  # 兼容：映射到 PreToolUse
    "post-commit": HookEventType.POST_TOOL_USE.value,
    "session-start": HookEventType.SESSION_START.value,
    "session-end": HookEventType.SESSION_END.value,
    "user-prompt-submit": HookEventType.USER_PROMPT_SUBMIT.value,
    "pre-compact": HookEventType.PRE_COMPACT.value,
    "post-compact": HookEventType.POST_COMPACT.value,
    "subagent-start": HookEventType.SUBAGENT_START.value,
    "subagent-stop": HookEventType.SUBAGENT_STOP.value,
    "permission-request": HookEventType.PERMISSION_REQUEST.value,
}


# ============================================================
# 目录扫描器
# ============================================================
class TraeHooksLoader:
    """TRAE 风格 .trae/hooks/ 目录加载器

    Usage:
        loader = TraeHooksLoader("/path/to/project")
        configs = loader.load()  # List[HookConfig]
        for cfg in configs:
            registry.add(cfg)
    """

    HOOKS_DIRNAME = ".trae"
    HOOKS_SUBDIR = "hooks"

    def __init__(self, project_path: Union[str, Path]):
        """初始化加载器

        Args:
            project_path: 项目根目录绝对路径
        """
        self.project_path = Path(project_path).absolute()
        self.hooks_dir = self.project_path / self.HOOKS_DIRNAME / self.HOOKS_SUBDIR

    @property
    def hooks_dir_exists(self) -> bool:
        """hooks 目录是否存在"""
        return self.hooks_dir.is_dir()

    def load(self) -> List[HookConfig]:
        """加载 .trae/hooks/ 目录下所有 hook 配置

        Returns:
            HookConfig 列表
        """
        if not self.hooks_dir_exists:
            return []
        configs: List[HookConfig] = []
        for sh_file in self.hooks_dir.rglob("*.sh"):
            cfg = self._parse_hook_file(sh_file)
            if cfg:
                configs.append(cfg)
        logger.info(
            f"Loaded {len(configs)} hook configs from {self.hooks_dir}"
        )
        return configs

    def load_with_errors(self) -> tuple:
        """加载并报告错误

        Returns:
            (configs, errors) - (HookConfig 列表, [(file_path, error_msg), ...])
        """
        if not self.hooks_dir_exists:
            return [], []
        configs: List[HookConfig] = []
        errors: List[tuple] = []
        for sh_file in self.hooks_dir.rglob("*.sh"):
            try:
                cfg = self._parse_hook_file(sh_file)
                if cfg:
                    configs.append(cfg)
            except Exception as e:
                errors.append((str(sh_file), str(e)))
        return configs, errors

    def _parse_hook_file(self, file_path: Path) -> Optional[HookConfig]:
        """解析单个 .sh 文件

        Args:
            file_path: 脚本文件绝对路径

        Returns:
            HookConfig 或 None（无法识别的事件类型）
        """
        # 从目录名识别事件类型
        rel = file_path.relative_to(self.hooks_dir)
        parts = rel.parts
        if len(parts) < 2:
            logger.warning(f"Hook script not in event subdir: {file_path}")
            return None

        event_dir_name = parts[0]
        event_name = EVENT_DIR_MAP.get(event_dir_name)
        if not event_name:
            logger.warning(
                f"Unknown event dir: {event_dir_name}, file={file_path}"
            )
            return None

        try:
            content = file_path.read_text(encoding="utf-8")
        except Exception as e:
            logger.error(f"Failed to read {file_path}: {e}")
            return None

        fm = _parse_trae_frontmatter(content)
        matcher = str(fm.get("matcher", ""))
        timeout = int(fm.get("timeout", 60))
        block_on_error = bool(fm.get("block_on_error", False))
        env_raw = fm.get("env", {})
        env: Dict[str, str] = {}
        if isinstance(env_raw, dict):
            env = {str(k): str(v) for k, v in env_raw.items()}

        # 文件名（去 .sh）作为 hook name
        hook_name = file_path.stem

        # command 为绝对路径
        cmd = str(file_path.absolute())

        # 设置可执行（如果尚未）
        try:
            if not file_path.stat().st_mode & 0o111:
                file_path.chmod(0o755)
        except Exception as e:
            logger.warning(f"Failed to chmod {file_path}: {e}")

        definition = HookDefinition(
            type="command",
            command=cmd,
            timeout=timeout,
            env=env,
            cwd=str(self.project_path),
            name=hook_name,
        )

        return HookConfig(
            event=event_name,
            matcher=matcher,
            hooks=[definition],
            block_on_error=block_on_error,
        )


# ============================================================
# 工具函数
# ============================================================
def load_trae_hooks(
    project_path: Union[str, Path],
    registry: Optional[Any] = None,
) -> int:
    """便捷函数：扫描项目并加载 hooks

    Args:
        project_path: 项目根目录
        registry: HooksRegistry 实例（可选，None 表示仅返回 configs 不注册）

    Returns:
        加载的配置数量
    """
    loader = TraeHooksLoader(project_path)
    configs = loader.load()
    if registry is not None and hasattr(registry, "load_from_dict"):
        for cfg in configs:
            registry.add(cfg)
    return len(configs)
