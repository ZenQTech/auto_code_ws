"""
# ============================================================
# Skills Progressive Disclosure Loader (Cycle 9 P1-5)
# ============================================================
# 核心作用：实现 Codex v0.135+ 规范的 SKILL.md Progressive Disclosure
#           - 初始仅加载 name + description（8K char cap）
#           - 选中后按需加载完整 SKILL.md body
#           - 支持 frontmatter 2 必填 + 4 可选字段
# Frontmatter 规范（Codex v0.135+）：
#   Required:
#     - name (string, 1-64 chars)
#     - description (string, 1-512 chars)
#   Optional:
#     - when_to_use (string, 自由文本关键词)
#     - tools (list of strings, 可用工具列表)
#     - model (string, 默认模型)
#     - metadata (dict, 自定义元数据)
# 目录结构：
#   .trae/skills/<skill_name>.md
# 输入参数：项目路径或单文件路径
# 输出结果：SkillSummary / SkillFull 数据类
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 9 P1-5 初始化
# ============================================================
"""

from __future__ import annotations

import json
import logging
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

logger = logging.getLogger(__name__)


# ============================================================
# 常量
# ============================================================
SKILL_FILENAME_PATTERN = re.compile(r"^[A-Za-z0-9_\-\.]+\.md$")
SKILL_FILENAME_STEM_PATTERN = re.compile(r"^[A-Za-z0-9_\-\.]+$")

# 8K char cap for initial load (Codex v0.135+ 规范)
SUMMARY_CAP_BYTES = 8 * 1024  # 8 KB

# 目录名
SKILLS_DIRNAME = ".trae"
SKILLS_SUBDIR = "skills"


# ============================================================
# 数据类
# ============================================================
@dataclass
class SkillSummary:
    """技能摘要（初始加载使用，体积小）

    字段：
      - name: 技能唯一标识
      - description: 一句话描述
      - when_to_use: 调用场景（可选）
      - file_path: 源 .md 文件绝对路径
      - project_path: 所在项目根目录
      - summary_size: 摘要大小（字节）
    """

    name: str
    description: str
    when_to_use: str = ""
    file_path: str = ""
    project_path: str = ""

    @property
    def summary_size(self) -> int:
        """摘要大小（字节）"""
        return len(self.name.encode("utf-8")) + len(
            self.description.encode("utf-8")
        ) + len(self.when_to_call.encode("utf-8") if hasattr(self, "when_to_call") else self.when_to_use.encode("utf-8"))

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "when_to_use": self.when_to_use,
            "file_path": self.file_path,
            "project_path": self.project_path,
            "summary_size": self.summary_size,
        }


@dataclass
class SkillFull:
    """技能完整定义（按需加载）

    字段：
      - name: 技能唯一标识
      - description: 一句话描述
      - when_to_use: 调用场景
      - tools: 可用工具列表
      - model: 默认模型
      - metadata: 自定义元数据
      - body: 完整 markdown body
      - file_path: 源文件绝对路径
      - project_path: 所在项目根目录
      - frontmatter: 原始 frontmatter 字典
    """

    name: str
    description: str
    when_to_use: str = ""
    tools: List[str] = field(default_factory=list)
    model: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)
    body: str = ""
    file_path: str = ""
    project_path: str = ""
    frontmatter: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "when_to_use": self.when_to_use,
            "tools": list(self.tools),
            "model": self.model,
            "metadata": dict(self.metadata),
            "body": self.body,
            "file_path": self.file_path,
            "project_path": self.project_path,
            "frontmatter": dict(self.frontmatter),
        }


# ============================================================
# Frontmatter 解析（与 project_agents/parser.py 一致的极简 YAML 子集）
# ============================================================
_FRONTMATTER_RE = re.compile(
    r"\A---\s*\n(?P<fm>.*?)\n---\s*\n?(?P<body>.*)\Z", re.DOTALL
)


def _parse_scalar(text: str) -> Any:
    """解析单行标量值"""
    text = text.strip()
    if (text.startswith('"') and text.endswith('"')) or (
        text.startswith("'") and text.endswith("'")
    ):
        return text[1:-1]
    if text.lower() in ("true", "yes", "on"):
        return True
    if text.lower() in ("false", "no", "off"):
        return False
    if text.lower() in ("null", "~", ""):
        return None
    if re.match(r"^-?\d+$", text):
        return int(text)
    if re.match(r"^-?\d+\.\d+$", text):
        return float(text)
    if text.startswith("[") and text.endswith("]"):
        inner = text[1:-1].strip()
        if not inner:
            return []
        # 简单列表解析
        return [_parse_scalar(p.strip()) for p in inner.split(",")]
    return text


