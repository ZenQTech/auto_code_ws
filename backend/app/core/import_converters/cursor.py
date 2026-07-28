"""
# ============================================================
# Import Converter - Cursor 转换器
# ============================================================
# 核心作用：将 Cursor 的配置/MCP/规则转换为 Hermes 格式
# 源路径：~/.cursor/
# 数据类型：
#   - settings: ~/.cursor/User/settings.json → ~/.hermes/config.toml
#   - mcp_servers: ~/.cursor/mcp.json → ~/.hermes/mcp_servers.json
#   - commands: 不支持（Cursor 无 commands 概念）
#   - memories: ~/.cursor/rules/*.md → ~/.hermes/rules/
#   - plugins: ~/.cursor/extensions/* → ~/.hermes/plugins/ (映射)
# 输入参数：源路径（默认 ~/.cursor/）
# 输出结果：Hermes 格式的数据
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P3-1 新建
# ============================================================
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .base import (
    BaseConverter,
    DataType,
    DetectedSource,
    ImportPreviewItem,
    ImportSource,
    _get_last_modified,
    _safe_name,
    _safe_read_json,
    _safe_read_text,
    _validate_file_size,
    MAX_FILE_SIZE,
)


class CursorConverter(BaseConverter):
    """Cursor 转换器

    读取 ~/.cursor/ 下的 settings.json / mcp.json / rules/ / extensions/
    转换为 Hermes 内部格式。
    """

    def __init__(self, install_path: Optional[Path] = None):
        super().__init__(ImportSource.CURSOR)
        self.install_path = install_path or self._default_install_path()

    def _default_install_path(self) -> Path:
        """Cursor 默认安装路径"""
        return Path.home() / ".cursor"

    def detect(self) -> DetectedSource:
        """检测 Cursor 是否安装"""
        if not self.is_installed():
            return DetectedSource(
                source=self.source,
                install_path=str(self.install_path),
                available=False,
                data_types=[],
                size_bytes=0,
            )

        available_types = []
        if (self.install_path / "User" / "settings.json").exists():
            available_types.append(DataType.SETTINGS)
        if (self.install_path / "mcp.json").exists():
            available_types.append(DataType.MCP_SERVERS)
        if (self.install_path / "extensions").exists():
            available_types.append(DataType.PLUGINS)
        rules_dir = self.install_path / "rules"
        if rules_dir.exists() and any(rules_dir.rglob("*.md")):
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
        """从 CLI 或 package.json 读取版本"""
        # 尝试 package.json
        pkg_file = self.install_path / "package.json"
        if pkg_file.exists():
            data, _ = _safe_read_json(pkg_file)
            if data and isinstance(data, dict):
                return data.get("version")
        return None

    def list_data(self, data_type: DataType) -> List[ImportPreviewItem]:
        if data_type == DataType.SETTINGS:
            return self._list_settings()
        elif data_type == DataType.MCP_SERVERS:
            return self._list_mcp_servers()
        elif data_type == DataType.PLUGINS:
            return self._list_plugins()
        elif data_type == DataType.MEMORIES:
            return self._list_memories()
        elif data_type == DataType.COMMANDS:
            return []  # Cursor 无 commands
        elif data_type == DataType.SESSIONS:
            return []  # Cursor 不在文件系统中保存会话
        return []

    def _list_settings(self) -> List[ImportPreviewItem]:
        settings_file = self.install_path / "User" / "settings.json"
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
                "Cursor settings JSON 转换为 Hermes TOML",
                "editor.* 字段映射到 Hermes preferences",
                "extensions.* 转换为插件列表",
            ],
        )]

    def _list_mcp_servers(self) -> List[ImportPreviewItem]:
        mcp_file = self.install_path / "mcp.json"
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
                "结构与 Hermes 兼容",
            ],
        )]

    def _list_plugins(self) -> List[ImportPreviewItem]:
        ext_dir = self.install_path / "extensions"
        if not ext_dir.exists():
            return []
        items = []
        for ext in ext_dir.iterdir():
            if ext.is_dir():
                size = sum(f.stat().st_size for f in ext.rglob("*") if f.is_file())
                if size > MAX_FILE_SIZE:
                    continue
                items.append(ImportPreviewItem(
                    source=self.source,
                    data_type=DataType.PLUGINS,
                    source_path=str(ext),
                    target_path=f"~/.hermes/plugins/{ext.name}/",
                    size_bytes=size,
                    item_count=1,
                    transform_notes=[
                        "Cursor 扩展映射为 Hermes 插件",
                        "仅复制元数据，不复制二进制",
                    ],
                ))
        return items

    def _list_memories(self) -> List[ImportPreviewItem]:
        rules_dir = self.install_path / "rules"
        if not rules_dir.exists():
            return []
        items = []
        for rule_file in rules_dir.rglob("*.md"):
            valid, size = _validate_file_size(rule_file)
            if not valid:
                continue
            items.append(ImportPreviewItem(
                source=self.source,
                data_type=DataType.MEMORIES,
                source_path=str(rule_file),
                target_path=f"~/.hermes/rules/{_safe_name(rule_file.relative_to(rules_dir))}",
                size_bytes=size,
                item_count=1,
                transform_notes=[
                    "Cursor rules 转换为 Hermes rules",
                    "保持目录结构",
                ],
            ))
        return items

    def convert(self, data_type: DataType, source_path: Path) -> Tuple[Path, bytes]:
        if data_type == DataType.SETTINGS:
            return self._convert_settings(source_path)
        elif data_type == DataType.MCP_SERVERS:
            return self._convert_mcp_servers(source_path)
        elif data_type == DataType.MEMORIES:
            return self._convert_memories(source_path)
        else:
            content, err = _safe_read_text(source_path)
            if err:
                raise ValueError(err)
            target_name = _safe_name(source_path.name)
            return Path(f"~/.hermes/{data_type.value}/{target_name}"), content.encode("utf-8")

    def _convert_settings(self, source_path: Path) -> Tuple[Path, bytes]:
        """Cursor settings.json → Hermes config.toml

        Cursor settings 字段特点：使用扁平键如 "editor.fontSize": 14
        需要转换为嵌套结构
        """
        data, err = _safe_read_json(source_path)
        if err:
            raise ValueError(err)

        lines = ["# Hermes config.toml (imported from Cursor)", ""]

        # 处理扁平键（如 editor.fontSize → [editor]\nfontSize = 14）
        sections: Dict[str, Dict[str, Any]] = {}
        top_level: Dict[str, Any] = {}
        for k, v in data.items():
            if isinstance(v, dict):
                # 已经是嵌套结构
                sections[k] = v
            elif "." in k:
                # 扁平键：拆分
                parts = k.split(".", 1)
                section = parts[0]
                key = parts[1]
                if section not in sections:
                    sections[section] = {}
                sections[section][key] = v
            else:
                top_level[k] = v

        # 输出 section
        for section_name, kv in sections.items():
            lines.append(f"[{section_name}]")
            for k, v in kv.items():
                if isinstance(v, (str, int, float, bool)):
                    lines.append(f'{k} = {json.dumps(v, ensure_ascii=False)}')
            lines.append("")

        # 输出顶层字段
        if top_level:
            lines.append("[general]")
            for k, v in top_level.items():
                if isinstance(v, (str, int, float, bool)):
                    lines.append(f'{k} = {json.dumps(v, ensure_ascii=False)}')

        content = "\n".join(lines).encode("utf-8")
        return Path("~/.hermes/config.toml"), content

    def _convert_mcp_servers(self, source_path: Path) -> Tuple[Path, bytes]:
        data, err = _safe_read_json(source_path)
        if err:
            raise ValueError(err)
        content = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
        return Path("~/.hermes/mcp_servers.json"), content

    def _convert_memories(self, source_path: Path) -> Tuple[Path, bytes]:
        """Cursor rules/*.md → Hermes rules/"""
        content, err = _safe_read_text(source_path)
        if err:
            raise ValueError(err)

        if not content.startswith("---"):
            frontmatter = (
                "---\n"
                "source: cursor\n"
                "type: rule\n"
                f"imported_at: {__import__('datetime').datetime.now().isoformat()}\n"
                "---\n\n"
            )
            content = frontmatter + content

        rel_path = source_path.relative_to(self.install_path / "rules")
        target_path = f"~/.hermes/rules/{_safe_name(str(rel_path))}"
        return Path(target_path), content.encode("utf-8")
