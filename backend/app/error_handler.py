"""
# ============================================================
# 全局错误处理与日志模块
# ============================================================
# 核心作用：提供全局异常捕获、日志记录、API 调用重试、
#           子实例崩溃检测与任务迁移、系统重启状态恢复
# 运行流程：
#   1. 注册全局异常处理器
#   2. 配置日志格式和输出
#   3. 提供重试装饰器
#   4. 提供崩溃检测和恢复逻辑
# 输入参数：异常对象、日志消息
# 输出结果：日志文件、异常响应
# ============================================================
"""

import asyncio
import functools
import logging
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Any, Optional, TypeVar

from fastapi import Request
from fastapi.responses import JSONResponse

from .config import settings

# 类型变量
F = TypeVar("F", bound=Callable[..., Any])


def setup_logging():
    """
    配置全局日志系统
    运行步骤：
      1. 读取日志配置
      2. 创建日志目录
      3. 配置控制台和文件处理器
      4. 设置日志级别和格式
    """
    log_config = settings.logging_config
    log_dir = Path(settings.get_project_root()) / log_config.get("dir", "logs")
    log_dir.mkdir(parents=True, exist_ok=True)

    log_level = getattr(logging, log_config.get("level", "INFO"))

    # 根日志器配置
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # 清除已有处理器
    root_logger.handlers.clear()

    # 控制台处理器
    console_handler = logging.StreamHandler()
    console_handler.setLevel(log_level)
    console_format = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    console_handler.setFormatter(console_format)
    root_logger.addHandler(console_handler)

    # 文件处理器
    log_file = log_dir / f"platform_{datetime.now().strftime('%Y%m%d')}.log"
    file_handler = logging.FileHandler(str(log_file), encoding="utf-8")
    file_handler.setLevel(log_level)
    file_handler.setFormatter(console_format)
    root_logger.addHandler(file_handler)

    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

    return root_logger


def retry_on_failure(
    max_retries: int = 3,
    base_delay: float = 2.0,
    exceptions: tuple = (Exception,),
):
    """
    异步重试装饰器
    作用：对可能失败的异步函数进行自动重试
    运行步骤：
      1. 执行被装饰函数
      2. 捕获指定异常
      3. 指数递增延迟后重试
      4. 超过最大重试次数后抛出异常
    参数：
      - max_retries: 最大重试次数
      - base_delay: 基础延迟（秒），指数递增
      - exceptions: 需要重试的异常类型元组
    返回值：装饰后的函数
    """
    def decorator(func: F) -> F:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(1, max_retries + 1):
                try:
                    return await func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    logger = logging.getLogger(func.__module__)
                    logger.warning(
                        f"{func.__name__} 执行失败 (第 {attempt}/{max_retries} 次): {e}"
                    )
                    if attempt < max_retries:
                        delay = base_delay ** attempt
                        logger.info(f"等待 {delay:.1f}s 后重试...")
                        await asyncio.sleep(delay)
            raise last_exception  # type: ignore
        return wrapper  # type: ignore
    return decorator


async def global_exception_handler(request: Request, exc: Exception):
    """
    全局异常处理器（FastAPI 中间件用）
    作用：捕获所有未处理的异常，返回统一格式的错误响应
    运行步骤：
      1. 记录异常日志和堆栈
      2. 构建 JSON 错误响应
      3. 返回 500 状态码
    参数：
      - request: FastAPI 请求对象
      - exc: 捕获的异常
    返回值：JSONResponse
    """
    logger = logging.getLogger(__name__)
    logger.error(
        f"未处理的异常: {type(exc).__name__}: {exc}\n"
        f"请求路径: {request.url.path}\n"
        f"堆栈跟踪:\n{traceback.format_exc()}"
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": "internal_server_error",
            "message": str(exc),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


class TaskRecoveryManager:
    """
    任务恢复管理器
    作用：系统重启后恢复未完成任务的执行状态
    调用方：应用启动事件
    被调用方：数据库
    """

    def __init__(self):
        self.logger = logging.getLogger(__name__)

    async def recover_pending_tasks(self, db_session):
        """
        恢复未完成的任务
        运行步骤：
          1. 查询状态为 RUNNING 或 VALIDATING 的任务
          2. 将这些任务重置为 PENDING 状态
          3. 记录恢复日志
        参数：
          - db_session: 数据库会话
        """
        from .models import Task, TaskStatus

        # 查询中断的任务
        from sqlalchemy import select

        result = await db_session.execute(
            select(Task).where(
                Task.status.in_([TaskStatus.RUNNING, TaskStatus.VALIDATING])
            )
        )
        interrupted_tasks = result.scalars().all()

        if interrupted_tasks:
            self.logger.info(f"发现 {len(interrupted_tasks)} 个中断的任务，正在恢复...")
            for task in interrupted_tasks:
                task.status = TaskStatus.PENDING
                task.error_message = "系统重启，任务已恢复为等待状态"
                self.logger.info(f"任务已恢复: {task.title} (ID: {task.id[:8]}...)")
            await db_session.commit()
        else:
            self.logger.info("没有需要恢复的中断任务")


# 初始化日志
logger = setup_logging()
