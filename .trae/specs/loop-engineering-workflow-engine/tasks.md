# Tasks: Loop Engineering 工作流引擎

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/loop-engineering-workflow-engine/spec.md)

---

## Task 1: 数据模型

- [x] 1.1 在 `backend/app/models.py` 中新增 `WorkflowStatus` 枚举（9 个值）
- [x] 1.2 在 `backend/app/models.py` 中新增 `StageStatus` 枚举（4 个值）
- [x] 1.3 在 `backend/app/models.py` 中新增 `Workflow` ORM 模型（14 个字段 + WorkflowStage 一对多关系）
- [x] 1.4 在 `backend/app/models.py` 中新增 `WorkflowStage` ORM 模型（10 个字段 + FK 关联）
- [x] 1.5 在 `backend/app/models.py` 中新增 `AgentRole` ORM 模型（6 个字段）
- [x] 1.6 扩展 `Session` 模型：新增 `workflow_id`、`workflow_stage` 字段
- [x] 1.7 在 `backend/app/database.py` 中新增 `sessions.workflow_id` 列迁移
- [x] 1.8 在 `backend/app/database.py` 中新增 `sessions.workflow_stage` 列迁移

## Task 2: 工作流引擎

- [x] 2.1 创建 `backend/app/services/workflow_engine.py`
- [x] 2.2 实现 `WorkflowEngine.__init__(session_factory)` 构造函数
- [x] 2.3 实现 `start_workflow(session_id, user_input) -> Workflow`
- [x] 2.4 实现 `advance_stage(workflow_id) -> WorkflowStage`
- [x] 2.5 实现 `rollback_stage(workflow_id, target_stage) -> WorkflowStage`
- [x] 2.6 实现 `get_workflow_status(workflow_id) -> WorkflowStatusInfo`
- [x] 2.7 实现 `mark_completed(workflow_id) -> Workflow`
- [x] 2.8 实现 `mark_failed(workflow_id, error_message) -> Workflow`
- [x] 2.9 实现 `start_iteration(workflow_id) -> Workflow`
- [x] 2.10 实现 `update_stage_output(workflow_id, stage_name, output_doc, ...) -> WorkflowStage`
- [x] 2.11 实现 `update_workflow_docs(workflow_id, **docs) -> Workflow`
- [x] 2.12 实现阶段状态机转换逻辑（`_get_next_stage`、`_stage_to_workflow_status`）
- [x] 2.13 实现迭代闭环控制（最大 3 轮自动终止）
- [x] 2.14 实现阶段中文显示名映射（`_stage_display_name`）

## Task 3: 工作流 API

- [x] 3.1 重写 `backend/app/api/workflow.py`（保留旧端点兼容）
- [x] 3.2 实现 `POST /api/workflow/start` — 启动工作流
- [x] 3.3 实现 `GET /api/workflow/{id}/status` — 获取工作流状态
- [x] 3.4 实现 `POST /api/workflow/{id}/advance` — 推进到下一阶段
- [x] 3.5 实现 `POST /api/workflow/{id}/rollback` — 回退到指定阶段
- [x] 3.6 实现 `GET /api/workflow/{id}/stages` — 获取所有阶段详情
- [x] 3.7 新增 Pydantic 请求/响应模型（StartWorkflowRequest、RollbackRequest、WorkflowStatusResponse、WorkflowStageResponse）

## Task 4: 注册到应用

- [x] 4.1 在 `backend/app/main.py` 中初始化 WorkflowEngine
- [x] 4.2 存储到 `app.state.workflow_engine`

## Task 5: 验证

- [x] 5.1 Python 导入测试：所有新模型和枚举正确加载
- [x] 5.2 数据库迁移测试：旧数据库启动后自动添加新列
- [x] 5.3 工作流引擎单元测试：start/advance/rollback/status/complete/fail/iterate
- [x] 5.4 API 端点测试：所有 5 个新端点返回正确响应
- [x] 5.5 原有端点兼容性测试：optimize/plan/execute/validate/full 无回归

---

## 任务依赖关系

```
Task 1 (数据模型) → Task 2 (工作流引擎) → Task 3 (工作流 API)
                                          → Task 4 (注册到应用)
Task 5 (验证) 在所有任务完成后执行
```
