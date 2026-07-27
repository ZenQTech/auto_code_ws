"""
# ============================================================
# Session Rollout JSONL 单元测试
# ============================================================
# 覆盖范围：
#   1. RolloutItem 序列化/反序列化
#   2. RolloutWriter 各种 append 方法
#   3. RolloutReader 各种 read 方法
#   4. SessionRolloutService 高层 API
#   5. 边界场景（空、损坏、大文件）
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 7 P0-9
# ============================================================
"""

import asyncio
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

# 设置 Python 路径
sys.path.insert(0, "/home/qizheng/auto_code_ws/backend")
sys.path.insert(0, "/home/qizheng/auto_code_ws")

PASS_COUNT = 0
FAIL_COUNT = 0


def section(name: str) -> None:
    """打印测试段标题"""
    print(f"\n=== {name} ===")


def test_pass(name: str) -> None:
    """测试通过"""
    global PASS_COUNT
    PASS_COUNT += 1
    print(f"  ✅ {name}")


def test_fail(name: str, detail: str = "") -> None:
    """测试失败"""
    global FAIL_COUNT
    FAIL_COUNT += 1
    print(f"  ❌ {name}")
    if detail:
        print(f"     详情: {detail}")


async def test_rollout_item_serialization():
    """Test 1: RolloutItem 序列化/反序列化"""
    section("Test 1: RolloutItem 序列化（4 个测试）")
    try:
        from app.services.rollout_jsonl import RolloutItem, RolloutItemType

        # Test 1.1: 基本序列化
        item = RolloutItem(
            type=RolloutItemType.SESSION_META.value,
            ts=1722000000.123,
            payload={"id": "sess-1", "title": "测试"},
            turn_id=None,
        )
        line = item.to_jsonl_line()
        assert b"session_meta" in line
        assert b"sess-1" in line
        test_pass("RolloutItem.to_jsonl_line() 正确序列化")

        # Test 1.2: 反序列化
        item2 = RolloutItem.from_jsonl_line(line.decode("utf-8").strip())
        assert item2.type == "session_meta"
        assert item2.payload["id"] == "sess-1"
        test_pass("RolloutItem.from_jsonl_line() 正确反序列化")

        # Test 1.3: to_dict 不含索引字段
        d = item.to_dict()
        assert "line_no" not in d
        assert "byte_offset" not in d
        assert "byte_length" not in d
        test_pass("to_dict() 不包含索引字段")

        # Test 1.4: 包含 turn_id 的序列化
        item3 = RolloutItem(
            type=RolloutItemType.TURN_CONTEXT.value,
            ts=1722000001.0,
            payload={"turn_id": "turn-1"},
            turn_id="turn-1",
        )
        d3 = item3.to_dict()
        assert d3["turn_id"] == "turn-1"
        test_pass("含 turn_id 的序列化正确")
    except Exception as e:
        test_fail("RolloutItem 序列化", str(e))


async def test_rollout_writer():
    """Test 2: RolloutWriter 各种 append 方法"""
    section("Test 2: RolloutWriter（7 个测试）")
    tmp_dir = tempfile.mkdtemp(prefix="rollout_writer_")
    try:
        from app.services.rollout_jsonl import (
            RolloutWriter, RolloutReader, RolloutItemType,
            ResponseItemType, EventMsgType,
        )

        writer = RolloutWriter(base_dir=tmp_dir)
        reader = RolloutReader(base_dir=tmp_dir)
        session_id = "test-session-1"

        # Test 2.1: append_item 基本
        item = await writer.append_item(
            session_id=session_id,
            item_type=RolloutItemType.SESSION_META.value,
            payload={"id": session_id, "title": "test"},
        )
        assert item.line_no == 1
        assert item.byte_offset == 0
        assert item.byte_length > 0
        test_pass("append_item() 正确返回 line_no/byte_offset")

        # Test 2.2: 多次 append
        item2 = await writer.append_item(
            session_id=session_id,
            item_type=RolloutItemType.RESPONSE_ITEM.value,
            payload={"item_type": "text", "text": "hi"},
        )
        assert item2.line_no == 2
        assert item2.byte_offset == item.byte_length
        test_pass("多次 append() 正确递增 line_no 和 offset")

        # Test 2.3: append_turn_context
        item3 = await writer.append_turn_context(
            session_id=session_id,
            turn_id="turn-abc",
            user_prompt="hello world",
        )
        assert item3.turn_id == "turn-abc"
        assert item3.payload["turn_id"] == "turn-abc"
        test_pass("append_turn_context() 设置 turn_id")

        # Test 2.4: append_response_item text
        item4 = await writer.append_response_item(
            session_id=session_id,
            item_type=ResponseItemType.TEXT.value,
            text="AI 响应",
        )
        assert item4.payload["text"] == "AI 响应"
        test_pass("append_response_item(text) 正确")

        # Test 2.5: append_response_item function_call
        item5 = await writer.append_response_item(
            session_id=session_id,
            item_type=ResponseItemType.FUNCTION_CALL.value,
            name="Bash",
            arguments='{"command":"ls"}',
            call_id="call-1",
        )
        assert item5.payload["name"] == "Bash"
        assert item5.payload["call_id"] == "call-1"
        test_pass("append_response_item(function_call) 正确")

        # Test 2.6: append_event
        item6 = await writer.append_event(
            session_id=session_id,
            event=EventMsgType.TOKEN_COUNT.value,
            input=100,
            output=200,
        )
        assert item6.payload["event"] == "token_count"
        assert item6.payload["input"] == 100
        test_pass("append_event() 正确")

        # Test 2.7: append_compacted
        item7 = await writer.append_compacted(
            session_id=session_id,
            turn_range="turn-1..turn-5",
            summary="压缩摘要",
        )
        assert item7.payload["range"] == "turn-1..turn-5"
        test_pass("append_compacted() 正确")
    except Exception as e:
        test_fail("RolloutWriter", str(e))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


