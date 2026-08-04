"""
# ============================================================
# Conversation Folding 服务单元测试 (v1.0.0)
# Cycle 61 G61-08
# ============================================================
# 测试覆盖：
#   - 数据模型 (FoldConfig / FoldedMessage / ConversationMessage / FoldResult)
#   - SummaryGenerator (Simple / LLM)
#   - ConversationFoldingManager
#     - add_message / get_messages / get_active_messages
#     - get_total_tokens / should_fold
#     - fold (LLM_SUMMARY / TRUNCATE / KEEP_HEAD / KEEP_TAIL / KEEP_BOTH)
#     - auto_fold_if_needed
#     - list_folds / get_fold / get_folded_messages / restore_fold
#     - list_sessions / get_session_stats
#     - 持久化
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 61 G61-08 初次创建
# ====================================
"""

import sys
import os
import asyncio
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import pytest

from app.services.conversation_folding import (
    ConversationFoldingManager,
    ConversationMessage,
    FoldConfig,
    FoldResult,
    FoldStrategy,
    FoldTrigger,
    FoldedMessage,
    LLMSummaryGenerator,
    SimpleSummaryGenerator,
    SummaryGenerator,
    get_manager,
    reset_manager,
)


# ============================================================
# 数据模型测试
# ============================================================


class TestFoldConfig:
    """FoldConfig 测试"""

    def test_default_values(self):
        cfg = FoldConfig()
        assert cfg.keep_recent == 10
        assert cfg.max_messages == 50
        assert cfg.max_tokens == 8000
        assert cfg.strategy == FoldStrategy.LLM_SUMMARY
        assert cfg.summary_max_tokens == 500
        assert cfg.auto_fold is True

    def test_to_dict(self):
        cfg = FoldConfig(keep_recent=5)
        d = cfg.to_dict()
        assert d["keep_recent"] == 5
        assert d["strategy"] == "llm_summary"


class TestFoldedMessage:
    """FoldedMessage 测试"""

    def test_default_values(self):
        f = FoldedMessage()
        assert f.fold_id.startswith("fold-")
        assert f.range_start == 0
        assert f.range_end == 0
        assert f.original_count == 0
        assert f.summary == ""
        assert f.strategy == FoldStrategy.LLM_SUMMARY

    def test_to_dict(self):
        f = FoldedMessage(summary="test", original_count=3)
        d = f.to_dict()
        assert d["summary"] == "test"
        assert d["original_count"] == 3


class TestConversationMessage:
    """ConversationMessage 测试"""

    def test_default_values(self):
        m = ConversationMessage()
        assert m.msg_id.startswith("msg-")
        assert m.role == "user"
        assert m.content == ""
        assert m.folded is False
        assert m.fold_id is None

    def test_to_dict(self):
        m = ConversationMessage(role="assistant", content="hi")
        d = m.to_dict()
        assert d["role"] == "assistant"
        assert d["content"] == "hi"


class TestFoldResult:
    """FoldResult 测试"""

    def test_default_values(self):
        r = FoldResult(success=True)
        assert r.success is True
        assert r.folded_count == 0
        assert r.error is None

    def test_to_dict(self):
        r = FoldResult(success=True, folded_count=5, summary="s")
        d = r.to_dict()
        assert d["folded_count"] == 5
        assert d["summary"] == "s"


# ============================================================
# 摘要生成器测试
# ============================================================


class TestSimpleSummaryGenerator:
    """SimpleSummaryGenerator 测试"""

    @pytest.mark.asyncio
    async def test_summarize_user_messages(self):
        gen = SimpleSummaryGenerator()
        msgs = [
            ConversationMessage(role="user", content="hello"),
            ConversationMessage(role="user", content="world"),
        ]
        summary = await gen.summarize(msgs)
        assert "用户提出 2 个" in summary

    @pytest.mark.asyncio
    async def test_summarize_assistant_messages(self):
        gen = SimpleSummaryGenerator()
        msgs = [
            ConversationMessage(role="user", content="Q1"),
            ConversationMessage(role="assistant", content="A1"),
            ConversationMessage(role="assistant", content="A2"),
        ]
        summary = await gen.summarize(msgs)
        assert "助手回复 2 次" in summary

    @pytest.mark.asyncio
    async def test_summarize_empty(self):
        gen = SimpleSummaryGenerator()
        summary = await gen.summarize([])
        assert summary == ""


