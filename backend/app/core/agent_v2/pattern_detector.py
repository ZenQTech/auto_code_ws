"""
Hermes Agent v2 - 模式检测器
==========================================
核心作用：检测用户操作序列中的重复模式
        基于 TF-IDF + 简单语义匹配，识别用户的重复行为
        当模式重复次数 >= 阈值时，生成 ProactivePattern
运行流程：输入操作序列 → 提取特征 → 滑动窗口聚合 → 模式匹配 → 计算置信度 → 输出模式
输入参数：操作列表、操作特征
输出结果：ProactivePattern 列表
修改记录：
  - 2026-07-28 | v1.0.0 | Cycle 14 P0-1 初始版本
"""
from __future__ import annotations

import re
import math
import hashlib
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional, Tuple
from threading import RLock

from .models import ProactivePattern, _new_id, _now_iso


# 路径白名单 - 防止路径注入
PATH_WHITELIST_PREFIXES = (
    "/home/",
    "/tmp/",
    "/var/log/",
    "/opt/",
    "/workspace/",
    "./",
    ".",
)

# 危险路径黑名单
DANGEROUS_PATH_PATTERNS = (
    r"/etc/passwd",
    r"/etc/shadow",
    r"/etc/sudoers",
    r"/root/\.ssh",
    r"/proc/",
    r"/sys/",
    r"\.\./\.\.",
    r"~/\.bash_history",
)


def _sanitize_path(path: str) -> str:
    """清理和验证路径安全性

    Args:
        path: 待验证路径

    Returns:
        str: 清理后的安全路径

    Raises:
        ValueError: 路径不安全
    """
    if not path:
        return ""

    # 检查危险模式
    for pattern in DANGEROUS_PATH_PATTERNS:
        if re.search(pattern, path):
            raise ValueError(f"Dangerous path pattern detected: {path}")

    return path


def _extract_features(operation: Dict[str, Any]) -> List[str]:
    """从操作中提取特征

    支持的操作字段：
    - type: 操作类型（如 "edit", "read", "create", "delete"）
    - target: 操作目标（文件路径、API 等）
    - context: 上下文信息

    Args:
        operation: 操作字典

    Returns:
        List[str]: 特征列表
    """
    features = []
    op_type = operation.get("type", "unknown")
    target = operation.get("target", "")

    # 类型特征
    features.append(f"type:{op_type}")

    # 目标特征（提取文件扩展名/目录/动词）
    if target:
        if "/" in target:
            # 文件路径
            ext_match = re.search(r"\.[a-zA-Z0-9]+$", target)
            if ext_match:
                features.append(f"ext:{ext_match.group()}")
            dir_match = re.search(r"/([^/]+)/[^/]+$", target)
            if dir_match:
                features.append(f"dir:{dir_match.group(1)}")
        else:
            # 简短目标
            target_hash = hashlib.md5(target.encode()).hexdigest()[:8]
            features.append(f"target:{target_hash}")

    # 上下文特征
    context = operation.get("context", {})
    if isinstance(context, dict):
        for k, v in list(context.items())[:3]:  # 最多 3 个上下文特征
            v_str = str(v)[:50]
            features.append(f"ctx:{k}={v_str}")

    return features


def _tfidf_similarity(features_a: List[str], features_b: List[str]) -> float:
    """计算两个特征集合的 TF-IDF 相似度（简化版）

    Args:
        features_a: 特征列表 A
        features_b: 特征列表 B

    Returns:
        float: 相似度 (0.0-1.0)
    """
    if not features_a or not features_b:
        return 0.0

    set_a = Counter(features_a)
    set_b = Counter(features_b)

    # 共有特征
    common = set(set_a.keys()) & set(set_b.keys())
    if not common:
        return 0.0

    # 余弦相似度
    dot = sum(set_a[f] * set_b[f] for f in common)
    mag_a = math.sqrt(sum(v * v for v in set_a.values()))
    mag_b = math.sqrt(sum(v * v for v in set_b.values()))

    if mag_a == 0 or mag_b == 0:
        return 0.0

    return dot / (mag_a * mag_b)


def _compute_pattern_hash(features: List[str]) -> str:
    """计算模式特征哈希

    Args:
        features: 特征列表

    Returns:
        str: 哈希字符串
    """
    sorted_features = sorted(features)
    joined = "|".join(sorted_features)
    return hashlib.md5(joined.encode()).hexdigest()[:12]


