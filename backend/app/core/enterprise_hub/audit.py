"""
# ============================================================
# 企业级 Plugin Hub - 审计日志 (SOC2)
# ============================================================
# 核心作用：记录所有管理操作的审计日志，支持 SOC2 合规
# 运行流程：
#   1. 写操作时调用 AuditLogger.log
#   2. 支持按 actor/action/target/时间范围查询
#   3. 支持导出为 JSON / JSONL
# 修改记录：
#   - 2026-07-28 | v6.28.0 | Cycle 14 P0-3 初始版本
# ============================================================
"""

from __future__ import annotations

import json
import os
import threading
from typing import Any, Dict, List, Optional

from .models import ActionType, AuditLog, _new_id, _now_iso, get_storage_dir


class AuditLogger:
    """审计日志记录器

    Attributes:
        storage_dir: 持久化目录
        _lock: 线程安全锁
        _buffer: 内存缓冲
    """

    def __init__(self, storage_dir: Optional[str] = None) -> None:
        self.storage_dir = storage_dir or get_storage_dir()
        os.makedirs(self.storage_dir, exist_ok=True)
        self._lock = threading.RLock()
        self._buffer: List[AuditLog] = []
        self._load_recent()

    # ----------------------------------------------------------------
    # 持久化
    # ----------------------------------------------------------------
    def _path(self) -> str:
        return os.path.join(self.storage_dir, "audit.jsonl")

    def _load_recent(self, n: int = 500) -> None:
        """加载最近 n 条到内存"""
        path = self._path()
        if not os.path.isfile(path):
            return
        with self._lock:
            try:
                with open(path, "r", encoding="utf-8") as f:
                    lines = f.readlines()
                tail = lines[-n:] if len(lines) > n else lines
                for line in tail:
                    line = line.strip()
                    if line:
                        self._buffer.append(AuditLog.from_dict(json.loads(line)))
            except Exception:
                pass

    def _append(self, log: AuditLog) -> None:
        with open(self._path(), "a", encoding="utf-8") as f:
            f.write(json.dumps(log.to_dict(), ensure_ascii=False) + "\n")

    # ----------------------------------------------------------------
    # API
    # ----------------------------------------------------------------
    def log(
        self,
        org_id: str,
        actor: str,
        action: str,
        target: str,
        metadata: Optional[Dict[str, Any]] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        severity: str = "info",
    ) -> AuditLog:
        """记录一条审计日志

        Args:
            org_id: 组织 ID
            actor: 操作用户
            action: 操作类型（ActionType.xxx）
            target: 操作目标
            metadata: 元数据
            ip_address: IP
            user_agent: UA
            severity: info/warn/error

        Returns:
            AuditLog: 日志实体
        """
        with self._lock:
            log = AuditLog(
                log_id=_new_id("aud"),
                org_id=org_id,
                actor=actor,
                action=action,
                target=target,
                metadata=metadata or {},
                ip_address=ip_address,
                user_agent=user_agent,
                severity=severity,
            )
            self._buffer.append(log)
            # 限制内存大小
            if len(self._buffer) > 2000:
                self._buffer = self._buffer[-1000:]
            self._append(log)
            return log

    def log_security_event(
        self,
        org_id: str,
        actor: str,
        event: str,
        target: str,
        metadata: Optional[Dict[str, Any]] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> AuditLog:
        """记录安全事件（severity=error）"""
        return self.log(
            org_id=org_id,
            actor=actor,
            action=ActionType.SECURITY_EVENT.value,
            target=target,
            metadata={"event": event, **(metadata or {})},
            ip_address=ip_address,
            user_agent=user_agent,
            severity="error",
        )

    def query(
        self,
        org_id: Optional[str] = None,
        actor: Optional[str] = None,
        action: Optional[str] = None,
        target: Optional[str] = None,
        severity: Optional[str] = None,
        limit: int = 200,
    ) -> List[AuditLog]:
        """查询审计日志

        Args:
            org_id: 组织过滤
            actor: 操作用户过滤
            action: 操作类型过滤
            target: 目标过滤
            severity: 严重性过滤
            limit: 返回数量

        Returns:
            List[AuditLog]: 日志列表
        """
        with self._lock:
            results = list(self._buffer)
            if org_id:
                results = [r for r in results if r.org_id == org_id]
            if actor:
                results = [r for r in results if r.actor == actor]
            if action:
                results = [r for r in results if r.action == action]
            if target:
                results = [r for r in results if r.target == target]
            if severity:
                results = [r for r in results if r.severity == severity]
            return results[-limit:][::-1]

    def export(
        self,
        org_id: Optional[str] = None,
        format: str = "jsonl",
    ) -> str:
        """导出审计报告

        Args:
            org_id: 组织过滤
            format: jsonl / json

        Returns:
            str: 序列化内容
        """
        results = self.query(org_id=org_id, limit=10000)
        data = [r.to_dict() for r in results]
        if format == "json":
            return json.dumps(data, ensure_ascii=False, indent=2)
        return "\n".join(json.dumps(x, ensure_ascii=False) for x in data)

    def stats(self, org_id: Optional[str] = None) -> Dict[str, Any]:
        """统计"""
        with self._lock:
            results = self.query(org_id=org_id, limit=100000)
            return {
                "total": len(results),
                "by_severity": {
                    "info": sum(1 for r in results if r.severity == "info"),
                    "warn": sum(1 for r in results if r.severity == "warn"),
                    "error": sum(1 for r in results if r.severity == "error"),
                },
                "by_action": {
                    a.value: sum(1 for r in results if r.action == a.value)
                    for a in ActionType
                },
            }
