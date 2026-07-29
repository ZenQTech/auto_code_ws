"""
# Orchestrate Stage Contract 强类型字段构建器
# ============================================================
# 核心作用：提供 FieldSpec 的便捷构建器 + Invariant 工厂
# 关联：Cycle 14 P1-1
# 版本：v6.29.0
#
# 使用方式：
#   contract = (ContractBuilder("code_review")
#       .input("repo", build_text_field(...))
#       .output("report", build_text_field(...))
#       .build())
# ============================================================
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .models import (
    FieldSpec,
    FieldType,
    Invariant,
    InvariantType,
    StageContract,
    SLASpec,
    RetryPolicy,
    StageStatus,
)


# ============================================================
# FieldSpec 工厂函数
# ============================================================

def build_text_field(
    name: str,
    *,
    required: bool = True,
    default: Optional[str] = None,
    description: str = "",
    min_length: Optional[int] = None,
    max_length: Optional[int] = None,
    regex: Optional[str] = None,
    enum_values: Optional[List[str]] = None,
) -> FieldSpec:
    """构建文本类型字段"""
    return FieldSpec(
        name=name,
        type=FieldType.STRING,
        required=required,
        default=default,
        description=description,
        min_length=min_length,
        max_length=max_length,
        regex=regex,
        enum_values=enum_values,
    )


def build_int_field(
    name: str,
    *,
    required: bool = True,
    default: Optional[int] = None,
    description: str = "",
    min_value: Optional[int] = None,
    max_value: Optional[int] = None,
) -> FieldSpec:
    """构建整数类型字段"""
    return FieldSpec(
        name=name,
        type=FieldType.INT,
        required=required,
        default=default,
        description=description,
        min_value=min_value,
        max_value=max_value,
    )


def build_float_field(
    name: str,
    *,
    required: bool = True,
    default: Optional[float] = None,
    description: str = "",
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
) -> FieldSpec:
    """构建浮点类型字段"""
    return FieldSpec(
        name=name,
        type=FieldType.FLOAT,
        required=required,
        default=default,
        description=description,
        min_value=min_value,
        max_value=max_value,
    )


def build_bool_field(
    name: str,
    *,
    required: bool = True,
    default: Optional[bool] = None,
    description: str = "",
) -> FieldSpec:
    """构建布尔类型字段"""
    return FieldSpec(
        name=name,
        type=FieldType.BOOL,
        required=required,
        default=default,
        description=description,
    )


def build_list_field(
    name: str,
    item_type: FieldType = FieldType.STRING,
    *,
    required: bool = True,
    default: Optional[List[Any]] = None,
    description: str = "",
    min_length: Optional[int] = None,
    max_length: Optional[int] = None,
) -> FieldSpec:
    """构建列表类型字段"""
    return FieldSpec(
        name=name,
        type=FieldType.LIST,
        required=required,
        default=default if default is not None else [],
        description=description,
        min_length=min_length,
        max_length=max_length,
        item_type=item_type,
    )


def build_dict_field(
    name: str,
    *,
    required: bool = True,
    default: Optional[Dict[str, Any]] = None,
    description: str = "",
) -> FieldSpec:
    """构建字典类型字段"""
    return FieldSpec(
        name=name,
        type=FieldType.DICT,
        required=required,
        default=default if default is not None else {},
        description=description,
    )


def build_any_field(
    name: str,
    *,
    required: bool = True,
    default: Any = None,
    description: str = "",
) -> FieldSpec:
    """构建任意类型字段"""
    return FieldSpec(
        name=name,
        type=FieldType.ANY,
        required=required,
        default=default,
        description=description,
    )


# ============================================================
# Invariant 工厂函数
# ============================================================

def invariant_non_null(field: str, description: str = "") -> Invariant:
    """非空断言"""
    return Invariant(
        invariant_type=InvariantType.NON_NULL,
        field=field,
        description=description or f"Field '{field}' must not be null",
    )


def invariant_non_empty(field: str, description: str = "") -> Invariant:
    """非空字符串/列表断言"""
    return Invariant(
        invariant_type=InvariantType.NON_EMPTY,
        field=field,
        description=description or f"Field '{field}' must not be empty",
    )


def invariant_range(
    field: str,
    min_value: float,
    max_value: float,
    description: str = "",
) -> Invariant:
    """数值范围断言"""
    return Invariant(
        invariant_type=InvariantType.RANGE,
        field=field,
        min_value=min_value,
        max_value=max_value,
        description=description or f"Field '{field}' must be in [{min_value}, {max_value}]",
    )


def invariant_regex(
    field: str,
    pattern: str,
    description: str = "",
) -> Invariant:
    """正则匹配断言"""
    return Invariant(
        invariant_type=InvariantType.REGEX,
        field=field,
        pattern=pattern,
        description=description or f"Field '{field}' must match pattern {pattern}",
    )


def invariant_enum(
    field: str,
    allowed_values: List[Any],
    description: str = "",
) -> Invariant:
    """枚举值断言"""
    return Invariant(
        invariant_type=InvariantType.ENUM,
        field=field,
        allowed_values=allowed_values,
        description=description or f"Field '{field}' must be one of {allowed_values}",
    )


# ============================================================
# ContractBuilder 流式构建器
# ============================================================

class ContractBuilder:
    """Stage Contract 流式构建器

    使用方式：
        contract = (ContractBuilder("code_review", "Code review stage")
            .description("...")
            .input("repo", build_text_field("repo"))
            .input("pr_number", build_int_field("pr_number", min_value=1))
            .output("report", build_text_field("report"))
            .precondition(invariant_non_null("repo"))
            .postcondition(invariant_non_empty("report"))
            .sla(SLASpec(p99_latency_ms=10000))
            .retry_policy(RetryPolicy(max_attempts=3))
            .capability("code_analysis")
            .timeout(300)
            .tag("review")
            .build())
    """

    def __init__(self, name: str, description: str = "", stage_id: Optional[str] = None):
        self._contract = StageContract(
            stage_id=stage_id or f"stage_{name}",
            name=name,
            description=description,
        )

    def stage_id(self, sid: str) -> "ContractBuilder":
        """显式设置阶段 ID"""
        self._contract.stage_id = sid
        return self

    def description(self, text: str) -> "ContractBuilder":
        self._contract.description = text
        return self

    def input(self, name: str, spec: FieldSpec) -> "ContractBuilder":
        """添加输入字段"""
        if spec.name != name:
            spec.name = name
        self._contract.inputs[name] = spec
        return self

    def output(self, name: str, spec: FieldSpec) -> "ContractBuilder":
        """添加输出字段"""
        if spec.name != name:
            spec.name = name
        self._contract.outputs[name] = spec
        return self

    def precondition(self, inv: Invariant) -> "ContractBuilder":
        """添加前置不变量"""
        self._contract.preconditions.append(inv)
        return self

    def postcondition(self, inv: Invariant) -> "ContractBuilder":
        """添加后置不变量"""
        self._contract.postconditions.append(inv)
        return self

    def sla(self, sla: SLASpec) -> "ContractBuilder":
        """设置 SLA"""
        self._contract.sla = sla
        return self

    def retry_policy(self, policy: RetryPolicy) -> "ContractBuilder":
        """设置重试策略"""
        self._contract.retry_policy = policy
        return self

    def capability(self, cap: str) -> "ContractBuilder":
        """添加所需能力"""
        if cap not in self._contract.required_capabilities:
            self._contract.required_capabilities.append(cap)
        return self

    def timeout(self, seconds: int) -> "ContractBuilder":
        """设置超时"""
        self._contract.timeout_seconds = seconds
        return self

    def tag(self, t: str) -> "ContractBuilder":
        """添加标签"""
        if t not in self._contract.tags:
            self._contract.tags.append(t)
        return self

    def version(self, v: str) -> "ContractBuilder":
        """设置版本"""
        self._contract.version = v
        return self

    def build(self) -> StageContract:
        """构建 StageContract"""
        return self._contract
