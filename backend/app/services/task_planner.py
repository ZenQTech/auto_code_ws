"""
# ============================================================
# 后端核心服务 - 任务规划系统
# ============================================================
# 核心作用：基于优化后的提示词，自动制定详细的任务分解计划，
#           明确任务模块、优先级和依赖关系
# 运行流程：
#   1. 接收优化后的提示词
#   2. 调用 CLI 进行任务分解
#   3. 解析分解结果
#   4. 构建任务计划（含优先级和依赖关系）
# 输入参数：
#   - optimized_prompt: OptimizedPrompt，优化后的提示词
# 输出结果：TaskPlan 对象，包含子任务列表和依赖关系
# 修改记录：
#   - 2026-06-30 | v2.7.0 | 增加反引号/美元符号转义，防止 shell 命令替换注入
# ============================================================
"""

import logging
from dataclasses import dataclass, field
from typing import List, Optional, Dict
from enum import Enum

from cli_integration.executor import CLIExecutor, CLIResult
from backend.app.models import TaskPriority

logger = logging.getLogger(__name__)


class TaskPriority(str, Enum):
    """任务优先级枚举（已废弃，请使用 backend.app.models.TaskPriority）"""
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


@dataclass
class SubTask:
    """
    子任务定义
    字段说明：
      - id: 子任务序号
      - title: 子任务标题
      - description: 子任务描述
      - priority: 优先级
      - dependencies: 依赖的子任务 ID 列表
      - estimated_complexity: 预估复杂度（0-1）
    """
    id: int = 0
    title: str = ""
    description: str = ""
    priority: TaskPriority = TaskPriority.MEDIUM
    dependencies: List[int] = field(default_factory=list)
    estimated_complexity: float = 0.0


@dataclass
class TaskPlan:
    """
    任务计划
    字段说明：
      - original_prompt: 原始需求
      - optimized_prompt: 优化后的提示词
      - sub_tasks: 子任务列表
      - total_tasks: 子任务总数
      - success: 规划是否成功
      - error_message: 错误信息
    """
    original_prompt: str = ""
    optimized_prompt: str = ""
    sub_tasks: List[SubTask] = field(default_factory=list)
    total_tasks: int = 0
    success: bool = False
    error_message: str = ""


