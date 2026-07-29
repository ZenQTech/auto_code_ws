"""
Hermes Agent v2 - 单元测试
==========================================
核心作用：测试 Agent v2 自进化智能体的所有核心模块
        覆盖：数据模型、模式检测器、调度器、主动记忆引擎、建议引擎、后台 Worker、自指导引擎、Manager
运行流程：执行测试 → 断言验证 → 报告结果
输入参数：测试用例
输出结果：测试结果（passed/failed）
修改记录：
  - 2026-07-28 | v1.0.0 | Cycle 14 P0-1 初始版本
"""
import os
import sys
import json
import asyncio
import tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

# 设置 PYTHONPATH
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.core.agent_v2.models import (
    ProactivePattern,
    ProactiveSuggestion,
    ThreadAutomation,
    BackgroundTask,
    IdleStatus,
    AgentV2Stats,
    ScheduleType,
    AutomationStatus,
    BackgroundTaskStatus,
    SuggestionSource,
)
from app.core.agent_v2.pattern_detector import (
    PatternDetector,
    _extract_features,
    _tfidf_similarity,
    _sanitize_path,
    _compute_pattern_hash,
)
from app.core.agent_v2.scheduler import (
    Scheduler,
    _validate_command,
    _parse_cron_field,
    _parse_cron,
    _next_cron_time,
    _parse_interval,
)
from app.core.agent_v2.proactive_memory import ProactiveMemoryEngine
from app.core.agent_v2.suggestion_engine import SuggestionEngine
from app.core.agent_v2.background_worker import BackgroundWorker
from app.core.agent_v2.self_directing import SelfDirectingEngine
from app.core.agent_v2.manager import AgentV2Manager, get_manager


# ============================================================
# 测试辅助
# ============================================================

def assert_eq(actual, expected, msg=""):
    """断言相等"""
    if actual != expected:
        raise AssertionError(f"{msg} expected {expected}, got {actual}")


def assert_true(condition, msg=""):
    """断言为真"""
    if not condition:
        raise AssertionError(f"{msg} - condition is False")


def assert_raises(exc_class, func, *args, **kwargs):
    """断言抛出异常"""
    try:
        func(*args, **kwargs)
    except exc_class:
        return
    raise AssertionError(f"Expected {exc_class.__name__} to be raised")


# ============================================================
# 数据模型测试
# ============================================================

def test_proactive_pattern_creation():
    """测试 ProactivePattern 创建"""
    pattern = ProactivePattern(
        description="Test pattern",
        trigger_conditions=["type:edit", "ext:.py"],
        confidence=0.85,
        occurrences=5,
        suggested_action="Run tests",
    )
    assert_true(pattern.pattern_id.startswith("pat-"), "pattern_id prefix")
    assert_eq(pattern.description, "Test pattern", "description")
    assert_eq(len(pattern.trigger_conditions), 2, "trigger count")
    assert_eq(pattern.confidence, 0.85, "confidence")
    assert_eq(pattern.occurrences, 5, "occurrences")
    assert_true(len(pattern.created_at) > 0, "created_at set")


def test_proactive_pattern_serialization():
    """测试 ProactivePattern 序列化/反序列化"""
    pattern = ProactivePattern(
        description="Serialize test",
        confidence=0.9,
        occurrences=3,
    )
    data = pattern.to_dict()
    assert_true(isinstance(data, dict), "data is dict")
    assert_true("pattern_id" in data, "has pattern_id")

    restored = ProactivePattern.from_dict(data)
    assert_eq(restored.pattern_id, pattern.pattern_id, "id preserved")
    assert_eq(restored.description, pattern.description, "description preserved")
    assert_eq(restored.confidence, pattern.confidence, "confidence preserved")


def test_proactive_suggestion_creation():
    """测试 ProactiveSuggestion 创建"""
    suggestion = ProactiveSuggestion(
        title="Test suggestion",
        description="Test description",
        confidence=0.75,
        source="memory",
    )
    assert_true(suggestion.suggestion_id.startswith("sug-"), "id prefix")
    assert_eq(suggestion.status, "pending", "default status")


def test_thread_automation_creation():
    """测试 ThreadAutomation 创建"""
    auto = ThreadAutomation(
        name="daily_check",
        schedule="0 9 * * *",
        action="health_check",
    )
    assert_true(auto.automation_id.startswith("auto-"), "id prefix")
    assert_eq(auto.schedule_type, "cron", "default schedule_type")
    assert_eq(auto.status, "active", "default status")


