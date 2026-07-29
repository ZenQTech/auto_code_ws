"""
# ============================================================
# 企业级 Plugin Hub - 单元测试
# ============================================================
# 核心作用：覆盖 EnterpriseHub 全部子模块的单元测试
# 覆盖范围：
#   - 数据模型 (10 个测试)
#   - 目录 (10 个测试)
#   - RBAC (8 个测试)
#   - 团队注册 (12 个测试)
#   - 成本控制 (10 个测试)
#   - 审批工作流 (8 个测试)
#   - 审计日志 (8 个测试)
#   - Dashboard (6 个测试)
#   - Manager 集成 (10 个测试)
#   - API 路由 (8 个测试)
# 总计 ≥ 90 个测试用例
# 修改记录：
#   - 2026-07-28 | v6.28.0 | Cycle 14 P0-3 初始版本
# ============================================================
"""

import os
import shutil
import sys
import tempfile
import unittest

# 设置临时存储目录
TMP_DIR = tempfile.mkdtemp(prefix="hermes_eh_test_")
os.environ["HERMES_HUB_DIR"] = TMP_DIR

# 添加 backend 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))


class BaseTestCase(unittest.TestCase):
    """基础测试用例：每个测试前重置单例"""

    def setUp(self) -> None:
        from app.core.enterprise_hub import reset_manager
        reset_manager()

    def tearDown(self) -> None:
        from app.core.enterprise_hub import reset_manager
        reset_manager()


# ============================================================
# 1. 数据模型
# ============================================================

class TestModels(BaseTestCase):
    """数据模型测试"""

    def test_01_organization_defaults(self):
        from app.core.enterprise_hub import Organization
        o = Organization(name="Acme")
        self.assertTrue(o.org_id.startswith("org_"))
        self.assertEqual(o.plan, "free")
        self.assertEqual(o.owner, "")
        self.assertIn("max_members", o.quotas)

    def test_02_organization_to_from_dict(self):
        from app.core.enterprise_hub import Organization
        o = Organization(name="X", owner="a@b.com", plan="enterprise")
        d = o.to_dict()
        o2 = Organization.from_dict(d)
        self.assertEqual(o.name, o2.name)
        self.assertEqual(o.org_id, o2.org_id)

    def test_03_team_defaults(self):
        from app.core.enterprise_hub import Team
        t = Team(name="T", org_id="org_x")
        self.assertTrue(t.team_id.startswith("team_"))
        self.assertEqual(t.budget_usd, 0.0)
        self.assertEqual(t.members, [])

    def test_04_member_defaults(self):
        from app.core.enterprise_hub import Member
        m = Member(email="a@b.com")
        self.assertTrue(m.member_id.startswith("mem_"))
        self.assertEqual(m.role, "developer")
        self.assertEqual(m.status, "active")

    def test_05_plugin_catalog_item(self):
        from app.core.enterprise_hub import PluginCatalogItem
        p = PluginCatalogItem(name="X", vendor="V")
        self.assertEqual(p.license, "MIT")
        self.assertEqual(p.pricing_model, "free")
        self.assertFalse(p.enterprise_ready)

    def test_06_approval_request(self):
        from app.core.enterprise_hub import ApprovalRequest
        a = ApprovalRequest(plugin_id="p", requested_by="u")
        self.assertTrue(a.request_id.startswith("apr_"))
        self.assertEqual(a.status, "pending")

    def test_07_cost_record(self):
        from app.core.enterprise_hub import CostRecord
        c = CostRecord(org_id="o", plugin_id="p", member_id="m", cost_usd=1.5)
        self.assertEqual(c.usage_count, 0)  # default
        self.assertEqual(c.cost_usd, 1.5)

    def test_08_audit_log(self):
        from app.core.enterprise_hub import AuditLog
        a = AuditLog(org_id="o", actor="u", action="x", target="t")
        self.assertEqual(a.severity, "info")
        self.assertEqual(a.metadata, {})

    def test_09_dashboard_snapshot(self):
        from app.core.enterprise_hub import DashboardSnapshot
        d = DashboardSnapshot(org_id="o", period="2026-07")
        self.assertEqual(d.total_installs, 0)
        self.assertEqual(d.productivity_score, 0.0)

    def test_10_storage_dir_env(self):
        from app.core.enterprise_hub import get_storage_dir
        d = get_storage_dir()
        self.assertIsInstance(d, str)
        self.assertGreater(len(d), 0)


