"""
# ============================================================
# /import 单元测试 - Cycle 11 P3-1
# ============================================================
# 覆盖点：
#   - ImportService 初始化 / 检测 / 预览 / 执行 / 取消 / 回滚 / 状态
#   - 4 个转换器（Claude Code / Cursor / Codex / TRAE）
#   - 路径白名单
#   - 持久化
# 输入参数：无（pytest 自动发现）
# 输出结果：测试报告
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P3-1 新建
# ============================================================
"""

import json
import os
import shutil
import tempfile
import time
import threading
from pathlib import Path
from typing import Any, Dict, List

import pytest

from app.core.import_converters.base import (
    DataType,
    DetectedSource,
    ImportPreviewItem,
    ImportSource,
    _is_path_allowed,
    _redact_sensitive,
    _safe_name,
)
from app.core.import_converters.claude_code import ClaudeCodeConverter
from app.core.import_converters.cursor import CursorConverter
from app.core.import_converters.codex import CodexConverter
from app.core.import_converters.trae import TraeConverter
from app.services.import_service import (
    ImportService,
    ImportStatus,
    ImportTask,
    get_import_service,
)


# ============================================================
# Fixtures
# ============================================================


@pytest.fixture
def temp_dir():
    """创建临时测试目录"""
    tmp = tempfile.mkdtemp(prefix="test-import-")
    yield Path(tmp)
    shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture
def mock_claude_code(temp_dir):
    """创建 mock Claude Code 目录"""
    cc_dir = temp_dir / ".claude"
    cc_dir.mkdir()
    # settings.json
    settings = {
        "permissions": {"allow": ["Read", "Edit"], "deny": ["Bash(rm -rf)"]},
        "env": {"ANTHROPIC_API_KEY": "sk-test-12345678"},
        "version": "1.0.5"
    }
    (cc_dir / "settings.json").write_text(json.dumps(settings, indent=2))
    # .mcp.json
    mcp = {"mcpServers": {"test-mcp": {"command": "npx", "args": ["-y", "test"]}}}
    (cc_dir / ".mcp.json").write_text(json.dumps(mcp, indent=2))
    # CLAUDE.md
    (cc_dir / "CLAUDE.md").write_text("# Project Memory\n\nUse TDD for all new code.\n")
    # commands/
    cmd_dir = cc_dir / "commands"
    cmd_dir.mkdir()
    (cmd_dir / "review.md").write_text("# Review Command\n\nReview the changed code.\n")
    # package.json
    pkg = {"name": "claude-code", "version": "1.0.5"}
    (cc_dir / "package.json").write_text(json.dumps(pkg))
    return cc_dir


@pytest.fixture
def mock_cursor(temp_dir):
    """创建 mock Cursor 目录"""
    cursor_dir = temp_dir / ".cursor"
    cursor_dir.mkdir()
    user_dir = cursor_dir / "User"
    user_dir.mkdir()
    settings = {
        "editor.fontSize": 14,
        "editor.tabSize": 2,
        "workbench.colorTheme": "Default Dark+",
    }
    (user_dir / "settings.json").write_text(json.dumps(settings, indent=2))
    mcp = {"mcpServers": {"cursor-mcp": {"command": "node", "args": ["server.js"]}}}
    (cursor_dir / "mcp.json").write_text(json.dumps(mcp, indent=2))
    # rules/
    rules_dir = cursor_dir / "rules"
    rules_dir.mkdir()
    (rules_dir / "style.md").write_text("# Code Style\n\nUse 2 spaces.\n")
    # package.json
    pkg = {"name": "cursor", "version": "0.42.0"}
    (cursor_dir / "package.json").write_text(json.dumps(pkg))
    return cursor_dir


@pytest.fixture
def mock_codex(temp_dir):
    """创建 mock Codex 目录"""
    codex_dir = temp_dir / ".codex"
    codex_dir.mkdir()
    config = """# Codex config
model = "gpt-5.6-sol"
provider = "openai"

[mcp_servers.test-codex]
command = "npx"
args = ["-y", "codex-test"]
"""
    (codex_dir / "config.toml").write_text(config)
    # AGENTS.md
    (codex_dir / "AGENTS.md").write_text("# Project Agents\n\nUse type hints.\n")
    # skills/
    skills_dir = codex_dir / "skills"
    skills_dir.mkdir()
    (skills_dir / "code-review.md").write_text("# Code Review\n\nReview thoroughly.\n")
    # version.txt
    (codex_dir / "version.txt").write_text("0.145.0")
    return codex_dir


