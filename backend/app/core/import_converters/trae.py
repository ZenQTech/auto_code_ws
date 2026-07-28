"""
# ============================================================
# Import Converter - TRAE 转换器
# ============================================================
# 核心作用：将 TRAE 的配置/命令/记忆/Skills 转换为 Hermes 格式
# 源路径：~/.trae/
# 数据类型：
#   - settings: settings.json → ~/.hermes/config.toml
#   - mcp_servers: mcp_servers.json → ~/.hermes/mcp_servers.json
#   - commands: commands/*.md (3 级目录嵌套) → ~/.hermes/commands/
#   - memories: memory/*.md → ~/.hermes/memory/
#   - plugins: plugins/* → ~/.hermes/plugins/
# 输入参数：源路径（默认 ~/.trae/）
# 输出结果：Hermes 格式的数据
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P3-1 新建
# ============================================================
"""

import json
import re
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


# 极简 YAML 解析器（仅支持 key: value 格式）
def _simple_yaml_parse(text: str) -> Dict[str, Any]:
    """极简 YAML 解析器（key: value 格式）

    支持：
      - 顶层 key: value
      - 嵌套（2 spaces 缩进）
    """
    result: Dict[str, Any] = {}
    lines = text.split("\n")
    stack = [(0, result)]
    current_dict = result

    for line in lines:
        if not line.strip() or line.strip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        content = line.strip()
        if ":" not in content:
            continue
        key, _, value = content.partition(":")
        key = key.strip()
        value = value.strip()

        # 调整 stack
        while stack and stack[-1][0] >= indent:
            stack.pop()
        if stack:
            current_dict = stack[-1][1]

        if not value:
            # 嵌套
            new_dict: Dict[str, Any] = {}
            if key in current_dict and isinstance(current_dict[key], dict):
                current_dict[key].update(new_dict)
                new_dict = current_dict[key]
            else:
                current_dict[key] = new_dict
            stack.append((indent, new_dict))
        else:
            parsed = _parse_yaml_value(value)
            current_dict[key] = parsed

    return result


def _parse_yaml_value(value: str) -> Any:
    if value.startswith('"') and value.endswith('"'):
        return value[1:-1]
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1]
    if value in ("true", "True"):
        return True
    if value in ("false", "False"):
        return False
    if value in ("null", "~", ""):
        return None
    try:
        if "." in value:
            return float(value)
        return int(value)
    except ValueError:
        pass
    return value


