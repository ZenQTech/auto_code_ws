"""
Examples for the Hermes Python SDK.

This module is both an importable namespace and a CLI demo. Run it as:

    python -m examples.basic
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Allow running this file directly from the sdks/ directory.
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "python"))

from hermes_sdk import Hermes, Sandbox  # noqa: E402


def basic_run() -> dict:
    """Start a thread, run a prompt, return the result."""
    with Hermes(api_key=os.environ.get("HERMES_API_KEY", "demo")) as hermes:
        thread = hermes.thread_start(sandbox=Sandbox.WORKSPACE_WRITE)
        result = thread.run("Explain the architecture of this project in 3 bullets.")
        thread.close()
        return result.to_dict()


def streaming_run() -> dict:
    """Start a thread, stream events for a prompt, return a small summary."""
    with Hermes(api_key=os.environ.get("HERMES_API_KEY", "demo")) as hermes:
        thread = hermes.thread_start(sandbox=Sandbox.READ_ONLY)
        stream = thread.run_stream("Walk me through the verification loop.")
        events = list(stream)
        thread.close()
        return {
            "event_count": len(events),
            "first_text": events[0].text if events else "",
            "types": sorted({e.type for e in events}),
        }


def resume_after_restart(thread_id: str) -> dict:
    """Resume a previously created thread by id."""
    with Hermes(api_key=os.environ.get("HERMES_API_KEY", "demo")) as hermes:
        thread = hermes.resume_thread(thread_id)
        result = thread.run("Continue where we left off.")
        thread.close()
        return result.to_dict()


def main() -> None:
    print("== basic_run ==")
    print(json.dumps(basic_run(), indent=2)[:400])
    print("\n== streaming_run ==")
    print(json.dumps(streaming_run(), indent=2))


if __name__ == "__main__":
    main()
