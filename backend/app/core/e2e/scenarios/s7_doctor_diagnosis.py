"""
# ============================================================
# 场景 7: Doctor 诊断
# ============================================================
# 核心作用：验证 /doctor 访问、6 大类诊断、修复建议、历史报告
# Cycle 11 P2-1 新建
# ============================================================
"""

from __future__ import annotations

from typing import Any

from ..scenario import BaseScenario


class S7DoctorDiagnosis(BaseScenario):
    """场景 7: Doctor 诊断"""

    name = "doctor_diagnosis"
    description = "验证 Doctor 环境诊断：6 大类、修复建议、历史报告"
    priority = 40
    timeout = 60
    tags = ["core", "doctor", "diagnostics"]

    def run(self, ctx) -> Any:
        """执行场景"""
        # 步骤 1: 验证 Doctor 健康
        with self.step("doctor_health") as s:
            r = ctx.api.get("/api/doctor/health")
            self.assert_true(r.get("success"), f"doctor not healthy: {r}")
            cats = r.get("categories", [])
            self.assert_equal(len(cats), 6, f"expected 6 categories, got {len(cats)}")
            s.set_message(f"doctor healthy, {len(cats)} categories")

        # 步骤 2: 列出所有分类
        with self.step("list_categories") as s:
            r = ctx.api.get("/api/doctor/categories")
            self.assert_true(r.get("success"), f"list failed: {r}")
            categories = r.get("categories", [])
            self.assert_equal(r.get("count"), 6)
            expected = {"environment", "workspace", "llm", "database", "mcp", "dependencies"}
            actual = {c["name"] for c in categories}
            self.assert_equal(actual, expected, f"category mismatch")
            s.set_message(f"all 6 categories present")

        # 步骤 3: 运行单个分类诊断
        with self.step("run_environment_check") as s:
            r = ctx.api.get("/api/doctor/environment")
            self.assert_true(r.get("success"), f"env check failed: {r}")
            cat = r.get("category", {})
            self.assert_true(cat.get("total_checks", 0) > 0, "no checks")
            s.set_message(f"environment: {cat.get('total_checks')} checks, status={cat.get('overall_status')}")

        # 步骤 4: 完整诊断（可能耗时较长，单独超时）
        with self.step("run_full_diagnosis") as s:
            # 单次大超时（90s）
            original_timeout = ctx.api.timeout
            ctx.api.timeout = 90
            try:
                r = ctx.api.get("/api/doctor/run?save_history=true")
                self.assert_true(r.get("success"), f"full diagnosis failed: {r}")
                report = r.get("report", {})
                self.assert_true(report.get("report_id"), "no report id")
                ctx.state["doctor_report_id"] = report["report_id"]
                s.set_message(f"full diagnosis done: {report.get('summary')}")
            finally:
                ctx.api.timeout = original_timeout

        # 步骤 5: 获取修复建议
        with self.step("get_fix_suggestion") as s:
            r = ctx.api.get("/api/doctor/fix/environment.anthropic_api_key")
            self.assert_true(r.get("success"), f"fix lookup failed: {r}")
            fix = r.get("fix", {})
            self.assert_true(fix.get("title"), "no fix title")
            self.assert_true(len(fix.get("steps", [])) > 0, "no fix steps")
            s.set_message(f"fix: {fix.get('title')[:30]}")

        # 步骤 6: 查看历史报告
        with self.step("view_history") as s:
            r = ctx.api.get("/api/doctor/history")
            self.assert_true(r.get("success"), f"history failed: {r}")
            reports = r.get("reports", [])
            self.assert_true(r.get("count", 0) > 0, "no history")
            s.set_message(f"history: {r.get('count')} reports")

        # 步骤 7: 列出所有修复
        with self.step("list_all_fixes") as s:
            r = ctx.api.get("/api/doctor/fixes/all/list")
            self.assert_true(r.get("success"), f"all fixes failed: {r}")
            total = r.get("total", 0)
            self.assert_true(total >= 40, f"expected ≥40 fixes, got {total}")
            s.set_message(f"total fixes: {total}")

        return self.result
