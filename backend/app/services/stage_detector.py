"""
# ============================================================
# StageDetector 服务 (v1.0.0)
# Cycle 63 G63-03
# ============================================================
# 核心作用：检测 AI 工作阶段（idle/prd/coding/preview/deploy/done）
# 运行流程：
#   1. 接收 AI 输出文本或任务状态变化
#   2. 规则引擎匹配（关键词 < 50ms）
#   3. 置信度低时触发 LLM 分类器（mock 默认）
#   4. 状态机更新（防阶段跳跃）
#   5. WebSocket 推送事件
#   6. 阶段历史持久化
# 设计要点：
#   - 规则匹配优先（< 50ms）
#   - 状态机防止 idle → deploy 跳跃
#   - auto_follow 开关控制联动
#   - 手动 override 立即生效
# 输入参数：session_id, 文本, 手动 stage
# 输出结果：StageState, StageEvent
# 对标：Trae SOLO Auto-Follow
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 63 G63-03 初次创建
# ====================================
"""

import asyncio
import json
import logging
import re
import time
import uuid
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Tuple

from .stage_models import (
    STAGE_TRIGGERS,
    StageEvent,
    StageState,
    is_valid_stage,
)

logger = logging.getLogger(__name__)


# ============================================================
# 异常类型
# ============================================================


class StageError(Exception):
    pass


class InvalidStageError(StageError):
    pass


# ============================================================
# 状态机：定义合法阶段转换
# ============================================================


# 阶段流转图（避免跳跃）
LEGAL_TRANSITIONS: Dict[str, List[str]] = {
    "idle": ["prd", "coding"],
    "prd": ["coding", "idle"],
    "coding": ["preview", "prd", "idle"],
    "preview": ["deploy", "coding", "idle"],
    "deploy": ["done", "preview", "idle"],
    "done": ["idle"],
}


# ============================================================
# LLM 分类器接口（依赖注入）
# ============================================================


async def default_llm_classifier(text: str) -> Tuple[str, float]:
    """
    默认 LLM 分类器（mock 实现）
    返回 (stage, confidence)
    """
    # 基于规则的 mock（确定性强）
    return _mock_llm_classify(text)


def _mock_llm_classify(text: str) -> Tuple[str, float]:
    """基于规则模拟 LLM 分类"""
    text_lower = text.lower()
    scores: Dict[str, float] = defaultdict(float)
    for stage, keywords in STAGE_TRIGGERS.items():
        for kw in keywords:
            if kw.lower() in text_lower:
                scores[stage] += 1.0
    if not scores:
        return "coding", 0.5  # 默认
    best_stage = max(scores, key=lambda s: scores[s])
    total = sum(scores.values())
    confidence = min(0.99, 0.5 + scores[best_stage] / max(total, 1.0))
    return best_stage, confidence


# ============================================================
# StageDetector 主类
# ============================================================