def _parse_frontmatter(text: str) -> Dict[str, Any]:
    """极简 frontmatter 解析"""
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}
    result: Dict[str, Any] = {}
    lines = m.group("fm").split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.strip().startswith("#"):
            i += 1
            continue
        if line.startswith(" ") or line.startswith("\t"):
            i += 1
            continue
        m2 = re.match(r"^([A-Za-z_][A-Za-z0-9_\-]*)\s*:\s*(.*)$", line)
        if not m2:
            i += 1
            continue
        key = m2.group(1)
        rest = m2.group(2).rstrip()
        if rest == "":
            # 收集缩进行
            j = i + 1
            collected: List[str] = []
            while j < len(lines):
                nxt = lines[j]
                if not nxt.strip():
                    j += 1
                    continue
                if not (nxt.startswith("  ") or nxt.startswith("\t")):
                    break
                collected.append(nxt.strip())
                j += 1
            if collected:
                if all(c.startswith("- ") for c in collected):
                    result[key] = [c[2:].strip().strip("'\"") for c in collected]
                else:
                    sub: Dict[str, Any] = {}
                    for c in collected:
                        sm = re.match(
                            r"^([A-Za-z_][A-Za-z0-9_\-]*)\s*:\s*(.*)$", c
                        )
                        if sm:
                            sub[sm.group(1)] = _parse_scalar(sm.group(2))
                    if sub:
                        result[key] = sub
            i = j
            continue
        result[key] = _parse_scalar(rest)
        i += 1
    return result


def parse_skill_file(file_path: Union[str, Path]) -> Optional[SkillFull]:
    """解析单个 SKILL.md 文件，返回完整定义

    Args:
        file_path: SKILL.md 绝对路径

    Returns:
        SkillFull 实例；解析失败返回 None
    """
    p = Path(file_path)
    if not p.exists() or not p.is_file():
        return None

    try:
        content = p.read_text(encoding="utf-8")
    except Exception as e:
        logger.error(f"Failed to read skill file {file_path}: {e}")
        return None

    fm = _parse_frontmatter(content)
    m = _FRONTMATTER_RE.match(content)
    body = m.group("body").strip() if m else content

    # 必填字段
    name = str(fm.get("name", "")).strip()
    if not name:
        # fallback: 使用文件名（去 .md）
        if SKILL_FILENAME_STEM_PATTERN.match(p.stem):
            name = p.stem
        else:
            logger.warning(f"Skill file {file_path} has invalid stem")
            return None

    description = str(fm.get("description", "")).strip()
    if not description:
        logger.warning(f"Skill {name} missing description, skipped")
        return None

    when_to_use = str(fm.get("when_to_use", "")).strip()
    model = str(fm.get("model", "")).strip()

    # tools
    tools_raw = fm.get("tools", [])
    if isinstance(tools_raw, str):
        tools_raw = [t.strip() for t in re.split(r"[,，;；]", tools_raw) if t.strip()]
    tools = [str(t) for t in tools_raw]

    # metadata
    metadata_raw = fm.get("metadata", {})
    if not isinstance(metadata_raw, dict):
        metadata_raw = {}

    # project_path 推断
    project_path = ""
    parts = p.parts
    for idx, part in enumerate(parts):
        if part == ".trae" and idx + 1 < len(parts) and parts[idx + 1] == "skills":
            project_path = str(Path(*parts[:idx]))
            break

    return SkillFull(
        name=name,
        description=description,
        when_to_use=when_to_use,
        tools=tools,
        model=model,
        metadata=dict(metadata_raw),
        body=body,
        file_path=str(p.absolute()),
        project_path=project_path,
        frontmatter=dict(fm),
    )


def build_summary(full: SkillFull) -> SkillSummary:
    """从 SkillFull 构建 SkillSummary（仅保留 name+description+when_to_use）"""
    return SkillSummary(
        name=full.name,
        description=full.description,
        when_to_use=full.when_to_use,
        file_path=full.file_path,
        project_path=full.project_path,
    )


# ============================================================
# 扫描器
# ============================================================
class SkillProgressiveScanner:
    """SKILL.md 渐进式扫描器

    Usage:
        scanner = SkillProgressiveScanner("/path/to/project")
        summaries = scanner.list_summaries()  # 8K cap
        full = scanner.load_full("code-review")  # on-demand
    """

    def __init__(self, project_path: Union[str, Path]):
        self.project_path = Path(project_path).absolute()
        self.skills_dir = self.project_path / SKILLS_DIRNAME / SKILLS_SUBDIR

    @property
    def skills_dir_exists(self) -> bool:
        return self.skills_dir.is_dir()

    def list_summaries(
        self, cap_bytes: int = SUMMARY_CAP_BYTES
    ) -> tuple:
        """列出项目所有 skill 摘要（强制 cap 限制）

        Args:
            cap_bytes: 摘要总字节数上限（默认 8K）

        Returns:
            (summaries, total_bytes, truncated)
            - summaries: SkillSummary 列表
            - total_bytes: 当前累计字节数
            - truncated: 是否因 cap 限制而被截断
        """
        if not self.skills_dir_exists:
            return [], 0, False

        summaries: List[SkillSummary] = []
        total_bytes = 0
        truncated = False

        # 按文件名排序（保证稳定的加载顺序）
        md_files = sorted(self.skills_dir.glob("*.md"))
        for md_file in md_files:
            if not SKILL_FILENAME_PATTERN.match(md_file.name):
                continue
            if md_file.stem.startswith("_"):
                continue

            full = parse_skill_file(md_file)
            if full is None:
                continue

            summary = build_summary(full)
            size = summary.summary_size
            if total_bytes + size > cap_bytes and summaries:
                # 已超出 cap，停止添加
                truncated = True
                break

            summaries.append(summary)
            total_bytes += size

        return summaries, total_bytes, truncated

    def load_full(self, name: str) -> Optional[SkillFull]:
        """按 name 加载完整 skill 定义（on-demand）

        Args:
            name: skill 名称（与文件名一致，不含 .md）

        Returns:
            SkillFull 实例；未找到返回 None
        """
        if not self.skills_dir_exists:
            return None
        # 文件名安全校验
        if not SKILL_FILENAME_STEM_PATTERN.match(name):
            return None
        file_path = self.skills_dir / f"{name}.md"
        return parse_skill_file(file_path)

    def load_full_by_path(self, file_path: Union[str, Path]) -> Optional[SkillFull]:
        """按文件路径加载完整 skill（不限于本项目目录）"""
        return parse_skill_file(file_path)

    def find_summary_by_name(self, name: str) -> Optional[SkillSummary]:
        """在摘要中按 name 查找"""
        summaries, _, _ = self.list_summaries()
        for s in summaries:
            if s.name == name:
                return s
        return None


