"""
# ============================================================
# Skill Invocation - 显式/隐式调用引擎 (v1.0.0)
# Cycle 70 G70-01 - 对标 Codex CLI Skills 显式/隐式调用
# ============================================================
# 核心作用：基于关键词匹配（隐式）+ $skill-name（显式）激活 skill
# 设计要点：
#   1. 隐式调用：基于 query 与 skill description 的 Jaccard 相似度
#   2. 显式调用：识别 $skill-name 前缀
#   3. 阈值可配置（默认 0.2 中文，0.3 英文）
#   4. 调用历史记录到 ~/.hermes/skill_invocations.jsonl
#   5. 频率限制：60 calls/min per skill
#   6. 线程安全
# 运行流程：
#   接收 query → 分词 → 匹配 → 返回 matches / 显式调用 → 记录
# 输入参数：query, threshold, top_k
# 输出结果：SkillMatch 列表 / SkillInvocation 记录
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 70 G70-01 初次创建
# ============================================================
"""

import hashlib
import json
import logging
import re
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Set, Tuple

from backend.app.services.skill_registry import Skill, SkillRegistry, get_skill_registry

logger = logging.getLogger(__name__)


# ============================================================
# 常量
# ============================================================

# 默认阈值（混合相似度：max(jaccard, coverage)）
DEFAULT_THRESHOLD_CN = 0.15
DEFAULT_THRESHOLD_EN = 0.25

# 默认 top_k
DEFAULT_TOP_K = 3

# 显式调用前缀
EXPLICIT_PREFIX = "$"

# 历史记录最大条数
MAX_HISTORY = 1000

# 频率限制：60 calls/min
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = 60

# 历史文件路径
HISTORY_PATH = Path("~/.hermes/skill_invocations.jsonl").expanduser()

# 英文停用词
STOPWORDS_EN = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
    "has", "he", "in", "is", "it", "its", "of", "on", "that", "the",
    "to", "was", "were", "will", "with", "this", "but", "or", "not",
    "have", "had", "do", "does", "did", "can", "could", "would",
    "should", "may", "might", "must", "shall", "i", "you", "we", "they",
    "me", "him", "her", "us", "them", "my", "your", "our", "their",
}

# 中文停用词（包含单字停用词以避免 bigram 残留干扰）
STOPWORDS_CN = {
    # 多字停用词
    "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一",
    "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有",
    "看", "好", "自己", "这", "他", "她", "它", "们", "那", "些", "什么",
    "啊", "吧", "呢", "吗", "哦", "嗯", "哈", "呀", "哇", "嘿",
    # 单字停用词（用于过滤 bigram 中的孤立字）
    "个", "些", "为", "以", "于", "但", "而", "或", "及", "即", "被", "对",
    "从", "向", "把", "被", "给", "让", "使", "让", "可", "能", "应", "该",
}


# ============================================================
# 数据模型
# ============================================================

@dataclass
class SkillMatch:
    """隐式匹配结果"""
    skill: Skill
    similarity: float
    matched_tokens: List[str]
    system_prompt: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "skill_id": self.skill.id,
            "skill_name": self.skill.name,
            "display_name": self.skill.display_name,
            "location": self.skill.location,
            "similarity": self.similarity,
            "matched_tokens": self.matched_tokens,
            "system_prompt": self.system_prompt,
        }


@dataclass
class SkillInvocation:
    """调用记录"""
    invocation_id: str
    skill_name: str
    skill_id: str
    invocation_type: str  # "explicit" | "implicit"
    args: Dict[str, Any]
    duration_ms: int
    created_at: str
    success: bool = True
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================
# 工具函数
# ============================================================

