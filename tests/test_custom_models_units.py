"""
# Cycle 8 P0-14: Custom Models + Bearer Token Unit Tests

覆盖范围：
- T1: ModelsStore CRUD + 加密 (≥ 8 测试)
- T2: BearerTokenRefresher (≥ 6 测试)
- T3: CustomModelsService (≥ 6 测试)
- T4: API 端点契约 (≥ 4 测试)
合计：≥ 24 单元测试
"""

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

# Ensure backend is on path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))
sys.path.insert(0, str(PROJECT_ROOT))


class TestModelsStore(unittest.TestCase):
    """T1: ModelsStore CRUD + 加密"""

    def setUp(self):
        # 使用临时数据库，避免污染 ~/.hermes/custom_models.db
        self.tmpdir = tempfile.mkdtemp()
        self.db_path = Path(self.tmpdir) / "test_custom_models.db"
        # Patch DEFAULT_DATA_DIR + 重新导入 store 模块
        from app.services.custom_models import models_store
        models_store.DEFAULT_DATA_DIR = Path(self.tmpdir)
        models_store._cipher_instance = None  # 重新生成 cipher
        # 删除已存在的 .encryption_key 以触发新密钥生成
        key_file = Path(self.tmpdir) / ".encryption_key"
        if key_file.exists():
            key_file.unlink()
        from app.services.custom_models.models_store import ModelsStore
        self.store = ModelsStore(db_path=self.db_path)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_T1_01_create_provider_basic(self):
        """T1-01: 基本创建 provider"""
        from app.services.custom_models.models_store import PROVIDER_TYPES
        p = self.store.create_provider(
            name="DeepSeek Official",
            type="openai",
            base_url="https://api.deepseek.com/v1",
        )
        self.assertIsNotNone(p.id)
        self.assertEqual(p.name, "DeepSeek Official")
        self.assertEqual(p.type, "openai")
        self.assertEqual(p.base_url, "https://api.deepseek.com/v1")
        self.assertTrue(p.enabled)
        self.assertIn("openai", PROVIDER_TYPES)

    def test_T1_02_create_provider_with_api_key(self):
        """T1-02: 创建时加密 API Key"""
        api_key = "sk-test-secret-key-12345"
        p = self.store.create_provider(
            name="Test",
            type="openai",
            base_url="https://api.openai.com/v1",
            api_key=api_key,
        )
        # 密文不应包含原文
        self.assertNotIn(api_key, p.api_key_encrypted)
        # 脱敏应保留前后 4 位
        self.assertIn("****", p.api_key_masked)
        self.assertTrue(p.api_key_masked.startswith("sk-t"))
        self.assertTrue(p.api_key_masked.endswith("2345"))

    def test_T1_03_get_provider_returns_none_for_missing(self):
        """T1-03: 不存在的 provider 返回 None"""
        result = self.store.get_provider("nonexistent-id")
        self.assertIsNone(result)

    def test_T1_04_list_providers(self):
        """T1-04: 列出所有 providers"""
        self.store.create_provider(name="A", type="openai", base_url="https://a.com")
        self.store.create_provider(name="B", type="anthropic", base_url="https://b.com")
        providers = self.store.list_providers()
        self.assertEqual(len(providers), 2)
        names = {p.name for p in providers}
        self.assertIn("A", names)
        self.assertIn("B", names)

    def test_T1_05_list_providers_enabled_only(self):
        """T1-05: enabled_only 过滤"""
        p1 = self.store.create_provider(name="Enabled", type="openai", base_url="https://e.com")
        p2 = self.store.create_provider(name="Disabled", type="openai", base_url="https://d.com")
        # 禁用 p2
        self.store.update_provider(p2.id, enabled=False)
        result = self.store.list_providers(enabled_only=True)
        names = {p.name for p in result}
        self.assertIn("Enabled", names)
        self.assertNotIn("Disabled", names)

    def test_T1_06_update_provider(self):
        """T1-06: 更新 provider 字段"""
        p = self.store.create_provider(name="Old", type="openai", base_url="https://old.com")
        updated = self.store.update_provider(p.id, name="New", base_url="https://new.com")
        self.assertIsNotNone(updated)
        self.assertEqual(updated.name, "New")
        self.assertEqual(updated.base_url, "https://new.com")
        # updated_at 应当更新
        self.assertGreater(updated.updated_at, p.created_at)

    def test_T1_07_delete_provider(self):
        """T1-07: 删除 provider"""
        p = self.store.create_provider(name="DeleteMe", type="openai", base_url="https://x.com")
        success = self.store.delete_provider(p.id)
        self.assertTrue(success)
        self.assertIsNone(self.store.get_provider(p.id))

    def test_T1_08_invalid_provider_type(self):
        """T1-08: 不支持的 type 抛错"""
        with self.assertRaises(ValueError):
            self.store.create_provider(name="Bad", type="unsupported", base_url="x")

    def test_T1_09_create_model_entry(self):
        """T1-09: 创建模型条目"""
        p = self.store.create_provider(name="P", type="openai", base_url="https://p.com")
        m = self.store.create_model(
            provider_id=p.id,
            model_id="deepseek-chat",
            display_name="DeepSeek Chat",
            max_tokens=4096,
            context_window=128000,
        )
        self.assertIsNotNone(m.id)
        self.assertEqual(m.model_id, "deepseek-chat")
        self.assertEqual(m.display_name, "DeepSeek Chat")
        self.assertEqual(m.context_window, 128000)

    def test_T1_10_list_models_for_provider(self):
        """T1-10: 列出 provider 下的模型"""
        p = self.store.create_provider(name="P", type="openai", base_url="https://p.com")
        self.store.create_model(provider_id=p.id, model_id="m1", display_name="M1")
        self.store.create_model(provider_id=p.id, model_id="m2", display_name="M2")
        # 给另一个 provider 添加模型，确认不会混入
        p2 = self.store.create_provider(name="Q", type="openai", base_url="https://q.com")
        self.store.create_model(provider_id=p2.id, model_id="q1", display_name="Q1")
        models = self.store.list_models(provider_id=p.id)
        self.assertEqual(len(models), 2)

    def test_T1_11_delete_model(self):
        """T1-11: 删除模型条目"""
        p = self.store.create_provider(name="P", type="openai", base_url="https://p.com")
        m = self.store.create_model(provider_id=p.id, model_id="m1", display_name="M1")
        ok = self.store.delete_model(m.id)
        self.assertTrue(ok)
        self.assertEqual(len(self.store.list_models(provider_id=p.id)), 0)

    def test_T1_12_encryption_round_trip(self):
        """T1-12: 加密-解密往返一致"""
        from app.services.custom_models.models_store import encrypt_value, decrypt_value
        original = "my-super-secret-key-12345"
        encrypted = encrypt_value(original)
        # 加密结果不应为空，且不应与原文一致（除非 Fernet 不可用）
        self.assertNotEqual(encrypted, original)
        decrypted = decrypt_value(encrypted)
        self.assertEqual(decrypted, original)

    def test_T1_13_mask_api_key_short(self):
        """T1-13: 短 API Key 脱敏返回 ****"""
        from app.services.custom_models.models_store import mask_api_key
        result = mask_api_key("short")
        self.assertEqual(result, "****")

    def test_T1_14_mask_api_key_long(self):
        """T1-14: 长 API Key 脱敏保留前后 4 位"""
        from app.services.custom_models.models_store import mask_api_key
        result = mask_api_key("sk-proj-1234567890abcdef")
        self.assertTrue(result.startswith("sk-p"))
        self.assertTrue(result.endswith("cdef"))
        self.assertIn("****", result)


