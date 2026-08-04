"""
# ============================================================
# Stage 数据模型 (v1.0.0)
# Cycle 63 G63-03
# ====================================
# 核心作用：定义阶段检测器的数据结构
# 输入参数：无（模型定义）
# 输出结果：Pydantic 模型
# 对标：Trae SOLO Auto-Follow
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 63 G63-03 初次创建
# ====================================
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ============================================================
# 阶段枚举
# ============================================================


STAGE_IDS = ["idle", "prd", "coding", "preview", "deploy", "done"]


def is_valid_stage(stage: str) -> bool:
    return stage in STAGE_IDS


# ============================================================
# 阶段触发关键词（rule-based）
# ============================================================


STAGE_TRIGGERS: Dict[str, List[str]] = {
    "prd": [
        "PRD",
        "user story",
        "acceptance criteria",
        "需求文档",
        "需求澄清",
        "验收标准",
        "用户场景",
        "目标",
    ],
    "coding": [
        "```",
        "function ",
        "class ",
        "import ",
        "def ",
        "const ",
        "let ",
        "var ",
        "fn ",
        "func ",
        "async ",
        "def ",
        "return ",
        "编写代码",
        "实现",
    ],
    "preview": [
        "preview",
        "http://localhost",
        "127.0.0.1",
        "screenshot",
        "浏览器",
        "页面",
        "前端",
        "UI",
        "渲染",
    ],
    "deploy": [
        "deploy",
        "vercel",
        "netlify",
        "npm run build",
        "git push",
        "部署",
        "发布",
        "上线",
        "docker build",
        "kubectl",
    ],
}


# ============================================================
# 数据模型
# ============================================================


class StageState(BaseModel):
    """阶段状态"""

    session_id: str
    stage: str = "idle"
    substage: Optional[str] = None
    confidence: float = 0.0
    auto_follow: bool = True
    entered_at: float = 0.0
    source: str = "rule"  # rule / llm / manual
    reason: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return self.model_dump()


class StageEvent(BaseModel):
    """阶段事件（WebSocket 推送）"""

    event_id: str
    session_id: str
    type: str  # stage_change / substage_change / follow_action
    from_stage: Optional[str] = None
    to_stage: Optional[str] = None
    confidence: Optional[float] = None
    reason: Optional[str] = None
    timestamp: float = 0.0


# ============================================================
# API 请求模型
# ============================================================


class ForceStageRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=128)
    stage: str = Field(..., min_length=1, max_length=32)
    reason: str = Field(default="manual override", max_length=512)


class DetectStageRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=128)
    text: str = Field(..., min_length=1, max_length=50000)
    use_llm: bool = False


class AutoFollowRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=128)
    enabled: bool
