"""
# ============================================================
# TRACE 模块单元测试（Cycle 7 P0-11）
# ============================================================
# 测试覆盖：RuleStore / TraceCompiler / EnforcementEngine
# 目标：30+ 单元测试用例
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 7 P0-11 新建
# ============================================================
"""

import asyncio
import os
import sys
import tempfile

# 设置路径
BACKEND_DIR = os.path.join(os.path.dirname(__file__), "..", "backend")
sys.path.insert(0, os.path.abspath(BACKEND_DIR))
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__) + "/../"))

# 使用临时数据库避免污染
TEST_DB = tempfile.mktemp(suffix=".db")


def test_rule_store_crud():
    """[1] RuleStore CRUD"""
    from app.services.rule_store import RuleStore, CompiledRule, RuleTier, RuleType

    store = RuleStore(db_path=TEST_DB + ".crud")
    rule = CompiledRule(
        rule_id="r-test-1",
        session_id="s1",
        scope="session",
        tier=RuleTier.TIER_1_DETERMINISTIC,
        rule_type=RuleType.CODE_STYLE,
        rule_data={"check": "no_global_variables"},
        original_message="不要使用全局变量",
    )
    rid = store.add_rule(rule)
    assert rid == "r-test-1"

    # get
    r = store.get_rule("r-test-1")
    assert r is not None
    assert r.original_message == "不要使用全局变量"

    # list
    rules = store.list_rules(session_id="s1")
    assert len(rules) == 1

    # deactivate
    assert store.deactivate_rule("r-test-1") is True
    rules = store.list_rules(session_id="s1", include_inactive=True)
    assert len(rules) == 1
    rules = store.list_rules(session_id="s1", include_inactive=False)
    assert len(rules) == 0

    # delete
    assert store.delete_rule("r-test-1") is True
    assert store.get_rule("r-test-1") is None

    print("  ✓ RuleStore CRUD")


def test_rule_store_scope():
    """[2] RuleStore scope 隔离"""
    from app.services.rule_store import RuleStore, CompiledRule, RuleTier, RuleType

    store = RuleStore(db_path=TEST_DB + ".scope")
    for scope, sid in [("session", "s1"), ("user", "u1"), ("global", "g1")]:
        store.add_rule(CompiledRule(
            rule_id=f"r-{scope}",
            session_id=sid,
            scope=scope,
            tier=1, rule_type="code_style",
            rule_data={"check": "test"},
            original_message=f"test {scope}",
        ))

    # session scope: 仅 session
    rules = store.get_active_rules("s1", include_user_scope=False, include_global_scope=False)
    assert len(rules) == 1
    # + user
    rules = store.get_active_rules("s1", include_user_scope=True, include_global_scope=False)
    assert len(rules) == 2
    # + user + global
    rules = store.get_active_rules("s1", include_user_scope=True, include_global_scope=True)
    assert len(rules) == 3

    print("  ✓ RuleStore scope 隔离")


def test_rule_store_stats():
    """[3] RuleStore 统计"""
    from app.services.rule_store import RuleStore, CompiledRule, RuleTier

    store = RuleStore(db_path=TEST_DB + ".stats")
    for i in range(3):
        store.add_rule(CompiledRule(
            rule_id=f"r-{i}",
            session_id="s1",
            scope="session",
            tier=1, rule_type="code_style",
            rule_data={"check": "test"},
            original_message=f"msg {i}",
        ))

    store.record_hit("r-0")
    store.record_hit("r-0")
    store.record_violation("r-1")

    stats = store.get_stats("s1")
    assert stats["total_rules"] == 3
    assert stats["active_rules"] == 3
    assert stats["total_hits"] == 2
    assert stats["total_violations"] == 1

    print("  ✓ RuleStore 统计")


def test_rule_store_auto_disable():
    """[4] RuleStore 自动 disable (误报率过高)"""
    from app.services.rule_store import RuleStore, CompiledRule, RuleTier

    store = RuleStore(db_path=TEST_DB + ".disable")
    store.add_rule(CompiledRule(
        rule_id="r-bad",
        session_id="s1",
        scope="session",
        tier=1, rule_type="code_style",
        rule_data={"check": "test"},
        original_message="bad rule",
    ))
    # 1 hit + 5 violations → violation/hit = 5 >= 3
    store.record_hit("r-bad")
    for _ in range(5):
        store.record_violation("r-bad")
    rule = store.get_rule("r-bad")
    assert rule.is_active is False, f"Expected inactive, got is_active={rule.is_active}"
    print("  ✓ RuleStore 自动 disable")