class TestBearerTokenRefresher(unittest.TestCase):
    """T2: BearerTokenRefresher 逻辑"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.db_path = Path(self.tmpdir) / "test.db"
        from app.services.custom_models import models_store
        models_store.DEFAULT_DATA_DIR = Path(self.tmpdir)
        models_store._cipher_instance = None
        key_file = Path(self.tmpdir) / ".encryption_key"
        if key_file.exists():
            key_file.unlink()
        from app.services.custom_models.models_store import ModelsStore
        from app.services.custom_models.bearer_token_refresher import BearerTokenRefresher
        self.store = ModelsStore(db_path=self.db_path)
        self.refresher = BearerTokenRefresher(store=self.store)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_T2_01_needs_refresh_no_expires(self):
        """T2-01: 无 expires_at 时不需要刷新"""
        from app.services.custom_models.models_store import ModelProvider
        p = ModelProvider(id="x", name="X", type="openai", base_url="u", expires_at=None)
        self.assertFalse(self.refresher.needs_refresh(p))

    def test_T2_02_needs_refresh_expired(self):
        """T2-02: 已过期需要刷新"""
        from app.services.custom_models.models_store import ModelProvider
        p = ModelProvider(
            id="x", name="X", type="openai", base_url="u",
            expires_at=time.time() - 100,  # 100 秒前已过期
        )
        self.assertTrue(self.refresher.needs_refresh(p))

    def test_T2_03_needs_refresh_within_threshold(self):
        """T2-03: 5 分钟内即将过期需要刷新"""
        from app.services.custom_models.models_store import ModelProvider
        p = ModelProvider(
            id="x", name="X", type="openai", base_url="u",
            expires_at=time.time() + 200,  # 200 秒后过期 (阈值默认 300 秒)
        )
        self.assertTrue(self.refresher.needs_refresh(p))

    def test_T2_04_needs_refresh_far_future(self):
        """T2-04: 长时间后过期不需要刷新"""
        from app.services.custom_models.models_store import ModelProvider
        p = ModelProvider(
            id="x", name="X", type="openai", base_url="u",
            expires_at=time.time() + 3600,  # 1 小时后过期
        )
        self.assertFalse(self.refresher.needs_refresh(p))

    def test_T2_05_refresh_now_provider_not_found(self):
        """T2-05: 刷新不存在的 provider 返回失败"""
        import asyncio
        result = asyncio.run(self.refresher.refresh_now("nonexistent"))
        self.assertFalse(result.success)
        self.assertIn("not found", (result.error or "").lower())

    def test_T2_06_refresh_now_default_handler(self):
        """T2-06: 默认 handler 刷新（无 refresh_token 时失败）"""
        import asyncio
        # 创建 provider 但不提供 refresh_token
        p = self.store.create_provider(name="Test", type="openai", base_url="https://t.com")
        result = asyncio.run(self.refresher.refresh_now(p.id))
        # 没有 refresh_token 时默认 handler 返回失败
        self.assertFalse(result.success)
        self.assertIn("refresh_token", (result.error or "").lower())

    def test_T2_07_refresh_now_success(self):
        """T2-07: 提供 refresh_token 时默认 handler 刷新成功"""
        import asyncio
        p = self.store.create_provider(
            name="Test", type="openai", base_url="https://t.com",
            refresh_token="rt-12345",
        )
        result = asyncio.run(self.refresher.refresh_now(p.id))
        self.assertTrue(result.success)
        self.assertIsNotNone(result.new_expires_at)
        # 验证 default handler 不主动更新 store（更新由注册 handler 负责）

    def test_T2_08_register_custom_handler_updates_store(self):
        """T2-08: 注册自定义 handler 后，刷新成功时会更新 store"""
        import asyncio
        from app.services.custom_models.models_store import ModelProvider
        from app.services.custom_models.bearer_token_refresher import RefreshResult

        called_with = []

        async def my_handler(provider: ModelProvider) -> RefreshResult:
            called_with.append(provider.id)
            return RefreshResult(
                success=True,
                provider_id=provider.id,
                new_expires_at=time.time() + 7200,
            )

        self.refresher.register_handler("custom", my_handler)
        p = self.store.create_provider(name="Custom", type="custom", base_url="https://c.com")
        result = asyncio.run(self.refresher.refresh_now(p.id))
        self.assertTrue(result.success)
        self.assertEqual(called_with, [p.id])
        # 注册 handler 路径会主动调用 update_provider
        updated = self.store.get_provider(p.id)
        self.assertEqual(updated.expires_at, result.new_expires_at)

    def test_T2_09_get_status_empty(self):
        """T2-09: 无 providers 时状态返回 0"""
        status = self.refresher.get_status()
        self.assertEqual(status["total_providers"], 0)
        self.assertEqual(status["expired"], 0)
        self.assertEqual(status["expiring_soon"], 0)
        self.assertFalse(status["background_running"])

    def test_T2_10_get_status_with_expired(self):
        """T2-10: 已过期 provider 在 status 中标记"""
        # 创建即将过期的 provider
        p = self.store.create_provider(
            name="Soon", type="openai", base_url="https://s.com",
            expires_at=time.time() + 100,  # 100 秒后过期（< 5 分钟阈值）
        )
        status = self.refresher.get_status()
        self.assertEqual(status["total_providers"], 1)
        self.assertEqual(status["expiring_soon"], 1)
        self.assertEqual(status["expired"], 0)


class TestCustomModelsService(unittest.TestCase):
    """T3: CustomModelsService 高层 API"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.db_path = Path(self.tmpdir) / "test_service.db"
        from app.services.custom_models import models_store
        # 重置 cipher 以使用新 tmpdir
        models_store.DEFAULT_DATA_DIR = Path(self.tmpdir)
        models_store._cipher_instance = None
        key_file = Path(self.tmpdir) / ".encryption_key"
        if key_file.exists():
            key_file.unlink()
        from app.services.custom_models.models_store import ModelsStore
        from app.services.custom_models.bearer_token_refresher import BearerTokenRefresher
        from app.services.custom_models.service import CustomModelsService
        # 创建共享 store
        self.store = ModelsStore(db_path=self.db_path)
        # 创建共享 refresher
        self.refresher = BearerTokenRefresher(store=self.store)
        # 重置 service 单例，手动注入 store + refresher
        CustomModelsService._instance = None
        self.service = CustomModelsService()
        self.service._store = self.store
        self.service._refresher = self.refresher

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_T3_01_list_all_models_includes_builtin(self):
        """T3-01: list_all_models 始终包含 3 个内置模型"""
        models = self.service.list_all_models()
        ids = {m["id"] for m in models}
        self.assertIn("sol", ids)
        self.assertIn("terra", ids)
        self.assertIn("luna", ids)

    def test_T3_02_list_all_models_includes_custom(self):
        """T3-02: 自定义 provider 的模型出现在 list_all_models 中"""
        p = self.service.create_provider(name="DS", type="openai", base_url="https://ds.com")
        self.service.create_model(provider_id=p.id, model_id="deepseek-chat", display_name="DS Chat")
        models = self.service.list_all_models()
        custom = [m for m in models if m.get("is_custom")]
        self.assertEqual(len(custom), 1)
        self.assertEqual(custom[0]["model_id"], "deepseek-chat")
        self.assertEqual(custom[0]["provider_name"], "DS")

    def test_T3_03_list_all_models_excludes_disabled(self):
        """T3-03: 禁用的 provider 的模型不会出现在列表中"""
        p = self.service.create_provider(name="DS", type="openai", base_url="https://ds.com")
        self.service.create_model(provider_id=p.id, model_id="m1", display_name="M1")
        self.service.update_provider(p.id, enabled=False)
        models = self.service.list_all_models()
        custom = [m for m in models if m.get("is_custom")]
        self.assertEqual(len(custom), 0)

    def test_T3_04_test_provider_returns_success(self):
        """T3-04: test_provider 返回成功响应"""
        import asyncio
        p = self.service.create_provider(name="Test", type="openai", base_url="https://t.com")
        result = asyncio.run(self.service.test_provider(p.id))
        self.assertTrue(result["success"])
        self.assertEqual(result["provider_name"], "Test")
        self.assertEqual(result["type"], "openai")
        self.assertGreater(result["latency_ms"], 0)

    def test_T3_05_test_provider_not_found(self):
        """T3-05: test_provider 不存在时返回失败"""
        import asyncio
        result = asyncio.run(self.service.test_provider("nonexistent"))
        self.assertFalse(result["success"])

    def test_T3_06_get_summary_structure(self):
        """T3-06: get_summary 返回正确结构"""
        p = self.service.create_provider(name="P", type="openai", base_url="https://p.com")
        self.service.create_model(provider_id=p.id, model_id="m1", display_name="M1")
        summary = self.service.get_summary()
        self.assertEqual(summary["total_providers"], 1)
        self.assertEqual(summary["total_models"], 1)
        self.assertEqual(summary["by_type"]["openai"], 1)
        self.assertEqual(summary["builtin_models"], 3)
        self.assertIn("refresh_status", summary)
        self.assertIn("background_running", summary["refresh_status"])

    def test_T3_07_get_summary_empty(self):
        """T3-07: 无 provider 时 summary 全 0"""
        summary = self.service.get_summary()
        self.assertEqual(summary["total_providers"], 0)
        self.assertEqual(summary["total_models"], 0)
        self.assertEqual(summary["by_type"], {})

    def test_T3_08_refresh_provider_token(self):
        """T3-08: refresh_provider_token 调用 refresher"""
        import asyncio
        p = self.service.create_provider(
            name="P", type="openai", base_url="https://p.com",
            refresh_token="rt-12345",
        )
        result = asyncio.run(self.service.refresh_provider_token(p.id))
        self.assertTrue(result.success)


