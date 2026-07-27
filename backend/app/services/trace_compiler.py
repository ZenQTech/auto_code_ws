"""
# ============================================================
# Trace Compiler - TRACE 用户纠正消息编译器（Cycle 7 P0-11）
# ============================================================
# 核心作用：将用户自然语言纠正消息编译为可执行规则
#           基于 Zhou et al. June 2026 TRACE 论文设计
# 设计要点：
#   1. Detection: 正则 + 关键词检测明显的纠正意图
#   2. Classification: 4 类纠正 (prohibition/requirement/preference/style)
#   3. Compilation: 映射到 4 种规则类型 + 3 个 tier
#   4. Confidence: 返回置信度（前端可决定是否启用）
# 运行流程：
#   1. detect_correction()  →  是否包含纠正意图
#   2. classify_correction() →  类别 + 目标
#   3. compile_to_rule()    →  CompiledRule 实例
# 输入参数：用户消息字符串
# 输出结果：CorrectionIntent / CompiledRule
# 修改记录：
#   - 2026-07-27 | v1.0.0 | Cycle 7 P0-11 新建
# ============================================================
"""

import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from .rule_store import (
    CompiledRule, RuleScope, RuleTier, RuleType,
)

logger = logging.getLogger(__name__)


# ============================================================
# Enums
# ============================================================
class CorrectionCategory(str, Enum):
    """纠正类别"""
    PROHIBITION = "prohibition"    # 禁止做某事
    REQUIREMENT = "requirement"    # 要求做某事
    PREFERENCE = "preference"      # 偏好（主观）
    STYLE = "style"                # 代码风格


class CorrectionTarget(str, Enum):
    """纠正目标"""
    CODE = "code"          # 代码内容
    TOOL = "tool"          # 工具调用
    FILE = "file"          # 文件路径
    GENERAL = "general"    # 通用


# ============================================================
# Dataclasses
# ============================================================
@dataclass
class CorrectionIntent:
    """检测到的纠正意图"""
    is_correction: bool
    category: str  # 'prohibition' / 'requirement' / 'preference' / 'style'
    target: str    # 'code' / 'tool' / 'file' / 'general'
    subject: str   # 被纠正的具体对象（如 "global_variables" / "console.log"）
    desired_behavior: str  # 用户期望的行为
    raw_message: str
    confidence: float  # 0-1
    detected_keywords: List[str] = field(default_factory=list)


# ============================================================
# 模式字典
# ============================================================
# 类别识别模式
CATEGORY_PATTERNS = {
    CorrectionCategory.PROHIBITION: [
        r"不要", r"禁止", r"别用", r"不许", r"不允许",
        r"don't", r"do not", r"never", r"forbid", r"prohibit", r"avoid",
    ],
    CorrectionCategory.REQUIREMENT: [
        r"必须", r"应该", r"需要", r"要使用", r"要加", r"务必",
        r"must", r"should", r"required", r"need to", r"have to",
    ],
    CorrectionCategory.PREFERENCE: [
        r"建议", r"最好", r"希望", r"想要", r"倾向于",
        r"prefer", r"better to", r"recommend", r"suggest",
    ],
    CorrectionCategory.STYLE: [
        r"风格", r"格式", r"命名", r"缩进", r"换行",
        r"style", r"format", r"naming", r"indent",
    ],
}

# 目标识别模式
TARGET_PATTERNS = {
    CorrectionTarget.TOOL: [
        r"工具", r"调用", r"function call",
    ],
    CorrectionTarget.FILE: [
        r"文件", r"路径", r"目录", r".*\.(py|js|ts|tsx|jsx|go|rs|java|cpp|c|h|hpp|md|json|yaml|yml|toml)$",
        r"/[\w/]+\.\w+", r"~", r"\.env", r"node_modules",
    ],
    CorrectionTarget.CODE: [
        r"代码", r"函数", r"变量", r"类", r"方法", r"参数",
        r"全局变量", r"循环", r"递归", r"异步",
        r"code", r"function", r"variable", r"class", r"method",
        r"global", r"loop", r"async",
    ],
}

