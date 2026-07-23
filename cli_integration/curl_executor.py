"""
# ============================================================
# CLI 集成层 - Curl 直连 LLM API 执行器
# ============================================================
# 核心作用：通过 curl 直接调用 volcengine LLM API，替代崩溃的
#           claude.exe 子进程调用。绕开 stack smashing 段错误，
#           走标准 HTTP 调用以支持 1MB 级别的长 prompt。
# 运行流程：
#   1. execute(prompt, model, max_tokens) 接收用户消息
#   2. 将 prompt + model + max_tokens 写入 JSON 临时文件
#   3. 通过 curl -d @file 推送 POST 请求到 volcengine 端点
#   4. 解析 OpenAI 格式响应，提取 choices[0].message.content
#   5. 将 usage 信息回填到 CLIResult.tokens_consumed
#   6. 清理临时文件
# 输入参数：
#   - prompt: str，用户消息内容
#   - model: Optional[str]，模型名，默认从 cli_env 读取或 deepseek-v4-flash
#   - max_tokens: Optional[int]，单次响应 token 上限，默认 16384 (v1.0.1 修复)
#   - timeout: Optional[int]，HTTP 超时时间（秒）
# 输出结果：CLIResult 对象，包含 stdout（已解析的助手内容）、token_usage
# ============================================================
# 修改记录：
#   版本 1.0.0 | 2026-07-23 | 初始创建，替代崩溃的 claude.exe
#                              通过 curl + volcengine API 直接调用 LLM
#                              支持 deepseek-v4-flash / deepseek-v4-pro 等模型
#                              自动从 ~/.claude/settings.json 加载兜底 token
#                              临时 payload 文件自动清理
#   版本 1.0.1 | 2026-07-23 | Bug 1 修复：DEFAULT_MAX_TOKENS 由 4096
#                              提升至 16384，解决架构设计等长文档生成
#                              被截断的问题
# ============================================================
"""

import json
import logging
import os
import shlex
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from cli_integration.base_executor import BaseCLIExecutor
from cli_integration.executor import CLIResult

logger = logging.getLogger(__name__)


@dataclass
class CurlLLMResult(CLIResult):
    """
    CurlLLMExecutor 专用结果对象
    扩展字段说明：
      - token_usage: 详细的 Token 用量拆分（prompt / completion / total）
    继承字段说明：
      - stdout: 助手回复内容（已从 JSON choices[0].message.content 提取）
      - stderr: 标准错误输出
      - exit_code: 进程退出码
      - duration: 执行耗时（秒）
      - success: 是否成功
      - error_message: 错误信息
      - tokens_consumed: 总 Token 消耗（=prompt_tokens + completion_tokens）
    """
    token_usage: Optional[Dict[str, int]] = None


