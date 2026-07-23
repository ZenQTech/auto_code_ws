"""
# ============================================================
# Claude Code CLI 集成层 - CLI 命令执行器
# ============================================================
# 核心作用：封装 subprocess 调用，提供超时控制、重试机制、
#           流式输出和标准化结果解析
# 运行流程：
#   1. 接收命令模板和参数
#   2. 构建完整的 CLI 命令
#   3. 通过 subprocess 异步执行
#   4. 支持超时控制、自动重试
#   5. 解析输出结果，提取 Token 消耗等元信息
# 输入参数：
#   - command: str，要执行的 CLI 命令
#   - cwd: str，工作目录
#   - timeout: int，超时时间（秒）
#   - env: dict，环境变量
# 输出结果：CLIResult 对象，包含 stdout、stderr、exit_code、duration、tokens
# ============================================================
# 修改记录：
#   版本 1.0.0 | 2026-06-17 | 初始创建，实现 Claude Code CLI 封装
#   版本 2.0.0 | 2026-06-24 | 重构：继承 BaseCLIExecutor 基类，消除与 hermes_executor.py 的代码重复
#                               _build_full_command 添加 --dangerously-skip-permissions 前缀
#                               _on_success 钩子处理 Token 解析与用量记录
#                               _create_result 返回 CLIResult 对象
#                               execute / execute_streaming / _run_once 委托基类实现
# ============================================================
"""

import logging
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, Callable

from cli_integration.base_executor import BaseCLIExecutor, BaseCLIResult

logger = logging.getLogger(__name__)


@dataclass
class CLIResult(BaseCLIResult):
    """
    CLI 命令执行结果
    扩展字段说明：
      - tokens_consumed: 估算的 Token 消耗量
    继承字段说明：
      - stdout: 标准输出内容
      - stderr: 标准错误输出内容
      - exit_code: 进程退出码（0 表示成功）
      - duration: 执行耗时（秒）
      - success: 是否执行成功
      - error_message: 错误信息（失败时）
    """
    tokens_consumed: int = 0


class CLIExecutor(BaseCLIExecutor):
    """
    CLI 命令执行器
    作用：封装 Claude Code CLI 的 subprocess 调用，提供超时、重试、流式输出
    调用方：AgentManager、TaskExecutor
    被调用方：无（底层工具）
    继承：BaseCLIExecutor（公共 subprocess 调用逻辑）
    """

    def __init__(
        self,
        executable: str = "claude",
        default_timeout: int = 600,
        max_retries: int = 3,
        retry_base_delay: int = 2,
        cli_env: Optional[Dict[str, str]] = None,
    ):
        """
        初始化 CLI 执行器
        参数：
          - executable: Claude Code CLI 可执行文件名，默认 "claude"
          - default_timeout: 默认超时时间（秒），默认 600
          - max_retries: 最大重试次数，默认 3
          - retry_base_delay: 重试基础延迟（秒），指数递增，默认 2
          - cli_env: CLI 执行时的环境变量（火山引擎 API 配置等）
        """
        super().__init__(
            executable=executable,
            default_timeout=default_timeout,
            max_retries=max_retries,
            retry_base_delay=retry_base_delay,
            cli_env=cli_env,
        )

    # ================================================================
    # 基类钩子方法重写
    # ================================================================

    def _build_full_command(self, command: str) -> str:
        """
        构建完整的 Claude Code CLI 命令行
        格式：{executable} --dangerously-skip-permissions {command}
        参数：
          - command: 子类传入的原始命令字符串（不含可执行文件名与全局标志）
        返回值：完整的命令行字符串
        """
        return f"{self.executable} --dangerously-skip-permissions {command}"

    def _create_result(self) -> CLIResult:
        """
        创建 CLIResult 结果对象
        返回值：CLIResult 实例（含 tokens_consumed 字段）
        """
        return CLIResult()

    def _on_success(self, result: CLIResult):
        """
        执行成功后的处理：解析 Token 用量并记录 API 调用
        运行步骤：
          1. 从 stderr/stdout 中解析真实 Token 用量
          2. 解析失败则回退到字符估算
          3. 记录 API 调用到用量监控器
        参数：
          - result: CLIResult 对象
        """
        result.tokens_consumed = self._parse_token_usage(result.stderr, result.stdout)
        self._record_usage_call()

    # ================================================================
    # TOKEN 用量解析（CLIExecutor 专有）
    # ================================================================

    def _parse_token_usage(self, stderr: str, stdout: str) -> int:
        """
        从 Claude Code CLI 输出中解析真实 Token 用量
        运行步骤：
          1. 在 stderr 中搜索 Token 用量模式（如 "Input tokens: N, Output tokens: M"）
          2. 在 stdout 中搜索 Token 用量模式
          3. 提取 input_tokens + output_tokens 总和
          4. 解析失败则回退到字符估算
        参数：
          - stderr: 标准错误输出
          - stdout: 标准输出
        返回值：解析出的 Token 数量，解析失败则返回估算值
        """
        import re

        combined = stderr + "\n" + stdout

        # 模式 1: "Input tokens: 1234, Output tokens: 567"
        input_match = re.search(r'[Ii]nput\s+tokens?[:\s]*(\d[\d,]*)', combined)
        output_match = re.search(r'[Oo]utput\s+tokens?[:\s]*(\d[\d,]*)', combined)
        if input_match or output_match:
            input_tokens = int(input_match.group(1).replace(",", "")) if input_match else 0
            output_tokens = int(output_match.group(1).replace(",", "")) if output_match else 0
            total = input_tokens + output_tokens
            if total > 0:
                logger.debug(f"解析到 Token 用量: input={input_tokens}, output={output_tokens}, total={total}")
                return total

        # 模式 2: "Token usage: 1234" 或 "tokens: 1234"
        token_match = re.search(r'[Tt]okens?(?:\s+usage)?[:\s]*(\d[\d,]*)', combined)
        if token_match:
            total = int(token_match.group(1).replace(",", ""))
            if total > 0:
                logger.debug(f"解析到 Token 用量: total={total}")
                return total

        # 模式 3: "Total tokens: 1234"
        total_match = re.search(r'[Tt]otal\s+tokens?[:\s]*(\d[\d,]*)', combined)
        if total_match:
            total = int(total_match.group(1).replace(",", ""))
            if total > 0:
                logger.debug(f"解析到 Token 用量: total={total}")
                return total

        # 回退：基于字符数估算
        estimated = self._estimate_tokens(stdout)
        logger.debug(f"未解析到 Token 用量，使用估算值: {estimated}")
        return estimated

    def _estimate_tokens(self, text: str) -> int:
        """
        估算文本的 Token 消耗量
        运行步骤：
          1. 按空格分词（粗略估算）
          2. 乘以系数 1.3（考虑 tokenization 开销）
        参数：
          - text: 输入文本
        返回值：估算的 Token 数量
        """
        if not text:
            return 0
        # 粗略估算：英文约 1 token ≈ 0.75 词，中文约 1 token ≈ 1.5 字符
        words = len(text.split())
        chars = len(text)
        # 混合估算
        return max(int(words * 1.3), int(chars / 2))

    def _record_usage_call(self):
        """
        记录一次 API 调用到用量监控器
        运行步骤：
          1. 尝试导入 usage_monitor 单例
          2. 调用 record_api_call() 记录时间戳
        注意：导入失败时静默忽略（用量监控为可选模块）
        """
        try:
            from backend.app.services.usage_monitor import usage_monitor
            usage_monitor.record_api_call()
        except ImportError:
            pass  # 用量监控模块未加载时静默忽略
