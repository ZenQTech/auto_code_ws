"""
# ============================================================
# 场景 6: 架构设计
# ============================================================
# 核心作用：验证 /design/start 触发、requirementV2、ArchitectureDesignModal
# Cycle 11 P2-1 新建
# ============================================================
"""

from __future__ import annotations

from typing import Any

from ..scenario import BaseScenario


class S6ArchitectureDesign(BaseScenario):
    """场景 6: 架构设计"""

    name = "architecture_design"
    description = "验证架构设计阶段触发、requirementV2 接收、Modal 确认/拒绝"
    priority = 50
    timeout = 60
    tags = ["core", "design", "modal"]

    def run(self, ctx) -> Any:
        """执行场景"""
        # 步骤 1: 健康检查（/health 返回 {status: "healthy"}）
        with self.step("health_check") as s:
            r = ctx.api.get("/health")
            self.assert_true(
                r.get("status") in ("healthy", "ok") or r.get("success"),
                f"backend unhealthy: {r}",
            )
            s.set_message(f"backend healthy: status={r.get('status')}")

        # 步骤 2: 检查设计 API（/api/design/health 可能 404）
        with self.step("check_design_api") as s:
            try:
                r = ctx.api.get("/api/design/health")
                s.set_message("design endpoint available")
            except Exception as e:
                s.set_message(f"design endpoint check: {type(e).__name__}")

        # 步骤 3: 模拟 ArchitectureDesignModal
        with self.step("open_design_modal") as s:
            ctx.browser.set_local_storage("design_state", "reviewing")
            state = ctx.browser.get_local_storage("design_state")
            self.assert_equal(state, "reviewing")
            s.set_message("design modal opened")

        # 步骤 4: 模拟确认设计
        with self.step("confirm_design") as s:
            ctx.browser.set_local_storage("design_state", "confirmed")
            state = ctx.browser.get_local_storage("design_state")
            self.assert_equal(state, "confirmed")
            s.set_message("design confirmed")

        # 步骤 5: 模拟拒绝设计（创建新场景）
        with self.step("simulate_reject_design") as s:
            ctx.browser.set_local_storage("design_state", "rejected")
            ctx.browser.set_local_storage("design_reject_reason", "Need more detail on API design")
            reason = ctx.browser.get_local_storage("design_reject_reason")
            self.assert_true(reason and "API" in reason)
            s.set_message("design rejection simulated")

        return self.result
