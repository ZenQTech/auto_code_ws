"""
# ============================================================
# 提示词工程智能体
# ============================================================
# 核心定位：架构提示词标准化专家
# 核心作用：对架构内容做结构化优化，生成无歧义、可直接
#           执行的标准化提示词，并注入独立 Claude Code CLI 实例
# 运行流程：
#   1. 解析 task.md，提取每个模块的任务描述
#   2. 对每个模块的提示词做结构化优化（上下文感知注入）
#   3. 质量闭环校验（validate_and_retry）
#   4. 批量优化并注入 Claude Code CLI 实例（batch_optimize_and_inject）
#   5. 为每个模块创建独立 Claude Code CLI 实例
# 输入参数：
#   - task_md: task.md 文档内容
#   - architecture_context: 架构上下文
#   - dependency_context: 依赖上下文
#   - acceptance_criteria: 验收标准
#   - interface_specs: 全局接口规范
# 输出结果：ModuleTask 列表 + AgentInstance 列表
# 修改记录：
#   - 2026-06-25 | v1.0.0 | 初始创建
#   - 2026-07-22 | v1.1.0 | 新增上下文感知注入与质量闭环校验
#     * 新增 PROMPT_ENGINEER_CONTEXT_AWARE_PROMPT 系统提示词
#     * 增强 optimize_prompt() 支持 dependency_context / acceptance_criteria / interface_specs
#     * 新增 validate_and_retry() 质量闭环校验方法
#     * 新增 batch_optimize_and_inject() 批量优化与注入方法
#     * 新增 _topological_sort() 拓扑排序辅助方法
# ============================================================
"""

import asyncio
import logging
import uuid
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class ModuleTask:
    """模块任务"""
    name: str = ""
    description: str = ""
    priority: str = "medium"
    dependencies: List[str] = field(default_factory=list)
    complexity: float = 0.0
    risk_level: str = "low"
    acceptance_criteria: str = ""


@dataclass
class AgentInstance:
    """Claude Code CLI 实例"""
    agent_id: str = ""
    module_name: str = ""
    optimized_prompt: str = ""
    worktree_path: str = ""
    branch_name: str = ""


@dataclass
class ValidationResult:
    """提示词质量校验结果"""
    valid: bool = True
    issues: List[str] = field(default_factory=list)
    ambiguity_score: float = 0.0  # 歧义评分（越低越好）
    constraint_coverage: float = 0.0  # 约束覆盖率


PROMPT_ENGINEER_SYSTEM_PROMPT = """你是一个专业的提示词工程智能体（架构提示词标准化专家）。

## 核心职责
将架构设计文档中的任务描述转化为无歧义、可直接执行的标准化提示词，
确保架构信息在传递过程中无失真、无遗漏。

## 提示词优化规则
1. **消除语义歧义**: 将模糊描述转化为精确指令
2. **固化核心约束**: 安全红线、性能指标、接口规范必须明确写入
3. **明确输出要求**: 输出格式、文件路径、命名规范必须清晰
4. **保留架构上下文**: 模块间依赖关系、全局接口规范必须包含

## 输出格式
优化后的提示词应包含以下部分：
```
## 任务目标
[一句话描述任务目标]

## 详细需求
[结构化的详细需求描述]

## 核心约束
- 安全红线: [具体约束]
- 性能指标: [具体指标]
- 接口规范: [具体规范]

## 输出要求
- 文件路径: [路径]
- 命名规范: [规范]
- 代码风格: [风格要求]

## 依赖上下文
[依赖的其他模块和接口信息]
```
"""

