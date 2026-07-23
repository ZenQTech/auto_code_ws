# Checklist

## 核心概念统一定义模块
- [x] `standard_definitions.py` 包含 `ChangeLevel` 枚举（CORE / LOCAL）
- [x] `is_core_change()` 函数正确实现 6 条核心变更判定标准
- [x] `standard_definitions.py` 包含 `DefectLevel` 枚举（ARCHITECTURE / CODE）
- [x] `is_architecture_defect()` 函数正确实现 4 条架构缺陷判定标准
- [x] `standard_definitions.py` 包含 `RiskLevel` 枚举（VERY_HIGH / HIGH / GENERAL / LOW）
- [x] `standard_definitions.py` 包含 `HookType` 枚举（4 种类型）
- [x] `standard_definitions.py` 包含 `StageCheckpoint` 数据类
- [x] `change_request_handler.py` 引用统一定义（不再自行定义变更等级）
- [x] `task_decomposer.py` 引用统一定义（不再自行定义风险等级）
- [x] `architecture_critic.py` 引用统一定义（不再自行定义缺陷等级）

## Task Hook 信号系统
- [x] `task_hook_handler.py` 支持 4 种 Hook 类型接收
- [x] Hook 必填字段校验：task_id、module_name、status 缺一不可
- [x] 任务完成 Hook 自动更新 Task 状态为 COMPLETED
- [x] 任务完成 Hook 自动触发 Git 模块提交
- [x] 重复 Hook 幂等处理：同一 task_id 不重复执行 Git 操作
- [x] 校验失败时返回详细错误信息，不执行任何状态变更
- [x] POST `/api/workflow/{id}/task-hook` 端点正确响应

## 原子任务清单聚合
- [x] `AtomicTaskList` 模型包含 workflow_id、modules、tasks_json、progress、status
- [x] 聚合服务能读取所有 CLI 实例生成的 plan.md / checklist.md / task.md
- [x] 合并后的原子清单建立模块-任务-状态三级映射
- [x] Hook 驱动状态同步：任务完成 → 原子清单对应条目更新
- [x] 进度计算正确反映整体完成百分比
- [x] 阻塞性依赖检测：存在未完成的强依赖时标记为 blocked
- [x] GET `/api/workflow/{id}/atomic-tasks` 端点正确返回完整清单
- [x] 前端 `AtomicTaskListViewer` 组件正确渲染任务树与状态

## 阶段边界闭环校验
- [x] clarifying → designing 校验：需求文档非空 + 人工确认
- [x] designing → prompting 校验：四文档齐全 + 批判迭代通过 + 人工确认
- [x] prompting → executing 校验：提示词已优化 + CLI 实例已注入
- [x] executing → reviewing 校验：全部 task 完成 + 原子清单无未完成 + Git 已提交
- [x] 校验不通过时阻断推进，返回具体未满足条件列表
- [x] 前端 StageVerificationPanel 正确展示校验状态

## WorkflowEngine 增强
- [x] `advance_stage()` 推进前强制调用 `validate_stage_boundary()`
- [x] `confirm_stage()` 处理人工确认节点，通过后推进
- [x] `reject_stage()` 处理人工驳回，含驳回次数追踪
- [x] 架构人工驳回最多 2 次，超过触发强制人工评审
- [x] `start_workflow()` 中不创建 GitHub 仓库
- [x] 架构确认后（`confirm_stage("designing")`）创建 GitHub 仓库
- [x] 架构批判迭代子阶段状态正确追踪
- [x] 前端 WorkflowDashboard 展示子阶段状态

## 集成测试
- [x] TaskHookHandler 4 种 Hook 类型单元测试通过
- [x] TaskHookHandler 幂等处理测试通过
- [x] TaskHookHandler 校验失败测试通过
- [x] AtomicTaskAggregator 聚合测试通过
- [x] AtomicTaskAggregator 状态同步测试通过
- [x] StandardDefinitions 枚举值与判定函数测试通过
- [x] WorkflowEngine 阶段边界校验测试通过
- [x] WorkflowEngine 人工确认/驳回测试通过
- [x] 全量回归测试通过（现有功能不受影响）
- [x] 测试脚本与临时文件已清理
