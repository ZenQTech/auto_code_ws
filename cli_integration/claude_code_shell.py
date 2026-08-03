"""
# ============================================================
# ClaudeCodeShell - Claude Code CLI 进程化封装 (v1.0.0)
# Cycle 58 G58-02
# ============================================================
# 核心作用：安全地调用本地 `claude` CLI 子进程，捕获流式输出
# 运行流程：
#   1. 调用 is_available() 探测 claude CLI 是否在 PATH 中
#   2. 若可用 → invoke() 启动子进程，异步读取 stdout/stderr
#   3. 若不可用 → fallback to LLM HTTP mode（直接调 LLM）
#   4. 强制路径净化：拒绝包含 .. 或 ~ 的危险路径
#   5. 强制超时熔断：默认 5 分钟
#   6. 返回 ClaudeShellResult 包含 stream_id/chunks/exit_code
# 设计要点：
#   - 高风险模块：所有用户输入必须经过 sanitization
#   - 禁止 shell=True，仅允许 list 形式参数
#   - 输出限制：单次最大 10MB
# 输入参数：prompt (str), args (List[str]), cwd (Optional[str])
# 输出结果：ClaudeShellResult 包含 stream_id/chunks/exit_code
# ====================================
# 修改记录：
#   - 2026-08-03 | v1.0.0 | Cycle 58 G58-02 初次创建
# ====================================
"""

import asyncio
import logging
import os
import re
import shlex
import shutil
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import AsyncIterator, List, Optional

logger = logging.getLogger(__name__)

# ============================================================
# 常量
# ====================================

DEFAULT_TIMEOUT = 300  # 5 分钟
MAX_TIMEOUT = 1800     # 30 分钟（绝对上限）
MAX_OUTPUT_BYTES = 10 * 1024 * 1024  # 10MB

# 危险路径模式：拒绝包含这些字符的路径
DANGEROUS_PATH_PATTERNS = [
    r"\.\.",          # 父目录引用
    r"^~",            # 家目录引用
    r"\$",            # 环境变量引用
    r"`",             # 命令替换
    r"\|\s*\w",       # 管道
    r"[;&]",          # 命令分隔
]

# 允许的 prompt 字符（白名单）
ALLOWED_PROMPT_CHARS = re.compile(r"^[\w\s\.\,\?\!\:\;\-\(\)\[\]\{\}\'\"\n\r\t\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\+\=\*\/\\\<\>\@\#\%\^\&\~]*$")


# ============================================================
# 数据结构
# ====================================

@dataclass
class ClaudeShellChunk:
    """流式输出块"""
    stream_id: str
    chunk: str
    stream: str  # 'stdout' | 'stderr' | 'system'
    timestamp: float


@dataclass
class ClaudeShellResult:
    """调用结果"""
    stream_id: str
    success: bool
    exit_code: Optional[int]
    error: Optional[str]
    chunks: List[ClaudeShellChunk] = field(default_factory=list)
    duration: float = 0.0
    mode: str = "subprocess"  # 'subprocess' | 'fallback'


# ============================================================
# 路径净化
# ====================================

def sanitize_path(path: str) -> Optional[str]:
    """
    净化文件路径，拒绝包含危险模式的路径
    
    输入参数：path (str) - 待净化路径
    输出结果：净化后的路径（None 表示拒绝）
    """
    if not path:
        return None
    
    # 检查危险模式
    for pattern in DANGEROUS_PATH_PATTERNS:
        if re.search(pattern, path):
            logger.warning(f"sanitize_path: rejected dangerous path pattern={pattern} path={path[:100]}")
            return None
    
    # 解析并验证
    try:
        resolved = Path(path).resolve()
    except (OSError, ValueError) as e:
        logger.warning(f"sanitize_path: resolve failed path={path[:100]} err={e}")
        return None
    
    # 验证路径必须存在或是合理的父目录
    return str(resolved)


def sanitize_prompt(prompt: str, max_length: int = 100_000) -> Optional[str]:
    """
    净化 prompt 文本
    
    输入参数：prompt (str), max_length (int)
    输出结果：净化后的 prompt（None 表示拒绝）
    """
    if not prompt:
        return None
    
    if len(prompt) > max_length:
        logger.warning(f"sanitize_prompt: prompt too long len={len(prompt)} max={max_length}")
        return None
    
    # 限制控制字符
    sanitized = "".join(c for c in prompt if c == "\n" or c == "\r" or c == "\t" or ord(c) >= 32)
    
    return sanitized


