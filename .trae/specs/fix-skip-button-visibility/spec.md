# 修复"跳过不确定项"按钮不可见 Bug Spec

## Why
当需求澄清智能体陷入 `complete=False` 且 `questions=0` 的死循环状态时（AI 返回含不确定项但无新问题的响应），ClarificationCard 不显示任何可操作按钮：
- `isComplete=false` → "确认需求文档"按钮不显示
- `roundNumber < 6` → "跳过不确定项"按钮不显示
- `questions.length=0` → "提交回答"按钮被包裹在 `questions.length > 0` 内

用户被困在死胡同，只能通过聊天输入框发送消息，每次都会重新触发需求澄清智能体。

## What Changes
- ClarificationCard：当 `questions.length === 0 && !isComplete && roundNumber >= 3` 时，显示「跳过不确定项，进入架构设计」按钮作为逃生出口

## Impact
- Affected specs: `architecture-critique-iteration`
- Affected code: `frontend/src/components/ClarificationCard.tsx`

## MODIFIED Requirements

### Requirement: 跳过不确定项按钮的显示条件
原：仅在 `roundNumber >= 6 && questions.length > 0 && !isComplete` 时显示
新：SHALL 在以下任一条件满足时显示「跳过不确定项，进入架构设计」按钮：
- `roundNumber >= 3 && questions.length === 0 && !isComplete`（澄清卡住，无新问题）
- `roundNumber >= 6 && questions.length > 0 && !isComplete`（多轮后仍不确定）

#### Scenario: 澄清卡住（questions=0, !isComplete, round>=3）
- **WHEN** 澄清轮次 >= 3 且无新问题且未完成
- **THEN** 显示「跳过不确定项，进入架构设计」按钮

#### Scenario: 正常多轮澄清（questions>0, !isComplete, round>=6）
- **WHEN** 澄清轮次 >= 6 且有新问题
- **THEN** 仍显示「跳过不确定项」按钮（行为不变）