async def test_rollout_reader():
    """Test 3: RolloutReader 各种 read 方法"""
    section("Test 3: RolloutReader（6 个测试）")
    tmp_dir = tempfile.mkdtemp(prefix="rollout_reader_")
    try:
        from app.services.rollout_jsonl import (
            RolloutWriter, RolloutReader, RolloutItemType,
        )

        writer = RolloutWriter(base_dir=tmp_dir)
        reader = RolloutReader(base_dir=tmp_dir)
        session_id = "test-session-r"

        # 准备数据
        for i in range(10):
            await writer.append_item(
                session_id=session_id,
                item_type=RolloutItemType.TURN_CONTEXT.value,
                payload={"turn_id": f"turn-{i}", "user_prompt": f"msg-{i}"},
                turn_id=f"turn-{i}",
            )

        # Test 3.1: read_all
        items = reader.read_all(session_id)
        assert len(items) == 10
        test_pass(f"read_all() 返回 {len(items)} items")

        # Test 3.2: read_paginated
        page1, total = reader.read_paginated(session_id, limit=3, offset=0)
        assert total == 10
        assert len(page1) == 3
        assert page1[0].line_no == 1
        test_pass("read_paginated(limit=3, offset=0) 返回前 3 条")

        # Test 3.3: read_paginated offset
        page2, _ = reader.read_paginated(session_id, limit=3, offset=7)
        assert len(page2) == 3
        assert page2[0].line_no == 8
        test_pass("read_paginated(limit=3, offset=7) 返回 8-10 条")

        # Test 3.4: read_around_turn
        ctx = reader.read_around_turn(session_id, "turn-5", context_before=2, context_after=2)
        assert len(ctx) == 5
        assert ctx[2].turn_id == "turn-5"
        test_pass("read_around_turn 正确返回 5 条上下文")

        # Test 3.5: exists
        assert reader.exists(session_id) is True
        test_pass("exists() 正确返回 True")

        # Test 3.6: 不存在的会话
        items_none = reader.read_all("nonexistent")
        assert items_none == []
        test_pass("不存在的会话返回空列表")
    except Exception as e:
        test_fail("RolloutReader", str(e))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


