"""
# ============================================================
# 需求澄清智能体
# ============================================================
# 核心定位：需求翻译官与标准化专家
# 核心作用：在用户提交开发任务后，通过多轮对话引导用户补充
#           关键细节，输出标准化需求文档
# 运行流程：
#   1. 分析用户输入，识别信息缺口
#   2. 逐轮引导用户补充关键维度信息
#   3. 对话轮次控制在 3-5 轮
#   4. 输出标准化需求文档
# 输入参数：
#   - user_input: 用户原始输入
#   - context: 上下文信息（会话历史、项目背景）
# 输出结果：标准化需求文档（Markdown）
# 修改记录：
#   - 2026-06-25 | v1.0.0 | 初始创建
#   - 2026-06-29 | v1.1.0 | 增强：clarify() 返回结构化 ClarifyResult；
#            新增 clarify_round() 支持多轮对话；
#            新增 _parse_clarify_response() 解析 AI JSON 输出；
#            更新系统 prompt 要求 JSON 格式输出；
#            generate_requirement_doc() 支持 List[Dict] 对话历史
#   - 2026-06-30 | v1.2.0 | 增强：ClarificationQuestion 新增 options/allow_multiple
#            字段以支持交互式候选选项选择；
#            合并文件中重复的两个 ClarifyResult 定义为单一定义；
#            更新系统 prompt 要求模型为每个问题提供 2-4 个候选选项；
#            _parse_clarify_response() 解析 options/allow_multiple 字段
#   - 2026-06-30 | v2.8.0 | _parse_clarify_response 回退正则替换为 json.JSONDecoder.raw_decode()，支持嵌套 JSON
#   - 2026-06-30 | v2.10.0 | 新增 _try_repair_truncated_json 截断 JSON 修复方法（4 种补全策略）
#   - 2026-06-30 | v2.10.0 | clarify_round questions 为空时重试 LLM 调用一次
#   - 2026-07-01 | v3.1.1 | _parse_clarify_response 增加不确定项关键词检测，含不确定项时强制 complete=False
#   - 2026-07-01 | v3.2.0 | 新增 _parse_markdown_questions 从 Markdown 文本提取结构化问题（JSON 解析失败时降级）
# ============================================================
"""

import json
import logging
import re
from typing import AsyncIterator, Optional, List, Dict, Any
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class ClarificationQuestion:
    """澄清问题（含候选选项，支持交互式选择）"""
    dimension: str              # 维度（如 功能需求/约束条件/安全要求）
    question: str               # 问题文本
    importance: str = "high"    # 重要性 high/medium/low
    options: List[str] = field(default_factory=list)  # 候选选项（2-4 个具体方案）
    allow_multiple: bool = False  # 是否允许多选


@dataclass
class ChangeAnalysis:
    """需求变更分析"""
    affected_sections: List[str] = field(default_factory=list)
    impact_scope: str = ""
    requires_architecture_review: bool = False
    summary: str = ""


@dataclass
class ClarifyResult:
    """
    澄清结果
    作用：封装需求澄清对话的结构化输出，
          供上游调用方程序化解析，替代原始纯文本返回值
    字段说明：
      - raw_text: AI 原始输出文本（用于调试和日志）
      - questions: 本轮提出的澄清问题列表（ClarificationQuestion 对象）
      - clarification_complete: 是否已完成澄清（True 表示信息充分可生成需求文档）
      - missing_dimensions: 仍需补充的需求维度名称列表
      - summary: 本轮澄清总结 / 需求文档总结
    """
    raw_text: str = ""  # AI 原始输出文本
    questions: List[ClarificationQuestion] = field(default_factory=list)  # 本轮提出的澄清问题列表
    clarification_complete: bool = False  # 是否已完成澄清（信息充分）
    missing_dimensions: List[str] = field(default_factory=list)  # 仍需补充的需求维度
    summary: str = ""  # 本轮澄清总结
    round_number: int = 0       # 当前澄清轮次
    max_rounds: int = 5         # 最大澄清轮次


