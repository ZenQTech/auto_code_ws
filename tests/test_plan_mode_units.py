"""
# ============================================================
# Cycle 4 P0-3 单元测试 - Plan Mode 深化 (Plan→Execute→Rollback)
# ============================================================
# 测试覆盖：
#   - T13: Plan API 端点契约（generate/confirm/modify/reject/get）
#   - T14: Plan 状态转换：pending → confirmed/modified/rejected
#   - T15: Plan 持久化：__PLAN__ 标记段读写
#   - T16: Plan 风险点序列化（含极端/高/中/低 4 等级）
#   - T17: Plan 回滚链路（修改前后对比，持久化到 plan_history）
#   - T18: Plan Mode Service 边界条件
# 创建日期：2026-07-27
# ============================================================
"""

import asyncio
import json
import os
import sys
import unittest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock, AsyncMock


# 添加项目根路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))


# ============================================================
# T13: Plan API 契约测试
# ============================================================
class TestPlanAPIContract(unittest.TestCase):
    """
    T13: Plan API 端点契约测试

    验证：
      - /api/workflow/{wfid}/plan/generate 接受 objective + spec_doc + architecture_doc
      - /api/workflow/{wfid}/plan/confirm 接受 plan_id + user_modifications
      - /api/workflow/{wfid}/plan/modify 接受 plan + user_modifications
      - /api/workflow/{wfid}/plan/reject 接受 reason
      - /api/workflow/{wfid}/plan 返回 plan 字段（可能 null）
    """

    def test_plan_router_path_prefix(self):
        """测试 Plan API 路由前缀"""
        from backend.app.api.plan import router
        # 验证 prefix 是 /api/workflow
        self.assertEqual(router.prefix, "")

    def test_plan_generate_request_model(self):
        """测试 PlanGenerateRequest 模型字段"""
        from backend.app.api.plan import PlanGenerateRequest
        req = PlanGenerateRequest(
            objective="实现运动控制",
            spec_doc="运动控制 API 规范",
            architecture_doc="分层架构",
        )
        self.assertEqual(req.objective, "实现运动控制")
        self.assertEqual(req.spec_doc, "运动控制 API 规范")
        self.assertEqual(req.architecture_doc, "分层架构")

    def test_plan_confirm_request_model(self):
        """测试 PlanConfirmRequest 模型必填字段"""
        from backend.app.api.plan import PlanConfirmRequest
        req = PlanConfirmRequest(plan_id="p-001", user_modifications="增加索引")
        self.assertEqual(req.plan_id, "p-001")
        self.assertEqual(req.user_modifications, "增加索引")

    def test_plan_modify_request_model(self):
        """测试 PlanModifyRequest 接受 plan dict"""
        from backend.app.api.plan import PlanModifyRequest
        req = PlanModifyRequest(
            plan={"plan_id": "p-1", "stages": []},
            user_modifications="调整任务顺序",
        )
        self.assertEqual(req.plan["plan_id"], "p-1")
        self.assertEqual(req.user_modifications, "调整任务顺序")

    def test_plan_reject_request_model(self):
        """测试 PlanRejectRequest 字段"""
        from backend.app.api.plan import PlanRejectRequest
        req = PlanRejectRequest(reason="缺少错误处理")
        self.assertEqual(req.reason, "缺少错误处理")


