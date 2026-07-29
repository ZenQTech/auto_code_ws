"""
# ============================================================
# 企业级 Plugin Hub - 团队管理
# ============================================================
# 核心作用：管理组织、团队、成员的多级实体关系
# 层级模型：Organization → Team → Member
# 运行流程：
#   1. TeamRegistry 维护内存 + JSON 持久化
#   2. 支持创建/查询/更新/删除组织、团队、成员
#   3. 路径白名单限制：仅允许 HERMES_HUB_DIR 目录
#   4. 线程安全：使用 RLock
# 修改记录：
#   - 2026-07-28 | v6.28.0 | Cycle 14 P0-3 初始版本
# ============================================================
"""

from __future__ import annotations

import json
import os
import re
import threading
from typing import Any, Dict, List, Optional, Tuple

from .models import Member, Organization, Team, _now_iso, get_storage_dir

# 邮箱正则（基本校验）
_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
# ID 校验正则
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


# 文件名白名单（不允许 .. / 路径分隔符 / 空）
_FILENAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,128}$")


def _safe_path(name: str) -> str:
    """安全路径校验：禁止 .. 或 / 等

    Args:
        name: 期望的文件名

    Returns:
        str: 通过校验的文件名
    """
    if not name or ".." in name or "/" in name or "\\" in name:
        raise ValueError(f"invalid name: {name!r}")
    if not _FILENAME_RE.match(name):
        raise ValueError(f"invalid id format: {name!r}")
    return name


