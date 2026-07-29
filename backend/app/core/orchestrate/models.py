"""
# Orchestrate 数据模型
# ============================================================
# 核心作用：定义 Orchestrated Multi-Agent 阶段合约系统的核心数据模型
# 关联：Cycle 14 P1-1
# 版本：v6.29.0
#
# 模型层级：
#   1. 字段规范层：FieldSpec / FieldType / Invariant
#   2. 合约层：SLASpec / RetryPolicy / StageContract
#   3. 执行层：StageRef / Pipeline / StageExecution
#   4. 监控层：ExecutionMetrics / SLAMetrics / Alert
#
# 设计原则：
#   - 全部 dataclass + to_dict/from_dict 序列化
#   - 全部 enum 字符串值（便于 JSON 持久化）
#   - 线程安全（不存储可变全局状态）
# ============================================================
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple


# ============================================================
# 枚举定义
# ============================================================

class FieldType(str, Enum):
    """字段类型枚举"""
    STRING = "string"
    INT = "int"
    FLOAT = "float"
    BOOL = "bool"
    LIST = "list"
    DICT = "dict"
    ANY = "any"


class InvariantType(str, Enum):
    """不变量断言类型"""
    NON_NULL = "non_null"      # 字段不能为空
    NON_EMPTY = "non_empty"    # 字符串/列表不能为空
    RANGE = "range"            # 数值范围
    REGEX = "regex"            # 正则匹配
    ENUM = "enum"              # 枚举值
    CUSTOM = "custom"          # 自定义函数


class CircuitBreakerState(str, Enum):
    """熔断器状态"""
    CLOSED = "closed"          # 正常
    OPEN = "open"              # 已熔断
    HALF_OPEN = "half_open"    # 半开（试探）


class StageStatus(str, Enum):
    """阶段状态（注册表中的）"""
    REGISTERED = "registered"
    DEPRECATED = "deprecated"
    DISABLED = "disabled"


class PipelineStatus(str, Enum):
    """Pipeline 状态"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    PAUSED = "paused"
    CANCELLED = "cancelled"


class ExecutionStatus(str, Enum):
    """阶段执行状态"""
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SKIPPED = "skipped"
    RETRYING = "retrying"


class AlertSeverity(str, Enum):
    """告警严重程度"""
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


# ============================================================
# 字段规范
# ============================================================

@dataclass
class FieldSpec:
    """字段类型规范

    用于定义 StageContract 的 inputs/outputs 字段强类型。
    """
    name: str
    type: FieldType = FieldType.ANY
    required: bool = True
    default: Any = None
    description: str = ""
    # 类型相关约束
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    min_length: Optional[int] = None
    max_length: Optional[int] = None
    regex: Optional[str] = None
    enum_values: Optional[List[Any]] = None
    # 列表/字典的内部类型
    item_type: Optional[FieldType] = None
    item_spec: Optional["FieldSpec"] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "type": self.type.value if isinstance(self.type, FieldType) else self.type,
            "required": self.required,
            "default": self.default,
            "description": self.description,
            "min_value": self.min_value,
            "max_value": self.max_value,
            "min_length": self.min_length,
            "max_length": self.max_length,
            "regex": self.regex,
            "enum_values": self.enum_values,
            "item_type": self.item_type.value if isinstance(self.item_type, FieldType) else self.item_type,
            "item_spec": self.item_spec.to_dict() if self.item_spec else None,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "FieldSpec":
        return cls(
            name=data["name"],
            type=FieldType(data.get("type", "any")),
            required=data.get("required", True),
            default=data.get("default"),
            description=data.get("description", ""),
            min_value=data.get("min_value"),
            max_value=data.get("max_value"),
            min_length=data.get("min_length"),
            max_length=data.get("max_length"),
            regex=data.get("regex"),
            enum_values=data.get("enum_values"),
            item_type=FieldType(data["item_type"]) if data.get("item_type") else None,
            item_spec=cls.from_dict(data["item_spec"]) if data.get("item_spec") else None,
        )


