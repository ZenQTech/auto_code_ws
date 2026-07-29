"""
Thread abstraction for the Hermes Python SDK.

A :class:`Thread` represents a single Hermes coding session. Threads are
stateless from the SDK perspective — the backend persists them, so the
caller can resume a thread by id via :meth:`Hermes.resume_thread`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, TYPE_CHECKING

from .run import RunResult
from .sandbox import Sandbox
from .stream import AsyncEventStream, EventStream, StreamEvent

if TYPE_CHECKING:  # pragma: no cover - type checking only
    from .client import Hermes


@dataclass
class ThreadConfig:
    """Configuration used when starting a new :class:`Thread`."""

    sandbox: Sandbox = Sandbox.WORKSPACE_WRITE
    model: str = "claude-sonnet-4.5"
    project_id: str = ""
    working_directory: str = ""
    system_prompt: str = ""
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_payload(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "sandbox": self.sandbox.value,
            "model": self.model,
        }
        if self.project_id:
            payload["project_id"] = self.project_id
        if self.working_directory:
            payload["working_directory"] = self.working_directory
        if self.system_prompt:
            payload["system_prompt"] = self.system_prompt
        if self.extra:
            payload.update(self.extra)
        return payload


class Thread:
    """Handle for a single Hermes thread.

    Use :meth:`Hermes.thread_start` to create one. Threads are cheap —
    they only carry an id and configuration; the heavy state lives on
    the backend.
    """

    def __init__(
        self,
        client: "Hermes",
        thread_id: str,
        config: Optional[ThreadConfig] = None,
    ) -> None:
        self._client = client
        self.id = thread_id
        self.config = config or ThreadConfig()

    # ------------------------------------------------------------------
    # Convenience accessors
    # ------------------------------------------------------------------
    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"Thread(id={self.id!r}, sandbox={self.config.sandbox.value!r})"

    # ------------------------------------------------------------------
    # Run APIs (synchronous)
    # ------------------------------------------------------------------
    def run(
        self,
        prompt: str,
        *,
        output_schema: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = None,
    ) -> RunResult:
        """Submit a prompt and block until the run completes."""
        payload: Dict[str, Any] = {"prompt": prompt}
        if output_schema is not None:
            payload["output_schema"] = output_schema
        if metadata is not None:
            payload["metadata"] = metadata
        data = self._client._request(
            "POST",
            f"/api/sdk/threads/{self.id}/runs",
            json_body=payload,
            timeout=timeout,
        )
        return RunResult.from_dict(data)

    def run_stream(
        self,
        prompt: str,
        *,
        output_schema: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = None,
    ) -> EventStream:
        """Submit a prompt and iterate over the resulting event stream."""
        payload: Dict[str, Any] = {"prompt": prompt, "stream": True}
        if output_schema is not None:
            payload["output_schema"] = output_schema
        if metadata is not None:
            payload["metadata"] = metadata
        data = self._client._request(
            "POST",
            f"/api/sdk/threads/{self.id}/runs/stream",
            json_body=payload,
            timeout=timeout,
        )
        return self._coerce_stream(data)

    async def arun(
        self,
        prompt: str,
        *,
        output_schema: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = None,
    ) -> RunResult:
        """Async variant of :meth:`run`."""
        payload: Dict[str, Any] = {"prompt": prompt}
        if output_schema is not None:
            payload["output_schema"] = output_schema
        if metadata is not None:
            payload["metadata"] = metadata
        data = await self._client._arequest(
            "POST",
            f"/api/sdk/threads/{self.id}/runs",
            json_body=payload,
            timeout=timeout,
        )
        return RunResult.from_dict(data)

    async def arun_stream(
        self,
        prompt: str,
        *,
        output_schema: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = None,
    ) -> AsyncEventStream:
        """Async variant of :meth:`run_stream`."""
        payload: Dict[str, Any] = {"prompt": prompt, "stream": True}
        if output_schema is not None:
            payload["output_schema"] = output_schema
        if metadata is not None:
            payload["metadata"] = metadata
        data = await self._client._arequest(
            "POST",
            f"/api/sdk/threads/{self.id}/runs/stream",
            json_body=payload,
            timeout=timeout,
        )
        events, final = self._extract_events(data)
        return AsyncEventStream(events, final=final)

    # ------------------------------------------------------------------
    # State helpers
    # ------------------------------------------------------------------
    def status(self) -> Dict[str, Any]:
        """Fetch the current thread status from the backend."""
        return self._client._request("GET", f"/api/sdk/threads/{self.id}")

    def close(self) -> Dict[str, Any]:
        """Mark the thread as closed on the backend (idempotent)."""
        return self._client._request("DELETE", f"/api/sdk/threads/{self.id}")

    async def aclose(self) -> Dict[str, Any]:
        """Async variant of :meth:`close`."""
        return await self._client._arequest("DELETE", f"/api/sdk/threads/{self.id}")

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    @staticmethod
    def _coerce_stream(data: Dict[str, Any]) -> EventStream:
        events, final = Thread._extract_events(data)
        return EventStream(events, final=final)

    @staticmethod
    def _extract_events(data: Dict[str, Any]):
        events: List[StreamEvent] = []
        for raw in data.get("events", []) or []:
            if isinstance(raw, StreamEvent):
                events.append(raw)
                continue
            if isinstance(raw, dict):
                evt_type = raw.get("type", "message")
                events.append(StreamEvent.from_payload(evt_type, raw))
        final_payload = data.get("final") or data.get("result")
        final = RunResult.from_dict(final_payload) if isinstance(final_payload, dict) else None
        return events, final
