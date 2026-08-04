"""
# ============================================================
# 多源上下文选择器 (v1.0.0)
# Cycle 62 G62-02
# ====================================
# 核心作用：支持 6 种上下文源（文件/代码片段/终端输出/Git/文档/网页）
# 运行流程：
#   1. 用户通过 API 添加上下文源
#   2. ContextManager 异步加载内容（带 token 估算）
#   3. 合并为统一的 ContextBundle
#   4. 注入到 LLM prompt 或任务输入
# 设计要点：
#   - 每种源独立加载器（解耦）
#   - token 估算（粗略字符 / 4）
#   - 持久化到磁盘
#   - 错误隔离：单源失败不影响其他
# 输入参数：source_type, source_data
# 输出结果：ContextBundle
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 62 G62-02 初次创建
# ====================================
"""

import asyncio
import json
import logging
import os
import subprocess
import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 数据类型
# ============================================================


class ContextSourceType(str, Enum):
    """上下文源类型"""
    FILE = "file"           # 单文件
    CODE = "code"           # 代码片段（行范围）
    TERMINAL = "terminal"   # 终端输出
    GIT = "git"             # Git 仓库（commit / branch / diff）
    DOCUMENT = "document"   # 文档（Markdown / URL）
    WEB = "web"             # 网页 URL


@dataclass
class ContextItem:
    """单个上下文项"""
    item_id: str
    source_type: ContextSourceType
    source_data: Dict[str, Any]
    content: str = ""
    token_count: int = 0
    loaded_at: float = 0.0
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            **asdict(self),
            "source_type": self.source_type.value,
            "loaded": self.error is None and self.content != "",
        }


@dataclass
class ContextBundle:
    """上下文集合"""
    bundle_id: str
    items: List[ContextItem] = field(default_factory=list)
    combined_content: str = ""
    total_tokens: int = 0
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "bundle_id": self.bundle_id,
            "items": [i.to_dict() for i in self.items],
            "item_count": len(self.items),
            "combined_content": self.combined_content,
            "total_tokens": self.total_tokens,
            "created_at": self.created_at,
        }


# ============================================================
# 源加载器
# ============================================================