# ============================================================
# 2. 目录
# ============================================================

class TestCatalog(BaseTestCase):
    """插件目录测试"""

    def test_01_catalog_size(self):
        from app.core.enterprise_hub import PLUGINS_DATA
        self.assertGreaterEqual(len(PLUGINS_DATA), 90)

    def test_02_categories_size(self):
        from app.core.enterprise_hub import CATEGORIES
        self.assertEqual(len(CATEGORIES), 12)

    def test_03_default_catalog_returns_copy(self):
        from app.core.enterprise_hub import get_default_catalog
        a = get_default_catalog()
        a.clear()
        b = get_default_catalog()
        self.assertGreater(len(b), 0)

    def test_04_get_categories(self):
        from app.core.enterprise_hub import get_categories
        cats = get_categories()
        ids = [c["id"] for c in cats]
        self.assertIn("ai-ml", ids)
        self.assertIn("security", ids)

    def test_05_filter_by_category(self):
        from app.core.enterprise_hub import filter_by_category
        items = filter_by_category("ai-ml")
        self.assertGreater(len(items), 0)
        for p in items:
            self.assertEqual(p.category, "ai-ml")

    def test_06_filter_by_source(self):
        from app.core.enterprise_hub import filter_by_source
        items = filter_by_source("official")
        for p in items:
            self.assertEqual(p.source, "official")

    def test_07_count_by_category(self):
        from app.core.enterprise_hub import count_by_category
        c = count_by_category()
        # 应该返回各类别插件数量之和 = 总插件数 (118)
        self.assertEqual(sum(c.values()), len(PLUGINS_DATA := __import__('app.core.enterprise_hub', fromlist=['PLUGINS_DATA']).PLUGINS_DATA))

    def test_08_search_query(self):
        from app.core.enterprise_hub import search_plugins
        items = search_plugins(query="Snyk")
        self.assertGreater(len(items), 0)
        self.assertEqual(items[0].name, "Snyk")

    def test_09_search_enterprise(self):
        from app.core.enterprise_hub import search_plugins
        items = search_plugins(enterprise_only=True)
        for p in items:
            self.assertTrue(p.enterprise_ready)

    def test_10_catalog_summary(self):
        from app.core.enterprise_hub import catalog_summary
        s = catalog_summary()
        self.assertGreaterEqual(s["total"], 90)
        self.assertEqual(s["categories"], 12)
        self.assertGreater(s["enterprise_ready_count"], 0)


# ============================================================
# 3. RBAC
# ============================================================

class TestRBAC(BaseTestCase):
    """RBAC 权限测试"""

    def test_01_admin_has_all(self):
        from app.core.enterprise_hub import Permission, PERMISSIONS
        admin_perms = Permission.permissions_of("admin")
        # Admin should have all defined permissions
        for p in PERMISSIONS:
            self.assertIn(p, admin_perms)

    def test_02_viewer_minimal(self):
        from app.core.enterprise_hub import Permission
        viewer_perms = Permission.permissions_of("viewer")
        self.assertIn("plugin:read", viewer_perms)
        self.assertNotIn("org:delete", viewer_perms)

    def test_03_has_check(self):
        from app.core.enterprise_hub import Permission
        self.assertTrue(Permission.has("admin", "org:delete"))
        self.assertFalse(Permission.has("viewer", "org:delete"))

    def test_04_require_raises(self):
        from app.core.enterprise_hub import Permission
        with self.assertRaises(PermissionError):
            Permission.require("viewer", "org:delete")

    def test_05_require_ok(self):
        from app.core.enterprise_hub import Permission
        Permission.require("admin", "org:delete")  # 不抛

    def test_06_can_manage_role(self):
        from app.core.enterprise_hub import Permission
        self.assertTrue(Permission.can_manage_role("admin", "developer"))
        self.assertFalse(Permission.can_manage_role("developer", "admin"))
        self.assertFalse(Permission.can_manage_role("admin", "admin"))

    def test_07_any_of(self):
        from app.core.enterprise_hub import Permission
        self.assertTrue(Permission.any_of("admin", ["x:y", "org:delete"]))
        self.assertFalse(Permission.any_of("viewer", ["org:delete", "member:invite"]))

    def test_08_list_roles(self):
        from app.core.enterprise_hub import Permission
        roles = Permission.list_roles()
        self.assertEqual(set(roles), {"admin", "manager", "developer", "viewer"})