def _tokenize(text: str) -> Set[str]:
    """中英文混合分词

    算法：
      1. 转小写
      2. 英文按非字母数字分割
      3. 中文按字符分割
      4. 去除停用词
      5. 去除单字符（除非中文字符）

    参数：
      - text: 输入文本
    返回值：token 集合
    """
    if not text:
        return set()

    text_lower = text.lower()
    tokens: Set[str] = set()

    # 中文按字符（bigram 以提高匹配率）
    chinese_chars = re.findall(r"[\u4e00-\u9fff]", text_lower)
    tokens.update(chinese_chars)
    # 添加 bigram（提高中文匹配率）
    for i in range(len(chinese_chars) - 1):
        tokens.add(chinese_chars[i] + chinese_chars[i + 1])

    # 英文按词
    english_words = re.findall(r"[a-z0-9]+", text_lower)
    tokens.update(english_words)

    # 去除停用词
    tokens = tokens - STOPWORDS_CN - STOPWORDS_EN

    # 去除单字符英文（保留单字符中文）
    tokens = {t for t in tokens if len(t) > 1 or re.match(r"[\u4e00-\u9fff]", t)}

    # 二次过滤：去除单个汉字停用词（bigram 中的单个字会保留）
    tokens = {t for t in tokens if not (len(t) == 1 and t in STOPWORDS_CN)}

    return tokens


def _jaccard_similarity(set_a: Set[str], set_b: Set[str]) -> float:
    """计算 Jaccard 相似度

    参数：
      - set_a, set_b: 集合
    返回值：Jaccard 相似度（0.0-1.0）
    """
    if not set_a and not set_b:
        return 0.0
    intersection = set_a & set_b
    union = set_a | set_b
    if not union:
        return 0.0
    return len(intersection) / len(union)


def _hybrid_similarity(query: Set[str], target: Set[str]) -> float:
    """混合相似度：Jaccard + 覆盖率

    算法：
      - score = max(jaccard, coverage) 其中 coverage = |intersection| / |query|
      - 这种方式对短 query 更友好（中文短句常见）

    参数：
      - query: 用户查询 token
      - target: 目标 description token
    返回值：相似度（0.0-1.0）
    """
    if not query or not target:
        return 0.0
    intersection = query & target
    if not intersection:
        return 0.0
    jaccard = len(intersection) / len(query | target)
    coverage = len(intersection) / len(query)
    return max(jaccard, coverage)


def _parse_explicit_invocation(query: str) -> Tuple[Optional[str], str]:
    """解析显式调用 $skill-name 格式

    参数：
      - query: 用户输入
    返回值：(skill_name, remaining_query)
        - skill_name: None 表示非显式调用
        - remaining_query: 去除 $skill-name 后的剩余文本
    """
    query = query.strip()
    if not query.startswith(EXPLICIT_PREFIX):
        return None, query

    # 匹配 $skill-name (允许带参数)
    match = re.match(r"\$([a-z0-9][a-z0-9-]{0,62}[a-z0-9])(?:\s+(.*))?", query, re.DOTALL)
    if not match:
        return None, query

    skill_name = match.group(1)
    remaining = match.group(2) or ""
    return skill_name, remaining.strip()


# ============================================================
# 主服务类
# ============================================================

