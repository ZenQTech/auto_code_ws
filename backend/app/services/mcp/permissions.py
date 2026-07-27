"""
# ============================================================
# MCP Permissions Service（Cycle 3 v1.0.0）
# ============================================================
# 核心作用：实现 MCP 工具的细粒度权限控制
# 权限模式：
#   - auto: 自动放行
#   - manual: 每次需用户审批（WebSocket 推送）
#   - blocked: 永久阻止
# 运行流程：
#   1. LLM 调用工具 → 2. 权限检查 → 3. 模式分发
#   4. auto 直接执行 / manual 推送审批等待 / blocked 拒绝
#   5. 所有调用记录到审计日志
# 输入参数：tool_name、arguments、session_id
# 输出结果：ApprovalRequest + AuditLog
# 创建日期：2026-07-27
# 模块版本：v1.0.0
# ============================================================
"""

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 枚举与常量
# ============================================================

class PermissionMode(str, Enum):
    """权限模式"""
    AUTO = "auto"           # 自动放行
    MANUAL = "manual"       # 每次确认
    BLOCKED = "blocked"     # 永久阻止


class ApprovalStatus(str, Enum):
    """审批状态"""
    PENDING = "pending"             # 待审批
    APPROVED = "approved"           # 已批准
    REJECTED = "rejected"           # 已拒绝
    EXPIRED = "expired"             # 已过期
    CANCELLED = "cancelled"         # 已取消


# 默认危险工具（manual 模式）
DEFAULT_DANGEROUS_TOOLS = {
    "write_file": PermissionMode.MANUAL,
    "edit_file": PermissionMode.MANUAL,
    "run_command": PermissionMode.MANUAL,
    "delete_file": PermissionMode.MANUAL,
    "delete_directory": PermissionMode.MANUAL,
}

# 默认安全工具（auto 模式）
DEFAULT_SAFE_TOOLS = {
    "read_file": PermissionMode.AUTO,
    "list_directory": PermissionMode.AUTO,
    "search_files": PermissionMode.AUTO,
    "get_file_info": PermissionMode.AUTO,
}

# 审批超时（秒）
APPROVAL_TIMEOUT_SEC = 30

# 审计日志最大内存保留数
AUDIT_LOG_MAX_SIZE = 10000


# ============================================================
# 数据模型
# ============================================================

@dataclass
class ToolPermission:
    """工具权限配置"""
    tool_name: str
    server_id: str
    mode: PermissionMode
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_by: str = "system"
    reason: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "tool_name": self.tool_name,
            "server_id": self.server_id,
            "mode": self.mode.value,
            "updated_at": self.updated_at,
            "updated_by": self.updated_by,
            "reason": self.reason,
        }


@dataclass
class ApprovalRequest:
    """审批请求"""
    id: str
    tool_name: str
    server_id: str
    arguments: Dict[str, Any]
    session_id: str
    requested_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    expires_at: str = field(default_factory=lambda: (datetime.now(timezone.utc) + timedelta(seconds=APPROVAL_TIMEOUT_SEC)).isoformat())
    status: ApprovalStatus = ApprovalStatus.PENDING
    decided_at: str = ""
    decided_by: str = ""
    decision_reason: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "tool_name": self.tool_name,
            "server_id": self.server_id,
            "arguments": self.arguments,
            "session_id": self.session_id,
            "requested_at": self.requested_at,
            "expires_at": self.expires_at,
            "status": self.status.value,
            "decided_at": self.decided_at,
            "decided_by": self.decided_by,
            "decision_reason": self.decision_reason,
        }

    def is_expired(self) -> bool:
        try:
            expires = datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))
            return datetime.now(timezone.utc) > expires
        except Exception:
            return False


@dataclass
class AuditLogEntry:
    """审计日志条目"""
    id: str
    tool_name: str
    server_id: str
    arguments: Dict[str, Any]
    result: Dict[str, Any]
    success: bool
    duration_ms: int
    session_id: str
    user_id: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    error_message: str = ""
    permission_mode: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "tool_name": self.tool_name,
            "server_id": self.server_id,
            "arguments": self.arguments,
            "result": self.result,
            "success": self.success,
            "duration_ms": self.duration_ms,
            "session_id": self.session_id,
            "user_id": self.user_id,
            "timestamp": self.timestamp,
            "error_message": self.error_message,
            "permission_mode": self.permission_mode,
        }


# ============================================================
# 权限控制服务
# ============================================================

