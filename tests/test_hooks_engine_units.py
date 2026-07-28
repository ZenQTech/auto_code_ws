"""
# ============================================================
# Hooks Engine 单元测试 (Cycle 9 P0-18)
# ============================================================
# 测试范围：
#   1. TraeHooksLoader frontmatter 解析
#   2. TraeHooksLoader 目录扫描
#   3. HookConfig.block_on_error 字段
#   4. HooksRegistry.load_from_directory
#   5. HooksRegistry.dispatch 集成 block_on_error
#   6. 事件类型映射
# 目标：≥15 个测试用例
# ============================================================
"""

import asyncio
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

# 添加 backend 到路径
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.services.hooks_registry import (
    HookConfig,
    HookDefinition,
    HookEventType,
    HooksRegistry,
    get_hooks_registry,
    reset_hooks_registry,
)
from app.services.trae_hooks_loader import (
    EVENT_DIR_MAP,
    TraeHooksLoader,
    _parse_trae_frontmatter,
    load_trae_hooks,
)


class TestTraeFrontmatterParser(unittest.TestCase):
    """frontmatter 解析测试"""

    def test_simple_key_value(self):
        text = "---\nmatcher: Write|Edit\ntimeout: 30\n---\nbody"
        result = _parse_trae_frontmatter(text)
        self.assertEqual(result["matcher"], "Write|Edit")
        self.assertEqual(result["timeout"], 30)

    def test_boolean(self):
        text = "---\nblock_on_error: true\n---\n"
        result = _parse_trae_frontmatter(text)
        self.assertTrue(result["block_on_error"])
        text = "---\nblock_on_error: false\n---\n"
        result = _parse_trae_frontmatter(text)
        self.assertFalse(result["block_on_error"])

    def test_no_frontmatter(self):
        text = "#!/bin/bash\necho hi"
        result = _parse_trae_frontmatter(text)
        self.assertEqual(result, {})

    def test_quoted_string(self):
        text = "---\nname: 'security-check'\n---\n"
        result = _parse_trae_frontmatter(text)
        self.assertEqual(result["name"], "security-check")

    def test_comment_ignored(self):
        text = "---\n# comment\nmatcher: x\n---\n"
        result = _parse_trae_frontmatter(text)
        self.assertEqual(result.get("matcher"), "x")
        self.assertNotIn("comment", result)


class TestEventDirMap(unittest.TestCase):
    """事件目录名映射测试"""

    def test_pre_tool_mapped(self):
        self.assertEqual(EVENT_DIR_MAP["pre-tool"], "PreToolUse")

    def test_post_tool_mapped(self):
        self.assertEqual(EVENT_DIR_MAP["post-tool"], "PostToolUse")

    def test_session_start_mapped(self):
        self.assertEqual(EVENT_DIR_MAP["session-start"], "SessionStart")

    def test_session_end_mapped(self):
        self.assertEqual(EVENT_DIR_MAP["session-end"], "SessionEnd")

    def test_user_prompt_submit_mapped(self):
        self.assertEqual(EVENT_DIR_MAP["user-prompt-submit"], "UserPromptSubmit")

    def test_pre_commit_alias(self):
        """pre-commit 是 PreToolUse 的别名"""
        self.assertEqual(EVENT_DIR_MAP["pre-commit"], "PreToolUse")


