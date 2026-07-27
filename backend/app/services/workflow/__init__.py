"""
# ============================================================
# workflow 子包 - 工作流引擎阶段化模块
# ============================================================
# 核心作用：将庞大的 workflow_engine.py（5241 行）按阶段拆分为
#           独立的 stage_* 子模块，便于后续渐进式重构
# 运行流程：
#   1. 本包对外统一暴露 WorkflowEngine 与全部数据类/常量
#   2. 数据类/常量下沉到 stage_common.py（v6.1.0）
#   3. WorkflowEngine 类继续保留在原 workflow_engine.py 中
#   4. 为避免循环导入：本包直接 re-export stage_common 的符号，
#      不通过 workflow_engine 间接引用
# 输入参数：无
# 输出结果：可导入的 WorkflowEngine、WorkflowStatusInfo、IterationContext、
#           SmartIterationResult、PipelineStep、PipelineResult、
#           PipelineStepResult、PipelineTestResult、SubGoal、GoalInfo、
#           WORKFLOW_STAGES、STAGE_TRANSITIONS
# ============================================================
# 修改记录：
#   - 2026-07-24 | v1.0.0 | C1 重构：建立 stage_* 子模块结构并 re-export
#   - 2026-07-27 | v1.1.0 | 修复循环导入：直接从 stage_common 导出，
#     不再通过 workflow_engine 中转；WorkflowEngine 仍从 workflow_engine
#     导入以保留 API 兼容
# ============================================================
"""

# 数据类 + 常量：直接从 stage_common 导出（避免循环导入 workflow_engine）
from .stage_common import (
    # 常量
    WORKFLOW_STAGES,
    STAGE_TRANSITIONS,
    # 数据类
    WorkflowStatusInfo,
    IterationContext,
    SmartIterationResult,
    PipelineStep,
    PipelineResult,
    PipelineStepResult,
    PipelineTestResult,
    SubGoal,
    GoalInfo,
)

# 核心引擎类：使用延迟导入（TYPE_CHECKING 模式），避免循环
# 调用方仍可使用 from app.services.workflow import WorkflowEngine
# 实际触发是从 app.services.workflow_engine 模块加载
def __getattr__(name):
    """延迟加载 WorkflowEngine 避免循环导入"""
    if name == "WorkflowEngine":
        from .. import workflow_engine as _we
        return _we.WorkflowEngine
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    "WORKFLOW_STAGES",
    "STAGE_TRANSITIONS",
    "WorkflowStatusInfo",
    "IterationContext",
    "SmartIterationResult",
    "PipelineStep",
    "PipelineResult",
    "PipelineStepResult",
    "PipelineTestResult",
    "SubGoal",
    "GoalInfo",
    "WorkflowEngine",
]
