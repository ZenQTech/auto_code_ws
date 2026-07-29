"""
# ============================================================
# Hermes Multi-Agent Delegation - 多 Agent 委派策略
# ============================================================
# 核心作用：根据 AC 类型、风险等级、依赖关系，自动选择并委派
#           合适的 Agent 角色（架构师 / 实施者 / 验证者 / 审查者 /
#           测试者 / 文档者 / 编排者）。
# 运行流程：
#   1. 注册 Agent（role + capabilities + risk_levels）
#   2. 接收 DelegationRequest（goal_id + ac_id + ac_type + risk_level）
#   3. 委派决策：AC 类型 → 角色 → 可用 Agent → 负载最小
#   4. 失败转移：首选 Agent 不可用时尝试备选角色
#   5. 记录审计日志
# 输入参数：
#   - 无（构造时无参数）
# 输出结果：
#   - DelegationResult（agent_id + decision + reason）
# 复用说明：
#   - 零外部依赖（仅 stdlib）
#   - 通过 RLock 保证线程安全
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 14 P1-4 新建
# ============================================================
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ============================================================
# 枚举定义
# ============================================================
class AgentRole(str, Enum):
    """Agent 角色"""
    ARCHITECT = "architect"           # 架构师
    IMPLEMENTER = "implementer"       # 实施者
    VERIFIER = "verifier"             # 验证者
    REVIEWER = "reviewer"             # 审查者
    TESTER = "tester"                 # 测试者
    DOCUMENTER = "documenter"         # 文档者
    ORCHESTRATOR = "orchestrator"     # 编排者


class RiskLevel(str, Enum):
    """风险等级"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class DelegationDecision(str, Enum):
    """委派决策"""
    DELEGATED = "delegated"           # 已委派
    QUEUED = "queued"                 # 排队中
    FAILED = "failed"                 # 失败
    REJECTED = "rejected"             # 拒绝


class ACType(str, Enum):
    """AC 类型"""
    IMPLEMENTATION = "implementation"     # 实施
    VERIFICATION = "verification"         # 验证
    REVIEW = "review"                     # 审查
    TESTING = "testing"                   # 测试
    DOCUMENTATION = "documentation"       # 文档
    ARCHITECTURE = "architecture"         # 架构
    INTEGRATION = "integration"           # 集成
    UNKNOWN = "unknown"                   # 未知


# ============================================================
# 数据模型
# ============================================================
@dataclass
class AgentSpec:
    """Agent 规格"""
    agent_id: str
    role: str
    name: str
    capabilities: List[str] = field(default_factory=list)
    risk_levels: List[str] = field(default_factory=lambda: ["low", "medium"])
    max_load: int = 5
    current_load: int = 0
    total_tasks: int = 0
    success_count: int = 0
    failure_count: int = 0
    status: str = "available"          # available / busy / offline
    last_heartbeat: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AgentSpec":
        return cls(
            agent_id=data.get("agent_id", ""),
            role=data.get("role", ""),
            name=data.get("name", ""),
            capabilities=data.get("capabilities", []),
            risk_levels=data.get("risk_levels", ["low", "medium"]),
            max_load=data.get("max_load", 5),
            current_load=data.get("current_load", 0),
            total_tasks=data.get("total_tasks", 0),
            success_count=data.get("success_count", 0),
            failure_count=data.get("failure_count", 0),
            status=data.get("status", "available"),
            last_heartbeat=data.get("last_heartbeat"),
            created_at=data.get("created_at", datetime.now(timezone.utc).isoformat()),
            metadata=data.get("metadata", {}),
        )

    @property
    def success_rate(self) -> float:
        if self.total_tasks == 0:
            return 0.0
        return self.success_count / self.total_tasks


@dataclass
class DelegationRequest:
    """委派请求"""
    delegation_id: str = field(default_factory=lambda: f"del_{uuid.uuid4().hex[:8]}")
    goal_id: str = ""
    ac_id: str = ""
    ac_title: str = ""
    ac_type: str = ACType.UNKNOWN.value
    risk_level: str = RiskLevel.MEDIUM.value
    required_capabilities: List[str] = field(default_factory=list)
    priority: int = 1
    context: Dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DelegationRequest":
        return cls(
            delegation_id=data.get("delegation_id", f"del_{uuid.uuid4().hex[:8]}"),
            goal_id=data.get("goal_id", ""),
            ac_id=data.get("ac_id", ""),
            ac_title=data.get("ac_title", ""),
            ac_type=data.get("ac_type", ACType.UNKNOWN.value),
            risk_level=data.get("risk_level", RiskLevel.MEDIUM.value),
            required_capabilities=data.get("required_capabilities", []),
            priority=data.get("priority", 1),
            context=data.get("context", {}),
            created_at=data.get("created_at", datetime.now(timezone.utc).isoformat()),
        )


