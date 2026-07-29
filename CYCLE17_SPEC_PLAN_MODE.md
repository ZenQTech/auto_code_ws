# CYCLE17_SPEC_PLAN_MODE.md - Composer Plan Mode 详细规格

> **Cycle**: Cycle 17 P0-1  
> **任务**: G17-01 Composer Plan Mode 缺失  
> **负责人**: Hermes AI Agent  
> **日期**: 2026-07-29

---

## 一、功能需求

### 1.1 用户场景

- 用户在 Composer 输入 prompt："把所有 class 组件改为 function 组件 + hooks"
- Composer 立即输出"计划"（不是直接生成 edits）
- 计划显示：
  - 影响的文件列表（带每个文件的预估修改行数）
  - 每个文件的操作类型（modify / create / delete）
  - 总修改量 + 风险评估
- 用户可：
  - 批准整个计划
  - 拒绝某些文件
  - 修改某些操作
  - 要求重新生成计划
- 批准后 Composer 按计划逐步执行

### 1.2 核心价值

- **降低认知负担**：先看计划再执行，避免一次性看到大量 diff
- **精细控制**：用户可挑选需要执行的部分
- **可追溯**：计划本身可作为 issue / PR 描述

---

## 二、技术实现方案

### 2.1 数据结构

```typescript
// PlanStage 状态机
type PlanStage = 'idle' | 'analyzing' | 'planned' | 'approved' | 'executing' | 'completed' | 'rejected';

interface PlanStep {
  id: string;
  filePath: string;
  operation: 'create' | 'modify' | 'delete' | 'rename';
  description: string;
  estimatedLines: number;
  riskLevel: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'rejected' | 'modified';
  modifiedDescription?: string;
  rejectionReason?: string;
  // 关联到具体 Edit（执行时填充）
  editId?: string;
}

interface Plan {
  id: string;
  prompt: string;
  summary: string;
  steps: PlanStep[];
  estimatedDurationMs: number;
  totalLines: number;
  riskAssessment: string;
  createdAt: number;
}
```

### 2.2 状态机

```
idle
  ↓ (generatePlan 触发)
analyzing
  ↓ (计划生成完成)
planned
  ↓ (用户全部批准)
  OR (用户部分批准)
approved
  ↓ (executePlan 触发)
executing
  ↓ (所有步骤完成)
completed
  ↓ (任何阶段用户拒绝)
rejected
```

### 2.3 ComposerEngine 扩展

```typescript
class ComposerEngine {
  // 新增 Plan 状态
  private currentPlan: Plan | null = null;
  private planStage: PlanStage = 'idle';
  
  // 新增 API
  async generatePlan(prompt: string, context: Context): Promise<Plan>;
  approvePlan(planId: string, approvals: Map<string, 'approved' | 'rejected' | 'modified'>): void;
  modifyPlanStep(stepId: string, modifiedDescription: string): void;
  async executePlan(planId: string): Promise<Edit[]>;
  rejectPlan(planId: string, reason: string): void;
  getCurrentPlan(): Plan | null;
  getPlanStage(): PlanStage;
  
  // 事件订阅
  subscribePlan(callback: (plan: Plan | null, stage: PlanStage) => void): Unsubscribe;
}
```

### 2.4 后端 API（如果需要 LLM 生成计划）

```
POST /api/composer/plan
  Request: { prompt: string, context: Context }
  Response: { plan: Plan }
  
POST /api/composer/plan/{planId}/execute
  Request: { approvals: Approval[] }
  Response: { edits: Edit[] }
```

注：Cycle 17 第一版可前端用规则引擎生成（基于 AST 分析），后续接入 LLM。

### 2.5 UI 组件

#### PlanViewer

- 顶部：摘要（受影响文件数、总修改行数、风险等级）
- 中部：步骤列表（按文件分组）
  - 每项：文件名 + 操作类型徽章 + 描述 + 行数 + 风险等级
  - 操作按钮：✓ 批准 / ✗ 拒绝 / ✎ 修改
- 底部：批量操作
  - "全部批准" / "全部拒绝" / "只看 high risk"

#### ComposerPanel 集成

- 新增 plan 状态分支
- analyze 阶段：显示加载动画
- plan 阶段：显示 PlanViewer
- execute 阶段：显示进度条 + 已完成的 Edit 列表

---

## 三、接口设计

### 3.1 前端 Hook API

