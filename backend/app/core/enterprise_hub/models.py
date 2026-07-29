"""
# ============================================================
# 企业级 Plugin Hub - 数据模型
# ============================================================
# 核心作用：定义企业级 Plugin Hub 所有数据实体
# 包含：组织/团队/成员/插件目录项/审批/成本/审计/Dashboard
# 修改记录：
#   - 2026-07-28 | v6.28.0 | Cycle 14 P0-3 初始版本
# ============================================================
"""

from __future__ import annotations

import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


def _new_id(prefix: str) -> str:
    """生成短 ID"""
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _now_iso() -> str:
    """返回当前时间的 ISO 格式字符串"""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ============================================================
# 枚举
# ============================================================

class MemberRole(str, Enum):
    """成员角色"""

    ADMIN = "admin"
    MANAGER = "manager"
    DEVELOPER = "developer"
    VIEWER = "viewer"


class ApprovalStatus(str, Enum):
    """审批状态"""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class ActionType(str, Enum):
    """审计操作类型"""

    PLUGIN_INSTALL = "plugin_install"
    PLUGIN_UNINSTALL = "plugin_uninstall"
    PLUGIN_APPROVE = "plugin_approve"
    PLUGIN_REJECT = "plugin_reject"
    TEAM_CREATE = "team_create"
    MEMBER_INVITE = "member_invite"
    MEMBER_REMOVE = "member_remove"
    ROLE_CHANGE = "role_change"
    QUOTA_UPDATE = "quota_update"
    COST_RECORD = "cost_record"
    SECURITY_EVENT = "security_event"
    CONFIG_UPDATE = "config_update"


class OrgPlan(str, Enum):
    """组织计划"""

    FREE = "free"
    PRO = "pro"
    ENTERPRISE = "enterprise"


class PricingModel(str, Enum):
    """插件定价模式"""

    FREE = "free"
    PAID = "paid"
    USAGE_BASED = "usage_based"
    SUBSCRIPTION = "subscription"


# ============================================================
# 实体
# ============================================================

