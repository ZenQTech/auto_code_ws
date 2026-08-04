"""
# ============================================================
# AgentRole Pydantic 数据模型 (v1.0.0)
# Cycle 63 G63-02
# ============================================================
# 核心作用：定义 AgentRole / AgentInstance 的数据结构
# 输入参数：无（模型定义）
# 输出结果：Pydantic 模型
# 对标：Codex CLI v0.105+ sub-agent 系统
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 63 G63-02 初次创建
# ====================================
"""

import re
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


ROLE_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")


class AgentRole(BaseModel):
    """
    Agent 角色定义
    决定 spawn 出来的 Agent 实例具有什么能力（模型 / 沙箱 / MCP / 技能）
    """

    name: str = Field(..., min_length=1, max_length=64)
    description: str = Field(default="", max_length=1024)
    developer_instructions: str = Field(default="", max_length=10240)
    nickname_candidates: List[str] = Field(default_factory=list, max_length=20)
    model: Optional[str] = Field(default=None, max_length=128)
    model_reasoning_effort: Optional[str] = Field(default=None, max_length=32)
    sandbox_mode: Optional[str] = Field(default=None, max_length=32)
    mcp_servers: List[str] = Field(default_factory=list, max_length=20)
    skills: List[str] = Field(default_factory=list, max_length=20)
    builtin: bool = False
    created_at: float = 0.0
    updated_at: float = 0.0

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        if not ROLE_NAME_PATTERN.match(v):
            raise ValueError(
                f"角色名必须匹配 {ROLE_NAME_PATTERN.pattern}，实际: {v!r}"
            )
        return v

    @field_validator("nickname_candidates")
    @classmethod
    def _validate_nicknames(cls, v: List[str]) -> List[str]:
        for n in v:
            if not isinstance(n, str) or not n.strip():
                raise ValueError(f"nickname 不能为空: {n!r}")
            if len(n) > 64:
                raise ValueError(f"nickname 长度不能超过 64: {n!r}")
        return v

    @field_validator("sandbox_mode")
    @classmethod
    def _validate_sandbox(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        allowed = {"read-only", "workspace-write", "danger-full-access", "none"}
        if v not in allowed:
            raise ValueError(f"sandbox_mode 必须是 {allowed} 之一，实际: {v!r}")
        return v

    @field_validator("model_reasoning_effort")
    @classmethod
    def _validate_effort(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        allowed = {"low", "medium", "high"}
        if v not in allowed:
            raise ValueError(f"model_reasoning_effort 必须是 {allowed} 之一，实际: {v!r}")
        return v


class AgentInstance(BaseModel):
    """Agent 实例（运行时状态）"""

    agent_id: str
    role_name: str
    nickname: str
    status: str = "spawning"  # spawning/running/idle/failed/dead
    task: str = ""
    started_at: float = 0.0
    finished_at: Optional[float] = None
    result: Optional[str] = None
    error: Optional[str] = None


class CreateRoleRequest(BaseModel):
    """创建角色请求"""

    name: str = Field(..., min_length=1, max_length=64)
    description: str = Field(default="", max_length=1024)
    developer_instructions: str = Field(default="", max_length=10240)
    nickname_candidates: List[str] = Field(default_factory=list, max_length=20)
    model: Optional[str] = Field(default=None, max_length=128)
    model_reasoning_effort: Optional[str] = Field(default=None, max_length=32)
    sandbox_mode: Optional[str] = Field(default=None, max_length=32)
    mcp_servers: List[str] = Field(default_factory=list, max_length=20)
    skills: List[str] = Field(default_factory=list, max_length=20)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        if not ROLE_NAME_PATTERN.match(v):
            raise ValueError(
                f"角色名必须匹配 {ROLE_NAME_PATTERN.pattern}，实际: {v!r}"
            )
        return v


class UpdateRoleRequest(BaseModel):
    """更新角色请求（部分字段）"""

    description: Optional[str] = Field(default=None, max_length=1024)
    developer_instructions: Optional[str] = Field(default=None, max_length=10240)
    nickname_candidates: Optional[List[str]] = Field(default=None, max_length=20)
    model: Optional[str] = Field(default=None, max_length=128)
    model_reasoning_effort: Optional[str] = Field(default=None, max_length=32)
    sandbox_mode: Optional[str] = Field(default=None, max_length=32)
    mcp_servers: Optional[List[str]] = Field(default=None, max_length=20)
    skills: Optional[List[str]] = Field(default=None, max_length=20)


class SpawnAgentRequest(BaseModel):
    """spawn 实例请求"""

    task: str = Field(..., min_length=1, max_length=4096)
    nickname: Optional[str] = Field(default=None, max_length=64)