@dataclass
class Invariant:
    """不变量断言

    用于在阶段执行前后验证数据完整性。
    """
    invariant_type: InvariantType
    field: str = ""
    # 范围断言
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    # 正则断言
    pattern: Optional[str] = None
    # 枚举断言
    allowed_values: Optional[List[Any]] = None
    # 自定义断言（仅存储名字，不可序列化）
    custom_fn_name: Optional[str] = None
    description: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "invariant_type": self.invariant_type.value,
            "field": self.field,
            "min_value": self.min_value,
            "max_value": self.max_value,
            "pattern": self.pattern,
            "allowed_values": self.allowed_values,
            "custom_fn_name": self.custom_fn_name,
            "description": self.description,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Invariant":
        return cls(
            invariant_type=InvariantType(data["invariant_type"]),
            field=data.get("field", ""),
            min_value=data.get("min_value"),
            max_value=data.get("max_value"),
            pattern=data.get("pattern"),
            allowed_values=data.get("allowed_values"),
            custom_fn_name=data.get("custom_fn_name"),
            description=data.get("description", ""),
        )


# ============================================================
# SLA + 重试策略
# ============================================================

@dataclass
class SLASpec:
    """阶段 SLA 规格"""
    # p99 延迟（毫秒）
    p99_latency_ms: int = 5000
    # 最小成功率（0-1）
    min_success_rate: float = 0.95
    # 最大并发数
    max_concurrent: int = 10
    # 优先级（数字越大越优先）
    priority: int = 5

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SLASpec":
        return cls(**data) if data else cls()


@dataclass
class RetryPolicy:
    """重试策略"""
    # 最大尝试次数
    max_attempts: int = 3
    # 基础延迟（毫秒）
    base_delay_ms: int = 1000
    # 最大延迟（毫秒）
    max_delay_ms: int = 30000
    # 退避倍数
    backoff_multiplier: float = 2.0
    # 是否启用抖动
    jitter: bool = True
    # 熔断阈值（连续失败次数）
    circuit_breaker_threshold: int = 5
    # 熔断恢复时间（毫秒）
    circuit_breaker_reset_ms: int = 60000
    # 失败时是否降级
    fallback_enabled: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "RetryPolicy":
        return cls(**data) if data else cls()


# ============================================================
# Stage Contract
# ============================================================

def _new_id(prefix: str) -> str:
    """生成新 ID（短格式）"""
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _now_iso() -> str:
    """当前时间 ISO 格式"""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