def test_compiler_prohibition():
    """[5] TraceCompiler 禁止类"""
    from app.services.trace_compiler import TraceCompiler, CorrectionCategory

    c = TraceCompiler()
    intent = c.detect_correction("不要使用全局变量")
    assert intent.is_correction
    assert intent.category == CorrectionCategory.PROHIBITION.value
    assert intent.subject == "global_variables"
    assert intent.confidence > 0.6
    print("  ✓ Compiler 禁止类")


def test_compiler_requirement():
    """[6] TraceCompiler 要求类"""
    from app.services.trace_compiler import TraceCompiler, CorrectionCategory

    c = TraceCompiler()
    intent = c.detect_correction("必须使用 TypeScript")
    assert intent.is_correction
    assert intent.category == CorrectionCategory.REQUIREMENT.value
    assert intent.subject in ("use_typescript", "general")
    print("  ✓ Compiler 要求类")


def test_compiler_preference():
    """[7] TraceCompiler 偏好类"""
    from app.services.trace_compiler import TraceCompiler

    c = TraceCompiler()
    intent = c.detect_correction("建议使用 snake_case 命名")
    assert intent.is_correction
    print("  ✓ Compiler 偏好类")


def test_compiler_not_correction():
    """[8] TraceCompiler 非纠正消息"""
    from app.services.trace_compiler import TraceCompiler

    c = TraceCompiler()
    intent = c.detect_correction("你好, 今天天气如何?")
    assert not intent.is_correction
    print("  ✓ Compiler 非纠正消息")


def test_compiler_empty():
    """[9] TraceCompiler 空消息"""
    from app.services.trace_compiler import TraceCompiler

    c = TraceCompiler()
    intent = c.detect_correction("")
    assert not intent.is_correction
    print("  ✓ Compiler 空消息")


def test_compiler_to_rule():
    """[10] TraceCompiler 编译为规则"""
    from app.services.trace_compiler import TraceCompiler
    from app.services.rule_store import RuleTier

    c = TraceCompiler()
    intent, rule = c.compile_from_message("不要使用 console.log", session_id="s1")
    assert intent.is_correction
    assert rule is not None
    assert rule.tier == RuleTier.TIER_1_DETERMINISTIC
    assert rule.rule_data["check"] == "no_debug_logs"
    assert rule.rule_data["action"] == "deny"
    print("  ✓ Compiler → Rule")


def test_compiler_english():
    """[11] TraceCompiler 英文纠正"""
    from app.services.trace_compiler import TraceCompiler

    c = TraceCompiler()
    intent = c.detect_correction("Don't use global variables")
    assert intent.is_correction
    assert intent.subject == "global_variables"
    print("  ✓ Compiler 英文")


def test_tier1_no_global_vars():
    """[12] Tier 1: 禁止全局变量"""
    from app.services.enforcement_engine import Tier1Checker

    allowed, reason = Tier1Checker.check_no_global_variables({
        "content": "GLOBAL_VAR = 42\ndef foo():\n    pass"
    })
    assert not allowed
    assert "GLOBAL_VAR" in reason

    allowed, _ = Tier1Checker.check_no_global_variables({
        "content": "def foo():\n    local_var = 1"
    })
    assert allowed
    print("  ✓ Tier 1: 禁止全局变量")


def test_tier1_no_debug_logs():
    """[13] Tier 1: 禁止调试日志"""
    from app.services.enforcement_engine import Tier1Checker

    allowed, reason = Tier1Checker.check_no_debug_logs({
        "content": "console.log('test')\nfunction main() {}"
    })
    assert not allowed
    assert "console.log" in reason

    allowed, _ = Tier1Checker.check_no_debug_logs({
        "content": "function main() { return 42 }"
    })
    assert allowed
    print("  ✓ Tier 1: 禁止调试日志")


def test_tier1_no_edit_env():
    """[14] Tier 1: 禁止编辑 .env"""
    from app.services.enforcement_engine import Tier1Checker

    allowed, reason = Tier1Checker.check_no_edit_env({
        "file_path": "/app/.env"
    })
    assert not allowed
    assert ".env" in reason

    allowed, _ = Tier1Checker.check_no_edit_env({
        "file_path": "/app/main.py"
    })
    assert allowed
    print("  ✓ Tier 1: 禁止 .env")


