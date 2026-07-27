# ============================================================
# 数据库管理模块
# ============================================================
# 核心作用：管理 SQLite 数据库连接、会话、表结构创建、
#           启动时数据迁移（Session 模型新增兼容旧数据）
# 运行流程：
#   1. 读取数据库配置（路径、类型）
#   2. 创建异步 SQLAlchemy 引擎
#   3. 提供依赖注入式的数据库会话获取
#   4. 应用启动时自动创建所有表
#   5. 启用 SQLite WAL 模式（提升并发读写性能）
#   6. 检测旧表缺字段时执行 ALTER TABLE 迁移
#   7. 将 session_id IS NULL 的记录归入 legacy-default Session
# 输入参数：无（通过 Settings 读取配置）
# 输出结果：异步数据库会话对象
# 修改记录：
#   - 2026-06-17 | v1.0.0 | 初始版本
#   - 2026-06-23 | v1.1.0 | 启动时数据迁移：将 NULL session_id 归入 legacy-default
#   - 2026-06-23 | v1.2.0 | sessions 表加 title_auto_generated 列 + 数据回填
#   - 2026-06-23 | v1.3.0 | 撤销 title_auto_generated 列迁移与数据回填
#   - 2026-06-25 | v1.4.0 | legacy-default Session 插入新增 mode 列（修复 NOT NULL 约束错误）
#   - 2026-06-26 | v2.1.0 | 新增 workflows 表 repo_name 和 push_status 列迁移
#   - 2026-06-30 | v2.5.0 | 新增 workflows 表 human_confirmed_* / rejection_count /
#             force_human_review / clarification_* 列迁移，修复 INSERT 报错
#   - 2026-06-30 | v2.7.0 | 流式方法增加 clarifying 模式前置检查 + not is_clarifying_mode 守卫
#   - 2026-07-22 | v2.8.0 | 新增 workflows 表 goal_id 和 goals 列迁移（Goal-oriented task loop）
#   - 2026-07-22 | v2.9.0 | 新增 workflows 表 iteration_context 和 iteration_history 列迁移（智能迭代闭环）
#   - 2026-07-24 | v2.10.0 | Module B：init_db() 中启用 SQLite WAL 模式（PRAGMA journal_mode=WAL），
#             提升并发读写性能；同步设置 PRAGMA synchronous=NORMAL 平衡性能与安全
#   - 2026-07-24 | v2.11.0 | Module F1：新增 PostgreSQL 数据库支持。
#             1) 新增 _get_database_url() 辅助函数：优先读取 DATABASE_URL 环境变量，
#                以 postgresql:// 或 postgresql+asyncpg:// 开头时启用 PostgreSQL
#             2) get_engine() 根据数据库类型返回不同驱动：postgresql → asyncpg，sqlite → aiosqlite
#             3) is_postgres() 暴露当前数据库类型，供上层（如 migration）按需分支
#             4) WAL 模式设置仅在 SQLite 路径下执行（PostgreSQL 不需要）
#             5) 保留向后兼容：未设置 DATABASE_URL 时，行为与 v2.10.0 一致
# ============================================================

import os
import logging
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import inspect, text

from .config import settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    """SQLAlchemy 声明式基类，所有 ORM 模型继承此类"""
    pass


# 数据库引擎与会话工厂（模块级变量，延迟初始化）
_engine = None
_async_session_factory = None


# ============================================================
# 启动时数据迁移辅助函数
# ============================================================

# 需要在旧表中新增 session_id 列的表名
_TABLES_NEED_SESSION_ID = ["agents", "tasks", "conversations"]
# 兼容旧数据用的兜底 Session ID（固定字符串）
LEGACY_DEFAULT_SESSION_ID = "legacy-default"
LEGACY_DEFAULT_SESSION_TITLE = "历史会话（自动迁移）"


def _get_db_path() -> str:
    """
    获取数据库文件路径
    运行步骤：
      1. 获取项目根目录
      2. 拼接数据库文件路径
      3. 确保父目录存在
    返回值：数据库文件的绝对路径字符串
    """
    project_root = settings.get_project_root()
    db_rel_path = settings.database.get("path", "data/platform.db")
    db_path = project_root / db_rel_path
    # 确保 data 目录存在
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return str(db_path)


