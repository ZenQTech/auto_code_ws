# Web Dashboard 工作流监控 Spec

> **来源**: [project-optimization-roadmap Task 4](file:///home/qizheng/auto_code_ws/.trae/specs/project-optimization-roadmap/spec.md)
> **优先级**: P1（支撑能力，依赖 Task 1）
> **依赖**: loop-engineering-workflow-engine

## Why

Loop Engineering 工作流执行时间较长（可能数十分钟），用户需要实时了解当前进度和各阶段状态。借鉴 Composio AO（Kanban 视图）和 Agentrooms（Web UI）的设计，提供可视化 Dashboard，展示 6 阶段进度条、阶段详情、智能体状态，让用户对工作流执行情况一目了然。

## What Changes

- **新增 Dashboard API**：工作流状态查询、阶段详情查询
- **升级 WorkflowDashboard 组件**：从通用工作流升级为 6 阶段 Loop Engineering 工作流
- **新增 StageViewer 组件**：阶段详情查看器（文档展示、对话摘要、操作按钮）
- **新增前端类型**：LoopWorkflowStatus、LoopWorkflowStage、StageDetail
- **新增前端 API hooks**：startWorkflow、fetchWorkflowStatus、advanceWorkflow、rollbackWorkflow、fetchStageDetail

## Impact

- Affected specs: loop-engineering-workflow-engine（数据来源）
- Affected code:
  - `backend/app/api/dashboard.py` — 新建
  - `backend/app/api/__init__.py` — 注册路由
  - `frontend/src/components/WorkflowDashboard.tsx` — 升级
  - `frontend/src/components/StageViewer.tsx` — 新建
  - `frontend/src/types/index.ts` — 新增类型
  - `frontend/src/hooks/useApi.ts` — 新增 API hooks

---

## ADDED Requirements

### Requirement: Dashboard API

系统 SHALL 在 `backend/app/api/dashboard.py` 中提供工作流监控数据接口。

#### Scenario: 获取工作流 Dashboard 数据
- **WHEN** 前端调用 `GET /api/dashboard/workflow/{workflow_id}`
- **THEN** 返回：
  - workflow_id、session_id、status、current_stage
  - iteration_count、max_iterations
  - progress（已完成阶段数 / 总阶段数 * 100）
  - error_message
  - stages 列表（每个阶段：key、name、status、agent_role、started_at、completed_at）
- **AND** 工作流不存在时返回 404

#### Scenario: 获取阶段详情
- **WHEN** 前端调用 `GET /api/dashboard/workflow/{workflow_id}/stages/{stage_name}`
- **THEN** 返回：
  - stage_name、status、agent_role
  - input_doc、output_doc
  - conversation_summary
  - started_at、completed_at
- **AND** 阶段不存在时返回 404

---

### Requirement: WorkflowDashboard 组件升级

系统 SHALL 将 `frontend/src/components/WorkflowDashboard.tsx` 升级为 Loop Engineering 6 阶段工作流展示。

#### Scenario: 6 阶段进度条
- **WHEN** 工作流启动后
- **THEN** Dashboard SHALL 显示 6 阶段横向步骤条：
  - 需求澄清 → 架构设计 → 提示词工程 → 代码执行 → 质量评审 → 迭代闭环
- **AND** 每阶段用图标和颜色表示状态：
  - ○ 等待中（灰色）
  - ◉ 进行中（金橙色 + 脉冲动画）
  - ✓ 已完成（绿色）
  - ✕ 失败（红色）
- **AND** 阶段之间用连接线表示流转关系
- **AND** 连接线颜色与前一阶段状态一致

#### Scenario: 进度百分比条
- **WHEN** 工作流执行中
- **THEN** Dashboard SHALL 显示整体进度百分比条
- **AND** 进度条颜色随进度变化（< 50% 灰色、50-80% 金橙色、≥ 80% 绿色）

#### Scenario: 当前阶段提示
- **WHEN** 工作流执行中
- **THEN** Dashboard SHALL 在底部显示当前阶段名称
- **AND** 显示迭代次数（如"迭代 1/3"）
- **AND** 如有错误信息，显示红色错误提示

#### Scenario: 阶段点击交互
- **WHEN** 用户点击某个阶段
- **THEN** 触发 `onStageClick(stageKey)` 回调
- **AND** 父组件可据此展示 StageViewer

#### Scenario: 加载态与空态
- **WHEN** 工作流数据加载中
- **THEN** 显示骨架屏（6 个圆形占位 + 进度条占位）
- **WHEN** 无工作流数据
- **THEN** 显示空态提示"暂无工作流数据"

#### 技术实现

**Props**:
```typescript
interface Props {
  workflow: LoopWorkflowStatus | null;
  loading?: boolean;
  onStageClick?: (stageKey: string) => void;
}
```

**状态映射**:
```typescript
const stageStatusMap: Record<StageStatus, { bg, text, border, dot, line, icon }> = {
  pending:     { bg: 'bg-surface-200', text: 'text-surface-500', border: 'border-surface-400', dot: 'bg-surface-400', line: 'bg-surface-400', icon: '○' },
  in_progress: { bg: 'bg-hermes-500/20', text: 'text-hermes-400', border: 'border-hermes-500/30', dot: 'bg-hermes-400 animate-pulse', line: 'bg-hermes-400', icon: '◉' },
  completed:   { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30', dot: 'bg-emerald-400', line: 'bg-emerald-400', icon: '✓' },
  failed:      { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30', dot: 'bg-red-400', line: 'bg-red-400', icon: '✕' },
};
```

---

### Requirement: StageViewer 组件

系统 SHALL 创建 `frontend/src/components/StageViewer.tsx`，展示单个工作流阶段的详细信息。

#### Scenario: 阶段详情展示
- **WHEN** 用户点击某个阶段
- **THEN** StageViewer SHALL 展示：
  - 阶段名称 + 状态标签（带颜色）
  - 智能体角色名称
  - 开始/完成时间
  - 输出文档（Markdown 渲染，最大高度可滚动）
  - 智能体对话摘要

#### Scenario: 操作按钮
- **WHEN** 阶段状态允许操作
- **THEN** StageViewer SHALL 提供：
  - "重试"按钮（金橙色，阶段失败时可用）
  - "跳过"按钮（灰色，阶段未完成时可用）
- **AND** 阶段已完成时隐藏操作按钮

#### Scenario: 加载态与空态
- **WHEN** 阶段数据加载中
- **THEN** 显示骨架屏
- **WHEN** 无阶段数据
- **THEN** 显示空态提示"选择阶段查看详情"

#### 技术实现

**Props**:
```typescript
interface Props {
  stage: StageDetail | null;
  loading?: boolean;
  onRetry?: () => void;
  onSkip?: () => void;
  onClose?: () => void;
}
```

---

### Requirement: 前端类型定义

系统 SHALL 在 `frontend/src/types/index.ts` 中新增 Loop Engineering 工作流相关类型。

#### Scenario: 类型定义
- **WHEN** 前端需要类型安全的工作流数据
- **THEN** SHALL 定义以下接口：

```typescript
/** Loop Engineering 工作流状态 */
interface LoopWorkflowStatus {
  workflow_id: string;
  session_id: string;
  status: string;
  current_stage: string;
  iteration_count: number;
  max_iterations: number;
  progress: number;
  error_message: string;
  stages: LoopWorkflowStage[];
}

/** Loop Engineering 工作流阶段 */
interface LoopWorkflowStage {
  key: string;
  name: string;
  status: StageStatus;
  agent_role?: string;
  started_at?: string;
  completed_at?: string;
}

/** 工作流阶段详情 */
interface StageDetail {
  stage_name: string;
  status: string;
  agent_role?: string;
  input_doc: string;
  output_doc: string;
  conversation_summary: string;
  started_at?: string;
  completed_at?: string;
}
```

---

### Requirement: 前端 API Hooks

系统 SHALL 在 `frontend/src/hooks/useApi.ts` 中新增 Loop Engineering 工作流 API 函数。

#### Scenario: API 函数定义
- **WHEN** 前端需要调用工作流 API
- **THEN** SHALL 提供以下函数：

```typescript
/** 启动 Loop Engineering 工作流 */
async function startWorkflow(sessionId: string, userInput: string): Promise<{
  workflow_id: string; session_id: string; status: string;
  current_stage: string; message: string;
}>

/** 获取工作流状态 */
async function fetchWorkflowStatus(workflowId: string): Promise<LoopWorkflowStatus>

/** 推进工作流到下一阶段 */
async function advanceWorkflow(workflowId: string): Promise<{
  workflow_id: string; stage_name: string; status: string; message: string;
}>

/** 回退工作流 */
async function rollbackWorkflow(workflowId: string, targetStage: string): Promise<{
  workflow_id: string; stage_name: string; status: string; message: string;
}>

/** 获取工作流阶段详情 */
async function fetchStageDetail(workflowId: string, stageName: string): Promise<StageDetail>
```

---

## 风险

| 风险 | 影响范围 | 概率 | 缓解措施 |
|------|----------|------|----------|
| Dashboard 数据更新不及时 | 用户体验 | 中 | 轮询 + WebSocket 实时推送 |
| 阶段切换动画性能 | 前端性能 | 低 | 使用 GPU 合成属性（transform/opacity） |
| 组件与现有 UI 风格不一致 | 视觉一致性 | 低 | 复用现有 glass/hermes/surface 设计令牌 |

## 成功标准

- Dashboard 加载时间 < 1 秒
- 状态更新延迟 < 500ms
- 阶段切换动画流畅（60fps）
- 6 阶段进度条正确展示所有状态
- StageViewer 正确展示阶段详情和操作按钮