async def test_rollout_corruption_tolerance():
    """Test 4: 损坏文件容错"""
    section("Test 4: 损坏文件容错（3 个测试）")
    tmp_dir = tempfile.mkdtemp(prefix="rollout_corrupt_")
    try:
        from app.services.rollout_jsonl import (
            RolloutWriter, RolloutReader, RolloutItemType,
        )

        writer = RolloutWriter(base_dir=tmp_dir)
        reader = RolloutReader(base_dir=tmp_dir)
        session_id = "test-corrupt"

        # 写入有效数据
        await writer.append_item(
            session_id=session_id,
            item_type=RolloutItemType.SESSION_META.value,
            payload={"id": session_id},
        )

        # 手动追加损坏行
        file_path = Path(tmp_dir) / f"{session_id}.jsonl"
        with open(file_path, "ab") as f:
            f.write(b"{invalid json line\n")
            f.write(b"{also bad\n")

        # 再追加一行有效数据
        await writer.append_item(
            session_id=session_id,
            item_type=RolloutItemType.SESSION_META.value,
            payload={"id": "second"},
        )

        # Test 4.1: 读取时跳过损坏行
        items = reader.read_all(session_id)
        # 应该跳过 2 行损坏数据，返回 2 条有效
        assert len(items) == 2
        test_pass(f"读取时跳过 {2} 行损坏数据，返回 {len(items)} 条有效数据")

        # Test 4.2: 损坏行不导致崩溃
        assert all(isinstance(item.to_dict()["type"], str) for item in items)
        test_pass("损坏行不导致解析崩溃")

        # Test 4.3: 损坏行有警告日志
        # 仅验证无异常抛出
        reader.read_all(session_id)
        test_pass("损坏文件读取稳定")
    except Exception as e:
        test_fail("损坏文件容错", str(e))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


async def test_session_rollout_service():
    """Test 5: SessionRolloutService 高层 API"""
    section("Test 5: SessionRolloutService（6 个测试）")
    tmp_dir = tempfile.mkdtemp(prefix="rollout_svc_")
    try:
        from app.services.session_rollout_service import SessionRolloutService

        # mock session factory
        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=None)
        mock_session.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None)))
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()

        async def mock_factory():
            return mock_session

        svc = SessionRolloutService(
            session_factory=mock_factory,
            base_dir=tmp_dir,
        )
        session_id = "test-svc-1"

        # Test 5.1: record_turn 返回 turn_id
        turn_id, item = await svc.record_turn(
            session_id=session_id,
            user_prompt="测试问题",
        )
        assert turn_id.startswith("turn-")
        assert item.type == "turn_context"
        test_pass(f"record_turn() 返回 turn_id={turn_id[:16]}...")

        # Test 5.2: record_response_text
        item = await svc.record_response_text(
            session_id=session_id,
            text="AI 响应",
            turn_id=turn_id,
        )
        assert item.payload["text"] == "AI 响应"
        test_pass("record_response_text() 正确")

        # Test 5.3: record_response_function_call
        item = await svc.record_response_function_call(
            session_id=session_id,
            name="Bash",
            arguments="{}",
            call_id="c-1",
            turn_id=turn_id,
        )
        assert item.payload["name"] == "Bash"
        test_pass("record_response_function_call() 正确")

        # Test 5.4: paginate_history
        result = svc.paginate_history(session_id, limit=10, offset=0)
        assert result["success"] is True
        assert result["total_items"] >= 3
        test_pass(f"paginate_history() 返回 {result['total_items']} items")

        # Test 5.5: export_session
        exp = svc.export_session(session_id, compressed=False)
        assert exp["success"] is True
        assert exp["format"] == "jsonl"
        assert exp["item_count"] >= 3
        test_pass(f"export_session() 返回 {exp['item_count']} items")

        # Test 5.6: import_session
        new_id = "imported-session"
        imp = svc.import_session(new_id, exp["content"])
        assert imp["success"] is True
        assert imp["items_imported"] == exp["item_count"]
        test_pass(f"import_session() 导入 {imp['items_imported']} items")
    except Exception as e:
        test_fail("SessionRolloutService", str(e))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


