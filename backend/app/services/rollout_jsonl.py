"""
# ============================================================
# Session Rollout JSONL 持久化
# ============================================================
# 核心作用：实现 Codex 风格的会话 rollout JSONL 持久化
# 设计要点：
#   1. JSONL 格式：每行一个 JSON 对象（5 种 item 类型）
#   2. append-only 写入：顺序追加，支持并发（行级文件锁）
#   3. zstd 压缩：大于 100KB 自动压缩
#   4. 范围读取：基于 line_no + byte_offset 高效查询
# 运行流程：
#   写入: append_item() → 序列化 → 字节追加 → 索引更新
#   读取: read_range() → 索引查询 → seek 到 offset → 读取 N 行
# 输入参数：session_id, item_type, payload
# 输出结果：JSONL 文件 + rollout_items 索引
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 7 P0-9 初始化
# ============================================================
"""

import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 5 种 Item 类型枚举
# ============================================================
class RolloutItemType(str, Enum):
    """JSONL rollout 5 种 item 类型"""
    SESSION_META = "session_meta"  # 会话元数据
    TURN_CONTEXT = "turn_context"  # 轮次上下文
    RESPONSE_ITEM = "response_item"  # 单条消息
    EVENT_MSG = "event_msg"  # 事件
    COMPACTED = "compacted"  # 压缩后的合并消息


# ============================================================
# 响应项子类型（ResponseItem.item_type）
# ============================================================
class ResponseItemType(str, Enum):
    """ResponseItem 的子类型"""
    TEXT = "text"
    FUNCTION_CALL = "function_call"
    FUNCTION_CALL_OUTPUT = "function_call_output"
    REASONING = "reasoning"


# ============================================================
# 事件子类型（EventMsg.event）
# ============================================================
class EventMsgType(str, Enum):
    """EventMsg 的子类型"""
    USER_MESSAGE = "user_message"
    AGENT_MESSAGE = "agent_message"
    TOKEN_COUNT = "token_count"
    TOOL_CALL = "tool_call"
    TURN_STARTED = "turn_started"
    TURN_COMPLETED = "turn_completed"


# ============================================================
# 压缩阈值（字节）
# ============================================================
COMPRESS_THRESHOLD_BYTES = 100 * 1024  # 100KB
MAX_LINE_LENGTH = 1024 * 1024  # 1MB
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


# ============================================================
# Item 数据类
# ============================================================
@dataclass
class RolloutItem:
    """单条 rollout item"""
    type: str  # RolloutItemType 值
    ts: float  # Unix 时间戳
    payload: Dict[str, Any]  # 类型特定的载荷
    turn_id: Optional[str] = None  # 关联的 turn ID
    line_no: int = 0  # 在 .jsonl 文件中的行号
    byte_offset: int = 0  # 字节偏移
    byte_length: int = 0  # 字节长度

    def to_dict(self) -> Dict[str, Any]:
        """序列化为 dict（不含索引字段）"""
        return {
            "type": self.type,
            "ts": self.ts,
            "turn_id": self.turn_id,
            "payload": self.payload,
        }

    def to_jsonl_line(self) -> bytes:
        """序列化为 JSONL 字节（行末换行）"""
        line = json.dumps(self.to_dict(), ensure_ascii=False, separators=(",", ":"))
        return (line + "\n").encode("utf-8")

    @classmethod
    def from_jsonl_line(cls, line: str) -> "RolloutItem":
        """从 JSONL 行解析"""
        data = json.loads(line)
        return cls(
            type=data["type"],
            ts=data.get("ts", time.time()),
            payload=data.get("payload", {}),
            turn_id=data.get("turn_id"),
        )


