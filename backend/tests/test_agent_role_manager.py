"""
# ============================================================
# AgentRoleManager 服务测试
# Cycle 63 G63-02
# ====================================
# 覆盖：
#   1. 角色注册表（list/get/register/update/delete）
#   2. TOML 解析与加载
#   3. 实例 spawn / list / cancel / complete
#   4. 并发限制
#   5. 内置角色只读约束
# ====================================
"""

import sys
import tempfile
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))
# 同时将项目根目录加入路径（解决 cli_integration.executor 依赖）
PROJECT_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(PROJECT_ROOT))

from app.services.agent_role_manager import (
    AgentRoleManager,
    ConcurrencyLimitError,
    RoleAlreadyExistsError,
    RoleNotFoundError,
    RoleValidationError,
)


@pytest.fixture
def manager():
    return AgentRoleManager(storage_dir=None)


@pytest.fixture
def tmp_manager(tmp_path):
    return AgentRoleManager(storage_dir=str(tmp_path))


# ============================================================
# 角色注册表
# ============================================================


class TestBuiltinRoles:
    def test_4_builtin_roles_loaded(self, manager):
        roles = manager.list_roles()
        names = {r.name for r in roles}
        assert names == {"default", "worker", "explorer", "monitor"}
        for r in roles:
            assert r.builtin is True

    def test_get_builtin_role(self, manager):
        role = manager.get_role("default")
        assert role.name == "default"
        assert role.builtin is True

    def test_get_nonexistent_role(self, manager):
        with pytest.raises(RoleNotFoundError):
            manager.get_role("nonexistent")

    def test_delete_builtin_role_rejected(self, manager):
        with pytest.raises(RoleValidationError):
            manager.delete_role("default")


class TestCustomRoleRegistration:
    def test_register_custom_role(self, manager):
        from app.services.agent_role_models import AgentRole
        role = AgentRole(
            name="custom-reviewer",
            description="Custom PR reviewer",
            developer_instructions="Review code carefully.",
            nickname_candidates=["A1", "A2"],
            model="gpt-5.5",
            sandbox_mode="read-only",
        )
        registered = manager.register_role(role)
        assert registered.builtin is False
        assert registered.created_at > 0
        assert registered.updated_at > 0

    def test_register_duplicate_custom_role(self, manager):
        from app.services.agent_role_models import AgentRole
        role = AgentRole(
            name="custom-dup",
            description="Dup",
            developer_instructions="Dup",
        )
        manager.register_role(role)
        with pytest.raises(RoleAlreadyExistsError):
            manager.register_role(role)

    def test_register_with_invalid_name(self, manager):
        from app.services.agent_role_models import AgentRole
        with pytest.raises(Exception):  # Pydantic ValidationError
            AgentRole(name="Invalid-Name", description="x", developer_instructions="x")

    def test_register_builtin_override_rejected(self, manager):
        from app.services.agent_role_models import AgentRole
        role = AgentRole(
            name="default",
            description="x",
            developer_instructions="x",
        )
        with pytest.raises(RoleAlreadyExistsError):
            manager.register_role(role)

    def test_register_builtin_with_override(self, manager):
        from app.services.agent_role_models import AgentRole
        role = AgentRole(
            name="default",
            description="Overridden",
            developer_instructions="x",
        )
        registered = manager.register_role(role, override=True)
        assert registered.description == "Overridden"


class TestRoleUpdate:
    def test_update_custom_role(self, manager):
        from app.services.agent_role_models import AgentRole
        manager.register_role(AgentRole(name="upd", description="d1", developer_instructions="i1"))
        updated = manager.update_role("upd", description="d2", model="gpt-5.5")
        assert updated.description == "d2"
        assert updated.model == "gpt-5.5"

    def test_update_nonexistent(self, manager):
        with pytest.raises(RoleNotFoundError):
            manager.update_role("nonexistent", description="x")

    def test_update_builtin_only_allowed_fields(self, manager):
        # 允许 description
        updated = manager.update_role("default", description="Updated default")
        assert updated.description == "Updated default"
        # 不允许 model
        with pytest.raises(RoleValidationError):
            manager.update_role("default", model="gpt-5.5")

    def test_delete_custom_role(self, manager):
        from app.services.agent_role_models import AgentRole
        manager.register_role(AgentRole(name="to-del", description="x", developer_instructions="y"))
        assert manager.delete_role("to-del") is True
        with pytest.raises(RoleNotFoundError):
            manager.get_role("to-del")

    def test_delete_nonexistent(self, manager):
        assert manager.delete_role("nonexistent") is False


# ============================================================
# TOML 解析
# ============================================================