class SkillInvocationService:
    """Skill 调用服务

    功能：
      1. 隐式匹配（基于 description 关键词）
      2. 显式调用（$skill-name）
      3. 调用历史记录
      4. 频率限制
    """

    def __init__(self, skill_registry: Optional[SkillRegistry] = None):
        self._registry = skill_registry or get_skill_registry()
        self._history: Deque[SkillInvocation] = deque(maxlen=MAX_HISTORY)
        self._rate_limits: Dict[str, Deque[float]] = {}  # skill_id -> timestamps
        self._lock = threading.RLock()
        # 加载历史
        self._load_history()
        logger.info("SkillInvocationService 初始化完成")

    # ============================================================
    # 隐式调用
    # ============================================================

    def match_implicit(
        self,
        query: str,
        top_k: int = DEFAULT_TOP_K,
        threshold: Optional[float] = None,
    ) -> Tuple[List[SkillMatch], float]:
        """隐式匹配 skill

        算法：
          1. 分词 query
          2. 对每个 enabled skill：
             - 分词 description
             - 计算 Jaccard 相似度
          3. 过滤 threshold 之下
          4. 按相似度降序
          5. 取 top_k

        参数：
          - query: 用户查询
          - top_k: 返回的最大数量
          - threshold: 相似度阈值（None 使用默认）
        返回值：(matches, inference_ms)
        """
        start = time.time()
        threshold_cn = threshold if threshold is not None else DEFAULT_THRESHOLD_CN
        threshold_en = threshold if threshold is not None else DEFAULT_THRESHOLD_EN

        query_tokens = _tokenize(query)
        if not query_tokens:
            return [], 0.0

        skills = self._registry.list_skills(enabled_only=True)
        matches: List[SkillMatch] = []

        for skill in skills:
            if skill.disable_model_invocation:
                continue

            # 综合 description + tags
            desc_text = skill.description + " " + " ".join(skill.tags)
            desc_tokens = _tokenize(desc_text)
            if not desc_tokens:
                continue

            similarity = _hybrid_similarity(query_tokens, desc_tokens)
            if similarity < min(threshold_cn, threshold_en):
                continue

            matched = list(query_tokens & desc_tokens)
            matches.append(SkillMatch(
                skill=skill,
                similarity=similarity,
                matched_tokens=matched,
                system_prompt=skill.system_prompt,
            ))

        matches.sort(key=lambda m: m.similarity, reverse=True)
        matches = matches[:top_k]

        duration_ms = (time.time() - start) * 1000
        return matches, duration_ms

    # ============================================================
    # 显式调用
    # ============================================================

    def invoke_explicit(
        self,
        skill_name: str,
        args: Optional[Dict[str, Any]] = None,
        context: Optional[str] = None,
    ) -> Tuple[Optional[SkillInvocation], Optional[Skill]]:
        """显式调用 skill

        参数：
          - skill_name: skill 名称
          - args: 调用参数
          - context: 上下文文本
        返回值：(invocation, skill) 或 (None, None) 当失败
        """
        start = time.time()
        skill = self._registry.get_skill_by_name(skill_name)

        if skill is None:
            invocation = self._record_invocation(
                skill_name=skill_name,
                skill_id=f"unknown:{skill_name}",
                invocation_type="explicit",
                args=args or {},
                duration_ms=int((time.time() - start) * 1000),
                success=False,
                error=f"Skill 不存在: {skill_name}",
            )
            return invocation, None

        if not skill.enabled:
            invocation = self._record_invocation(
                skill_name=skill_name,
                skill_id=skill.id,
                invocation_type="explicit",
                args=args or {},
                duration_ms=int((time.time() - start) * 1000),
                success=False,
                error=f"Skill 已禁用: {skill_name}",
            )
            return invocation, None

        if not skill.user_invocable:
            invocation = self._record_invocation(
                skill_name=skill_name,
                skill_id=skill.id,
                invocation_type="explicit",
                args=args or {},
                duration_ms=int((time.time() - start) * 1000),
                success=False,
                error=f"Skill 不可显式调用: {skill_name}",
            )
            return invocation, None

        # 频率限制
        if not self._check_rate_limit(skill.id):
            invocation = self._record_invocation(
                skill_name=skill_name,
                skill_id=skill.id,
                invocation_type="explicit",
                args=args or {},
                duration_ms=int((time.time() - start) * 1000),
                success=False,
                error="频率限制超出（60 calls/min）",
            )
            return invocation, None

        invocation = self._record_invocation(
            skill_name=skill_name,
            skill_id=skill.id,
            invocation_type="explicit",
            args=args or {},
            duration_ms=int((time.time() - start) * 1000),
            success=True,
        )
        return invocation, skill

    # ============================================================
    # 统一入口
    # ============================================================

    def process(
        self,
        query: str,
        args: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """统一处理入口

        优先识别显式调用；否则走隐式匹配

        参数：
          - query: 用户输入
          - args: 参数
        返回值：{
          "invocation_type": "explicit" | "implicit" | "none",
          "matches": [...],
          "invocation": {...},
          "skill": {...}
        }
        """
        result: Dict[str, Any] = {
            "invocation_type": "none",
            "matches": [],
            "invocation": None,
            "skill": None,
        }

        # 1. 检查显式
        skill_name, remaining = _parse_explicit_invocation(query)
        if skill_name:
            invocation, skill = self.invoke_explicit(skill_name, args=args, context=remaining)
            result["invocation_type"] = "explicit"
            result["invocation"] = invocation.to_dict() if invocation else None
            result["skill"] = skill.to_dict() if skill else None
            return result

        # 2. 隐式
        matches, duration = self.match_implicit(query)
        result["invocation_type"] = "implicit"
        result["matches"] = [m.to_dict() for m in matches]
        result["inference_ms"] = duration
        return result

    # ============================================================
    # 历史管理
    # ============================================================

    def _record_invocation(
        self,
        skill_name: str,
        skill_id: str,
        invocation_type: str,
        args: Dict[str, Any],
        duration_ms: int,
        success: bool = True,
        error: Optional[str] = None,
    ) -> SkillInvocation:
        """记录一次调用"""
        invocation = SkillInvocation(
            invocation_id=f"inv-{uuid.uuid4().hex[:12]}",
            skill_name=skill_name,
            skill_id=skill_id,
            invocation_type=invocation_type,
            args=args,
            duration_ms=duration_ms,
            created_at=datetime.now(timezone.utc).isoformat(),
            success=success,
            error=error,
        )

        with self._lock:
            self._history.append(invocation)

        # 异步持久化
        self._append_to_disk(invocation)
        return invocation

    def get_history(self, limit: int = 50) -> List[SkillInvocation]:
        """获取最近调用历史"""
        with self._lock:
            history = list(self._history)
        history.reverse()  # 最新在前
        return history[:limit]

    def _load_history(self):
        """从磁盘加载历史"""
        try:
            if not HISTORY_PATH.exists():
                return
            with open(HISTORY_PATH, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        inv = SkillInvocation(**data)
                        self._history.append(inv)
                    except (json.JSONDecodeError, TypeError):
                        continue
        except OSError as e:
            logger.warning(f"加载 skill invocation 历史失败: {e}")

    def _append_to_disk(self, invocation: SkillInvocation):
        """追加单条历史到磁盘"""
        try:
            HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(HISTORY_PATH, "a", encoding="utf-8") as f:
                f.write(json.dumps(invocation.to_dict(), ensure_ascii=False) + "\n")
        except OSError as e:
            logger.warning(f"追加 skill invocation 失败: {e}")

    # ============================================================
    # 频率限制
    # ============================================================

    def _check_rate_limit(self, skill_id: str) -> bool:
        """检查并记录频率"""
        with self._lock:
            now = time.time()
            if skill_id not in self._rate_limits:
                self._rate_limits[skill_id] = deque(maxlen=RATE_LIMIT_MAX * 2)
            timestamps = self._rate_limits[skill_id]
            # 清理过期
            while timestamps and now - timestamps[0] > RATE_LIMIT_WINDOW:
                timestamps.popleft()
            if len(timestamps) >= RATE_LIMIT_MAX:
                return False
            timestamps.append(now)
            return True


# ============================================================
# 单例
# ============================================================

_invocation_instance: Optional[SkillInvocationService] = None
_invocation_lock = threading.Lock()


def get_skill_invocation_service() -> SkillInvocationService:
    """获取全局单例"""
    global _invocation_instance
    if _invocation_instance is None:
        with _invocation_lock:
            if _invocation_instance is None:
                _invocation_instance = SkillInvocationService()
    return _invocation_instance
