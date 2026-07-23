"""
# ============================================================
# Hermes 集成层 - Hermes CLI 命令执行器
# ============================================================
# 核心作用：封装 Hermes CLI 的 subprocess 调用，提供超时控制、
#           重试机制、对话交互、提示词优化、Claude Code CLI 实例管理
# 运行流程：
#   1. 接收用户消息或原始需求
#   2. 通过 subprocess 异步执行 Hermes CLI 命令
#   3. 支持超时控制、自动重试
#   4. 解析输出结果
#   5. 通过 AgentManager 管理 Claude Code CLI 子实例生命周期
# 输入参数：
#   - message: str，用户对话消息
#   - raw_prompt: str，待优化的原始需求
#   - name: str，Claude Code CLI 实例名称
# 输出结果：HermesResult 对象，包含 stdout、stderr、exit_code、duration
# ============================================================
# 修改记录：
#   版本 1.0.0 | 2026-06-17 | 初始创建，实现 Hermes CLI 封装
#   版本 1.0.1 | 2026-06-23 | 修复 CLI 参数错误：-p 改为 chat -q，--dangerously-skip-permissions 改为 --yolo，并追加 -Q 静默模式
#   版本 1.0.2 | 2026-06-23 | 过滤 Hermes CLI 启动 banner（tirith security scanner）与空行，避免污染前端 text 流
#   版本 2.0.0 | 2026-06-24 | 重构：继承 BaseCLIExecutor 基类，消除与 executor.py 的代码重复
#                               _build_full_command 添加 --yolo 前缀
#                               _get_process_env 设置 HERMES_HOME 环境变量
#                               _create_result 返回 HermesResult 对象
#                               execute / execute_streaming / _run_once 委托基类实现
#   版本 2.1.0 | 2026-06-29 | 修复：chat_streaming() 新增 system_prompt 可选参数，
#                               传入时使用 -p 模式（输出 thinking 标签），
#                               不传时降级 chat -q 模式（保持向后兼容）
#   版本 2.1.1 | 2026-06-30 | 修复回归：Hermes CLI 不支持 -p 参数（导致命令立即
#                               失败、无输出）。改为将 system_prompt 拼接进 chat -q
#                               的 query；移除 -Q 静默模式以保留 thinking 输出
#   版本 2.2.0 | 2026-06-30 | chat/chat_streaming/optimize_prompt 增加反引号/美元符号转义，防止 shell 命令替换注入
# ============================================================
"""

import asyncio
import os
import time
import logging
from dataclasses import dataclass
from typing import Optional, Dict, Any, Callable

from cli_integration.base_executor import BaseCLIExecutor, BaseCLIResult

logger = logging.getLogger(__name__)


@dataclass
class HermesResult(BaseCLIResult):
    """
    Hermes CLI 命令执行结果
    继承字段说明：
      - stdout: 标准输出内容（Hermes 回复文本）
      - stderr: 标准错误输出内容
      - exit_code: 进程退出码（0 表示成功）
      - duration: 执行耗时（秒）
      - success: 是否执行成功
      - error_message: 错误信息（失败时）
    """
    pass  # 无额外字段，所有字段均继承自 BaseCLIResult