class TestTOMLParser:
    def test_parse_simple_toml(self, manager):
        toml_content = '''
[role]
name = "reviewer"
description = "PR reviewer"
developer_instructions = "Review code."
nickname_candidates = ["Atlas", "Delta"]
model = "gpt-5.5"
sandbox_mode = "read-only"
'''
        with tempfile.NamedTemporaryFile(mode="w", suffix=".toml", delete=False) as f:
            f.write(toml_content)
            toml_path = f.name
        try:
            role = manager.register_role_from_toml(toml_path)
            assert role.name == "reviewer"
            assert role.model == "gpt-5.5"
            assert role.sandbox_mode == "read-only"
            assert "Atlas" in role.nickname_candidates
        finally:
            Path(toml_path).unlink(missing_ok=True)

    def test_parse_multiline_string_toml(self, manager):
        toml_content = '''
[role]
name = "worker2"
description = "Worker agent"
developer_instructions = """
Multi-line
instructions.
"""
'''
        with tempfile.NamedTemporaryFile(mode="w", suffix=".toml", delete=False) as f:
            f.write(toml_content)
            toml_path = f.name
        try:
            role = manager.register_role_from_toml(toml_path)
            assert "Multi-line" in role.developer_instructions
        finally:
            Path(toml_path).unlink(missing_ok=True)

    def test_parse_invalid_toml(self, manager):
        toml_content = "this is not valid toml at all\n[[["
        with tempfile.NamedTemporaryFile(mode="w", suffix=".toml", delete=False) as f:
            f.write(toml_content)
            toml_path = f.name
        try:
            with pytest.raises(RoleValidationError):
                manager.load_role_from_toml(toml_path)
        finally:
            Path(toml_path).unlink(missing_ok=True)

    def test_parse_nonexistent_file(self, manager):
        with pytest.raises(RoleValidationError):
            manager.load_role_from_toml("/nonexistent/path.toml")

    def test_parse_toml_without_role_block(self, manager):
        toml_content = "foo = 1\n"
        with tempfile.NamedTemporaryFile(mode="w", suffix=".toml", delete=False) as f:
            f.write(toml_content)
            toml_path = f.name
        try:
            with pytest.raises(RoleValidationError):
                manager.load_role_from_toml(toml_path)
        finally:
            Path(toml_path).unlink(missing_ok=True)


# ============================================================
# 实例管理
# ============================================================


class TestInstanceSpawn:
    def test_spawn_instance(self, manager):
        inst = manager.spawn_instance("worker", "Test task")
        assert inst.agent_id.startswith("agent-")
        assert inst.role_name == "worker"
        assert inst.status == "running"
        assert inst.nickname in ["Builder", "Forge", "Hammer", "Wrench"]
        assert inst.task == "Test task"

    def test_spawn_with_custom_nickname(self, manager):
        inst = manager.spawn_instance("worker", "Test", nickname="MyNick")
        assert inst.nickname == "MyNick"

    def test_spawn_unknown_role(self, manager):
        with pytest.raises(RoleNotFoundError):
            manager.spawn_instance("unknown", "Test")

    def test_spawn_increments_concurrency(self, manager):
        m1 = manager.spawn_instance("worker", "t1")
        m2 = manager.spawn_instance("worker", "t2")
        stats = manager.get_stats()
        assert stats["running_instances"] == 2
        assert m1.agent_id != m2.agent_id


class TestInstanceList:
    def test_list_empty(self, manager):
        assert manager.list_instances() == []

    def test_list_filtered_by_role(self, manager):
        manager.spawn_instance("worker", "t1")
        manager.spawn_instance("explorer", "t2")
        worker_insts = manager.list_instances(role_name="worker")
        assert len(worker_insts) == 1
        assert worker_insts[0].role_name == "worker"

    def test_list_filtered_by_status(self, manager):
        inst = manager.spawn_instance("worker", "t1")
        running = manager.list_instances(status="running")
        assert len(running) == 1
        assert running[0].agent_id == inst.agent_id


class TestInstanceCancel:
    def test_cancel_instance(self, manager):
        inst = manager.spawn_instance("worker", "t1")
        cancelled = manager.cancel_instance(inst.agent_id)
        assert cancelled.status == "dead"
        assert cancelled.finished_at is not None

    def test_cancel_nonexistent(self, manager):
        with pytest.raises(Exception):
            manager.cancel_instance("agent-nonexistent")

    def test_cancel_decrements_concurrency(self, manager):
        inst = manager.spawn_instance("worker", "t1")
        assert manager.get_stats()["running_instances"] == 1
        manager.cancel_instance(inst.agent_id)
        assert manager.get_stats()["running_instances"] == 0


class TestConcurrencyLimit:
    def test_concurrency_limit_enforced(self, manager):
        manager._max_concurrency_per_role = 2
        manager.spawn_instance("worker", "t1")
        manager.spawn_instance("worker", "t2")
        with pytest.raises(ConcurrencyLimitError):
            manager.spawn_instance("worker", "t3")


class TestInstanceComplete:
    def test_complete_success(self, manager):
        inst = manager.spawn_instance("worker", "t1")
        completed = manager.complete_instance(inst.agent_id, "Result", success=True)
        assert completed.status == "idle"
        assert completed.result == "Result"
        assert manager.get_stats()["running_instances"] == 0

    def test_complete_failure(self, manager):
        inst = manager.spawn_instance("worker", "t1")
        completed = manager.complete_instance(inst.agent_id, "Err", success=False)
        assert completed.status == "failed"


# ============================================================
# 持久化
# ============================================================


class TestPersistence:
    def test_persist_and_reload(self, tmp_path):
        from app.services.agent_role_models import AgentRole
        m1 = AgentRoleManager(storage_dir=str(tmp_path))
        m1.register_role(AgentRole(name="custom-p", description="d", developer_instructions="i"))
        inst = m1.spawn_instance("custom-p", "task")

        # 创建新 manager 重新加载
        m2 = AgentRoleManager(storage_dir=str(tmp_path))
        assert m2.get_role("custom-p").description == "d"
        reloaded = m2.get_instance(inst.agent_id)
        assert reloaded.role_name == "custom-p"
        assert reloaded.task == "task"


# ============================================================
# 统计
# ============================================================


class TestStats:
    def test_initial_stats(self, manager):
        stats = manager.get_stats()
        assert stats["total_roles"] == 4  # 4 个内置
        assert stats["builtin_roles"] == 4
        assert stats["custom_roles"] == 0
        assert stats["running_instances"] == 0

    def test_stats_after_register(self, manager):
        from app.services.agent_role_models import AgentRole
        manager.register_role(AgentRole(name="x", description="d", developer_instructions="i"))
        stats = manager.get_stats()
        assert stats["custom_roles"] == 1
        assert stats["total_roles"] == 5
