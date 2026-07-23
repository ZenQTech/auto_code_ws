"""
# ============================================================
# Commit Hook 处理器模块（v2.1.0）
# ============================================================
# 核心作用：处理工作流执行阶段的 Commit Hook 回调，接收模块
#           变更信息后执行 Git 提交、推送，并更新工作流阶段记录
# 运行流程：
#   1. 接收 Commit Hook 回调数据（模块名、变更文件、提交信息）
#   2. 校验 hook_data 必填字段完整性
#   3. 调用 GitManager.commit_module_changes 执行模块提交
#   4. 调用 GitManager.push_module_branch 推送远程分支
#   5. 更新 WorkflowStage 记录的 output_doc 字段
#   6. 返回操作结果（success、commit_hash、message）
# 输入参数：
#   - git_manager: GitManager 实例，提供 Git 操作能力
#   - session_factory: async_sessionmaker 实例，提供数据库会话
# 输出结果：字典，包含 success、commit_hash、message
# 修改记录：
#   - 2026-06-26 | v2.1.0 | 初始版本，实现 Commit Hook 处理逻辑
#   - 2026-06-26 | v2.2.0 | 适配 GitManager v4.3.0，commit_module_changes 和
#     push_module_branch 改为异步方法，调用处增加 await
# ============================================================
"""

import logging
from typing import Any, Dict, List

from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

from .git_manager import GitManager

logger = logging.getLogger(__name__)


class CommitHookHandler:
    """
    Commit Hook 处理器类
    作用：接收工作流执行阶段的 Commit Hook 回调，执行 Git 提交、
          推送操作，并更新工作流阶段记录
    调用方：API 路由层（workflow.py 的 commit-hook 端点）
    被调用方：GitManager（Git 操作）、数据库（WorkflowStage 更新）
    """

    def __init__(self, git_manager: GitManager, session_factory: async_sessionmaker):
        """
        初始化 Commit Hook 处理器
        运行步骤：
          1. 保存 GitManager 实例引用
          2. 保存异步数据库会话工厂引用
        参数：
          - git_manager: GitManager 实例，提供 Git 提交和推送能力
          - session_factory: async_sessionmaker 实例，提供异步数据库会话
        """
        self.git_manager = git_manager
        self.session_factory = session_factory

    async def handle_commit_hook(
        self,
        workflow_id: str,
        module_name: str,
        hook_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        处理 Commit Hook 回调
        运行步骤：
          1. 校验 hook_data 必填字段：module_name、changed_files、commit_message_suggestion
          2. 调用 GitManager.commit_module_changes 执行模块提交
          3. 调用 GitManager.push_module_branch 推送远程分支
          4. 更新 WorkflowStage 记录的 output_doc 字段
          5. 返回操作结果
        参数：
          - workflow_id: 工作流 ID，用于定位 WorkflowStage 记录
          - module_name: 模块名称，用于 Git 提交和日志记录
          - hook_data: Hook 回调数据字典，包含以下字段：
            * module_name: str，模块名称（必填）
            * changed_files: List[str]，变更文件路径列表（必填）
            * commit_message_suggestion: str，建议的提交信息（必填）
            * checklist_item: str，可选的 checklist 项信息
            * change_summary: str，可选的变更摘要
        返回值：字典，包含以下字段：
          - success: bool，操作是否成功
          - commit_hash: str，提交哈希值（成功时返回）
          - message: str，操作结果描述信息
        """
        # 步骤 1：校验 hook_data 必填字段
        required_fields = ["module_name", "changed_files", "commit_message_suggestion"]
        missing_fields = [f for f in required_fields if f not in hook_data or not hook_data[f]]
        if missing_fields:
            error_msg = f"hook_data 缺少必填字段: {', '.join(missing_fields)}"
            logger.error(f"Commit Hook 校验失败: {error_msg}")
            return {"success": False, "commit_hash": "", "message": error_msg}

        # 提取 hook_data 中的字段
        hook_module_name = hook_data["module_name"]
        changed_files: List[str] = hook_data["changed_files"]
        commit_message: str = hook_data["commit_message_suggestion"]
        checklist_item: str = hook_data.get("checklist_item", "")
        change_summary: str = hook_data.get("change_summary", "")

        # 步骤 2：执行模块提交
        commit_result = await self.git_manager.commit_module_changes(
            module_name=hook_module_name,
            changed_files=changed_files,
            commit_message=commit_message,
        )

        if not commit_result.get("success"):
            error_msg = commit_result.get("message", "模块提交失败")
            logger.error(f"Commit Hook 提交失败: {error_msg}")
            return {"success": False, "commit_hash": "", "message": error_msg}

        commit_hash = commit_result.get("commit_hash", "")

        # 步骤 3：推送远程分支
        push_result = await self.git_manager.push_module_branch(hook_module_name)
        if not push_result.get("success"):
            # 推送失败不阻塞流程，仅记录警告
            logger.warning(
                f"Commit Hook 推送失败（非阻塞）: {push_result.get('message')}"
            )

        # 步骤 4：更新 WorkflowStage 记录的 output_doc 字段
        try:
            async with self.session_factory() as db:
                # 构建 output_doc 内容：包含 checklist 项和提交信息
                output_doc_parts = []
                if checklist_item:
                    output_doc_parts.append(f"[Checklist 项] {checklist_item}")
                if change_summary:
                    output_doc_parts.append(f"[变更摘要] {change_summary}")
                output_doc_parts.append(f"[提交哈希] {commit_hash}")
                output_doc_parts.append(f"[提交信息] {commit_message}")
                output_doc = "\n".join(output_doc_parts)

                # 更新 executing 阶段的 output_doc
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
                    f"Commit Hook 阶段记录已更新: workflow={workflow_id[:8]}..., "
                    f"module={hook_module_name}, commit={commit_hash}"
                )
        except Exception as e:
            # 数据库更新失败不阻塞流程，仅记录警告
            logger.warning(f"Commit Hook 更新 WorkflowStage 失败（非阻塞）: {e}")

        # 步骤 5：返回成功结果
        return {
            "success": True,
            "commit_hash": commit_hash,
            "message": f"模块 [{hook_module_name}] 提交并推送成功",
        }

    async def fallback_commit(self, workflow_id: str) -> Dict[str, Any]:
        """
        兜底提交：对未发送 Commit Hook 的模块执行全量提交
        运行步骤：
          1. 获取工作流 executing 阶段的 output_doc（已记录的提交信息）
          2. 执行 git add -A 全量暂存所有变更
          3. 执行 git commit 提交
          4. 返回提交结果
        参数：
          - workflow_id: 工作流 ID
        返回值：字典，包含 success、commit_hash、message
        """
        try:
            # 检查工作区是否有未提交变更
            if not self.git_manager.repo or not self.git_manager.repo.is_dirty(untracked_files=True):
                logger.info(f"工作区无未提交变更，跳过兜底提交: workflow={workflow_id[:8]}...")
                return {"success": True, "commit_hash": "", "message": "无未提交变更"}

            # 执行全量提交
            result = await self.git_manager.commit_module_changes(
                module_name="workflow-completion",
                changed_files=[],
                commit_message=f"chore: 工作流 {workflow_id[:8]} 完成，兜底提交所有未提交变更",
            )

            if result.get("success"):
                logger.info(f"兜底提交成功: workflow={workflow_id[:8]}..., hash={result.get('commit_hash')}")
            else:
                logger.warning(f"兜底提交失败: workflow={workflow_id[:8]}..., {result.get('message')}")

            return result
        except Exception as e:
            logger.error(f"兜底提交异常: {e}")
            return {"success": False, "commit_hash": "", "message": str(e)}