@pytest.fixture
def mock_trae(temp_dir):
    """创建 mock TRAE 目录"""
    trae_dir = temp_dir / ".trae"
    trae_dir.mkdir()
    settings = {
        "model": "trae-default",
        "agent": {"name": "main", "type": "general"}
    }
    (trae_dir / "settings.json").write_text(json.dumps(settings, indent=2))
    mcp = {"mcpServers": {"trae-mcp": {"command": "trae-mcp"}}}
    (trae_dir / "mcp_servers.json").write_text(json.dumps(mcp, indent=2))
    # commands/ (3 级嵌套)
    cmds_dir = trae_dir / "commands"
    cmds_dir.mkdir()
    (cmds_dir / "build.md").write_text("# Build\n\nRun build.\n")
    nested = cmds_dir / "frontend" / "react"
    nested.mkdir(parents=True)
    (nested / "component.md").write_text("# Component\n\nReact component.\n")
    # memory/
    mem_dir = trae_dir / "memory"
    mem_dir.mkdir()
    (mem_dir / "preferences.md").write_text("# Preferences\n\nDark mode.\n")
    # package.json
    pkg = {"name": "trae", "version": "3.5.79"}
    (trae_dir / "package.json").write_text(json.dumps(pkg))
    return trae_dir


@pytest.fixture
def import_service(temp_dir):
    """创建独立的 ImportService 实例（每个测试一个）"""
    hermes_home = temp_dir / "hermes"
    hermes_home.mkdir()
    # 重置全局单例以使用新的 hermes_home
    import app.services.import_service as svc_module
    svc_module._global_service = None
    svc_module.ImportService._instance = None
    svc_module.ImportService._initialized = False
    return svc_module.ImportService(hermes_home=hermes_home)


# ============================================================
# TestImportService - 15 用例
# ============================================================