def test_background_task_creation():
    """测试 BackgroundTask 创建"""
    task = BackgroundTask(
        name="test_task",
        action="log",
    )
    assert_true(task.task_id.startswith("bg-"), "id prefix")
    assert_eq(task.status, "pending", "default status")
    assert_eq(task.retry_count, 0, "default retry_count")
    assert_eq(task.max_retries, 3, "default max_retries")


def test_idle_status_creation():
    """测试 IdleStatus 创建"""
    status = IdleStatus()
    assert_eq(status.idle_threshold, 1800, "default threshold")
    assert_eq(status.auto_turn_enabled, True, "default auto_turn")


def test_agent_v2_stats_creation():
    """测试 AgentV2Stats 创建"""
    stats = AgentV2Stats()
    assert_eq(stats.total_patterns, 0, "default count")
    assert_true(isinstance(stats.background_tasks_by_status, dict), "by_status dict")


# ============================================================
# 模式检测器测试
# ============================================================

def test_extract_features():
    """测试特征提取"""
    op = {
        "type": "edit",
        "target": "/home/user/test.py",
        "context": {"file_type": "python"},
    }
    features = _extract_features(op)
    assert_true(len(features) > 0, "features extracted")
    assert_true(any("type:edit" in f for f in features), "type feature")
    assert_true(any("ext:.py" in f for f in features), "ext feature")


def test_tfidf_similarity_identical():
    """测试 TF-IDF 相似度（相同）"""
    f = ["a", "b", "c"]
    sim = _tfidf_similarity(f, f)
    assert_true(abs(sim - 1.0) < 0.001, f"identical sim (got {sim})")


def test_tfidf_similarity_empty():
    """测试 TF-IDF 相似度（空）"""
    assert_eq(_tfidf_similarity([], ["a"]), 0.0, "empty a")
    assert_eq(_tfidf_similarity(["a"], []), 0.0, "empty b")


def test_tfidf_similarity_partial():
    """测试 TF-IDF 相似度（部分重叠）"""
    sim = _tfidf_similarity(["a", "b", "c"], ["b", "c", "d"])
    assert_true(0 < sim < 1, "partial sim range")


def test_validate_path_safe():
    """测试路径安全验证"""
    safe_path = "/home/user/test.py"
    result = _sanitize_path(safe_path)
    assert_eq(result, safe_path, "safe path allowed")


def test_validate_path_dangerous():
    """测试危险路径"""
    assert_raises(ValueError, _sanitize_path, "/etc/passwd")
    assert_raises(ValueError, _sanitize_path, "/etc/shadow")
    assert_raises(ValueError, _sanitize_path, "/root/.ssh/id_rsa")


def test_parse_cron_field_wildcard():
    """测试 cron 字段解析（通配符）"""
    values = _parse_cron_field("*", 0, 59)
    assert_eq(len(values), 60, "all 60 minutes")


def test_parse_cron_field_range():
    """测试 cron 字段解析（范围）"""
    values = _parse_cron_field("1-5", 0, 59)
    assert_eq(values, [1, 2, 3, 4, 5], "range values")


def test_parse_cron_field_step():
    """测试 cron 字段解析（步长）"""
    values = _parse_cron_field("*/15", 0, 59)
    assert_eq(values, [0, 15, 30, 45], "step values")


def test_parse_cron_valid():
    """测试 cron 解析（有效）"""
    parsed = _parse_cron("0 9 * * *")
    assert_true(parsed is not None, "valid cron")
    assert_eq(parsed["hour"], [9], "hour 9")
    assert_eq(len(parsed["minute"]), 1, "single minute")
    assert_eq(parsed["minute"][0], 0, "minute 0")


def test_parse_cron_invalid():
    """测试 cron 解析（无效）"""
    assert_true(_parse_cron("invalid") is None, "invalid")
    assert_true(_parse_cron("0 9 *") is None, "too few fields")
    assert_true(_parse_cron("0 9 * * * *") is None, "too many fields")


def test_next_cron_time():
    """测试 cron 下次执行时间"""
    next_time = _next_cron_time("0 9 * * *")
    assert_true(next_time is not None, "next time computed")
    assert_eq(next_time.hour, 9, "hour 9")
    assert_eq(next_time.minute, 0, "minute 0")


