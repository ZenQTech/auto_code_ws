"""
# ============================================================
# Batch Spawner 服务 (v1.0.0)
# Cycle 65 G65-02
# ============================================================
# 核心作用：批量 spawn Agent 实例，支持 CSV 输入、并发控制、进度跟踪
# 运行流程：
#   1. 接收 CSV 文本
#   2. CSVTaskParser 解析 + 校验
#   3. 创建 BatchJob
#   4. asyncio.Semaphore 控制并发，逐个 spawn
#   5. 跟踪每个 instance 状态
#   6. 汇总结果（accepted/rejected/completed/failed）
# 设计要点：
#   - 失败隔离：单行失败不影响其他行
#   - 进度实时更新
#   - 支持取消（cancelled 状态）
#   - 结果可导出（JSON/CSV/MD）
#   - 集成 AgentRoleManager + AgentRunner
# 输入参数：CSV 文本、角色、并发度
# 输出结果：BatchJob（含 instance 列表）
# 对标：Codex CLI v0.133 batch_spawn_agents
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 65 G65-02 初次创建
# ====================================
"""

import asyncio
import csv
import io
import json
import logging
import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from io import StringIO
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from .agent_role_manager import (
    AgentRoleManager,
    AgentInstanceNotFoundError,
    ConcurrencyLimitError,
    RoleNotFoundError,
    get_agent_role_manager,
)
from .agent_role_models import AgentInstance, AgentRole, HookEventType
from .agent_runner import AgentRunner, get_agent_runner
from .hook_event_bus import HookEventBus, get_hook_bus

logger = logging.getLogger(__name__)


# ============================================================
# 常量与配置
# ============================================================


# CSV 大小限制：1MB
MAX_CSV_BYTES = 1024 * 1024
# 单批最大行数
MAX_BATCH_ROWS = 1000
# 最大并发度
MAX_CONCURRENCY = 50
# 默认并发度
DEFAULT_CONCURRENCY = 5


# ============================================================
# 状态枚举
# ============================================================


class BatchStatus(str, Enum):
    """批量任务状态"""

    PENDING = "pending"          # 解析完成，等待执行
    RUNNING = "running"          # 执行中
    COMPLETED = "completed"      # 全部完成（含部分失败）
    CANCELLED = "cancelled"      # 用户取消
    FAILED = "failed"            # 全部失败（解析阶段）


# ============================================================
# 数据结构
# ============================================================


@dataclass
class BatchError:
    """单行错误记录"""

    row_index: int          # CSV 行号（1-based，跳过表头）
    field: str              # 错误字段
    message: str            # 错误信息
    raw: str = ""           # 原始行内容

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class BatchInstance:
    """批量任务中的单个实例记录"""

    agent_id: str
    row_index: int
    task: str
    nickname: Optional[str] = None
    role: str = "default"
    model: Optional[str] = None
    context: Dict[str, Any] = field(default_factory=dict)
    status: str = "pending"  # pending/spawning/running/idle/failed/cancelled
    error: Optional[str] = None
    started_at: float = 0.0
    finished_at: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class BatchJob:
    """批量任务"""

    batch_id: str
    total: int = 0
    accepted: int = 0
    rejected: int = 0
    in_progress: int = 0
    completed: int = 0
    failed: int = 0
    progress: float = 0.0
    status: str = BatchStatus.PENDING.value
    max_concurrency: int = DEFAULT_CONCURRENCY
    default_role: Optional[str] = None
    default_model: Optional[str] = None
    started_at: float = 0.0
    finished_at: Optional[float] = None
    instances: Dict[str, BatchInstance] = field(default_factory=dict)
    errors: List[BatchError] = field(default_factory=list)
    # asyncio 任务引用
    _task: Optional[asyncio.Task] = field(default=None, repr=False, compare=False)
    # 取消事件
    _cancel_event: Optional[asyncio.Event] = field(default=None, repr=False, compare=False)

    def to_dict(self) -> Dict[str, Any]:
        d = {
            "batch_id": self.batch_id,
            "total": self.total,
            "accepted": self.accepted,
            "rejected": self.rejected,
            "in_progress": self.in_progress,
            "completed": self.completed,
            "failed": self.failed,
            "progress": self.progress,
            "status": self.status,
            "max_concurrency": self.max_concurrency,
            "default_role": self.default_role,
            "default_model": self.default_model,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }
        # 转换 instance 字典
        d["instances"] = {
            aid: inst.to_dict() for aid, inst in self.instances.items()
        }
        d["errors"] = [e.to_dict() for e in self.errors]
        return d

    def update_progress(self) -> None:
        """更新进度（基于 completed + failed）"""
        done = self.completed + self.failed
        if self.total > 0:
            self.progress = done / self.total
        else:
            self.progress = 0.0