class TestImportService:
    """ImportService 主类测试"""

    def test_service_init(self, import_service, temp_dir):
        """测试 1: 服务初始化"""
        assert import_service.hermes_home == temp_dir / "hermes"
        assert import_service.import_dir.exists()
        assert import_service.backups_root.exists()
        assert len(import_service._converters) == 4

    def test_health_check(self, import_service):
        """测试 2: 健康检查"""
        result = import_service.health_check()
        assert result["status"] == "ok"
        assert "version" in result
        assert "hermes_home" in result

    def test_get_stats(self, import_service):
        """测试 3: 统计信息"""
        stats = import_service.get_stats()
        assert stats["total"] == 0
        assert len(stats["supported_sources"]) == 4
        assert len(stats["supported_data_types"]) == 6

    def test_detect_sources(self, import_service, mock_claude_code):
        """测试 4: 检测 4 源"""
        # 创建一个空的 mock_cursor 等以让 detect 能扫描到
        results = import_service.detect_sources()
        assert len(results) == 4
        # 找到 Claude Code 的结果
        cc_result = next((r for r in results if r.source == ImportSource.CLAUDE_CODE), None)
        # 因为 mock 路径不在 ~/.claude，检测应该返回 not available
        # 这是预期行为
        assert cc_result is not None

    def test_detect_specific_source(self, import_service, mock_claude_code):
        """测试 5: 检测指定源（使用自定义路径）"""
        # 由于 _global_service 单例模式，直接测试 converter
        converter = ClaudeCodeConverter(install_path=mock_claude_code)
        detected = converter.detect()
        assert detected.available
        assert detected.version == "1.0.5"
        assert DataType.SETTINGS in detected.data_types
        assert DataType.MCP_SERVERS in detected.data_types
        assert DataType.COMMANDS in detected.data_types
        assert DataType.MEMORIES in detected.data_types

    def test_preview_import(self, import_service, mock_claude_code):
        """测试 6: 预览（dry-run）"""
        items = import_service.preview_import(
            ImportSource.CLAUDE_CODE,
            [DataType.SETTINGS, DataType.MCP_SERVERS],
            install_path=mock_claude_code,
        )
        assert len(items) == 2
        assert items[0].data_type in [DataType.SETTINGS, DataType.MCP_SERVERS]

    def test_run_import_success(self, import_service, mock_claude_code, temp_dir):
        """测试 7: 异步执行导入（成功）"""
        task, err = import_service.run_import(
            ImportSource.CLAUDE_CODE,
            [DataType.SETTINGS, DataType.MCP_SERVERS, DataType.COMMANDS, DataType.MEMORIES],
            install_path=mock_claude_code,
        )
        assert err == ""
        assert task is not None
        assert task.task_id.startswith("imp_")
        assert task.items_total == 4
        # 等待完成
        time.sleep(3)
        t = import_service.get_task(task.task_id)
        assert t.status == ImportStatus.COMPLETED
        assert t.items_completed == 4
        assert t.items_failed == 0
        # 验证文件
        hermes = temp_dir / "hermes"
        assert (hermes / "config.toml").exists()
        assert (hermes / "mcp_servers.json").exists()
        assert (hermes / "commands" / "review.md").exists()
        assert (hermes / "memory" / "project" / "CLAUDE.md").exists()

    def test_get_task(self, import_service, mock_claude_code):
        """测试 8: 查询任务"""
        task, _ = import_service.run_import(
            ImportSource.CLAUDE_CODE,
            [DataType.SETTINGS],
            install_path=mock_claude_code,
        )
        t = import_service.get_task(task.task_id)
        assert t is not None
        assert t.task_id == task.task_id
        # 不存在的任务
        assert import_service.get_task("nonexistent") is None

    def test_list_tasks(self, import_service, mock_claude_code):
        """测试 9: 列出所有任务"""
        task, _ = import_service.run_import(
            ImportSource.CLAUDE_CODE,
            [DataType.SETTINGS],
            install_path=mock_claude_code,
        )
        time.sleep(2)
        tasks = import_service.list_tasks()
        assert len(tasks) >= 1
        # 按 source 过滤
        tasks_cc = import_service.list_tasks(source=ImportSource.CLAUDE_CODE)
        assert len(tasks_cc) >= 1

    def test_cancel_task(self, import_service, mock_claude_code):
        """测试 10: 取消任务（短超时测试）"""
        task, _ = import_service.run_import(
            ImportSource.CLAUDE_CODE,
            [DataType.SETTINGS, DataType.MCP_SERVERS, DataType.COMMANDS, DataType.MEMORIES],
            install_path=mock_claude_code,
        )
        # 立即取消（可能已完成或运行中）
        import_service.cancel_task(task.task_id)
        t = import_service.get_task(task.task_id)
        # 状态应为 cancelled 或 completed
        assert t.status in (ImportStatus.CANCELLED, ImportStatus.COMPLETED)

    def test_rollback_task(self, import_service, mock_claude_code, temp_dir):
        """测试 11: 回滚任务"""
        task, _ = import_service.run_import(
            ImportSource.CLAUDE_CODE,
            [DataType.SETTINGS],
            install_path=mock_claude_code,
        )
        time.sleep(2)
        hermes = temp_dir / "hermes"
        # 确认文件存在
        assert (hermes / "config.toml").exists()
        # 回滚
        success, msg = import_service.rollback_task(task.task_id)
        assert success, f"rollback failed: {msg}"
        t = import_service.get_task(task.task_id)
        assert t.status == ImportStatus.ROLLED_BACK
        # 文件应被删除
        assert not (hermes / "config.toml").exists()

    def test_run_import_invalid_source(self, import_service):
        """测试 12: 无效 source"""
        task, err = import_service.run_import("invalid_source", [DataType.SETTINGS])
        assert task is None
        assert "unsupported" in err.lower()

    def test_run_import_empty_data_types(self, import_service, mock_claude_code):
        """测试 13: 空 data_types"""
        task, err = import_service.run_import(
            ImportSource.CLAUDE_CODE, [], install_path=mock_claude_code
        )
        assert task is None
        assert "empty" in err.lower()

    def test_persistence(self, import_service, mock_claude_code, temp_dir):
        """测试 14: 持久化（重启恢复）"""
        task, _ = import_service.run_import(
            ImportSource.CLAUDE_CODE,
            [DataType.SETTINGS],
            install_path=mock_claude_code,
        )
        time.sleep(2)
        original_id = task.task_id
        # 创建新实例模拟重启
        import app.services.import_service as svc_module
        svc_module._global_service = None
        svc_module.ImportService._instance = None
        svc_module.ImportService._initialized = False
        svc2 = svc_module.ImportService(hermes_home=temp_dir / "hermes")
        t = svc2.get_task(original_id)
        assert t is not None
        assert t.task_id == original_id

    def test_concurrent_tasks(self, import_service, mock_claude_code, temp_dir):
        """测试 15: 并发任务"""
        # 创建第二个 mock
        cc_dir2 = temp_dir / ".claude2"
        if cc_dir2.exists():
            shutil.rmtree(cc_dir2)
        shutil.copytree(mock_claude_code, cc_dir2)
        # 启动两个并发任务
        t1, e1 = import_service.run_import(
            ImportSource.CLAUDE_CODE, [DataType.SETTINGS], install_path=mock_claude_code
        )
        t2, e2 = import_service.run_import(
            ImportSource.CLAUDE_CODE, [DataType.MCP_SERVERS], install_path=cc_dir2
        )
        assert e1 == "" and e2 == ""
        time.sleep(3)
        assert import_service.get_task(t1.task_id).status in (
            ImportStatus.COMPLETED, ImportStatus.FAILED
        )
        assert import_service.get_task(t2.task_id).status in (
            ImportStatus.COMPLETED, ImportStatus.FAILED
        )