def _get_database_url() -> str:
    """
    获取数据库连接 URL（v2.11.0 Module F1 新增）
    作用：按优先级决定使用的数据库类型
    优先级：
      1. 读取环境变量 DATABASE_URL
      2. 若以 "postgresql" 开头，使用 PostgreSQL
      3. 否则使用 SQLite 默认路径
    返回值：SQLAlchemy 异步引擎可识别的 URL
      - postgresql+asyncpg://... 用于 PostgreSQL
      - sqlite+aiosqlite:///<path> 用于 SQLite
    """
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if db_url.startswith("postgresql"):
        # 统一转换为 asyncpg 驱动
        if db_url.startswith("postgresql+asyncpg://"):
            return db_url
        # postgresql:// → postgresql+asyncpg://
        # 注意：postgresql+psycopg2 / postgresql+psycopg / postgresql+pg8000 暂不支持
        if db_url.startswith("postgresql://"):
            return "postgresql+asyncpg://" + db_url[len("postgresql://"):]
        # 其他 postgresql+xxx:// 直接返回（要求用户使用支持的驱动）
        return db_url
    # 兜底：SQLite 默认路径
    db_path = _get_db_path()
    return f"sqlite+aiosqlite:///{db_path}"


def is_postgres() -> bool:
    """
    判断当前是否使用 PostgreSQL（v2.11.0 Module F1 新增）
    作用：供上层（如 migration 逻辑、JSON 字段处理）按需分支
    返回值：True 使用 PostgreSQL，False 使用 SQLite
    """
    db_url = _get_database_url()
    return db_url.startswith("postgresql")


def get_engine():
    """
    获取或创建数据库引擎（懒加载单例）
    v2.11.0 Module F1：根据 DATABASE_URL 自动选择驱动
      - postgresql+asyncpg://...  → asyncpg
      - sqlite+aiosqlite:///<path> → aiosqlite（保留 WAL 模式）
    返回值：SQLAlchemy 异步引擎实例
    """
    global _engine
    if _engine is None:
        db_url = _get_database_url()
        if db_url.startswith("postgresql"):
            # PostgreSQL 路径：使用 asyncpg 驱动
            logger.info("检测到 DATABASE_URL 指向 PostgreSQL，使用 asyncpg 驱动")
            _engine = create_async_engine(
                db_url,
                echo=False,
                pool_pre_ping=True,  # 自动检测断连
            )
        else:
            # SQLite 路径：使用 aiosqlite 驱动（保留 v2.10.0 行为）
            _engine = create_async_engine(
                db_url,
                echo=False,
                connect_args={"check_same_thread": False},
            )
    return _engine


def get_session_factory():
    """
    获取或创建会话工厂
    返回值：async_sessionmaker 实例
    """
    global _async_session_factory
    if _async_session_factory is None:
        _async_session_factory = async_sessionmaker(
            get_engine(), class_=AsyncSession, expire_on_commit=False
        )
    return _async_session_factory