# ============================================================
# 4. 团队注册
# ============================================================

class TestTeams(BaseTestCase):
    """团队管理测试"""

    def setUp(self) -> None:
        super().setUp()
        from app.core.enterprise_hub import get_manager
        self.mgr = get_manager()
        self.org = self.mgr.create_org(name="TestCo", owner="alice@test.com", actor="alice@test.com")
        # 邀请 owner 为 admin
        self.alice = self.mgr.invite_member(org_id=self.org.org_id, email="alice@test.com", name="Alice", role="admin", actor="alice@test.com")

    def test_01_create_org(self):
        self.assertTrue(self.org.org_id.startswith("org_"))

    def test_02_invalid_email(self):
        with self.assertRaises(ValueError):
            self.mgr.registry.create_org(name="X", owner="not-email")

    def test_03_create_team(self):
        team = self.mgr.create_team(org_id=self.org.org_id, name="Backend", actor="alice@test.com")
        self.assertTrue(team.team_id.startswith("team_"))

    def test_04_team_quota(self):
        org = self.mgr.get_org(self.org.org_id)
        org.quotas["max_teams"] = 2
        self.mgr.registry._save()
        self.mgr.create_team(org_id=self.org.org_id, name="A", actor="alice@test.com")
        self.mgr.create_team(org_id=self.org.org_id, name="B", actor="alice@test.com")
        with self.assertRaises(ValueError):
            self.mgr.create_team(org_id=self.org.org_id, name="C", actor="alice@test.com")

    def test_05_invite_member(self):
        m = self.mgr.invite_member(org_id=self.org.org_id, email="bob@test.com", actor="alice@test.com", role="developer")
        self.assertTrue(m.member_id.startswith("mem_"))

    def test_06_invite_invalid_email(self):
        with self.assertRaises(ValueError):
            self.mgr.registry.invite_member(org_id=self.org.org_id, email="bad")

    def test_07_member_quota(self):
        org = self.mgr.get_org(self.org.org_id)
        org.quotas["max_members"] = 1
        self.mgr.registry._save()
        with self.assertRaises(ValueError):
            self.mgr.invite_member(org_id=self.org.org_id, email="x@y.com", actor="alice@test.com")

    def test_08_update_role(self):
        # 邀请 alice 为 admin，bob 为 developer
        alice = self.mgr.invite_member(org_id=self.org.org_id, email="alice@test.com", actor="alice@test.com", role="admin")
        m = self.mgr.invite_member(org_id=self.org.org_id, email="bob@test.com", actor="alice@test.com")
        m2 = self.mgr.update_member_role(org_id=self.org.org_id, member_id=m.member_id, new_role="manager", actor=alice.member_id)
        self.assertEqual(m2.role, "manager")

    def test_09_role_permission(self):
        alice = self.mgr.invite_member(org_id=self.org.org_id, email="alice@test.com", actor="alice@test.com", role="admin")
        m = self.mgr.invite_member(org_id=self.org.org_id, email="bob@test.com", actor="alice@test.com", role="developer")
        with self.assertRaises(PermissionError):
            self.mgr.update_member_role(org_id=self.org.org_id, member_id=m.member_id, new_role="admin", actor=m.member_id)

    def test_10_team_add_member(self):
        team = self.mgr.create_team(org_id=self.org.org_id, name="A", actor="alice@test.com")
        m = self.mgr.invite_member(org_id=self.org.org_id, email="bob@test.com", actor="alice@test.com")
        self.mgr.registry.add_team_member(team.team_id, m.member_id)
        team2 = self.mgr.get_team(team.team_id)
        self.assertIn(m.member_id, team2.members)

    def test_11_delete_team(self):
        team = self.mgr.create_team(org_id=self.org.org_id, name="A", actor="alice@test.com")
        ok = self.mgr.registry.delete_team(team.team_id)
        self.assertTrue(ok)
        self.assertIsNone(self.mgr.get_team(team.team_id))

    def test_12_delete_org_cascade(self):
        m = self.mgr.invite_member(org_id=self.org.org_id, email="bob@test.com", actor="alice@test.com")
        ok = self.mgr.registry.delete_org(self.org.org_id)
        self.assertTrue(ok)
        self.assertIsNone(self.mgr.get_org(self.org.org_id))
        self.assertIsNone(self.mgr.get_member(m.member_id))