@dataclass
class DelegationResult:
    """委派结果"""
    delegation_id: str
    goal_id: str
    ac_id: str
    ac_type: str
    risk_level: str
    agent_id: str = ""
    agent_role: str = ""
    decision: str = DelegationDecision.FAILED.value
    reason: str = ""
    fallback_attempts: List[str] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    completed_at: Optional[str] = None
    output: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DelegationResult":
        return cls(
            delegation_id=data.get("delegation_id", ""),
            goal_id=data.get("goal_id", ""),
            ac_id=data.get("ac_id", ""),
            ac_type=data.get("ac_type", ACType.UNKNOWN.value),
            risk_level=data.get("risk_level", RiskLevel.MEDIUM.value),
            agent_id=data.get("agent_id", ""),
            agent_role=data.get("agent_role", ""),
            decision=data.get("decision", DelegationDecision.FAILED.value),
            reason=data.get("reason", ""),
            fallback_attempts=data.get("fallback_attempts", []),
            created_at=data.get("created_at", datetime.now(timezone.utc).isoformat()),
            completed_at=data.get("completed_at"),
            output=data.get("output", {}),
        )


# ============================================================
# AC 类型映射器
# ============================================================
class ACTypeMapping:
    """
    AC 类型 → 首选 Agent 角色映射器
    """
    # 关键词 → AC 类型
    KEYWORD_PATTERNS: Dict[str, List[str]] = {
        ACType.IMPLEMENTATION.value: [
            "implement", "开发", "实现", "代码", "code", "build", "create", "添加", "新增",
        ],
        ACType.VERIFICATION.value: [
            "verify", "validate", "check", "验证", "确认", "校验",
        ],
        ACType.REVIEW.value: [
            "review", "audit", "审查", "审核", "review",
        ],
        ACType.TESTING.value: [
            "test", "e2e", "unit test", "测试", "pytest", "coverage",
        ],
        ACType.DOCUMENTATION.value: [
            "document", "docs", "readme", "文档", "说明", "tutorial",
        ],
        ACType.ARCHITECTURE.value: [
            "architect", "design", "架构", "设计", "规划",
        ],
        ACType.INTEGRATION.value: [
            "integrate", "connect", "集成", "对接", "merge", "整合",
        ],
    }

    # AC 类型 → 首选角色
    TYPE_TO_ROLE: Dict[str, List[str]] = {
        ACType.IMPLEMENTATION.value: [AgentRole.IMPLEMENTER.value, AgentRole.ARCHITECT.value],
        ACType.VERIFICATION.value: [AgentRole.VERIFIER.value, AgentRole.TESTER.value],
        ACType.REVIEW.value: [AgentRole.REVIEWER.value, AgentRole.ARCHITECT.value],
        ACType.TESTING.value: [AgentRole.TESTER.value, AgentRole.VERIFIER.value],
        ACType.DOCUMENTATION.value: [AgentRole.DOCUMENTER.value, AgentRole.REVIEWER.value],
        ACType.ARCHITECTURE.value: [AgentRole.ARCHITECT.value, AgentRole.IMPLEMENTER.value],
        ACType.INTEGRATION.value: [AgentRole.IMPLEMENTER.value, AgentRole.TESTER.value],
        ACType.UNKNOWN.value: [AgentRole.IMPLEMENTER.value, AgentRole.VERIFIER.value],
    }

    # 风险等级 → 允许角色（CRITICAL 仅架构师）
    RISK_TO_ROLES: Dict[str, List[str]] = {
        RiskLevel.LOW.value: [
            AgentRole.IMPLEMENTER.value,
            AgentRole.VERIFIER.value,
            AgentRole.TESTER.value,
            AgentRole.DOCUMENTER.value,
            AgentRole.REVIEWER.value,
            AgentRole.ARCHITECT.value,
            AgentRole.ORCHESTRATOR.value,
        ],
        RiskLevel.MEDIUM.value: [
            AgentRole.IMPLEMENTER.value,
            AgentRole.VERIFIER.value,
            AgentRole.TESTER.value,
            AgentRole.REVIEWER.value,
            AgentRole.ARCHITECT.value,
            AgentRole.ORCHESTRATOR.value,
        ],
        RiskLevel.HIGH.value: [
            AgentRole.ARCHITECT.value,
            AgentRole.REVIEWER.value,
            AgentRole.ORCHESTRATOR.value,
        ],
        RiskLevel.CRITICAL.value: [
            AgentRole.ARCHITECT.value,
        ],
    }

    @classmethod
    def infer(cls, title: str, description: str = "") -> str:
        """
        根据标题/描述推断 AC 类型

        参数：title - AC 标题；description - 描述
        返回：AC 类型字符串
        """
        text = f"{title} {description}".lower()
        # 按关键词匹配度评分
        scores: Dict[str, int] = {}
        for ac_type, keywords in cls.KEYWORD_PATTERNS.items():
            score = sum(1 for kw in keywords if kw.lower() in text)
            if score > 0:
                scores[ac_type] = score
        if not scores:
            return ACType.UNKNOWN.value
        return max(scores, key=scores.get)  # type: ignore

    @classmethod
    def get_preferred_roles(cls, ac_type: str) -> List[str]:
        """获取 AC 类型对应的首选角色列表"""
        return cls.TYPE_TO_ROLE.get(ac_type, [AgentRole.IMPLEMENTER.value])

    @classmethod
    def get_allowed_roles(cls, risk_level: str) -> List[str]:
        """获取风险等级允许的角色列表"""
        return cls.RISK_TO_ROLES.get(risk_level, cls.RISK_TO_ROLES[RiskLevel.LOW.value])


