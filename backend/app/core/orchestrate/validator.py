"""
# Orchestrate Contract 验证器
# ============================================================
# 核心作用：根据 StageContract 验证输入/输出数据
# 关联：Cycle 14 P1-1
# 版本：v6.29.0
#
# 验证类型：
#   - 字段类型校验（string/int/float/bool/list/dict）
#   - 必填字段校验
#   - 数值范围校验
#   - 字符串长度/正则校验
#   - 枚举值校验
#   - 不变量断言（precondition/postcondition）
# ============================================================
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from .models import (
    FieldSpec,
    FieldType,
    Invariant,
    InvariantType,
    StageContract,
)


class ValidationError(Exception):
    """合约验证错误"""
    def __init__(self, message: str, field: str = "", code: str = "validation_error"):
        super().__init__(message)
        self.message = message
        self.field = field
        self.code = code

    def to_dict(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "field": self.field,
        }


class ContractValidator:
    """合约验证器

    用法：
        validator = ContractValidator(contract)
        result = validator.validate_inputs({"repo": "..."})  # True/False
        result, errors = validator.validate_inputs_with_errors(...)
    """

    def __init__(self, contract: StageContract):
        self.contract = contract

    # ============================================================
    # 输入验证
    # ============================================================

    def validate_inputs(self, data: Dict[str, Any]) -> bool:
        """验证输入（仅返回布尔）"""
        result, _ = self.validate_inputs_with_errors(data)
        return result

    def validate_inputs_with_errors(
        self,
        data: Dict[str, Any],
    ) -> Tuple[bool, List[Dict[str, Any]]]:
        """验证输入（带详细错误）"""
        errors: List[Dict[str, Any]] = []
        for name, spec in self.contract.inputs.items():
            value = data.get(name)
            field_errors = self._validate_field(name, value, spec)
            errors.extend(field_errors)
        return (len(errors) == 0, errors)

    # ============================================================
    # 输出验证
    # ============================================================

    def validate_outputs(self, data: Dict[str, Any]) -> bool:
        """验证输出（仅返回布尔）"""
        result, _ = self.validate_outputs_with_errors(data)
        return result

    def validate_outputs_with_errors(
        self,
        data: Dict[str, Any],
    ) -> Tuple[bool, List[Dict[str, Any]]]:
        """验证输出（带详细错误）"""
        errors: List[Dict[str, Any]] = []
        for name, spec in self.contract.outputs.items():
            value = data.get(name)
            field_errors = self._validate_field(name, value, spec)
            errors.extend(field_errors)
        return (len(errors) == 0, errors)

    # ============================================================
    # 不变量验证
    # ============================================================

    def validate_preconditions(self, data: Dict[str, Any]) -> bool:
        """验证前置不变量"""
        return all(self._check_invariant(inv, data) for inv in self.contract.preconditions)

    def validate_postconditions(self, data: Dict[str, Any]) -> bool:
        """验证后置不变量"""
        return all(self._check_invariant(inv, data) for inv in self.contract.postconditions)

    def get_precondition_errors(self, data: Dict[str, Any]) -> List[str]:
        errors = []
        for inv in self.contract.preconditions:
            if not self._check_invariant(inv, data):
                errors.append(inv.description or f"Precondition failed: {inv.field}")
        return errors

    def get_postcondition_errors(self, data: Dict[str, Any]) -> List[str]:
        errors = []
        for inv in self.contract.postconditions:
            if not self._check_invariant(inv, data):
                errors.append(inv.description or f"Postcondition failed: {inv.field}")
        return errors

    # ============================================================
    # 内部：字段验证
    # ============================================================

    def _validate_field(
        self,
        name: str,
        value: Any,
        spec: FieldSpec,
    ) -> List[Dict[str, Any]]:
        """验证单个字段"""
        errors: List[Dict[str, Any]] = []

        # 必填检查
        if value is None:
            if spec.required and spec.default is None:
                errors.append({
                    "code": "missing_field",
                    "field": name,
                    "message": f"Required field '{name}' is missing",
                })
                return errors
            # 使用默认值
            return errors

        # 类型检查
        if not self._check_type(value, spec.type):
            errors.append({
                "code": "type_mismatch",
                "field": name,
                "message": f"Field '{name}' expected type {spec.type.value}, got {type(value).__name__}",
            })
            return errors

        # 类型特定约束
        if spec.type == FieldType.STRING:
            if spec.min_length is not None and len(str(value)) < spec.min_length:
                errors.append({
                    "code": "min_length",
                    "field": name,
                    "message": f"Field '{name}' length < {spec.min_length}",
                })
            if spec.max_length is not None and len(str(value)) > spec.max_length:
                errors.append({
                    "code": "max_length",
                    "field": name,
                    "message": f"Field '{name}' length > {spec.max_length}",
                })
            if spec.regex is not None:
                if not re.match(spec.regex, str(value)):
                    errors.append({
                        "code": "regex_mismatch",
                        "field": name,
                        "message": f"Field '{name}' doesn't match pattern {spec.regex}",
                    })
            if spec.enum_values is not None and value not in spec.enum_values:
                errors.append({
                    "code": "enum_mismatch",
                    "field": name,
                    "message": f"Field '{name}' must be one of {spec.enum_values}",
                })

        elif spec.type in (FieldType.INT, FieldType.FLOAT):
            if spec.min_value is not None and value < spec.min_value:
                errors.append({
                    "code": "min_value",
                    "field": name,
                    "message": f"Field '{name}' < {spec.min_value}",
                })
            if spec.max_value is not None and value > spec.max_value:
                errors.append({
                    "code": "max_value",
                    "field": name,
                    "message": f"Field '{name}' > {spec.max_value}",
                })
            if spec.enum_values is not None and value not in spec.enum_values:
                errors.append({
                    "code": "enum_mismatch",
                    "field": name,
                    "message": f"Field '{name}' must be one of {spec.enum_values}",
                })

        elif spec.type == FieldType.LIST:
            if spec.min_length is not None and len(value) < spec.min_length:
                errors.append({
                    "code": "min_length",
                    "field": name,
                    "message": f"List '{name}' length < {spec.min_length}",
                })
            if spec.max_length is not None and len(value) > spec.max_length:
                errors.append({
                    "code": "max_length",
                    "field": name,
                    "message": f"List '{name}' length > {spec.max_length}",
                })
            if spec.item_type and spec.item_type != FieldType.ANY:
                for i, item in enumerate(value):
                    if not self._check_type(item, spec.item_type):
                        errors.append({
                            "code": "item_type_mismatch",
                            "field": f"{name}[{i}]",
                            "message": f"Item {i} expected {spec.item_type.value}, got {type(item).__name__}",
                        })

        return errors

    def _check_type(self, value: Any, expected: FieldType) -> bool:
        """检查值的类型"""
        if expected == FieldType.ANY:
            return True
        if expected == FieldType.STRING:
            return isinstance(value, str)
        if expected == FieldType.INT:
            return isinstance(value, int) and not isinstance(value, bool)
        if expected == FieldType.FLOAT:
            return isinstance(value, (int, float)) and not isinstance(value, bool)
        if expected == FieldType.BOOL:
            return isinstance(value, bool)
        if expected == FieldType.LIST:
            return isinstance(value, list)
        if expected == FieldType.DICT:
            return isinstance(value, dict)
        return False

    # ============================================================
    # 内部：不变量验证
    # ============================================================

    def _check_invariant(self, inv: Invariant, data: Dict[str, Any]) -> bool:
        """检查不变量"""
        value = data.get(inv.field) if inv.field else None

        if inv.invariant_type == InvariantType.NON_NULL:
            return value is not None
        if inv.invariant_type == InvariantType.NON_EMPTY:
            if value is None:
                return False
            if isinstance(value, (str, list, dict)):
                return len(value) > 0
            return True
        if inv.invariant_type == InvariantType.RANGE:
            if not isinstance(value, (int, float)):
                return False
            if inv.min_value is not None and value < inv.min_value:
                return False
            if inv.max_value is not None and value > inv.max_value:
                return False
            return True
        if inv.invariant_type == InvariantType.REGEX:
            if not isinstance(value, str):
                return False
            if inv.pattern is None:
                return True
            return bool(re.match(inv.pattern, value))
        if inv.invariant_type == InvariantType.ENUM:
            return value in (inv.allowed_values or [])
        if inv.invariant_type == InvariantType.CUSTOM:
            # 自定义函数暂不实现，仅返回 True
            return True
        return True
