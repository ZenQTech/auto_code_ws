"""
# ============================================================
# Custom Commands Parser - TRAE .trae/commands/ 解析器
# ============================================================
# 核心作用：解析 TRAE 风格的自定义命令 .md 文件
# 文件格式：
#   ---
#   Name: command-name
#   Description: 一句话描述
#   Category: category-name    # 可选
#   Icon: 📦                   # 可选
#   Aliases: [alias1, alias2]  # 可选
#   Permission: user           # 可选
#   Args:                      # 可选
#     - name: arg_name
#       required: true
#       type: string
#       description: ...
#   ---
#
#   Instructions: |
#     LLM 提示词内容
#     支持 {arg_name} 占位符替换
#
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 8 P0-13
# ============================================================
"""

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

logger = logging.getLogger(__name__)


# ============================================================
# 数据模型
# ============================================================

@dataclass
class CommandArg:
    """命令参数定义"""
    name: str
    required: bool = False
    type: str = "string"
    description: str = ""
    choices: Optional[List[str]] = None
    default: Any = None


@dataclass
class CustomCommand:
    """自定义命令数据模型"""
    name: str
    description: str
    instructions: str = ""
    category: str = "general"
    icon: str = "📦"
    aliases: List[str] = field(default_factory=list)
    permission: str = "user"
    args: List[CommandArg] = field(default_factory=list)
    allowed_tools: List[str] = field(default_factory=list)
    # 路径信息
    file_path: Optional[str] = None
    scope: str = "project"  # project | global
    parent_category: str = ""  # 3 级目录分类
    # 元数据
    parse_error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "name": self.name,
            "description": self.description,
            "instructions": self.instructions,
            "category": self.category,
            "icon": self.icon,
            "aliases": self.aliases,
            "permission": self.permission,
            "args": [
                {
                    "name": a.name,
                    "required": a.required,
                    "type": a.type,
                    "description": a.description,
                    "choices": a.choices,
                    "default": a.default,
                }
                for a in self.args
            ],
            "allowed_tools": self.allowed_tools,
            "file_path": self.file_path,
            "scope": self.scope,
            "parent_category": self.parent_category,
            "parse_error": self.parse_error,
        }


# ============================================================
# Frontmatter 解析
# ============================================================

FRONTMATTER_PATTERN = re.compile(
    r"^---\s*\n(.*?)\n---\s*\n(.*)$",
    re.DOTALL,
)


def extract_frontmatter(content: str) -> tuple[Optional[Dict[str, Any]], str]:
    """
    从 Markdown 内容中提取 YAML frontmatter 和正文

    Args:
        content: 完整的 .md 文件内容

    Returns:
        (frontmatter_dict, body) 元组
        如果没有 frontmatter，返回 (None, content)
    """
    if not content or not content.strip():
        return None, ""

    match = FRONTMATTER_PATTERN.match(content.strip())
    if not match:
        return None, content

    try:
        frontmatter = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError as e:
        logger.warning(f"Frontmatter YAML 解析失败: {e}")
        return None, content

    body = match.group(2).strip()
    return frontmatter, body


def extract_instructions(body: str) -> str:
    """
    从正文中提取 Instructions 字段

    支持格式：
      Instructions: |
        内容
    或：
      Instructions: >
        内容
    或纯文本直接使用 body
    """
    if not body:
        return ""

    # 尝试匹配 "Instructions: |" 或 "Instructions: >" 格式
    pattern = re.compile(
        r"^Instructions:\s*[|>][+-]?\s*\n(.*?)(?=\n\w+:|\Z)",
        re.DOTALL | re.MULTILINE,
    )
    match = pattern.search(body)
    if match:
        return match.group(1).strip()

    # 如果找不到，尝试简单匹配 "Instructions: <text>"
    simple_pattern = re.compile(r"^Instructions:\s*(.+?)(?=\n\w+:|\Z)", re.DOTALL | re.MULTILINE)
    simple_match = simple_pattern.search(body)
    if simple_match:
        return simple_match.group(1).strip()

    # 否则整个 body 作为 instructions
    return body.strip()


# ============================================================
# 命令解析
# ============================================================

