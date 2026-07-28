"""
# ============================================================
# FastAPI 主应用入口
# ============================================================
# 核心作用：平台后端服务入口，注册路由、中间件、WebSocket、
#           启动/关闭事件处理
# 运行流程：
#   1. 应用启动时初始化数据库、创建默认智能体
#   2. 注册 API 路由和 WebSocket 端点
#   3. 配置 CORS / GZip / 限流 / 请求追踪 ID 中间件
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
#   - 2026-07-27 | v5.5.0 | Cycle 7 P0-10 新增：注册 Multi-Agent v2 path-based
#     addressing 路由（spawn_agent/wait_agent/close_agent/send_message/followup_task）
#   - 2026-07-27 | v5.6.0 | Cycle 7 P0-11 新增：注册 TRACE 编译与执行路由
#     （compile/check/rules/stats/subjects）实现用户纠正到运行时强制执行的管道
#   - 2026-07-01 | v2.5.0 | 新增 ArchitectureWorkflowService 初始化，注入
#     hermes_service / workflow_engine / git_manager，注册到 app.state
#   - 2026-07-24 | v5.9.0 | Module B 后端性能优化：
#     1) 新增 GZipMiddleware（minimum_size=500, compresslevel=4）
#     2) 新增 /api/hermes/chat 与 /api/hermes/chat/stream 限流（20 req/min/IP，超限 429）
#     3) CORS 配置：cors_origins=["*"] 时打印 WARNING 日志
#     4) /health 端点增强：DB SELECT 1 + LLM API 2s 超时探测
#     5) 新增 X-Request-ID 中间件（UUID4）注入 request.state 与响应头
#     6) 日志过滤器注入 request_id extra 字段，结构化日志
#   - 2026-07-24 | v6.0.0 | Module F4 API 响应缓存：
#     1) /api/stats/overview 与 /api/quota/overview 添加 Cache-Control: max-age=30
#     2) /api/config 添加 ETag 支持：
#        - 基于响应体 SHA-256 计算强 ETag
#        - 客户端 If-None-Match 命中时返回 304 Not Modified
#        - 失败兜底：异常不影响主响应，仅记录日志
# ============================================================
"""

import hashlib
import json
import logging
import sys
import time
import uuid
from pathlib import Path
from contextlib import asynccontextmanager
from collections import defaultdict, deque
from typing import Deque, Dict, Tuple

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
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


# ============================================================
# 结构化日志：注入 request_id（v5.9.0 Module B 新增）
# ============================================================
class RequestIdFilter(logging.Filter):
    """
    日志过滤器：将当前请求上下文的 request_id 注入到 LogRecord
    调用方：所有 logger（通过 setup_logging 挂到根 logger）
    被调用方：日志格式化（%(request_id)s 可在格式串中使用）
    运行步骤：
      1. 尝试从 contextvars/request.state 获取当前 request_id
      2. 若无则使用占位符 "-"
      3. 将字段挂到 LogRecord 上，供格式化使用
    """

    def filter(self, record: logging.LogRecord) -> bool:
        # 默认占位符
        record.request_id = getattr(record, "request_id", "-")
        return True


# 将过滤器挂到根 logger 与本模块 logger
_root_logger = logging.getLogger()
if not any(isinstance(f, RequestIdFilter) for f in _root_logger.filters):
    _root_logger.addFilter(RequestIdFilter())
if not any(isinstance(f, RequestIdFilter) for f in logger.filters):
    logger.addFilter(RequestIdFilter())
# v6.13.0 修复：同时把 filter 挂到所有 root handler 上，
# 解决子 logger（如 database/services/...）日志记录缺少 request_id 字段
# 导致 "Formatting field not found in record: 'request_id'" 错误的问题。
for _handler in _root_logger.handlers:
    if not any(isinstance(f, RequestIdFilter) for f in _handler.filters):
        _handler.addFilter(RequestIdFilter())


