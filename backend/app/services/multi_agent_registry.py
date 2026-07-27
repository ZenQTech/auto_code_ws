"""
# ============================================================
# Multi-Agent v2 Path-Based Registry
# ============================================================
# 核心作用：实现 Codex v0.121+ Multi-Agent v2 path-based addressing
#           多智能体编排系统，支持 spawn_agent / wait_agent /
#           close_agent / send_message / followup_task 五大工具
# 设计要点：
#   1. Path-based addressing: /root/{task_name}[/{child_task_name}]*
#   2. Slot reservation: max_threads 限制并发数
#   3. Auto-cleanup: turn 结束自动释放 slot（Codex bug fix 模式）
#   4. Recursion limit: max_depth 防止无限递归
#   5. Lifecycle: pending → running → completed/failed → closed
# 运行流程：
#   spawn_agent → reserve_slot → create_node → status=running
#   turn 结束 / close_agent → release_slot → status=closed
#   wait_agent → asyncio.Event.wait until status in (completed/failed)
# 输入参数：
#   - parent_path: 父路径（必须以 / 开头）
#   - task_name: 路径最后一段
#   - message: 任务描述
#   - model/sandbox: 可选覆盖
# 输出结果：Dict 包含 success / subagent_id / path / depth
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 7 P0-10 初始化
#     - 实现 MultiAgentRegistry 核心调度器
#     - 实现 5 个工具 API（spawn/wait/close/send/followup）
#     - 实现 slot reservation + turn-end auto cleanup
# ============================================================
"""

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)


# ============================================================
# 枚举：状态
# ============================================================
class SubAgentStatus(str, Enum):
    """SubAgent 生命周期状态"""
    PENDING = "pending"      # 已创建未启动
    RUNNING = "running"      # 执行中
    COMPLETED = "completed"  # 正常完成
    FAILED = "failed"        # 失败
    CLOSED = "closed"        # 显式关闭（slot 已释放）


# ============================================================
# 数据类
# ============================================================
@dataclass
class SubAgentNode:
    """SubAgent 节点（path-based）"""
    path: str                       # 完整路径 /root/researcher
    task_name: str                  # 路径最后一段
    parent_path: Optional[str]      # 父路径
    subagent_id: str                # 内部唯一 ID
    model: str = "claude-sonnet"
    sandbox: str = "workspace-write"
    status: str = SubAgentStatus.PENDING.value
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    closed_at: Optional[float] = None
    result: Optional[str] = None
    error: Optional[str] = None
    depth: int = 0                  # 路径深度（/root = 1, /root/x = 2）
    message: str = ""               # 任务描述
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "path": self.path,
            "task_name": self.task_name,
            "parent_path": self.parent_path,
            "subagent_id": self.subagent_id,
            "model": self.model,
            "sandbox": self.sandbox,
            "status": self.status,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "closed_at": self.closed_at,
            "result": self.result,
            "error": self.error,
            "depth": self.depth,
            "message": self.message[:200] if self.message else "",
            "metadata": self.metadata,
        }


@dataclass
class SubAgentSlot:
    """SubAgent slot 槽位（Codex bug fix 模式）"""
    path: str
    subagent_id: str
    reserved_at: float
    state: str = "active"  # active / released


@dataclass
class SubAgentMessage:
    """SubAgent 间消息"""
    msg_id: str
    from_path: str
    to_path: str
    body: str
    msg_type: str  # "send" / "followup"
    sent_at: float = field(default_factory=time.time)
    read: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "msg_id": self.msg_id,
            "from_path": self.from_path,
            "to_path": self.to_path,
            "body": self.body[:300] if self.body else "",
            "msg_type": self.msg_type,
            "sent_at": self.sent_at,
            "read": self.read,
        }


# ============================================================
# 路径工具
# ============================================================
def parse_path(path: str) -> List[str]:
    """
    解析 path 为段列表
    规则：必须以 / 开头；空段被过滤
    参数：path 如 "/root/researcher/summarizer"
    返回值：["root", "researcher", "summarizer"]
    """
    if not path or not path.startswith("/"):
        raise ValueError(f"路径必须以 / 开头: {path}")
    parts = [p for p in path.split("/") if p]
    if not parts:
        raise ValueError(f"路径不能为空: {path}")
    return parts


def path_depth(path: str) -> int:
    """路径深度（/root = 1, /root/x = 2）"""
    return len(parse_path(path))


def is_valid_task_name(name: str) -> bool:
    """task_name 合法性：字母数字下划线短横线，长度 1-64"""
    if not name or len(name) > 64:
        return False
    return all(c.isalnum() or c in "_-" for c in name)


