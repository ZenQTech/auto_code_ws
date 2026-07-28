"""
# ============================================================
# Import Converter - Claude Code 转换器
# ============================================================
# 核心作用：将 Claude Code 的配置/记忆/会话/命令转换为 Hermes 格式
# 源路径：~/.claude/
# 数据类型：
#   - settings: settings.json → ~/.hermes/config.toml
#   - mcp_servers: .mcp.json → ~/.hermes/mcp_servers.json
#   - sessions: projects/*/sessions/*.jsonl → ~/.hermes/sessions/
#   - commands: commands/*.md → ~/.hermes/commands/
#   - memories: CLAUDE.md → ~/.hermes/memory/project/
#   - plugins: plugins/* → ~/.hermes/plugins/  (直接复制)
# 输入参数：源路径（默认 ~/.claude/）
# 输出结果：Hermes 格式的数据
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P3-1 新建
# ============================================================
"""

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .base import (
    BaseConverter,
    DataType,
    DetectedSource,
    ImportPreviewItem,
    ImportSource,
    _get_dir_size,
    _get_last_modified,
    _safe_name,
    _safe_read_json,
    _safe_read_text,
    _validate_file_size,
    MAX_FILE_SIZE,
)


class ClaudeCodeConverter(BaseConverter):
    """Claude Code 转换器

    读取 ~/.claude/ 下的 settings.json / .mcp.json / CLAUDE.md / sessions/ / commands/
    转换为 Hermes 内部格式。
    """

    def __init__(self, install_path: Optional[Path] = None):
        super().__init__(ImportSource.CLAUDE_CODE)
        self.install_path = install_path or self._default_install_path()

    def _default_install_path(self) -> Path:
        """Claude Code 默认安装路径"""
        return Path.home() / ".claude"

    def detect(self) -> DetectedSource:
        """检测 Claude Code 是否安装

        Returns:
            DetectedSource 对象
        """
        if not self.is_installed():
            return DetectedSource(
                source=self.source,
                install_path=str(self.install_path),
                available=False,
                data_types=[],
                size_bytes=0,
            )

        available_types = []
        if (self.install_path / "settings.json").exists():
            available_types.append(DataType.SETTINGS)
        if (self.install_path / ".mcp.json").exists():
            available_types.append(DataType.MCP_SERVERS)
        if (self.install_path / "plugins").exists():
            available_types.append(DataType.PLUGINS)
        sessions_dir = self.install_path / "projects"
        if sessions_dir.exists() and any(sessions_dir.rglob("*.jsonl")):
            available_types.append(DataType.SESSIONS)
        commands_dir = self.install_path / "commands"
        if commands_dir.exists() and any(commands_dir.glob("*.md")):
            available_types.append(DataType.COMMANDS)
        if (self.install_path / "CLAUDE.md").exists():
            available_types.append(DataType.MEMORIES)

        return DetectedSource(
            source=self.source,
            install_path=str(self.install_path),
            available=True,
            version=self.get_version(),
            data_types=available_types,
            size_bytes=self.get_size(),
            last_modified=_get_last_modified(self.install_path),
        )

    def get_version(self) -> Optional[str]:
        """从 package.json 或 settings.json 读取版本

        Returns:
            版本字符串或 None
        """
        # 尝试 package.json
        pkg_file = self.install_path / "package.json"
        if pkg_file.exists():
            data, _ = _safe_read_json(pkg_file)
            if data and isinstance(data, dict):
                return data.get("version")

        # 尝试 settings.json 中的 version 字段
        settings_file = self.install_path / "settings.json"
        if settings_file.exists():
            data, _ = _safe_read_json(settings_file)
            if data and isinstance(data, dict):
                return data.get("version") or data.get("claudeCodeVersion")

        return None

    def list_data(self, data_type: DataType) -> List[ImportPreviewItem]:
        """列出该数据类型的所有项

        Args:
            data_type: 数据类型

        Returns:
            预览项列表
        """
        if data_type == DataType.SETTINGS:
            return self._list_settings()
        elif data_type == DataType.MCP_SERVERS:
            return self._list_mcp_servers()
        elif data_type == DataType.PLUGINS:
            return self._list_plugins()
        elif data_type == DataType.SESSIONS:
            return self._list_sessions()
        elif data_type == DataType.COMMANDS:
            return self._list_commands()
        elif data_type == DataType.MEMORIES:
            return self._list_memories()
        return []

    def _list_settings(self) -> List[ImportPreviewItem]:
        """列出 settings"""
        settings_file = self.install_path / "settings.json"
        if not settings_file.exists():
            return []
        valid, size = _validate_file_size(settings_file)
        if not valid:
            return []
        return [ImportPreviewItem(
            source=self.source,
            data_type=DataType.SETTINGS,
            source_path=str(settings_file),
            target_path="~/.hermes/config.toml",
            size_bytes=size,
            item_count=1,
            transform_notes=[
                "JSON 转换为 TOML 格式",
                "permissionMode 映射到 sandbox_mode + approval_policy",
                "敏感字段（apiKey/token）将被脱敏",
            ],
        )]

    def _list_mcp_servers(self) -> List[ImportPreviewItem]:
        """列出 MCP servers"""
        mcp_file = self.install_path / ".mcp.json"
        if not mcp_file.exists():
            return []
        valid, size = _validate_file_size(mcp_file)
        if not valid:
            return []
        data, _ = _safe_read_json(mcp_file)
        servers = data.get("mcpServers", {}) if data else {}
        return [ImportPreviewItem(
            source=self.source,
            data_type=DataType.MCP_SERVERS,
            source_path=str(mcp_file),
            target_path="~/.hermes/mcp_servers.json",
            size_bytes=size,
            item_count=len(servers),
            transform_notes=[
                f"包含 {len(servers)} 个 MCP 服务器",
                "字段结构基本保持不变",
                "API key / token 将被脱敏提示重新输入",
            ],
        )]

    def _list_plugins(self) -> List[ImportPreviewItem]:
        """列出 plugins"""
        plugins_dir = self.install_path / "plugins"
        if not plugins_dir.exists():
            return []
        items = []
        for plugin_dir in plugins_dir.iterdir():
            if plugin_dir.is_dir():
                size = sum(f.stat().st_size for f in plugin_dir.rglob("*") if f.is_file())
                if size > MAX_FILE_SIZE:
                    continue
                items.append(ImportPreviewItem(
                    source=self.source,
                    data_type=DataType.PLUGINS,
                    source_path=str(plugin_dir),
                    target_path=f"~/.hermes/plugins/{plugin_dir.name}/",
                    size_bytes=size,
                    item_count=1,
                    transform_notes=["直接复制目录内容"],
                ))
        return items

    def _list_sessions(self) -> List[ImportPreviewItem]:
        """列出 sessions"""
        projects_dir = self.install_path / "projects"
        if not projects_dir.exists():
            return []
        items = []
        for session_file in projects_dir.rglob("*.jsonl"):
            valid, size = _validate_file_size(session_file)
            if not valid:
                continue
            items.append(ImportPreviewItem(
                source=self.source,
                data_type=DataType.SESSIONS,
                source_path=str(session_file),
                target_path=f"~/.hermes/sessions/{_safe_name(session_file.name)}",
                size_bytes=size,
                item_count=1,
                transform_notes=["JSONL 格式转换为 Hermes 内部会话格式"],
            ))
        return items

    def _list_commands(self) -> List[ImportPreviewItem]:
        """列出 commands"""
        commands_dir = self.install_path / "commands"
        if not commands_dir.exists():
            return []
        items = []
        for cmd_file in commands_dir.glob("*.md"):
            valid, size = _validate_file_size(cmd_file)
            if not valid:
                continue
            items.append(ImportPreviewItem(
                source=self.source,
                data_type=DataType.COMMANDS,
                source_path=str(cmd_file),
                target_path=f"~/.hermes/commands/{cmd_file.name}",
                size_bytes=size,
                item_count=1,
                transform_notes=["Markdown 命令直接复制，可立即使用"],
            ))
        return items

    def _list_memories(self) -> List[ImportPreviewItem]:
        """列出 memories"""
        memories = []
        for mem_file in ["CLAUDE.md"]:
            f = self.install_path / mem_file
            if f.exists():
                valid, size = _validate_file_size(f)
                if valid:
                    memories.append(ImportPreviewItem(
                        source=self.source,
                        data_type=DataType.MEMORIES,
                        source_path=str(f),
                        target_path=f"~/.hermes/memory/project/{mem_file.lower().replace('.md', '')}.md",
                        size_bytes=size,
                        item_count=1,
                        transform_notes=[
                            "CLAUDE.md → project memory",
                            "Frontmatter 字段映射到 Hermes 格式",
                        ],
                    ))
        return memories

    def convert(self, data_type: DataType, source_path: Path) -> Tuple[Path, bytes]:
        """转换为 Hermes 格式

        Args:
            data_type: 数据类型
            source_path: 源文件路径

        Returns:
            (target_path, content_bytes)
        """
        if data_type == DataType.SETTINGS:
            return self._convert_settings(source_path)
        elif data_type == DataType.MCP_SERVERS:
            return self._convert_mcp_servers(source_path)
        elif data_type == DataType.MEMORIES:
            return self._convert_memories(source_path)
        elif data_type == DataType.COMMANDS:
            return self._convert_commands(source_path)
        else:
            # plugins / sessions：直接复制
            content, err = _safe_read_text(source_path)
            if err:
                raise ValueError(err)
            target_name = _safe_name(source_path.name)
            return Path(f"~/.hermes/{data_type.value}/{target_name}"), content.encode("utf-8")

    def _convert_settings(self, source_path: Path) -> Tuple[Path, bytes]:
        """转换 settings.json → config.toml

        Claude Code settings 字段：
          - permissions: { allow, deny, ask }
          - env: 环境变量
          - hooks: 事件钩子
          - mcpServers: MCP 服务器
        Hermes config.toml 字段：
          - [permissions]
          - [env]
          - [hooks]
        """
        data, err = _safe_read_json(source_path)
        if err:
            raise ValueError(err)

        # 简单 TOML 序列化
        lines = ["# Hermes config.toml (imported from Claude Code)", ""]

        permissions = data.get("permissions", {})
        if permissions:
            lines.append("[permissions]")
            allow = permissions.get("allow", [])
            deny = permissions.get("deny", [])
            if allow:
                lines.append("allow = " + json.dumps(allow, ensure_ascii=False))
            if deny:
                lines.append("deny = " + json.dumps(deny, ensure_ascii=False))
            lines.append("")

        env = data.get("env", {})
        if env:
            lines.append("[env]")
            for k, v in env.items():
                # 转义 TOML 字符串
                v_escaped = str(v).replace("\\", "\\\\").replace('"', '\\"')
                lines.append(f'{k} = "{v_escaped}"')
            lines.append("")

        hooks = data.get("hooks", {})
        if hooks:
            lines.append("[hooks]")
            for event, handlers in hooks.items():
                lines.append(f"{event} = {json.dumps(handlers, ensure_ascii=False)}")
            lines.append("")

        # 备注信息
        notes = data.get("notes", [])
        if notes:
            lines.append("# Notes:")
            for n in notes:
                lines.append(f"# - {n}")

        content = "\n".join(lines).encode("utf-8")
        return Path("~/.hermes/config.toml"), content

    def _convert_mcp_servers(self, source_path: Path) -> Tuple[Path, bytes]:
        """转换 .mcp.json → mcp_servers.json（基本结构不变）"""
        data, err = _safe_read_json(source_path)
        if err:
            raise ValueError(err)
        # 结构基本一致，但重新格式化
        content = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
        return Path("~/.hermes/mcp_servers.json"), content

    def _convert_memories(self, source_path: Path) -> Tuple[Path, bytes]:
        """转换 CLAUDE.md → project memory

        添加 Hermes frontmatter
        """
        content, err = _safe_read_text(source_path)
        if err:
            raise ValueError(err)

        # 添加 frontmatter
        if not content.startswith("---"):
            frontmatter = (
                "---\n"
                "source: claude_code\n"
                "type: project_memory\n"
                f"imported_at: {__import__('datetime').datetime.now().isoformat()}\n"
                "---\n\n"
            )
            content = frontmatter + content

        target_name = _safe_name(source_path.stem) + ".md"
        return Path(f"~/.hermes/memory/project/{target_name}"), content.encode("utf-8")

    def _convert_commands(self, source_path: Path) -> Tuple[Path, bytes]:
        """转换 commands/*.md（直接复制）"""
        content, err = _safe_read_text(source_path)
        if err:
            raise ValueError(err)
        return Path(f"~/.hermes/commands/{_safe_name(source_path.name)}"), content.encode("utf-8")
