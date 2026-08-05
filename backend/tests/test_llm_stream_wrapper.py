"""
# ============================================================
# LLM 流式响应包装器单元测试
# Cycle 68 G68-03
# ====================================
# 覆盖：chunk 解析、reasoning 推送、end_step 触发、错误处理
# ====================================
"""

import asyncio
import unittest

from app.services.llm_stream_wrapper import (
    LLMStreamWrapper,
    MockChunk,
    MockDelta,
    get_llm_stream_wrapper,
    reset_llm_stream_wrapper,
)
from app.services.thinking_stream import (
    get_thinking_stream_service,
    reset_thinking_stream_service,
)


async def _collect(agen):
    """收集异步迭代器到列表"""
    items = []
    async for item in agen:
        items.append(item)
    return items


class TestChunkExtraction(unittest.TestCase):
    """chunk 字段提取测试"""

    def setUp(self):
        self.wrapper = LLMStreamWrapper()

    def test_extract_mock_chunk(self):
        chunk = MockChunk(content="hello", reasoning_content="thinking...")
        content, reasoning = self.wrapper._extract_chunk_fields(chunk)
        self.assertEqual(content, "hello")
        self.assertEqual(reasoning, "thinking...")

    def test_extract_dict_chunk(self):
        chunk = {
            "choices": [
                {"delta": {"content": "hi", "reasoning_content": "let me think"}}
            ]
        }
        content, reasoning = self.wrapper._extract_chunk_fields(chunk)
        self.assertEqual(content, "hi")
        self.assertEqual(reasoning, "let me think")

    def test_extract_empty_chunk(self):
        chunk = MockChunk()
        content, reasoning = self.wrapper._extract_chunk_fields(chunk)
        self.assertEqual(content, "")
        self.assertEqual(reasoning, "")

    def test_extract_content_only(self):
        chunk = MockChunk(content="just content")
        content, reasoning = self.wrapper._extract_chunk_fields(chunk)
        self.assertEqual(content, "just content")
        self.assertEqual(reasoning, "")

    def test_extract_reasoning_only(self):
        chunk = MockChunk(reasoning_content="just thinking")
        content, reasoning = self.wrapper._extract_chunk_fields(chunk)
        self.assertEqual(content, "")
        self.assertEqual(reasoning, "just thinking")

    def test_extract_invalid_chunk(self):
        # 没有 choices
        content, reasoning = self.wrapper._extract_chunk_fields("invalid")
        self.assertEqual(content, "")
        self.assertEqual(reasoning, "")

    def test_extract_partial_dict(self):
        chunk = {"choices": [{"delta": {"content": "x"}}]}
        content, reasoning = self.wrapper._extract_chunk_fields(chunk)
        self.assertEqual(content, "x")
        self.assertEqual(reasoning, "")


