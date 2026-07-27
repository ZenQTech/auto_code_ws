"""
# ============================================================
# 推理强度调节 API（Module E - E2）
# ============================================================
# 核心作用：提供 Codex CLI 风格的「思考深度」三档调节能力，
#           配合 ModelSelector 使用，调整 LLM 的 temperature / max_tokens。
# 运行流程：
#   1. GET  /api/reasoning     → 列出全部可选强度与当前选中项
#   2. POST /api/reasoning/set → 切换激活强度，返回 {intensity, config}
# 输入参数（POST /api/reasoning/set）：
#   - intensity: str，强度档（low / medium / high）
# 输出结果（POST 响应）：
#   {
#     "intensity": "medium",
#     "config": {"temperature": 0.7, "max_tokens": 4096, "top_p": 0.95}
#   }
# 修改记录：
#   - 2026-07-24 | v1.0.0 | Module E E2 初始版本：3 档强度 + 模块级 dict
# ============================================================
"""

import logging
from typing import Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# 静态强度配置（Module E E2 - MVP）
# 三档强度：低（速度优先）/ 中（默认）/ 高（深度推理）
# 每档映射一组 LLM 推理参数，供调用方读取
# ============================================================
INTENSITY_REGISTRY: Dict[str, Dict[str, object]] = {
    "low": {
        "label": "低",
        "description": "速度优先：低 temperature，短 max_tokens。适合简单问答、CRUD。",
        "config": {"temperature": 0.3, "max_tokens": 1024, "top_p": 0.9},
    },
    "medium": {
        "label": "中",
        "description": "默认档：均衡的 temperature 与 max_tokens。适合一般开发任务。",
        "config": {"temperature": 0.7, "max_tokens": 4096, "top_p": 0.95},
    },
    "high": {
        "label": "高",
        "description": "深度优先：高 max_tokens，鼓励模型多步推理。适合架构设计、复杂调试。",
        "config": {"temperature": 0.9, "max_tokens": 8192, "top_p": 0.98},
    },
}

# 当前激活的推理强度（模块级 dict，进程级持久）
_CURRENT_INTENSITY: Dict[str, str] = {"value": "medium"}


class SetReasoningRequest(BaseModel):
    """
    设置推理强度请求体
    字段：
      - intensity: str，强度档（low / medium / high）
    """

    intensity: str = Field(..., description="推理强度（low / medium / high）")


def _build_intensity_list() -> list:
    """
    构造强度列表响应（包含 selected 标志）
    返回值：list[dict]
    """
    selected = _CURRENT_INTENSITY["value"]
    out = []
    for key, meta in INTENSITY_REGISTRY.items():
        out.append(
            {
                "id": key,
                "label": meta["label"],
                "description": meta["description"],
                "selected": key == selected,
            }
        )
    return out


@router.get("")
@router.get("/")
async def list_intensities():
    """
    列出全部推理强度选项
    返回值：JSON 数组，按 INTENSITY_REGISTRY 顺序
    """
    return _build_intensity_list()


@router.get("/current")
async def get_current_intensity():
    """
    获取当前激活的推理强度及配置
    返回值：{"intensity": "medium", "config": {...}}
    """
    cur = _CURRENT_INTENSITY["value"]
    return {
        "intensity": cur,
        "config": INTENSITY_REGISTRY[cur]["config"],
    }


@router.post("/set")
async def set_intensity(req: SetReasoningRequest):
    """
    设置推理强度
    作用：更新模块级 _CURRENT_INTENSITY 并返回新档位与对应 config
    异常：
      - 400：intensity 不在 INTENSITY_REGISTRY 中
    返回值：{"intensity": "...", "config": {...}}
    """
    target = req.intensity.lower().strip()
    if target not in INTENSITY_REGISTRY:
        valid = ", ".join(sorted(INTENSITY_REGISTRY.keys()))
        raise HTTPException(
            status_code=400,
            detail=f"未知强度档: {req.intensity!r}（有效值: {valid}）",
        )
    _CURRENT_INTENSITY["value"] = target
    logger.info(f"推理强度已切换: {target} ({INTENSITY_REGISTRY[target]['label']})")
    return {
        "intensity": target,
        "config": INTENSITY_REGISTRY[target]["config"],
    }


def get_current_intensity() -> str:
    """
    获取当前激活强度（供其他模块如 /api/fix 引用）
    返回值：强度字符串
    """
    return _CURRENT_INTENSITY["value"]


def get_current_config() -> Dict[str, object]:
    """
    获取当前强度对应的 LLM 配置
    返回值：dict，含 temperature / max_tokens / top_p
    """
    cur = _CURRENT_INTENSITY["value"]
    return dict(INTENSITY_REGISTRY[cur]["config"])  # type: ignore[arg-type]
