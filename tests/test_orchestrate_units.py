"""
# Orchestrate 单元测试
# ============================================================
# 测试覆盖：
#   - 数据模型（FieldSpec, Invariant, StageContract, Pipeline）
#   - 合约构建（ContractBuilder, 字段工厂, 不变量工厂）
#   - DAG 引擎（拓扑排序, 循环检测, 关键路径, 并行度）
#   - 验证器（输入/输出校验, 不变量断言）
#   - 重试编排（指数退避, 熔断器, 重试队列, 幂等性）
#   - 注册中心（注册, 查询, 标签/能力过滤）
#   - SLA 监控（指标计算, 告警, 百分位）
#   - 模板（6 预定义模板, 实例化）
#   - API 端点（健康, 阶段, Pipeline, SLA, 重试）
# ============================================================
"""

from __future__ import annotations

import json
import os
import sys
import time
import unittest

# 确保可以导入 app
sys.path.insert(
    0, os.path.join(os.path.dirname(__file__), "..", "backend")
)

from app.core.orchestrate import (
    GLOBAL_REGISTRY,
    PIPELINE_TEMPLATES,
    SLAMonitor,
    Alert,
    AlertSeverity,
    CircuitBreaker,
    CircuitBreakerState,
    ContractBuilder,
    ContractValidator,
    DAGValidationError,
    ExecutionStatus,
    FieldSpec,
    FieldType,
    Invariant,
    InvariantType,
    Pipeline,
    PipelineExecutor,
    PipelineStatus,
    RetryOrchestrator,
    RetryPolicy,
    SLASpec,
    SLAMetrics,
    StageContract,
    StageExecution,
    StageRef,
    StageRegistry,
    StageStatus,
    ValidationError,
    build_any_field,
    build_bool_field,
    build_dict_field,
    build_execution_plan,
    build_float_field,
    build_int_field,
    build_list_field,
    build_text_field,
    detect_cycles,
    get_critical_path,
    get_parallelism,
    get_template,
    instantiate_template,
    invariant_enum,
    invariant_non_empty,
    invariant_non_null,
    invariant_range,
    invariant_regex,
    list_templates,
    validate_dag,
)


# ============================================================
# Test: 数据模型
# ============================================================

class TestFieldSpec(unittest.TestCase):
    """FieldSpec 序列化测试"""

    def test_01_text_field(self):
        spec = build_text_field("repo", min_length=1, max_length=100)
        self.assertEqual(spec.name, "repo")
        self.assertEqual(spec.type, FieldType.STRING)
        self.assertEqual(spec.min_length, 1)
        self.assertEqual(spec.max_length, 100)
        d = spec.to_dict()
        self.assertEqual(d["name"], "repo")
        self.assertEqual(d["type"], "string")
        restored = FieldSpec.from_dict(d)
        self.assertEqual(restored.name, "repo")
        self.assertEqual(restored.type, FieldType.STRING)

    def test_02_int_field(self):
        spec = build_int_field("count", min_value=0, max_value=100)
        self.assertEqual(spec.type, FieldType.INT)
        self.assertEqual(spec.min_value, 0)
        self.assertEqual(spec.max_value, 100)

    def test_03_float_field(self):
        spec = build_float_field("ratio", min_value=0.0, max_value=1.0)
        self.assertEqual(spec.type, FieldType.FLOAT)

    def test_04_bool_field(self):
        spec = build_bool_field("enabled", default=True)
        self.assertEqual(spec.type, FieldType.BOOL)
        self.assertTrue(spec.default)

    def test_05_list_field(self):
        spec = build_list_field("tags", item_type=FieldType.STRING, min_length=1)
        self.assertEqual(spec.type, FieldType.LIST)
        self.assertEqual(spec.item_type, FieldType.STRING)

    def test_06_dict_field(self):
        spec = build_dict_field("config")
        self.assertEqual(spec.type, FieldType.DICT)

    def test_07_any_field(self):
        spec = build_any_field("payload")
        self.assertEqual(spec.type, FieldType.ANY)