async def get_db() -> AsyncSession:
    """
    获取数据库会话（FastAPI 依赖注入用）
    运行步骤：
      1. 创建新的异步会话
      2. yield 给调用方使用
      3. 使用完毕后自动关闭会话
    返回值：AsyncSession 实例（通过 yield）
    """
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """
    初始化数据库表结构 + 启动时数据迁移
    运行步骤：
      1. 获取数据库引擎
      2. 创建所有继承自 Base 的 ORM 模型对应的表
      3. v2.10.0 新增：启用 SQLite WAL 模式（PRAGMA journal_mode=WAL），
         并设置 synchronous=NORMAL 平衡性能与安全
      4. 检查旧表是否缺 session_id 列，缺失则 ALTER TABLE ADD COLUMN
      5. 创建 legacy-default Session 记录
      6. UPDATE 所有 session_id IS NULL 的记录，把 session_id 设为 legacy-default
    异常处理：迁移失败不能阻塞应用启动（仅记录日志）
    注意：仅在应用启动时调用一次
    """
    engine = get_engine()
    # 确保 models.py 已被加载（populate Base.metadata）
    from . import models as _models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # v2.10.0 Module B 新增：启用 SQLite WAL 模式
    # WAL 模式优势：读写并发不互锁，提升多线程/多连接场景性能
    # synchronous=NORMAL 与 WAL 配套使用，比 FULL 性能更好且仍能保证崩溃一致性
    # v2.11.0 Module F1：仅在 SQLite 路径下执行（PostgreSQL 不需要 PRAGMA）
    if not is_postgres():
        try:
            async with engine.begin() as conn:
                await conn.execute(text("PRAGMA journal_mode=WAL"))
                await conn.execute(text("PRAGMA synchronous=NORMAL"))
                # 验证：SELECT 当前 journal_mode
                result = await conn.execute(text("PRAGMA journal_mode"))
                current_mode = result.scalar()
                logger.info(f"SQLite journal_mode 已设置为: {current_mode}")
        except Exception as e:
            logger.error(f"启用 SQLite WAL 模式失败（非阻塞，继续启动）: {e}")
    else:
        logger.info("当前使用 PostgreSQL，跳过 SQLite WAL 模式设置")

    # 启动时数据迁移（不阻塞启动）
    try:
        await _run_legacy_migration(engine)
    except Exception as e:
        logger.error(f"启动数据迁移失败（非阻塞，应用继续启动）: {e}")