class CurlLLMExecutor(BaseCLIExecutor):
    """
    通过 curl 直接调用 volcengine LLM API 的执行器
    作用：替代崩溃的 claude.exe，提供稳定的大模型调用入口
    端点：https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions
    协议：OpenAI Chat Completions 兼容格式
    认证：Authorization: Bearer <ANTHROPIC_AUTH_TOKEN>
    继承：BaseCLIExecutor，复用其 subprocess / 超时 / 重试 / env 合并逻辑
    调用方：main.py 中根据 config.cli.executable 选择实例化
    """

    # ============================================================
    # 类级别常量
    # ============================================================
    DEFAULT_ENDPOINT = "https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions"
    DEFAULT_MODEL = "deepseek-v4-flash"
    # v5.5.0 修复：从 4096 提升到 16384，避免架构设计等长文档生成时被截断
    # 架构设计四文档（spec/checklist/task/acceptance）单文档可能达 8K-12K tokens
    DEFAULT_MAX_TOKENS = 16384

    def __init__(
        self,
        executable: str = "curl",
        default_timeout: int = 600,
        max_retries: int = 3,
        retry_base_delay: int = 2,
        cli_env: Optional[Dict[str, str]] = None,
        agent_id: Optional[str] = None,
        name: str = "curl-llm-executor",
    ):
        """
        初始化 CurlLLMExecutor
        参数：
          - executable: curl 可执行文件名，默认 "curl"（标准 Linux 二进制）
          - default_timeout: 默认超时时间（秒），默认 600
          - max_retries: 最大重试次数，默认 3
          - retry_base_delay: 重试基础延迟（秒），指数递增，默认 2
          - cli_env: CLI 配置环境变量（必须含 ANTHROPIC_AUTH_TOKEN）
          - agent_id: 智能体 ID（用于日志关联）
          - name: 执行器名称（用于日志标识）
        """
        super().__init__(
            executable=executable,
            default_timeout=default_timeout,
            max_retries=max_retries,
            retry_base_delay=retry_base_delay,
            cli_env=cli_env,
        )
        # 智能体/执行器标识（基类无此字段，单独保存）
        self.agent_id = agent_id
        self.name = name

        # 解析 LLM 端点 URL：自动补全 /v3/chat/completions 后缀
        raw_endpoint = self.cli_env.get("ANTHROPIC_BASE_URL", self.DEFAULT_ENDPOINT).rstrip("/")
        if raw_endpoint.endswith("/chat/completions"):
            self.endpoint = raw_endpoint
        elif raw_endpoint.endswith("/v3"):
            self.endpoint = raw_endpoint + "/chat/completions"
        else:
            self.endpoint = raw_endpoint + "/v3/chat/completions"

        # 解析模型名：去除火山引擎 [1m] 后缀
        raw_model = self.cli_env.get("ANTHROPIC_MODEL", self.DEFAULT_MODEL)
        if raw_model.endswith("[1m]"):
            raw_model = raw_model[:-4]
        self.model = raw_model

        # 解析认证 token：优先 cli_env，兜底从 ~/.claude/settings.json 加载
        self.auth_token = self.cli_env.get("ANTHROPIC_AUTH_TOKEN") or self._load_fallback_token()
        if not self.auth_token:
            logger.warning(
                "CurlLLMExecutor: ANTHROPIC_AUTH_TOKEN 未配置且 ~/.claude/settings.json "
                "中未找到兜底 token，execute() 将直接返回错误"
            )

        # 临时 payload 文件目录（避免污染工作目录）
        self._temp_dir = tempfile.gettempdir()

    # ============================================================
    # 兜底 token 加载
    # ============================================================

    def _load_fallback_token(self) -> str:
        """
        从 ~/.claude/settings.json 加载兜底 LLM token
        运行步骤：
          1. 检查 ~/.claude/settings.json 是否存在
          2. 解析 JSON 中的 env.ANTHROPIC_AUTH_TOKEN 字段
          3. 异常时静默返回空字符串
        返回值：token 字符串，加载失败则返回空
        """
        try:
            settings_path = Path.home() / ".claude" / "settings.json"
            if not settings_path.is_file():
                return ""
            with open(settings_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            env_block = data.get("env", {}) or {}
            token = env_block.get("ANTHROPIC_AUTH_TOKEN", "") or ""
            if token:
                logger.info(
                    f"CurlLLMExecutor: 从 {settings_path} 加载兜底 LLM token 成功"
                )
            return token
        except Exception as e:
            logger.warning(f"CurlLLMExecutor: 加载 ~/.claude/settings.json 失败: {e}")
            return ""

    # ============================================================
    # Payload 构造
    # ============================================================

    def _build_payload(
        self,
        prompt: str,
        model: Optional[str] = None,
        max_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        构造 OpenAI 格式的请求体
        参数：
          - prompt: 用户消息内容
          - model: 模型名（None 则使用 self.model）
          - max_tokens: 单次响应 token 上限（None 则使用默认 4096）
        返回值：请求体字典（含 model / max_tokens / messages）
        """
        return {
            "model": model or self.model,
            "max_tokens": max_tokens or self.DEFAULT_MAX_TOKENS,
            "messages": [{"role": "user", "content": prompt}],
        }

    def _write_payload_file(self, payload: Dict[str, Any]) -> str:
        """
        将请求体写入临时文件
        运行步骤：
          1. 生成唯一文件名（UUID 前 12 位）
          2. 写入 /tmp 目录，UTF-8 编码，ensure_ascii=False
          3. 返回绝对路径
        参数：
          - payload: 请求体字典
        返回值：临时文件绝对路径
        异常：写入失败时抛出 IOError
        """
        filename = f"llm_payload_{uuid.uuid4().hex[:12]}.json"
        path = os.path.join(self._temp_dir, filename)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        return path

    # ============================================================
    # 基类钩子方法重写
    # ============================================================

    def _build_full_command(
        self,
        command: str,
        model: Optional[str] = None,
        max_tokens: Optional[int] = None,
        **kwargs,
    ) -> str:
        """
        构建 curl 命令行
        设计说明：基类 _run_once 在调用本方法时只传 command（已是完整 curl 命令），
                  因此默认实现为 passthrough；外部如需从原始 prompt 构建，可显式
                  调用 _build_curl_command_from_prompt
        参数：
          - command: 完整 curl 命令（passthrough 模式）或原始 prompt
          - model: 模型名（仅在从 prompt 构造时使用）
          - max_tokens: token 上限（仅在从 prompt 构造时使用）
        返回值：完整 curl 命令行字符串
        """
        # passthrough 模式：基类调用时直接返回
        return command

    def _create_result(self) -> CurlLLMResult:
        """
        创建 CurlLLMResult 结果对象（含 token_usage 扩展字段）
        返回值：CurlLLMResult 实例
        """
        return CurlLLMResult()

    # ============================================================
    # 公共执行方法（重写基类以支持 prompt -> curl 命令的转换）
    # ============================================================

    async def execute(
        self,
        command: str,
        cwd: Optional[str] = None,
        timeout: Optional[int] = None,
        env: Optional[Dict[str, str]] = None,
        stream_callback: Optional[Callable] = None,
        model: Optional[str] = None,
        max_tokens: Optional[int] = None,
        **kwargs,
    ) -> CurlLLMResult:
        """
        执行 LLM 调用（重写基类以将 prompt 转为 curl HTTP 请求）
        运行步骤：
          1. 校验认证 token，缺失则返回错误结果
          2. 构造请求体 JSON 并写入临时文件
          3. 构建 curl POST 命令
          4. 委托基类 execute() 执行（含重试 / 超时 / env 合并）
          5. 解析 JSON 响应，提取 content 和 usage
          6. 清理临时文件
        参数：
          - command: 用户消息内容（prompt）
          - cwd: 工作目录
          - timeout: HTTP 超时（秒）
          - env: 额外环境变量
          - stream_callback: 流式回调（本执行器不支持流式，忽略）
          - model: 覆盖默认模型
          - max_tokens: 覆盖默认 token 上限
        返回值：CurlLLMResult 对象
        """
        start_time = time.time()
        result = self._create_result()
        result.command = command  # type: ignore[attr-defined]

        # 校验 token
        if not self.auth_token:
            result.error_message = "ANTHROPIC_AUTH_TOKEN 未设置，无法调用 LLM"
            result.stderr = "ERROR: missing ANTHROPIC_AUTH_TOKEN"
            result.exit_code = -1
            result.success = False
            result.duration = time.time() - start_time
            logger.error("CurlLLMExecutor: 缺少认证 token，跳过执行")
            return result

        # 构造 payload 并写入临时文件
        payload_path: Optional[str] = None
        try:
            payload = self._build_payload(command, model=model, max_tokens=max_tokens)
            payload_path = self._write_payload_file(payload)

            # 构建 curl 命令（每个进程独立路径）
            effective_timeout = int(timeout or self.default_timeout)
            curl_cmd = self._build_curl_command(payload_path, effective_timeout)

            logger.info(
                f"CurlLLMExecutor[{self.name}]: POST {self.endpoint} "
                f"model={payload['model']} max_tokens={payload['max_tokens']} "
                f"prompt_len={len(command)}"
            )

            # 委托基类执行（基类负责重试 / 超时 / env 合并 / subprocess）
            # 基类 _run_once 会调用 _build_full_command(curl_cmd) -> passthrough 返回原命令
            result = await super().execute(
                curl_cmd,
                cwd=cwd,
                timeout=timeout,
                env=env,
                stream_callback=stream_callback,
            )

            # 解析 curl 输出（OpenAI 格式 JSON）
            self._parse_response(result)

        except FileNotFoundError as e:
            result.error_message = f"curl 可执行文件未找到: {e}"
            result.success = False
            logger.error(result.error_message)
        except Exception as e:
            result.error_message = f"CurlLLMExecutor 执行异常: {e}"
            result.success = False
            logger.exception("CurlLLMExecutor 执行失败")
        finally:
            # 清理临时 payload 文件
            if payload_path and os.path.isfile(payload_path):
                try:
                    os.remove(payload_path)
                except OSError as e:
                    logger.warning(f"清理临时文件 {payload_path} 失败: {e}")
            # 重新计算耗时（覆盖基类的 duration，包含 JSON 解析时间）
            result.duration = time.time() - start_time

        return result

    # ============================================================
    # 内部辅助方法
    # ============================================================

    def _build_curl_command(self, payload_path: str, timeout: int) -> str:
        """
        构建完整的 curl POST 命令字符串
        参数：
          - payload_path: JSON 请求体文件路径
          - timeout: --max-time 参数值（秒）
        返回值：完整的 curl 命令字符串（已 shlex.quote）
        """
        quoted_path = shlex.quote(payload_path)
        quoted_url = shlex.quote(self.endpoint)
        quoted_content_type = shlex.quote("Content-Type: application/json")
        quoted_auth = shlex.quote(f"Authorization: Bearer {self.auth_token}")
        return (
            f"{self.executable} -sS -X POST "
            f"-H {quoted_content_type} "
            f"-H {quoted_auth} "
            f"--max-time {int(timeout)} "
            f"-d @{quoted_path} {quoted_url}"
        )

    def _parse_response(self, result: CurlLLMResult) -> None:
        """
        解析 curl 输出的 JSON 响应，填充到 result
        运行步骤：
          1. 检查 curl 退出码
          2. 解析 stdout 为 JSON
          3. 提取 choices[0].message.content
          4. 提取 usage.{prompt,completion,total}_tokens
          5. 设置 success / error_message / tokens_consumed / token_usage
        参数：
          - result: 基类返回的 CurlLLMResult（已被基类填充 stdout/stderr/exit_code）
        """
        # 优先检查 curl 进程退出码
        if result.exit_code != 0:
            result.success = False
            if not result.error_message:
                result.error_message = (
                    f"curl 退出码 {result.exit_code}: {result.stderr[:500]}"
                )
            return

        stdout_text = result.stdout or ""
        if not stdout_text.strip():
            result.success = False
            result.error_message = "LLM 响应为空"
            return

        # 解析 JSON
        try:
            data = json.loads(stdout_text)
        except json.JSONDecodeError as e:
            result.success = False
            result.error_message = (
                f"LLM 响应不是有效 JSON: {e}; raw={stdout_text[:500]}"
            )
            logger.error(f"CurlLLMExecutor: JSON 解析失败: {result.error_message}")
            return

        # 检查 OpenAI 格式错误响应
        if isinstance(data, dict) and "error" in data and "choices" not in data:
            err = data.get("error", {})
            err_msg = err.get("message", "unknown error") if isinstance(err, dict) else str(err)
            result.success = False
            result.error_message = f"LLM 返回错误: {err_msg}"
            result.stderr = json.dumps(err, ensure_ascii=False)
            logger.error(f"CurlLLMExecutor: LLM 错误响应: {err_msg}")
            return

        # 提取助手消息内容
        try:
            choices = data.get("choices", [])
            if not choices:
                raise IndexError("choices 为空")
            message = choices[0].get("message", {}) or {}
            content = message.get("content", "")
            if not content:
                raise ValueError("assistant content 为空")
        except (KeyError, IndexError, ValueError) as e:
            result.success = False
            result.error_message = f"LLM 响应字段缺失: {e}; raw={stdout_text[:500]}"
            logger.error(f"CurlLLMExecutor: {result.error_message}")
            return

        # 提取 usage
        usage_raw = data.get("usage", {}) or {}
        prompt_tokens = int(usage_raw.get("prompt_tokens", 0) or 0)
        completion_tokens = int(usage_raw.get("completion_tokens", 0) or 0)
        total_tokens = int(
            usage_raw.get("total_tokens", 0)
            or (prompt_tokens + completion_tokens)
        )

        # 回填结果
        result.stdout = content
        result.success = True
        result.error_message = ""
        result.tokens_consumed = total_tokens
        result.token_usage = {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
        }
        logger.info(
            f"CurlLLMExecutor[{self.name}]: 调用成功 "
            f"prompt={prompt_tokens} completion={completion_tokens} total={total_tokens}"
        )
