"""
# ============================================================
# Enforcement Engine - TRACE 规则执行引擎（Cycle 7 P0-11）
# ============================================================
# 核心作用：在 tool call 前后强制执行 TRACE 编译后的规则
#           支持 Tier 1 (deterministic) / Tier 2 (semantic) / Tier 3 (intent)
# 设计要点：
#   1. 按 tier 顺序检查 (1 → 2 → 3)
#   2. Tier 1: 正则/路径匹配 (Python 内置, 延迟 < 1ms)
#   3. Tier 2: AST/语义分析 (调用 analyzer, 延迟 < 20ms)
#   4. Tier 3: 提示注入 (返回 warning, 由 LLM 处理)
#   5. 记录 hit/violation 统计
# 运行流程：
#   1. pre_tool_check() → 获取 active rules → 按 tier 检查 → 返回 EnforcementResult
#   2. deny: 阻止执行 + 记录 violation
#   3. allow: 记录 hit
#   4. warn: 允许 + 记录 warning
# 输入参数：tool_name, tool_args, session_id
# 输出结果：EnforcementResult(allowed, rule_id, reason, suggestion, tier)
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 7 P0-11 新建
# ============================================================
"""

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from .rule_store import (
    CompiledRule, RuleStore, RuleTier, RuleType,
    get_rule_store,
)

logger = logging.getLogger(__name__)


# ============================================================
# Dataclasses
# ============================================================
@dataclass
class EnforcementResult:
    """规则执行结果"""
    allowed: bool
    rule_id: Optional[str] = None
    rule_subject: Optional[str] = None
    reason: Optional[str] = None
    suggestion: Optional[str] = None
    tier: Optional[int] = None
    action: Optional[str] = None  # 'deny' / 'require' / 'prefer' / 'style_check'
    check_time_ms: float = 0.0
    warnings: List[str] = field(default_factory=list)


# ============================================================
# 内置检查器 (Tier 1 - 确定性)
# ============================================================
class Tier1Checker:
    """Tier 1: 确定性检查 (正则/路径匹配)"""

    @staticmethod
    def check_no_global_variables(tool_args: Dict[str, Any]) -> Tuple[bool, str]:
        """检查全局变量"""
        content = Tier1Checker._extract_content(tool_args)
        if not content:
            return True, ""

        # Python: module-level UPPER_CASE = ...
        pattern_py = re.compile(r"^([A-Z_][A-Z0-9_]*)\s*=\s*[^=]", re.MULTILINE)
        matches = pattern_py.findall(content)
        if matches:
            return False, f"检测到全局变量: {', '.join(matches[:3])}"
        return True, ""

    @staticmethod
    def check_no_debug_logs(tool_args: Dict[str, Any]) -> Tuple[bool, str]:
        """检查调试日志"""
        content = Tier1Checker._extract_content(tool_args)
        if not content:
            return True, ""

        # console.log / console.debug / print(
        patterns = [
            (r"console\.log\s*\(", "console.log"),
            (r"console\.debug\s*\(", "console.debug"),
            (r"^\s*print\s*\(", "print()"),
            (r"^\s*println!\s*\(", "println!()"),
            (r"^\s*fmt\.Println\s*\(", "fmt.Println()"),
            (r"std::cout\s*<<", "std::cout"),
        ]
        found = []
        for pattern, name in patterns:
            if re.search(pattern, content, re.MULTILINE):
                found.append(name)
        if found:
            return False, f"检测到调试日志: {', '.join(found)}"
        return True, ""

    @staticmethod
    def check_no_edit_env(tool_args: Dict[str, Any]) -> Tuple[bool, str]:
        """检查编辑 .env 文件"""
        file_path = tool_args.get("file_path") or tool_args.get("path") or ""
        env_patterns = [r"\.env$", r"\.env\.", r"\.env\.local$", r"\.env\.production$"]
        for pattern in env_patterns:
            if re.search(pattern, file_path):
                return False, f"禁止编辑 .env 文件: {file_path}"
        return True, ""

    @staticmethod
    def check_no_edit_vendor(tool_args: Dict[str, Any]) -> Tuple[bool, str]:
        """检查编辑 vendor/node_modules"""
        file_path = tool_args.get("file_path") or tool_args.get("path") or ""
        forbidden_prefixes = [
            "node_modules/", "/node_modules/",
            "vendor/", "/vendor/",
            "__pycache__/", "/__pycache__/",
            "dist/", "/dist/",
            "build/", "/build/",
            ".git/", "/.git/",
        ]
        for prefix in forbidden_prefixes:
            if file_path.startswith(prefix) or prefix.lstrip("/") in file_path:
                return False, f"禁止编辑依赖目录: {file_path}"
        return True, ""

    @staticmethod
    def _extract_content(tool_args: Dict[str, Any]) -> str:
        """从 tool args 提取代码内容"""
        for key in ["content", "new_content", "code", "text", "body"]:
            if key in tool_args and isinstance(tool_args[key], str):
                return tool_args[key]
        return ""


