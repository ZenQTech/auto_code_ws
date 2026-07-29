"""
# TRAE Work - Voice Chat 优化
# ============================================================
# 核心作用：实现 TRAE Work 的 Voice Chat 优化
# 关联：Cycle 14 P1-3
# 版本：v6.31.0
#
# 核心能力：
#   - 语音会话管理（创建/查询/删除）
#   - 项目级上下文自动注入（从 Global Memory 拉取）
#   - 增强 Web 搜索（多源聚合 + 相关性排序）
#   - STT/TTS Mock（本地规则引擎）
#
# 算法：
#   - 上下文检索：tag 匹配 + 关键词匹配 + 时间衰减
#   - 相关性排序：score = 0.4 * tag_match + 0.4 * keyword + 0.2 * recency
#   - 复杂度：O(N) N = memory 条目数
# ============================================================
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from .models import (
    VoiceMessage,
    VoiceSession,
    WebSearchResult,
    _new_id,
    _now_iso,
)


# ============================================================
# STT/TTS Mock 实现
# ============================================================

# 简单的 STT 模拟：将"语音"输入转为文本
def mock_stt(audio_text: str) -> str:
    """模拟语音转文本（占位）"""
    if not audio_text:
        return ""
    # 简单的标点修正
    text = audio_text.strip()
    if not text.endswith((".", "!", "?", "。", "！", "？")):
        text += "。"
    return text


# 简单的 TTS 模拟：返回文本+时长估算
def mock_tts(text: str) -> Dict[str, Any]:
    """模拟文本转语音

    Returns:
        {"text": ..., "duration_estimate": ..., "audio_id": ...}
    """
    # 中文每字约 0.3 秒，英文每词约 0.4 秒
    chinese_chars = len(re.findall(r"[\u4e00-\u9fa5]", text))
    english_words = len(re.findall(r"[A-Za-z]+", text))
    duration = chinese_chars * 0.3 + english_words * 0.4
    return {
        "text": text,
        "duration_estimate": round(duration, 2),
        "audio_id": _new_id("tts"),
        "format": "wav",
    }


# ============================================================
# 增强 Web 搜索（Mock 多源聚合）
# ============================================================

# 模拟的搜索源
MOCK_SEARCH_SOURCES = [
    "openai-docs",
    "github",
    "stackoverflow",
    "mdn",
    "arxiv",
    "wikipedia",
    "huggingface",
    "anthropic-docs",
    "codex-changelog",
    "trae-changelog",
]


def mock_web_search(
    query: str,
    max_results: int = 5,
    sources: Optional[List[str]] = None,
) -> List[WebSearchResult]:
    """模拟多源 Web 搜索

    Args:
        query: 搜索关键词
        max_results: 最大结果数
        sources: 指定搜索源（默认全部）

    Returns:
        搜索结果列表（已按相关性排序）
    """
    if not query or not query.strip():
        return []

    # 提取查询关键词
    keywords = re.findall(r"[A-Za-z]+|[\u4e00-\u9fa5]+", query.lower())
    keywords = [k for k in keywords if len(k) >= 2]
    if not keywords:
        return []

    # 模拟的"知识库"用于匹配
    knowledge_base = [
        {
            "title": f"OpenAI Codex 文档 - {keywords[0]}",
            "url": f"https://openai.com/codex/docs/{keywords[0]}",
            "snippet": f"Codex {keywords[0]} 提供 {...} 的能力，支持 {...} 等场景，最佳实践包括 {...}。",
            "source": "openai-docs",
        },
        {
            "title": f"GitHub - {keywords[0]} 示例代码",
            "url": f"https://github.com/search?q={keywords[0]}&type=code",
            "snippet": f"查找 {keywords[0]} 的开源实现，包含完整示例与文档说明。",
            "source": "github",
        },
        {
            "title": f"Stack Overflow - {keywords[0]} 问答",
            "url": f"https://stackoverflow.com/search?q={keywords[0]}",
            "snippet": f"社区关于 {keywords[0]} 的热门讨论，包含 10+ 高票答案与最佳实践。",
            "source": "stackoverflow",
        },
        {
            "title": f"MDN - {keywords[0]} Web 标准",
            "url": f"https://developer.mozilla.org/zh-CN/search?q={keywords[0]}",
            "snippet": f"Web 平台 {keywords[0]} 的标准定义、浏览器兼容性与代码示例。",
            "source": "mdn",
        },
        {
            "title": f"arXiv - {keywords[0]} 学术论文",
            "url": f"https://arxiv.org/search/?query={keywords[0]}",
            "snippet": f"{keywords[0]} 相关的前沿研究，涵盖理论基础与实验验证。",
            "source": "arxiv",
        },
        {
            "title": f"Wiki - {keywords[0]} 背景知识",
            "url": f"https://zh.wikipedia.org/wiki/{keywords[0]}",
            "snippet": f"{keywords[0]} 的基本概念、发展历史与典型应用场景。",
            "source": "wikipedia",
        },
        {
            "title": f"Hugging Face - {keywords[0]} 模型",
            "url": f"https://huggingface.co/models?search={keywords[0]}",
            "snippet": f"包含 {keywords[0]} 相关的预训练模型，支持下载与在线推理。",
            "source": "huggingface",
        },
        {
            "title": f"Anthropic Docs - {keywords[0]} 集成",
            "url": f"https://docs.anthropic.com/en/docs/{keywords[0]}",
            "snippet": f"使用 Claude API 进行 {keywords[0]} 集成的完整指南与代码示例。",
            "source": "anthropic-docs",
        },
        {
            "title": f"Codex Changelog - {keywords[0]} 新特性",
            "url": f"https://developers.openai.com/codex/changelog?q={keywords[0]}",
            "snippet": f"Codex 最新版本中 {keywords[0]} 相关的新增功能、改进与已知问题。",
            "source": "codex-changelog",
        },
        {
            "title": f"TRAE Changelog - {keywords[0]} 更新",
            "url": f"https://www.trae.ai/changelog?q={keywords[0]}",
            "snippet": f"TRAE 最新动态中 {keywords[0]} 的新功能介绍。",
            "source": "trae-changelog",
        },
    ]

    # 过滤源
    if sources:
        knowledge_base = [k for k in knowledge_base if k["source"] in sources]

    # 计算相关性
    results: List[WebSearchResult] = []
    for idx, kb in enumerate(knowledge_base[:max_results * 2]):
        # 相关性：与关键词重合度
        text = (kb["title"] + kb["snippet"]).lower()
        matches = sum(1 for kw in keywords if kw in text)
        relevance = min(1.0, matches / max(1, len(keywords)) * 0.8 + 0.2)
        # 距离衰减
        relevance = relevance * (1.0 - idx * 0.05)
        results.append(
            WebSearchResult(
                title=kb["title"],
                url=kb["url"],
                snippet=kb["snippet"],
                source=kb["source"],
                relevance=round(max(0.1, relevance), 3),
            )
        )

    # 按相关性排序
    results.sort(key=lambda r: r.relevance, reverse=True)
    return results[:max_results]


# ============================================================
# Voice Chat 服务类
# ============================================================


class VoiceChatService:
    """语音聊天服务

    功能：
        - 语音会话管理
        - 项目级上下文注入
        - 增强 Web 搜索
        - 消息收发
    """

    def __init__(self) -> None:
        # session_id -> VoiceSession
        self._sessions: Dict[str, VoiceSession] = {}
        # 注入的 memory 回调（延迟解耦）
        self._memory_provider: Optional[Any] = None
        import threading
        self._lock = threading.RLock()
        # 统计
        self._stats = {
            "sessions": 0,
            "messages": 0,
            "web_searches": 0,
            "context_injections": 0,
        }

    def set_memory_provider(self, provider: Any) -> None:
        """注入 Global Memory 服务（延迟解耦）"""
        self._memory_provider = provider

    # ============================================================
    # 会话管理
    # ============================================================

    def create_session(
        self,
        user_id: str,
        project_id: str,
        initial_message: Optional[str] = None,
    ) -> VoiceSession:
        """创建语音会话

        Args:
            user_id: 用户 ID
            project_id: 项目 ID
            initial_message: 初始消息

        Returns:
            VoiceSession 实例
        """
        session = VoiceSession(
            session_id=_new_id("vsess"),
            user_id=user_id,
            project_id=project_id,
        )

        if initial_message:
            msg = VoiceMessage(
                message_id=_new_id("vmsg"),
                role="user",
                text=initial_message,
            )
            session.messages.append(msg.to_dict())

        with self._lock:
            self._sessions[session.session_id] = session
            self._stats["sessions"] += 1
            self._stats["messages"] += 1

        return session

    def get_session(self, session_id: str) -> Optional[VoiceSession]:
        """获取会话"""
        with self._lock:
            return self._sessions.get(session_id)

    def list_sessions(
        self,
        user_id: Optional[str] = None,
        project_id: Optional[str] = None,
        limit: int = 50,
    ) -> List[VoiceSession]:
        """列出会话"""
        with self._lock:
            results = list(self._sessions.values())
        if user_id:
            results = [s for s in results if s.user_id == user_id]
        if project_id:
            results = [s for s in results if s.project_id == project_id]
        results.sort(key=lambda s: s.last_active_at, reverse=True)
        return results[:limit]

    def close_session(self, session_id: str) -> bool:
        """关闭会话"""
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return False
            session.status = "closed"
            session.last_active_at = _now_iso()
            return True

    def delete_session(self, session_id: str) -> bool:
        """删除会话"""
        with self._lock:
            if session_id in self._sessions:
                del self._sessions[session_id]
                return True
            return False

    # ============================================================
    # 消息处理
    # ============================================================

    def send_message(
        self,
        session_id: str,
        text: str,
        audio_id: Optional[str] = None,
        use_context: bool = True,
        use_web_search: bool = False,
        web_search_query: Optional[str] = None,
    ) -> Dict[str, Any]:
        """发送消息

        Args:
            session_id: 会话 ID
            text: 消息文本
            audio_id: 关联音频 ID
            use_context: 是否注入项目上下文
            use_web_search: 是否执行 Web 搜索
            web_search_query: 自定义搜索关键词（默认用 text）

        Returns:
            {"message": ..., "reply": ..., "context_refs": ..., "web_results": ...}
        """
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                raise ValueError(f"Session not found: {session_id}")
            if session.status == "closed":
                raise ValueError(f"Session is closed: {session_id}")

        # 1. 注入上下文
        context_refs: List[str] = []
        if use_context and self._memory_provider is not None:
            try:
                entries = self._memory_provider.search(
                    project_id=session.project_id,
                    query=text,
                    top_k=3,
                )
                context_refs = [e.entry_id for e in entries]
                session.context_refs = list(set(session.context_refs + context_refs))
                self._stats["context_injections"] += 1
            except Exception:
                context_refs = []

        # 2. Web 搜索
        web_results: List[Dict[str, Any]] = []
        if use_web_search:
            q = web_search_query or text
            results = mock_web_search(q, max_results=3)
            web_results = [r.to_dict() for r in results]
            session.web_search_results.extend(web_results)
            self._stats["web_searches"] += 1

        # 3. 添加用户消息
        user_msg = VoiceMessage(
            message_id=_new_id("vmsg"),
            role="user",
            text=text,
            audio_id=audio_id,
        )
        with self._lock:
            session.messages.append(user_msg.to_dict())
            session.touch()
            self._stats["messages"] += 1

        # 4. 生成助手回复（Mock）
        reply_text = self._generate_reply(text, context_refs, web_results)
        assistant_msg = VoiceMessage(
            message_id=_new_id("vmsg"),
            role="assistant",
            text=reply_text,
            metadata={
                "context_refs": context_refs,
                "web_search_used": use_web_search,
            },
        )
        with self._lock:
            session.messages.append(assistant_msg.to_dict())
            session.touch()
            self._stats["messages"] += 1

        return {
            "message": user_msg.to_dict(),
            "reply": assistant_msg.to_dict(),
            "context_refs": context_refs,
            "web_results": web_results,
        }

    def get_context(
        self,
        session_id: str,
        query: Optional[str] = None,
        max_refs: int = 5,
    ) -> Dict[str, Any]:
        """获取会话上下文

        Args:
            session_id: 会话 ID
            query: 检索关键词
            max_refs: 最大引用数

        Returns:
            {"session_id": ..., "context_refs": [...], "details": [...]}
        """
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                raise ValueError(f"Session not found: {session_id}")

        if query and self._memory_provider is not None:
            try:
                entries = self._memory_provider.search(
                    project_id=session.project_id,
                    query=query,
                    top_k=max_refs,
                )
                refs = [e.to_dict() for e in entries]
                return {
                    "session_id": session_id,
                    "query": query,
                    "context_refs": [e.entry_id for e in entries],
                    "details": refs,
                }
            except Exception:
                pass

        # 返回当前 context_refs 的详情（如果有 memory provider）
        details: List[Dict[str, Any]] = []
        if self._memory_provider is not None:
            for ref_id in session.context_refs[:max_refs]:
                try:
                    entry = self._memory_provider.get_entry(ref_id)
                    if entry:
                        details.append(entry.to_dict())
                except Exception:
                    continue

        return {
            "session_id": session_id,
            "context_refs": session.context_refs[:max_refs],
            "details": details,
        }

    def web_search(
        self,
        query: str,
        max_results: int = 5,
        sources: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """执行 Web 搜索

        Args:
            query: 搜索关键词
            max_results: 最大结果数
            sources: 指定源

        Returns:
            搜索结果列表
        """
        with self._lock:
            self._stats["web_searches"] += 1
        return [r.to_dict() for r in mock_web_search(query, max_results, sources)]

    def transcribe(
        self,
        audio_id: str,
        text_hint: Optional[str] = None,
    ) -> Dict[str, Any]:
        """模拟语音转写

        Args:
            audio_id: 音频 ID
            text_hint: 文本提示（用于 Mock）

        Returns:
            {"audio_id": ..., "text": ..., "confidence": ...}
        """
        transcript = mock_stt(text_hint or "")
        return {
            "audio_id": audio_id,
            "text": transcript,
            "language": "zh-CN",
            "confidence": 0.95 if text_hint else 0.0,
            "model": "mock-stt-v1",
        }

    def synthesize(self, text: str) -> Dict[str, Any]:
        """模拟语音合成

        Args:
            text: 待合成文本

        Returns:
            {"audio_id": ..., "duration": ..., "format": ...}
        """
        result = mock_tts(text)
        return result

    # ============================================================
    # 内部辅助
    # ============================================================

    def _generate_reply(
        self,
        user_text: str,
        context_refs: List[str],
        web_results: List[Dict[str, Any]],
    ) -> str:
        """生成助手回复（Mock）"""
        parts: List[str] = []
        parts.append(f"已收到您的消息：{user_text[:100]}")

        if context_refs:
            parts.append(f"基于 {len(context_refs)} 条项目记忆回答。")

        if web_results:
            sources = list({r.get("source", "unknown") for r in web_results})
            parts.append(f"参考了 {', '.join(sources)} 等来源。")

        parts.append("这是一个 TRAE Work 模拟回复，将由真实 LLM 替换。")
        return " ".join(parts)

    def get_stats(self) -> Dict[str, Any]:
        """获取统计"""
        with self._lock:
            return dict(self._stats)


# 全局单例
GLOBAL_VOICE_CHAT = VoiceChatService()