class TeamRegistry:
    """组织/团队/成员注册中心

    Attributes:
        storage_dir: 持久化目录
        _lock: 线程安全锁
        _orgs: 组织字典
        _teams: 团队字典
        _members: 成员字典
    """

    def __init__(self, storage_dir: Optional[str] = None) -> None:
        """初始化

        Args:
            storage_dir: 持久化目录（默认从环境变量获取）
        """
        self.storage_dir = storage_dir or get_storage_dir()
        os.makedirs(self.storage_dir, exist_ok=True)
        self._lock = threading.RLock()
        self._orgs: Dict[str, Organization] = {}
        self._teams: Dict[str, Team] = {}
        self._members: Dict[str, Member] = {}
        self._load()

    # ----------------------------------------------------------------
    # 持久化
    # ----------------------------------------------------------------
    def _org_path(self) -> str:
        return os.path.join(self.storage_dir, _safe_path("orgs.json"))

    def _team_path(self) -> str:
        return os.path.join(self.storage_dir, _safe_path("teams.json"))

    def _member_path(self) -> str:
        return os.path.join(self.storage_dir, _safe_path("members.json"))

    def _load(self) -> None:
        """从磁盘加载"""
        with self._lock:
            try:
                if os.path.isfile(self._org_path()):
                    with open(self._org_path(), "r", encoding="utf-8") as f:
                        for data in json.load(f):
                            org = Organization.from_dict(data)
                            self._orgs[org.org_id] = org
            except Exception:
                pass
            try:
                if os.path.isfile(self._team_path()):
                    with open(self._team_path(), "r", encoding="utf-8") as f:
                        for data in json.load(f):
                            team = Team.from_dict(data)
                            self._teams[team.team_id] = team
            except Exception:
                pass
            try:
                if os.path.isfile(self._member_path()):
                    with open(self._member_path(), "r", encoding="utf-8") as f:
                        for data in json.load(f):
                            member = Member.from_dict(data)
                            self._members[member.member_id] = member
            except Exception:
                pass

    def _save(self) -> None:
        """持久化到磁盘"""
        with self._lock:
            with open(self._org_path(), "w", encoding="utf-8") as f:
                json.dump([o.to_dict() for o in self._orgs.values()], f, ensure_ascii=False, indent=2)
            with open(self._team_path(), "w", encoding="utf-8") as f:
                json.dump([t.to_dict() for t in self._teams.values()], f, ensure_ascii=False, indent=2)
            with open(self._member_path(), "w", encoding="utf-8") as f:
                json.dump([m.to_dict() for m in self._members.values()], f, ensure_ascii=False, indent=2)

    # ----------------------------------------------------------------
    # 组织 CRUD
    # ----------------------------------------------------------------
    def create_org(self, name: str, owner: str, plan: str = "free", billing_email: str = "") -> Organization:
        """创建组织

        Args:
            name: 组织名
            owner: 创建者邮箱
            plan: free/pro/enterprise
            billing_email: 计费邮箱

        Returns:
            Organization: 组织实体
        """
        if not name or not name.strip():
            raise ValueError("org name required")
        if not _EMAIL_RE.match(owner):
            raise ValueError("invalid owner email")
        with self._lock:
            org = Organization(
                name=name.strip(),
                owner=owner,
                plan=plan,
                billing_email=billing_email or owner,
            )
            self._orgs[org.org_id] = org
            self._save()
            return org

    def list_orgs(self) -> List[Organization]:
        """列出所有组织"""
        with self._lock:
            return list(self._orgs.values())

    def get_org(self, org_id: str) -> Optional[Organization]:
        """按 ID 获取组织"""
        with self._lock:
            return self._orgs.get(org_id)

    def update_org_quotas(self, org_id: str, quotas: Dict[str, Any]) -> Optional[Organization]:
        """更新组织配额

        Args:
            org_id: 组织 ID
            quotas: 配额字典

        Returns:
            Optional[Organization]: 更新后的组织（未找到为 None）
        """
        with self._lock:
            org = self._orgs.get(org_id)
            if not org:
                return None
            # 合并
            merged = dict(org.quotas)
            merged.update(quotas)
            org.quotas = merged
            self._save()
            return org

    def delete_org(self, org_id: str) -> bool:
        """删除组织（同时删除其团队/成员）"""
        with self._lock:
            if org_id not in self._orgs:
                return False
            del self._orgs[org_id]
            # 删团队
            team_ids = [t.team_id for t in self._teams.values() if t.org_id == org_id]
            for tid in team_ids:
                self._teams.pop(tid, None)
            # 删成员
            member_ids = [m.member_id for m in self._members.values() if m.org_id == org_id]
            for mid in member_ids:
                self._members.pop(mid, None)
            self._save()
            return True

    # ----------------------------------------------------------------
    # 团队 CRUD
    # ----------------------------------------------------------------
    def create_team(self, org_id: str, name: str, description: str = "", budget_usd: float = 0.0) -> Team:
        """创建团队

        Args:
            org_id: 组织 ID
            name: 团队名
            description: 描述
            budget_usd: 月预算

        Returns:
            Team: 团队实体
        """
        with self._lock:
            if org_id not in self._orgs:
                raise ValueError(f"org {org_id} not found")
            # 配额校验
            org = self._orgs[org_id]
            max_teams = int(org.quotas.get("max_teams", 999))
            current_teams = sum(1 for t in self._teams.values() if t.org_id == org_id)
            if current_teams >= max_teams:
                raise ValueError(f"org team quota reached: {current_teams}/{max_teams}")
            if not name or not name.strip():
                raise ValueError("team name required")
            team = Team(org_id=org_id, name=name.strip(), description=description, budget_usd=budget_usd)
            self._teams[team.team_id] = team
            self._save()
            return team

    def list_teams(self, org_id: str) -> List[Team]:
        """按组织列出团队"""
        with self._lock:
            return [t for t in self._teams.values() if t.org_id == org_id]

    def get_team(self, team_id: str) -> Optional[Team]:
        """按 ID 获取团队"""
        with self._lock:
            return self._teams.get(team_id)

    def add_team_member(self, team_id: str, member_id: str) -> Optional[Team]:
        """添加成员到团队

        Args:
            team_id: 团队 ID
            member_id: 成员 ID

        Returns:
            Optional[Team]: 更新后的团队
        """
        with self._lock:
            team = self._teams.get(team_id)
            if not team:
                return None
            if member_id not in self._members:
                raise ValueError(f"member {member_id} not found")
            if member_id not in team.members:
                team.members.append(member_id)
            # 同步到成员的 teams
            mem = self._members[member_id]
            if team_id not in mem.teams:
                mem.teams.append(team_id)
            self._save()
            return team

    def remove_team_member(self, team_id: str, member_id: str) -> Optional[Team]:
        """从团队移除成员"""
        with self._lock:
            team = self._teams.get(team_id)
            if not team:
                return None
            if member_id in team.members:
                team.members.remove(member_id)
            mem = self._members.get(member_id)
            if mem and team_id in mem.teams:
                mem.teams.remove(team_id)
            self._save()
            return team

    def delete_team(self, team_id: str) -> bool:
        """删除团队"""
        with self._lock:
            if team_id not in self._teams:
                return False
            del self._teams[team_id]
            # 从成员 teams 列表中移除
            for m in self._members.values():
                if team_id in m.teams:
                    m.teams.remove(team_id)
            self._save()
            return True

    # ----------------------------------------------------------------
    # 成员 CRUD
    # ----------------------------------------------------------------
    def invite_member(
        self,
        org_id: str,
        email: str,
        name: str = "",
        role: str = "developer",
    ) -> Member:
        """邀请成员加入组织

        Args:
            org_id: 组织 ID
            email: 邮箱
            name: 显示名
            role: 角色

        Returns:
            Member: 成员实体
        """
        with self._lock:
            if org_id not in self._orgs:
                raise ValueError(f"org {org_id} not found")
            if not _EMAIL_RE.match(email):
                raise ValueError(f"invalid email: {email}")
            # 配额校验
            org = self._orgs[org_id]
            max_members = int(org.quotas.get("max_members", 999))
            current = sum(1 for m in self._members.values() if m.org_id == org_id)
            if current >= max_members:
                raise ValueError(f"org member quota reached: {current}/{max_members}")
            # 去重
            for m in self._members.values():
                if m.org_id == org_id and m.email == email:
                    return m
            member = Member(
                org_id=org_id,
                email=email,
                name=name or email.split("@")[0],
                role=role,
                status="active",
            )
            self._members[member.member_id] = member
            self._save()
            return member

    def list_members(self, org_id: str) -> List[Member]:
        """列出组织成员"""
        with self._lock:
            return [m for m in self._members.values() if m.org_id == org_id]

    def get_member(self, member_id: str) -> Optional[Member]:
        """按 ID 获取成员"""
        with self._lock:
            return self._members.get(member_id)

    def update_member_role(self, member_id: str, role: str) -> Optional[Member]:
        """更新成员角色"""
        with self._lock:
            member = self._members.get(member_id)
            if not member:
                return None
            member.role = role
            self._save()
            return member

    def touch_active(self, member_id: str) -> Optional[Member]:
        """更新最后活跃时间"""
        with self._lock:
            member = self._members.get(member_id)
            if not member:
                return None
            member.last_active = _now_iso()
            self._save()
            return member

    def remove_member(self, member_id: str) -> bool:
        """移除成员"""
        with self._lock:
            if member_id not in self._members:
                return False
            member = self._members.pop(member_id)
            # 从团队中移除
            for t in self._teams.values():
                if member_id in t.members:
                    t.members.remove(member_id)
            self._save()
            return True

    # ----------------------------------------------------------------
    # 统计
    # ----------------------------------------------------------------
    def stats(self) -> Dict[str, Any]:
        """统计信息"""
        with self._lock:
            return {
                "orgs": len(self._orgs),
                "teams": len(self._teams),
                "members": len(self._members),
                "active_members": sum(1 for m in self._members.values() if m.status == "active"),
                "storage_dir": self.storage_dir,
            }