class TraeConverter(BaseConverter):
    """TRAE 转换器

    读取 ~/.trae/ 下的 settings.json / mcp_servers.json / commands/ / memory/ / plugins/
    转换为 Hermes 内部格式。
    """

    def __init__(self, install_path: Optional[Path] = None):
        super().__init__(ImportSource.TRAE)
        self.install_path = install_path or self._default_install_path()

    def _default_install_path(self) -> Path:
        return Path.home() / ".trae"

    def detect(self) -> DetectedSource:
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
        if (self.install_path / "mcp_servers.json").exists():
            available_types.append(DataType.MCP_SERVERS)
        if (self.install_path / "plugins").exists():
            available_types.append(DataType.PLUGINS)
        cmds_dir = self.install_path / "commands"
        if cmds_dir.exists() and any(cmds_dir.rglob("*.md")):
            available_types.append(DataType.COMMANDS)
        mem_dir = self.install_path / "memory"
        if mem_dir.exists() and any(mem_dir.rglob("*.md")):
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
        """TRAE 版本从 package.json 读取"""
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
        elif data_type == DataType.COMMANDS:
            return self._list_commands()
        elif data_type == DataType.MEMORIES:
            return self._list_memories()
        return []

    def _list_settings(self) -> List[ImportPreviewItem]:
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
                "TRAE settings JSON 转换为 Hermes TOML",
                "agent.* 字段映射到 Hermes agents",
            ],
        )]

    def _list_mcp_servers(self) -> List[ImportPreviewItem]:
        mcp_file = self.install_path / "mcp_servers.json"
        if not mcp_file.exists():
            return []
        valid, size = _validate_file_size(mcp_file)
        if not valid:
            return []
        data, _ = _safe_read_json(mcp_file)
        servers = data.get("mcpServers", data) if data else {}
        return [ImportPreviewItem(
            source=self.source,
            data_type=DataType.MCP_SERVERS,
            source_path=str(mcp_file),
            target_path="~/.hermes/mcp_servers.json",
            size_bytes=size,
            item_count=len(servers) if isinstance(servers, dict) else 0,
            transform_notes=["结构与 Hermes 兼容，直接保留"],
        )]

    def _list_plugins(self) -> List[ImportPreviewItem]:
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
                    target_path=f"~/.hermes/plugins/{_safe_name(plugin_dir.name)}/",
                    size_bytes=size,
                    item_count=1,
                    transform_notes=["TRAE 插件复制到 Hermes 插件目录"],
                ))
        return items

    def _list_commands(self) -> List[ImportPreviewItem]:
        """TRAE commands 支持 3 级嵌套（v3.5.55+）"""
        cmds_dir = self.install_path / "commands"
        if not cmds_dir.exists():
            return []
        items = []
        for cmd_file in cmds_dir.rglob("*.md"):
            valid, size = _validate_file_size(cmd_file)
            if not valid:
                continue
            rel = cmd_file.relative_to(cmds_dir)
            depth = len(rel.parts) - 1
            items.append(ImportPreviewItem(
                source=self.source,
                data_type=DataType.COMMANDS,
                source_path=str(cmd_file),
                target_path=f"~/.hermes/commands/{_safe_name(str(rel))}",
                size_bytes=size,
                item_count=1,
                transform_notes=[
                    f"嵌套深度: {depth} 级（TRAE 支持 3 级）",
                    "保持目录结构",
                ],
            ))
        return items

    def _list_memories(self) -> List[ImportPreviewItem]:
        mem_dir = self.install_path / "memory"
        if not mem_dir.exists():
            return []
        items = []
        for mem_file in mem_dir.rglob("*.md"):
            valid, size = _validate_file_size(mem_file)
            if not valid:
                continue
            items.append(ImportPreviewItem(
                source=self.source,
                data_type=DataType.MEMORIES,
                source_path=str(mem_file),
                target_path=f"~/.hermes/memory/{_safe_name(str(mem_file.relative_to(mem_dir)))}",
                size_bytes=size,
                item_count=1,
                transform_notes=[
                    "TRAE memory 映射为 Hermes memory",
                    "Dual-Track Memory 系统兼容",
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
            if data_type == DataType.COMMANDS:
                rel = source_path.relative_to(self.install_path / "commands")
                target = f"~/.hermes/commands/{_safe_name(str(rel))}"
            else:
                target = f"~/.hermes/{data_type.value}/{_safe_name(source_path.name)}"
            return Path(target), content.encode("utf-8")

    def _convert_settings(self, source_path: Path) -> Tuple[Path, bytes]:
        data, err = _safe_read_json(source_path)
        if err:
            raise ValueError(err)

        lines = ["# Hermes config.toml (imported from TRAE)", ""]
        for key, val in data.items():
            if isinstance(val, (str, int, float, bool)):
                lines.append(f"{key} = {json.dumps(val, ensure_ascii=False)}")
            elif isinstance(val, dict):
                lines.append(f"[{key}]")
                for k, v in val.items():
                    if isinstance(v, (str, int, float, bool)):
                        lines.append(f"{k} = {json.dumps(v, ensure_ascii=False)}")
                lines.append("")

        return Path("~/.hermes/config.toml"), "\n".join(lines).encode("utf-8")

    def _convert_mcp_servers(self, source_path: Path) -> Tuple[Path, bytes]:
        data, err = _safe_read_json(source_path)
        if err:
            raise ValueError(err)
        if "mcpServers" not in data:
            data = {"mcpServers": data}
        return Path("~/.hermes/mcp_servers.json"), json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")

    def _convert_memories(self, source_path: Path) -> Tuple[Path, bytes]:
        content, err = _safe_read_text(source_path)
        if err:
            raise ValueError(err)
        if not content.startswith("---"):
            frontmatter = (
                "---\n"
                "source: trae\n"
                "type: memory\n"
                f"imported_at: {__import__('datetime').datetime.now().isoformat()}\n"
                "---\n\n"
            )
            content = frontmatter + content
        rel = source_path.relative_to(self.install_path / "memory")
        return Path(f"~/.hermes/memory/{_safe_name(str(rel))}"), content.encode("utf-8")