class TestLLMSummaryGenerator:
    """LLMSummaryGenerator 测试"""

    @pytest.mark.asyncio
    async def test_fallback_when_no_llm(self):
        gen = LLMSummaryGenerator()
        msgs = [ConversationMessage(role="user", content="hello")]
        summary = await gen.summarize(msgs)
        # 无 LLM，回退到 Simple
        assert "用户提出" in summary

    @pytest.mark.asyncio
    async def test_uses_llm_when_set(self):
        async def mock_llm(prompt, system, max_tokens, timeout):
            return f"LLM_SUMMARY: {prompt[:30]}"

        gen = LLMSummaryGenerator()
        gen.set_llm_call(mock_llm)
        msgs = [ConversationMessage(role="user", content="hello world")]
        summary = await gen.summarize(msgs)
        assert summary.startswith("LLM_SUMMARY:")

    @pytest.mark.asyncio
    async def test_fallback_on_llm_error(self):
        async def failing_llm(prompt, system, max_tokens, timeout):
            raise RuntimeError("LLM failed")

        gen = LLMSummaryGenerator()
        gen.set_llm_call(failing_llm)
        msgs = [ConversationMessage(role="user", content="hello")]
        summary = await gen.summarize(msgs)
        # 降级
        assert "用户提出" in summary


# ============================================================
# ConversationFoldingManager 测试
# ============================================================


class TestConversationFoldingManager:
    """ConversationFoldingManager 基础测试"""

    def test_add_message(self):
        mgr = ConversationFoldingManager()
        msg = mgr.add_message("s1", "user", "hello")
        assert msg.role == "user"
        assert msg.content == "hello"
        assert mgr.get_messages("s1")[0].msg_id == msg.msg_id

    def test_get_active_messages(self):
        mgr = ConversationFoldingManager()
        mgr.add_message("s1", "user", "hello")
        active = mgr.get_active_messages("s1")
        assert len(active) == 1

    def test_get_total_tokens(self):
        mgr = ConversationFoldingManager()
        mgr.add_message("s1", "user", "x" * 400, tokens=100)
        mgr.add_message("s1", "assistant", "y" * 200, tokens=50)
        assert mgr.get_total_tokens("s1") == 150

    def test_should_fold_by_count(self):
        mgr = ConversationFoldingManager()
        mgr.set_config("s1", FoldConfig(keep_recent=2, max_messages=5))
        for i in range(4):
            mgr.add_message("s1", "user", f"msg {i}")
        # 4 < 5，无需折叠
        assert not mgr.should_fold("s1")
        mgr.add_message("s1", "user", "msg 5")
        # 5 >= 5，需要折叠
        assert mgr.should_fold("s1")

    def test_should_fold_by_tokens(self):
        mgr = ConversationFoldingManager()
        mgr.set_config("s1", FoldConfig(keep_recent=2, max_messages=100, max_tokens=100))
        for i in range(3):
            mgr.add_message("s1", "user", "x", tokens=50)
        # 150 >= 100，需要折叠
        assert mgr.should_fold("s1")

    def test_should_not_fold_when_disabled(self):
        mgr = ConversationFoldingManager()
        mgr.set_config("s1", FoldConfig(keep_recent=1, max_messages=1, auto_fold=False))
        mgr.add_message("s1", "user", "x")
        mgr.add_message("s1", "user", "y")
        assert not mgr.should_fold("s1")


