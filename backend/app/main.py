"""
# ============================================================
# FastAPI 主应用入口
# ============================================================
# 核心作用：平台后端服务入口，注册路由、中间件、WebSocket、
#           启动/关闭事件处理
# 运行流程：
#   1. 应用启动时初始化数据库、创建默认智能体
#   2. 注册 API 路由和 WebSocket 端点
#   3. 配置 CORS 中间件
#   4. 启动 Uvicorn 服务器
# 输入参数：无（通过配置文件读取）
# 输出结果：运行中的 Web 服务
# 修改记录：
#   - 2026-06-17 | v1.0.0 | 初始版本
#   - 2026-06-23 | v1.3.0 | 注册 sessions 路由；HermesService 注入 session_factory 启用持久化
#   - 2026-06-24 | v2.0.0 | 新增垃圾回收清理器生命周期管理（trash_cleaner.start/stop）
#   - 2026-06-26 | v2.1.0 | 新增 CommitHookHandler 初始化，注入 git_manager 和 session_factory
#   - 2026-06-26 | v4.1.0 | 新增 GitHubRepoManager 初始化（Task 6 配置管理）
#   - 2026-06-26 | v4.2.0 | WorkflowEngine 初始化传入 git_manager 和 commit_hook_handler，
#     调整初始化顺序（CommitHookHandler 在 WorkflowEngine 之前）
#   - 2026-06-29 | v2.2.0 | 新增 TaskHookHandler 初始化，注入 git_manager 和 session_factory，
#     注册到 app.state.task_hook_handler
#   - 2026-06-29 | v2.2.0 | 新增 AtomicTaskAggregator 初始化，注册到 app.state
#     atomic_task_aggregator
#   - 2026-06-29 | v2.4.0 | 新增 ClarificationService 初始化（基于 RequirementClarifier），
#     传入 WorkflowEngine 启用需求澄清功能
#   - 2026-06-29 | v2.4.1 | HermesService 注入 workflow_engine，支持 coding 模式下
#     开发需求自动路由到 WorkflowEngine 启动 SOP 工作流
#   - 2026-06-30 | v2.4.2 | 新增静态资源 no-store 缓存头，避免浏览器继续加载旧
#     index-Bic32m5_.js 等历史 bundle 导致前端逻辑不生效
#   - 2026-07-01 | v2.5.0 | 新增 ArchitectureWorkflowService 初始化，注入
#     hermes_service / workflow_engine / git_manager，注册到 app.state
# ============================================================
"""

import logging
import sys
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# 确保项目根目录在 Python 路径中
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from .config import settings
from .database import init_db, get_session_factory
from .api import api_router
from .ws import ws_router
from .error_handler import setup_logging, global_exception_handler, TaskRecoveryManager