# ============================================================
# 跨项目全局注册表
# ============================================================
class SkillsProgressiveRegistry:
    """跨项目的技能摘要注册表

    线程安全（RLock 保护）。
    维护 project_path -> {name: SkillSummary} 映射。
    """

    def __init__(self):
        self._lock = threading.RLock()
        # project_path -> {name: SkillSummary}
        self._by_project: Dict[str, Dict[str, SkillSummary]] = {}

    def register_project(
        self,
        project_path: Union[str, Path],
        cap_bytes: int = SUMMARY_CAP_BYTES,
    ) -> int:
        """扫描并注册项目摘要

        Args:
            project_path: 项目根目录
            cap_bytes: 单项目摘要字节上限

        Returns:
            注册的 skill 数量
        """
        project_path = str(Path(project_path).absolute())
        scanner = SkillProgressiveScanner(project_path)
        summaries, total_bytes, truncated = scanner.list_summaries(cap_bytes)

        with self._lock:
            self._by_project[project_path] = {s.name: s for s in summaries}

        logger.info(
            f"Registered {len(summaries)} skills for {project_path} "
            f"(bytes={total_bytes}, truncated={truncated})"
        )
        return len(summaries)

    def unregister_project(self, project_path: Union[str, Path]) -> bool:
        """注销项目"""
        project_path = str(Path(project_path).absolute())
        with self._lock:
            if project_path in self._by_project:
                del self._by_project[project_path]
                return True
            return False

    def list_all_summaries(
        self, project_path: Optional[Union[str, Path]] = None
    ) -> List[SkillSummary]:
        """列出所有摘要"""
        with self._lock:
            if project_path is None:
                result: List[SkillSummary] = []
                for m in self._by_project.values():
                    result.extend(m.values())
                return result
            pp = str(Path(project_path).absolute())
            m = self._by_project.get(pp, {})
            return list(m.values())

    def get_summary(
        self,
        name: str,
        project_path: Optional[Union[str, Path]] = None,
    ) -> Optional[SkillSummary]:
        """按 name 查找摘要"""
        with self._lock:
            if project_path is not None:
                pp = str(Path(project_path).absolute())
                m = self._by_project.get(pp, {})
                return m.get(name)
            for m in self._by_project.values():
                if name in m:
                    return m[name]
            return None

    def load_full(
        self,
        name: str,
        project_path: Optional[Union[str, Path]] = None,
    ) -> Optional[SkillFull]:
        """按需加载完整 skill

        Args:
            name: skill 名称
            project_path: 项目路径；None 时跨项目查找
        """
        # 先找到 summary
        summary = self.get_summary(name, project_path)
        if summary is None:
            # 跨项目查找并尝试加载
            with self._lock:
                for pp, m in self._by_project.items():
                    if name in m:
                        project_path = pp
                        break
            if project_path is None:
                return None
            summary = self.get_summary(name, project_path)

        if summary is None:
            return None

        scanner = SkillProgressiveScanner(summary.project_path)
        return scanner.load_full(name)

    def get_stats(self) -> Dict[str, int]:
        """获取统计"""
        with self._lock:
            return {
                "projects": len(self._by_project),
                "skills": sum(len(m) for m in self._by_project.values()),
            }


# ============================================================
# 全局单例
# ============================================================
_global_registry: Optional[SkillsProgressiveRegistry] = None
_global_lock = threading.Lock()


def get_global_registry() -> SkillsProgressiveRegistry:
    global _global_registry
    if _global_registry is None:
        with _global_lock:
            if _global_registry is None:
                _global_registry = SkillsProgressiveRegistry()
    return _global_registry


def reset_global_registry() -> None:
    global _global_registry
    with _global_lock:
        _global_registry = None
