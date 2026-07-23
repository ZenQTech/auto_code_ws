# 全流程执行标准SOP 刚性闭环实现 Spec

## Why
当前平台已实现基础工作流引擎（5阶段）、智能体角色、架构批判迭代、任务拆解、接口变更管理、需求变更处理、系统评测等核心能力，但与用户定义的"全流程执行标准SOP"相比，存在以下关键断点：Claude Code CLI 任务完成后缺乏统一的 Hook 信号机制、各 Claude Code CLI 生成的 plan/checklist/task 文档未整合为原子任务清单、核心概念定义分散在各模块未统一、阶段边界缺乏 100% 闭环校验。需补齐这些断点，确保全流程刚性执行。

## What Changes
- 新增 Claude Code CLI 任务完成 Hook 信号系统（含接收、校验、状态同步、Git 提交触发）
- 新增原子任务清单聚合服务（整合所有 Claude Code CLI 的 plan/checklist/task 文档）
- 新增核心概念与统计口径统一定义模块（Section 5.11 全流程引用）
- 增强阶段边界 100% 闭环校验（每阶段推进前强制校验前置条件）
- 调整 Git 仓库创建时机（从 start_workflow 移至架构确认阶段）
- 增强 WorkflowEngine 的阶段转换规则，匹配 SOP 的精确阶段定义
- 前端新增原子任务清单聚合视图与阶段校验状态面板

## Impact
- Affected specs: scheduling-platform-v4-full（增量增强）
- Affected code:
  - `backend/app/services/workflow_engine.py` - 增强阶段转换与闭环校验
  - `backend/app/services/commit_hook_handler.py` - 扩展为通用 Task Hook 处理器
  - `backend/app/services/` - 新增 `task_hook_handler.py`、`atomic_task_aggregator.py`、`standard_definitions.py`
  - `backend/app/api/workflow.py` - 新增 Hook 接收端点、原子清单查询端点
  - `backend/app/models.py` - 新增 AtomicTaskList 模型
  - `frontend/src/components/` - 新增 AtomicTaskListViewer 组件

---

## ADDED Requirements

### Requirement: Claude Code CLI 任务完成 Hook 信号系统
系统 SHALL 提供统一的 Hook 接收端点，Claude Code CLI 实例每完成一项 task 后通过 Hook 向调度平台发送完成信号，平台自动完成状态同步与 Git 提交。

#### Scenario: 任务完成 Hook 接收
- **WHEN** Claude Code CLI 实例完成一项 task 并发送 Hook 信号
- **THEN** 平台接收 Hook 数据（task_id、module_name、status、changed_files、commit_message）
- **AND** 校验 Hook 数据必填字段完整性
- **AND** 更新对应任务状态为 COMPLETED
- **AND** 触发 Git 模块提交
- **AND** 返回成功确认信号给 CLI 实例

#### Scenario: Hook 数据校验失败
- **WHEN** Hook 数据缺少必填字段（task_id、module_name、status）
- **THEN** 平台返回校验失败详情
- **AND** 不更新任何状态
- **AND** 不触发 Git 操作

#### Scenario: 重复 Hook 幂等处理
- **WHEN** 同一 task 重复发送完成 Hook
- **THEN** 平台识别为重复信号，返回幂等确认，不重复执行 Git 操作

### Requirement: 原子任务清单聚合服务
系统 SHALL 在所有 Claude Code CLI 实例完成 plan 文档生成后，读取所有实例生成的 plan.md、checklist.md、task.md 文档，整合为一个大的原子任务清单，作为全流程唯一的任务状态追踪源。

#### Scenario: 原子清单聚合触发
- **WHEN** 所有 Claude Code CLI 实例完成 task.md 生成并通过 Hook 上报
- **THEN** 调度平台自动触发原子清单聚合
- **AND** 读取每个模块的 plan.md、checklist.md、task.md
- **AND** 合并为统一的 AtomicTaskList
- **AND** 建立模块-任务-状态的三级映射关系

#### Scenario: 原子清单状态追踪
- **WHEN** 任意 Claude Code CLI 通过 Hook 上报任务完成
- **THEN** 原子清单中对应任务状态同步更新
- **AND** 计算整体完成进度百分比
- **AND** 检测是否存在阻塞性依赖未完成

#### Scenario: 原子清单查询
- **WHEN** 前端请求原子任务清单
- **THEN** 返回完整的 AtomicTaskList，包含所有模块的任务树、状态、依赖关系、进度