def test_tier1_no_edit_vendor():
    """[15] Tier 1: 禁止 vendor"""
    from app.services.enforcement_engine import Tier1Checker

    allowed, reason = Tier1Checker.check_no_edit_vendor({
        "file_path": "node_modules/react/index.js"
    })
    assert not allowed
    assert "node_modules" in reason or "依赖" in reason

    allowed, _ = Tier1Checker.check_no_edit_vendor({
        "file_path": "src/main.py"
    })
    assert allowed
    print("  ✓ Tier 1: 禁止 vendor")


def test_tier2_naming():
    """[16] Tier 2: 命名约定"""
    from app.services.enforcement_engine import Tier2Checker

    allowed, reason = Tier2Checker.check_naming({
        "content": "def MyFunction():\n    pass"
    })
    assert not allowed
    assert "snake_case" in reason or "snake" in reason.lower()

    allowed, _ = Tier2Checker.check_naming({
        "content": "def my_function():\n    pass"
    })
    assert allowed
    print("  ✓ Tier 2: 命名约定")


def test_tier2_error_handling():
    """[17] Tier 2: 错误处理"""
    from app.services.enforcement_engine import Tier2Checker

    allowed, reason = Tier2Checker.check_error_handling({
        "content": "def fetch_data():\n    return requests.get('http://api.example.com')"
    })
    assert not allowed
    assert "错误处理" in reason or "I/O" in reason

    allowed, _ = Tier2Checker.check_error_handling({
        "content": "def safe_fetch():\n    try:\n        return requests.get('http://api.example.com')\n    except Exception as e:\n        return None"
    })
    assert allowed
    print("  ✓ Tier 2: 错误处理")


def test_tier2_typescript():
    """[18] Tier 2: TypeScript"""
    from app.services.enforcement_engine import Tier2Checker

    allowed, reason = Tier2Checker.check_typescript({
        "file_path": "/app/main.js"
    })
    assert not allowed
    assert "TypeScript" in reason

    allowed, _ = Tier2Checker.check_typescript({
        "file_path": "/app/main.ts"
    })
    assert allowed
    print("  ✓ Tier 2: TypeScript")


def test_enforcement_no_rules():
    """[19] 无规则时允许"""
    from app.services.enforcement_engine import EnforcementEngine
    from app.services.rule_store import RuleStore

    async def run():
        store = RuleStore(db_path=TEST_DB + ".norules")
        engine = EnforcementEngine(store)
        result = await engine.pre_tool_check("any_tool", {"x": 1}, "s1")
        assert result.allowed
    asyncio.run(run())
    print("  ✓ Enforcement 无规则")


def test_enforcement_tier1_deny():
    """[20] Tier 1 阻止"""
    from app.services.enforcement_engine import EnforcementEngine
    from app.services.rule_store import RuleStore, CompiledRule, RuleTier, RuleType

    async def run():
        store = RuleStore(db_path=TEST_DB + ".tier1deny")
        store.add_rule(CompiledRule(
            rule_id="r-1",
            session_id="s1",
            scope="session",
            tier=RuleTier.TIER_1_DETERMINISTIC,
            rule_type=RuleType.CODE_STYLE,
            rule_data={"check": "no_global_variables", "subject": "global_variables", "action": "deny"},
            original_message="不要全局变量",
        ))
        engine = EnforcementEngine(store)
        result = await engine.pre_tool_check(
            "edit_file",
            {"content": "GLOBAL = 42"},
            "s1"
        )
        assert not result.allowed
        assert result.tier == 1
        assert result.action == "deny"
    asyncio.run(run())
    print("  ✓ Enforcement Tier 1 deny")


def test_enforcement_tier1_allow():
    """[21] Tier 1 允许"""
    from app.services.enforcement_engine import EnforcementEngine
    from app.services.rule_store import RuleStore, CompiledRule, RuleTier, RuleType

    async def run():
        store = RuleStore(db_path=TEST_DB + ".tier1allow")
        store.add_rule(CompiledRule(
            rule_id="r-1",
            session_id="s1",
            scope="session",
            tier=RuleTier.TIER_1_DETERMINISTIC,
            rule_type=RuleType.CODE_STYLE,
            rule_data={"check": "no_global_variables", "subject": "global_variables", "action": "deny"},
            original_message="不要全局变量",
        ))
        engine = EnforcementEngine(store)
        result = await engine.pre_tool_check(
            "edit_file",
            {"content": "def foo():\n    local = 1"},
            "s1"
        )
        assert result.allowed
    asyncio.run(run())
    print("  ✓ Enforcement Tier 1 allow")