class TestWrapStream(unittest.TestCase):
    """wrap_stream 端到端测试"""

    def setUp(self):
        reset_thinking_stream_service()
        reset_llm_stream_wrapper()
        self.wrapper = LLMStreamWrapper()
        self.thinking = get_thinking_stream_service()

    def test_wrap_stream_reasoning_and_content(self):
        """测试 reasoning + content 混合流"""

        async def mock_llm():
            yield MockChunk(reasoning_content="Let me think... ")
            yield MockChunk(content="The answer is ")
            yield MockChunk(reasoning_content="actually, let me reconsider")
            yield MockChunk(content="42.")

        async def runner():
            content_parts = []
            async for c in self.wrapper.wrap_stream(
                mock_llm(),
                session_id="s1",
                agent_id="a1",
                model="mock-llm",
            ):
                content_parts.append(c)
            return "".join(content_parts)

        loop = asyncio.new_event_loop()
        try:
            content = loop.run_until_complete(runner())
        finally:
            loop.close()

        # 验证 content 输出
        self.assertEqual(content, "The answer is 42.")

        # 验证 thinking step 已结束
        steps = self.thinking.get_session_steps("s1")
        self.assertEqual(len(steps), 1)
        step = steps[0]
        self.assertEqual(step.status, "completed")
        self.assertIn("Let me think", step.content)
        self.assertIn("actually, let me reconsider", step.content)
        # tokens = 2 (2 reasoning chunks)
        self.assertEqual(step.tokens, 2)

    def test_wrap_stream_no_reasoning(self):
        """测试只有 content 的流"""

        async def mock_llm():
            yield MockChunk(content="just content 1")
            yield MockChunk(content=" and 2")

        async def runner():
            content_parts = []
            async for c in self.wrapper.wrap_stream(
                mock_llm(),
                session_id="s2",
                agent_id="a1",
            ):
                content_parts.append(c)
            return "".join(content_parts)

        loop = asyncio.new_event_loop()
        try:
            content = loop.run_until_complete(runner())
        finally:
            loop.close()

        self.assertEqual(content, "just content 1 and 2")
        steps = self.thinking.get_session_steps("s2")
        self.assertEqual(len(steps), 1)
        step = steps[0]
        # 无 reasoning 也会创建 step（可能为空）
        self.assertEqual(step.status, "completed")
        self.assertEqual(step.tokens, 0)

    def test_wrap_stream_error_handling(self):
        """测试错误处理：end_step with error metadata"""

        async def mock_llm_with_error():
            yield MockChunk(reasoning_content="thinking...")
            yield MockChunk(content="partial answer")
            raise RuntimeError("LLM connection lost")

        async def runner():
            try:
                content_parts = []
                async for c in self.wrapper.wrap_stream(
                    mock_llm_with_error(),
                    session_id="s3",
                    agent_id="a1",
                ):
                    content_parts.append(c)
            except RuntimeError:
                pass

        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(runner())
        finally:
            loop.close()

        # 验证 step 已结束（带 error metadata）
        steps = self.thinking.get_session_steps("s3")
        self.assertEqual(len(steps), 1)
        step = steps[0]
        self.assertEqual(step.status, "completed")
        self.assertIn("error", step.metadata)
        self.assertIn("LLM connection lost", step.metadata["error"])

    def test_wrap_stream_dict_chunks(self):
        """测试 dict 形式 chunk"""

        async def mock_llm():
            yield {"choices": [{"delta": {"content": "dict1", "reasoning_content": "r1"}}]}
            yield {"choices": [{"delta": {"content": "dict2"}}]}

        async def runner():
            content_parts = []
            async for c in self.wrapper.wrap_stream(
                mock_llm(),
                session_id="s4",
                agent_id="a1",
            ):
                content_parts.append(c)
            return "".join(content_parts)

        loop = asyncio.new_event_loop()
        try:
            content = loop.run_until_complete(runner())
        finally:
            loop.close()

        self.assertEqual(content, "dict1dict2")
        steps = self.thinking.get_session_steps("s4")
        step = steps[0]
        self.assertIn("r1", step.content)
        self.assertEqual(step.tokens, 1)

    def test_wrap_stream_summary(self):
        """测试 summary 自动生成（前 200 字符）"""

        async def mock_llm():
            long_text = "A" * 300
            yield MockChunk(content=long_text)

        async def runner():
            async for c in self.wrapper.wrap_stream(
                mock_llm(),
                session_id="s5",
                agent_id="a1",
                summary_length=200,
            ):
                pass

        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(runner())
        finally:
            loop.close()

        steps = self.thinking.get_session_steps("s5")
        step = steps[0]
        self.assertEqual(len(step.summary), 200)
        self.assertEqual(step.summary, "A" * 200)

    def test_wrap_stream_metadata_passed(self):
        """测试 metadata 传递"""

        async def mock_llm():
            yield MockChunk(content="x")

        async def runner():
            async for c in self.wrapper.wrap_stream(
                mock_llm(),
                session_id="s6",
                agent_id="a1",
                metadata={"task": "test", "priority": "high"},
            ):
                pass

        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(runner())
        finally:
            loop.close()

        steps = self.thinking.get_session_steps("s6")
        step = steps[0]
        self.assertEqual(step.metadata.get("task"), "test")
        self.assertEqual(step.metadata.get("priority"), "high")

    def test_wrap_stream_step_metadata_enhanced(self):
        """测试 step 结束后 metadata 包含 chunk_count 等信息"""

        async def mock_llm():
            yield MockChunk(reasoning_content="r1")
            yield MockChunk(content="c1")
            yield MockChunk(reasoning_content="r2")
            yield MockChunk(content="c2")

        async def runner():
            async for c in self.wrapper.wrap_stream(
                mock_llm(),
                session_id="s7",
                agent_id="a1",
            ):
                pass

        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(runner())
        finally:
            loop.close()

        steps = self.thinking.get_session_steps("s7")
        step = steps[0]
        self.assertEqual(step.metadata.get("chunk_count"), 4)
        self.assertEqual(step.metadata.get("reasoning_chunks"), 2)
        self.assertEqual(step.metadata.get("content_chunks"), 2)


