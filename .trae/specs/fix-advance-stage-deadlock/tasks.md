# Tasks

- [x] Task 1: 移除 clarifying→designing 边界校验中的死锁检查
  - 在 `validate_stage_boundary` 中删除 lines 579-582：`clarifying_stage.status != COMPLETED` 检查
  - stage 完成由 `advance_stage` 自身的 `_complete_current_stage` 管理
  - **验证**：`confirm_stage("clarifying")` 正常推进到 designing

- [x] Task 2: 移除 designing→prompting 边界校验中的死锁检查
  - 在 `validate_stage_boundary` 中删除 lines 601-604：`designing_stage.status != COMPLETED` 检查
  - **验证**：`confirm_stage("designing")` 正常推进到 prompting

# Task Dependencies
- 无依赖，同文件两处修改
