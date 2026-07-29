"""
# ============================================================
# 企业级 Plugin Hub - RBAC 权限模型
# ============================================================
# 核心作用：基于角色的访问控制（Role-Based Access Control）
# 角色：admin / manager / developer / viewer
# 运行流程：
#   1. 预定义角色 → 权限集
#   2. Permission.check(actor_role, required_permission) 返回 bool
#   3. 通过 Manager 在每个写操作前调用
# 修改记录：
#   - 2026-07-28 | v6.28.0 | Cycle 14 P0-3 初始版本
# ============================================================
"""

from __future__ import annotations

from typing import Dict, FrozenSet, List, Set

from .models import MemberRole


# ============================================================
# 权限定义
# ============================================================

# 资源级权限
PERMISSIONS: Dict[str, str] = {
    # 组织管理
    "org:read": "查看组织信息",
    "org:write": "修改组织信息",
    "org:delete": "删除组织",
    "org:quotas": "修改组织配额",
    # 团队管理
    "team:read": "查看团队",
    "team:write": "创建/修改团队",
    "team:delete": "删除团队",
    "team:members": "管理团队成员",
    # 成员管理
    "member:read": "查看成员",
    "member:invite": "邀请成员",
    "member:remove": "移除成员",
    "member:role": "修改成员角色",
    # 插件目录
    "plugin:read": "查看插件目录",
    "plugin:install": "安装插件",
    "plugin:uninstall": "卸载插件",
    "plugin:publish": "发布插件到市场",
    # 审批
    "approval:create": "创建审批请求",
    "approval:read": "查看审批",
    "approval:review": "审批/拒绝请求",
    # 成本控制
    "cost:read": "查看成本",
    "cost:write": "记录成本",
    "cost:manage": "管理预算/告警",
    # 审计
    "audit:read": "查看审计日志",
    "audit:export": "导出审计报告",
    "audit:security": "记录安全事件",
    # 仪表盘
    "dashboard:read": "查看 Dashboard",
}


# ============================================================
# 角色 → 权限集
# ============================================================

ROLE_PERMISSIONS: Dict[str, FrozenSet[str]] = {
    MemberRole.ADMIN.value: frozenset({
        "org:read", "org:write", "org:delete", "org:quotas",
        "team:read", "team:write", "team:delete", "team:members",
        "member:read", "member:invite", "member:remove", "member:role",
        "plugin:read", "plugin:install", "plugin:uninstall", "plugin:publish",
        "approval:create", "approval:read", "approval:review",
        "cost:read", "cost:write", "cost:manage",
        "audit:read", "audit:export", "audit:security",
        "dashboard:read",
    }),
    MemberRole.MANAGER.value: frozenset({
        "org:read", "org:write",
        "team:read", "team:write", "team:members",
        "member:read", "member:invite", "member:role",
        "plugin:read", "plugin:install", "plugin:uninstall",
        "approval:create", "approval:read", "approval:review",
        "cost:read", "cost:write", "cost:manage",
        "audit:read",
        "dashboard:read",
    }),
    MemberRole.DEVELOPER.value: frozenset({
        "org:read",
        "team:read", "team:members",
        "member:read",
        "plugin:read", "plugin:install", "plugin:uninstall",
        "approval:create", "approval:read",
        "cost:read",
        "dashboard:read",
    }),
    MemberRole.VIEWER.value: frozenset({
        "org:read",
        "team:read",
        "member:read",
        "plugin:read",
        "cost:read",
        "dashboard:read",
    }),
}


# ============================================================
# 角色等级
# ============================================================

ROLE_LEVEL: Dict[str, int] = {
    MemberRole.ADMIN.value: 100,
    MemberRole.MANAGER.value: 70,
    MemberRole.DEVELOPER.value: 40,
    MemberRole.VIEWER.value: 10,
}


class Permission:
    """权限工具类

    提供：
      - check(role, permission) → bool
      - role_has(role, permission) → bool
      - permissions_of(role) → Set[str]
      - require(check_result) → 异常友好接口
    """

    @staticmethod
    def permissions_of(role: str) -> FrozenSet[str]:
        """获取角色所有权限

        Args:
            role: 角色名

        Returns:
            FrozenSet[str]: 权限集
        """
        return ROLE_PERMISSIONS.get(role, frozenset())

    @staticmethod
    def has(role: str, permission: str) -> bool:
        """判断角色是否拥有某权限

        Args:
            role: 角色
            permission: 权限名

        Returns:
            bool: 是否拥有
        """
        return permission in ROLE_PERMISSIONS.get(role, frozenset())

    @staticmethod
    def check(role: str, permission: str) -> bool:
        """与 has 等价（语义化）"""
        return Permission.has(role, permission)

    @staticmethod
    def any_of(role: str, permissions: List[str]) -> bool:
        """角色是否拥有任一权限

        Args:
            role: 角色
            permissions: 权限列表

        Returns:
            bool: 是否拥有任一
        """
        role_perms = ROLE_PERMISSIONS.get(role, frozenset())
        return any(p in role_perms for p in permissions)

    @staticmethod
    def all_of(role: str, permissions: List[str]) -> bool:
        """角色是否拥有所有权限"""
        role_perms = ROLE_PERMISSIONS.get(role, frozenset())
        return all(p in role_perms for p in permissions)

    @staticmethod
    def can_manage_role(actor_role: str, target_role: str) -> bool:
        """actor 能否管理 target 角色（要求 actor 等级 > target）

        Args:
            actor_role: 操作用户角色
            target_role: 目标用户角色

        Returns:
            bool: 是否能管理
        """
        return ROLE_LEVEL.get(actor_role, 0) > ROLE_LEVEL.get(target_role, 0)

    @staticmethod
    def require(role: str, permission: str) -> None:
        """若角色无权限则抛 PermissionError

        Args:
            role: 角色
            permission: 权限

        Raises:
            PermissionError: 无权限时
        """
        if not Permission.has(role, permission):
            raise PermissionError(
                f"role {role!r} lacks permission {permission!r}"
            )

    @staticmethod
    def list_roles() -> List[str]:
        """列出所有角色"""
        return list(ROLE_PERMISSIONS.keys())

    @staticmethod
    def list_permissions() -> Set[str]:
        """列出所有权限"""
        return set(PERMISSIONS.keys())
