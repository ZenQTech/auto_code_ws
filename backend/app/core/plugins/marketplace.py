"""
# ============================================================
# Hermes Plugin Marketplace - 远端 Plugin 仓库
# ============================================================
# 核心作用：实现 Codex 风格的远端 Plugin 仓库（官方/社区/本地三层）
# 特性：
#   - 远端 Plugin 索引（mock + 真实）
#   - 一键安装/卸载
#   - 评分系统
#   - 版本管理
#   - 签名验证
#   - 搜索与分类
# Cycle 13 P1-1 新建
# ============================================================
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import random
import re
import threading
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 路径白名单
# ============================================================
import re as _re

ALLOWED_MARKETPLACE_PATHS = [
    _re.compile(r"^/home/qizheng/auto_code_data"),
    _re.compile(r"^/home/qizheng/auto_code_ws"),
    _re.compile(r"^/home/qizheng/.hermes"),
    _re.compile(r"^/tmp/marketplace_"),
    _re.compile(r"^/tmp/pytest-of-"),
    _re.compile(r"^/tmp/tmp"),
]


def is_marketplace_path_allowed(path: str) -> bool:
    if not path:
        return True
    p = Path(path).resolve()
    path_str = str(p)
    for pattern in ALLOWED_MARKETPLACE_PATHS:
        if pattern.match(path_str):
            return True
    return False


# ============================================================
# 数据模型
# ============================================================
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{random.randint(10000000, 99999999):08x}"


@dataclass
class PluginVersion:
    """单个版本信息"""
    version: str
    released_at: str
    changelog: str = ""
    download_url: str = ""
    signature: str = ""
    size_kb: int = 0
    min_hermes_version: str = ""
    dependencies: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PluginVersion":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class MarketplacePlugin:
    """Marketplace 中的 Plugin 条目"""
    id: str
    name: str
    description: str
    author: str
    homepage: str = ""
    repository: str = ""
    license: str = "MIT"
    keywords: List[str] = field(default_factory=list)
    categories: List[str] = field(default_factory=list)
    icon: str = ""
    versions: List[PluginVersion] = field(default_factory=list)
    latest_version: str = ""
    total_downloads: int = 0
    rating_sum: float = 0.0
    rating_count: int = 0
    verified: bool = False  # 官方认证
    source: str = "official"  # official/community/local
    created_at: str = field(default_factory=_now_iso)
    updated_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "author": self.author,
            "homepage": self.homepage,
            "repository": self.repository,
            "license": self.license,
            "keywords": list(self.keywords),
            "categories": list(self.categories),
            "icon": self.icon,
            "versions": [v.to_dict() for v in self.versions],
            "latest_version": self.latest_version,
            "total_downloads": self.total_downloads,
            "rating_sum": self.rating_sum,
            "rating_count": self.rating_count,
            "avg_rating": self.avg_rating,
            "verified": self.verified,
            "source": self.source,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @property
    def avg_rating(self) -> float:
        if self.rating_count == 0:
            return 0.0
        return round(self.rating_sum / self.rating_count, 2)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MarketplacePlugin":
        versions_data = data.get("versions", []) or []
        versions = [PluginVersion.from_dict(v) if isinstance(v, dict) else v for v in versions_data]
        # 过滤掉非数据模型字段
        allowed = {k: v for k, v in data.items() if k in cls.__dataclass_fields__}
        allowed["versions"] = versions
        return cls(**allowed)


@dataclass
class Rating:
    """用户评分"""
    plugin_id: str
    user: str
    score: int  # 1-5
    comment: str = ""
    created_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Rating":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


# ============================================================
# 评分存储
# ============================================================
class RatingStore:
    """评分存储（线程安全）"""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._ratings: Dict[str, List[Rating]] = {}  # plugin_id -> [Rating]

    def add(self, rating: Rating) -> Rating:
        with self._lock:
            # 检查是否已评分过（同一用户）
            existing = [r for r in self._ratings.get(rating.plugin_id, []) if r.user == rating.user]
            if existing:
                # 更新已有评分
                existing[0].score = rating.score
                existing[0].comment = rating.comment
                existing[0].created_at = rating.created_at
            else:
                self._ratings.setdefault(rating.plugin_id, []).append(rating)
            return rating

    def list_for_plugin(self, plugin_id: str) -> List[Rating]:
        with self._lock:
            return list(self._ratings.get(plugin_id, []))

    def list_all(self) -> List[Rating]:
        with self._lock:
            return [r for rs in self._ratings.values() for r in rs]

    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "total_ratings": sum(len(rs) for rs in self._ratings.values()),
                "plugins_with_ratings": len(self._ratings),
            }


# ============================================================
# Marketplace 核心
# ============================================================
class PluginMarketplace:
    """
    Plugin Marketplace 核心
    三层 Plugin 目录：
      1. official - 官方市场
      2. community - 社区市场
      3. local - 本地仓库
    """

    def __init__(self, store_dir: Optional[str] = None) -> None:
        self._lock = threading.RLock()
        self._plugins: Dict[str, MarketplacePlugin] = {}
        self.ratings = RatingStore()
        # 持久化
        if store_dir is None:
            store_dir = str(Path.home() / ".hermes" / "marketplace")
        self.store_dir = Path(store_dir)
        if is_marketplace_path_allowed(str(self.store_dir)) or str(self.store_dir) == str(Path.home() / ".hermes" / "marketplace"):
            try:
                self.store_dir.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                logger.warning(f"Create marketplace dir failed: {e}")
        self.index_file = self.store_dir / "index.jsonl"
        self.ratings_file = self.store_dir / "ratings.jsonl"
        # 加载已有数据
        self._load()
        # 注入 mock 数据（如果没有）
        if not self._plugins:
            self._inject_mock_data()

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------
    def publish(self, plugin: MarketplacePlugin) -> MarketplacePlugin:
        """发布 Plugin 到 Marketplace"""
        with self._lock:
            if not plugin.latest_version and plugin.versions:
                plugin.latest_version = plugin.versions[0].version
            plugin.updated_at = _now_iso()
            self._plugins[plugin.id] = plugin
            self._append_index(plugin)
            logger.info(f"Published plugin: {plugin.id} v{plugin.latest_version}")
            return plugin

    def unpublish(self, plugin_id: str) -> bool:
        """从 Marketplace 移除"""
        with self._lock:
            if plugin_id not in self._plugins:
                return False
            del self._plugins[plugin_id]
            self._save_index()
            logger.info(f"Unpublished plugin: {plugin_id}")
            return True

    def get(self, plugin_id: str) -> Optional[MarketplacePlugin]:
        with self._lock:
            return self._plugins.get(plugin_id)

    def list(
        self,
        source: Optional[str] = None,
        category: Optional[str] = None,
        verified_only: bool = False,
    ) -> List[MarketplacePlugin]:
        """列出 Plugin（可按 source/category 过滤）"""
        with self._lock:
            results = list(self._plugins.values())
        if source:
            results = [p for p in results if p.source == source]
        if category:
            results = [p for p in results if category in p.categories]
        if verified_only:
            results = [p for p in results if p.verified]
        # 按下载量降序
        results.sort(key=lambda p: p.total_downloads, reverse=True)
        return results

    def search(self, query: str) -> List[MarketplacePlugin]:
        """搜索 Plugin"""
        q = query.lower().strip()
        if not q:
            return self.list()
        with self._lock:
            results = []
            for p in self._plugins.values():
                if (
                    q in p.id.lower()
                    or q in p.name.lower()
                    or q in p.description.lower()
                    or any(q in kw.lower() for kw in p.keywords)
                    or any(q in c.lower() for c in p.categories)
                ):
                    results.append(p)
        results.sort(key=lambda p: p.total_downloads, reverse=True)
        return results

    def categories(self) -> List[str]:
        """所有分类"""
        with self._lock:
            cats = set()
            for p in self._plugins.values():
                for c in p.categories:
                    cats.add(c)
        return sorted(cats)

    def get_versions(self, plugin_id: str) -> List[PluginVersion]:
        with self._lock:
            p = self._plugins.get(plugin_id)
            if p is None:
                return []
            return list(p.versions)

    def get_latest_version(self, plugin_id: str) -> Optional[PluginVersion]:
        with self._lock:
            p = self._plugins.get(plugin_id)
            if p is None or not p.versions:
                return None
            # 找到匹配 latest_version 的版本
            for v in p.versions:
                if v.version == p.latest_version:
                    return v
            return p.versions[0]

    # ------------------------------------------------------------------
    # 评分
    # ------------------------------------------------------------------
    def rate(self, plugin_id: str, user: str, score: int, comment: str = "") -> Rating:
        """评分 Plugin（1-5）"""
        if score < 1 or score > 5:
            raise ValueError(f"Score must be 1-5, got {score}")
        with self._lock:
            if plugin_id not in self._plugins:
                raise KeyError(f"Plugin not found: {plugin_id}")
        rating = Rating(plugin_id=plugin_id, user=user, score=score, comment=comment)
        self.ratings.add(rating)
        # 重新计算评分统计
        with self._lock:
            plugin = self._plugins[plugin_id]
            all_ratings = self.ratings.list_for_plugin(plugin_id)
            plugin.rating_count = len(all_ratings)
            plugin.rating_sum = sum(r.score for r in all_ratings)
            self._append_index(plugin)
        return rating

    def get_ratings(self, plugin_id: str) -> List[Rating]:
        return self.ratings.list_for_plugin(plugin_id)

    # ------------------------------------------------------------------
    # 安装计数
    # ------------------------------------------------------------------
    def record_install(self, plugin_id: str) -> None:
        with self._lock:
            if plugin_id in self._plugins:
                self._plugins[plugin_id].total_downloads += 1
                self._append_index(self._plugins[plugin_id])

    # ------------------------------------------------------------------
    # 统计
    # ------------------------------------------------------------------
    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            total = len(self._plugins)
            by_source: Dict[str, int] = {}
            for p in self._plugins.values():
                by_source[p.source] = by_source.get(p.source, 0) + 1
            verified_count = sum(1 for p in self._plugins.values() if p.verified)
            total_downloads = sum(p.total_downloads for p in self._plugins.values())
        rating_stats = self.ratings.get_stats()
        return {
            "total_plugins": total,
            "by_source": by_source,
            "verified": verified_count,
            "total_downloads": total_downloads,
            "categories": self.categories(),
            "ratings": rating_stats,
        }

    # ------------------------------------------------------------------
    # 签名验证（简化版：基于 plugin_id + version 的 SHA256）
    # ------------------------------------------------------------------
    def verify_signature(self, plugin_id: str, version: str, signature: str) -> bool:
        """
        验证 Plugin 签名（mock 实现）
        真实场景应使用 GPG/Ed25519 等加密签名
        """
        expected = self._compute_signature(plugin_id, version)
        return expected == signature

    def _compute_signature(self, plugin_id: str, version: str) -> str:
        raw = f"{plugin_id}@{version}".encode("utf-8")
        return hashlib.sha256(raw).hexdigest()[:16]

    def sign(self, plugin_id: str, version: str) -> str:
        """生成签名（用于发布时）"""
        return self._compute_signature(plugin_id, version)

    # ------------------------------------------------------------------
    # 持久化
    # ------------------------------------------------------------------
    def _append_index(self, plugin: MarketplacePlugin) -> None:
        try:
            with open(self.index_file, "a", encoding="utf-8") as fp:
                fp.write(json.dumps(plugin.to_dict(), ensure_ascii=False) + "\n")
        except Exception as e:
            logger.warning(f"Append index failed: {e}")

    def _save_index(self) -> None:
        try:
            with open(self.index_file, "w", encoding="utf-8") as fp:
                for p in self._plugins.values():
                    fp.write(json.dumps(p.to_dict(), ensure_ascii=False) + "\n")
        except Exception as e:
            logger.warning(f"Save index failed: {e}")

    def _load(self) -> None:
        if not self.index_file.exists():
            return
        try:
            # 清空并重新加载（取最后一条）
            latest: Dict[str, Dict[str, Any]] = {}
            with open(self.index_file, "r", encoding="utf-8") as fp:
                for line in fp:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        latest[data["id"]] = data
                    except Exception:
                        pass
            for data in latest.values():
                try:
                    p = MarketplacePlugin.from_dict(data)
                    self._plugins[p.id] = p
                except Exception as e:
                    logger.warning(f"Load plugin failed: {e}")
        except Exception as e:
            logger.warning(f"Load marketplace failed: {e}")

    # ------------------------------------------------------------------
    # Mock 数据注入
    # ------------------------------------------------------------------
    def _inject_mock_data(self) -> None:
        """注入 5+ 示例 Plugin 用于演示"""
        mock_plugins = [
            {
                "id": "hermes.code-formatter",
                "name": "Code Formatter Pro",
                "description": "Automatic code formatting with multi-language support (Python/JS/Go/Rust)",
                "author": "Hermes Team",
                "homepage": "https://hermes.dev/plugins/code-formatter",
                "repository": "https://github.com/hermes/code-formatter",
                "license": "Apache-2.0",
                "keywords": ["formatter", "lint", "code-quality"],
                "categories": ["code-quality", "developer-tools"],
                "icon": "🎨",
                "verified": True,
                "source": "official",
                "total_downloads": 12500,
                "versions": [
                    {"version": "2.1.0", "released_at": "2026-07-15T00:00:00Z", "changelog": "Add Rust support", "size_kb": 256, "min_hermes_version": "6.20.0", "dependencies": []},
                    {"version": "2.0.0", "released_at": "2026-06-01T00:00:00Z", "changelog": "Major refactor", "size_kb": 240, "min_hermes_version": "6.18.0", "dependencies": []},
                ],
            },
            {
                "id": "hermes.test-runner",
                "name": "Parallel Test Runner",
                "description": "Run unit tests in parallel with intelligent sharding and result aggregation",
                "author": "Community",
                "license": "MIT",
                "keywords": ["test", "ci", "parallel"],
                "categories": ["testing", "ci-cd"],
                "icon": "🧪",
                "verified": False,
                "source": "community",
                "total_downloads": 8200,
                "versions": [
                    {"version": "1.5.2", "released_at": "2026-07-20T00:00:00Z", "changelog": "Bug fixes", "size_kb": 128, "min_hermes_version": "6.15.0", "dependencies": []},
                ],
            },
            {
                "id": "hermes.security-scanner",
                "name": "Security Vulnerability Scanner",
                "description": "Scan code for OWASP top 10 vulnerabilities and CVEs",
                "author": "Hermes Security Team",
                "license": "Apache-2.0",
                "keywords": ["security", "owasp", "cve", "scanner"],
                "categories": ["security", "code-quality"],
                "icon": "🔒",
                "verified": True,
                "source": "official",
                "total_downloads": 21000,
                "versions": [
                    {"version": "3.0.0", "released_at": "2026-07-25T00:00:00Z", "changelog": "Add CVE database integration", "size_kb": 512, "min_hermes_version": "6.20.0", "dependencies": ["hermes.code-formatter>=2.0.0"]},
                ],
            },
            {
                "id": "hermes.docs-generator",
                "name": "Auto Documentation Generator",
                "description": "Generate beautiful API docs from code with examples and diagrams",
                "author": "DocOps",
                "license": "MIT",
                "keywords": ["docs", "documentation", "api"],
                "categories": ["docs", "developer-tools"],
                "icon": "📚",
                "verified": False,
                "source": "community",
                "total_downloads": 5400,
                "versions": [
                    {"version": "1.2.0", "released_at": "2026-07-10T00:00:00Z", "changelog": "Add Mermaid diagram support", "size_kb": 320, "min_hermes_version": "6.18.0", "dependencies": []},
                ],
            },
            {
                "id": "hermes.metrics-dashboard",
                "name": "Real-time Metrics Dashboard",
                "description": "Live metrics dashboard for Hermes tasks, agents, and resource usage",
                "author": "Hermes Team",
                "license": "Apache-2.0",
                "keywords": ["metrics", "monitoring", "dashboard"],
                "categories": ["monitoring", "observability"],
                "icon": "📊",
                "verified": True,
                "source": "official",
                "total_downloads": 9800,
                "versions": [
                    {"version": "1.0.5", "released_at": "2026-07-22T00:00:00Z", "changelog": "Performance improvements", "size_kb": 410, "min_hermes_version": "6.19.0", "dependencies": []},
                ],
            },
            {
                "id": "hermes.git-hooks",
                "name": "Advanced Git Hooks",
                "description": "Powerful pre-commit/post-commit hooks with auto-formatting and validation",
                "author": "DevTools",
                "license": "BSD-3-Clause",
                "keywords": ["git", "hooks", "automation"],
                "categories": ["git", "developer-tools"],
                "icon": "🪝",
                "verified": False,
                "source": "community",
                "total_downloads": 3700,
                "versions": [
                    {"version": "0.9.0", "released_at": "2026-07-18T00:00:00Z", "changelog": "Beta release", "size_kb": 96, "min_hermes_version": "6.17.0", "dependencies": []},
                ],
            },
        ]
        for mp in mock_plugins:
            versions = [PluginVersion.from_dict(v) for v in mp.pop("versions", [])]
            plugin = MarketplacePlugin(
                **{k: v for k, v in mp.items() if k in MarketplacePlugin.__dataclass_fields__},
                versions=versions,
            )
            if not plugin.latest_version and versions:
                plugin.latest_version = versions[0].version
            self._plugins[plugin.id] = plugin
            # 自动生成签名
            for v in versions:
                v.signature = self.sign(plugin.id, v.version)
        # 保存到磁盘
        self._save_index()
        logger.info(f"Injected {len(mock_plugins)} mock plugins to marketplace")


# ============================================================
# 全局单例
# ============================================================
_marketplace_instance: Optional[PluginMarketplace] = None
_marketplace_lock = threading.Lock()


def get_marketplace() -> PluginMarketplace:
    global _marketplace_instance
    if _marketplace_instance is None:
        with _marketplace_lock:
            if _marketplace_instance is None:
                _marketplace_instance = PluginMarketplace()
    return _marketplace_instance


def reset_marketplace() -> None:
    global _marketplace_instance
    _marketplace_instance = None