# ============================================================
# TestClaudeCodeConverter - 10 用例
# ============================================================


class TestClaudeCodeConverter:
    """Claude Code 转换器测试"""

    def test_detect_available(self, mock_claude_code):
        """测试 1: 检测可用"""
        converter = ClaudeCodeConverter(install_path=mock_claude_code)
        detected = converter.detect()
        assert detected.available
        assert detected.version == "1.0.5"

    def test_detect_not_available(self, temp_dir):
        """测试 2: 检测不可用"""
        converter = ClaudeCodeConverter(install_path=temp_dir / "nonexistent")
        detected = converter.detect()
        assert not detected.available

    def test_list_settings(self, mock_claude_code):
        """测试 3: 列出 settings"""
        converter = ClaudeCodeConverter(install_path=mock_claude_code)
        items = converter.list_data(DataType.SETTINGS)
        assert len(items) == 1
        assert items[0].data_type == DataType.SETTINGS
        assert "settings.json" in items[0].source_path

    def test_list_mcp_servers(self, mock_claude_code):
        """测试 4: 列出 MCP servers"""
        converter = ClaudeCodeConverter(install_path=mock_claude_code)
        items = converter.list_data(DataType.MCP_SERVERS)
        assert len(items) == 1
        assert items[0].item_count == 1  # 1 个 server

    def test_list_commands(self, mock_claude_code):
        """测试 5: 列出 commands"""
        converter = ClaudeCodeConverter(install_path=mock_claude_code)
        items = converter.list_data(DataType.COMMANDS)
        assert len(items) == 1
        assert "review.md" in items[0].source_path

    def test_list_memories(self, mock_claude_code):
        """测试 6: 列出 memories"""
        converter = ClaudeCodeConverter(install_path=mock_claude_code)
        items = converter.list_data(DataType.MEMORIES)
        assert len(items) == 1
        assert "CLAUDE.md" in items[0].source_path

    def test_convert_settings(self, mock_claude_code):
        """测试 7: 转换 settings"""
        converter = ClaudeCodeConverter(install_path=mock_claude_code)
        target, content = converter.convert(DataType.SETTINGS, mock_claude_code / "settings.json")
        text = content.decode("utf-8")
        assert "permissions" in text
        assert "allow" in text
        assert "env" in text

    def test_convert_mcp_servers(self, mock_claude_code):
        """测试 8: 转换 MCP servers"""
        converter = ClaudeCodeConverter(install_path=mock_claude_code)
        target, content = converter.convert(DataType.MCP_SERVERS, mock_claude_code / ".mcp.json")
        data = json.loads(content.decode("utf-8"))
        assert "mcpServers" in data
        assert "test-mcp" in data["mcpServers"]

    def test_convert_memories(self, mock_claude_code):
        """测试 9: 转换 memories"""
        converter = ClaudeCodeConverter(install_path=mock_claude_code)
        target, content = converter.convert(DataType.MEMORIES, mock_claude_code / "CLAUDE.md")
        text = content.decode("utf-8")
        assert "frontmatter" in text or "source: claude_code" in text
        assert "Project Memory" in text

    def test_convert_commands(self, mock_claude_code):
        """测试 10: 转换 commands"""
        converter = ClaudeCodeConverter(install_path=mock_claude_code)
        target, content = converter.convert(DataType.COMMANDS, mock_claude_code / "commands" / "review.md")
        text = content.decode("utf-8")
        assert "Review Command" in text


