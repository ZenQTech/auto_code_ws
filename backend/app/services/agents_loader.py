"""
# ============================================================
# AGENTS.md / CLAUDE.md 指令加载器 (v1.0.0)
# Cycle 62 G62-04
# ====================================
# 核心作用：扫描项目目录中的 AGENTS.md / CLAUDE.md / .trae/AGENTS.md
#           等项目级指令文件，加载到 LLM 调用的 system prompt 中
# 运行流程：
#   1. 任务创建时调用 find_instruction_files() 扫描项目根目录
#   2. 按优先级顺序加载：.trae/AGENTS.md > AGENTS.md > CLAUDE.md
#   3. 合并内容到 SystemPrompt
#   4. 支持热更新（文件变更时自动重载）
#   5. 提供 API 查看/编辑当前加载的指令
# 设计要点：
#   - 加载是只读快照，不修改原始文件
#   - 支持项目级 + 全局级（~/.trae/AGENTS.md）指令
#   - 解析 frontmatter（如有），支持 YAML 元数据
# 输入参数：project_path
# 输出结果：InstructionSet（聚合的指令集合）
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 62 G62-04 初次创建
# ====================================
"""

import asyncio
import hashlib
import logging
import os
import re
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import yaml

logger = logging.getLogger(__name__)


# ============================================================
# 数据类型
# ============================================================


class InstructionSource(str, Enum):
    """指令来源"""
    PROJECT_TRAE = "project_trae"     # .trae/AGENTS.md
    PROJECT_ROOT = "project_root"     # ./AGENTS.md
    PROJECT_CLAUDE = "project_claude" # ./CLAUDE.md
    GLOBAL_TRAE = "global_trae"       # ~/.trae/AGENTS.md
    USER_OVERRIDE = "user_override"   # 用户自定义


@dataclass
class InstructionFile:
    """单个指令文件"""
    source: InstructionSource
    path: str
    content: str
    raw_content: str
    frontmatter: Dict
    file_hash: str
    file_size: int
    modified_at: float
    loaded_at: float = field(default_factory=time.time)

    def to_dict(self) -> Dict:
        return {
            "source": self.source.value,
            "path": self.path,
            "content": self.content,
            "frontmatter": self.frontmatter,
            "file_hash": self.file_hash,
            "file_size": self.file_size,
            "modified_at": self.modified_at,
            "loaded_at": self.loaded_at,
        }


@dataclass
class InstructionSet:
    """聚合的指令集合"""
    project_path: str
    files: List[InstructionFile] = field(default_factory=list)
    combined_content: str = ""
    combined_hash: str = ""
    loaded_at: float = field(default_factory=time.time)

    def to_dict(self) -> Dict:
        return {
            "project_path": self.project_path,
            "files": [f.to_dict() for f in self.files],
            "combined_content": self.combined_content,
            "combined_hash": self.combined_hash,
            "file_count": len(self.files),
            "loaded_at": self.loaded_at,
        }


# ============================================================
# 指令加载器
# ============================================================