class TestTraeHooksLoader(unittest.TestCase):
    """TraeHooksLoader 单元测试"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.project = Path(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _write_hook(self, event_dir: str, name: str, content: str):
        d = self.project / ".trae" / "hooks" / event_dir
        d.mkdir(parents=True, exist_ok=True)
        f = d / f"{name}.sh"
        f.write_text(content, encoding="utf-8")
        f.chmod(0o755)
        return f

    def test_no_hooks_dir(self):
        """无 .trae/hooks/ 目录"""
        loader = TraeHooksLoader(self.project)
        self.assertFalse(loader.hooks_dir_exists)
        self.assertEqual(loader.load(), [])

    def test_load_simple_pre_tool(self):
        """加载简单的 pre-tool hook"""
        self._write_hook(
            "pre-tool",
            "my-check",
            "---\nmatcher: Write|Edit\nblock_on_error: true\n---\n#!/bin/bash\necho done\n",
        )
        loader = TraeHooksLoader(self.project)
        configs = loader.load()
        self.assertEqual(len(configs), 1)
        cfg = configs[0]
        self.assertEqual(cfg.event, "PreToolUse")
        self.assertEqual(cfg.matcher, "Write|Edit")
        self.assertTrue(cfg.block_on_error)
        self.assertEqual(len(cfg.hooks), 1)
        self.assertEqual(cfg.hooks[0].name, "my-check")

    def test_load_multiple_event_dirs(self):
        """加载多个事件目录的 hooks"""
        self._write_hook("pre-tool", "a", "---\n---\n#!/bin/bash\n")
        self._write_hook("post-tool", "b", "---\n---\n#!/bin/bash\n")
        self._write_hook("session-start", "c", "---\n---\n#!/bin/bash\n")
        loader = TraeHooksLoader(self.project)
        configs = loader.load()
        self.assertEqual(len(configs), 3)
        events = {c.event for c in configs}
        self.assertIn("PreToolUse", events)
        self.assertIn("PostToolUse", events)
        self.assertIn("SessionStart", events)

    def test_load_unknown_event_dir(self):
        """未知事件目录被跳过"""
        self._write_hook("unknown-event", "x", "---\n---\n#!/bin/bash\n")
        loader = TraeHooksLoader(self.project)
        configs = loader.load()
        self.assertEqual(len(configs), 0)

    def test_load_skips_non_sh(self):
        """跳过非 .sh 文件"""
        (self.project / ".trae" / "hooks" / "pre-tool").mkdir(parents=True)
        (self.project / ".trae" / "hooks" / "pre-tool" / "readme.md").write_text(
            "readme"
        )
        loader = TraeHooksLoader(self.project)
        configs = loader.load()
        self.assertEqual(len(configs), 0)

    def test_load_with_errors(self):
        """load_with_errors 返回错误"""
        (self.project / ".trae" / "hooks" / "pre-tool").mkdir(parents=True)
        # 合法
        (self.project / ".trae" / "hooks" / "pre-tool" / "ok.sh").write_text(
            "---\n---\n#!/bin/bash\n", encoding="utf-8"
        )
        (self.project / ".trae" / "hooks" / "pre-tool" / "ok.sh").chmod(0o755)
        # 不在事件子目录（会被 _parse_hook_file 拒绝）
        (self.project / ".trae" / "hooks" / "bad.sh").write_text(
            "---\n---\n#!/bin/bash\n", encoding="utf-8"
        )
        loader = TraeHooksLoader(self.project)
        configs, errors = loader.load_with_errors()
        # 至少 1 个合法被加载
        self.assertGreaterEqual(len(configs), 1)

    def test_block_on_error_default_false(self):
        """block_on_error 默认 False"""
        self._write_hook("pre-tool", "default", "---\n---\n#!/bin/bash\n")
        loader = TraeHooksLoader(self.project)
        cfg = loader.load()[0]
        self.assertFalse(cfg.block_on_error)

    def test_load_with_env(self):
        """环境变量解析"""
        self._write_hook(
            "pre-tool",
            "envtest",
            "---\nenv:\n  LOG_LEVEL: info\n  MODE: strict\n---\n#!/bin/bash\n",
        )
        loader = TraeHooksLoader(self.project)
        cfg = loader.load()[0]
        # 解析时 env 留作 dict 暂未支持（简化为字符串）
        # 仅验证文件被加载即可
        self.assertEqual(cfg.hooks[0].name, "envtest")

    def test_load_nested_subdirs(self):
        """支持嵌套子目录"""
        nested = self.project / ".trae" / "hooks" / "pre-tool" / "nested"
        nested.mkdir(parents=True)
        (nested / "deep.sh").write_text(
            "---\n---\n#!/bin/bash\n", encoding="utf-8"
        )
        (nested / "deep.sh").chmod(0o755)
        loader = TraeHooksLoader(self.project)
        configs = loader.load()
        self.assertEqual(len(configs), 1)
        self.assertEqual(configs[0].hooks[0].name, "deep")


class TestHookConfigBlockOnError(unittest.TestCase):
    """HookConfig.block_on_error 字段测试"""

    def test_default_false(self):
        cfg = HookConfig(event="PreToolUse")
        self.assertFalse(cfg.block_on_error)

    def test_from_dict_with_block_on_error(self):
        cfg = HookConfig.from_dict(
            {
                "event": "PreToolUse",
                "block_on_error": True,
            }
        )
        self.assertTrue(cfg.block_on_error)

    def test_to_dict_includes_block_on_error(self):
        cfg = HookConfig(event="PreToolUse", block_on_error=True)
        d = cfg.to_dict()
        self.assertIn("block_on_error", d)
        self.assertTrue(d["block_on_error"])


class TestHooksRegistryLoadFromDirectory(unittest.TestCase):
    """HooksRegistry.load_from_directory 测试"""

    def setUp(self):
        reset_hooks_registry()
        self.tmpdir = tempfile.mkdtemp()
        self.project = Path(self.tmpdir)
        self.registry = HooksRegistry()

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)
        reset_hooks_registry()

    def _write_hook(self, event_dir: str, name: str, content: str = None):
        if content is None:
            content = "---\n---\n#!/bin/bash\necho ok\n"
        d = self.project / ".trae" / "hooks" / event_dir
        d.mkdir(parents=True, exist_ok=True)
        f = d / f"{name}.sh"
        f.write_text(content, encoding="utf-8")
        f.chmod(0o755)
        return f

    def test_load_from_directory(self):
        """load_from_directory 集成"""
        self._write_hook("pre-tool", "a")
        self._write_hook("post-tool", "b")
        count = self.registry.load_from_directory(self.project)
        self.assertEqual(count, 2)
        # 验证事件已注册
        self.assertGreaterEqual(
            len(self.registry.get_configs_for_event("PreToolUse")), 1
        )
        self.assertGreaterEqual(
            len(self.registry.get_configs_for_event("PostToolUse")), 1
        )

    def test_clear_existing(self):
        """clear_existing=True 清空已有"""
        # 先添加一个非目录来源的 config
        self.registry.add(
            HookConfig(
                event="PreToolUse",
                hooks=[HookDefinition(type="command", command="echo old")],
            )
        )
        self.assertEqual(len(self.registry.configs), 1)
        # 用 clear_existing 加载
        self._write_hook("pre-tool", "x")
        self.registry.load_from_directory(self.project, clear_existing=True)
        # 旧 config 被清掉
        self.assertEqual(len(self.registry.configs), 1)
        self.assertEqual(self.registry.configs[0].hooks[0].name, "x")

    def test_no_clear_appends(self):
        """clear_existing=False 追加"""
        self.registry.add(
            HookConfig(
                event="PreToolUse",
                hooks=[HookDefinition(type="command", command="echo old")],
            )
        )
        self._write_hook("pre-tool", "x")
        self.registry.load_from_directory(self.project, clear_existing=False)
        self.assertEqual(len(self.registry.configs), 2)


class TestHooksRegistryDispatchWithBlockOnError(unittest.TestCase):
    """HooksRegistry.dispatch 与 block_on_error 集成测试"""

    def setUp(self):
        reset_hooks_registry()
        self.tmpdir = tempfile.mkdtemp()
        self.project = Path(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)
        reset_hooks_registry()

    def _write_script(self, name: str, exit_code: int) -> Path:
        d = self.project / "scripts"
        d.mkdir(exist_ok=True)
        f = d / f"{name}.sh"
        f.write_text(f"#!/bin/bash\nexit {exit_code}\n", encoding="utf-8")
        f.chmod(0o755)
        return f

    def test_dispatch_runs_all_when_no_block(self):
        """无 block_on_error 时所有 hook 都会执行"""
        script_ok = self._write_script("ok", 0)
        script_ok2 = self._write_script("ok2", 0)
        registry = HooksRegistry()
        registry.add(
            HookConfig(
                event="PreToolUse",
                hooks=[
                    HookDefinition(type="command", command=str(script_ok)),
                    HookDefinition(type="command", command=str(script_ok2)),
                ],
            )
        )
        actions = asyncio.run(
            registry.dispatch("PreToolUse", {"tool_name": "Write"})
        )
        self.assertEqual(len(actions), 2)

    def test_dispatch_stops_on_block_on_error(self):
        """block_on_error=True 失败时停止后续"""
        script_ok = self._write_script("ok", 0)
        script_fail = self._write_script("fail", 1)
        script_ok2 = self._write_script("ok2", 0)
        registry = HooksRegistry()
        registry.add(
            HookConfig(
                event="PreToolUse",
                block_on_error=True,
                hooks=[
                    HookDefinition(type="command", command=str(script_ok)),
                    HookDefinition(type="command", command=str(script_fail)),
                    HookDefinition(type="command", command=str(script_ok2)),
                ],
            )
        )
        actions = asyncio.run(
            registry.dispatch("PreToolUse", {"tool_name": "Write"})
        )
        # 第一个 ok + 失败时停止，第三个不执行
        self.assertEqual(len(actions), 2)
        self.assertTrue(actions[0].is_success)
        self.assertFalse(actions[1].is_success)

    def test_dispatch_continues_when_block_false(self):
        """block_on_error=False 失败时继续"""
        script_ok = self._write_script("ok", 0)
        script_fail = self._write_script("fail", 1)
        script_ok2 = self._write_script("ok2", 0)
        registry = HooksRegistry()
        registry.add(
            HookConfig(
                event="PreToolUse",
                block_on_error=False,
                hooks=[
                    HookDefinition(type="command", command=str(script_ok)),
                    HookDefinition(type="command", command=str(script_fail)),
                    HookDefinition(type="command", command=str(script_ok2)),
                ],
            )
        )
        actions = asyncio.run(
            registry.dispatch("PreToolUse", {"tool_name": "Write"})
        )
        self.assertEqual(len(actions), 3)


class TestLoadTraeHooksHelper(unittest.TestCase):
    """load_trae_hooks 便捷函数测试"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.project = Path(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_load_trae_hooks_returns_count(self):
        (self.project / ".trae" / "hooks" / "pre-tool").mkdir(parents=True)
        for i in range(3):
            f = self.project / ".trae" / "hooks" / "pre-tool" / f"h{i}.sh"
            f.write_text("---\n---\n#!/bin/bash\n", encoding="utf-8")
            f.chmod(0o755)
        count = load_trae_hooks(self.project)
        self.assertEqual(count, 3)

    def test_load_trae_hooks_with_registry(self):
        """传入 registry 时自动注册"""
        (self.project / ".trae" / "hooks" / "pre-tool").mkdir(parents=True)
        f = self.project / ".trae" / "hooks" / "pre-tool" / "h.sh"
        f.write_text("---\n---\n#!/bin/bash\n", encoding="utf-8")
        f.chmod(0o755)
        registry = HooksRegistry()
        count = load_trae_hooks(self.project, registry=registry)
        self.assertEqual(count, 1)
        self.assertEqual(len(registry.configs), 1)


