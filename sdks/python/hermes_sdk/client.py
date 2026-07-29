"""
Main :class:`Hermes` client for the Python SDK.

The client owns a ``HermesConfig`` and a tiny HTTP helper layer that
maps status codes to typed SDK exceptions. It exposes
:meth:`thread_start` / :meth:`resume_thread` to mirror the Codex SDK
API surface.

The HTTP layer is intentionally dependency-free so the SDK can be
vendored in offline environments. The default transport uses the
standard library ``urllib``; the async transport uses ``asyncio`` and
``urllib`` (no third-party dependencies).
"""

from __future__ import annotations

import asyncio
import json
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

from .config import HermesConfig
from .exceptions import (
    HermesAPIError,
    HermesAuthError,
    HermesNotFoundError,
    HermesRateLimitError,
    HermesServerError,
    HermesTimeoutError,
)
from .sandbox import Sandbox
from .thread import Thread, ThreadConfig


class Hermes:
    """Top-level entry point for the Hermes Python SDK.

    Use as a context manager to ensure clean shutdown of the underlying
    transports.

    Example
    -------

        with Hermes(api_key="hermes-xxx") as hermes:
            thread = hermes.thread_start(sandbox=Sandbox.WORKSPACE_WRITE)
            print(thread.run("Hello").final_response)
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: Optional[str] = None,
        config: Optional[HermesConfig] = None,
    ) -> None:
        if config is not None:
            self.config = config
        else:
            self.config = HermesConfig.from_env()
        if api_key is not None:
            self.config.api_key = api_key
        if base_url is not None:
            self.config.base_url = base_url
        self._closed = False

    # ------------------------------------------------------------------
    # Context manager
    # ------------------------------------------------------------------
    def __enter__(self) -> "Hermes":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    async def __aenter__(self) -> "Hermes":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        self.close()

    def close(self) -> None:
        self._closed = True

    # ------------------------------------------------------------------
    # Thread lifecycle
    # ------------------------------------------------------------------
    def thread_start(
        self,
        *,
        sandbox: Sandbox | str = Sandbox.WORKSPACE_WRITE,
        model: Optional[str] = None,
        project_id: Optional[str] = None,
        working_directory: Optional[str] = None,
        system_prompt: Optional[str] = None,
        config: Optional[ThreadConfig] = None,
        extra: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = None,
    ) -> Thread:
        """Start a new thread on the backend."""
        cfg = config or ThreadConfig(
            sandbox=Sandbox.coerce(sandbox),
            model=model or self.config.default_model,
            project_id=project_id or self.config.project_id,
            working_directory=working_directory or "",
            system_prompt=system_prompt or "",
            extra=extra or {},
        )
        data = self._request(
            "POST",
            "/api/sdk/threads",
            json_body=cfg.to_payload(),
            timeout=timeout,
        )
        thread_id = data.get("thread_id") or data.get("id", "")
        if not thread_id:
            raise HermesAPIError(
                "Backend returned a thread without an id",
                payload=data,
            )
        return Thread(self, thread_id, config=cfg)

    def resume_thread(self, thread_id: str) -> Thread:
        """Resume a previously started thread by id."""
        data = self._request("GET", f"/api/sdk/threads/{thread_id}")
        cfg = ThreadConfig(
            sandbox=Sandbox.coerce(data.get("sandbox", self.config.default_sandbox)),
            model=data.get("model", self.config.default_model),
            project_id=data.get("project_id", ""),
            working_directory=data.get("working_directory", ""),
            system_prompt=data.get("system_prompt", ""),
        )
        return Thread(self, data.get("thread_id", thread_id), config=cfg)

    def list_threads(self) -> Dict[str, Any]:
        """List all threads currently tracked on the backend."""
        return self._request("GET", "/api/sdk/threads")

    # ------------------------------------------------------------------
    # HTTP plumbing
    # ------------------------------------------------------------------
    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Issue a synchronous HTTP request and return the parsed JSON body."""
        if self._closed:
            raise HermesAPIError("Client is closed")
        url = self._build_url(path, params)
        body: Optional[bytes] = None
        headers = self._build_headers()
        if json_body is not None:
            body = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=body, method=method, headers=headers)
        attempts = max(0, int(self.config.max_retries)) + 1
        last_error: Optional[Exception] = None
        for attempt in range(attempts):
            try:
                with urllib.request.urlopen(
                    request, timeout=timeout or self.config.timeout
                ) as response:
                    raw = response.read().decode("utf-8") or "{}"
                    return self._parse_json(raw)
            except urllib.error.HTTPError as e:
                payload = self._safe_read(e)
                mapped = self._map_http_error(e.code, payload, e)
                if isinstance(mapped, (HermesRateLimitError, HermesServerError)) and attempt + 1 < attempts:
                    last_error = mapped
                    time.sleep(self._backoff(attempt))
                    continue
                raise mapped
            except urllib.error.URLError as e:
                last_error = HermesTimeoutError(f"Network error: {e.reason}")
                if attempt + 1 < attempts:
                    time.sleep(self._backoff(attempt))
                    continue
                raise last_error
        # Should not reach here but be defensive.
        if last_error:
            raise last_error
        return {}

    async def _arequest(
        self,
        method: str,
        path: str,
        *,
        json_body: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Async variant of :meth:`_request` (uses ``asyncio.to_thread``)."""
        return await asyncio.to_thread(
            self._request, method, path, json_body=json_body, params=params, timeout=timeout
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _build_url(self, path: str, params: Optional[Dict[str, Any]]) -> str:
        base = self.config.base_url.rstrip("/")
        if not path.startswith("/"):
            path = "/" + path
        url = f"{base}{path}"
        if params:
            from urllib.parse import urlencode
            filtered = {k: v for k, v in params.items() if v is not None and v != ""}
            if filtered:
                url = f"{url}?{urlencode(filtered, doseq=True)}"
        return url

    def _build_headers(self) -> Dict[str, str]:
        headers = {
            "Accept": "application/json",
            "User-Agent": f"hermes-sdk-python/{self._version()}",
        }
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        if self.config.extra_headers:
            headers.update(self.config.extra_headers)
        return headers

    @staticmethod
    def _version() -> str:
        try:
            from . import __version__
        except Exception:  # pragma: no cover
            return "0.0.0"
        return __version__

    @staticmethod
    def _parse_json(raw: str) -> Dict[str, Any]:
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return {"raw": raw}
        if isinstance(data, dict):
            return data
        return {"data": data}

    @staticmethod
    def _safe_read(error: urllib.error.HTTPError) -> Dict[str, Any]:
        try:
            raw = error.read().decode("utf-8") or "{}"
        except Exception:
            return {}
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"raw": raw}

    @staticmethod
    def _map_http_error(
        status_code: int,
        payload: Dict[str, Any],
        error: urllib.error.HTTPError,
    ) -> Exception:
        message = str(payload.get("detail") or payload.get("message") or error.reason or error)
        if status_code in (401, 403):
            return HermesAuthError(message, status_code=status_code, payload=payload)
        if status_code == 404:
            return HermesNotFoundError(message, status_code=status_code, payload=payload)
        if status_code == 429:
            return HermesRateLimitError(message, status_code=status_code, payload=payload)
        if status_code >= 500:
            return HermesServerError(message, status_code=status_code, payload=payload)
        return HermesAPIError(message, status_code=status_code, payload=payload)

    def _backoff(self, attempt: int) -> float:
        return float(self.config.backoff_factor) * (2 ** attempt)