async def test_fork_at_turn():
    """Test 6: fork_at_turn 高级 fork"""
    section("Test 6: fork_at_turn（4 个测试）")
    tmp_dir = tempfile.mkdtemp(prefix="rollout_fork_")
    try:
        from app.services.session_rollout_service import SessionRolloutService

        # mock session factory
        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=None)
        mock_session.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None)))
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()

        async def mock_factory():
            return mock_session

        svc = SessionRolloutService(
            session_factory=mock_factory,
            base_dir=tmp_dir,
        )
        source_id = "source-fork-test"

        # 准备数据：3 个 turn
        turn_ids = []
        for i in range(3):
            tid, _ = await svc.record_turn(
                session_id=source_id,
                user_prompt=f"turn-{i} prompt",
            )
            turn_ids.append(tid)
            await svc.record_response_text(
                session_id=source_id,
                text=f"turn-{i} response",
                turn_id=tid,
            )

        # Test 6.1: 复制不存在的 turn
        result = await svc.fork_at_turn(
            source_session_id=source_id,
            before_turn_id="nonexistent",
        )
        assert result["success"] is False
        test_pass("fork_at_turn 不存在的 turn → 失败")

        # Test 6.2: 正确 fork
        result = await svc.fork_at_turn(
            source_session_id=source_id,
            before_turn_id=turn_ids[1],  # 在第 2 个 turn 之前
            title="Fork Test",
        )
        assert result["success"] is True
        new_id = result["session"]["id"]
        assert result["items_copied"] >= 3  # session_meta + turn 0 + response 0
        test_pass(f"fork_at_turn() 复制 {result['items_copied']} items")

        # Test 6.3: 新会话的 items 数 <= 源会话
        src_info = svc.get_rollout_info(source_id)
        new_info = svc.get_rollout_info(new_id)
        assert new_info["item_count"] < src_info["item_count"]
        test_pass(f"新会话 items={new_info['item_count']} < 源会话={src_info['item_count']}")

        # Test 6.4: lineage 字段
        assert result["session"]["parent_session_id"] == source_id
        assert result["session"]["fork_turn_id"] == turn_ids[1]
        test_pass("fork_at_turn lineage 字段正确")
    except Exception as e:
        test_fail("fork_at_turn", str(e))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


async def test_get_rollout_info():
    """Test 7: get_rollout_info 状态查询"""
    section("Test 7: get_rollout_info（3 个测试）")
    tmp_dir = tempfile.mkdtemp(prefix="rollout_info_")
    try:
        from app.services.session_rollout_service import SessionRolloutService

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=None)
        mock_session.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None)))

        async def mock_factory():
            return mock_session

        svc = SessionRolloutService(
            session_factory=mock_factory,
            base_dir=tmp_dir,
        )
        session_id = "info-test"

        # Test 7.1: 不存在
        info = svc.get_rollout_info(session_id)
        assert info["exists"] is False
        test_pass("get_rollout_info 不存在 → exists=False")

        # Test 7.2: 存在
        for i in range(3):
            await svc.record_turn(
                session_id=session_id,
                user_prompt=f"q{i}",
            )
        info = svc.get_rollout_info(session_id)
        assert info["exists"] is True
        assert info["turn_count"] == 3
        assert info["item_count"] >= 6  # 3 turn_context + 3 user_message
        test_pass(f"get_rollout_info 存在 → turn_count={info['turn_count']}")

        # Test 7.3: type_counts
        assert "turn_context" in info["type_counts"]
        assert "event_msg" in info["type_counts"]
        test_pass(f"type_counts 包含 {list(info['type_counts'].keys())}")
    except Exception as e:
        test_fail("get_rollout_info", str(e))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


async def test_pagination_edge_cases():
    """Test 8: 分页边界场景"""
    section("Test 8: 分页边界（4 个测试）")
    tmp_dir = tempfile.mkdtemp(prefix="rollout_page_")
    try:
        from app.services.session_rollout_service import SessionRolloutService

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=None)

        async def mock_factory():
            return mock_session

        svc = SessionRolloutService(
            session_factory=mock_factory,
            base_dir=tmp_dir,
        )

        # Test 8.1: limit < 1
        result = svc.paginate_history("any", limit=0, offset=0)
        assert result["success"] is False
        test_pass("limit=0 → 失败")

        # Test 8.2: limit > 500
        result = svc.paginate_history("any", limit=501, offset=0)
        assert result["success"] is False
        test_pass("limit=501 → 失败")

        # Test 8.3: offset < 0
        result = svc.paginate_history("any", limit=10, offset=-1)
        assert result["success"] is False
        test_pass("offset=-1 → 失败")

        # Test 8.4: 不存在的会话分页
        result = svc.paginate_history("nonexistent-page", limit=10, offset=0)
        assert result["success"] is True
        assert result["total_items"] == 0
        test_pass("不存在会话分页 → total=0")
    except Exception as e:
        test_fail("分页边界", str(e))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


async def main():
    """主测试入口"""
    print("=" * 60)
    print("Session Rollout JSONL 单元测试")
    print("=" * 60)

    await test_rollout_item_serialization()
    await test_rollout_writer()
    await test_rollout_reader()
    await test_rollout_corruption_tolerance()
    await test_session_rollout_service()
    await test_fork_at_turn()
    await test_get_rollout_info()
    await test_pagination_edge_cases()

    print("\n" + "=" * 60)
    print(f"测试结果: {PASS_COUNT} 通过 / {FAIL_COUNT} 失败")
    print("=" * 60)

    return FAIL_COUNT == 0


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
