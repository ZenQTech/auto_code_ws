"""
# ============================================================
# 需求澄清桥接服务
# ============================================================
# 核心作用：连接 WorkflowEngine 与 RequirementClarifier，
#           驱动 clarifying 阶段的需求澄清 AI 多轮对话，
#           管理澄清状态、持久化澄清问题与需求文档
# 运行流程：
#   1. WorkflowEngine 启动工作流时调用 start_clarification() 生成首轮问题
#   2. API 接收用户回复后调用 handle_user_response() 推进澄清对话
#   3. 澄清完成后调用 finalize_requirement_doc() 生成标准化需求文档
#   4. 通过 is_clarification_complete() 查询澄清是否完成
# 输入参数：
#   - session_factory: 异步数据库会话工厂（用于持久化澄清结果）
#   - requirement_clarifier: RequirementClarifier 实例（执行实际澄清对话）
# 输出结果：ClarifyResult 对象（结构化澄清结果）
# 修改记录：
#   - 2026-06-29 | v2.4.0 | 初始创建，封装需求澄清调用逻辑
#   - 2026-06-29 | v2.5.0 | 重写为完整桥接服务：新增 ClarificationState 状态管理、
#             start_clarification / handle_user_response / finalize_requirement_doc /
#             is_clarification_complete 方法；集成 Workflow 持久化
#   - 2026-07-01 | v3.0.0 | handle_user_response 增加不确定项检测：需求文档含不确定项时强制 complete=False，max_rounds 提升至 13
#   - 2026-07-01 | v3.0.0 | 新增 _has_uncertain_items / _count_uncertain_items 方法，支持表格和编号列表格式
#   - 2026-07-01 | v3.0.0 | 修复 StageStatus 枚举值 'completed' → 'COMPLETED'
#   - 2026-07-02 | v3.4.0 | handle_user_response 新增：用户消息含"跳过不确定项"时直接完成澄清，
#     不限轮次，跳过 _has_uncertain_items 检查
# ============================================================
"""

import logging
import json
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from .agent_roles.requirement_clarifier import ClarifyResult, ClarificationQuestion

logger = logging.getLogger(__name__)


@dataclass
class ClarificationState:
    """
    澄清状态数据类
    作用：在内存中维护单个工作流的澄清对话状态，
          包括轮次、问题列表、对话历史和完成标记
    字段说明：
      - workflow_id: 关联的工作流 ID
      - round_number: 当前澄清轮次（从 1 开始）
      - max_rounds: 最大澄清轮次（默认 5）
      - questions: 当前轮次的澄清问题列表
        [{"dimension": "功能需求", "question": "...", "importance": "high"}]
      - conversation_history: 完整对话历史
        [{"role": "user"/"assistant", "content": "..."}]
      - is_complete: 澄清是否已完成（True 表示可以生成需求文档）
      - requirement_doc: 最终生成的需求文档内容
    """
    workflow_id: str
    round_number: int = 0
    max_rounds: int = 13  # v3.0.0：最大澄清轮次提升至 13
    questions: List[Dict] = field(default_factory=list)
    conversation_history: List[Dict] = field(default_factory=list)
    is_complete: bool = False
    requirement_doc: str = ""


