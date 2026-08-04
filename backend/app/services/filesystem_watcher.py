"""
# ============================================================
# FileSystemWatcher 服务 (v1.0.0)
# Cycle 64 G64-02
# ====================================
# 核心作用：监控文件系统变更，与 StageDetector 联动
# 运行流程：
#   1. 启动时为指定目录创建 Observer
#   2. 文件 create/modify/delete 时触发回调
#   3. 回调中分析文件类型 → 推断 stage
#   4. 调用 StageDetector.force_stage 切换
#   5. 支持多目录监控
# 设计要点：
#   - watchdog 库（生产）+ 轮询（fallback）
#   - 同一文件 100ms 内合并（debounce）
#   - 排除隐藏目录/大文件/node_modules
#   - 异步处理
#   - 阶段联动通过回调注入
# 输入参数：watch_paths, stage_callback
# 输出结果：FileSystemEvent 流
# 对标：Trae SOLO Auto-Follow
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 64 G64-02 初次创建
# ====================================
"""

import asyncio
import logging
import os
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Callable, Deque, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 异常类型
# ============================================================


class FSWatchError(Exception):
    pass


class InvalidPathError(FSWatchError):
    pass


# ============================================================
# 文件类型 → 阶段推断
# ============================================================


# 阶段推断规则
# priority 越高表示越应该被采纳
STAGE_FILE_RULES: Dict[str, Dict[str, Any]] = {
    # coding: 源代码文件
    "coding": {
        "extensions": {
            ".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".rs", ".java",
            ".kt", ".swift", ".c", ".cpp", ".h", ".hpp", ".cs", ".rb",
            ".php", ".scala", ".clj", ".ex", ".exs", ".vue", ".svelte",
            ".css", ".scss", ".less", ".html", ".htm",
        },
        "priority": 5,
    },
    # preview: 静态资源/配置
    "preview": {
        "extensions": {".json", ".yaml", ".yml", ".toml", ".ini", ".env"},
        "priority": 4,
    },
    # deploy: 构建产物
    "deploy": {
        "names": {
            "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
            ".dockerignore", "package.json", "Cargo.toml", "go.mod",
            "pyproject.toml", "setup.py", "requirements.txt",
        },
        "priority": 6,
    },
    # prd: 文档
    "prd": {
        "extensions": {".md", ".txt", ".rst", ".adoc", ".docx", ".pdf"},
        "priority": 2,
    },
    # done: 测试报告
    "done": {
        "extensions": {".log", ".html"},
        "names": {"test_report.html", "report.html"},
        "priority": 1,
    },
}


# 排除路径
EXCLUDE_PATTERNS = (
    "node_modules",
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    "env",
    "dist",
    "build",
    ".pytest_cache",
    ".mypy_cache",
    ".next",
    "target",
    "out",
    "coverage",
    ".idea",
    ".vscode",
)


# ============================================================
# 事件数据结构
# ============================================================


class FileSystemEvent:
    """文件系统事件"""

    def __init__(
        self,
        event_type: str,    # created/modified/deleted/moved
        path: str,
        is_dir: bool = False,
        timestamp: Optional[float] = None,
    ):
        self.event_type = event_type
        self.path = path
        self.is_dir = is_dir
        self.timestamp = timestamp or time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "event_type": self.event_type,
            "path": self.path,
            "is_dir": self.is_dir,
            "timestamp": self.timestamp,
        }


# ============================================================
# Watcher 主类
# ============================================================