async def _run_legacy_migration(engine):
    """
    启动时数据迁移：补齐 session_id 列，并把 NULL session_id 的记录归入 legacy-default Session
    运行步骤：
      1. 通过 inspect 检查每个目标表是否存在
      2. 若表存在但缺 session_id 列，执行 ALTER TABLE ADD COLUMN
      3. 创建 legacy-default Session 记录（固定 ID）
      4. UPDATE 三个目标表中 session_id IS NULL 的记录
    参数：
      - engine: 异步 SQLAlchemy 引擎实例
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker

    # 使用同步 inspector 检查表结构（避免异步连接复杂度）
    # 复用 async engine 底层的 sync_engine，调用 run_sync 避免事件循环冲突
    def _inspect_tables(sync_conn) -> tuple:
        insp = inspect(sync_conn)
        existing = set(insp.get_table_names())
        columns_by_table: dict = {}
        for tbl in _TABLES_NEED_SESSION_ID:
            if tbl in existing:
                columns_by_table[tbl] = {c["name"] for c in insp.get_columns(tbl)}
        # V4.3: 同步检测 sessions 表列结构（用于 deleted_at 迁移）
        if "sessions" in existing:
            columns_by_table["sessions"] = {c["name"] for c in insp.get_columns("sessions")}
        # v2.1.0: 同步检测 workflows 表列结构（用于 repo_name/push_status 迁移）
        if "workflows" in existing:
            columns_by_table["workflows"] = {c["name"] for c in insp.get_columns("workflows")}
        return existing, columns_by_table

    async with engine.begin() as conn:
        existing_tables, columns_by_table = await conn.run_sync(_inspect_tables)

    # 步骤 1+2: 对已存在但缺 session_id 列的表执行 ALTER TABLE
    for tbl, cols in columns_by_table.items():
        if "session_id" not in cols:
            logger.info(f"检测到旧表 {tbl} 缺 session_id 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                # SQLite 支持 ALTER TABLE ADD COLUMN；VARCHAR(36) 与 String(36) 对应
                await conn.execute(text(f'ALTER TABLE {tbl} ADD COLUMN session_id VARCHAR(36)'))
                # 为兼容性创建索引（IF NOT EXISTS 防止重复）
                await conn.execute(
                    text(f'CREATE INDEX IF NOT EXISTS ix_{tbl}_session_id ON {tbl}(session_id)')
                )

    # V4.3 新增：检测 sessions 表是否缺 deleted_at 列
    if "sessions" in columns_by_table and "deleted_at" not in columns_by_table["sessions"]:
        logger.info("检测到 sessions 表缺 deleted_at 列，执行 ALTER TABLE ADD COLUMN")
        async with engine.begin() as conn:
            await conn.execute(text('ALTER TABLE sessions ADD COLUMN deleted_at DATETIME'))

    # V4.3 新增：检测 sessions 表是否缺 mode 列（双模式入口）
    if "sessions" in columns_by_table and "mode" not in columns_by_table["sessions"]:
        logger.info("检测到 sessions 表缺 mode 列，执行 ALTER TABLE ADD COLUMN")
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE sessions ADD COLUMN mode VARCHAR(16) DEFAULT 'chat'"))
        logger.info("sessions.mode 列迁移完成")

    # v2.0.0 新增：检测 sessions 表是否缺 workflow_id 列
    if "sessions" in columns_by_table and "workflow_id" not in columns_by_table["sessions"]:
        logger.info("检测到 sessions 表缺 workflow_id 列，执行 ALTER TABLE ADD COLUMN")
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE sessions ADD COLUMN workflow_id VARCHAR(36)"))
        logger.info("sessions.workflow_id 列迁移完成")

    # v2.0.0 新增：检测 sessions 表是否缺 workflow_stage 列
    if "sessions" in columns_by_table and "workflow_stage" not in columns_by_table["sessions"]:
        logger.info("检测到 sessions 表缺 workflow_stage 列，执行 ALTER TABLE ADD COLUMN")
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE sessions ADD COLUMN workflow_stage VARCHAR(32)"))
        logger.info("sessions.workflow_stage 列迁移完成")

    # v2.1.0 新增：检测 workflows 表是否缺 repo_name 列
    if "workflows" in columns_by_table and "repo_name" not in columns_by_table["workflows"]:
        logger.info("检测到 workflows 表缺 repo_name 列，执行 ALTER TABLE ADD COLUMN")
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE workflows ADD COLUMN repo_name VARCHAR(256) DEFAULT ''"))
        logger.info("workflows.repo_name 列迁移完成")

    # v2.1.0 新增：检测 workflows 表是否缺 push_status 列
    if "workflows" in columns_by_table and "push_status" not in columns_by_table["workflows"]:
        logger.info("检测到 workflows 表缺 push_status 列，执行 ALTER TABLE ADD COLUMN")
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE workflows ADD COLUMN push_status VARCHAR(32) DEFAULT 'pending'"))
        logger.info("workflows.push_status 列迁移完成")

    # ================================================================
    # v2.5.0 新增：workflows 表字段补全迁移
    # 根因：human_confirmed_* / rejection_count / force_human_review /
    #       clarification_* 等字段在 v2.2.0 ~ v2.4.0 逐步新增于 models.py，
    #       但旧数据库文件没有这些列，导致 INSERT 时报 "no such column" 错误
    # ================================================================
    if "workflows" in columns_by_table:
        _workflow_cols = columns_by_table["workflows"]

        # 布尔类型列：human_confirmed_requirement / human_confirmed_architecture /
        # human_confirmed_review / critique_passed / prompts_optimized / force_human_review
        _bool_cols = [
            ("human_confirmed_requirement", "需求确认标记"),
            ("human_confirmed_architecture", "架构确认标记"),
            ("human_confirmed_review", "评审确认标记"),
            ("critique_passed", "批判迭代通过标记"),
            ("prompts_optimized", "提示词已优化标记"),
            ("force_human_review", "强制人工审核标记"),
        ]
        for col_name, col_desc in _bool_cols:
            if col_name not in _workflow_cols:
                logger.info(f"检测到 workflows 表缺 {col_name} 列（{col_desc}），执行 ALTER TABLE ADD COLUMN")
                async with engine.begin() as conn:
                    await conn.execute(text(f"ALTER TABLE workflows ADD COLUMN {col_name} BOOLEAN DEFAULT 0"))
                logger.info(f"workflows.{col_name} 列迁移完成")

        # rejection_count 列（INTEGER）
        if "rejection_count" not in _workflow_cols:
            logger.info("检测到 workflows 表缺 rejection_count 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE workflows ADD COLUMN rejection_count INTEGER DEFAULT 0"))
            logger.info("workflows.rejection_count 列迁移完成")

        # clarification_questions 列（JSON）
        if "clarification_questions" not in _workflow_cols:
            logger.info("检测到 workflows 表缺 clarification_questions 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE workflows ADD COLUMN clarification_questions JSON DEFAULT '[]'"))
            logger.info("workflows.clarification_questions 列迁移完成")

        # clarification_round 列（INTEGER）
        if "clarification_round" not in _workflow_cols:
            logger.info("检测到 workflows 表缺 clarification_round 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE workflows ADD COLUMN clarification_round INTEGER DEFAULT 0"))
            logger.info("workflows.clarification_round 列迁移完成")

        # clarification_complete 列（BOOLEAN）
        if "clarification_complete" not in _workflow_cols:
            logger.info("检测到 workflows 表缺 clarification_complete 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE workflows ADD COLUMN clarification_complete BOOLEAN DEFAULT 0"))
            logger.info("workflows.clarification_complete 列迁移完成")

        # requirement_doc_v2 列（TEXT, v2.5.0 新增）
        if "requirement_doc_v2" not in _workflow_cols:
            logger.info("检测到 workflows 表缺 requirement_doc_v2 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE workflows ADD COLUMN requirement_doc_v2 TEXT DEFAULT ''"))
            logger.info("workflows.requirement_doc_v2 列迁移完成")

        # v2.8.0 新增：goal_id 列（VARCHAR(36), Goal-oriented task loop）
        if "goal_id" not in _workflow_cols:
            logger.info("检测到 workflows 表缺 goal_id 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE workflows ADD COLUMN goal_id VARCHAR(36)"))
            logger.info("workflows.goal_id 列迁移完成")

        # v2.8.0 新增：goals 列（JSON, Goal-oriented task loop）
        if "goals" not in _workflow_cols:
            logger.info("检测到 workflows 表缺 goals 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE workflows ADD COLUMN goals JSON"))
            logger.info("workflows.goals 列迁移完成")

        # v2.9.0 新增：iteration_context 列（TEXT, 智能迭代闭环缺陷上下文）
        if "iteration_context" not in _workflow_cols:
            logger.info("检测到 workflows 表缺 iteration_context 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE workflows ADD COLUMN iteration_context TEXT DEFAULT ''"))
            logger.info("workflows.iteration_context 列迁移完成")

        # v2.9.0 新增：iteration_history 列（TEXT, 智能迭代闭环历史记录）
        if "iteration_history" not in _workflow_cols:
            logger.info("检测到 workflows 表缺 iteration_history 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE workflows ADD COLUMN iteration_history TEXT DEFAULT ''"))
            logger.info("workflows.iteration_history 列迁移完成")

        # v6.3.0 (P0-4) 新增：plan_confirmed 列（BOOLEAN, Plan 模式确认标记）
        if "plan_confirmed" not in _workflow_cols:
            logger.info("检测到 workflows 表缺 plan_confirmed 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE workflows ADD COLUMN plan_confirmed BOOLEAN DEFAULT 0"))
            logger.info("workflows.plan_confirmed 列迁移完成")

        # v6.3.0 (P0-4) 新增：plan_data 列（TEXT, Plan 模式 JSON 数据）
        if "plan_data" not in _workflow_cols:
            logger.info("检测到 workflows 表缺 plan_data 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE workflows ADD COLUMN plan_data TEXT DEFAULT ''"))
            logger.info("workflows.plan_data 列迁移完成")

    # v6.13.0 Cycle 2 新增：conversations 表压缩追踪字段
    if "conversations" in columns_by_table:
        _conv_cols = columns_by_table["conversations"]
        # is_compacted 列（BOOLEAN）
        if "is_compacted" not in _conv_cols:
            logger.info("检测到 conversations 表缺 is_compacted 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE conversations ADD COLUMN is_compacted BOOLEAN DEFAULT 0"))
            logger.info("conversations.is_compacted 列迁移完成")
        # compacted_at 列（DATETIME）
        if "compacted_at" not in _conv_cols:
            logger.info("检测到 conversations 表缺 compacted_at 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE conversations ADD COLUMN compacted_at DATETIME"))
            logger.info("conversations.compacted_at 列迁移完成")
        # compacted_into 列（VARCHAR(36)）
        if "compacted_into" not in _conv_cols:
            logger.info("检测到 conversations 表缺 compacted_into 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE conversations ADD COLUMN compacted_into VARCHAR(36)"))
            logger.info("conversations.compacted_into 列迁移完成")

    # v6.13.0 Cycle 2 T3 新增：sessions 表 fork/resume 字段
    if "sessions" in columns_by_table:
        _session_cols = columns_by_table["sessions"]
        # parent_session_id 列（VARCHAR(36)）
        if "parent_session_id" not in _session_cols:
            logger.info("检测到 sessions 表缺 parent_session_id 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE sessions ADD COLUMN parent_session_id VARCHAR(36)"))
                await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_sessions_parent_session_id ON sessions(parent_session_id)"))
            logger.info("sessions.parent_session_id 列迁移完成")
        # forked_at 列（DATETIME）
        if "forked_at" not in _session_cols:
            logger.info("检测到 sessions 表缺 forked_at 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE sessions ADD COLUMN forked_at DATETIME"))
            logger.info("sessions.forked_at 列迁移完成")
        # fork_point_message_id 列（VARCHAR(36)）
        if "fork_point_message_id" not in _session_cols:
            logger.info("检测到 sessions 表缺 fork_point_message_id 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE sessions ADD COLUMN fork_point_message_id VARCHAR(36)"))
            logger.info("sessions.fork_point_message_id 列迁移完成")
        # is_archived 列（BOOLEAN）
        if "is_archived" not in _session_cols:
            logger.info("检测到 sessions 表缺 is_archived 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE sessions ADD COLUMN is_archived BOOLEAN DEFAULT 0"))
            logger.info("sessions.is_archived 列迁移完成")
        # device_id 列（VARCHAR(128)）
        if "device_id" not in _session_cols:
            logger.info("检测到 sessions 表缺 device_id 列，执行 ALTER TABLE ADD COLUMN")
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE sessions ADD COLUMN device_id VARCHAR(128)"))
            logger.info("sessions.device_id 列迁移完成")

    # 步骤 3: 创建 legacy-default Session 记录
    try:
        from .models import Session as SessionModel  # 延迟导入避免循环
    except Exception as import_err:
        logger.warning(f"无法导入 Session 模型，跳过 legacy-default 记录创建: {import_err}")
        return

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        # 使用 INSERT ... ON CONFLICT DO NOTHING 风格的 SQL，兼容 SQLite / PostgreSQL
        # 先查询是否已存在
        result = await session.execute(
            text("SELECT id FROM sessions WHERE id = :id"),
            {"id": LEGACY_DEFAULT_SESSION_ID},
        )
        exists = result.first() is not None
        if not exists:
            # 状态列存的是 SAEnum 的 name（大写），与现有 AgentStatus/TaskStatus 行为一致
            await session.execute(
                text(
                    """
                    INSERT INTO sessions (id, title, created_at, last_active_at, user_first_message, message_count, status, mode)
                    VALUES (:id, :title, :ts, :ts, :msg, :mc, :status, :mode)
                    """
                ),
                {
                    "id": LEGACY_DEFAULT_SESSION_ID,
                    "title": LEGACY_DEFAULT_SESSION_TITLE,
                    "ts": datetime.now(timezone.utc),
                    "msg": "",
                    "mc": 0,
                    "status": "ACTIVE",  # SessionStatus.ACTIVE.name
                    "mode": "chat",
                },
            )
            await session.commit()
            logger.info(f"已创建 legacy-default Session: {LEGACY_DEFAULT_SESSION_ID}")

        # 步骤 4: UPDATE 三个目标表中 session_id IS NULL 的记录
        for tbl in _TABLES_NEED_SESSION_ID:
            if tbl not in existing_tables:
                continue
            # 先确认表是否有 session_id 列（前面已 ALTER）
            upd_result = await session.execute(
                text(f"UPDATE {tbl} SET session_id = :sid WHERE session_id IS NULL OR session_id = ''"),
                {"sid": LEGACY_DEFAULT_SESSION_ID},
            )
            if upd_result.rowcount and upd_result.rowcount > 0:
                logger.info(
                    f"已将 {tbl} 表中 {upd_result.rowcount} 条 session_id 为空的记录归入 legacy-default"
                )
        await session.commit()
