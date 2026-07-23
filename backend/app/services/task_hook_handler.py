"""
# ============================================================
# Task Hook 处理器模块（v2.2.0）
# ============================================================
# 核心作用：接收 Claude Code CLI 实例发送的 4 种 Hook 信号
#           （task_complete/git_commit/check_complete/test_complete），
#           完成校验、状态同步、Git 提交触发
# 运行流程：
#   1. 接收 Hook 信号，根据 hook_type 分发到对应处理方法
#   2. task_complete：校验必填字段 → 幂等检查 → 更新 tasks 表状态
#      → 触发 Git 提交（若有变更文件）
#   3. git_commit：校验必填字段 → 调用 git_manager 执行提交推送
#      → 更新 WorkflowStage 的 output_doc
#   4. check_complete：校验必填字段 → 更新 task 的 result_summary
#      → 记录 issues 到 error_message
#   5. test_complete：校验必填字段 → 更新 task 的 result_summary
#   6. 返回 HookResult 处理结果
# 输入参数：
#   - git_manager: GitManager 实例，提供 Git 操作能力
#   - session_factory: async_sessionmaker 实例，提供数据库会话
# 输出结果：HookResult 数据类实例，包含 success、hook_type、
#           task_id、commit_hash、message、action_taken
# 修改记录：
#   - 2026-06-29 | v2.2.0 | 初始版本，实现 4 种 Task Hook 处理逻辑
# ============================================================
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Set, Tuple

from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

from .git_manager import GitManager

logger = logging.getLogger(__name__)


@dataclass
class HookResult:
    """
    Hook 处理结果数据类
    字段说明：
      - success: bool，操作是否成功
      - hook_type: str，Hook 类型（task_complete/git_commit/check_complete/test_complete）
      - task_id: str，关联的任务 ID
      - commit_hash: str，Git 提交哈希值（仅 git_commit/task_complete 有值）
      - message: str，操作结果描述信息
      - action_taken: str，执行的动作（committed/skipped_duplicate/validation_failed/status_updated）
    """
    success: bool = False
    hook_type: str = ""
    task_id: str = ""
    commit_hash: str = ""
    message: str = ""
    action_taken: str = ""


class TaskHookHandler:
    """
    Task Hook 处理器类
    作用：接收 Claude Code CLI 实例发送的 4 种 Hook 信号，
          完成校验、状态同步、Git 提交触发
    调用方：API 路由层（workflow.py 的 task-hook 端点）
    被调用方：GitManager（Git 操作）、数据库（tasks/WorkflowStage 更新）
    """

    def __init__(self, git_manager: GitManager, session_factory: async_sessionmaker):
        """
        初始化 Task Hook 处理器
        运行步骤：
          1. 保存 GitManager 实例引用
          2. 保存异步数据库会话工厂引用
          3. 初始化幂等处理集合，记录已处理的 task_id
        参数：
          - git_manager: GitManager 实例，提供 Git 提交和推送能力
          - session_factory: async_sessionmaker 实例，提供异步数据库会话
        """
        self.git_manager = git_manager
        self.session_factory = session_factory
        # 幂等处理：记录已处理的 task_id，防止重复处理
        self._processed_hooks: Set[str] = set()

    async def handle_task_hook(
        self,
        workflow_id: str,
        hook_type: str,
        payload: Dict[str, Any],
    ) -> HookResult:
        """
        Task Hook 主入口方法，根据 hook_type 分发到对应处理方法
        运行步骤：
          1. 校验 hook_type 合法性（必须为 4 种类型之一）
          2. 根据 hook_type 路由到对应的处理方法
          3. 返回 HookResult
        参数：
          - workflow_id: str，工作流 ID
          - hook_type: str，Hook 类型，取值：
            * task_complete：任务完成信号
            * git_commit：Git 提交信号
            * check_complete：校验完成信号
            * test_complete：测试完成信号
          - payload: dict，Hook 负载数据
        返回值：HookResult，包含 success、hook_type、task_id、
                commit_hash、message、action_taken
        """
        valid_types = {"task_complete", "git_commit", "check_complete", "test_complete"}
        if hook_type not in valid_types:
            logger.error(f"无效的 hook_type: {hook_type}，有效值为: {valid_types}")
            return HookResult(
                success=False,
                hook_type=hook_type,
                message=f"无效的 hook_type: {hook_type}，有效值为: {valid_types}",
                action_taken="validation_failed",
            )

        # 路由分发到对应的处理方法
        if hook_type == "task_complete":
            return await self._handle_task_complete(workflow_id, payload)
        elif hook_type == "git_commit":
            return await self._handle_git_commit(workflow_id, payload)
        elif hook_type == "check_complete":
            return await self._handle_check_complete(workflow_id, payload)
        elif hook_type == "test_complete":
            return await self._handle_test_complete(workflow_id, payload)

    # ============================================================
    # 私有方法：各 Hook 类型的处理逻辑
    # ============================================================

    async def _handle_task_complete(
        self,
        workflow_id: str,
        payload: Dict[str, Any],
    ) -> HookResult:
        """
        处理 task_complete 信号
        运行步骤：
          1. 校验必填字段：task_id、module_name、status、output
          2. 幂等检查：若 task_id 已处理则返回幂等确认
          3. 更新 tasks 表中对应 task 状态为 COMPLETED
          4. 若 payload 中包含 changed_files 和 commit_message，触发 Git 提交
          5. 记录 task_id 到 _processed_hooks
        参数：
          - workflow_id: str，工作流 ID
          - payload: dict，包含 task_id、module_name、status、output 等字段
        返回值：HookResult
        """
        # 步骤 1：校验必填字段
        required_fields = ["task_id", "module_name", "status", "output"]
        valid, error_msg = self._validate_payload(payload, required_fields)
        if not valid:
            logger.error(f"task_complete Hook 校验失败: {error_msg}")
            return HookResult(
                success=False,
                hook_type="task_complete",
                message=error_msg,
                action_taken="validation_failed",
            )

        task_id = payload["task_id"]
        module_name = payload["module_name"]
        status = payload["status"]
        output = payload["output"]

        # 步骤 2：幂等检查
        if self._is_duplicate(task_id):
            logger.info(f"task_complete Hook 幂等跳过: task_id={task_id}")
            return HookResult(
                success=True,
                hook_type="task_complete",
                task_id=task_id,
                message=f"任务 {task_id} 已处理（幂等）",
                action_taken="skipped_duplicate",
            )

        # 步骤 3：更新 tasks 表中对应 task 状态为 COMPLETED
        try:
            async with self.session_factory() as db:
                await db.execute(
                    text(
                        "UPDATE tasks SET status = :status, "
                        "result_summary = :result_summary, "
                        "completed_at = :completed_at, "
                        "updated_at = :updated_at "
                        "WHERE id = :task_id"
                    ),
                    {
                        "status": "completed" if status == "completed" else status,
                        "result_summary": output[:2000],
                        "completed_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc),
                        "task_id": task_id,
                    },
                )
                await db.commit()
                logger.info(
                    f"task_complete Hook 已更新任务状态: task_id={task_id}, "
                    f"module={module_name}, status=completed"
                )
        except Exception as e:
            logger.error(f"task_complete Hook 更新任务状态失败: {e}")
            return HookResult(
                success=False,
                hook_type="task_complete",
                task_id=task_id,
                message=f"数据库更新失败: {str(e)}",
                action_taken="validation_failed",
            )

        # 步骤 4：若 payload 中包含 changed_files 和 commit_message，触发 Git 提交
        commit_hash = ""
        changed_files: List[str] = payload.get("changed_files", [])
        commit_message: str = payload.get("commit_message", "")
        if changed_files and commit_message:
            try:
                commit_result = await self.git_manager.commit_module_changes(
                    module_name=module_name,
                    changed_files=changed_files,
                    commit_message=commit_message,
                )
                if commit_result.get("success"):
                    commit_hash = commit_result.get("commit_hash", "")
                    # 推送远程分支
                    push_result = await self.git_manager.push_module_branch(module_name)
                    if not push_result.get("success"):
                        logger.warning(
                            f"task_complete Hook 推送失败（非阻塞）: {push_result.get('message')}"
                        )
                    logger.info(
                        f"task_complete Hook 已提交: task_id={task_id}, "
                        f"commit={commit_hash}"
                    )
                else:
                    logger.warning(
                        f"task_complete Hook 提交失败: {commit_result.get('message')}"
                    )
            except Exception as e:
                logger.warning(f"task_complete Hook 触发 Git 提交异常（非阻塞）: {e}")

        # 步骤 5：记录 task_id 到 _processed_hooks
        self._processed_hooks.add(task_id)

        return HookResult(
            success=True,
            hook_type="task_complete",
            task_id=task_id,
            commit_hash=commit_hash,
            message=f"任务 [{module_name}] 已完成并更新状态",
            action_taken="committed" if commit_hash else "status_updated",
        )

    async def _handle_git_commit(
        self,
        workflow_id: str,
        payload: Dict[str, Any],
    ) -> HookResult:
        """
        处理 git_commit 信号
        运行步骤：
          1. 校验必填字段：module_name、changed_files、commit_message
          2. 调用 git_manager.commit_module_changes() 执行提交
          3. 调用 git_manager.push_module_branch() 推送
          4. 更新 WorkflowStage 的 output_doc
        参数：
          - workflow_id: str，工作流 ID
          - payload: dict，包含 module_name、changed_files、commit_message 等字段
        返回值：HookResult
        """
        # 步骤 1：校验必填字段
        required_fields = ["module_name", "changed_files", "commit_message"]
        valid, error_msg = self._validate_payload(payload, required_fields)
        if not valid:
            logger.error(f"git_commit Hook 校验失败: {error_msg}")
            return HookResult(
                success=False,
                hook_type="git_commit",
                message=error_msg,
                action_taken="validation_failed",
            )

        module_name = payload["module_name"]
        changed_files: List[str] = payload["changed_files"]
        commit_message: str = payload["commit_message"]
        task_id = payload.get("task_id", "")

        # 步骤 2：执行模块提交
        commit_result = await self.git_manager.commit_module_changes(
            module_name=module_name,
            changed_files=changed_files,
            commit_message=commit_message,
        )

        if not commit_result.get("success"):
            error_msg = commit_result.get("message", "模块提交失败")
            logger.error(f"git_commit Hook 提交失败: {error_msg}")
            return HookResult(
                success=False,
                hook_type="git_commit",
                task_id=task_id,
                message=error_msg,
                action_taken="validation_failed",
            )

        commit_hash = commit_result.get("commit_hash", "")

        # 步骤 3：推送远程分支
        push_result = await self.git_manager.push_module_branch(module_name)
        if not push_result.get("success"):
            # 推送失败不阻塞流程，仅记录警告
            logger.warning(
                f"git_commit Hook 推送失败（非阻塞）: {push_result.get('message')}"
            )

        # 步骤 4：更新 WorkflowStage 的 output_doc
        try:
            async with self.session_factory() as db:
                # 构建 output_doc 内容
                checklist_item = payload.get("checklist_item", "")
                change_summary = payload.get("change_summary", "")
                output_doc_parts = []
                if checklist_item:
                    output_doc_parts.append(f"[Checklist 项] {checklist_item}")
                if change_summary:
                    output_doc_parts.append(f"[变更摘要] {change_summary}")
                output_doc_parts.append(f"[提交哈希] {commit_hash}")
                output_doc_parts.append(f"[提交信息] {commit_message}")
                output_doc = "\n".join(output_doc_parts)

                await db.execute(
                    text(
                        "UPDATE workflow_stages SET output_doc = :output_doc "
                        "WHERE workflow_id = :wid AND stage_name = :sn"
                    ),
                    {
                        "output_doc": output_doc,
                        "wid": workflow_id,
                        "sn": "executing",
                    },
                )
                await db.commit()

                logger.info(
                    f"git_commit Hook 阶段记录已更新: workflow={workflow_id[:8]}..., "
                    f"module={module_name}, commit={commit_hash}"
                )
        except Exception as e:
            # 数据库更新失败不阻塞流程，仅记录警告
            logger.warning(f"git_commit Hook 更新 WorkflowStage 失败（非阻塞）: {e}")

        return HookResult(
            success=True,
            hook_type="git_commit",
            task_id=task_id,
            commit_hash=commit_hash,
            message=f"模块 [{module_name}] 提交并推送成功",
            action_taken="committed",
        )

    async def _handle_check_complete(
        self,
        workflow_id: str,
        payload: Dict[str, Any],
    ) -> HookResult:
        """
        处理 check_complete 信号
        运行步骤：
          1. 校验必填字段：task_id、module_name、check_type、result
          2. 更新对应 task 的 result_summary 字段
          3. 若 result 为 "failed"，记录 issues 到 task.error_message
        参数：
          - workflow_id: str，工作流 ID
          - payload: dict，包含 task_id、module_name、check_type、result 等字段
        返回值：HookResult
        """
        # 步骤 1：校验必填字段
        required_fields = ["task_id", "module_name", "check_type", "result"]
        valid, error_msg = self._validate_payload(payload, required_fields)
        if not valid:
            logger.error(f"check_complete Hook 校验失败: {error_msg}")
            return HookResult(
                success=False,
                hook_type="check_complete",
                message=error_msg,
                action_taken="validation_failed",
            )

        task_id = payload["task_id"]
        module_name = payload["module_name"]
        check_type = payload["check_type"]
        result = payload["result"]
        issues: List[str] = payload.get("issues", [])

        # 步骤 2-3：更新 task 的 result_summary 和 error_message
        try:
            async with self.session_factory() as db:
                # 构建 result_summary 内容
                summary_parts = [
                    f"[校验类型] {check_type}",
                    f"[校验结果] {result}",
                ]
                if issues:
                    summary_parts.append(f"[问题数量] {len(issues)}")
                result_summary = "\n".join(summary_parts)

                # 若 result 为 "failed"，记录 issues 到 error_message
                error_message = ""
                if result == "failed" and issues:
                    error_message = "校验问题:\n" + "\n".join(
                        f"  - {issue}" for issue in issues
                    )

                await db.execute(
                    text(
                        "UPDATE tasks SET result_summary = :result_summary, "
                        "error_message = :error_message, "
                        "updated_at = :updated_at "
                        "WHERE id = :task_id"
                    ),
                    {
                        "result_summary": result_summary,
                        "error_message": error_message,
                        "updated_at": datetime.now(timezone.utc),
                        "task_id": task_id,
                    },
                )
                await db.commit()
                logger.info(
                    f"check_complete Hook 已更新: task_id={task_id}, "
                    f"module={module_name}, result={result}"
                )
        except Exception as e:
            logger.error(f"check_complete Hook 更新失败: {e}")
            return HookResult(
                success=False,
                hook_type="check_complete",
                task_id=task_id,
                message=f"数据库更新失败: {str(e)}",
                action_taken="validation_failed",
            )

        return HookResult(
            success=True,
            hook_type="check_complete",
            task_id=task_id,
            message=f"校验 [{check_type}] 结果已记录: {result}",
            action_taken="status_updated",
        )

    async def _handle_test_complete(
        self,
        workflow_id: str,
        payload: Dict[str, Any],
    ) -> HookResult:
        """
        处理 test_complete 信号
        运行步骤：
          1. 校验必填字段：task_id、module_name、test_type、result、coverage
          2. 更新 task 的 result_summary 包含测试结果
        参数：
          - workflow_id: str，工作流 ID
          - payload: dict，包含 task_id、module_name、test_type、result、coverage 等字段
        返回值：HookResult
        """
        # 步骤 1：校验必填字段
        required_fields = ["task_id", "module_name", "test_type", "result", "coverage"]
        valid, error_msg = self._validate_payload(payload, required_fields)
        if not valid:
            logger.error(f"test_complete Hook 校验失败: {error_msg}")
            return HookResult(
                success=False,
                hook_type="test_complete",
                message=error_msg,
                action_taken="validation_failed",
            )

        task_id = payload["task_id"]
        module_name = payload["module_name"]
        test_type = payload["test_type"]
        result = payload["result"]
        coverage = payload["coverage"]

        # 步骤 2：更新 task 的 result_summary 包含测试结果
        try:
            async with self.session_factory() as db:
                # 构建 result_summary 内容
                summary_parts = [
                    f"[测试类型] {test_type}",
                    f"[测试结果] {result}",
                    f"[覆盖率] {coverage:.2%}" if isinstance(coverage, float) else f"[覆盖率] {coverage}",
                ]
                result_summary = "\n".join(summary_parts)

                # 若 result 为 "failed"，记录 issues 到 error_message
                error_message = ""
                issues: List[str] = payload.get("issues", [])
                if result == "failed" and issues:
                    error_message = "测试问题:\n" + "\n".join(
                        f"  - {issue}" for issue in issues
                    )

                await db.execute(
                    text(
                        "UPDATE tasks SET result_summary = :result_summary, "
                        "error_message = :error_message, "
                        "updated_at = :updated_at "
                        "WHERE id = :task_id"
                    ),
                    {
                        "result_summary": result_summary,
                        "error_message": error_message,
                        "updated_at": datetime.now(timezone.utc),
                        "task_id": task_id,
                    },
                )
                await db.commit()
                logger.info(
                    f"test_complete Hook 已更新: task_id={task_id}, "
                    f"module={module_name}, result={result}, coverage={coverage}"
                )
        except Exception as e:
            logger.error(f"test_complete Hook 更新失败: {e}")
            return HookResult(
                success=False,
                hook_type="test_complete",
                task_id=task_id,
                message=f"数据库更新失败: {str(e)}",
                action_taken="validation_failed",
            )

        return HookResult(
            success=True,
            hook_type="test_complete",
            task_id=task_id,
            message=f"测试 [{test_type}] 结果已记录: {result}（覆盖率: {coverage}）",
            action_taken="status_updated",
        )

    # ============================================================
    # 私有辅助方法
    # ============================================================

    def _validate_payload(
        self,
        payload: Dict[str, Any],
        required_fields: List[str],
    ) -> Tuple[bool, str]:
        """
        校验 payload 是否包含所有必填字段
        运行步骤：
          1. 遍历 required_fields 列表
          2. 检查每个字段是否存在于 payload 中且非空
          3. 返回校验结果
        参数：
          - payload: dict，待校验的负载数据
          - required_fields: List[str]，必填字段名称列表
        返回值：Tuple[bool, str]
          - bool: 校验是否通过
          - str: 校验失败时的错误信息（通过时为空字符串）
        """
        missing_fields = []
        for field in required_fields:
            value = payload.get(field)
            # 字段不存在或为空值（None、空字符串、空列表）
            if value is None or value == "" or (isinstance(value, list) and len(value) == 0 and field == "changed_files"):
                # changed_files 允许空列表，仅当明确要求非空时检查
                if field == "changed_files":
                    continue
                missing_fields.append(field)

        if missing_fields:
            error_msg = f"payload 缺少必填字段: {', '.join(missing_fields)}"
            return False, error_msg

        return True, ""

    def _is_duplicate(self, task_id: str) -> bool:
        """
        检查 task_id 是否已处理（幂等检查）
        运行步骤：
          1. 在 _processed_hooks 集合中查找 task_id
          2. 返回是否存在
        参数：
          - task_id: str，任务 ID
        返回值：bool，True 表示已处理，False 表示未处理
        """
        return task_id in self._processed_hooks