class FileSystemWatcher:
    """
    文件系统监听器
    - 监控一个或多个目录
    - 文件变化时触发回调
    - 联动 stage 推断
    """

    def __init__(
        self,
        watch_paths: Optional[List[str]] = None,
        debounce_ms: int = 100,
        max_event_history: int = 1000,
    ):
        self._watch_paths: List[str] = []
        self._debounce_ms = debounce_ms
        self._max_event_history = max_event_history

        # 路径 -> 状态
        # 状态: running/paused
        self._path_states: Dict[str, str] = {}

        # 事件历史（全局）
        self._events: Deque[FileSystemEvent] = deque(maxlen=max_event_history)

        # 防抖缓存
        # path -> last_event_time
        self._last_event_time: Dict[str, float] = {}

        # 回调注册表
        # event_type -> List[callback]
        self._callbacks: Dict[str, List[Callable[[FileSystemEvent], None]]] = defaultdict(list)
        # 全局回调
        self._global_callbacks: List[Callable[[FileSystemEvent], None]] = []

        # 当前活跃的 stage 推断
        self._current_stage: str = "idle"

        # 锁
        self._lock = asyncio.Lock()

        # 是否使用 watchdog（生产）
        self._observer: Any = None  # watchdog.Observer 实例
        self._observer_active: bool = False

        if watch_paths:
            for p in watch_paths:
                self.add_watch_path(p)

    # ============================================================
    # 路径管理
    # ============================================================

    def add_watch_path(self, path: str) -> None:
        """添加监控路径"""
        p = Path(path).resolve()
        if not p.exists():
            raise InvalidPathError(f"路径不存在: {path}")
        if not p.is_dir():
            raise InvalidPathError(f"路径不是目录: {path}")
        p_str = str(p)
        if p_str not in self._watch_paths:
            self._watch_paths.append(p_str)
            self._path_states[p_str] = "running"
            # 如果 Observer 在运行，添加新目录
            if self._observer is not None and self._observer_active:
                self._attach_observer_to_path(p_str)

    def remove_watch_path(self, path: str) -> bool:
        """移除监控路径"""
        p_str = str(Path(path).resolve())
        if p_str in self._watch_paths:
            self._watch_paths.remove(p_str)
            self._path_states.pop(p_str, None)
            return True
        return False

    def list_watch_paths(self) -> List[str]:
        """列出监控路径"""
        return list(self._watch_paths)

    def get_path_state(self, path: str) -> str:
        """获取路径状态"""
        return self._path_states.get(str(Path(path).resolve()), "unknown")

    # ============================================================
    # 生命周期
    # ============================================================

    async def start(self) -> None:
        """启动监控（异步轮询模式，无需 watchdog）"""
        # 尝试使用 watchdog
        try:
            from watchdog.observers import Observer
            from watchdog.events import FileSystemEventHandler
        except ImportError:
            logger.warning("watchdog 未安装，使用轮询模式")
            self._start_polling()
            return

        # 使用 watchdog
        self._observer = Observer()
        self._observer_active = True
        for p in self._watch_paths:
            self._attach_observer_to_path(p)
        self._observer.start()
        logger.info(f"FileSystemWatcher 启动 (watchdog): {len(self._watch_paths)} 个目录")

    def _attach_observer_to_path(self, path: str) -> None:
        """将 observer 附加到指定路径"""
        from watchdog.events import FileSystemEventHandler

        watcher = self

        class Handler(FileSystemEventHandler):
            def on_created(self, event):
                if not event.is_directory:
                    watcher._handle_event("created", event.src_path, False)

            def on_modified(self, event):
                if not event.is_directory:
                    watcher._handle_event("modified", event.src_path, False)

            def on_deleted(self, event):
                watcher._handle_event("deleted", event.src_path, event.is_directory)

            def on_moved(self, event):
                watcher._handle_event("moved", event.dest_path, event.is_directory)

        self._observer.schedule(Handler(), path, recursive=True)

    def _start_polling(self) -> None:
        """启动轮询（fallback）"""
        # 启动一个 asyncio 任务
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(self._poll_loop())
        except RuntimeError:
            # 没有运行中的 loop，延迟启动
            asyncio.run(self._poll_loop())

    async def _poll_loop(self) -> None:
        """轮询循环（fallback）"""
        # 记录已存在的文件
        known_files: Dict[str, float] = {}
        for p in self._watch_paths:
            for root, dirs, files in os.walk(p):
                # 过滤目录
                dirs[:] = [d for d in dirs if not self._should_exclude(d)]
                for f in files:
                    full = os.path.join(root, f)
                    if not self._should_exclude_path(full):
                        try:
                            known_files[full] = os.path.getmtime(full)
                        except OSError:
                            pass

        # 轮询
        while True:
            await asyncio.sleep(1.0)
            try:
                current_files: Set[str] = set()
                for p in self._watch_paths:
                    for root, dirs, files in os.walk(p):
                        dirs[:] = [d for d in dirs if not self._should_exclude(d)]
                        for f in files:
                            full = os.path.join(root, f)
                            if not self._should_exclude_path(full):
                                current_files.add(full)
                                try:
                                    mtime = os.path.getmtime(full)
                                    if full not in known_files:
                                        self._handle_event("created", full, False)
                                        known_files[full] = mtime
                                    elif known_files[full] != mtime:
                                        self._handle_event("modified", full, False)
                                        known_files[full] = mtime
                                except OSError:
                                    pass
                # 删除检测
                deleted = set(known_files.keys()) - current_files
                for d in deleted:
                    self._handle_event("deleted", d, False)
                    known_files.pop(d, None)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"轮询错误: {e}")

    async def stop(self) -> None:
        """停止监控"""
        self._observer_active = False
        if self._observer is not None:
            try:
                self._observer.stop()
                self._observer.join(timeout=2.0)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"停止 Observer 失败: {e}")
            self._observer = None

    # ====================================
    # 事件处理
    # ====================================

    def _handle_event(
        self,
        event_type: str,
        path: str,
        is_dir: bool,
    ) -> None:
        """处理事件（watchdog 回调）"""
        # 排除目录
        if is_dir:
            return
        # 排除路径
        if self._should_exclude_path(path):
            return
        # 防抖
        now = time.time() * 1000  # ms
        last = self._last_event_time.get(path, 0)
        if now - last < self._debounce_ms:
            return
        self._last_event_time[path] = now
        # 创建事件
        event = FileSystemEvent(
            event_type=event_type,
            path=path,
            is_dir=is_dir,
        )
        # 记录到历史
        self._events.append(event)
        # 触发回调
        self._dispatch(event)

    def _dispatch(self, event: FileSystemEvent) -> None:
        """派发事件到回调"""
        for cb in self._global_callbacks:
            try:
                cb(event)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"全局回调失败: {e}")
        for cb in self._callbacks.get(event.event_type, []):
            try:
                cb(event)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"事件回调失败: {e}")

    def _should_exclude_path(self, path: str) -> bool:
        """检查路径是否应排除"""
        parts = Path(path).parts
        for excl in EXCLUDE_PATTERNS:
            if excl in parts:
                return True
        return False

    def _should_exclude(self, name: str) -> bool:
        """检查目录名是否应排除"""
        return name in EXCLUDE_PATTERNS

    # ============================================================
    # 回调
    # ============================================================

    def on(self, event_type: str, callback: Callable[[FileSystemEvent], None]) -> None:
        """注册事件类型回调"""
        self._callbacks[event_type].append(callback)

    def on_any(self, callback: Callable[[FileSystemEvent], None]) -> None:
        """注册全局回调"""
        self._global_callbacks.append(callback)

    # ============================================================
    # Stage 推断
    # ============================================================

    def infer_stage(self, event: FileSystemEvent) -> str:
        """
        根据文件事件推断 stage
        返回最匹配的 stage
        """
        if event.event_type == "deleted":
            # 删除事件不改变推断
            return self._current_stage
        path = Path(event.path)
        ext = path.suffix.lower()
        name = path.name

        candidates: List[Tuple[str, int]] = []
        for stage, rules in STAGE_FILE_RULES.items():
            priority = rules.get("priority", 0)
            if ext in rules.get("extensions", set()):
                candidates.append((stage, priority))
            if name in rules.get("names", set()):
                candidates.append((stage, priority + 1))  # 文件名匹配优先
        if not candidates:
            return self._current_stage
        # 选择 priority 最高的
        candidates.sort(key=lambda x: x[1], reverse=True)
        return candidates[0][0]

    def update_current_stage(self, new_stage: str) -> bool:
        """更新当前 stage（供外部回调）"""
        if new_stage != self._current_stage:
            old = self._current_stage
            self._current_stage = new_stage
            logger.info(f"Stage 切换: {old} -> {new_stage}")
            return True
        return False

    def get_current_stage(self) -> str:
        return self._current_stage

    # ============================================================
    # 历史
    # ============================================================

    def get_recent_events(self, limit: int = 50) -> List[FileSystemEvent]:
        """获取最近事件"""
        return list(self._events)[-limit:]

    def clear_events(self) -> None:
        """清空事件历史"""
        self._events.clear()
        self._last_event_time.clear()

    # ============================================================
    # 统计
    # ============================================================

    def get_stats(self) -> Dict[str, Any]:
        """统计"""
        return {
            "watch_paths": len(self._watch_paths),
            "event_count": len(self._events),
            "observer_active": self._observer_active,
            "current_stage": self._current_stage,
            "callbacks": {
                event_type: len(cbs)
                for event_type, cbs in self._callbacks.items()
            },
            "global_callbacks": len(self._global_callbacks),
        }


# ============================================================
# 全局单例 + 工厂
# ============================================================


_watcher: Optional[FileSystemWatcher] = None


def get_filesystem_watcher() -> FileSystemWatcher:
    """获取全局 FileSystemWatcher（单例）"""
    global _watcher
    if _watcher is None:
        _watcher = FileSystemWatcher()
    return _watcher


def reset_filesystem_watcher() -> None:
    """重置全局 FileSystemWatcher（用于测试）"""
    global _watcher
    _watcher = None
