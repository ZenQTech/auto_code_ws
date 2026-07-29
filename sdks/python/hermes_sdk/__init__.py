"""
Hermes Python SDK
=================

Python SDK for the Hermes Agent Scheduling Platform.
Mirrors the Codex SDK API surface (Thread/Run/Stream) but targets the
Hermes REST API so external Python tooling and CLIs can drive the
agent platform programmatically.

Quickstart
----------

    from hermes_sdk import Hermes, Sandbox

    with Hermes(api_key="hermes-xxx") as hermes:
        thread = hermes.thread_start(sandbox=Sandbox.WORKSPACE_WRITE)
        result = thread.run("Explain this codebase in 3 bullets.")
        print(result.final_response)
        print(result.usage)

For more examples see ``sdks/examples/``.
"""

from .client import Hermes
from .config import HermesConfig
from .exceptions import (
    HermesError,
    HermesAPIError,
    HermesAuthError,
    HermesNotFoundError,
    HermesRateLimitError,
    HermesServerError,
    HermesTimeoutError,
)
from .run import RunResult, Usage
from .sandbox import Sandbox
from .stream import AsyncEventStream, EventStream, StreamEvent
from .thread import Thread, ThreadConfig

__all__ = [
    "Hermes",
    "HermesConfig",
    "Sandbox",
    "Thread",
    "ThreadConfig",
    "RunResult",
    "Usage",
    "EventStream",
    "AsyncEventStream",
    "StreamEvent",
    "HermesError",
    "HermesAPIError",
    "HermesAuthError",
    "HermesNotFoundError",
    "HermesRateLimitError",
    "HermesServerError",
    "HermesTimeoutError",
]

__version__ = "0.1.0"