class TestFoldOperation:
    """fold 操作测试"""

    @pytest.mark.asyncio
    async def test_fold_too_few_messages(self):
        mgr = ConversationFoldingManager()
        mgr.set_config("s1", FoldConfig(keep_recent=10))
        for i in range(5):
            mgr.add_message("s1", "user", f"m{i}")
        result = await mgr.fold("s1")
        assert result.success is False
        assert "无需折叠" in (result.error or "")

    @pytest.mark.asyncio
    async def test_fold_with_llm_summary(self):
        async def mock_llm(prompt, system, max_tokens, timeout):
            return "AI summary of conversation"

        gen = LLMSummaryGenerator()
        gen.set_llm_call(mock_llm)
        mgr = ConversationFoldingManager(summary_generator=gen)
        mgr.set_config("s1", FoldConfig(keep_recent=2, strategy=FoldStrategy.LLM_SUMMARY))
        for i in range(5):
            mgr.add_message("s1", "user" if i % 2 == 0 else "assistant", f"m{i}")

        result = await mgr.fold("s1")
        assert result.success is True
        assert result.folded_count == 3  # 5 - 2 = 3
        assert result.summary == "AI summary of conversation"
        # 验证消息被标记为 folded
        active = mgr.get_active_messages("s1")
        assert len(active) == 2

    @pytest.mark.asyncio
    async def test_fold_with_truncate(self):
        mgr = ConversationFoldingManager()
        mgr.set_config("s1", FoldConfig(keep_recent=2, strategy=FoldStrategy.TRUNCATE))
        for i in range(5):
            mgr.add_message("s1", "user", f"m{i}")

        result = await mgr.fold("s1")
        assert result.success is True
        assert "简单截断" in result.summary

    @pytest.mark.asyncio
    async def test_fold_with_keep_head(self):
        mgr = ConversationFoldingManager()
        mgr.set_config("s1", FoldConfig(keep_recent=2, strategy=FoldStrategy.KEEP_HEAD))
        for i in range(5):
            mgr.add_message("s1", "user", f"m{i}")

        result = await mgr.fold("s1")
        assert result.success is True
        assert "m0" in result.summary

    @pytest.mark.asyncio
    async def test_fold_with_keep_tail(self):
        mgr = ConversationFoldingManager()
        mgr.set_config("s1", FoldConfig(keep_recent=2, strategy=FoldStrategy.KEEP_TAIL))
        for i in range(5):
            mgr.add_message("s1", "user", f"m{i}")

        result = await mgr.fold("s1")
        assert result.success is True
        # 最后一条是 m4
        assert "m4" in result.summary

    @pytest.mark.asyncio
    async def test_fold_with_keep_both(self):
        mgr = ConversationFoldingManager()
        mgr.set_config("s1", FoldConfig(keep_recent=2, strategy=FoldStrategy.KEEP_BOTH))
        for i in range(5):
            mgr.add_message("s1", "user", f"m{i}")

        result = await mgr.fold("s1")
        assert result.success is True
        assert "头部" in result.summary
        assert "尾部" in result.summary

    @pytest.mark.asyncio
    async def test_fold_keeps_recent(self):
        mgr = ConversationFoldingManager()
        mgr.set_config("s1", FoldConfig(keep_recent=3, strategy=FoldStrategy.TRUNCATE))
        for i in range(10):
            mgr.add_message("s1", "user", f"m{i}")

        result = await mgr.fold("s1")
        assert result.success is True
        # 保留最近 3 条
        active = mgr.get_active_messages("s1")
        assert len(active) == 3
        assert active[0].content == "m7"
        assert active[2].content == "m9"