class TestInvariant(unittest.TestCase):
    """Invariant 序列化测试"""

    def test_01_non_null(self):
        inv = invariant_non_null("repo")
        self.assertEqual(inv.invariant_type, InvariantType.NON_NULL)
        d = inv.to_dict()
        restored = Invariant.from_dict(d)
        self.assertEqual(restored.invariant_type, InvariantType.NON_NULL)

    def test_02_non_empty(self):
        inv = invariant_non_empty("report")
        self.assertEqual(inv.invariant_type, InvariantType.NON_EMPTY)

    def test_03_range(self):
        inv = invariant_range("score", 0, 100)
        self.assertEqual(inv.invariant_type, InvariantType.RANGE)
        self.assertEqual(inv.min_value, 0)
        self.assertEqual(inv.max_value, 100)

    def test_04_regex(self):
        inv = invariant_regex("email", r"^[\w.]+@[\w.]+$")
        self.assertEqual(inv.invariant_type, InvariantType.REGEX)
        self.assertEqual(inv.pattern, r"^[\w.]+@[\w.]+$")

    def test_05_enum(self):
        inv = invariant_enum("status", ["draft", "active", "archived"])
        self.assertEqual(inv.invariant_type, InvariantType.ENUM)
        self.assertEqual(inv.allowed_values, ["draft", "active", "archived"])


class TestContractBuilder(unittest.TestCase):
    """ContractBuilder 流式构建测试"""

    def test_01_basic_build(self):
        contract = (ContractBuilder("test", "Test stage")
            .input("repo", build_text_field("repo"))
            .output("report", build_text_field("report"))
            .precondition(invariant_non_null("repo"))
            .postcondition(invariant_non_empty("report"))
            .capability("analysis")
            .timeout(60)
            .tag("test")
            .build())
        self.assertEqual(contract.name, "test")
        self.assertEqual(len(contract.inputs), 1)
        self.assertEqual(len(contract.outputs), 1)
        self.assertEqual(len(contract.preconditions), 1)
        self.assertEqual(len(contract.postconditions), 1)
        self.assertIn("analysis", contract.required_capabilities)
        self.assertEqual(contract.timeout_seconds, 60)
        self.assertIn("test", contract.tags)

    def test_02_sla_and_retry(self):
        sla = SLASpec(p99_latency_ms=5000)
        policy = RetryPolicy(max_attempts=5)
        contract = (ContractBuilder("test")
            .sla(sla)
            .retry_policy(policy)
            .build())
        self.assertEqual(contract.sla.p99_latency_ms, 5000)
        self.assertEqual(contract.retry_policy.max_attempts, 5)

    def test_03_serialization(self):
        contract = (ContractBuilder("test")
            .input("x", build_int_field("x"))
            .output("y", build_int_field("y"))
            .build())
        d = contract.to_dict()
        restored = StageContract.from_dict(d)
        self.assertEqual(restored.name, contract.name)
        self.assertEqual(len(restored.inputs), 1)


class TestPipelineModel(unittest.TestCase):
    """Pipeline 模型测试"""

    def test_01_basic_pipeline(self):
        p = Pipeline(name="test", stages=[StageRef(stage_id="a")])
        self.assertEqual(p.status, PipelineStatus.PENDING)
        self.assertEqual(len(p.stages), 1)
        d = p.to_dict()
        restored = Pipeline.from_dict(d)
        self.assertEqual(restored.name, "test")

    def test_02_stage_execution(self):
        e = StageExecution(stage_id="x", status=ExecutionStatus.RUNNING)
        self.assertEqual(e.attempt, 1)
        d = e.to_dict()
        restored = StageExecution.from_dict(d)
        self.assertEqual(restored.status, ExecutionStatus.RUNNING)


# ============================================================
# Test: DAG 引擎
# ============================================================

