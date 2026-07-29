"""
# ============================================================
# 企业级 Plugin Hub - 审批工作流
# ============================================================
# 核心作用：管理企业级插件安装/发布的审批流程
# 流程：pending → approved | rejected | cancelled
# 修改记录：
#   - 2026-07-28 | v6.28.0 | Cycle 14 P0-3 初始版本
# ============================================================
"""

from __future__ import annotations

import json
import os
import threading
from typing import Any, Dict, List, Optional

from .models import ApprovalRequest, ApprovalStatus, _now_iso, get_storage_dir


class ApprovalWorkflow:
    """审批工作流

    Attributes:
        storage_dir: 持久化目录
        _lock: 线程锁
        _requests: 审批请求列表
    """

    def __init__(self, storage_dir: Optional[str] = None) -> None:
        self.storage_dir = storage_dir or get_storage_dir()
        os.makedirs(self.storage_dir, exist_ok=True)
        self._lock = threading.RLock()
        self._requests: List[ApprovalRequest] = []
        self._load()

    # ----------------------------------------------------------------
    # 持久化
    # ----------------------------------------------------------------
    def _path(self) -> str:
        return os.path.join(self.storage_dir, "approvals.jsonl")

    def _load(self) -> None:
        with self._lock:
            try:
                if os.path.isfile(self._path()):
                    with open(self._path(), "r", encoding="utf-8") as f:
                        for line in f:
                            line = line.strip()
                            if line:
                                self._requests.append(ApprovalRequest.from_dict(json.loads(line)))
            except Exception:
                pass

    def _append(self, req: ApprovalRequest) -> None:
        with open(self._path(), "a", encoding="utf-8") as f:
            f.write(json.dumps(req.to_dict(), ensure_ascii=False) + "\n")

    # ----------------------------------------------------------------
    # API
    # ----------------------------------------------------------------
    def create_request(
        self,
        plugin_id: str,
        requested_by: str,
        reason: str = "",
        team_id: str = "",
    ) -> ApprovalRequest:
        """创建审批请求

        Args:
            plugin_id: 插件 ID
            requested_by: 申请人 member_id
            reason: 申请原因
            team_id: 团队 ID

        Returns:
            ApprovalRequest: 审批请求
        """
        with self._lock:
            req = ApprovalRequest(
                plugin_id=plugin_id,
                requested_by=requested_by,
                team_id=team_id,
                reason=reason,
                status=ApprovalStatus.PENDING.value,
            )
            self._requests.append(req)
            self._append(req)
            return req

    def approve(self, request_id: str, reviewer: str, comment: str = "") -> Optional[ApprovalRequest]:
        """批准请求"""
        return self._review(request_id, reviewer, ApprovalStatus.APPROVED.value, comment)

    def reject(self, request_id: str, reviewer: str, comment: str = "") -> Optional[ApprovalRequest]:
        """拒绝请求"""
        return self._review(request_id, reviewer, ApprovalStatus.REJECTED.value, comment)

    def cancel(self, request_id: str) -> Optional[ApprovalRequest]:
        """取消请求（仅 pending 可取消）"""
        with self._lock:
            for r in self._requests:
                if r.request_id == request_id:
                    if r.status == ApprovalStatus.PENDING.value:
                        r.status = ApprovalStatus.CANCELLED.value
                        r.reviewed_at = _now_iso()
                        # 重建文件
                        self._rewrite()
                    return r
            return None

    def _review(self, request_id: str, reviewer: str, status: str, comment: str) -> Optional[ApprovalRequest]:
        with self._lock:
            for r in self._requests:
                if r.request_id == request_id:
                    if r.status != ApprovalStatus.PENDING.value:
                        return r  # 已处理过
                    r.status = status
                    r.reviewed_by = reviewer
                    r.reviewed_at = _now_iso()
                    r.review_comment = comment
                    self._rewrite()
                    return r
            return None

    def _rewrite(self) -> None:
        with open(self._path(), "w", encoding="utf-8") as f:
            for r in self._requests:
                f.write(json.dumps(r.to_dict(), ensure_ascii=False) + "\n")

    def get(self, request_id: str) -> Optional[ApprovalRequest]:
        with self._lock:
            for r in self._requests:
                if r.request_id == request_id:
                    return r
            return None

    def list(
        self,
        status: Optional[str] = None,
        org_id: Optional[str] = None,
        team_id: Optional[str] = None,
        plugin_id: Optional[str] = None,
        limit: int = 200,
    ) -> List[ApprovalRequest]:
        """列出审批请求

        Args:
            status: 状态过滤
            org_id: 组织过滤（通过 team_id 间接实现）
            team_id: 团队过滤
            plugin_id: 插件过滤
            limit: 返回数量上限

        Returns:
            List[ApprovalRequest]: 审批列表
        """
        with self._lock:
            results = list(self._requests)
            if status:
                results = [r for r in results if r.status == status]
            if team_id:
                results = [r for r in results if r.team_id == team_id]
            if plugin_id:
                results = [r for r in results if r.plugin_id == plugin_id]
            return results[-limit:][::-1]

    def stats(self) -> Dict[str, int]:
        """统计"""
        with self._lock:
            return {
                "total": len(self._requests),
                "pending": sum(1 for r in self._requests if r.status == ApprovalStatus.PENDING.value),
                "approved": sum(1 for r in self._requests if r.status == ApprovalStatus.APPROVED.value),
                "rejected": sum(1 for r in self._requests if r.status == ApprovalStatus.REJECTED.value),
                "cancelled": sum(1 for r in self._requests if r.status == ApprovalStatus.CANCELLED.value),
            }