class StageDetector:
    """
    阶段检测器
    - 规则引擎：基于关键词快速匹配
    - LLM 分类器：低置信度时二次校验
    - 状态机：管理 session 阶段流转
    - 事件总线：WebSocket 推送
    """

    def __init__(
        self,
        llm_classifier=None,
        storage_dir: Optional[str] = None,
        max_history: int = 100,
    ):
        self._llm_classifier = llm_classifier or default_llm_classifier
        self._storage_dir = Path(storage_dir) if storage_dir else None
        if self._storage_dir:
            self._storage_dir.mkdir(parents=True, exist_ok=True)
        self._max_history = max_history

        # session_id -> StageState
        self._states: Dict[str, StageState] = {}
        # session_id -> 阶段历史（Deque）
        self._histories: Dict[str, Deque[StageEvent]] = defaultdict(
            lambda: deque(maxlen=self._max_history)
        )
        # 订阅者：session_id -> list of callbacks
        self._subscribers: Dict[str, List] = defaultdict(list)
        # 全部订阅者（接收所有事件）
        self._global_subscribers: List = []

        # 加载持久化数据
        if self._storage_dir:
            self._load_from_disk()

    # ============================================================
    # 状态管理
    # ============================================================

    def get_state(self, session_id: str) -> StageState:
        """获取当前状态"""
        if session_id not in self._states:
            self._states[session_id] = StageState(
                session_id=session_id,
                stage="idle",
                confidence=1.0,
                auto_follow=True,
                entered_at=time.time(),
                source="rule",
                reason="initial state",
            )
        return self._states[session_id]

    def force_stage(self, session_id: str, stage: str, reason: str = "manual override") -> StageState:
        """手动设置阶段"""
        if not is_valid_stage(stage):
            raise InvalidStageError(f"无效的阶段: {stage}")
        old = self.get_state(session_id)
        from_stage = old.stage
        old.stage = stage
        old.confidence = 1.0
        old.source = "manual"
        old.reason = reason
        old.entered_at = time.time()
        # 记录事件
        self._record_event(
            session_id=session_id,
            event_type="stage_change",
            from_stage=from_stage,
            to_stage=stage,
            confidence=1.0,
            reason=reason,
        )
        self._persist()
        logger.info(f"阶段强制设置: session={session_id}, {from_stage} → {stage}")
        return old

    def set_auto_follow(self, session_id: str, enabled: bool) -> StageState:
        """设置 auto_follow"""
        state = self.get_state(session_id)
        state.auto_follow = enabled
        self._record_event(
            session_id=session_id,
            event_type="follow_action",
            to_stage=state.stage,
            reason=f"auto_follow={'enabled' if enabled else 'disabled'}",
        )
        return state

    def get_history(self, session_id: str, limit: int = 50) -> List[StageEvent]:
        """获取阶段历史"""
        history = list(self._histories.get(session_id, []))
        return history[-limit:]

    # ============================================================
    # 阶段检测
    # ============================================================

    async def detect_from_text(
        self,
        session_id: str,
        text: str,
        use_llm: bool = False,
    ) -> StageState:
        """
        从 AI 输出文本检测阶段
        - 规则匹配（始终执行，< 50ms）
        - 可选 LLM 二次校验（use_llm=True 时）
        """
        # 1. 规则匹配
        rule_stage, rule_score = self._match_rules(text)
        # 2. LLM 分类（可选）
        llm_stage, llm_conf = (None, 0.0)
        if use_llm or rule_score < 0.3:
            try:
                llm_stage, llm_conf = await self._llm_classifier(text)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"LLM 分类失败: {e}")
                llm_stage, llm_conf = None, 0.0

        # 3. 综合决策
        final_stage, confidence, source = self._combine_results(
            rule_stage, rule_score, llm_stage, llm_conf
        )

        # 4. 应用到状态机
        return self._apply_transition(
            session_id=session_id,
            new_stage=final_stage,
            confidence=confidence,
            source=source,
            reason=f"text-based detection (rule={rule_stage}, llm={llm_stage})",
        )

    def _match_rules(self, text: str) -> Tuple[str, float]:
        """规则匹配（返回最佳 stage 和归一化分数 0-1）"""
        if not text:
            return "idle", 0.0
        text_lower = text.lower()
        scores: Dict[str, int] = defaultdict(int)
        for stage, keywords in STAGE_TRIGGERS.items():
            for kw in keywords:
                if kw.lower() in text_lower:
                    scores[stage] += 1
        if not scores:
            return "idle", 0.0
        best_stage = max(scores, key=lambda s: scores[s])
        total_keywords = sum(len(kws) for kws in STAGE_TRIGGERS.values())
        # 归一化到 0-1
        confidence = min(1.0, scores[best_stage] / 3.0)
        return best_stage, confidence

    def _combine_results(
        self,
        rule_stage: str,
        rule_score: float,
        llm_stage: Optional[str],
        llm_conf: float,
    ) -> Tuple[str, float, str]:
        """综合规则和 LLM 结果"""
        if llm_stage and llm_conf > 0.7:
            return llm_stage, llm_conf, "llm"
        if rule_score >= 0.3:
            return rule_stage, rule_score, "rule"
        if llm_stage:
            return llm_stage, llm_conf, "llm"
        return rule_stage, max(rule_score, 0.0), "rule"

    def _apply_transition(
        self,
        session_id: str,
        new_stage: str,
        confidence: float,
        source: str,
        reason: str,
    ) -> StageState:
        """应用阶段转换（含状态机校验）"""
        if not is_valid_stage(new_stage):
            return self.get_state(session_id)

        old = self.get_state(session_id)
        from_stage = old.stage
        if from_stage == new_stage:
            # 无变化，仅更新置信度
            old.confidence = max(old.confidence, confidence)
            old.reason = reason
            return old

        # 检查状态机合法转换
        legal = LEGAL_TRANSITIONS.get(from_stage, [])
        if new_stage not in legal and from_stage != "idle":
            # 非法跳跃，保留当前状态
            logger.debug(
                f"非法阶段跳跃: {from_stage} → {new_stage}，忽略"
            )
            return old

        old.stage = new_stage
        old.confidence = confidence
        old.source = source
        old.reason = reason
        old.entered_at = time.time()
        # 记录事件
        self._record_event(
            session_id=session_id,
            event_type="stage_change",
            from_stage=from_stage,
            to_stage=new_stage,
            confidence=confidence,
            reason=reason,
        )
        self._persist()
        logger.info(
            f"阶段变化: session={session_id}, {from_stage} → {new_stage}, "
            f"confidence={confidence:.2f}, source={source}"
        )
        return old

    # ============================================================
    # 事件总线
    # ============================================================

    def subscribe(self, session_id: Optional[str] = None):
        """
        订阅阶段变化事件（返回 unsubscribe 函数）
        - session_id=None: 订阅所有 session
        """
        queue: asyncio.Queue = asyncio.Queue()
        if session_id is None:
            self._global_subscribers.append(queue)
        else:
            self._subscribers[session_id].append(queue)

        def unsubscribe():
            try:
                if session_id is None:
                    self._global_subscribers.remove(queue)
                else:
                    self._subscribers[session_id].remove(queue)
            except ValueError:
                pass

        return queue, unsubscribe

    def _record_event(
        self,
        session_id: str,
        event_type: str,
        from_stage: Optional[str] = None,
        to_stage: Optional[str] = None,
        confidence: Optional[float] = None,
        reason: Optional[str] = None,
    ) -> StageEvent:
        """记录阶段事件并推送"""
        event = StageEvent(
            event_id=f"evt-{uuid.uuid4().hex[:12]}",
            session_id=session_id,
            type=event_type,
            from_stage=from_stage,
            to_stage=to_stage,
            confidence=confidence,
            reason=reason,
            timestamp=time.time(),
        )
        # 推送到订阅者
        for q in self._subscribers.get(session_id, []):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning(f"订阅者队列已满: session={session_id}")
        for q in self._global_subscribers:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("全局订阅者队列已满")
        # 记录历史
        self._histories[session_id].append(event)
        return event

    # ============================================================
    # 统计
    # ============================================================

    def get_stats(self) -> Dict[str, Any]:
        """统计信息"""
        stage_distribution: Dict[str, int] = defaultdict(int)
        for state in self._states.values():
            stage_distribution[state.stage] += 1
        return {
            "total_sessions": len(self._states),
            "stage_distribution": dict(stage_distribution),
            "total_history_events": sum(len(h) for h in self._histories.values()),
            "max_history_per_session": self._max_history,
        }

    # ============================================================
    # 持久化
    # ============================================================

    def _persist(self) -> None:
        if not self._storage_dir:
            return
        data = {
            "states": {sid: s.model_dump() for sid, s in self._states.items()},
            "histories": {
                sid: [e.model_dump() for e in list(hist)]
                for sid, hist in self._histories.items()
            },
        }
        file_path = self._storage_dir / "stage_detector.json"
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"持久化 stage detector 失败: {e}")

    def _load_from_disk(self) -> None:
        if not self._storage_dir or not self._storage_dir.exists():
            return
        file_path = self._storage_dir / "stage_detector.json"
        if not file_path.exists():
            return
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"加载 stage detector 失败: {e}")
            return
        for sid, sdata in data.get("states", {}).items():
            try:
                self._states[sid] = StageState(**sdata)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"加载状态 {sid} 失败: {e}")
        for sid, events in data.get("histories", {}).items():
            dq = deque(maxlen=self._max_history)
            for edata in events:
                try:
                    dq.append(StageEvent(**edata))
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"加载事件失败: {e}")
            self._histories[sid] = dq


# ============================================================
# 全局单例
# ============================================================


_detector: Optional[StageDetector] = None


def get_stage_detector(storage_dir: Optional[str] = None) -> StageDetector:
    """获取 StageDetector 单例"""
    global _detector
    if _detector is None:
        _detector = StageDetector(storage_dir=storage_dir)
    return _detector


def reset_stage_detector() -> None:
    """重置 StageDetector（用于测试）"""
    global _detector
    _detector = None