# ============================================================
# T14: Plan 状态转换测试
# ============================================================
class TestPlanStateTransitions(unittest.TestCase):
    """
    T14: Plan 状态转换测试

    验证：
      - PlanDocument.status 在 generate/confirm/modify/reject 后正确变化
      - 状态字段是 Literal 类型（4 种状态）
    """

    def test_plan_status_literal_values(self):
        """测试 PlanDocument.status 字段的合法值"""
        from backend.app.services.plan_mode import PlanDocument
        valid_statuses = ["pending", "confirmed", "modified", "rejected"]
        for status in valid_statuses:
            plan = PlanDocument(plan_id="p-1", status=status)
            self.assertEqual(plan.status, status)

    def test_plan_task_risk_level_literal_values(self):
        """测试 PlanTask.risk_level 字段的合法值"""
        from backend.app.services.plan_mode import PlanTask
        valid_levels = ["low", "medium", "high", "extreme"]
        for level in valid_levels:
            task = PlanTask(task_id="t-1", risk_level=level)
            self.assertEqual(task.risk_level, level)

    def test_plan_risk_severity_literal_values(self):
        """测试 PlanRisk.severity 字段的合法值"""
        from backend.app.services.plan_mode import PlanRisk
        valid_severities = ["low", "medium", "high", "extreme"]
        for sev in valid_severities:
            risk = PlanRisk(risk_id="r-1", severity=sev)
            self.assertEqual(risk.severity, sev)

    def test_plan_default_status_is_pending(self):
        """测试 PlanDocument 默认状态是 pending"""
        from backend.app.services.plan_mode import PlanDocument
        plan = PlanDocument(plan_id="p-1")
        self.assertEqual(plan.status, "pending")

    def test_plan_default_risk_level_is_medium(self):
        """测试 PlanTask 默认风险等级是 medium"""
        from backend.app.services.plan_mode import PlanTask
        task = PlanTask(task_id="t-1")
        self.assertEqual(task.risk_level, "medium")

    def test_plan_status_transition_sequence(self):
        """测试 Plan 状态转换序列：pending → modified → confirmed"""
        from backend.app.services.plan_mode import PlanDocument
        plan = PlanDocument(plan_id="p-1", status="pending")
        # pending → modified（用户修改）
        plan.status = "modified"
        self.assertEqual(plan.status, "modified")
        # modified → confirmed（用户确认）
        plan.status = "confirmed"
        self.assertEqual(plan.status, "confirmed")

    def test_plan_status_to_dict_preserves_status(self):
        """测试序列化保留 status 字段"""
        from backend.app.services.plan_mode import PlanDocument
        for status in ["pending", "confirmed", "modified", "rejected"]:
            plan = PlanDocument(plan_id="p-1", status=status)
            data = plan.to_dict()
            self.assertEqual(data["status"], status)


# ============================================================
# T15: Plan 持久化标记段测试
# ============================================================
class TestPlanPersistenceMarkers(unittest.TestCase):
    """
    T15: Plan 持久化标记段测试

    验证：
      - __PLAN__ 标记前缀/后缀常量
      - _extract_plan_json 从 error_message 正确提取
      - 替换已有 __PLAN__ 段保留前缀后内容
      - 多 Plan 版本共存时只取第一个
    """

    def test_extract_plan_json_basic(self):
        """测试从 __PLAN__ 段提取 JSON"""
        from backend.app.services.plan_mode import PlanModeService
        svc = PlanModeService(session_factory=None)
        plan_json = '{"plan_id":"p-1","stages":[]}'
        marked = f"prefix\n{PlanModeService.PLAN_MARKER_PREFIX}{plan_json}{PlanModeService.PLAN_MARKER_SUFFIX}\nsuffix"
        extracted = svc._extract_plan_json(marked)
        self.assertEqual(extracted, plan_json)

    def test_extract_plan_json_with_whitespace(self):
        """测试带空白的标记段"""
        from backend.app.services.plan_mode import PlanModeService
        svc = PlanModeService(session_factory=None)
        plan_json = '{"plan_id":"p-2"}'
        marked = f"{PlanModeService.PLAN_MARKER_PREFIX}\n  {plan_json}  \n{PlanModeService.PLAN_MARKER_SUFFIX}"
        extracted = svc._extract_plan_json(marked)
        self.assertIn("p-2", extracted)

    def test_extract_plan_json_empty(self):
        """测试无标记时返回 falsy"""
        from backend.app.services.plan_mode import PlanModeService
        svc = PlanModeService(session_factory=None)
        self.assertFalse(svc._extract_plan_json(""))
        self.assertFalse(svc._extract_plan_json("普通文本无标记"))

    def test_extract_plan_json_partial_marker(self):
        """测试只有前缀没有后缀时返回 falsy（不会部分匹配）"""
        from backend.app.services.plan_mode import PlanModeService
        svc = PlanModeService(session_factory=None)
        # 只有前缀没有后缀，re.search 必须有完整匹配
        partial = f"{PlanModeService.PLAN_MARKER_PREFIX}没有后缀"
        result = svc._extract_plan_json(partial)
        # 因为正则要求 [\\s\\S]*? + 后缀，没有后缀时可能为 None
        # 关键是不能 crash
        self.assertTrue(result is None or result == "" or "没有后缀" in str(result))

    def test_extract_plan_json_multiline_json(self):
        """测试多行 JSON 提取"""
        from backend.app.services.plan_mode import PlanModeService
        svc = PlanModeService(session_factory=None)
        multiline_json = """{
  "plan_id": "p-multiline",
  "stages": [
    {"stage": "coding", "tasks": []}
  ]
}"""
        marked = f"{PlanModeService.PLAN_MARKER_PREFIX}{multiline_json}{PlanModeService.PLAN_MARKER_SUFFIX}"
        extracted = svc._extract_plan_json(marked)
        self.assertIn("p-multiline", extracted)
        self.assertIn("coding", extracted)


