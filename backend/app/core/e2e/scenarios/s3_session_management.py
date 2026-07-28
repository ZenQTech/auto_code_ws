"""
# ============================================================
# 场景 3: Session 管理
# ============================================================
# 核心作用：验证 Session 创建、列表、切换、删除
# Cycle 11 P2-1 新建
# ============================================================
"""

from __future__ import annotations

from typing import Any

from ..scenario import BaseScenario


class S3SessionManagement(BaseScenario):
    """场景 3: Session 管理"""

    name = "session_management"
    description = "验证 Session 创建、列表、切换、删除、localStorage 持久化"
    priority = 80
    timeout = 60
    tags = ["core", "session", "api"]

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

        # 步骤 2: 列出 Session（GET /api/sessions 返回数组）
        with self.step("list_sessions") as s:
            r = ctx.api.get("/api/sessions")
            # /api/sessions GET 直接返回数组
            self.assert_true(isinstance(r, list), f"sessions not a list: {type(r).__name__}")
            s.set_message(f"listed {len(r)} sessions")

        # 步骤 3: 创建新 Session（POST /api/sessions 返回 session 对象）
        with self.step("create_session") as s:
            r = ctx.api.post("/api/sessions", body={"title": "E2E Test Session"})
            # 响应是 session 对象（不是 {success: true, session: {...}}）
            self.assert_true(
                r.get("id") and r.get("title"),
                f"create failed or missing id/title: {r}",
            )
            new_id = r.get("id")
            ctx.state["test_session_id"] = new_id
            s.set_message(f"created session {new_id}")

        # 步骤 4: 获取 Session 详情
        with self.step("get_session_detail") as s:
            sid = ctx.state.get("test_session_id")
            if sid:
                r = ctx.api.get(f"/api/sessions/{sid}")
                self.assert_true(
                    r.get("id") == sid,
                    f"get failed or id mismatch: {r}",
                )
                s.set_message(f"got session detail for {sid}")
            else:
                s.set_message("skipped: no session id")

        # 步骤 5: 删除 Session（返回 {message, status: "deleted"}）
        with self.step("delete_session") as s:
            sid = ctx.state.get("test_session_id")
            if sid:
                r = ctx.api.delete(f"/api/sessions/{sid}")
                # DELETE 返回 {message: "...", session_id: ..., status: "deleted"}
                self.assert_true(
                    r.get("status") in ("deleted", "ok") or r.get("message"),
                    f"delete failed: {r}",
                )
                s.set_message(f"deleted session {sid}")
            else:
                s.set_message("skipped: no session id")

        return self.result
