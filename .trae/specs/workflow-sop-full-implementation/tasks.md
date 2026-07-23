# Tasks

- [x] Task 1: 核心概念与统计口径统一定义模块
  - [x] 1.1 创建 `backend/app/services/standard_definitions.py`，定义 Section 5.11 所有核心概念
  - [x] 1.2 定义 `ChangeLevel` 枚举（CORE / LOCAL）及 `is_core_change()` 判定函数（6 条标准）
  - [x] 1.3 定义 `DefectLevel` 枚举（ARCHITECTURE / CODE）及 `is_architecture_defect()` 判定函数（4 条标准）
  - [x] 1.4 定义 `RiskLevel` 枚举（VERY_HIGH / HIGH / GENERAL / LOW）及三级界定标准
  - [x] 1.5 定义 `HookType` 枚举（TASK_COMPLETE / GIT_COMMIT / CHECK_COMPLETE / TEST_COMPLETE）
  - [x] 1.6 定义 `StageCheckpoint` 数据类（阶段-前置条件-校验规则映射）
  - [x] 1.7 更新现有模块（change_request_handler、task_decomposer、architecture_critic）引用统一定义

- [x] Task 2: Claude Code CLI 任务完成 Hook 信号系统
  - [x] 2.1 创建 `backend/app/services/task_hook_handler.py`，扩展 CommitHookHandler 为通用 Task Hook 处理器
  - [x] 2.2 实现任务完成 Hook 接收与校验（task_id、module_name、status、output 必填）
  - [x] 2.3 实现 Git 提交 Hook 接收（module_name、changed_files、commit_message）
  - [x] 2.4 实现校验完成 Hook 接收（check_type、result、issues）
  - [x] 2.5 实现测试完成 Hook 接收（test_type、result、coverage）
  - [x] 2.6 实现重复 Hook 幂等处理（同一 task_id 不重复执行 Git 操作）
  - [x] 2.7 创建 `backend/app/api/workflow.py` 中的 Hook 接收端点（POST /api/workflow/{id}/task-hook）
  - [x] 2.8 Hook 触发后自动更新 Task 状态 + 触发 Git 模块提交

- [x] Task 3: 原子任务清单聚合服务
  - [x] 3.1 创建 `backend/app/models.py` 中的 `AtomicTaskList` 模型（workflow_id、modules、tasks_json、progress、status）
  - [x] 3.2 创建 `backend/app/services/atomic_task_aggregator.py` 聚合服务
  - [x] 3.3 实现聚合触发逻辑：所有 CLI 实例完成 task.md 生成后自动触发
  - [x] 3.4 实现多模块 plan.md / checklist.md / task.md 读取与合并
  - [x] 3.5 实现模块-任务-状态三级映射关系
  - [x] 3.6 实现 Hook 驱动的状态同步（任务完成 → 原子清单更新）
  - [x] 3.7 实现进度计算与阻塞性依赖检测
  - [x] 3.8 创建原子清单查询 API 端点（GET /api/workflow/{id}/atomic-tasks）
  - [x] 3.9 前端新增 `AtomicTaskListViewer` 组件展示原子任务清单

- [x] Task 4: 阶段边界 100% 闭环校验
  - [x] 4.1 在 `workflow_engine.py` 中新增 `validate_stage_boundary()` 方法
  - [x] 4.2 实现 clarifying → designing 边界校验（需求文档非空 + 人工确认）
  - [x] 4.3 实现 designing → prompting 边界校验（四文档齐全 + 批判迭代通过 + 人工确认）
  - [x] 4.4 实现 prompting → executing 边界校验（提示词已优化 + CLI 实例已注入）
  - [x] 4.5 实现 executing → reviewing 边界校验（全部 task 完成 + 原子清单无未完成 + Git 已提交）
  - [x] 4.6 校验不通过时阻断推进并返回具体未满足条件列表
  - [x] 4.7 前端新增阶段校验状态面板（StageVerificationPanel）

- [x] Task 5: WorkflowEngine 增强与 Git 仓库创建时机调整
  - [x] 5.1 增强 `advance_stage()` 方法，推进前强制调用 `validate_stage_boundary()`
  - [x] 5.2 新增 `confirm_stage()` 方法处理人工确认节点
  - [x] 5.3 新增 `reject_stage()` 方法处理人工驳回（含驳回次数追踪）
  - [x] 5.4 在 `start_workflow()` 中移除 GitHub 仓库创建逻辑
  - [x] 5.5 在 `confirm_stage("designing")` 中新增 GitHub 仓库创建逻辑
  - [x] 5.6 新增架构批判迭代子阶段状态追踪（designing 内部的 critiquing / iterating 状态）
  - [x] 5.7 更新前端 `WorkflowDashboard` 展示子阶段状态和校验结果

- [x] Task 6: 集成测试与全量验证
  - [x] 6.1 编写 TaskHookHandler 单元测试（4 种 Hook 类型 + 幂等 + 校验失败）
  - [x] 6.2 编写 AtomicTaskAggregator 单元测试（聚合 + 状态同步 + 进度计算）
  - [x] 6.3 编写 StandardDefinitions 单元测试（枚举值 + 判定函数正确性）
  - [x] 6.4 编写 WorkflowEngine 增强测试（阶段边界校验 + 人工确认/驳回 + 迭代次数）
  - [x] 6.5 执行全量回归测试确保现有功能不受影响
  - [x] 6.6 清理测试脚本与临时文件

# Task Dependencies
- Task 2 依赖 Task 1（Hook 类型枚举引用统一定义）
- Task 3 依赖 Task 2（原子清单状态同步依赖 Hook 信号）
- Task 4 依赖 Task 1（阶段校验引用统一定义中的 StageCheckpoint）
- Task 5 依赖 Task 1 和 Task 4（增强 WorkflowEngine 引用统一定义 + 调用边界校验）
- Task 6 依赖 Task 1-5（全量测试在所有功能完成后执行）
- Task 1、Task 2、Task 3 可部分并行（Task 1 先完成枚举定义，Task 2/3 可同步开发）
