"""
# ============================================================
# Hermes LLM-as-Judge 验证层 - 模块入口
# ============================================================
# 核心作用：导出所有公开类与函数
# Cycle 13 P0-3 新建
# ============================================================
"""

from .models import (
    ALL_DIMENSIONS,
    ConsensusStrategy,
    DEFAULT_RUBRIC,
    Difficulty,
    DIMENSION_CORRECTNESS,
    DIMENSION_MAINTAINABILITY,
    DIMENSION_PERFORMANCE,
    DIMENSION_SAFETY,
    DIMENSION_STYLE,
    Domain,
    Judge,
    JudgeAdapterType,
    JudgeConsensus,
    JudgeReport,
    JudgeScore,
    JudgeTask,
    JudgeTaskStatus,
)
from .prompts import (
    build_prompt,
    default_rubric,
    DEFAULT_JUDGE_PROMPT,
    extract_json_from_response,
    render_template,
    validate_rubric,
)
from .adapters import (
    ADAPTER_REGISTRY,
    ClaudeJudgeAdapter,
    create_adapter,
    CustomJudgeAdapter,
    GeminiJudgeAdapter,
    GPTJudgeAdapter,
    JudgeAdapter,
    MockJudgeAdapter,
    register_adapter,
)
from .pool import (
    DEFAULT_JUDGES,
    get_judge_pool,
    is_pool_path_allowed,
    JudgePool,
    reset_judge_pool,
)
from .consensus import ConsensusEngine
from .verifier import get_llm_judge_verifier, LLMJudgeVerifier
from .store import (
    get_judge_store,
    is_store_path_allowed,
    JudgeStore,
    reset_judge_store,
)
from .engine import (
    get_judge_engine,
    JudgeEngine,
    reset_judge_engine,
)

__all__ = [
    # 数据模型
    "Judge",
    "JudgeTask",
    "JudgeReport",
    "JudgeScore",
    "JudgeConsensus",
    "JudgeTaskStatus",
    "Difficulty",
    "Domain",
    "JudgeAdapterType",
    "ConsensusStrategy",
    "ALL_DIMENSIONS",
    "DEFAULT_RUBRIC",
    "DIMENSION_CORRECTNESS",
    "DIMENSION_STYLE",
    "DIMENSION_SAFETY",
    "DIMENSION_PERFORMANCE",
    "DIMENSION_MAINTAINABILITY",
    # Prompt
    "build_prompt",
    "default_rubric",
    "DEFAULT_JUDGE_PROMPT",
    "extract_json_from_response",
    "render_template",
    "validate_rubric",
    # Adapter
    "ADAPTER_REGISTRY",
    "JudgeAdapter",
    "MockJudgeAdapter",
    "ClaudeJudgeAdapter",
    "GPTJudgeAdapter",
    "GeminiJudgeAdapter",
    "CustomJudgeAdapter",
    "create_adapter",
    "register_adapter",
    # Pool
    "JudgePool",
    "get_judge_pool",
    "reset_judge_pool",
    "is_pool_path_allowed",
    "DEFAULT_JUDGES",
    # Consensus
    "ConsensusEngine",
    # Verifier
    "LLMJudgeVerifier",
    "get_llm_judge_verifier",
    # Store
    "JudgeStore",
    "get_judge_store",
    "reset_judge_store",
    "is_store_path_allowed",
    # Engine
    "JudgeEngine",
    "get_judge_engine",
    "reset_judge_engine",
]

__version__ = "1.0.0"