# ============================================================
# 5. 成本控制
# ============================================================

class TestCostControl(BaseTestCase):
    """成本控制测试"""

    def setUp(self) -> None:
        super().setUp()
        from app.core.enterprise_hub import get_manager
        self.mgr = get_manager()
        self.org = self.mgr.create_org(name="X", owner="a@b.com", actor="a@b.com")
        self.mgr.invite_member(org_id=self.org.org_id, email="a@b.com", role="admin", actor="a@b.com")
        self.mgr.invite_member(org_id=self.org.org_id, email="b@b.com", role="developer", actor="a@b.com")
        self.admin = self.mgr.registry.list_members(self.org.org_id)[0]
        self.dev = self.mgr.registry.list_members(self.org.org_id)[1]

    def test_01_record_usage(self):
        from app.core.enterprise_hub.cost_control import _current_period
        rec = self.mgr.record_cost(
            org_id=self.org.org_id, plugin_id="p1", member_id=self.dev.member_id,
            cost_usd=1.0, actor=self.admin.member_id,
        )
        self.assertEqual(rec.cost_usd, 1.0)
        self.assertEqual(rec.period, _current_period())

    def test_02_set_budget(self):
        self.mgr.set_budget(self.org.org_id, "2026-07", 50.0, actor=self.admin.member_id)
        b = self.mgr.cost.get_budget(self.org.org_id, "2026-07")
        self.assertEqual(b, 50.0)

    def test_03_cost_summary(self):
        self.mgr.record_cost(org_id=self.org.org_id, plugin_id="p1", member_id=self.dev.member_id, cost_usd=5.0, actor=self.admin.member_id)
        s = self.mgr.cost_summary(self.org.org_id)
        self.assertEqual(s["total_usd"], 5.0)
        self.assertIn("period", s)

    def test_04_cost_breakdown(self):
        for i in range(3):
            self.mgr.record_cost(org_id=self.org.org_id, plugin_id="p1", member_id=self.dev.member_id, cost_usd=1.0, actor=self.admin.member_id)
        b = self.mgr.cost_breakdown(self.org.org_id)
        self.assertIn("by_plugin", b)
        self.assertIn("by_member", b)
        self.assertEqual(b["by_plugin"]["p1"], 3.0)

    def test_05_budget_alert(self):
        # 设置低预算
        self.mgr.set_budget(self.org.org_id, "2026-07", 1.0, actor=self.admin.member_id)
        self.mgr.record_cost(org_id=self.org.org_id, plugin_id="p1", member_id=self.dev.member_id, cost_usd=5.0, actor=self.admin.member_id)
        alerts = self.mgr.list_alerts(self.org.org_id)
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]["severity"], "error")  # 5 > 1*1.2

    def test_06_default_budget(self):
        b = self.mgr.cost.get_budget(self.org.org_id, "2026-07")
        self.assertEqual(b, 100.0)  # default org.quotas

    def test_07_period_total(self):
        self.mgr.record_cost(org_id=self.org.org_id, plugin_id="p1", member_id=self.dev.member_id, cost_usd=2.0, actor=self.admin.member_id, period="2026-06")
        self.mgr.record_cost(org_id=self.org.org_id, plugin_id="p1", member_id=self.dev.member_id, cost_usd=3.0, actor=self.admin.member_id, period="2026-07")
        self.assertEqual(self.mgr.cost._period_total(self.org.org_id, "2026-06"), 2.0)
        self.assertEqual(self.mgr.cost._period_total(self.org.org_id, "2026-07"), 3.0)

    def test_08_list_records(self):
        for i in range(5):
            self.mgr.record_cost(org_id=self.org.org_id, plugin_id="p1", member_id=self.dev.member_id, cost_usd=1.0, actor=self.admin.member_id)
        recs = self.mgr.cost.list_records(self.org.org_id, limit=10)
        self.assertEqual(len(recs), 5)

    def test_09_record_permission(self):
        with self.assertRaises(PermissionError):
            self.mgr.record_cost(org_id=self.org.org_id, plugin_id="p1", member_id=self.dev.member_id, cost_usd=1.0, actor=self.dev.member_id)

    def test_10_budget_permission(self):
        with self.assertRaises(PermissionError):
            self.mgr.set_budget(self.org.org_id, "2026-07", 50.0, actor=self.dev.member_id)