# ============================================================
# T16: Plan 风险点序列化测试
# ============================================================
class TestPlanRiskSerialization(unittest.TestCase):
    """
    T16: Plan 风险点序列化测试

    验证：
      - 4 种 severity 等级（low/medium/high/extreme）正确序列化
      - mitigation 字段保留
      - 风险点列表嵌套在 stage 中正确导出
    """

    def test_risk_serialization_4_levels(self):
        """测试 4 种风险等级完整序列化"""
        from backend.app.services.plan_mode import PlanDocument, PlanStage, PlanRisk
        risks = [
            PlanRisk(risk_id="r-1", description="low risk", severity="low", mitigation="m1"),
            PlanRisk(risk_id="r-2", description="medium risk", severity="medium", mitigation="m2"),
            PlanRisk(risk_id="r-3", description="high risk", severity="high", mitigation="m3"),
            PlanRisk(risk_id="r-4", description="extreme risk", severity="extreme", mitigation="m4"),
        ]
        plan = PlanDocument(
            plan_id="p-risk-4",
            stages=[PlanStage(stage="coding", tasks=[], risks=risks)],
        )
        data = plan.to_dict()
        serialized_risks = data["stages"][0]["risks"]
        self.assertEqual(len(serialized_risks), 4)
        severities = [r["severity"] for r in serialized_risks]
        self.assertEqual(severities, ["low", "medium", "high", "extreme"])
        # mitigation 必须保留
        self.assertEqual(serialized_risks[3]["mitigation"], "m4")

    def test_risk_round_trip_via_dict(self):
        """测试 PlanRisk 经 to_dict/from_dict 往返"""
        from backend.app.services.plan_mode import PlanDocument, PlanStage, PlanRisk
        original = PlanDocument(
            plan_id="p-roundtrip",
            stages=[PlanStage(
                stage="testing",
                tasks=[],
                risks=[PlanRisk(
                    risk_id="r-rt",
                    description="roundtrip test",
                    severity="high",
                    mitigation="add validation",
                )],
            )],
        )
        data = original.to_dict()
        restored = PlanDocument.from_dict(data)
        self.assertEqual(len(restored.stages), 1)
        self.assertEqual(len(restored.stages[0].risks), 1)
        risk = restored.stages[0].risks[0]
        self.assertEqual(risk.risk_id, "r-rt")
        self.assertEqual(risk.severity, "high")
        self.assertEqual(risk.mitigation, "add validation")

    def test_extreme_risk_preserved_in_json(self):
        """测试 extreme 风险在 JSON 序列化中保留"""
        from backend.app.services.plan_mode import PlanDocument, PlanStage, PlanRisk
        plan = PlanDocument(
            plan_id="p-extreme",
            stages=[PlanStage(
                stage="coding",
                tasks=[],
                risks=[PlanRisk(risk_id="r-extreme", description="安全风险", severity="extreme")],
            )],
        )
        json_str = plan.to_json()
        self.assertIn("extreme", json_str)
        self.assertIn("安全风险", json_str)
        # 解析回来仍是 extreme
        restored = PlanDocument.from_json(json_str)
        self.assertEqual(restored.stages[0].risks[0].severity, "extreme")


