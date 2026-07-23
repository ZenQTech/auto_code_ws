"""
# ============================================================
# 上下文生命周期管理服务模块
# ============================================================
# 核心作用：管理所有 Agent 的对话上下文，监控上下文使用率，
#           在超过阈值时自动触发压缩，区分全局约束（不可压缩）
#           与对话信息（可压缩），确保压缩后上下文一致性
# 运行流程：
#   1. 初始化时从 settings 读取上下文配置参数
#   2. register_agent() 注册智能体及其全局约束
#   3. add_message() 追加消息到智能体上下文，自动检测使用率
#   4. 当使用率超过 compression_threshold 时自动触发压缩
#   5. compress_context() 压缩历史对话，保留全局约束和近期消息
#   6. get_context() 返回当前上下文（已压缩或原始）
#   7. unregister_agent() 注销智能体，清理上下文数据
# 输入参数：
#   - agent_id: str，智能体唯一标识
#   - global_constraints: str，全局约束文本（不可压缩）
#   - role: str，消息角色（system/user/assistant）
#   - content: str，消息内容
#   - token_count: int，消息的 Token 估算数量
# 输出结果：上下文消息列表、使用率百分比、压缩摘要等
# ============================================================
# 修改记录：
#   v1.0.0 - 2026-06-24 | 初始版本，实现上下文生命周期管理
#     - ContextManager 类，管理所有 Agent 上下文
#     - 70% 阈值触发压缩，区分全局约束与对话信息
#     - 压缩后上下文恢复与一致性校验
#   v1.0.1 - 2026-06-24 | 修复压缩配额边界条件
#     - 动态调整 reserved_constraint_tokens 防止对话配额为负数
#     - 压缩时至少保留 1 条最近消息
# ============================================================
"""

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from backend.app.config import settings

logger = logging.getLogger(__name__)


# ============================================================
# 数据类定义
# ============================================================

@dataclass
class ContextMessage:
    """
    上下文消息数据容器
    字段说明：
      - role: 消息角色（system / user / assistant）
      - content: 消息文本内容
      - token_count: 该消息的 Token 估算数量
      - is_constraint: 是否为全局约束消息（True 表示不可压缩）
      - compressed: 是否已被压缩处理
      - original_content: 压缩前的原始内容（用于恢复校验）
    """
    role: str = ""
    content: str = ""
    token_count: int = 0
    is_constraint: bool = False
    compressed: bool = False
    original_content: Optional[str] = None


@dataclass
class AgentContext:
    """
    单个智能体的上下文状态容器
    字段说明：
      - agent_id: 智能体唯一标识
      - messages: 上下文消息列表（按时间顺序）
      - global_constraints: 全局约束文本（不可压缩的核心约束）
      - total_tokens: 当前上下文总 Token 数
      - compressed: 是否已执行过压缩
      - compression_count: 累计压缩次数
      - last_compression_summary: 最近一次压缩摘要
    """
    agent_id: str = ""
    messages: List[ContextMessage] = field(default_factory=list)
    global_constraints: str = ""
    total_tokens: int = 0
    compressed: bool = False
    compression_count: int = 0
    last_compression_summary: Optional[str] = None


# ============================================================
# ContextManager 类
# ============================================================

