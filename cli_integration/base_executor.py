"""
# ============================================================
# CLI 集成层 - CLI 命令执行器基类
# ============================================================
# 核心作用：提取 CLIExecutor 与 HermesExecutor 的公共逻辑，
#           提供统一的 subprocess 调用封装，包括超时控制、
#           重试机制、流式输出和标准化结果解析
# 运行流程：
#   1. 子类调用 execute(command) 或 execute_streaming(command)
#   2. 基类通过 _build_full_command(command) 构建完整命令行
#   3. 通过 _get_process_env(env) 构建进程环境变量
#   4. 执行 _run_once(command) 进行单次 subprocess 调用
#   5. execute() 中带指数退避的重试循环
#   6. 成功时调用 _on_success(result) 钩子（子类重写以解析 Token 等）
#   7. 返回 BaseCLIResult 或其子类对象
# 输入参数：
#   - command: str，子类传入的原始命令字符串（不含可执行文件名与全局标志）
#   - cwd: Optional[str]，工作目录
#   - timeout: Optional[int]，超时时间（秒），None 使用默认值
#   - env: Optional[Dict[str, str]]，额外环境变量
#   - stream_callback: Optional[Callable]，流式输出回调函数
# 输出结果：BaseCLIResult 或其子类对象
# ============================================================
# 修改记录：
#   版本 1.0.0 | 2026-06-24 | 从 executor.py 与 hermes_executor.py 提取公共逻辑创建基类
#   版本 1.1.0 | 2026-06-26 | 新增 _resolve_executable 自动解析可执行文件绝对路径
#                              + _build_default_search_dirs 构建常见安装位置列表
#                              + _get_process_env 增强 PATH（合并自动发现的 bin 目录）
#                              修复 bug: claude 安装在 nvm 后 uvicorn 找不到命令 (exit 127)
#   版本 1.2.0 | 2026-06-29 | 新增 cancel() 方法和 _current_process 属性，
#                              支持用户通过前端停止按钮终止正在运行的子进程
#                              _run_once 中保存进程引用并增加 finally 清理
# ============================================================
"""

import asyncio
import os
import shutil
import time
import logging
import subprocess as _std_subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Dict, Callable, List, Tuple

logger = logging.getLogger(__name__)


@dataclass
class BaseCLIResult:
    """
    CLI 命令执行结果基类
    字段说明：
      - stdout: 标准输出内容
      - stderr: 标准错误输出内容
      - exit_code: 进程退出码（0 表示成功）
      - duration: 执行耗时（秒）
      - success: 是否执行成功
      - error_message: 错误信息（失败时）
    """
    stdout: str = ""
    stderr: str = ""
    exit_code: int = -1
    duration: float = 0.0
    success: bool = False
    error_message: str = ""


