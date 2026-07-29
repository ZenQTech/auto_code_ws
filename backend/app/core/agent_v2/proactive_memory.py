"""
Hermes Agent v2 - 主动记忆引擎
==========================================
核心作用：Proactive Memory Engine 核心
        集成 PatternDetector + SuggestionEngine + 持久化
        提供建议生成、模式管理、主动召回 API
运行流程：操作 → 模式检测 → 模式持久化 → 建议生成 → 建议持久化
输入参数：操作、配置
输出结果：建议、模式
修改记录：
  - 2026-07-28 | v1.0.0 | Cycle 14 P0-1 初始版本
"""
from __future__ import annotations

import os
import json
import asyncio
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from threading import RLock
from pathlib import Path

from .models import (
    ProactivePattern,
    ProactiveSuggestion,
    SuggestionSource,
    _new_id,
    _now_iso,
)
from .pattern_detector import PatternDetector


def _get_storage_dir() -> Path:
    """获取持久化存储目录

    Returns:
        Path: 存储目录
    """
    base = os.environ.get("HERMES_AGENT_V2_DIR", "/tmp/hermes_agent_v2")
    storage = Path(base)
    storage.mkdir(parents=True, exist_ok=True)
    return storage


class ProactiveMemoryEngine:
    """主动记忆引擎

    集成模式检测、建议生成、持久化
    线程安全（RLock）

    Attributes:
        detector: 模式检测器
        storage_dir: 持久化目录
    """

    def __init__(
        self,
        min_occurrences: int = 3,
        min_confidence: float = 0.7,
        suggestion_expiry_hours: int = 24,
        enable_persistence: bool = True,
    ) -> None:
        """初始化引擎

        Args:
            min_occurrences: 最小重复次数
            min_confidence: 最低置信度
            suggestion_expiry_hours: 建议过期时间（小时）
            enable_persistence: 是否启用持久化
        """
        self._lock = RLock()
        self._detector = PatternDetector(
            min_occurrences=min_occurrences,
            min_confidence=min_confidence,
        )
        self._patterns: Dict[str, ProactivePattern] = {}
        self._suggestions: Dict[str, ProactiveSuggestion] = {}
        self._suggestion_expiry_hours = suggestion_expiry_hours
        self._enable_persistence = enable_persistence
        self._storage_dir: Optional[Path] = None

        if enable_persistence:
            self._storage_dir = _get_storage_dir()
            self._load()

    @property
    def detector(self) -> PatternDetector:
        """获取模式检测器

        Returns:
            PatternDetector: 检测器实例
        """
        return self._detector

    def record_operation(
        self,
        operation: Dict[str, Any],
    ) -> List[ProactiveSuggestion]:
        """记录操作 + 生成建议

        Args:
            operation: 操作字典

        Returns:
            List[ProactiveSuggestion]: 新生成的建议列表
        """
        with self._lock:
            pattern = self._detector.add_operation(operation)
            suggestions: List[ProactiveSuggestion] = []

            if pattern is not None:
                # 检查是否已存在类似 pattern
                existing = self._find_similar_pattern(pattern)
                if existing is None:
                    self._patterns[pattern.pattern_id] = pattern
                    self._save_patterns()

                    # 生成建议
                    suggestion = self._create_suggestion_from_pattern(pattern)
                    self._suggestions[suggestion.suggestion_id] = suggestion
                    self._save_suggestions()
                    suggestions.append(suggestion)

            return suggestions

    def add_pattern(self, pattern: ProactivePattern) -> ProactivePattern:
        """手动添加模式

        Args:
            pattern: 模式实体

        Returns:
            ProactivePattern: 添加的模式
        """
        with self._lock:
            self._patterns[pattern.pattern_id] = pattern
            self._save_patterns()
            return pattern

    def list_patterns(
        self,
        min_confidence: Optional[float] = None,
    ) -> List[ProactivePattern]:
        """列出模式

        Args:
            min_confidence: 最低置信度过滤

        Returns:
            List[ProactivePattern]: 模式列表
        """
        with self._lock:
            results = list(self._patterns.values())
            if min_confidence is not None:
                results = [p for p in results if p.confidence >= min_confidence]
            results.sort(key=lambda p: p.confidence, reverse=True)
            return results

    def get_pattern(self, pattern_id: str) -> Optional[ProactivePattern]:
        """获取模式详情

        Args:
            pattern_id: 模式 ID

        Returns:
            Optional[ProactivePattern]: 模式实体
        """
        with self._lock:
            return self._patterns.get(pattern_id)

    def remove_pattern(self, pattern_id: str) -> bool:
        """删除模式

        Args:
            pattern_id: 模式 ID

        Returns:
            bool: True 表示删除成功
        """
        with self._lock:
            removed = self._patterns.pop(pattern_id, None) is not None
            if removed:
                self._save_patterns()
            return removed

    def create_suggestion(
        self,
        title: str,
        description: str,
        source: str = SuggestionSource.MEMORY.value,
        confidence: float = 0.8,
        action_url: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> ProactiveSuggestion:
        """手动创建建议

        Args:
            title: 标题
            description: 描述
            source: 来源
            confidence: 置信度
            action_url: 操作 URL
            metadata: 元数据

        Returns:
            ProactiveSuggestion: 创建的建议
        """
        with self._lock:
            now = datetime.now(timezone.utc)
            expires = now + timedelta(hours=self._suggestion_expiry_hours)

            suggestion = ProactiveSuggestion(
                title=title,
                description=description,
                confidence=confidence,
                source=source,
                action_url=action_url,
                created_at=_now_iso(),
                expires_at=expires.isoformat(),
                metadata=metadata or {},
                status="pending",
            )

            self._suggestions[suggestion.suggestion_id] = suggestion
            self._save_suggestions()
            return suggestion

    def list_suggestions(
        self,
        status: Optional[str] = None,
        source: Optional[str] = None,
        min_confidence: float = 0.0,
    ) -> List[ProactiveSuggestion]:
        """列出建议

        Args:
            status: 状态过滤
            source: 来源过滤
            min_confidence: 最低置信度

        Returns:
            List[ProactiveSuggestion]: 建议列表
        """
        with self._lock:
            results: List[ProactiveSuggestion] = []
            for sug in self._suggestions.values():
                # 过滤过期
                if sug.expires_at:
                    try:
                        expires_dt = datetime.fromisoformat(sug.expires_at)
                        if expires_dt < datetime.now(timezone.utc):
                            continue
                    except (ValueError, TypeError):
                        pass

                if status and sug.status != status:
                    continue
                if source and sug.source != source:
                    continue
                if sug.confidence < min_confidence:
                    continue

                results.append(sug)

            results.sort(key=lambda s: s.confidence, reverse=True)
            return results

    def get_suggestion(self, suggestion_id: str) -> Optional[ProactiveSuggestion]:
        """获取建议详情

        Args:
            suggestion_id: 建议 ID

        Returns:
            Optional[ProactiveSuggestion]: 建议实体
        """
        with self._lock:
            return self._suggestions.get(suggestion_id)

    def accept_suggestion(self, suggestion_id: str) -> Optional[ProactiveSuggestion]:
        """接受建议

        Args:
            suggestion_id: 建议 ID

        Returns:
            Optional[ProactiveSuggestion]: 更新后的建议
        """
        with self._lock:
            sug = self._suggestions.get(suggestion_id)
            if sug is None:
                return None
            sug.status = "accepted"
            self._save_suggestions()
            return sug

    def reject_suggestion(self, suggestion_id: str) -> Optional[ProactiveSuggestion]:
        """拒绝建议

        Args:
            suggestion_id: 建议 ID

        Returns:
            Optional[ProactiveSuggestion]: 更新后的建议
        """
        with self._lock:
            sug = self._suggestions.get(suggestion_id)
            if sug is None:
                return None
            sug.status = "rejected"
            self._save_suggestions()
            return sug

    def get_stats(self) -> Dict[str, Any]:
        """获取统计

        Returns:
            Dict[str, Any]: 统计数据
        """
        with self._lock:
            total_patterns = len(self._patterns)
            high_conf = sum(1 for p in self._patterns.values() if p.confidence >= 0.8)

            total_suggestions = len(self._suggestions)
            pending = sum(1 for s in self._suggestions.values() if s.status == "pending")
            accepted = sum(1 for s in self._suggestions.values() if s.status == "accepted")
            rejected = sum(1 for s in self._suggestions.values() if s.status == "rejected")

            return {
                "total_patterns": total_patterns,
                "high_confidence_patterns": high_conf,
                "total_suggestions": total_suggestions,
                "pending_suggestions": pending,
                "accepted_suggestions": accepted,
                "rejected_suggestions": rejected,
                "total_operations": self._detector.total_operations,
                "last_update": _now_iso(),
            }

    def _find_similar_pattern(
        self,
        pattern: ProactivePattern,
        threshold: float = 0.9,
    ) -> Optional[ProactivePattern]:
        """查找相似模式

        Args:
            pattern: 待匹配模式
            threshold: 相似度阈值

        Returns:
            Optional[ProactivePattern]: 相似模式
        """
        for existing in self._patterns.values():
            # 简单相似度：触发条件 Jaccard
            set1 = set(existing.trigger_conditions)
            set2 = set(pattern.trigger_conditions)
            if not set1 or not set2:
                continue
            intersection = set1 & set2
            union = set1 | set2
            similarity = len(intersection) / len(union) if union else 0
            if similarity >= threshold:
                return existing
        return None

    def _create_suggestion_from_pattern(
        self,
        pattern: ProactivePattern,
    ) -> ProactiveSuggestion:
        """从模式创建建议

        Args:
            pattern: 模式实体

        Returns:
            ProactiveSuggestion: 建议实体
        """
        now = datetime.now(timezone.utc)
        expires = now + timedelta(hours=self._suggestion_expiry_hours)

        return ProactiveSuggestion(
            title=f"Pattern detected: {pattern.description[:50]}",
            description=(
                f"Detected pattern with {pattern.occurrences} occurrences "
                f"(confidence: {pattern.confidence:.2f}). "
                f"Suggested action: {pattern.suggested_action}"
            ),
            confidence=pattern.confidence,
            source=SuggestionSource.PATTERN.value,
            action_url=None,
            created_at=_now_iso(),
            expires_at=expires.isoformat(),
            metadata={
                "pattern_id": pattern.pattern_id,
                "trigger_conditions": pattern.trigger_conditions,
                "occurrences": pattern.occurrences,
            },
            status="pending",
        )

    # 持久化
    def _get_storage_path(self, name: str) -> Optional[Path]:
        """获取存储路径

        Args:
            name: 文件名

        Returns:
            Optional[Path]: 文件路径
        """
        if self._storage_dir is None:
            return None
        return self._storage_dir / f"{name}.jsonl"

    def _save_patterns(self) -> None:
        """保存模式到磁盘

        Returns:
            None
        """
        path = self._get_storage_path("patterns")
        if path is None:
            return
        try:
            with open(path, "w", encoding="utf-8") as f:
                for p in self._patterns.values():
                    f.write(json.dumps(p.to_dict(), ensure_ascii=False) + "\n")
        except OSError:
            pass

    def _save_suggestions(self) -> None:
        """保存建议到磁盘

        Returns:
            None
        """
        path = self._get_storage_path("suggestions")
        if path is None:
            return
        try:
            with open(path, "w", encoding="utf-8") as f:
                for s in self._suggestions.values():
                    f.write(json.dumps(s.to_dict(), ensure_ascii=False) + "\n")
        except OSError:
            pass

    def _load(self) -> None:
        """从磁盘加载

        Returns:
            None
        """
        if self._storage_dir is None:
            return

        patterns_path = self._get_storage_path("patterns")
        if patterns_path and patterns_path.exists():
            try:
                with open(patterns_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                            p = ProactivePattern.from_dict(data)
                            self._patterns[p.pattern_id] = p
                        except (json.JSONDecodeError, KeyError):
                            continue
            except OSError:
                pass

        suggestions_path = self._get_storage_path("suggestions")
        if suggestions_path and suggestions_path.exists():
            try:
                with open(suggestions_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                            s = ProactiveSuggestion.from_dict(data)
                            self._suggestions[s.suggestion_id] = s
                        except (json.JSONDecodeError, KeyError):
                            continue
            except OSError:
                pass
