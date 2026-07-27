"""
# ============================================================
# 测试数据清理脚本 - Test Data Cleanup
# ============================================================
# 用途：在运行 E2E 测试套件前清理数据库中累积的测试会话
# 原因：避免测试数据污染导致 lineage / fork 等测试因历史数据失败
# 使用方法：
#   python3 tests/cleanup_test_data.py
#   或
#   python3 tests/cleanup_test_data.py --dry-run  # 仅显示不删除
# ============================================================
"""

import argparse
import asyncio
import sys
from pathlib import Path

# 添加项目根目录到 sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))


async def cleanup_test_sessions(dry_run: bool = False) -> dict:
    """清理所有测试相关的会话数据

    Args:
        dry_run: 仅显示将删除的会话数，不实际删除

    Returns:
        dict: {"sessions_deleted": int, "conversations_deleted": int}
    """
    from backend.app.database import get_session_factory
    from backend.app.models import Session, Conversation
    from sqlalchemy import select, delete, func

    factory = get_session_factory()
    result = {"sessions_deleted": 0, "conversations_deleted": 0}

    async with factory() as db:
        # 查找所有测试会话（按命名模式）
        test_patterns = [
            "%测试%",
            "%test%",
            "%e2e%",
            "%fork%",
            "%源会话%",
        ]

        # 统计匹配的会话
        total_sessions = 0
        for pattern in test_patterns:
            count_stmt = select(func.count(Session.id)).where(
                Session.title.like(pattern)
            )
            count_result = await db.execute(count_stmt)
            count = count_result.scalar() or 0
            total_sessions += count

        print(f"[清理] 找到 {total_sessions} 个测试会话")

        if dry_run:
            print("[DRY-RUN] 仅显示，不删除")
            return result

        # 先删除这些会话的所有 conversations（外键约束）
        for pattern in test_patterns:
            # 找出匹配的 session_ids
            id_stmt = select(Session.id).where(Session.title.like(pattern))
            id_result = await db.execute(id_stmt)
            session_ids = [row[0] for row in id_result.fetchall()]

            if session_ids:
                # 删除相关 conversations
                conv_delete = await db.execute(
                    delete(Conversation).where(
                        Conversation.session_id.in_(session_ids)
                    )
                )
                result["conversations_deleted"] += conv_delete.rowcount or 0

                # 删除 sessions
                sess_delete = await db.execute(
                    delete(Session).where(Session.id.in_(session_ids))
                )
                result["sessions_deleted"] += sess_delete.rowcount or 0

        await db.commit()
        print(
            f"[清理] 已删除 {result['sessions_deleted']} 个会话, "
            f"{result['conversations_deleted']} 条消息"
        )

    return result


async def main():
    """主函数"""
    parser = argparse.ArgumentParser(description="清理 E2E 测试累积的数据")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="仅显示将删除的数据，不实际删除",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("测试数据清理脚本")
    print("=" * 60)

    try:
        result = await cleanup_test_sessions(dry_run=args.dry_run)
        print("=" * 60)
        if args.dry_run:
            print(f"[DRY-RUN 完成] 将删除 {result['sessions_deleted']} 个会话")
        else:
            print(
                f"[清理完成] 删除 {result['sessions_deleted']} 个会话, "
                f"{result['conversations_deleted']} 条消息"
            )
    except Exception as e:
        print(f"[错误] 清理失败: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
