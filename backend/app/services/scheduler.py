"""
# ============================================================
# 后端核心服务 - 智能体调度器
# ============================================================
# 核心作用：根据任务特性和资源情况，将任务模块分配给合适的
#           子 Claude Code CLI 实例执行
# 运行流程：
#   1. 接收待分配任务列表
#   2. 获取可用智能体列表
#   3. 根据调度策略分配任务
#   4. 支持自动分配和手动指派
# 输入参数：
#   - tasks: List[Task]，待分配任务列表
#   - strategy: str，调度策略
# 输出结果：分配结果字典 {task_id: agent_id}
# ============================================================
"""

import logging
import random
from typing import List, Dict, Optional
from dataclasses import dataclass

from cli_integration.agent_manager import AgentManager, AgentInfo

logger = logging.getLogger(__name__)


@dataclass
class AssignmentResult:
    """
    任务分配结果
    字段说明：
      - task_id: 任务 ID
      - agent_id: 分配的智能体 ID
      - agent_name: 智能体名称
      - success: 是否分配成功
      - reason: 分配原因/失败原因
    """
    task_id: str = ""
    agent_id: str = ""
    agent_name: str = ""
    success: bool = False
    reason: str = ""


class TaskScheduler:
    """
    智能体调度器
    作用：将任务合理分配给可用的子 Claude Code CLI 实例
    调用方：API 层、任务执行引擎
    被调用方：AgentManager
    """

    def __init__(self, agent_manager: AgentManager, strategy: str = "least_loaded"):
        """
        初始化调度器
        参数：
          - agent_manager: 智能体管理器实例
          - strategy: 调度策略（least_loaded / round_robin / random）
        """
        self.agent_manager = agent_manager
        self.strategy = strategy
        # round_robin 策略的轮转计数器
        self._round_robin_index = 0

    async def assign_tasks(
        self,
        task_ids: List[str],
        task_complexities: Optional[Dict[str, float]] = None,
    ) -> List[AssignmentResult]:
        """
        批量分配任务
        运行步骤：
          1. 获取可用智能体列表
          2. 若无可用智能体，所有任务标记为分配失败
          3. 根据调度策略逐个分配任务
          4. 更新智能体负载计数
        参数：
          - task_ids: 任务 ID 列表
          - task_complexities: 任务复杂度映射 {task_id: complexity}
        返回值：AssignmentResult 列表
        """
        results: List[AssignmentResult] = []
        available_agents = await self.agent_manager.get_available_agents()

        if not available_agents:
            logger.warning("没有可用的智能体实例")
            for task_id in task_ids:
                results.append(AssignmentResult(
                    task_id=task_id,
                    reason="没有可用的智能体实例",
                ))
            return results

        for task_id in task_ids:
            complexity = (task_complexities or {}).get(task_id, 0.5)
            result = self._assign_single(task_id, available_agents, complexity)
            results.append(result)

            if result.success:
                # 更新智能体负载
                await self.agent_manager.increment_task_count(result.agent_id)
                # 重新获取可用列表（负载已变化）
                available_agents = await self.agent_manager.get_available_agents()
                if not available_agents:
                    logger.warning("所有智能体已满负载")

        return results

    async def assign_manual(self, task_id: str, agent_id: str) -> AssignmentResult:
        """
        手动指派任务到指定智能体
        运行步骤：
          1. 检查智能体是否存在
          2. 检查智能体是否可用
          3. 分配任务
        参数：
          - task_id: 任务 ID
          - agent_id: 目标智能体 ID
        返回值：AssignmentResult
        """
        agent = await self.agent_manager.get_agent(agent_id)
        if agent is None:
            return AssignmentResult(
                task_id=task_id,
                agent_id=agent_id,
                reason=f"智能体 {agent_id[:8]}... 不存在",
            )

        if agent.current_tasks >= agent.max_concurrent:
            return AssignmentResult(
                task_id=task_id,
                agent_id=agent_id,
                agent_name=agent.name,
                reason=f"智能体 {agent.name} 已满负载 ({agent.current_tasks}/{agent.max_concurrent})",
            )

        await self.agent_manager.increment_task_count(agent_id)
        return AssignmentResult(
            task_id=task_id,
            agent_id=agent_id,
            agent_name=agent.name,
            success=True,
            reason=f"手动指派到 {agent.name}",
        )

    def _assign_single(
        self,
        task_id: str,
        available_agents: List[AgentInfo],
        complexity: float,
    ) -> AssignmentResult:
        """
        单个任务分配（内部方法）
        运行步骤：
          1. 根据调度策略选择智能体
          2. 返回分配结果
        参数：
          - task_id: 任务 ID
          - available_agents: 可用智能体列表
          - complexity: 任务复杂度
        返回值：AssignmentResult
        """
        if self.strategy == "least_loaded":
            agent = self._least_loaded(available_agents)
            reason = "最少负载策略"
        elif self.strategy == "round_robin":
            agent = self._round_robin(available_agents)
            reason = "轮转策略"
        elif self.strategy == "random":
            agent = random.choice(available_agents)
            reason = "随机策略"
        else:
            agent = self._least_loaded(available_agents)
            reason = "默认最少负载策略"

        return AssignmentResult(
            task_id=task_id,
            agent_id=agent.id,
            agent_name=agent.name,
            success=True,
            reason=f"{reason}，复杂度 {complexity:.2f}",
        )

    def _least_loaded(self, agents: List[AgentInfo]) -> AgentInfo:
        """
        最少负载策略：选择当前任务数最少的智能体
        参数：
          - agents: 可用智能体列表
        返回值：负载最少的 AgentInfo
        """
        return min(agents, key=lambda a: a.current_tasks)

    def _round_robin(self, agents: List[AgentInfo]) -> AgentInfo:
        """
        轮转策略：按顺序轮流分配
        参数：
          - agents: 可用智能体列表
        返回值：轮转到的 AgentInfo
        """
        idx = self._round_robin_index % len(agents)
        self._round_robin_index += 1
        return agents[idx]

    async def release_agent(self, agent_id: str):
        """
        释放智能体（任务完成后减少负载计数）
        参数：
          - agent_id: 智能体 ID
        """
        await self.agent_manager.decrement_task_count(agent_id)
