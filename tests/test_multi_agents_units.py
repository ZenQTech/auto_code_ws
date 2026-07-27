#!/usr/bin/env python3
"""
# ============================================================
# Cycle 7 P0-10 Multi-Agent v2 Path-Based Registry 单元测试
# ============================================================
# 测试范围：multi_agent_registry.py 核心功能
#   1. 路径解析（parse_path / path_depth / is_valid_task_name / join_path）
#   2. spawn_agent 工具（正常 / 深度超限 / 槽位超限 / 同名冲突 / 父节点不存在）
#   3. wait_agent 工具（正常 / 超时 / 不存在）
#   4. close_agent 工具（正常 / 递归关闭 / 不存在）
#   5. send_message / followup_task 工具
#   6. list_agents / get_tree / get_stats / get_messages 查询
#   7. auto_cleanup_on_turn 内部清理
#   8. signal_completion / force_delete / clear_all
# 运行：PYTHONPATH=/home/qizheng/auto_code_ws/backend:/home/qizheng/auto_code_ws \
#       python3 tests/test_multi_agents_units.py
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 7 P0-10
# ============================================================
"""

import asyncio
import sys
import time
import traceback
from pathlib import Path

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.multi_agent_registry import (
    MultiAgentRegistry,
    parse_path,
    path_depth,
    is_valid_task_name,
    join_path,
    SubAgentStatus,
)


# ============================================================
# 简易测试框架
# ============================================================
class TestRunner:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.failures = []

    def run(self, name, fn):
        try:
            if asyncio.iscoroutinefunction(fn):
                asyncio.run(fn())
            else:
                fn()
            self.passed += 1
            print(f"  ✓ {name}")
        except Exception as e:
            self.failed += 1
            tb = traceback.format_exc()
            self.failures.append((name, tb))
            print(f"  ✗ {name}: {e}")

    def summary(self):
        total = self.passed + self.failed
        print(f"\n{'='*60}")
        print(f"Total: {total} | Passed: {self.passed} | Failed: {self.failed}")
        if self.failures:
            print("\nFailures:")
            for name, tb in self.failures:
                print(f"--- {name} ---")
                print(tb)
        return self.failed == 0


# ============================================================
# 测试用例
# ============================================================
def test_path_parsing():
    assert parse_path("/root") == ["root"]
    assert parse_path("/root/x") == ["root", "x"]
    assert parse_path("/root/x/y") == ["root", "x", "y"]
    assert path_depth("/root") == 1
    assert path_depth("/root/x") == 2
    assert path_depth("/root/a/b/c") == 4

    # 错误路径
    try:
        parse_path("root/x")
        assert False, "应当报错"
    except ValueError:
        pass

    try:
        parse_path("/")
        assert False, "应当报错"
    except ValueError:
        pass


def test_is_valid_task_name():
    assert is_valid_task_name("researcher")
    assert is_valid_task_name("test-1")
    assert is_valid_task_name("abc_123")
    assert not is_valid_task_name("")  # 空
    assert not is_valid_task_name("a" * 65)  # 超长
    assert not is_valid_task_name("a b")  # 含空格
    assert not is_valid_task_name("a/b")  # 含斜杠


def test_join_path():
    assert join_path("/root", "researcher") == "/root/researcher"
    assert join_path("/root/", "x") == "/root/x"


def test_registry_init():
    reg = MultiAgentRegistry(max_threads=3, max_depth=2)
    assert reg.max_threads == 3
    assert reg.max_depth == 2
    assert "/root" in reg._nodes
    assert reg._nodes["/root"].status == SubAgentStatus.RUNNING.value


def test_spawn_basic():
    async def run():
        reg = MultiAgentRegistry()
        r = await reg.spawn_agent(
            parent_path="/root",
            task_name="researcher",
            message="分析 API",
        )
        assert r["success"] is True
        assert r["path"] == "/root/researcher"
        assert r["depth"] == 2
        assert r["status"] == "running"
        assert "/root/researcher" in reg._nodes
        assert reg._slots["/root/researcher"].state == "active"
    asyncio.run(run())


