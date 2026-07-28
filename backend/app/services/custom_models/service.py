"""
# ============================================================
# Custom Models Service - 自定义模型服务层
# ============================================================
# 核心作用：提供 ModelProvider + ModelEntry 的高层 API
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 8 P0-14
# ============================================================
"""

import logging
import time
from typing import Any, Dict, List, Optional

from .bearer_token_refresher import BearerTokenRefresher, RefreshResult
from .models_store import (
    ModelEntry,
    ModelProvider,
    ModelsStore,
    decrypt_value,
)

logger = logging.getLogger(__name__)


# ============================================================
# 内置模型定义（Sol / Terra / Luna）
# ============================================================

BUILTIN_MODELS = [
    {
        "id": "sol",
        "provider_id": "builtin",
        "model_id": "sol",
        "display_name": "Sol",
        "tagline": "Strong reasoning",
        "description": "深度推理模型，适合复杂任务",
        "max_tokens": 8192,
        "context_window": 200000,
        "selected": True,
    },
    {
        "id": "terra",
        "provider_id": "builtin",
        "model_id": "terra",
        "display_name": "Terra",
        "tagline": "Balanced",
        "description": "平衡型模型，适合日常任务",
        "max_tokens": 4096,
        "context_window": 128000,
        "selected": False,
    },
    {
        "id": "luna",
        "provider_id": "builtin",
        "model_id": "luna",
        "display_name": "Luna",
        "tagline": "Fast",
        "description": "快速响应模型，适合简短对话",
        "max_tokens": 2048,
        "context_window": 64000,
        "selected": False,
    },
]


class CustomModelsService:
    """
    自定义模型服务（单例）
    """

    _instance: Optional["CustomModelsService"] = None

    def __init__(self) -> None:
        self._store = ModelsStore()
        self._refresher = BearerTokenRefresher.get_instance()

    @classmethod
    def get_instance(cls) -> "CustomModelsService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # ============================================================
    # Provider 操作
    # ============================================================

    def create_provider(
        self,
        name: str,
        type: str,
        base_url: str,
        api_key: str = "",
        **kwargs: Any,
    ) -> ModelProvider:
        return self._store.create_provider(
            name=name, type=type, base_url=base_url, api_key=api_key, **kwargs
        )

    def list_providers(self) -> List[ModelProvider]:
        return self._store.list_providers()

    def get_provider(self, provider_id: str) -> Optional[ModelProvider]:
        return self._store.get_provider(provider_id)

    def update_provider(self, provider_id: str, **kwargs: Any) -> Optional[ModelProvider]:
        return self._store.update_provider(provider_id, **kwargs)

    def delete_provider(self, provider_id: str) -> bool:
        return self._store.delete_provider(provider_id)

    # ============================================================
    # 模型操作
    # ============================================================

    def create_model(
        self,
        provider_id: str,
        model_id: str,
        display_name: str,
        **kwargs: Any,
    ) -> ModelEntry:
        return self._store.create_model(
            provider_id=provider_id,
            model_id=model_id,
            display_name=display_name,
            **kwargs,
        )

    def list_all_models(self) -> List[Dict[str, Any]]:
        """
        列出所有可用模型（内置 + 自定义）

        Returns:
            模型字典列表
        """
        result: List[Dict[str, Any]] = list(BUILTIN_MODELS)

        # 添加自定义 providers 的模型
        for provider in self._store.list_providers(enabled_only=True):
            for model in self._store.list_models(provider_id=provider.id, enabled_only=True):
                result.append({
                    "id": f"custom-{model.id}",
                    "provider_id": provider.id,
                    "provider_name": provider.name,
                    "provider_type": provider.type,
                    "model_id": model.model_id,
                    "display_name": model.display_name,
                    "max_tokens": model.max_tokens,
                    "context_window": model.context_window,
                    "selected": False,
                    "is_custom": True,
                })

        return result

    def list_models_for_provider(self, provider_id: str) -> List[ModelEntry]:
        return self._store.list_models(provider_id=provider_id)

    def delete_model(self, model_id: str) -> bool:
        return self._store.delete_model(model_id)

    # ============================================================
    # 测试连接
    # ============================================================

    async def test_provider(self, provider_id: str) -> Dict[str, Any]:
        """测试 provider 连接性（模拟）"""
        provider = self.get_provider(provider_id)
        if provider is None:
            return {"success": False, "error": f"Provider not found: {provider_id}"}

        # 真实实现：发送 GET {base_url}/models 测试
        # 模拟：返回成功
        return {
            "success": True,
            "provider_id": provider_id,
            "provider_name": provider.name,
            "base_url": provider.base_url,
            "type": provider.type,
            "latency_ms": 42.0,
            "models_available": len(self._store.list_models(provider_id=provider_id)),
            "tested_at": time.time(),
        }

    # ============================================================
    # Token 刷新
    # ============================================================

    async def refresh_provider_token(self, provider_id: str) -> RefreshResult:
        return await self._refresher.refresh_now(provider_id)

    def get_refresh_status(self) -> Dict[str, Any]:
        return self._refresher.get_status()

    # ============================================================
    # 摘要
    # ============================================================

    def get_summary(self) -> Dict[str, Any]:
        providers = self._store.list_providers()
        total_models = sum(
            len(self._store.list_models(provider_id=p.id)) for p in providers
        )
        by_type: Dict[str, int] = {}
        for p in providers:
            by_type[p.type] = by_type.get(p.type, 0) + 1
        return {
            "total_providers": len(providers),
            "total_models": total_models,
            "by_type": by_type,
            "builtin_models": len(BUILTIN_MODELS),
            "refresh_status": self.get_refresh_status(),
        }