class TestAutoFold:
    """auto_fold_if_needed 测试"""

    @pytest.mark.asyncio
    async def test_auto_fold_when_needed(self):
        mgr = ConversationFoldingManager()
        mgr.set_config("s1", FoldConfig(keep_recent=2, max_messages=3, strategy=FoldStrategy.TRUNCATE))
        for i in range(5):
            mgr.add_message("s1", "user", f"m{i}")
        result = await mgr.auto_fold_if_needed("s1")
        assert result is not None
        assert result.success is True

    @pytest.mark.asyncio
    async def test_auto_fold_not_needed(self):
        mgr = ConversationFoldingManager()
        mgr.set_config("s1", FoldConfig(keep_recent=10, max_messages=50))
        for i in range(3):
            mgr.add_message("s1", "user", f"m{i}")
        result = await mgr.auto_fold_if_needed("s1")
        assert result is None


class TestFoldHistory:
    """折叠历史测试"""

    @pytest.mark.asyncio
    async def test_list_folds(self):
        mgr = ConversationFoldingManager()
        mgr.set_config("s1", FoldConfig(keep_recent=2, strategy=FoldStrategy.TRUNCATE))
        for i in range(5):
            mgr.add_message("s1", "user", f"m{i}")
        await mgr.fold("s1")
        folds = mgr.list_folds("s1")
        assert len(folds) == 1

    @pytest.mark.asyncio
    async def test_restore_fold(self):
        mgr = ConversationFoldingManager()
        mgr.set_config("s1", FoldConfig(keep_recent=2, strategy=FoldStrategy.TRUNCATE))
        for i in range(5):
            mgr.add_message("s1", "user", f"m{i}")
        result = await mgr.fold("s1")
        assert result.success
        fold_id = result.fold_id
        # 恢复
        count = mgr.restore_fold("s1", fold_id)
        assert count == 3
        # 验证消息恢复为未折叠
        active = mgr.get_active_messages("s1")
        assert len(active) == 5

    @pytest.mark.asyncio
    async def test_get_folded_messages(self):
        mgr = ConversationFoldingManager()
        mgr.set_config("s1", FoldConfig(keep_recent=2, strategy=FoldStrategy.TRUNCATE))
        for i in range(5):
            mgr.add_message("s1", "user", f"m{i}")
        result = await mgr.fold("s1")
        folded_msgs = mgr.get_folded_messages("s1", result.fold_id)
        assert len(folded_msgs) == 3

    def test_get_fold_not_found(self):
        mgr = ConversationFoldingManager()
        assert mgr.get_fold("s1", "nonexistent") is None


class TestSessionStats:
    """session 统计测试"""

    @pytest.mark.asyncio
    async def test_stats(self):
        mgr = ConversationFoldingManager()
        mgr.set_config("s1", FoldConfig(keep_recent=2, strategy=FoldStrategy.TRUNCATE))
        for i in range(5):
            mgr.add_message("s1", "user", f"m{i}", tokens=10)
        await mgr.fold("s1")
        stats = mgr.get_session_stats("s1")
        assert stats["total_messages"] == 5
        assert stats["active_messages"] == 2
        assert stats["folded_messages"] == 3
        assert stats["fold_count"] == 1


# ============================================================
# 持久化测试
# ============================================================


class TestPersistence:
    """持久化测试"""

    @pytest.mark.asyncio
    async def test_save_and_load(self, tmp_path):
        storage = str(tmp_path / "fold_storage")
        mgr = ConversationFoldingManager()
        mgr.set_storage_dir(storage)
        mgr.set_config("s1", FoldConfig(keep_recent=2, strategy=FoldStrategy.TRUNCATE))
        for i in range(5):
            mgr.add_message("s1", "user", f"m{i}", tokens=10)
        await mgr.fold("s1")
        # 创建新 manager 加载
        mgr2 = ConversationFoldingManager()
        mgr2.set_storage_dir(storage)
        msgs = mgr2.get_messages("s1")
        assert len(msgs) == 5
        folds = mgr2.list_folds("s1")
        assert len(folds) == 1


# ============================================================
# 全局单例
# ============================================================


class TestGlobalManager:
    """全局单例测试"""

    def test_singleton(self):
        reset_manager()
        m1 = get_manager()
        m2 = get_manager()
        assert m1 is m2
        reset_manager()