# ============================================================
# 6. 审批工作流
# ============================================================

class TestApprovals(BaseTestCase):
    """审批工作流测试"""

    def setUp(self) -> None:
        super().setUp()
        from app.core.enterprise_hub import get_manager
        self.mgr = get_manager()
        self.org = self.mgr.create_org(name="X", owner="a@b.com", actor="a@b.com")
        self.admin = self.mgr.invite_member(org_id=self.org.org_id, email="a@b.com", role="admin", actor="a@b.com")
        self.dev = self.mgr.invite_member(org_id=self.org.org_id, email="b@b.com", role="developer", actor="a@b.com")
        # 重置审批工作流的状态（避免跨测试污染）
        self.mgr.approvals._requests.clear()
        try:
            if os.path.exists(self.mgr.approvals._path()):
                os.remove(self.mgr.approvals._path())
        except Exception:
            pass

    def test_01_create_request(self):
        req = self.mgr.create_approval(self.org.org_id, "p1", self.dev.member_id, "need it")
        self.assertEqual(req.status, "pending")
        self.assertEqual(req.requested_by, self.dev.member_id)

    def test_02_approve(self):
        req = self.mgr.create_approval(self.org.org_id, "p1", self.dev.member_id, "need it")
        r = self.mgr.approve_request(self.org.org_id, req.request_id, self.admin.member_id, "ok")
        self.assertEqual(r.status, "approved")
        self.assertEqual(r.reviewed_by, self.admin.member_id)

    def test_03_reject(self):
        req = self.mgr.create_approval(self.org.org_id, "p1", self.dev.member_id, "need it")
        r = self.mgr.reject_request(self.org.org_id, req.request_id, self.admin.member_id, "no")
        self.assertEqual(r.status, "rejected")

    def test_04_cancel(self):
        req = self.mgr.create_approval(self.org.org_id, "p1", self.dev.member_id, "x")
        r = self.mgr.approvals.cancel(req.request_id)
        self.assertEqual(r.status, "cancelled")

    def test_05_double_approve(self):
        req = self.mgr.create_approval(self.org.org_id, "p1", self.dev.member_id, "x")
        self.mgr.approve_request(self.org.org_id, req.request_id, self.admin.member_id)
        r2 = self.mgr.approve_request(self.org.org_id, req.request_id, self.admin.member_id)
        # Already approved; should return without error
        self.assertEqual(r2.status, "approved")

    def test_06_list_filter(self):
        for i in range(3):
            self.mgr.create_approval(self.org.org_id, f"p{i}", self.dev.member_id, "x")
        items = self.mgr.list_approvals(status="pending")
        self.assertEqual(len(items), 3)

    def test_07_stats(self):
        for i in range(2):
            r = self.mgr.create_approval(self.org.org_id, f"p{i}", self.dev.member_id, "x")
            self.mgr.approve_request(self.org.org_id, r.request_id, self.admin.member_id)
        stats = self.mgr.approvals.stats()
        self.assertEqual(stats["total"], 2)
        self.assertEqual(stats["approved"], 2)
        self.assertEqual(stats["pending"], 0)

    def test_08_create_permission(self):
        # developer 角色有 approval:create 权限（开发人员可以申请）
        from app.core.enterprise_hub import Permission
        self.assertTrue(Permission.has("developer", "approval:create"))
        # viewer 角色没有 approval:create 权限
        viewer = self.mgr.invite_member(org_id=self.org.org_id, email="c@b.com", role="viewer", actor=self.admin.member_id)
        with self.assertRaises(PermissionError):
            self.mgr.create_approval(self.org.org_id, "p1", viewer.member_id, "x")