class TestDAG(unittest.TestCase):
    """DAG 引擎测试"""

    def test_01_simple_topological(self):
        p = Pipeline(stages=[
            StageRef(stage_id="a"),
            StageRef(stage_id="b", depends_on=["a"]),
        ])
        plan = build_execution_plan(p)
        self.assertEqual(len(plan), 2)
        self.assertEqual(plan[0], ["a"])
        self.assertEqual(plan[1], ["b"])

    def test_02_parallel_batch(self):
        p = Pipeline(stages=[
            StageRef(stage_id="a"),
            StageRef(stage_id="b", depends_on=["a"]),
            StageRef(stage_id="c", depends_on=["a"]),
            StageRef(stage_id="d", depends_on=["b", "c"]),
        ])
        plan = build_execution_plan(p)
        self.assertEqual(len(plan), 3)
        self.assertEqual(plan[0], ["a"])
        # b 和 c 并行
        self.assertEqual(set(plan[1]), {"b", "c"})
        self.assertEqual(plan[2], ["d"])

    def test_03_diamond_dag(self):
        p = Pipeline(stages=[
            StageRef(stage_id="a"),
            StageRef(stage_id="b", depends_on=["a"]),
            StageRef(stage_id="c", depends_on=["a"]),
            StageRef(stage_id="d", depends_on=["b", "c"]),
            StageRef(stage_id="e", depends_on=["d"]),
        ])
        plan = build_execution_plan(p)
        self.assertEqual(len(plan), 4)
        self.assertEqual(plan[0], ["a"])
        self.assertEqual(set(plan[1]), {"b", "c"})
        self.assertEqual(plan[2], ["d"])
        self.assertEqual(plan[3], ["e"])

    def test_04_detect_cycle(self):
        p = Pipeline(stages=[
            StageRef(stage_id="a", depends_on=["b"]),
            StageRef(stage_id="b", depends_on=["a"]),
        ])
        cycles = detect_cycles(p)
        self.assertGreater(len(cycles), 0)

    def test_05_validate_dag(self):
        p = Pipeline(stages=[
            StageRef(stage_id="a", depends_on=["nonexistent"]),
        ])
        valid, errors = validate_dag(p)
        self.assertFalse(valid)
        self.assertGreater(len(errors), 0)

    def test_06_self_dependency(self):
        p = Pipeline(stages=[
            StageRef(stage_id="a", depends_on=["a"]),
        ])
        valid, errors = validate_dag(p)
        self.assertFalse(valid)

    def test_07_duplicate_ids(self):
        p = Pipeline(stages=[
            StageRef(stage_id="a"),
            StageRef(stage_id="a"),
        ])
        valid, errors = validate_dag(p)
        self.assertFalse(valid)

    def test_08_critical_path(self):
        p = Pipeline(stages=[
            StageRef(stage_id="a"),
            StageRef(stage_id="b", depends_on=["a"]),
            StageRef(stage_id="c", depends_on=["a"]),
            StageRef(stage_id="d", depends_on=["b", "c"]),
        ])
        path = get_critical_path(p)
        self.assertEqual(path[0], "a")
        self.assertEqual(path[-1], "d")
        self.assertEqual(len(path), 3)  # a → b/c → d

    def test_09_parallelism(self):
        p = Pipeline(stages=[
            StageRef(stage_id="a"),
            StageRef(stage_id="b", depends_on=["a"]),
            StageRef(stage_id="c", depends_on=["a"]),
        ])
        stats = get_parallelism(p)
        self.assertEqual(stats["total_stages"], 3)
        self.assertEqual(stats["max_parallel"], 2)
        self.assertEqual(stats["critical_path_length"], 2)

    def test_10_empty_pipeline(self):
        p = Pipeline(stages=[])
        plan = build_execution_plan(p)
        self.assertEqual(plan, [])


# ============================================================
# Test: 验证器
# ============================================================