def test_parse_interval_seconds():
    """测试 interval 解析（秒）"""
    assert_eq(_parse_interval("300"), 300, "300 seconds")
    assert_eq(_parse_interval("5m"), 300, "5 minutes")
    assert_eq(_parse_interval("2h"), 7200, "2 hours")
    assert_eq(_parse_interval("1d"), 86400, "1 day")


def test_parse_interval_invalid():
    """测试 interval 解析（无效）"""
    assert_true(_parse_interval("") is None, "empty")
    assert_true(_parse_interval("invalid") is None, "invalid")
    assert_true(_parse_interval("5x") is None, "invalid suffix")


def test_pattern_detector_no_pattern():
    """测试模式检测器（无模式）"""
    detector = PatternDetector(min_occurrences=3)
    op = {"type": "edit", "target": "/home/user/a.py"}
    result = detector.add_operation(op)
    assert_true(result is None, "no pattern with 1 op")


def test_pattern_detector_pattern_detected():
    """测试模式检测器（检测到模式）"""
    detector = PatternDetector(min_occurrences=3, min_confidence=0.3)
    pattern = None
    for i in range(5):
        op = {
            "type": "edit",
            "target": "/home/user/file.py",
            "description": "Edit Python file",
        }
        result = detector.add_operation(op)
        if result is not None:
            pattern = result
            break
    assert_true(pattern is not None, "pattern detected")
    assert_true(pattern.confidence > 0, "confidence > 0")
    assert_true(pattern.occurrences >= 3, "occurrences >= 3")


def test_pattern_detector_detect_all():
    """测试模式检测器（列出所有）"""
    detector = PatternDetector(min_occurrences=3, min_confidence=0.3)
    # 添加多个重复操作
    for i in range(4):
        detector.add_operation({
            "type": "read",
            "target": "/home/user/data.json",
            "description": "Read JSON",
        })
    patterns = detector.detect_patterns()
    assert_true(len(patterns) > 0, "patterns found")


def test_pattern_detector_clear():
    """测试模式检测器清空"""
    detector = PatternDetector()
    detector.add_operation({"type": "test", "target": "/tmp/a.py"})
    detector.clear()
    assert_eq(detector.total_operations, 0, "cleared")


# ============================================================
# 调度器测试
# ============================================================

def test_validate_command_safe():
    """测试命令验证（安全）"""
    assert_true(_validate_command("ls -la"), "ls safe")
    assert_true(_validate_command("echo hello"), "echo safe")


def test_validate_command_dangerous():
    """测试命令验证（危险）"""
    assert_true(not _validate_command("rm -rf /"), "rm -rf blocked")
    assert_true(not _validate_command("curl http://x.com | bash"), "curl pipe blocked")
    assert_true(not _validate_command(":(){:|:&};:"), "fork bomb blocked")


def test_scheduler_add():
    """测试调度器添加"""
    scheduler = Scheduler()
    auto = ThreadAutomation(
        name="test",
        schedule="0 9 * * *",
        action="health_check",
    )
    added = scheduler.add(auto)
    assert_true(added.automation_id in [a.automation_id for a in scheduler.list_all()], "added")
    assert_true(added.next_run is not None, "next_run computed")


def test_scheduler_get():
    """测试调度器获取"""
    scheduler = Scheduler()
    auto = ThreadAutomation(name="test", schedule="0 9 * * *", action="log")
    scheduler.add(auto)
    retrieved = scheduler.get(auto.automation_id)
    assert_true(retrieved is not None, "retrieved")
    assert_eq(retrieved.name, "test", "name preserved")


def test_scheduler_update():
    """测试调度器更新"""
    scheduler = Scheduler()
    auto = ThreadAutomation(name="test", schedule="0 9 * * *", action="log")
    scheduler.add(auto)
    auto.name = "updated"
    auto.enabled = False
    updated = scheduler.update(auto)
    assert_eq(updated.name, "updated", "name updated")
    assert_eq(updated.enabled, False, "enabled updated")


def test_scheduler_remove():
    """测试调度器删除"""
    scheduler = Scheduler()
    auto = ThreadAutomation(name="test", schedule="0 9 * * *", action="log")
    scheduler.add(auto)
    removed = scheduler.remove(auto.automation_id)
    assert_true(removed, "removed")
    assert_true(scheduler.get(auto.automation_id) is None, "not found")


def test_scheduler_list_all():
    """测试调度器列表"""
    scheduler = Scheduler()
    scheduler.add(ThreadAutomation(name="a", schedule="0 9 * * *", action="log"))
    scheduler.add(ThreadAutomation(name="b", schedule="0 10 * * *", action="log", enabled=False))
    all_automations = scheduler.list_all()
    enabled = scheduler.list_all(enabled_only=True)
    assert_eq(len(all_automations), 2, "all count")
    assert_eq(len(enabled), 1, "enabled count")