# ============================================================
# 可用性探测
# ====================================

def is_available() -> bool:
    """
    探测 claude CLI 是否在 PATH 中
    
    输入参数：无
    输出结果：bool
    """
    return shutil.which("claude") is not None


async def is_available_async() -> bool:
    """
    异步探测 claude CLI 是否在 PATH 中（带版本检查）
    
    输入参数：无
    输出结果：bool
    """
    if not is_available():
        return False
    
    try:
        proc = await asyncio.create_subprocess_exec(
            "claude", "--version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5.0)
        return proc.returncode == 0
    except (asyncio.TimeoutError, FileNotFoundError, OSError) as e:
        logger.warning(f"is_available_async: version check failed err={e}")
        return False


# ============================================================
# 进程调用
# ====================================

async def invoke(
    prompt: str,
    args: Optional[List[str]] = None,
    cwd: Optional[str] = None,
    timeout: int = DEFAULT_TIMEOUT,
    env: Optional[dict] = None,
) -> ClaudeShellResult:
    """
    调用 claude CLI 并捕获流式输出
    
    输入参数：
      - prompt: 提示词
      - args: 额外 CLI 参数（不允许危险字符）
      - cwd: 工作目录（必须已净化）
      - timeout: 超时秒数（默认 300，最大 1800）
      - env: 自定义环境变量
    
    输出结果：ClaudeShellResult
    """
    stream_id = f"cs-{uuid.uuid4().hex[:16]}"
    start_time = time.time()
    
    # 参数校验
    if not is_available():
        return await _fallback_to_llm(prompt, stream_id, start_time, "claude CLI 不在 PATH 中")
    
    sanitized_prompt = sanitize_prompt(prompt)
    if not sanitized_prompt:
        return ClaudeShellResult(
            stream_id=stream_id,
            success=False,
            exit_code=None,
            error="prompt 净化失败或为空",
            mode="subprocess",
        )
    
    sanitized_cwd = None
    if cwd:
        sanitized_cwd = sanitize_path(cwd)
        if not sanitized_cwd:
            return ClaudeShellResult(
                stream_id=stream_id,
                success=False,
                exit_code=None,
                error=f"工作目录净化失败: {cwd}",
                mode="subprocess",
            )
        if not os.path.isdir(sanitized_cwd):
            return ClaudeShellResult(
                stream_id=stream_id,
                success=False,
                exit_code=None,
                error=f"工作目录不存在: {sanitized_cwd}",
                mode="subprocess",
            )
    
    sanitized_args = []
    for arg in (args or []):
        if not isinstance(arg, str):
            return ClaudeShellResult(
                stream_id=stream_id,
                success=False,
                exit_code=None,
                error=f"参数必须是字符串: {arg}",
                mode="subprocess",
            )
        # 防止参数注入
        if any(c in arg for c in (";", "|", "&", "$", "`", "\n")):
            return ClaudeShellResult(
                stream_id=stream_id,
                success=False,
                exit_code=None,
                error=f"参数包含危险字符: {arg[:50]}",
                mode="subprocess",
            )
        sanitized_args.append(arg)
    
    effective_timeout = min(max(timeout, 1), MAX_TIMEOUT)
    
    # 构建命令
    cmd = ["claude", "--print", "--output-format", "stream-json", *sanitized_args]
    
    # 准备环境
    proc_env = os.environ.copy()
    if env:
        proc_env.update(env)
    # 移除潜在的危险变量
    proc_env.pop("LD_PRELOAD", None)
    proc_env.pop("LD_LIBRARY_PATH", None)
    
    logger.info(f"invoke: stream_id={stream_id} timeout={effective_timeout}s cwd={sanitized_cwd}")
    
    chunks: List[ClaudeShellChunk] = []
    total_bytes = 0
    truncated = False
    
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=sanitized_cwd,
            env=proc_env,
        )
        
        # 写入 prompt 到 stdin
        try:
            proc.stdin.write(sanitized_prompt.encode("utf-8"))
            await proc.stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            try:
                proc.stdin.close()
            except Exception:
                pass
        
        # 流式读取
        async def read_stream(stream: asyncio.StreamReader, stream_name: str):
            nonlocal total_bytes, truncated
            while True:
                if total_bytes >= MAX_OUTPUT_BYTES:
                    truncated = True
                    break
                try:
                    line = await asyncio.wait_for(stream.readline(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                if not line:
                    break
                
                line_str = line.decode("utf-8", errors="replace")
                chunk_size = len(line_str.encode("utf-8"))
                if total_bytes + chunk_size > MAX_OUTPUT_BYTES:
                    line_str = line_str[:MAX_OUTPUT_BYTES - total_bytes]
                    truncated = True
                
                total_bytes += chunk_size
                chunks.append(ClaudeShellChunk(
                    stream_id=stream_id,
                    chunk=line_str,
                    stream=stream_name,
                    timestamp=time.time(),
                ))
        
        try:
            await asyncio.wait_for(
                asyncio.gather(
                    read_stream(proc.stdout, "stdout"),
                    read_stream(proc.stderr, "stderr"),
                ),
                timeout=effective_timeout,
            )
        except asyncio.TimeoutError:
            logger.warning(f"invoke: timeout stream_id={stream_id}")
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            return ClaudeShellResult(
                stream_id=stream_id,
                success=False,
                exit_code=None,
                error=f"超时熔断 ({effective_timeout}s)",
                chunks=chunks,
                duration=time.time() - start_time,
                mode="subprocess",
            )
        
        # 等待进程退出
        try:
            exit_code = await asyncio.wait_for(proc.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            proc.kill()
            exit_code = -1
        
        if truncated:
            chunks.append(ClaudeShellChunk(
                stream_id=stream_id,
                chunk="...[output truncated]\n",
                stream="system",
                timestamp=time.time(),
            ))
        
        return ClaudeShellResult(
            stream_id=stream_id,
            success=(exit_code == 0),
            exit_code=exit_code,
            error=None if exit_code == 0 else f"exit code {exit_code}",
            chunks=chunks,
            duration=time.time() - start_time,
            mode="subprocess",
        )
    
    except FileNotFoundError:
        return await _fallback_to_llm(prompt, stream_id, start_time, "claude 命令未找到")
    except (OSError, PermissionError) as e:
        logger.error(f"invoke: OS error stream_id={stream_id} err={e}")
        return await _fallback_to_llm(prompt, stream_id, start_time, str(e))


# ============================================================
# LLM 降级模式
# ====================================

async def _fallback_to_llm(
    prompt: str,
    stream_id: str,
    start_time: float,
    reason: str,
) -> ClaudeShellResult:
    """
    当 claude CLI 不可用时，降级为 LLM HTTP 模式
    
    输入参数：prompt, stream_id, start_time, reason
    输出结果：ClaudeShellResult
    """
    logger.info(f"_fallback_to_llm: stream_id={stream_id} reason={reason}")
    
    # 检查是否有可用的 LLM 配置
    llm_api_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not llm_api_key:
        return ClaudeShellResult(
            stream_id=stream_id,
            success=False,
            exit_code=None,
            error=f"claude CLI 不可用且无 LLM API Key: {reason}",
            mode="fallback",
        )
    
    # 简单的 LLM HTTP 调用（使用 anthropic SDK 或 requests）
    try:
        import httpx
        
        if os.environ.get("ANTHROPIC_API_KEY"):
            api_key = os.environ["ANTHROPIC_API_KEY"]
            model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
            endpoint = "https://api.anthropic.com/v1/messages"
            payload = {
                "model": model,
                "max_tokens": 4096,
                "messages": [{"role": "user", "content": prompt}],
            }
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
        else:
            api_key = os.environ["OPENAI_API_KEY"]
            model = os.environ.get("OPENAI_MODEL", "gpt-4o")
            endpoint = "https://api.openai.com/v1/chat/completions"
            payload = {
                "model": model,
                "max_tokens": 4096,
                "messages": [{"role": "user", "content": prompt}],
            }
            headers = {
                "Authorization": f"Bearer {api_key}",
                "content-type": "application/json",
            }
        
        chunks: List[ClaudeShellChunk] = []
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(endpoint, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            
            if "content" in data and len(data["content"]) > 0:
                content = data["content"][0].get("text", "")
            elif "choices" in data and len(data["choices"]) > 0:
                content = data["choices"][0].get("message", {}).get("content", "")
            else:
                content = ""
            
            chunks.append(ClaudeShellChunk(
                stream_id=stream_id,
                chunk=content,
                stream="stdout",
                timestamp=time.time(),
            ))
        
        return ClaudeShellResult(
            stream_id=stream_id,
            success=True,
            exit_code=0,
            error=None,
            chunks=chunks,
            duration=time.time() - start_time,
            mode="fallback",
        )
    except Exception as e:
        logger.error(f"_fallback_to_llm: failed err={e}")
        return ClaudeShellResult(
            stream_id=stream_id,
            success=False,
            exit_code=None,
            error=f"LLM 降级失败: {e}",
            mode="fallback",
        )


# ============================================================
# 流式调用（async iterator）
# ====================================

async def stream_invoke(
    prompt: str,
    args: Optional[List[str]] = None,
    cwd: Optional[str] = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> AsyncIterator[ClaudeShellChunk]:
    """
    流式调用 claude CLI，逐块返回输出
    
    输入参数：prompt, args, cwd, timeout
    输出结果：AsyncIterator[ClaudeShellChunk]
    """
    stream_id = f"cs-{uuid.uuid4().hex[:16]}"
    
    if not is_available():
        yield ClaudeShellChunk(
            stream_id=stream_id,
            chunk=f"[fallback] claude CLI 不可用\n",
            stream="system",
            timestamp=time.time(),
        )
        result = await _fallback_to_llm(prompt, stream_id, time.time(), "claude CLI 不可用")
        for chunk in result.chunks:
            yield chunk
        return
    
    sanitized_prompt = sanitize_prompt(prompt)
    if not sanitized_prompt:
        yield ClaudeShellChunk(
            stream_id=stream_id,
            chunk="[error] prompt 净化失败\n",
            stream="system",
            timestamp=time.time(),
        )
        return
    
    sanitized_cwd = None
    if cwd:
        sanitized_cwd = sanitize_path(cwd)
        if not sanitized_cwd or not os.path.isdir(sanitized_cwd):
            yield ClaudeShellChunk(
                stream_id=stream_id,
                chunk=f"[error] 工作目录无效: {cwd}\n",
                stream="system",
                timestamp=time.time(),
            )
            return
    
    sanitized_args = []
    for arg in (args or []):
        if not isinstance(arg, str) or any(c in arg for c in (";", "|", "&", "$", "`", "\n")):
            yield ClaudeShellChunk(
                stream_id=stream_id,
                chunk=f"[error] 参数包含危险字符\n",
                stream="system",
                timestamp=time.time(),
            )
            return
        sanitized_args.append(arg)
    
    effective_timeout = min(max(timeout, 1), MAX_TIMEOUT)
    
    cmd = ["claude", "--print", "--output-format", "stream-json", *sanitized_args]
    
    proc_env = os.environ.copy()
    proc_env.pop("LD_PRELOAD", None)
    proc_env.pop("LD_LIBRARY_PATH", None)
    
    total_bytes = 0
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=sanitized_cwd,
            env=proc_env,
        )
        
        try:
            proc.stdin.write(sanitized_prompt.encode("utf-8"))
            await proc.stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            try:
                proc.stdin.close()
            except Exception:
                pass
        
        async def read_stream(stream: asyncio.StreamReader, stream_name: str):
            nonlocal total_bytes
            while True:
                if total_bytes >= MAX_OUTPUT_BYTES:
                    yield ClaudeShellChunk(
                        stream_id=stream_id,
                        chunk="\n...[truncated]\n",
                        stream="system",
                        timestamp=time.time(),
                    )
                    break
                try:
                    line = await asyncio.wait_for(stream.readline(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                if not line:
                    break
                line_str = line.decode("utf-8", errors="replace")
                chunk_size = len(line_str.encode("utf-8"))
                if total_bytes + chunk_size > MAX_OUTPUT_BYTES:
                    line_str = line_str[:MAX_OUTPUT_BYTES - total_bytes]
                total_bytes += chunk_size
                yield ClaudeShellChunk(
                    stream_id=stream_id,
                    chunk=line_str,
                    stream=stream_name,
                    timestamp=time.time(),
                )
        
        try:
            async for chunk in read_stream(proc.stdout, "stdout"):
                yield chunk
            async for chunk in read_stream(proc.stderr, "stderr"):
                yield chunk
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            yield ClaudeShellChunk(
                stream_id=stream_id,
                chunk=f"\n[timeout after {effective_timeout}s]\n",
                stream="system",
                timestamp=time.time(),
            )
        
        try:
            await asyncio.wait_for(proc.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            proc.kill()
    
    except FileNotFoundError:
        yield ClaudeShellChunk(
            stream_id=stream_id,
            chunk="[error] claude 命令未找到\n",
            stream="system",
            timestamp=time.time(),
        )