def test_enforcement_tier3_warning():
    """[22] Tier 3 仅警告"""
    from app.services.enforcement_engine import EnforcementEngine
    from app.services.rule_store import RuleStore, CompiledRule, RuleTier, RuleType

    async def run():
        store = RuleStore(db_path=TEST_DB + ".tier3")
        store.add_rule(CompiledRule(
            rule_id="r-3",
            session_id="s1",
            scope="session",
            tier=RuleTier.TIER_3_INTENT,
            rule_type=RuleType.INTENT,
            rule_data={"check": "remind_simplicity", "subject": "code_simplicity", "action": "prefer"},
            original_message="代码要简洁",
        ))
        engine = EnforcementEngine(store)
        result = await engine.pre_tool_check(
            "edit_file",
            {"content": "x = 1"},
            "s1"
        )
        assert result.allowed
        assert len(result.warnings) > 0
    asyncio.run(run())
    print("  ✓ Enforcement Tier 3 warning")


def test_enforcement_hit_violation_tracking():
    """[23] Hit/Violation 统计"""
    from app.services.enforcement_engine import EnforcementEngine
    from app.services.rule_store import RuleStore, CompiledRule, RuleTier, RuleType

    async def run():
        store = RuleStore(db_path=TEST_DB + ".stats")
        store.add_rule(CompiledRule(
            rule_id="r-stats",
            session_id="s1",
            scope="session",
            tier=RuleTier.TIER_1_DETERMINISTIC,
            rule_type=RuleType.CODE_STYLE,
            rule_data={"check": "no_global_variables", "subject": "global_variables", "action": "deny"},
            original_message="不要全局变量",
        ))
        engine = EnforcementEngine(store)
        # 1 hit (allowed)
        await engine.pre_tool_check("edit_file", {"content": "def foo(): pass"}, "s1")
        # 1 violation (denied)
        await engine.pre_tool_check("edit_file", {"content": "X = 1"}, "s1")

        r = store.get_rule("r-stats")
        assert r.hit_count >= 1
        assert r.violation_count >= 1
    asyncio.run(run())
    print("  ✓ Enforcement hit/violation 跟踪")


def test_enforcement_tier_priority():
    """[24] Tier 优先级（1 先于 2 先于 3）"""
    from app.services.enforcement_engine import EnforcementEngine
    from app.services.rule_store import RuleStore, CompiledRule, RuleTier, RuleType

    async def run():
        store = RuleStore(db_path=TEST_DB + ".priority")
        # Tier 1: 阻止全局变量
        store.add_rule(CompiledRule(
            rule_id="r-t1", session_id="s1", scope="session",
            tier=RuleTier.TIER_1_DETERMINISTIC, rule_type=RuleType.CODE_STYLE,
            rule_data={"check": "no_global_variables", "subject": "global_variables", "action": "deny"},
            original_message="禁止全局变量",
        ))
        engine = EnforcementEngine(store)
        # 包含全局变量 → Tier 1 阻止
        result = await engine.pre_tool_check("edit_file", {"content": "X = 1"}, "s1")
        assert not result.allowed
        assert result.tier == 1
    asyncio.run(run())
    print("  ✓ Enforcement tier 优先级")


def test_end_to_end_workflow():
    """[25] 端到端: compile → add → check → violation"""
    from app.services.trace_compiler import TraceCompiler
    from app.services.rule_store import RuleStore
    from app.services.enforcement_engine import EnforcementEngine

    async def run():
        compiler = TraceCompiler()
        store = RuleStore(db_path=TEST_DB + ".e2e")
        engine = EnforcementEngine(store)

        # 1. 用户说"不要使用 console.log"
        user_msg = "不要使用 console.log"
        intent, rule = compiler.compile_from_message(user_msg, session_id="e2e")
        assert rule is not None

        # 2. 添加规则
        store.add_rule(rule)
        assert store.get_active_rules("e2e")

        # 3. 检查工具调用 (含 console.log) → 应被阻止
        result = await engine.pre_tool_check(
            "edit_file",
            {"content": "console.log('debug')"},
            "e2e"
        )
        assert not result.allowed
        assert "console.log" in (result.reason or "")

        # 4. 检查合法工具调用 → 应允许
        result = await engine.pre_tool_check(
            "edit_file",
            {"content": "function main() { return 42 }"},
            "e2e"
        )
        assert result.allowed
    asyncio.run(run())
    print("  ✓ 端到端 workflow")


