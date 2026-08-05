"""
# ============================================================
# LLM 流式响应包装器 (v1.0.0)
# Cycle 68 G68-03
# ============================================================
# 核心作用：包装 LLM 流式响应，检测 reasoning_content 字段，
#           自动触发 ThinkingStreamService 事件
# 运行流程：
#   1. wrap_stream(llm_stream, session_id, agent_id)
#      → 启动 thinking step
#   2. 对每个 chunk 检测 reasoning_content/content
#      → reasoning → thinking_service.append_delta
#      → content → yield 给调用方
#   3. 流结束 → thinking_service.end_step
# 设计要点：
#   - 兼容 OpenAI-compatible 流式协议（reasoning_content 字段）
#   - 兼容普通 chunk（无 reasoning_content）
#   - 异常安全：end_step with error metadata
#   - 可选：summary 自动从 final_content 截取前 200 字符
# 输入参数：异步 chunk 迭代器、session_id、agent_id
# 输出结果：异步 chunk 迭代器（仅含 content）
# 对标：Codex reasoning_content + Trae 思考流集成
# ====================================
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 68 G68-03 初次创建
# ====================================
"""

import asyncio
import logging
import time
from typing import Any, AsyncIterator, Callable, Dict, Optional

from .thinking_stream import (
    ThinkingStep,
    ThinkingStreamService,
    get_thinking_stream_service,
)

logger = logging.getLogger(__name__)


# ============================================================
# Mock Chunk 类型
# ============================================================


class MockDelta:
    """OpenAI-compatible delta"""
    def __init__(
        self,
        content: str = "",
        reasoning_content: str = "",
    ):
        self.content = content
        self.reasoning_content = reasoning_content


class MockChoice:
    """OpenAI-compatible choice"""
    def __init__(self, delta: MockDelta):
        self.delta = delta


class MockChunk:
    """OpenAI-compatible streaming chunk"""
    def __init__(
        self,
        content: str = "",
        reasoning_content: str = "",
    ):
        self.choices = [MockChoice(MockDelta(content, reasoning_content))]


# ============================================================
# 包装器
# ============================================================


class LLMStreamWrapper:
    """
    LLM 流式响应包装器

    用法：
        wrapper = LLMStreamWrapper()
        async for content_chunk in wrapper.wrap_stream(
            llm_stream=some_async_iter(),
            session_id="sess-1",
            agent_id="agent-1",
            model="claude-3.5-sonnet",
        ):
            print(content_chunk)
    """

    def __init__(
        self,
        thinking_service: Optional[ThinkingStreamService] = None,
    ):
        self._thinking = thinking_service or get_thinking_stream_service()

    async def wrap_stream(
        self,
        llm_stream: AsyncIterator[Any],
        session_id: str,
        agent_id: str,
        model: str = "",
        metadata: Optional[Dict[str, Any]] = None,
        summary_length: int = 200,
    ) -> AsyncIterator[str]:
        """
        包装 LLM 流式响应

        处理：
          - chunk.choices[0].delta.reasoning_content → 推送到 thinking
          - chunk.choices[0].delta.content → yield 给调用方

        错误处理：
          - 启动失败：直接抛出
          - 中途失败：end_step with error
        """
        # 1. 启动 step
        step = await self._thinking.start_step(
            session_id=session_id,
            agent_id=agent_id,
            model=model,
            metadata=metadata or {},
        )

        final_content_parts: list = []
        chunk_count = 0
        reasoning_chunks = 0
        content_chunks = 0
        error: Optional[Exception] = None

        try:
            async for chunk in llm_stream:
                chunk_count += 1
                # 提取 content 和 reasoning_content
                content, reasoning = self._extract_chunk_fields(chunk)

                if reasoning:
                    reasoning_chunks += 1
                    await self._thinking.append_delta(
                        step.step_id,
                        reasoning,
                    )

                if content:
                    content_chunks += 1
                    final_content_parts.append(content)
                    yield content

        except Exception as e:
            error = e
            logger.error(
                f"LLM stream error: session={session_id} agent={agent_id}: {e}"
            )
            raise
        finally:
            # 2. 结束 step（无论成功失败）
            final_content = "".join(final_content_parts)
            summary = final_content[:summary_length] if final_content else ""
            end_metadata: Dict[str, Any] = {
                "chunk_count": chunk_count,
                "reasoning_chunks": reasoning_chunks,
                "content_chunks": content_chunks,
            }
            if error is not None:
                end_metadata["error"] = str(error)
                end_metadata["error_type"] = type(error).__name__
            try:
                await self._thinking.end_step(
                    step.step_id,
                    summary=summary,
                    metadata=end_metadata,
                )
            except Exception as end_err:
                logger.error(f"end_step 失败: {end_err}")

    def _extract_chunk_fields(self, chunk: Any) -> tuple:
        """
        提取 chunk 的 content 和 reasoning_content
        支持：
          - OpenAI-compatible: chunk.choices[0].delta.content / .reasoning_content
          - Mock: 同上
          - Dict: chunk["choices"][0]["delta"]["content"]
        返回 (content, reasoning_content)
        """
        content = ""
        reasoning = ""

        try:
            if isinstance(chunk, dict):
                # dict 形式
                choices = chunk.get("choices", [])
                if choices:
                    delta = choices[0].get("delta", {})
                    content = delta.get("content", "") or ""
                    reasoning = delta.get("reasoning_content", "") or ""
            else:
                # 对象形式（OpenAI SDK / Mock）
                choices = getattr(chunk, "choices", None)
                if choices:
                    delta = getattr(choices[0], "delta", None)
                    if delta is not None:
                        content = getattr(delta, "content", "") or ""
                        reasoning = getattr(delta, "reasoning_content", "") or ""
        except (AttributeError, IndexError, TypeError):
            # 忽略解析错误
            pass

        return content, reasoning

    async def wrap_simple_stream(
        self,
        reasoning_tokens: list,
        content_tokens: Optional[list] = None,
        session_id: str = "test-session",
        agent_id: str = "test-agent",
        model: str = "mock-llm",
    ) -> AsyncIterator[str]:
        """
        简化流式接口：直接接受 reasoning + content 列表
        用于测试和简单场景
        """
        async def mock_iter():
            max_len = max(len(reasoning_tokens), len(content_tokens or []))
            for i in range(max_len):
                r = reasoning_tokens[i] if i < len(reasoning_tokens) else ""
                c = (content_tokens[i] if content_tokens and i < len(content_tokens) else "")
                yield MockChunk(content=c, reasoning_content=r)
                await asyncio.sleep(0.001)

        async for content in self.wrap_stream(
            llm_stream=mock_iter(),
            session_id=session_id,
            agent_id=agent_id,
            model=model,
        ):
            yield content


# ============================================================
# 便捷函数
# ============================================================


_llm_wrapper_instance: Optional[LLMStreamWrapper] = None


def get_llm_stream_wrapper() -> LLMStreamWrapper:
    """获取全局 LLMStreamWrapper 实例"""
    global _llm_wrapper_instance
    if _llm_wrapper_instance is None:
        _llm_wrapper_instance = LLMStreamWrapper()
    return _llm_wrapper_instance


def reset_llm_stream_wrapper() -> None:
    """重置全局实例（仅测试）"""
    global _llm_wrapper_instance
    _llm_wrapper_instance = None