@dataclass
class Organization:
    """组织实体

    Attributes:
        org_id: 组织唯一标识
        name: 组织名称
        plan: 计划（free/pro/enterprise）
        owner: 创建者 email
        created_at: 创建时间
        settings: 组织设置
        quotas: 默认配额
        billing_email: 计费邮箱
    """

    org_id: str = field(default_factory=lambda: _new_id("org"))
    name: str = ""
    plan: str = OrgPlan.FREE.value
    owner: str = ""
    created_at: str = field(default_factory=_now_iso)
    settings: Dict[str, Any] = field(default_factory=dict)
    quotas: Dict[str, Any] = field(default_factory=lambda: {
        "max_members": 10,
        "max_teams": 3,
        "monthly_budget_usd": 100.0,
        "max_plugin_installs": 50,
    })
    billing_email: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Organization":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class Team:
    """团队实体

    Attributes:
        team_id: 团队唯一标识
        org_id: 所属组织
        name: 团队名称
        description: 描述
        members: 成员 ID 列表
        budget_usd: 团队预算（美元/月）
        created_at: 创建时间
        lead: 团队负责人 member_id
    """

    team_id: str = field(default_factory=lambda: _new_id("team"))
    org_id: str = ""
    name: str = ""
    description: str = ""
    members: List[str] = field(default_factory=list)
    budget_usd: float = 0.0
    created_at: str = field(default_factory=_now_iso)
    lead: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Team":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class Member:
    """成员实体

    Attributes:
        member_id: 成员唯一标识
        org_id: 所属组织
        email: 邮箱
        name: 显示名
        role: 角色（admin/manager/developer/viewer）
        teams: 所属团队 ID 列表
        joined_at: 加入时间
        last_active: 最后活跃时间
        status: 状态（active/inactive/pending）
    """

    member_id: str = field(default_factory=lambda: _new_id("mem"))
    org_id: str = ""
    email: str = ""
    name: str = ""
    role: str = MemberRole.DEVELOPER.value
    teams: List[str] = field(default_factory=list)
    joined_at: str = field(default_factory=_now_iso)
    last_active: Optional[str] = None
    status: str = "active"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Member":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class PluginCatalogItem:
    """企业级插件目录项

    Attributes:
        plugin_id: 插件唯一标识
        name: 插件名称
        version: 版本
        source: 来源（official/community/local）
        category: 分类
        vendor: 供应商
        license: 许可证
        description: 简短描述
        long_description: 详细描述
        icon_url: 图标 URL
        screenshots: 截图列表
        tags: 标签
        pricing_model: 定价模式
        price_usd: 价格
        enterprise_ready: 企业级就绪
        soc2_compliant: SOC2 合规
        data_residency: 数据驻留地
        permissions_required: 所需权限
        downloads: 下载次数
        rating: 评分
        rating_count: 评分人数
        install_commands: 安装次数
        last_updated: 最后更新时间
        verified: 已验证
        signature: SHA-256 签名
    """

    plugin_id: str = ""
    name: str = ""
    version: str = "1.0.0"
    source: str = "community"
    category: str = "developer-tools"
    vendor: str = ""
    license: str = "MIT"
    description: str = ""
    long_description: str = ""
    icon_url: str = ""
    screenshots: List[str] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)
    pricing_model: str = PricingModel.FREE.value
    price_usd: float = 0.0
    enterprise_ready: bool = False
    soc2_compliant: bool = False
    data_residency: List[str] = field(default_factory=lambda: ["global"])
    permissions_required: List[str] = field(default_factory=list)
    downloads: int = 0
    rating: float = 0.0
    rating_count: int = 0
    install_commands: int = 0
    last_updated: str = field(default_factory=_now_iso)
    verified: bool = False
    signature: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PluginCatalogItem":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class ApprovalRequest:
    """插件安装审批请求

    Attributes:
        request_id: 审批唯一标识
        plugin_id: 插件 ID
        requested_by: 申请人 member_id
        team_id: 所属团队
        reason: 申请原因
        status: 状态（pending/approved/rejected/cancelled）
        reviewed_by: 审批人
        reviewed_at: 审批时间
        review_comment: 审批意见
        created_at: 创建时间
    """

    request_id: str = field(default_factory=lambda: _new_id("apr"))
    plugin_id: str = ""
    requested_by: str = ""
    team_id: str = ""
    reason: str = ""
    status: str = ApprovalStatus.PENDING.value
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[str] = None
    review_comment: Optional[str] = None
    created_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ApprovalRequest":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class CostRecord:
    """成本记录

    Attributes:
        record_id: 记录唯一标识
        org_id: 组织
        team_id: 团队（可选）
        plugin_id: 插件
        member_id: 成员
        usage_count: 使用次数
        cost_usd: 成本
        period: 周期（YYYY-MM）
        created_at: 创建时间
    """

    record_id: str = field(default_factory=lambda: _new_id("cost"))
    org_id: str = ""
    team_id: Optional[str] = None
    plugin_id: str = ""
    member_id: str = ""
    usage_count: int = 0
    cost_usd: float = 0.0
    period: str = ""
    created_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CostRecord":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class AuditLog:
    """审计日志

    Attributes:
        log_id: 日志唯一标识
        org_id: 组织
        actor: 操作用户
        action: 操作类型
        target: 操作目标
        metadata: 附加元数据
        ip_address: IP 地址
        user_agent: User Agent
        severity: 严重性（info/warn/error）
        created_at: 创建时间
    """

    log_id: str = field(default_factory=lambda: _new_id("aud"))
    org_id: str = ""
    actor: str = ""
    action: str = ""
    target: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    severity: str = "info"
    created_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AuditLog":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class DashboardSnapshot:
    """Dashboard 快照

    Attributes:
        snapshot_id: 快照 ID
        org_id: 组织
        period: 周期
        total_plugins: 插件总数
        active_plugins: 活跃插件数
        total_installs: 安装总数
        active_users: 活跃用户数
        top_plugins: 热门插件
        usage_by_category: 按分类使用
        cost_summary: 成本摘要
        productivity_score: 生产力评分
        generated_at: 生成时间
    """

    snapshot_id: str = field(default_factory=lambda: _new_id("dash"))
    org_id: str = ""
    period: str = ""
    total_plugins: int = 0
    active_plugins: int = 0
    total_installs: int = 0
    active_users: int = 0
    top_plugins: List[Dict[str, Any]] = field(default_factory=list)
    usage_by_category: Dict[str, int] = field(default_factory=dict)
    cost_summary: Dict[str, float] = field(default_factory=dict)
    productivity_score: float = 0.0
    generated_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DashboardSnapshot":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


# ============================================================
# 工具
# ============================================================

def get_storage_dir() -> str:
    """获取 Plugin Hub 存储目录

    Returns:
        str: 存储目录路径
    """
    import os
    return os.environ.get("HERMES_HUB_DIR", "/tmp/hermes_enterprise_hub")