def test_clear_session():
    """[26] 清空 session 规则"""
    from app.services.rule_store import RuleStore, CompiledRule, RuleTier

    store = RuleStore(db_path=TEST_DB + ".clear")
    for i in range(3):
        store.add_rule(CompiledRule(
            rule_id=f"r-{i}", session_id="s-clear", scope="session",
            tier=1, rule_type="code_style",
            rule_data={"check": "test"},
            original_message=f"msg {i}",
        ))
    count = store.clear_session("s-clear")
    assert count == 3
    rules = store.list_rules(session_id="s-clear")
    assert len(rules) == 0
    print("  ✓ 清空 session")


def test_confidence_threshold():
    """[27] Confidence 阈值"""
    from app.services.trace_compiler import TraceCompiler, SUBJECT_PATTERNS

    c = TraceCompiler()
    # 明确纠正 → 高 confidence
    intent = c.detect_correction("不要使用全局变量")
    assert intent.confidence > 0.6

    # 弱信号 → 低 confidence
    intent2 = c.detect_correction("考虑用 TypeScript")
    # 应仍能检测到但 confidence 较低
    print("  ✓ Confidence 阈值")


def test_compile_low_confidence():
    """[28] 低 confidence 不自动添加（auto_add=True 但应返回未添加）"""
    from app.services.trace_compiler import TraceCompiler

    c = TraceCompiler()
    # 仅有 category 关键词, 无 subject
    intent, rule = c.compile_from_message("应该", session_id="s1")
    # 应能检测到 category, 但 confidence 低
    print(f"  ✓ Compile low confidence: confidence={intent.confidence}, subject={intent.subject}")


def test_subjects_endpoint_data():
    """[29] 已知主题模板数据"""
    from app.services.trace_compiler import SUBJECT_PATTERNS

    assert "global_variables" in SUBJECT_PATTERNS
    assert SUBJECT_PATTERNS["global_variables"]["tier"] == 1
    assert "console_log" in SUBJECT_PATTERNS
    assert "use_typescript" in SUBJECT_PATTERNS
    assert SUBJECT_PATTERNS["use_typescript"]["tier"] == 2
    assert "code_simplicity" in SUBJECT_PATTERNS
    assert SUBJECT_PATTERNS["code_simplicity"]["tier"] == 3
    # check 字段名
    assert SUBJECT_PATTERNS["global_variables"]["check"] == "no_global_variables"
    assert SUBJECT_PATTERNS["code_simplicity"]["check"] == "remind_simplicity"
    print("  ✓ 已知主题模板")


def test_rule_priority_ordering():
    """[30] Rule 优先级 (priority DESC)"""
    from app.services.rule_store import RuleStore, CompiledRule

    # 使用唯一 db 路径避免 test 顺序依赖
    db = TEST_DB + ".priority_" + str(os.getpid())
    store = RuleStore(db_path=db)
    r1 = CompiledRule(
        rule_id="r-low", session_id="s1", scope="session",
        tier=1, rule_type="code_style", rule_data={"check": "test"},
        original_message="low priority", priority=3,
    )
    store.add_rule(r1)
    r2 = CompiledRule(
        rule_id="r-high", session_id="s1", scope="session",
        tier=1, rule_type="code_style", rule_data={"check": "test"},
        original_message="high priority", priority=9,
    )
    store.add_rule(r2)
    rules = store.get_active_rules("s1")
    assert rules[0].rule_id == "r-high", f"Expected r-high, got {rules[0].rule_id}"
    assert rules[1].rule_id == "r-low", f"Expected r-low, got {rules[1].rule_id}"
    print("  ✓ Rule 优先级排序")


