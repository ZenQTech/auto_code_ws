"""
# ============================================================
# Session Rollout Service - 整合 JSONL 与 Fork/Resume
# ============================================================
# 核心作用：高层服务，整合 RolloutWriter/Reader + SessionForkResumeService
# 设计要点：
#   1. 自动持久化：每次 turn/event/response 写入 JSONL
#   2. 分页查询：基于 RolloutReader 提供分页 API
#   3. beforeTurnId fork：扩展 v0.145.0 切分点
#   4. 导出/导入：JSONL 完整 round-trip
# 运行流程：
#   写入: record_*() → RolloutWriter.append_*() → JSONL 追加
#   查询: paginate_history() → RolloutReader.read_paginated()
#   Fork: fork_at_turn() → 计算切分点 → 调用 fork_resume
# 输入参数：session_id, turn_id, payload
# 输出结果：JSONL 文件 + 索引 + fork 后的新 session
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 7 P0-9 初始化
# ============================================================
"""

import json
import logging
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .rollout_jsonl import (
    RolloutWriter,
    RolloutReader,
    RolloutItem,
    RolloutItemType,
    ResponseItemType,
    EventMsgType,
)

logger = logging.getLogger(__name__)


class SessionRolloutService:
    """
    Session Rollout 服务
    """

    def __init__(
        self,
        session_factory,
        base_dir: str = "data/rollouts",
    ):
        """
        初始化
        参数：
          - session_factory 异步会话工厂（来自 get_session_factory）
          - base_dir rollout 文件存储根目录
        """
        self.session_factory = session_factory
        self.writer = RolloutWriter(base_dir=base_dir)
        self.reader = RolloutReader(base_dir=base_dir)
        logger.info(
            f"SessionRolloutService 初始化完成: base_dir={base_dir}"
        )

    # ============================================================
    # 写入方法
    # ============================================================
    async def record_session_meta(
        self,
        session_id: str,
        title: str,
        model: str,
        cwd: str = "",
    ) -> RolloutItem:
        """
        记录会话元数据
        """
        from backend.app.models import Session

        async with self.session_factory() as session:
            result = await session.execute(
                # 简单查询以确保 session 存在
                __import__("sqlalchemy").text("SELECT 1")
            )

        return await self.writer.append_item(
            session_id=session_id,
            item_type=RolloutItemType.SESSION_META.value,
            payload={
                "id": session_id,
                "title": title,
                "model": model,
                "cwd": cwd,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    async def record_turn(
        self,
        session_id: str,
        user_prompt: str,
        sandbox: str = "workspace-write",
        approval_policy: str = "on-failure",
    ) -> Tuple[str, RolloutItem]:
        """
        记录用户 turn
        返回值：(turn_id, item)
        """
        turn_id = f"turn-{uuid.uuid4().hex[:12]}"
        item = await self.writer.append_turn_context(
            session_id=session_id,
            turn_id=turn_id,
            user_prompt=user_prompt,
            sandbox=sandbox,
            approval_policy=approval_policy,
        )
        # 同时记录 user_message 事件
        await self.writer.append_event(
            session_id=session_id,
            event=EventMsgType.USER_MESSAGE.value,
            turn_id=turn_id,
            text=user_prompt,
        )
        return turn_id, item

    async def record_response_text(
        self,
        session_id: str,
        text: str,
        turn_id: Optional[str] = None,
    ) -> RolloutItem:
        """记录 AI 文本回复"""
        return await self.writer.append_response_item(
            session_id=session_id,
            item_type=ResponseItemType.TEXT.value,
            text=text,
            turn_id=turn_id,
        )

    async def record_response_function_call(
        self,
        session_id: str,
        name: str,
        arguments: str,
        call_id: str,
        turn_id: Optional[str] = None,
    ) -> RolloutItem:
        """记录函数调用"""
        return await self.writer.append_response_item(
            session_id=session_id,
            item_type=ResponseItemType.FUNCTION_CALL.value,
            name=name,
            arguments=arguments,
            call_id=call_id,
            turn_id=turn_id,
        )

    async def record_response_function_output(
        self,
        session_id: str,
        call_id: str,
        output: str,
        turn_id: Optional[str] = None,
    ) -> RolloutItem:
        """记录函数调用输出"""
        return await self.writer.append_response_item(
            session_id=session_id,
            item_type=ResponseItemType.FUNCTION_CALL_OUTPUT.value,
            call_id=call_id,
            output=output,
            turn_id=turn_id,
        )

    async def record_token_count(
        self,
        session_id: str,
        input_tokens: int,
        output_tokens: int,
        turn_id: Optional[str] = None,
    ) -> RolloutItem:
        """记录 token 计数"""
        return await self.writer.append_event(
            session_id=session_id,
            event=EventMsgType.TOKEN_COUNT.value,
            turn_id=turn_id,
            input=input_tokens,
            output=output_tokens,
        )

    async def record_compacted(
        self,
        session_id: str,
        turn_range: str,
        summary: str,
    ) -> RolloutItem:
        """记录压缩"""
        return await self.writer.append_compacted(
            session_id=session_id,
            turn_range=turn_range,
            summary=summary,
        )

    # ============================================================
    # 查询方法
    # ============================================================
    def paginate_history(
        self,
        session_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """
        分页查询会话历史
        返回值：
          {
            "success": True,
            "session_id": ...,
            "total_items": N,
            "limit": L,
            "offset": O,
            "has_more": bool,
            "items": [...]
          }
        """
        if limit < 1 or limit > 500:
            return {
                "success": False,
                "error": "limit 必须在 [1, 500] 范围内",
            }
        if offset < 0:
            return {
                "success": False,
                "error": "offset 必须 >= 0",
            }

        items, total = self.reader.read_paginated(
            session_id=session_id,
            limit=limit,
            offset=offset,
        )

        return {
            "success": True,
            "session_id": session_id,
            "total_items": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + len(items) < total,
            "items": [item.to_dict() | {"line_no": item.line_no} for item in items],
        }

    def get_turn_context(
        self,
        session_id: str,
        turn_id: str,
        context_before: int = 5,
        context_after: int = 5,
    ) -> Dict[str, Any]:
        """
        获取指定 turn 周围的上下文
        """
        items = self.reader.read_around_turn(
            session_id=session_id,
            turn_id=turn_id,
            context_before=context_before,
            context_after=context_after,
        )
        return {
            "success": True,
            "turn_id": turn_id,
            "items": [item.to_dict() | {"line_no": item.line_no} for item in items],
        }

    # ============================================================
    # Fork 方法
    # ============================================================
    async def fork_at_turn(
        self,
        source_session_id: str,
        before_turn_id: str,
        title: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        基于 beforeTurnId 分叉会话（v0.145.0 API）
        参数：
          - source_session_id 源会话 ID
          - before_turn_id 该 turn 之前的所有内容被复制
          - title 新会话标题
        返回值：
          {
            "success": True,
            "session": {...},
            "items_copied": N
          }
        """
        # 1. 读取源会话的 items
        source_items = self.reader.read_all(source_session_id)
        if not source_items:
            return {
                "success": False,
                "error": f"源会话 rollout 不存在: {source_session_id}",
            }

        # 2. 找到 before_turn_id 的位置
        target_idx = None
        for idx, item in enumerate(source_items):
            if item.type == RolloutItemType.TURN_CONTEXT.value:
                if item.payload.get("turn_id") == before_turn_id:
                    target_idx = idx
                    break

        if target_idx is None:
            return {
                "success": False,
                "error": f"未找到 turn_id={before_turn_id}",
            }

        # 3. 复制该 turn 之前的 items（包括 session_meta）
        items_to_copy = source_items[:target_idx]

        # 4. 创建新 session
        new_session_id = f"sess-{uuid.uuid4().hex[:12]}"
        new_title = title or f"Fork from turn {before_turn_id[:8]}"

        # 5. 写入新 rollout 文件
        for item in items_to_copy:
            await self.writer.append_item(
                session_id=new_session_id,
                item_type=item.type,
                payload=item.payload,
                turn_id=item.turn_id,
            )

        # 6. 在数据库中创建新 Session 记录
        try:
            from backend.app.models import Session
            from sqlalchemy import select
            from datetime import datetime, timezone

            async with self.session_factory() as session:
                # 加载源 session
                result = await session.execute(
                    select(Session).where(Session.id == source_session_id)
                )
                source = result.scalar_one_or_none()

                now = datetime.now(timezone.utc)
                new_session = Session(
                    id=new_session_id,
                    title=new_title,
                    created_at=now,
                    last_active_at=now,
                    user_first_message=None,
                    message_count=sum(
                        1 for i in items_to_copy
                        if i.type == RolloutItemType.RESPONSE_ITEM.value
                    ),
                    status="active",
                    mode=getattr(source, "mode", "chat") if source else "chat",
                    workflow_id=None,
                    workflow_stage=None,
                    parent_session_id=source_session_id,
                    forked_at=now,
                    fork_point_message_id=before_turn_id,
                    is_archived=False,
                )
                session.add(new_session)
                await session.commit()
        except Exception as e:
            # 数据库失败不阻塞 rollout 写入
            logger.warning(f"数据库 Session 记录创建失败（不影响 rollout）: {e}")

        logger.info(
            f"Fork at turn 完成: source={source_session_id}, "
            f"new={new_session_id}, before_turn_id={before_turn_id}, "
            f"items_copied={len(items_to_copy)}"
        )

        return {
            "success": True,
            "session": {
                "id": new_session_id,
                "title": new_title,
                "parent_session_id": source_session_id,
                "fork_turn_id": before_turn_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
            "items_copied": len(items_to_copy),
        }

    # ============================================================
    # 导出/导入
    # ============================================================
    def export_session(
        self,
        session_id: str,
        compressed: bool = False,
    ) -> Dict[str, Any]:
        """
        导出会话为 JSONL
        参数：
          - compressed True 返回 zstd+base64，否则返回原始 JSONL 文本
        返回值：
          {
            "success": True,
            "session_id": ...,
            "format": "jsonl" | "jsonl.zst.base64",
            "content": "...",
            "item_count": N
          }
        """
        if not self.reader.exists(session_id):
            return {
                "success": False,
                "error": f"会话 rollout 不存在: {session_id}",
            }

        if compressed:
            content = self.reader.export_compressed(session_id)
            fmt = "jsonl.zst.base64"
        else:
            content = self.reader.export_jsonl(session_id)
            fmt = "jsonl"

        items = self.reader.read_all(session_id)
        return {
            "success": True,
            "session_id": session_id,
            "format": fmt,
            "content": content,
            "item_count": len(items),
        }

    def import_session(
        self,
        session_id: str,
        content: str,
        compressed: bool = False,
    ) -> Dict[str, Any]:
        """
        导入 JSONL 到新会话
        """
        if compressed:
            import base64
            try:
                import zstandard as zstd
            except ImportError:
                return {"success": False, "error": "zstandard 未安装"}
            try:
                raw = base64.b64decode(content)
                dctx = zstd.ZstdDecompressor()
                text = dctx.decompress(raw).decode("utf-8")
            except Exception as e:
                return {"success": False, "error": f"解压失败: {e}"}
        else:
            text = content

        count = self.reader.import_jsonl(session_id, text)
        return {
            "success": True,
            "session_id": session_id,
            "items_imported": count,
        }

    # ============================================================
    # 状态查询
    # ============================================================
    def get_rollout_info(self, session_id: str) -> Dict[str, Any]:
        """获取 rollout 状态信息"""
        exists = self.reader.exists(session_id)
        if not exists:
            return {
                "success": True,
                "session_id": session_id,
                "exists": False,
            }
        size = self.reader.get_file_size(session_id)
        items = self.reader.read_all(session_id)
        type_counts: Dict[str, int] = {}
        turn_ids: List[str] = []
        for item in items:
            type_counts[item.type] = type_counts.get(item.type, 0) + 1
            if item.type == RolloutItemType.TURN_CONTEXT.value and item.turn_id:
                turn_ids.append(item.turn_id)
        return {
            "success": True,
            "session_id": session_id,
            "exists": True,
            "file_size_bytes": size,
            "compressed": size > 0 and str(self.reader._file_path(session_id)).endswith(".zst"),
            "item_count": len(items),
            "type_counts": type_counts,
            "turn_count": len(turn_ids),
            "turn_ids": turn_ids[:10],  # 只返回前 10 个
        }

    def delete_rollout(self, session_id: str) -> Dict[str, Any]:
        """删除 rollout 文件"""
        deleted = self.reader.delete(session_id)
        return {
            "success": True,
            "session_id": session_id,
            "deleted": deleted,
        }
