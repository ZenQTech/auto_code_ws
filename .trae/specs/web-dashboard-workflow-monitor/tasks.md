# Tasks: Web Dashboard 工作流监控

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/web-dashboard-workflow-monitor/spec.md)

---

## Task 1: 后端 Dashboard API

- [x] 1.1 创建 `backend/app/api/dashboard.py`
- [x] 1.2 实现 `GET /api/dashboard/workflow/{id}` — 获取工作流 Dashboard 数据
- [x] 1.3 实现 `GET /api/dashboard/workflow/{id}/stages/{stage}` — 获取阶段详情
- [x] 1.4 在 `backend/app/api/__init__.py` 中注册 dashboard 路由

## Task 2: 前端类型定义

- [x] 2.1 在 `frontend/src/types/index.ts` 中新增 `LoopWorkflowStatus` 接口
- [x] 2.2 在 `frontend/src/types/index.ts` 中新增 `LoopWorkflowStage` 接口
- [x] 2.3 在 `frontend/src/types/index.ts` 中新增 `StageDetail` 接口

## Task 3: 前端 API Hooks

- [x] 3.1 在 `frontend/src/hooks/useApi.ts` 中新增 `startWorkflow(sessionId, userInput)` 函数
- [x] 3.2 在 `frontend/src/hooks/useApi.ts` 中新增 `fetchWorkflowStatus(workflowId)` 函数
- [x] 3.3 在 `frontend/src/hooks/useApi.ts` 中新增 `advanceWorkflow(workflowId)` 函数
- [x] 3.4 在 `frontend/src/hooks/useApi.ts` 中新增 `rollbackWorkflow(workflowId, targetStage)` 函数
- [x] 3.5 在 `frontend/src/hooks/useApi.ts` 中新增 `fetchStageDetail(workflowId, stageName)` 函数

## Task 4: WorkflowDashboard 组件升级

- [x] 4.1 升级 `frontend/src/components/WorkflowDashboard.tsx` Props 接口（LoopWorkflowStatus）
- [x] 4.2 实现 6 阶段横向步骤条（需求澄清→架构设计→提示词工程→代码执行→质量评审→迭代闭环）
- [x] 4.3 实现阶段状态图标和颜色映射（pending/in_progress/completed/failed）
- [x] 4.4 实现阶段间连接线（颜色跟随前一阶段状态）
- [x] 4.5 实现进度百分比条（颜色随进度变化）
- [x] 4.6 实现当前阶段提示（阶段名称 + 迭代次数 + 错误信息）
- [x] 4.7 实现阶段点击交互（onStageClick 回调）
- [x] 4.8 实现加载态骨架屏
- [x] 4.9 实现空态提示

## Task 5: StageViewer 组件

- [x] 5.1 创建 `frontend/src/components/StageViewer.tsx`
- [x] 5.2 实现阶段详情展示（名称、状态标签、角色、时间、输出文档、对话摘要）
- [x] 5.3 实现操作按钮（重试/跳过）
- [x] 5.4 实现加载态骨架屏
- [x] 5.5 实现空态提示

## Task 6: 验证

- [x] 6.1 后端 API 端点测试：Dashboard 和阶段详情返回正确数据
- [x] 6.2 前端 TypeScript 编译通过
- [x] 6.3 Dashboard 加载时间 < 1 秒
- [x] 6.4 阶段切换动画流畅（60fps）

---

## 任务依赖关系

```
Task 1 (后端 API) ─┐
Task 2 (类型定义)  ├── 可并行开发
Task 3 (API Hooks) │
Task 4 (Dashboard) ─┤ 依赖 Task 2、Task 3
Task 5 (StageViewer) ┘ 依赖 Task 2
Task 6 (验证) 在所有任务完成后执行
```