# ============================================================
# 内置检查器 (Tier 2 - 语义)
# ============================================================
class Tier2Checker:
    """Tier 2: 语义检查 (AST/简单分析)"""

    @staticmethod
    def check_naming(tool_args: Dict[str, Any], style: str = "snake_case") -> Tuple[bool, str]:
        """检查命名约定（Python 默认 snake_case）"""
        content = Tier2Checker._extract_content(tool_args)
        if not content:
            return True, ""

        # 检查函数定义: def MyFunction 应该是 def my_function
        violations = []
        # 函数命名
        if style == "snake_case":
            func_pattern = re.compile(r"def\s+([A-Z][a-zA-Z0-9]*)\s*\(")
            for match in func_pattern.finditer(content):
                violations.append(f"函数 '{match.group(1)}' 应使用 snake_case")
            # 类命名 (PascalCase)
            class_pattern = re.compile(r"class\s+([a-z][a-zA-Z0-9_]*)\s*[:\(]")
            for match in class_pattern.finditer(content):
                violations.append(f"类 '{match.group(1)}' 应使用 PascalCase")
        if violations:
            return False, "; ".join(violations[:3])
        return True, ""

    @staticmethod
    def check_error_handling(tool_args: Dict[str, Any]) -> Tuple[bool, str]:
        """检查异常处理"""
        content = Tier2Checker._extract_content(tool_args)
        if not content:
            return True, ""

        # 简单启发式: 长函数无 try/except
        func_pattern = re.compile(r"def\s+(\w+)\s*\([^)]*\):", re.MULTILINE)
        issues = []
        for match in func_pattern.finditer(content):
            # 检查后续 30 行是否有 try/except
            start = match.end()
            snippet = content[start:start + 1500]
            if "try:" in snippet or "except" in snippet or "if err" in snippet:
                continue
            # 如果有 I/O 操作但无错误处理
            if any(op in snippet for op in ["open(", "requests.", "urllib", "subprocess"]):
                func_name = match.group(1)
                # 排除 main / test 函数
                if func_name not in ("main", "test_*", "__init__"):
                    issues.append(f"函数 '{func_name}' 含 I/O 但无错误处理")
        if issues:
            return False, "; ".join(issues[:3])
        return True, ""

    @staticmethod
    def check_typescript(tool_args: Dict[str, Any]) -> Tuple[bool, str]:
        """检查 TypeScript 使用"""
        file_path = tool_args.get("file_path") or tool_args.get("path") or ""
        if file_path.endswith(".js") or file_path.endswith(".jsx"):
            return False, f"应使用 TypeScript (.ts/.tsx) 而非 {file_path.split('.')[-1]}"
        return True, ""

    @staticmethod
    def _extract_content(tool_args: Dict[str, Any]) -> str:
        return Tier1Checker._extract_content(tool_args)


# ============================================================
# 内置检查器 (Tier 3 - 意图级提醒)
# ============================================================
class Tier3Checker:
    """Tier 3: 意图级提醒 (返回建议, 不阻止)"""

    REMINDERS = {
        "remind_simplicity": "提示: 倾向于简洁实现，避免过度设计",
        "remind_documentation": "提示: 记得添加函数/类文档",
        "remind_testing": "提示: 考虑为新代码添加单元测试",
        "remind_general": "提示: 留意用户偏好",
    }

    @staticmethod
    def check(intent_subject: str) -> str:
        """获取提醒文本"""
        return Tier3Checker.REMINDERS.get(intent_subject, Tier3Checker.REMINDERS["remind_general"])


