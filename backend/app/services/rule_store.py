"""
# ============================================================
# Rule Store - TRACE 规则持久化（Cycle 7 P0-11）
# ============================================================
# 核心作用：使用 SQLite 存储 TRACE 编译后的可执行规则
#           支持 session/user/global 三种 scope
#           记录 hit_count / violation_count 统计
# 设计要点：
#   1. SQLite WAL 模式：支持并发读 + 单写
#   2. 三种 scope 隔离：session（当前会话） / user（用户级） / global（全局）
#   3. 命中/违规统计：评估规则有效性的关键指标
#   4. 自动 disable：连续误报自动停用
# 运行流程：
#   1. add_rule() → INSERT + 返回 rule_id
#   2. get_active_rules(session_id) → SELECT WHERE is_active=1
#   3. record_hit(rule_id) / record_violation(rule_id) → UPDATE stats
#   4. auto_disable_check(rule_id) → 若 violation_count > 5×hit_count 自动停用
# 输入参数：见各函数
# 输出结果：CompiledRule dataclass 实例
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 7 P0-11 新建
# ============================================================
"""

import json
import logging
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ============================================================
# Enums
# ============================================================
class RuleScope(str, Enum):
    """规则作用域"""
    SESSION = "session"  # 当前会话
    USER = "user"        # 用户级（跨 session）
    GLOBAL = "global"    # 全局（所有用户）


class RuleTier(int, Enum):
    """规则层级（执行顺序）"""
    TIER_1_DETERMINISTIC = 1  # 正则/路径匹配
    TIER_2_SEMANTIC = 2       # 模型语义检查
    TIER_3_INTENT = 3         # 提示级提醒


class RuleType(str, Enum):
    """规则类型"""
    PATTERN = "pattern"        # 工具调用模式
    FILE_PATH = "file_path"    # 文件路径模式
    CODE_STYLE = "code_style"  # 代码风格
    INTENT = "intent"          # 意图级提醒


# ============================================================
# Dataclasses
# ============================================================
@dataclass
class CompiledRule:
    """编译后的可执行规则"""
    rule_id: str
    session_id: str
    scope: str  # 'session' | 'user' | 'global'
    tier: int   # 1/2/3
    rule_type: str  # 'pattern'/'file_path'/'code_style'/'intent'
    rule_data: Dict[str, Any]
    original_message: str
    source_message_id: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    is_active: bool = True
    hit_count: int = 0
    violation_count: int = 0
    last_hit_at: Optional[float] = None
    last_violation_at: Optional[float] = None
    priority: int = 5  # 1-10, 默认 5

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CompiledRule":
        return cls(**data)

    @classmethod
    def from_db_row(cls, row: sqlite3.Row) -> "CompiledRule":
        return cls(
            rule_id=row["rule_id"],
            session_id=row["session_id"],
            scope=row["scope"],
            tier=row["tier"],
            rule_type=row["rule_type"],
            rule_data=json.loads(row["rule_data"]),
            original_message=row["original_message"],
            source_message_id=row["source_message_id"],
            created_at=row["created_at"],
            is_active=bool(row["is_active"]),
            hit_count=row["hit_count"],
            violation_count=row["violation_count"],
            last_hit_at=row["last_hit_at"],
            last_violation_at=row["last_violation_at"],
            priority=row["priority"],
        )


