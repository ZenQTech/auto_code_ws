"""
# ============================================================
# 会话 fork / resume 服务
# ============================================================
# 核心作用：实现 Codex 风格的会话分叉（fork）和恢复（resume）功能
# 设计要点：
#   1. Fork：基于现有会话在某个消息点创建分叉，复制该点之前的消息
#   2. Resume：恢复历史会话的完整状态
#   3. Lineage：追踪会话的父子血缘链
#   4. 安全：原始会话数据不被修改
# 运行流程：
#   Fork: 验证源 → 创建新 Session → 复制消息 → 返回新 ID
#   Resume: 加载 Session + 消息 + 任务 → 更新设备 ID
#   Lineage: 递归查询父子链
# 输入参数：session_id, fork_point_message_id, device_id
# 输出结果：fork 返回新 session_id；resume 返回完整 detail；lineage 返回祖先链
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 2 T3 初始化：实现 fork/resume/lineage 算法
# ============================================================
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class SessionForkResumeService:
    """
    会话 fork / resume 服务
    """

    def __init__(self, session_factory):
        """
        初始化
        参数：session_factory 异步会话工厂
        """
        self.session_factory = session_factory
        logger.info("SessionForkResumeService 初始化完成")

    # ============================================================
    # Fork：分叉会话
    # ============================================================
    async def fork(
        self,
        source_session_id: str,
        fork_point_message_id: Optional[str] = None,
        title: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Fork 会话
        参数：
          - source_session_id 源会话 ID
          - fork_point_message_id 分叉点消息 ID（None=分叉最新点）
          - title 新会话标题（默认 "源标题 (fork)"）
        返回值：{"success": True, "session": {...}, "messages_copied": N}
        """
        from backend.app.models import Session, Conversation

        # 1. 加载源 session
        async with self.session_factory() as session:
            result = await session.execute(
                select(Session).where(Session.id == source_session_id)
            )
            source = result.scalar_one_or_none()
            if not source:
                return {"success": False, "error": f"源会话不存在: {source_session_id}"}

            # 2. 复制源会话的基本属性
            new_session_id = str(uuid.uuid4())
            now = datetime.now(timezone.utc)
            new_title = title or f"{source.title} (fork)"
            new_session = Session(
                id=new_session_id,
                title=new_title,
                created_at=now,
                last_active_at=now,
                user_first_message=source.user_first_message,
                message_count=0,  # 后续更新
                status="active",
                mode=source.mode,
                workflow_id=source.workflow_id,
                workflow_stage=source.workflow_stage,
                # v6.13.0 T3 新增字段
                parent_session_id=source_session_id,
                forked_at=now,
                fork_point_message_id=fork_point_message_id,
                is_archived=False,
                device_id=source.device_id,
            )
            session.add(new_session)
            await session.commit()

        # 3. 复制消息
        async with self.session_factory() as session:
            # 加载源消息
            query = select(Conversation).where(Conversation.session_id == source_session_id)
            if fork_point_message_id:
                # 找到 fork_point 的位置
                fp_result = await session.execute(
                    select(Conversation.created_at).where(
                        Conversation.id == fork_point_message_id,
                        Conversation.session_id == source_session_id,
                    )
                )
                fp_time = fp_result.scalar_one_or_none()
                if fp_time:
                    query = query.where(Conversation.created_at <= fp_time)
            query = query.order_by(Conversation.created_at.asc())
            result = await session.execute(query)
            source_msgs = result.scalars().all()

            # 创建副本
            new_msgs = []
            for src_msg in source_msgs:
                new_msg = Conversation(
                    id=str(uuid.uuid4()),
                    session_id=new_session_id,
                    task_id=None,  # fork 后不继承任务关联
                    agent_id=None,
                    role=src_msg.role,
                    content=src_msg.content,
                    extra_data=src_msg.extra_data,
                    is_compacted=src_msg.is_compacted,
                    compacted_at=src_msg.compacted_at,
                    compacted_into=None,
                    created_at=src_msg.created_at,
                )
                new_msgs.append(new_msg)
            if new_msgs:
                session.add_all(new_msgs)
            await session.commit()
            messages_copied = len(new_msgs)

        # 4. 更新新会话的 message_count
        async with self.session_factory() as session:
            await session.execute(
                update(Session)
                .where(Session.id == new_session_id)
                .values(message_count=messages_copied)
            )
            await session.commit()

        logger.info(
            f"Fork 完成: source={source_session_id} → new={new_session_id}, "
            f"messages_copied={messages_copied}"
        )

        return {
            "success": True,
            "session": {
                "id": new_session_id,
                "title": new_title,
                "parent_session_id": source_session_id,
                "fork_point_message_id": fork_point_message_id,
                "created_at": now.isoformat(),
                "mode": source.mode,
            },
            "messages_copied": messages_copied,
        }

    # ============================================================
    # Resume：恢复会话
    # ============================================================
    async def resume(
        self,
        session_id: str,
        device_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        恢复会话
        参数：
          - session_id 会话 ID
          - device_id 设备 ID（可选，用于跨设备同步标记）
        返回值：完整会话详情（含消息、任务等）
        """
        from backend.app.models import Session, Conversation, Task, Agent

        async with self.session_factory() as session:
            # 1. 加载 session
            result = await session.execute(
                select(Session).where(Session.id == session_id)
            )
            sess = result.scalar_one_or_none()
            if not sess:
                return {"success": False, "error": f"会话不存在: {session_id}"}

            # 2. 加载消息
            msg_result = await session.execute(
                select(Conversation)
                .where(Conversation.session_id == session_id)
                .order_by(Conversation.created_at.asc())
            )
            messages = msg_result.scalars().all()

            # 3. 加载任务
            task_result = await session.execute(
                select(Task).where(Task.session_id == session_id)
            )
            tasks = task_result.scalars().all()

            # 4. 加载 agents
            agent_result = await session.execute(
                select(Agent).where(Agent.session_id == session_id)
            )
            agents = agent_result.scalars().all()

            # 5. 更新 last_active_at 和 device_id
            now = datetime.now(timezone.utc)
            update_values = {"last_active_at": now}
            if device_id:
                update_values["device_id"] = device_id
            await session.execute(
                update(Session).where(Session.id == session_id).values(**update_values)
            )
            await session.commit()

        logger.info(
            f"Resume 会话: {session_id} (device={device_id or 'unchanged'}), "
            f"messages={len(messages)}, tasks={len(tasks)}, agents={len(agents)}"
        )

        return {
            "success": True,
            "session": {
                "id": sess.id,
                "title": sess.title,
                "created_at": sess.created_at.isoformat() if sess.created_at else None,
                "last_active_at": now.isoformat(),
                "user_first_message": sess.user_first_message,
                "message_count": sess.message_count,
                "status": sess.status.value if sess.status else "active",
                "mode": sess.mode,
                "workflow_id": sess.workflow_id,
                "workflow_stage": sess.workflow_stage,
                "parent_session_id": sess.parent_session_id,
                "forked_at": sess.forked_at.isoformat() if sess.forked_at else None,
                "fork_point_message_id": sess.fork_point_message_id,
                "is_archived": sess.is_archived,
                "device_id": device_id or sess.device_id,
            },
            "messages": [
                {
                    "id": m.id,
                    "role": m.role,
                    "content": m.content,
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                    "is_compacted": m.is_compacted,
                }
                for m in messages
            ],
            "tasks": [
                {
                    "id": t.id,
                    "title": t.title,
                    "status": t.status.value if t.status else None,
                }
                for t in tasks
            ],
            "agents": [
                {
                    "id": a.id,
                    "name": a.name,
                    "status": a.status.value if a.status else None,
                }
                for a in agents
            ],
        }

    # ============================================================
    # Lineage：血缘查询
    # ============================================================
    async def get_lineage(self, session_id: str) -> Dict[str, Any]:
        """
        查询会话血缘（父→子链）
        参数：session_id 起始会话 ID
        返回值：{"ancestors": [...], "descendants": [...], "root": id}
        """
        from backend.app.models import Session

        # 1. 向上追溯祖先
        ancestors = []
        current_id = session_id
        visited = set()
        while current_id and current_id not in visited:
            visited.add(current_id)
            async with self.session_factory() as session:
                result = await session.execute(
                    select(Session).where(Session.id == current_id)
                )
                sess = result.scalar_one_or_none()
                if not sess:
                    break
                if sess.id != session_id:
                    ancestors.append({
                        "id": sess.id,
                        "title": sess.title,
                        "created_at": sess.created_at.isoformat() if sess.created_at else None,
                        "is_root": sess.parent_session_id is None,
                    })
                current_id = sess.parent_session_id

        # 2. 向下查找所有子孙
        descendants = []
        async with self.session_factory() as session:
            result = await session.execute(
                select(Session).where(Session.parent_session_id == session_id)
            )
            children = result.scalars().all()
        for child in children:
            descendants.append({
                "id": child.id,
                "title": child.title,
                "created_at": child.created_at.isoformat() if child.created_at else None,
                "forked_at": child.forked_at.isoformat() if child.forked_at else None,
                "is_archived": child.is_archived,
            })
            # 递归查找孙级
            sub_lineage = await self.get_lineage(child.id)
            descendants.extend(sub_lineage.get("descendants", []))

        # 3. 找到根
        root_id = session_id
        if ancestors:
            root_id = ancestors[-1]["id"]
        elif descendants:
            # 没有祖先但有子孙，根就是当前 session
            root_id = session_id

        return {
            "success": True,
            "session_id": session_id,
            "root_id": root_id,
            "ancestors": ancestors,
            "descendants": descendants,
            "ancestor_count": len(ancestors),
            "descendant_count": len(descendants),
        }

    # ============================================================
    # Archive：归档会话
    # ============================================================
    async def archive(self, session_id: str, archived: bool = True) -> Dict[str, Any]:
        """
        归档/取消归档会话
        参数：
          - session_id 会话 ID
          - archived True=归档, False=取消归档
        返回值：操作结果
        """
        from backend.app.models import Session
        async with self.session_factory() as session:
            result = await session.execute(
                select(Session).where(Session.id == session_id)
            )
            sess = result.scalar_one_or_none()
            if not sess:
                return {"success": False, "error": f"会话不存在: {session_id}"}
            await session.execute(
                update(Session).where(Session.id == session_id).values(is_archived=archived)
            )
            await session.commit()
        return {
            "success": True,
            "session_id": session_id,
            "is_archived": archived,
        }