def join_path(parent: str, child: str) -> str:
    """拼接父子路径"""
    parent = parent.rstrip("/")
    return f"{parent}/{child}"


# ============================================================
# MultiAgentRegistry 核心调度器
# ============================================================
class MultiAgentRegistry:
    """
    Multi-Agent v2 注册表
    核心职责：
      1. 维护 path-based SubAgent 树
      2. slot reservation 防止泄漏
      3. 提供 spawn/wait/close/send/followup 工具
      4. turn 结束自动清理
    """

    def __init__(self, max_threads: int = 6, max_depth: int = 3):
        """
        初始化
        参数：
          - max_threads 最大并发 slot 数（默认 6，Codex 默认）
          - max_depth 最大嵌套深度（默认 3，含 /root）
        """
        self.max_threads = max_threads
        self.max_depth = max_depth
        self._nodes: Dict[str, SubAgentNode] = {}
        self._slots: Dict[str, SubAgentSlot] = {}  # path -> slot
        self._messages: List[SubAgentMessage] = []
        self._completion_events: Dict[str, asyncio.Event] = {}
        self._completion_results: Dict[str, Dict[str, Any]] = {}
        self._lock = asyncio.Lock()
        # 根节点（orchestrator）
        self._nodes["/root"] = SubAgentNode(
            path="/root",
            task_name="root",
            parent_path=None,
            subagent_id="root-orchestrator",
            status=SubAgentStatus.RUNNING.value,
            depth=1,
            message="orchestrator root",
        )
        logger.info(
            f"MultiAgentRegistry 初始化: max_threads={max_threads}, max_depth={max_depth}"
        )

    # ============================================================
    # 内部：slot 管理
    # ============================================================
    def _active_slot_count(self) -> int:
        """活跃 slot 数量"""
        return sum(1 for s in self._slots.values() if s.state == "active")

    def _try_reserve_slot(self, path: str, subagent_id: str) -> bool:
        """
        尝试 reserve slot
        返回 True 成功；False 已达 max_threads
        """
        if self._active_slot_count() >= self.max_threads:
            return False
        self._slots[path] = SubAgentSlot(
            path=path,
            subagent_id=subagent_id,
            reserved_at=time.time(),
            state="active",
        )
        return True

    def _release_slot(self, path: str) -> None:
        """释放 slot（幂等）"""
        slot = self._slots.get(path)
        if slot and slot.state == "active":
            slot.state = "released"
            logger.debug(f"释放 slot: {path}")

    def _ensure_depth(self, path: str) -> None:
        """检查路径深度限制"""
        depth = path_depth(path)
        if depth > self.max_depth:
            raise ValueError(
                f"路径深度 {depth} 超过 max_depth={self.max_depth}: {path}"
            )

    # ============================================================
    # 工具 1: spawn_agent
    # ============================================================
    async def spawn_agent(
        self,
        parent_path: str,
        task_name: str,
        message: str,
        model: Optional[str] = None,
        sandbox: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        spawn_agent 工具
        参数：
          - parent_path 父路径
          - task_name 子任务名
          - message 任务描述
          - model/sandbox 可选覆盖
        返回值：{"success": True, "subagent_id": "...", "path": "/root/x", "depth": N}
        """
        async with self._lock:
            # 校验
            if not is_valid_task_name(task_name):
                return {"success": False, "error": f"非法 task_name: {task_name}"}

            # 父节点必须存在
            if parent_path not in self._nodes:
                return {"success": False, "error": f"父节点不存在: {parent_path}"}

            new_path = join_path(parent_path, task_name)

            # 深度检查
            try:
                self._ensure_depth(new_path)
            except ValueError as e:
                return {"success": False, "error": str(e)}

            # 同名冲突
            if new_path in self._nodes:
                return {
                    "success": False,
                    "error": f"子节点已存在: {new_path}",
                }

            # slot 限制
            if self._active_slot_count() >= self.max_threads:
                return {
                    "success": False,
                    "error": (
                        f"已达 max_threads={self.max_threads} 限制，"
                        f"无法 spawn 更多 SubAgent"
                    ),
                }

            # 创建节点
            subagent_id = f"sa-{uuid.uuid4().hex[:12]}"
            node = SubAgentNode(
                path=new_path,
                task_name=task_name,
                parent_path=parent_path,
                subagent_id=subagent_id,
                model=model or "claude-sonnet",
                sandbox=sandbox or "workspace-write",
                status=SubAgentStatus.RUNNING.value,
                started_at=time.time(),
                depth=path_depth(new_path),
                message=message,
                metadata=metadata or {},
            )
            self._nodes[new_path] = node

            # reserve slot
            self._try_reserve_slot(new_path, subagent_id)

            # 准备 completion event
            self._completion_events[new_path] = asyncio.Event()
            self._completion_results[new_path] = {}

            logger.info(
                f"spawn_agent: {parent_path} → {new_path} "
                f"(id={subagent_id}, depth={node.depth})"
            )

            return {
                "success": True,
                "subagent_id": subagent_id,
                "path": new_path,
                "depth": node.depth,
                "parent_path": parent_path,
                "task_name": task_name,
                "status": node.status,
                "slot_reserved": True,
            }

    # ============================================================
    # 工具 2: wait_agent
    # ============================================================
    async def wait_agent(
        self,
        target: str,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        wait_agent 工具
        参数：
          - target 目标路径
          - timeout 超时秒数（None=无限等待）
        返回值：{"success": True, "status": "completed", "result": "..."}
        """
        node = self._nodes.get(target)
        if not node:
            return {"success": False, "error": f"目标节点不存在: {target}"}

        event = self._completion_events.get(target)
        if not event:
            return {
                "success": False,
                "error": f"目标节点无 completion event: {target}",
            }

        # 已完成则直接返回
        if node.status in (
            SubAgentStatus.COMPLETED.value,
            SubAgentStatus.FAILED.value,
            SubAgentStatus.CLOSED.value,
        ):
            result = self._completion_results.get(target, {})
            return {
                "success": True,
                "path": target,
                "status": node.status,
                "result": node.result,
                "error": node.error,
                "duration_sec": (node.closed_at or time.time()) - (node.started_at or node.created_at),
                **result,
            }

        # 等待
        try:
            if timeout:
                await asyncio.wait_for(event.wait(), timeout=timeout)
            else:
                await event.wait()
        except asyncio.TimeoutError:
            return {
                "success": False,
                "error": f"wait_agent 超时 ({timeout}s): {target}",
                "status": node.status,
            }

        # 完成后返回
        result = self._completion_results.get(target, {})
        return {
            "success": True,
            "path": target,
            "status": node.status,
            "result": node.result,
            "error": node.error,
            "duration_sec": (node.closed_at or time.time()) - (node.started_at or node.created_at),
            **result,
        }

    # ============================================================
    # 工具 3: close_agent
    # ============================================================
    async def close_agent(
        self,
        target: str,
        recursive: bool = False,
    ) -> Dict[str, Any]:
        """
        close_agent 工具
        参数：
          - target 目标路径
          - recursive 是否递归关闭所有子节点
        返回值：{"success": True, "closed": 1}
        """
        async with self._lock:
            node = self._nodes.get(target)
            if not node:
                return {"success": False, "error": f"目标节点不存在: {target}"}

            closed_paths = []

            # 关闭目标
            if node.status not in (
                SubAgentStatus.CLOSED.value,
            ):
                node.status = SubAgentStatus.CLOSED.value
                node.closed_at = time.time()
                self._release_slot(target)
                self._signal_completion(target, status=SubAgentStatus.CLOSED.value)
                closed_paths.append(target)

            # 递归关闭子节点
            if recursive:
                for child_path, child in list(self._nodes.items()):
                    if child_path == target:
                        continue
                    if child.parent_path == target or child_path.startswith(target + "/"):
                        if child.status != SubAgentStatus.CLOSED.value:
                            child.status = SubAgentStatus.CLOSED.value
                            child.closed_at = time.time()
                            self._release_slot(child_path)
                            self._signal_completion(
                                child_path, status=SubAgentStatus.CLOSED.value
                            )
                            closed_paths.append(child_path)

            logger.info(
                f"close_agent: {target} (recursive={recursive}) "
                f"closed {len(closed_paths)} nodes"
            )
            return {
                "success": True,
                "closed": len(closed_paths),
                "paths": closed_paths,
            }

    # ============================================================
    # 工具 4: send_message
    # ============================================================
    async def send_message(
        self,
        from_path: str,
        to_path: str,
        body: str,
    ) -> Dict[str, Any]:
        """
        send_message 工具
        参数：
          - from_path 发送方路径
          - to_path 接收方路径
          - body 消息内容
        返回值：{"success": True, "msg_id": "..."}
        """
        if from_path not in self._nodes:
            return {"success": False, "error": f"发送方不存在: {from_path}"}
        if to_path not in self._nodes:
            return {"success": False, "error": f"接收方不存在: {to_path}"}
        if not body or len(body) > 50_000:
            return {"success": False, "error": "body 必须非空且 ≤ 50000 字符"}

        msg = SubAgentMessage(
            msg_id=f"msg-{uuid.uuid4().hex[:10]}",
            from_path=from_path,
            to_path=to_path,
            body=body,
            msg_type="send",
        )
        self._messages.append(msg)
        logger.info(
            f"send_message: {from_path} → {to_path} ({len(body)} chars)"
        )
        return {
            "success": True,
            "msg_id": msg.msg_id,
            "from_path": from_path,
            "to_path": to_path,
            "len": len(body),
        }

    # ============================================================
    # 工具 5: followup_task
    # ============================================================
    async def followup_task(
        self,
        from_path: str,
        to_path: str,
        task: str,
    ) -> Dict[str, Any]:
        """
        followup_task 工具
        参数：
          - from_path 发送方
          - to_path 已关闭的 SubAgent
          - task 后续任务
        返回值：{"success": True, "msg_id": "..."}
        """
        if from_path not in self._nodes:
            return {"success": False, "error": f"发送方不存在: {from_path}"}
        target = self._nodes.get(to_path)
        if not target:
            return {"success": False, "error": f"目标不存在: {to_path}"}

        # followup 可以作用于 closed/completed/failed 节点，激活它们
        if target.status == SubAgentStatus.CLOSED.value:
            # 重新激活：reserve slot
            if not self._try_reserve_slot(to_path, target.subagent_id):
                return {
                    "success": False,
                    "error": "无法 reserve slot（max_threads 已满）",
                }
            target.status = SubAgentStatus.RUNNING.value
            target.closed_at = None
            target.started_at = time.time()
            # 重新创建 event
            self._completion_events[to_path] = asyncio.Event()
            self._completion_results[to_path] = {}
            logger.info(f"followup_task 重新激活: {to_path}")

        msg = SubAgentMessage(
            msg_id=f"msg-{uuid.uuid4().hex[:10]}",
            from_path=from_path,
            to_path=to_path,
            body=task,
            msg_type="followup",
        )
        self._messages.append(msg)
        return {
            "success": True,
            "msg_id": msg.msg_id,
            "to_path": to_path,
            "reactivated": target.status == SubAgentStatus.RUNNING.value,
        }

    # ============================================================
    # 查询 API
    # ============================================================
    def list_agents(
        self,
        parent_path: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        list_agents(path?, status?)
        参数：
          - parent_path 仅列出该路径下的直接子节点（None=全部）
          - status 仅列出指定状态（None=全部）
        返回值：节点 dict 列表
        """
        results = []
        for path, node in self._nodes.items():
            if path == "/root":
                # 根节点只在 parent_path=None 时返回
                if parent_path is None:
                    if status is None or node.status == status:
                        results.append(node.to_dict())
                continue

            if parent_path is not None and node.parent_path != parent_path:
                continue

            if status is not None and node.status != status:
                continue

            results.append(node.to_dict())

        results.sort(key=lambda d: d["created_at"])
        return results

    def get_tree(self) -> Dict[str, Any]:
        """
        get_tree()：返回完整树状结构
        返回值：{
            "root": {...},
            "children": [
                {"path": "/root/x", "status": ..., "children": [...]},
                ...
            ]
        }
        """
        def build_subtree(path: str) -> Dict[str, Any]:
            node = self._nodes.get(path)
            if not node:
                return {}
            children = []
            for child_path, child in self._nodes.items():
                if child.parent_path == path:
                    children.append(build_subtree(child_path))
            return {
                **node.to_dict(),
                "children": sorted(children, key=lambda c: c.get("created_at", 0)),
            }

        return build_subtree("/root")

    def get_stats(self) -> Dict[str, Any]:
        """
        get_stats()：返回注册表统计
        返回值：{
            "total": N, "active_slots": N, "max_threads": N,
            "max_depth": N, "by_status": {...}, "max_actual_depth": N
        }
        """
        status_count: Dict[str, int] = {}
        max_depth = 0
        for node in self._nodes.values():
            status_count[node.status] = status_count.get(node.status, 0) + 1
            if node.depth > max_depth:
                max_depth = node.depth

        return {
            "total": len(self._nodes),
            "active_slots": self._active_slot_count(),
            "max_threads": self.max_threads,
            "max_depth": self.max_depth,
            "max_actual_depth": max_depth,
            "by_status": status_count,
            "message_count": len(self._messages),
        }

    def get_messages(
        self,
        path: Optional[str] = None,
        unread_only: bool = False,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """
        get_messages(path?, unread_only?, limit=50)
        返回：消息 dict 列表（最新优先）
        """
        results = []
        for msg in reversed(self._messages):
            if path is not None and msg.from_path != path and msg.to_path != path:
                continue
            if unread_only and msg.read:
                continue
            results.append(msg.to_dict())
            if len(results) >= limit:
                break
        return results

    def get_node(self, path: str) -> Optional[Dict[str, Any]]:
        """获取单个节点"""
        node = self._nodes.get(path)
        return node.to_dict() if node else None

    # ============================================================
    # 内部：完成信号（模拟 SubAgent 完成任务）
    # ============================================================
    def signal_completion(
        self,
        target: str,
        result: Optional[str] = None,
        error: Optional[str] = None,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        内部/测试用：标记 SubAgent 完成
        参数：
          - target 路径
          - result 成功结果
          - error 错误信息
          - status 强制状态（默认 completed/failed）
        """
        node = self._nodes.get(target)
        if not node:
            return {"success": False, "error": f"节点不存在: {target}"}

        if status:
            node.status = status
        elif error:
            node.status = SubAgentStatus.FAILED.value
        else:
            node.status = SubAgentStatus.COMPLETED.value

        node.closed_at = time.time()
        node.result = result
        node.error = error
        # 释放 slot
        self._release_slot(target)
        # 触发 event
        self._signal_completion(target, status=node.status)
        return {"success": True, "path": target, "status": node.status}

    def _signal_completion(self, target: str, status: str) -> None:
        """设置 completion event"""
        event = self._completion_events.get(target)
        if event and not event.is_set():
            self._completion_results[target] = {"status": status}
            event.set()

    # ============================================================
    # 内部：turn 结束自动清理（Codex bug fix 模式）
    # ============================================================
    async def auto_cleanup_on_turn(self, parent_path: str) -> Dict[str, Any]:
        """
        turn 结束自动清理：关闭已完成子节点，释放 slot
        防止 Codex #18335 报告的 slot 泄漏 bug
        """
        async with self._lock:
            cleaned = []
            for path, node in list(self._nodes.items()):
                if path == "/root":
                    continue
                if node.parent_path == parent_path or path.startswith(parent_path + "/"):
                    if node.status in (
                        SubAgentStatus.COMPLETED.value,
                        SubAgentStatus.FAILED.value,
                    ):
                        # 释放 slot 但不触发 close
                        self._release_slot(path)
                        cleaned.append(path)
                        logger.debug(f"auto_cleanup: 释放 slot {path}")

            return {
                "success": True,
                "cleaned": len(cleaned),
                "paths": cleaned,
            }

    # ============================================================
    # 内部：强制删除节点
    # ============================================================
    async def force_delete(self, path: str, recursive: bool = False) -> Dict[str, Any]:
        """
        强制删除节点（连同子节点可选）
        与 close_agent 不同：close_agent 保留历史，force_delete 完全清除
        """
        async with self._lock:
            target = self._nodes.get(path)
            if not target:
                return {"success": False, "error": f"节点不存在: {path}"}

            deleted_paths = []
            paths_to_delete = []
            if recursive:
                for child_path in self._nodes:
                    if child_path == path or child_path.startswith(path + "/"):
                        paths_to_delete.append(child_path)
            else:
                # 检查是否有子节点
                has_children = any(
                    c.parent_path == path for c in self._nodes.values()
                )
                if has_children:
                    return {
                        "success": False,
                        "error": f"节点 {path} 有子节点，需 recursive=true",
                    }
                paths_to_delete = [path]

            for p in paths_to_delete:
                if p in self._nodes:
                    del self._nodes[p]
                    self._release_slot(p)
                    if p in self._completion_events:
                        del self._completion_events[p]
                    if p in self._completion_results:
                        del self._completion_results[p]
                    deleted_paths.append(p)

            return {
                "success": True,
                "deleted": len(deleted_paths),
                "paths": deleted_paths,
            }

    # ============================================================
    # 清理
    # ============================================================
    async def clear_all(self) -> Dict[str, Any]:
        """清空所有非根节点（用于测试）"""
        async with self._lock:
            cleared = []
            for path in list(self._nodes.keys()):
                if path != "/root":
                    del self._nodes[path]
                    cleared.append(path)
            self._slots.clear()
            self._messages.clear()
            self._completion_events.clear()
            self._completion_results.clear()
            return {"success": True, "cleared": len(cleared)}


# ============================================================
# 全局单例（按 session 隔离）
# ============================================================
_registries: Dict[str, MultiAgentRegistry] = {}


def get_registry(session_id: str = "default") -> MultiAgentRegistry:
    """获取或创建 session 隔离的 registry"""
    if session_id not in _registries:
        _registries[session_id] = MultiAgentRegistry()
    return _registries[session_id]
