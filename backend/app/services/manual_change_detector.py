"""
# ============================================================
# 人工变更检测与重验证服务（V4.1 新增）
# ============================================================
# 核心作用：监控人工对代码文件的修改，通过文件哈希对比检测变更，
#           分析变更影响范围（ROS 包依赖、头文件引用、接口调用关系），
#           按影响级别执行分级重验证，确保人工修改不破坏系统完整性
# 运行流程：
#   1. 启动监控：start_monitoring() 扫描指定路径，建立文件哈希基线
#   2. 变更检测：detect_changes() 对比当前哈希与基线，发现修改文件
#   3. 影响分析：analyze_impact() 分析 ROS 包依赖、头文件引用、接口调用
#   4. 影响分级：classify_impact() 按 no_impact/minor/core/high_risk 分级
#   5. 分级重验证：execute_revalidation() 根据影响级别执行对应验证
#   6. 批量处理：handle_batch_changes() 暂停未执行任务，输出影响报告
#   7. 告警推送：send_alert() 核心逻辑/安全变更推送通知
#   8. 记忆库同步：sync_memory_store() 重验证通过后同步更新代码到记忆库
# 输入参数：
#   - watch_paths: List[str]，监控的目录/文件路径列表
#   - modified_files: List[str]，检测到的变更文件列表
#   - impact_level: str，影响级别（no_impact/minor_impact/core_impact/high_risk_module）
# 输出结果：变更检测报告，包含影响分析、分级结果、重验证状态
# 修改记录：
#   - 2026-06-24 | v4.1.0 | 初始版本，实现人工变更检测、影响分析、
#     分级重验证、批量处理、告警推送、记忆库同步全流程
# ============================================================
"""

import hashlib
import json
import logging
import os
import re
import sqlite3
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from backend.app.config import settings

logger = logging.getLogger(__name__)


# ============================================================
# 枚举与数据类定义
# ============================================================

class ImpactLevel(str, Enum):
    """
    变更影响级别枚举
    取值：
      - NO_IMPACT: 无影响（仅注释/格式变更）
      - MINOR_IMPACT: 轻微影响（文档/非核心逻辑变更）
      - CORE_IMPACT: 核心影响（核心算法/接口逻辑变更）
      - HIGH_RISK_MODULE: 高风险模块变更（安全相关/控制逻辑变更）
    """
    NO_IMPACT = "no_impact"
    MINOR_IMPACT = "minor_impact"
    CORE_IMPACT = "core_impact"
    HIGH_RISK_MODULE = "high_risk_module"


class RevalidationStatus(str, Enum):
    """
    重验证状态枚举
    取值：
      - PENDING: 等待验证
      - IN_PROGRESS: 验证中
      - PASSED: 验证通过
      - FAILED: 验证失败
      - SKIPPED: 已跳过（无需验证）
    """
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class FileHashRecord:
    """
    文件哈希记录数据结构
    字段说明：
      - file_path: 文件绝对路径
      - hash_value: SHA256 哈希值
      - last_modified: 最后修改时间戳
      - file_size: 文件大小（字节）
    """
    file_path: str = ""
    hash_value: str = ""
    last_modified: float = 0.0
    file_size: int = 0


@dataclass
class ChangeDetectionResult:
    """
    变更检测结果数据结构
    字段说明：
      - modified_files: 已修改的文件路径列表
      - added_files: 新增的文件路径列表
      - deleted_files: 已删除的文件路径列表
      - unchanged_files: 未变更的文件路径列表
      - detection_time: 检测时间戳
    """
    modified_files: List[str] = field(default_factory=list)
    added_files: List[str] = field(default_factory=list)
    deleted_files: List[str] = field(default_factory=list)
    unchanged_files: List[str] = field(default_factory=list)
    detection_time: str = ""


@dataclass
class ImpactAnalysisResult:
    """
    影响分析结果数据结构
    字段说明：
      - file_path: 文件路径
      - impact_level: 影响级别
      - ros_dependencies: 受影响的 ROS 包列表
      - header_references: 受影响的头文件引用列表
      - interface_callers: 受影响的接口调用方列表
      - dependent_modules: 依赖该文件的模块列表
      - analysis_time: 分析时间戳
    """
    file_path: str = ""
    impact_level: str = ""
    ros_dependencies: List[str] = field(default_factory=list)
    header_references: List[str] = field(default_factory=list)
    interface_callers: List[str] = field(default_factory=list)
    dependent_modules: List[str] = field(default_factory=list)
    analysis_time: str = ""


@dataclass
class RevalidationResult:
    """
    重验证结果数据结构
    字段说明：
      - file_path: 文件路径
      - status: 验证状态
      - impact_level: 影响级别
      - checks_performed: 已执行的检查项列表
      - issues_found: 发现的问题列表
      - revalidation_time: 重验证时间戳
    """
    file_path: str = ""
    status: str = ""
    impact_level: str = ""
    checks_performed: List[str] = field(default_factory=list)
    issues_found: List[str] = field(default_factory=list)
    revalidation_time: str = ""


# ============================================================
# ManualChangeDetector 主类
# ============================================================

