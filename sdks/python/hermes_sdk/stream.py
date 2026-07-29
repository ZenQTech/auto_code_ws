"""
Streaming event types and the lightweight :class:`EventStream` wrapper.

The Hermes backend emits Server-Sent Events (SSE) encoded as
``event: <type>\\ndata: <json>\\n\\n`` blocks. The :class:`EventStream`
iterator parses those blocks into :class:`StreamEvent` objects.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, Iterator, List, Optional


# Canonical event types emitted by the backend.
EVENT_TEXT_DELTA = "text_delta"
EVENT_TOOL_CALL = "tool_call"
EVENT_TOOL_RESULT = "tool_result"
EVENT_RUN_STARTED = "run_started"
EVENT_RUN_COMPLETED = "run_completed"
EVENT_RUN_FAILED = "run_failed"
EVENT_HEARTBEAT = "heartbeat"


@dataclass
class StreamEvent:
    """A single Server-Sent Event from the Hermes API."""

    type: str = ""
    text: str = ""
    data: Dict[str, Any] = field(default_factory=dict)
    run_id: str = ""
    thread_id: str = ""
    raw: str = ""

    @classmethod
    def from_payload(cls, event_type: str, payload: Dict[str, Any]) -> "StreamEvent":
        """Build a :class:`StreamEvent` from a parsed SSE payload."""
        text = ""
        data = dict(payload or {})
        if event_type == EVENT_TEXT_DELTA:
            text = str(payload.get("text") or payload.get("delta") or "")
        return cls(
            type=event_type,
            text=text,
            data=data,
            run_id=str(payload.get("run_id", "")),
            thread_id=str(payload.get("thread_id", "")),
        )


class EventStream:
    """Synchronous iterator wrapper over a parsed list of events.

    The Hermes backend currently returns the full event list as JSON
    rather than a true SSE stream. The wrapper exposes both the raw
    list and an iterator that yields :class:`StreamEvent` objects so
    callers can adopt the streaming API without changing their code
    once the backend switches to true SSE.
    """

    def __init__(self, events: List[StreamEvent], final: Optional["RunResult"] = None) -> None:
        self._events = list(events)
        self.final = final

    def __iter__(self) -> Iterator[StreamEvent]:
        for evt in self._events:
            yield evt

    def __len__(self) -> int:
        return len(self._events)

    def texts(self) -> List[str]:
        """Return the concatenated text from all text_delta events."""
        return [e.text for e in self._events if e.type == EVENT_TEXT_DELTA and e.text]

    def tool_calls(self) -> List[Dict[str, Any]]:
        """Return data from all tool_call events."""
        return [e.data for e in self._events if e.type == EVENT_TOOL_CALL]


class AsyncEventStream:
    """Async iterator counterpart to :class:`EventStream`.

    Currently produces the buffered events asynchronously; the API
    matches what callers expect when the backend upgrades to true SSE.
    """

    def __init__(self, events: List[StreamEvent], final: Optional["RunResult"] = None) -> None:
        self._events = list(events)
        self.final = final

    def __aiter__(self) -> AsyncIterator[StreamEvent]:
        async def gen() -> AsyncIterator[StreamEvent]:
            for evt in self._events:
                yield evt
        return gen()

    def __len__(self) -> int:
        return len(self._events)


def parse_sse_block(block: str) -> Optional[StreamEvent]:
    """Parse a single SSE ``event/data`` block into a :class:`StreamEvent`.

    Returns ``None`` for empty / keep-alive / heartbeat blocks.
    """
    event_type = ""
    data_lines: List[str] = []
    for line in block.splitlines():
        if not line:
            continue
        if line.startswith(":"):
            continue  # comment / keep-alive
        if line.startswith("event:"):
            event_type = line[len("event:"):].strip()
        elif line.startswith("data:"):
            data_lines.append(line[len("data:"):].lstrip())
    if not event_type and not data_lines:
        return None
    raw_data = "\n".join(data_lines)
    try:
        payload = json.loads(raw_data) if raw_data else {}
    except json.JSONDecodeError:
        payload = {"raw": raw_data}
    return StreamEvent.from_payload(event_type or "message", payload)