# 配置日志
setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    应用生命周期管理
    启动时：初始化数据库
    关闭时：清理资源
    """
    # 启动时执行
    logger.info("正在初始化数据库...")
    await init_db()
    logger.info("数据库初始化完成")

    # 恢复中断的任务
    recovery_manager = TaskRecoveryManager()
    session_factory = get_session_factory()
    async with session_factory() as session:
        await recovery_manager.recover_pending_tasks(session)
    logger.info("任务恢复检查完成")

    # 初始化 CLI 集成层
    from cli_integration.executor import CLIExecutor
    from cli_integration.curl_executor import CurlLLMExecutor
    from cli_integration.agent_manager import AgentManager
    from cli_integration.strategy_router import StrategyRouter

    cli_config = settings.cli
    # 从配置中提取 CLI 环境变量（火山引擎 Coding Plan API）
    cli_env = cli_config.get("env", {})
    # 根据 cli.executable 选择执行器：curl/curl-llm 走 CurlLLMExecutor，
    # 其余（默认 claude）走 CLIExecutor。这样 claude.exe 崩溃时可无缝切换。
    cli_executable = cli_config.get("executable", "claude")
    if str(cli_executable).lower() in ("curl", "curl-llm"):
        logger.info(
            f"检测到 cli.executable={cli_executable}，使用 CurlLLMExecutor "
            f"绕过 claude.exe 子进程（stack smashing 段错误绕过方案）"
        )
        executor = CurlLLMExecutor(
            executable=cli_executable,
            default_timeout=cli_config.get("default_timeout", 600),
            max_retries=cli_config.get("max_retries", 3),
            retry_base_delay=cli_config.get("retry_base_delay", 2),
            cli_env=cli_env,
            name=f"curl-llm-{cli_executable}",
        )
    else:
        executor = CLIExecutor(
            executable=cli_executable,
            default_timeout=cli_config.get("default_timeout", 600),
            max_retries=cli_config.get("max_retries", 3),
            retry_base_delay=cli_config.get("retry_base_delay", 2),
            cli_env=cli_env,
        )
    agent_manager = AgentManager(
        health_check_interval=settings.scheduling.get("health_check_interval", 30),
    )
    strategy_router = StrategyRouter()

    # 存储到 app.state 供路由使用
    app.state.executor = executor
    app.state.agent_manager = agent_manager
    app.state.strategy_router = strategy_router

    # 初始化 Hermes 集成层
    from hermes_integration.hermes_executor import HermesExecutor
    from backend.app.services.hermes_service import HermesService

    hermes_config = settings.hermes
    hermes_executor = HermesExecutor(
        executable=hermes_config.get("executable", "hermes"),
        default_timeout=hermes_config.get("default_timeout", 600),
        max_retries=hermes_config.get("max_retries", 3),
        retry_base_delay=hermes_config.get("retry_base_delay", 2),
        cli_env=cli_env,
        agent_manager=agent_manager,
    )
    hermes_service = HermesService(
        executor=executor,
        agent_manager=agent_manager,
        session_factory=get_session_factory(),
    )

    # 存储到 app.state 供路由使用
    app.state.hermes_executor = hermes_executor
    app.state.hermes_service = hermes_service

    # V2.4.0 新增：初始化需求澄清服务
    from backend.app.services.clarification_service import ClarificationService
    from backend.app.services.agent_roles.requirement_clarifier import RequirementClarifier
    requirement_clarifier = RequirementClarifier(hermes_service)
    clarification_service = ClarificationService(
        session_factory=get_session_factory(),
        requirement_clarifier=requirement_clarifier,
    )
    app.state.clarification_service = clarification_service
    # v2.5.0 新增：将 clarification_service 注入到 hermes_service（用于 clarifying 模式）
    hermes_service.clarification_service = clarification_service
    logger.info("需求澄清服务已初始化")

    # V2.1.0 新增：初始化 Commit Hook 处理器（必须在 WorkflowEngine 之前）
    from backend.app.services.commit_hook_handler import CommitHookHandler
    from backend.app.services.git_manager import git_manager
    app.state.git_manager = git_manager
    commit_hook_handler = CommitHookHandler(
        git_manager=git_manager,
        session_factory=get_session_factory(),
    )
    app.state.commit_hook_handler = commit_hook_handler
    logger.info("Commit Hook 处理器已初始化")

    # V2.2.0 新增：初始化 Task Hook 处理器
    from backend.app.services.task_hook_handler import TaskHookHandler
    task_hook_handler = TaskHookHandler(
        git_manager=git_manager,
        session_factory=get_session_factory(),
    )
    app.state.task_hook_handler = task_hook_handler
    logger.info("Task Hook 处理器已初始化")

    # V2.2.0 新增：初始化原子任务清单聚合器
    from backend.app.services.atomic_task_aggregator import AtomicTaskAggregator
    atomic_task_aggregator = AtomicTaskAggregator(
        session_factory=get_session_factory(),
        task_hook_handler=commit_hook_handler,
    )
    app.state.atomic_task_aggregator = atomic_task_aggregator
    logger.info("原子任务清单聚合器已初始化")

    # V2.0.0 新增：初始化 Loop Engineering 工作流引擎
    from backend.app.services.workflow_engine import WorkflowEngine
    workflow_engine = WorkflowEngine(
        session_factory=get_session_factory(),
        git_manager=git_manager,
        commit_hook_handler=commit_hook_handler,
        clarification_service=clarification_service,  # v2.4.0 新增
        hermes_service=hermes_service,  # v5.4.0 新增：双向注入，使 _run_prompting_phase 能通过 PromptEngineer 调用真实 LLM
    )
    app.state.workflow_engine = workflow_engine
    logger.info("Loop Engineering 工作流引擎已初始化")
    # v2.4.1 新增：将 workflow_engine 注入到 hermes_service（用于 coding 模式下开发需求自动路由）
    hermes_service.workflow_engine = workflow_engine
    logger.info("HermesService 已注入 WorkflowEngine")

    # V2.5.0 新增：初始化架构设计工作流编排服务
    from backend.app.services.architecture_workflow_service import ArchitectureWorkflowService
    architecture_workflow_service = ArchitectureWorkflowService(
        session_factory=get_session_factory(),
        hermes_service=hermes_service,
        workflow_engine=workflow_engine,
        git_manager=git_manager,
    )
    app.state.architecture_workflow_service = architecture_workflow_service
    # v3.2.0 新增：将 architecture_workflow_service 注入到 workflow_engine
    workflow_engine.architecture_workflow_service = architecture_workflow_service
    logger.info("架构设计工作流编排服务已初始化")

    # V2.0.0 新增：初始化 Git Worktree 管理器
    from backend.app.services.worktree_manager import WorktreeManager
    worktree_manager = WorktreeManager()
    app.state.worktree_manager = worktree_manager
    logger.info("Git Worktree 管理器已初始化")

    # 初始化 GitHub 仓库管理器
    from backend.app.services.github_repo_manager import GitHubRepoManager
    github_repo_manager = GitHubRepoManager()
    app.state.github_repo_manager = github_repo_manager
    logger.info("GitHub 仓库管理器已初始化")

    # 启动健康检查
    await agent_manager.start_health_check()

    # 启动用量监控后台刷新任务（绑定 AgentManager 获取本地真实用量）
    from .services.usage_monitor import usage_monitor
    usage_monitor.bind_agent_manager(agent_manager)
    usage_monitor.start_background_refresh()

    # V4.1 新增：启动配额管理器后台清理
    from .services.quota_manager import quota_manager
    quota_manager.start_background_cleanup()
    logger.info("配额管理器已启动")

    # V2.0 新增：启动垃圾回收清理器（定期硬删除过期软删除会话）
    from .services.trash_cleaner import trash_cleaner
    trash_cleaner.start()
    logger.info("垃圾回收清理器已启动")

    # 不再自动创建默认智能体，所有实例由 Hermes 按需动态创建
    logger.info("平台就绪，等待 Hermes 按需创建 Claude Code CLI 实例")

    yield

    # 关闭时执行
    logger.info("正在关闭服务...")
    usage_monitor.stop_background_refresh()
    quota_manager.stop_background_cleanup()
    trash_cleaner.stop()
    await agent_manager.stop_health_check()
    logger.info("服务已关闭")


# 创建 FastAPI 应用
app = FastAPI(
    title="Claude Code CLI 代码智能体调度平台",
    description="基于 Claude Code CLI 的多实例代码智能体调度平台",
    version="1.0.0",
    lifespan=lifespan,
)

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.server.get("cors_origins", ["*"]),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def no_store_frontend_static_cache(request: Request, call_next):
    """
    前端静态资源缓存兜底中间件（v2.4.2）
    作用：防止浏览器继续使用旧版 index.html 或旧 hashed JS bundle
          （如 index-Bic32m5_.js），导致最新前端逻辑不生效。
    调用方：所有 HTTP 请求进入 FastAPI 时自动调用。
    被调用方：下游路由/StaticFiles 响应。
    运行步骤：
      1. 调用下游路由获取 Response；
      2. 对根路径、index.html、assets 下的 js/css 静态资源添加 no-store；
      3. 返回响应，强制浏览器下次重新拉取最新 dist 资源。
    输入参数：request 当前 HTTP 请求，call_next 下游处理函数。
    输出结果：添加 Cache-Control/Pragma/Expires 响应头后的 Response。
    """
    response: Response = await call_next(request)
    path = request.url.path
    if path in ("/", "/index.html") or path.startswith("/assets/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# 注册路由
app.include_router(api_router, prefix="/api")
app.include_router(ws_router)

# 注册全局异常处理器
app.add_exception_handler(Exception, global_exception_handler)


@app.get("/health")
async def health_check():
    """健康检查端点"""
    return {"status": "ok", "service": "claude-code-scheduling-platform"}


@app.get("/")
async def root_fallback():
    """
    根路径兜底路由
    当前端未构建时，返回平台信息页和 API 文档链接
    """
    if _frontend_available:
        # 如果前端已挂载，这个路由不会被触发
        # 但保留以防 StaticFiles 挂载失败
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url="/index.html")
    from fastapi.responses import HTMLResponse
    return HTMLResponse(content=f"""
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head><meta charset="UTF-8"><title>Claude Code CLI 调度平台</title>
    <style>
      body {{ font-family: sans-serif; max-width: 600px; margin: 80px auto; padding: 20px; background: #0f0f1a; color: #e0e0e0; }}
      h1 {{ color: #a78bfa; }} a {{ color: #7c3aed; }}
      .card {{ background: #1a1a2e; border-radius: 12px; padding: 24px; margin: 16px 0; }}
      code {{ background: #2d2d4a; padding: 2px 8px; border-radius: 4px; }}
    </style></head>
    <body>
      <h1>Claude Code CLI 智能体调度平台</h1>
      <div class="card">
        <p>后端服务运行中</p>
        <p>API 文档: <a href="/docs">/docs</a></p>
        <p>健康检查: <a href="/health">/health</a></p>
      </div>
      <div class="card">
        <p>启动前端开发服务器:</p>
        <code>cd frontend && npm run dev</code>
      </div>
    </body></html>
    """)


# 挂载静态文件（前端构建产物）
# 注意：必须在所有显式路由注册之后挂载，否则会拦截 /health 等路由
frontend_dist = settings.get_project_root() / "frontend" / "dist"
_frontend_available = frontend_dist.exists()
if _frontend_available:
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