# ============================================================
# 简易滑动窗口限流器（v5.9.0 Module B 新增）
# ============================================================
class SimpleRateLimiter:
    """
    基于内存的滑动窗口限流器
    作用：保护关键 API 端点，避免被单一 IP 刷爆
    调用方：限流中间件
    被调用方：无
    运行步骤：
      1. 为每个 (endpoint, ip) 维护一个 timestamp 队列
      2. 每次请求时清理超出窗口的旧时间戳
      3. 队列未满则放行并追加；满则拒绝
    说明：不依赖 slowapi，零外部依赖，单实例足够，
         多实例部署需替换为 Redis。
    参数：
      - max_requests: 窗口期内允许的最大请求数
      - window_seconds: 滑动窗口大小（秒）
    """

    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._buckets: Dict[Tuple[str, str], Deque[float]] = defaultdict(deque)
        self._last_cleanup = time.time()

    def hit(self, endpoint: str, client_ip: str) -> bool:
        """
        记录一次请求并判断是否超限
        参数：
          - endpoint: 限流端点标识
          - client_ip: 客户端 IP
        返回值：True 放行；False 超限
        """
        now = time.time()
        key = (endpoint, client_ip)
        bucket = self._buckets[key]

        # 清理过期时间戳
        cutoff = now - self.window_seconds
        while bucket and bucket[0] < cutoff:
            bucket.popleft()

        # 桶满则拒绝
        if len(bucket) >= self.max_requests:
            return False

        bucket.append(now)
        # 周期清理空桶，避免内存膨胀（每 60s 一次）
        if now - self._last_cleanup > 60:
            self._cleanup_empty_buckets()
            self._last_cleanup = now
        return True

    def _cleanup_empty_buckets(self):
        """清理空桶（仅清理真正为空的）"""
        empty_keys = [k for k, v in self._buckets.items() if not v]
        for k in empty_keys:
            del self._buckets[k]


# /api/hermes/chat 与 /api/hermes/chat/stream 限流：20 req/min/IP
_RATE_LIMITER = SimpleRateLimiter(max_requests=20, window_seconds=60)
_RATE_LIMITED_PATHS = {"/api/hermes/chat", "/api/hermes/chat/stream"}


