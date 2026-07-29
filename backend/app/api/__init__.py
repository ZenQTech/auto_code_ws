"""
# ============================================================
# API 路由聚合模块（V4.1 升级版）
# ============================================================
# 核心作用：聚合所有 API 子路由，统一注册到主应用
# ============================================================
# 修改记录：
#   - 2026-06-17 | v1.1.0 | 新增 hermes 路由注册
#   - 2026-06-23 | v1.2.0 | 新增 sessions 路由注册
#   - 2026-06-24 | v4.1.0 | 新增 quota、architecture、evaluation、
#     security、git、memory 路由注册
#   - 2026-06-24 | v4.1.1 | 新增 architecture 路由注册（架构设计批判迭代 API）
#   - 2026-06-24 | v4.1.2 | 新增 evaluation 路由注册（集成校验与系统评测 API）
#   - 2026-06-24 | v4.1.3 | 新增 config 路由注册（全局配置中心 API）
#   - 2026-07-24 | v1.3.0 | Module E 新增 models / reasoning / review / fix
#     四个路由注册（Codex 核心特性：模型选择 / 推理强度 / /review / /fix）
#   - 2026-07-28 | v6.17.0 | Cycle 11 P2-1 新增 e2e 路由注册
#     （Playwright E2E 自动化：health/scenarios/run/reports/baselines/compare）
#   - 2026-07-28 | v6.20.0 | Cycle 13 P0-1 新增 worktree_v2 路由注册
#     （Worktree 隔离执行：完整生命周期 + 状态机 + 自动合并 + 冲突解决 + 过期检测）
# ============================================================
"""

from fastapi import APIRouter

from .agents import router as agents_router
from .tasks import router as tasks_router
from .conversations import router as conversations_router
from .stats import router as stats_router
from .workflow import router as workflow_router
from .usage import router as usage_router
from .hermes import router as hermes_router
from .sessions import router as sessions_router
from .quota import router as quota_router
from .security import router as security_router
from .git import router as git_router
from .memory import router as memory_router
from .architecture import router as architecture_router
from .evaluation import router as evaluation_router
from .config_endpoint import router as config_router
from .workspace import router as workspace_router
from .worktree import router as worktree_router
from .dashboard import router as dashboard_router
from .loop_v7 import router as loop_v7_router
from .models import router as models_router
from .reasoning import router as reasoning_router
from .review import router as review_router
from .fix import router as fix_router

api_router = APIRouter()

api_router.include_router(agents_router, prefix="/agents", tags=["智能体管理"])
api_router.include_router(tasks_router, prefix="/tasks", tags=["任务管理"])
api_router.include_router(conversations_router, prefix="/conversations", tags=["对话记录"])
api_router.include_router(stats_router, prefix="/stats", tags=["统计信息"])
api_router.include_router(workflow_router, prefix="/workflow", tags=["工作流"])
api_router.include_router(usage_router, prefix="/usage", tags=["用量监控"])
api_router.include_router(hermes_router, prefix="/hermes", tags=["Hermes 智能调度"])
api_router.include_router(sessions_router, prefix="/sessions", tags=["会话管理"])
api_router.include_router(quota_router, prefix="/quota", tags=["配额管控"])
api_router.include_router(security_router, prefix="/security", tags=["安全管理"])
api_router.include_router(git_router, prefix="/git", tags=["Git 版本管理"])
api_router.include_router(memory_router, prefix="/memory", tags=["代码记忆库"])
api_router.include_router(architecture_router, prefix="/architecture", tags=["架构设计批判迭代"])
api_router.include_router(evaluation_router, prefix="/evaluation", tags=["集成校验与系统评测"])
api_router.include_router(config_router, prefix="/config", tags=["全局配置中心"])
api_router.include_router(workspace_router, prefix="/workspace", tags=["工作空间管理"])
api_router.include_router(worktree_router, prefix="/worktree", tags=["Git Worktree"])
api_router.include_router(dashboard_router, prefix="/dashboard", tags=["工作流监控"])
api_router.include_router(loop_v7_router, prefix="/workflow", tags=["Loop Engineering v7"])
# v1.3.0 Module E：Codex 核心特性路由
api_router.include_router(models_router, prefix="/models", tags=["模型版本选择"])
api_router.include_router(reasoning_router, prefix="/reasoning", tags=["推理强度调节"])
api_router.include_router(review_router, prefix="/review", tags=["代码审查"])
api_router.include_router(fix_router, prefix="/fix", tags=["代码自动修复"])
# v1.4.0 P0-4 Cycle 4：SubAgent 记忆继承与独立 Context
from .subagent_memory import router as subagent_memory_router
api_router.include_router(subagent_memory_router, prefix="/agents", tags=["SubAgent 记忆"])
# v6.17.0 Cycle 11 P2-1：Playwright E2E 自动化
from .e2e import router as e2e_router
api_router.include_router(e2e_router, prefix="/e2e", tags=["E2E 自动化"])
# v6.18.0 Cycle 12 P0-1：Plugin 系统
from .plugins import router as plugins_router
api_router.include_router(plugins_router, prefix="/plugins", tags=["Plugin 系统"])
# v6.19.0 Cycle 12 P0-2：/goal 长时域模式
from .goal import router as goal_router
api_router.include_router(goal_router, prefix="/goal", tags=["/goal 长时域模式"])
# v6.20.0 Cycle 13 P0-1：Worktree v2 隔离执行
from .worktree_v2 import router as worktree_v2_router
api_router.include_router(worktree_v2_router, tags=["Worktree v2 隔离执行"])
# v6.21.0 Cycle 13 P0-2：Hermes Python/TypeScript SDK API
from .sdk import router as sdk_router
api_router.include_router(sdk_router, tags=["Hermes SDK"])
# v6.22.0 Cycle 13 P0-3：LLM-as-Judge 验证层
from .llm_judge import router as llm_judge_router
api_router.include_router(llm_judge_router, tags=["LLM-as-Judge 验证层"])
# v6.23.0 Cycle 13 P1-1：Plugin Marketplace 远端仓库
from .marketplace import router as marketplace_router
api_router.include_router(marketplace_router, prefix="/marketplace", tags=["Plugin Marketplace"])