### Requirement: 核心概念与统计口径统一定义模块
系统 SHALL 提供全局唯一的 `standard_definitions.py` 模块，定义 Section 5.11 中的所有核心概念，全流程所有模块统一引用，禁止自行定义。

#### Scenario: 需求变更等级判定
- **WHEN** 判定需求变更等级
- **THEN** 使用 `standard_definitions.py` 中的 `ChangeLevel` 枚举（CORE / LOCAL）
- **AND** 使用 `is_core_change()` 函数按 6 条标准逐一判定

#### Scenario: 缺陷等级判定
- **WHEN** 判定缺陷等级
- **THEN** 使用 `standard_definitions.py` 中的 `DefectLevel` 枚举（ARCHITECTURE / CODE）
- **AND** 使用 `is_architecture_defect()` 函数按 4 条标准逐一判定

#### Scenario: 风险等级引用
- **WHEN** 任务风险标记
- **THEN** 使用 `standard_definitions.py` 中的 `RiskLevel` 枚举（VERY_HIGH / HIGH / GENERAL / LOW）
- **AND** 引用统一的三级界定标准

### Requirement: 阶段边界 100% 闭环校验
系统 SHALL 在每个工作流阶段推进前，强制校验前置阶段的所有验收条件是否满足，不满足则阻断推进。

#### Scenario: 需求澄清→架构设计 边界校验
- **WHEN** 尝试从 clarifying 推进到 designing
- **THEN** 校验：需求文档已生成且内容非空
- **AND** 校验：需求文档已获人工确认
- **AND** 校验不通过则阻断推进，返回具体未满足条件

#### Scenario: 架构设计→提示词工程 边界校验
- **WHEN** 尝试从 designing 推进到 prompting
- **THEN** 校验：spec.md / checklist.md / task.md / 验收标准.md 均已生成
- **AND** 校验：架构批判迭代已完成且通过
- **AND** 校验：架构已获人工确认
- **AND** 校验不通过则阻断推进

#### Scenario: 代码执行→质量评审 边界校验
- **WHEN** 尝试从 executing 推进到 reviewing
- **THEN** 校验：所有模块的 task 均已完成（通过 Hook 确认）
- **AND** 校验：原子任务清单中无未完成任务
- **AND** 校验：所有模块已完成 Git 提交
- **AND** 校验不通过则阻断推进

### Requirement: 增强的阶段转换规则
系统 SHALL 在工作流引擎中实现与 SOP 精确匹配的阶段转换规则，包括人工确认节点和架构批判迭代子阶段。

#### Scenario: 架构设计阶段包含批判迭代子流程
- **WHEN** 进入 designing 阶段
- **THEN** 依次执行：架构生成 → 架构批判 → 迭代修复 → 人工确认
- **AND** 批判迭代最多 3 次
- **AND** 人工驳回最多 2 次，超过触发强制人工评审
- **AND** 人工确认通过后方可推进到下一阶段

#### Scenario: Git 仓库创建时机
- **WHEN** 架构设计阶段人工确认通过
- **THEN** 创建 GitHub 仓库
- **AND** 初始化 Git 仓库结构
- **AND** 记录 repo_name 到 Workflow

---

## MODIFIED Requirements

### Requirement: WorkflowEngine 阶段定义
**原定义**: 5 阶段（clarifying / designing / prompting / executing / reviewing）
**新定义**: 保持 5 阶段不变，但每个阶段内部增加子阶段流转控制：
- clarifying: 需求澄清对话 → 需求文档生成 → 人工确认
- designing: 架构生成 → 架构批判迭代 → 人工确认 → Git 仓库创建
- prompting: 提示词优化 → CLI 实例注入
- executing: 任务分发 → Hook 接收 → 原子清单聚合 → 单模块校验
- reviewing: 集成校验 → 系统评测 → 人工确认 → 代码推送

### Requirement: CommitHookHandler 扩展为 TaskHookHandler
**原定义**: 仅处理 Git 提交相关的 Commit Hook
**新定义**: 扩展为通用 Task Hook 处理器，同时处理：
- 任务完成 Hook（task_id、module_name、status、output）
- Git 提交 Hook（module_name、changed_files、commit_message）
- 校验完成 Hook（check_type、result、issues）
- 测试完成 Hook（test_type、result、coverage）

---

## REMOVED Requirements
无（纯增量增强，不删除任何现有功能）
