"""
# ============================================================
# 垃圾回收后台清理服务（Trash Cleaner）
# ============================================================
# 核心作用：定期扫描标记为 DELETED 的 Session 记录，
#           对超过 7 天保留期的已删除会话执行硬删除（物理删除）
# 运行流程：
#   1. 系统启动时在主应用 lifespan 中调用 start() 启动后台线程
#   2. 后台线程每 60 分钟执行一次清理扫描
#   3. 扫描 sessions 表中 status=DELETED 且 deleted_at < (now - 7 days) 的记录
#   4. 对符合条件的记录及其级联子记录执行硬删除
#   5. 系统关闭时调用 stop() 优雅停止后台线程
# 输入参数：
#   - cleanup_interval_minutes: 清理扫描间隔（默认 60 分钟）
#   - retention_days: 软删除保留天数（默认 7 天）
# 输出结果：每次扫描清理的 Session 数量记录到日志
# 修改记录：
#   - 2026-06-24 | v1.0.0 | 初始版本，实现后台定期硬删除过期软删除会话
# ============================================================
"""

import asyncio
import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select

from backend.app.config import settings
from ..database import get_session_factory
from ..models import (
    Session as SessionORM,
    SessionStatus,
    Agent as AgentORM,
    Task as TaskORM,
    Conversation as ConversationORM,
)

logger = logging.getLogger(__name__)


class TrashCleaner:
    """
    垃圾回收清理器
    作用：定期扫描已软删除（status=DELETED）超过保留期的会话并执行物理删除
    调用方：main.py（应用生命周期管理）
    被调用方：数据库（异步 SQLAlchemy 会话）
    """

    def __init__(
        self,
        cleanup_interval_minutes: int = 60,
        retention_days: int = 7,
    ):
        """
        初始化垃圾回收清理器
        运行步骤：
          1. 从全局配置读取清理参数（如未配置则使用默认值）
          2. 初始化后台线程相关变量
        参数：
          - cleanup_interval_minutes: 清理扫描间隔（分钟），默认 60 分钟
          - retention_days: 软删除保留天数，超过此天数的已删除会话将被硬删除
        """
        # 尝试从配置中读取覆盖参数
        trash_config = settings._config.get("trash", {})
        self.cleanup_interval: int = trash_config.get(
            "cleanup_interval_minutes", cleanup_interval_minutes
        )
        self.retention_days: int = trash_config.get(
            "retention_days", retention_days
        )

        # 后台线程控制
        self._cleanup_thread: Optional[threading.Thread] = None
        self._running: bool = False

        logger.info(
            "垃圾回收清理器初始化完成 | 清理间隔=%d分钟 | 保留天数=%d天",
            self.cleanup_interval,
            self.retention_days,
        )

    # ============================================================
    # 核心清理逻辑
    # ============================================================

    async def cleanup_once(self) -> int:
        """
        单次执行过期软删除会话的硬删除清理
        运行步骤：
          1. 计算保留截止时间（now - retention_days 天）
          2. 查询 sessions 表中 status=DELETED 且 deleted_at < 截止时间的记录
          3. 对每条记录级联删除其关联的 agents、tasks、conversations
          4. 硬删除 Session 本身
          5. 提交事务并记录清理日志
        参数：无
        返回值：本次清理的 Session 数量（int）
        """
        # 计算保留截止时间
        cutoff_time = datetime.now(timezone.utc) - timedelta(days=self.retention_days)

        session_factory = get_session_factory()

        cleaned_count = 0
        async with session_factory() as db:
            # 查询所有需要清理的已删除会话
            result = await db.execute(
                select(SessionORM).where(
                    SessionORM.status == SessionStatus.DELETED,
                    SessionORM.deleted_at.isnot(None),
                    SessionORM.deleted_at < cutoff_time,
                )
            )
            expired_sessions = result.scalars().all()

            if not expired_sessions:
                logger.debug("垃圾回收扫描完成：无过期会话需清理")
                await db.commit()
                return 0

            for session_obj in expired_sessions:
                session_id = session_obj.id
                session_title = session_obj.title or ""

                # 级联删除关联子记录（因 session_id 为非外键字段，需手动删除）
                # 删除对话记录
                conv_result = await db.execute(
                    select(ConversationORM).where(
                        ConversationORM.session_id == session_id
                    )
                )
                for c in conv_result.scalars().all():
                    await db.delete(c)

                # 删除任务记录
                task_result = await db.execute(
                    select(TaskORM).where(TaskORM.session_id == session_id)
                )
                for t in task_result.scalars().all():
                    await db.delete(t)

                # 删除智能体记录
                agent_result = await db.execute(
                    select(AgentORM).where(AgentORM.session_id == session_id)
                )
                for a in agent_result.scalars().all():
                    await db.delete(a)

                # 硬删除 Session 本身
                await db.delete(session_obj)
                cleaned_count += 1

                logger.info(
                    "垃圾回收：已硬删除会话 id=%s title=%r（软删除时间=%s）",
                    session_id[:8],
                    session_title[:30],
                    session_obj.deleted_at.isoformat() if session_obj.deleted_at else "未知",
                )

            await db.commit()

        if cleaned_count > 0:
            logger.info("垃圾回收清理完成 | 本次清理 %d 个过期会话", cleaned_count)

        return cleaned_count

    # ============================================================
    # 后台线程管理
    # ============================================================

    def start(self):
        """
        启动后台清理线程
        运行步骤：
          1. 检查是否已在运行，避免重复启动
          2. 标记运行状态为 True
          3. 创建后台守护线程，按固定间隔定期执行 cleanup_once
        调用方：应用启动时（main.py lifespan）
        参数：无
        返回值：无
        """
        if self._running:
            logger.warning("垃圾回收清理线程已在运行中，跳过重复启动")
            return

        self._running = True

        def _cleanup_loop():
            """
            后台清理循环
            运行步骤：
              1. 创建独立的异步事件循环
              2. 循环等待 cleanup_interval 分钟
              3. 每轮循环执行 cleanup_once() 进行清理
              4. _running 设为 False 时退出循环
            """
            # 为子线程创建独立的事件循环（避免与主事件循环冲突）
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

            logger.info(
                "垃圾回收后台线程已启动 | 清理间隔=%d分钟",
                self.cleanup_interval,
            )

            while self._running:
                # 等待清理间隔（转换为秒）
                time.sleep(self.cleanup_interval * 60)

                if not self._running:
                    break

                try:
                    # 在当前线程的事件循环中执行异步清理
                    loop.run_until_complete(self.cleanup_once())
                except Exception as exc:
                    logger.error(
                        "垃圾回收清理执行异常: %s",
                        str(exc),
                        exc_info=True,
                    )

            loop.close()
            logger.info("垃圾回收后台线程已退出")

        self._cleanup_thread = threading.Thread(
            target=_cleanup_loop,
            daemon=True,
            name="trash-cleaner",
        )
        self._cleanup_thread.start()
        logger.info("垃圾回收清理器已启动")

    def stop(self):
        """
        停止后台清理线程
        运行步骤：
          1. 设置 _running = False 通知循环退出
          2. 等待后台线程结束（最多等待 5 秒）
        调用方：应用关闭时（main.py lifespan）
        参数：无
        返回值：无
        """
        self._running = False
        if self._cleanup_thread and self._cleanup_thread.is_alive():
            self._cleanup_thread.join(timeout=5)
        logger.info("垃圾回收清理器已停止")


# ============================================================
# 全局垃圾回收清理器单例
# ============================================================
trash_cleaner = TrashCleaner()
