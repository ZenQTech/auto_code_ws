"""
# ============================================================
# Import Service - 跨平台配置迁移核心服务
# ============================================================
# 核心作用：导入服务主类，编排 4 个数据源转换器
# 调用方：backend/app/api/import.py
# 被调用方：backend/app/core/import_converters/*
# 输入参数：ImportSource + DataType
# 输出结果：ImportTask（带 status/progress/log）
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P3-1 新建
# ============================================================
"""

import json
import logging
import os
import shutil
import threading
import time
import uuid
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ..core.import_converters.base import (
    DataType,
    DetectedSource,
    ImportPreviewItem,
    ImportSource,
    ALLOWED_SOURCE_PATHS,
    MAX_FILE_SIZE,
    MAX_TASK_SIZE,
    _is_path_allowed,
    _safe_name,
)
from ..core.import_converters.claude_code import ClaudeCodeConverter
from ..core.import_converters.cursor import CursorConverter
from ..core.import_converters.codex import CodexConverter
from ..core.import_converters.trae import TraeConverter

logger = logging.getLogger(__name__)


# ============================================================
# 枚举
# ============================================================


class ImportStatus(str, Enum):
    """导入状态"""
    PENDING = "pending"
    DETECTING = "detecting"
    PREVIEWING = "previewing"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    ROLLED_BACK = "rolled_back"


# ============================================================
# 路径常量
# ============================================================

DEFAULT_HERMES_HOME = Path.home() / ".hermes"
TASKS_FILE = "import_tasks.jsonl"
BACKUPS_DIR = "import_backups"

# 任务超时（10 分钟）
TASK_TIMEOUT_SECONDS = 600

# Hermes 目标目录白名单
HERMES_TARGETS = [
    "config.toml",
    "mcp_servers.json",
    "commands",
    "memory",
    "skills",
    "plugins",
    "sessions",
    "rules",
]


# ============================================================
# 数据模型
# ============================================================