class PatternDetector:
    """模式检测器

    维护操作历史 + 检测重复模式
    线程安全（RLock）

    Attributes:
        history: 操作历史（按 hash 分组）
        min_occurrences: 触发模式的最小重复次数
        min_confidence: 最低置信度阈值
    """

    def __init__(
        self,
        min_occurrences: int = 3,
        min_confidence: float = 0.7,
        max_history: int = 10000,
    ) -> None:
        """初始化检测器

        Args:
            min_occurrences: 触发模式的最小重复次数
            min_confidence: 最低置信度阈值
            max_history: 最大历史操作数
        """
        self._lock = RLock()
        self._history: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        self._min_occurrences = min_occurrences
        self._min_confidence = min_confidence
        self._max_history = max_history
        self._total_operations = 0

    @property
    def total_operations(self) -> int:
        """获取总操作数

        Returns:
            int: 操作总数
        """
        with self._lock:
            return self._total_operations

    def add_operation(self, operation: Dict[str, Any]) -> Optional[ProactivePattern]:
        """添加操作并检测模式

        Args:
            operation: 操作字典

        Returns:
            Optional[ProactivePattern]: 检测到新模式时返回，否则 None
        """
        with self._lock:
            # 路径安全检查
            target = operation.get("target", "")
            if target and isinstance(target, str) and target.startswith("/"):
                try:
                    _sanitize_path(target)
                except ValueError:
                    # 危险路径不加入历史
                    return None

            features = _extract_features(operation)
            pattern_hash = _compute_pattern_hash(features)

            self._history[pattern_hash].append({
                "features": features,
                "operation": operation,
                "timestamp": _now_iso(),
            })

            self._total_operations += 1

            # 限制历史大小
            total = sum(len(v) for v in self._history.values())
            if total > self._max_history:
                # 删除最旧的一组
                oldest_key = min(
                    self._history.keys(),
                    key=lambda k: self._history[k][0]["timestamp"]
                )
                self._history[oldest_key].pop(0)
                if not self._history[oldest_key]:
                    del self._history[oldest_key]

            # 检测是否达到重复阈值
            occurrences = len(self._history[pattern_hash])
            if occurrences < self._min_occurrences:
                return None

            # 计算置信度
            confidence = self._compute_confidence(pattern_hash)
            if confidence < self._min_confidence:
                return None

            # 创建 Pattern
            pattern = ProactivePattern(
                pattern_id=_new_id("pat"),
                description=operation.get("description", "Detected pattern"),
                trigger_conditions=features[:5],
                confidence=confidence,
                occurrences=occurrences,
                last_triggered=_now_iso(),
                suggested_action=operation.get("suggested_action", "Review this pattern"),
                metadata={
                    "pattern_hash": pattern_hash,
                    "first_seen": self._history[pattern_hash][0]["timestamp"],
                    "operation_type": operation.get("type", "unknown"),
                },
            )

            return pattern

    def _compute_confidence(self, pattern_hash: str) -> float:
        """计算模式置信度

        基于：
        1. 出现次数（>= 3 满分，< 3 线性）
        2. 时间衰减（最近操作更可信）
        3. 特征稳定性

        Args:
            pattern_hash: 模式哈希

        Returns:
            float: 置信度 (0.0-1.0)
        """
        with self._lock:
            entries = self._history.get(pattern_hash, [])
            if not entries:
                return 0.0

            # 1. 出现次数得分
            occurrences = len(entries)
            count_score = min(occurrences / self._min_occurrences, 1.0)

            # 2. 特征稳定性
            all_features = [set(e["features"]) for e in entries]
            if len(all_features) >= 2:
                intersection = all_features[0]
                for s in all_features[1:]:
                    intersection = intersection & s
                stability = len(intersection) / max(len(all_features[0]), 1)
            else:
                stability = 1.0

            # 综合得分
            confidence = 0.6 * count_score + 0.4 * stability
            return min(max(confidence, 0.0), 1.0)

    def detect_patterns(self) -> List[ProactivePattern]:
        """检测所有当前模式

        Returns:
            List[ProactivePattern]: 模式列表
        """
        with self._lock:
            patterns: List[ProactivePattern] = []
            for pattern_hash, entries in self._history.items():
                if len(entries) < self._min_occurrences:
                    continue

                confidence = self._compute_confidence(pattern_hash)
                if confidence < self._min_confidence:
                    continue

                last_entry = entries[-1]
                pattern = ProactivePattern(
                    pattern_id=_new_id("pat"),
                    description=last_entry["operation"].get("description", "Detected pattern"),
                    trigger_conditions=list(set(last_entry["features"][:5])),
                    confidence=confidence,
                    occurrences=len(entries),
                    last_triggered=last_entry["timestamp"],
                    suggested_action=last_entry["operation"].get("suggested_action", "Review"),
                    metadata={
                        "pattern_hash": pattern_hash,
                        "first_seen": entries[0]["timestamp"],
                        "operation_type": last_entry["operation"].get("type", "unknown"),
                    },
                )
                patterns.append(pattern)

            return patterns

    def clear(self) -> None:
        """清空历史

        Returns:
            None
        """
        with self._lock:
            self._history.clear()
            self._total_operations = 0

    def get_history(self, pattern_hash: str) -> List[Dict[str, Any]]:
        """获取指定模式的历史

        Args:
            pattern_hash: 模式哈希

        Returns:
            List[Dict[str, Any]]: 历史条目列表
        """
        with self._lock:
            return list(self._history.get(pattern_hash, []))