class HermesExecutor(BaseCLIExecutor):
    """
    Hermes CLI 命令执行器
    作用：封装 Hermes CLI 的 subprocess 调用，提供对话、提示词优化、
          超时控制、重试机制，以及 Claude Code CLI 子实例管理
    调用方：HermesService、API 层
    被调用方：subprocess（Hermes CLI）、AgentManager（Claude Code CLI 实例管理）
    继承：BaseCLIExecutor（公共 subprocess 调用逻辑）
    """

    def __init__(
        self,
        executable: str = "hermes",
        default_timeout: int = 600,
        max_retries: int = 3,
        retry_base_delay: int = 2,
        cli_env: Optional[Dict[str, str]] = None,
        agent_manager: Optional[Any] = None,
    ):
        """
        初始化 Hermes CLI 执行器
        参数：
          - executable: Hermes CLI 可执行文件名，默认 "hermes"
          - default_timeout: 默认超时时间（秒），默认 600
          - max_retries: 最大重试次数，默认 3
          - retry_base_delay: 重试基础延迟（秒），指数递增，默认 2
          - cli_env: CLI 执行时的环境变量（火山引擎 API 配置等）
          - agent_manager: AgentManager 实例，用于管理 Claude Code CLI 子实例
        """
        super().__init__(
            executable=executable,
            default_timeout=default_timeout,
            max_retries=max_retries,
            retry_base_delay=retry_base_delay,
            cli_env=cli_env,
        )
        # AgentManager 实例引用，用于按需创建/销毁 Claude Code CLI 子实例
        self.agent_manager = agent_manager

    # ================================================================
    # 基类钩子方法重写
    # ================================================================

    def _build_full_command(self, command: str) -> str:
        """
        构建完整的 Hermes CLI 命令行
        格式：{executable} --yolo {command}
        参数：
          - command: 子类传入的原始命令字符串（不含可执行文件名与全局标志）
        返回值：完整的命令行字符串
        """
        return f"{self.executable} --yolo {command}"

    def _get_process_env(self, env: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        """
        构建 Hermes 进程环境变量
        运行步骤：
          1. 调用基类方法获取基础环境变量
          2. 设置 HERMES_HOME 指向可写的配置目录
        参数：
          - env: 调用方传入的额外环境变量
        返回值：合并后的环境变量字典
        """
        process_env = super()._get_process_env(env)
        # 设置 HERMES_HOME 指向可写的配置目录（~/.hermes 为只读文件系统）
        hermes_home = os.environ.get(
            "HERMES_HOME",
            os.path.expanduser("~/.local/share/hermes"),
        )
        process_env["HERMES_HOME"] = hermes_home
        return process_env

    def _create_result(self) -> HermesResult:
        """
        创建 HermesResult 结果对象
        返回值：HermesResult 实例
        """
        return HermesResult()

    # ================================================================
    # 对话交互方法（HermesExecutor 专有）
    # ================================================================

    async def chat(self, message: str, timeout: Optional[int] = None) -> HermesResult:
        """
        与 Hermes 进行对话交互
        运行步骤：
          1. 输入校验：检查消息是否为空
          2. 构建 Hermes 对话命令
          3. 调用基类 execute 方法执行
          4. 返回 Hermes 回复结果
        参数：
          - message: 用户对话消息文本
          - timeout: 超时时间（秒），None 则使用默认值
        返回值：HermesResult 对象，stdout 包含 Hermes 回复内容
        """
        # 输入合法性校验
        if not message or not message.strip():
            return HermesResult(
                error_message="对话消息不能为空",
            )

        logger.info(f"发送消息给 Hermes，消息长度: {len(message)} 字符")

        # 构建对话命令：使用 hermes chat -q 模式发送消息（-Q 抑制 banner/spinner/工具预览）
        # 转义双引号，防止命令注入
        # 转义反引号与美元符号，防止 shell 命令替换注入（如 `cmd` 和 $(cmd)）
        safe_message = message.replace('"', '\\"').replace('`', '\\`').replace('$', '\\$')
        command = f'chat -q "{safe_message}" -Q'

        # 执行命令（委托基类 execute 方法）
        result = await self.execute(command=command, timeout=timeout)
        return result

    async def chat_streaming(
        self,
        message: str,
        system_prompt: str = None,
        timeout: Optional[int] = None,
        stream_callback: Optional[Callable] = None,
    ) -> HermesResult:
        """
        与 Hermes 进行流式对话交互，实时输出思考过程和回答内容
        运行步骤：
          1. 输入校验：检查消息是否为空
          2. 构建 Hermes 对话命令（-p 模式支持 thinking 标签输出）
          3. 调用基类 execute_streaming 逐行执行
          4. 解析思考标签（ thinking），区分 thinking 和 text 内容
          5. 实时回调 stream_callback(type, content)
          6. 输出完成后回调 stream_callback("done", None)
        参数：
          - message: 用户对话消息文本
          - system_prompt: 系统提示词（可选），传入时使用 -p 模式确保 CLI 输出 thinking 标签
          - timeout: 超时时间（秒），None 则使用默认值
          - stream_callback: 流式回调，接收 (event_type: str, content: str | None)
                              event_type: "thinking" | "text" | "done" | "error"
        返回值：HermesResult 对象
        """
        if not message or not message.strip():
            if stream_callback:
                stream_callback("error", "对话消息不能为空")
            return HermesResult(error_message="对话消息不能为空")

        logger.info(f"流式发送消息给 Hermes，消息长度: {len(message)} 字符")

        # 构建流式对话命令
        # 注意：Hermes CLI 不支持 -p 参数（那是 Claude Code CLI 的参数）。
        # Hermes 仅支持 chat 子命令的 -q QUERY 单次查询模式。
        # 有 system_prompt 时将其拼接进 query；无则直接使用消息。
        # 不使用 -Q 静默模式，以保留 thinking 等中间输出。
        if system_prompt:
            full_query = f"{system_prompt}\n\n用户消息：{message}\n\n请用中文回复。"
            # 转义双引号、反引号、美元符号，防止 shell 命令替换注入
            safe_query = full_query.replace('"', '\\"').replace('`', '\\`').replace('$', '\\$')
            command = f'chat -q "{safe_query}"'
        else:
            # 转义双引号、反引号、美元符号，防止 shell 命令替换注入
            safe_message = message.replace('"', '\\"').replace('`', '\\`').replace('$', '\\$')
            command = f'chat -q "{safe_message}"'

        # 思考内容解析状态
        in_thinking = False
        thinking_buffer = []
        text_buffer = []

        # 构建行回调，用于区分 thinking 和 text 内容
        async def on_line(line: str | None):
            nonlocal in_thinking, thinking_buffer, text_buffer

            if line is None:
                # 输出完成
                if stream_callback:
                    stream_callback("done", None)
                return

            # 过滤 Hermes CLI 的启动 banner / 警告 / 装饰框线（写在 stdout，会被当作正文推送）
            # - tirith 安全扫描器提示（"⚠ tirith security scanner ..."）
            # - 纯空行 / 仅含空白字符的行
            # - chat -q 模式的元信息行（Query:/Initializing/Session:/Duration:/Messages:/Resume）
            # - 装饰框线（╭ ╮ ╰ ╯ │ ─ 等 box-drawing 字符）与分隔线
            stripped_line = line.strip()
            if not stripped_line:
                return
            if stripped_line.startswith("⚠") or "tirith security scanner" in stripped_line:
                logger.debug(f"过滤 Hermes banner/warning 行: {stripped_line!r}")
                return
            # 过滤 chat -q 模式的元信息行
            _meta_prefixes = (
                "Query:", "Initializing agent", "Resume this session",
                "hermes --resume", "Session:", "Duration:", "Messages:",
            )
            if stripped_line.startswith(_meta_prefixes):
                logger.debug(f"过滤 Hermes 元信息行: {stripped_line!r}")
                return
            # 过滤纯装饰框线 / 分隔线（仅由 box-drawing 字符、横线、⚕ Hermes 标题组成）
            if all(ch in "╭╮╰╯│─-═╔╗╚╝ ⚕Hermes" for ch in stripped_line):
                logger.debug(f"过滤 Hermes 装饰框线: {stripped_line!r}")
                return
            # 去除正文行两侧的框线竖线（"│ 内容 │" → "内容"）
            line = line.replace("│", "")

            # 检测  thinking 标签
            # 支持 <thinking>、 thinking、</thinking>、 thinking 等格式
            import re

            # 查找所有 thinking 标签
            parts = re.split(r'(</?thinking\s*>)', line, flags=re.IGNORECASE)

            for part in parts:
                if re.match(r'<thinking\s*>', part, re.IGNORECASE):
                    # 开始思考
                    in_thinking = True
                    continue
                elif re.match(r'</thinking\s*>', part, re.IGNORECASE):
                    # 结束思考，flush thinking buffer
                    if thinking_buffer and stream_callback:
                        stream_callback("thinking", "".join(thinking_buffer))
                        thinking_buffer = []
                    in_thinking = False
                    continue

                if in_thinking:
                    thinking_buffer.append(part)
                else:
                    text_buffer.append(part)

            # 实时 flush text buffer（每行 flush 一次）
            if text_buffer and stream_callback:
                stream_callback("text", "".join(text_buffer))
                text_buffer = []

        # 执行流式命令（委托基类 execute_streaming 方法）
        result = await self.execute_streaming(
            command=command,
            timeout=timeout,
            stream_callback=on_line,
        )

        # flush 剩余缓冲区
        if thinking_buffer and stream_callback:
            stream_callback("thinking", "".join(thinking_buffer))
        if text_buffer and stream_callback:
            stream_callback("text", "".join(text_buffer))

        # 确保发送 done
        if stream_callback and result.success:
            stream_callback("done", None)

        return result

    async def optimize_prompt(
        self, raw_prompt: str, timeout: Optional[int] = None
    ) -> HermesResult:
        """
        调用 Hermes 进行提示词优化
        运行步骤：
          1. 输入校验：检查原始需求是否为空
          2. 构建提示词优化命令
          3. 调用基类 execute 方法执行
          4. 返回优化后的结构化指令
        参数：
          - raw_prompt: 用户原始需求文本
          - timeout: 超时时间（秒），None 则使用默认值
        返回值：HermesResult 对象，stdout 包含优化后的提示词
        """
        # 输入合法性校验
        if not raw_prompt or not raw_prompt.strip():
            return HermesResult(
                error_message="待优化的需求文本不能为空",
            )

        logger.info(f"开始提示词优化，原始需求长度: {len(raw_prompt)} 字符")

        # 构建提示词优化命令
        # 转义双引号、反引号、美元符号，防止 shell 命令替换注入
        safe_prompt = raw_prompt.replace('"', '\\"').replace('`', '\\`').replace('$', '\\$')
        command = (
            f'chat -q "你是一个专业的提示词工程优化专家。请对以下用户需求进行优化，'
            f'将其转化为结构化、高质量的任务指令。\n\n'
            f'原始需求：\n{safe_prompt}\n\n'
            f'请按以下格式输出优化结果：\n'
            f'## 优化后的任务指令\n'
            f'[将原始需求转化为清晰、具体、可执行的结构化指令]\n\n'
            f'## 任务模块分解\n'
            f'- 模块1: [名称] - [简要描述]\n'
            f'- 模块2: [名称] - [简要描述]\n'
            f'...\n\n'
            f'## 约束条件\n'
            f'- [约束1]\n'
            f'- [约束2]\n'
            f'...\n\n'
            f'## 技术建议\n'
            f'[提供技术栈、架构方面的建议]" -Q'
        )

        # 执行命令（委托基类 execute 方法）
        result = await self.execute(command=command, timeout=timeout)
        return result

    # ================================================================
    # Claude Code CLI 实例管理（HermesExecutor 专有）
    # ================================================================

    async def create_claude_instance(self, name: str) -> Optional[Any]:
        """
        通过 AgentManager 动态创建 Claude Code CLI 子实例
        运行步骤：
          1. 检查 agent_manager 是否已初始化
          2. 调用 agent_manager.register_agent 创建实例
          3. 返回创建的 AgentInfo 对象
        参数：
          - name: 新创建的 Claude Code CLI 实例名称
        返回值：AgentInfo 对象，创建失败返回 None
        """
        if self.agent_manager is None:
            logger.error("AgentManager 未初始化，无法创建 Claude Code CLI 实例")
            return None

        logger.info(f"Hermes 请求创建 Claude Code CLI 实例: {name}")
        agent_info = await self.agent_manager.register_agent(
            name=name,
            cli_path="claude",
            workspace="",
            max_concurrent=5,
        )
        logger.info(f"Claude Code CLI 实例已创建: {agent_info.name} (ID: {agent_info.id[:8]}...)")
        return agent_info

    async def destroy_claude_instance(self, agent_id: str) -> bool:
        """
        通过 AgentManager 销毁 Claude Code CLI 子实例
        运行步骤：
          1. 检查 agent_manager 是否已初始化
          2. 调用 agent_manager.unregister_agent 销毁实例
          3. 返回销毁结果
        参数：
          - agent_id: 要销毁的 Claude Code CLI 实例 ID
        返回值：是否成功销毁
        """
        if self.agent_manager is None:
            logger.error("AgentManager 未初始化，无法销毁 Claude Code CLI 实例")
            return False

        logger.info(f"Hermes 请求销毁 Claude Code CLI 实例: {agent_id[:8]}...")
        success = await self.agent_manager.unregister_agent(agent_id)
        if success:
            logger.info(f"Claude Code CLI 实例已销毁: {agent_id[:8]}...")
        else:
            logger.warning(f"Claude Code CLI 实例不存在或已销毁: {agent_id[:8]}...")
        return success

    def cancel(self) -> bool:
        """
        终止当前正在运行的 Hermes CLI 子进程（v2.1.0 新增）
        作用：委托父类 BaseCLIExecutor.cancel() 终止子进程，供前端停止按钮调用
        返回值：bool，True 表示成功终止，False 表示无进程可终止或终止失败
        调用方：后端 /api/hermes/stop 端点
        被调用方：BaseCLIExecutor.cancel()
        """
        return super().cancel()