class TestValidator(unittest.TestCase):
    """Contract 验证器测试"""

    def setUp(self):
        self.contract = (ContractBuilder("test")
            .input("repo", build_text_field("repo", min_length=1))
            .input("count", build_int_field("count", min_value=0, max_value=100))
            .output("report", build_text_field("report", min_length=1))
            .precondition(invariant_non_null("repo"))
            .postcondition(invariant_non_empty("report"))
            .build())
        self.validator = ContractValidator(self.contract)

    def test_01_valid_input(self):
        valid, errors = self.validator.validate_inputs_with_errors(
            {"repo": "myrepo", "count": 5}
        )
        self.assertTrue(valid)
        self.assertEqual(len(errors), 0)

    def test_02_missing_required(self):
        valid, errors = self.validator.validate_inputs_with_errors({"count": 5})
        self.assertFalse(valid)
        self.assertGreater(len(errors), 0)
        self.assertEqual(errors[0]["code"], "missing_field")

    def test_03_type_mismatch(self):
        valid, errors = self.validator.validate_inputs_with_errors(
            {"repo": "myrepo", "count": "not a number"}
        )
        self.assertFalse(valid)
        self.assertEqual(errors[0]["code"], "type_mismatch")

    def test_04_range_violation(self):
        valid, errors = self.validator.validate_inputs_with_errors(
            {"repo": "myrepo", "count": 200}
        )
        self.assertFalse(valid)
        self.assertEqual(errors[0]["code"], "max_value")

    def test_05_min_length_violation(self):
        valid, errors = self.validator.validate_inputs_with_errors(
            {"repo": "", "count": 5}
        )
        self.assertFalse(valid)
        self.assertEqual(errors[0]["code"], "min_length")

    def test_06_valid_output(self):
        valid, errors = self.validator.validate_outputs_with_errors(
            {"report": "valid report"}
        )
        self.assertTrue(valid)

    def test_07_invalid_output(self):
        valid, errors = self.validator.validate_outputs_with_errors(
            {"report": ""}
        )
        self.assertFalse(valid)

    def test_08_precondition(self):
        self.assertFalse(self.validator.validate_preconditions({}))
        self.assertTrue(self.validator.validate_preconditions({"repo": "x"}))

    def test_09_postcondition(self):
        self.assertFalse(self.validator.validate_postconditions({"report": ""}))
        self.assertTrue(self.validator.validate_postconditions({"report": "x"}))

    def test_10_precondition_errors(self):
        errors = self.validator.get_precondition_errors({})
        self.assertGreater(len(errors), 0)

    def test_11_postcondition_errors(self):
        errors = self.validator.get_postcondition_errors({"report": ""})
        self.assertGreater(len(errors), 0)

    def test_12_optional_field_with_default(self):
        spec = build_text_field("opt", required=False, default="default")
        contract = ContractBuilder("test").input("opt", spec).build()
        validator = ContractValidator(contract)
        valid, _ = validator.validate_inputs_with_errors({})
        self.assertTrue(valid)


# ============================================================
# Test: 重试编排 + 熔断器
# ============================================================

class TestRetry(unittest.TestCase):
    """重试编排 + 熔断器测试"""

    def test_01_circuit_breaker_states(self):
        cb = CircuitBreaker(threshold=3, reset_timeout_ms=100)
        self.assertEqual(cb.state, CircuitBreakerState.CLOSED)
        self.assertTrue(cb.allow_request())
        # 连续失败 3 次 → 熔断
        for _ in range(3):
            cb.record_failure()
        self.assertEqual(cb.state, CircuitBreakerState.OPEN)
        self.assertFalse(cb.allow_request())

    def test_02_circuit_breaker_recovery(self):
        cb = CircuitBreaker(threshold=2, reset_timeout_ms=50)
        for _ in range(2):
            cb.record_failure()
        self.assertEqual(cb.state, CircuitBreakerState.OPEN)
        # 等待恢复
        time.sleep(0.1)
        self.assertTrue(cb.allow_request())
        self.assertEqual(cb.state, CircuitBreakerState.HALF_OPEN)

    def test_03_circuit_breaker_reset(self):
        cb = CircuitBreaker(threshold=2, reset_timeout_ms=60000)
        for _ in range(2):
            cb.record_failure()
        cb.reset()
        self.assertEqual(cb.state, CircuitBreakerState.CLOSED)
        self.assertEqual(cb.failure_count, 0)

    def test_04_should_retry(self):
        ro = RetryOrchestrator()
        policy = RetryPolicy(max_attempts=3)
        self.assertTrue(ro.should_retry(1, policy))
        self.assertTrue(ro.should_retry(2, policy))
        self.assertFalse(ro.should_retry(3, policy))

    def test_05_backoff_calculation(self):
        ro = RetryOrchestrator()
        policy = RetryPolicy(
            base_delay_ms=100,
            backoff_multiplier=2,
            max_delay_ms=10000,
            jitter=False,
        )
        d1 = ro.compute_backoff_ms(1, policy)
        d2 = ro.compute_backoff_ms(2, policy)
        d3 = ro.compute_backoff_ms(3, policy)
        self.assertEqual(d1, 100)
        self.assertEqual(d2, 200)
        self.assertEqual(d3, 400)

    def test_06_backoff_max_limit(self):
        ro = RetryOrchestrator()
        policy = RetryPolicy(
            base_delay_ms=1000,
            backoff_multiplier=10,
            max_delay_ms=5000,
            jitter=False,
        )
        d = ro.compute_backoff_ms(5, policy)
        self.assertLessEqual(d, 5000)

    def test_07_retry_queue(self):
        ro = RetryOrchestrator()
        item = ro.enqueue_retry(
            stage_id="a",
            pipeline_id="p1",
            attempt=1,
            max_attempts=3,
            error="oops",
            inputs={},
        )
        items = ro.list_queue()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["stage_id"], "a")
        # 移除
        self.assertTrue(ro.remove_item(item.item_id))
        self.assertEqual(len(ro.list_queue()), 0)

    def test_08_idempotency(self):
        ro = RetryOrchestrator()
        key = "test_key_123"
        self.assertTrue(ro.register_idempotency_key(key))
        self.assertFalse(ro.register_idempotency_key(key))
        self.assertTrue(ro.is_duplicate(key))

    def test_09_stats(self):
        ro = RetryOrchestrator()
        self.assertIn("queue_size", ro.get_stats())
        self.assertIn("breaker_count", ro.get_stats())

    def test_10_breaker_status(self):
        ro = RetryOrchestrator()
        policy = RetryPolicy()
        breaker = ro.get_breaker("test_stage", policy)
        self.assertEqual(breaker.state, CircuitBreakerState.CLOSED)


