"""
# ============================================================
# T2 长会话压缩 (Compaction) 端到端测试
# ============================================================
# 测试范围：
#   1. TokenCounter 准确性
#   2. SummaryGenerator 本地降级
#   3. CompactionService 配置读写
#   4. 真实会话压缩流程
# ============================================================
"""

import asyncio
import sys
import json
from pathlib import Path

# 添加项目根到路径
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from backend.app.services.compaction import (
    TokenCounter,
    SummaryGenerator,
    CompactionService,
    DEFAULT_CONFIG,
)


def test_token_counter():
    """测试 TokenCounter 准确性"""
    print("\n=== Test 1: TokenCounter ===")
    # 空文本
    assert TokenCounter.count_text("") == 0
    # 短文本
    assert TokenCounter.count_text("hi") >= 1
    # 长文本（100 字符 ≈ 40 token）
    text = "x" * 100
    tokens = TokenCounter.count_text(text)
    assert 30 <= tokens <= 50, f"100 chars should give ~40 tokens, got {tokens}"
    # 消息列表
    messages = [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi there!"},
    ]
    total = TokenCounter.count_messages(messages)
    assert total > 0
    print(f"  ✅ 100 chars → {tokens} tokens (expect ~40)")
    print(f"  ✅ 2 messages → {total} tokens")
    return True


def test_summary_generator():
    """测试 SummaryGenerator 本地降级"""
    print("\n=== Test 2: SummaryGenerator ===")
    gen = SummaryGenerator()  # 无 LLM，使用本地降级
    messages = [
        {"role": "user", "content": "我想实现一个 TODO 应用"},
        {"role": "assistant", "content": "好的，请问需要哪些功能？"},
        {"role": "user", "content": "添加、删除、标记完成"},
        {"role": "assistant", "content": "明白了，我来设计架构"},
        {"role": "user", "content": "使用 React 框架"},
    ]
    summary = asyncio.run(gen.generate(messages, max_length=500))
    assert isinstance(summary, str)
    assert len(summary) > 0
    print(f"  ✅ 本地摘要生成: {len(summary)} chars")
    print(f"  ✅ 摘要前 100 字符: {summary[:100]}")
    return True


async def test_compaction_e2e():
    """测试 CompactionService 端到端"""
    print("\n=== Test 3: CompactionService E2E ===")
    from backend.app.database import init_db, get_session_factory
    from backend.app.models import Session, Conversation
    from datetime import datetime, timezone
    import uuid

    await init_db()
    factory = get_session_factory()

    # 创建测试 session
    test_session_id = f"test-compact-{uuid.uuid4().hex[:8]}"
    async with factory() as session:
        new_session = Session(
            id=test_session_id,
            title="压缩测试会话",
            user_first_message="测试压缩",
            status="active",
            mode="chat",
            created_at=datetime.now(timezone.utc),
            last_active_at=datetime.now(timezone.utc),
        )
        session.add(new_session)
        # 创建 60 条消息（足够触发压缩）
        for i in range(60):
            msg = Conversation(
                id=str(uuid.uuid4()),
                session_id=test_session_id,
                role="user" if i % 2 == 0 else "assistant",
                content=f"这是第 {i+1} 条测试消息，模拟一个长对话中的内容。" * 5,
            )
            session.add(msg)
        await session.commit()

    # 创建 service
    svc = CompactionService(session_factory=factory)

    # 检查统计
    stats = await svc.get_session_stats(test_session_id)
    print(f"  ✅ 初始 stats: {stats}")
    assert stats["message_count"] == 60
    assert stats["token_count"] > 0

    # 检查 should_trigger
    should, _ = await svc.should_trigger(test_session_id)
    print(f"  ✅ should_compact: {should}")
    # 60 条消息 > 50 阈值，应触发
    assert should is True

    # 执行压缩
    result = await svc.compact(
        session_id=test_session_id,
        strategy="hybrid",
        keep_recent=10,
    )
    print(f"  ✅ 压缩结果: success={result['success']}")
    print(f"  ✅ before: {result['before']}")
    print(f"  ✅ after: {result['after']}")
    print(f"  ✅ 摘要前 100 字符: {result['summary'][:100]}")
    print(f"  ✅ compacted_count={result['compacted_count']}, kept_count={result['kept_count']}")
    assert result["success"] is True
    assert result["compacted_count"] > 0
    assert result["after"]["active_count"] < result["before"]["active_count"]

    # 验证：被压缩的消息已标记 is_compacted=True
    async with factory() as session:
        from sqlalchemy import select
        result_q = await session.execute(
            select(Conversation).where(
                Conversation.session_id == test_session_id,
                Conversation.is_compacted == True,
            )
        )
        compacted = result_q.scalars().all()
        assert len(compacted) == result["compacted_count"]
        print(f"  ✅ 数据库验证: {len(compacted)} 条消息已标记 is_compacted=True")

    # 验证：summary 消息已写入
    async with factory() as session:
        from sqlalchemy import select
        result_q = await session.execute(
            select(Conversation).where(
                Conversation.session_id == test_session_id,
                Conversation.content.like("[压缩摘要]%"),
            )
        )
        summary_msgs = result_q.scalars().all()
        assert len(summary_msgs) >= 1
        print(f"  ✅ 摘要消息: {len(summary_msgs)} 条已写入")

    # 清理
    async with factory() as session:
        from sqlalchemy import text
        await session.execute(
            text("DELETE FROM conversations WHERE session_id = :sid"),
            {"sid": test_session_id},
        )
        await session.execute(
            text("DELETE FROM sessions WHERE id = :sid"),
            {"sid": test_session_id},
        )
        await session.commit()
    print(f"  ✅ 清理测试数据")

    return True


def test_config_management():
    """测试配置管理"""
    print("\n=== Test 4: Config Management ===")
    svc = CompactionService(session_factory=None)
    # 默认配置
    config = svc.get_config()
    assert config["strategy"] == "hybrid"
    print(f"  ✅ 默认配置: {config}")

    # 更新配置
    new_config = svc.update_config({"max_tokens": 10000, "strategy": "sliding"})
    assert new_config["max_tokens"] == 10000
    assert new_config["strategy"] == "sliding"
    print(f"  ✅ 更新后: max_tokens={new_config['max_tokens']}, strategy={new_config['strategy']}")

    # 无效键
    new_config = svc.update_config({"invalid_key": "x"})
    assert "invalid_key" not in new_config
    print(f"  ✅ 拒绝无效键")

    return True


def main():
    """运行所有测试"""
    print("=" * 60)
    print("T2 Compaction 测试套件")
    print("=" * 60)

    results = []
    results.append(("TokenCounter", test_token_counter()))
    results.append(("SummaryGenerator", test_summary_generator()))
    results.append(("Config Management", test_config_management()))

    # E2E 测试（需要数据库）
    try:
        results.append(("Compaction E2E", asyncio.run(test_compaction_e2e())))
    except Exception as e:
        print(f"  ❌ E2E 测试失败: {e}")
        import traceback
        traceback.print_exc()
        results.append(("Compaction E2E", False))

    print("\n" + "=" * 60)
    print("测试结果:")
    for name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"  {status} | {name}")
    all_passed = all(p for _, p in results)
    print("=" * 60)
    print(f"总览: {sum(1 for _, p in results if p)}/{len(results)} 通过")
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
