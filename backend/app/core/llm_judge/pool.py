"""
# ============================================================
# Hermes LLM-as-Judge - Judge 模型池
# ============================================================
# 核心作用：管理 Judge 模型池（注册/查询/选择/启停）
# 特性：
#   - 线程安全
#   - 按 domain / difficulty 选择最合适的 Judge
#   - 权重管理
#   - 统计与监控
# Cycle 13 P0-3 新建
# ============================================================
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from .adapters import create_adapter, JudgeAdapter
from .models import (
    Difficulty,
    Domain,
    Judge,
    JudgeAdapterType,
    _now_iso,
)

logger = logging.getLogger(__name__)


# ============================================================
# 路径白名单
# ============================================================
import re

ALLOWED_POOL_PATHS = [
    re.compile(r"^/home/qizheng/auto_code_data"),
    re.compile(r"^/home/qizheng/auto_code_ws"),
    re.compile(r"^/home/qizheng/.hermes"),
    re.compile(r"^/tmp/judge_test_"),
    re.compile(r"^/tmp/llm_judge_"),
    re.compile(r"^/tmp/pytest-of-"),
    re.compile(r"^/tmp/tmp"),
]


def is_pool_path_allowed(path: str) -> bool:
    if not path:
        return True
    p = Path(path).resolve()
    path_str = str(p)
    for pattern in ALLOWED_POOL_PATHS:
        if pattern.match(path_str):
            return True
    return False


# ============================================================
# 默认 Judge 配置
# ============================================================
DEFAULT_JUDGES: List[Dict[str, Any]] = [
    {
        "name": "Claude Sonnet 4.5",
        "model": "claude-sonnet-4.5",
        "weight": 1.0,
        "adapter": "mock",
        "specialties": ["general", "backend", "frontend", "code"],
    },
    {
        "name": "GPT-5 Codex",
        "model": "gpt-5-codex",
        "weight": 0.8,
        "adapter": "mock",
        "specialties": ["code", "testing"],
    },
    {
        "name": "Gemini 2.5 Pro",
        "model": "gemini-2.5-pro",
        "weight": 0.6,
        "adapter": "mock",
        "specialties": ["general", "style", "docs"],
    },
]


# ============================================================
# Judge Pool
# ============================================================
class JudgePool:
    """
    Judge 模型池
    - 注册/注销 Judge
    - 按 domain/difficulty 选择
    - 维护 adapter 缓存
    """

    def __init__(self, store_dir: Optional[str] = None):
        self._lock = threading.RLock()
        self._judges: Dict[str, Judge] = {}
        self._adapters: Dict[str, JudgeAdapter] = {}
        self._custom_fns: Dict[str, Any] = {}
        # 持久化
        if store_dir is None:
            store_dir = str(Path.home() / ".hermes" / "judge")
        self.store_dir = Path(store_dir)
        if is_pool_path_allowed(self.store_dir) or self.store_dir == Path.home() / ".hermes" / "judge":
            try:
                self.store_dir.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                logger.warning(f"Failed to create store dir: {e}")
        # 加载已存在的 Judge
        self._load()
        # 注册默认 Judge（如果没有）
        if not self._judges:
            for cfg in DEFAULT_JUDGES:
                self.register(Judge(**cfg))

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------
    def register(
        self,
        judge: Judge,
        custom_fn=None,
    ) -> Judge:
        with self._lock:
            self._judges[judge.judge_id] = judge
            self._adapters[judge.judge_id] = create_adapter(judge, custom_fn=custom_fn)
            if custom_fn is not None:
                self._custom_fns[judge.judge_id] = custom_fn
            self._save_judge(judge)
            logger.info(f"Registered judge: {judge.name} ({judge.judge_id})")
            return judge

    def unregister(self, judge_id: str) -> bool:
        with self._lock:
            if judge_id not in self._judges:
                return False
            del self._judges[judge_id]
            self._adapters.pop(judge_id, None)
            self._custom_fns.pop(judge_id, None)
            self._delete_judge(judge_id)
            logger.info(f"Unregistered judge: {judge_id}")
            return True

    def get(self, judge_id: str) -> Optional[Judge]:
        with self._lock:
            return self._judges.get(judge_id)

    def get_adapter(self, judge_id: str) -> Optional[JudgeAdapter]:
        with self._lock:
            return self._adapters.get(judge_id)

    def list(
        self,
        enabled_only: bool = False,
        specialty: Optional[str] = None,
    ) -> List[Judge]:
        with self._lock:
            judges = list(self._judges.values())
        if enabled_only:
            judges = [j for j in judges if j.enabled]
        if specialty:
            judges = [j for j in judges if specialty in (j.specialties or [])]
        return judges

    def enable(self, judge_id: str) -> bool:
        with self._lock:
            judge = self._judges.get(judge_id)
            if not judge:
                return False
            judge.enabled = True
            self._save_judge(judge)
            return True

    def disable(self, judge_id: str) -> bool:
        with self._lock:
            judge = self._judges.get(judge_id)
            if not judge:
                return False
            judge.enabled = False
            self._save_judge(judge)
            return True

    # ------------------------------------------------------------------
    # 选择
    # ------------------------------------------------------------------
    def select(
        self,
        domain: str = Domain.GENERAL.value,
        difficulty: str = Difficulty.MEDIUM.value,
        count: int = 1,
        use_consensus: bool = False,
    ) -> List[Judge]:
        """
        选择 Judge
        规则：
        - 优先选择 enabled=True
        - 优先选择 specialties 包含 domain 的
        - 按 weight 降序
        - count: 选择的数量
        - use_consensus=True 时选 2-3 个，否则选 1 个
        """
        with self._lock:
            candidates = [j for j in self._judges.values() if j.enabled]
        if not candidates:
            return []
        # 按 domain 匹配度 + weight 排序
        def sort_key(j: Judge):
            specialty_match = 1 if domain in (j.specialties or []) else 0
            return (specialty_match, j.weight)
        candidates.sort(key=sort_key, reverse=True)
        if use_consensus:
            # 共识：选 2-3 个
            target = max(2, min(count, 3, len(candidates)))
        else:
            # 单 Judge：选 1 个
            target = min(count, len(candidates))
        return candidates[:target]

    # ------------------------------------------------------------------
    # 统计
    # ------------------------------------------------------------------
    def record_run(self, judge_id: str, success: bool, latency_ms: int) -> None:
        with self._lock:
            judge = self._judges.get(judge_id)
            if not judge:
                return
            judge.total_runs += 1
            if not success:
                judge.total_failures += 1
            # 移动平均延迟
            if judge.avg_latency_ms == 0:
                judge.avg_latency_ms = float(latency_ms)
            else:
                judge.avg_latency_ms = (judge.avg_latency_ms * 0.8) + (latency_ms * 0.2)
            self._save_judge(judge)

    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            judges = list(self._judges.values())
        enabled_count = sum(1 for j in judges if j.enabled)
        total_runs = sum(j.total_runs for j in judges)
        total_failures = sum(j.total_failures for j in judges)
        avg_latency = 0.0
        if judges:
            avg_latency = sum(j.avg_latency_ms for j in judges) / len(judges)
        adapter_types = {}
        for j in judges:
            t = j.adapter
            adapter_types[t] = adapter_types.get(t, 0) + 1
        return {
            "total_judges": len(judges),
            "enabled_judges": enabled_count,
            "total_runs": total_runs,
            "total_failures": total_failures,
            "success_rate": (1.0 - total_failures / total_runs) if total_runs > 0 else 1.0,
            "avg_latency_ms": round(avg_latency, 2),
            "adapter_types": adapter_types,
        }

    # ------------------------------------------------------------------
    # 持久化
    # ------------------------------------------------------------------
    def _judge_file(self, judge_id: str) -> Path:
        return self.store_dir / f"judge_{judge_id}.json"

    def _save_judge(self, judge: Judge) -> None:
        try:
            f = self._judge_file(judge.judge_id)
            tmp = f.with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as fp:
                json.dump(judge.to_dict(), fp, ensure_ascii=False, indent=2)
            tmp.replace(f)
        except Exception as e:
            logger.warning(f"Save judge failed: {e}")

    def _delete_judge(self, judge_id: str) -> None:
        try:
            f = self._judge_file(judge_id)
            if f.exists():
                f.unlink()
        except Exception as e:
            logger.warning(f"Delete judge failed: {e}")

    def _load(self) -> None:
        if not self.store_dir.exists():
            return
        try:
            for f in self.store_dir.glob("judge_*.json"):
                with open(f, "r", encoding="utf-8") as fp:
                    data = json.load(fp)
                judge = Judge.from_dict(data)
                self._judges[judge.judge_id] = judge
                self._adapters[judge.judge_id] = create_adapter(judge)
        except Exception as e:
            logger.warning(f"Load judges failed: {e}")


# ============================================================
# 全局单例
# ============================================================
_pool_instance: Optional[JudgePool] = None
_pool_lock = threading.Lock()


def get_judge_pool() -> JudgePool:
    global _pool_instance
    if _pool_instance is None:
        with _pool_lock:
            if _pool_instance is None:
                _pool_instance = JudgePool()
    return _pool_instance


def reset_judge_pool() -> None:
    """重置全局单例（用于测试）"""
    global _pool_instance
    _pool_instance = None
