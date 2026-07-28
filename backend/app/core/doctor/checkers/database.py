"""
# ============================================================
# Database Checker - 数据库检查
# ============================================================
# 检查项：connection / migration / tables / indexes / size / wal_mode
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P2-2 新建
# ============================================================
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import List

from ..base import (
    BaseChecker,
    CheckItem,
    CheckStatus,
)


class DatabaseChecker(BaseChecker):
    """数据库检查器"""

    category = "database"
    title = "数据库"
    default_timeout = 10.0

    # 核心表名（应存在）
    CORE_TABLES = [
        "users", "projects", "agents", "sessions", "tasks",
    ]

    def run_checks(self) -> List[CheckItem]:
        items: List[CheckItem] = []
        items.append(self._check_connection())
        items.append(self._check_tables())
        items.append(self._check_migration())
        items.append(self._check_indexes())
        items.append(self._check_size())
        items.append(self._check_wal_mode())
        return items

    def _get_db_path(self) -> Path:
        """获取 SQLite 数据库路径"""
        env_path = os.environ.get("HERMES_DB_PATH")
        if env_path:
            return Path(env_path)
        return self.hermes_home / "data" / "hermes.db"

    def _check_connection(self) -> CheckItem:
        """数据库连接检查"""
        db_path = self._get_db_path()
        if not db_path.exists():
            return self.make_item(
                check_id="database.connection",
                name="Database Connection",
                description="数据库连接",
                status=CheckStatus.WARNING.value,
                value=str(db_path),
                message=f"数据库文件不存在: {db_path}（首次启动时会自动创建）",
                fix_suggestion="启动后端服务以初始化数据库",
            )
        try:
            conn = sqlite3.connect(str(db_path), timeout=2.0)
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            result = cursor.fetchone()
            conn.close()
            if result and result[0] == 1:
                return self.make_item(
                    check_id="database.connection",
                    name="Database Connection",
                    description="数据库连接",
                    status=CheckStatus.OK.value,
                    value=str(db_path),
                    message=f"数据库连接成功: {db_path}",
                )
            return self.make_item(
                check_id="database.connection",
                name="Database Connection",
                description="数据库连接",
                status=CheckStatus.ERROR.value,
                message="SELECT 1 返回异常",
            )
        except Exception as e:
            return self.make_item(
                check_id="database.connection",
                name="Database Connection",
                description="数据库连接",
                status=CheckStatus.ERROR.value,
                message=f"连接失败: {e}",
                fix_suggestion="检查数据库文件权限和路径",
            )

    def _check_tables(self) -> CheckItem:
        """核心表检查"""
        db_path = self._get_db_path()
        if not db_path.exists():
            return self.make_item(
                check_id="database.tables",
                name="Core Tables",
                description="核心数据表",
                status=CheckStatus.SKIPPED.value,
                message="数据库文件不存在",
            )
        try:
            conn = sqlite3.connect(str(db_path), timeout=2.0)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            existing_tables = {row[0] for row in cursor.fetchall()}
            conn.close()
            missing = [t for t in self.CORE_TABLES if t not in existing_tables]
            if not missing:
                return self.make_item(
                    check_id="database.tables",
                    name="Core Tables",
                    description="核心数据表",
                    status=CheckStatus.OK.value,
                    value=f"{len(self.CORE_TABLES)}/{len(self.CORE_TABLES)}",
                    message=f"所有核心表存在: {', '.join(self.CORE_TABLES)}",
                )
            return self.make_item(
                check_id="database.tables",
                name="Core Tables",
                description="核心数据表",
                status=CheckStatus.ERROR.value,
                value=f"{len(self.CORE_TABLES) - len(missing)}/{len(self.CORE_TABLES)}",
                message=f"缺失表: {', '.join(missing)}",
                fix_suggestion="alembic upgrade head",
            )
        except Exception as e:
            return self.make_item(
                check_id="database.tables",
                name="Core Tables",
                description="核心数据表",
                status=CheckStatus.ERROR.value,
                message=f"查询失败: {e}",
            )

    def _check_migration(self) -> CheckItem:
        """迁移状态检查"""
        alembic_dir = self.hermes_home / "data" / "alembic"
        if not alembic_dir.exists():
            return self.make_item(
                check_id="database.migration",
                name="Alembic Migration",
                description="数据库迁移版本",
                status=CheckStatus.WARNING.value,
                message="未检测到 alembic 目录",
            )
        version_file = alembic_dir / "version"
        if version_file.exists() and any(version_file.iterdir()):
            return self.make_item(
                check_id="database.migration",
                name="Alembic Migration",
                description="数据库迁移版本",
                status=CheckStatus.OK.value,
                message="alembic 版本目录存在",
            )
        return self.make_item(
            check_id="database.migration",
            name="Alembic Migration",
            description="数据库迁移版本",
            status=CheckStatus.WARNING.value,
            message="alembic 目录为空",
            fix_suggestion="alembic upgrade head",
        )

    def _check_indexes(self) -> CheckItem:
        """索引检查"""
        db_path = self._get_db_path()
        if not db_path.exists():
            return self.make_item(
                check_id="database.indexes",
                name="Database Indexes",
                description="数据库索引",
                status=CheckStatus.SKIPPED.value,
                message="数据库文件不存在",
            )
        try:
            conn = sqlite3.connect(str(db_path), timeout=2.0)
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='index'")
            index_count = cursor.fetchone()[0]
            conn.close()
            status = CheckStatus.OK.value if index_count >= 5 else CheckStatus.WARNING.value
            return self.make_item(
                check_id="database.indexes",
                name="Database Indexes",
                description="数据库索引",
                status=status,
                value=f"{index_count} indexes",
                expected=">= 5",
                message=f"共 {index_count} 个索引",
                fix_suggestion="alembic upgrade head" if index_count < 5 else None,
            )
        except Exception as e:
            return self.make_item(
                check_id="database.indexes",
                name="Database Indexes",
                description="数据库索引",
                status=CheckStatus.ERROR.value,
                message=f"查询失败: {e}",
            )

    def _check_size(self) -> CheckItem:
        """数据库大小检查"""
        db_path = self._get_db_path()
        if not db_path.exists():
            return self.make_item(
                check_id="database.size",
                name="Database Size",
                description="数据库文件大小",
                status=CheckStatus.SKIPPED.value,
                message="数据库文件不存在",
            )
        size_bytes = db_path.stat().st_size
        size_mb = size_bytes / (1024 ** 2)
        ok = size_mb < 1024  # < 1GB
        return self.make_item(
            check_id="database.size",
            name="Database Size",
            description="数据库文件大小",
            status=CheckStatus.OK.value if ok else CheckStatus.WARNING.value,
            value=f"{size_mb:.2f} MB",
            expected="< 1024 MB",
            message=f"数据库大小: {size_mb:.2f} MB",
            fix_suggestion="归档历史数据" if not ok else None,
        )

    def _check_wal_mode(self) -> CheckItem:
        """WAL 模式检查"""
        db_path = self._get_db_path()
        if not db_path.exists():
            return self.make_item(
                check_id="database.wal_mode",
                name="WAL Mode",
                description="SQLite WAL 模式",
                status=CheckStatus.SKIPPED.value,
                message="数据库文件不存在",
            )
        try:
            conn = sqlite3.connect(str(db_path), timeout=2.0)
            cursor = conn.cursor()
            cursor.execute("PRAGMA journal_mode")
            mode = cursor.fetchone()[0]
            conn.close()
            ok = mode.lower() == "wal"
            return self.make_item(
                check_id="database.wal_mode",
                name="WAL Mode",
                description="SQLite WAL 模式",
                status=CheckStatus.OK.value if ok else CheckStatus.WARNING.value,
                value=mode,
                expected="wal",
                message=f"当前模式: {mode}",
                fix_suggestion="PRAGMA journal_mode=WAL" if not ok else None,
            )
        except Exception as e:
            return self.make_item(
                check_id="database.wal_mode",
                name="WAL Mode",
                description="SQLite WAL 模式",
                status=CheckStatus.ERROR.value,
                message=f"查询失败: {e}",
            )