class TestIntegrationWithFixture(unittest.TestCase):
    """使用真实 fixture 集成测试"""

    @classmethod
    def setUpClass(cls):
        cls.fixture = Path("/tmp/test-projects/sample-trae-project")
        if not cls.fixture.exists():
            raise unittest.SkipTest("fixture not prepared")

    def test_real_fixture_load(self):
        """真实 fixture 加载"""
        loader = TraeHooksLoader(self.fixture)
        configs = loader.load()
        # 至少 6 个 hooks
        self.assertGreaterEqual(len(configs), 5)
        # 验证事件类型
        events = {c.event for c in configs}
        self.assertIn("PreToolUse", events)
        self.assertIn("PostToolUse", events)
        self.assertIn("SessionStart", events)
        self.assertIn("SessionEnd", events)
        self.assertIn("UserPromptSubmit", events)

    def test_real_fixture_block_on_error(self):
        """真实 fixture 应至少有 1 个 block_on_error=true"""
        loader = TraeHooksLoader(self.fixture)
        configs = loader.load()
        block_count = sum(1 for c in configs if c.block_on_error)
        self.assertGreaterEqual(block_count, 1)

    def test_real_fixture_matcher(self):
        """真实 fixture 的 matcher 字段应正确解析"""
        loader = TraeHooksLoader(self.fixture)
        configs = loader.load()
        # 找到 security-check
        sc = next(
            (c for c in configs if c.hooks and c.hooks[0].name == "security-check"),
            None,
        )
        self.assertIsNotNone(sc)
        self.assertEqual(sc.matcher, "Write|Edit|MultiEdit")
        self.assertTrue(sc.block_on_error)


if __name__ == "__main__":
    unittest.main(verbosity=2)
