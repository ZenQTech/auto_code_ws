"""
# ============================================================
# Custom Models API - 自定义模型 REST API
# ============================================================
# 核心作用：提供自定义模型 + Bearer Token 的 HTTP 接口
# 端点（11 个）：
#   GET    /api/custom-models/providers                    - 列出 providers
#   POST   /api/custom-models/providers                    - 创建 provider
#   GET    /api/custom-models/providers/{id}               - 详情
#   PATCH  /api/custom-models/providers/{id}               - 更新
#   DELETE /api/custom-models/providers/{id}               - 删除
#   POST   /api/custom-models/providers/{id}/test         - 测试连接
#   POST   /api/custom-models/providers/{id}/refresh      - 刷新 token
#   GET    /api/custom-models/models                       - 列出所有模型
#   POST   /api/custom-models/models                       - 添加模型
#   DELETE /api/custom-models/models/{id}                  - 删除模型
#   GET    /api/custom-models/status                       - 全局状态
#   GET    /api/custom-models/summary                      - 摘要
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 8 P0-14
# ============================================================
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services.custom_models.bearer_token_refresher import RefreshResult
from app.services.custom_models.models_store import ModelEntry, ModelProvider
from app.services.custom_models.service import BUILTIN_MODELS, CustomModelsService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/custom-models", tags=["custom-models"])


def get_service() -> CustomModelsService:
    return CustomModelsService.get_instance()


# ============================================================
# 请求模型
# ============================================================

class CreateProviderRequest(BaseModel):
    name: str
    type: str
    base_url: str
    api_key: str = ""
    refresh_token: str = ""
    expires_at: Optional[float] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class UpdateProviderRequest(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    enabled: Optional[bool] = None
    metadata: Optional[Dict[str, Any]] = None


class CreateModelRequest(BaseModel):
    provider_id: str
    model_id: str
    display_name: str
    max_tokens: int = 4096
    context_window: int = 32768
    temperature_default: float = 0.7
    metadata: Dict[str, Any] = Field(default_factory=dict)


# ============================================================
# Provider 端点
# ============================================================

@router.get("/summary")
async def get_summary() -> Dict[str, Any]:
    """获取摘要"""
    service = get_service()
    return {"success": True, "summary": service.get_summary()}


@router.get("/status")
async def get_status() -> Dict[str, Any]:
    """获取全局状态"""
    service = get_service()
    return {"success": True, "status": service.get_refresh_status()}


@router.get("/providers")
async def list_providers(
    enabled_only: bool = Query(False),
) -> Dict[str, Any]:
    """列出所有 providers"""
    service = get_service()
    if enabled_only:
        providers = [p for p in service.list_providers() if p.enabled]
    else:
        providers = service.list_providers()
    return {
        "success": True,
        "providers": [p.to_dict() for p in providers],
        "total": len(providers),
    }


@router.post("/providers")
async def create_provider(request: CreateProviderRequest) -> Dict[str, Any]:
    """创建 provider"""
    if request.type not in ("openai", "anthropic", "azure", "custom"):
        raise HTTPException(status_code=400, detail=f"不支持的 type: {request.type}")
    service = get_service()
    try:
        provider = service.create_provider(
            name=request.name,
            type=request.type,
            base_url=request.base_url,
            api_key=request.api_key,
            refresh_token=request.refresh_token,
            expires_at=request.expires_at,
            metadata=request.metadata,
        )
        return {
            "success": True,
            "provider": provider.to_dict(),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"创建 provider 失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/providers/{provider_id}")
async def get_provider(
    provider_id: str,
    include_secrets: bool = Query(False),
) -> Dict[str, Any]:
    """获取 provider 详情"""
    service = get_service()
    provider = service.get_provider(provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail=f"Provider not found: {provider_id}")
    return {
        "success": True,
        "provider": provider.to_dict(include_secrets=include_secrets),
    }


@router.patch("/providers/{provider_id}")
async def update_provider(
    provider_id: str,
    request: UpdateProviderRequest,
) -> Dict[str, Any]:
    """更新 provider"""
    service = get_service()
    update_data = {k: v for k, v in request.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="无更新字段")
    provider = service.update_provider(provider_id, **update_data)
    if provider is None:
        raise HTTPException(status_code=404, detail=f"Provider not found: {provider_id}")
    return {
        "success": True,
        "provider": provider.to_dict(),
    }


@router.delete("/providers/{provider_id}")
async def delete_provider(provider_id: str) -> Dict[str, Any]:
    """删除 provider"""
    service = get_service()
    success = service.delete_provider(provider_id)
    return {
        "success": success,
        "provider_id": provider_id,
    }


@router.post("/providers/{provider_id}/test")
async def test_provider(provider_id: str) -> Dict[str, Any]:
    """测试 provider 连接"""
    service = get_service()
    result = await service.test_provider(provider_id)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error"))
    return {"success": True, "test": result}


@router.post("/providers/{provider_id}/refresh")
async def refresh_provider_token(provider_id: str) -> Dict[str, Any]:
    """刷新 provider token"""
    service = get_service()
    result = await service.refresh_provider_token(provider_id)
    return {
        "success": result.success,
        "refresh": {
            "provider_id": result.provider_id,
            "new_expires_at": result.new_expires_at,
            "error": result.error,
            "duration_ms": result.duration_ms,
        },
    }


# ============================================================
# Model 端点
# ============================================================

@router.get("/models")
async def list_all_models() -> Dict[str, Any]:
    """列出所有模型（内置 + 自定义）"""
    service = get_service()
    models = service.list_all_models()
    return {
        "success": True,
        "models": models,
        "total": len(models),
    }


@router.post("/models")
async def create_model(request: CreateModelRequest) -> Dict[str, Any]:
    """添加模型条目"""
    service = get_service()
    try:
        model = service.create_model(
            provider_id=request.provider_id,
            model_id=request.model_id,
            display_name=request.display_name,
            max_tokens=request.max_tokens,
            context_window=request.context_window,
            temperature_default=request.temperature_default,
            metadata=request.metadata,
        )
        return {
            "success": True,
            "model": model.to_dict(),
        }
    except Exception as e:
        logger.error(f"创建模型失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/models/{model_id}")
async def delete_model(model_id: str) -> Dict[str, Any]:
    """删除模型条目"""
    service = get_service()
    success = service.delete_model(model_id)
    return {
        "success": success,
        "model_id": model_id,
    }


@router.get("/models/provider/{provider_id}")
async def list_provider_models(provider_id: str) -> Dict[str, Any]:
    """列出指定 provider 的模型"""
    service = get_service()
    models = service.list_models_for_provider(provider_id)
    return {
        "success": True,
        "models": [m.to_dict() for m in models],
        "total": len(models),
    }