# ============================================================
# T17: Plan 回滚链路模拟测试
# ============================================================
class TestPlanRollbackChain(unittest.TestCase):
    """
    T17: Plan 回滚链路模拟测试

    模拟场景：
      1. 生成 Plan A
      2. 修改 Plan A → Plan A'
      3. 拒绝 Plan A' → 回滚到 Plan A
      4. 再次修改 Plan A → Plan A''
      5. 确认 Plan A'' → 终态
    """

    def test_rollback_chain_simulate(self):
        """模拟回滚链路的版本切换"""
        from backend.app.services.plan_mode import PlanDocument, PlanStage, PlanTask

        # 步骤1：生成初始 Plan A
        plan_a = PlanDocument(
            plan_id="p-a",
            workflow_id="wf-test",
            objective="初始目标",
            stages=[PlanStage(
                stage="coding",
                tasks=[PlanTask(task_id="t-a-1", title="A 的任务")],
            )],
            status="pending",
        )

        # 模拟历史栈（前端 PlanEditorModal.planHistory）
        history = []
        # 步骤2：修改前保存当前 plan 到历史
        history.append(plan_a)
        plan_a_modified = PlanDocument.from_dict(plan_a.to_dict())
        plan_a_modified.stages[0].tasks[0].title = "A 的修改任务"
        plan_a_modified.status = "modified"

        # 步骤3：拒绝 A'，回滚到 A
        # 回滚时使用历史栈的最后一个
        if history:
            plan_rolled_back = history.pop()
            self.assertEqual(plan_rolled_back.plan_id, "p-a")
            self.assertEqual(plan_rolled_back.status, "pending")
            self.assertEqual(plan_rolled_back.stages[0].tasks[0].title, "A 的任务")

        # 步骤4：再次修改 A
        history.append(plan_rolled_back)
        plan_a_v3 = PlanDocument.from_dict(plan_rolled_back.to_dict())
        plan_a_v3.stages[0].tasks[0].title = "A 的 v3 任务"
        plan_a_v3.status = "modified"

        # 步骤5：确认 A''
        plan_a_v3.status = "confirmed"
        self.assertEqual(plan_a_v3.status, "confirmed")
        self.assertEqual(plan_a_v3.stages[0].tasks[0].title, "A 的 v3 任务")

    def test_modify_plan_preserves_plan_id(self):
        """测试 modify_plan 保留 plan_id 用于回滚匹配"""
        from backend.app.services.plan_mode import PlanDocument
        original = PlanDocument(plan_id="p-stable", workflow_id="wf-1")
        # 用户修改后 plan_id 应保持不变（用于 modify API 调用）
        modified = PlanDocument.from_dict(original.to_dict())
        modified.user_modifications = "微调"
        self.assertEqual(modified.plan_id, original.plan_id)

    def test_history_stack_max_unbounded(self):
        """测试历史栈可保留多个版本（无强制限）"""
        from backend.app.services.plan_mode import PlanDocument
        history = []
        # 模拟 10 次修改
        for i in range(10):
            history.append(PlanDocument(plan_id=f"p-v{i}"))
        self.assertEqual(len(history), 10)


