"""
Exception hierarchy for the Hermes Python SDK.

All exceptions derive from :class:`HermesError` so callers can catch the
base class for any SDK-related failure. Sub-classes map to the most
common HTTP failure modes from the Hermes REST API.
"""

from __future__ import annotations

from typing import Any, Dict, Optional


class HermesError(Exception):
    """Base class for every Hermes SDK exception."""

    def __init__(self, message: str, *, payload: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(message)
        self.message = message
        self.payload = payload or {}

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"{type(self).__name__}({self.message!r})"


class HermesAPIError(HermesError):
    """Generic 4xx/5xx error from the Hermes REST API."""

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
        payload: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message, payload=payload)
        self.status_code = status_code


class HermesAuthError(HermesAPIError):
    """Raised on 401/403 responses."""

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = 401,
        payload: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message, status_code=status_code, payload=payload)


class HermesNotFoundError(HermesAPIError):
    """Raised on 404 responses (e.g. unknown thread_id)."""

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = 404,
        payload: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message, status_code=status_code, payload=payload)


class HermesRateLimitError(HermesAPIError):
    """Raised on 429 responses (too many requests)."""

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = 429,
        payload: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message, status_code=status_code, payload=payload)


class HermesServerError(HermesAPIError):
    """Raised on 5xx responses."""

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = 500,
        payload: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message, status_code=status_code, payload=payload)


class HermesTimeoutError(HermesError):
    """Raised when a request exceeds the configured timeout."""