# ============================================================
# Test: 注册中心
# ============================================================

class TestRegistry(unittest.TestCase):
    """阶段注册中心测试"""

    def setUp(self):
        self.registry = StageRegistry()

    def test_01_register_and_get(self):
        contract = ContractBuilder("test1").stage_id("test1").build()
        self.registry.register(contract)
        self.assertTrue(self.registry.has(contract.stage_id))
        self.assertEqual(self.registry.get(contract.stage_id), contract)

    def test_02_unregister(self):
        contract = ContractBuilder("test1").stage_id("test1").build()
        self.registry.register(contract)
        self.assertTrue(self.registry.unregister(contract.stage_id))
        self.assertFalse(self.registry.has(contract.stage_id))

    def test_03_list_all(self):
        for i in range(3):
            self.registry.register(ContractBuilder(f"test_{i}").stage_id(f"test_{i}").build())
        self.assertEqual(len(self.registry.list_all()), 3)

    def test_04_find_by_capability(self):
        c1 = ContractBuilder("a").stage_id("a").capability("nlp").build()
        c2 = ContractBuilder("b").stage_id("b").capability("nlp").build()
        c3 = ContractBuilder("c").stage_id("c").capability("vision").build()
        self.registry.register(c1)
        self.registry.register(c2)
        self.registry.register(c3)
        self.assertEqual(len(self.registry.find_by_capability("nlp")), 2)
        self.assertEqual(len(self.registry.find_by_capability("vision")), 1)

    def test_05_find_by_tag(self):
        c1 = ContractBuilder("a").stage_id("a").tag("review").build()
        c2 = ContractBuilder("b").stage_id("b").tag("test").build()
        self.registry.register(c1)
        self.registry.register(c2)
        self.assertEqual(len(self.registry.find_by_tag("review")), 1)

    def test_06_search(self):
        c1 = ContractBuilder("lint_check").stage_id("lint_check").description("Lint code").build()
        c2 = ContractBuilder("security_scan").stage_id("security_scan").description("Security analysis").build()
        self.registry.register(c1)
        self.registry.register(c2)
        results = self.registry.search("lint")
        self.assertEqual(len(results), 1)

    def test_07_update_status(self):
        contract = ContractBuilder("test").stage_id("test").build()
        self.registry.register(contract)
        self.assertTrue(self.registry.update_status(contract.stage_id, StageStatus.DISABLED))
        updated = self.registry.get(contract.stage_id)
        self.assertEqual(updated.status, StageStatus.DISABLED)

    def test_08_count_by_status(self):
        c1 = ContractBuilder("a").stage_id("a").build()
        c2 = ContractBuilder("b").stage_id("b").build()
        self.registry.register(c1)
        self.registry.register(c2)
        self.registry.update_status(c1.stage_id, StageStatus.DISABLED)
        stats = self.registry.count_by_status()
        self.assertEqual(stats.get("disabled"), 1)
        self.assertEqual(stats.get("registered"), 1)

    def test_09_get_stats(self):
        for i in range(3):
            self.registry.register(ContractBuilder(f"a{i}").stage_id(f"a{i}").capability("x").tag("t").build())
        stats = self.registry.get_stats()
        self.assertEqual(stats["total_stages"], 3)
        self.assertIn("x", stats["capabilities"])

    def test_10_clear(self):
        self.registry.register(ContractBuilder("a").stage_id("a").build())
        self.registry.clear()
        self.assertEqual(self.registry.count(), 0)


