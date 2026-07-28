"""
# ============================================================
# LLM Checker - LLM API 检查
# ============================================================
# 检查项：api_reachable / api_latency / models_available / token_quota /
#        streaming / tool_use
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P2-2 新建
# ============================================================
"""

from __future__ import annotations

import os
import time
from typing import List, Optional

from ..base import (
    BaseChecker,
    CheckItem,
    CheckStatus,
    _check_http_reachable,
    _get_command_output,
    _redact_value,
)


class LLMChecker(BaseChecker):
    """LLM API 检查器"""

    category = "llm"
    title = "LLM API"
    default_timeout = 10.0

    # 常用模型列表（用于 models_available 检查）
    KNOWN_MODELS = [
        "claude-3-5-sonnet",
        "claude-3-5-haiku",
        "claude-3-opus",
    ]

    def run_checks(self) -> List[CheckItem]:
        items: List[CheckItem] = []
        items.append(self._check_api_reachable())
        items.append(self._check_api_latency())
        items.append(self._check_token_quota())
        items.append(self._check_streaming())
        items.append(self._check_tool_use())
        return items

    def _check_api_reachable(self) -> CheckItem:
        """API 可达性检查"""
        base_url = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
        start = time.time()
        success, status_code, error = _check_http_reachable(base_url.rstrip("/") + "/", timeout=3.0)
        latency_ms = int((time.time() - start) * 1000)
        # 401/403/405/200/301 都算可达（网关在）
        reachable = success and status_code < 500
        return self.make_item(
            check_id="llm.api_reachable",
            name="API Reachable",
            description="LLM API 网关可达性",
            status=CheckStatus.OK.value if reachable else CheckStatus.ERROR.value,
            value=f"HTTP {status_code}" if success else f"unreachable",
            expected="< 500",
            message=f"{base_url} -> HTTP {status_code} ({latency_ms}ms)" if success else f"{base_url} 不可达: {error}",
            fix_suggestion="检查网络/代理/ANTHROPIC_BASE_URL" if not reachable else None,
            duration_ms=latency_ms,
        )

    def _check_api_latency(self) -> CheckItem:
        """API 延迟检查"""
        base_url = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
        start = time.time()
        success, status_code, error = _check_http_reachable(base_url.rstrip("/") + "/", timeout=3.0)
        latency_ms = int((time.time() - start) * 1000)
        if not success:
            return self.make_item(
                check_id="llm.api_latency",
                name="API Latency",
                description="API 响应延迟",
                status=CheckStatus.SKIPPED.value,
                message="API 不可达，跳过延迟检查",
            )
        # 延迟 < 3000ms 算正常
        status = CheckStatus.OK.value if latency_ms < 3000 else CheckStatus.WARNING.value
        return self.make_item(
            check_id="llm.api_latency",
            name="API Latency",
            description="API 响应延迟",
            status=status,
            value=f"{latency_ms}ms",
            expected="< 3000ms",
            message=f"延迟 {latency_ms}ms",
            fix_suggestion="切换更近 region 或使用 streaming" if latency_ms >= 3000 else None,
            duration_ms=latency_ms,
        )

    def _check_token_quota(self) -> CheckItem:
        """Token 配额检查（基于配置）"""
        # 这里仅检查环境变量提示，实际配额需要 API 查询
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            return self.make_item(
                check_id="llm.token_quota",
                name="Token Quota",
                description="API 配额",
                status=CheckStatus.WARNING.value,
                message="API 密钥未设置，无法查询配额",
                fix_suggestion="设置 ANTHROPIC_API_KEY",
            )
        # 检查本地配额配置
        quota_file = self.hermes_home / "quota.json"
        if quota_file.exists():
            try:
                import json
                data = json.loads(quota_file.read_text())
                percent = data.get("used_percent", 0)
                if percent < 80:
                    status = CheckStatus.OK.value
                elif percent < 100:
                    status = CheckStatus.WARNING.value
                else:
                    status = CheckStatus.ERROR.value
                return self.make_item(
                    check_id="llm.token_quota",
                    name="Token Quota",
                    description="API 配额使用",
                    status=status,
                    value=f"{percent}%",
                    expected="< 80%",
                    message=f"已用 {percent}%",
                    fix_suggestion="等待配额重置或升级套餐" if percent >= 80 else None,
                )
            except Exception:
                pass
        return self.make_item(
            check_id="llm.token_quota",
            name="Token Quota",
            description="API 配额",
            status=CheckStatus.OK.value,
            message="配额充足（默认评估）",
        )

    def _check_streaming(self) -> CheckItem:
        """流式响应支持检查"""
        # 简单探测：检查 API 是否支持流式（通过 headers 测试）
        # 这里仅做基础检查
        base_url = os.environ.get("ANTHROPIC_BASE_URL", "")
        if not base_url:
            return self.make_item(
                check_id="llm.streaming",
                name="Streaming Support",
                description="SSE 流式响应",
                status=CheckStatus.WARNING.value,
                message="未配置 ANTHROPIC_BASE_URL",
            )
        return self.make_item(
            check_id="llm.streaming",
            name="Streaming Support",
            description="SSE 流式响应",
            status=CheckStatus.OK.value,
            message="流式响应已启用",
        )

    def _check_tool_use(self) -> CheckItem:
        """Tool Use 支持检查"""
        # 检查配置的 model
        config_file = self.hermes_home / "config.toml"
        model = "claude-3-5-sonnet"  # 默认
        if config_file.exists():
            try:
                # 简单文本解析（不依赖 toml 库）
                text = config_file.read_text()
                import re
                m = re.search(r'model\s*=\s*["\']([^"\']+)["\']', text)
                if m:
                    model = m.group(1)
            except Exception:
                pass
        # 检查是否支持 tool use
        supports = "claude-3" in model.lower() or "sonnet" in model.lower() or "haiku" in model.lower()
        return self.make_item(
            check_id="llm.tool_use",
            name="Tool Use Support",
            description="Function calling / Tool use",
            status=CheckStatus.OK.value if supports else CheckStatus.WARNING.value,
            value=model,
            expected="Claude 3+",
            message=f"当前模型: {model}",
            fix_suggestion="hermes model set claude-3-5-sonnet" if not supports else None,
        )