REQUIREMENT_CLARIFIER_SYSTEM_PROMPT = """你是一个专业的需求澄清智能体（需求翻译官与标准化专家）。

## 核心职责
你的任务是与用户进行多轮对话，引导用户补充关键细节，最终输出一份标准化、无歧义的需求文档。

## 必须覆盖的 6 个关键维度
1. **功能需求（Functional Requirements）**: 系统需要实现什么功能？输入输出是什么？
2. **非功能需求（Non-Functional Requirements）**: 性能指标、安全要求、可靠性要求
3. **约束条件（Constraints）**: 硬件限制、软件版本、依赖项、ROS 版本
4. **环境要求（Environment）**: 运行环境、仿真平台（Gazebo/Isaac Sim）、操作系统
5. **安全红线（Safety Requirements）**: 急停条件、最大速度限制、边界条件
6. **验收标准（Acceptance Criteria）**: 如何判断功能已正确实现？

## 对话规则
- 每轮对话聚焦 1-2 个关键维度
- 对话轮次控制在 3-5 轮
- 当用户信息不足时，主动提出具体问题而非泛泛询问
- 使用中文回复
- 对于机器人相关项目，重点关注安全红线

## 输出规范
当收集到足够信息后，输出以下格式的标准化需求文档：

# 需求文档

## 1. 功能需求
[清晰描述所有功能需求，无歧义]

## 2. 非功能需求
- 性能: [具体指标]
- 安全: [安全要求]
- 可靠性: [可靠性要求]

## 3. 约束条件
- 硬件: [硬件限制]
- 软件: [软件版本/依赖]
- ROS: [ROS 版本]

## 4. 环境要求
[运行环境、仿真平台等]

## 5. 安全红线
[急停条件、速度限制、边界条件等]

## 6. 验收标准
[可量化的验收标准]

## 7. 不确定项与待确认项
[标记需要进一步确认的内容]

## 输出格式要求
你必须严格按照以下 JSON 格式输出，不要输出其他内容：

```json
{
  "stage": "asking",
  "questions": [
    {
      "dimension": "维度名称",
      "question": "具体问题",
      "importance": "high",
      "options": ["方案A：具体描述", "方案B：具体描述", "方案C：具体描述"],
      "allow_multiple": false
    }
  ],
  "clarification_complete": false,
  "missing_dimensions": ["仍需补充的维度"],
  "summary": "当前理解总结"
}
```

- stage 字段：信息不充分时为 "asking"，信息充分可生成需求文档时为 "summarizing"
- 当信息充分时，设置 "clarification_complete": true，并在 summary 中生成完整的需求文档总结
- 当信息不充分时，设置 "clarification_complete": false，在 questions 中列出本轮需要提出的问题
- **每个问题必须提供 2-4 个具体的候选选项（options），让用户能直接选择而非自由输入**
- 候选选项应覆盖该问题常见的合理方案，描述要具体清晰
- 若问题适合多选（如「需要哪些功能模块」），设置 "allow_multiple": true，否则为 false
- 用户始终可以选择「其他」来自由输入，所以 options 不需要穷举所有可能
- missing_dimensions 列出所有尚未覆盖的维度名称
- 所有输出必须包裹在 ```json 代码块中
"""


