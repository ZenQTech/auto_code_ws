"""
# Orchestrate 模块入口
# ============================================================
# 核心作用：实现 Orchestrated Multi-Agent 阶段合约系统
# 关联：Cycle 14 P1-1
# 版本：v6.29.0
#
# 子模块：
#   - models: 数据模型（StageContract/Pipeline/StageExecution）
#   - contracts: Stage Contract 强类型字段定义
#   - dag: Pipeline DAG 引擎（拓扑排序 + 并行优化）
#   - executor: 并行执行器（多阶段并发调度）
#   - validator: Contract 验证器（输入/输出/不变量）
#   - sla: SLA 监控（p50/p95/p99 + 告警）
#   - retry: 重试编排（指数退避 + 熔断）
#   - registry: 阶段注册中心
#   - templates: 预定义 Pipeline 模板
#   - api: REST API
# ============================================================
"""

from .models import (
    FieldSpec,
    FieldType,
    Invariant,
    InvariantType,
    SLASpec,
    RetryPolicy,
    CircuitBreakerState,
    StageContract,
    StageRef,
    StageStatus,
    Pipeline,
    PipelineStatus,
    StageExecution,
    ExecutionStatus,
    ExecutionMetrics,
    SLAMetrics,
    Alert,
    AlertSeverity,
)

from .contracts import (
    build_text_field,
    build_int_field,
    build_float_field,
    build_bool_field,
    build_list_field,
    build_dict_field,
    build_any_field,
    ContractBuilder,
    invariant_non_null,
    invariant_non_empty,
    invariant_range,
    invariant_regex,
    invariant_enum,
)

from .dag import (
    build_execution_plan,
    detect_cycles,
    validate_dag,
    get_critical_path,
    get_parallelism,
    CycleError,
    DAGValidationError,
)

from .executor import PipelineExecutor

from .validator import ContractValidator, ValidationError

from .sla import SLAMonitor

from .retry import RetryOrchestrator, CircuitBreaker

from .registry import StageRegistry, GLOBAL_REGISTRY

from .templates import (
    list_templates,
    get_template,
    instantiate_template,
    PIPELINE_TEMPLATES,
)

from .api import router, ENDPOINT_COUNT

__all__ = [
    # 数据模型
    "FieldSpec",
    "FieldType",
    "Invariant",
    "InvariantType",
    "SLASpec",
    "RetryPolicy",
    "CircuitBreakerState",
    "StageContract",
    "StageRef",
    "StageStatus",
    "Pipeline",
    "PipelineStatus",
    "StageExecution",
    "ExecutionStatus",
    "ExecutionMetrics",
    "SLAMetrics",
    "Alert",
    "AlertSeverity",
    # 合约构建
    "build_text_field",
    "build_int_field",
    "build_float_field",
    "build_bool_field",
    "build_list_field",
    "build_dict_field",
    "build_any_field",
    "ContractBuilder",
    "invariant_non_null",
    "invariant_non_empty",
    "invariant_range",
    "invariant_regex",
    "invariant_enum",
    # DAG
    "build_execution_plan",
    "detect_cycles",
    "validate_dag",
    "get_critical_path",
    "get_parallelism",
    "CycleError",
    "DAGValidationError",
    # 执行器
    "PipelineExecutor",
    # 验证器
    "ContractValidator",
    "ValidationError",
    # SLA
    "SLAMonitor",
    # 重试
    "RetryOrchestrator",
    "CircuitBreaker",
    # 注册中心
    "StageRegistry",
    "GLOBAL_REGISTRY",
    # 模板
    "list_templates",
    "get_template",
    "instantiate_template",
    "PIPELINE_TEMPLATES",
    # API
    "router",
    "ENDPOINT_COUNT",
]