class TestCustomModelsAPI(unittest.TestCase):
    """T4: API 端点契约（HTTP 端点可发现性测试）"""

    def setUp(self):
        from app.services.custom_models import models_store
        self.tmpdir = tempfile.mkdtemp()
        models_store.DEFAULT_DATA_DIR = Path(self.tmpdir)
        models_store._cipher_instance = None
        from app.api import custom_models as api_module
        self.api_module = api_module

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_T4_01_router_prefix(self):
        """T4-01: 路由前缀为 /api/custom-models"""
        self.assertEqual(self.api_module.router.prefix, "/api/custom-models")

    def test_T4_02_router_has_summary_route(self):
        """T4-02: 存在 /summary 路由"""
        paths = [r.path for r in self.api_module.router.routes]
        self.assertIn("/api/custom-models/summary", paths)

    def test_T4_03_router_has_status_route(self):
        """T4-03: 存在 /status 路由"""
        paths = [r.path for r in self.api_module.router.routes]
        self.assertIn("/api/custom-models/status", paths)

    def test_T4_04_router_has_providers_routes(self):
        """T4-04: 存在 /providers 系列路由"""
        paths = [r.path for r in self.api_module.router.routes]
        self.assertIn("/api/custom-models/providers", paths)
        # /providers/{id} 路径
        provider_id_routes = [p for p in paths if p.startswith("/api/custom-models/providers/")]
        self.assertGreater(len(provider_id_routes), 0)

    def test_T4_05_router_has_models_routes(self):
        """T4-05: 存在 /models 系列路由"""
        paths = [r.path for r in self.api_module.router.routes]
        self.assertIn("/api/custom-models/models", paths)
        self.assertIn("/api/custom-models/models/provider/{provider_id}", paths)

    def test_T4_06_request_models_have_required_fields(self):
        """T4-06: CreateProviderRequest 包含必填字段"""
        from app.api.custom_models import CreateProviderRequest
        fields = CreateProviderRequest.model_fields
        self.assertIn("name", fields)
        self.assertIn("type", fields)
        self.assertIn("base_url", fields)

    def test_T4_07_create_model_request_fields(self):
        """T4-07: CreateModelRequest 包含必填字段"""
        from app.api.custom_models import CreateModelRequest
        fields = CreateModelRequest.model_fields
        self.assertIn("provider_id", fields)
        self.assertIn("model_id", fields)
        self.assertIn("display_name", fields)
        self.assertIn("max_tokens", fields)
        self.assertIn("context_window", fields)


if __name__ == "__main__":
    unittest.main(verbosity=2)