# ============================================================
# RuleStore
# ============================================================
class RuleStore:
    """SQLite 规则存储"""

    # 自动 disable 阈值: violation_count >= hit_count * multiplier
    AUTO_DISABLE_MULTIPLIER = 3
    AUTO_DISABLE_MIN_VIOLATIONS = 5

    def __init__(self, db_path: str = "/tmp/trace_rules.db"):
        self.db_path = db_path
        self._lock = threading.RLock()
        self._init_db()

    def _init_db(self):
        """初始化数据库 schema"""
        with self._conn() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS compiled_rules (
                    rule_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    tier INTEGER NOT NULL,
                    rule_type TEXT NOT NULL,
                    rule_data JSON NOT NULL,
                    original_message TEXT NOT NULL,
                    source_message_id TEXT,
                    created_at REAL NOT NULL,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    hit_count INTEGER NOT NULL DEFAULT 0,
                    violation_count INTEGER NOT NULL DEFAULT 0,
                    last_hit_at REAL,
                    last_violation_at REAL,
                    priority INTEGER NOT NULL DEFAULT 5
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_session_active
                ON compiled_rules (session_id, is_active)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_scope
                ON compiled_rules (scope, is_active)
            """)
            conn.commit()
        logger.info(f"RuleStore initialized: {self.db_path}")

    @contextmanager
    def _conn(self):
        """获取数据库连接（线程安全）"""
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    # ============================================================
    # CRUD
    # ============================================================
    def add_rule(self, rule: CompiledRule) -> str:
        """添加规则，返回 rule_id"""
        with self._lock, self._conn() as conn:
            conn.execute("""
                INSERT INTO compiled_rules
                (rule_id, session_id, scope, tier, rule_type, rule_data,
                 original_message, source_message_id, created_at, is_active,
                 hit_count, violation_count, last_hit_at, last_violation_at, priority)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                rule.rule_id, rule.session_id, rule.scope, rule.tier,
                rule.rule_type, json.dumps(rule.rule_data),
                rule.original_message, rule.source_message_id, rule.created_at,
                1 if rule.is_active else 0,
                rule.hit_count, rule.violation_count,
                rule.last_hit_at, rule.last_violation_at, rule.priority,
            ))
            conn.commit()
        logger.info(f"Rule added: {rule.rule_id} tier={rule.tier} type={rule.rule_type}")
        return rule.rule_id

    def get_rule(self, rule_id: str) -> Optional[CompiledRule]:
        """获取单条规则"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM compiled_rules WHERE rule_id = ?", (rule_id,)
            ).fetchone()
        return CompiledRule.from_db_row(row) if row else None

    def get_active_rules(
        self,
        session_id: str,
        include_user_scope: bool = True,
        include_global_scope: bool = True,
    ) -> List[CompiledRule]:
        """获取 session + user + global 所有 active 规则

        规则作用域语义:
        - session: 仅当前 session_id 的规则
        - user:    所有 scope='user' 的规则 (用户级, 跨 session)
        - global:  所有 scope='global' 的规则 (全局, 跨用户)
        """
        scope_clauses = ["(scope = 'session' AND session_id = ?)"]
        params: List[Any] = [session_id]
        if include_user_scope:
            scope_clauses.append("scope = 'user'")
        if include_global_scope:
            scope_clauses.append("scope = 'global'")

        where = " OR ".join(scope_clauses)
        with self._conn() as conn:
            rows = conn.execute(f"""
                SELECT * FROM compiled_rules
                WHERE ({where}) AND is_active = 1
                ORDER BY tier ASC, priority DESC
            """, params).fetchall()
        return [CompiledRule.from_db_row(row) for row in rows]

    def list_rules(
        self,
        session_id: Optional[str] = None,
        include_inactive: bool = False,
    ) -> List[CompiledRule]:
        """列出规则（默认仅 active）"""
        with self._conn() as conn:
            if session_id:
                if include_inactive:
                    rows = conn.execute(
                        "SELECT * FROM compiled_rules WHERE session_id = ? ORDER BY created_at DESC",
                        (session_id,),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT * FROM compiled_rules WHERE session_id = ? AND is_active = 1 ORDER BY created_at DESC",
                        (session_id,),
                    ).fetchall()
            else:
                if include_inactive:
                    rows = conn.execute(
                        "SELECT * FROM compiled_rules ORDER BY created_at DESC"
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT * FROM compiled_rules WHERE is_active = 1 ORDER BY created_at DESC"
                    ).fetchall()
        return [CompiledRule.from_db_row(row) for row in rows]

    def deactivate_rule(self, rule_id: str) -> bool:
        """停用规则"""
        with self._lock, self._conn() as conn:
            cur = conn.execute(
                "UPDATE compiled_rules SET is_active = 0 WHERE rule_id = ?", (rule_id,)
            )
            conn.commit()
        return cur.rowcount > 0

    def delete_rule(self, rule_id: str) -> bool:
        """物理删除规则"""
        with self._lock, self._conn() as conn:
            cur = conn.execute(
                "DELETE FROM compiled_rules WHERE rule_id = ?", (rule_id,)
            )
            conn.commit()
        return cur.rowcount > 0

    def clear_session(self, session_id: str) -> int:
        """清空 session 所有规则"""
        with self._lock, self._conn() as conn:
            cur = conn.execute(
                "DELETE FROM compiled_rules WHERE session_id = ? AND scope = 'session'",
                (session_id,),
            )
            conn.commit()
        return cur.rowcount

    # ============================================================
    # 统计
    # ============================================================
    def record_hit(self, rule_id: str) -> None:
        """记录规则被命中（用于评估）"""
        now = time.time()
        with self._lock, self._conn() as conn:
            conn.execute("""
                UPDATE compiled_rules
                SET hit_count = hit_count + 1, last_hit_at = ?
                WHERE rule_id = ?
            """, (now, rule_id))
            conn.commit()
        self._auto_disable_check(rule_id)

    def record_violation(self, rule_id: str) -> None:
        """记录规则被违反"""
        now = time.time()
        with self._lock, self._conn() as conn:
            conn.execute("""
                UPDATE compiled_rules
                SET violation_count = violation_count + 1, last_violation_at = ?
                WHERE rule_id = ?
            """, (now, rule_id))
            conn.commit()
        self._auto_disable_check(rule_id)

    def _auto_disable_check(self, rule_id: str) -> None:
        """自动 disable 检测：violations >= multiplier * hits 且 violations >= min"""
        rule = self.get_rule(rule_id)
        if not rule or not rule.is_active:
            return
        if (rule.violation_count >= self.AUTO_DISABLE_MIN_VIOLATIONS and
                rule.violation_count >= self.AUTO_DISABLE_MULTIPLIER * max(rule.hit_count, 1)):
            self.deactivate_rule(rule_id)
            logger.warning(
                f"Rule {rule_id} auto-disabled: violations={rule.violation_count}, hits={rule.hit_count}"
            )

    def get_stats(self, session_id: Optional[str] = None) -> Dict[str, Any]:
        """获取统计信息"""
        with self._conn() as conn:
            if session_id:
                total = conn.execute(
                    "SELECT COUNT(*) FROM compiled_rules WHERE session_id = ?", (session_id,)
                ).fetchone()[0]
                active = conn.execute(
                    "SELECT COUNT(*) FROM compiled_rules WHERE session_id = ? AND is_active = 1", (session_id,)
                ).fetchone()[0]
                hits = conn.execute(
                    "SELECT COALESCE(SUM(hit_count), 0) FROM compiled_rules WHERE session_id = ?", (session_id,)
                ).fetchone()[0]
                violations = conn.execute(
                    "SELECT COALESCE(SUM(violation_count), 0) FROM compiled_rules WHERE session_id = ?", (session_id,)
                ).fetchone()[0]
                by_tier = conn.execute("""
                    SELECT tier, COUNT(*) FROM compiled_rules
                    WHERE session_id = ? AND is_active = 1
                    GROUP BY tier
                """, (session_id,)).fetchall()
            else:
                total = conn.execute("SELECT COUNT(*) FROM compiled_rules").fetchone()[0]
                active = conn.execute("SELECT COUNT(*) FROM compiled_rules WHERE is_active = 1").fetchone()[0]
                hits = conn.execute("SELECT COALESCE(SUM(hit_count), 0) FROM compiled_rules").fetchone()[0]
                violations = conn.execute("SELECT COALESCE(SUM(violation_count), 0) FROM compiled_rules").fetchone()[0]
                by_tier = conn.execute("""
                    SELECT tier, COUNT(*) FROM compiled_rules
                    WHERE is_active = 1
                    GROUP BY tier
                """).fetchall()
        return {
            "total_rules": total,
            "active_rules": active,
            "total_hits": hits,
            "total_violations": violations,
            "violation_rate": round(violations / max(hits + violations, 1), 4),
            "by_tier": {row[0]: row[1] for row in by_tier},
        }


# ============================================================
# Singleton accessor
# ============================================================
_store_instance: Optional[RuleStore] = None
_store_lock = threading.Lock()


def get_rule_store(db_path: Optional[str] = None) -> RuleStore:
    """获取 RuleStore 单例"""
    global _store_instance
    with _store_lock:
        if _store_instance is None:
            _store_instance = RuleStore(db_path or "/tmp/trace_rules.db")
        return _store_instance


def reset_rule_store() -> None:
    """重置单例（用于测试）"""
    global _store_instance
    with _store_lock:
        _store_instance = None