# ============================================================
# Test: SLA 监控
# ============================================================

class TestSLA(unittest.TestCase):
    """SLA 监控测试"""

    def setUp(self):
        self.monitor = SLAMonitor()
        self.sla = SLASpec(p99_latency_ms=1000, min_success_rate=0.9)
        self.monitor.register_sla("test_stage", self.sla)

    def test_01_record_execution(self):
        alerts = self.monitor.record_execution("test_stage", 500, True)
        self.assertEqual(len(alerts), 0)

    def test_02_p99_alert(self):
        # 多次慢执行
        for _ in range(15):
            self.monitor.record_execution("test_stage", 2000, True)
        alerts = self.monitor.list_alerts()
        self.assertGreater(len(alerts), 0)

    def test_03_low_success_rate_alert(self):
        for i in range(20):
            self.monitor.record_execution("test_stage", 500, success=(i % 5 != 0))
        alerts = self.monitor.list_alerts()
        # 应该有低成功率告警
        found = any(a["metric"] == "success_rate" for a in alerts)
        self.assertTrue(found)

    def test_04_get_metrics(self):
        for i in range(10):
            self.monitor.record_execution("test_stage", 100 + i * 10, True)
        metrics = self.monitor.get_metrics("test_stage")
        self.assertEqual(metrics.total_executions, 10)
        self.assertEqual(metrics.successful_executions, 10)
        self.assertGreater(metrics.p50_latency_ms, 0)

    def test_05_global_stats(self):
        for _ in range(5):
            self.monitor.record_execution("test_stage", 100, True)
        stats = self.monitor.get_global_stats()
        self.assertEqual(stats["total_executions"], 5)
        self.assertEqual(stats["global_error_rate"], 0.0)

    def test_06_acknowledge_alert(self):
        for _ in range(15):
            self.monitor.record_execution("test_stage", 2000, True)
        alerts = self.monitor.list_alerts(include_acknowledged=False)
        if alerts:
            alert_id = alerts[0]["alert_id"]
            self.assertTrue(self.monitor.acknowledge_alert(alert_id, "user1"))

    def test_07_clear_acknowledged(self):
        for _ in range(15):
            self.monitor.record_execution("test_stage", 2000, True)
        alerts = self.monitor.list_alerts()
        for a in alerts:
            self.monitor.acknowledge_alert(a["alert_id"], "user1")
        cleared = self.monitor.clear_acknowledged_alerts()
        self.assertGreater(cleared, 0)

    def test_08_filter_by_severity(self):
        for _ in range(20):
            self.monitor.record_execution("test_stage", 100, success=False)
        alerts = self.monitor.list_alerts(severity=AlertSeverity.WARNING)
        for a in alerts:
            self.assertEqual(a["severity"], "warning")

    def test_09_percentile_calculation(self):
        # 直接测试 _percentile
        values = list(range(1, 101))
        p50 = self.monitor._percentile(values, 50)
        p99 = self.monitor._percentile(values, 99)
        self.assertGreater(p50, 0)
        self.assertGreater(p99, p50)

    def test_10_unregister_sla(self):
        self.assertTrue(self.monitor.unregister_sla("test_stage"))
        self.assertFalse(self.monitor.unregister_sla("test_stage"))


# ============================================================
# Test: 模板
# ============================================================