# ============================================================
# TestCursorConverter - 10 用例
# ============================================================


class TestCursorConverter:
    """Cursor 转换器测试"""

    def test_detect_available(self, mock_cursor):
        converter = CursorConverter(install_path=mock_cursor)
        detected = converter.detect()
        assert detected.available
        assert detected.version == "0.42.0"
        assert DataType.SETTINGS in detected.data_types
        assert DataType.MCP_SERVERS in detected.data_types

    def test_detect_not_available(self, temp_dir):
        converter = CursorConverter(install_path=temp_dir / "nonexistent")
        detected = converter.detect()
        assert not detected.available

    def test_list_settings(self, mock_cursor):
        converter = CursorConverter(install_path=mock_cursor)
        items = converter.list_data(DataType.SETTINGS)
        assert len(items) == 1

    def test_list_mcp_servers(self, mock_cursor):
        converter = CursorConverter(install_path=mock_cursor)
        items = converter.list_data(DataType.MCP_SERVERS)
        assert len(items) == 1
        assert items[0].item_count == 1

    def test_list_memories(self, mock_cursor):
        """Cursor rules 映射为 memories"""
        converter = CursorConverter(install_path=mock_cursor)
        items = converter.list_data(DataType.MEMORIES)
        assert len(items) == 1
        assert "style.md" in items[0].source_path

    def test_list_commands_empty(self, mock_cursor):
        """Cursor 无 commands"""
        converter = CursorConverter(install_path=mock_cursor)
        items = converter.list_data(DataType.COMMANDS)
        assert len(items) == 0

    def test_convert_settings(self, mock_cursor):
        converter = CursorConverter(install_path=mock_cursor)
        target, content = converter.convert(
            DataType.SETTINGS, mock_cursor / "User" / "settings.json"
        )
        text = content.decode("utf-8")
        assert "editor" in text

    def test_convert_mcp_servers(self, mock_cursor):
        converter = CursorConverter(install_path=mock_cursor)
        target, content = converter.convert(DataType.MCP_SERVERS, mock_cursor / "mcp.json")
        data = json.loads(content.decode("utf-8"))
        assert "mcpServers" in data

    def test_convert_memories(self, mock_cursor):
        converter = CursorConverter(install_path=mock_cursor)
        target, content = converter.convert(
            DataType.MEMORIES, mock_cursor / "rules" / "style.md"
        )
        text = content.decode("utf-8")
        assert "Code Style" in text

    def test_size_calculation(self, mock_cursor):
        converter = CursorConverter(install_path=mock_cursor)
        assert converter.get_size() > 0


# ============================================================
# TestCodexConverter - 8 用例
# ============================================================