class BaseCLIExecutor:
    """
    CLI 命令执行器基类
    作用：封装 subprocess 调用的通用逻辑，提供超时、重试、流式输出
         子类通过重写 _build_full_command / _get_process_env 来适配不同 CLI
    调用方：CLIExecutor（Claude Code CLI）、HermesExecutor（Hermes CLI）
    被调用方：asyncio subprocess（底层进程管理）
    """

    # ============================================================
    # 类级别常量：可执行文件自动搜索路径
    # ============================================================
    # 设计目的：解决 nvm/npm 全局安装的 claude/hermes 命令在 uvicorn
    #           启动时不在 PATH 中的问题（uvicorn 继承最小化环境变量）
    DEFAULT_SEARCH_DIRS: List[str] = []  # 运行时动态填充

    @classmethod
    def _build_default_search_dirs(cls) -> List[str]:
        """
        构建默认的可执行文件搜索目录列表
        运行步骤：
          1. 添加 nvm 目录（~/.nvm/versions/node/*/bin/）
          2. 添加 ~/.local/bin/、/usr/local/bin/
          3. 动态获取 npm 全局目录
          4. 添加 ~/.npm-global/bin/、/opt/homebrew/bin/ 备用
        返回值：搜索目录绝对路径列表
        """
        dirs: List[str] = []
        home = Path.home()
        # nvm 多版本目录
        nvm_dir = home / ".nvm" / "versions" / "node"
        if nvm_dir.is_dir():
            for child in nvm_dir.iterdir():
                bin_dir = child / "bin"
                if bin_dir.is_dir():
                    dirs.append(str(bin_dir))
        # 用户本地 bin
        for p in [home / ".local" / "bin", home / ".npm-global" / "bin"]:
            if p.is_dir():
                dirs.append(str(p))
        # 系统级 bin
        for p in [Path("/usr/local/bin"), Path("/opt/homebrew/bin"), Path("/snap/bin")]:
            if p.is_dir():
                dirs.append(str(p))
        # 动态 npm 全局目录
        try:
            npm_root = _std_subprocess.check_output(
                ["npm", "root", "-g"], stderr=_std_subprocess.DEVNULL, timeout=3
            ).decode().strip()
            if npm_root:
                # npm root -g 返回 lib 目录，需拼 bin
                parent = Path(npm_root).parent
                bin_dir = parent / "bin"
                if bin_dir.is_dir():
                    dirs.append(str(bin_dir))
        except Exception:
            pass
        return dirs

    @staticmethod
    def _resolve_executable(executable: str) -> Tuple[str, List[str]]:
        """
        解析可执行文件为绝对路径
        运行步骤：
          1. 如果 executable 已是绝对路径且存在 → 直接返回
          2. 调用 shutil.which(executable) → 找到则返回绝对路径
          3. 否则遍历常见安装位置（nvm、npm 全局、~/.local/bin、/usr/local/bin）
          4. 深度 5 遍历 ~ 目录查找同名可执行
          5. 全部失败 → 返回原值
        参数：
          - executable: 用户配置的 CLI 可执行文件名或绝对路径
        返回值：(resolved_path, searched_dirs)
          - resolved_path: 解析后的绝对路径（解析失败时为原值）
          - searched_dirs: 实际搜索过的目录列表（用于日志）
        """
        if not executable:
            return executable, []

        # 绝对路径：直接验证存在性
        p = Path(executable)
        if p.is_absolute():
            if p.exists() and os.access(str(p), os.X_OK):
                return str(p.resolve()), []
            return executable, []  # 绝对路径但不存在，保留原值

        searched_dirs: List[str] = []

        # 1. 优先 shutil.which
        found = shutil.which(executable)
        if found and os.access(found, os.X_OK):
            return found, []

        # 2. 遍历常见安装位置
        search_dirs = BaseCLIExecutor._build_default_search_dirs()
        for d in search_dirs:
            candidate = Path(d) / executable
            searched_dirs.append(str(candidate))
            if candidate.exists() and os.access(str(candidate), os.X_OK):
                return str(candidate.resolve()), searched_dirs

        # 3. 深度 5 遍历 ~ 目录查找同名可执行（兜底）
        home = Path.home()
        try:
            for match in home.glob(f"**/{executable}"):
                try:
                    depth = len(match.relative_to(home).parts)
                except ValueError:
                    continue
                if depth > 5:
                    continue
                if match.is_file() and os.access(str(match), os.X_OK):
                    return str(match.resolve()), searched_dirs
        except Exception:
            pass

        return executable, searched_dirs

    def __init__(
        self,
        executable: str,
        default_timeout: int = 600,
        max_retries: int = 3,
        retry_base_delay: int = 2,
        cli_env: Optional[Dict[str, str]] = None,
    ):
        """
        初始化 CLI 执行器基类
        参数：
          - executable: CLI 可执行文件名（如 "claude"、"hermes"）或绝对路径
          - default_timeout: 默认超时时间（秒），默认 600
          - max_retries: 最大重试次数，默认 3
          - retry_base_delay: 重试基础延迟（秒），指数递增，默认 2
          - cli_env: CLI 执行时的环境变量（API 配置等）
        """
        # 解析可执行文件绝对路径（解决 nvm/npm 安装但不在 PATH 中的问题）
        resolved, searched = self._resolve_executable(executable)
        if resolved != executable and Path(resolved).is_absolute():
            logger.info(
                f"CLI 可执行文件已解析: {executable} -> {resolved}"
            )
        elif resolved == executable and not Path(executable).is_absolute():
            # 未能解析
            logger.warning(
                f"未能自动发现可执行文件 '{executable}'，"
                f"搜索过的位置: {searched[:5]}{'...' if len(searched) > 5 else ''}。"
                f"请安装 Claude Code CLI 或在 config.yaml 中将 cli.executable "
                f"设置为绝对路径。"
            )
        self.executable = resolved
        # 保存搜索过的目录，用于后续增强 PATH
        self._searched_dirs = searched
        self.default_timeout = default_timeout
        self.max_retries = max_retries
        self.retry_base_delay = retry_base_delay
        # CLI 环境变量：API 配置等
        self.cli_env = cli_env or {}
        # 当前正在运行的子进程引用（v1.2.0 新增，用于 cancel() 方法终止子进程）
        self._current_process = None

    # ================================================================
    # 子类必须/可选重写的钩子方法
    # ================================================================

    def _build_full_command(self, command: str) -> str:
        """
        构建完整命令行（含可执行文件名与全局标志）
        子类必须重写此方法以添加各自的全局标志
        参数：
          - command: 子类传入的原始命令字符串（不含可执行文件名与全局标志）
        返回值：完整的命令行字符串
        """
        raise NotImplementedError("子类必须实现 _build_full_command 方法")

    def _get_process_env(self, env: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        """
        构建进程环境变量
        运行步骤：
          1. 复制系统环境变量
          2. 合并自动发现的 bin 目录到 PATH 前缀（解决 nvm/npm 不在 PATH 问题）
          3. 合并 CLI 配置环境变量
          4. 合并调用方传入的额外环境变量
        参数：
          - env: 调用方传入的额外环境变量
        返回值：合并后的环境变量字典
        """
        process_env = os.environ.copy()

        # 增强 PATH：将 _searched_dirs 中的可执行文件所在目录加入 PATH 前缀
        extra_path_parts: List[str] = []
        for d in getattr(self, "_searched_dirs", []) or []:
            p = Path(d).parent
            if p.is_dir():
                extra_path_parts.append(str(p))
        # 也加入 _build_default_search_dirs 结果（不重复）
        for d in self._build_default_search_dirs():
            if d not in extra_path_parts:
                extra_path_parts.append(d)

        if extra_path_parts:
            current_path = process_env.get("PATH", "")
            if current_path:
                process_env["PATH"] = ":".join(extra_path_parts) + ":" + current_path
            else:
                process_env["PATH"] = ":".join(extra_path_parts)

        if self.cli_env:
            process_env.update(self.cli_env)
        if env:
            process_env.update(env)
        return process_env

    def _create_result(self) -> BaseCLIResult:
        """
        创建结果对象（工厂方法）
        子类可重写以返回带有扩展字段的结果对象
        返回值：BaseCLIResult 或子类实例
        """
        return BaseCLIResult()

    def _on_success(self, result: BaseCLIResult):
        """
        执行成功后的钩子（子类可重写以进行额外处理）
        参数：
          - result: 执行结果对象
        """
        pass  # 默认无额外处理

    # ================================================================
    # 公共执行方法
    # ================================================================

    async def execute(
        self,
        command: str,
        cwd: Optional[str] = None,
        timeout: Optional[int] = None,
        env: Optional[Dict[str, str]] = None,
        stream_callback: Optional[Callable] = None,
    ) -> BaseCLIResult:
        """
        执行 CLI 命令（带重试机制）
        运行步骤：
          1. 确定超时时间
          2. 循环执行（最多 max_retries 次）
          3. 每次执行调用 _run_once
          4. 成功则调用 _on_success 钩子并返回结果
          5. 失败则根据重试次数以指数退避策略重试
        参数：
          - command: 要执行的命令字符串（不含可执行文件名与全局标志）
          - cwd: 工作目录
          - timeout: 超时时间（None 则使用默认值）
          - env: 环境变量字典
          - stream_callback: 流式输出回调函数
        返回值：BaseCLIResult 对象
        """
        timeout = timeout or self.default_timeout
        last_result = self._create_result()

        for attempt in range(1, self.max_retries + 1):
            logger.info(
                f"执行 {self.executable} 命令 (第 {attempt}/{self.max_retries} 次): "
                f"{command[:100]}..."
            )
            result = await self._run_once(command, cwd, timeout, env, stream_callback)

            if result.success:
                logger.info(
                    f"{self.executable} 命令执行成功，耗时 {result.duration:.2f}s"
                )
                return result

            last_result = result
            logger.warning(
                f"{self.executable} 命令执行失败 (第 {attempt} 次): "
                f"{result.error_message}"
            )

            # 最后一次尝试不等待
            if attempt < self.max_retries:
                delay = self.retry_base_delay ** attempt
                logger.info(f"等待 {delay}s 后重试...")
                await asyncio.sleep(delay)

        logger.error(
            f"{self.executable} 命令执行失败，已达最大重试次数 {self.max_retries}"
        )
        return last_result

    def cancel(self) -> bool:
        """
        终止当前正在运行的子进程（v1.2.0 新增）
        作用：供前端停止按钮调用，通过向子进程发送 SIGKILL 信号终止执行
        运行步骤：
          1. 检查 _current_process 是否存在
          2. 若存在则调用 process.kill() 终止进程
          3. 捕获异常，防止重复 kill 导致报错
        返回值：bool，True 表示成功终止，False 表示无进程可终止或终止失败
        幂等性：多次调用不会报错，_current_process 为 None 时直接返回 False
        调用方：后端 /api/hermes/stop 端点
        被调用方：asyncio.subprocess.Process.kill()
        """
        if self._current_process is not None:
            try:
                self._current_process.kill()
                logger.info("CLI 子进程已被用户取消")
                return True
            except Exception as e:
                logger.error(f"取消 CLI 子进程失败: {e}")
                return False
        return False

    async def _run_once(
        self,
        command: str,
        cwd: Optional[str],
        timeout: int,
        env: Optional[Dict[str, str]],
        stream_callback: Optional[Callable],
    ) -> BaseCLIResult:
        """
        单次执行 CLI 命令（内部方法）
        运行步骤：
          1. 调用 _build_full_command 构建完整命令行
          2. 调用 _get_process_env 合并环境变量
          3. 通过 asyncio.create_subprocess_shell 创建子进程
          4. 等待进程完成（带超时控制）
          5. 收集 stdout/stderr
          6. 判断执行结果，成功时调用 _on_success 钩子
          7. 构建 BaseCLIResult 返回
        参数：同 execute 方法
        返回值：BaseCLIResult 对象
        """
        start_time = time.time()
        result = self._create_result()

        try:
            # 构建完整命令行（子类负责添加可执行文件名和全局标志）
            full_cmd = self._build_full_command(command)
            # 合并环境变量：系统环境 -> CLI 配置环境 -> 调用方传入环境
            process_env = self._get_process_env(env)

            # 创建子进程
            process = await asyncio.create_subprocess_shell(
                full_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
                env=process_env,
            )
            # 保存进程引用，用于 cancel() 方法从外部终止子进程
            self._current_process = process

            # 等待进程完成（带超时控制）
            try:
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    process.communicate(), timeout=timeout
                )
            except asyncio.TimeoutError:
                # 超时处理：终止进程并等待回收
                logger.error(
                    f"{self.executable} 命令超时 ({timeout}s)，正在终止进程..."
                )
                process.kill()
                await process.wait()
                result.error_message = f"命令执行超时 ({timeout}s)"
                result.duration = time.time() - start_time
                return result

            # 解码输出
            result.stdout = (
                stdout_bytes.decode("utf-8", errors="replace")
                if stdout_bytes else ""
            )
            result.stderr = (
                stderr_bytes.decode("utf-8", errors="replace")
                if stderr_bytes else ""
            )
            result.exit_code = process.returncode or 0
            result.duration = time.time() - start_time

            # 判断执行结果
            if result.exit_code == 0:
                result.success = True
                # 调用子类钩子进行成功后的额外处理（如 Token 解析）
                self._on_success(result)
            else:
                result.error_message = (
                    f"命令退出码 {result.exit_code}: {result.stderr[:500]}"
                )

            # 流式输出回调（非流式模式下一次性回调全部 stdout）
            if stream_callback and result.stdout:
                stream_callback(result.stdout)

        except FileNotFoundError:
            result.error_message = f"找不到可执行文件: {self.executable}"
            result.duration = time.time() - start_time
            logger.error(result.error_message)
        except Exception as e:
            result.error_message = f"执行异常: {str(e)}"
            result.duration = time.time() - start_time
            logger.exception(f"{self.executable} 命令执行异常")
        finally:
            # 清理进程引用，确保 cancel() 不会对已完成的进程调用 kill()
            self._current_process = None

        return result

    async def execute_streaming(
        self,
        command: str,
        cwd: Optional[str] = None,
        timeout: Optional[int] = None,
        env: Optional[Dict[str, str]] = None,
        stream_callback: Optional[Callable] = None,
    ) -> BaseCLIResult:
        """
        流式执行 CLI 命令，逐行读取 stdout 并通过回调实时输出
        运行步骤：
          1. 调用 _build_full_command 构建完整命令行
          2. 调用 _get_process_env 构建进程环境变量
          3. 通过 asyncio.create_subprocess_shell 创建子进程
          4. 逐行读取 stdout，每行立即回调 stream_callback(line)
          5. 后台异步读取 stderr
          6. 进程结束后回调 stream_callback(None) 表示完成
          7. 成功时调用 _on_success 钩子
        参数：
          - command: 要执行的命令字符串（不含可执行文件名与全局标志）
          - cwd: 工作目录
          - timeout: 超时时间（None 则使用默认值）
          - env: 环境变量字典
          - stream_callback: 流式输出回调函数，接收 (line: str | None)
                              line 为 None 时表示输出完成
        返回值：BaseCLIResult 对象
        """
        timeout = timeout or self.default_timeout
        start_time = time.time()
        result = self._create_result()
        all_stdout = []
        all_stderr = []

        try:
            # 构建完整命令行
            full_cmd = self._build_full_command(command)
            # 合并环境变量
            process_env = self._get_process_env(env)

            # 创建子进程
            process = await asyncio.create_subprocess_shell(
                full_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
                env=process_env,
            )
            # v1.2.1 修复：保存进程引用，使 cancel() 能在流式路径下终止子进程
            self._current_process = process

            async def read_stderr():
                """
                后台读取 stderr，避免进程阻塞
                """
                while True:
                    line = await process.stderr.readline()
                    if not line:
                        break
                    all_stderr.append(line.decode("utf-8", errors="replace"))

            # 启动后台 stderr 读取任务
            stderr_task = asyncio.create_task(read_stderr())

            try:
                # 逐行读取 stdout，实时回调
                while True:
                    line_bytes = await asyncio.wait_for(
                        process.stdout.readline(), timeout=timeout
                    )
                    if not line_bytes:
                        break
                    line = line_bytes.decode("utf-8", errors="replace")
                    all_stdout.append(line)
                    if stream_callback:
                        # 同步回调，确保顺序；支持异步回调
                        maybe_coro = stream_callback(line)
                        if asyncio.iscoroutine(maybe_coro):
                            await maybe_coro

                # 等待 stderr 读取完成
                await stderr_task
                await process.wait()

            except asyncio.TimeoutError:
                # 超时处理：终止进程
                logger.error(
                    f"{self.executable} 流式命令超时 ({timeout}s)，正在终止进程..."
                )
                process.kill()
                await process.wait()
                stderr_task.cancel()
                result.error_message = f"命令执行超时 ({timeout}s)"
                result.duration = time.time() - start_time
                if stream_callback:
                    maybe_coro = stream_callback(None)
                    if asyncio.iscoroutine(maybe_coro):
                        await maybe_coro
                return result

            # 组装结果
            result.stdout = "".join(all_stdout)
            result.stderr = "".join(all_stderr)
            result.exit_code = process.returncode or 0
            result.duration = time.time() - start_time

            if result.exit_code == 0:
                result.success = True
                # 调用子类钩子进行成功后的额外处理
                self._on_success(result)
            else:
                result.error_message = (
                    f"命令退出码 {result.exit_code}: {result.stderr[:500]}"
                )

            # 通知流式输出完成
            if stream_callback:
                maybe_coro = stream_callback(None)
                if asyncio.iscoroutine(maybe_coro):
                    await maybe_coro

        except FileNotFoundError:
            result.error_message = f"找不到可执行文件: {self.executable}"
            result.duration = time.time() - start_time
            logger.error(result.error_message)
            if stream_callback:
                maybe_coro = stream_callback(None)
                if asyncio.iscoroutine(maybe_coro):
                    await maybe_coro
        except Exception as e:
            result.error_message = f"执行异常: {str(e)}"
            result.duration = time.time() - start_time
            logger.exception(f"{self.executable} 流式命令执行异常")
            if stream_callback:
                maybe_coro = stream_callback(None)
                if asyncio.iscoroutine(maybe_coro):
                    await maybe_coro
        finally:
            # v1.2.1 修复：清理进程引用，确保 cancel() 不会对已完成的进程调用 kill()
            self._current_process = None

        return result