# 已知主题模式（编译为具体规则）
SUBJECT_PATTERNS = {
    # Tier 1: 确定性模式
    "global_variables": {
        "tier": RuleTier.TIER_1_DETERMINISTIC,
        "rule_type": RuleType.CODE_STYLE,
        "keywords": [r"全局变量", r"global\s*variable"],
        "check": "no_global_variables",
        "tier_rationale": "可通过 AST 检测",
    },
    "console_log": {
        "tier": RuleTier.TIER_1_DETERMINISTIC,
        "rule_type": RuleType.CODE_STYLE,
        "keywords": [r"console\.log", r"console\.debug", r"调试日志", r"print\s*\("],
        "check": "no_debug_logs",
        "tier_rationale": "正则匹配即可",
    },
    "env_file": {
        "tier": RuleTier.TIER_1_DETERMINISTIC,
        "rule_type": RuleType.FILE_PATH,
        "keywords": [r"\.env", r"环境变量文件", r"env\s*file"],
        "check": "no_edit_env",
        "tier_rationale": "路径模式匹配",
    },
    "node_modules": {
        "tier": RuleTier.TIER_1_DETERMINISTIC,
        "rule_type": RuleType.FILE_PATH,
        "keywords": [r"node_modules", r"vendor/", r"__pycache__", r"\.pyc"],
        "check": "no_edit_vendor",
        "tier_rationale": "路径前缀匹配",
    },
    # Tier 2: 语义检查
    "naming_convention": {
        "tier": RuleTier.TIER_2_SEMANTIC,
        "rule_type": RuleType.CODE_STYLE,
        "keywords": [r"命名", r"snake_case", r"camelCase", r"PascalCase", r"kebab-case"],
        "check": "check_naming",
        "tier_rationale": "需要 AST + 命名空间分析",
    },
    "error_handling": {
        "tier": RuleTier.TIER_2_SEMANTIC,
        "rule_type": RuleType.CODE_STYLE,
        "keywords": [r"异常处理", r"错误处理", r"try.catch", r"except", r"error\s*handling"],
        "check": "check_error_handling",
        "tier_rationale": "需要 AST 节点分析",
    },
    "use_typescript": {
        "tier": RuleTier.TIER_2_SEMANTIC,
        "rule_type": RuleType.CODE_STYLE,
        "keywords": [r"typescript", r"类型", r"type\s*annotation", r"类型注解"],
        "check": "use_typescript",
        "tier_rationale": "需要文件扩展名分析",
    },
    # Tier 3: 意图级提醒
    "code_simplicity": {
        "tier": RuleTier.TIER_3_INTENT,
        "rule_type": RuleType.INTENT,
        "keywords": [r"简洁", r"简单", r"simple", r"minimal"],
        "check": "remind_simplicity",
        "tier_rationale": "主观偏好，LLM 提醒",
    },
    "documentation": {
        "tier": RuleTier.TIER_3_INTENT,
        "rule_type": RuleType.INTENT,
        "keywords": [r"文档", r"注释", r"doc", r"comment", r"注释"],
        "check": "remind_documentation",
        "tier_rationale": "主观偏好",
    },
    "test_coverage": {
        "tier": RuleTier.TIER_3_INTENT,
        "rule_type": RuleType.INTENT,
        "keywords": [r"测试", r"test", r"unit\s*test", r"覆盖率"],
        "check": "remind_testing",
        "tier_rationale": "主观偏好",
    },
}


