# 修复 advance_stage 边界校验死锁 Bug

## Why
`validate_stage_boundary("clarifying→designing")` 要求 `clarifying_stage.status == COMPLETED`（line 581），但 `_complete_current_stage` 在 `advance_stage` 中**校验通过后**才执行（line 241 → line 819）。这形成死锁：校验要求已完成，但完成只能在校验通过后。

此前该 Bug 被 `clarification_complete=False` 硬拒绝掩盖——`confirm_stage` 在 `advance_stage` 之前就返回了错误。修复硬拒绝后，`advance_stage` 被实际调用，立即触发 `ValueError("需求澄清阶段状态未标记为 COMPLETED")`，异常未被 `confirm_stage` 捕获，导致整个 API 返回 500 错误。

## What Changes
- `validate_stage_boundary("clarifying→designing")` 移除 `clarifying_stage.status != COMPLETED` 检查
- `validate_stage_boundary("designing→prompting")` 同样移除 `designing_stage.status != COMPLETED` 检查（同类型死锁）

## Impact
- Affected code: `backend/app/services/workflow_engine.py` lines 579-582, 601-604

## MODIFIED Requirements

### Requirement: clarifying→designing 边界校验
原：检查 clarifying stage 为 COMPLETED（死锁）
新：移除该检查，stage 完成由 `advance_stage` 自身管理

#### Scenario: 正常推进
- **WHEN** `confirm_stage("clarifying")` 调用 `advance_stage`
- **THEN** `validate_stage_boundary` 通过，阶段正常推进到 designing

### Requirement: designing→prompting 边界校验
原：检查 designing stage 为 COMPLETED（同类型死锁）
新：移除该检查