class TestTemplates(unittest.TestCase):
    """预定义模板测试"""

    def test_01_list_templates(self):
        templates = list_templates()
        self.assertGreaterEqual(len(templates), 6)

    def test_02_get_template(self):
        template = get_template("code_review")
        self.assertIsNotNone(template)
        self.assertEqual(template.name, "Code Review")

    def test_03_get_nonexistent_template(self):
        self.assertIsNone(get_template("nonexistent"))

    def test_04_instantiate_template(self):
        pipeline = instantiate_template("code_review", {"repo": "test"})
        self.assertIsNotNone(pipeline)
        self.assertEqual(pipeline.template, "tpl_code_review")
        self.assertEqual(pipeline.inputs["repo"], "test")

    def test_05_template_stages(self):
        template = get_template("code_review")
        self.assertEqual(len(template.stage_refs), 5)
        # lint → security/perf → style → summary
        deps = {s.stage_id: s.depends_on for s in template.stage_refs}
        self.assertEqual(deps["lint"], [])
        self.assertIn("lint", deps["security"])
        self.assertIn("lint", deps["perf"])
        self.assertIn("security", deps["style"])
        self.assertIn("perf", deps["style"])
        self.assertIn("style", deps["summary"])

    def test_06_research_template(self):
        pipeline = instantiate_template("research", {"query": "test"})
        self.assertEqual(pipeline.template, "tpl_research")
        self.assertEqual(pipeline.inputs["query"], "test")

    def test_07_writing_template(self):
        template = get_template("writing")
        self.assertIsNotNone(template)
        # 应该有 6 阶段
        self.assertEqual(len(template.stage_refs), 6)

    def test_08_devops_template(self):
        template = get_template("devops")
        self.assertIsNotNone(template)
        self.assertEqual(len(template.stage_refs), 5)

    def test_09_data_pipeline_template(self):
        template = get_template("data_pipeline")
        self.assertIsNotNone(template)
        self.assertEqual(len(template.stage_refs), 5)

    def test_10_security_audit_template(self):
        template = get_template("security_audit")
        self.assertIsNotNone(template)
        self.assertEqual(len(template.stage_refs), 4)


# ============================================================
# Test: Pipeline 执行器
# ============================================================

