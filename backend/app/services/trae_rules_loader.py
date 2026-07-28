"""
# ============================================================
# .trae/rules/ Multi-Level Loader (Cycle 9 P1-6)
# ============================================================
# 核心作用：实现 .trae/rules/ 目录式规则加载，支持多级嵌套分类
#           - 目录结构: <project>/.trae/rules/<category>/<name>.md
#           - 多级嵌套: <project>/.trae/rules/python/testing/pytest.md
#           - 类别推断: 自动从子目录路径生成 category
#           - 跨项目注册: 线程安全的全局注册表
# 目录规范（Codex v0.140+）：
#   <project>/.trae/rules/<category1>/<category2>/.../<rule_name>.md
# Frontmatter 规范：
#   Required:
#     - name (string)
#   Optional:
#     - description (string)
#     - when_to_use (string)
#     - tools (list of strings)
#     - priority (int, 0-100, 数字越大优先级越高)
#     - metadata (dict)
# 输入参数：项目路径
# 输出结果：Rule 数据类 + 跨项目注册表
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 9 P1-6 初始化
# ============================================================
"""

from __future__ import annotations

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
RULES_FILENAME_PATTERN = re.compile(r"^[A-Za-z0-9_\-\.]+\.md$")
RULES_FILENAME_STEM_PATTERN = re.compile(r"^[A-Za-z0-9_\-\.]+$")

# 目录名
RULES_DIRNAME = ".trae"
RULES_SUBDIR = "rules"

# 最大嵌套目录深度（3 级，足够覆盖绝大多数分类场景）
MAX_CATEGORY_DEPTH = 3

# 默认优先级
DEFAULT_PRIORITY = 50
MIN_PRIORITY = 0
MAX_PRIORITY = 100


# ============================================================
# 数据类
# ============================================================
@dataclass
class Rule:
    """规则完整定义

    字段：
      - name: 规则唯一标识（来自 frontmatter.name 或文件名 stem）
      - description: 规则描述
      - when_to_use: 调用场景
      - tools: 可用工具列表
      - priority: 优先级（0-100）
      - metadata: 自定义元数据
      - content: 完整 markdown 内容
      - file_path: 源 .md 文件绝对路径
      - project_path: 所在项目根目录
      - category: 类别（由目录路径生成，如 "python/testing"）
      - frontmatter: 原始 frontmatter 字典
    """

    name: str
    content: str
    file_path: str
    project_path: str
    category: str = ""
    description: str = ""
    when_to_use: str = ""
    tools: List[str] = field(default_factory=list)
    priority: int = DEFAULT_PRIORITY
    metadata: Dict[str, Any] = field(default_factory=dict)
    frontmatter: Dict[str, Any] = field(default_factory=dict)

    @property
    def summary(self) -> str:
        """规则摘要（用于列表展示）"""
        return f"[{self.category}] {self.name}: {self.description[:80] if self.description else self.content[:80]}"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "category": self.category,
            "description": self.description,
            "when_to_use": self.when_to_use,
            "tools": list(self.tools),
            "priority": self.priority,
            "metadata": dict(self.metadata),
            "content": self.content,
            "file_path": self.file_path,
            "project_path": self.project_path,
            "frontmatter": dict(self.frontmatter),
        }

    def to_summary_dict(self) -> Dict[str, Any]:
        """轻量摘要（不含 content）"""
        return {
            "name": self.name,
            "category": self.category,
            "description": self.description,
            "when_to_use": self.when_to_use,
            "priority": self.priority,
            "file_path": self.file_path,
            "project_path": self.project_path,
        }


# ============================================================
# Frontmatter 解析（与 skill_progressive 一致的极简 YAML 子集）
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