class TestWrapSimpleStream(unittest.TestCase):
    """wrap_simple_stream 简化接口测试"""

    def setUp(self):
        reset_thinking_stream_service()
        reset_llm_stream_wrapper()
        self.wrapper = LLMStreamWrapper()

    def test_simple_stream(self):
        async def runner():
            content_parts = []
            async for c in self.wrapper.wrap_simple_stream(
                reasoning_tokens=["Think1 ", "Think2 "],
                content_tokens=["Result1", "Result2"],
                session_id="simple1",
                agent_id="a1",
            ):
                content_parts.append(c)
            return "".join(content_parts)

        loop = asyncio.new_event_loop()
        try:
            content = loop.run_until_complete(runner())
        finally:
            loop.close()

        self.assertEqual(content, "Result1Result2")
        thinking = get_thinking_stream_service()
        steps = thinking.get_session_steps("simple1")
        step = steps[0]
        self.assertIn("Think1", step.content)
        self.assertIn("Think2", step.content)


class TestMultiAgentIsolation(unittest.TestCase):
    """多 agent 隔离测试"""

    def setUp(self):
        reset_thinking_stream_service()
        reset_llm_stream_wrapper()
        self.wrapper = LLMStreamWrapper()

    def test_multi_agent_steps(self):
        async def runner():
            # Agent 1
            async def llm1():
                yield MockChunk(reasoning_content="A1 thinking")
                yield MockChunk(content="A1 result")

            content1_parts = []
            async for c in self.wrapper.wrap_stream(
                llm1(), session_id="multi", agent_id="agent1"
            ):
                content1_parts.append(c)

            # Agent 2
            async def llm2():
                yield MockChunk(reasoning_content="A2 thinking")
                yield MockChunk(content="A2 result")

            content2_parts = []
            async for c in self.wrapper.wrap_stream(
                llm2(), session_id="multi", agent_id="agent2"
            ):
                content2_parts.append(c)

            return "".join(content1_parts), "".join(content2_parts)

        loop = asyncio.new_event_loop()
        try:
            c1, c2 = loop.run_until_complete(runner())
        finally:
            loop.close()

        self.assertEqual(c1, "A1 result")
        self.assertEqual(c2, "A2 result")

        thinking = get_thinking_stream_service()
        steps = thinking.get_session_steps("multi", reverse=False)
        self.assertEqual(len(steps), 2)
        # 验证 step_index 递增
        self.assertEqual(steps[0].step_index, 0)
        self.assertEqual(steps[1].step_index, 1)


class TestSingleton(unittest.TestCase):
    """全局单例测试"""

    def test_singleton(self):
        reset_llm_stream_wrapper()
        w1 = get_llm_stream_wrapper()
        w2 = get_llm_stream_wrapper()
        self.assertIs(w1, w2)


if __name__ == "__main__":
    unittest.main()