def test_spawn_nested():
    async def run():
        reg = MultiAgentRegistry()
        await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        await reg.spawn_agent(parent_path="/root/a", task_name="b", message="b")
        assert "/root/a/b" in reg._nodes
        assert reg._nodes["/root/a/b"].depth == 3
    asyncio.run(run())


def test_spawn_max_depth_limit():
    async def run():
        reg = MultiAgentRegistry(max_depth=3)
        await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        await reg.spawn_agent(parent_path="/root/a", task_name="b", message="b")
        # 第 4 层应失败
        r = await reg.spawn_agent(parent_path="/root/a/b", task_name="c", message="c")
        assert r["success"] is False
        assert "max_depth" in r["error"]
    asyncio.run(run())


def test_spawn_max_threads_limit():
    async def run():
        reg = MultiAgentRegistry(max_threads=2, max_depth=5)
        r1 = await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        r2 = await reg.spawn_agent(parent_path="/root", task_name="b", message="b")
        r3 = await reg.spawn_agent(parent_path="/root", task_name="c", message="c")
        assert r1["success"]
        assert r2["success"]
        assert r3["success"] is False
        assert "max_threads" in r3["error"]
    asyncio.run(run())


def test_spawn_duplicate_task_name():
    async def run():
        reg = MultiAgentRegistry()
        await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        r = await reg.spawn_agent(parent_path="/root", task_name="a", message="again")
        assert r["success"] is False
        assert "已存在" in r["error"]
    asyncio.run(run())


def test_spawn_parent_not_exist():
    async def run():
        reg = MultiAgentRegistry()
        r = await reg.spawn_agent(parent_path="/root/missing", task_name="x", message="x")
        assert r["success"] is False
        assert "父节点不存在" in r["error"]
    asyncio.run(run())


def test_spawn_invalid_task_name():
    async def run():
        reg = MultiAgentRegistry()
        r = await reg.spawn_agent(parent_path="/root", task_name="bad name", message="x")
        assert r["success"] is False
        assert "非法 task_name" in r["error"]
    asyncio.run(run())


def test_wait_completed():
    async def run():
        reg = MultiAgentRegistry()
        await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        # 立即标记完成
        reg.signal_completion("/root/a", result="完成")
        r = await reg.wait_agent("/root/a", timeout=1)
        assert r["success"] is True
        assert r["status"] == "completed"
        assert r["result"] == "完成"
    asyncio.run(run())


def test_wait_timeout():
    async def run():
        reg = MultiAgentRegistry()
        await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        r = await reg.wait_agent("/root/a", timeout=0.1)
        assert r["success"] is False
        assert "超时" in r["error"]
    asyncio.run(run())


def test_wait_not_exist():
    async def run():
        reg = MultiAgentRegistry()
        r = await reg.wait_agent("/root/missing", timeout=1)
        assert r["success"] is False
        assert "不存在" in r["error"]
    asyncio.run(run())


def test_close_basic():
    async def run():
        reg = MultiAgentRegistry()
        await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        r = await reg.close_agent("/root/a")
        assert r["success"] is True
        assert r["closed"] == 1
        assert reg._nodes["/root/a"].status == "closed"
        assert reg._slots["/root/a"].state == "released"
    asyncio.run(run())


def test_close_recursive():
    async def run():
        reg = MultiAgentRegistry()
        await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        await reg.spawn_agent(parent_path="/root/a", task_name="b", message="b")
        await reg.spawn_agent(parent_path="/root/a", task_name="c", message="c")
        r = await reg.close_agent("/root/a", recursive=True)
        assert r["success"] is True
        assert r["closed"] == 3  # a + b + c
    asyncio.run(run())


def test_close_not_exist():
    async def run():
        reg = MultiAgentRegistry()
        r = await reg.close_agent("/root/missing")
        assert r["success"] is False
        assert "不存在" in r["error"]
    asyncio.run(run())