class ManualChangeDetector:
    """
    人工变更检测与重验证管理器
    作用：监控人工代码修改，检测变更、分析影响、分级重验证、
          批量处理、告警推送、记忆库同步
    调用方：API 路由层、任务执行引擎、安全校验流程
    被调用方：SQLite 持久化存储、MemoryStore、SecurityChecker
    """

    _instance = None

    def __new__(cls, db_path: str = None):
        """
        单例模式：确保全局只有一个人工变更检测器实例
        参数：
          db_path: SQLite 数据库路径（可选，默认从配置读取）
        """
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self, db_path: str = None):
        """
        初始化人工变更检测器
        参数：
          db_path: SQLite 数据库路径（可选）
        运行步骤：
          1. 确定数据库路径
          2. 初始化 SQLite 数据库表结构
          3. 初始化文件哈希基线字典
          4. 初始化监控路径列表
          5. 初始化线程安全锁
        """
        if self._initialized:
            return

        # 数据库路径：从配置获取数据目录
        project_root = settings.get_project_root()
        data_dir = project_root / settings.storage.get("data_dir", "data")
        data_dir.mkdir(parents=True, exist_ok=True)
        if db_path is None:
            db_path = str(data_dir / "manual_change_detector.db")
        self._db_path = db_path

        # 文件哈希基线：file_path -> FileHashRecord
        self._hash_baseline: Dict[str, FileHashRecord] = {}

        # 监控路径列表
        self._watch_paths: List[str] = []

        # 变更检测结果缓存
        self._last_detection: Optional[ChangeDetectionResult] = None

        # 影响分析结果缓存
        self._impact_results: Dict[str, ImpactAnalysisResult] = {}

        # 重验证结果缓存
        self._revalidation_results: Dict[str, RevalidationResult] = {}

        # 告警回调函数列表
        self._alert_callbacks: List[Callable[[Dict[str, Any]], None]] = []

        # 线程安全锁
        self._lock = threading.Lock()

        # 初始化数据库
        self._init_db()

        # 从数据库加载已有哈希基线
        self._load_baseline_from_db()

        self._initialized = True
        logger.info(
            "人工变更检测器初始化完成 | 数据库=%s | 基线文件数=%d",
            self._db_path,
            len(self._hash_baseline),
        )

    # ============================================================
    # 数据库初始化与持久化
    # ============================================================

    def _init_db(self):
        """
        初始化 SQLite 数据库表结构
        运行步骤：
          1. 创建 file_hashes 表（文件哈希基线）
          2. 创建 change_detections 表（变更检测记录）
          3. 创建 impact_analyses 表（影响分析记录）
          4. 创建 revalidation_results 表（重验证结果）
          5. 创建必要索引
        """
        conn = sqlite3.connect(self._db_path)
        # 文件哈希基线表
        conn.execute("""
            CREATE TABLE IF NOT EXISTS file_hashes (
                file_path TEXT PRIMARY KEY,
                hash_value TEXT NOT NULL DEFAULT '',
                last_modified REAL NOT NULL DEFAULT 0.0,
                file_size INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT ''
            )
        """)
        # 变更检测记录表
        conn.execute("""
            CREATE TABLE IF NOT EXISTS change_detections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                modified_files TEXT NOT NULL DEFAULT '[]',
                added_files TEXT NOT NULL DEFAULT '[]',
                deleted_files TEXT NOT NULL DEFAULT '[]',
                unchanged_count INTEGER NOT NULL DEFAULT 0,
                detection_time TEXT NOT NULL DEFAULT ''
            )
        """)
        # 影响分析记录表
        conn.execute("""
            CREATE TABLE IF NOT EXISTS impact_analyses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                impact_level TEXT NOT NULL DEFAULT '',
                ros_dependencies TEXT NOT NULL DEFAULT '[]',
                header_references TEXT NOT NULL DEFAULT '[]',
                interface_callers TEXT NOT NULL DEFAULT '[]',
                dependent_modules TEXT NOT NULL DEFAULT '[]',
                analysis_time TEXT NOT NULL DEFAULT ''
            )
        """)
        # 重验证结果表
        conn.execute("""
            CREATE TABLE IF NOT EXISTS revalidation_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT '',
                impact_level TEXT NOT NULL DEFAULT '',
                checks_performed TEXT NOT NULL DEFAULT '[]',
                issues_found TEXT NOT NULL DEFAULT '[]',
                revalidation_time TEXT NOT NULL DEFAULT ''
            )
        """)
        # 创建索引
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_detection_time "
            "ON change_detections(detection_time)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_impact_file "
            "ON impact_analyses(file_path)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_impact_level "
            "ON impact_analyses(impact_level)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_reval_file "
            "ON revalidation_results(file_path)"
        )
        conn.commit()
        conn.close()

    def _load_baseline_from_db(self):
        """
        从 SQLite 数据库加载已有文件哈希基线到内存
        运行步骤：
          1. 查询所有文件哈希记录
          2. 构建内存哈希基线字典
        """
        conn = sqlite3.connect(self._db_path)
        rows = conn.execute(
            "SELECT file_path, hash_value, last_modified, file_size "
            "FROM file_hashes"
        ).fetchall()
        conn.close()

        for row in rows:
            self._hash_baseline[row[0]] = FileHashRecord(
                file_path=row[0],
                hash_value=row[1],
                last_modified=row[2],
                file_size=row[3],
            )

    def _save_hash_to_db(self, record: FileHashRecord):
        """
        将文件哈希记录持久化到 SQLite
        参数：
          record: 文件哈希记录对象
        """
        conn = sqlite3.connect(self._db_path)
        conn.execute(
            """INSERT OR REPLACE INTO file_hashes
               (file_path, hash_value, last_modified, file_size, updated_at)
               VALUES (?, ?, ?, ?, ?)""",
            (
                record.file_path,
                record.hash_value,
                record.last_modified,
                record.file_size,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        conn.commit()
        conn.close()

    def _remove_hash_from_db(self, file_path: str):
        """
        从 SQLite 删除文件哈希记录
        参数：
          file_path: 文件路径
        """
        conn = sqlite3.connect(self._db_path)
        conn.execute("DELETE FROM file_hashes WHERE file_path = ?", (file_path,))
        conn.commit()
        conn.close()

    # ============================================================
    # 文件哈希计算
    # ============================================================

    @staticmethod
    def compute_file_hash(file_path: str, algorithm: str = "sha256") -> Optional[str]:
        """
        计算文件的哈希值
        参数：
          file_path: 文件绝对路径
          algorithm: 哈希算法（sha256 / md5）
        返回值：十六进制哈希字符串，文件不存在或读取失败返回 None
        运行步骤：
          1. 检查文件是否存在
          2. 以二进制模式分块读取文件内容
          3. 使用 hashlib 计算哈希值
          4. 返回十六进制字符串
        """
        if not os.path.isfile(file_path):
            return None

        try:
            hasher = hashlib.new(algorithm)
            with open(file_path, "rb") as f:
                # 分块读取大文件，避免内存溢出
                while True:
                    chunk = f.read(8192)
                    if not chunk:
                        break
                    hasher.update(chunk)
            return hasher.hexdigest()
        except (IOError, OSError) as e:
            logger.error("计算文件哈希失败 | file=%s | error=%s", file_path, e)
            return None

    # ============================================================
    # 监控启动
    # ============================================================

    def start_monitoring(self, watch_paths: List[str]) -> Dict[str, Any]:
        """
        启动文件哈希监控：扫描指定路径，建立文件哈希基线
        参数：
          watch_paths: 监控的目录/文件路径列表
        返回值：
          {
            "success": bool,            # 是否启动成功
            "watch_paths": List[str],   # 监控路径列表
            "files_indexed": int,       # 已建立索引的文件数
            "message": str,             # 结果消息
          }
        运行步骤：
          1. 校验监控路径列表非空
          2. 遍历每个监控路径，递归扫描所有文件
          3. 对每个文件计算 SHA256 哈希值
          4. 建立文件哈希基线
          5. 持久化到 SQLite
        """
        if not watch_paths:
            return {
                "success": False,
                "watch_paths": [],
                "files_indexed": 0,
                "message": "监控路径列表不能为空",
            }

        self._watch_paths = list(watch_paths)
        files_indexed = 0

        with self._lock:
            for watch_path in watch_paths:
                path_obj = Path(watch_path)
                if not path_obj.exists():
                    logger.warning("监控路径不存在，跳过 | path=%s", watch_path)
                    continue

                if path_obj.is_file():
                    # 单个文件
                    self._index_file(str(path_obj))
                    files_indexed += 1
                elif path_obj.is_dir():
                    # 目录：递归扫描所有文件
                    for file_path in path_obj.rglob("*"):
                        if file_path.is_file():
                            # 跳过隐藏文件和二进制文件
                            if file_path.name.startswith("."):
                                continue
                            self._index_file(str(file_path))
                            files_indexed += 1

        logger.info(
            "文件哈希监控已启动 | 监控路径数=%d | 索引文件数=%d",
            len(watch_paths),
            files_indexed,
        )

        return {
            "success": True,
            "watch_paths": self._watch_paths,
            "files_indexed": files_indexed,
            "message": f"监控已启动，已为 {files_indexed} 个文件建立哈希基线",
        }

    def _index_file(self, file_path: str):
        """
        为单个文件建立哈希索引
        参数：
          file_path: 文件绝对路径
        运行步骤：
          1. 获取文件元信息（修改时间、大小）
          2. 计算文件哈希值
          3. 创建 FileHashRecord 并存入基线
          4. 持久化到 SQLite
        """
        try:
            stat = os.stat(file_path)
            hash_value = self.compute_file_hash(file_path)
            if hash_value is None:
                return

            record = FileHashRecord(
                file_path=file_path,
                hash_value=hash_value,
                last_modified=stat.st_mtime,
                file_size=stat.st_size,
            )
            self._hash_baseline[file_path] = record
            self._save_hash_to_db(record)
        except (IOError, OSError) as e:
            logger.error("文件索引失败 | file=%s | error=%s", file_path, e)

    # ============================================================
    # 变更检测
    # ============================================================

    def detect_changes(self) -> Dict[str, Any]:
        """
        检测人工修改：通过文件哈希对比发现变更
        返回值：
          {
            "success": bool,                      # 是否检测成功
            "modified_files": List[str],          # 已修改的文件列表
            "added_files": List[str],             # 新增的文件列表
            "deleted_files": List[str],           # 已删除的文件列表
            "unchanged_count": int,               # 未变更的文件数
            "detection_time": str,                # 检测时间
            "has_changes": bool,                  # 是否有变更
            "message": str,                       # 结果消息
          }
        运行步骤：
          1. 扫描所有监控路径下的当前文件
          2. 对比当前哈希与基线哈希
          3. 分类为：修改、新增、删除、未变更
          4. 更新基线（将当前状态设为新基线）
          5. 持久化检测记录
        """
        if not self._watch_paths:
            return {
                "success": False,
                "modified_files": [],
                "added_files": [],
                "deleted_files": [],
                "unchanged_count": 0,
                "detection_time": datetime.now(timezone.utc).isoformat(),
                "has_changes": False,
                "message": "未启动监控，请先调用 start_monitoring()",
            }

        now = datetime.now(timezone.utc).isoformat()
        current_files: Dict[str, FileHashRecord] = {}
        modified_files: List[str] = []
        added_files: List[str] = []
        deleted_files: List[str] = []
        unchanged_files: List[str] = []

        with self._lock:
            # 步骤 1：扫描当前所有文件并计算哈希
            for watch_path in self._watch_paths:
                path_obj = Path(watch_path)
                if not path_obj.exists():
                    continue
                if path_obj.is_file():
                    self._scan_current_file(str(path_obj), current_files)
                elif path_obj.is_dir():
                    for file_path in path_obj.rglob("*"):
                        if file_path.is_file() and not file_path.name.startswith("."):
                            self._scan_current_file(str(file_path), current_files)

            # 步骤 2：对比哈希，分类变更
            # 检测修改和未变更的文件
            for file_path, current_record in current_files.items():
                baseline_record = self._hash_baseline.get(file_path)
                if baseline_record is None:
                    # 基线中不存在 → 新增文件
                    added_files.append(file_path)
                elif current_record.hash_value != baseline_record.hash_value:
                    # 哈希值不同 → 文件已修改
                    modified_files.append(file_path)
                else:
                    # 哈希值相同 → 未变更
                    unchanged_files.append(file_path)

            # 检测已删除的文件（基线中存在但当前不存在）
            for file_path in self._hash_baseline:
                if file_path not in current_files:
                    deleted_files.append(file_path)

            # 步骤 3：更新基线为当前状态
            for file_path, record in current_files.items():
                self._hash_baseline[file_path] = record
                self._save_hash_to_db(record)

            # 从基线和数据库移除已删除的文件
            for file_path in deleted_files:
                self._hash_baseline.pop(file_path, None)
                self._remove_hash_from_db(file_path)

            # 步骤 4：缓存检测结果
            self._last_detection = ChangeDetectionResult(
                modified_files=modified_files,
                added_files=added_files,
                deleted_files=deleted_files,
                unchanged_files=unchanged_files,
                detection_time=now,
            )

            # 步骤 5：持久化检测记录
            self._save_detection_to_db(
                modified_files, added_files, deleted_files,
                len(unchanged_files), now,
            )

        has_changes = bool(modified_files or added_files or deleted_files)
        total_changes = len(modified_files) + len(added_files) + len(deleted_files)

        if has_changes:
            logger.warning(
                "检测到人工变更 | 修改=%d | 新增=%d | 删除=%d | 未变更=%d",
                len(modified_files),
                len(added_files),
                len(deleted_files),
                len(unchanged_files),
            )
        else:
            logger.debug("未检测到文件变更 | 监控文件数=%d", len(current_files))

        return {
            "success": True,
            "modified_files": modified_files,
            "added_files": added_files,
            "deleted_files": deleted_files,
            "unchanged_count": len(unchanged_files),
            "detection_time": now,
            "has_changes": has_changes,
            "message": (
                f"检测到 {total_changes} 个文件变更"
                if has_changes
                else "未检测到文件变更"
            ),
        }

    def _scan_current_file(
        self,
        file_path: str,
        current_files: Dict[str, FileHashRecord],
    ):
        """
        扫描单个当前文件并计算哈希
        参数：
          file_path: 文件路径
          current_files: 当前文件哈希记录字典（输出参数）
        """
        try:
            stat = os.stat(file_path)
            hash_value = self.compute_file_hash(file_path)
            if hash_value is None:
                return
            current_files[file_path] = FileHashRecord(
                file_path=file_path,
                hash_value=hash_value,
                last_modified=stat.st_mtime,
                file_size=stat.st_size,
            )
        except (IOError, OSError) as e:
            logger.error("扫描文件失败 | file=%s | error=%s", file_path, e)

    def _save_detection_to_db(
        self,
        modified_files: List[str],
        added_files: List[str],
        deleted_files: List[str],
        unchanged_count: int,
        detection_time: str,
    ):
        """
        将变更检测记录持久化到 SQLite
        参数：
          modified_files: 已修改文件列表
          added_files: 新增文件列表
          deleted_files: 已删除文件列表
          unchanged_count: 未变更文件数
          detection_time: 检测时间
        """
        conn = sqlite3.connect(self._db_path)
        conn.execute(
            """INSERT INTO change_detections
               (modified_files, added_files, deleted_files,
                unchanged_count, detection_time)
               VALUES (?, ?, ?, ?, ?)""",
            (
                json.dumps(modified_files, ensure_ascii=False),
                json.dumps(added_files, ensure_ascii=False),
                json.dumps(deleted_files, ensure_ascii=False),
                unchanged_count,
                detection_time,
            ),
        )
        conn.commit()
        conn.close()

    # ============================================================
    # 影响分析
    # ============================================================

    def analyze_impact(
        self,
        modified_files: List[str],
    ) -> List[Dict[str, Any]]:
        """
        分析变更影响范围：ROS 包依赖、头文件引用、接口调用关系
        参数：
          modified_files: 已修改的文件路径列表
        返回值：影响分析结果列表，每项包含：
          {
            "file_path": str,              # 文件路径
            "impact_level": str,           # 影响级别
            "ros_dependencies": List[str], # 受影响的 ROS 包
            "header_references": List[str],# 受影响的头文件引用
            "interface_callers": List[str],# 受影响的接口调用方
            "dependent_modules": List[str],# 依赖该文件的模块
            "analysis_time": str,          # 分析时间
          }
        运行步骤：
          1. 遍历每个修改文件
          2. 分析文件类型（C++/Python/CMake/配置）
          3. 提取 ROS 包依赖关系
          4. 提取头文件引用关系
          5. 提取接口调用关系
          6. 综合评估影响级别
        """
        results = []
        now = datetime.now(timezone.utc).isoformat()

        for file_path in modified_files:
            if not os.path.isfile(file_path):
                continue

            # 读取文件内容进行分析
            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            except (IOError, OSError):
                content = ""

            # 分析 ROS 包依赖
            ros_deps = self._analyze_ros_dependencies(file_path, content)

            # 分析头文件引用
            header_refs = self._analyze_header_references(file_path, content)

            # 分析接口调用关系
            interface_callers = self._analyze_interface_callers(file_path, content)

            # 分析依赖模块
            dependent_modules = self._analyze_dependent_modules(file_path)

            # 综合评估影响级别
            impact_level = self._evaluate_impact_level(
                file_path, content, ros_deps, header_refs, interface_callers,
            )

            result = ImpactAnalysisResult(
                file_path=file_path,
                impact_level=impact_level,
                ros_dependencies=ros_deps,
                header_references=header_refs,
                interface_callers=interface_callers,
                dependent_modules=dependent_modules,
                analysis_time=now,
            )

            with self._lock:
                self._impact_results[file_path] = result

            # 持久化影响分析结果
            self._save_impact_to_db(result)

            results.append({
                "file_path": result.file_path,
                "impact_level": result.impact_level,
                "ros_dependencies": result.ros_dependencies,
                "header_references": result.header_references,
                "interface_callers": result.interface_callers,
                "dependent_modules": result.dependent_modules,
                "analysis_time": result.analysis_time,
            })

        logger.info(
            "影响分析完成 | 分析文件数=%d",
            len(results),
        )

        return results

    def _analyze_ros_dependencies(
        self,
        file_path: str,
        content: str,
    ) -> List[str]:
        """
        分析 ROS 包依赖关系
        参数：
          file_path: 文件路径
          content: 文件内容
        返回值：依赖的 ROS 包名称列表
        运行步骤：
          1. 检查 package.xml 中的依赖声明
          2. 检查 CMakeLists.txt 中的 find_package/catkin_package
          3. 检查 C++ 代码中的 #include <ros/...> 和 #include <包名/...>
          4. 检查 Python 代码中的 import rospy/roscpp 等
        """
        ros_deps = []

        # 从 package.xml 提取依赖
        if file_path.endswith("package.xml"):
            # 匹配 <depend>、<build_depend>、<exec_depend> 标签
            dep_patterns = [
                r'<depend[^>]*>([^<]+)</depend>',
                r'<build_depend[^>]*>([^<]+)</build_depend>',
                r'<exec_depend[^>]*>([^<]+)</exec_depend>',
                r'<buildtool_depend[^>]*>([^<]+)</buildtool_depend>',
            ]
            for pattern in dep_patterns:
                matches = re.findall(pattern, content)
                ros_deps.extend(matches)

        # 从 CMakeLists.txt 提取依赖
        if file_path.endswith("CMakeLists.txt"):
            # find_package(包名 ...)
            find_matches = re.findall(
                r'find_package\s*\(\s*(\w+)', content,
            )
            ros_deps.extend(find_matches)
            # catkin_package(DEPENDS 包名 ...)
            catkin_matches = re.findall(
                r'catkin_package\s*\([^)]*DEPENDS\s+([^)]+)\)', content,
            )
            for match in catkin_matches:
                ros_deps.extend([d.strip() for d in match.split()])

        # 从 C++ 代码提取 ROS 头文件引用
        if file_path.endswith((".cpp", ".cc", ".cxx", ".h", ".hpp", ".hxx")):
            # #include <ros/ros.h> → ros
            ros_include = re.findall(r'#include\s*<\s*(\w+)/', content)
            ros_deps.extend(ros_include)

        # 从 Python 代码提取 ROS 导入
        if file_path.endswith(".py"):
            ros_imports = re.findall(
                r'(?:from|import)\s+(rospy|roscpp|roslib|rosmsg|rossrv|rosbag|'
                r'tf|tf2|actionlib|std_msgs|sensor_msgs|geometry_msgs|'
                r'nav_msgs|visualization_msgs|trajectory_msgs|control_msgs)',
                content,
            )
            ros_deps.extend(ros_imports)

        # 去重并过滤常见非 ROS 包
        ros_deps = list(set(ros_deps))
        non_ros = {"catkin", "ament_cmake", "rosidl_default_generators"}
        ros_deps = [d for d in ros_deps if d not in non_ros]

        return ros_deps

    def _analyze_header_references(
        self,
        file_path: str,
        content: str,
    ) -> List[str]:
        """
        分析头文件引用关系
        参数：
          file_path: 文件路径
          content: 文件内容
        返回值：引用的头文件列表
        运行步骤：
          1. 提取 C++ 的 #include 指令
          2. 提取 Python 的 import 语句
          3. 区分系统头文件与项目头文件
        """
        header_refs = []

        if file_path.endswith((".cpp", ".cc", ".cxx", ".h", ".hpp", ".hxx")):
            # 提取所有 #include 指令
            includes = re.findall(
                r'#include\s*[<"]([^>"]+)[>"]',
                content,
            )
            header_refs.extend(includes)

        if file_path.endswith(".py"):
            # 提取 import 语句
            imports = re.findall(
                r'(?:from|import)\s+([\w.]+)',
                content,
            )
            header_refs.extend(imports)

        return list(set(header_refs))

    def _analyze_interface_callers(
        self,
        file_path: str,
        content: str,
    ) -> List[str]:
        """
        分析接口调用关系
        参数：
          file_path: 文件路径
          content: 文件内容
        返回值：接口调用方列表（函数/方法名）
        运行步骤：
          1. 提取 C++ 函数调用模式
          2. 提取 Python 函数调用模式
          3. 提取 ROS 服务/话题调用
        """
        callers = []

        if file_path.endswith((".cpp", ".cc", ".cxx", ".h", ".hpp", ".hxx")):
            # 提取函数调用：identifier( 模式
            func_calls = re.findall(
                r'(?:->|\.)?(\w+)\s*\(',
                content,
            )
            callers.extend(func_calls)

            # 提取 ROS 发布/订阅调用
            ros_calls = re.findall(
                r'(advertise|subscribe|advertiseService|callService|'
                r'create_publisher|create_subscription|create_service|'
                r'create_client)\s*[<\(]',
                content,
            )
            callers.extend(ros_calls)

        if file_path.endswith(".py"):
            # 提取函数调用
            func_calls = re.findall(
                r'\.(\w+)\s*\(|(\w+)\s*\(',  # 修正：匹配 .method() 和 function()
                content,
            )
            # 展平元组结果
            for match in func_calls:
                for m in match:
                    if m:
                        callers.append(m)

            # 提取 ROS Python 调用
            ros_calls = re.findall(
                r'(Publisher|Subscriber|ServiceProxy|Service|'
                r'create_publisher|create_subscription)\s*\(',
                content,
            )
            callers.extend(ros_calls)

        return list(set(callers))

    def _analyze_dependent_modules(self, file_path: str) -> List[str]:
        """
        分析依赖该文件的模块列表
        参数：
          file_path: 文件路径
        返回值：依赖模块名称列表
        运行步骤：
          1. 根据文件路径推断所属 ROS 包
          2. 搜索其他文件中对该文件的引用
          3. 返回依赖模块列表
        """
        dependent_modules = []

        # 从文件路径推断 ROS 包名
        path_parts = Path(file_path).parts
        # 查找 src 目录，其父目录通常为 ROS 包
        for i, part in enumerate(path_parts):
            if part == "src" and i > 0:
                pkg_name = path_parts[i - 1]
                dependent_modules.append(pkg_name)
                break

        # 如果文件在 include 目录下，同样推断包名
        for i, part in enumerate(path_parts):
            if part == "include" and i > 0:
                pkg_name = path_parts[i - 1]
                if pkg_name not in dependent_modules:
                    dependent_modules.append(pkg_name)
                break

        return dependent_modules

    def _evaluate_impact_level(
        self,
        file_path: str,
        content: str,
        ros_deps: List[str],
        header_refs: List[str],
        interface_callers: List[str],
    ) -> str:
        """
        综合评估文件变更的影响级别
        参数：
          file_path: 文件路径
          content: 文件内容
          ros_deps: ROS 依赖列表
          header_refs: 头文件引用列表
          interface_callers: 接口调用方列表
        返回值：影响级别字符串
        运行步骤：
          1. 检查是否为高风险模块（安全/控制相关）
          2. 检查是否涉及核心接口变更
          3. 检查是否为轻微变更（注释/格式）
          4. 综合评分确定影响级别
        """
        file_name = os.path.basename(file_path).lower()

        # 高风险模块检测：安全、控制、核心算法相关文件
        high_risk_patterns = [
            "security", "safety", "control", "controller",
            "pid", "motor", "actuator", "brake", "emergency",
            "collision", "obstacle", "navigation", "planner",
            "trajectory", "motion", "velocity", "position",
        ]
        is_high_risk = any(
            pattern in file_name or pattern in file_path.lower()
            for pattern in high_risk_patterns
        )

        # 核心接口检测：头文件、接口定义文件
        core_interface_patterns = [
            ".h", ".hpp", ".hxx",  # C++ 头文件
            "__init__.py",         # Python 包初始化
            "interface", "api", "msg", "srv", "action",  # 接口相关
        ]
        is_core_interface = any(
            file_name.endswith(ext) or pattern in file_name
            for ext in core_interface_patterns[:3]
            for pattern in core_interface_patterns
        )

        # 轻微变更检测：仅注释/文档/格式变更
        # 通过检查代码行中非注释行的比例来判断
        lines = content.split("\n")
        non_empty_lines = [l for l in lines if l.strip()]
        if non_empty_lines:
            comment_lines = sum(
                1 for l in non_empty_lines
                if l.strip().startswith(("#", "//", "/*", "*", "'''", '"""'))
            )
            comment_ratio = comment_lines / len(non_empty_lines)
            if comment_ratio > 0.8:
                return ImpactLevel.NO_IMPACT.value

        # 根据依赖和引用数量辅助判断
        total_deps = len(ros_deps) + len(header_refs) + len(interface_callers)

        if is_high_risk:
            return ImpactLevel.HIGH_RISK_MODULE.value
        elif is_core_interface or total_deps > 10:
            return ImpactLevel.CORE_IMPACT.value
        elif total_deps > 3:
            return ImpactLevel.MINOR_IMPACT.value
        else:
            return ImpactLevel.NO_IMPACT.value

    def _save_impact_to_db(self, result: ImpactAnalysisResult):
        """
        将影响分析结果持久化到 SQLite
        参数：
          result: 影响分析结果对象
        """
        conn = sqlite3.connect(self._db_path)
        conn.execute(
            """INSERT INTO impact_analyses
               (file_path, impact_level, ros_dependencies, header_references,
                interface_callers, dependent_modules, analysis_time)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                result.file_path,
                result.impact_level,
                json.dumps(result.ros_dependencies, ensure_ascii=False),
                json.dumps(result.header_references, ensure_ascii=False),
                json.dumps(result.interface_callers, ensure_ascii=False),
                json.dumps(result.dependent_modules, ensure_ascii=False),
                result.analysis_time,
            ),
        )
        conn.commit()
        conn.close()

    # ============================================================
    # 影响分级
    # ============================================================

    def classify_impact(
        self,
        modified_files: List[str],
    ) -> Dict[str, Any]:
        """
        将变更文件按影响级别分类
        参数：
          modified_files: 已修改的文件路径列表
        返回值：
          {
            "success": bool,                          # 是否分类成功
            "classification": {                       # 分级结果
              "no_impact": List[str],                 # 无影响文件
              "minor_impact": List[str],              # 轻微影响文件
              "core_impact": List[str],               # 核心影响文件
              "high_risk_module": List[str],          # 高风险模块文件
            },
            "summary": str,                           # 分类摘要
          }
        运行步骤：
          1. 对每个文件执行影响分析
          2. 按影响级别分组
          3. 生成分类摘要
        """
        # 先执行影响分析
        impact_results = self.analyze_impact(modified_files)

        classification = {
            ImpactLevel.NO_IMPACT.value: [],
            ImpactLevel.MINOR_IMPACT.value: [],
            ImpactLevel.CORE_IMPACT.value: [],
            ImpactLevel.HIGH_RISK_MODULE.value: [],
        }

        for result in impact_results:
            level = result["impact_level"]
            if level in classification:
                classification[level].append(result["file_path"])

        # 生成分类摘要
        summary_parts = []
        for level, files in classification.items():
            if files:
                level_names = {
                    ImpactLevel.NO_IMPACT.value: "无影响",
                    ImpactLevel.MINOR_IMPACT.value: "轻微影响",
                    ImpactLevel.CORE_IMPACT.value: "核心影响",
                    ImpactLevel.HIGH_RISK_MODULE.value: "高风险模块",
                }
                summary_parts.append(
                    f"{level_names.get(level, level)}: {len(files)} 个文件"
                )

        summary = "变更分类结果：" + "；".join(summary_parts) if summary_parts else "无变更"

        logger.info(
            "变更影响分级完成 | 无影响=%d | 轻微=%d | 核心=%d | 高风险=%d",
            len(classification[ImpactLevel.NO_IMPACT.value]),
            len(classification[ImpactLevel.MINOR_IMPACT.value]),
            len(classification[ImpactLevel.CORE_IMPACT.value]),
            len(classification[ImpactLevel.HIGH_RISK_MODULE.value]),
        )

        return {
            "success": True,
            "classification": classification,
            "summary": summary,
        }

    # ============================================================
    # 分级重验证
    # ============================================================

    def execute_revalidation(
        self,
        modified_files: List[str],
        impact_level: str = None,
    ) -> List[Dict[str, Any]]:
        """
        根据影响级别执行分级重验证
        参数：
          modified_files: 已修改的文件路径列表
          impact_level: 可选，仅验证指定影响级别的文件
        返回值：重验证结果列表，每项包含：
          {
            "file_path": str,              # 文件路径
            "status": str,                 # 验证状态
            "impact_level": str,           # 影响级别
            "checks_performed": List[str], # 已执行的检查项
            "issues_found": List[str],     # 发现的问题
            "revalidation_time": str,      # 验证时间
          }
        运行步骤（分级重验证策略）：
          - no_impact: 跳过验证（仅注释/格式变更）
          - minor_impact: 基本语法检查 + 编译验证
          - core_impact: 完整单元测试 + 集成测试 + 接口兼容性检查
          - high_risk_module: 全量安全校验 + 边界测试 + 人工审核
        """
        results = []
        now = datetime.now(timezone.utc).isoformat()

        # 先获取影响分析结果
        impact_results = {
            r["file_path"]: r["impact_level"]
            for r in self.analyze_impact(modified_files)
        }

        for file_path in modified_files:
            file_impact = impact_results.get(file_path, ImpactLevel.NO_IMPACT.value)

            # 如果指定了影响级别过滤，跳过不匹配的文件
            if impact_level and file_impact != impact_level:
                continue

            # 根据影响级别确定验证策略
            checks, status = self._get_revalidation_strategy(file_impact)

            result = RevalidationResult(
                file_path=file_path,
                status=status,
                impact_level=file_impact,
                checks_performed=checks,
                issues_found=[],
                revalidation_time=now,
            )

            with self._lock:
                self._revalidation_results[file_path] = result

            # 持久化重验证结果
            self._save_revalidation_to_db(result)

            results.append({
                "file_path": result.file_path,
                "status": result.status,
                "impact_level": result.impact_level,
                "checks_performed": result.checks_performed,
                "issues_found": result.issues_found,
                "revalidation_time": result.revalidation_time,
            })

        logger.info(
            "分级重验证完成 | 验证文件数=%d",
            len(results),
        )

        return results

    def _get_revalidation_strategy(
        self,
        impact_level: str,
    ) -> Tuple[List[str], str]:
        """
        根据影响级别获取重验证策略
        参数：
          impact_level: 影响级别
        返回值：(检查项列表, 验证状态)
        """
        strategies = {
            ImpactLevel.NO_IMPACT.value: (
                ["跳过验证：仅注释/格式变更，无需重验证"],
                RevalidationStatus.SKIPPED.value,
            ),
            ImpactLevel.MINOR_IMPACT.value: (
                [
                    "语法检查（Python: py_compile / C++: g++ -fsyntax-only）",
                    "编译验证（确保代码可编译通过）",
                    "基本代码规范检查（PEP8 / Google C++ Style）",
                ],
                RevalidationStatus.PENDING.value,
            ),
            ImpactLevel.CORE_IMPACT.value: (
                [
                    "完整单元测试执行",
                    "集成测试执行",
                    "接口兼容性检查（API 签名对比）",
                    "依赖模块回归测试",
                    "代码规范全面检查",
                ],
                RevalidationStatus.PENDING.value,
            ),
            ImpactLevel.HIGH_RISK_MODULE.value: (
                [
                    "全量安全校验（三层安全验证）",
                    "边界条件全覆盖测试",
                    "极限值测试",
                    "异常工况测试",
                    "急停逻辑分支全验证",
                    "故障注入测试",
                    "人工安全审核",
                    "仿真/真机验证",
                ],
                RevalidationStatus.PENDING.value,
            ),
        }

        return strategies.get(
            impact_level,
            (["未知影响级别，需人工评估"], RevalidationStatus.PENDING.value),
        )

    def _save_revalidation_to_db(self, result: RevalidationResult):
        """
        将重验证结果持久化到 SQLite
        参数：
          result: 重验证结果对象
        """
        conn = sqlite3.connect(self._db_path)
        conn.execute(
            """INSERT INTO revalidation_results
               (file_path, status, impact_level, checks_performed,
                issues_found, revalidation_time)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                result.file_path,
                result.status,
                result.impact_level,
                json.dumps(result.checks_performed, ensure_ascii=False),
                json.dumps(result.issues_found, ensure_ascii=False),
                result.revalidation_time,
            ),
        )
        conn.commit()
        conn.close()

    # ============================================================
    # 批量变更处理
    # ============================================================

    def handle_batch_changes(
        self,
        modified_files: List[str],
    ) -> Dict[str, Any]:
        """
        批量变更处理：暂停未执行任务，输出影响报告
        参数：
          modified_files: 已修改的文件路径列表
        返回值：
          {
            "success": bool,                    # 是否处理成功
            "total_files": int,                 # 总变更文件数
            "impact_classification": Dict,      # 影响分级结果
            "paused_tasks": List[str],          # 已暂停的任务列表
            "impact_report": str,               # 影响报告文本
            "recommended_actions": List[str],   # 建议操作列表
          }
        运行步骤：
          1. 执行影响分级
          2. 识别受影响的依赖任务
          3. 暂停未执行的相关任务
          4. 生成影响报告
          5. 输出建议操作
        """
        # 步骤 1：影响分级
        classification_result = self.classify_impact(modified_files)
        classification = classification_result["classification"]

        # 步骤 2：识别受影响的依赖任务
        paused_tasks = []
        high_risk_files = classification.get(ImpactLevel.HIGH_RISK_MODULE.value, [])
        core_files = classification.get(ImpactLevel.CORE_IMPACT.value, [])

        # 高风险和核心影响文件需要暂停相关任务
        affected_files = high_risk_files + core_files
        for file_path in affected_files:
            # 标记相关任务为暂停（实际暂停由调度器执行）
            paused_tasks.append(f"task_related_to_{os.path.basename(file_path)}")

        # 步骤 3：生成影响报告
        impact_report = self._generate_impact_report(classification)

        # 步骤 4：生成建议操作
        recommended_actions = self._generate_recommended_actions(classification)

        logger.warning(
            "批量变更处理完成 | 总文件=%d | 高风险=%d | 核心=%d | 暂停任务=%d",
            len(modified_files),
            len(high_risk_files),
            len(core_files),
            len(paused_tasks),
        )

        return {
            "success": True,
            "total_files": len(modified_files),
            "impact_classification": classification,
            "paused_tasks": paused_tasks,
            "impact_report": impact_report,
            "recommended_actions": recommended_actions,
        }

    def _generate_impact_report(
        self,
        classification: Dict[str, List[str]],
    ) -> str:
        """
        生成影响报告文本
        参数：
          classification: 影响分级结果
        返回值：影响报告文本
        """
        report_lines = ["=" * 60, "人工变更影响报告", "=" * 60, ""]

        level_names = {
            ImpactLevel.HIGH_RISK_MODULE.value: "【高风险模块变更】",
            ImpactLevel.CORE_IMPACT.value: "【核心影响变更】",
            ImpactLevel.MINOR_IMPACT.value: "【轻微影响变更】",
            ImpactLevel.NO_IMPACT.value: "【无影响变更】",
        }

        for level, files in classification.items():
            if files:
                report_lines.append(level_names.get(level, level))
                report_lines.append(f"  文件数: {len(files)}")
                for f in files:
                    report_lines.append(f"    - {f}")
                report_lines.append("")

        report_lines.append(f"报告生成时间: {datetime.now(timezone.utc).isoformat()}")
        report_lines.append("=" * 60)

        return "\n".join(report_lines)

    def _generate_recommended_actions(
        self,
        classification: Dict[str, List[str]],
    ) -> List[str]:
        """
        根据影响分级生成建议操作列表
        参数：
          classification: 影响分级结果
        返回值：建议操作列表
        """
        actions = []

        if classification.get(ImpactLevel.HIGH_RISK_MODULE.value):
            actions.append(
                "高风险模块变更：立即暂停所有相关下游任务，"
                "执行全量安全校验与人工审核"
            )
        if classification.get(ImpactLevel.CORE_IMPACT.value):
            actions.append(
                "核心影响变更：执行完整单元测试与集成测试，"
                "验证接口兼容性"
            )
        if classification.get(ImpactLevel.MINOR_IMPACT.value):
            actions.append(
                "轻微影响变更：执行基本编译验证与代码规范检查"
            )
        if classification.get(ImpactLevel.NO_IMPACT.value):
            actions.append(
                "无影响变更：可跳过重验证，直接更新哈希基线"
            )

        if not actions:
            actions.append("无变更文件，无需操作")

        return actions

    # ============================================================
    # 告警推送
    # ============================================================

    def send_alert(self, change_info: Dict[str, Any]) -> Dict[str, Any]:
        """
        推送变更告警通知（核心逻辑/安全变更时触发）
        参数：
          change_info: 变更信息字典，包含：
            - modified_files: List[str]，变更文件列表
            - impact_level: str，影响级别
            - details: str，变更详情描述
        返回值：
          {
            "success": bool,          # 是否推送成功
            "alert_sent": bool,       # 是否发送了告警
            "alert_level": str,       # 告警级别
            "message": str,           # 结果消息
          }
        运行步骤：
          1. 检查变更影响级别
          2. 仅对核心影响和高风险模块发送告警
          3. 构造告警消息
          4. 通过配置的通知渠道发送
          5. 调用注册的告警回调函数
        """
        impact_level = change_info.get("impact_level", "")
        modified_files = change_info.get("modified_files", [])

        # 仅对核心影响和高风险模块发送告警
        alert_levels = [
            ImpactLevel.CORE_IMPACT.value,
            ImpactLevel.HIGH_RISK_MODULE.value,
        ]

        if impact_level not in alert_levels:
            return {
                "success": True,
                "alert_sent": False,
                "alert_level": impact_level,
                "message": f"影响级别 '{impact_level}' 不需要发送告警",
            }

        # 构造告警消息
        alert_msg = {
            "type": "manual_change_alert",
            "impact_level": impact_level,
            "modified_files": modified_files,
            "file_count": len(modified_files),
            "details": change_info.get("details", ""),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        # 获取通知配置
        notification_config = settings.notification
        channel = notification_config.get("channel", "log_only")

        # 通过日志记录告警
        logger.warning(
            "人工变更告警 | level=%s | files=%d | channel=%s",
            impact_level,
            len(modified_files),
            channel,
        )

        # 调用注册的告警回调函数
        for callback in self._alert_callbacks:
            try:
                callback(alert_msg)
            except Exception as e:
                logger.error("告警回调执行失败 | error=%s", e)

        return {
            "success": True,
            "alert_sent": True,
            "alert_level": impact_level,
            "message": (
                f"已通过 {channel} 渠道发送 {impact_level} 级别告警，"
                f"涉及 {len(modified_files)} 个文件"
            ),
        }

    def register_alert_callback(
        self,
        callback: Callable[[Dict[str, Any]], None],
    ):
        """
        注册告警回调函数
        参数：
          callback: 告警回调函数，接收告警消息字典作为参数
        """
        self._alert_callbacks.append(callback)
        logger.info("告警回调已注册 | 当前回调数=%d", len(self._alert_callbacks))

    # ============================================================
    # 记忆库同步
    # ============================================================

    def sync_memory_store(self) -> Dict[str, Any]:
        """
        重验证通过后同步更新代码到记忆库
        返回值：
          {
            "success": bool,              # 是否同步成功
            "synced_files": int,          # 已同步的文件数
            "skipped_files": int,         # 跳过的文件数
            "message": str,               # 结果消息
          }
        运行步骤：
          1. 遍历所有重验证结果
          2. 筛选验证通过的文件
          3. 读取文件内容
          4. 调用 MemoryStore 入库
          5. 统计同步结果
        """
        synced_count = 0
        skipped_count = 0

        try:
            from backend.app.services.memory_store import memory_store
        except ImportError:
            logger.warning("MemoryStore 不可用，跳过记忆库同步")
            return {
                "success": False,
                "synced_files": 0,
                "skipped_files": 0,
                "message": "MemoryStore 不可用，无法同步",
            }

        with self._lock:
            for file_path, result in self._revalidation_results.items():
                # 仅同步验证通过的文件
                if result.status != RevalidationStatus.PASSED.value:
                    skipped_count += 1
                    continue

                # 跳过非代码文件
                code_extensions = (
                    ".py", ".cpp", ".cc", ".cxx", ".c", ".h", ".hpp", ".hxx",
                    ".js", ".ts", ".jsx", ".tsx",
                )
                if not any(file_path.endswith(ext) for ext in code_extensions):
                    skipped_count += 1
                    continue

                try:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        code = f.read()

                    # 检测编程语言
                    language = self._detect_language(file_path)

                    # 入库到记忆库
                    memory_store.ingest_from_task_result(
                        code=code,
                        language=language,
                        source=f"manual_change:{file_path}",
                        task_id="",
                    )
                    synced_count += 1
                    logger.info("记忆库同步成功 | file=%s", file_path)
                except (IOError, OSError) as e:
                    logger.error("记忆库同步失败 | file=%s | error=%s", file_path, e)
                    skipped_count += 1

        logger.info(
            "记忆库同步完成 | 已同步=%d | 已跳过=%d",
            synced_count,
            skipped_count,
        )

        return {
            "success": True,
            "synced_files": synced_count,
            "skipped_files": skipped_count,
            "message": f"记忆库同步完成：已同步 {synced_count} 个文件，跳过 {skipped_count} 个文件",
        }

    @staticmethod
    def _detect_language(file_path: str) -> str:
        """
        根据文件扩展名检测编程语言
        参数：
          file_path: 文件路径
        返回值：编程语言名称
        """
        ext_map = {
            ".py": "python",
            ".cpp": "cpp",
            ".cc": "cpp",
            ".cxx": "cpp",
            ".c": "c",
            ".h": "cpp",
            ".hpp": "cpp",
            ".hxx": "cpp",
            ".js": "javascript",
            ".ts": "typescript",
            ".jsx": "javascript",
            ".tsx": "typescript",
        }
        ext = Path(file_path).suffix.lower()
        return ext_map.get(ext, "")

    # ============================================================
    # 统计与查询
    # ============================================================

    def get_detection_history(
        self,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """
        获取变更检测历史记录
        参数：
          limit: 返回记录数量上限
        返回值：检测历史记录列表
        """
        conn = sqlite3.connect(self._db_path)
        rows = conn.execute(
            """SELECT modified_files, added_files, deleted_files,
               unchanged_count, detection_time
               FROM change_detections
               ORDER BY detection_time DESC
               LIMIT ?""",
            (limit,),
        ).fetchall()
        conn.close()

        history = []
        for row in rows:
            try:
                modified = json.loads(row[0]) if row[0] else []
            except json.JSONDecodeError:
                modified = []
            try:
                added = json.loads(row[1]) if row[1] else []
            except json.JSONDecodeError:
                added = []
            try:
                deleted = json.loads(row[2]) if row[2] else []
            except json.JSONDecodeError:
                deleted = []

            history.append({
                "modified_files": modified,
                "added_files": added,
                "deleted_files": deleted,
                "unchanged_count": row[3],
                "detection_time": row[4],
                "total_changes": len(modified) + len(added) + len(deleted),
            })

        return history

    def get_baseline_stats(self) -> Dict[str, Any]:
        """
        获取哈希基线统计信息
        返回值：
          {
            "total_files": int,         # 基线文件总数
            "watch_paths": List[str],   # 监控路径列表
            "last_detection": Optional[Dict],  # 最近一次检测结果
          }
        """
        last_detection = None
        if self._last_detection:
            last_detection = {
                "modified_count": len(self._last_detection.modified_files),
                "added_count": len(self._last_detection.added_files),
                "deleted_count": len(self._last_detection.deleted_files),
                "unchanged_count": len(self._last_detection.unchanged_files),
                "detection_time": self._last_detection.detection_time,
            }

        return {
            "total_files": len(self._hash_baseline),
            "watch_paths": self._watch_paths,
            "last_detection": last_detection,
        }


# 全局人工变更检测器单例
manual_change_detector = ManualChangeDetector()
