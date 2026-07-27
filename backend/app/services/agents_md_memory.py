"""
# ============================================================
# AGENTS.md Memory System
# ============================================================
# 核心作用：自动读取项目 AGENTS.md 并注入到 LLM 提示词
# 设计要点：
#   1. 启动时扫描项目根 + 子目录
#   2. 内存缓存文件内容
#   3. 支持启用/禁用
#   4. 注入到 system prompt
# 运行流程：
#   扫描 → 读取 → 缓存 → 启用 → 注入
# 输入参数：project_path
# 输出结果：AGENTS.md 列表 + 拼接后的提示词块
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 2 T5 初始化
# ============================================================
"""

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)


class AgentsMdMemoryService:
    """
    AGENTS.md Memory 管理服务
    """

    # 最大文件大小（5MB）
    MAX_FILE_SIZE = 5 * 1024 * 1024
    # 默认排除目录
    EXCLUDE_DIRS = {".git", "node_modules", "__pycache__", "venv", ".venv", "dist", "build", ".next"}

    def __init__(self):
        self._memories: Dict[str, Dict[str, Any]] = {}
        logger.info("AgentsMdMemoryService 初始化完成")

    # ============================================================
    # 扫描
    # ============================================================
    def scan_project(
        self, project_path: str, max_depth: int = 3, include_subdirs: bool = True
    ) -> List[Dict[str, Any]]:
        """
        扫描项目目录，查找所有 AGENTS.md
        参数：
          - project_path 项目根路径
          - max_depth 最大扫描深度
          - include_subdirs 是否包含子目录
        返回值：找到的 AGENTS.md 列表
        """
        project = Path(project_path)
        if not project.exists() or not project.is_dir():
            logger.warning(f"项目路径不存在: {project_path}")
            return []

        # 根目录优先
        results = []
        root_agents = project / "AGENTS.md"
        if root_agents.exists():
            mem = self._load_file(root_agents, project)
            if mem:
                results.append(mem)

        # 扫描子目录
        if include_subdirs:
            for agents_md in self._walk_agents(project, max_depth):
                mem = self._load_file(agents_md, project)
                if mem:
                    results.append(mem)

        # 合并到内存
        for mem in results:
            self._memories[mem["id"]] = mem

        logger.info(f"扫描 {project_path}: 找到 {len(results)} 个 AGENTS.md")
        return results

    def _walk_agents(self, project: Path, max_depth: int):
        """
        递归遍历目录，查找 AGENTS.md
        """
        def _walk(current: Path, depth: int):
            if depth > max_depth:
                return
            try:
                for entry in current.iterdir():
                    if entry.is_dir():
                        if entry.name in self.EXCLUDE_DIRS:
                            continue
                        if entry.name.startswith("."):
                            continue
                        _walk(entry, depth + 1)
                    elif entry.is_file() and entry.name == "AGENTS.md":
                        yield entry
            except PermissionError:
                pass

        # 跳过根目录（已单独处理）
        for child in project.iterdir():
            if child.is_dir() and child.name not in self.EXCLUDE_DIRS and not child.name.startswith("."):
                yield from _walk(child, 1)

    def _load_file(self, file_path: Path, project_root: Path) -> Optional[Dict[str, Any]]:
        """
        加载单个 AGENTS.md
        """
        try:
            if not file_path.exists() or not file_path.is_file():
                return None
            stat = file_path.stat()
            if stat.st_size > self.MAX_FILE_SIZE:
                logger.warning(f"AGENTS.md 太大，跳过: {file_path} ({stat.st_size} bytes)")
                return None
            content = file_path.read_text(encoding="utf-8")
            memory_id = f"agents-md-{hash(str(file_path)) & 0xFFFFFFFF:08x}"
            relative = str(file_path.relative_to(project_root))
            return {
                "id": memory_id,
                "file_path": str(file_path),
                "relative_path": relative,
                "project_path": str(project_root),
                "content": content,
                "size": stat.st_size,
                "enabled": True,
                "last_loaded_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            logger.error(f"加载 AGENTS.md 失败: {file_path}: {e}")
            return None

    # ============================================================
    # CRUD
    # ============================================================
    def list_memories(self, enabled_only: bool = False) -> List[Dict[str, Any]]:
        """列出所有 AGENTS.md 记忆"""
        items = list(self._memories.values())
        if enabled_only:
            items = [m for m in items if m.get("enabled", False)]
        return items

    def get_memory(self, memory_id: str) -> Optional[Dict[str, Any]]:
        """获取单个 AGENTS.md 详情"""
        return self._memories.get(memory_id)

    def set_enabled(self, memory_id: str, enabled: bool) -> Optional[Dict[str, Any]]:
        """启用/禁用 AGENTS.md"""
        if memory_id not in self._memories:
            return None
        self._memories[memory_id]["enabled"] = enabled
        return self._memories[memory_id]

    def delete_memory(self, memory_id: str) -> bool:
        """从缓存中删除（不影响磁盘文件）"""
        if memory_id in self._memories:
            del self._memories[memory_id]
            return True
        return False

    # ============================================================
    # 提示词注入
    # ============================================================
    def build_injection_block(self) -> str:
        """
        构建注入到 LLM 提示词的 AGENTS.md 内容块
        返回值：注入块（无内容时返回空字符串）
        """
        enabled = [m for m in self._memories.values() if m.get("enabled", False)]
        if not enabled:
            return ""

        parts = ["## Project AGENTS.md Instructions\n"]
        parts.append("以下是从项目 AGENTS.md 文件加载的项目级规则，LLM 必须严格遵守：\n")
        for m in enabled:
            parts.append(f"\n### From: {m['relative_path']}\n")
            parts.append(m["content"])
            parts.append("\n---\n")

        return "\n".join(parts)