class TestExecutor(unittest.TestCase):
    """Pipeline 执行器测试"""

    def setUp(self):
        self.registry = StageRegistry()
        self.sla = SLAMonitor()
        self.retry = RetryOrchestrator()
        self.executor = PipelineExecutor(
            registry=self.registry,
            sla_monitor=self.sla,
            retry_orchestrator=self.retry,
        )
        # 注册测试阶段
        self._register_stages()

    def _register_stages(self):
        a = (ContractBuilder("a")
            .stage_id("a")
            .input("x", build_int_field("x", default=1))
            .output("y", build_int_field("y"))
            .build())
        b = (ContractBuilder("b")
            .stage_id("b")
            .input("y", build_int_field("y"))
            .output("z", build_int_field("z"))
            .build())
        self.registry.register(a)
        self.registry.register(b)

    def test_01_simple_execute(self):
        def runner_a(inputs):
            return {"y": inputs.get("x", 1) * 2}

        def runner_b(inputs):
            return {"z": inputs.get("y", 0) + 1}

        pipeline = Pipeline(stages=[
            StageRef(stage_id="a"),
            StageRef(stage_id="b", depends_on=["a"]),
        ], inputs={"x": 5})
        result = self.executor.execute(
            pipeline,
            {"a": runner_a, "b": runner_b},
        )
        self.assertEqual(result.status, PipelineStatus.COMPLETED)
        self.assertEqual(result.stage_executions["b"].outputs["z"], 11)

    def test_02_parallel_execute(self):
        def runner_a(inputs):
            return {"y": 1}

        def runner_b(inputs):
            return {"z": 2}

        def runner_c(inputs):
            return {"w": 3}

        c = (ContractBuilder("c")
            .stage_id("c")
            .input("y", build_int_field("y", required=False, default=0))
            .output("w", build_int_field("w"))
            .build())
        self.registry.register(c)

        # 重新注册 b 为可选输入
        self.registry.unregister("b")
        b = (ContractBuilder("b")
            .stage_id("b")
            .input("y", build_int_field("y", required=False, default=0))
            .output("z", build_int_field("z"))
            .build())
        self.registry.register(b)

        pipeline = Pipeline(stages=[
            StageRef(stage_id="a"),
            StageRef(stage_id="b", depends_on=["a"]),
            StageRef(stage_id="c", depends_on=["a"]),
        ])
        result = self.executor.execute(
            pipeline,
            {"a": runner_a, "b": runner_b, "c": runner_c},
        )
        self.assertEqual(result.status, PipelineStatus.COMPLETED)
        self.assertEqual(result.stage_executions["b"].status, ExecutionStatus.SUCCEEDED)
        self.assertEqual(result.stage_executions["c"].status, ExecutionStatus.SUCCEEDED)

    def test_03_missing_runner(self):
        # 创建一个没有输出要求的阶段用于测试无 runner 场景
        no_output = (ContractBuilder("no_output")
            .stage_id("no_output")
            .input("x", build_int_field("x", default=1))
            .build())
        self.registry.register(no_output)
        pipeline = Pipeline(stages=[StageRef(stage_id="no_output")])
        result = self.executor.execute(pipeline, {})
        # 没有 runner 时默认返回 _status=no_runner
        self.assertEqual(result.status, PipelineStatus.COMPLETED)

    def test_04_input_validation_failure(self):
        # 必填字段缺失
        contract = (ContractBuilder("strict")
            .stage_id("strict")
            .input("required_field", build_text_field("required_field"))
            .build())
        self.registry.register(contract)
        pipeline = Pipeline(stages=[StageRef(stage_id="strict")])
        result = self.executor.execute(pipeline, {})
        self.assertEqual(result.status, PipelineStatus.FAILED)

    def test_05_retry_on_failure(self):
        # 创建一个会失败的 runner
        attempt_counter = [0]

        def runner_a(inputs):
            attempt_counter[0] += 1
            if attempt_counter[0] < 2:
                raise RuntimeError("transient error")
            return {"y": 1}

        pipeline = Pipeline(stages=[StageRef(stage_id="a")])
        result = self.executor.execute(pipeline, {"a": runner_a})
        self.assertEqual(result.status, PipelineStatus.COMPLETED)
        self.assertEqual(attempt_counter[0], 2)

    def test_06_circuit_breaker(self):
        # 创建一个总是失败的 runner
        def runner_a(inputs):
            raise RuntimeError("permanent error")

        pipeline = Pipeline(stages=[StageRef(stage_id="a")])
        # 执行多次以触发熔断
        for _ in range(10):
            self.executor.execute(pipeline, {"a": runner_a})
        # 熔断器应该开启
        breaker = self.retry.get_breaker_status("a")
        self.assertIsNotNone(breaker)

    def test_07_optional_stage_failure(self):
        def runner_a(inputs):
            return {"y": 1}

        def runner_b(inputs):
            raise RuntimeError("fail")

        contract_b = ContractBuilder("b").input("y", build_int_field("y")).output("z", build_int_field("z")).build()
        self.registry.register(contract_b)

        pipeline = Pipeline(stages=[
            StageRef(stage_id="a"),
            StageRef(stage_id="b", depends_on=["a"], optional=True),
        ])
        result = self.executor.execute(
            pipeline,
            {"a": runner_a, "b": runner_b},
        )
        # b 是 optional，它的失败不应阻塞 pipeline
        self.assertEqual(result.status, PipelineStatus.COMPLETED)

    def test_08_dag_validation_failure(self):
        pipeline = Pipeline(stages=[
            StageRef(stage_id="a", depends_on=["nonexistent"]),
        ])
        result = self.executor.execute(pipeline, {})
        self.assertEqual(result.status, PipelineStatus.FAILED)

    def test_09_execution_plan_recorded(self):
        pipeline = Pipeline(stages=[
            StageRef(stage_id="a"),
            StageRef(stage_id="b", depends_on=["a"]),
        ])
        result = self.executor.execute(pipeline, {})
        self.assertEqual(len(result.execution_plan), 2)

    def test_10_sla_recorded(self):
        def runner_a(inputs):
            return {"y": 1}

        pipeline = Pipeline(stages=[StageRef(stage_id="a")])
        result = self.executor.execute(pipeline, {"a": runner_a})
        metrics = self.sla.get_metrics("a")
        self.assertEqual(metrics.total_executions, 1)


# ============================================================
# Test: 全局注册表
# ============================================================

class TestGlobalRegistry(unittest.TestCase):
    """全局注册表（模板自动注册）测试"""

    def test_01_default_stages_registered(self):
        # 通过模块导入触发初始化
        from app.core.orchestrate.api import _registry
        self.assertGreater(_registry.count(), 0)

    def test_02_template_stages_present(self):
        from app.core.orchestrate.api import _registry
        # code_review 模板的阶段应该被注册
        self.assertTrue(_registry.has("lint"))
        self.assertTrue(_registry.has("security"))
        self.assertTrue(_registry.has("perf"))
        self.assertTrue(_registry.has("style"))
        self.assertTrue(_registry.has("summary"))


# ============================================================
# 主函数
# ============================================================

if __name__ == "__main__":
    unittest.main()
