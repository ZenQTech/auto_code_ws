# ============================================================
# 提示词工程阶段 (prompting) - 真实实现
# ============================================================
# 核心作用：从 workflow_engine.py 迁移 _run_prompting_phase
#          等提示词工程阶段核心方法。
#          通过 Mixin 多继承注入到 WorkflowEngine，行为完全等价。
# 拆分日期：2026-07-27
# 来源方法（已迁移）:
#   - run_prompting_phase  (原 _run_prompting_phase, workflow_engine.py 第 1844 行)
# 模块版本：v6.2.0 - C1 重构第三阶段（方法真实迁移）
# 修改记录：
#   - 2026-07-27 | v6.2.0 | 从 workflow_engine.py 真实迁移 1 个核心方法（约 280 行）
# ============================================================

import asyncio
import json as _json
import logging
import re
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from sqlalchemy import select

logger = logging.getLogger(__name__)


class PromptingStageMixin:
    """
    提示词工程阶段 Mixin（v6.2.0 真实实现）

    阶段职责：
      1. 解析 task.md 中的模块列表
      2. 为每个模块生成优化的 Claude Code CLI 提示词
      3. 持久化提示词到 Workflow.error_message (__PROMPTS__ 标记)
      4. 设置 prompts_optimized=True
      5. 自动推进到 executing 阶段

    状态机：
      designing → prompting → executing
    """

    async def run_prompting_phase(
        self, workflow_id: str
    ) -> Dict[str, Any]:
        """
        提示词工程阶段：自动为每个模块生成优化后的提示词（v5.1.0 新增，v6.2.0 迁移）
        作用：填补 designing→prompting→executing 阶段的自动推进 GAP；
             被 confirm_stage("designing") 后台任务调用，完成后自动推进到 executing
        调用方：confirm_stage("designing") 内部 asyncio.create_task
        被调用方：PromptEngineer（如果可用）、self.advance_stage
        运行步骤：
          1. 加载 workflow 记录，解析 task_doc 提取模块列表
          2. 降级策略：若解析失败则使用默认占位模块列表
          3. 尝试用 PromptEngineer.optimize_prompt() 优化每个模块的提示词
          4. PromptEngineer 不可用或调用失败时使用模板化的兜底提示词
          5. 持久化优化后的提示词到 workflow.error_message 的 __PROMPTS__ 段
             并设置 prompts_optimized=True
          6. 调用 self.advance_stage(workflow_id) 推进到 executing 阶段
        参数：
          - workflow_id: 工作流 ID
        返回值：
          - Dict：包含成功状态、模块数量、提示词生成结果摘要
        """
        from backend.app.models import Workflow

        result: Dict[str, Any] = {
            "success": False,
            "workflow_id": workflow_id,
            "module_count": 0,
            "phases": [],
        }

        try:
            # Step 1: 加载工作流数据
            async with self.session_factory() as db:
                wf_result = await db.execute(
                    select(Workflow).where(Workflow.id == workflow_id)
                )
                workflow = wf_result.scalar_one_or_none()
                if not workflow:
                    logger.error(
                        f"run_prompting_phase: workflow {workflow_id} not found"
                    )
                    return result
                task_doc = workflow.task_doc or ""
                acceptance_doc = workflow.acceptance_doc or ""
                requirement_doc = workflow.requirement_doc or ""
                spec_doc = workflow.spec_doc or ""

            # Step 2: 解析模块列表
            # 优先匹配 "### Module N: 标题" 或 "### 模块 N: 标题"
            module_pattern = re.compile(
                r'(?:^|\n)#{2,4}\s*(?:Module|模块)\s*\d+[：:、\.\s]+([^\n]+)'
            )
            module_matches = [
                m.strip()[:80] for m in module_pattern.findall(task_doc)
                if m and m.strip()
            ]
            if not module_matches:
                # 降级策略 1：匹配 "模块X: 标题" 或 "Module X: 标题"
                fallback_pattern = re.compile(
                    r'(?:^|\n)[#\-\*\d\.\s]*([\u4e00-\u9fa5A-Za-z0-9_]+)'
                    r'(?:Module|模块)?\s*\d*[：:]\s*([^\n]+)'
                )
                module_matches = [
                    (m[1] if isinstance(m, tuple) else m).strip()[:80]
                    for m in fallback_pattern.findall(task_doc)
                    if m and (m[1] if isinstance(m, tuple) else m).strip()
                ][:10]
            if not module_matches:
                # 降级策略 2：使用默认占位模块
                logger.warning(
                    f"run_prompting_phase: 未解析到模块，使用默认占位 "
                    f"workflow={workflow_id[:8]}..."
                )
                module_matches = [f"Module {i + 1}" for i in range(7)]
            result["module_count"] = len(module_matches)
            logger.info(
                f"run_prompting_phase: 解析到 {len(module_matches)} 个模块 "
                f"workflow={workflow_id[:8]}..."
            )

            # Step 3: 构造 PromptEngineer（如果 hermes_service 可用）
            pe = None
            hermes_service = getattr(self, "hermes_service", None)
            if hermes_service is not None:
                try:
                    from backend.app.services.agent_roles.prompt_engineer import (
                        PromptEngineer,
                        ModuleTask,
                    )
                    pe = PromptEngineer(
                        hermes_service=hermes_service,
                        agent_manager=getattr(hermes_service, "agent_manager", None),
                        worktree_manager=None,
                    )
                except Exception as pe_init_exc:
                    logger.warning(
                        f"PromptEngineer 初始化失败，使用模板兜底: {pe_init_exc}"
                    )
                    pe = None

            # Step 4: 为每个模块生成提示词
            optimized_prompts: List[Dict[str, Any]] = []
            architecture_context = (
                f"{spec_doc[:1500]}\n\n{task_doc[:1500]}"
            ).strip()
            for idx, module_name in enumerate(module_matches):
                module_name = (module_name or f"Module {idx + 1}").strip()[:80]
                module_prompt: Optional[str] = None
                if pe is not None:
                    try:
                        from backend.app.services.agent_roles.prompt_engineer import ModuleTask
                        task = ModuleTask(
                            name=module_name,
                            description=(
                                f"实现 {module_name} 模块（基于需求文档和架构设计）"
                            ),
                            priority=str(idx),
                            acceptance_criteria=acceptance_doc[:1000],
                        )
                        module_prompt = await pe.optimize_prompt(
                            module_task=task,
                            architecture_context=architecture_context,
                            dependency_context="",
                            acceptance_criteria=acceptance_doc[:2000],
                            interface_specs="",
                        )
                        result["phases"].append(
                            {"module": module_name, "source": "prompt_engineer"}
                        )
                        logger.info(
                            f"模块提示词生成成功 (PromptEngineer): {module_name}"
                        )
                    except Exception as pe_call_exc:
                        logger.warning(
                            f"模块 {module_name} PromptEngineer 优化失败，"
                            f"降级为模板: {pe_call_exc}"
                        )
                        module_prompt = None

                if not module_prompt:
                    # 模板兜底：使用结构化模板生成
                    module_prompt = (
                        f"## 任务目标\n\n"
                        f"实现 {module_name} 模块。\n\n"
                        f"## 详细需求\n\n"
                        f"{requirement_doc[:1500]}\n\n"
                        f"## 核心约束\n\n"
                        f"- 遵循 Google C++ Style Guide / PEP8\n"
                        f"- 异常处理：所有外部依赖必须有 try/except 保护\n"
                        f"- 边界条件：空值、None、越界必须显式处理\n\n"
                        f"## 验收标准\n\n"
                        f"{acceptance_doc[:1000]}\n\n"
                        f"## 输出要求\n\n"
                        f"- 完整可运行代码（无 TODO / pass 占位）\n"
                        f"- 关键函数 docstring 必须含中英双语说明\n"
                        f"- 模块自检：单元测试覆盖核心路径\n"
                    )
                    result["phases"].append(
                        {"module": module_name, "source": "template_fallback"}
                    )
                    logger.info(
                        f"模块提示词使用模板兜底生成: {module_name}"
                    )

                optimized_prompts.append({
                    "module": module_name,
                    "prompt": (module_prompt or "")[:2000],
                    "index": idx,
                })

            # Step 5: 持久化提示词 + 推进到 executing
            try:
                prompts_blob = _json.dumps(
                    optimized_prompts, ensure_ascii=False
                )[:30000]
            except Exception as json_exc:
                logger.warning(
                    f"提示词 JSON 序列化失败，使用简化版本: {json_exc}"
                )
                prompts_blob = _json.dumps(
                    [
                        {"module": p["module"], "prompt": p["prompt"][:500]}
                        for p in optimized_prompts
                    ],
                    ensure_ascii=False,
                )[:30000]

            async with self.session_factory() as db:
                wf_result = await db.execute(
                    select(Workflow).where(Workflow.id == workflow_id)
                )
                workflow = wf_result.scalar_one_or_none()
                if workflow is None:
                    logger.error(
                        f"run_prompting_phase: 持久化阶段 workflow 消失 "
                        f"{workflow_id[:8]}..."
                    )
                    return result
                workflow.prompts_optimized = True
                existing_error = workflow.error_message or ""
                # 追加 __PROMPTS__ 段，避免覆盖已有错误信息
                prompts_marker = "\n__PROMPTS__:"
                if prompts_marker in existing_error:
                    # 替换旧 __PROMPTS__ 段
                    head, _, _ = existing_error.partition(prompts_marker)
                    workflow.error_message = f"{head}{prompts_marker}{prompts_blob}"
                else:
                    workflow.error_message = (
                        f"{existing_error}{prompts_marker}{prompts_blob}"
                    )
                workflow.updated_at = datetime.now(timezone.utc)
                await db.commit()
                logger.info(
                    f"提示词持久化完成: {len(optimized_prompts)} 个模块 "
                    f"workflow={workflow_id[:8]}..."
                )

            result["success"] = True

            # v5.3.0 修复：在调用 advance_stage 之前先将 prompting 阶段标记为 COMPLETED，
            # 否则 validate_stage_boundary 会因阶段状态非 COMPLETED 而拒绝推进，
            # 与 run_prompting_phase 完成提示词生成后立即推进的设计冲突
            try:
                async with self.session_factory() as db:
                    await self._complete_current_stage(db, workflow_id, "prompting")
                    await db.commit()
                    logger.info(
                        f"run_prompting_phase: prompting 阶段已标记为 COMPLETED "
                        f"workflow={workflow_id[:8]}..."
                    )
            except Exception as mark_exc:
                logger.warning(
                    f"run_prompting_phase: 标记 prompting 阶段 COMPLETED 失败 "
                    f"（将由 validate_stage_boundary 的 prompts_optimized 宽松校验兜底）: "
                    f"{mark_exc}"
                )

            # Step 6: 推进到 executing 阶段
            try:
                advance_result = await self.advance_stage(workflow_id)
                result["advanced_to"] = (
                    advance_result.stage_name if advance_result else None
                )
                logger.info(
                    f"run_prompting_phase: 已推进到 "
                    f"{advance_result.stage_name if advance_result else '未知'} "
                    f"workflow={workflow_id[:8]}..."
                )
            except Exception as adv_exc:
                logger.exception(
                    f"run_prompting_phase: 推进到 executing 失败: {adv_exc}"
                )
                result["advance_error"] = str(adv_exc)

            # v5.6.0 修复：调度 _run_executing_phase 后台任务
            # 填补 executing 阶段没有自动 runner 的 GAP，让 prompting→executing
            # 推进后由后台异步任务真正调用 LLM 生成代码并写入工作区
            try:
                asyncio.create_task(self._run_executing_phase(workflow_id))
                logger.info(
                    f"run_prompting_phase: 已调度 _run_executing_phase 后台任务 "
                    f"workflow={workflow_id[:8]}..."
                )
            except RuntimeError as loop_exc:
                # 无事件循环时降级为同步执行（兜底）
                logger.warning(
                    f"run_prompting_phase: 调度 executing 后台任务失败，"
                    f"改为同步执行: {loop_exc}"
                )
                try:
                    await self._run_executing_phase(workflow_id)
                except Exception as exec_exc:
                    logger.warning(
                        f"run_prompting_phase: 同步执行 _run_executing_phase 失败: "
                        f"{exec_exc}"
                    )
        except Exception as exc:
            logger.exception(f"run_prompting_phase 失败: {exc}")
            result["error"] = str(exc)
        return result


__all__ = ["PromptingStageMixin"]
