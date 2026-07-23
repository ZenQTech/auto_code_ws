"""
# ============================================================
# Claude Code CLI 集成层 - 执行策略路由器
# ============================================================
# 核心作用：根据任务复杂度自动选择执行模式
#           （直接执行 / Subagent / Agent Team）
# 运行流程：
#   1. 接收任务描述和复杂度评分
#   2. 根据评分阈值路由到对应执行模式
#   3. 构建对应模式的 CLI 命令模板
#   4. 返回执行指令
# 输入参数：
#   - task_description: str，任务描述
#   - complexity_score: float，复杂度评分（0-1）
# 输出结果：ExecutionStrategy 对象，包含执行模式和命令模板
# ============================================================
"""

import logging
from dataclasses import dataclass
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)


class ExecutionMode(str, Enum):
    """
    执行模式枚举
    - DIRECT: 直接执行（简单任务）
    - SUBAGENT: Subagent 模式（中等复杂度）
    - AGENT_TEAM: Agent Team 协作模式（高复杂度）
    """
    DIRECT = "direct"
    SUBAGENT = "subagent"
    AGENT_TEAM = "agent_team"


@dataclass
class ExecutionStrategy:
    """
    执行策略
    字段说明：
      - mode: 执行模式
      - command_template: CLI 命令模板
      - reasoning: 选择该模式的原因说明
    """
    mode: ExecutionMode
    command_template: str
    reasoning: str = ""