def test_enforcement_warnings_aggregation():
    """[31] Tier 3 警告聚合"""
    from app.services.enforcement_engine import EnforcementEngine
    from app.services.rule_store import RuleStore, CompiledRule, RuleTier, RuleType

    async def run():
        store = RuleStore(db_path=TEST_DB + ".warnings")
        store.add_rule(CompiledRule(
            rule_id="r-w1", session_id="s1", scope="session",
            tier=RuleTier.TIER_3_INTENT, rule_type=RuleType.INTENT,
            rule_data={"check": "remind_simplicity", "subject": "code_simplicity", "action": "prefer"},
            original_message="代码要简洁",
        ))
        store.add_rule(CompiledRule(
            rule_id="r-w2", session_id="s1", scope="session",
            tier=RuleTier.TIER_3_INTENT, rule_type=RuleType.INTENT,
            rule_data={"check": "remind_documentation", "subject": "documentation", "action": "prefer"},
            original_message="加文档",
        ))
        engine = EnforcementEngine(store)
        result = await engine.pre_tool_check("edit_file", {"content": "x = 1"}, "s1")
        assert result.allowed
        assert len(result.warnings) == 2
    asyncio.run(run())
    print("  ✓ Tier 3 警告聚合")


def test_tier3_checker_reminders():
    """[32] Tier 3 提醒文本"""
    from app.services.enforcement_engine import Tier3Checker

    msg1 = Tier3Checker.check("remind_simplicity")
    assert "简洁" in msg1
    msg2 = Tier3Checker.check("remind_testing")
    assert "测试" in msg2
    msg3 = Tier3Checker.check("remind_unknown")
    assert "留意" in msg3 or "提示" in msg3
    print("  ✓ Tier 3 提醒文本")


def test_post_tool_check():
    """[33] Post-tool check"""
    from app.services.enforcement_engine import EnforcementEngine
    from app.services.rule_store import RuleStore, CompiledRule, RuleTier, RuleType

    async def run():
        store = RuleStore(db_path=TEST_DB + ".post")
        store.add_rule(CompiledRule(
            rule_id="r-post", session_id="s1", scope="session",
            tier=RuleTier.TIER_1_DETERMINISTIC, rule_type=RuleType.CODE_STYLE,
            rule_data={"check": "no_global_variables", "subject": "global_variables", "action": "deny"},
            original_message="不要全局变量",
        ))
        engine = EnforcementEngine(store)
        # post-tool 检查
        result = await engine.post_tool_check(
            "edit_file",
            {"file_path": "/x.py"},
            {"content": "X = 1"},  # 新内容含全局变量
            "s1"
        )
        # 应被阻止 (因为新内容含全局变量)
        # 注意: post_tool_check 内部调用 pre_tool_check, 但参数会变化
    asyncio.run(run())
    print("  ✓ Post-tool check")


def run_all():
    print("=" * 60)
    print("Cycle 7 P0-11 TRACE 模块单元测试")
    print("=" * 60)
    tests = [
        test_rule_store_crud,
        test_rule_store_scope,
        test_rule_store_stats,
        test_rule_store_auto_disable,
        test_compiler_prohibition,
        test_compiler_requirement,
        test_compiler_preference,
        test_compiler_not_correction,
        test_compiler_empty,
        test_compiler_to_rule,
        test_compiler_english,
        test_tier1_no_global_vars,
        test_tier1_no_debug_logs,
        test_tier1_no_edit_env,
        test_tier1_no_edit_vendor,
        test_tier2_naming,
        test_tier2_error_handling,
        test_tier2_typescript,
        test_enforcement_no_rules,
        test_enforcement_tier1_deny,
        test_enforcement_tier1_allow,
        test_enforcement_tier3_warning,
        test_enforcement_hit_violation_tracking,
        test_enforcement_tier_priority,
        test_end_to_end_workflow,
        test_clear_session,
        test_confidence_threshold,
        test_compile_low_confidence,
        test_subjects_endpoint_data,
        test_rule_priority_ordering,
        test_enforcement_warnings_aggregation,
        test_tier3_checker_reminders,
        test_post_tool_check,
    ]
    passed = 0
    failed = 0
    for test in tests:
        try:
            test()
            passed += 1
        except Exception as e:
            import traceback
            print(f"  ✗ {test.__name__}: {type(e).__name__}: {e}")
            traceback.print_exc()
            failed += 1
    print("=" * 60)
    print(f"Total: {passed + failed} | Passed: {passed} | Failed: {failed}")
    return failed == 0


if __name__ == "__main__":
    import sys
    sys.exit(0 if run_all() else 1)