def _get_client_ip(request: Request) -> str:
    """
    提取客户端 IP（优先 X-Forwarded-For，回落到 client.host）
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return (request.client.host if request.client else "unknown") or "unknown"


# ============================================================
# 健康检查（v5.9.0 Module B 增强）
# ============================================================
async def _check_database() -> Tuple[str, str]:
    """
    探测数据库连接：执行 SELECT 1
    返回值：(status, detail) status 为 "ok" 或 "error"
    """
    try:
        session_factory = get_session_factory()
        async with session_factory() as session:
            from sqlalchemy import text
            await session.execute(text("SELECT 1"))
        return "ok", "database reachable"
    except Exception as e:
        logger.error(f"健康检查-数据库连接失败: {e}")
        return "error", str(e)


async def _check_llm_api() -> Tuple[str, str]:
    """
    探测 LLM API 可达性：HEAD 请求 LLM base_url（2s 超时）
    返回值：(status, detail) status 为 "ok" 或 "error"
    """
    base_url = settings.cli.get("env", {}).get("ANTHROPIC_BASE_URL", "")
    if not base_url:
        return "error", "ANTHROPIC_BASE_URL not configured"
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            # 多数 LLM 网关对根路径或 /health 返回 200/401/405
            resp = await client.get(base_url.rstrip("/") + "/")
            # 2xx/3xx/4xx 都视为可达（网关存在），5xx 才视为异常
            if resp.status_code < 500:
                return "ok", f"llm api reachable (status={resp.status_code})"
            return "error", f"llm api returned {resp.status_code}"
    except Exception as e:
        logger.error(f"健康检查-LLM API 连接失败: {e}")
        return "error", str(e)


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

    # v6.3.0 (P0-4) 新增：Plan 模式服务初始化
    from .services.plan_mode import PlanModeService
    plan_mode_service = PlanModeService(
        session_factory=get_session_factory(),
        executor=getattr(app.state, "hermes_executor", None) or getattr(app.state, "executor", None),
    )
    app.state.plan_mode_service = plan_mode_service
    logger.info("Plan 模式服务已初始化")

    # v6.13.0 (Cycle 2 T2) 新增：长会话压缩服务初始化
    from .services.compaction import CompactionService
    compaction_service = CompactionService(
        session_factory=get_session_factory(),
        hermes_service=app.state.hermes_service,
    )
    app.state.compaction_service = compaction_service
    logger.info("长会话压缩服务已初始化")

    # v6.13.0 (Cycle 2 T3) 新增：会话 fork/resume 服务初始化
    from .services.session_fork_resume import SessionForkResumeService
    session_fork_resume_service = SessionForkResumeService(
        session_factory=get_session_factory(),
    )
    app.state.session_fork_resume_service = session_fork_resume_service
    logger.info("会话 fork/resume 服务已初始化")

    # v5.4.0 (Cycle 7 P0-9) 新增：Session Rollout JSONL 服务初始化
    from .services.session_rollout_service import SessionRolloutService
    from pathlib import Path
    rollout_base = Path(getattr(settings, "data_dir", "data")) / "rollouts"
    session_rollout_service = SessionRolloutService(
        session_factory=get_session_factory(),
        base_dir=str(rollout_base),
    )
    app.state.session_rollout_service = session_rollout_service
    logger.info(f"Session Rollout JSONL 服务已初始化: base_dir={rollout_base}")

    # v6.13.0 (Cycle 2 T4) 新增：Skills 插件系统服务初始化
    from .services.skills import SkillService
    skill_service = SkillService(session_factory=get_session_factory())
    app.state.skill_service = skill_service
    logger.info("Skills 插件服务已初始化")

    # v6.13.0 (Cycle 2 T5) 新增：AGENTS.md Memory 服务初始化
    from .services.agents_md_memory import AgentsMdMemoryService
    agents_md_service = AgentsMdMemoryService()
    app.state.agents_md_service = agents_md_service
    logger.info("AGENTS.md Memory 服务已初始化")

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

# ============================================================
# 中间件注册顺序（v5.9.0 Module B）
# ============================================================
# FastAPI 中间件按 LIFO（后注册先执行）顺序工作；
# 期望链路：Request -> RequestId -> RateLimit -> GZip -> CORS -> 路由
# 实际注册顺序（自下而上）：CORS, GZip, RateLimit, RequestId

# 配置 CORS
_cors_origins = settings.server.get("cors_origins", ["*"])
if isinstance(_cors_origins, list) and len(_cors_origins) == 1 and _cors_origins[0] == "*":
    # 通配符模式：仅适合开发环境；生产应配置具体来源
    logger.warning(
        "CORS 配置为通配符 ['*']，仅用于开发环境；生产部署请在 "
        "config/auto_code_config.yaml 的 server.cors_origins 配置具体允许的来源"
    )
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins if isinstance(_cors_origins, list) else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 启用 GZip 压缩（minimum_size=500, compresslevel=4）
# minimum_size 避免对非常小的响应浪费 CPU；
# compresslevel=4 平衡压缩率与 CPU 开销。
app.add_middleware(GZipMiddleware, minimum_size=500, compresslevel=4)


@app.middleware("http")
async def request_id_and_rate_limit_middleware(request: Request, call_next):
    """
    请求追踪 ID + 限流中间件（v5.9.0 Module B）
    作用：
      1. 为每个请求生成 UUID4 作为 X-Request-ID；
         - 优先使用请求头传入的 X-Request-ID（便于跨服务链路追踪）
         - 否则新生成一个
      2. 注入到 request.state.request_id 供下游路由使用
      3. 命中限流端点时检查 _RATE_LIMITER，超限直接返回 429
      4. 在响应头中回传 X-Request-ID
      5. 通过 contextvars/request.state 暴露 request_id 供日志过滤器使用
    调用方：所有 HTTP 请求
    被调用方：下游路由
    """
    # 1) 生成 / 复用 request_id
    incoming = request.headers.get("x-request-id")
    request_id = incoming if incoming else str(uuid.uuid4())
    request.state.request_id = request_id

    # 2) 限流检查（仅作用于配置的端点）
    if request.url.path in _RATE_LIMITED_PATHS:
        client_ip = _get_client_ip(request)
        if not _RATE_LIMITER.hit(request.url.path, client_ip):
            logger.warning(
                "限流触发: path=%s ip=%s request_id=%s",
                request.url.path,
                client_ip,
                request_id,
                extra={"request_id": request_id},
            )
            return JSONResponse(
                status_code=429,
                content={
                    "error": "rate_limited",
                    "message": "请求过于频繁，请稍后重试",
                    "request_id": request_id,
                },
                headers={"X-Request-ID": request_id, "Retry-After": "60"},
            )

    # 3) 执行下游
    response: Response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


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


# ============================================================
# API 响应缓存中间件（v6.0.0 Module F4 新增）
# ============================================================
# 设计：
#   - 集中式管理：避免在每个 endpoint 重复声明
#   - 路径白名单：仅对配置中的路径生效
#   - Cache-Control 路径：max-age=30（浏览器/代理可缓存 30 秒）
#   - ETag 路径：基于响应体 SHA-256 计算强 ETag，命中 If-None-Match 时
#     返回 304 Not Modified，节省带宽
# 失败兜底：异常不影响主响应，仅记录日志
# ============================================================

# Cache-Control 路径：响应添加 max-age=30
_API_CACHE_CONTROL_PATHS = {
    "/api/stats/overview",
    "/api/quota/overview",
}
_API_CACHE_MAX_AGE = 30  # 秒

# ETag 路径：基于响应体生成 ETag，支持 304 协商缓存
_API_ETAG_PATHS = {
    "/api/config",
}


def _compute_strong_etag(body: bytes) -> str:
    """
    计算强 ETag（基于响应体 SHA-256）
    输入：body - 响应体字节串
    输出：双引号包裹的 ETag 字符串（符合 RFC 7232）
    """
    digest = hashlib.sha256(body).hexdigest()
    return f'"{digest}"'


async def _read_response_body(response: Response) -> bytes:
    """
    读取 Response 的 body 内容（v6.0.0 Module F4 新增）
    背景：FastAPI/Starlette 的 Response 默认不会暴露 body，
          但经过中间件时 body_iterator 还未被消费。
    兜底：若 body_iterator 不可读，返回空字节。
    """
    body_iter = getattr(response, "body_iterator", None)
    if body_iter is None:
        return b""
    chunks = []
    try:
        async for chunk in body_iter:
            if isinstance(chunk, str):
                chunks.append(chunk.encode("utf-8"))
            elif isinstance(chunk, bytes):
                chunks.append(chunk)
            else:
                chunks.append(str(chunk).encode("utf-8"))
    except Exception as exc:
        logger.debug(f"读取响应 body 失败: {exc}")
        return b""
    return b"".join(chunks)


@app.middleware("http")
async def api_response_cache_middleware(request: Request, call_next):
    """
    API 响应缓存中间件（v6.0.0 Module F4 新增）
    作用：
      1) 对 _API_CACHE_CONTROL_PATHS 路径设置 Cache-Control: max-age=30
      2) 对 _API_ETAG_PATHS 路径计算 ETag，命中 If-None-Match 返回 304
    调用方：所有 HTTP 请求
    被调用方：下游路由
    异常处理：所有异常均为非阻塞，仅记录日志
    """
    path = request.url.path

    # 1) 先执行下游路由获取响应
    try:
        response: Response = await call_next(request)
    except Exception as exc:
        # 下游异常：放行原始异常（全局异常处理器兜底）
        raise

    # 2) 命中 Cache-Control 白名单
    if path in _API_CACHE_CONTROL_PATHS:
        try:
            # 保留已有 Cache-Control（兜底），否则覆盖
            existing = response.headers.get("Cache-Control")
            if not existing:
                response.headers["Cache-Control"] = f"public, max-age={_API_CACHE_MAX_AGE}"
        except Exception as exc:
            logger.debug(f"设置 Cache-Control 失败 path={path}: {exc}")

    # 3) 命中 ETag 白名单
    if path in _API_ETAG_PATHS:
        try:
            # 读取响应体计算 ETag
            body = await _read_response_body(response)
            if body:
                etag = _compute_strong_etag(body)

                # 重新构造响应（因为 body 已被消费）
                from fastapi.responses import Response as FastAPIResponse
                response = FastAPIResponse(
                    content=body,
                    status_code=response.status_code,
                    headers=dict(response.headers),
                    media_type=response.media_type,
                )

                # 检查 If-None-Match 协商缓存
                if_none_match = request.headers.get("if-none-match", "").strip()
                if if_none_match and if_none_match == etag:
                    # 命中 304：返回空 body
                    not_modified = FastAPIResponse(
                        content=b"",
                        status_code=304,
                        headers={
                            "ETag": etag,
                            "X-Request-ID": response.headers.get("X-Request-ID", ""),
                        },
                    )
                    return not_modified

                # 未命中：设置 ETag 头
                response.headers["ETag"] = etag
        except Exception as exc:
            logger.debug(f"ETag 处理失败 path={path}: {exc}")

    return response

# 注册路由
app.include_router(api_router, prefix="/api")
app.include_router(ws_router)

# v6.3.0 (P0-4) 新增：注册 Plan 模式 API 路由
from .api.plan import router as plan_router
app.include_router(plan_router, prefix="/api/workflow", tags=["plan-mode"])

# v6.11.0 (P0 Cycle 2) 新增：注册 MCP (Model Context Protocol) API 路由
from .api.mcp import router as mcp_router
app.include_router(mcp_router, prefix="/api/mcp", tags=["mcp"])

# v6.13.0 (Cycle 2 T2) 新增：注册长会话压缩 (Compaction) API 路由
from .api.compaction import router as compaction_router
app.include_router(compaction_router, prefix="/api", tags=["compaction"])

# v6.13.0 (Cycle 2 T3) 新增：注册会话 fork/resume API 路由
from .api.session_fork_resume import router as fork_resume_router
app.include_router(fork_resume_router, prefix="/api", tags=["session-fork-resume"])

# v6.13.0 (Cycle 2 T4) 新增：注册 Skills API 路由
from .api.skills import router as skills_router
app.include_router(skills_router, prefix="/api", tags=["skills"])

# v6.13.0 (Cycle 2 T5) 新增：注册 AGENTS.md Memory API 路由
from .api.agents_md import router as agents_md_router
app.include_router(agents_md_router, prefix="/api", tags=["agents-md"])

# v4.5.0 (Cycle 4 P0-4) 新增：注册 Hooks API 路由（10 类事件）
from .api.hooks import router as hooks_router
app.include_router(hooks_router, prefix="/api/hooks", tags=["hooks"])

# v5.1.0 (Cycle 6 P0-7-A) 新增：注册 LLM 缓存 API 路由（4 层缓存）
from .api.cache import router as cache_router
app.include_router(cache_router, tags=["llm-cache"])

# v5.1.0 (Cycle 6 P0-7-B) 新增：注册流式恢复网关 API 路由（SQLite + SSE replay）
from .api.streaming import router as streaming_router
app.include_router(streaming_router, tags=["streaming-buffer"])

# v5.3.0 (Cycle 7 P0-8) 新增：注册 OAuth 2.1 + PKCE API 路由（MCP 授权规范）
#   - GET  /.well-known/oauth-authorization-server
#   - POST /oauth/register / /oauth/token / /oauth/revoke
#   - GET  /oauth/authorize
from .api.oauth import router as oauth_router
app.include_router(oauth_router, tags=["oauth-2.1-pkce"])

# v5.3.0 (Cycle 7 P0-8) 新增：注册 MCP OAuth 管理 API 路由
#   - GET    /api/mcp/oauth/clients
#   - DELETE /api/mcp/oauth/clients/{id}
#   - GET    /api/mcp/oauth/stats
from .api.mcp_oauth_admin import router as mcp_oauth_admin_router
app.include_router(mcp_oauth_admin_router, prefix="/api", tags=["mcp-oauth-admin"])

# v5.4.0 (Cycle 7 P0-9) 新增：注册 Session Rollout JSONL API 路由
#   - GET    /api/sessions/{id}/rollout        分页查询 rollout
#   - GET    /api/sessions/{id}/rollout/info   rollout 状态信息
#   - GET    /api/sessions/{id}/rollout/turn/{tid}  turn 上下文
#   - POST   /api/sessions/{id}/fork-turn      基于 beforeTurnId 分叉（Codex v0.145.0）
#   - GET    /api/sessions/{id}/export         导出 JSONL
#   - POST   /api/sessions/{id}/import         导入 JSONL
#   - DELETE /api/sessions/{id}/rollout        删除 rollout
#   - POST   /api/sessions/{id}/rollout/turn   记录用户 turn
#   - POST   /api/sessions/{id}/rollout/response  记录 AI response
from .api.session_rollout import router as session_rollout_router
app.include_router(session_rollout_router, prefix="/api", tags=["session-rollout"])

# 注册 Multi-Agent v2 path-based addressing 路由（Cycle 7 P0-10）
#   - POST   /api/multi-agents/spawn           spawn_agent
#   - POST   /api/multi-agents/wait            wait_agent
#   - POST   /api/multi-agents/close           close_agent
#   - POST   /api/multi-agents/send-message    send_message
#   - POST   /api/multi-agents/followup        followup_task
#   - GET    /api/multi-agents/list            list_agents
#   - GET    /api/multi-agents/tree            get_tree
#   - GET    /api/multi-agents/stats           get_stats
#   - GET    /api/multi-agents/messages        get_messages
#   - POST   /api/multi-agents/auto-cleanup    turn-end cleanup
from .api.multi_agents import router as multi_agents_router
app.include_router(multi_agents_router, prefix="/api", tags=["multi-agents-v2"])

# 注册 TRACE 编译与执行路由（Cycle 7 P0-11）
#   - POST /api/trace/compile       编译用户消息为规则
#   - POST /api/trace/check         预检查工具调用
#   - GET  /api/trace/rules         列出规则
#   - GET  /api/trace/rules/{id}    获取单条规则
#   - DELETE /api/trace/rules/{id}  停用规则
#   - DELETE /api/trace/rules/{id}/hard  物理删除
#   - GET  /api/trace/stats         统计
#   - POST /api/trace/clear         清空 session 规则
#   - GET  /api/trace/subjects      列出已知主题
#   - GET  /api/trace/health        健康检查
from .api.trace import router as trace_router
app.include_router(trace_router, prefix="/api/trace", tags=["trace-enforcement"])

# v1.0.0 Cycle 8 P0-12：Slash Commands 系统
from .api.slash_commands import router as slash_commands_router
app.include_router(slash_commands_router, prefix="/api/slash-commands", tags=["slash-commands"])

# v1.0.0 Cycle 8 P0-13：Custom Commands 系统（.trae/commands/）
from .api.custom_commands import router as custom_commands_router
app.include_router(custom_commands_router, tags=["custom-commands"])

# v1.0.0 Cycle 8 P0-14：Custom Models + Bearer Token Auto-Refresh
from .api.custom_models import router as custom_models_router
app.include_router(custom_models_router)

# v1.0.0 Cycle 8 P1-4：/loop 命令集 (Loop Engineering triage/plan/execute/verify)
from .api.loop_commands import router as loop_commands_router
app.include_router(loop_commands_router, prefix="/api", tags=["loop-commands"])

# 启动时初始化 Custom Models 服务 + Bearer Token 后台刷新任务
@app.on_event("startup")
async def _init_custom_models():
    """应用启动时初始化自定义模型服务并启动后台 Token 刷新任务"""
    try:
        from app.services.custom_models.service import CustomModelsService
        from app.services.custom_models.bearer_token_refresher import BearerTokenRefresher
        # 触发单例实例化
        service = CustomModelsService.get_instance()
        refresher = BearerTokenRefresher.get_instance()
        # 启动后台 Token 刷新任务（每 60s 检查一次）
        await refresher.start_background_check(interval_seconds=60)
        import logging
        logging.getLogger(__name__).info(
            f"Custom Models 已初始化 (providers={len(service.list_providers())}, "
            f"refresh_running={refresher.get_status()['background_running']})"
        )
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"启动时初始化 Custom Models 失败: {e}")


@app.on_event("startup")
async def _init_custom_commands():
    """应用启动时扫描自定义命令目录"""
    try:
        from app.services.custom_commands.service import CustomCommandsService
        service = CustomCommandsService.get_instance()
        service.refresh()
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"启动时扫描自定义命令失败: {e}")

# 注册全局异常处理器
app.add_exception_handler(Exception, global_exception_handler)


@app.get("/health")
async def health_check():
    """
    健康检查端点（v5.9.0 Module B 增强）
    作用：探测数据库连接与 LLM API 可达性
    返回值：JSONResponse
      {
        "status": "healthy" | "unhealthy",
        "database": "ok" | "error",
        "database_detail": "...",
        "llm_api": "ok" | "error",
        "llm_api_detail": "...",
        "service": "claude-code-scheduling-platform"
      }
    """
    db_status, db_detail = await _check_database()
    llm_status, llm_detail = await _check_llm_api()
    overall = "healthy" if (db_status == "ok" and llm_status == "ok") else "unhealthy"
    payload = {
        "status": overall,
        "database": db_status,
        "database_detail": db_detail,
        "llm_api": llm_status,
        "llm_api_detail": llm_detail,
        "service": "claude-code-scheduling-platform",
    }
    return JSONResponse(
        status_code=200 if overall == "healthy" else 503,
        content=payload,
    )


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
