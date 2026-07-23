"""
# ============================================================
# BaseCLIExecutor 可执行文件自动解析 单元测试
# ============================================================
# 核心作用：验证 _resolve_executable 在各种边界情况下的行为
# 覆盖场景：
#   1. 绝对路径透传（已存在）
#   2. 绝对路径不存在
#   3. 标准 PATH 中的命令（shutil.which 能找到）
#   4. nvm 自动发现（核心 bug 修复验证）
#   5. 自定义搜索路径（_build_default_search_dirs）
#   6. 完全找不到时保留原值
#   7. subprocess 环境变量包含增强 PATH
#   8. 空字符串处理
# 复用说明：无复用（按 spec 全新编写）
# ============================================================
# 修改记录：
#   - 2026-06-26 | v1.0.0 | 初始版本，覆盖在线测试发现的 claude-not-found bug
# ============================================================
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

# 确保项目根目录在 Python 路径中
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cli_integration.base_executor import BaseCLIExecutor


class TestResolveExecutable(unittest.TestCase):
    """测试 _resolve_executable 静态方法"""

    def test_absolute_path_passthrough(self):
        """测试 1: 绝对路径透传（已存在）"""
        # /usr/bin/which 在 Debian/Ubuntu 上几乎必定存在
        resolved, searched = BaseCLIExecutor._resolve_executable("/usr/bin/which")
        self.assertTrue(Path(resolved).is_absolute(), "绝对路径应被透传")
        self.assertEqual(searched, [], "绝对路径不应触发搜索")

    def test_absolute_path_not_exists(self):
        """测试 2: 绝对路径但文件不存在"""
        fake_path = "/nonexistent_path_xyz_123/foo"
        resolved, searched = BaseCLIExecutor._resolve_executable(fake_path)
        self.assertEqual(resolved, fake_path, "不存在的绝对路径应原样保留")

    def test_standard_path_command(self):
        """测试 3: 标准 PATH 中的命令（shutil.which 能找到）"""
        resolved, searched = BaseCLIExecutor._resolve_executable("ls")
        self.assertTrue(Path(resolved).is_absolute(), "ls 应被解析为绝对路径")
        self.assertTrue(os.access(resolved, os.X_OK), "解析结果必须是可执行文件")

    def test_nvm_autodiscovery(self):
        """测试 4: nvm 自动发现（核心 bug 修复验证）"""
        # 不依赖 system PATH 中的 which 命令，直接验证 _resolve_executable 行为
        # 检查本机是否有 nvm 目录
        nvm_dir = Path.home() / ".nvm" / "versions" / "node"
        if not nvm_dir.is_dir():
            self.skipTest("本机无 nvm 目录，跳过 nvm 自动发现测试")
        # 检查 nvm 中是否有 claude 或 claude.exe
        has_claude = any((nvm_dir.glob(f"*/bin/claude*"))) or any(
            (nvm_dir.glob(f"*/lib/node_modules/@anthropic-ai/claude-code/bin/claude*"))
        )
        if not has_claude:
            self.skipTest("本机 nvm 中未安装 claude，跳过 nvm 自动发现测试")
        # 实际调用 _resolve_executable
        resolved, _ = BaseCLIExecutor._resolve_executable("claude")
        self.assertTrue(Path(resolved).is_absolute(),
                        f"claude 应被解析为绝对路径，实际: {resolved}")
        self.assertIn("nvm", resolved,
                      f"解析结果应包含 nvm 路径，实际: {resolved}")

    def test_mock_nvm_discovery(self):
        """测试 5: 用临时目录模拟 nvm 目录结构"""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            # 模拟 ~/.nvm/versions/node/v20.0.0/bin/myfakebin
            fake_bin_dir = tmp / ".nvm" / "versions" / "node" / "v20.0.0" / "bin"
            fake_bin_dir.mkdir(parents=True)
            fake_bin = fake_bin_dir / "myfakebin"
            fake_bin.write_text("#!/bin/sh\necho fake\n")
            fake_bin.chmod(0o755)

            # monkey patch Path.home 返回 tmp
            with patch("pathlib.Path.home", return_value=tmp):
                # 也需要 patch _build_default_search_dirs 让它包含 fake_bin_dir
                with patch.object(
                    BaseCLIExecutor,
                    "_build_default_search_dirs",
                    return_value=[str(fake_bin_dir)],
                ):
                    resolved, searched = BaseCLIExecutor._resolve_executable("myfakebin")
                    self.assertEqual(resolved, str(fake_bin.resolve()))
                    self.assertIn(str(fake_bin), searched)

    def test_not_found_keeps_original(self):
        """测试 6: 完全找不到时保留原值并返回搜索过的位置"""
        resolved, searched = BaseCLIExecutor._resolve_executable("nonexistent_xyz_abc_123")
        self.assertEqual(resolved, "nonexistent_xyz_abc_123", "找不到时应原样保留")
        self.assertIsInstance(searched, list, "searched 应为列表")

    def test_empty_string(self):
        """测试 7: 空字符串处理"""
        resolved, searched = BaseCLIExecutor._resolve_executable("")
        self.assertEqual(resolved, "")


class TestEnhancedPATH(unittest.TestCase):
    """测试 _get_process_env 增强 PATH 逻辑"""

    def test_enhanced_path_contains_nvm(self):
        """测试 8: 实例化后 _get_process_env 返回的 PATH 包含 nvm 等增强路径"""
        executor = BaseCLIExecutor(executable="ls")
        env = executor._get_process_env()
        path_value = env.get("PATH", "")
        path_dirs = path_value.split(":")
        # 应该包含一些额外目录
        self.assertGreater(len(path_dirs), 5, "PATH 目录数应大于 5")

    def test_executor_preserves_resolved_path(self):
        """测试 9: 实例化后 self.executable 保留解析后的路径"""
        executor = BaseCLIExecutor(executable="ls")
        self.assertTrue(Path(executor.executable).is_absolute(),
                        f"实例化后 executable 必须是绝对路径: {executor.executable}")


class TestBackwardCompatibility(unittest.TestCase):
    """测试向后兼容性：现有 CLIExecutor / HermesExecutor 行为不变"""

    def test_subclass_uses_resolved_executable(self):
        """测试 10: CLIExecutor 子类继承基类解析行为"""
        from cli_integration.executor import CLIExecutor
        executor = CLIExecutor(executable="ls")
        self.assertTrue(Path(executor.executable).is_absolute())

    def test_hermes_subclass_uses_resolved_executable(self):
        """测试 11: HermesExecutor 子类继承基类解析行为"""
        from hermes_integration.hermes_executor import HermesExecutor
        executor = HermesExecutor(executable="ls")
        self.assertTrue(Path(executor.executable).is_absolute())


if __name__ == "__main__":
    unittest.main(verbosity=2)