# ============================================================
# Multi-Agent Delegator
# ============================================================
class MultiAgentDelegator:
    """
    多 Agent 委派器

    负责：
      - Agent 注册/注销
      - 委派决策（AC 类型 → 角色 → Agent）
      - 负载均衡
      - 故障转移
      - 审计日志
    """

    def __init__(self, storage_dir: Optional[str] = None) -> None:
        """初始化"""
        if storage_dir is None:
            storage_dir = os.path.join(os.path.expanduser("~"), ".hermes", "goal_automation")
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.agents_file = self.storage_dir / "agents.jsonl"
        self.delegations_file = self.storage_dir / "delegations.jsonl"

        self._lock = threading.RLock()
        self._agents: Dict[str, AgentSpec] = {}
        self._delegations: List[DelegationResult] = []

        # 加载持久化
        self._load()

        logger.info(f"MultiAgentDelegator 初始化完成 storage_dir={self.storage_dir}")

    def _load(self) -> None:
        """加载持久化数据"""
        if self.agents_file.exists():
            try:
                with open(self.agents_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            data = json.loads(line)
                            spec = AgentSpec.from_dict(data)
                            self._agents[spec.agent_id] = spec
            except Exception as e:
                logger.error(f"加载 agents 失败: {e}")

        if self.delegations_file.exists():
            try:
                with open(self.delegations_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            data = json.loads(line)
                            self._delegations.append(DelegationResult.from_dict(data))
            except Exception as e:
                logger.error(f"加载 delegations 失败: {e}")

    def _save_agent(self, spec: AgentSpec) -> None:
        """保存 Agent 到 JSONL"""
        try:
            with open(self.agents_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(spec.to_dict(), ensure_ascii=False) + "\n")
        except Exception as e:
            logger.error(f"保存 agent 失败: {e}")

    def _append_delegation(self, result: DelegationResult) -> None:
        """追加委派记录"""
        try:
            with open(self.delegations_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(result.to_dict(), ensure_ascii=False) + "\n")
        except Exception as e:
            logger.error(f"追加委派记录失败: {e}")

    # ============================================================
    # Agent 管理
    # ============================================================
    def register_agent(self, spec: AgentSpec) -> AgentSpec:
        """
        注册 Agent

        参数：spec - AgentSpec
        返回：注册后的 spec
        """
        with self._lock:
            if not spec.agent_id:
                raise ValueError("agent_id is required")
            if not spec.role:
                raise ValueError("role is required")
            # 校验 role
            valid_roles = [r.value for r in AgentRole]
            if spec.role not in valid_roles:
                raise ValueError(f"Invalid role: {spec.role}, must be one of {valid_roles}")
            # 校验 risk_levels
            valid_risks = [r.value for r in RiskLevel]
            for rl in spec.risk_levels:
                if rl not in valid_risks:
                    raise ValueError(f"Invalid risk_level: {rl}")

            self._agents[spec.agent_id] = spec
            self._save_agent(spec)
            logger.info(f"Agent {spec.agent_id} ({spec.role}) 已注册")
            return spec

    def unregister_agent(self, agent_id: str) -> bool:
        """注销 Agent"""
        with self._lock:
            if agent_id not in self._agents:
                return False
            del self._agents[agent_id]
            logger.info(f"Agent {agent_id} 已注销")
            return True

    def get_agent(self, agent_id: str) -> Optional[AgentSpec]:
        """获取 Agent"""
        with self._lock:
            return self._agents.get(agent_id)

    def list_agents(
        self,
        role: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[AgentSpec]:
        """列出 Agent"""
        with self._lock:
            result = list(self._agents.values())
            if role:
                result = [a for a in result if a.role == role]
            if status:
                result = [a for a in result if a.status == status]
            return result

    def update_agent_status(self, agent_id: str, status: str) -> bool:
        """更新 Agent 状态"""
        with self._lock:
            spec = self._agents.get(agent_id)
            if not spec:
                return False
            spec.status = status
            spec.last_heartbeat = datetime.now(timezone.utc).isoformat()
            return True

    # ============================================================
    # 委派决策
    # ============================================================
    def delegate(self, request: DelegationRequest) -> DelegationResult:
        """
        委派任务

        参数：request - DelegationRequest
        返回：DelegationResult
        """
        with self._lock:
            # 1. 推断 AC 类型
            ac_type = request.ac_type
            if not ac_type or ac_type == ACType.UNKNOWN.value:
                ac_type = ACTypeMapping.infer(request.ac_title)
            request.ac_type = ac_type

            # 2. 获取首选角色 + 备选
            preferred_roles = ACTypeMapping.get_preferred_roles(ac_type)
            allowed_roles = ACTypeMapping.get_allowed_roles(request.risk_level)
            # 交集
            candidate_roles = [r for r in preferred_roles if r in allowed_roles]
            if not candidate_roles:
                # 风险过高且无匹配角色
                result = DelegationResult(
                    delegation_id=request.delegation_id,
                    goal_id=request.goal_id,
                    ac_id=request.ac_id,
                    ac_type=ac_type,
                    risk_level=request.risk_level,
                    decision=DelegationDecision.REJECTED.value,
                    reason=f"No allowed role for risk_level={request.risk_level}",
                )
                self._delegations.append(result)
                self._append_delegation(result)
                return result

            fallback_attempts: List[str] = []

            # 3. 依次尝试候选角色
            for role in candidate_roles:
                # 过滤可用 Agent
                candidates = [
                    a for a in self._agents.values()
                    if a.role == role
                    and a.status == "available"
                    and a.current_load < a.max_load
                    and request.risk_level in a.risk_levels
                ]
                # 能力匹配
                if request.required_capabilities:
                    candidates = [
                        a for a in candidates
                        if all(
                            cap.lower() in [c.lower() for c in a.capabilities]
                            for cap in request.required_capabilities
                        )
                    ]
                if not candidates:
                    fallback_attempts.append(f"role={role}:no_available_agent")
                    continue

                # 负载均衡：选 load 最小 + 成功率最高
                candidates.sort(key=lambda a: (a.current_load, -a.success_rate))
                chosen = candidates[0]

                # 委派
                chosen.current_load += 1
                chosen.total_tasks += 1
                if chosen.current_load >= chosen.max_load:
                    chosen.status = "busy"

                result = DelegationResult(
                    delegation_id=request.delegation_id,
                    goal_id=request.goal_id,
                    ac_id=request.ac_id,
                    ac_type=ac_type,
                    risk_level=request.risk_level,
                    agent_id=chosen.agent_id,
                    agent_role=chosen.role,
                    decision=DelegationDecision.DELEGATED.value,
                    reason=f"Role match (priority={candidate_roles.index(role) + 1}) + load balanced",
                    fallback_attempts=fallback_attempts,
                )
                self._delegations.append(result)
                self._append_delegation(result)
                logger.info(
                    f"委派成功 delegation_id={result.delegation_id} "
                    f"agent={chosen.agent_id} role={chosen.role}"
                )
                return result

            # 4. 所有候选都失败 → 排队
            result = DelegationResult(
                delegation_id=request.delegation_id,
                goal_id=request.goal_id,
                ac_id=request.ac_id,
                ac_type=ac_type,
                risk_level=request.risk_level,
                decision=DelegationDecision.QUEUED.value,
                reason="All candidate roles unavailable, queued",
                fallback_attempts=fallback_attempts,
            )
            self._delegations.append(result)
            self._append_delegation(result)
            return result

    # ============================================================
    # 完成回调
    # ============================================================
    def complete_delegation(
        self,
        delegation_id: str,
        success: bool = True,
        output: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """
        完成委派（Agent 报告任务完成）

        参数：delegation_id, success, output
        返回：True 成功
        """
        with self._lock:
            # 找到对应委派
            for d in reversed(self._delegations):
                if d.delegation_id == delegation_id:
                    d.completed_at = datetime.now(timezone.utc).isoformat()
                    d.output = output or {}
                    # 更新 Agent 状态
                    agent = self._agents.get(d.agent_id)
                    if agent:
                        agent.current_load = max(0, agent.current_load - 1)
                        if success:
                            agent.success_count += 1
                        else:
                            agent.failure_count += 1
                        if agent.current_load < agent.max_load:
                            agent.status = "available"
                    return True
            return False

    # ============================================================
    # 查询 / 统计
    # ============================================================
    def get_delegation_history(
        self,
        goal_id: Optional[str] = None,
        limit: int = 100,
    ) -> List[DelegationResult]:
        """获取委派历史"""
        with self._lock:
            history = self._delegations
            if goal_id:
                history = [d for d in history if d.goal_id == goal_id]
            return history[-limit:][::-1]

    def get_load_distribution(self) -> Dict[str, Any]:
        """获取负载分布"""
        with self._lock:
            role_dist: Dict[str, int] = {}
            for a in self._agents.values():
                role_dist[a.role] = role_dist.get(a.role, 0) + 1

            status_dist: Dict[str, int] = {}
            for a in self._agents.values():
                status_dist[a.status] = status_dist.get(a.status, 0) + 1

            load_avg = (
                sum(a.current_load for a in self._agents.values())
                / max(1, len(self._agents))
            )

            return {
                "total_agents": len(self._agents),
                "by_role": role_dist,
                "by_status": status_dist,
                "avg_load": round(load_avg, 2),
            }

    def health_check(self) -> Dict[str, str]:
        """健康检查"""
        with self._lock:
            result: Dict[str, str] = {}
            for aid, a in self._agents.items():
                result[aid] = f"{a.status} (load={a.current_load}/{a.max_load})"
            return result

    def get_stats(self) -> Dict[str, Any]:
        """获取统计"""
        with self._lock:
            total = len(self._delegations)
            delegated = sum(1 for d in self._delegations if d.decision == DelegationDecision.DELEGATED.value)
            queued = sum(1 for d in self._delegations if d.decision == DelegationDecision.QUEUED.value)
            failed = sum(1 for d in self._delegations if d.decision == DelegationDecision.FAILED.value)
            rejected = sum(1 for d in self._delegations if d.decision == DelegationDecision.REJECTED.value)
            completed = sum(1 for d in self._delegations if d.completed_at is not None)
            return {
                "total_agents": len(self._agents),
                "total_delegations": total,
                "delegated": delegated,
                "queued": queued,
                "failed": failed,
                "rejected": rejected,
                "completed": completed,
                "load_distribution": self.get_load_distribution(),
            }


# ============================================================
# 全局单例
# ============================================================
_delegator_instance: Optional[MultiAgentDelegator] = None
_delegator_lock = threading.Lock()


def get_delegator() -> MultiAgentDelegator:
    """获取全局 MultiAgentDelegator 单例"""
    global _delegator_instance
    with _delegator_lock:
        if _delegator_instance is None:
            _delegator_instance = MultiAgentDelegator()
        return _delegator_instance


def reset_delegator() -> None:
    """重置全局单例（测试用）"""
    global _delegator_instance
    with _delegator_lock:
        _delegator_instance = None