@dataclass
class StageContract:
    """阶段合约

    描述一个 Agent 阶段的输入/输出契约、SLA、重试策略等。
    """
    stage_id: str = field(default_factory=lambda: _new_id("stage"))
    name: str = ""
    description: str = ""
    # 强类型字段
    inputs: Dict[str, FieldSpec] = field(default_factory=dict)
    outputs: Dict[str, FieldSpec] = field(default_factory=dict)
    # 不变量断言
    preconditions: List[Invariant] = field(default_factory=list)
    postconditions: List[Invariant] = field(default_factory=list)
    # SLA + 重试
    sla: SLASpec = field(default_factory=SLASpec)
    retry_policy: RetryPolicy = field(default_factory=RetryPolicy)
    # 所需能力标签
    required_capabilities: List[str] = field(default_factory=list)
    # 单次执行超时（秒）
    timeout_seconds: int = 300
    # 阶段状态
    status: StageStatus = StageStatus.REGISTERED
    # 元数据
    version: str = "1.0.0"
    tags: List[str] = field(default_factory=list)
    created_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "stage_id": self.stage_id,
            "name": self.name,
            "description": self.description,
            "inputs": {k: v.to_dict() for k, v in self.inputs.items()},
            "outputs": {k: v.to_dict() for k, v in self.outputs.items()},
            "preconditions": [i.to_dict() for i in self.preconditions],
            "postconditions": [i.to_dict() for i in self.postconditions],
            "sla": self.sla.to_dict(),
            "retry_policy": self.retry_policy.to_dict(),
            "required_capabilities": self.required_capabilities,
            "timeout_seconds": self.timeout_seconds,
            "status": self.status.value,
            "version": self.version,
            "tags": self.tags,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StageContract":
        return cls(
            stage_id=data["stage_id"],
            name=data.get("name", ""),
            description=data.get("description", ""),
            inputs={k: FieldSpec.from_dict(v) for k, v in data.get("inputs", {}).items()},
            outputs={k: FieldSpec.from_dict(v) for k, v in data.get("outputs", {}).items()},
            preconditions=[Invariant.from_dict(i) for i in data.get("preconditions", [])],
            postconditions=[Invariant.from_dict(i) for i in data.get("postconditions", [])],
            sla=SLASpec.from_dict(data.get("sla", {})),
            retry_policy=RetryPolicy.from_dict(data.get("retry_policy", {})),
            required_capabilities=data.get("required_capabilities", []),
            timeout_seconds=data.get("timeout_seconds", 300),
            status=StageStatus(data.get("status", "registered")),
            version=data.get("version", "1.0.0"),
            tags=data.get("tags", []),
            created_at=data.get("created_at", _now_iso()),
        )


# ============================================================
# Pipeline 模型
# ============================================================

@dataclass
class StageRef:
    """Pipeline 中对 Stage 的引用

    描述一个阶段在 Pipeline 中的位置和依赖关系。
    """
    stage_id: str
    depends_on: List[str] = field(default_factory=list)
    # 并行分组（同一分组的阶段可并行执行）
    parallel_group: Optional[str] = None
    # 是否可选（失败时不影响 Pipeline）
    optional: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StageRef":
        return cls(**data)


@dataclass
class ExecutionMetrics:
    """单次执行的指标"""
    latency_ms: int = 0
    tokens_used: int = 0
    cost_usd: float = 0.0
    memory_mb: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExecutionMetrics":
        return cls(**data) if data else cls()


@dataclass
class StageExecution:
    """阶段执行记录

    跟踪每个阶段的执行状态、重试次数、性能指标等。
    """
    stage_id: str
    status: ExecutionStatus = ExecutionStatus.PENDING
    attempt: int = 1
    inputs_validated: bool = False
    outputs_validated: bool = False
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    latency_ms: int = 0
    error: Optional[str] = None
    error_code: Optional[str] = None
    metrics: ExecutionMetrics = field(default_factory=ExecutionMetrics)
    # 实际输出（执行后填充）
    outputs: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "stage_id": self.stage_id,
            "status": self.status.value,
            "attempt": self.attempt,
            "inputs_validated": self.inputs_validated,
            "outputs_validated": self.outputs_validated,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "latency_ms": self.latency_ms,
            "error": self.error,
            "error_code": self.error_code,
            "metrics": self.metrics.to_dict(),
            "outputs": self.outputs,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StageExecution":
        return cls(
            stage_id=data["stage_id"],
            status=ExecutionStatus(data.get("status", "pending")),
            attempt=data.get("attempt", 1),
            inputs_validated=data.get("inputs_validated", False),
            outputs_validated=data.get("outputs_validated", False),
            started_at=data.get("started_at"),
            completed_at=data.get("completed_at"),
            latency_ms=data.get("latency_ms", 0),
            error=data.get("error"),
            error_code=data.get("error_code"),
            metrics=ExecutionMetrics.from_dict(data.get("metrics", {})),
            outputs=data.get("outputs", {}),
        )