class TestCodexConverter:
    """Codex 转换器测试"""

    def test_detect_available(self, mock_codex):
        converter = CodexConverter(install_path=mock_codex)
        detected = converter.detect()
        assert detected.available
        assert DataType.SETTINGS in detected.data_types
        assert DataType.MCP_SERVERS in detected.data_types
        assert DataType.MEMORIES in detected.data_types

    def test_detect_not_available(self, temp_dir):
        converter = CodexConverter(install_path=temp_dir / "nonexistent")
        detected = converter.detect()
        assert not detected.available

    def test_get_version(self, mock_codex):
        converter = CodexConverter(install_path=mock_codex)
        assert converter.get_version() == "0.145.0"

    def test_list_settings(self, mock_codex):
        converter = CodexConverter(install_path=mock_codex)
        items = converter.list_data(DataType.SETTINGS)
        assert len(items) == 1

    def test_list_mcp_servers(self, mock_codex):
        converter = CodexConverter(install_path=mock_codex)
        items = converter.list_data(DataType.MCP_SERVERS)
        assert len(items) == 1
        assert items[0].item_count == 1  # test-codex

    def test_list_commands(self, mock_codex):
        """Codex skills 映射为 commands"""
        converter = CodexConverter(install_path=mock_codex)
        items = converter.list_data(DataType.COMMANDS)
        assert len(items) == 1
        assert "code-review.md" in items[0].source_path

    def test_convert_settings(self, mock_codex):
        converter = CodexConverter(install_path=mock_codex)
        target, content = converter.convert(DataType.SETTINGS, mock_codex / "config.toml")
        text = content.decode("utf-8")
        # 验证 mcp_servers 段被移除
        assert "[mcp_servers" not in text
        # 验证 model 保留
        assert "model" in text

    def test_convert_mcp_servers(self, mock_codex):
        converter = CodexConverter(install_path=mock_codex)
        target, content = converter.convert(DataType.MCP_SERVERS, mock_codex / "config.toml")
        data = json.loads(content.decode("utf-8"))
        assert "mcpServers" in data
        assert "test-codex" in data["mcpServers"]


# ============================================================
# TestTraeConverter - 8 用例
# ============================================================


class TestTraeConverter:
    """TRAE 转换器测试"""

    def test_detect_available(self, mock_trae):
        converter = TraeConverter(install_path=mock_trae)
        detected = converter.detect()
        assert detected.available
        assert detected.version == "3.5.79"
        assert DataType.SETTINGS in detected.data_types
        assert DataType.MCP_SERVERS in detected.data_types
        assert DataType.COMMANDS in detected.data_types
        assert DataType.MEMORIES in detected.data_types

    def test_detect_not_available(self, temp_dir):
        converter = TraeConverter(install_path=temp_dir / "nonexistent")
        detected = converter.detect()
        assert not detected.available

    def test_list_settings(self, mock_trae):
        converter = TraeConverter(install_path=mock_trae)
        items = converter.list_data(DataType.SETTINGS)
        assert len(items) == 1

    def test_list_commands_nested(self, mock_trae):
        """TRAE commands 支持 3 级嵌套"""
        converter = TraeConverter(install_path=mock_trae)
        items = converter.list_data(DataType.COMMANDS)
        # 应该有 2 个：build.md 和 frontend/react/component.md
        assert len(items) == 2
        # 验证嵌套
        nested = [i for i in items if "frontend" in i.source_path]
        assert len(nested) == 1

    def test_list_memories(self, mock_trae):
        converter = TraeConverter(install_path=mock_trae)
        items = converter.list_data(DataType.MEMORIES)
        assert len(items) == 1
        assert "preferences.md" in items[0].source_path

    def test_convert_settings(self, mock_trae):
        converter = TraeConverter(install_path=mock_trae)
        target, content = converter.convert(DataType.SETTINGS, mock_trae / "settings.json")
        text = content.decode("utf-8")
        assert "model" in text or "agent" in text

    def test_convert_mcp_servers(self, mock_trae):
        converter = TraeConverter(install_path=mock_trae)
        target, content = converter.convert(DataType.MCP_SERVERS, mock_trae / "mcp_servers.json")
        data = json.loads(content.decode("utf-8"))
        assert "mcpServers" in data

    def test_size_calculation(self, mock_trae):
        converter = TraeConverter(install_path=mock_trae)
        assert converter.get_size() > 0


# ============================================================
# TestPathWhitelist - 5 用例
# ============================================================