def estimate_tokens(text: str) -> int:
    """粗略估算 token 数（每 4 字符约 1 token）"""
    if not text:
        return 0
    return max(1, len(text) // 4)


async def load_file_source(data: Dict[str, Any]) -> Tuple[str, int, Optional[str]]:
    """
    加载文件源

    data: {"path": "/abs/path", "max_size": 10000}
    """
    path = data.get("path", "")
    max_size = data.get("max_size", 100000)
    if not path or not os.path.isfile(path):
        return "", 0, f"文件不存在: {path}"
    try:
        size = os.path.getsize(path)
        if size > max_size:
            # 截断读取
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read(max_size)
            content += f"\n\n... [文件过大，已截断: 实际 {size} bytes]"
        else:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        return content, estimate_tokens(content), None
    except (OSError, UnicodeDecodeError) as e:
        return "", 0, f"读取失败: {e}"


async def load_code_source(data: Dict[str, Any]) -> Tuple[str, int, Optional[str]]:
    """
    加载代码片段

    data: {"path": "/abs/path", "start_line": 1, "end_line": 100}
    """
    path = data.get("path", "")
    start = data.get("start_line", 1)
    end = data.get("end_line", start + 100)
    if not path or not os.path.isfile(path):
        return "", 0, f"文件不存在: {path}"
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        # 1-based 转 0-based
        selected = lines[max(0, start - 1):end]
        content = "".join(selected)
        return content, estimate_tokens(content), None
    except (OSError, UnicodeDecodeError) as e:
        return "", 0, f"读取失败: {e}"


async def load_git_source(data: Dict[str, Any]) -> Tuple[str, int, Optional[str]]:
    """
    加载 Git 信息

    data: {"repo_path": "/path", "type": "diff|log|branch", "ref": "HEAD"}
    """
    repo_path = data.get("repo_path", "")
    info_type = data.get("type", "log")
    ref = data.get("ref", "HEAD")
    if not repo_path or not os.path.isdir(repo_path):
        return "", 0, f"仓库不存在: {repo_path}"

    try:
        if info_type == "log":
            cmd = ["git", "log", "--oneline", "-n", "20", ref]
        elif info_type == "diff":
            cmd = ["git", "diff", ref]
        elif info_type == "branch":
            cmd = ["git", "branch", "-a"]
        else:
            return "", 0, f"未知 git 类型: {info_type}"

        proc = await asyncio.create_subprocess_exec(
            *cmd, cwd=repo_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=10,
        )
        if proc.returncode != 0:
            return "", 0, f"git 命令失败: {stderr.decode('utf-8', errors='replace')[:500]}"
        content = stdout.decode("utf-8", errors="replace")
        return content, estimate_tokens(content), None
    except (asyncio.TimeoutError, FileNotFoundError) as e:
        return "", 0, f"git 加载失败: {e}"


async def load_document_source(data: Dict[str, Any]) -> Tuple[str, int, Optional[str]]:
    """
    加载文档

    data: {"url": "https://..."} 或 {"path": "/path/to.md"}
    """
    if "url" in data:
        # URL 文档
        url = data["url"]
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                content = resp.text[:50000]  # 限制大小
                return content, estimate_tokens(content), None
        except ImportError:
            return "", 0, "httpx 未安装"
        except Exception as e:  # noqa: BLE001
            return "", 0, f"URL 加载失败: {e}"
    elif "path" in data:
        return await load_file_source(data)
    else:
        return "", 0, "document 源需要 url 或 path"


async def load_web_source(data: Dict[str, Any]) -> Tuple[str, int, Optional[str]]:
    """
    加载网页

    data: {"url": "https://...", "selector": "main", "max_size": 20000}
    """
    url = data.get("url", "")
    if not url:
        return "", 0, "web 源需要 url"
    try:
        import httpx
        async with httpx.AsyncClient(
            timeout=10,
            follow_redirects=True,
            headers={"User-Agent": "Hermes-ContextBot/1.0"},
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            html = resp.text
            # 简单 HTML 剥离
            import re
            # 移除 script/style
            html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL)
            html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL)
            # 提取 selector 元素（简化版）
            selector = data.get("selector", "")
            if selector:
                # 简单实现：提取 <body>
                match = re.search(r"<body[^>]*>(.*?)</body>", html, flags=re.DOTALL)
                if match:
                    html = match.group(1)
            # 移除标签
            text = re.sub(r"<[^>]+>", " ", html)
            text = re.sub(r"\s+", " ", text).strip()
            max_size = data.get("max_size", 20000)
            if len(text) > max_size:
                text = text[:max_size] + f"... [截断: 原 {len(text)} 字符]"
            return text, estimate_tokens(text), None
    except ImportError:
        return "", 0, "httpx 未安装"
    except Exception as e:  # noqa: BLE001
        return "", 0, f"网页加载失败: {e}"


async def load_terminal_source(data: Dict[str, Any]) -> Tuple[str, int, Optional[str]]:
    """
    加载终端输出（执行命令）

    data: {"command": "ls -la", "cwd": "/path"}
    """
    command = data.get("command", "")
    cwd = data.get("cwd", os.getcwd())
    if not command:
        return "", 0, "terminal 源需要 command"
    try:
        proc = await asyncio.create_subprocess_shell(
            command, cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=data.get("timeout", 10),
        )
        content = stdout.decode("utf-8", errors="replace")
        if stderr:
            err = stderr.decode("utf-8", errors="replace")
            content += f"\n[stderr]: {err}"
        return content[:50000], estimate_tokens(content), None
    except asyncio.TimeoutError:
        return "", 0, "命令执行超时"
    except Exception as e:  # noqa: BLE001
        return "", 0, f"执行失败: {e}"