# ============================================================
# CSV 解析器
# ============================================================


class CSVTaskParser:
    """
    CSV 任务解析器
    - 遵循 RFC 4180（引号、转义、换行）
    - 必填字段校验
    - 长度限制
    - 收集所有错误（不中断）
    """

    # 必填列
    REQUIRED_COLUMNS = ["task"]
    # 可选列
    OPTIONAL_COLUMNS = [
        "nickname",
        "role",
        "model",
        "context",
        "model_reasoning_effort",  # Cycle 66 G66-01 新增
    ]
    # 字段长度限制
    MAX_TASK_LEN = 4096
    MAX_NICKNAME_LEN = 64
    MAX_ROLE_LEN = 64
    MAX_MODEL_LEN = 128
    MAX_CONTEXT_LEN = 4096
    MAX_EFFORT_LEN = 16

    def __init__(self, max_rows: int = MAX_BATCH_ROWS):
        self.max_rows = max_rows
        self._rows: List[Dict[str, Any]] = []
        self._errors: List[BatchError] = []

    def parse(self, csv_content: str) -> Tuple[List[Dict[str, Any]], List[BatchError]]:
        """
        解析 CSV 内容
        返回 (rows, errors)
        """
        self._rows = []
        self._errors = []

        # 1. 大小检查
        if len(csv_content.encode("utf-8")) > MAX_CSV_BYTES:
            self._errors.append(
                BatchError(
                    row_index=0,
                    field="csv",
                    message=f"CSV 超过 {MAX_CSV_BYTES} 字节限制",
                )
            )
            return self._rows, self._errors

        # 2. 解析
        try:
            reader = csv.DictReader(StringIO(csv_content))
        except Exception as e:  # noqa: BLE001
            self._errors.append(
                BatchError(
                    row_index=0,
                    field="csv",
                    message=f"CSV 格式错误: {e}",
                )
            )
            return self._rows, self._errors

        # 3. 校验表头
        if not reader.fieldnames:
            self._errors.append(
                BatchError(
                    row_index=0,
                    field="csv",
                    message="CSV 缺少表头",
                )
            )
            return self._rows, self._errors

        for col in self.REQUIRED_COLUMNS:
            if col not in reader.fieldnames:
                self._errors.append(
                    BatchError(
                        row_index=0,
                        field=col,
                        message=f"缺少必填列: {col}",
                    )
                )
                return self._rows, self._errors

        # 4. 逐行解析
        for row_index, row in enumerate(reader, start=1):  # 1-based 跳过表头
            if row_index > self.max_rows:
                self._errors.append(
                    BatchError(
                        row_index=row_index,
                        field="csv",
                        message=f"超过最大行数 {self.max_rows}",
                    )
                )
                break

            validated = self._validate_row(row, row_index)
            if validated is not None:
                self._rows.append(validated)

        return self._rows, self._errors

    def _validate_row(
        self, row: Dict[str, str], row_index: int
    ) -> Optional[Dict[str, Any]]:
        """
        校验单行
        返回规范化后的 dict；校验失败返回 None（错误已记录）
        """
        raw = ",".join(f"{k}={v}" for k, v in row.items())[:200]

        # task 必填
        task = (row.get("task") or "").strip()
        if not task:
            self._errors.append(
                BatchError(
                    row_index=row_index,
                    field="task",
                    message="task 不能为空",
                    raw=raw,
                )
            )
            return None
        if len(task) > self.MAX_TASK_LEN:
            self._errors.append(
                BatchError(
                    row_index=row_index,
                    field="task",
                    message=f"task 长度 {len(task)} 超过 {self.MAX_TASK_LEN}",
                    raw=raw,
                )
            )
            return None

        # nickname 可选
        nickname = (row.get("nickname") or "").strip() or None
        if nickname and len(nickname) > self.MAX_NICKNAME_LEN:
            self._errors.append(
                BatchError(
                    row_index=row_index,
                    field="nickname",
                    message=f"nickname 长度 {len(nickname)} 超过 {self.MAX_NICKNAME_LEN}",
                    raw=raw,
                )
            )
            return None

        # role 可选（默认 default）
        role = (row.get("role") or "").strip() or "default"
        if len(role) > self.MAX_ROLE_LEN:
            self._errors.append(
                BatchError(
                    row_index=row_index,
                    field="role",
                    message=f"role 长度 {len(role)} 超过 {self.MAX_ROLE_LEN}",
                    raw=raw,
                )
            )
            return None

        # model 可选
        model = (row.get("model") or "").strip() or None
        if model and len(model) > self.MAX_MODEL_LEN:
            self._errors.append(
                BatchError(
                    row_index=row_index,
                    field="model",
                    message=f"model 长度 {len(model)} 超过 {self.MAX_MODEL_LEN}",
                    raw=raw,
                )
            )
            return None

        # context 可选（JSON 字符串）
        context_str = (row.get("context") or "").strip()
        context: Dict[str, Any] = {}
        if context_str:
            if len(context_str) > self.MAX_CONTEXT_LEN:
                self._errors.append(
                    BatchError(
                        row_index=row_index,
                        field="context",
                        message=f"context 长度 {len(context_str)} 超过 {self.MAX_CONTEXT_LEN}",
                        raw=raw,
                    )
                )
                return None
            try:
                parsed = json.loads(context_str)
                if not isinstance(parsed, dict):
                    self._errors.append(
                        BatchError(
                            row_index=row_index,
                            field="context",
                            message="context 必须是 JSON 对象",
                            raw=raw,
                        )
                    )
                    return None
                context = parsed
            except json.JSONDecodeError as e:
                self._errors.append(
                    BatchError(
                        row_index=row_index,
                        field="context",
                        message=f"context JSON 解析失败: {e}",
                        raw=raw,
                    )
                )
                return None

        # model_reasoning_effort 可选（Cycle 66 G66-01 新增）
        reasoning_effort_str = (row.get("model_reasoning_effort") or "").strip() or None
        if reasoning_effort_str and len(reasoning_effort_str) > self.MAX_EFFORT_LEN:
            self._errors.append(
                BatchError(
                    row_index=row_index,
                    field="model_reasoning_effort",
                    message=(
                        f"model_reasoning_effort 长度 {len(reasoning_effort_str)} "
                        f"超过 {self.MAX_EFFORT_LEN}"
                    ),
                    raw=raw,
                )
            )
            return None
        # 验证 effort 合法性
        if reasoning_effort_str and reasoning_effort_str not in ("low", "medium", "high"):
            self._errors.append(
                BatchError(
                    row_index=row_index,
                    field="model_reasoning_effort",
                    message=(
                        f"model_reasoning_effort 必须是 low/medium/high 之一，"
                        f"实际: {reasoning_effort_str}"
                    ),
                    raw=raw,
                )
            )
            return None

        return {
            "task": task,
            "nickname": nickname,
            "role": role,
            "model": model,
            "context": context,
            "model_reasoning_effort": reasoning_effort_str,
        }


