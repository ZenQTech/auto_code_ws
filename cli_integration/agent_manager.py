"""
# ============================================================
# Claude Code CLI 集成层 - 子实例管理器
# ============================================================
# 核心作用：管理多个子 Claude Code CLI 实例的生命周期，
#           包括注册、注销、健康检查、状态监控
# 运行流程：
#   1. 维护子实例注册表（内存字典）
#   2. 提供注册/注销接口
#   3. 定期健康检查（心跳检测）
#   4. 状态变更通知
# 输入参数：
#   - agent_id: str，智能体唯一标识
#   - agent_info: dict，智能体配置信息
# 输出结果：AgentInfo 对象，包含实例状态和统计信息
# ============================================================
"""

import asyncio
import uuid
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional, Callable, List
from enum import Enum

logger = logging.getLogger(__name__)


class AgentStatus(str, Enum):
    """智能体状态枚举"""
    ONLINE = "online"
    BUSY = "busy"
    OFFLINE = "offline"
    ERROR = "error"


@dataclass
class AgentInfo:
    """
    智能体实例信息
    字段说明：
      - id: 唯一标识（UUID）
      - name: 可识别名称
      - avatar_seed: 头像生成种子
      - status: 当前状态
      - cli_path: CLI 可执行文件路径
      - workspace: 工作空间路径
      - max_concurrent: 最大并发任务数
      - current_tasks: 当前执行中的任务数
      - total_tokens: 累计 Token 消耗
      - total_api_calls: 累计 API 调用次数
      - last_heartbeat: 最后心跳时间
      - created_at: 创建时间
    """
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""
    avatar_seed: str = ""
    status: AgentStatus = AgentStatus.OFFLINE
    cli_path: str = "claude"
    workspace: str = ""
    max_concurrent: int = 5
    current_tasks: int = 0
    total_tokens: int = 0
    total_api_calls: int = 0
    last_heartbeat: Optional[datetime] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class AgentManager:
    """
    子实例管理器
    作用：管理所有子 Claude Code CLI 实例的注册、注销、健康检查
    调用方：调度器、API 层
    被调用方：CLIExecutor
    """

    def __init__(self, health_check_interval: int = 30):
        """
        初始化管理器
        参数：
          - health_check_interval: 健康检查间隔（秒）
        """
        # 实例注册表：{agent_id: AgentInfo}
        self._agents: Dict[str, AgentInfo] = {}
        self._lock = asyncio.Lock()
        self._health_check_interval = health_check_interval
        self._health_check_task: Optional[asyncio.Task] = None
        # 状态变更回调列表
        self._status_callbacks: List[Callable] = []

    async def register_agent(
        self,
        name: str,
        cli_path: str = "claude",
        workspace: str = "",
        max_concurrent: int = 5,
    ) -> AgentInfo:
        """
        注册新的子实例
        运行步骤：
          1. 生成唯一 ID 和头像种子
          2. 创建 AgentInfo 对象
          3. 加入注册表
          4. 触发状态变更回调
        参数：
          - name: 智能体名称
          - cli_path: CLI 路径
          - workspace: 工作空间
          - max_concurrent: 最大并发数
        返回值：新创建的 AgentInfo 对象
        """
        async with self._lock:
            agent = AgentInfo(
                id=str(uuid.uuid4()),
                name=name,
                avatar_seed=str(uuid.uuid4())[:8],  # 取前 8 位作为头像种子
                cli_path=cli_path,
                workspace=workspace,
                max_concurrent=max_concurrent,
                status=AgentStatus.ONLINE,
                last_heartbeat=datetime.now(timezone.utc),
            )
            self._agents[agent.id] = agent
            logger.info(f"智能体已注册: {agent.name} (ID: {agent.id[:8]}...)")
            self._notify_status_change(agent.id, agent.status)
            return agent

    async def unregister_agent(self, agent_id: str) -> bool:
        """
        注销子实例
        运行步骤：
          1. 从注册表中移除
          2. 触发状态变更回调
        参数：
          - agent_id: 智能体 ID
        返回值：是否成功注销
        """
        async with self._lock:
            if agent_id in self._agents:
                agent = self._agents.pop(agent_id)
                logger.info(f"智能体已注销: {agent.name} (ID: {agent_id[:8]}...)")
                self._notify_status_change(agent_id, AgentStatus.OFFLINE)
                return True
            return False

    async def get_agent(self, agent_id: str) -> Optional[AgentInfo]:
        """
        获取指定智能体信息
        参数：
          - agent_id: 智能体 ID
        返回值：AgentInfo 或 None
        """
        async with self._lock:
            return self._agents.get(agent_id)

    async def get_all_agents(self) -> List[AgentInfo]:
        """
        获取所有已注册智能体列表
        返回值：AgentInfo 列表
        """
        async with self._lock:
            return list(self._agents.values())

    async def get_available_agents(self) -> List[AgentInfo]:
        """
        获取可用智能体列表（在线且未满负载）
        运行步骤：
          1. 遍历所有智能体
          2. 筛选状态为 ONLINE 且当前任务数 < 最大并发数的实例
        返回值：可用 AgentInfo 列表
        """
        async with self._lock:
            return [
                agent
                for agent in self._agents.values()
                if agent.status == AgentStatus.ONLINE
                and agent.current_tasks < agent.max_concurrent
            ]

    async def update_agent_status(self, agent_id: str, status: AgentStatus):
        """
        更新智能体状态
        参数：
          - agent_id: 智能体 ID
          - status: 新状态
        """
        async with self._lock:
            agent = self._agents.get(agent_id)
            if agent:
                old_status = agent.status
                agent.status = status
                agent.last_heartbeat = datetime.now(timezone.utc)
                if old_status != status:
                    logger.info(
                        f"智能体状态变更: {agent.name} {old_status.value} -> {status.value}"
                    )
                    self._notify_status_change(agent_id, status)

    async def increment_task_count(self, agent_id: str):
        """
        增加智能体当前任务计数
        参数：
          - agent_id: 智能体 ID
        """
        async with self._lock:
            agent = self._agents.get(agent_id)
            if agent:
                agent.current_tasks += 1
                if agent.current_tasks >= agent.max_concurrent:
                    old_status = agent.status
                    agent.status = AgentStatus.BUSY
                    agent.last_heartbeat = datetime.now(timezone.utc)
                    if old_status != AgentStatus.BUSY:
                        logger.info(
                            f"智能体状态变更: {agent.name} {old_status.value} -> {AgentStatus.BUSY.value}"
                        )
                        self._notify_status_change(agent_id, AgentStatus.BUSY)

    async def decrement_task_count(self, agent_id: str):
        """
        减少智能体当前任务计数
        参数：
          - agent_id: 智能体 ID
        """
        async with self._lock:
            agent = self._agents.get(agent_id)
            if agent:
                agent.current_tasks = max(0, agent.current_tasks - 1)
                if agent.current_tasks < agent.max_concurrent and agent.status == AgentStatus.BUSY:
                    old_status = agent.status
                    agent.status = AgentStatus.ONLINE
                    agent.last_heartbeat = datetime.now(timezone.utc)
                    if old_status != AgentStatus.ONLINE:
                        logger.info(
                            f"智能体状态变更: {agent.name} {old_status.value} -> {AgentStatus.ONLINE.value}"
                        )
                        self._notify_status_change(agent_id, AgentStatus.ONLINE)

    async def add_token_usage(self, agent_id: str, tokens: int, api_calls: int = 1):
        """
        累加 Token 和 API 调用统计
        参数：
          - agent_id: 智能体 ID
          - tokens: 本次消耗 Token 数
          - api_calls: 本次 API 调用次数
        """
        async with self._lock:
            agent = self._agents.get(agent_id)
            if agent:
                agent.total_tokens += tokens
                agent.total_api_calls += api_calls

    def on_status_change(self, callback: Callable):
        """
        注册状态变更回调
        参数：
          - callback: 回调函数，签名为 callback(agent_id: str, status: AgentStatus)
        """
        self._status_callbacks.append(callback)

    def _notify_status_change(self, agent_id: str, status: AgentStatus):
        """
        通知所有状态变更回调
        参数：
          - agent_id: 智能体 ID
          - status: 新状态
        """
        for callback in self._status_callbacks:
            try:
                callback(agent_id, status)
            except Exception as e:
                logger.error(f"状态回调执行异常: {e}")

    async def start_health_check(self):
        """
        启动定期健康检查任务
        运行步骤：
          1. 创建异步循环任务
          2. 每隔 health_check_interval 秒检查所有实例状态
          3. 超时未心跳的实例标记为 OFFLINE
        """
        if self._health_check_task is not None:
            return

        async def _check_loop():
            while True:
                await asyncio.sleep(self._health_check_interval)
                await self._perform_health_check()

        self._health_check_task = asyncio.create_task(_check_loop())
        logger.info(f"健康检查已启动，间隔 {self._health_check_interval}s")

    async def stop_health_check(self):
        """停止健康检查任务"""
        if self._health_check_task:
            self._health_check_task.cancel()
            try:
                await self._health_check_task
            except asyncio.CancelledError:
                pass
            self._health_check_task = None
            logger.info("健康检查已停止")

    async def _perform_health_check(self):
        """
        执行健康检查
        运行步骤：
          1. 遍历所有智能体
          2. 检查最后心跳时间
          3. 超时（2 倍检查间隔）则标记为 OFFLINE
        """
        async with self._lock:
            now = datetime.now(timezone.utc)
            timeout_seconds = self._health_check_interval * 2

            for agent in self._agents.values():
                if agent.last_heartbeat is None:
                    continue
                elapsed = (now - agent.last_heartbeat).total_seconds()
                if elapsed > timeout_seconds and agent.status != AgentStatus.OFFLINE:
                    logger.warning(
                        f"智能体 {agent.name} 心跳超时 ({elapsed:.0f}s)，标记为离线"
                    )
                    old_status = agent.status
                    agent.status = AgentStatus.OFFLINE
                    agent.last_heartbeat = now
                    if old_status != AgentStatus.OFFLINE:
                        self._notify_status_change(agent.id, AgentStatus.OFFLINE)