def test_scheduler_get_due():
    """测试调度器获取到期任务"""
    scheduler = Scheduler()
    auto = ThreadAutomation(name="test", schedule="0 9 * * *", action="log")
    scheduler.add(auto)
    due = scheduler.get_due()
    # 取决于时间，可能有或没有
    assert_true(isinstance(due, list), "due is list")


def test_scheduler_mark_run():
    """测试标记已执行"""
    scheduler = Scheduler()
    auto = ThreadAutomation(name="test", schedule="*/5 * * * *", action="log")
    scheduler.add(auto)
    marked = scheduler.mark_run(auto.automation_id)
    assert_true(marked is not None, "marked")
    assert_eq(marked.run_count, 1, "run_count incremented")
    assert_true(marked.last_run is not None, "last_run set")


# ============================================================
# 主动记忆引擎测试
# ============================================================

def test_proactive_memory_record():
    """测试记录操作"""
    import os
    os.environ["HERMES_AGENT_V2_DIR"] = tempfile.mkdtemp()
    engine = ProactiveMemoryEngine(min_occurrences=3, min_confidence=0.3)
    suggestions = []
    for i in range(5):
        s = engine.record_operation({
            "type": "test",
            "target": "/tmp/test_pattern.py",
            "description": "Test operation",
        })
        suggestions.extend(s)
    assert_true(len(suggestions) > 0, "suggestions generated")


def test_proactive_memory_add_pattern():
    """测试添加模式"""
    import os
    os.environ["HERMES_AGENT_V2_DIR"] = tempfile.mkdtemp()
    engine = ProactiveMemoryEngine()
    pattern = ProactivePattern(
        description="Manual pattern",
        confidence=0.9,
    )
    added = engine.add_pattern(pattern)
    assert_eq(added.pattern_id, pattern.pattern_id, "added")


def test_proactive_memory_list_patterns():
    """测试列出模式"""
    import os
    os.environ["HERMES_AGENT_V2_DIR"] = tempfile.mkdtemp()
    engine = ProactiveMemoryEngine()
    engine.add_pattern(ProactivePattern(description="p1", confidence=0.5))
    engine.add_pattern(ProactivePattern(description="p2", confidence=0.9))
    patterns = engine.list_patterns()
    assert_eq(len(patterns), 2, "all patterns")
    high_conf = engine.list_patterns(min_confidence=0.8)
    assert_eq(len(high_conf), 1, "high conf filter")


def test_proactive_memory_suggestion_lifecycle():
    """测试建议生命周期"""
    import os
    os.environ["HERMES_AGENT_V2_DIR"] = tempfile.mkdtemp()
    engine = ProactiveMemoryEngine()
    suggestion = engine.create_suggestion(
        title="Test",
        description="Test desc",
        confidence=0.8,
    )
    assert_eq(suggestion.status, "pending", "initial status")

    accepted = engine.accept_suggestion(suggestion.suggestion_id)
    assert_eq(accepted.status, "accepted", "accepted")

    # 创建另一个测试 reject
    s2 = engine.create_suggestion(title="T2", description="D2")
    rejected = engine.reject_suggestion(s2.suggestion_id)
    assert_eq(rejected.status, "rejected", "rejected")


def test_proactive_memory_stats():
    """测试统计"""
    import os
    os.environ["HERMES_AGENT_V2_DIR"] = tempfile.mkdtemp()
    engine = ProactiveMemoryEngine()
    stats = engine.get_stats()
    assert_true("total_patterns" in stats, "has total_patterns")
    assert_true("total_suggestions" in stats, "has total_suggestions")


# ============================================================
# 建议引擎测试
# ============================================================

def test_suggestion_engine_from_pattern():
    """测试从模式生成建议"""
    engine = SuggestionEngine()
    pattern = ProactivePattern(
        description="Test",
        confidence=0.8,
        occurrences=5,
        suggested_action="Run tests",
    )
    suggestion = engine.generate_from_pattern(pattern)
    assert_true(suggestion is not None, "suggestion generated")
    assert_eq(suggestion.source, "pattern", "source pattern")


