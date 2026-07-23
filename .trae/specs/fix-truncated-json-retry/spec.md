# 修复 LLM 返回截断 JSON 导致澄清卡死

## Why
LLM 偶发返回截断的 JSON（`Unterminated string`），`_parse_clarify_response` 解析失败后返回 `questions=[]`。虽然 v2.9.0 修复了 `clarify_questions` 事件在 `complete=True` 时仍发送，但当 `complete=False` 且 `questions=[]` 时，前端弹窗仍无法渲染，用户卡在提交状态。

## What Changes
- `requirement_clarifier.py`: `_parse_clarify_response` 增加 JSON 修复逻辑（截断字符串补全）
- `requirement_clarifier.py`: `clarify_round` 解析失败时增加重试（最多 1 次）

## Impact
- Affected specs: fix-json-parse-nested, fix-round2-clarify-complete
- Affected code: `backend/app/services/agent_roles/requirement_clarifier.py`

## ADDED Requirements
### Requirement: JSON 解析失败时自动修复截断字符串
系统 SHALL 在 `raw_decode` 失败时尝试修复截断的 JSON（补全缺失的引号和括号），修复失败则重试 LLM 调用一次。

#### Scenario: LLM 返回截断 JSON
- **WHEN** LLM 返回的 JSON 因长度限制被截断（`Unterminated string`）
- **THEN** 系统自动修复 JSON 或重试，确保 `questions` 非空
