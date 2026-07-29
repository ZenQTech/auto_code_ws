"""
# TRAE Work - 统一管理器
# ============================================================
# 核心作用：管理 4 大子系统（Design/Voice/Memory/Video）的统一入口
# 关联：Cycle 14 P1-3
# 版本：v6.31.0
#
# 职责：
#   - 持有 4 大子服务的引用
#   - 提供统一的状态查询与统计
#   - 注入 Voice ↔ Memory 依赖
#   - 持久化索引到 JSONL
# ============================================================
"""

from __future__ import annotations

import json
import os
import threading
from typing import Any, Dict, List, Optional

from .design import GLOBAL_DESIGN_MODE
from .memory import GLOBAL_MEMORY
from .models import WorkStats, _now_iso, path_within
from .video import GLOBAL_VIDEO
from .voice import GLOBAL_VOICE_CHAT


class WorkManager:
    """TRAE Work 统一管理器

    功能：
        - 4 大子服务协调
        - 统一统计
        - JSONL 索引持久化
    """

    def __init__(self, base_dir: str = "/tmp/hermes_trae_work") -> None:
        self._base_dir = base_dir
        os.makedirs(base_dir, exist_ok=True)
        self._index_file = os.path.join(base_dir, "work_index.jsonl")

        # 子服务（使用全局单例）
        self._design = GLOBAL_DESIGN_MODE
        self._voice = GLOBAL_VOICE_CHAT
        self._memory = GLOBAL_MEMORY
        self._video = GLOBAL_VIDEO

        # 注入依赖：Voice → Memory
        self._voice.set_memory_provider(self._memory)

        self._lock = threading.RLock()
        # 启动时间
        self._started_at = _now_iso()

    # ============================================================
    # 子服务访问
    # ============================================================

    @property
    def design(self):
        return self._design

    @property
    def voice(self):
        return self._voice

    @property
    def memory(self):
        return self._memory

    @property
    def video(self):
        return self._video

    # ============================================================
    # 健康与统计
    # ============================================================

    def health(self) -> Dict[str, Any]:
        """健康检查"""
        return {
            "status": "ok",
            "version": "v6.31.0",
            "started_at": self._started_at,
            "modules": {
                "design": "ok",
                "voice": "ok",
                "memory": "ok",
                "video": "ok",
            },
        }

    def get_stats(self) -> Dict[str, Any]:
        """获取全局统计"""
        return {
            "design": self._design.get_stats(),
            "voice": self._voice.get_stats(),
            "memory": self._memory.get_stats(),
            "video": self._video.get_stats(),
        }

    # ============================================================
    # 索引持久化
    # ============================================================

    def save_index(self, event_type: str, data: Dict[str, Any]) -> None:
        """保存一条索引记录

        Args:
            event_type: 事件类型
            data: 事件数据
        """
        try:
            with self._lock:
                record = {
                    "event": event_type,
                    "timestamp": _now_iso(),
                    "data": data,
                }
                with open(self._index_file, "a", encoding="utf-8") as f:
                    f.write(json.dumps(record, ensure_ascii=False) + "\n")
        except Exception:
            pass

    def read_index(self, limit: int = 100) -> List[Dict[str, Any]]:
        """读取索引"""
        results: List[Dict[str, Any]] = []
        if not os.path.exists(self._index_file):
            return results
        try:
            with open(self._index_file, "r", encoding="utf-8") as f:
                lines = f.readlines()
            for line in lines[-limit:]:
                line = line.strip()
                if not line:
                    continue
                try:
                    results.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        except Exception:
            pass
        return results

    def clear_index(self) -> int:
        """清空索引"""
        if not os.path.exists(self._index_file):
            return 0
        try:
            count = 0
            with open(self._index_file, "r", encoding="utf-8") as f:
                count = len(f.readlines())
            os.remove(self._index_file)
            return count
        except Exception:
            return 0


# 全局单例
_MANAGER: Optional[WorkManager] = None
_MANAGER_LOCK = threading.Lock()


def get_work_manager() -> WorkManager:
    """获取全局 WorkManager 单例"""
    global _MANAGER
    with _MANAGER_LOCK:
        if _MANAGER is None:
            _MANAGER = WorkManager()
        return _MANAGER
