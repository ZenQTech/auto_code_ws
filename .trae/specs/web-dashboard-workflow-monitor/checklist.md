# Checklist: Web Dashboard 工作流监控

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/web-dashboard-workflow-monitor/spec.md)

---

## 后端 Dashboard API

- [x] dashboard.py 已创建
- [x] GET /api/dashboard/workflow/{id} 端点已实现
- [x] GET /api/dashboard/workflow/{id}/stages/{stage} 端点已实现
- [x] api/__init__.py 中 dashboard 路由已注册

## 前端类型定义

- [x] LoopWorkflowStatus 接口已添加到 types/index.ts
- [x] LoopWorkflowStage 接口已添加到 types/index.ts
- [x] StageDetail 接口已添加到 types/index.ts

## 前端 API Hooks

- [x] startWorkflow 函数已添加到 useApi.ts
- [x] fetchWorkflowStatus 函数已添加到 useApi.ts
- [x] advanceWorkflow 函数已添加到 useApi.ts
- [x] rollbackWorkflow 函数已添加到 useApi.ts
- [x] fetchStageDetail 函数已添加到 useApi.ts

## WorkflowDashboard 组件

- [x] Props 接口已升级为 LoopWorkflowStatus
- [x] 6 阶段横向步骤条已实现
- [x] 阶段状态图标和颜色映射已实现（pending/in_progress/completed/failed）
- [x] 阶段间连接线已实现
- [x] 进度百分比条已实现（颜色随进度变化）
- [x] 当前阶段提示已实现（阶段名称 + 迭代次数 + 错误信息）
- [x] 阶段点击交互已实现（onStageClick 回调）
- [x] 加载态骨架屏已实现
- [x] 空态提示已实现

## StageViewer 组件

- [x] StageViewer.tsx 已创建
- [x] 阶段详情展示已实现（名称、状态标签、角色、时间、输出文档、对话摘要）
- [x] 操作按钮已实现（重试/跳过）
- [x] 加载态骨架屏已实现
- [x] 空态提示已实现

## 验证

- [x] 后端 API 端点测试通过
- [x] 前端 TypeScript 编译通过
- [x] Dashboard 加载时间 < 1 秒
- [x] 阶段切换动画流畅（60fps）