# ============================================================
# TraceCompiler
# ============================================================
class TraceCompiler:
    """用户消息 → CompiledRule 编译器"""

    CONFIDENCE_THRESHOLD = 0.6  # 低于此值标记为 low confidence

    def __init__(self):
        # 预编译正则
        self._category_regex = {
            cat: [re.compile(p, re.IGNORECASE) for p in patterns]
            for cat, patterns in CATEGORY_PATTERNS.items()
        }
        self._target_regex = {
            tgt: [re.compile(p, re.IGNORECASE) for p in patterns]
            for tgt, patterns in TARGET_PATTERNS.items()
        }
        self._subject_regex = {
            subj: [re.compile(p, re.IGNORECASE) for p in data["keywords"]]
            for subj, data in SUBJECT_PATTERNS.items()
        }

    # ============================================================
    # 检测
    # ============================================================
    def detect_correction(self, user_message: str) -> CorrectionIntent:
        """检测消息是否包含纠正意图"""
        msg = user_message.strip()
        if not msg:
            return CorrectionIntent(
                is_correction=False,
                category="general", target="general", subject="",
                desired_behavior="", raw_message=msg, confidence=0.0,
            )

        # 1. 检测类别
        category, category_score, category_keywords = self._detect_category(msg)

        # 2. 检测目标
        target, target_score, target_keywords = self._detect_target(msg)

        # 3. 检测主题
        subject, subject_data, subject_keywords = self._detect_subject(msg)

        # 综合判断
        has_category = category_score > 0
        has_target = target_score > 0
        has_subject = subject is not None

        is_correction = has_category and (has_target or has_subject)

        # 计算 confidence
        # - 主题匹配时, 给更高基础分 (0.5)
        # - 类别+主题清晰时, 应达到阈值
        confidence = 0.0
        if is_correction:
            if has_subject:
                # 主题明确, 基础分 0.5
                confidence = 0.5
                confidence += 0.3 * min(category_score / 2.0, 1.0)
                confidence += 0.2 * min(target_score / 2.0, 1.0)
            else:
                # 仅类别+目标, 基础分 0.3
                confidence = 0.3
                confidence += 0.4 * min(category_score / 2.0, 1.0)
                confidence += 0.3 * min(target_score / 2.0, 1.0)
            confidence = min(1.0, confidence)

        # 提取期望行为
        desired_behavior = self._extract_desired_behavior(msg, category)

        return CorrectionIntent(
            is_correction=is_correction,
            category=category.value,
            target=target.value,
            subject=subject or "general",
            desired_behavior=desired_behavior,
            raw_message=msg,
            confidence=round(confidence, 3),
            detected_keywords=category_keywords + target_keywords + subject_keywords,
        )

    def _detect_category(self, msg: str) -> Tuple[CorrectionCategory, int, List[str]]:
        """检测纠正类别"""
        best_category = CorrectionCategory.REQUIREMENT
        best_score = 0
        keywords = []
        for cat, regexes in self._category_regex.items():
            score = 0
            matched = []
            for rx in regexes:
                matches = rx.findall(msg)
                if matches:
                    score += 1
                    matched.extend(matches if isinstance(matches, list) else [matches])
            if score > best_score:
                best_score = score
                best_category = cat
                keywords = matched
        return best_category, best_score, keywords

    def _detect_target(self, msg: str) -> Tuple[CorrectionTarget, int, List[str]]:
        """检测纠正目标"""
        best_target = CorrectionTarget.GENERAL
        best_score = 0
        keywords = []
        for tgt, regexes in self._target_regex.items():
            score = 0
            matched = []
            for rx in regexes:
                matches = rx.findall(msg)
                if matches:
                    score += 1
                    matched.extend(matches if isinstance(matches, list) else [matches])
            if score > best_score:
                best_score = score
                best_target = tgt
                keywords = matched
        return best_target, best_score, keywords

    def _detect_subject(self, msg: str) -> Tuple[Optional[str], Optional[Dict], List[str]]:
        """检测具体主题"""
        for subject, data in SUBJECT_PATTERNS.items():
            for rx in self._subject_regex[subject]:
                matches = rx.findall(msg)
                if matches:
                    return subject, data, matches if isinstance(matches, list) else [matches]
        return None, None, []

    def _extract_desired_behavior(self, msg: str, category: CorrectionCategory) -> str:
        """提取期望行为（简化版）"""
        if category == CorrectionCategory.PROHIBITION:
            return "禁止" + msg
        elif category == CorrectionCategory.REQUIREMENT:
            return "要求" + msg
        elif category == CorrectionCategory.PREFERENCE:
            return "建议" + msg
        else:
            return msg

    # ============================================================
    # 编译
    # ============================================================
    def compile_to_rule(
        self,
        intent: CorrectionIntent,
        session_id: str = "default",
        scope: str = "session",
        source_message_id: Optional[str] = None,
    ) -> Optional[CompiledRule]:
        """将意图编译为 CompiledRule"""
        if not intent.is_correction:
            return None

        # 查找主题规则模板
        subject_template = SUBJECT_PATTERNS.get(intent.subject)

        if subject_template:
            tier = subject_template["tier"]
            rule_type = subject_template["rule_type"]
            rule_data = {
                "check": subject_template["check"],
                "subject": intent.subject,
                "target": intent.target,
                "category": intent.category,
                "tier_rationale": subject_template["tier_rationale"],
            }
            priority = 7  # 已知主题，优先级高
        else:
            # 通用规则：使用 Tier 3 intent 提醒
            tier = RuleTier.TIER_3_INTENT
            rule_type = RuleType.INTENT
            rule_data = {
                "check": "remind_general",
                "subject": intent.subject,
                "target": intent.target,
                "category": intent.category,
                "tier_rationale": "未匹配到具体模式，使用通用提醒",
            }
            priority = 5

        # 根据 category 调整
        if intent.category == CorrectionCategory.PROHIBITION.value:
            rule_data["action"] = "deny"
        elif intent.category == CorrectionCategory.REQUIREMENT.value:
            rule_data["action"] = "require"
        elif intent.category == CorrectionCategory.PREFERENCE.value:
            rule_data["action"] = "prefer"
        else:
            rule_data["action"] = "style_check"

        rule = CompiledRule(
            rule_id=f"rule-{uuid.uuid4().hex[:12]}",
            session_id=session_id,
            scope=scope,
            tier=tier,
            rule_type=rule_type,
            rule_data=rule_data,
            original_message=intent.raw_message,
            source_message_id=source_message_id,
            priority=priority,
        )
        return rule

    def compile_from_message(
        self,
        user_message: str,
        session_id: str = "default",
        scope: str = "session",
        source_message_id: Optional[str] = None,
    ) -> Tuple[CorrectionIntent, Optional[CompiledRule]]:
        """一站式: 检测 + 编译"""
        intent = self.detect_correction(user_message)
        rule = self.compile_to_rule(
            intent, session_id=session_id, scope=scope, source_message_id=source_message_id
        )
        return intent, rule


# ============================================================
# Singleton
# ============================================================
_compiler_instance: Optional[TraceCompiler] = None
_compiler_lock = __import__("threading").Lock()


def get_trace_compiler() -> TraceCompiler:
    """获取 TraceCompiler 单例"""
    global _compiler_instance
    with _compiler_lock:
        if _compiler_instance is None:
            _compiler_instance = TraceCompiler()
        return _compiler_instance


def reset_trace_compiler() -> None:
    """重置单例（用于测试）"""
    global _compiler_instance
    with _compiler_lock:
        _compiler_instance = None