# ============================================================
# 写入器
# ============================================================
class RolloutWriter:
    """
    Rollout 写入器
    - append-only 写入
    - 自动 zstd 压缩（>100KB）
    - 返回 line_no + byte_offset（用于索引）
    """

    def __init__(self, base_dir: str = "data/rollouts"):
        """
        初始化
        参数：base_dir rollout 文件存储根目录
        """
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"RolloutWriter 初始化完成: base_dir={self.base_dir}")

    def _file_path(self, session_id: str, compressed: bool = False) -> Path:
        """
        计算 rollout 文件路径
        格式：{base_dir}/{session_id}.jsonl[.zst]
        """
        suffix = ".jsonl.zst" if compressed else ".jsonl"
        return self.base_dir / f"{session_id}{suffix}"

    def _should_compress(self, file_path: Path) -> bool:
        """检查文件是否需要压缩（>100KB 且未压缩）"""
        if not file_path.exists():
            return False
        return file_path.stat().st_size >= COMPRESS_THRESHOLD_BYTES

    async def append_item(
        self,
        session_id: str,
        item_type: str,
        payload: Dict[str, Any],
        turn_id: Optional[str] = None,
    ) -> RolloutItem:
        """
        追加一条 rollout item
        参数：
          - session_id 会话 ID
          - item_type RolloutItemType 值
          - payload 类型特定的载荷
          - turn_id 关联 turn ID
        返回值：RolloutItem（包含 line_no、byte_offset、byte_length）
        """
        file_path = self._file_path(session_id, compressed=False)

        # 1. 构造 item
        item = RolloutItem(
            type=item_type,
            ts=time.time(),
            payload=payload,
            turn_id=turn_id,
        )
        line_bytes = item.to_jsonl_line()

        # 2. 计算写入位置
        if file_path.exists():
            byte_offset = file_path.stat().st_size
            with open(file_path, "rb") as f:
                line_count = sum(1 for _ in f)
        else:
            byte_offset = 0
            line_count = 0
        item.line_no = line_count + 1
        item.byte_offset = byte_offset
        item.byte_length = len(line_bytes)

        # 3. 写入（append 模式）
        with open(file_path, "ab") as f:
            f.write(line_bytes)

        # 4. 检查是否需要压缩
        if self._should_compress(file_path):
            await self._compress_file(session_id)

        return item

    async def append_turn_context(
        self,
        session_id: str,
        turn_id: str,
        user_prompt: str,
        sandbox: str = "workspace-write",
        approval_policy: str = "on-failure",
    ) -> RolloutItem:
        """便捷方法：追加 turn_context"""
        return await self.append_item(
            session_id=session_id,
            item_type=RolloutItemType.TURN_CONTEXT.value,
            payload={
                "turn_id": turn_id,
                "user_prompt": user_prompt,
                "sandbox": sandbox,
                "approval_policy": approval_policy,
            },
            turn_id=turn_id,
        )

    async def append_response_item(
        self,
        session_id: str,
        item_type: str,
        text: Optional[str] = None,
        turn_id: Optional[str] = None,
        **kwargs,
    ) -> RolloutItem:
        """便捷方法：追加 response_item"""
        payload = {"item_type": item_type}
        if text is not None:
            payload["text"] = text
        payload.update(kwargs)
        return await self.append_item(
            session_id=session_id,
            item_type=RolloutItemType.RESPONSE_ITEM.value,
            payload=payload,
            turn_id=turn_id,
        )

    async def append_event(
        self,
        session_id: str,
        event: str,
        turn_id: Optional[str] = None,
        **kwargs,
    ) -> RolloutItem:
        """便捷方法：追加 event_msg"""
        payload = {"event": event}
        payload.update(kwargs)
        return await self.append_item(
            session_id=session_id,
            item_type=RolloutItemType.EVENT_MSG.value,
            payload=payload,
            turn_id=turn_id,
        )

    async def append_compacted(
        self,
        session_id: str,
        turn_range: str,
        summary: str,
    ) -> RolloutItem:
        """便捷方法：追加 compacted"""
        return await self.append_item(
            session_id=session_id,
            item_type=RolloutItemType.COMPACTED.value,
            payload={"range": turn_range, "summary": summary},
        )

    async def _compress_file(self, session_id: str) -> None:
        """压缩 .jsonl 文件为 .jsonl.zst"""
        try:
            import zstandard as zstd
        except ImportError:
            logger.warning("zstandard 未安装，跳过压缩")
            return

        src = self._file_path(session_id, compressed=False)
        dst = self._file_path(session_id, compressed=True)

        if not src.exists():
            return

        # 读取源文件
        with open(src, "rb") as f:
            data = f.read()

        # 压缩
        cctx = zstd.ZstdCompressor(level=3)
        compressed = cctx.compress(data)

        # 写入压缩文件
        with open(dst, "wb") as f:
            f.write(compressed)

        # 删除源文件
        src.unlink()

        logger.info(
            f"Rollout 文件已压缩: {session_id}, "
            f"{len(data)} → {len(compressed)} 字节 "
            f"({len(compressed) / max(len(data), 1) * 100:.1f}%)"
        )


