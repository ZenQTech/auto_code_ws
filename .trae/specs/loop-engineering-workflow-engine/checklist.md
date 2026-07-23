# Checklist: Loop Engineering 工作流引擎

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/loop-engineering-workflow-engine/spec.md)

---

## 数据模型

- [x] WorkflowStatus 枚举已添加到 models.py（9 个值：PENDING/CLARIFYING/DESIGNING/PROMPTING/EXECUTING/REVIEWING/ITERATING/COMPLETED/FAILED）
- [x] StageStatus 枚举已添加到 models.py（4 个值：PENDING/IN_PROGRESS/COMPLETED/FAILED）
- [x] Workflow 模型已添加（14 个字段 + WorkflowStage 一对多关系）
- [x] WorkflowStage 模型已添加（10 个字段 + FK 关联 workflows.id CASCADE）
- [x] AgentRole 模型已添加（6 个字段）
- [x] Session 模型已扩展（workflow_id、workflow_stage 字段）
- [x] sessions.workflow_id 列迁移已添加到 database.py
- [x] sessions.workflow_stage 列迁移已添加到 database.py

## 工作流引擎

- [x] workflow_engine.py 已创建
- [x] WorkflowEngine.__init__ 接受 session_factory 参数
- [x] start_workflow 方法已实现（创建 Workflow + 5 个 WorkflowStage + 更新 Session）
- [x] advance_stage 方法已实现（标记当前完成 + 推进到下一阶段 + 更新 Session）
- [x] rollback_stage 方法已实现（重置目标及后续阶段 + 标记目标为进行中）
- [x] get_workflow_status 方法已实现（返回完整状态 + 进度计算）
- [x] mark_completed 方法已实现
- [x] mark_failed 方法已实现
- [x] start_iteration 方法已实现（检查迭代次数 + 回退到 executing）
- [x] update_stage_output 方法已实现
- [x] update_workflow_docs 方法已实现
- [x] 阶段状态机正确：pending → clarifying → designing → prompting → executing → reviewing → completed/failed
- [x] 迭代闭环控制：reviewing → iterating → executing，最多 3 轮
- [x] 阶段中文显示名映射正确

## 工作流 API

- [x] workflow.py 已重写（保留旧端点兼容）
- [x] POST /api/workflow/start 端点已实现
- [x] GET /api/workflow/{id}/status 端点已实现
- [x] POST /api/workflow/{id}/advance 端点已实现
- [x] POST /api/workflow/{id}/rollback 端点已实现
- [x] GET /api/workflow/{id}/stages 端点已实现
- [x] Pydantic 请求/响应模型已添加
- [x] 原有端点（optimize/plan/execute/validate/full）功能无回归

## 注册到应用

- [x] main.py 中 WorkflowEngine 已初始化
- [x] app.state.workflow_engine 已设置

## 验证

- [x] Python 导入测试通过（所有新模型和枚举）
- [x] 数据库迁移测试通过（旧数据库启动后自动添加新列）
- [x] 工作流引擎单元测试通过（start/advance/rollback/status/complete/fail/iterate）
- [x] API 端点测试通过（所有 5 个新端点）
- [x] 原有端点兼容性测试通过
