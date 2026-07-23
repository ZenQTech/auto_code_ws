# 修复需求澄清多轮交互缺陷 + 思考过程实时可视化

## Why
1. 需求澄清阶段在完成第一轮选择后无法进入第二轮——后端 `_format_clarify_result_for_sse` 未在 `clarify_questions` SSE 事件中传递 `round` 字段，前端 `roundNumber` 永远为 1，`key={roundNumber}` 不变导致 `ClarificationCard` 不重挂载、`submitted` 不重置，按钮/选项全部处于禁用状态
2. Hermes 思考过程实时可视化已有 `ThinkingBlock` 组件，但需确保在编程模式下也正确展示

## What Changes
- **后端**：`ClarifyResult` 新增 `round_number`/`max_rounds` 字段；`ClarificationService` 在两个方法中填充；`_format_clarify_result_for_sse` 透传到 SSE 事件
- **前端**：`handleClarifyQuestions` 消费 `data.round`/`data.maxRounds` 字段
- **前端**：`ClarificationCard` 增加 `useEffect` 在 `roundNumber` 变化时防御性重置 `submitted`

## Impact
- Affected specs: clarify-interactive-options, streaming-thinking
- Affected code:
  - `backend/app/services/agent_roles/requirement_clarifier.py` (ClarifyResult dataclass)
  - `backend/app/services/clarification_service.py` (start_clarification, handle_user_response)
  - `backend/app/services/hermes_service.py` (_format_clarify_result_for_sse)
  - `frontend/src/App.tsx` (handleClarifyQuestions)
  - `frontend/src/components/ClarificationCard.tsx` (submitted reset)

## MODIFIED Requirements
### Requirement: 澄清 SSE 事件必须包含轮次信息
系统 SHALL 在 `clarify_questions` SSE 事件中包含 `round`（当前轮次）和 `maxRounds`（最大轮次）字段。

#### Scenario: 第二轮澄清正常显示
- **WHEN** 用户完成第一轮需求选择并提交
- **THEN** 前端收到 `round: 2` 的 `clarify_questions` 事件，`ClarificationCard` 以 `key=2` 重新挂载，提交按钮恢复为可交互的"提交回答"

### Requirement: 澄清卡片提交后状态正确重置
`ClarificationCard` SHALL 在 `roundNumber` 变化时自动重置 `submitted` 状态为 `false`。

#### Scenario: 第二轮鼠标不再显示禁止状态
- **WHEN** 前端渲染第二轮 `ClarificationCard`
- **THEN** 选项按钮和提交按钮不应用 `cursor-not-allowed`，用户可以正常点击选择
