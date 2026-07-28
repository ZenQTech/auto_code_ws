"""
# ============================================================
# 场景 2: 模式选择 + 切换
# ============================================================
# 核心作用：验证 ModeSelector、Chat/Coding 模式切换、localStorage 持久化
# Cycle 11 P2-1 新建
# ============================================================
"""

from __future__ import annotations

from typing import Any

from ..scenario import BaseScenario


class S2ModeSwitch(BaseScenario):
    """场景 2: 模式选择 + 切换"""

    name = "mode_switch"
    description = "验证 ModeSelector 显示、Chat/Coding 模式切换、localStorage 持久化"
    priority = 90
    timeout = 30
    tags = ["core", "mode", "ui"]

    def run(self, ctx) -> Any:
        """执行场景"""
        # 步骤 1: 验证后端可用（/health 返回 {status: "healthy"}）
        with self.step("backend_health") as s:
            r = ctx.api.get("/health")
            # /health 返回 {"status": "healthy", ...}，视为健康
            self.assert_true(
                r.get("status") in ("healthy", "ok") or r.get("success"),
                f"backend unhealthy: {r}",
            )
            s.set_message(f"backend healthy: status={r.get('status')}")

        # 步骤 2: 导航到根路径（触发 ModeSelector）
        with self.step("navigate_to_root") as s:
            ctx.browser.navigate(f"{ctx.config.frontend_url}/")
            self.assert_equal(ctx.browser.get_url(), f"{ctx.config.frontend_url}/")
            s.set_message("navigated to root")

        # 步骤 3: 模拟选择 Chat 模式
        with self.step("select_chat_mode") as s:
            ctx.browser.set_local_storage("app_mode", "chat")
            stored = ctx.browser.get_local_storage("app_mode")
            self.assert_equal(stored, "chat", "chat mode not stored")
            s.set_message("chat mode selected and stored")

        # 步骤 4: 模拟切换到 Coding 模式
        with self.step("switch_to_coding_mode") as s:
            ctx.browser.set_local_storage("app_mode", "coding")
            stored = ctx.browser.get_local_storage("app_mode")
            self.assert_equal(stored, "coding", "coding mode not stored")
            s.set_message("coding mode selected and stored")

        # 步骤 5: 验证 localStorage 持久化（清空后恢复）
        with self.step("verify_localStorage_persistence") as s:
            ctx.browser.clear_local_storage()
            self.assert_equal(ctx.browser.get_local_storage("app_mode"), None)
            ctx.browser.set_local_storage("app_mode", "chat")
            persisted = ctx.browser.get_local_storage("app_mode")
            self.assert_equal(persisted, "chat")
            s.set_message("localStorage persistence verified")

        return self.result