def parse_command_file(
    file_path: str,
    scope: str = "project",
    parent_category: str = "",
) -> Optional[CustomCommand]:
    """
    解析单个命令文件

    Args:
        file_path: .md 文件的绝对路径
        scope: 'project' | 'global'
        parent_category: 父目录分类（最多 3 级）

    Returns:
        CustomCommand 实例，解析失败返回 None
    """
    path = Path(file_path)
    if not path.exists():
        logger.warning(f"命令文件不存在: {file_path}")
        return None
    if not path.is_file():
        return None
    if path.suffix.lower() not in (".md", ".markdown"):
        return None

    try:
        content = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        logger.error(f"读取命令文件失败 {file_path}: {e}")
        return None

    return parse_command_content(
        content=content,
        file_path=str(path.absolute()),
        scope=scope,
        parent_category=parent_category,
        fallback_name=path.stem,
    )


def parse_command_content(
    content: str,
    file_path: Optional[str] = None,
    scope: str = "project",
    parent_category: str = "",
    fallback_name: str = "unknown",
) -> CustomCommand:
    """
    解析命令内容字符串

    Args:
        content: .md 文件内容
        file_path: 文件路径（用于错误日志）
        scope: 'project' | 'global'
        parent_category: 父目录分类
        fallback_name: 解析失败时使用的默认名称

    Returns:
        CustomCommand 实例（包含可能的 parse_error）
    """
    if not content or not content.strip():
        return CustomCommand(
            name=fallback_name,
            description="(空文件)",
            file_path=file_path,
            scope=scope,
            parent_category=parent_category,
            parse_error="空文件",
        )

    frontmatter, body = extract_frontmatter(content)

    if frontmatter is None:
        # 没有 frontmatter - 使用文件名作为命令名
        return CustomCommand(
            name=fallback_name,
            description=body[:200] if body else "(无描述)",
            instructions=body,
            category=parent_category or "general",
            file_path=file_path,
            scope=scope,
            parent_category=parent_category,
        )

    # 解析 frontmatter 字段
    name = frontmatter.get("Name") or frontmatter.get("name") or fallback_name
    description = frontmatter.get("Description") or frontmatter.get("description") or "(无描述)"
    category = frontmatter.get("Category") or frontmatter.get("category") or parent_category or "general"
    icon = frontmatter.get("Icon") or frontmatter.get("icon") or "📦"
    aliases = frontmatter.get("Aliases") or frontmatter.get("aliases") or []
    permission = frontmatter.get("Permission") or frontmatter.get("permission") or "user"
    allowed_tools = frontmatter.get("AllowedTools") or frontmatter.get("allowed_tools") or []

    # 解析 args
    raw_args = frontmatter.get("Args") or frontmatter.get("args") or []
    args: List[CommandArg] = []
    for arg_def in raw_args:
        if not isinstance(arg_def, dict):
            continue
        arg = CommandArg(
            name=arg_def.get("name", ""),
            required=arg_def.get("required", False),
            type=arg_def.get("type", "string"),
            description=arg_def.get("description", ""),
            choices=arg_def.get("choices"),
            default=arg_def.get("default"),
        )
        if arg.name:
            args.append(arg)

    # 提取 instructions
    instructions = extract_instructions(body)

    return CustomCommand(
        name=str(name).strip(),
        description=str(description).strip(),
        instructions=instructions,
        category=str(category).strip(),
        icon=str(icon).strip() if icon else "📦",
        aliases=list(aliases) if isinstance(aliases, list) else [],
        permission=str(permission).strip(),
        args=args,
        allowed_tools=list(allowed_tools) if isinstance(allowed_tools, list) else [],
        file_path=file_path,
        scope=scope,
        parent_category=parent_category,
    )


def render_instructions(command: CustomCommand, args: Dict[str, str]) -> str:
    """
    渲染命令的 instructions，替换 {arg_name} 占位符

    Args:
        command: CustomCommand 实例
        args: 参数字典

    Returns:
        渲染后的 instructions 字符串
    """
    text = command.instructions
    for key, value in args.items():
        text = text.replace(f"{{{key}}}", str(value))
    return text