class TaskPlanner:
    """
    任务规划系统
    作用：将优化后的提示词分解为可执行的子任务计划
    调用方：API 层（任务规划接口）
    被调用方：CLIExecutor
    """

    def __init__(self, executor: CLIExecutor):
        """
        初始化任务规划器
        参数：
          - executor: CLI 命令执行器实例
        """
        self.executor = executor

    async def plan(
        self, original_prompt: str, optimized_prompt: str
    ) -> TaskPlan:
        """
        制定任务分解计划
        运行步骤：
          1. 输入校验
          2. 构建规划命令
          3. 调用 CLI 进行任务分解
          4. 解析分解结果
          5. 构建 TaskPlan 返回
        参数：
          - original_prompt: 用户原始需求
          - optimized_prompt: 优化后的提示词
        返回值：TaskPlan 对象
        """
        if not optimized_prompt:
            return TaskPlan(
                original_prompt=original_prompt,
                error_message="优化后的提示词不能为空",
            )

        logger.info("开始制定任务计划...")

        # 构建规划命令
        plan_command = self._build_plan_command(optimized_prompt)

        # 调用 CLI 执行规划
        result: CLIResult = await self.executor.execute(
            command=plan_command,
            timeout=180,  # 任务规划超时 180 秒
        )

        if not result.success:
            logger.error(f"任务规划失败: {result.error_message}")
            return TaskPlan(
                original_prompt=original_prompt,
                optimized_prompt=optimized_prompt,
                error_message=f"规划执行失败: {result.error_message}",
            )

        # 解析规划结果
        plan = self._parse_plan_result(result.stdout, original_prompt, optimized_prompt)
        plan.success = True
        logger.info(f"任务规划完成，共 {plan.total_tasks} 个子任务")
        return plan

    def _build_plan_command(self, optimized_prompt: str) -> str:
        """
        构建任务规划 CLI 命令
        参数：
          - optimized_prompt: 优化后的提示词
        返回值：CLI 命令字符串
        """
        # 转义双引号、反引号、美元符号，防止命令注入
        safe_prompt = optimized_prompt.replace('"', '\\"').replace('`', '\\`').replace('$', '\\$')

        command = (
            f'-p "你是一个专业的任务规划专家。请基于以下优化后的需求，'
            f'制定详细的任务分解计划。\n\n'
            f'优化后的需求：\n{safe_prompt}\n\n'
            f'请按以下格式输出任务计划：\n'
            f'## 任务分解计划\n'
            f'### 任务1: [标题] (优先级: high/medium/low)\n'
            f'- 描述: [详细描述]\n'
            f'- 依赖: [依赖的任务编号，无则写"无"]\n'
            f'- 预估复杂度: [0.0-1.0]\n\n'
            f'### 任务2: [标题] (优先级: high/medium/low)\n'
            f'- 描述: [详细描述]\n'
            f'- 依赖: [依赖的任务编号]\n'
            f'- 预估复杂度: [0.0-1.0]\n\n'
            f'...\n\n'
            f'## 执行顺序建议\n'
            f'[按依赖关系排列的执行顺序]\n\n'
            f'## 风险提示\n'
            f'[可能的风险点和注意事项]"'
        )
        return command

    def _parse_plan_result(
        self, output: str, original: str, optimized: str
    ) -> TaskPlan:
        """
        解析任务规划结果
        运行步骤：
          1. 按任务编号分割输出
          2. 提取每个子任务的标题、描述、优先级、依赖、复杂度
          3. 构建 SubTask 列表
        参数：
          - output: CLI 原始输出
          - original: 原始需求
          - optimized: 优化后提示词
        返回值：TaskPlan 对象
        """
        plan = TaskPlan(original_prompt=original, optimized_prompt=optimized)
        sub_tasks: List[SubTask] = []
        current_task: Optional[SubTask] = None

        for line in output.split("\n"):
            line_stripped = line.strip()

            # 检测新任务开始（### 任务N: 格式）
            if line_stripped.startswith("### 任务") or line_stripped.startswith("### 任务"):
                if current_task:
                    sub_tasks.append(current_task)

                # 提取任务标题和优先级
                task_id = len(sub_tasks) + 1
                title_part = line_stripped.lstrip("# ").strip()

                # 解析优先级
                priority = TaskPriority.MEDIUM
                if "(优先级: high)" in title_part or "(优先级:high)" in title_part:
                    priority = TaskPriority.HIGH
                elif "(优先级: low)" in title_part or "(优先级:low)" in title_part:
                    priority = TaskPriority.LOW

                # 提取标题（去除优先级部分）
                title = title_part.split("(优先级")[0].strip()
                if title.startswith("任务"):
                    # 去掉 "任务N: " 前缀
                    parts = title.split(":", 1)
                    title = parts[1].strip() if len(parts) > 1 else title

                current_task = SubTask(id=task_id, title=title, priority=priority)
                continue

            if current_task is None:
                continue

            # 解析描述
            if line_stripped.startswith("- 描述:") or line_stripped.startswith("- 描述："):
                current_task.description = line_stripped.split(":", 1)[-1].strip()

            # 解析依赖
            elif line_stripped.startswith("- 依赖:") or line_stripped.startswith("- 依赖："):
                dep_text = line_stripped.split(":", 1)[-1].strip()
                if dep_text and dep_text != "无" and dep_text != "none":
                    # 尝试提取数字
                    import re
                    dep_ids = re.findall(r'\d+', dep_text)
                    current_task.dependencies = [int(d) for d in dep_ids]

            # 解析复杂度
            elif "预估复杂度" in line_stripped or "复杂度" in line_stripped:
                import re
                numbers = re.findall(r'[\d.]+', line_stripped)
                if numbers:
                    val = float(numbers[0])
                    current_task.estimated_complexity = max(0.0, min(1.0, val))

        # 添加最后一个任务
        if current_task:
            sub_tasks.append(current_task)

        plan.sub_tasks = sub_tasks
        plan.total_tasks = len(sub_tasks)
        return plan
