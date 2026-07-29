"""
# Auto-Compaction 冷热分层管理
# ============================================================
# 核心作用：管理会话的 Hot / Cold 分层存储
# 关联：Cycle 14 P1-2
# 版本：v6.30.0
#
# 设计：
#   - Hot tier：最近 N 条消息（活跃上下文）
#   - Cold tier：归档摘要块（带关键词索引）
#   - 增量压缩：仅处理新增消息，复用已有冷块
#   - 持久化：JSON 文件存储（线程安全）
#
# 复杂度：检索 O(K * W)，K=块数，W=关键词数
# ============================================================
"""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Any, Dict, List, Optional

from .detector import TokenCounter
from .models import CompactionBlock, CompactionTier


# ============================================================
# 冷热分层管理器
# ============================================================

class TierManager:
    """
    冷热分层管理器

    用法：
        manager = TierManager()
        tier = manager.get_or_create(session_id)
        manager.add_block(session_id, block)
        results = manager.search(session_id, keyword)
    """

    def __init__(self, storage_dir: Optional[str] = None) -> None:
        # 内存索引
        self._tiers: Dict[str, CompactionTier] = {}
        self._lock = threading.RLock()
        # 持久化目录
        if storage_dir is None:
            storage_dir = os.environ.get(
                "HERMES_AUTO_COMPACTION_DIR",
                "/tmp/hermes_auto_compaction",
            )
        os.makedirs(storage_dir, exist_ok=True)
        self._storage_dir = storage_dir

    # ============================================================
    # 会话管理
    # ============================================================

    def get_or_create(self, session_id: str) -> CompactionTier:
        """获取或创建会话分层"""
        with self._lock:
            if session_id not in self._tiers:
                tier = CompactionTier(session_id=session_id)
                # 尝试从磁盘加载
                loaded = self._load_tier(session_id)
                if loaded:
                    tier = loaded
                self._tiers[session_id] = tier
            return self._tiers[session_id]

    def get(self, session_id: str) -> Optional[CompactionTier]:
        """获取会话分层（不创建）"""
        with self._lock:
            return self._tiers.get(session_id)

    def remove(self, session_id: str) -> bool:
        """删除会话分层"""
        with self._lock:
            removed = self._tiers.pop(session_id, None) is not None
            if removed:
                path = self._tier_path(session_id)
                if os.path.exists(path):
                    try:
                        os.remove(path)
                    except Exception:
                        pass
            return removed

    def list_sessions(self) -> List[str]:
        """列出所有会话"""
        with self._lock:
            return list(self._tiers.keys())

    # ============================================================
    # Hot Tier 操作
    # ============================================================

    def set_hot(
        self,
        session_id: str,
        messages: List[Dict[str, Any]],
        keep_recent: int = 10,
    ) -> CompactionTier:
        """设置 hot tier（保留最近 N 条）"""
        tier = self.get_or_create(session_id)
        with self._lock:
            # 保留最近 N 条
            tier.hot = list(messages[-keep_recent:]) if messages else []
            tier.total_hot_tokens = TokenCounter.count_messages(tier.hot)
        return tier

    def append_hot(
        self,
        session_id: str,
        message: Dict[str, Any],
        keep_recent: int = 10,
    ) -> CompactionTier:
        """追加单条到 hot tier"""
        tier = self.get_or_create(session_id)
        with self._lock:
            tier.hot.append(message)
            if len(tier.hot) > keep_recent:
                tier.hot = tier.hot[-keep_recent:]
            tier.total_hot_tokens = TokenCounter.count_messages(tier.hot)
        return tier

    # ============================================================
    # Cold Tier 操作
    # ============================================================

    def add_block(self, session_id: str, block: CompactionBlock) -> CompactionTier:
        """添加压缩块到 cold tier"""
        tier = self.get_or_create(session_id)
        with self._lock:
            tier.cold.append(block)
            # 更新关键词索引
            for kw in block.keywords:
                if kw not in tier.cold_index:
                    tier.cold_index[kw] = []
                if block.block_id not in tier.cold_index[kw]:
                    tier.cold_index[kw].append(block.block_id)
            # 重新计算 cold token
            tier.total_cold_tokens = sum(b.tokens for b in tier.cold)
            tier.last_compaction_at = time.strftime(
                "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
            )
            # 持久化
            self._save_tier(tier)
        return tier

    def add_blocks(
        self,
        session_id: str,
        blocks: List[CompactionBlock],
    ) -> CompactionTier:
        """批量添加压缩块"""
        tier = self.get_or_create(session_id)
        with self._lock:
            tier.cold.extend(blocks)
            for block in blocks:
                for kw in block.keywords:
                    if kw not in tier.cold_index:
                        tier.cold_index[kw] = []
                    if block.block_id not in tier.cold_index[kw]:
                        tier.cold_index[kw].append(block.block_id)
            tier.total_cold_tokens = sum(b.tokens for b in tier.cold)
            tier.last_compaction_at = time.strftime(
                "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
            )
            self._save_tier(tier)
        return tier

    def search(
        self,
        session_id: str,
        query: str,
        top_k: int = 5,
    ) -> List[CompactionBlock]:
        """在 cold tier 中按关键词搜索"""
        tier = self.get(session_id)
        if not tier:
            return []
        # 简单匹配
        q_lower = query.lower().strip()
        if not q_lower:
            return []
        # 按关键词索引找到候选块
        candidate_ids: set = set()
        for kw, block_ids in tier.cold_index.items():
            if q_lower in kw or kw in q_lower:
                candidate_ids.update(block_ids)
        # 取完整块
        candidates = [b for b in tier.cold if b.block_id in candidate_ids]
        # 关键词在摘要中直接出现的优先
        scored = []
        for block in candidates:
            score = 0
            if q_lower in block.summary.lower():
                score += 10
            for kw in block.keywords:
                if q_lower in kw or kw in q_lower:
                    score += 2
            scored.append((score, block))
        scored.sort(key=lambda x: -x[0])
        return [b for _, b in scored[:top_k]]

    # ============================================================
    # Checkpoint（用于增量压缩）
    # ============================================================

    def set_checkpoint(
        self,
        session_id: str,
        last_message_index: int,
    ) -> CompactionTier:
        """设置增量压缩起点"""
        tier = self.get_or_create(session_id)
        with self._lock:
            tier.checkpoint = {
                "last_message_index": last_message_index,
                "set_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            self._save_tier(tier)
        return tier

    def get_checkpoint(self, session_id: str) -> Optional[Dict[str, Any]]:
        """获取增量压缩起点"""
        tier = self.get(session_id)
        return tier.checkpoint if tier else None

    def clear_checkpoint(self, session_id: str) -> None:
        """清除 checkpoint"""
        tier = self.get(session_id)
        if tier:
            with self._lock:
                tier.checkpoint = None
                self._save_tier(tier)

    # ============================================================
    # 回滚
    # ============================================================

    def snapshot(self, session_id: str) -> Optional[Dict[str, Any]]:
        """创建会话快照（用于回滚）"""
        tier = self.get(session_id)
        if not tier:
            return None
        return {
            "session_id": session_id,
            "hot": list(tier.hot),
            "cold": [b.to_dict() for b in tier.cold],
            "cold_index": dict(tier.cold_index),
            "total_hot_tokens": tier.total_hot_tokens,
            "total_cold_tokens": tier.total_cold_tokens,
            "checkpoint": tier.checkpoint,
            "snapshot_at": time.strftime(
                "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
            ),
        }

    def restore(self, session_id: str, snapshot: Dict[str, Any]) -> bool:
        """从快照恢复"""
        with self._lock:
            try:
                cold_blocks = [
                    CompactionBlock.from_dict(b) for b in snapshot.get("cold", [])
                ]
                tier = CompactionTier(
                    session_id=session_id,
                    hot=list(snapshot.get("hot", [])),
                    cold=cold_blocks,
                    cold_index=dict(snapshot.get("cold_index", {})),
                    total_hot_tokens=int(snapshot.get("total_hot_tokens", 0)),
                    total_cold_tokens=int(snapshot.get("total_cold_tokens", 0)),
                    checkpoint=snapshot.get("checkpoint"),
                )
                self._tiers[session_id] = tier
                self._save_tier(tier)
                return True
            except Exception:
                return False

    # ============================================================
    # 持久化
    # ============================================================

    def _tier_path(self, session_id: str) -> str:
        """获取会话分层文件路径"""
        # 安全：仅允许安全字符
        safe = "".join(c for c in session_id if c.isalnum() or c in "-_")
        if not safe:
            safe = "default"
        return os.path.join(self._storage_dir, f"{safe}.json")

    def _save_tier(self, tier: CompactionTier) -> None:
        """保存到磁盘"""
        try:
            path = self._tier_path(tier.session_id)
            data = {
                "session_id": tier.session_id,
                "hot": tier.hot,
                "cold": [b.to_dict() for b in tier.cold],
                "cold_index": tier.cold_index,
                "total_hot_tokens": tier.total_hot_tokens,
                "total_cold_tokens": tier.total_cold_tokens,
                "last_compaction_at": tier.last_compaction_at,
                "checkpoint": tier.checkpoint,
            }
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, path)
        except Exception:
            pass

    def _load_tier(self, session_id: str) -> Optional[CompactionTier]:
        """从磁盘加载"""
        path = self._tier_path(session_id)
        if not os.path.exists(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            cold_blocks = [CompactionBlock.from_dict(b) for b in data.get("cold", [])]
            return CompactionTier(
                session_id=session_id,
                hot=list(data.get("hot", [])),
                cold=cold_blocks,
                cold_index=dict(data.get("cold_index", {})),
                total_hot_tokens=int(data.get("total_hot_tokens", 0)),
                total_cold_tokens=int(data.get("total_cold_tokens", 0)),
                last_compaction_at=data.get("last_compaction_at"),
                checkpoint=data.get("checkpoint"),
            )
        except Exception:
            return None

    def save_all(self) -> None:
        """保存所有分层"""
        with self._lock:
            for tier in self._tiers.values():
                self._save_tier(tier)

    def get_stats(self) -> Dict[str, Any]:
        """获取全局统计"""
        with self._lock:
            total_sessions = len(self._tiers)
            total_cold_blocks = sum(len(t.cold) for t in self._tiers.values())
            total_hot_messages = sum(len(t.hot) for t in self._tiers.values())
            total_hot_tokens = sum(t.total_hot_tokens for t in self._tiers.values())
            total_cold_tokens = sum(t.total_cold_tokens for t in self._tiers.values())
            return {
                "total_sessions": total_sessions,
                "total_cold_blocks": total_cold_blocks,
                "total_hot_messages": total_hot_messages,
                "total_hot_tokens": total_hot_tokens,
                "total_cold_tokens": total_cold_tokens,
                "total_tokens": total_hot_tokens + total_cold_tokens,
                "sessions": list(self._tiers.keys())[:50],
            }


# 全局分层管理器（单例）
GLOBAL_TIER_MANAGER = TierManager()