# ============================================================
# 单文件解析
# ============================================================
def parse_rule_file(file_path: Union[str, Path]) -> Optional[Rule]:
    """解析单个规则 .md 文件

    Args:
        file_path: 规则 .md 文件绝对路径

    Returns:
        Rule 实例；解析失败返回 None
    """
    p = Path(file_path)
    if not p.exists() or not p.is_file():
        return None

    try:
        content = p.read_text(encoding="utf-8")
    except Exception as e:
        logger.error(f"Failed to read rule file {file_path}: {e}")
        return None

    fm = _parse_frontmatter(content)
    m = _FRONTMATTER_RE.match(content)
    body = m.group("body").strip() if m else content

    # 必填字段：name（fallback 使用文件名 stem）
    name = str(fm.get("name", "")).strip()
    if not name:
        if RULES_FILENAME_STEM_PATTERN.match(p.stem):
            name = p.stem
        else:
            logger.warning(f"Rule file {file_path} has invalid stem")
            return None

    # 可选字段
    description = str(fm.get("description", "")).strip()
    when_to_use = str(fm.get("when_to_use", "")).strip()

    # tools
    tools_raw = fm.get("tools", [])
    if isinstance(tools_raw, str):
        tools_raw = [t.strip() for t in re.split(r"[,，;；]", tools_raw) if t.strip()]
    tools = [str(t) for t in tools_raw]

    # priority（clamp 到 [0, 100]）
    priority_raw = fm.get("priority", DEFAULT_PRIORITY)
    try:
        priority = int(priority_raw)
    except (ValueError, TypeError):
        priority = DEFAULT_PRIORITY
    priority = max(MIN_PRIORITY, min(MAX_PRIORITY, priority))

    # metadata
    metadata_raw = fm.get("metadata", {})
    if not isinstance(metadata_raw, dict):
        metadata_raw = {}

    # 推断 project_path 和 category
    project_path = ""
    category = ""
    parts = p.parts
    for idx, part in enumerate(parts):
        if part == RULES_DIRNAME and idx + 1 < len(parts) and parts[idx + 1] == RULES_SUBDIR:
            project_path = str(Path(*parts[:idx]))
            # category = 介于 .trae/rules/ 和文件名之间的路径
            category_start = idx + 2
            category_end = len(parts) - 1  # 排除文件名
            if category_start < category_end:
                category = "/".join(parts[category_start:category_end])
            else:
                category = "uncategorized"
            break

    return Rule(
        name=name,
        description=description,
        when_to_use=when_to_use,
        tools=tools,
        priority=priority,
        metadata=dict(metadata_raw),
        content=body,
        file_path=str(p.absolute()),
        project_path=project_path,
        category=category,
        frontmatter=dict(fm),
    )


# ============================================================
# 扫描器
# ============================================================
class TraeRulesLoader:
    """.trae/rules/ 多级嵌套规则加载器

    Usage:
        loader = TraeRulesLoader("/path/to/project")
        rules = loader.scan_all()  # 递归扫描所有子目录
        rule = loader.load_by_name("python-style")  # 按 name 加载
    """

    def __init__(self, project_path: Union[str, Path]):
        self.project_path = Path(project_path).absolute()
        self.rules_dir = self.project_path / RULES_DIRNAME / RULES_SUBDIR

    @property
    def rules_dir_exists(self) -> bool:
        return self.rules_dir.is_dir()

    def scan_all(
        self,
        max_depth: int = MAX_CATEGORY_DEPTH,
    ) -> List[Rule]:
        """递归扫描所有规则 .md 文件

        Args:
            max_depth: 最大嵌套目录深度（默认 3 级）

        Returns:
            Rule 列表
        """
        if not self.rules_dir_exists:
            return []

        rules: List[Rule] = []

        for file_path in self.rules_dir.rglob("*.md"):
            if not RULES_FILENAME_PATTERN.match(file_path.name):
                continue
            if file_path.stem.startswith("_"):
                # 跳过 _ 开头模板文件
                continue

            # 校验嵌套深度
            try:
                rel = file_path.relative_to(self.rules_dir)
                depth = len(rel.parts) - 1
                if depth > max_depth:
                    logger.debug(f"嵌套深度超限 ({depth}>{max_depth}): {file_path}")
                    continue
            except ValueError:
                continue

            rule = parse_rule_file(file_path)
            if rule is not None:
                rules.append(rule)

        # 按 priority 降序排序（高优先级在前）
        rules.sort(key=lambda r: (-r.priority, r.category, r.name))
        return rules

    def list_categories(self) -> List[Dict[str, Any]]:
        """列出所有分类

        Returns:
            分类列表 [{name, rule_count, rules: [names]}]
        """
        rules = self.scan_all()
        category_map: Dict[str, List[str]] = {}
        for r in rules:
            category_map.setdefault(r.category, []).append(r.name)
        return [
            {
                "name": cat,
                "rule_count": len(names),
                "rules": sorted(names),
            }
            for cat, names in sorted(category_map.items())
        ]

    def load_by_name(self, name: str) -> Optional[Rule]:
        """按 name 查找规则

        Args:
            name: 规则名

        Returns:
            Rule 实例；未找到返回 None
        """
        if not RULES_FILENAME_STEM_PATTERN.match(name):
            return None
        if not self.rules_dir_exists:
            return None

        # 尝试直接通过文件名查找
        direct = self.rules_dir / f"{name}.md"
        if direct.exists():
            return parse_rule_file(direct)

        # 递归查找
        for file_path in self.rules_dir.rglob(f"{name}.md"):
            if file_path.stem.startswith("_"):
                continue
            return parse_rule_file(file_path)
        return None

    def load_by_category(self, category: str) -> List[Rule]:
        """按 category 加载该分类下所有规则

        Args:
            category: 分类路径（如 "python" 或 "python/testing"）

        Returns:
            Rule 列表
        """
        if not self.rules_dir_exists:
            return []
        all_rules = self.scan_all()
        return [r for r in all_rules if r.category == category]

    def load_by_path(self, file_path: Union[str, Path]) -> Optional[Rule]:
        """按文件路径加载（不限于本项目）"""
        return parse_rule_file(file_path)


