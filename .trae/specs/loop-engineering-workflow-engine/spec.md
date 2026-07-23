# Loop Engineering 工作流引擎 Spec

> **来源**: [project-optimization-roadmap Task 1](file:///home/qizheng/auto_code_ws/.trae/specs/project-optimization-roadmap/spec.md)
> **优先级**: P0（核心工作流，必须最先完成）
> **依赖**: 无

## Why

当前项目已建立 Hermes 总调度 + Claude Code CLI 子实例的架构基础，但缺少结构化的 Loop Engineering 工作流。业界领先项目（OMC 的 5 阶段 Team Pipeline、Composio AO 的 Reaction 系统、Aider 的 lint+test 循环）已验证：只有将需求澄清、架构设计、提示词工程、代码执行、质量评审、迭代闭环串联为完整工作流，才能真正实现高质量、可落地的 AI 编程。

本 spec 聚焦于工作流引擎本身——即阶段状态机、数据模型、API 端点、迭代控制、超时机制。智能体角色的具体实现在 `five-agent-roles` spec 中。

## What Changes

- **新增 Workflow 数据模型**：workflows 表（id, session_id, status, current_stage, iteration_count, max_iterations, user_input, requirement_doc, spec_doc, checklist_doc, task_doc, acceptance_doc, error_message, created_at, updated_at）
- **新增 WorkflowStage 数据模型**：workflow_stages 表（id, workflow_id, stage_name, status, agent_role, input_doc, output_doc, conversation_summary, started_at, completed_at）
- **新增 AgentRole 数据模型**：agent_roles 表（id, name, description, system_prompt, trigger_rules JSON）
- **扩展 Session 模型**：新增 workflow_id、workflow_stage 字段
- **新增 WorkflowEngine 服务**：阶段状态机、推进/回退/迭代控制
- **新增 Workflow API 端点**：start、status、advance、rollback、stages
- **数据库迁移**：sessions 表新增 workflow_id、workflow_stage 列

## Impact

- Affected specs: five-agent-roles（依赖本 spec）、web-dashboard-workflow-monitor（依赖本 spec）
- Affected code:
  - `backend/app/models.py` — 新增 Workflow、WorkflowStage、AgentRole 模型 + Session 扩展
  - `backend/app/database.py` — 新增列迁移
  - `backend/app/services/workflow_engine.py` — 新建
  - `backend/app/api/workflow.py` — 重写（保留旧端点兼容）
  - `backend/app/main.py` — 注册 WorkflowEngine

---

## ADDED Requirements

### Requirement: Workflow 数据模型

系统 SHALL 在 `backend/app/models.py` 中新增以下 ORM 模型和枚举类型。

#### Scenario: WorkflowStatus 枚举
- **WHEN** 系统需要表示工作流状态
- **THEN** 使用以下枚举值：
  - `PENDING` — 等待启动
  - `CLARIFYING` — 需求澄清阶段
  - `DESIGNING` — 架构设计阶段
  - `PROMPTING` — 提示词工程阶段
  - `EXECUTING` — 代码执行阶段
  - `REVIEWING` — 质量评审阶段
  - `ITERATING` — 迭代中
  - `COMPLETED` — 已完成
  - `FAILED` — 失败

#### Scenario: StageStatus 枚举
- **WHEN** 系统需要表示工作流阶段状态
- **THEN** 使用以下枚举值：
  - `PENDING` — 等待中
  - `IN_PROGRESS` — 进行中
  - `COMPLETED` — 已完成
  - `FAILED` — 失败

#### Scenario: Workflow 模型定义
- **WHEN** 系统创建新的工作流记录
- **THEN** Workflow 模型 SHALL 包含以下字段：

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String(36) | PK, UUID | 工作流唯一标识 |
| session_id | String(36) | NOT NULL, INDEX | 关联会话 ID |
| status | Enum(WorkflowStatus) | DEFAULT PENDING | 工作流状态 |
| current_stage | String(32) | NULLABLE | 当前阶段标识 |
| iteration_count | Integer | DEFAULT 0 | 当前迭代次数 |
| max_iterations | Integer | DEFAULT 3 | 最大迭代次数 |
| user_input | Text | DEFAULT '' | 用户原始输入 |
| requirement_doc | Text | DEFAULT '' | 需求文档 |
| spec_doc | Text | DEFAULT '' | 架构 spec.md |
| checklist_doc | Text | DEFAULT '' | 架构 checklist.md |
| task_doc | Text | DEFAULT '' | 架构 task.md |
| acceptance_doc | Text | DEFAULT '' | 验收标准.md |
| error_message | Text | DEFAULT '' | 错误信息 |
| created_at | DateTime | DEFAULT now | 创建时间 |
| updated_at | DateTime | DEFAULT now, ONUPDATE | 更新时间 |

- **AND** 与 WorkflowStage 建立一对多关系（cascade="all, delete-orphan"）

#### Scenario: WorkflowStage 模型定义
- **WHEN** 系统记录工作流阶段
- **THEN** WorkflowStage 模型 SHALL 包含以下字段：

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String(36) | PK, UUID | 阶段唯一标识 |
| workflow_id | String(36) | FK → workflows.id, CASCADE | 关联工作流 ID |
| stage_name | String(32) | NOT NULL | 阶段名称 |
| status | Enum(StageStatus) | DEFAULT PENDING | 阶段状态 |
| agent_role | String(128) | NULLABLE | 智能体角色名称 |
| input_doc | Text | DEFAULT '' | 阶段输入文档 |
| output_doc | Text | DEFAULT '' | 阶段输出文档 |
| conversation_summary | Text | DEFAULT '' | 智能体对话摘要 |
| started_at | DateTime | NULLABLE | 开始时间 |
| completed_at | DateTime | NULLABLE | 完成时间 |

#### Scenario: AgentRole 模型定义
- **WHEN** 系统存储智能体角色定义
- **THEN** AgentRole 模型 SHALL 包含以下字段：

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String(36) | PK, UUID | 角色唯一标识 |
| name | String(128) | NOT NULL | 角色名称 |
| description | Text | DEFAULT '' | 角色描述 |
| system_prompt | Text | DEFAULT '' | System Prompt 模板 |
| trigger_rules | JSON | DEFAULT {} | 触发规则 |
| created_at | DateTime | DEFAULT now | 创建时间 |

#### Scenario: Session 模型扩展
- **WHEN** 系统关联工作流与会话
- **THEN** Session 模型 SHALL 新增以下字段：
  - `workflow_id` — String(36), NULLABLE, 关联的工作流 ID
  - `workflow_stage` — String(32), NULLABLE, 当前工作流阶段

---

### Requirement: 工作流引擎

系统 SHALL 在 `backend/app/services/workflow_engine.py` 中实现 WorkflowEngine 类，管理完整的工作流生命周期。

#### Scenario: 启动工作流
- **WHEN** 用户在编程模式下提交开发任务
- **THEN** `start_workflow(session_id, user_input)` 方法 SHALL：
  1. 创建 Workflow 记录（status=CLARIFYING, current_stage="clarifying"）
  2. 为 5 个阶段（clarifying/designing/prompting/executing/reviewing）各创建一条 WorkflowStage 记录（初始 status=PENDING）
  3. 更新 Session 的 workflow_id 和 workflow_stage 字段
  4. 返回创建的 Workflow 对象

#### Scenario: 推进工作流阶段
- **WHEN** 当前阶段完成，需要进入下一阶段
- **THEN** `advance_stage(workflow_id)` 方法 SHALL：
  1. 加载工作流和当前阶段
  2. 标记当前阶段为 COMPLETED（设置 completed_at）
  3. 根据阶段状态机确定下一阶段
  4. 标记下一阶段为 IN_PROGRESS（设置 started_at）
  5. 更新 Workflow.current_stage 和 Workflow.status
  6. 更新 Session.workflow_stage
  7. 返回新的当前阶段 WorkflowStage 对象

#### Scenario: 阶段状态机
- **WHEN** 工作流在阶段间转换
- **THEN** 状态机 SHALL 遵循以下规则：
  ```
  pending → clarifying → designing → prompting → executing → reviewing
  reviewing → completed（评审通过）
  reviewing → iterating → executing（评审不通过，进入迭代）
  ```
- **AND** 迭代闭环最多 3 轮自动终止（iteration_count >= max_iterations 时标记 FAILED）

#### Scenario: 回退工作流阶段
- **WHEN** 需要回退到之前的阶段（如评审不通过、需求变更）
- **THEN** `rollback_stage(workflow_id, target_stage)` 方法 SHALL：
  1. 验证目标阶段是否在有效范围内
  2. 重置目标阶段及之后所有阶段的 status 为 PENDING
  3. 清空这些阶段的 output_doc、conversation_summary、completed_at
  4. 标记目标阶段为 IN_PROGRESS
  5. 更新 Workflow 状态
  6. 返回目标阶段 WorkflowStage 对象

#### Scenario: 获取工作流状态
- **WHEN** 前端 Dashboard 查询工作流状态
- **THEN** `get_workflow_status(workflow_id)` 方法 SHALL 返回：
  - workflow_id、session_id、status、current_stage
  - iteration_count、max_iterations
  - progress（已完成阶段数 / 总阶段数 * 100）
  - error_message
  - stages 列表（每个阶段的 key、name、status、agent_role、started_at、completed_at）

#### Scenario: 标记工作流完成
- **WHEN** 所有阶段通过，工作流成功结束
- **THEN** `mark_completed(workflow_id)` 方法 SHALL：
  1. 设置 status=COMPLETED, current_stage=None
  2. 清除 Session 的 workflow_stage

#### Scenario: 标记工作流失败
- **WHEN** 工作流无法继续（超时、超过最大迭代次数等）
- **THEN** `mark_failed(workflow_id, error_message)` 方法 SHALL：
  1. 设置 status=FAILED, error_message
  2. 清除 Session 的 workflow_stage

#### Scenario: 开始迭代
- **WHEN** 评审不通过，需要重新执行
- **THEN** `start_iteration(workflow_id)` 方法 SHALL：
  1. 检查 iteration_count < max_iterations（否则抛出异常）
  2. 增加 iteration_count
  3. 设置 status=ITERATING
  4. 回退到 executing 阶段

#### Scenario: 更新阶段输出
- **WHEN** 智能体角色完成阶段任务
- **THEN** `update_stage_output(workflow_id, stage_name, output_doc, conversation_summary, agent_role)` 方法 SHALL：
  1. 更新对应 WorkflowStage 的 output_doc、conversation_summary、agent_role

#### Scenario: 更新工作流文档
- **WHEN** 总架构师输出四文档
- **THEN** `update_workflow_docs(workflow_id, **docs)` 方法 SHALL：
  1. 支持更新 requirement_doc、spec_doc、checklist_doc、task_doc、acceptance_doc

---

### Requirement: 工作流 API

系统 SHALL 在 `backend/app/api/workflow.py` 中提供 Loop Engineering 工作流端点，同时保留原有端点兼容。

#### Scenario: 启动工作流端点
- **WHEN** 前端调用 `POST /api/workflow/start`
- **THEN** 接收 `{ session_id: string, user_input: string }`
- **AND** 调用 WorkflowEngine.start_workflow
- **AND** 返回 `{ workflow_id, session_id, status, current_stage, message }`

#### Scenario: 获取工作流状态端点
- **WHEN** 前端调用 `GET /api/workflow/{workflow_id}/status`
- **THEN** 返回完整的 WorkflowStatusInfo（含 stages 列表和 progress）
- **AND** 工作流不存在时返回 404

#### Scenario: 推进工作流端点
- **WHEN** 前端调用 `POST /api/workflow/{workflow_id}/advance`
- **THEN** 调用 WorkflowEngine.advance_stage
- **AND** 返回 `{ workflow_id, stage_name, status, message }`
- **AND** 无法推进时返回 400

#### Scenario: 回退工作流端点
- **WHEN** 前端调用 `POST /api/workflow/{workflow_id}/rollback`
- **THEN** 接收 `{ target_stage: string }`
- **AND** 调用 WorkflowEngine.rollback_stage
- **AND** 返回 `{ workflow_id, stage_name, status, message }`
- **AND** 无效阶段时返回 400

#### Scenario: 获取阶段列表端点
- **WHEN** 前端调用 `GET /api/workflow/{workflow_id}/stages`
- **THEN** 返回所有阶段的列表（key、name、status、agent_role、started_at、completed_at）
- **AND** 工作流不存在时返回 404

#### Scenario: 保留原有端点兼容
- **WHEN** 前端调用原有端点（optimize/plan/execute/validate/full）
- **THEN** 这些端点 SHALL 继续正常工作，不受新增端点影响

---

### Requirement: 数据库迁移

系统 SHALL 在启动时自动执行数据库迁移，确保旧数据库兼容新模型。

#### Scenario: 新增列迁移
- **WHEN** 系统启动且 sessions 表缺少 workflow_id 列
- **THEN** 自动执行 `ALTER TABLE sessions ADD COLUMN workflow_id VARCHAR(36)`
- **WHEN** 系统启动且 sessions 表缺少 workflow_stage 列
- **THEN** 自动执行 `ALTER TABLE sessions ADD COLUMN workflow_stage VARCHAR(32)`

#### Scenario: 新表创建
- **WHEN** 系统启动
- **THEN** 自动创建 workflows、workflow_stages、agent_roles 表（通过 Base.metadata.create_all）

---

### Requirement: 注册到应用

系统 SHALL 在 `backend/app/main.py` 中初始化并注册 WorkflowEngine。

#### Scenario: 启动时初始化
- **WHEN** FastAPI 应用启动
- **THEN** 创建 WorkflowEngine 实例（传入 session_factory）
- **AND** 存储到 `app.state.workflow_engine`
- **AND** 记录日志 "Loop Engineering 工作流引擎已初始化"

---

## 风险

| 风险 | 影响范围 | 概率 | 缓解措施 |
|------|----------|------|----------|
| 阶段状态机逻辑错误 | 工作流核心 | 中 | 单元测试覆盖所有状态转换路径 |
| 数据库迁移失败 | 启动流程 | 低 | try/except 捕获，不阻塞启动 |
| 迭代闭环无限循环 | 工作流执行 | 中 | 最大迭代次数限制（3 轮） |
| 阶段间上下文丢失 | 工作流质量 | 中 | 结构化上下文传递 + 关键信息摘要 |

## 成功标准

- 6 阶段工作流正确串联执行（pending → clarifying → designing → prompting → executing → reviewing → completed/failed）
- 阶段切换延迟 < 2 秒
- 迭代闭环最多 3 轮自动终止
- 工作流中断后可恢复（回退到指定阶段）
- 所有新增模型正确创建，数据库迁移成功
- 原有端点（optimize/plan/execute/validate/full）功能无回归