# 源类型 → 加载器映射
LOADERS = {
    ContextSourceType.FILE: load_file_source,
    ContextSourceType.CODE: load_code_source,
    ContextSourceType.TERMINAL: load_terminal_source,
    ContextSourceType.GIT: load_git_source,
    ContextSourceType.DOCUMENT: load_document_source,
    ContextSourceType.WEB: load_web_source,
}


# ============================================================
# 上下文管理器
# ============================================================


class ContextManager:
    """
    多源上下文管理器（全局单例）

    职责：
    1. 维护 context bundles
    2. 异步加载各种源
    3. 合并为 prompt 字符串
    """

    def __init__(self) -> None:
        # bundle_id -> ContextBundle
        self._bundles: Dict[str, ContextBundle] = {}
        self._lock = asyncio.Lock()

    async def add_item(
        self,
        bundle_id: str,
        source_type: ContextSourceType,
        source_data: Dict[str, Any],
    ) -> ContextItem:
        """
        添加上下文项到指定 bundle

        参数：
          - bundle_id: 目标 bundle
          - source_type: 源类型
          - source_data: 源数据
        返回值：ContextItem
        """
        item_id = f"ctx-{uuid.uuid4().hex[:12]}"
        item = ContextItem(
            item_id=item_id,
            source_type=source_type,
            source_data=source_data,
        )

        # 异步加载
        loader = LOADERS.get(source_type)
        if loader is None:
            item.error = f"未知源类型: {source_type}"
        else:
            try:
                content, tokens, err = await loader(source_data)
                item.content = content
                item.token_count = tokens
                item.loaded_at = time.time()
                if err:
                    item.error = err
            except Exception as e:  # noqa: BLE001
                item.error = f"加载异常: {e}"
                item.loaded_at = time.time()

        # 添加到 bundle
        async with self._lock:
            if bundle_id not in self._bundles:
                self._bundles[bundle_id] = ContextBundle(bundle_id=bundle_id)
            bundle = self._bundles[bundle_id]
            bundle.items.append(item)
            self._rebuild_bundle(bundle)
        return item

    def _rebuild_bundle(self, bundle: ContextBundle) -> None:
        """重新构建 bundle 合并内容"""
        parts = []
        total = 0
        for item in bundle.items:
            if item.error:
                parts.append(
                    f"# [{item.source_type.value}] 加载失败: {item.error}"
                )
            elif item.content:
                parts.append(
                    f"# === {item.source_type.value} ({item.item_id}) ==="
                )
                parts.append(item.content)
                parts.append("")
            total += item.token_count
        bundle.combined_content = "\n".join(parts).strip()
        bundle.total_tokens = total

    def get_bundle(self, bundle_id: str) -> Optional[ContextBundle]:
        """获取 bundle"""
        return self._bundles.get(bundle_id)

    def list_bundles(self) -> List[ContextBundle]:
        """列出所有 bundles"""
        return list(self._bundles.values())

    async def remove_item(self, bundle_id: str, item_id: str) -> bool:
        """从 bundle 移除 item"""
        async with self._lock:
            bundle = self._bundles.get(bundle_id)
            if not bundle:
                return False
            bundle.items = [i for i in bundle.items if i.item_id != item_id]
            self._rebuild_bundle(bundle)
            return True

    async def delete_bundle(self, bundle_id: str) -> bool:
        """删除 bundle"""
        async with self._lock:
            if bundle_id in self._bundles:
                del self._bundles[bundle_id]
                return True
            return False

    def get_stats(self) -> Dict[str, Any]:
        """统计"""
        total_items = sum(len(b.items) for b in self._bundles.values())
        total_tokens = sum(b.total_tokens for b in self._bundles.values())
        return {
            "bundle_count": len(self._bundles),
            "total_items": total_items,
            "total_tokens": total_tokens,
        }


# ============================================================
# 全局单例
# ============================================================

_manager: Optional[ContextManager] = None


def get_context_manager() -> ContextManager:
    """获取全局上下文管理器"""
    global _manager
    if _manager is None:
        _manager = ContextManager()
    return _manager


def reset_context_manager() -> None:
    """重置（用于测试）"""
    global _manager
    _manager = None
