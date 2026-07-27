"""
# ============================================================
# 模型版本选择 API（Module E - E1）
# ============================================================
# 核心作用：提供 Codex CLI 风格的模型版本选择能力，
#           支持 Sol（旗舰/复杂任务）/ Terra（均衡/日常）/
#           Luna（快速/批量）三档模型。
# 运行流程：
#   1. GET  /api/models      → 列出全部可用模型（含当前 selected 标志）
#   2. POST /api/models/select → 切换激活模型，返回最新列表
# 输入参数（POST /api/models/select）：
#   - model_id: str，模型标识（sol / terra / luna）
# 输出结果：JSON
#   [
#     {"id": "sol", "name": "Sol", "description": "...", "selected": false},
#     {"id": "terra", "name": "Terra", "description": "...", "selected": true},
#     {"id": "luna", "name": "Luna", "description": "...", "selected": false}
#   ]
# 修改记录：
#   - 2026-07-24 | v1.0.0 | Module E E1 初始版本：3 档模型 + 模块级 dict 存储
# ============================================================
"""

import logging
from typing import Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# 静态模型清单（Module E E1 - MVP）
# 核心作用：定义三档 Codex 风格模型的元数据。
# 设计原则：仅在内存中保存当前选中状态；服务重启会回到默认 terra。
# ============================================================
MODEL_REGISTRY: Dict[str, Dict[str, str]] = {
    "sol": {
        "id": "sol",
        "name": "Sol",
        "tagline": "旗舰",
        "description": "适合复杂任务：架构设计、多文件重构、深度推理。响应慢但质量最高。",
    },
    "terra": {
        "id": "terra",
        "name": "Terra",
        "tagline": "均衡",
        "description": "日常主力：通用代码生成、调试、文档撰写。速度与质量平衡。",
    },
    "luna": {
        "id": "luna",
        "name": "Luna",
        "tagline": "快速",
        "description": "适合批量重复任务：单元测试、CRUD 代码、简单问答。延迟低、成本低。",
    },
}

# 当前激活的模型 ID（模块级 dict，进程级持久；MVP 不入 DB）
_CURRENT_MODEL_ID: Dict[str, str] = {"value": "terra"}


class SelectModelRequest(BaseModel):
    """
    切换激活模型请求体
    字段：
      - model_id: str，目标模型 ID（sol / terra / luna）
    """

    model_id: str = Field(..., description="目标模型 ID（sol / terra / luna）")


def _build_model_list() -> List[Dict[str, object]]:
    """
    构造模型列表响应（包含 selected 标志）
    返回值：list[dict]，每项含 id / name / tagline / description / selected
    """
    selected = _CURRENT_MODEL_ID["value"]
    out: List[Dict[str, object]] = []
    for mid, meta in MODEL_REGISTRY.items():
        out.append(
            {
                "id": meta["id"],
                "name": meta["name"],
                "tagline": meta["tagline"],
                "description": meta["description"],
                "selected": mid == selected,
            }
        )
    return out


@router.get("")
@router.get("/")
async def list_models():
    """
    列出全部可用模型
    作用：供前端 ModelSelector 初始化时拉取清单与当前 selected 状态
    返回值：JSON 数组，按 MODEL_REGISTRY 顺序排列
    """
    return _build_model_list()


@router.post("/select")
async def select_model(req: SelectModelRequest):
    """
    切换激活模型
    作用：更新模块级 _CURRENT_MODEL_ID 并返回最新列表
    异常：
      - 400：model_id 不在 MODEL_REGISTRY 中
    返回值：JSON 数组（含更新后的 selected 状态）
    """
    target = req.model_id.lower().strip()
    if target not in MODEL_REGISTRY:
        valid = ", ".join(sorted(MODEL_REGISTRY.keys()))
        raise HTTPException(
            status_code=400,
            detail=f"未知模型 ID: {req.model_id!r}（有效值: {valid}）",
        )
    _CURRENT_MODEL_ID["value"] = target
    logger.info(f"模型已切换: {target} ({MODEL_REGISTRY[target]['name']})")
    return _build_model_list()


def get_current_model_id() -> str:
    """
    获取当前激活模型 ID（供其他模块如 /api/fix / /api/reasoning 引用）
    返回值：模型 ID 字符串
    """
    return _CURRENT_MODEL_ID["value"]