# ============================================================
# 7. 审计日志
# ============================================================

class TestAudit(BaseTestCase):
    """审计日志测试"""

    def setUp(self) -> None:
        super().setUp()
        from app.core.enterprise_hub import get_manager
        self.mgr = get_manager()
        self.org = self.mgr.create_org(name="X", owner="a@b.com", actor="a@b.com")

    def test_01_log(self):
        log = self.mgr.audit.log(self.org.org_id, "u1", "test_action", "t1", severity="info")
        self.assertTrue(log.log_id.startswith("aud_"))

    def test_02_log_security_event(self):
        log = self.mgr.audit.log_security_event(self.org.org_id, "u1", "brute_force", "t1")
        self.assertEqual(log.severity, "error")
        self.assertEqual(log.action, "security_event")
        self.assertEqual(log.metadata["event"], "brute_force")

    def test_03_query_by_actor(self):
        self.mgr.audit.log(self.org.org_id, "u1", "a", "t")
        self.mgr.audit.log(self.org.org_id, "u2", "a", "t")
        results = self.mgr.audit.query(org_id=self.org.org_id, actor="u1")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].actor, "u1")

    def test_04_query_by_severity(self):
        self.mgr.audit.log(self.org.org_id, "u1", "a", "t", severity="info")
        self.mgr.audit.log_security_event(self.org.org_id, "u1", "x", "t")
        results = self.mgr.audit.query(org_id=self.org.org_id, severity="error")
        self.assertGreaterEqual(len(results), 1)

    def test_05_query_by_action(self):
        self.mgr.audit.log(self.org.org_id, "u1", "act1", "t")
        self.mgr.audit.log(self.org.org_id, "u1", "act2", "t")
        results = self.mgr.audit.query(org_id=self.org.org_id, action="act1")
        self.assertEqual(len(results), 1)

    def test_06_export_jsonl(self):
        self.mgr.audit.log(self.org.org_id, "u1", "a", "t")
        content = self.mgr.audit.export(org_id=self.org.org_id, format="jsonl")
        # Should contain JSON-encoded logs
        self.assertIn("log_id", content)
        self.assertIn("aud_", content)

    def test_07_export_json(self):
        self.mgr.audit.log(self.org.org_id, "u1", "a", "t")
        content = self.mgr.audit.export(org_id=self.org.org_id, format="json")
        import json
        data = json.loads(content)
        self.assertIsInstance(data, list)

    def test_08_stats(self):
        self.mgr.audit.log(self.org.org_id, "u1", "act1", "t", severity="info")
        self.mgr.audit.log_security_event(self.org.org_id, "u1", "x", "t")
        s = self.mgr.audit.stats(org_id=self.org.org_id)
        self.assertIn("by_severity", s)
        self.assertIn("by_action", s)


# ============================================================
# 8. Dashboard
# ============================================================

class TestDashboard(BaseTestCase):
    """Dashboard 测试"""

    def setUp(self) -> None:
        super().setUp()
        from app.core.enterprise_hub import get_manager
        self.mgr = get_manager()
        self.org = self.mgr.create_org(name="X", owner="a@b.com", actor="a@b.com")
        self.mgr.invite_member(org_id=self.org.org_id, email="a@b.com", role="admin", actor="a@b.com")
        self.mgr.invite_member(org_id=self.org.org_id, email="b@b.com", role="developer", actor="a@b.com")
        self.admin = self.mgr.registry.list_members(self.org.org_id)[0]
        self.dev = self.mgr.registry.list_members(self.org.org_id)[1]

    def test_01_snapshot(self):
        snap = self.mgr.dashboard_snapshot(self.org.org_id)
        self.assertEqual(snap.org_id, self.org.org_id)
        self.assertEqual(snap.active_plugins, 0)

    def test_02_snapshot_with_installs(self):
        for p in ["plugin_ai-ml_code-generator", "plugin_security_snyk"]:
            self.mgr.install_plugin(self.org.org_id, p, self.dev.member_id, cost_usd=1.0)
        snap = self.mgr.dashboard_snapshot(self.org.org_id)
        self.assertEqual(snap.active_plugins, 2)
        self.assertEqual(snap.total_installs, 2)

    def test_03_top_plugins(self):
        for p in ["plugin_ai-ml_code-generator", "plugin_ai-ml_code-generator", "plugin_security_snyk"]:
            self.mgr.install_plugin(self.org.org_id, p, self.dev.member_id, cost_usd=1.0)
        top = self.mgr.top_plugins(self.org.org_id, limit=5)
        self.assertGreater(len(top), 0)
        self.assertEqual(top[0]["plugin_id"], "plugin_ai-ml_code-generator")

    def test_04_productivity_zero(self):
        p = self.mgr.productivity(self.org.org_id)
        self.assertEqual(p["score"], 0.0)

    def test_05_productivity_score(self):
        # Touch active on dev
        self.mgr.registry.touch_active(self.dev.member_id)
        p = self.mgr.productivity(self.org.org_id)
        self.assertGreater(p["score"], 0.0)
        self.assertEqual(p["active_users"], 1)

    def test_06_dashboard_not_found(self):
        with self.assertRaises(ValueError):
            self.mgr.dashboard_snapshot("org_nonexistent")