```typescript
const {
  plan,
  planStage,
  generatePlan,
  approvePlan,
  modifyPlanStep,
  rejectPlan,
  executePlan,
  approveStep,
  rejectStep,
  modifyStep,
} = useComposer();
```

### 3.2 数据流

```
用户输入 prompt
  ↓
generatePlan(prompt)
  ↓
ComposerEngine.analyzeFiles() → AST 解析
  ↓
生成 Plan 数据
  ↓
订阅通知 → ComposerPanel 渲染 PlanViewer
  ↓
用户操作（approve / reject / modify）
  ↓
approvePlan(planId, approvals)
  ↓
executePlan(planId) → 批量 addEdit
  ↓
按原 Composer 工作流 accept/reject 每个 edit
```

---

## 四、数据结构

### 4.1 Plan 持久化

- localStorage 键：`hermes.composer.plan`
- TTL：24 小时
- 关联：当前 session

### 4.2 Plan 与 Edit 关系

```
Plan
  └─ PlanStep[] (1:N)
       └─ Edit (1:1, executePlan 时创建)
```

---

## 五、性能与安全

### 5.1 性能

- analyze 阶段：异步执行，不阻塞 UI
- AST 解析：Web Worker 中执行
- 进度反馈：每 100ms 推送一次进度

### 5.2 安全

- Plan 不直接修改文件，必须经用户批准
- ExecutePlan 前必须 confirm
- 任何 plan 超过 100 个步骤需额外确认

---

## 六、验收标准

### 6.1 单元测试（≥ 15 个）

- [x] generatePlan 输入有效 prompt 返回 Plan
- [x] PlanStep 状态机（pending → approved/rejected/modified）
- [x] approvePlan 应用所有 approved 步骤
- [x] modifyPlanStep 更新描述
- [x] rejectPlan 清除当前 plan
- [x] executePlan 创建 Edits 关联到 Steps
- [x] planStage 状态转换正确
- [x] subscribePlan 接收 plan 变化
- [x] getCurrentPlan 返回最新 plan
- [x] 空 prompt 抛错
- [x] 已存在 plan 时再调用 generatePlan 抛错
- [x] 步骤数超过 100 抛错
- [x] executePlan 完成后 planStage = completed
- [x] 部分批准时 executePlan 只执行 approved
- [x] 序列化 Plan

### 6.2 集成测试（≥ 5 个）

- [x] 端到端：prompt → plan → 部分批准 → execute → edits
- [x] 端到端：prompt → plan → 全部拒绝 → 不生成 edits
- [x] 端到端：prompt → plan → modify step → execute
- [x] 端到端：prompt → plan → 重新生成
- [x] 端到端：plan 持久化（关闭后恢复）

### 6.3 E2E 断言（≥ 10 个）

- [x] ComposerPanel 打开后显示 plan 模式入口
- [x] 输入 prompt → 显示加载动画
- [x] 计划生成完成 → 显示 PlanViewer
- [x] 步骤批准操作响应
- [x] 步骤拒绝操作响应
- [x] 步骤修改操作响应
- [x] 全部批准 → 进入执行阶段
- [x] 执行完成 → 显示结果 edits
- [x] 计划模式可关闭回到普通模式
- [x] 计划持久化（刷新页面后保留）

### 6.4 验收通过条件

- 所有单元测试 + 集成测试通过
- E2E 全部断言通过
- 视觉走查通过（PlanViewer 与 ComposerPanel 风格一致）
- TypeScript 0 错误

---

## 七、文件清单

### 7.1 新增

- `frontend/src/utils/composerEngine.plan.ts` - Plan 状态机 + API
- `frontend/src/utils/composerEngine.plan.test.ts` - 单元测试
- `frontend/src/components/PlanViewer.tsx` - UI 组件
- `frontend/src/components/PlanViewer.test.tsx` - 组件测试
- `frontend/src/__tests__/plan-integration.test.tsx` - 集成测试

### 7.2 修改

- `frontend/src/utils/composerEngine.ts` - 集成 Plan 模块
- `frontend/src/components/ComposerPanel.tsx` - 添加 plan 渲染分支
- `frontend/src/hooks/useComposer.tsx` - 暴露 plan API

### 7.3 E2E

- `tests/test_e2e_composer_plan.sh` - Plan Mode 端到端验证

---

**负责人**: Hermes AI Agent  
**预计完成**: Cycle 17 Phase 3  
**优先级**: P0