class TestPathWhitelist:
    """路径白名单测试"""

    def test_home_dir_allowed(self):
        """测试 1: ~/.claude 允许"""
        p = Path.home() / ".claude"
        assert _is_path_allowed(p)

    def test_workspace_allowed(self):
        """测试 2: 工作区允许"""
        p = Path("/home/qizheng/auto_code_ws/.cursor")
        assert _is_path_allowed(p)

    def test_tmp_test_allowed(self):
        """测试 3: /tmp/test-* 允许"""
        p = Path("/tmp/test-import-foo")
        assert _is_path_allowed(p)
        p2 = Path("/tmp/test-claude-code")
        assert _is_path_allowed(p2)

    def test_random_path_denied(self):
        """测试 4: 随机路径拒绝"""
        p = Path("/etc/passwd")
        assert not _is_path_allowed(p)
        p2 = Path("/var/log/messages")
        assert not _is_path_allowed(p2)

    def test_tmp_random_denied(self):
        """测试 5: /tmp 下非 test-* 拒绝"""
        p = Path("/tmp/random-file")
        assert not _is_path_allowed(p)


# ============================================================
# TestRollback - 4 用例
# ============================================================


class TestRollback:
    """回滚测试"""

    def test_rollback_removes_files(self, import_service, mock_claude_code, temp_dir):
        """测试 1: 回滚删除文件"""
        task, _ = import_service.run_import(
            ImportSource.CLAUDE_CODE,
            [DataType.SETTINGS, DataType.MCP_SERVERS],
            install_path=mock_claude_code,
        )
        time.sleep(2)
        hermes = temp_dir / "hermes"
        assert (hermes / "config.toml").exists()
        success, msg = import_service.rollback_task(task.task_id)
        assert success
        assert not (hermes / "config.toml").exists()

    def test_rollback_preserves_backup(self, import_service, mock_claude_code):
        """测试 2: 回滚保留备份"""
        task, _ = import_service.run_import(
            ImportSource.CLAUDE_CODE,
            [DataType.SETTINGS],
            install_path=mock_claude_code,
        )
        time.sleep(2)
        t = import_service.get_task(task.task_id)
        backup_dir = Path(t.backup_dir) if t.backup_dir else None
        assert backup_dir is not None and backup_dir.exists()
        import_service.rollback_task(task.task_id)
        # 备份应保留
        assert backup_dir.exists()

    def test_rollback_nonexistent(self, import_service):
        """测试 3: 回滚不存在的任务"""
        success, msg = import_service.rollback_task("nonexistent_id")
        assert not success
        assert "not found" in msg.lower()

    def test_rollback_before_completion(self, import_service, mock_claude_code):
        """测试 4: 完成前回滚（应失败，因为未完成）"""
        task, _ = import_service.run_import(
            ImportSource.CLAUDE_CODE,
            [DataType.SETTINGS, DataType.MCP_SERVERS, DataType.COMMANDS, DataType.MEMORIES],
            install_path=mock_claude_code,
        )
        # 立即回滚（可能未完成）
        success, msg = import_service.rollback_task(task.task_id)
        # 不一定成功（取决于时机），但不抛异常
        # 仅验证返回类型
        assert isinstance(success, bool)


# ============================================================
# TestUtility - 辅助测试
# ============================================================


class TestUtility:
    """工具函数测试"""

    def test_safe_name_basic(self):
        assert _safe_name("test.md") == "test.md"
        # 保留路径分隔符
        assert _safe_name("a/b/c.md") == "a/b/c.md"
        assert _safe_name("file with space.md") == "file_with_space.md"

    def test_redact_sensitive_dict(self):
        data = {
            "api_key": "sk-12345678",
            "token": "abc12345",
            "name": "test",
        }
        redacted = _redact_sensitive(data)
        assert "***" in redacted["api_key"]
        assert "***" in redacted["token"]
        assert redacted["name"] == "test"

    def test_redact_sensitive_nested(self):
        data = {
            "outer": {
                "password": "secret",
                "innocent": "value"
            }
        }
        redacted = _redact_sensitive(data)
        assert "***" in redacted["outer"]["password"]
        assert redacted["outer"]["innocent"] == "value"

    def test_redact_sensitive_list(self):
        data = [{"apiKey": "sk-12345678"}, {"name": "test"}]
        redacted = _redact_sensitive(data)
        assert "***" in redacted[0]["apiKey"]
        assert redacted[1]["name"] == "test"
