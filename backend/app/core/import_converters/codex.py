"""
# ============================================================
# Import Converter - Codex 转换器
# ============================================================
# 核心作用：将 Codex 的配置/AGENTS.md/Skills/Plugins 转换为 Hermes 格式
# 源路径：~/.codex/
# 数据类型：
#   - settings: config.toml → ~/.hermes/config.toml
#   - mcp_servers: config.toml [mcp_servers.*] → ~/.hermes/mcp_servers.json
#   - memories: AGENTS.md → ~/.hermes/memory/project/
#   - skills: skills/*.md → ~/.hermes/skills/
#   - commands: 无（Codex 通过 prompts/）
# 输入参数：源路径（默认 ~/.codex/）
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
    _safe_read_text,
    _validate_file_size,
    MAX_FILE_SIZE,
)


# 极简 TOML 解析器（不依赖外部库）
def _simple_toml_parse(text: str) -> Dict[str, Any]:
    """极简 TOML 解析器

    支持 [section] / key = value（string/int/float/bool/array）
    不支持：多行字符串、复杂嵌套表、注释中的引号
    """
    result: Dict[str, Any] = {}
    current_section: Optional[Dict[str, Any]] = None
    current_key = None

    for line in text.split("\n"):
        line_stripped = line.strip()
        if not line_stripped or line_stripped.startswith("#"):
            continue

        # section header
        m = re.match(r"^\[([^\]]+)\]$", line_stripped)
        if m:
            section_name = m.group(1)
            if "." in section_name:
                parts = section_name.split(".")
                d = result
                for p in parts[:-1]:
                    if p not in d:
                        d[p] = {}
                    d = d[p]
                d[parts[-1]] = {}
                current_section = d[parts[-1]]
            else:
                if section_name not in result:
                    result[section_name] = {}
                current_section = result[section_name]
            continue

        # key = value
        if "=" in line_stripped:
            key, _, value = line_stripped.partition("=")
            key = key.strip()
            value = value.strip()
            parsed = _parse_toml_value(value)
            if current_section is not None:
                current_section[key] = parsed
            else:
                result[key] = parsed
            current_key = key

    return result


def _parse_toml_value(value: str) -> Any:
    """解析 TOML 值"""
    value = value.strip()
    if not value:
        return ""

    # 字符串
    if (value.startswith('"') and value.endswith('"')) or \
       (value.startswith("'") and value.endswith("'")):
        return value[1:-1]

    # 数组
    if value.startswith("[") and value.endswith("]"):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value

    # bool
    if value in ("true", "True"):
        return True
    if value in ("false", "False"):
        return False

    # 数字
    try:
        if "." in value:
            return float(value)
        return int(value)
    except ValueError:
        pass

    return value


class CodexConverter(BaseConverter):
    """Codex 转换器

    读取 ~/.codex/ 下的 config.toml / AGENTS.md / skills/ 等
    转换为 Hermes 内部格式。
    """

    def __init__(self, install_path: Optional[Path] = None):
        super().__init__(ImportSource.CODEX)
        self.install_path = install_path or self._default_install_path()

    def _default_install_path(self) -> Path:
        return Path.home() / ".codex"

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
        if (self.install_path / "config.toml").exists():
            available_types.append(DataType.SETTINGS)
        # Codex 在 config.toml 中嵌入 mcp_servers
        if (self.install_path / "config.toml").exists():
            content, _ = _safe_read_text(self.install_path / "config.toml")
            if content and "[mcp_servers" in content:
                available_types.append(DataType.MCP_SERVERS)
        skills_dir = self.install_path / "skills"
        if skills_dir.exists() and any(skills_dir.rglob("*.md")):
            available_types.append(DataType.COMMANDS)  # Codex skills 映射为 Hermes commands
        if (self.install_path / "AGENTS.md").exists():
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
        # Codex 没有标准版本文件，尝试从 version.txt
        version_file = self.install_path / "version.txt"
        if version_file.exists():
            content, err = _safe_read_text(version_file)
            if content:
                return content.strip()
        return None

    def list_data(self, data_type: DataType) -> List[ImportPreviewItem]:
        if data_type == DataType.SETTINGS:
            return self._list_settings()
        elif data_type == DataType.MCP_SERVERS:
            return self._list_mcp_servers()
        elif data_type == DataType.COMMANDS:
            return self._list_skills()
        elif data_type == DataType.MEMORIES:
            return self._list_memories()
        return []

    def _list_settings(self) -> List[ImportPreviewItem]:
        config_file = self.install_path / "config.toml"
        if not config_file.exists():
            return []
        valid, size = _validate_file_size(config_file)
        if not valid:
            return []
        return [ImportPreviewItem(
            source=self.source,
            data_type=DataType.SETTINGS,
            source_path=str(config_file),
            target_path="~/.hermes/config.toml",
            size_bytes=size,
            item_count=1,
            transform_notes=[
                "TOML 字段保持原样",
                "model / provider / approval_policy 直接保留",
                "mcp_servers 段单独提取",
            ],
        )]

    def _list_mcp_servers(self) -> List[ImportPreviewItem]:
        config_file = self.install_path / "config.toml"
        if not config_file.exists():
            return []
        content, _ = _safe_read_text(config_file)
        if not content or "[mcp_servers" not in content:
            return []
        # 解析 mcp_servers 段
        parsed = _simple_toml_parse(content)
        mcp_servers = parsed.get("mcp_servers", {})
        valid, size = _validate_file_size(config_file)
        if not valid:
            return []
        return [ImportPreviewItem(
            source=self.source,
            data_type=DataType.MCP_SERVERS,
            source_path=str(config_file),
            target_path="~/.hermes/mcp_servers.json",
            size_bytes=size,
            item_count=len(mcp_servers),
            transform_notes=[
                f"从 config.toml [mcp_servers.*] 提取 {len(mcp_servers)} 个服务器",
                "转换为 JSON 格式",
            ],
        )]

    def _list_skills(self) -> List[ImportPreviewItem]:
        skills_dir = self.install_path / "skills"
        if not skills_dir.exists():
            return []
        items = []
        for skill_file in skills_dir.rglob("*.md"):
            valid, size = _validate_file_size(skill_file)
            if not valid:
                continue
            items.append(ImportPreviewItem(
                source=self.source,
                data_type=DataType.COMMANDS,
                source_path=str(skill_file),
                target_path=f"~/.hermes/commands/{_safe_name(skill_file.relative_to(skills_dir))}",
                size_bytes=size,
                item_count=1,
                transform_notes=[
                    "Codex skills 映射为 Hermes commands",
                    "保持目录结构",
                ],
            ))
        return items

    def _list_memories(self) -> List[ImportPreviewItem]:
        memories = []
        for mem_file in ["AGENTS.md"]:
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
                            "AGENTS.md → project memory",
                            "AGENTS.md 是开放标准，字段 1:1 映射",
                        ],
                    ))
        return memories

    def convert(self, data_type: DataType, source_path: Path) -> Tuple[Path, bytes]:
        if data_type == DataType.SETTINGS:
            return self._convert_settings(source_path)
        elif data_type == DataType.MCP_SERVERS:
            return self._convert_mcp_servers(source_path)
        elif data_type == DataType.COMMANDS:
            return self._convert_skill(source_path)
        elif data_type == DataType.MEMORIES:
            return self._convert_memories(source_path)
        else:
            content, err = _safe_read_text(source_path)
            if err:
                raise ValueError(err)
            return Path(f"~/.hermes/{data_type.value}/{_safe_name(source_path.name)}"), content.encode("utf-8")

    def _convert_settings(self, source_path: Path) -> Tuple[Path, bytes]:
        """Codex config.toml → Hermes config.toml

        保留所有 TOML 字段，移除 mcp_servers 段（单独提取）
        """
        content, err = _safe_read_text(source_path)
        if err:
            raise ValueError(err)

        # 移除 mcp_servers 段
        lines = []
        in_mcp = False
        for line in content.split("\n"):
            if re.match(r"^\[mcp_servers", line):
                in_mcp = True
                continue
            if in_mcp:
                if line.strip().startswith("["):
                    in_mcp = False
                else:
                    continue
            lines.append(line)

        # 添加注释
        result = "# Hermes config.toml (imported from Codex)\n\n" + "\n".join(lines)
        return Path("~/.hermes/config.toml"), result.encode("utf-8")

    def _convert_mcp_servers(self, source_path: Path) -> Tuple[Path, bytes]:
        """从 config.toml 提取 mcp_servers → JSON"""
        content, err = _safe_read_text(source_path)
        if err:
            raise ValueError(err)
        parsed = _simple_toml_parse(content)
        mcp_servers = parsed.get("mcp_servers", {})
        # 转换为 Hermes 格式
        hermes_mcp = {"mcpServers": mcp_servers}
        return Path("~/.hermes/mcp_servers.json"), json.dumps(hermes_mcp, indent=2, ensure_ascii=False).encode("utf-8")

    def _convert_skill(self, source_path: Path) -> Tuple[Path, bytes]:
        content, err = _safe_read_text(source_path)
        if err:
            raise ValueError(err)
        rel_path = source_path.relative_to(self.install_path / "skills")
        target_path = f"~/.hermes/commands/{_safe_name(str(rel_path))}"
        return Path(target_path), content.encode("utf-8")

    def _convert_memories(self, source_path: Path) -> Tuple[Path, bytes]:
        content, err = _safe_read_text(source_path)
        if err:
            raise ValueError(err)
        if not content.startswith("---"):
            frontmatter = (
                "---\n"
                "source: codex\n"
                "type: project_memory\n"
                f"imported_at: {__import__('datetime').datetime.now().isoformat()}\n"
                "---\n\n"
            )
            content = frontmatter + content
        target_name = _safe_name(source_path.stem) + ".md"
        return Path(f"~/.hermes/memory/project/{target_name}"), content.encode("utf-8")
