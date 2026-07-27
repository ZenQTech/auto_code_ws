# ============================================================
# 需求澄清阶段 (clarifying) - 方法契约与目标接口
# ============================================================
# 核心作用：定义需求澄清阶段的所有方法签名。
#           本文件 v6.1.0 仅作为方法契约（method contract），
#           实际实现仍在 workflow_engine.py 中。
#           后续 v6.2.0+ 迭代时，方法会从 workflow_engine.py 逐步
#           迁移到本文件，并通过 Mixin 注入回 WorkflowEngine。
# 拆分日期：2026-07-27
# 来源方法（目标迁移）:
#   - confirm_stage("clarifying") 部分逻辑
#   - validate_stage_boundary 中 clarifying 相关校验
#   - 澄清完成判定与需求文档生成
# 模块版本：v6.1.0 - C1 重构第二阶段（接口契约）
# 修改记录：
#   - 2026-07-27 | v6.1.0 | 定义需求澄清阶段方法签名
# ============================================================

from typing import Optional, Dict, Any, List
# v6.2.0: 使用绝对路径避免相对导入层级问题（stage_*.py 在 app.services.workflow 子包）
from backend.app.models import Workflow


class ClarificationStageMixin:
    """
    需求澄清阶段 Mixin（v6.1.0 接口契约）
    
    提供需求澄清阶段的所有方法。当 WorkflowEngine 继承本 Mixin 后，
    这些方法会变成 WorkflowEngine 实例方法，与原实现完全等价。
    
    阶段职责：
      1. 生成澄清问题（ClarificationService 调用）
      2. 接收用户回答
      3. 判定澄清完成条件
      4. 生成需求文档（requirement_doc）
      5. 推进到 designing 阶段
    
    状态机：
      pending → clarifying → (clarify_round loop) → designing
    """
    
    # 注意：以下方法签名仅为契约。实际实现仍在原 workflow_engine.py 中。
    # 完整迁移需要 1-2 个迭代周期。
    
    async def start_clarification(self, workflow_id: str) -> List[Dict[str, Any]]:
        """
        启动需求澄清，生成第一轮澄清问题
        参数：workflow_id - 工作流 ID
        返回：澄清问题列表
        异常：ValueError 当工作流不存在或状态非 pending/clarifying
        """
        raise NotImplementedError(
            "v6.1.0 接口契约：实际实现仍在 workflow_engine.py 的 start_workflow() 中"
        )
    
    async def submit_clarification_answer(
        self, workflow_id: str, answers: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        提交用户澄清回答
        参数：
          - workflow_id: 工作流 ID
          - answers: 用户答案列表，每项含 question_id + answer
        返回：{"clarification_round": int, "is_complete": bool, "next_questions": List}
        """
        raise NotImplementedError(
            "v6.1.0 接口契约：实际实现仍在 workflow_engine.py 的 confirm_stage('clarifying') 中"
        )
    
    async def finalize_requirement_doc(self, workflow_id: str) -> str:
        """
        根据澄清答案生成需求文档
        参数：workflow_id
        返回：生成的 requirement_doc 内容（Markdown 格式）
        """
        raise NotImplementedError(
            "v6.1.0 接口契约：实际实现仍在 workflow_engine.py 的 _finalize_requirement_doc() 中"
        )
    
    def _is_clarification_complete(
        self, workflow: Workflow, answers: List[Dict[str, Any]]
    ) -> bool:
        """
        判定澄清是否完成
        条件：
          1. 至少完成 1 轮澄清
          2. 用户明确确认或回答了所有必填问题
        """
        raise NotImplementedError(
            "v6.1.0 接口契约：实际实现仍在 workflow_engine.py 的 confirm_stage 中"
        )


__all__ = ["ClarificationStageMixin"]