class RequirementClarifier:
    """
    需求澄清智能体
    作用：引导用户补充需求细节，输出标准化需求文档
    """

    def __init__(self, hermes_service):
        """
        初始化需求澄清智能体
        参数：
          - hermes_service: HermesService 实例（用于调用 Hermes）
        """
        self.hermes_service = hermes_service

    def get_system_prompt(self) -> str:
        """获取 system prompt"""
        return REQUIREMENT_CLARIFIER_SYSTEM_PROMPT

    def _try_repair_truncated_json(
        self, raw_text: str, brace_start: int, error_msg: str
    ) -> Optional[str]:
        """
        v2.10.0 新增：尝试修复截断的 JSON
        作用：当 raw_decode 失败时（通常因 LLM 输出被截断），
              尝试补全缺失的引号和括号
        运行步骤：
          1. 从 brace_start 开始取子串
          2. 尝试补全最后缺失的 "（Unterminated string）
          3. 尝试补全缺失的 ]}（未闭合的数组/对象）
          4. 重新 json.loads 验证
        参数：
          - raw_text: 原始文本
          - brace_start: { 的起始位置
          - error_msg: raw_decode 的错误信息
        返回值：修复后的 JSON 字符串，或 None
        """
        # 只取从 { 开始的子串
        truncated = raw_text[brace_start:]
        
        # 尝试补全：添加 " 闭合最后一个字符串，再添加 ]} 闭合结构
        candidates = []
        
        # 策略 1: 补 " ] } ] }（闭合字符串 + options数组 + question对象 + questions数组 + 根对象）
        candidates.append(truncated.rstrip() + '"]}]}')
        # 策略 2: 补 " ] }（闭合字符串 + 数组 + 对象）
        candidates.append(truncated.rstrip() + '"]}')
        # 策略 3: 补 " ] ] }（闭合字符串 + 数组 + 数组 + 对象）
        candidates.append(truncated.rstrip() + '"]]}')
        # 策略 4: 补 }（如果最后一个字符不是 }）
        if not truncated.rstrip().endswith('}'):
            candidates.append(truncated.rstrip() + '}')
        
        for candidate in candidates:
            try:
                json.loads(candidate)
                logger.info(f"截断 JSON 修复成功（补全策略）")
                return candidate
            except json.JSONDecodeError:
                continue
        
        # 尝试用 raw_decode 解析修复后的字符串（可能部分修复）
        for candidate in candidates:
            try:
                decoder = json.JSONDecoder()
                obj, end_idx = decoder.raw_decode(candidate)
                logger.info(f"截断 JSON 部分修复成功（raw_decode，提取了 {end_idx} 字符）")
                return candidate[:end_idx]
            except json.JSONDecodeError:
                continue
        
        logger.warning(f"截断 JSON 修复失败，已尝试 {len(candidates)} 种补全策略")
        return None

    def _parse_markdown_questions(self, text: str) -> List[ClarificationQuestion]:
        """
        v3.2.0 新增：从 Markdown 文本中提取结构化澄清问题
        支持的格式：
          **问题 N：具体问题文本**
          - 方案 A：描述
          - 方案 B：描述
        运行步骤：
          1. 按"问题 N"或"问题N"分割文本
          2. 提取每个问题的文本和选项
          3. 返回 ClarificationQuestion 列表
        """
        import re as _re3
        questions = []
        # 匹配 "**问题 N：xxx**" 或 "**问题N：xxx**"
        pattern = r'\*\*问题\s*(\d+)\s*[：:]\s*(.+?)\*\*'
        matches = list(_re3.finditer(pattern, text))
        
        for i, match in enumerate(matches):
            q_num = match.group(1)
            q_text = match.group(2).strip()
            # 提取该问题到下一个问题之间的内容
            start = match.end()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            content = text[start:end]
            
            # 提取方案选项
            options = _re3.findall(r'[-*]\s*方案\s*[A-Z][：:]\s*(.+?)(?=\n|$)', content)
            if not options:
                # 尝试匹配 "- 方案A：" 格式
                options = _re3.findall(r'[-*]\s*方案\s*[A-Z][：:]\s*(.+?)(?=\n|$)', content)
            
            if q_text and len(q_text) > 3:
                # 从该问题之前的最近标题推断维度
                prefix = text[:match.start()]
                dim_match = _re3.findall(r'##\s*(?:U-\d+[：:]|)([^\n]+)', prefix)
                dimension = dim_match[-1].strip() if dim_match else "待确认项"
                questions.append(ClarificationQuestion(
                    dimension=dimension[:20],
                    question=q_text,
                    importance="high",
                    options=options if options else [],
                    allow_multiple=False,
                ))
        
        return questions

    def _parse_clarify_response(self, raw_text: str) -> ClarifyResult:
        """
        解析 AI 返回的 JSON 澄清响应
        运行步骤：
          1. 从原始文本中提取 JSON 代码块（可能在 ```json 标记中）
          2. 解析 JSON 字段，构建 ClarifyResult 对象
          3. 若解析失败，降级为将整段文本作为 summary 返回
        参数：
          - raw_text: AI 返回的原始文本
        返回值：ClarifyResult 对象
        """
        result = ClarifyResult(raw_text=raw_text)

        # 步骤 1：尝试从 ```json 代码块中提取 JSON
        json_match = re.search(r'```json\s*\n?(.*?)\n?```', raw_text, re.DOTALL)
        if not json_match:
            # v2.8.0 修复：正则 `\{[^{}]*"stage"[^{}]*\}` 无法匹配嵌套 `{}`，
            # 改用 json.JSONDecoder.raw_decode() 从文本中提取第一个有效 JSON 对象
            json_str = None
            try:
                # 找到 "stage" 关键词的位置
                stage_pos = raw_text.find('"stage"')
                if stage_pos >= 0:
                    # 从 "stage" 往前找最近的 `{`（JSON 起始）
                    brace_start = raw_text.rfind('{', 0, stage_pos)
                    if brace_start >= 0:
                        # 从 `{` 位置开始，用 raw_decode 提取完整 JSON 对象
                        decoder = json.JSONDecoder()
                        obj, end_idx = decoder.raw_decode(raw_text[brace_start:])
                        json_str = raw_text[brace_start:brace_start + end_idx]
                        json_match = re.match(r'.*', json_str)  # 伪造 match 对象供后续使用
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(f"raw_decode 提取 JSON 失败: {e}")
                # v2.10.0 修复：尝试修复截断的 JSON（补全缺失引号和括号）
                json_str = self._try_repair_truncated_json(raw_text, brace_start, str(e))

            if json_str is None:
                # 解析失败，降级处理：将整段文本作为 summary 返回
                logger.warning("无法从 AI 响应中提取 JSON，降级为纯文本 summary")
                result.summary = raw_text.strip()
                return result
            json_str_from_match = json_str
        else:
            json_str_from_match = json_match.group(1).strip() if hasattr(json_match, 'group') else json_match.group(0)

        # 步骤 2：解析 JSON 并构建 ClarifyResult
        try:
            data = json.loads(json_str_from_match)
            # 解析 questions 列表
            raw_questions = data.get("questions", [])
            result.questions = [
                ClarificationQuestion(
                    dimension=q.get("dimension", ""),
                    question=q.get("question", ""),
                    importance=q.get("importance", "high"),
                    options=q.get("options", []) if isinstance(q.get("options"), list) else [],
                    allow_multiple=bool(q.get("allow_multiple", False)),
                )
                for q in raw_questions
            ]
            result.clarification_complete = data.get("clarification_complete", False)
            result.missing_dimensions = data.get("missing_dimensions", [])
            result.summary = data.get("summary", "")
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            # JSON 解析异常，降级处理
            logger.warning(f"解析 AI JSON 响应失败: {e}，降级为纯文本 summary")
            result.summary = raw_text.strip()
            # v3.2.0 新增：尝试从 Markdown 文本中提取问题（格式：**问题 N：xxx** + 方案 A/B/C）
            md_questions = self._parse_markdown_questions(raw_text)
            if md_questions:
                result.questions = md_questions
                logger.info(f"从 Markdown 文本提取了 {len(md_questions)} 个问题")

        # v3.1.1 修复：简化检测——只要文本含"不确定项"/"待确认项"且 AI 标记完成，强制继续
        # 原因：AI 可能在 summary 中内联提及不确定项（非表格/列表格式），
        # 且生成的完整需求文档必然包含不确定项章节
        if result.clarification_complete:
             import re as _re2
             if _re2.search(r'不确定项|待确认项|待定项|不确定', raw_text):
                 # 排除否定表述（如"无不确定项"、"没有不确定项"）
                 if not _re2.search(r'(?:无|没有|不存在|已解决.*)\s*(?:不确定|待确认)', raw_text):
                     logger.info(
                         f"AI 标记完成但文本含不确定项关键词，"
                         f"强制 clarification_complete=False"
                     )
                     result.clarification_complete = False

        return result

    async def clarify(
        self, user_input: str, context: Optional[Dict[str, Any]] = None
    ) -> ClarifyResult:
        """
        执行需求澄清对话（单轮）
        运行步骤：
          1. 分析用户输入，识别信息缺口
          2. 构建澄清对话提示词
          3. 调用 Hermes 进行对话
          4. 解析 AI 返回的 JSON 结构化输出
        参数：
          - user_input: 用户原始输入
          - context: 上下文信息
        返回值：ClarifyResult 结构化澄清结果
        """
        context_str = ""
        if context:
            context_str = f"\n\n上下文信息：\n{context}"

        prompt = (
            f"{REQUIREMENT_CLARIFIER_SYSTEM_PROMPT}\n\n"
            f"用户输入：\n{user_input}{context_str}\n\n"
            f"请分析用户输入，识别信息缺口，提出 1-2 个具体问题引导用户补充关键细节。"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=120,
        )

        if result.success:
            parsed = self._parse_clarify_response(result.stdout.strip())
            # v2.10.0 修复：questions 为空时重试一次（可能是 LLM 输出截断）
            if not parsed.questions and not parsed.clarification_complete:
                logger.warning(
                    "首轮澄清解析结果 questions 为空，重试 LLM 调用一次"
                )
                retry_result = await self.hermes_service.executor.execute(
                    command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
                    timeout=120,
                )
                if retry_result.success:
                    parsed = self._parse_clarify_response(retry_result.stdout.strip())
            return parsed
        # Hermes 调用失败，返回错误信息的 ClarifyResult
        error_msg = f"抱歉，需求分析暂时遇到问题。请重新描述您的需求。\n\n技术细节：{result.error_message}"
        return ClarifyResult(
            raw_text=error_msg,
            summary=error_msg,
            missing_dimensions=["功能需求", "非功能需求", "约束条件", "环境要求", "安全红线", "验收标准"],
        )

    async def clarify_round(
        self,
        user_input: str,
        conversation_history: List[Dict[str, str]],
        round_number: int,
        max_rounds: int = 5,
    ) -> ClarifyResult:
        """
        执行多轮需求澄清对话中的某一轮
        运行步骤：
          1. 基于对话历史构建上下文 prompt
          2. 若已达到最大轮次，强制要求 AI 输出 clarification_complete=true
          3. 调用 Hermes 获取结构化响应
          4. 解析并返回 ClarifyResult
        参数：
          - user_input: 当前轮次的用户输入
          - conversation_history: 完整对话历史，每项为 {"role": "user"/"assistant", "content": "..."}
          - round_number: 当前轮次编号（从 1 开始）
          - max_rounds: 最大对话轮次（默认 5）
        返回值：ClarifyResult 结构化澄清结果
        """
        # 步骤 1：构建对话历史文本
        history_str = ""
        for entry in conversation_history:
            role_label = "用户" if entry.get("role") == "user" else "助手"
            history_str += f"{role_label}：{entry.get('content', '')}\n"

        # 步骤 2：判断是否需要强制结束澄清
        force_complete_instruction = ""
        if round_number >= max_rounds:
            force_complete_instruction = (
                f"\n\n**重要**：当前已是第 {round_number} 轮对话（最大轮次 {max_rounds}），"
                f"请强制设置 \"clarification_complete\": true，"
                f"在 summary 中生成完整的标准化需求文档总结，"
                f"并在 missing_dimensions 中标注尚未充分覆盖的维度。"
            )

        prompt = (
            f"{REQUIREMENT_CLARIFIER_SYSTEM_PROMPT}\n\n"
            f"## 对话历史（共 {round_number} 轮）\n{history_str}\n"
            f"## 当前用户输入\n{user_input}\n"
            f"{force_complete_instruction}"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=120,
        )

        if result.success:
            return self._parse_clarify_response(result.stdout.strip())
        # Hermes 调用失败，返回错误信息的 ClarifyResult
        error_msg = f"抱歉，需求分析暂时遇到问题。请重新描述您的需求。\n\n技术细节：{result.error_message}"
        return ClarifyResult(
            raw_text=error_msg,
            summary=error_msg,
            missing_dimensions=["功能需求", "非功能需求", "约束条件", "环境要求", "安全红线", "验收标准"],
        )

    async def generate_requirement_doc(
        self, conversation_history: List[Dict[str, str]]
    ) -> str:
        """
        生成标准化需求文档
        运行步骤：
          1. 将对话历史格式化为文本
          2. 调用 Hermes 生成结构化需求文档
        参数：
          - conversation_history: 完整对话历史，每项为 {"role": "user"/"assistant", "content": "..."}
        返回值：标准化需求文档（Markdown）
        """
        # 步骤 1：格式化对话历史
        history_str = ""
        for entry in conversation_history:
            role_label = "用户" if entry.get("role") == "user" else "助手"
            history_str += f"{role_label}：{entry.get('content', '')}\n"

        prompt = (
            f"{REQUIREMENT_CLARIFIER_SYSTEM_PROMPT}\n\n"
            f"以下是与用户的完整对话历史：\n\n{history_str}\n\n"
            f"请基于以上对话，按照输出规范生成完整的标准化需求文档。"
            f"确保覆盖 6 个关键维度。对于对话中未提及的维度，在「不确定项与待确认项」中标注。"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=180,
        )

        if result.success:
            return result.stdout.strip()
        return f"# 需求文档\n\n生成失败：{result.error_message}"

    async def handle_change(
        self, change_request: str, current_doc: str
    ) -> ChangeAnalysis:
        """
        处理需求变更
        运行步骤：
          1. 分析变更请求
          2. 评估影响范围
          3. 更新需求文档
        参数：
          - change_request: 变更请求
          - current_doc: 当前需求文档
        返回值：ChangeAnalysis 对象
        """
        prompt = (
            f"{REQUIREMENT_CLARIFIER_SYSTEM_PROMPT}\n\n"
            f"当前需求文档：\n{current_doc}\n\n"
            f"用户提出需求变更：\n{change_request}\n\n"
            f"请分析此变更的影响范围，列出受影响的章节，"
            f"并判断是否需要触发架构重新设计。"
            f"输出格式：\n"
            f"受影响章节：[列表]\n"
            f"影响范围：[描述]\n"
            f"是否需要架构评审：是/否\n"
            f"变更摘要：[描述]"
        )

        result = await self.hermes_service.executor.execute(
            command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
            timeout=120,
        )

        analysis = ChangeAnalysis()
        if result.success:
            output = result.stdout
            # 解析输出
            for line in output.split("\n"):
                line = line.strip()
                if "受影响章节" in line:
                    sections = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                    analysis.affected_sections = [
                        s.strip() for s in sections.split(",") if s.strip()
                    ]
                elif "影响范围" in line:
                    analysis.impact_scope = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                elif "是否需要架构评审" in line:
                    need = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]
                    analysis.requires_architecture_review = "是" in need
                elif "变更摘要" in line:
                    analysis.summary = line.split("：", 1)[-1] if "：" in line else line.split(":", 1)[-1]

        return analysis
