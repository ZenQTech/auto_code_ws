"""
# ============================================================
# SubAgent 记忆继承与独立 Context 服务
# ============================================================
# 核心作用：为每个 SubAgent（Claude Code CLI 实例）提供独立 context
#           存储与父→子记忆继承机制，对应 TRAE Sub Agent 三大组件
#           中的"独立工作区"特性。
# 运行流程：
#   1. SubAgentContext dataclass 定义单个 SubAgent 的隔离上下文
#      （含独立 session_id、parent_context 引用、skill_set、
#       isolated_messages、output_dir）
#   2. SubAgentMemoryStore 维护所有 SubAgent context，
#      支持 append / get / clear / inherit_from_parent
#   3. InMemorySubAgentMemoryStore 提供内存版实现（生产环境可替换为 DB 版）
# 输入参数：
#   - subagent_id: 子智能体 ID
#   - parent_context: 父智能体 context（可选）
#   - skill_set: 该 SubAgent 专有技能集合
#   - output_dir: 输出隔离目录
# 输出结果：SubAgentContext 实例，包含 messages / metadata / 状态
# 修改记录：
#   - 2026-07-27 | v1.0.0 | P0-4 SubAgent Memory Inheritance 初始化
#     - 定义 SubAgentContext / SubAgentMemoryEntry dataclass
#     - 实现 InMemorySubAgentMemoryStore 单例存储
#     - 实现 inherit_from_parent / append_message / get_messages /
#       clear / list_subagents / get_summary 等方法
# ============================================================
"""

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ============================================================
# 数据类
# ============================================================
@dataclass
class SubAgentMemoryEntry:
    """
    SubAgent 记忆条目（单条消息或事件）

    属性：
      - entry_id: 条目唯一 ID（UUID4 短串）
      - role: 角色（user / assistant / system / tool / event）
      - content: 内容字符串
      - timestamp: 创建时间戳（秒）
      - metadata: 附加元数据（tool_name / tool_args / token_usage 等）
    """
    entry_id: str
    role: str
    content: str
    timestamp: float
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SubAgentContext:
    """
    SubAgent 独立上下文（对应 TRAE SubAgent 独立工作区）

    属性：
      - subagent_id: SubAgent 唯一 ID
      - name: SubAgent 名称（如 module_name）
      - parent_id: 父智能体 ID（可空，根节点无父）
      - parent_context_snapshot: 继承时刻父 context 的消息快照
      - skill_set: SubAgent 专有技能集（与父不同）
      - isolated_messages: SubAgent 自身产生的消息（不与父共享）
      - output_dir: 输出隔离目录（避免 SubAgent 写父目录）
      - isolated: 是否完全隔离（True=独立，False=只读继承）
      - created_at: 创建时间戳
      - metadata: 附加元数据
    """
    subagent_id: str
    name: str
    parent_id: Optional[str] = None
    parent_context_snapshot: List[SubAgentMemoryEntry] = field(default_factory=list)
    skill_set: List[str] = field(default_factory=list)
    isolated_messages: List[SubAgentMemoryEntry] = field(default_factory=list)
    output_dir: str = ""
    isolated: bool = True
    created_at: float = field(default_factory=time.time)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """转换为可 JSON 序列化的字典"""
        return {
            "subagent_id": self.subagent_id,
            "name": self.name,
            "parent_id": self.parent_id,
            "parent_context_size": len(self.parent_context_snapshot),
            "skill_set": list(self.skill_set),
            "isolated_messages_count": len(self.isolated_messages),
            "output_dir": self.output_dir,
            "isolated": self.isolated,
            "created_at": self.created_at,
            "metadata": dict(self.metadata),
        }


# ============================================================
# 抽象接口
# ============================================================
class SubAgentMemoryStore:
    """
    SubAgent 记忆存储抽象接口
    子类需实现：create / get / append / clear / list / inherit_from_parent
    """

    async def create(self, ctx: SubAgentContext) -> SubAgentContext:
        raise NotImplementedError

    async def get(self, subagent_id: str) -> Optional[SubAgentContext]:
        raise NotImplementedError

    async def append(self, subagent_id: str, entry: SubAgentMemoryEntry) -> bool:
        raise NotImplementedError

    async def get_messages(self, subagent_id: str, include_parent: bool = True) -> List[SubAgentMemoryEntry]:
        raise NotImplementedError

    async def clear(self, subagent_id: str) -> bool:
        raise NotImplementedError

    async def list_subagents(self) -> List[SubAgentContext]:
        raise NotImplementedError

    async def inherit_from_parent(
        self,
        subagent_id: str,
        parent_id: str,
        parent_messages: List[SubAgentMemoryEntry],
    ) -> bool:
        raise NotImplementedError