class AgentsInstructionLoader:
    """
    AGENTS.md / CLAUDE.md 指令加载器

    单例
    """

    # 按优先级排序的指令文件搜索路径
    SEARCH_PATHS: List[Tuple[InstructionSource, str]] = [
        (InstructionSource.PROJECT_TRAE, ".trae/AGENTS.md"),
        (InstructionSource.PROJECT_ROOT, "AGENTS.md"),
        (InstructionSource.PROJECT_CLAUDE, "CLAUDE.md"),
        (InstructionSource.GLOBAL_TRAE, "~/.trae/AGENTS.md"),
    ]

    # frontmatter 正则（YAML 元数据块）
    FRONTMATTER_RE = re.compile(
        r"^---\s*\n(.*?)\n---\s*\n(.*)$",
        re.DOTALL,
    )

    def __init__(self) -> None:
        # project_path -> InstructionSet
        self._cache: Dict[str, InstructionSet] = {}
        # 文件监控（未来扩展点）
        self._watchers: Dict[str, asyncio.Task] = {}
        # 锁
        self._locks: Dict[str, asyncio.Lock] = {}

    def _get_lock(self, project_path: str) -> asyncio.Lock:
        if project_path not in self._locks:
            self._locks[project_path] = asyncio.Lock()
        return self._locks[project_path]

    def _parse_frontmatter(self, content: str) -> Tuple[Dict, str]:
        """
        解析 frontmatter（YAML 元数据块）

        参数：content - 原始文件内容
        返回值：(frontmatter_dict, body_content)
        """
        match = self.FRONTMATTER_RE.match(content)
        if not match:
            return {}, content
        try:
            fm = yaml.safe_load(match.group(1)) or {}
            if not isinstance(fm, dict):
                fm = {}
            return fm, match.group(2)
        except yaml.YAMLError as e:  # noqa: BLE001
            logger.warning(f"frontmatter 解析失败: {e}")
            return {}, content

    def _compute_hash(self, content: str) -> str:
        """计算内容 SHA-256 哈希"""
        return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]

    def _read_file(self, file_path: Path) -> Optional[InstructionFile]:
        """
        读取单个指令文件

        参数：file_path - 文件绝对路径
        返回值：InstructionFile 或 None（文件不存在）
        """
        if not file_path.exists() or not file_path.is_file():
            return None
        try:
            raw_content = file_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as e:
            logger.warning(f"读取指令文件失败: {file_path} err={e}")
            return None

        frontmatter, body = self._parse_frontmatter(raw_content)
        stat = file_path.stat()

        # 推断来源
        source = self._infer_source(file_path)
        if source is None:
            return None

        return InstructionFile(
            source=source,
            path=str(file_path),
            content=body.strip(),
            raw_content=raw_content,
            frontmatter=frontmatter,
            file_hash=self._compute_hash(raw_content),
            file_size=stat.st_size,
            modified_at=stat.st_mtime,
        )

    def _infer_source(self, file_path: Path) -> Optional[InstructionSource]:
        """
        根据文件路径推断来源类型

        参数：file_path - 文件绝对路径
        返回值：InstructionSource 或 None（无法识别）
        """
        path_str = str(file_path)
        if path_str.endswith(".trae/AGENTS.md"):
            if "home" in path_str and ".trae" in path_str:
                # 全局 ~/.trae/AGENTS.md
                if file_path.parent.parent == Path.home():
                    return InstructionSource.GLOBAL_TRAE
            return InstructionSource.PROJECT_TRAE
        if file_path.name == "AGENTS.md":
            return InstructionSource.PROJECT_ROOT
        if file_path.name == "CLAUDE.md":
            return InstructionSource.PROJECT_CLAUDE
        return None

    def find_instruction_files(
        self, project_path: str,
    ) -> List[InstructionFile]:
        """
        查找项目目录下的所有指令文件

        参数：project_path - 项目根目录绝对路径
        返回值：InstructionFile 列表（按优先级排序）
        """
        project_root = Path(project_path).resolve()
        if not project_root.exists() or not project_root.is_dir():
            logger.warning(f"项目目录不存在: {project_path}")
            return []

        files: List[InstructionFile] = []
        for source, rel_path in self.SEARCH_PATHS:
            # 展开 ~ 为 home 目录
            expanded = Path(rel_path).expanduser()
            if expanded.is_absolute():
                file_path = expanded
            else:
                file_path = project_root / rel_path
            inst = self._read_file(file_path)
            if inst is not None:
                files.append(inst)

        return files

    def load(self, project_path: str, force: bool = False) -> InstructionSet:
        """
        加载项目的所有指令文件

        参数：
          - project_path: 项目根目录
          - force: 强制重新加载（忽略缓存）
        返回值：InstructionSet
        """
        # 检查缓存
        if not force and project_path in self._cache:
            cached = self._cache[project_path]
            # 检查文件是否变更
            for inst in cached.files:
                try:
                    if Path(inst.path).stat().st_mtime > inst.modified_at:
                        force = True
                        break
                except OSError:
                    force = True
                    break
            if not force:
                return cached

        files = self.find_instruction_files(project_path)

        # 合并内容
        combined_parts: List[str] = []
        for inst in files:
            header = f"# === {inst.source.value} ({inst.path}) ==="
            combined_parts.append(header)
            combined_parts.append(inst.content)
            combined_parts.append("")

        combined_content = "\n".join(combined_parts).strip()
        combined_hash = self._compute_hash(combined_content)

        result = InstructionSet(
            project_path=project_path,
            files=files,
            combined_content=combined_content,
            combined_hash=combined_hash,
        )

        # 缓存
        self._cache[project_path] = result
        logger.info(
            f"AGENTS.md 加载完成: project={project_path} "
            f"files={len(files)} hash={combined_hash}"
        )
        return result

    def reload(self, project_path: str) -> InstructionSet:
        """强制重新加载（忽略缓存）"""
        self.invalidate(project_path)
        return self.load(project_path, force=True)

    def invalidate(self, project_path: str) -> bool:
        """清除缓存"""
        if project_path in self._cache:
            del self._cache[project_path]
            return True
        return False

    def get_cached(self, project_path: str) -> Optional[InstructionSet]:
        """获取缓存（不触发加载）"""
        return self._cache.get(project_path)

    def build_system_prompt(
        self,
        project_path: str,
        base_prompt: str = "",
    ) -> str:
        """
        构建包含项目指令的 system prompt

        参数：
          - project_path: 项目根目录
          - base_prompt: 基础 system prompt
        返回值：合并后的完整 system prompt
        """
        inst_set = self.load(project_path)
        if not inst_set.combined_content:
            return base_prompt

        parts = []
        if base_prompt:
            parts.append(base_prompt)
        parts.append("")
        parts.append("# 项目级指令（AGENTS.md / CLAUDE.md）")
        parts.append("")
        parts.append(inst_set.combined_content)
        return "\n".join(parts)

    def get_stats(self) -> Dict:
        """获取加载器统计信息"""
        return {
            "cached_projects": len(self._cache),
            "total_files": sum(
                len(s.files) for s in self._cache.values()
            ),
            "projects": list(self._cache.keys()),
        }


# ============================================================
# 全局单例
# ============================================================

_loader: Optional[AgentsInstructionLoader] = None


def get_loader() -> AgentsInstructionLoader:
    """获取全局指令加载器单例"""
    global _loader
    if _loader is None:
        _loader = AgentsInstructionLoader()
    return _loader


def reset_loader() -> None:
    """重置（用于测试）"""
    global _loader
    _loader = None
