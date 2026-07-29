"""
# TRAE Work - Global Memory（项目级知识库）
# ============================================================
# 核心作用：实现 TRAE Work 的 Global Memory 系统
# 关联：Cycle 14 P1-3
# 版本：v6.31.0
#
# 核心能力：
#   - 项目级知识条目 CRUD
#   - 5 类别管理：preference | fact | context | rule | todo
#   - 多标签检索
#   - 生命周期管理：active | archived | deprecated
#   - 使用统计 + 时间衰减
#   - 语义检索：tag 匹配 + 关键词 + 衰减因子
#
# 算法：
#   - 相关性评分：
#     score = 0.4 * tag_match + 0.4 * keyword + 0.2 * recency_factor
#     其中 recency_factor = exp(-days_since_last_use / 30)
#   - 复杂度：O(N) N = 项目内条目数
# ============================================================
"""

from __future__ import annotations

import math
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from .models import (
    KnowledgeCategory,
    KnowledgeEntry,
    KnowledgeSource,
    KnowledgeStatus,
    _new_id,
    _now_iso,
)


# ============================================================
# 文本相似度计算
# ============================================================

# 简单的分词器（中英文混合）
def _tokenize(text: str) -> List[str]:
    """简单分词：中文字符、英文单词、数字"""
    if not text:
        return []
    text = text.lower()
    tokens: List[str] = []
    # 提取中文字符（2字以上成词）
    chinese_words = re.findall(r"[\u4e00-\u9fa5]{2,}", text)
    tokens.extend(chinese_words)
    # 单字中文
    chinese_chars = re.findall(r"[\u4e00-\u9fa5]", text)
    tokens.extend(chinese_chars)
    # 英文单词
    english_words = re.findall(r"[a-z]{2,}", text)
    tokens.extend(english_words)
    # 数字
    numbers = re.findall(r"\d+", text)
    tokens.extend(numbers)
    return tokens


# 停用词
STOP_WORDS = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been",
    "的", "了", "是", "在", "有", "和", "与", "或", "但", "我", "你", "他",
    "this", "that", "these", "those", "it", "its",
}


def _compute_text_similarity(query_tokens: List[str], text: str) -> float:
    """计算文本相似度（基于 token 重合度）

    Returns:
        0-1 之间的相似度分数
    """
    if not query_tokens or not text:
        return 0.0
    text_tokens = [t for t in _tokenize(text) if t not in STOP_WORDS]
    if not text_tokens:
        return 0.0
    query_set = set(t for t in query_tokens if t not in STOP_WORDS)
    if not query_set:
        return 0.0
    text_set = set(text_tokens)
    intersection = query_set & text_set
    if not intersection:
        return 0.0
    # Jaccard 相似度
    union = query_set | text_set
    return len(intersection) / len(union) if union else 0.0


def _compute_tag_match(query_tokens: List[str], tags: List[str]) -> float:
    """计算标签匹配度

    Returns:
        0-1 之间的匹配度
    """
    if not query_tokens or not tags:
        return 0.0
    query_set = set(t.lower() for t in query_tokens)
    tag_set = set(t.lower() for t in tags)
    intersection = query_set & tag_set
    return len(intersection) / len(tag_set) if tag_set else 0.0


def _days_since(iso_time: str) -> float:
    """计算距今多少天"""
    try:
        ts = time.mktime(time.strptime(iso_time, "%Y-%m-%dT%H:%M:%SZ"))
        diff = time.time() - ts
        return max(0.0, diff / 86400.0)
    except (ValueError, TypeError):
        return 0.0


def _recency_factor(iso_time: str, half_life_days: float = 30.0) -> float:
    """计算时间衰减因子"""
    days = _days_since(iso_time)
    if days < 0:
        return 1.0
    return math.exp(-days / half_life_days)


# ============================================================
# Global Memory 服务类
# ============================================================