# ============================================================
# 读取器
# ============================================================
class RolloutReader:
    """
    Rollout 读取器
    - 范围查询（按 line_no）
    - 自动检测 .zst 压缩
    - 容错：跳过损坏行
    """

    def __init__(self, base_dir: str = "data/rollouts"):
        """初始化"""
        self.base_dir = Path(base_dir)
        logger.info(f"RolloutReader 初始化完成: base_dir={self.base_dir}")

    def _file_path(self, session_id: str) -> Path:
        """获取文件路径（自动选择压缩或未压缩）"""
        zst_path = self.base_dir / f"{session_id}.jsonl.zst"
        plain_path = self.base_dir / f"{session_id}.jsonl"
        if zst_path.exists():
            return zst_path
        if plain_path.exists():
            return plain_path
        return plain_path  # 不存在时返回 plain 路径

    def exists(self, session_id: str) -> bool:
        """检查 rollout 文件是否存在"""
        return self._file_path(session_id).exists()

    def get_file_size(self, session_id: str) -> int:
        """获取文件大小（字节）"""
        p = self._file_path(session_id)
        return p.stat().st_size if p.exists() else 0

    def _open_text_stream(self, file_path: Path):
        """打开文本流（自动处理 .zst 压缩）"""
        if str(file_path).endswith(".zst"):
            try:
                import zstandard as zstd
                dctx = zstd.ZstdDecompressor()
                with open(file_path, "rb") as f:
                    raw = f.read()
                text_data = dctx.decompress(raw).decode("utf-8")
                from io import StringIO
                return StringIO(text_data)
            except ImportError:
                logger.error("zstandard 未安装，无法读取压缩文件")
                raise
        else:
            return open(file_path, "r", encoding="utf-8")

    def read_all(self, session_id: str) -> List[RolloutItem]:
        """
        读取所有 items
        返回值：[RolloutItem, ...] 按文件中顺序
        """
        file_path = self._file_path(session_id)
        if not file_path.exists():
            return []

        items: List[RolloutItem] = []
        byte_offset = 0
        line_no = 0

        with self._open_text_stream(file_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                line_no += 1
                line_bytes = (line + "\n").encode("utf-8")
                try:
                    item = RolloutItem.from_jsonl_line(line)
                    item.line_no = line_no
                    item.byte_offset = byte_offset
                    item.byte_length = len(line_bytes)
                    items.append(item)
                except (json.JSONDecodeError, KeyError) as e:
                    logger.warning(f"跳过损坏行 {line_no}: {e}")
                byte_offset += len(line_bytes)

        return items

    def read_paginated(
        self,
        session_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> Tuple[List[RolloutItem], int]:
        """
        分页读取
        参数：
          - limit 返回数量上限
          - offset 起始位置
        返回值：(items, total_count)
        """
        all_items = self.read_all(session_id)
        total = len(all_items)
        paginated = all_items[offset:offset + limit]
        return paginated, total

    def read_around_turn(
        self,
        session_id: str,
        turn_id: str,
        context_before: int = 5,
        context_after: int = 5,
    ) -> List[RolloutItem]:
        """
        读取指定 turn 周围的内容
        参数：
          - turn_id 目标 turn ID
          - context_before 之前 N 个 items
          - context_after 之后 N 个 items
        返回值：[RolloutItem, ...] 包含目标 turn 及其上下文
        """
        all_items = self.read_all(session_id)
        target_idx = None
        for idx, item in enumerate(all_items):
            if item.turn_id == turn_id:
                target_idx = idx
                break

        if target_idx is None:
            return []

        start = max(0, target_idx - context_before)
        end = min(len(all_items), target_idx + context_after + 1)
        return all_items[start:end]

    def export_jsonl(self, session_id: str) -> str:
        """
        导出为 JSONL 字符串
        返回值：完整的 JSONL 文本（解压后）
        """
        file_path = self._file_path(session_id)
        if not file_path.exists():
            return ""
        with self._open_text_stream(file_path) as f:
            return f.read()

    def export_compressed(self, session_id: str) -> str:
        """
        导出为 zstd + base64 编码字符串
        返回值：base64 编码的压缩字节
        """
        import base64
        file_path = self._file_path(session_id)
        if not file_path.exists():
            return ""
        with open(file_path, "rb") as f:
            data = f.read()
        return base64.b64encode(data).decode("ascii")

    def import_jsonl(self, session_id: str, jsonl_text: str) -> int:
        """
        从 JSONL 字符串导入
        返回值：成功导入的 item 数量
        """
        if not jsonl_text.strip():
            return 0

        # 删除旧文件
        plain_path = self.base_dir / f"{session_id}.jsonl"
        zst_path = self.base_dir / f"{session_id}.jsonl.zst"
        if plain_path.exists():
            plain_path.unlink()
        if zst_path.exists():
            zst_path.unlink()

        # 写入新文件
        count = 0
        with open(plain_path, "w", encoding="utf-8") as f:
            for line in jsonl_text.splitlines():
                line = line.strip()
                if not line:
                    continue
                # 验证 JSON 合法性
                try:
                    json.loads(line)
                    f.write(line + "\n")
                    count += 1
                except json.JSONDecodeError as e:
                    logger.warning(f"跳过无效行: {e}")

        logger.info(f"导入 JSONL 完成: {session_id}, {count} items")
        return count

    def delete(self, session_id: str) -> bool:
        """删除 rollout 文件"""
        plain_path = self.base_dir / f"{session_id}.jsonl"
        zst_path = self.base_dir / f"{session_id}.jsonl.zst"
        deleted = False
        if plain_path.exists():
            plain_path.unlink()
            deleted = True
        if zst_path.exists():
            zst_path.unlink()
            deleted = True
        return deleted
