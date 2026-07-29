"""
Run / Result objects returned by :meth:`Thread.run` and ``run_stream``.

Mirrors the Codex SDK response shape so existing Codex tooling can be
ported with minimal changes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class Usage:
    """Token usage breakdown for a single run."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "Usage":
        data = data or {}
        prompt = int(data.get("prompt_tokens", 0) or 0)
        completion = int(data.get("completion_tokens", 0) or 0)
        total = int(data.get("total_tokens", prompt + completion) or (prompt + completion))
        return cls(
            prompt_tokens=prompt,
            completion_tokens=completion,
            total_tokens=total,
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
        }


@dataclass
class RunResult:
    """Synchronous result of a :meth:`Thread.run` call."""

    thread_id: str = ""
    run_id: str = ""
    final_response: str = ""
    status: str = "completed"
    usage: Usage = field(default_factory=Usage)
    collected_items: List[Dict[str, Any]] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "RunResult":
        return cls(
            thread_id=data.get("thread_id", ""),
            run_id=data.get("run_id", ""),
            final_response=data.get("final_response") or data.get("text") or "",
            status=data.get("status", "completed"),
            usage=Usage.from_dict(data.get("usage")),
            collected_items=list(data.get("collected_items", []) or []),
            metadata=dict(data.get("metadata", {}) or {}),
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "thread_id": self.thread_id,
            "run_id": self.run_id,
            "final_response": self.final_response,
            "status": self.status,
            "usage": self.usage.to_dict(),
            "collected_items": list(self.collected_items),
            "metadata": dict(self.metadata),
        }