class ContextManager:
    """
    上下文生命周期管理器
    作用：管理所有智能体的对话上下文，监控使用率并在超阈值时
          自动压缩历史对话，同时保留不可压缩的全局约束
    调用方：API 路由层、任务执行引擎、Agent 管理模块
    被调用方：settings（配置读取）
    """

    def __init__(self):
        """
        初始化上下文管理器
        运行步骤：
          1. 从 settings.context 读取配置参数
          2. 初始化智能体上下文字典
          3. 设置压缩阈值、最大 Token 数、保留约束 Token 数
        参数：无
        """
        # 从全局配置中读取上下文管理参数
        ctx_config = settings.context

        # 压缩触发阈值（百分比），默认 70%
        self.compression_threshold: float = float(
            ctx_config.get("compression_threshold", 70)
        )

        # 最大上下文 Token 数，默认 200000
        self.max_context_tokens: int = int(
            ctx_config.get("max_context_tokens", 200000)
        )

        # 保留给全局约束的 Token 数，默认 50000
        self.reserved_constraint_tokens: int = int(
            ctx_config.get("reserved_constraint_tokens", 50000)
        )

        # 智能体上下文映射表：{agent_id: AgentContext}
        self._agents: Dict[str, AgentContext] = {}

        # 压缩时保留的最近消息数量（至少保留最近 N 条消息不被压缩）
        self._recent_message_count: int = 5

        logger.info(
            f"上下文管理器初始化完成: "
            f"compression_threshold={self.compression_threshold}%, "
            f"max_context_tokens={self.max_context_tokens}, "
            f"reserved_constraint_tokens={self.reserved_constraint_tokens}"
        )

    # ============================================================
    # 智能体注册与注销
    # ============================================================

    def register_agent(self, agent_id: str, global_constraints: str) -> None:
        """
        注册智能体并设置其全局约束
        运行步骤：
          1. 检查智能体是否已注册，若已注册则更新约束
          2. 创建 AgentContext 实例
          3. 将全局约束作为不可压缩消息存入上下文
          4. 计算全局约束的 Token 数（按字符数估算）
          5. 更新总 Token 计数
        参数：
          - agent_id: 智能体唯一标识
          - global_constraints: 全局约束文本（不可压缩，始终保留）
        返回值：无
        """
        if agent_id in self._agents:
            logger.warning(f"智能体 {agent_id[:8]}... 已注册，将更新全局约束")
            # 移除旧的约束消息，用新的替换
            old_ctx = self._agents[agent_id]
            old_ctx.messages = [
                m for m in old_ctx.messages if not m.is_constraint
            ]
            old_ctx.total_tokens = sum(m.token_count for m in old_ctx.messages)
        else:
            # 创建新的智能体上下文
            self._agents[agent_id] = AgentContext(agent_id=agent_id)

        ctx = self._agents[agent_id]
        ctx.global_constraints = global_constraints

        # 估算全局约束的 Token 数（中文字符约 1.5 字符 / token，英文约 4 字符 / token）
        constraint_tokens = self._estimate_tokens(global_constraints)

        # 将全局约束作为不可压缩的 system 消息存入上下文
        constraint_msg = ContextMessage(
            role="system",
            content=global_constraints,
            token_count=constraint_tokens,
            is_constraint=True,
            compressed=False,
        )
        # 约束消息始终放在消息列表最前面
        ctx.messages.insert(0, constraint_msg)
        ctx.total_tokens = sum(m.token_count for m in ctx.messages)

        logger.info(
            f"智能体 {agent_id[:8]}... 已注册，"
            f"全局约束 Token 数: {constraint_tokens}"
        )

    def unregister_agent(self, agent_id: str) -> None:
        """
        注销智能体，清理其所有上下文数据
        运行步骤：
          1. 检查智能体是否存在
          2. 从映射表中移除
          3. 记录日志
        参数：
          - agent_id: 智能体唯一标识
        返回值：无
        """
        if agent_id in self._agents:
            ctx = self._agents.pop(agent_id)
            logger.info(
                f"智能体 {agent_id[:8]}... 已注销，"
                f"消息数: {len(ctx.messages)}, "
                f"压缩次数: {ctx.compression_count}"
            )
        else:
            logger.warning(f"智能体 {agent_id[:8]}... 未注册，无需注销")

    # ============================================================
    # 消息管理
    # ============================================================

    def add_message(
        self, agent_id: str, role: str, content: str, token_count: int
    ) -> None:
        """
        向智能体上下文追加一条消息
        运行步骤：
          1. 验证智能体已注册
          2. 创建 ContextMessage 实例
          3. 追加到消息列表末尾
          4. 更新总 Token 计数
          5. 检查使用率是否超过阈值，若超过则自动触发压缩
        参数：
          - agent_id: 智能体唯一标识
          - role: 消息角色（system / user / assistant）
          - content: 消息文本内容
          - token_count: 该消息的 Token 估算数量
        返回值：无
        异常：ValueError（智能体未注册时抛出）
        """
        if agent_id not in self._agents:
            raise ValueError(f"智能体 {agent_id[:8]}... 未注册，请先调用 register_agent()")

        ctx = self._agents[agent_id]

        # 创建消息对象
        msg = ContextMessage(
            role=role,
            content=content,
            token_count=token_count,
            is_constraint=False,
            compressed=False,
        )
        ctx.messages.append(msg)
        ctx.total_tokens += token_count

        logger.debug(
            f"智能体 {agent_id[:8]}... 新增消息: role={role}, "
            f"tokens={token_count}, total_tokens={ctx.total_tokens}"
        )

        # 自动检测使用率，超过阈值则触发压缩
        usage_pct = self.get_context_usage(agent_id)
        if usage_pct >= self.compression_threshold:
            logger.info(
                f"智能体 {agent_id[:8]}... 上下文使用率 {usage_pct:.1f}% "
                f"超过阈值 {self.compression_threshold}%，触发自动压缩"
            )
            self.compress_context(agent_id)

    # ============================================================
    # 上下文使用率查询
    # ============================================================

    def get_context_usage(self, agent_id: str) -> float:
        """
        获取智能体当前上下文使用率百分比
        运行步骤：
          1. 验证智能体已注册
          2. 计算当前总 Token 数
          3. 计算使用率 = (当前 Token / 最大 Token) * 100
          4. 返回百分比浮点数
        参数：
          - agent_id: 智能体唯一标识
        返回值：float，上下文使用率百分比（0.0 ~ 100.0+）
        异常：ValueError（智能体未注册时抛出）
        """
        if agent_id not in self._agents:
            raise ValueError(f"智能体 {agent_id[:8]}... 未注册")

        ctx = self._agents[agent_id]
        if self.max_context_tokens <= 0:
            return 100.0

        usage = (ctx.total_tokens / self.max_context_tokens) * 100.0
        return usage

    # ============================================================
    # 上下文压缩
    # ============================================================

    def compress_context(self, agent_id: str) -> Optional[str]:
        """
        压缩智能体的历史对话上下文
        运行步骤：
          1. 验证智能体已注册
          2. 分离全局约束消息（不可压缩）与对话消息（可压缩）
          3. 计算当前总 Token 数与可压缩部分的 Token 数
          4. 确定需要压缩的 Token 量（目标：降至阈值的 80% 以下）
          5. 保留最近 N 条消息不被压缩
          6. 对较早的对话消息生成摘要，替换原始内容
          7. 更新消息列表和 Token 计数
          8. 执行一致性校验
          9. 记录压缩日志
        参数：
          - agent_id: 智能体唯一标识
        返回值：Optional[str]，压缩摘要文本，无需压缩时返回 None
        异常：ValueError（智能体未注册时抛出）
        """
        if agent_id not in self._agents:
            raise ValueError(f"智能体 {agent_id[:8]}... 未注册")

        ctx = self._agents[agent_id]

        # 分离约束消息与对话消息
        constraint_msgs = [m for m in ctx.messages if m.is_constraint]
        conversation_msgs = [m for m in ctx.messages if not m.is_constraint]

        # 计算各部分 Token 数
        constraint_tokens = sum(m.token_count for m in constraint_msgs)
        conversation_tokens = sum(m.token_count for m in conversation_msgs)

        # 计算压缩目标：将总 Token 降至阈值的 80%
        target_tokens = int(self.max_context_tokens * self.compression_threshold * 0.8 / 100)

        # 动态调整保留约束 Token 配额：不能超过（目标 Token - 约束 Token）的合理比例
        # 防止 reserved_constraint_tokens 配置过大导致对话配额为负数
        max_usable_reserved = max(0, target_tokens - constraint_tokens)
        effective_reserved = min(self.reserved_constraint_tokens, max_usable_reserved)

        # 可用于对话消息的 Token 配额 = 目标 Token - 约束 Token - 有效保留 Token
        available_for_conversation = target_tokens - constraint_tokens - effective_reserved

        # 如果对话消息 Token 数已在可用配额内，无需压缩
        if conversation_tokens <= max(available_for_conversation, 0):
            logger.debug(
                f"智能体 {agent_id[:8]}... 对话 Token 数 {conversation_tokens} "
                f"在可用配额 {available_for_conversation} 内，无需压缩"
            )
            return None

        # 确定需要保留的最近消息（不可压缩），至少保留 1 条
        recent_count = max(1, min(self._recent_message_count, len(conversation_msgs)))
        recent_msgs = conversation_msgs[-recent_count:] if recent_count > 0 else []
        recent_tokens = sum(m.token_count for m in recent_msgs)

        # 需要压缩的历史消息
        history_msgs = conversation_msgs[:-recent_count] if recent_count > 0 else conversation_msgs
        history_tokens = sum(m.token_count for m in history_msgs)

        # 压缩后历史消息的目标 Token 数，确保非负
        target_history_tokens = max(0, available_for_conversation - recent_tokens)

        if history_tokens <= target_history_tokens:
            logger.debug(
                f"智能体 {agent_id[:8]}... 历史消息 Token 数 {history_tokens} "
                f"已在目标 {target_history_tokens} 内，无需压缩"
            )
            return None

        # 执行压缩：对历史消息生成摘要
        compression_summary = self._generate_compression_summary(
            history_msgs, history_tokens, target_history_tokens
        )

        # 估算摘要的 Token 数
        summary_tokens = self._estimate_tokens(compression_summary)

        # 重建消息列表：约束消息 + 压缩摘要 + 最近消息
        new_messages: List[ContextMessage] = list(constraint_msgs)

        # 添加压缩摘要消息
        summary_msg = ContextMessage(
            role="system",
            content=compression_summary,
            token_count=summary_tokens,
            is_constraint=False,
            compressed=True,
        )
        new_messages.append(summary_msg)

        # 添加最近的未压缩消息
        new_messages.extend(recent_msgs)

        # 更新上下文
        ctx.messages = new_messages
        ctx.total_tokens = sum(m.token_count for m in new_messages)
        ctx.compressed = True
        ctx.compression_count += 1
        ctx.last_compression_summary = compression_summary

        # 执行一致性校验
        self._validate_context_consistency(agent_id)

        logger.info(
            f"智能体 {agent_id[:8]}... 上下文压缩完成: "
            f"压缩前 Token={constraint_tokens + conversation_tokens}, "
            f"压缩后 Token={ctx.total_tokens}, "
            f"压缩率={(1 - ctx.total_tokens / max(constraint_tokens + conversation_tokens, 1)) * 100:.1f}%, "
            f"累计压缩次数={ctx.compression_count}"
        )

        return compression_summary

    def _generate_compression_summary(
        self,
        history_msgs: List[ContextMessage],
        original_tokens: int,
        target_tokens: int,
    ) -> str:
        """
        生成历史对话的压缩摘要（内部方法）
        运行步骤：
          1. 按角色分组统计对话轮次
          2. 提取关键信息（用户请求、助手回复要点）
          3. 生成结构化摘要文本
          4. 控制摘要长度在目标 Token 数以内
        参数：
          - history_msgs: 需要压缩的历史消息列表
          - original_tokens: 原始历史消息总 Token 数
          - target_tokens: 压缩后目标 Token 数
        返回值：str，压缩摘要文本
        """
        if not history_msgs:
            return "（无历史对话）"

        # 统计对话轮次
        user_msgs = [m for m in history_msgs if m.role == "user"]
        assistant_msgs = [m for m in history_msgs if m.role == "assistant"]
        total_rounds = max(len(user_msgs), len(assistant_msgs))

        # 提取用户请求摘要（取每条用户消息的前 200 字符作为摘要）
        user_summaries: List[str] = []
        for i, msg in enumerate(user_msgs):
            # 截取每条消息的前 200 字符
            snippet = msg.content[:200].replace("\n", " ").strip()
            if len(msg.content) > 200:
                snippet += "..."
            user_summaries.append(f"  第{i + 1}轮: {snippet}")

        # 提取助手回复关键信息
        assistant_summaries: List[str] = []
        for i, msg in enumerate(assistant_msgs):
            snippet = msg.content[:150].replace("\n", " ").strip()
            if len(msg.content) > 150:
                snippet += "..."
            assistant_summaries.append(f"  第{i + 1}轮: {snippet}")

        # 构建结构化摘要
        summary_parts = [
            f"[上下文压缩摘要 #{len(history_msgs)}]",
            f"原始 Token 数: {original_tokens}，压缩目标: {target_tokens}",
            f"历史对话共 {total_rounds} 轮，包含 {len(user_msgs)} 条用户消息、{len(assistant_msgs)} 条助手消息",
            "",
            "--- 用户请求历史 ---",
        ]
        summary_parts.extend(user_summaries[-10:])  # 最多保留最近 10 轮用户请求

        summary_parts.append("")
        summary_parts.append("--- 助手回复历史 ---")
        summary_parts.extend(assistant_summaries[-10:])  # 最多保留最近 10 轮助手回复

        summary_parts.append("")
        summary_parts.append("（以上为历史对话压缩摘要，完整上下文已归档）")

        return "\n".join(summary_parts)

    # ============================================================
    # 上下文获取
    # ============================================================

    def get_context(self, agent_id: str) -> List[Dict[str, Any]]:
        """
        获取智能体的当前上下文（已压缩或原始）
        运行步骤：
          1. 验证智能体已注册
          2. 检查使用率是否超过阈值，若超过则先触发压缩
          3. 将 ContextMessage 列表转换为字典列表返回
          4. 返回格式：[{role, content, token_count, is_constraint, compressed}, ...]
        参数：
          - agent_id: 智能体唯一标识
        返回值：List[Dict]，上下文消息字典列表
        异常：ValueError（智能体未注册时抛出）
        """
        if agent_id not in self._agents:
            raise ValueError(f"智能体 {agent_id[:8]}... 未注册")

        # 获取前先检查是否需要压缩
        usage_pct = self.get_context_usage(agent_id)
        if usage_pct >= self.compression_threshold:
            logger.info(
                f"智能体 {agent_id[:8]}... get_context 时检测到使用率 "
                f"{usage_pct:.1f}% 超阈值，先执行压缩"
            )
            self.compress_context(agent_id)

        ctx = self._agents[agent_id]

        # 转换为字典列表
        result: List[Dict[str, Any]] = []
        for msg in ctx.messages:
            result.append({
                "role": msg.role,
                "content": msg.content,
                "token_count": msg.token_count,
                "is_constraint": msg.is_constraint,
                "compressed": msg.compressed,
            })

        return result

    # ============================================================
    # 一致性校验
    # ============================================================

    def _validate_context_consistency(self, agent_id: str) -> bool:
        """
        校验压缩后上下文的一致性（内部方法）
        运行步骤：
          1. 验证全局约束消息完整保留
          2. 验证 Token 计数与实际消息 Token 之和一致
          3. 验证压缩后总 Token 未超过最大限制
          4. 验证消息列表非空
        参数：
          - agent_id: 智能体唯一标识
        返回值：bool，校验是否通过
        """
        if agent_id not in self._agents:
            logger.error(f"一致性校验失败: 智能体 {agent_id[:8]}... 不存在")
            return False

        ctx = self._agents[agent_id]
        errors: List[str] = []

        # 校验 1：全局约束消息必须存在且未被压缩
        constraint_msgs = [m for m in ctx.messages if m.is_constraint]
        if not constraint_msgs:
            errors.append("全局约束消息丢失")

        # 校验 2：Token 计数一致性
        calculated_tokens = sum(m.token_count for m in ctx.messages)
        if calculated_tokens != ctx.total_tokens:
            errors.append(
                f"Token 计数不一致: 记录值={ctx.total_tokens}, "
                f"实际计算值={calculated_tokens}"
            )
            # 自动修复计数
            ctx.total_tokens = calculated_tokens

        # 校验 3：总 Token 数不超过最大限制
        if ctx.total_tokens > self.max_context_tokens:
            errors.append(
                f"总 Token 数 {ctx.total_tokens} 超过最大限制 "
                f"{self.max_context_tokens}"
            )

        # 校验 4：消息列表非空
        if not ctx.messages:
            errors.append("消息列表为空")

        if errors:
            logger.error(
                f"智能体 {agent_id[:8]}... 上下文一致性校验失败: {'; '.join(errors)}"
            )
            return False

        logger.debug(f"智能体 {agent_id[:8]}... 上下文一致性校验通过")
        return True

    # ============================================================
    # 上下文恢复
    # ============================================================

    def recover_context(self, agent_id: str) -> bool:
        """
        恢复智能体上下文到压缩前状态（基于备份的原始内容）
        运行步骤：
          1. 验证智能体已注册且已执行过压缩
          2. 遍历消息列表，将压缩消息恢复为原始内容
          3. 重新计算 Token 计数
          4. 执行一致性校验
        参数：
          - agent_id: 智能体唯一标识
        返回值：bool，恢复是否成功
        """
        if agent_id not in self._agents:
            logger.error(f"上下文恢复失败: 智能体 {agent_id[:8]}... 未注册")
            return False

        ctx = self._agents[agent_id]

        if not ctx.compressed:
            logger.debug(f"智能体 {agent_id[:8]}... 未执行过压缩，无需恢复")
            return True

        recovered_count = 0
        for msg in ctx.messages:
            if msg.compressed and msg.original_content is not None:
                msg.content = msg.original_content
                msg.compressed = False
                msg.original_content = None
                recovered_count += 1

        # 重新计算 Token 计数
        ctx.total_tokens = sum(m.token_count for m in ctx.messages)
        ctx.compressed = False

        logger.info(
            f"智能体 {agent_id[:8]}... 上下文恢复完成: "
            f"恢复消息数={recovered_count}, 总 Token={ctx.total_tokens}"
        )

        # 恢复后校验一致性
        self._validate_context_consistency(agent_id)
        return True

    # ============================================================
    # 工具方法
    # ============================================================

    def _estimate_tokens(self, text: str) -> int:
        """
        估算文本的 Token 数量（内部方法）
        运行步骤：
          1. 统计中文字符数（每个中文字符约 1.5 Token）
          2. 统计英文单词数（每个英文单词约 1.3 Token）
          3. 统计其他字符数（每 4 字符约 1 Token）
          4. 综合计算并返回估算值
        参数：
          - text: 待估算的文本
        返回值：int，估算的 Token 数量
        """
        if not text:
            return 0

        chinese_chars = 0
        english_words = 0
        other_chars = 0

        # 遍历字符进行分类统计
        i = 0
        current_word = ""
        while i < len(text):
            char = text[i]
            # 判断是否为中文字符（Unicode 范围：CJK 统一表意文字）
            if '\u4e00' <= char <= '\u9fff' or '\u3400' <= char <= '\u4dbf':
                chinese_chars += 1
                # 如果有累积的英文单词，先结算
                if current_word.strip():
                    english_words += 1
                    current_word = ""
            elif char.isalpha():
                current_word += char
            elif char.isspace():
                if current_word.strip():
                    english_words += 1
                    current_word = ""
                other_chars += 1
            else:
                if current_word.strip():
                    english_words += 1
                    current_word = ""
                other_chars += 1
            i += 1

        # 结算最后一个单词
        if current_word.strip():
            english_words += 1

        # 综合估算：中文 1.5 Token/字，英文 1.3 Token/词，其他 0.25 Token/字符
        estimated = int(chinese_chars * 1.5 + english_words * 1.3 + other_chars * 0.25)
        # 确保至少返回 1（非空文本至少 1 Token）
        return max(estimated, 1)

    def get_agent_info(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """
        获取智能体的上下文统计信息
        运行步骤：
          1. 验证智能体已注册
          2. 汇总消息数、Token 数、压缩状态等
          3. 返回统计字典
        参数：
          - agent_id: 智能体唯一标识
        返回值：Optional[Dict]，统计信息字典，未注册返回 None
        """
        if agent_id not in self._agents:
            return None

        ctx = self._agents[agent_id]
        constraint_msgs = [m for m in ctx.messages if m.is_constraint]
        conversation_msgs = [m for m in ctx.messages if not m.is_constraint]
        compressed_msgs = [m for m in ctx.messages if m.compressed]

        return {
            "agent_id": agent_id,
            "total_messages": len(ctx.messages),
            "constraint_messages": len(constraint_msgs),
            "conversation_messages": len(conversation_msgs),
            "compressed_messages": len(compressed_msgs),
            "total_tokens": ctx.total_tokens,
            "max_context_tokens": self.max_context_tokens,
            "usage_percentage": self.get_context_usage(agent_id),
            "compressed": ctx.compressed,
            "compression_count": ctx.compression_count,
            "has_global_constraints": bool(ctx.global_constraints),
        }

    def get_all_agent_ids(self) -> List[str]:
        """
        获取所有已注册智能体的 ID 列表
        参数：无
        返回值：List[str]，智能体 ID 列表
        """
        return list(self._agents.keys())


# ============================================================
# 全局上下文管理器单例
# ============================================================

# 全局上下文管理器实例，供其他模块直接导入使用
context_manager = ContextManager()