class GlobalMemoryService:
    """Global Memory 服务

    功能：
        - 项目级知识条目管理
        - 多维度检索（标签 + 关键词 + 时间衰减）
        - 生命周期管理
        - 使用统计
    """

    def __init__(self) -> None:
        # entry_id -> KnowledgeEntry
        self._entries: Dict[str, KnowledgeEntry] = {}
        import threading
        self._lock = threading.RLock()
        # 统计
        self._stats = {
            "created": 0,
            "updated": 0,
            "deleted": 0,
            "searches": 0,
            "active": 0,
            "archived": 0,
        }

    # ============================================================
    # 条目 CRUD
    # ============================================================

    def create_entry(
        self,
        project_id: str,
        category: str,
        content: str,
        tags: Optional[List[str]] = None,
        source: str = "user",
        confidence: float = 1.0,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> KnowledgeEntry:
        """创建知识条目

        Args:
            project_id: 项目 ID
            category: 类别（preference/fact/context/rule/todo）
            content: 内容
            tags: 标签列表
            source: 来源
            confidence: 置信度（0-1）
            metadata: 元数据

        Returns:
            KnowledgeEntry 实例
        """
        # 校验类别
        valid_categories = {c.value for c in KnowledgeCategory}
        if category not in valid_categories:
            raise ValueError(
                f"Invalid category: {category}. Valid: {sorted(valid_categories)}"
            )

        # 限制内容长度
        if len(content) > 16 * 1024:
            raise ValueError(f"Content too long: {len(content)} > 16384")

        # 限制置信度
        confidence = max(0.0, min(1.0, confidence))

        entry = KnowledgeEntry(
            entry_id=_new_id("kb"),
            project_id=project_id,
            category=category,
            content=content,
            tags=tags or [],
            source=source,
            confidence=confidence,
            metadata=metadata or {},
        )

        with self._lock:
            self._entries[entry.entry_id] = entry
            self._stats["created"] += 1
            self._update_active_count()

        return entry

    def get_entry(self, entry_id: str) -> Optional[KnowledgeEntry]:
        """获取条目"""
        with self._lock:
            entry = self._entries.get(entry_id)
            if entry:
                entry.touch()
                self._stats["searches"] += 1
            return entry

    def list_entries(
        self,
        project_id: Optional[str] = None,
        category: Optional[str] = None,
        tags: Optional[List[str]] = None,
        status: str = "active",
        limit: int = 50,
    ) -> List[KnowledgeEntry]:
        """列条目

        Args:
            project_id: 项目 ID 过滤
            category: 类别过滤
            tags: 标签过滤（任一匹配）
            status: 状态过滤
            limit: 最大数量

        Returns:
            条目列表
        """
        with self._lock:
            results = list(self._entries.values())

        if project_id:
            results = [e for e in results if e.project_id == project_id]
        if category:
            results = [e for e in results if e.category == category]
        if tags:
            tag_set = set(t.lower() for t in tags)
            results = [e for e in results if tag_set & set(t.lower() for t in e.tags)]
        if status:
            results = [e for e in results if e.status == status]

        # 按 last_used_at 倒序
        results.sort(key=lambda e: e.last_used_at, reverse=True)
        return results[:limit]

    def update_entry(
        self,
        entry_id: str,
        content: Optional[str] = None,
        tags: Optional[List[str]] = None,
        category: Optional[str] = None,
        confidence: Optional[float] = None,
        status: Optional[str] = None,
    ) -> Optional[KnowledgeEntry]:
        """更新条目

        Args:
            entry_id: 条目 ID
            content: 新内容
            tags: 新标签
            category: 新类别
            confidence: 新置信度
            status: 新状态

        Returns:
            更新后的条目，None 表示未找到
        """
        with self._lock:
            entry = self._entries.get(entry_id)
            if not entry:
                return None

            if content is not None:
                if len(content) > 16 * 1024:
                    raise ValueError(f"Content too long: {len(content)} > 16384")
                entry.content = content
            if tags is not None:
                entry.tags = tags
            if category is not None:
                valid_categories = {c.value for c in KnowledgeCategory}
                if category not in valid_categories:
                    raise ValueError(f"Invalid category: {category}")
                entry.category = category
            if confidence is not None:
                entry.confidence = max(0.0, min(1.0, confidence))
            if status is not None:
                valid_statuses = {s.value for s in KnowledgeStatus}
                if status not in valid_statuses:
                    raise ValueError(f"Invalid status: {status}")
                entry.status = status

            entry.updated_at = _now_iso()
            self._stats["updated"] += 1
            self._update_active_count()
            return entry

    def delete_entry(self, entry_id: str) -> bool:
        """删除条目（硬删除）"""
        with self._lock:
            if entry_id in self._entries:
                del self._entries[entry_id]
                self._stats["deleted"] += 1
                self._update_active_count()
                return True
            return False

    def archive_entry(self, entry_id: str) -> bool:
        """归档条目（软删除）"""
        result = self.update_entry(entry_id, status="archived")
        return result is not None

    def deprecate_entry(self, entry_id: str) -> bool:
        """废弃条目"""
        result = self.update_entry(entry_id, status="deprecated")
        return result is not None

    # ============================================================
    # 检索
    # ============================================================

    def search(
        self,
        project_id: str,
        query: str,
        top_k: int = 5,
        categories: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
        min_relevance: float = 0.0,
    ) -> List[KnowledgeEntry]:
        """检索条目

        Args:
            project_id: 项目 ID
            query: 查询关键词
            top_k: 返回数量
            categories: 限定类别
            tags: 限定标签
            min_relevance: 最低相关性

        Returns:
            按相关性排序的条目列表（已更新 use_count + last_used_at）
        """
        query_tokens = _tokenize(query)
        if not query_tokens:
            return []

        candidates: List[KnowledgeEntry] = []
        with self._lock:
            for entry in self._entries.values():
                if entry.project_id != project_id:
                    continue
                if entry.status != "active":
                    continue
                if categories and entry.category not in categories:
                    continue
                if tags:
                    tag_set = set(t.lower() for t in tags)
                    if not (tag_set & set(t.lower() for t in entry.tags)):
                        continue
                candidates.append(entry)

        # 计算相关性分数
        scored: List[Tuple[KnowledgeEntry, float]] = []
        for entry in candidates:
            tag_score = _compute_tag_match(query_tokens, entry.tags)
            text_score = _compute_text_similarity(query_tokens, entry.content)
            recency = _recency_factor(entry.last_used_at)
            # 加权：tag 0.4 + text 0.4 + recency 0.2
            score = (
                tag_score * 0.4
                + text_score * 0.4
                + recency * 0.2
            ) * entry.confidence

            if score >= min_relevance:
                scored.append((entry, score))

        # 按分数降序
        scored.sort(key=lambda x: x[1], reverse=True)
        top = [e for e, _ in scored[:top_k]]

        # 更新使用统计
        with self._lock:
            self._stats["searches"] += 1
            for entry in top:
                entry.touch()

        return top

    def search_with_score(
        self,
        project_id: str,
        query: str,
        top_k: int = 5,
    ) -> List[Tuple[KnowledgeEntry, float]]:
        """检索并返回分数

        Returns:
            (entry, score) 列表
        """
        query_tokens = _tokenize(query)
        if not query_tokens:
            return []

        candidates: List[KnowledgeEntry] = []
        with self._lock:
            for entry in self._entries.values():
                if entry.project_id != project_id:
                    continue
                if entry.status != "active":
                    continue
                candidates.append(entry)

        scored: List[Tuple[KnowledgeEntry, float]] = []
        for entry in candidates:
            tag_score = _compute_tag_match(query_tokens, entry.tags)
            text_score = _compute_text_similarity(query_tokens, entry.content)
            recency = _recency_factor(entry.last_used_at)
            score = (
                tag_score * 0.4
                + text_score * 0.4
                + recency * 0.2
            ) * entry.confidence
            scored.append((entry, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:top_k]

    # ============================================================
    # 统计
    # ============================================================

    def get_stats(self, project_id: Optional[str] = None) -> Dict[str, Any]:
        """获取统计

        Args:
            project_id: 项目 ID（None 表示全局）

        Returns:
            统计字典
        """
        with self._lock:
            self._update_active_count()
            if project_id is None:
                return dict(self._stats)
            entries = [e for e in self._entries.values() if e.project_id == project_id]
            return {
                "project_id": project_id,
                "total": len(entries),
                "active": sum(1 for e in entries if e.status == "active"),
                "archived": sum(1 for e in entries if e.status == "archived"),
                "deprecated": sum(1 for e in entries if e.status == "deprecated"),
                "by_category": {
                    c.value: sum(1 for e in entries if e.category == c.value)
                    for c in KnowledgeCategory
                },
            }

    def list_projects(self) -> List[str]:
        """列出所有项目 ID"""
        with self._lock:
            return sorted(set(e.project_id for e in self._entries.values()))

    def get_context_for_query(
        self,
        project_id: str,
        query: str,
        top_k: int = 3,
    ) -> List[Dict[str, Any]]:
        """为查询构建上下文（用于注入到 LLM prompt）

        Args:
            project_id: 项目 ID
            query: 查询
            top_k: 最多条目

        Returns:
            上下文条目列表（精简）
        """
        entries = self.search(project_id, query, top_k=top_k, min_relevance=0.05)
        return [
            {
                "entry_id": e.entry_id,
                "category": e.category,
                "content": e.content[:500],  # 截断
                "tags": e.tags,
            }
            for e in entries
        ]

    def _update_active_count(self) -> None:
        """更新 active/archived 计数（需持有锁）"""
        self._stats["active"] = sum(1 for e in self._entries.values() if e.status == "active")
        self._stats["archived"] = sum(1 for e in self._entries.values() if e.status == "archived")


# 全局单例
GLOBAL_MEMORY = GlobalMemoryService()