PROMPT_ENGINEER_CONTEXT_AWARE_PROMPT = """你是一个专业的上下文感知提示词工程智能体（架构提示词标准化专家）。

## 核心职责
将架构设计文档中的任务描述转化为无歧义、可直接执行的标准化提示词，
确保架构信息在传递过程中无失真、无遗漏。同时，必须将模块间依赖关系、
全局接口规范、架构约束（安全红线、性能目标）一同注入到产出提示词中。

## 上下文感知注入规则
1. **模块依赖注入**: 将当前模块依赖的其他模块的接口、数据格式、调用方式写入提示词
2. **全局接口规范约束**: 所有接口调用必须遵循全局接口规范，确保跨模块兼容
3. **架构约束固化**: 安全红线（如紧急停止逻辑、传感器故障保护）、性能目标（如延迟上限、吞吐量要求）必须写入
4. **消除歧义**: 所有模糊描述必须转化为精确、可量化、可验证的指令
5. **直接可执行**: 产出提示词必须可直接作为 Claude Code CLI 的输入，无需二次加工

## 输出格式
优化后的提示词必须包含以下结构化部分：
```
## 任务目标
[一句话描述任务目标，明确该模块在整个系统中的定位]

## 详细需求
[结构化的详细需求描述，包含功能需求和非功能需求]

## 核心约束
- 安全红线: [具体的安全约束，如紧急停止条件、异常检测阈值、传感器数据校验规则]
- 性能指标: [具体的性能目标，如延迟上限、吞吐量、内存占用上限]
- 接口规范: [具体的接口规范，包括消息格式、QoS策略、命名空间约定]

## 输出要求
- 文件路径: [明确的目标文件路径]
- 命名规范: [变量、函数、类、文件的命名规范]
- 代码风格: [代码风格要求，如遵循 Google C++ Style Guide、PEP8]

## 依赖上下文
- 上游模块: [依赖的模块及其接口说明]
- 下游模块: [依赖当前模块的模块及其期望接口]
- 全局接口: [涉及的全局接口定义及其约束]
```
"""