# ============================================================
# 9. Manager 集成
# ============================================================

class TestManager(BaseTestCase):
    """Manager 集成测试"""

    def test_01_health(self):
        from app.core.enterprise_hub import get_manager
        mgr = get_manager()
        h = mgr.health()
        self.assertEqual(h["status"], "ok")
        self.assertEqual(h["version"], "v6.28.0")

    def test_02_catalog_list(self):
        from app.core.enterprise_hub import get_manager
        mgr = get_manager()
        items = mgr.list_catalog()
        self.assertGreater(len(items), 90)

    def test_03_catalog_search(self):
        from app.core.enterprise_hub import get_manager
        mgr = get_manager()
        items = mgr.list_catalog(query="Snyk")
        self.assertGreater(len(items), 0)

    def test_04_catalog_featured(self):
        from app.core.enterprise_hub import get_manager
        mgr = get_manager()
        items = mgr.featured_plugins(limit=5)
        self.assertEqual(len(items), 5)
        for p in items:
            self.assertTrue(p.enterprise_ready)

    def test_05_full_workflow(self):
        from app.core.enterprise_hub import get_manager
        mgr = get_manager()
        # org
        org = mgr.create_org(name="Acme", owner="ceo@acme.com", plan="enterprise", actor="ceo@acme.com")
        # members
        admin = mgr.invite_member(org_id=org.org_id, email="ceo@acme.com", name="CEO", role="admin", actor="ceo@acme.com")
        dev = mgr.invite_member(org_id=org.org_id, email="dev@acme.com", name="Dev", role="developer", actor="ceo@acme.com")
        # team
        team = mgr.create_team(org_id=org.org_id, name="Platform", actor="ceo@acme.com", budget_usd=1000.0)
        # install
        result = mgr.install_plugin(org_id=org.org_id, plugin_id="plugin_ai-ml_code-generator", member_id=dev.member_id, cost_usd=2.0)
        self.assertTrue(result["ok"])
        # approval
        appr = mgr.create_approval(org_id=org.org_id, plugin_id="plugin_security_snyk", requested_by=dev.member_id, reason="security")
        self.mgr_test_local = mgr  # avoid lint
        appr2 = mgr.approve_request(org_id=org.org_id, request_id=appr.request_id, reviewer=admin.member_id)
        self.assertEqual(appr2.status, "approved")
        # dashboard
        snap = mgr.dashboard_snapshot(org_id=org.org_id)
        self.assertEqual(snap.total_installs, 1)

    def test_06_install_quota(self):
        from app.core.enterprise_hub import get_manager
        mgr = get_manager()
        org = mgr.create_org(name="Q", owner="a@b.com", actor="a@b.com")
        mgr.invite_member(org_id=org.org_id, email="a@b.com", role="admin", actor="a@b.com")
        mgr.invite_member(org_id=org.org_id, email="b@b.com", role="developer", actor="a@b.com")
        admin = mgr.registry.list_members(org_id=org.org_id)[0]
        dev = mgr.registry.list_members(org_id=org.org_id)[1]
        org.quotas["max_plugin_installs"] = 1
        mgr.registry._save()
        mgr.install_plugin(org_id=org.org_id, plugin_id="plugin_ai-ml_code-generator", member_id=dev.member_id)
        with self.assertRaises(ValueError):
            mgr.install_plugin(org_id=org.org_id, plugin_id="plugin_security_snyk", member_id=dev.member_id)

    def test_07_uninstall(self):
        from app.core.enterprise_hub import get_manager
        mgr = get_manager()
        org = mgr.create_org(name="X", owner="a@b.com", actor="a@b.com")
        mgr.invite_member(org_id=org.org_id, email="a@b.com", role="admin", actor="a@b.com")
        mgr.invite_member(org_id=org.org_id, email="b@b.com", role="developer", actor="a@b.com")
        dev = mgr.registry.list_members(org_id=org.org_id)[1]
        r = mgr.uninstall_plugin(org_id=org.org_id, plugin_id="p1", member_id=dev.member_id)
        self.assertTrue(r["ok"])

    def test_08_security_event(self):
        from app.core.enterprise_hub import get_manager
        mgr = get_manager()
        org = mgr.create_org(name="X", owner="a@b.com", actor="a@b.com")
        log = mgr.log_security_event(org_id=org.org_id, actor="hacker", event="unauthorized_access", target="/admin")
        self.assertEqual(log.severity, "error")

    def test_09_get_permissions(self):
        from app.core.enterprise_hub import get_manager
        mgr = get_manager()
        org = mgr.create_org(name="X", owner="a@b.com", actor="a@b.com")
        mgr.invite_member(org_id=org.org_id, email="a@b.com", role="admin", actor="a@b.com")
        mgr.invite_member(org_id=org.org_id, email="b@b.com", role="developer", actor="a@b.com")
        perms = mgr.get_permissions(org_id=org.org_id, actor="b@b.com")
        self.assertEqual(perms["role"], "developer")
        self.assertIn("plugin:read", perms["permissions"])

    def test_10_singleton(self):
        from app.core.enterprise_hub import get_manager
        m1 = get_manager()
        m2 = get_manager()
        self.assertIs(m1, m2)


