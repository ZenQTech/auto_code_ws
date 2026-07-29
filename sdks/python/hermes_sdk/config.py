"""
Configuration objects for the Hermes Python SDK.

The :class:`HermesConfig` dataclass holds the network settings shared
by the :class:`Hermes` client. All fields have safe defaults that work
against a local development instance of the Hermes backend.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class HermesConfig:
    """Network configuration for the Hermes SDK client."""

    api_key: str = ""
    base_url: str = "http://localhost:8000"
    timeout: float = 60.0
    max_retries: int = 2
    backoff_factor: float = 0.5
    default_model: str = "claude-sonnet-4.5"
    default_sandbox: str = "workspace_write"
    project_id: str = ""
    extra_headers: dict = field(default_factory=dict)

    @classmethod
    def from_env(cls, *, base_url: Optional[str] = None) -> "HermesConfig":
        """Build a config from the ``HERMES_API_KEY`` / ``HERMES_BASE_URL`` env vars."""
        api_key = os.environ.get("HERMES_API_KEY", "")
        resolved_base = base_url or os.environ.get("HERMES_BASE_URL", cls.base_url)
        timeout = float(os.environ.get("HERMES_TIMEOUT", cls.timeout))
        return cls(api_key=api_key, base_url=resolved_base, timeout=timeout)

    def with_overrides(self, **kwargs) -> "HermesConfig":
        """Return a copy of this config with any of the fields overridden."""
        from dataclasses import replace
        return replace(self, **kwargs)