class PromptEngineer:
    """
    提示词工程智能体
    作用：优化提示词并注入 Claude Code CLI 实例
    """

    def __init__(self, hermes_service, agent_manager=None, worktree_manager=None):
        """
        初始化提示词工程智能体
        参数：
          - hermes_service: HermesService 实例
          - agent_manager: AgentManager 实例（用于创建 CLI 实例）
          - worktree_manager: WorktreeManager 实例（用于创建 worktree）
        """
        self.hermes_service = hermes_service
        self.agent_manager = agent_manager
        self.worktree_manager = worktree_manager

    def get_system_prompt(self) -> str:
        """获取 system prompt"""
        return PROMPT_ENGINEER_SYSTEM_PROMPT

    async def parse_tasks(self, task_md: str) -> List[ModuleTask]:
        """
        解析 task.md，提取模块任务列表
        运行步骤：
          1. 解析 Markdown 结构
          2. 提取每个模块的名称、描述、优先级、依赖、复杂度、风险等级
        参数：
          - task_md: task.md 文档内容
        返回值：ModuleTask 列表
        """
        modules: List[ModuleTask] = []
        current_module: Optional[ModuleTask] = None

        for line in task_md.split("\n"):
            line_stripped = line.strip()

            # 检测模块标题
            if line_stripped.startswith("## 模块") or line_stripped.startswith("### 模块"):
                if current_module and current_module.name:
                    modules.append(current_module)

                name = line_stripped.lstrip("# ").strip()
                if ":" in name:
                    name = name.split(":", 1)[1].strip()
                elif "：" in name:
                    name = name.split("：", 1)[1].strip()
                current_module = ModuleTask(name=name)
                continue

            if current_module is None:
                continue

            # 提取描述
            if "描述" in line_stripped or "**描述**" in line_stripped:
                desc = line_stripped.split("：", 1)[-1] if "：" in line_stripped else line_stripped.split(":", 1)[-1]
                current_module.description = desc.strip().lstrip("* ").strip()

            # 提取优先级
            if "优先级" in line_stripped:
                pri = line_stripped.split("：", 1)[-1] if "：" in line_stripped else line_stripped.split(":", 1)[-1]
                current_module.priority = pri.strip().lower()

            # 提取依赖
            if "依赖" in line_stripped:
                dep = line_stripped.split("：", 1)[-1] if "：" in line_stripped else line_stripped.split(":", 1)[-1]
                dep = dep.strip()
                if dep and dep.lower() not in ["无", "none", "n/a"]:
                    current_module.dependencies = [d.strip() for d in dep.split(",") if d.strip()]

            # 提取复杂度
            if "复杂度" in line_stripped:
                comp = line_stripped.split("：", 1)[-1] if "：" in line_stripped else line_stripped.split(":", 1)[-1]
                try:
                    current_module.complexity = float(comp.strip())
                except ValueError:
                    current_module.complexity = 0.5

            # 提取风险等级
            if "风险" in line_stripped:
                risk = line_stripped.split("：", 1)[-1] if "：" in line_stripped else line_stripped.split(":", 1)[-1]
                current_module.risk_level = risk.strip()

            # 提取验收标准
            if "验收标准" in line_stripped:
                ac = line_stripped.split("：", 1)[-1] if "：" in line_stripped else line_stripped.split(":", 1)[-1]
                current_module.acceptance_criteria = ac.strip()

        # 添加最后一个模块
        if current_module and current_module.name:
            modules.append(current_module)

        return modules

    async def optimize_prompt(
        self, module_task: ModuleTask,
        architecture_context: str = "",
        dependency_context: str = "",
        acceptance_criteria: str = "",
        interface_specs: str = ""
    ) -> str:
        """
        上下文感知提示词优化
        运行步骤：
          1. 使用上下文感知系统提示词构建优化请求
          2. 注入模块依赖、全局接口规范、架构约束等上下文
          3. 调用 Hermes 进行优化
          4. 返回结构化的可执行提示词
        参数：
          - module_task: 模块任务
          - architecture_context: 架构上下文（架构设计文档、安全红线、性能目标）
          - dependency_context: 依赖上下文（依赖模块的接口、数据格式、调用方式）
          - acceptance_criteria: 验收标准
          - interface_specs: 全局接口规范
        返回值：优化后的结构化可执行提示词
        """
        # 构建验收标准文本
        ac_text = acceptance_criteria if acceptance_criteria else module_task.acceptance_criteria

        # 构建依赖上下文文本
        dep_text = dependency_context if dependency_context else (
            ', '.join(module_task.dependencies) if module_task.dependencies else '无'
        )

        prompt = (
            f"{PROMPT_ENGINEER_CONTEXT_AWARE_PROMPT}\n\n"
            f"=== 架构上下文 ===\n"
            f"{architecture_context}\n\n"
            f"=== 模块依赖上下文 ===\n"
            f"{dep_text}\n\n"
            f"=== 全局接口规范 ===\n"
            f"{interface_specs}\n\n"
            f"=== 模块任务信息 ===\n"
            f"模块名称：{module_task.name}\n"
            f"模块描述：{module_task.description}\n"
            f"优先级：{module_task.priority}\n"
            f"依赖模块：{', '.join(module_task.dependencies) if module_task.dependencies else '无'}\n"
            f"复杂度：{module_task.complexity}\n"
            f"风险等级：{module_task.risk_level}\n"
            f"验收标准：{ac_text}\n\n"
            f"请按照上下文感知提示词输出格式，生成结构化的、无歧义的、可直接执行的标准化提示词，"
            f"确保将所有架构约束、依赖上下文、接口规范都注入到产出提示词中。"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=300,  # v5.5.0 修复：从 180 提升到 300，与其他长文档生成任务对齐
        )
        # v5.5.0 修复：通过 max_tokens=16384 确保长提示词不被截断
        # (CurlLLMExecutor.DEFAULT_MAX_TOKENS 已提升，此处无需显式传参)

        if result.success:
            return result.stdout.strip()
        return f"## 任务目标\n\n{module_task.description}\n\n（提示词优化失败：{result.error_message}）"

    async def inject_to_claude_cli(
        self, optimized_prompt: str, module_name: str,
        repo_path: str = ""
    ) -> Optional[AgentInstance]:
        """
        注入 Claude Code CLI 实例
        运行步骤：
          1. 创建独立 worktree（如果有 worktree_manager）
          2. 创建 Claude Code CLI 实例
          3. 注入优化后的提示词
        参数：
          - optimized_prompt: 优化后的提示词
          - module_name: 模块名称
          - repo_path: 仓库路径
        返回值：AgentInstance 对象
        """
        instance = AgentInstance(module_name=module_name)

        # 创建 worktree
        if self.worktree_manager and repo_path:
            try:
                worktree_info = await self.worktree_manager.create_worktree(
                    repo_path=repo_path,
                    module_name=module_name,
                    instance_id=str(uuid.uuid4())[:8],
                )
                instance.worktree_path = worktree_info.worktree_path
                instance.branch_name = worktree_info.branch_name
            except Exception as e:
                logger.warning(f"创建 worktree 失败: {e}，继续使用默认工作空间")

        # 创建 Claude Code CLI 实例
        if self.agent_manager:
            try:
                agent = await self.agent_manager.register_agent(
                    name=f"worker-{module_name[:20]}-{uuid.uuid4().hex[:4]}",
                    cli_path=self.hermes_service.executor.executable,
                    workspace=instance.worktree_path or "",
                    max_concurrent=1,
                )
                instance.agent_id = agent.id
            except Exception as e:
                logger.error(f"创建 CLI 实例失败: {e}")
                return None

        instance.optimized_prompt = optimized_prompt
        return instance

    async def validate_prompt(self, optimized_prompt: str) -> ValidationResult:
        """
        提示词质量校验
        检查：语义歧义、核心约束覆盖、输出要求完整性
        参数：
          - optimized_prompt: 优化后的提示词
        返回值：ValidationResult 对象
        """
        prompt = (
            f"你是一个提示词质量审查专家。请检查以下提示词的质量：\n\n"
            f"{optimized_prompt}\n\n"
            f"请从以下维度评估：\n"
            f"1. 语义歧义：是否存在模糊、多义表述？评分 0-1（越低越好）\n"
            f"2. 核心约束覆盖：安全红线、性能指标、接口规范是否完整？评分 0-1（越高越好）\n"
            f"3. 输出要求：文件路径、命名规范、代码风格是否明确？\n"
            f"4. 问题列表：列出所有发现的问题\n\n"
            f"输出格式：\n"
            f"歧义评分: [0.0-1.0]\n"
            f"约束覆盖率: [0.0-1.0]\n"
            f"问题: [列表]"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=120,
        )

        validation = ValidationResult()
        if result.success:
            for line in result.stdout.split("\n"):
                line = line.strip()
                if "歧义评分" in line:
                    try:
                        val = line.split(":", 1)[-1].strip()
                        validation.ambiguity_score = float(val)
                    except ValueError:
                        pass
                elif "约束覆盖率" in line:
                    try:
                        val = line.split(":", 1)[-1].strip()
                        validation.constraint_coverage = float(val)
                    except ValueError:
                        pass
                elif line.startswith("- ") or line.startswith("* "):
                    validation.issues.append(line.lstrip("- *").strip())

            # 歧义评分 > 0.3 视为不合格
            if validation.ambiguity_score > 0.3:
                validation.valid = False
            # 约束覆盖率 < 0.8 视为不合格
            if validation.constraint_coverage < 0.8:
                validation.valid = False

        return validation

    async def validate_and_retry(
        self, module_task: ModuleTask,
        architecture_context: str = "",
        dependency_context: str = "",
        acceptance_criteria: str = "",
        interface_specs: str = "",
        max_retries: int = 3
    ) -> Dict[str, Any]:
        """
        质量闭环校验与重试
        运行步骤：
          1. 调用 optimize_prompt() 生成优化后的提示词
          2. 调用 validate_prompt() 检查提示词质量
          3. 若 ambiguity_score > 0.3 或 constraint_coverage < 0.8：
             - 将校验反馈作为额外上下文注入，重新调用 optimize_prompt()
             - 最多重试 max_retries 次
          4. 若所有重试均失败，返回最佳尝试并附带警告
        参数：
          - module_task: 模块任务
          - architecture_context: 架构上下文
          - dependency_context: 依赖上下文
          - acceptance_criteria: 验收标准
          - interface_specs: 全局接口规范
          - max_retries: 最大重试次数（默认 3）
        返回值：
          {
            prompt: str,              # 最终优化后的提示词
            valid: bool,              # 是否通过质量校验
            attempts: int,            # 实际尝试次数
            validation_result: ValidationResult  # 最终校验结果
          }
        """
        best_prompt = ""
        best_validation = ValidationResult()
        best_attempt = 0

        for attempt in range(1, max_retries + 1):
            # 构建优化上下文，首次使用原始上下文，重试时注入校验反馈
            if attempt == 1:
                opt_arch_context = architecture_context
                opt_dep_context = dependency_context
            else:
                # 将上次校验反馈作为额外上下文注入
                feedback = (
                    f"\n\n=== 上次校验反馈（第 {attempt - 1} 次尝试） ===\n"
                    f"歧义评分: {best_validation.ambiguity_score}（目标 ≤ 0.3）\n"
                    f"约束覆盖率: {best_validation.constraint_coverage}（目标 ≥ 0.8）\n"
                    f"发现问题: {', '.join(best_validation.issues) if best_validation.issues else '无'}\n"
                    f"请针对以上问题进行针对性修正，消除歧义、补充缺失的约束和规范。"
                )
                opt_arch_context = architecture_context + feedback
                opt_dep_context = dependency_context

            # 步骤 1: 优化提示词
            optimized = await self.optimize_prompt(
                module_task=module_task,
                architecture_context=opt_arch_context,
                dependency_context=opt_dep_context,
                acceptance_criteria=acceptance_criteria,
                interface_specs=interface_specs,
            )

            # 步骤 2: 校验提示词质量
            validation = await self.validate_prompt(optimized)

            # 记录最佳尝试
            best_prompt = optimized
            best_validation = validation
            best_attempt = attempt

            # 步骤 3: 判断是否通过质量门禁
            # 歧义评分 ≤ 0.3 且约束覆盖率 ≥ 0.8 视为通过
            if validation.ambiguity_score <= 0.3 and validation.constraint_coverage >= 0.8:
                logger.info(
                    f"模块 [{module_task.name}] 提示词质量校验通过 "
                    f"（第 {attempt} 次尝试，歧义评分: {validation.ambiguity_score}，"
                    f"约束覆盖率: {validation.constraint_coverage}）"
                )
                return {
                    "prompt": optimized,
                    "valid": True,
                    "attempts": attempt,
                    "validation_result": validation,
                }

            logger.warning(
                f"模块 [{module_task.name}] 第 {attempt}/{max_retries} 次校验未通过: "
                f"歧义评分={validation.ambiguity_score}, "
                f"约束覆盖率={validation.constraint_coverage}"
            )

        # 步骤 4: 所有重试均失败，返回最佳尝试并附带警告
        logger.warning(
            f"模块 [{module_task.name}] 在 {max_retries} 次重试后仍未通过质量门禁，"
            f"返回最佳尝试（歧义评分: {best_validation.ambiguity_score}，"
            f"约束覆盖率: {best_validation.constraint_coverage}）"
        )
        return {
            "prompt": best_prompt,
            "valid": False,
            "attempts": best_attempt,
            "validation_result": best_validation,
        }

    async def batch_optimize_and_inject(
        self, module_tasks: List[ModuleTask],
        architecture_context: str = "",
        acceptance_criteria: str = "",
        repo_path: str = ""
    ) -> List[AgentInstance]:
        """
        批量优化提示词并注入 Claude Code CLI 实例
        运行步骤：
          1. 按依赖关系拓扑排序（被依赖模块优先）
          2. 识别并行执行组（无依赖关系的模块可并行执行）
          3. 对每个模块调用 validate_and_retry() 获取优化后的提示词
          4. 调用 inject_to_claude_cli() 创建 CLI 实例
          5. 组装并返回 AgentInstance 列表
        参数：
          - module_tasks: 模块任务列表
          - architecture_context: 架构上下文
          - acceptance_criteria: 验收标准
          - repo_path: 仓库路径
        返回值：AgentInstance 对象列表
        """
        # 步骤 1: 按依赖关系拓扑排序
        # 构建模块名称到模块的映射
        name_to_task: Dict[str, ModuleTask] = {t.name: t for t in module_tasks}

        # 拓扑排序：被依赖的模块优先
        sorted_tasks = self._topological_sort(module_tasks)

        # 步骤 2: 识别并行执行组
        # 将无依赖关系的模块分到同一组中并行执行
        execution_groups: List[List[ModuleTask]] = []
        completed: set = set()
        remaining = list(sorted_tasks)

        while remaining:
            current_group: List[ModuleTask] = []
            for task in remaining[:]:
                # 检查该模块的所有依赖是否已满足
                deps_satisfied = all(
                    dep in completed for dep in task.dependencies
                )
                if deps_satisfied:
                    current_group.append(task)
                    remaining.remove(task)
            if current_group:
                execution_groups.append(current_group)
            else:
                # 防止死循环：如果无法推进，将剩余模块全部放入一组
                execution_groups.append(remaining)
                break

        # 步骤 3-4: 分组并行执行优化与注入
        all_instances: List[AgentInstance] = []

        for group_idx, group in enumerate(execution_groups):
            logger.info(
                f"执行第 {group_idx + 1}/{len(execution_groups)} 组并行任务，"
                f"包含模块: {[t.name for t in group]}"
            )

            async def _process_one_task(task: ModuleTask) -> Optional[AgentInstance]:
                """处理单个模块的优化与注入"""
                # 构建依赖上下文
                dep_context = ""
                if task.dependencies:
                    dep_parts = []
                    for dep_name in task.dependencies:
                        dep_task = name_to_task.get(dep_name)
                        if dep_task:
                            dep_parts.append(
                                f"模块 [{dep_name}]: {dep_task.description}"
                            )
                    dep_context = "\n".join(dep_parts)

                # 调用质量闭环校验
                result = await self.validate_and_retry(
                    module_task=task,
                    architecture_context=architecture_context,
                    dependency_context=dep_context,
                    acceptance_criteria=acceptance_criteria,
                    interface_specs="",
                )

                optimized_prompt = result["prompt"]
                if not result["valid"]:
                    logger.warning(
                        f"模块 [{task.name}] 提示词校验未通过，"
                        f"但仍将使用最佳尝试进行注入"
                    )

                # 注入 Claude Code CLI 实例
                instance = await self.inject_to_claude_cli(
                    optimized_prompt=optimized_prompt,
                    module_name=task.name,
                    repo_path=repo_path,
                )
                return instance

            # 并行执行当前组中的所有模块
            tasks = [_process_one_task(t) for t in group]
            group_results = await asyncio.gather(*tasks, return_exceptions=True)

            for task, result in zip(group, group_results):
                if isinstance(result, Exception):
                    logger.error(f"模块 [{task.name}] 处理异常: {result}")
                    continue
                if result is not None:
                    all_instances.append(result)

            # 标记当前组的所有模块为已完成
            for task in group:
                completed.add(task.name)

        logger.info(
            f"批量优化与注入完成，共处理 {len(module_tasks)} 个模块，"
            f"成功创建 {len(all_instances)} 个 AgentInstance"
        )
        return all_instances

    def _topological_sort(self, module_tasks: List[ModuleTask]) -> List[ModuleTask]:
        """
        拓扑排序模块任务列表
        被依赖的模块排在前面，确保依赖关系正确
        参数：
          - module_tasks: 模块任务列表
        返回值：拓扑排序后的模块任务列表
        """
        name_to_task: Dict[str, ModuleTask] = {t.name: t for t in module_tasks}
        sorted_tasks: List[ModuleTask] = []
        visited: set = set()
        temp_mark: set = set()

        def visit(task: ModuleTask):
            """深度优先遍历"""
            if task.name in visited:
                return
            if task.name in temp_mark:
                # 检测到循环依赖，跳过
                logger.warning(f"检测到循环依赖，涉及模块: {task.name}")
                return
            temp_mark.add(task.name)
            for dep_name in task.dependencies:
                dep_task = name_to_task.get(dep_name)
                if dep_task:
                    visit(dep_task)
            temp_mark.discard(task.name)
            visited.add(task.name)
            sorted_tasks.append(task)

        for task in module_tasks:
            if task.name not in visited:
                visit(task)

        return sorted_tasks