def test_suggestion_engine_low_confidence():
    """测试低置信度"""
    engine = SuggestionEngine()
    pattern = ProactivePattern(description="Test", confidence=0.3, occurrences=2)
    suggestion = engine.generate_from_pattern(pattern)
    assert_true(suggestion is None, "low confidence returns None")


def test_suggestion_engine_from_memory():
    """测试从 Memory 生成建议"""
    engine = SuggestionEngine()
    suggestion = engine.generate_from_memory(
        title="Memory test",
        description="Memory description",
    )
    assert_eq(suggestion.source, "memory", "source memory")


def test_suggestion_engine_automation():
    """测试自动化建议"""
    engine = SuggestionEngine()
    suggestion = engine.generate_automation_suggestion(pending_count=5)
    assert_eq(suggestion.source, "automation", "source automation")
    assert_true("5" in suggestion.description, "count in description")


def test_suggestion_engine_background():
    """测试后台建议"""
    engine = SuggestionEngine()
    suggestion = engine.generate_background_suggestion(running_count=2, pending_count=3)
    assert_eq(suggestion.source, "background", "source background")
    assert_true("2" in suggestion.description, "running in description")
    assert_true("3" in suggestion.description, "pending in description")


def test_suggestion_engine_filter_by_confidence():
    """测试按置信度过滤"""
    engine = SuggestionEngine()
    s1 = ProactiveSuggestion(title="high", confidence=0.9)
    s2 = ProactiveSuggestion(title="low", confidence=0.3)
    filtered = engine.filter_by_confidence([s1, s2], min_confidence=0.5)
    assert_eq(len(filtered), 1, "filtered count")


# ============================================================
# 后台 Worker 测试
# ============================================================

def test_background_worker_create_task():
    """测试创建后台任务"""
    worker = BackgroundWorker()
    task = worker.create_task(name="test", action="log")
    assert_eq(task.status, "pending", "initial status")
    assert_eq(task.retry_count, 0, "initial retry")


def test_background_worker_execute():
    """测试执行任务"""
    async def run_test():
        worker = BackgroundWorker()
        task = worker.create_task(name="test", action="health_check")
        executed = await worker.execute_task(task.task_id)
        assert_eq(executed.status, "completed", "completed")
        assert_true(executed.result is not None, "result set")
    asyncio.run(run_test())


def test_background_worker_register_handler():
    """测试注册 handler"""
    worker = BackgroundWorker()

    async def custom_handler(action, metadata):
        return f"Custom: {action}"

    worker.register_handler("custom_action", custom_handler)
    assert_true("custom_action" in worker._handlers, "registered")


def test_background_worker_list_tasks():
    """测试列出任务"""
    worker = BackgroundWorker()
    worker.create_task(name="t1", action="log")
    worker.create_task(name="t2", action="health_check")
    tasks = worker.list_tasks()
    assert_eq(len(tasks), 2, "task count")


def test_background_worker_get_task():
    """测试获取任务"""
    worker = BackgroundWorker()
    task = worker.create_task(name="t", action="log")
    retrieved = worker.get_task(task.task_id)
    assert_true(retrieved is not None, "retrieved")


def test_background_worker_cancel():
    """测试取消任务"""
    worker = BackgroundWorker()
    task = worker.create_task(name="t", action="log")
    cancelled = worker.cancel_task(task.task_id)
    assert_true(cancelled, "cancelled")
    assert_eq(task.status, "cancelled", "status cancelled")


def test_background_worker_stats():
    """测试统计"""
    worker = BackgroundWorker()
    worker.create_task(name="t1", action="log")
    worker.create_task(name="t2", action="log")
    stats = worker.get_stats()
    assert_eq(stats["pending"], 2, "pending count")


# ============================================================
# Self-Directing 测试
# ============================================================

def test_self_directing_initial():
    """测试初始状态"""
    engine = SelfDirectingEngine()
    status = engine.get_idle_status()
    assert_eq(status.idle_threshold, 1800, "default threshold")
    assert_eq(status.auto_turn_enabled, True, "default enabled")


def test_self_directing_record_activity():
    """测试记录活动"""
    engine = SelfDirectingEngine()
    engine.record_activity()
    status = engine.get_idle_status()
    assert_eq(status.idle_seconds, 0, "idle after activity")


def test_self_directing_idle():
    """测试空闲状态"""
    engine = SelfDirectingEngine(idle_threshold=1)
    import time
    time.sleep(2)
    status = engine.get_idle_status()
    assert_true(status.is_idle, "is_idle")
    assert_true(status.idle_seconds >= 1, "idle_seconds")