# ============================================================
# 内存实现
# ============================================================
class InMemorySubAgentMemoryStore(SubAgentMemoryStore):
    """
    内存版 SubAgent 记忆存储（v1.0.0 初始实现）
    适用场景：单实例部署 + 短期 SubAgent 生命周期
    并发控制：使用 asyncio.Lock 保护内部字典
    """

    def __init__(self) -> None:
        self._store: Dict[str, SubAgentContext] = {}
        self._lock = asyncio.Lock()
        logger.info("InMemorySubAgentMemoryStore 已初始化（v1.0.0）")

    async def create(self, ctx: SubAgentContext) -> SubAgentContext:
        """注册一个 SubAgent context"""
        async with self._lock:
            if ctx.subagent_id in self._store:
                logger.warning(f"SubAgent {ctx.subagent_id} 已存在，将被覆盖")
            self._store[ctx.subagent_id] = ctx
            logger.info(
                f"SubAgent context 创建: id={ctx.subagent_id} "
                f"name={ctx.name} parent={ctx.parent_id or 'None'} "
                f"isolated={ctx.isolated} skills={len(ctx.skill_set)}"
            )
            return ctx

    async def get(self, subagent_id: str) -> Optional[SubAgentContext]:
        """获取指定 SubAgent context（None 表示不存在）"""
        async with self._lock:
            return self._store.get(subagent_id)

    async def append(self, subagent_id: str, entry: SubAgentMemoryEntry) -> bool:
        """向 SubAgent isolated_messages 追加一条记忆"""
        async with self._lock:
            ctx = self._store.get(subagent_id)
            if ctx is None:
                logger.error(f"SubAgent {subagent_id} 不存在，无法追加记忆")
                return False
            ctx.isolated_messages.append(entry)
            return True

    async def get_messages(
        self, subagent_id: str, include_parent: bool = True
    ) -> List[SubAgentMemoryEntry]:
        """
        获取 SubAgent 完整消息列表
        若 include_parent=True：返回 parent_snapshot + isolated_messages
        若 include_parent=False：仅返回 isolated_messages
        """
        async with self._lock:
            ctx = self._store.get(subagent_id)
            if ctx is None:
                return []
            if include_parent:
                return list(ctx.parent_context_snapshot) + list(ctx.isolated_messages)
            return list(ctx.isolated_messages)

    async def clear(self, subagent_id: str) -> bool:
        """清空 SubAgent isolated_messages（保留 parent_snapshot）"""
        async with self._lock:
            ctx = self._store.get(subagent_id)
            if ctx is None:
                return False
            cleared = len(ctx.isolated_messages)
            ctx.isolated_messages.clear()
            logger.info(f"SubAgent {subagent_id} 已清空 {cleared} 条 isolated 记忆")
            return True

    async def list_subagents(self) -> List[SubAgentContext]:
        """列出所有 SubAgent context"""
        async with self._lock:
            return list(self._store.values())

    async def inherit_from_parent(
        self,
        subagent_id: str,
        parent_id: str,
        parent_messages: List[SubAgentMemoryEntry],
    ) -> bool:
        """
        从父 SubAgent 继承记忆快照
        步骤：
          1. 检查 subagent_id 是否存在
          2. 将 parent_messages 复制到 parent_context_snapshot
          3. 记录 parent_id
        """
        async with self._lock:
            ctx = self._store.get(subagent_id)
            if ctx is None:
                logger.error(f"SubAgent {subagent_id} 不存在，无法继承父记忆")
                return False
            # 复制父消息快照（深拷贝避免引用共享）
            snapshot = [
                SubAgentMemoryEntry(
                    entry_id=e.entry_id,
                    role=e.role,
                    content=e.content,
                    timestamp=e.timestamp,
                    metadata=dict(e.metadata),
                )
                for e in parent_messages
            ]
            ctx.parent_context_snapshot = snapshot
            ctx.parent_id = parent_id
            logger.info(
                f"SubAgent {subagent_id} 已继承父 {parent_id} 的 {len(snapshot)} 条记忆快照"
            )
            return True

    async def get_summary(self) -> Dict[str, Any]:
        """获取整体统计信息（用于前端展示）"""
        async with self._lock:
            total = len(self._store)
            total_isolated_msgs = sum(len(c.isolated_messages) for c in self._store.values())
            total_parent_msgs = sum(
                len(c.parent_context_snapshot) for c in self._store.values()
            )
            isolated_count = sum(1 for c in self._store.values() if c.isolated)
            with_parent = sum(1 for c in self._store.values() if c.parent_id)
            return {
                "total_subagents": total,
                "isolated_subagents": isolated_count,
                "with_parent_inheritance": with_parent,
                "total_isolated_messages": total_isolated_msgs,
                "total_parent_snapshots": total_parent_msgs,
            }


# ============================================================
# 单例 + 辅助
# ============================================================
_memory_store_instance: Optional[InMemorySubAgentMemoryStore] = None


def get_subagent_memory_store() -> InMemorySubAgentMemoryStore:
    """
    获取全局 SubAgent 记忆存储单例
    返回值：InMemorySubAgentMemoryStore 实例
    """
    global _memory_store_instance
    if _memory_store_instance is None:
        _memory_store_instance = InMemorySubAgentMemoryStore()
    return _memory_store_instance


def _new_entry_id() -> str:
    """生成短 ID（entry 标识）"""
    return uuid.uuid4().hex[:12]


def make_memory_entry(
    role: str,
    content: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> SubAgentMemoryEntry:
    """
    工厂函数：构造一条 SubAgentMemoryEntry
    参数：
      - role: 角色名
      - content: 内容
      - metadata: 附加元数据
    返回值：SubAgentMemoryEntry 实例
    """
    return SubAgentMemoryEntry(
        entry_id=_new_entry_id(),
        role=role,
        content=content,
        timestamp=time.time(),
        metadata=metadata or {},
    )
