"""
# ============================================================
# T3 会话 fork / resume 端到端测试
# ============================================================
# 测试范围：
#   1. Fork：基于会话分叉，验证消息复制
#   2. Resume：恢复会话，更新设备 ID
#   3. Lineage：查询父子血缘链
#   4. Archive：归档/取消归档
# ============================================================
"""

import asyncio
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))


async def setup_test_data():
    """创建测试数据：1 个 session + 20 条消息"""
    from backend.app.database import init_db, get_session_factory
    from backend.app.models import Session, Conversation

    await init_db()
    factory = get_session_factory()

    source_id = f"test-fork-{uuid.uuid4().hex[:8]}"
    async with factory() as session:
        new_session = Session(
            id=source_id,
            title="源会话（fork测试）",
            user_first_message="第一条用户消息",
            status="active",
            mode="chat",
            created_at=datetime.now(timezone.utc),
            last_active_at=datetime.now(timezone.utc),
        )
        session.add(new_session)
        for i in range(20):
            msg = Conversation(
                id=str(uuid.uuid4()),
                session_id=source_id,
                role="user" if i % 2 == 0 else "assistant",
                content=f"消息 {i+1}: 模拟长对话内容",
            )
            session.add(msg)
        await session.commit()

    return source_id


async def cleanup_test_data(*session_ids):
    """清理测试数据"""
    from backend.app.database import get_session_factory
    from sqlalchemy import text

    factory = get_session_factory()
    async with factory() as session:
        for sid in session_ids:
            await session.execute(text("DELETE FROM conversations WHERE session_id = :sid"), {"sid": sid})
            await session.execute(text("DELETE FROM sessions WHERE id = :sid"), {"sid": sid})
        await session.commit()


async def test_fork():
    """测试 fork"""
    print("\n=== Test 1: Fork ===")
    from backend.app.services.session_fork_resume import SessionForkResumeService
    from backend.app.database import get_session_factory

    source_id = await setup_test_data()
    print(f"  ✅ 创建源会话: {source_id} (20 条消息)")

    factory = get_session_factory()
    svc = SessionForkResumeService(session_factory=factory)

    # Fork at latest point
    result = await svc.fork(
        source_session_id=source_id,
        title="测试 Fork 分支",
    )
    assert result["success"] is True
    new_id = result["session"]["id"]
    print(f"  ✅ Fork 创建新会话: {new_id}")
    print(f"  ✅ 复制消息数: {result['messages_copied']}")
    assert result["messages_copied"] == 20
    assert result["session"]["parent_session_id"] == source_id

    # Fork at point (前 10 条)
    fp_id = None
    async with factory() as session:
        from backend.app.models import Conversation
        from sqlalchemy import select
        result_q = await session.execute(
            select(Conversation).where(
                Conversation.session_id == source_id,
            ).order_by(Conversation.created_at.asc()).limit(10)
        )
        msgs = result_q.scalars().all()
        fp_id = msgs[-1].id if msgs else None

    if fp_id:
        result2 = await svc.fork(
            source_session_id=source_id,
            fork_point_message_id=fp_id,
            title="Fork at 10",
        )
        assert result2["success"] is True
        print(f"  ✅ Fork at 10: 复制 {result2['messages_copied']} 条")
        assert result2["messages_copied"] == 10

    return source_id, new_id


async def test_resume(source_id):
    """测试 resume"""
    print("\n=== Test 2: Resume ===")
    from backend.app.services.session_fork_resume import SessionForkResumeService
    from backend.app.database import get_session_factory

    factory = get_session_factory()
    svc = SessionForkResumeService(session_factory=factory)

    # Resume with device_id
    result = await svc.resume(
        session_id=source_id,
        device_id="test-device-001",
    )
    assert result["success"] is True
    print(f"  ✅ Resume 成功: {result['session']['id']}")
    print(f"  ✅ 消息数: {len(result['messages'])}")
    print(f"  ✅ 设备 ID: {result['session']['device_id']}")
    assert len(result["messages"]) == 20
    assert result["session"]["device_id"] == "test-device-001"


async def test_lineage(source_id, fork_id):
    """测试 lineage"""
    print("\n=== Test 3: Lineage ===")
    from backend.app.services.session_fork_resume import SessionForkResumeService
    from backend.app.database import get_session_factory

    factory = get_session_factory()
    svc = SessionForkResumeService(session_factory=factory)

    # 从 fork 节点查 lineage
    result = await svc.get_lineage(session_id=fork_id)
    assert result["success"] is True
    print(f"  ✅ 从 {fork_id} 查询 lineage")
    print(f"  ✅ 祖先数: {result['ancestor_count']}")
    print(f"  ✅ 后代数: {result['descendant_count']}")
    assert result["ancestor_count"] == 1
    assert result["ancestors"][0]["id"] == source_id
    assert result["root_id"] == source_id

    # 从 source 查 lineage
    result2 = await svc.get_lineage(session_id=source_id)
    print(f"  ✅ 从 {source_id} 查询: ancestor={result2['ancestor_count']}, descendant={result2['descendant_count']}")
    assert result2["ancestor_count"] == 0
    assert result2["descendant_count"] >= 2  # 至少有 2 个 fork


async def test_archive(fork_id):
    """测试 archive"""
    print("\n=== Test 4: Archive ===")
    from backend.app.services.session_fork_resume import SessionForkResumeService
    from backend.app.database import get_session_factory

    factory = get_session_factory()
    svc = SessionForkResumeService(session_factory=factory)

    # 归档
    result = await svc.archive(fork_id, archived=True)
    assert result["success"] is True
    assert result["is_archived"] is True
    print(f"  ✅ 归档 {fork_id}")

    # 取消归档
    result2 = await svc.archive(fork_id, archived=False)
    assert result2["success"] is True
    assert result2["is_archived"] is False
    print(f"  ✅ 取消归档 {fork_id}")


def main():
    print("=" * 60)
    print("T3 Session Fork/Resume 测试套件")
    print("=" * 60)

    async def run_all():
        source_id, fork_id = await test_fork()
        await test_resume(source_id)
        await test_lineage(source_id, fork_id)
        await test_archive(fork_id)
        # 清理所有测试数据
        from backend.app.services.session_fork_resume import SessionForkResumeService
        from backend.app.database import get_session_factory
        factory = get_session_factory()
        async with factory() as session:
            from sqlalchemy import select
            from backend.app.models import Session
            r = await session.execute(
                select(Session).where(Session.parent_session_id == source_id)
            )
            children = r.scalars().all()
            children_ids = [c.id for c in children]
        await cleanup_test_data(source_id, *children_ids)
        print("\n  ✅ 清理测试数据")
        return True

    try:
        result = asyncio.run(run_all())
        print("\n" + "=" * 60)
        print("✅ T3 全部测试通过")
        print("=" * 60)
        return 0
    except Exception as e:
        print(f"\n❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