def test_self_directing_auto_turn():
    """测试 auto-turn"""
    engine = SelfDirectingEngine(idle_threshold=0)
    suggestions = engine.trigger_auto_turn(context={
        "pending_count": 3,
        "automation_due_count": 1,
        "background_running": 2,
        "background_pending": 1,
        "high_confidence_patterns": 2,
    })
    assert_true(len(suggestions) > 0, "suggestions generated")


def test_self_directing_auto_turn_disabled():
    """测试 auto-turn 禁用"""
    engine = SelfDirectingEngine(idle_threshold=0, auto_turn_enabled=False)
    suggestions = engine.trigger_auto_turn()
    assert_eq(len(suggestions), 0, "no suggestions when disabled")


def test_self_directing_set_idle_threshold():
    """测试设置空闲阈值"""
    engine = SelfDirectingEngine()
    engine.set_idle_threshold(3600)
    status = engine.get_idle_status()
    assert_eq(status.idle_threshold, 3600, "updated threshold")


def test_self_directing_set_enabled():
    """测试设置启用状态"""
    engine = SelfDirectingEngine()
    engine.set_auto_turn_enabled(False)
    status = engine.get_idle_status()
    assert_eq(status.auto_turn_enabled, False, "disabled")


# ============================================================
# Manager 测试
# ============================================================

def test_manager_singleton():
    """测试 Manager 单例"""
    m1 = get_manager()
    m2 = get_manager()
    assert_true(m1 is m2, "singleton")


def test_manager_record_operation():
    """测试 Manager 记录操作"""
    manager = get_manager()
    suggestions = manager.record_operation({
        "type": "test",
        "target": "/tmp/manager_test.py",
        "description": "Manager test",
    })
    # 取决于历史，可能没有
    assert_true(isinstance(suggestions, list), "list returned")


def test_manager_create_automation():
    """测试 Manager 创建自动化"""
    manager = get_manager()
    automation = manager.create_automation(
        name="test_auto",
        schedule="*/10 * * * *",
        action="log",
    )
    assert_true(automation.automation_id.startswith("auto-"), "id prefix")
    assert_true(automation.next_run is not None, "next_run computed")


def test_manager_list_automations():
    """测试 Manager 列出自动化"""
    manager = get_manager()
    automations = manager.list_automations()
    assert_true(isinstance(automations, list), "list returned")


def test_manager_create_suggestion():
    """测试 Manager 创建建议"""
    manager = get_manager()
    suggestion = manager.memory.create_suggestion(
        title="Test",
        description="Test desc",
    )
    assert_true(suggestion.suggestion_id.startswith("sug-"), "id prefix")


def test_manager_get_stats():
    """测试 Manager 统计"""
    manager = get_manager()
    stats = manager.get_stats()
    assert_true(isinstance(stats, AgentV2Stats), "stats is AgentV2Stats")


def test_manager_health():
    """测试 Manager 健康检查"""
    manager = get_manager()
    health = manager.health()
    assert_eq(health["service"], "agent_v2", "service name")
    assert_eq(health["status"], "healthy", "healthy")


def test_manager_dashboard():
    """测试 Manager Dashboard"""
    manager = get_manager()
    dashboard = manager.get_dashboard()
    assert_true("stats" in dashboard, "has stats")
    assert_true("idle_status" in dashboard, "has idle_status")


# ============================================================
# 测试运行器
# ============================================================

def run_all_tests():
    """运行所有单元测试

    Returns:
        tuple: (passed_count, total_count)
    """
    import inspect

    test_funcs = [
        (name, func)
        for name, func in globals().items()
        if name.startswith("test_") and callable(func) and inspect.isfunction(func)
    ]

    passed = 0
    failed = 0
    failures = []

    for name, func in sorted(test_funcs):
        try:
            func()
            passed += 1
            print(f"  ✓ {name}")
        except Exception as e:
            failed += 1
            failures.append((name, str(e)))
            print(f"  ✗ {name}: {e}")

    return passed, failed, failures


if __name__ == "__main__":
    print("=" * 60)
    print("Hermes Agent v2 - 单元测试")
    print("=" * 60)

    passed, failed, failures = run_all_tests()

    print("=" * 60)
    print(f"测试结果: {passed} passed, {failed} failed, {passed + failed} total")
    print("=" * 60)

    if failures:
        print("\n失败详情:")
        for name, err in failures:
            print(f"  - {name}: {err}")

    sys.exit(0 if failed == 0 else 1)