# ============================================================
# 批量 Spawn 服务
# ============================================================


class BatchSpawner:
    """
    批量 spawn 服务
    - 创建/管理 BatchJob
    - 并发 spawn instances
    - 跟踪进度
    - 失败隔离
    """

    def __init__(
        self,
        role_manager: Optional[AgentRoleManager] = None,
        runner: Optional[AgentRunner] = None,
        hook_bus: Optional[HookEventBus] = None,
    ):
        self._role_manager = role_manager or get_agent_role_manager()
        self._runner = runner or get_agent_runner()
        self._hook_bus = hook_bus or get_hook_bus()
        # batch_id -> BatchJob
        self._jobs: Dict[str, BatchJob] = {}

    # ============================================================
    # 公共 API
    # ============================================================

    async def spawn_batch(
        self,
        csv_content: str,
        default_role: Optional[str] = None,
        default_model: Optional[str] = None,
        max_concurrency: int = DEFAULT_CONCURRENCY,
        progress_callback: Optional[Callable[[BatchJob], None]] = None,
    ) -> BatchJob:
        """
        提交批量任务
        返回 BatchJob（含 batch_id）
        """
        # 1. 校验并发度
        if max_concurrency < 1 or max_concurrency > MAX_CONCURRENCY:
            raise ValueError(
                f"max_concurrency 必须在 1-{MAX_CONCURRENCY} 之间，实际: {max_concurrency}"
            )

        # 2. 解析 CSV
        parser = CSVTaskParser()
        rows, errors = parser.parse(csv_content)

        # 3. 创建 BatchJob
        job = BatchJob(
            batch_id=f"batch-{uuid.uuid4().hex[:12]}",
            total=len(rows) + len(errors),
            accepted=len(rows),
            rejected=len(errors),
            max_concurrency=max_concurrency,
            default_role=default_role,
            default_model=default_model,
            started_at=time.time(),
            errors=errors,
        )

        # 4. 校验角色
        if default_role:
            try:
                self._role_manager.get_role(default_role)
            except RoleNotFoundError:
                job.status = BatchStatus.FAILED.value
                job.errors.append(
                    BatchError(
                        row_index=0,
                        field="default_role",
                        message=f"默认角色不存在: {default_role}",
                    )
                )
                self._jobs[job.batch_id] = job
                return job

        # 5. 注册 job
        self._jobs[job.batch_id] = job
        job._cancel_event = asyncio.Event()

        # 6. 启动后台任务
        if rows:
            job.status = BatchStatus.RUNNING.value
            job._task = asyncio.create_task(
                self._execute_batch(job, rows, progress_callback)
            )
        else:
            # 没有接受的行，直接标记完成
            job.status = BatchStatus.COMPLETED.value
            job.finished_at = time.time()

        return job

    def get_job(self, batch_id: str) -> Optional[BatchJob]:
        """获取 BatchJob"""
        return self._jobs.get(batch_id)

    def list_jobs(self) -> List[BatchJob]:
        """列出所有 BatchJob"""
        return list(self._jobs.values())

    async def cancel_batch(self, batch_id: str) -> Tuple[bool, int]:
        """
        取消批量任务
        返回 (success, cancelled_count)
        """
        job = self._jobs.get(batch_id)
        if job is None:
            return False, 0
        if job.status in (BatchStatus.COMPLETED.value, BatchStatus.CANCELLED.value, BatchStatus.FAILED.value):
            return False, 0

        # 设置取消事件
        if job._cancel_event:
            job._cancel_event.set()

        # 取消所有进行中的 instance
        cancelled_count = 0
        for inst in job.instances.values():
            if inst.status in ("spawning", "running", "tool_calling", "output_streaming"):
                try:
                    await self._runner.cancel(inst.agent_id, "batch cancelled")
                    inst.status = "cancelled"
                    inst.finished_at = time.time()
                    cancelled_count += 1
                except Exception:  # noqa: BLE001
                    pass

        job.status = BatchStatus.CANCELLED.value
        job.finished_at = time.time()
        return True, cancelled_count

    # ============================================================
    # 内部实现
    # ============================================================

    async def _execute_batch(
        self,
        job: BatchJob,
        rows: List[Dict[str, Any]],
        progress_callback: Optional[Callable[[BatchJob], None]],
    ) -> None:
        """
        执行批量任务
        使用 asyncio.Semaphore 控制并发
        """
        semaphore = asyncio.Semaphore(job.max_concurrency)

        async def spawn_one(row: Dict[str, Any], row_index: int) -> None:
            """spawn 单个 instance，并等待其完成"""
            async with semaphore:
                if job._cancel_event and job._cancel_event.is_set():
                    return
                try:
                    inst = await self._spawn_single(job, row, row_index)
                    if inst is None:
                        # spawn 失败，已经记录
                        return
                    # 等待 instance 实际完成（runner 任务结束）
                    await self._wait_for_instance(inst, job)
                except Exception as e:  # noqa: BLE001
                    logger.exception(f"批量 spawn 失败 row={row_index}: {e}")
                    inst = job.instances.get(str(row_index))
                    if inst is None:
                        inst = BatchInstance(
                            agent_id=f"agent-{uuid.uuid4().hex[:12]}",
                            row_index=row_index,
                            task=row.get("task", ""),
                            role=row.get("role", job.default_role or "default"),
                        )
                        job.instances[inst.agent_id] = inst
                    inst.status = "failed"
                    inst.error = f"spawn exception: {e}"
                    inst.finished_at = time.time()
                    job.failed += 1
                finally:
                    job.update_progress()
                    if progress_callback:
                        try:
                            progress_callback(job)
                        except Exception:  # noqa: BLE001
                            pass

        # 并发执行所有 spawn
        tasks = [spawn_one(row, i + 1) for i, row in enumerate(rows)]
        await asyncio.gather(*tasks, return_exceptions=True)

        # 标记完成 / 取消
        if job._cancel_event and job._cancel_event.is_set():
            job.status = BatchStatus.CANCELLED.value
        else:
            job.status = BatchStatus.COMPLETED.value
        job.finished_at = time.time()
        if progress_callback:
            try:
                progress_callback(job)
            except Exception:  # noqa: BLE001
                pass

    async def _wait_for_instance(
        self, inst: BatchInstance, job: BatchJob
    ) -> None:
        """
        等待 instance 实际完成
        通过轮询 instance.status 直到完成（status in completed/failed/cancelled/idle）
        """
        timeout_s = 600  # 10 分钟硬上限
        start = time.time()
        # 终态集合
        terminal = {"completed", "failed", "cancelled", "dead", "idle"}
        while True:
            # 1. 检查 instance.status
            cur = inst.status
            if cur in terminal:
                return
            # 2. 检查取消事件
            if job._cancel_event and job._cancel_event.is_set():
                return
            # 3. 超时保护
            if time.time() - start > timeout_s:
                inst.status = "failed"
                inst.error = "instance wait timeout"
                inst.finished_at = time.time()
                job.failed += 1
                job.in_progress = max(0, job.in_progress - 1)
                return
            await asyncio.sleep(0.05)

    async def _spawn_single(
        self, job: BatchJob, row: Dict[str, Any], row_index: int
    ) -> Optional[BatchInstance]:
        """
        spawn 单个 instance 并启动执行
        返回 BatchInstance（如果成功启动）或 None（如果失败）
        """
        # 1. 角色选择
        role_name = row.get("role") or job.default_role or "default"
        try:
            role = self._role_manager.get_role(role_name)
        except RoleNotFoundError:
            # 角色不存在，记录错误
            inst = BatchInstance(
                agent_id=f"agent-{uuid.uuid4().hex[:12]}",
                row_index=row_index,
                task=row["task"],
                nickname=row.get("nickname"),
                role=role_name,
                model=row.get("model") or job.default_model,
                context=row.get("context", {}),
                status="failed",
                error=f"Role not found: {role_name}",
                started_at=time.time(),
                finished_at=time.time(),
            )
            job.instances[inst.agent_id] = inst
            job.rejected += 1
            job.failed += 1
            return

        # 2. 应用 model 覆盖
        model = row.get("model") or job.default_model
        if model and not role.model:
            # 复制 role 并覆盖 model
            role_data = role.model_dump()
            role_data["model"] = model
            role = AgentRole(**role_data)

        # 3. spawn instance
        try:
            instance = self._role_manager.spawn_instance(
                role_name=role.name,
                task=row["task"],
                nickname=row.get("nickname"),
            )
        except (ConcurrencyLimitError, RoleNotFoundError) as e:
            inst = BatchInstance(
                agent_id=f"agent-{uuid.uuid4().hex[:12]}",
                row_index=row_index,
                task=row["task"],
                nickname=row.get("nickname"),
                role=role_name,
                model=model,
                context=row.get("context", {}),
                status="failed",
                error=f"Spawn failed: {e}",
                started_at=time.time(),
                finished_at=time.time(),
            )
            job.instances[inst.agent_id] = inst
            job.failed += 1
            return

        # 3.5 应用 reasoning effort（Cycle 66 G66-01）
        row_effort = row.get("model_reasoning_effort")
        if row_effort:
            try:
                from .reasoning_effort import get_reasoning_controller

                controller = get_reasoning_controller()
                controller.set_effort(
                    agent_id=instance.agent_id,
                    effort=row_effort,
                    source="csv",
                )
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    f"设置 reasoning effort 失败: agent_id={instance.agent_id}, "
                    f"effort={row_effort}, error={e}"
                )

        # 4. 记录 instance
        inst = BatchInstance(
            agent_id=instance.agent_id,
            row_index=row_index,
            task=row["task"],
            nickname=row.get("nickname"),
            role=role.name,
            model=model,
            context=row.get("context", {}),
            status=instance.status,
            started_at=instance.started_at,
        )
        job.instances[inst.agent_id] = inst
        job.in_progress += 1

        # 5. 订阅事件以跟踪进度
        async def on_event(event):
            ev_type = event.event_type
            if ev_type == HookEventType.SUBAGENT_STOP:
                # 任务正常完成
                inst.status = instance.status
                inst.finished_at = time.time()
                if instance.status in ("idle",):
                    job.completed += 1
                else:
                    job.failed += 1
                job.in_progress = max(0, job.in_progress - 1)
                job.update_progress()
            elif ev_type == HookEventType.ERROR:
                # 错误
                inst.status = "failed"
                inst.error = event.data.get("error", "unknown")
                inst.finished_at = time.time()
                instance.status = "failed"
                instance.error = inst.error
                job.failed += 1
                job.in_progress = max(0, job.in_progress - 1)
                job.update_progress()
            elif ev_type == HookEventType.CANCELLED:
                inst.status = "cancelled"
                inst.finished_at = time.time()
                instance.status = "cancelled"
                job.in_progress = max(0, job.in_progress - 1)
                job.update_progress()

        # 6. 启动 runner
        await self._runner.start(instance, role)
        # 订阅事件
        self._hook_bus.subscribe(instance.agent_id, on_event)
        return inst

    # ============================================================
    # 导出
    # ============================================================

    def export_batch(self, batch_id: str, fmt: str = "json") -> str:
        """
        导出 batch 结果
        fmt: json / csv / md
        """
        job = self._jobs.get(batch_id)
        if job is None:
            raise KeyError(f"Batch not found: {batch_id}")

        if fmt == "json":
            return json.dumps(job.to_dict(), ensure_ascii=False, indent=2)
        elif fmt == "csv":
            return self._export_csv(job)
        elif fmt == "md":
            return self._export_markdown(job)
        else:
            raise ValueError(f"Unsupported format: {fmt}")

    def _export_csv(self, job: BatchJob) -> str:
        """导出为 CSV 格式"""
        buf = StringIO()
        writer = csv.writer(buf)
        # 表头
        writer.writerow(
            [
                "agent_id",
                "row_index",
                "task",
                "nickname",
                "role",
                "model",
                "status",
                "error",
                "started_at",
                "finished_at",
            ]
        )
        # 数据
        for inst in job.instances.values():
            writer.writerow(
                [
                    inst.agent_id,
                    inst.row_index,
                    inst.task,
                    inst.nickname or "",
                    inst.role,
                    inst.model or "",
                    inst.status,
                    inst.error or "",
                    inst.started_at,
                    inst.finished_at or "",
                ]
            )
        return buf.getvalue()

    def _export_markdown(self, job: BatchJob) -> str:
        """导出为 Markdown 表格"""
        lines = [
            f"# Batch Report: {job.batch_id}",
            "",
            f"- **Status**: {job.status}",
            f"- **Total**: {job.total}",
            f"- **Accepted**: {job.accepted}",
            f"- **Rejected**: {job.rejected}",
            f"- **Completed**: {job.completed}",
            f"- **Failed**: {job.failed}",
            f"- **In Progress**: {job.in_progress}",
            f"- **Progress**: {job.progress:.1%}",
            f"- **Started**: {job.started_at}",
            f"- **Finished**: {job.finished_at or 'N/A'}",
            "",
            "## Instances",
            "",
            "| Agent ID | Row | Status | Task | Error |",
            "|----------|-----|--------|------|-------|",
        ]
        for inst in job.instances.values():
            task_short = inst.task[:50] + ("..." if len(inst.task) > 50 else "")
            error_short = (inst.error or "")[:50]
            lines.append(
                f"| {inst.agent_id} | {inst.row_index} | {inst.status} | {task_short} | {error_short} |"
            )
        return "\n".join(lines)

    # ============================================================
    # 统计
    # ============================================================

    def get_stats(self) -> Dict[str, Any]:
        """统计信息"""
        return {
            "total_batches": len(self._jobs),
            "running": sum(
                1 for j in self._jobs.values() if j.status == BatchStatus.RUNNING.value
            ),
            "completed": sum(
                1 for j in self._jobs.values() if j.status == BatchStatus.COMPLETED.value
            ),
            "cancelled": sum(
                1 for j in self._jobs.values() if j.status == BatchStatus.CANCELLED.value
            ),
        }


# ============================================================
# 全局单例
# ============================================================


_spawner: Optional[BatchSpawner] = None


def get_batch_spawner() -> BatchSpawner:
    """获取全局 BatchSpawner（单例）"""
    global _spawner
    if _spawner is None:
        _spawner = BatchSpawner()
    return _spawner


def reset_batch_spawner() -> None:
    """重置全局 BatchSpawner（用于测试）"""
    global _spawner
    _spawner = None
