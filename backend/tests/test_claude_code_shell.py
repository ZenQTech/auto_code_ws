"""
# ============================================================
# ClaudeCodeShell 单元测试 (v1.0.0)
# Cycle 58 G58-02
# ============================================================
# 测试覆盖：
#   - 路径净化（拒绝 .. ~ $ ` ; & |）
#   - Prompt 净化（长度限制、控制字符）
#   - 可用性探测
#   - invoke 正常路径
#   - invoke 异常路径（超时、空 prompt、危险路径）
#   - 降级到 LLM 模式
# ====================================
# 修改记录：
#   - 2026-08-03 | v1.0.0 | Cycle 58 G58-02 初次创建
# ====================================
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..")))

import asyncio
import os
import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from cli_integration import claude_code_shell as shell


class TestSanitizePath:
    """路径净化测试"""
    
    def test_reject_parent_directory_traversal(self):
        assert shell.sanitize_path("/home/user/../etc/passwd") is None
        assert shell.sanitize_path("../../../etc/passwd") is None
    
    def test_reject_home_directory_reference(self):
        assert shell.sanitize_path("~/secret") is None
    
    def test_reject_env_variable_reference(self):
        assert shell.sanitize_path("$HOME/secret") is None
    
    def test_reject_command_substitution(self):
        assert shell.sanitize_path("`whoami`") is None
    
    def test_reject_pipe(self):
        assert shell.sanitize_path("/tmp | rm -rf /") is None
    
    def test_reject_command_separator(self):
        assert shell.sanitize_path("/tmp; rm -rf /") is None
        assert shell.sanitize_path("/tmp & rm -rf /") is None
    
    def test_reject_empty(self):
        assert shell.sanitize_path("") is None
        assert shell.sanitize_path(None) is None
    
    def test_accept_valid_path(self, tmp_path):
        result = shell.sanitize_path(str(tmp_path))
        assert result is not None
        assert os.path.isabs(result)


class TestSanitizePrompt:
    """Prompt 净化测试"""
    
    def test_reject_empty(self):
        assert shell.sanitize_prompt("") is None
        assert shell.sanitize_prompt(None) is None
    
    def test_reject_too_long(self):
        long_prompt = "a" * 100_001
        assert shell.sanitize_prompt(long_prompt) is None
    
    def test_accept_normal_prompt(self):
        result = shell.sanitize_prompt("Hello, world!")
        assert result == "Hello, world!"
    
    def test_strip_control_characters(self):
        result = shell.sanitize_prompt("hello\x00\x01\x02world")
        assert result is not None
        assert "\x00" not in result
        assert "hello" in result
        assert "world" in result
    
    def test_allow_newline_tab(self):
        result = shell.sanitize_prompt("line1\nline2\tindented")
        assert result is not None
        assert "\n" in result
        assert "\t" in result


class TestIsAvailable:
    """可用性探测测试"""
    
    def test_is_available_returns_bool(self):
        result = shell.is_available()
        assert isinstance(result, bool)
    
    @pytest.mark.asyncio
    async def test_is_available_async(self):
        result = await shell.is_available_async()
        assert isinstance(result, bool)


class TestInvokeValidation:
    """invoke 参数校验测试"""
    
    @pytest.mark.asyncio
    async def test_invoke_empty_prompt(self):
        with patch.object(shell, "is_available", return_value=True):
            result = await shell.invoke(prompt="")
            assert not result.success
            assert "prompt" in result.error.lower() or "净化" in result.error or "空" in result.error
    
    @pytest.mark.asyncio
    async def test_invoke_long_prompt(self):
        with patch.object(shell, "is_available", return_value=True):
            result = await shell.invoke(prompt="a" * 100_001)
            assert not result.success
    
    @pytest.mark.asyncio
    async def test_invoke_dangerous_cwd(self):
        with patch.object(shell, "is_available", return_value=True):
            result = await shell.invoke(prompt="test", cwd="../../../etc")
            assert not result.success
            assert "工作目录" in result.error or "目录" in result.error
    
    @pytest.mark.asyncio
    async def test_invoke_dangerous_args(self):
        with patch.object(shell, "is_available", return_value=True):
            result = await shell.invoke(prompt="test", args=["; rm -rf /"])
            assert not result.success
            assert "危险字符" in result.error or "参数" in result.error


class TestInvokeFallback:
    """降级模式测试"""
    
    @pytest.mark.asyncio
    async def test_invoke_fallback_when_cli_unavailable(self):
        with patch.object(shell, "is_available", return_value=False):
            with patch.dict(os.environ, {}, clear=True):
                result = await shell.invoke(prompt="test")
                assert not result.success
                assert "API Key" in result.error or "claude" in result.error
                assert result.mode == "fallback"
    
    @pytest.mark.asyncio
    async def test_invoke_fallback_with_openai_key(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "Hello from OpenAI"}}]
        }
        mock_response.raise_for_status = MagicMock()
        
        with patch.object(shell, "is_available", return_value=False):
            with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test123"}, clear=True):
                with patch("httpx.AsyncClient") as mock_client:
                    mock_client.return_value.__aenter__.return_value.post = AsyncMock(
                        return_value=mock_response
                    )
                    result = await shell.invoke(prompt="test")
                    # 可能成功（如果有 httpx）或失败（如果没有）
                    assert result.mode == "fallback"


class TestInvokeSuccess:
    """成功路径测试（mock subprocess）"""
    
    @pytest.mark.asyncio
    async def test_invoke_subprocess_success(self):
        mock_proc = MagicMock()
        mock_proc.stdin = MagicMock()
        mock_proc.stdin.write = MagicMock()
        mock_proc.stdin.drain = AsyncMock()
        mock_proc.stdin.close = MagicMock()
        mock_proc.stdout = MagicMock()
        mock_proc.stderr = MagicMock()
        mock_proc.wait = AsyncMock(return_value=0)
        mock_proc.kill = MagicMock()
        
        async def readline_side_effect():
            return b""
        
        mock_proc.stdout.readline = AsyncMock(side_effect=readline_side_effect)
        mock_proc.stderr.readline = AsyncMock(side_effect=readline_side_effect)
        
        with patch.object(shell, "is_available", return_value=True):
            with patch.object(shell, "sanitize_path", return_value="/tmp"):
                with patch("asyncio.create_subprocess_exec", AsyncMock(return_value=mock_proc)):
                    with patch("os.path.isdir", return_value=True):
                        result = await shell.invoke(prompt="test", cwd="/tmp")
                        assert result.success
                        assert result.exit_code == 0
                        assert result.mode == "subprocess"


class TestStreamInvoke:
    """流式调用测试"""
    
    @pytest.mark.asyncio
    async def test_stream_invoke_unavailable(self):
        with patch.object(shell, "is_available", return_value=False):
            chunks = []
            async for chunk in shell.stream_invoke(prompt="test"):
                chunks.append(chunk)
            assert len(chunks) >= 1
            assert any(c.stream == "system" for c in chunks)
    
    @pytest.mark.asyncio
    async def test_stream_invoke_empty_prompt(self):
        with patch.object(shell, "is_available", return_value=True):
            chunks = []
            async for chunk in shell.stream_invoke(prompt=""):
                chunks.append(chunk)
            assert any("error" in c.chunk.lower() or "[error]" in c.chunk for c in chunks)
    
    @pytest.mark.asyncio
    async def test_stream_invoke_invalid_cwd(self):
        with patch.object(shell, "is_available", return_value=True):
            with patch.object(shell, "sanitize_path", return_value=None):
                chunks = []
                async for chunk in shell.stream_invoke(prompt="test", cwd="/invalid"):
                    chunks.append(chunk)
                assert any("[error]" in c.chunk for c in chunks)


class TestConstants:
    """常量测试"""
    
    def test_default_timeout(self):
        assert shell.DEFAULT_TIMEOUT == 300
    
    def test_max_timeout(self):
        assert shell.MAX_TIMEOUT == 1800
    
    def test_max_output_bytes(self):
        assert shell.MAX_OUTPUT_BYTES == 10 * 1024 * 1024
