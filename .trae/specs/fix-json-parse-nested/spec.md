# 修复澄清 JSON 解析正则无法匹配嵌套对象

## Why
`_parse_clarify_response` 使用正则 `\{[^{}]*"stage"[^{}]*\}` 提取 LLM 返回的 JSON，但 `[^{}]*` 无法匹配嵌套的 `{}`。当 LLM 未使用 ` ```json ``` ` 包裹输出时，回退正则始终失败，导致 `ClarifyResult.questions = []`，`_format_clarify_result_for_sse` 跳过 `clarify_questions` SSE 事件，前端仅收到纯文本 markdown，不弹出交互式弹窗。

## What Changes
- `requirement_clarifier.py`: `_parse_clarify_response` 回退解析改用 `json.JSONDecoder.raw_decode()` 替代正则，正确提取嵌套 JSON 对象

## Impact
- Affected specs: clarify-popup-and-thinking, clarify-interactive-options
- Affected code: `backend/app/services/agent_roles/requirement_clarifier.py` (line ~200)

## MODIFIED Requirements
### Requirement: JSON 解析必须支持嵌套对象
`_parse_clarify_response` SHALL 使用 `json.JSONDecoder.raw_decode()` 从 LLM 原始输出中提取 JSON 对象，而非使用无法匹配嵌套 `{}` 的正则表达式。

#### Scenario: LLM 返回含嵌套 questions 数组的 JSON
- **WHEN** LLM 返回的 JSON 中包含嵌套的对象数组（如 `questions: [{...}, {...}]`）
- **THEN** 解析器正确提取完整 JSON，`result.questions` 非空，`clarify_questions` SSE 事件被发送

#### Scenario: LLM 未使用 ```json``` 包裹
- **WHEN** LLM 直接输出 JSON 而无 markdown 代码块包裹
- **THEN** 回退解析仍能正确提取 JSON
