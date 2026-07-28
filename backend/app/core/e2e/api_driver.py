"""
# ============================================================
# API 驱动 - HTTP 客户端封装
# ============================================================
# 核心作用：提供轻量级 HTTP 客户端，封装 E2E 测试 API 调用
# 特性：超时控制、重试机制、JSON 自动处理、错误捕获
# Cycle 11 P2-1 新建
# ============================================================
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


class ApiError(Exception):
    """API 调用错误"""
    def __init__(self, message: str, status_code: int = 0, response: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.response = response


class ApiDriver:
    """
    HTTP 客户端驱动
    零外部依赖（使用 urllib）
    支持 GET/POST/PUT/DELETE
    """

    def __init__(
        self,
        base_url: str = "http://localhost:8765",
        timeout: int = 30,
        max_retries: int = 3,
        retry_delay: float = 1.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        # 统计
        self.total_requests = 0
        self.failed_requests = 0

    def _build_url(self, path: str, query: Optional[Dict[str, Any]] = None) -> str:
        """构建完整 URL"""
        url = f"{self.base_url}/{path.lstrip('/')}"
        if query:
            qs = urllib.parse.urlencode(
                {k: v for k, v in query.items() if v is not None},
                doseq=True,
            )
            url = f"{url}?{qs}"
        return url

    def _request(
        self,
        method: str,
        path: str,
        body: Optional[Any] = None,
        query: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """发送 HTTP 请求（带重试）"""
        url = self._build_url(path, query)
        data_bytes = None
        if body is not None:
            if isinstance(body, (dict, list)):
                data_bytes = json.dumps(body).encode("utf-8")
                headers = {**(headers or {}), "Content-Type": "application/json"}
            elif isinstance(body, str):
                data_bytes = body.encode("utf-8")
            elif isinstance(body, bytes):
                data_bytes = body

        req_headers = {
            "User-Agent": "E2E-Test/1.0",
            "Accept": "application/json",
            **(headers or {}),
        }

        last_error: Optional[Exception] = None
        for attempt in range(self.max_retries):
            self.total_requests += 1
            try:
                req = urllib.request.Request(
                    url,
                    data=data_bytes,
                    headers=req_headers,
                    method=method,
                )
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    raw = resp.read()
                    if not raw:
                        return {}
                    try:
                        return json.loads(raw.decode("utf-8"))
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        return {"raw": raw.decode("utf-8", errors="replace")}

            except urllib.error.HTTPError as e:
                # 4xx 错误不重试
                if 400 <= e.code < 500:
                    self.failed_requests += 1
                    raw = e.read()
                    try:
                        resp = json.loads(raw.decode("utf-8"))
                    except Exception:
                        resp = {"raw": raw.decode("utf-8", errors="replace")}
                    raise ApiError(
                        f"HTTP {e.code} {method} {url}",
                        status_code=e.code,
                        response=resp,
                    ) from e
                last_error = e
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                last_error = e
                logger.warning(f"attempt {attempt + 1}/{self.max_retries} failed: {e}")

            if attempt < self.max_retries - 1:
                time.sleep(self.retry_delay * (2 ** attempt))

        self.failed_requests += 1
        raise ApiError(
            f"request failed after {self.max_retries} attempts: {last_error}",
            status_code=0,
        )

    def get(self, path: str, query: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """GET 请求"""
        return self._request("GET", path, query=query)

    def post(self, path: str, body: Any = None, query: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """POST 请求"""
        return self._request("POST", path, body=body, query=query)

    def put(self, path: str, body: Any = None) -> Dict[str, Any]:
        """PUT 请求"""
        return self._request("PUT", path, body=body)

    def delete(self, path: str) -> Dict[str, Any]:
        """DELETE 请求"""
        return self._request("DELETE", path)

    def health(self) -> Dict[str, Any]:
        """健康检查（带可配置路径）"""
        try:
            return self.get("/health")
        except ApiError:
            return {"success": False, "error": "backend_unreachable"}

    def stats(self) -> Dict[str, Any]:
        """统计信息"""
        return {
            "total_requests": self.total_requests,
            "failed_requests": self.failed_requests,
            "success_rate": (
                (self.total_requests - self.failed_requests) / self.total_requests
                if self.total_requests > 0
                else 0.0
            ),
        }
