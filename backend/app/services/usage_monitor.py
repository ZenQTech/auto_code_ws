"""
# ============================================================
# 本地用量监控服务模块
# ============================================================
# 核心作用：从 AgentManager 聚合所有 Claude Code CLI 实例的
#           本地用量数据（API 调用次数 + Token 消耗），
#           提供缓存与定时刷新机制
# 运行流程：
#   1. 初始化时关联 AgentManager 实例
#   2. get_usage() 遍历所有智能体，汇总 total_api_calls 和 total_tokens
#   3. 最近 5 小时 API 调用次数通过时间窗口内的调用记录计算
#   4. 缓存有效期 30 秒，get_cached_usage() 返回缓存或触发刷新
#   5. 后台定时刷新任务每 30 秒执行一次
# 输入参数：
#   - agent_manager: AgentManager 实例（数据来源）
# 输出结果：UsageData 数据类实例，包含本地聚合的用量指标
# ============================================================
# 修改记录：
#   v1.0.0 - 2026-06-17：初始版本，远程 API 调用模式
#   v2.0.0 - 2026-06-17：重构为本地聚合模式，从 AgentManager 获取真实用量
# ============================================================
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Optional, List

logger = logging.getLogger(__name__)

# 缓存有效期（秒）
CACHE_TTL_SECONDS = 30


# ============================================================
# 数据类定义
# ============================================================

@dataclass
class UsageData:
    """
    用量数据容器
    字段说明：
      - total_api_calls: 所有智能体累计 API 调用次数
      - remaining_calls: 剩余可用调用次数（基于 Coding Plan 配额估算）
      - total_tokens: 所有智能体累计 Token 消耗
      - recent_5h_api_calls: 最近 5 小时 API 调用次数
      - fetched_at: 数据获取时间戳（Unix 秒）
      - is_local: 是否为本地聚合数据（始终为 True）
    """
    total_api_calls: int = 0
    remaining_calls: int = 0
    total_tokens: int = 0
    recent_5h_api_calls: int = 0
    fetched_at: float = field(default_factory=time.time)
    is_local: bool = True


# ============================================================
# UsageMonitor 类
# ============================================================

class UsageMonitor:
    """
    本地用量监控器
    作用：从 AgentManager 聚合所有 Claude Code CLI 实例的用量数据
    调用方：API 路由层（usage.py）
    被调用方：AgentManager
    """

    # Coding Plan 默认配额（可通过配置覆盖）
    DEFAULT_QUOTA = 10000

    def __init__(self, cache_ttl: int = CACHE_TTL_SECONDS):
        """
        初始化用量监控器
        参数：
          - cache_ttl: 缓存有效期（秒）
        """
        self.cache_ttl = cache_ttl
        self._agent_manager = None  # 延迟绑定

        # 缓存数据
        self._cached_data: Optional[UsageData] = None

        # 后台刷新任务引用
        self._refresh_task: Optional[asyncio.Task] = None

        # 调用时间戳记录（用于计算最近 5 小时调用次数）
        self._call_timestamps: List[float] = []

        logger.info("本地用量监控器初始化完成（数据来源：AgentManager 本地聚合）")

    def bind_agent_manager(self, agent_manager):
        """
        绑定 AgentManager 实例
        参数：
          - agent_manager: AgentManager 实例
        """
        self._agent_manager = agent_manager
        logger.info("用量监控器已绑定 AgentManager")

    def record_api_call(self):
        """
        记录一次 API 调用（由 CLIExecutor 在执行时调用）
        运行步骤：
          1. 记录当前时间戳
          2. 清理超过 5 小时的旧时间戳
        """
        now = time.time()
        self._call_timestamps.append(now)
        # 清理 5 小时前的记录
        cutoff = now - 5 * 3600
        self._call_timestamps = [t for t in self._call_timestamps if t > cutoff]

    async def get_usage(self) -> UsageData:
        """
        从 AgentManager 聚合本地用量数据
        运行步骤：
          1. 遍历所有已注册智能体
          2. 汇总 total_api_calls 和 total_tokens
          3. 计算最近 5 小时调用次数
          4. 基于 Coding Plan 配额计算剩余次数
        参数：无
        返回值：UsageData 实例
        """
        total_api_calls = 0
        total_tokens = 0

        if self._agent_manager is not None:
            agents = await self._agent_manager.get_all_agents()
            for agent in agents:
                total_api_calls += agent.total_api_calls
                total_tokens += agent.total_tokens

        # 最近 5 小时调用次数
        now = time.time()
        cutoff = now - 5 * 3600
        recent_5h = sum(1 for t in self._call_timestamps if t > cutoff)

        # 剩余调用次数 = 配额 - 总调用次数
        remaining = max(0, self.DEFAULT_QUOTA - total_api_calls)

        return UsageData(
            total_api_calls=total_api_calls,
            remaining_calls=remaining,
            total_tokens=total_tokens,
            recent_5h_api_calls=recent_5h,
            fetched_at=now,
            is_local=True,
        )

    async def get_cached_usage(self) -> UsageData:
        """
        获取缓存的用量数据，若缓存过期或不存在则触发刷新
        运行步骤：
          1. 检查缓存是否存在且未过期
          2. 若缓存有效，直接返回缓存数据
          3. 若缓存过期或不存在，调用 get_usage() 刷新并更新缓存
        参数：无
        返回值：UsageData 实例
        """
        now = time.time()

        if self._cached_data is not None:
            age = now - self._cached_data.fetched_at
            if age < self.cache_ttl:
                return self._cached_data

        self._cached_data = await self.get_usage()
        return self._cached_data

    async def _background_refresh_loop(self):
        """
        后台定时刷新循环（内部方法）
        运行步骤：
          1. 等待缓存 TTL 时间
          2. 调用 get_usage() 刷新数据
          3. 更新缓存
          4. 循环执行
        """
        logger.info(f"后台用量刷新任务启动，刷新间隔: {self.cache_ttl}s")
        while True:
            try:
                await asyncio.sleep(self.cache_ttl)
                self._cached_data = await self.get_usage()
                logger.debug(
                    f"用量数据已刷新: api_calls={self._cached_data.total_api_calls}, "
                    f"tokens={self._cached_data.total_tokens}"
                )
            except asyncio.CancelledError:
                logger.info("后台用量刷新任务被取消")
                break
            except Exception as e:
                logger.error(f"后台用量刷新异常: {e}")

    def start_background_refresh(self):
        """
        启动后台定时刷新任务
        调用方：应用启动时（main.py lifespan）
        """
        if self._refresh_task is None or self._refresh_task.done():
            self._refresh_task = asyncio.create_task(self._background_refresh_loop())
            logger.info("后台用量刷新任务已创建")
        else:
            logger.warning("后台用量刷新任务已在运行中")

    def stop_background_refresh(self):
        """
        停止后台定时刷新任务
        调用方：应用关闭时（main.py lifespan）
        """
        if self._refresh_task and not self._refresh_task.done():
            self._refresh_task.cancel()
            logger.info("后台用量刷新任务已取消")


# 全局用量监控器单例
usage_monitor = UsageMonitor()