class StrategyRouter:
    """
    执行策略路由器
    作用：根据任务复杂度自动选择最优执行模式
    调用方：TaskExecutor、调度器
    被调用方：CLIExecutor
    """

    # 复杂度阈值定义
    # 0.0 - 0.3: 简单任务，直接执行
    # 0.3 - 0.7: 中等复杂度，使用 Subagent
    # 0.7 - 1.0: 高复杂度，使用 Agent Team
    DIRECT_THRESHOLD = 0.3
    SUBAGENT_THRESHOLD = 0.7

    def route(self, task_description: str, complexity_score: float) -> ExecutionStrategy:
        """
        根据复杂度评分路由到对应执行模式
        运行步骤：
          1. 校验复杂度评分范围
          2. 根据阈值判断执行模式
          3. 构建对应的命令模板
          4. 返回执行策略
        参数：
          - task_description: 任务描述文本
          - complexity_score: 复杂度评分（0-1）
        返回值：ExecutionStrategy 对象
        """
        # 输入合法性校验：评分必须在 0-1 范围内
        complexity_score = max(0.0, min(1.0, complexity_score))

        if complexity_score <= self.DIRECT_THRESHOLD:
            return self._build_direct_strategy(task_description, complexity_score)
        elif complexity_score <= self.SUBAGENT_THRESHOLD:
            return self._build_subagent_strategy(task_description, complexity_score)
        else:
            return self._build_agent_team_strategy(task_description, complexity_score)

    def _build_direct_strategy(
        self, task_description: str, score: float
    ) -> ExecutionStrategy:
        """
        构建直接执行策略（简单任务）
        运行步骤：
          1. 构建直接执行的 CLI 命令
          2. 包含任务描述和输出格式要求
        参数：
          - task_description: 任务描述
          - score: 复杂度评分
        返回值：ExecutionStrategy（DIRECT 模式）
        """
        # 直接执行：使用 --print 模式，非交互式输出
        command = (
            f'-p "请完成以下任务，直接输出结果，无需确认：\n\n{task_description}\n\n'
            f'请以结构化格式输出：\n'
            f'1. 任务完成摘要\n'
            f'2. 生成的代码（如有）\n'
            f'3. 关键决策说明"'
        )
        return ExecutionStrategy(
            mode=ExecutionMode.DIRECT,
            command_template=command,
            reasoning=f"复杂度评分 {score:.2f} ≤ {self.DIRECT_THRESHOLD}，使用直接执行模式",
        )

    def _build_subagent_strategy(
        self, task_description: str, score: float
    ) -> ExecutionStrategy:
        """
        构建 Subagent 执行策略（中等复杂度任务）
        运行步骤：
          1. 构建使用 Task 工具（Subagent）的 CLI 命令
          2. 将任务拆分为子任务描述
        参数：
          - task_description: 任务描述
          - score: 复杂度评分
        返回值：ExecutionStrategy（SUBAGENT 模式）
        """
        # Subagent 模式：指示 Claude Code CLI 使用 Task 工具
        command = (
            f'-p "请使用 Task 工具（Subagent）完成以下任务。'
            f'将任务合理拆分为子任务，使用 general_purpose_task 类型的 Subagent 执行：\n\n'
            f'{task_description}\n\n'
            f'要求：\n'
            f'1. 先制定子任务分解计划\n'
            f'2. 使用 Task 工具并行执行独立的子任务\n'
            f'3. 汇总所有子任务结果\n'
            f'4. 输出最终完成报告"'
        )
        return ExecutionStrategy(
            mode=ExecutionMode.SUBAGENT,
            command_template=command,
            reasoning=(
                f"复杂度评分 {score:.2f} 在 ({self.DIRECT_THRESHOLD}, {self.SUBAGENT_THRESHOLD}] 范围内，"
                f"使用 Subagent 模式"
            ),
        )

    def _build_agent_team_strategy(
        self, task_description: str, score: float
    ) -> ExecutionStrategy:
        """
        构建 Agent Team 协作策略（高复杂度任务）
        运行步骤：
          1. 构建使用多 Subagent 协作的 CLI 命令
          2. 指定需要多个专业 Subagent 协同工作
        参数：
          - task_description: 任务描述
          - score: 复杂度评分
        返回值：ExecutionStrategy（AGENT_TEAM 模式）
        """
        # Agent Team 模式：使用多个不同类型的 Subagent 协作
        command = (
            f'-p "请启动 Agent Team 协作模式完成以下高复杂度任务。'
            f'使用多个不同类型的 Task Subagent（search、general_purpose_task 等）协同工作：\n\n'
            f'{task_description}\n\n'
            f'执行要求：\n'
            f'1. 分析任务，识别需要哪些专业 Subagent 类型\n'
            f'2. 制定协作计划，明确各 Subagent 的职责和交付物\n'
            f'3. 按依赖关系编排 Subagent 执行顺序\n'
            f'4. 协调各 Subagent 的输出，整合为最终交付物\n'
            f'5. 输出完整的团队协作报告"'
        )
        return ExecutionStrategy(
            mode=ExecutionMode.AGENT_TEAM,
            command_template=command,
            reasoning=f"复杂度评分 {score:.2f} > {self.SUBAGENT_THRESHOLD}，使用 Agent Team 协作模式",
        )

    def estimate_complexity(self, task_description: str) -> float:
        """
        估算任务复杂度
        运行步骤：
          1. 基于任务描述长度估算基础复杂度
          2. 检测关键词加权（如"多模块"、"系统"、"架构"等）
          3. 返回 0-1 的复杂度评分
        参数：
          - task_description: 任务描述文本
        返回值：复杂度评分（0-1）
        """
        score = 0.0

        # 基础评分：基于描述长度（越长越复杂）
        length = len(task_description)
        if length > 2000:
            score += 0.3
        elif length > 1000:
            score += 0.2
        elif length > 500:
            score += 0.1

        # 关键词加权
        high_complexity_keywords = [
            "系统", "架构", "平台", "框架", "多模块", "分布式",
            "微服务", "数据库", "安全", "认证", "权限",
            "system", "architecture", "platform", "framework",
            "distributed", "microservice", "database", "security",
        ]
        medium_complexity_keywords = [
            "接口", "API", "组件", "模块", "集成", "测试",
            "interface", "component", "module", "integration", "test",
        ]

        desc_lower = task_description.lower()
        for kw in high_complexity_keywords:
            if kw.lower() in desc_lower:
                score += 0.15
        for kw in medium_complexity_keywords:
            if kw.lower() in desc_lower:
                score += 0.08

        # 限制在 0-1 范围内
        return max(0.0, min(1.0, score))