def test_send_message():
    async def run():
        reg = MultiAgentRegistry()
        await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        r = await reg.send_message("/root", "/root/a", "你好")
        assert r["success"] is True
        assert r["msg_id"].startswith("msg-")
        msgs = reg.get_messages()
        assert len(msgs) == 1
    asyncio.run(run())


def test_send_message_not_exist():
    async def run():
        reg = MultiAgentRegistry()
        r = await reg.send_message("/root", "/root/missing", "hi")
        assert r["success"] is False
    asyncio.run(run())


def test_send_message_empty_body():
    async def run():
        reg = MultiAgentRegistry()
        await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        r = await reg.send_message("/root", "/root/a", "")
        assert r["success"] is False
    asyncio.run(run())


def test_followup_reactivate():
    async def run():
        reg = MultiAgentRegistry()
        await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        await reg.close_agent("/root/a")
        r = await reg.followup_task("/root", "/root/a", "新任务")
        assert r["success"] is True
        assert r["reactivated"] is True
        assert reg._nodes["/root/a"].status == "running"
    asyncio.run(run())


def test_followup_no_target():
    async def run():
        reg = MultiAgentRegistry()
        r = await reg.followup_task("/root", "/root/missing", "task")
        assert r["success"] is False
    asyncio.run(run())


def test_list_agents():
    async def run():
        reg = MultiAgentRegistry()
        await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        await reg.spawn_agent(parent_path="/root", task_name="b", message="b")
        await reg.spawn_agent(parent_path="/root/a", task_name="c", message="c")
        # 全部
        all_nodes = reg.list_agents()
        assert len(all_nodes) == 4  # root + a + b + c
        # 仅 /root 直接子节点
        children = reg.list_agents(parent_path="/root")
        assert len(children) == 2
        # 按状态过滤
        running = reg.list_agents(status="running")
        assert len(running) == 4
    asyncio.run(run())


def test_get_tree():
    async def run():
        reg = MultiAgentRegistry()
        await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        await reg.spawn_agent(parent_path="/root/a", task_name="b", message="b")
        tree = reg.get_tree()
        assert tree["path"] == "/root"
        assert len(tree["children"]) == 1
        assert tree["children"][0]["path"] == "/root/a"
        assert len(tree["children"][0]["children"]) == 1
    asyncio.run(run())


def test_get_stats():
    async def run():
        reg = MultiAgentRegistry(max_threads=5, max_depth=3)
        await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        await reg.spawn_agent(parent_path="/root", task_name="b", message="b")
        stats = reg.get_stats()
        assert stats["total"] == 3  # root + a + b
        assert stats["active_slots"] == 2
        assert stats["max_threads"] == 5
        assert stats["max_depth"] == 3
        assert stats["by_status"]["running"] == 3
    asyncio.run(run())


def test_get_messages_filter():
    async def run():
        reg = MultiAgentRegistry()
        await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        await reg.send_message("/root", "/root/a", "msg1")
        await reg.send_message("/root/a", "/root", "msg2")
        # 全部
        all_msgs = reg.get_messages()
        assert len(all_msgs) == 2
        # 仅 /root
        root_msgs = reg.get_messages(path="/root")
        assert len(root_msgs) == 2  # 收发各 1 条均匹配
    asyncio.run(run())


def test_auto_cleanup():
    async def run():
        reg = MultiAgentRegistry()
        await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        # 注意：signal_completion 本身会 release slot，
        # 这里改用 close_agent 模拟"完成但未释放"的场景
        await reg.close_agent("/root/a")
        # 重新激活 + 标记完成（不释放 slot）
        await reg.followup_task("/root", "/root/a", "重做")
        reg.signal_completion("/root/a", result="done2")
        # 槽位已被释放
        assert reg._slots["/root/a"].state == "released"
        # auto_cleanup 应当无操作
        r = await reg.auto_cleanup_on_turn("/root")
        assert r["success"] is True
    asyncio.run(run())


def test_signal_completion_failed():
    async def run():
        reg = MultiAgentRegistry()
        await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        reg.signal_completion("/root/a", error="出错了")
        assert reg._nodes["/root/a"].status == "failed"
    asyncio.run(run())