# ============================================================
# 跨项目注册表
# ============================================================
class TraeRulesRegistry:
    """跨项目的 .trae/rules/ 注册表

    线程安全（RLock 保护）。
    维护 project_path -> {name: Rule} 映射。
    """

    def __init__(self):
        self._lock = threading.RLock()
        # project_path -> {name: Rule}
        self._by_project: Dict[str, Dict[str, Rule]] = {}

    def register_project(self, project_path: Union[str, Path]) -> int:
        """扫描并注册项目规则

        Args:
            project_path: 项目根目录

        Returns:
            注册的规则数量
        """
        project_path = str(Path(project_path).absolute())
        loader = TraeRulesLoader(project_path)
        rules = loader.scan_all()

        with self._lock:
            self._by_project[project_path] = {r.name: r for r in rules}

        logger.info(f"Registered {len(rules)} rules for {project_path}")
        return len(rules)

    def unregister_project(self, project_path: Union[str, Path]) -> bool:
        """注销项目"""
        project_path = str(Path(project_path).absolute())
        with self._lock:
            if project_path in self._by_project:
                del self._by_project[project_path]
                return True
            return False

    def list_rules(
        self, project_path: Optional[Union[str, Path]] = None
    ) -> List[Rule]:
        """列出规则

        Args:
            project_path: 项目路径（None = 跨项目）

        Returns:
            Rule 列表
        """
        with self._lock:
            if project_path is None:
                result: List[Rule] = []
                for m in self._by_project.values():
                    result.extend(m.values())
                return result
            pp = str(Path(project_path).absolute())
            m = self._by_project.get(pp, {})
            return list(m.values())

    def list_summaries(
        self, project_path: Optional[Union[str, Path]] = None
    ) -> List[Dict[str, Any]]:
        """列出规则摘要（轻量）"""
        rules = self.list_rules(project_path)
        return [r.to_summary_dict() for r in rules]

    def list_categories(
        self, project_path: Optional[Union[str, Path]] = None
    ) -> List[Dict[str, Any]]:
        """列出所有分类"""
        rules = self.list_rules(project_path)
        category_map: Dict[str, List[str]] = {}
        for r in rules:
            category_map.setdefault(r.category, []).append(r.name)
        return [
            {
                "name": cat,
                "rule_count": len(names),
                "rules": sorted(names),
            }
            for cat, names in sorted(category_map.items())
        ]

    def get_rule(
        self,
        name: str,
        project_path: Optional[Union[str, Path]] = None,
    ) -> Optional[Rule]:
        """按 name 查找规则"""
        with self._lock:
            if project_path is not None:
                pp = str(Path(project_path).absolute())
                m = self._by_project.get(pp, {})
                return m.get(name)
            for m in self._by_project.values():
                if name in m:
                    return m[name]
            return None

    def load_by_name(
        self,
        name: str,
        project_path: Optional[Union[str, Path]] = None,
    ) -> Optional[Rule]:
        """按需加载规则（与 get_rule 类似，但优先使用 project_path 文件）"""
        rule = self.get_rule(name, project_path)
        if rule is not None:
            return rule
        # 跨项目查找并尝试加载
        with self._lock:
            for pp, m in self._by_project.items():
                if name in m:
                    project_path = pp
                    break
        if project_path is None:
            return None
        loader = TraeRulesLoader(project_path)
        return loader.load_by_name(name)

    def get_stats(self) -> Dict[str, Any]:
        """获取统计"""
        with self._lock:
            total = sum(len(m) for m in self._by_project.values())
            # 统计所有分类
            all_categories: set = set()
            for m in self._by_project.values():
                for r in m.values():
                    all_categories.add(r.category)
            return {
                "projects": len(self._by_project),
                "rules": total,
                "categories": len(all_categories),
            }


# ============================================================
# 全局单例
# ============================================================
_global_registry: Optional[TraeRulesRegistry] = None
_global_lock = threading.Lock()


def get_global_rules_registry() -> TraeRulesRegistry:
    """获取全局规则注册表（双重检查锁单例）"""
    global _global_registry
    if _global_registry is None:
        with _global_lock:
            if _global_registry is None:
                _global_registry = TraeRulesRegistry()
    return _global_registry


def reset_global_rules_registry() -> None:
    """重置全局注册表（测试用）"""
    global _global_registry
    with _global_lock:
        _global_registry = None
