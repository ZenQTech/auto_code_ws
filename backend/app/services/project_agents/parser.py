"""
# ============================================================
# Project Agent Parser - Markdown Frontmatter 解析器 (Cycle 9 P0-17)
# ============================================================
# 核心作用：解析 .trae/agents/*.md 文件，提取 YAML frontmatter
#           与 markdown body，构造 ProjectAgent 数据类
# Frontmatter 规范（TRAE v3.5.67）：
#   - name (required): 子智能体唯一标识
#   - description (required): 描述
#   - prompt (required): 系统提示词
#   - callable (optional, default true): 是否可被 @ 调用
#   - when_to_call (optional): 调用场景描述
#   - model (optional, default sonnet): 默认模型
#   - tools (optional, list): 可用工具列表
#   - metadata (optional, dict): 自定义元数据
# 输入参数：markdown 文件路径或内容字符串
# 输出结果：ProjectAgent 数据类
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 9 P0-17 初始化
# ============================================================
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

logger = logging.getLogger(__name__)


# ============================================================
# 数据类
# ============================================================
@dataclass
class ProjectAgent:
    """项目级子智能体定义

    Attributes:
        name: 子智能体唯一标识（与文件名一致，不含 .md）
        description: 一句话描述
        prompt: 系统提示词（markdown body）
        callable: 是否可被 @ 调用
        when_to_call: 调用场景描述
        model: 默认模型
        tools: 可用工具列表
        metadata: 自定义元数据
        file_path: 源 .md 文件绝对路径
        project_path: 所在项目根目录
    """

    name: str
    description: str
    prompt: str
    callable: bool = True
    when_to_call: str = ""
    model: str = "claude-sonnet"
    tools: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    file_path: str = ""
    project_path: str = ""

    def to_dict(self) -> Dict[str, Any]:
        """转换为 dict（可 JSON 序列化）"""
        return {
            "name": self.name,
            "description": self.description,
            "prompt": self.prompt,
            "callable": self.callable,
            "when_to_call": self.when_to_call,
            "model": self.model,
            "tools": list(self.tools),
            "metadata": dict(self.metadata),
            "file_path": self.file_path,
            "project_path": self.project_path,
        }

    @property
    def identifier(self) -> str:
        """@ 调用的标识符（与 name 一致）"""
        return self.name

    def matches_query(self, query: str) -> float:
        """根据 query 计算匹配度（0~1），用于 when_to_call 智能调用

        Args:
            query: 用户查询或任务描述

        Returns:
            0~1 之间的匹配分数
        """
        if not self.when_to_call:
            return 0.0
        q = query.lower()
        # 简单关键词匹配：拆 when_to_call 为关键词
        keywords = [k.strip().lower() for k in re.split(r"[,，;；/、\s]+", self.when_to_call) if k.strip()]
        if not keywords:
            return 0.0
        hits = sum(1 for k in keywords if k in q)
        return hits / len(keywords)


# ============================================================
# Frontmatter 解析
# ============================================================
# 支持的 frontmatter 分隔符：--- 开头与结尾
_FRONTMATTER_RE = re.compile(r"\A---\s*\n(?P<fm>.*?)\n---\s*\n?(?P<body>.*)\Z", re.DOTALL)


def parse_frontmatter(content: str) -> Dict[str, Any]:
    """解析 markdown frontmatter 为 dict

    支持的字段类型：
      - 字符串：name, description, prompt, when_to_call, model
      - 布尔：callable
      - 列表：tools（支持 [a, b, c] 或 a, b, c 形式）
      - 字典：metadata（JSON 风格或 key: value 风格）

    Args:
        content: markdown 文件全文

    Returns:
        解析后的字典；若未发现 frontmatter 则返回空 dict
    """
    m = _FRONTMATTER_RE.match(content)
    if not m:
        return {}
    fm_text = m.group("fm")
    return _parse_yaml_like(fm_text)


def _parse_yaml_like(text: str) -> Dict[str, Any]:
    """极简 YAML 解析（仅支持一级 key: value + 列表/字典）

    不依赖 PyYAML，避免外部依赖。支持的语法：
      - key: value
      - key: "quoted value"
      - key: 'single quoted'
      - key: true / false
      - key: [a, b, c]
      - key:
          - item1
          - item2
      - key:
          subkey: subvalue
    """
    result: Dict[str, Any] = {}
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        # 跳过空行与注释
        if not line.strip() or line.strip().startswith("#"):
            i += 1
            continue

        # 仅处理一级 key（不以空格开头）
        if line.startswith(" ") or line.startswith("\t"):
            i += 1
            continue

        m = re.match(r"^([A-Za-z_][A-Za-z0-9_\-]*)\s*:\s*(.*)$", line)
        if not m:
            i += 1
            continue

        key = m.group(1)
        rest = m.group(2).rstrip()

        # 列表或多行值
        if rest == "":
            # 收集缩进行
            j = i + 1
            collected: List[str] = []
            while j < len(lines):
                next_line = lines[j]
                if not next_line.strip():
                    j += 1
                    continue
                if not (next_line.startswith("  ") or next_line.startswith("\t")):
                    break
                collected.append(next_line.strip())
                j += 1
            if collected:
                # 判断是列表项还是字典项
                if all(c.startswith("- ") for c in collected):
                    result[key] = [c[2:].strip().strip("'\"") for c in collected]
                else:
                    # 嵌套字典
                    sub: Dict[str, Any] = {}
                    for c in collected:
                        sub_m = re.match(r"^([A-Za-z_][A-Za-z0-9_\-]*)\s*:\s*(.*)$", c)
                        if sub_m:
                            sub[sub_m.group(1)] = _parse_scalar(sub_m.group(2))
                    if sub:
                        result[key] = sub
            i = j
            continue

        # 单行值
        result[key] = _parse_scalar(rest)
        i += 1

    return result


def _parse_scalar(text: str) -> Any:
    """解析单行标量值"""
    text = text.strip()
    # 引号
    if (text.startswith('"') and text.endswith('"')) or (
        text.startswith("'") and text.endswith("'")
    ):
        return text[1:-1]
    # 布尔
    if text.lower() in ("true", "yes", "on"):
        return True
    if text.lower() in ("false", "no", "off"):
        return False
    # null
    if text.lower() in ("null", "~", ""):
        return None
    # 数字
    if re.match(r"^-?\d+$", text):
        return int(text)
    if re.match(r"^-?\d+\.\d+$", text):
        return float(text)
    # 行内列表 [a, b, c]
    if text.startswith("[") and text.endswith("]"):
        inner = text[1:-1].strip()
        if not inner:
            return []
        return [_parse_scalar(p.strip()) for p in inner.split(",")]
    return text


def parse_agent_file(file_path: Union[str, Path]) -> Optional[ProjectAgent]:
    """解析单个 .trae/agents/*.md 文件

    Args:
        file_path: markdown 文件绝对路径

    Returns:
        ProjectAgent 实例；解析失败返回 None
    """
    p = Path(file_path)
    if not p.exists() or not p.is_file():
        logger.warning(f"Agent file not found: {file_path}")
        return None

    try:
        content = p.read_text(encoding="utf-8")
    except Exception as e:
        logger.error(f"Failed to read agent file {file_path}: {e}")
        return None

    frontmatter = parse_frontmatter(content)
    if not frontmatter:
        logger.warning(f"No frontmatter in {file_path}")
        return None

    # 必填字段校验
    name = str(frontmatter.get("name", "")).strip()
    if not name:
        # fallback: 使用文件名（不含 .md）
        name = p.stem

    description = str(frontmatter.get("description", "")).strip()
    if not description:
        logger.warning(f"Agent {name} missing description, skipped")
        return None

    # body
    m = _FRONTMATTER_RE.match(content)
    body = m.group("body").strip() if m else content

    # callable 字段
    callable_flag = frontmatter.get("callable", True)
    if isinstance(callable_flag, str):
        callable_flag = callable_flag.lower() not in ("false", "no", "off", "0")
    callable_flag = bool(callable_flag)

    # tools 字段
    tools_raw = frontmatter.get("tools", [])
    if isinstance(tools_raw, str):
        tools_raw = [t.strip() for t in re.split(r"[,，;；]", tools_raw) if t.strip()]
    tools = [str(t) for t in tools_raw]

    # metadata 字段
    metadata_raw = frontmatter.get("metadata", {})
    if not isinstance(metadata_raw, dict):
        metadata_raw = {}

    # project_path 推断
    project_path = ""
    parts = p.parts
    for idx, part in enumerate(parts):
        if part == ".trae" and idx + 1 < len(parts) and parts[idx + 1] == "agents":
            project_path = str(Path(*parts[:idx]))
            break

    return ProjectAgent(
        name=name,
        description=description,
        prompt=body,
        callable=callable_flag,
        when_to_call=str(frontmatter.get("when_to_call", "")).strip(),
        model=str(frontmatter.get("model", "claude-sonnet")).strip() or "claude-sonnet",
        tools=tools,
        metadata=dict(metadata_raw),
        file_path=str(p.absolute()),
        project_path=project_path,
    )