def test_signal_completion_not_exist():
    reg = MultiAgentRegistry()
    r = reg.signal_completion("/root/missing", result="x")
    assert r["success"] is False


def test_force_delete():
    async def run():
        reg = MultiAgentRegistry()
        await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        r = await reg.force_delete("/root/a")
        assert r["success"] is True
        assert "/root/a" not in reg._nodes
    asyncio.run(run())


def test_force_delete_with_children_requires_recursive():
    async def run():
        reg = MultiAgentRegistry()
        await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        await reg.spawn_agent(parent_path="/root/a", task_name="b", message="b")
        r = await reg.force_delete("/root/a", recursive=False)
        assert r["success"] is False
        assert "有子节点" in r["error"]
        r2 = await reg.force_delete("/root/a", recursive=True)
        assert r2["success"] is True
        assert r2["deleted"] == 2
    asyncio.run(run())


def test_clear_all():
    async def run():
        reg = MultiAgentRegistry()
        await reg.spawn_agent(parent_path="/root", task_name="a", message="a")
        await reg.spawn_agent(parent_path="/root", task_name="b", message="b")
        r = await reg.clear_all()
        assert r["success"] is True
        assert r["cleared"] == 2
        # /root 仍保留
        assert "/root" in reg._nodes
    asyncio.run(run())


def test_global_registry():
    """全局 registry 按 session 隔离"""
    from app.services.multi_agent_registry import get_registry
    r1 = get_registry("test-iso-1")
    r2 = get_registry("test-iso-2")
    r3 = get_registry("test-iso-1")
    assert r1 is r3
    assert r1 is not r2


# ============================================================
# 主测试
# ============================================================
def main():
    runner = TestRunner()

    print("\n[1] 路径解析")
    runner.run("parse_path/path_depth", test_path_parsing)
    runner.run("is_valid_task_name", test_is_valid_task_name)
    runner.run("join_path", test_join_path)

    print("\n[2] Registry 初始化")
    runner.run("init", test_registry_init)
    runner.run("global get_registry session 隔离", test_global_registry)

    print("\n[3] spawn_agent")
    runner.run("基本 spawn", test_spawn_basic)
    runner.run("嵌套 spawn", test_spawn_nested)
    runner.run("max_depth 限制", test_spawn_max_depth_limit)
    runner.run("max_threads 限制", test_spawn_max_threads_limit)
    runner.run("同名冲突", test_spawn_duplicate_task_name)
    runner.run("父节点不存在", test_spawn_parent_not_exist)
    runner.run("非法 task_name", test_spawn_invalid_task_name)

    print("\n[4] wait_agent")
    runner.run("已完成节点", test_wait_completed)
    runner.run("超时", test_wait_timeout)
    runner.run("不存在", test_wait_not_exist)

    print("\n[5] close_agent")
    runner.run("基本关闭", test_close_basic)
    runner.run("递归关闭", test_close_recursive)
    runner.run("不存在", test_close_not_exist)

    print("\n[6] send_message / followup_task")
    runner.run("send 正常", test_send_message)
    runner.run("send 接收方不存在", test_send_message_not_exist)
    runner.run("send 空内容", test_send_message_empty_body)
    runner.run("followup 重新激活", test_followup_reactivate)
    runner.run("followup 目标不存在", test_followup_no_target)

    print("\n[7] 查询 API")
    runner.run("list_agents", test_list_agents)
    runner.run("get_tree", test_get_tree)
    runner.run("get_stats", test_get_stats)
    runner.run("get_messages 过滤", test_get_messages_filter)

    print("\n[8] 内部清理 / 管理")
    runner.run("auto_cleanup_on_turn", test_auto_cleanup)
    runner.run("signal_completion failed", test_signal_completion_failed)
    runner.run("signal_completion 不存在", test_signal_completion_not_exist)
    runner.run("force_delete", test_force_delete)
    runner.run("force_delete 有子节点需 recursive", test_force_delete_with_children_requires_recursive)
    runner.run("clear_all", test_clear_all)

    ok = runner.summary()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