class ImportTask:
    """导入任务

    表示一个完整的导入操作，包含状态、进度、日志、统计信息。
    """

    def __init__(
        self,
        task_id: str,
        source: ImportSource,
        data_types: List[DataType],
        hermes_home: Path,
        items_total: int = 0,
    ):
        self.task_id = task_id
        self.source = source
        self.data_types = data_types
        self.hermes_home = hermes_home
        self.status = ImportStatus.PENDING
        self.progress = 0.0
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.completed_at: Optional[str] = None
        self.items_total = items_total
        self.items_completed = 0
        self.items_failed = 0
        self.error: Optional[str] = None
        self.rollback_available = False
        self.log: List[str] = []
        self.preview_items: List[ImportPreviewItem] = []
        self.backup_dir: Optional[str] = None
        self.results: List[Dict[str, Any]] = []

    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典"""
        return {
            "task_id": self.task_id,
            "source": self.source.value,
            "data_types": [dt.value for dt in self.data_types],
            "status": self.status.value,
            "progress": self.progress,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "items_total": self.items_total,
            "items_completed": self.items_completed,
            "items_failed": self.items_failed,
            "error": self.error,
            "rollback_available": self.rollback_available,
            "log": self.log[-20:],  # 仅保留最后 20 条日志
            "backup_dir": self.backup_dir,
            "results": self.results,
        }

    def add_log(self, msg: str) -> None:
        """添加日志"""
        ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
        entry = f"[{ts}] {msg}"
        self.log.append(entry)
        logger.info(f"[ImportTask {self.task_id}] {msg}")


# ============================================================
# ImportService 主类
# ============================================================


class ImportService:
    """导入服务主类

    单例模式，线程安全。
    """

    _instance: Optional["ImportService"] = None
    _lock = threading.RLock()

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self, hermes_home: Optional[Path] = None):
        if self._initialized:
            return

        self.hermes_home = hermes_home or DEFAULT_HERMES_HOME
        self.import_dir = self.hermes_home / "import"
        self.import_dir.mkdir(parents=True, exist_ok=True)
        self.backups_root = self.import_dir / BACKUPS_DIR
        self.backups_root.mkdir(parents=True, exist_ok=True)

        self.tasks_file = self.import_dir / TASKS_FILE
        self._tasks: Dict[str, ImportTask] = {}
        self._converters: Dict[ImportSource, Any] = {
            ImportSource.CLAUDE_CODE: ClaudeCodeConverter(),
            ImportSource.CURSOR: CursorConverter(),
            ImportSource.CODEX: CodexConverter(),
            ImportSource.TRAE: TraeConverter(),
        }
        self._threads: Dict[str, threading.Thread] = {}
        self._cancel_flags: Dict[str, threading.Event] = {}
        self._load_all()
        self._initialized = True
        logger.info(f"ImportService 初始化完成, hermes_home={self.hermes_home}")

    # ============================================================
    # 公共 API
    # ============================================================

    def detect_sources(self, sources: Optional[List[ImportSource]] = None) -> List[DetectedSource]:
        """检测已安装的 IDE

        Args:
            sources: 要检测的源列表，None 表示全部

        Returns:
            DetectedSource 列表
        """
        if sources is None:
            sources = list(self._converters.keys())

        results = []
        for source in sources:
            if source not in self._converters:
                continue
            converter = self._converters[source]
            try:
                detected = converter.detect()
                results.append(detected)
            except Exception as e:
                logger.error(f"detect {source.value} failed: {e}")
                results.append(DetectedSource(
                    source=source,
                    install_path=str(converter.install_path),
                    available=False,
                    error=str(e),
                ))
        return results

    def preview_import(
        self,
        source: ImportSource,
        data_types: List[DataType],
        install_path: Optional[Path] = None,
    ) -> List[ImportPreviewItem]:
        """预览待迁移项（dry-run）

        Args:
            source: 数据源
            data_types: 数据类型列表
            install_path: 自定义安装路径（用于测试）

        Returns:
            ImportPreviewItem 列表
        """
        converter = self._get_converter(source, install_path)
        if converter is None:
            return []

        # 校验源已安装
        if not converter.is_installed():
            return []

        # 校验路径
        if not _is_path_allowed(converter.install_path):
            logger.warning(f"path not in whitelist: {converter.install_path}")
            return []

        items: List[ImportPreviewItem] = []
        for data_type in data_types:
            try:
                sub_items = converter.list_data(data_type)
                # 检测冲突
                for item in sub_items:
                    self._check_conflicts(item)
                items.extend(sub_items)
            except Exception as e:
                logger.error(f"list_data {source.value}/{data_type.value} failed: {e}")
                items.append(ImportPreviewItem(
                    source=source,
                    data_type=data_type,
                    source_path="",
                    target_path="",
                    size_bytes=0,
                    error=str(e),
                ))

        return items

    def run_import(
        self,
        source: ImportSource,
        data_types: List[DataType],
        install_path: Optional[Path] = None,
    ) -> Tuple[Optional[ImportTask], str]:
        """异步执行导入

        Args:
            source: 数据源
            data_types: 数据类型列表
            install_path: 自定义安装路径

        Returns:
            (ImportTask, error_message)
        """
        with self._lock:
            # 校验
            valid, err = self._validate_inputs(source, data_types, install_path)
            if not valid:
                return None, err

            # 生成 task_id
            task_id = f"imp_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"

            # 预览
            preview_items = self.preview_import(source, data_types, install_path)
            items_total = sum(item.item_count for item in preview_items if not item.error)

            # 创建任务
            task = ImportTask(
                task_id=task_id,
                source=source,
                data_types=data_types,
                hermes_home=self.hermes_home,
                items_total=items_total,
            )
            task.status = ImportStatus.PENDING
            task.preview_items = preview_items
            task.add_log(f"任务创建: {len(preview_items)} 个待迁移项，{items_total} 个项目")

            self._tasks[task_id] = task
            self._save(task)

            # 启动后台线程
            cancel_event = threading.Event()
            self._cancel_flags[task_id] = cancel_event
            thread = threading.Thread(
                target=self._run_import_thread,
                args=(task, install_path, cancel_event),
                daemon=True,
                name=f"import-{task_id}",
            )
            self._threads[task_id] = thread
            thread.start()

            return task, ""

    def get_task(self, task_id: str) -> Optional[ImportTask]:
        """查询任务状态"""
        return self._tasks.get(task_id)

    def list_tasks(self, source: Optional[ImportSource] = None, status: Optional[ImportStatus] = None) -> List[ImportTask]:
        """列出所有任务"""
        with self._lock:
            tasks = list(self._tasks.values())
            if source is not None:
                tasks = [t for t in tasks if t.source == source]
            if status is not None:
                tasks = [t for t in tasks if t.status == status]
            # 按 started_at 倒序
            tasks.sort(key=lambda t: t.started_at, reverse=True)
            return tasks

    def cancel_task(self, task_id: str) -> bool:
        """取消任务"""
        task = self._tasks.get(task_id)
        if task is None:
            return False
        if task.status not in (ImportStatus.PENDING, ImportStatus.RUNNING):
            return False
        cancel_event = self._cancel_flags.get(task_id)
        if cancel_event:
            cancel_event.set()
        task.status = ImportStatus.CANCELLED
        task.completed_at = datetime.now(timezone.utc).isoformat()
        task.add_log("任务被取消")
        self._save(task)
        return True

    def rollback_task(self, task_id: str) -> Tuple[bool, str]:
        """回滚任务（恢复源数据 + 删除已迁移项）

        Args:
            task_id: 任务 ID

        Returns:
            (success, message)
        """
        task = self._tasks.get(task_id)
        if task is None:
            return False, "task not found"
        if not task.rollback_available or not task.backup_dir:
            return False, "rollback not available"

        try:
            # 删除已迁移项
            for result in task.results:
                target_path = result.get("target_path", "")
                if target_path:
                    p = self._resolve_path(target_path)
                    if p.exists():
                        if p.is_file():
                            p.unlink()
                        elif p.is_dir():
                            shutil.rmtree(p)
            task.add_log("已删除迁移的目标项")
            task.status = ImportStatus.ROLLED_BACK
            task.completed_at = datetime.now(timezone.utc).isoformat()
            self._save(task)
            return True, "rolled back"
        except Exception as e:
            return False, str(e)

    def get_stats(self) -> Dict[str, Any]:
        """统计信息"""
        with self._lock:
            total = len(self._tasks)
            by_status = {}
            by_source = {}
            for t in self._tasks.values():
                by_status[t.status.value] = by_status.get(t.status.value, 0) + 1
                by_source[t.source.value] = by_source.get(t.source.value, 0) + 1
            return {
                "total": total,
                "by_status": by_status,
                "by_source": by_source,
                "supported_sources": [s.value for s in ImportSource],
                "supported_data_types": [dt.value for dt in DataType],
                "hermes_home": str(self.hermes_home),
            }

    def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        return {
            "status": "ok",
            "version": "1.0.0",
            "hermes_home": str(self.hermes_home),
            "import_dir": str(self.import_dir),
            "active_tasks": sum(1 for t in self._threads.values() if t.is_alive()),
        }

    # ============================================================
    # 内部方法
    # ============================================================

    def _get_converter(self, source: ImportSource, install_path: Optional[Path] = None):
        """获取转换器实例"""
        if source == ImportSource.CLAUDE_CODE:
            return ClaudeCodeConverter(install_path)
        elif source == ImportSource.CURSOR:
            return CursorConverter(install_path)
        elif source == ImportSource.CODEX:
            return CodexConverter(install_path)
        elif source == ImportSource.TRAE:
            return TraeConverter(install_path)
        return None

    def _validate_inputs(
        self,
        source: ImportSource,
        data_types: List[DataType],
        install_path: Optional[Path] = None,
    ) -> Tuple[bool, str]:
        """校验输入"""
        if source not in self._converters:
            return False, f"unsupported source: {source}"
        if not data_types:
            return False, "data_types is empty"
        for dt in data_types:
            if dt not in DataType:
                return False, f"unsupported data_type: {dt}"
        # 校验 install_path（如果提供）
        if install_path is not None and not _is_path_allowed(install_path):
            return False, f"install_path not in whitelist: {install_path}"
        return True, ""

    def _check_conflicts(self, item: ImportPreviewItem) -> None:
        """检测目标冲突"""
        target = self._resolve_path(item.target_path)
        if target.exists():
            item.conflicts.append(f"目标已存在: {item.target_path}")

    def _resolve_path(self, path_str: str) -> Path:
        """解析路径（处理 ~ 和相对路径）

        处理策略：
        1. 如果以 ~/.hermes/ 开头，提取相对 hermes_home 的路径
        2. 如果以 ~/ 开头，提取相对 hermes_home 的路径
        3. 如果是绝对路径，直接使用
        4. 相对路径：相对 hermes_home
        """
        path_str = path_str.strip()
        # 处理 ~/.hermes/xxx → hermes_home / xxx
        if path_str.startswith("~/.hermes/"):
            rel = path_str[len("~/.hermes/"):]
            return self.hermes_home / rel
        if path_str == "~/.hermes":
            return self.hermes_home
        # 处理 ~/xxx → hermes_home / xxx
        if path_str.startswith("~/"):
            rel = path_str[2:]
            return self.hermes_home / rel
        if path_str == "~":
            return self.hermes_home
        # 处理 /home/<user>/.hermes/xxx → hermes_home / xxx
        home_prefix = str(Path.home() / ".hermes")
        if path_str.startswith(home_prefix + "/"):
            rel = path_str[len(home_prefix) + 1:]
            return self.hermes_home / rel
        if path_str == home_prefix:
            return self.hermes_home

        # 其他情况
        p = Path(path_str)
        if p.is_absolute():
            return p
        return self.hermes_home / p

    def _run_import_thread(
        self,
        task: ImportTask,
        install_path: Optional[Path],
        cancel_event: threading.Event,
    ) -> None:
        """后台执行导入"""
        start_time = time.time()
        try:
            task.status = ImportStatus.RUNNING
            task.add_log("开始导入...")
            self._save(task)

            # 1. 备份源（只读，复制到备份目录）
            task.backup_dir = self._create_backup(task)
            task.rollback_available = True
            task.add_log(f"源数据已备份到 {task.backup_dir}")
            self._save(task)

            # 2. 遍历 preview items 执行转换
            converter = self._get_converter(task.source, install_path)
            for i, item in enumerate(task.preview_items):
                if cancel_event.is_set():
                    task.status = ImportStatus.CANCELLED
                    task.add_log("任务被取消")
                    return

                if item.error:
                    task.items_failed += 1
                    continue

                # 进度更新
                progress = (i + 1) / max(len(task.preview_items), 1)
                task.progress = round(progress, 4)

                # 转换 + 写入
                try:
                    source_path = Path(item.source_path)
                    if not source_path.exists():
                        task.add_log(f"⚠️ 源文件不存在: {source_path}")
                        task.items_failed += 1
                        continue

                    target_path, content = converter.convert(item.data_type, source_path)
                    # 解析 target 路径
                    actual_target = self._resolve_path(str(target_path))
                    # 创建父目录
                    actual_target.parent.mkdir(parents=True, exist_ok=True)
                    # 写入
                    actual_target.write_bytes(content)
                    task.results.append({
                        "data_type": item.data_type.value,
                        "source_path": str(source_path),
                        "target_path": str(actual_target),
                        "size_bytes": len(content),
                        "success": True,
                    })
                    task.items_completed += 1
                    task.add_log(f"✓ 迁移 {item.data_type.value}: {source_path.name} → {actual_target.name}")
                except Exception as e:
                    task.items_failed += 1
                    task.add_log(f"✗ 迁移失败 {item.data_type.value}: {e}")
                    task.results.append({
                        "data_type": item.data_type.value,
                        "source_path": item.source_path,
                        "target_path": "",
                        "error": str(e),
                        "success": False,
                    })

                # 检查超时
                if time.time() - start_time > TASK_TIMEOUT_SECONDS:
                    task.status = ImportStatus.FAILED
                    task.error = "task timeout"
                    task.add_log("任务超时")
                    return

                self._save(task)

            # 3. 完成
            if task.items_failed == 0:
                task.status = ImportStatus.COMPLETED
                task.progress = 1.0
                task.add_log(f"✅ 导入完成：{task.items_completed} 成功，{task.items_failed} 失败")
            else:
                task.status = ImportStatus.FAILED
                task.error = f"{task.items_failed} items failed"
                task.add_log(f"⚠️ 导入部分失败：{task.items_completed} 成功，{task.items_failed} 失败")

            task.completed_at = datetime.now(timezone.utc).isoformat()
            self._save(task)
        except Exception as e:
            logger.exception(f"import task {task.task_id} crashed: {e}")
            task.status = ImportStatus.FAILED
            task.error = str(e)
            task.completed_at = datetime.now(timezone.utc).isoformat()
            task.add_log(f"❌ 任务异常: {e}")
            self._save(task)
        finally:
            # 清理
            self._cancel_flags.pop(task.task_id, None)
            self._threads.pop(task.task_id, None)

    def _create_backup(self, task: ImportTask) -> str:
        """创建源数据备份（只读快照）

        Args:
            task: 导入任务

        Returns:
            备份目录路径
        """
        backup_id = f"{task.task_id}_{int(time.time())}"
        backup_path = self.backups_root / backup_id
        backup_path.mkdir(parents=True, exist_ok=True)

        # 复制所有 preview items 的源文件
        for item in task.preview_items:
            if item.error or not item.source_path:
                continue
            source = Path(item.source_path)
            if not source.exists():
                continue
            # 目标备份路径
            rel = source.name
            dest = backup_path / rel
            try:
                if source.is_file():
                    shutil.copy2(source, dest)
            except Exception as e:
                logger.warning(f"backup failed for {source}: {e}")

        return str(backup_path)

    # ============================================================
    # 持久化
    # ============================================================

    def _save(self, task: ImportTask) -> None:
        """保存任务到 JSONL"""
        try:
            with self._lock:
                with open(self.tasks_file, "a", encoding="utf-8") as f:
                    f.write(json.dumps(task.to_dict(), ensure_ascii=False) + "\n")
        except Exception as e:
            logger.error(f"save task {task.task_id} failed: {e}")

    def _load_all(self) -> None:
        """从 JSONL 加载所有任务"""
        if not self.tasks_file.exists():
            return
        try:
            with open(self.tasks_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    # 重建任务对象
                    task = self._restore_task(data)
                    if task:
                        self._tasks[task.task_id] = task
            logger.info(f"加载 {len(self._tasks)} 个历史任务")
        except Exception as e:
            logger.error(f"load tasks failed: {e}")

    def _restore_task(self, data: Dict[str, Any]) -> Optional[ImportTask]:
        """从 dict 重建任务"""
        try:
            task = ImportTask(
                task_id=data["task_id"],
                source=ImportSource(data["source"]),
                data_types=[DataType(dt) for dt in data.get("data_types", [])],
                hermes_home=self.hermes_home,
                items_total=data.get("items_total", 0),
            )
            task.status = ImportStatus(data.get("status", "pending"))
            task.progress = data.get("progress", 0.0)
            task.started_at = data.get("started_at", task.started_at)
            task.completed_at = data.get("completed_at")
            task.items_completed = data.get("items_completed", 0)
            task.items_failed = data.get("items_failed", 0)
            task.error = data.get("error")
            task.rollback_available = data.get("rollback_available", False)
            task.log = data.get("log", [])
            task.backup_dir = data.get("backup_dir")
            task.results = data.get("results", [])
            return task
        except Exception as e:
            logger.warning(f"restore task failed: {e}")
            return None


# ============================================================
# 单例获取函数
# ============================================================


_global_service: Optional[ImportService] = None


def get_import_service(hermes_home: Optional[Path] = None) -> ImportService:
    """获取全局 ImportService 单例"""
    global _global_service
    if _global_service is None:
        _global_service = ImportService(hermes_home)
    return _global_service
