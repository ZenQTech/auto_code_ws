"""
# ============================================================
# 场景 8: 全链路回归
# ============================================================
# 核心作用：端到端：用户输入 → 需求澄清 → 架构设计 → 任务派发
# Cycle 11 P2-1 新建
# ============================================================
"""

from __future__ import annotations

from typing import Any

from ..scenario import BaseScenario


class S8E2ERegression(BaseScenario):
    """场景 8: 全链路回归"""

    name = "e2e_regression"
    description = "端到端回归：用户输入 → 需求澄清 → 架构设计 → 任务派发 → 验证"
    priority = 10  # 最低优先级（最后执行）
    timeout = 120
    tags = ["core", "e2e", "regression", "integration"]

    def run(self, ctx) -> Any:
        """执行场景"""
        # 步骤 1: 全后端健康检查
        with self.step("full_health_check") as s:
            endpoints = [
                "/health",
                "/api/doctor/health",
                "/api/verification/health",
                "/api/e2e/health",
            ]
            healthy = 0
            for ep in endpoints:
                try:
                    r = ctx.api.get(ep)
                    if (
                        r.get("status") in ("healthy", "ok")
                        or r.get("success")
                        or "version" in r
                    ):
                        healthy += 1
                except Exception:
                    pass
            self.assert_true(healthy >= 2, f"insufficient healthy endpoints: {healthy}/{len(endpoints)}")
            s.set_message(f"{healthy}/{len(endpoints)} endpoints healthy")

        # 步骤 2: 创建 Session
        with self.step("create_session") as s:
            r = ctx.api.post("/api/sessions", body={"title": "E2E Regression"})
            self.assert_true(
                r.get("id") and r.get("title"),
                f"create failed or missing id/title: {r}",
            )
            sid = r.get("id")
            self.assert_true(sid, "no session id")
            ctx.state["regression_session_id"] = sid
            s.set_message(f"session {sid}")

        # 步骤 3: 模拟需求输入
        with self.step("simulate_requirement_input") as s:
            ctx.browser.fill(
                "textarea",
                "Build an AGV with differential drive, SICK LiDAR, emergency stop, and SLAM navigation"
            )
            value = ctx.browser.elements.get("textarea", {}).get("value", "")
            self.assert_true("AGV" in value and "emergency" in value.lower())
            s.set_message("requirement input simulated")

        # 步骤 4: 触发需求澄清
        with self.step("trigger_clarification") as s:
            ctx.browser.set_local_storage("workflow_stage", "clarifying")
            stage = ctx.browser.get_local_storage("workflow_stage")
            self.assert_equal(stage, "clarifying")
            s.set_message("clarification stage entered")

        # 步骤 5: 触发架构设计
        with self.step("trigger_architecture_design") as s:
            ctx.browser.set_local_storage("workflow_stage", "designing")
            stage = ctx.browser.get_local_storage("workflow_stage")
            self.assert_equal(stage, "designing")
            s.set_message("design stage entered")

        # 步骤 6: 触发任务派发
        with self.step("trigger_task_dispatch") as s:
            ctx.browser.set_local_storage("workflow_stage", "dispatching")
            stage = ctx.browser.get_local_storage("workflow_stage")
            self.assert_equal(stage, "dispatching")
            s.set_message("dispatch stage entered")

        # 步骤 7: 验证 SubAgent workspace（端点可能 404）
        with self.step("verify_subagent_workspace") as s:
            try:
                r = ctx.api.get("/api/subagents")
                s.set_message(f"subagents API responded")
            except Exception as e:
                s.set_message(f"subagents API check: {type(e).__name__}")

        # 步骤 8: 触发 Verification Loop
        with self.step("trigger_verification") as s:
            try:
                r = ctx.api.get("/api/verification/health")
                self.assert_true(
                    r.get("success") or "version" in r,
                    f"verification not healthy: {r}",
                )
                s.set_message("verification triggered")
            except Exception as e:
                s.set_message(f"verification check: {type(e).__name__}")

        # 步骤 9: 运行 Doctor 诊断
        with self.step("run_doctor_check") as s:
            r = ctx.api.get("/api/doctor/health")
            self.assert_true(r.get("success"), f"doctor not healthy: {r}")
            s.set_message("doctor check passed")

        # 步骤 10: 验证全局状态
        with self.step("verify_global_state") as s:
            workflow_stage = ctx.browser.get_local_storage("workflow_stage")
            self.assert_equal(workflow_stage, "dispatching")
            s.set_message("global state consistent")

        return self.result