# ============================================================
# 10. API 路由
# ============================================================

class TestAPI(BaseTestCase):
    """API 路由测试（TestClient）"""

    def setUp(self) -> None:
        super().setUp()
        from fastapi.testclient import TestClient
        from app.main import app
        self.client = TestClient(app)
        self.base = "/api/enterprise-hub"

    def test_01_health(self):
        r = self.client.get(f"{self.base}/health")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["status"], "ok")

    def test_02_stats(self):
        r = self.client.get(f"{self.base}/stats")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("catalog", data)

    def test_03_catalog(self):
        r = self.client.get(f"{self.base}/catalog")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertGreater(data["total"], 90)

    def test_04_catalog_featured(self):
        r = self.client.get(f"{self.base}/catalog/featured?limit=5")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertLessEqual(data["total"], 5)

    def test_05_categories(self):
        r = self.client.get(f"{self.base}/categories")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(len(data["items"]), 12)

    def test_06_get_plugin_404(self):
        r = self.client.get(f"{self.base}/catalog/plugin_nonexistent")
        self.assertEqual(r.status_code, 404)

    def test_07_create_org(self):
        r = self.client.post(
            f"{self.base}/orgs",
            json={"name": "Test", "owner": "x@y.com", "actor": "x@y.com"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertEqual(data["name"], "Test")
        self.assertIn("org_id", data)

    def test_08_full_workflow_api(self):
        # org
        r = self.client.post(f"{self.base}/orgs", json={"name": "API", "owner": "ceo@api.com", "actor": "ceo@api.com"})
        self.assertEqual(r.status_code, 200, r.text)
        org_id = r.json()["org_id"]
        # team
        r = self.client.post(
            f"{self.base}/orgs/{org_id}/teams",
            json={"name": "Eng", "actor": "ceo@api.com"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        # install
        r = self.client.post(
            f"{self.base}/install",
            json={"org_id": org_id, "plugin_id": "plugin_ai-ml_code-generator", "member_id": "ceo@api.com", "cost_usd": 1.0},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()["ok"])


# ============================================================
# Cleanup
# ============================================================

def tearDownModule():
    shutil.rmtree(TMP_DIR, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