# ============================================================
# EnforcementEngine
# ============================================================
class EnforcementEngine:
    """TRACE 规则执行引擎"""

    # Tier 1 检查器映射
    TIER_1_CHECKERS = {
        "no_global_variables": Tier1Checker.check_no_global_variables,
        "no_debug_logs": Tier1Checker.check_no_debug_logs,
        "no_edit_env": Tier1Checker.check_no_edit_env,
        "no_edit_vendor": Tier1Checker.check_no_edit_vendor,
    }

    # Tier 2 检查器映射
    TIER_2_CHECKERS = {
        "check_naming": Tier2Checker.check_naming,
        "check_error_handling": Tier2Checker.check_error_handling,
        "use_typescript": Tier2Checker.check_typescript,
    }

    def __init__(self, store: Optional[RuleStore] = None):
        self.store = store or get_rule_store()

    # ============================================================
    # Pre-Tool Check
    # ============================================================
    async def pre_tool_check(
        self,
        tool_name: str,
        tool_args: Dict[str, Any],
        session_id: str,
    ) -> EnforcementResult:
        """PreToolUse 阶段: 检查工具调用是否被允许"""
        start = time.time()
        rules = self.store.get_active_rules(session_id)
        if not rules:
            return EnforcementResult(allowed=True, check_time_ms=(time.time() - start) * 1000)

        warnings: List[str] = []
        # 按 tier 顺序检查
        for rule in sorted(rules, key=lambda r: r.tier):
            result = self._check_single_rule(rule, tool_name, tool_args)
            if result is None:
                continue
            allowed, reason = result
            check_time = (time.time() - start) * 1000

            if not allowed:
                # 阻止执行
                self.store.record_violation(rule.rule_id)
                return EnforcementResult(
                    allowed=False,
                    rule_id=rule.rule_id,
                    rule_subject=rule.rule_data.get("subject"),
                    reason=reason,
                    suggestion=self._generate_suggestion(rule),
                    tier=rule.tier,
                    action=rule.rule_data.get("action"),
                    check_time_ms=check_time,
                    warnings=warnings,
                )
            else:
                # 允许 + 记录 hit
                self.store.record_hit(rule.rule_id)
                # Tier 3 警告收集
                if rule.tier == 3:
                    warning = Tier3Checker.check(rule.rule_data.get("check", ""))
                    if warning:
                        warnings.append(f"[{rule.rule_data.get('subject', 'rule')}] {warning}")

        return EnforcementResult(
            allowed=True,
            warnings=warnings,
            check_time_ms=(time.time() - start) * 1000,
        )

    # ============================================================
    # Post-Tool Check
    # ============================================================
    async def post_tool_check(
        self,
        tool_name: str,
        tool_args: Dict[str, Any],
        tool_result: Any,
        session_id: str,
    ) -> EnforcementResult:
        """PostToolUse 阶段: 检查工具执行结果是否违反规则"""
        # 简化: 当前实现主要在 pre_tool_check 完成
        # 此处可扩展为: 工具结果包含新文件, 需再次扫描内容
        start = time.time()
        # 如果是文件编辑类工具, 可对结果进行内容审查
        if tool_name in ("edit_file", "create_file", "write_file") and isinstance(tool_result, dict):
            new_content = tool_result.get("content") or tool_result.get("new_content", "")
            if new_content:
                # 将内容作为 tool_args 重新检查
                return await self.pre_tool_check(
                    tool_name, {**tool_args, "content": new_content}, session_id
                )
        return EnforcementResult(allowed=True, check_time_ms=(time.time() - start) * 1000)

    # ============================================================
    # 内部: 单规则检查
    # ============================================================
    def _check_single_rule(
        self,
        rule: CompiledRule,
        tool_name: str,
        tool_args: Dict[str, Any],
    ) -> Optional[Tuple[bool, str]]:
        """检查单条规则, 返回 (allowed, reason) 或 None (规则不适用)"""
        check_name = rule.rule_data.get("check")
        if not check_name:
            return None

        # Tier 1
        if rule.tier == 1:
            checker = self.TIER_1_CHECKERS.get(check_name)
            if checker:
                return checker(tool_args)

        # Tier 2
        elif rule.tier == 2:
            checker = self.TIER_2_CHECKERS.get(check_name)
            if checker:
                return checker(tool_args)

        # Tier 3: 不阻止, 仅返回 allowed=True
        elif rule.tier == 3:
            return True, ""

        return None

    def _generate_suggestion(self, rule: CompiledRule) -> str:
        """生成修改建议"""
        subject = rule.rule_data.get("subject", "")
        action = rule.rule_data.get("action", "")

        suggestions = {
            ("no_global_variables", "deny"): "请使用函数参数或类成员变量替代全局变量",
            ("no_debug_logs", "deny"): "请删除 console.log/print 调试代码后再提交",
            ("no_edit_env", "deny"): "请通过环境变量管理界面修改配置, 不要直接编辑 .env",
            ("no_edit_vendor", "deny"): "请编辑源文件, 不要修改依赖目录",
            ("check_naming", "require"): "请将命名调整为符合团队规范",
            ("check_error_handling", "require"): "请为 I/O 操作添加 try/except 错误处理",
            ("use_typescript", "require"): "请使用 .ts/.tsx 后缀",
        }
        return suggestions.get((subject, action), f"请遵守规则: {rule.original_message}")


# ============================================================
# Singleton
# ============================================================
_engine_instance: Optional[EnforcementEngine] = None
_engine_lock = __import__("threading").Lock()


def get_enforcement_engine() -> EnforcementEngine:
    """获取 EnforcementEngine 单例"""
    global _engine_instance
    with _engine_lock:
        if _engine_instance is None:
            _engine_instance = EnforcementEngine()
        return _engine_instance


def reset_enforcement_engine() -> None:
    """重置单例（用于测试）"""
    global _engine_instance
    with _engine_lock:
        _engine_instance = None