class MCPPermissionService:
    """
    MCP 权限控制服务
    核心能力：
      1. 工具级权限配置
      2. 实时审批请求管理
      3. 审计日志
      4. WebSocket 推送（通过回调）
    """

    def __init__(self, websocket_broadcaster: Optional[Callable] = None):
        # 权限表: (tool_name, server_id) -> ToolPermission
        self._permissions: Dict[Tuple[str, str], ToolPermission] = {}
        # 审批请求: request_id -> ApprovalRequest
        self._approvals: Dict[str, ApprovalRequest] = {}
        # 审计日志: 内存环形缓冲
        self._audit_logs: List[AuditLogEntry] = []
        # WebSocket 广播器
        self._broadcaster = websocket_broadcaster
        # 初始化默认权限
        self._init_default_permissions()
        # 单次放行（one-time approve）记录
        self._one_time_approvals: Dict[Tuple[str, str], float] = {}
        logger.info("MCPPermissionService 初始化完成")

    def _init_default_permissions(self):
        """初始化默认权限"""
        server_id = "builtin"
        for tool_name, mode in DEFAULT_DANGEROUS_TOOLS.items():
            self._permissions[(tool_name, server_id)] = ToolPermission(
                tool_name=tool_name,
                server_id=server_id,
                mode=mode,
                updated_by="default",
                reason="默认危险工具",
            )
        for tool_name, mode in DEFAULT_SAFE_TOOLS.items():
            self._permissions[(tool_name, server_id)] = ToolPermission(
                tool_name=tool_name,
                server_id=server_id,
                mode=mode,
                updated_by="default",
                reason="默认安全工具",
            )

    # ============================================================
    # 权限配置
    # ============================================================
    def get_permission(self, tool_name: str, server_id: str = "builtin") -> Optional[Dict[str, Any]]:
        """获取工具权限"""
        perm = self._permissions.get((tool_name, server_id))
        return perm.to_dict() if perm else None

    def list_permissions(self) -> List[Dict[str, Any]]:
        """列出所有权限"""
        return [p.to_dict() for p in self._permissions.values()]

    def set_permission(
        self,
        tool_name: str,
        mode: str,
        server_id: str = "builtin",
        updated_by: str = "user",
        reason: str = "",
    ) -> Dict[str, Any]:
        """
        设置工具权限
        """
        try:
            mode_enum = PermissionMode(mode)
        except ValueError:
            raise ValueError(f"无效权限模式: {mode}（支持: auto/manual/blocked）")

        perm = ToolPermission(
            tool_name=tool_name,
            server_id=server_id,
            mode=mode_enum,
            updated_by=updated_by,
            reason=reason,
        )
        self._permissions[(tool_name, server_id)] = perm
        logger.info(f"权限更新: {tool_name} ({server_id}) → {mode}")
        return perm.to_dict()

    def bulk_set_permissions(self, permissions: List[Dict[str, Any]], updated_by: str = "user") -> List[Dict[str, Any]]:
        """批量设置权限"""
        results = []
        for p in permissions:
            try:
                result = self.set_permission(
                    tool_name=p["tool_name"],
                    mode=p["mode"],
                    server_id=p.get("server_id", "builtin"),
                    updated_by=updated_by,
                    reason=p.get("reason", ""),
                )
                results.append(result)
            except ValueError as e:
                results.append({"error": str(e), "tool_name": p.get("tool_name")})
        return results

    # ============================================================
    # 权限检查
    # ============================================================
    def check_permission(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        server_id: str = "builtin",
    ) -> Tuple[PermissionMode, Optional[Dict[str, Any]]]:
        """
        检查工具权限
        返回值：(mode, permission_dict)
        """
        # 单次放行
        ot_key = (tool_name, server_id)
        if ot_key in self._one_time_approvals:
            expiry = self._one_time_approvals[ot_key]
            if time.time() < expiry:
                return PermissionMode.AUTO, {
                    "mode": "auto",
                    "reason": "one_time_approval",
                    "expires_in_sec": int(expiry - time.time()),
                }
            else:
                del self._one_time_approvals[ot_key]

        perm = self._permissions.get((tool_name, server_id))
        if perm is None:
            # 未配置：默认 manual（保守策略）
            return PermissionMode.MANUAL, {
                "mode": "manual",
                "reason": "unconfigured_default_manual",
            }
        return perm.mode, perm.to_dict()

    def grant_one_time_approval(self, tool_name: str, server_id: str = "builtin", duration_sec: int = 60) -> bool:
        """
        单次放行（指定时间窗口内自动放行一次）
        """
        self._one_time_approvals[(tool_name, server_id)] = time.time() + duration_sec
        logger.info(f"单次放行: {tool_name} ({server_id}) for {duration_sec}s")
        return True

    # ============================================================
    # 审批流
    # ============================================================
    async def request_approval(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        session_id: str,
        server_id: str = "builtin",
        timeout_sec: int = APPROVAL_TIMEOUT_SEC,
    ) -> ApprovalRequest:
        """
        创建审批请求并广播到 WebSocket
        """
        request = ApprovalRequest(
            id=str(uuid.uuid4()),
            tool_name=tool_name,
            server_id=server_id,
            arguments=arguments,
            session_id=session_id,
        )
        # 调整超时
        request.expires_at = (
            datetime.now(timezone.utc) + timedelta(seconds=timeout_sec)
        ).isoformat()

        self._approvals[request.id] = request

        # 广播到 WebSocket
        if self._broadcaster is not None:
            try:
                msg = {
                    "type": "permission_request",
                    "request_id": request.id,
                    "tool_name": tool_name,
                    "server_id": server_id,
                    "arguments": arguments,
                    "session_id": session_id,
                    "requested_at": request.requested_at,
                    "expires_at": request.expires_at,
                    "timeout_sec": timeout_sec,
                }
                if asyncio.iscoroutinefunction(self._broadcaster):
                    await self._broadcaster(msg)
                else:
                    self._broadcaster(msg)
            except Exception as e:
                logger.error(f"WebSocket 广播失败: {e}")

        # 启动超时任务
        asyncio.create_task(self._expire_approval(request.id, timeout_sec))

        logger.info(f"创建审批请求: {request.id} ({tool_name})")
        return request

    async def _expire_approval(self, request_id: str, timeout_sec: int):
        """超时自动过期"""
        await asyncio.sleep(timeout_sec)
        request = self._approvals.get(request_id)
        if request and request.status == ApprovalStatus.PENDING:
            request.status = ApprovalStatus.EXPIRED
            request.decided_at = datetime.now(timezone.utc).isoformat()
            request.decision_reason = "timeout"
            logger.info(f"审批请求超时: {request_id}")

    def respond_to_approval(
        self,
        request_id: str,
        decision: str,
        decided_by: str = "user",
        reason: str = "",
    ) -> Optional[Dict[str, Any]]:
        """
        响应审批请求
        decision: approved / rejected
        """
        request = self._approvals.get(request_id)
        if request is None:
            return None
        if request.status != ApprovalStatus.PENDING:
            return request.to_dict()
        if request.is_expired():
            request.status = ApprovalStatus.EXPIRED
            return request.to_dict()

        if decision == "approved":
            request.status = ApprovalStatus.APPROVED
        elif decision == "rejected":
            request.status = ApprovalStatus.REJECTED
        else:
            return None

        request.decided_at = datetime.now(timezone.utc).isoformat()
        request.decided_by = decided_by
        request.decision_reason = reason
        logger.info(f"审批响应: {request_id} → {decision}")
        return request.to_dict()

    def get_approval(self, request_id: str) -> Optional[Dict[str, Any]]:
        """获取审批请求"""
        request = self._approvals.get(request_id)
        return request.to_dict() if request else None

    def list_pending_approvals(self, session_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """列出待审批请求"""
        pending = []
        for request in self._approvals.values():
            if request.status != ApprovalStatus.PENDING:
                continue
            if request.is_expired():
                request.status = ApprovalStatus.EXPIRED
                continue
            if session_id and request.session_id != session_id:
                continue
            pending.append(request.to_dict())
        return pending

    def list_all_approvals(self, limit: int = 100) -> List[Dict[str, Any]]:
        """列出所有审批请求"""
        all_requests = sorted(
            self._approvals.values(),
            key=lambda r: r.requested_at,
            reverse=True,
        )
        return [r.to_dict() for r in all_requests[:limit]]

    async def wait_for_decision(self, request_id: str, timeout_sec: Optional[int] = None) -> ApprovalStatus:
        """
        异步等待审批结果
        """
        request = self._approvals.get(request_id)
        if request is None:
            return ApprovalStatus.CANCELLED

        timeout = timeout_sec or APPROVAL_TIMEOUT_SEC
        start = time.time()
        while time.time() - start < timeout:
            if request.status != ApprovalStatus.PENDING:
                return request.status
            await asyncio.sleep(0.1)
        return ApprovalStatus.EXPIRED

    # ============================================================
    # 审计日志
    # ============================================================
    def record_audit(
        self,
        tool_name: str,
        server_id: str,
        arguments: Dict[str, Any],
        result: Dict[str, Any],
        success: bool,
        duration_ms: int,
        session_id: str = "",
        user_id: str = "system",
        error_message: str = "",
        permission_mode: str = "",
    ) -> Dict[str, Any]:
        """记录审计日志"""
        entry = AuditLogEntry(
            id=str(uuid.uuid4()),
            tool_name=tool_name,
            server_id=server_id,
            arguments=arguments,
            result=result,
            success=success,
            duration_ms=duration_ms,
            session_id=session_id,
            user_id=user_id,
            error_message=error_message,
            permission_mode=permission_mode,
        )
        self._audit_logs.append(entry)
        # 限制大小
        if len(self._audit_logs) > AUDIT_LOG_MAX_SIZE:
            self._audit_logs = self._audit_logs[-AUDIT_LOG_MAX_SIZE:]
        return entry.to_dict()

    def list_audit_logs(
        self,
        tool_name: Optional[str] = None,
        server_id: Optional[str] = None,
        session_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        success_only: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """查询审计日志"""
        logs = self._audit_logs
        if tool_name:
            logs = [l for l in logs if l.tool_name == tool_name]
        if server_id:
            logs = [l for l in logs if l.server_id == server_id]
        if session_id:
            logs = [l for l in logs if l.session_id == session_id]
        if success_only is not None:
            logs = [l for l in logs if l.success == success_only]

        # 按时间倒序
        logs = sorted(logs, key=lambda l: l.timestamp, reverse=True)
        total = len(logs)
        page = logs[offset: offset + limit]
        return {
            "logs": [l.to_dict() for l in page],
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    def clear_audit_logs(self) -> int:
        """清空审计日志"""
        n = len(self._audit_logs)
        self._audit_logs = []
        return n

    # ============================================================
    # 工具调用（带权限检查）
    # ============================================================
    async def call_tool_with_permission(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        session_id: str,
        tool_executor: Callable,
        server_id: str = "builtin",
        user_id: str = "system",
    ) -> Dict[str, Any]:
        """
        带权限检查的工具调用
        流程：
          1. 权限检查 → auto/manual/blocked
          2. auto: 直接执行
          3. manual: 创建审批请求 + 等待决策
          4. blocked: 拒绝
          5. 审计记录
        """
        start_time = time.time()
        mode, perm_info = self.check_permission(tool_name, arguments, server_id)

        if mode == PermissionMode.BLOCKED:
            duration_ms = int((time.time() - start_time) * 1000)
            result = {
                "success": False,
                "error": f"工具 {tool_name} 已被阻止",
                "permission_mode": "blocked",
                "permission_info": perm_info,
            }
            self.record_audit(
                tool_name=tool_name,
                server_id=server_id,
                arguments=arguments,
                result=result,
                success=False,
                duration_ms=duration_ms,
                session_id=session_id,
                user_id=user_id,
                error_message="blocked",
                permission_mode="blocked",
            )
            return result

        if mode == PermissionMode.MANUAL:
            # 创建审批请求
            request = await self.request_approval(
                tool_name=tool_name,
                arguments=arguments,
                session_id=session_id,
                server_id=server_id,
            )
            # 等待决策
            status = await self.wait_for_decision(request.id)
            if status != ApprovalStatus.APPROVED:
                duration_ms = int((time.time() - start_time) * 1000)
                result = {
                    "success": False,
                    "error": f"审批未通过: {status.value}",
                    "request_id": request.id,
                    "status": status.value,
                }
                self.record_audit(
                    tool_name=tool_name,
                    server_id=server_id,
                    arguments=arguments,
                    result=result,
                    success=False,
                    duration_ms=duration_ms,
                    session_id=session_id,
                    user_id=user_id,
                    error_message=f"approval_{status.value}",
                    permission_mode="manual",
                )
                return result

        # auto 或 manual approved → 执行
        try:
            if asyncio.iscoroutinefunction(tool_executor):
                exec_result = await tool_executor(tool_name, arguments)
            else:
                exec_result = tool_executor(tool_name, arguments)
            success = exec_result.get("success", True) if isinstance(exec_result, dict) else True
            error_message = exec_result.get("error", "") if isinstance(exec_result, dict) else ""
        except Exception as e:
            exec_result = {"success": False, "error": str(e)}
            success = False
            error_message = str(e)

        duration_ms = int((time.time() - start_time) * 1000)
        self.record_audit(
            tool_name=tool_name,
            server_id=server_id,
            arguments=arguments,
            result=exec_result,
            success=success,
            duration_ms=duration_ms,
            session_id=session_id,
            user_id=user_id,
            error_message=error_message,
            permission_mode=mode.value,
        )
        return exec_result


# ============================================================
# 全局单例
# ============================================================
_permission_instance: Optional[MCPPermissionService] = None


def get_permission_service(websocket_broadcaster: Optional[Callable] = None) -> MCPPermissionService:
    """获取全局权限服务"""
    global _permission_instance
    if _permission_instance is None:
        _permission_instance = MCPPermissionService(websocket_broadcaster=websocket_broadcaster)
    return _permission_instance


def reset_permission_service() -> None:
    """重置单例（用于测试）"""
    global _permission_instance
    _permission_instance = None