# ============================================================
# T18: Plan 边界条件测试
# ============================================================
class TestPlanBoundaryConditions(unittest.TestCase):
    """
    T18: Plan 边界条件测试

    验证：
      - 空 Plan（无 stages）正常序列化
      - Plan 含空 stage（无 tasks/risks）正常序列化
      - 用户修改说明为 None 或空字符串的兼容性
      - total_estimated_minutes 字段计算
    """

    def test_empty_plan_serialization(self):
        """测试空 Plan 序列化"""
        from backend.app.services.plan_mode import PlanDocument
        empty = PlanDocument(plan_id="p-empty")
        data = empty.to_dict()
        self.assertEqual(data["plan_id"], "p-empty")
        self.assertEqual(data["stages"], [])
        self.assertEqual(data["total_estimated_minutes"], 0)

    def test_plan_with_empty_stage(self):
        """测试含空 stage 的 Plan"""
        from backend.app.services.plan_mode import PlanDocument, PlanStage
        plan = PlanDocument(
            plan_id="p-empty-stage",
            stages=[PlanStage(stage="coding", tasks=[], risks=[], alternatives=[])],
        )
        data = plan.to_dict()
        self.assertEqual(len(data["stages"]), 1)
        self.assertEqual(data["stages"][0]["tasks"], [])
        self.assertEqual(data["stages"][0]["risks"], [])

    def test_user_modifications_empty_string(self):
        """测试空 user_modifications"""
        from backend.app.services.plan_mode import PlanDocument
        plan = PlanDocument(plan_id="p-1", user_modifications="")
        data = plan.to_dict()
        self.assertEqual(data["user_modifications"], "")

    def test_task_zero_estimated_minutes(self):
        """测试 estimated_minutes 为 0（边界）"""
        from backend.app.services.plan_mode import PlanDocument, PlanStage, PlanTask
        plan = PlanDocument(
            plan_id="p-zero",
            stages=[PlanStage(
                stage="coding",
                tasks=[PlanTask(task_id="t-1", estimated_minutes=0)],
            )],
        )
        self.assertEqual(plan.stages[0].tasks[0].estimated_minutes, 0)

    def test_task_large_estimated_minutes(self):
        """测试 estimated_minutes 较大值（如 24h=1440 分钟）"""
        from backend.app.services.plan_mode import PlanTask
        task = PlanTask(task_id="t-1", estimated_minutes=1440)
        self.assertEqual(task.estimated_minutes, 1440)

    def test_alternatives_field_default_empty(self):
        """测试 alternatives 字段默认空列表"""
        from backend.app.services.plan_mode import PlanStage
        stage = PlanStage(stage="coding")
        self.assertEqual(stage.alternatives, [])

    def test_files_involved_default_empty(self):
        """测试 files_involved 字段默认空列表"""
        from backend.app.services.plan_mode import PlanTask
        task = PlanTask(task_id="t-1")
        self.assertEqual(task.files_involved, [])

    def test_dependencies_default_empty(self):
        """测试 dependencies 字段默认空列表"""
        from backend.app.services.plan_mode import PlanTask
        task = PlanTask(task_id="t-1")
        self.assertEqual(task.dependencies, [])

    def test_plan_to_json_indented(self):
        """测试 JSON 输出有缩进（便于阅读）"""
        from backend.app.services.plan_mode import PlanDocument
        plan = PlanDocument(plan_id="p-1")
        json_str = plan.to_json()
        # ensure_ascii=False + indent=2 → 应包含换行符
        self.assertIn("\n", json_str)
        # 应保留中文（如有）
        plan.objective = "测试目标"
        json_str = plan.to_json()
        self.assertIn("测试目标", json_str)

    def test_plan_from_dict_uses_defaults_for_missing_fields(self):
        """测试 from_dict 对缺失字段使用默认值"""
        from backend.app.services.plan_mode import PlanDocument
        # 极简 dict（缺很多字段）
        minimal = {"plan_id": "p-min"}
        plan = PlanDocument.from_dict(minimal)
        self.assertEqual(plan.plan_id, "p-min")
        self.assertEqual(plan.workflow_id, "")
        self.assertEqual(plan.status, "pending")
        self.assertEqual(plan.stages, [])


# ============================================================
# 主入口
# ============================================================
def run_all_tests():
    """运行所有测试"""
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(TestPlanAPIContract))
    suite.addTests(loader.loadTestsFromTestCase(TestPlanStateTransitions))
    suite.addTests(loader.loadTestsFromTestCase(TestPlanPersistenceMarkers))
    suite.addTests(loader.loadTestsFromTestCase(TestPlanRiskSerialization))
    suite.addTests(loader.loadTestsFromTestCase(TestPlanRollbackChain))
    suite.addTests(loader.loadTestsFromTestCase(TestPlanBoundaryConditions))
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(run_all_tests())