class ClarificationService:
    """
    需求澄清桥接服务
    作用：连接 WorkflowEngine 与 RequirementClarifier，
          驱动 clarifying 阶段的需求澄清 AI 对话，
          管理澄清状态并在数据库中持久化
    调用方：WorkflowEngine（启动澄清）、API 层（接收用户回复）
    被调用方：RequirementClarifier（执行实际 AI 对话）
    """

    def __init__(self, session_factory, requirement_clarifier):
        """
        初始化需求澄清桥接服务
        参数：
          - session_factory: 异步数据库会话工厂（用于持久化澄清结果到 Workflow 表）
          - requirement_clarifier: RequirementClarifier 实例（执行实际澄清 AI 对话）
        """
        self.session_factory = session_factory
        self.requirement_clarifier = requirement_clarifier
        # 内存中维护澄清状态（按 workflow_id 索引），避免频繁查库
        self._states: Dict[str, ClarificationState] = {}

    # ============================================================
    # 公共方法
    # ============================================================

    async def clarify(
        self, user_input: str, context: str = ""
    ) -> ClarifyResult:
        """
        执行需求澄清，生成结构化的澄清问题（单轮，兼容旧接口）
        运行步骤：
          1. 调用 RequirementClarifier.clarify() 获取结构化澄清结果
          2. 直接返回 ClarifyResult（已包含 questions 列表和完整信息）
        参数：
          - user_input: 用户原始输入
          - context: 上下文信息（会话历史、项目背景）
        返回值：ClarifyResult 对象（包含澄清问题列表和文本回复）
        """
        # 委托给 RequirementClarifier 的 clarify 方法
        # RequirementClarifier 已返回结构化的 ClarifyResult（含 questions 列表）
        return await self.requirement_clarifier.clarify(user_input, context)

    async def start_clarification(
        self, workflow_id: str, user_input: str
    ) -> ClarifyResult:
        """
        启动需求澄清流程，生成首轮澄清问题
        运行步骤：
          1. 创建 ClarificationState，设置 round_number=1, max_rounds=5
          2. 调用 self.requirement_clarifier.clarify(user_input, "") 生成首轮问题
          3. 将结果中的 questions 保存到 state
          4. 持久化 questions 到 Workflow.clarification_questions
          5. 持久化到 WorkflowStage(clarifying).output_doc
          6. 返回 ClarifyResult
        参数：
          - workflow_id: 工作流 ID
          - user_input: 用户原始输入
        返回值：ClarifyResult 结构化澄清结果
        """
        # 步骤 1：创建澄清状态
        state = ClarificationState(
            workflow_id=workflow_id,
            round_number=1,
            max_rounds=13,  # v3.0.0
        )
        self._states[workflow_id] = state

        # 步骤 2：调用 RequirementClarifier 生成首轮澄清问题
        result = await self.requirement_clarifier.clarify(user_input, "")
        result.round_number = 1
        result.max_rounds = state.max_rounds

        # 步骤 3：将问题保存到内存状态（含 options/allow_multiple，支持交互式选择）
        state.questions = [
            {
                "dimension": q.dimension,
                "question": q.question,
                "importance": q.importance,
                "options": getattr(q, "options", []),
                "allow_multiple": getattr(q, "allow_multiple", False),
            }
            for q in result.questions
        ]
        state.conversation_history.append({
            "role": "assistant",
            "content": result.summary,
        })

        # 步骤 4 & 5：持久化到数据库
        await self._persist_state(workflow_id, state)

        logger.info(
            f"需求澄清已启动: workflow={workflow_id[:8]}..., "
            f"共 {len(result.questions)} 个问题"
        )
        return result

    async def handle_user_response(
        self, workflow_id: str, user_message: str
    ) -> ClarifyResult:
        """
        处理用户在澄清阶段的回复，推进多轮澄清对话
        运行步骤：
          1. 获取或创建 ClarificationState
          2. 将用户消息追加到 conversation_history
          3. 增加 round_number
          4. 调用 self.requirement_clarifier.clarify_round() 获取 AI 回复
          5. 将 AI 回复追加到 conversation_history
          6. 更新 state.questions 和 state.is_complete
          7. 持久化更新到 Workflow
          8. 若 is_complete，调用 finalize_requirement_doc
          9. 返回 ClarifyResult
        参数：
          - workflow_id: 工作流 ID
          - user_message: 用户回复内容
        返回值：ClarifyResult 结构化澄清结果
        """
        # 步骤 1：获取或创建状态
        state = self._get_or_create_state(workflow_id)

        # 步骤 2：追加用户消息到对话历史
        state.conversation_history.append({
            "role": "user",
            "content": user_message,
        })

        # 步骤 3：增加轮次编号
        state.round_number += 1

        # 步骤 4：调用 RequirementClarifier 获取 AI 回复
        result = await self.requirement_clarifier.clarify_round(
            user_input=user_message,
            conversation_history=state.conversation_history,
            round_number=state.round_number,
            max_rounds=state.max_rounds,
        )
        result.round_number = state.round_number
        result.max_rounds = state.max_rounds

        # 步骤 5：将 AI 回复追加到对话历史
        assistant_content = result.summary
        state.conversation_history.append({
            "role": "assistant",
            "content": assistant_content,
        })

        # 步骤 6：更新内存状态（含 options/allow_multiple）
        state.questions = [
            {
                "dimension": q.dimension,
                "question": q.question,
                "importance": q.importance,
                "options": getattr(q, "options", []),
                "allow_multiple": getattr(q, "allow_multiple", False),
            }
            for q in result.questions
        ]
        state.is_complete = result.clarification_complete

        # 步骤 7：持久化到数据库
        await self._persist_state(workflow_id, state)

        # v3.3.0 修复：当 questions 为空时（LLM 被强制 complete=False 但未生成新问题），
        # 从已有需求文档中提取不确定项作为具体问题
        if not result.questions and not result.clarification_complete:
            doc = await self._load_requirement_doc(workflow_id)
            if doc:
                extracted = self._extract_uncertain_questions(doc)
                if extracted:
                    result.questions = extracted
                    logger.info(f"从已有需求文档提取了 {len(extracted)} 个不确定项问题")

        # v3.4.0 新增：用户消息明确包含"跳过不确定项"时，直接完成澄清
        # 放在步骤 8 之前，不受 AI 返回的 complete 状态影响
        if "跳过不确定项" in user_message:
            logger.info(
                f"用户选择跳过不确定项，直接完成澄清 "
                f"(第 {state.round_number} 轮)"
            )
            state.is_complete = True
            result.clarification_complete = True
            # 生成并持久化最终需求文档
            await self.finalize_requirement_doc(workflow_id)
            result.questions = []

        # 步骤 8：若 AI 判定完成，先生成需求文档再检查不确定项
        elif state.is_complete:
            requirement_doc = await self.finalize_requirement_doc(workflow_id)

            # v3.0.0 新增：检查需求文档中是否仍有不确定项
            has_uncertain = self._has_uncertain_items(requirement_doc)

            # 轮次 >= 13：强制进入架构设计
            if state.round_number >= 13:
                logger.info(f"已达最大轮次 13，强制进入架构设计")
                state.is_complete = True
                result.clarification_complete = True
            elif has_uncertain:
                # 仍有不确定项 → 强制继续澄清
                logger.info(
                    f"需求文档仍存在不确定项，强制继续澄清 "
                    f"(当前第 {state.round_number} 轮)"
                )
                state.is_complete = False
                result.clarification_complete = False
                # v3.3.0 修复：从需求文档提取不确定项作为具体问题（替代空问题循环）
                if not result.questions:
                    extracted = self._extract_uncertain_questions(requirement_doc)
                    if extracted:
                        result.questions = extracted
                        logger.info(f"从需求文档提取了 {len(extracted)} 个不确定项问题")
                # 轮次 >= 6 时追加"是否继续澄清"提示
                if state.round_number >= 6:
                    result.questions.append(
                        ClarificationQuestion(
                            dimension="流程控制",
                            question=(
                                f"当前第 {state.round_number} 轮澄清，需求文档仍有 "
                                f"{self._count_uncertain_items(requirement_doc)} 项不确定。"
                                f"是否继续澄清？"
                            ),
                            importance="high",
                            options=["继续澄清不确定项", "跳过不确定项，进入架构设计"],
                            allow_multiple=False,
                        )
                    )
        else:
            # AI 未判定完成，但轮次已达上限 → 强制完成
            if state.round_number >= 13:
                logger.info(f"已达最大轮次 13，强制完成澄清")
                requirement_doc = await self.finalize_requirement_doc(workflow_id)
                state.is_complete = True
                result.clarification_complete = True

        logger.info(
            f"澄清轮次 {state.round_number}: workflow={workflow_id[:8]}..., "
            f"完成={state.is_complete}, 问题数={len(result.questions)}"
        )
        return result

    def is_clarification_complete(self, workflow_id: str) -> bool:
        """
        检查指定工作流的需求澄清是否已完成
        参数：
          - workflow_id: 工作流 ID
        返回值：bool，True 表示澄清已完成
        """
        state = self._states.get(workflow_id)
        if state is None:
            return False
        return state.is_complete

    async def finalize_requirement_doc(self, workflow_id: str) -> str:
        """
        生成标准化需求文档并持久化到数据库
        运行步骤：
          1. 获取 ClarificationState
          2. 调用 self.requirement_clarifier.generate_requirement_doc() 生成需求文档
          3. 持久化到 Workflow.requirement_doc
          4. 设置 Workflow.clarification_complete = True
          5. 返回需求文档内容
        参数：
          - workflow_id: 工作流 ID
        返回值：str，标准化需求文档（Markdown 格式）
        """
        # 步骤 1：获取状态
        state = self._get_or_create_state(workflow_id)

        # 步骤 2：生成需求文档
        requirement_doc = await self.requirement_clarifier.generate_requirement_doc(
            state.conversation_history
        )
        state.requirement_doc = requirement_doc

        # 步骤 3 & 4：持久化到数据库
        try:
            async with self.session_factory() as db:
                await db.execute(
                    text(
                        "UPDATE workflows SET requirement_doc = :doc, "
                        "clarification_complete = :complete, "
                        "clarification_round = :round, "
                        "updated_at = CURRENT_TIMESTAMP "
                        "WHERE id = :wid"
                    ),
                    {
                        "doc": requirement_doc,
                        "complete": True,
                        "round": state.round_number,
                        "wid": workflow_id,
                    },
                )
                # 更新 WorkflowStage(clarifying) 的 output_doc
                await db.execute(
                    text(
                        "UPDATE workflow_stages SET output_doc = :doc, "
                        "status = 'COMPLETED' "
                        "WHERE workflow_id = :wid AND stage_name = 'clarifying'"
                    ),
                    {"doc": requirement_doc, "wid": workflow_id},
                )
                await db.commit()
                logger.info(
                    f"需求文档已持久化: workflow={workflow_id[:8]}..., "
                    f"长度={len(requirement_doc)} 字符"
                )
        except Exception as e:
            logger.error(f"持久化需求文档失败: {e}")

        return requirement_doc

    # ============================================================
    # 私有辅助方法
    # ============================================================

    # ============================================================
    # 私有辅助方法
    # ============================================================

    async def _load_requirement_doc(self, workflow_id: str) -> str:
        """
        v3.3.0 新增：从数据库加载已有需求文档
        """
        try:
            async with self.session_factory() as db:
                result = await db.execute(
                    text("SELECT requirement_doc FROM workflows WHERE id = :wid"),
                    {"wid": workflow_id},
                )
                row = result.fetchone()
                return row[0] if row and row[0] else ""
        except Exception as e:
            logger.warning(f"加载需求文档失败: {e}")
            return ""

    def _get_or_create_state(self, workflow_id: str) -> ClarificationState:
        """
        获取或创建指定工作流的澄清状态
        运行步骤：
          1. 从内存 _states 字典中查找已有状态
          2. 若不存在，创建新的 ClarificationState 并存入字典
        参数：
          - workflow_id: 工作流 ID
        返回值：ClarificationState 对象
        """
        if workflow_id not in self._states:
            self._states[workflow_id] = ClarificationState(
                workflow_id=workflow_id,
                round_number=1,
                max_rounds=13,  # v3.0.0
            )
        return self._states[workflow_id]

    async def _persist_state(
        self, workflow_id: str, state: ClarificationState
    ) -> None:
        """
        将澄清状态同步持久化到数据库 Workflow 记录
        运行步骤：
          1. 将 state.questions 序列化为 JSON
          2. 更新 Workflow 表的 clarification_questions、clarification_round、
             clarification_complete 字段
          3. 更新 WorkflowStage(clarifying) 的 output_doc
        参数：
          - workflow_id: 工作流 ID
          - state: ClarificationState 对象
        """
        try:
            # 序列化 questions 为 JSON 字符串（SQLite 不支持直接传 list）
            questions_json = json.dumps(state.questions, ensure_ascii=False)
            # 构建澄清问题文本用于 output_doc
            questions_text = "\n\n".join([
                f"【{q.get('dimension', '')}】{q.get('question', '')}"
                + (f"（重要性：{q.get('importance', '')}）" if q.get('importance') else "")
                for q in state.questions
            ])

            async with self.session_factory() as db:
                # 更新 Workflow 的澄清字段
                await db.execute(
                    text(
                        "UPDATE workflows SET "
                        "clarification_questions = :questions, "
                        "clarification_round = :round, "
                        "clarification_complete = :complete, "
                        "updated_at = CURRENT_TIMESTAMP "
                        "WHERE id = :wid"
                    ),
                    {
                        "questions": questions_json,
                        "round": state.round_number,
                        "complete": state.is_complete,
                        "wid": workflow_id,
                    },
                )
                # 更新 WorkflowStage(clarifying) 的 output_doc
                await db.execute(
                    text(
                        "UPDATE workflow_stages SET output_doc = :doc "
                        "WHERE workflow_id = :wid AND stage_name = 'clarifying'"
                    ),
                    {"doc": questions_text, "wid": workflow_id},
                )
                await db.commit()
        except Exception as e:
            logger.error(f"持久化澄清状态失败 (workflow={workflow_id[:8]}...): {e}")

    # ============================================================
    # v3.0.0 新增：不确定项检测辅助方法
    # ============================================================

    def _has_uncertain_items(self, doc: str) -> bool:
        """
        检测需求文档中是否仍存在不确定项或待确认项
        运行步骤：
          1. 搜索"不确定项"、"待确认项"、"待确认"等关键词
          2. 排除已标记为"已确认"或"已明确"的行
        参数：
          - doc: 需求文档内容（Markdown 格式）
        返回值：bool，True 表示仍存在不确定项
        """
        if not doc:
            return False
        import re
        # 查找"不确定项"或"待确认项"章节标题（可能含编号如 "7. 不确定项"）
        if re.search(r'不确定|待确认|待定', doc):
            # 检查章节下是否有实际条目（表格行或列表项）
            section_match = re.search(
                r'(?:不确定|待确认|待定)[^\n]*\n(.*?)(?=\n#+\s|\n\*\*|\Z)',
                doc, re.DOTALL
            )
            if section_match:
                section_content = section_match.group(1)
                # 统计表格行（| 开头，排除分隔行和表头）+ 编号列表项（1. 2. 开头）
                table_items = [l for l in re.findall(r'^\s*\|.*\|', section_content, re.MULTILINE)
                               if '---' not in l and '编号' not in l and '不确定项' not in l]
                list_items = re.findall(r'^\s*\d+\.\s', section_content, re.MULTILINE)
                return len(table_items) + len(list_items) > 0
        return False

    def _count_uncertain_items(self, doc: str) -> int:
        """
        统计需求文档中不确定项的数量
        参数：
          - doc: 需求文档内容（Markdown 格式）
        返回值：int，不确定项数量
        """
        if not doc:
            return 0

    def _extract_uncertain_questions(self, doc: str) -> List[ClarificationQuestion]:
        """
        v3.3.0 新增：从需求文档的不确定项章节提取澄清问题
        支持表格格式（| 序号 | 待确认项 | ...）和编号列表格式（1. **xxx**）
        返回：ClarificationQuestion 列表，每个不确定项生成一个问题
        """
        if not doc:
            return []
        import re
        section_match = re.search(
            r'(?:不确定|待确认|待定)[^\n]*\n(.*?)(?=\n#+\s|\n\*\*|\Z)',
            doc, re.DOTALL
        )
        if not section_match:
            return []
        content = section_match.group(1)
        questions = []
        
        # 尝试表格格式
        for line in re.findall(r'^\s*\|[^\-].*\|', content, re.MULTILINE):
            if '编号' in line or '不确定项' in line or '待确认项' in line:
                continue
            parts = [p.strip() for p in line.split('|')]
            if len(parts) >= 3:
                item_num = parts[1]
                item_desc = parts[2]
            else:
                continue
            questions.append(ClarificationQuestion(
                dimension=f"不确定项 {item_num}",
                question=f"请确认：{item_desc}",
                importance="high",
                options=[f"确认：{item_desc}", "跳过此项"],
                allow_multiple=False,
            ))
        
        # 尝试编号列表格式
        if not questions:
            list_items = re.findall(
                r'^\s*\d+\.\s*\*\*(.+?)\*\*[：:]\s*(.+?)(?=\n|$)',
                content, re.MULTILINE
            )
            for title, desc in list_items:
                questions.append(ClarificationQuestion(
                    dimension=title.strip(),
                    question=f"请确认：{desc.strip()}",
                    importance="high",
                    options=[f"确认：{desc.strip()}", "跳过此项"],
                    allow_multiple=False,
                ))
        
        return questions
        import re
        section_match = re.search(
            r'(?:不确定|待确认|待定)[^\n]*\n(.*?)(?=\n#+\s|\n\*\*|\Z)',
            doc, re.DOTALL
        )
        if section_match:
            content = section_match.group(1)
            table_items = [l for l in re.findall(r'^\s*\|.*\|', content, re.MULTILINE)
                           if '---' not in l and '编号' not in l and '不确定项' not in l]
            list_items = re.findall(r'^\s*\d+\.\s', content, re.MULTILINE)
            return len(table_items) + len(list_items)
        return 0
