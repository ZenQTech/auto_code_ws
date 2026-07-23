# 修复 ClarificationModal 渲染条件导致跳过按钮不可见

## Why
ClarificationModal 的显示条件为 `questions.length > 0 || isComplete`。当需求澄清智能体陷入 `complete=False && questions=0` 的卡住状态时（回合 3+），该条件为 `false`，模态弹窗不渲染。ClarificationCard 内部的「跳过不确定项」按钮无法显示，用户只能通过聊天输入框发送消息，每次都重新触发需求澄清智能体，形成无限循环。

## What Changes
- App.tsx 中两处 ClarificationModal 渲染条件新增 `|| (clarificationData.roundNumber >= 3)`，确保回合 >= 3 时即使无问题也显示弹窗

## Impact
- Affected code: `frontend/src/App.tsx` 第 1362 行和第 1628 行

## MODIFIED Requirements

### Requirement: ClarificationModal 显示条件
原：`questions.length > 0 || isComplete`
新：`questions.length > 0 || isComplete || roundNumber >= 3`

#### Scenario: 澄清卡住（questions=0, !isComplete, round>=3）
- **WHEN** 回合 >= 3 且无新问题且未完成
- **THEN** ClarificationModal 正常渲染，ClarificationCard 显示「跳过不确定项」按钮

#### Scenario: 早期加载（questions=0, !isComplete, round<3）
- **WHEN** 回合 < 3 且无新问题
- **THEN** 行为不变，不弹窗（仍然在加载中）