@dataclass
class Pipeline:
    """Pipeline 实体

    描述一个多阶段执行的工作流。
    """
    pipeline_id: str = field(default_factory=lambda: _new_id("pipe"))
    name: str = ""
    description: str = ""
    # 阶段定义（不含执行信息）
    stages: List[StageRef] = field(default_factory=list)
    # 全局输入
    inputs: Dict[str, Any] = field(default_factory=dict)
    # 状态
    status: PipelineStatus = PipelineStatus.PENDING
    # 模板来源
    template: Optional[str] = None
    # 创建者
    created_by: str = "system"
    # 时间戳
    created_at: str = field(default_factory=_now_iso)
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    # 执行计划（batches of parallel stages）
    execution_plan: List[List[str]] = field(default_factory=list)
    # 各阶段执行记录
    stage_executions: Dict[str, StageExecution] = field(default_factory=dict)
    # 整体指标
    total_latency_ms: int = 0
    total_cost_usd: float = 0.0
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "pipeline_id": self.pipeline_id,
            "name": self.name,
            "description": self.description,
            "stages": [s.to_dict() for s in self.stages],
            "inputs": self.inputs,
            "status": self.status.value,
            "template": self.template,
            "created_by": self.created_by,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "execution_plan": self.execution_plan,
            "stage_executions": {k: v.to_dict() for k, v in self.stage_executions.items()},
            "total_latency_ms": self.total_latency_ms,
            "total_cost_usd": self.total_cost_usd,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Pipeline":
        return cls(
            pipeline_id=data["pipeline_id"],
            name=data.get("name", ""),
            description=data.get("description", ""),
            stages=[StageRef.from_dict(s) for s in data.get("stages", [])],
            inputs=data.get("inputs", {}),
            status=PipelineStatus(data.get("status", "pending")),
            template=data.get("template"),
            created_by=data.get("created_by", "system"),
            created_at=data.get("created_at", _now_iso()),
            started_at=data.get("started_at"),
            completed_at=data.get("completed_at"),
            execution_plan=data.get("execution_plan", []),
            stage_executions={k: StageExecution.from_dict(v) for k, v in data.get("stage_executions", {}).items()},
            total_latency_ms=data.get("total_latency_ms", 0),
            total_cost_usd=data.get("total_cost_usd", 0.0),
            error=data.get("error"),
        )


# ============================================================
# 监控数据
# ============================================================

@dataclass
class SLAMetrics:
    """SLA 指标聚合"""
    stage_id: str
    p50_latency_ms: int = 0
    p95_latency_ms: int = 0
    p99_latency_ms: int = 0
    total_executions: int = 0
    successful_executions: int = 0
    failed_executions: int = 0
    success_rate: float = 1.0
    avg_latency_ms: int = 0
    # 时间窗
    window_start: str = field(default_factory=_now_iso)
    window_end: str = field(default_factory=_now_iso)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SLAMetrics":
        return cls(**data)


@dataclass
class Alert:
    """SLA 告警"""
    alert_id: str = field(default_factory=lambda: _new_id("alert"))
    stage_id: str = ""
    pipeline_id: Optional[str] = None
    severity: AlertSeverity = AlertSeverity.WARNING
    metric: str = ""
    threshold: float = 0.0
    actual: float = 0.0
    message: str = ""
    timestamp: str = field(default_factory=_now_iso)
    acknowledged: bool = False
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Alert":
        return cls(
            alert_id=data.get("alert_id", _new_id("alert")),
            stage_id=data.get("stage_id", ""),
            pipeline_id=data.get("pipeline_id"),
            severity=AlertSeverity(data.get("severity", "warning")),
            metric=data.get("metric", ""),
            threshold=data.get("threshold", 0.0),
            actual=data.get("actual", 0.0),
            message=data.get("message", ""),
            timestamp=data.get("timestamp", _now_iso()),
            acknowledged=data.get("acknowledged", False),
            acknowledged_by=data.get("acknowledged_by"),
            acknowledged_at=data.get("acknowledged_at"),
        )
