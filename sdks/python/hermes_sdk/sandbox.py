"""
Sandbox presets mirroring the Codex v0.135+ ``Sandbox`` enum.

Three presets are supported:

* ``READ_ONLY`` – audit / analysis only, no filesystem writes.
* ``WORKSPACE_WRITE`` – writes only allowed within the project workspace
  (recommended for typical coding tasks).
* ``FULL_ACCESS`` – unrestricted filesystem access; use only in trusted
  environments.
"""

from __future__ import annotations

from enum import Enum


class Sandbox(str, Enum):
    """Filesystem sandbox modes for a Hermes thread."""

    READ_ONLY = "read_only"
    WORKSPACE_WRITE = "workspace_write"
    FULL_ACCESS = "full_access"

    @classmethod
    def coerce(cls, value: "str | Sandbox") -> "Sandbox":
        """Return a Sandbox for a string-or-Sandbox input."""
        if isinstance(value, cls):
            return value
        if isinstance(value, str):
            normalized = value.strip().lower().replace("-", "_")
            for member in cls:
                if member.value == normalized:
                    return member
        raise ValueError(f"Unknown sandbox: {value!r}")
