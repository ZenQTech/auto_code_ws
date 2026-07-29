"""
# ============================================================
# Hermes LLM-as-Judge - 引擎（编排任务执行）
# ============================================================
# 核心作用：编排 Judge 任务执行流程（选择 Judge → 执行 → 共识 → 持久化）
# 特性：
#   - 任务生命周期管理
#   - 串行/并行执行
#   - 自动共识 + Safety 一票否决
#   - 错误隔离
# Cycle 13 P0-3 新建
# ============================================================
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

from .adapters import JudgeAdapter
from .consensus import ConsensusEngine
from .models import (
    ConsensusStrategy,
    Difficulty,
    Domain,
    Judge,
    JudgeConsensus,
    JudgeReport,
    JudgeTask,
    JudgeTaskStatus,
)
from .pool import JudgePool, get_judge_pool
from .prompts import build_prompt
from .store import JudgeStore, get_judge_store

logger = logging.getLogger(__name__)


# ============================================================
# Judge Engine
# ============================================================
class JudgeEngine:
    """
    Judge 引擎
    编排任务执行：选择 Judge → 执行 → 共识 → 持久化
    """

    def __init__(
        self,
        pool: Optional[JudgePool] = None,
        store: Optional[JudgeStore] = None,
        consensus_engine: Optional[ConsensusEngine] = None,
    ):
        self.pool = pool or get_judge_pool()
        self.store = store or get_judge_store()
        self.consensus_engine = consensus_engine or ConsensusEngine()

    def submit(self, task: JudgeTask) -> JudgeTask:
        """提交任务（创建并保存）"""
        task = self.store.save(task)
        logger.info(f"Task submitted: {task.task_id}")
        return task

    def execute(
        self,
        task_id: str,
        timeout: Optional[float] = None,
        consensus_strategy: str = ConsensusStrategy.WEIGHTED_AVERAGE.value,
    ) -> JudgeTask:
        """
        执行 Judge 任务
        """
        task = self.store.get_or_raise(task_id)
        if task.is_terminal():
            logger.info(f"Task already terminal: {task_id} ({task.status})")
            return task

        # 标记为 RUNNING
        self.store.update_status(task_id, JudgeTaskStatus.RUNNING.value)

        try:
            # 1. 选择 Judge
            judges = self.pool.select(
                domain=task.domain,
                difficulty=task.difficulty,
                count=3,
                use_consensus=task.use_consensus,
            )
            if not judges:
                raise ValueError("No enabled judges in pool")

            # 2. 构建 prompt
            prompt = build_prompt(
                task_description=task.task_description,
                code_diff=task.code_diff,
                test_results=task.test_results,
                rubric=task.rubric,
                domain=task.domain,
                difficulty=task.difficulty,
            )

            # 3. 执行所有 Judge（错误隔离）
            reports: List[JudgeReport] = []
            for judge in judges:
                report = self._execute_judge(judge, task_id, prompt, timeout)
                if report:
                    self.store.add_report(task_id, report)
                    reports.append(report)
                    self.pool.record_run(
                        judge.judge_id,
                        success=not bool(report.error),
                        latency_ms=report.latency_ms,
                    )

            if not reports:
                raise RuntimeError("All judges failed to produce reports")

            # 4. 共识
            consensus = self.consensus_engine.aggregate(
                reports=reports,
                judges=judges,
                task_id=task_id,
                strategy=consensus_strategy,
            )
            self.store.set_consensus(task_id, consensus)

            # 5. 标记完成（VETOED 优先于 COMPLETED/FAILED）
            if consensus.safety_veto:
                final_status = JudgeTaskStatus.VETOED.value
            elif consensus.overall_pass:
                final_status = JudgeTaskStatus.COMPLETED.value
            else:
                # 不通过但有报告，依然标记完成（用户决定是否接受）
                final_status = JudgeTaskStatus.COMPLETED.value
            self.store.update_status(task_id, final_status)
            logger.info(f"Task completed: {task_id} -> {final_status}")
            return self.store.get_or_raise(task_id)

        except Exception as e:
            logger.error(f"Task execution failed: {task_id} - {e}")
            self.store.update_status(task_id, JudgeTaskStatus.FAILED.value, error=str(e))
            return self.store.get_or_raise(task_id)

    def _execute_judge(
        self,
        judge: Judge,
        task_id: str,
        prompt: str,
        timeout: Optional[float],
    ) -> Optional[JudgeReport]:
        """执行单个 Judge（带错误隔离）"""
        try:
            adapter = self.pool.get_adapter(judge.judge_id)
            if not adapter:
                logger.warning(f"Adapter not found: {judge.judge_id}")
                return None
            return adapter.judge(task_id, prompt, timeout=timeout)
        except Exception as e:
            logger.error(f"Judge {judge.judge_id} failed: {e}")
            return None

    def execute_sync(
        self,
        task: JudgeTask,
        timeout: Optional[float] = None,
        consensus_strategy: Optional[str] = None,
    ) -> JudgeTask:
        """同步执行：submit + execute"""
        task = self.submit(task)
        kwargs = {}
        if consensus_strategy is not None:
            kwargs["consensus_strategy"] = consensus_strategy
        if timeout is not None:
            kwargs["timeout"] = timeout
        return self.execute(task.task_id, **kwargs)

    def get_stats(self) -> Dict[str, Any]:
        return self.store.get_stats()


# ============================================================
# 全局单例
# ============================================================
_engine_instance: Optional[JudgeEngine] = None
_engine_lock = __import__("threading").RLock()


def get_judge_engine() -> JudgeEngine:
    global _engine_instance
    if _engine_instance is None:
        with _engine_lock:
            if _engine_instance is None:
                _engine_instance = JudgeEngine()
    return _engine_instance


def reset_judge_engine() -> None:
    global _engine_instance
    _engine_instance = None
