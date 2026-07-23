"""
# ============================================================
# 后端核心服务 - 提示词优化引擎
# ============================================================
# 核心作用：接收用户原始需求，调用 Claude Code CLI 进行提示词
#           工程优化，生成结构化、高质量的任务指令
# 运行流程：
#   1. 接收用户原始需求文本
#   2. 构建提示词优化模板
#   3. 调用 CLI 执行器进行优化
#   4. 解析优化结果
#   5. 返回结构化任务指令
# 输入参数：
#   - raw_prompt: str，用户原始需求
# 输出结果：OptimizedPrompt 对象，包含优化后的结构化指令
# 修改记录：
#   - 2026-06-30 | v2.7.0 | 增加反引号/美元符号转义，防止 shell 命令替换注入
# ============================================================
"""

import logging
from dataclasses import dataclass, field
from typing import Optional, List

from cli_integration.executor import CLIExecutor, CLIResult

logger = logging.getLogger(__name__)


@dataclass
class OptimizedPrompt:
    """
    优化后的提示词结果
    字段说明：
      - original: 原始需求文本
      - optimized: 优化后的结构化指令
      - task_modules: 识别出的任务模块列表
      - constraints: 识别出的约束条件列表
      - success: 优化是否成功
      - error_message: 错误信息（失败时）
    """
    original: str = ""
    optimized: str = ""
    task_modules: List[str] = field(default_factory=list)
    constraints: List[str] = field(default_factory=list)
    success: bool = False
    error_message: str = ""


class PromptOptimizer:
    """
    提示词优化引擎
    作用：将用户模糊需求转化为结构化、高质量的任务指令
    调用方：API 层（需求提交接口）
    被调用方：CLIExecutor
    """

    def __init__(self, executor: CLIExecutor):
        """
        初始化优化引擎
        参数：
          - executor: CLI 命令执行器实例
        """
        self.executor = executor

    async def optimize(self, raw_prompt: str) -> OptimizedPrompt:
        """
        优化用户原始需求
        运行步骤：
          1. 输入校验：检查需求是否为空
          2. 构建优化提示词模板
          3. 调用 CLI 执行优化
          4. 解析优化结果
          5. 构建 OptimizedPrompt 返回
        参数：
          - raw_prompt: 用户原始需求文本
        返回值：OptimizedPrompt 对象
        """
        # 输入合法性校验
        if not raw_prompt or not raw_prompt.strip():
            return OptimizedPrompt(
                original=raw_prompt,
                error_message="需求文本不能为空",
            )

        logger.info(f"开始优化提示词，原始需求长度: {len(raw_prompt)} 字符")

        # 构建优化命令模板
        optimize_command = self._build_optimize_command(raw_prompt)

        # 调用 CLI 执行优化
        result: CLIResult = await self.executor.execute(
            command=optimize_command,
            timeout=120,  # 提示词优化超时 120 秒
        )

        if not result.success:
            logger.error(f"提示词优化失败: {result.error_message}")
            return OptimizedPrompt(
                original=raw_prompt,
                error_message=f"优化执行失败: {result.error_message}",
            )

        # 解析优化结果
        optimized = self._parse_optimization_result(result.stdout, raw_prompt)
        optimized.success = True
        logger.info(f"提示词优化完成，识别到 {len(optimized.task_modules)} 个任务模块")
        return optimized

    def _build_optimize_command(self, raw_prompt: str) -> str:
        """
        构建提示词优化 CLI 命令
        运行步骤：
          1. 构建优化指令模板
          2. 嵌入用户原始需求
          3. 指定输出格式要求
        参数：
          - raw_prompt: 用户原始需求
        返回值：完整的 CLI 命令字符串
        """
        # 转义双引号、反引号、美元符号，防止命令注入
        safe_prompt = raw_prompt.replace('"', '\\"').replace('`', '\\`').replace('$', '\\$')

        command = (
            f'-p "你是一个专业的提示词工程优化专家。请对以下用户需求进行优化，'
            f'将其转化为结构化、高质量的任务指令。\n\n'
            f'原始需求：\n{safe_prompt}\n\n'
            f'请按以下格式输出优化结果：\n'
            f'## 优化后的任务指令\n'
            f'[将原始需求转化为清晰、具体、可执行的结构化指令]\n\n'
            f'## 任务模块分解\n'
            f'- 模块1: [名称] - [简要描述]\n'
            f'- 模块2: [名称] - [简要描述]\n'
            f'...\n\n'
            f'## 约束条件\n'
            f'- [约束1]\n'
            f'- [约束2]\n'
            f'...\n\n'
            f'## 技术建议\n'
            f'[提供技术栈、架构方面的建议]"'
        )
        return command

    def _parse_optimization_result(
        self, output: str, original: str
    ) -> OptimizedPrompt:
        """
        解析 CLI 优化输出结果
        运行步骤：
          1. 按章节标记分割输出
          2. 提取优化后的指令
          3. 提取任务模块列表
          4. 提取约束条件列表
        参数：
          - output: CLI 原始输出
          - original: 用户原始需求
        返回值：OptimizedPrompt 对象
        """
        optimized = OptimizedPrompt(original=original)
        optimized.optimized = output

        # 解析任务模块
        in_modules_section = False
        in_constraints_section = False

        for line in output.split("\n"):
            line_stripped = line.strip()

            # 检测章节标记
            if "任务模块分解" in line_stripped or "任务模块" in line_stripped:
                in_modules_section = True
                in_constraints_section = False
                continue
            if "约束条件" in line_stripped:
                in_constraints_section = True
                in_modules_section = False
                continue
            if line_stripped.startswith("##") and "优化后的任务指令" not in line_stripped:
                in_modules_section = False
                in_constraints_section = False
                continue

            # 提取模块
            if in_modules_section and line_stripped.startswith("-"):
                module = line_stripped.lstrip("- ").strip()
                if module:
                    optimized.task_modules.append(module)

            # 提取约束
            if in_constraints_section and line_stripped.startswith("-"):
                constraint = line_stripped.lstrip("- ").strip()
                if constraint:
                    optimized.constraints.append(constraint)

        return optimized
