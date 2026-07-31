# G33-01 EnterpriseWorkflowEngine 详细 SPEC

**周期**：Cycle 33 (v6.92.0)  
**任务**：G33-01 企业全场景工作流引擎  
**日期**：2026-07-30

---

## 一、目标

实现企业级工作流编排引擎，集成 30+ 引擎作为工作流步骤，提供 5 个开箱即用的企业场景模板。

---

## 二、设计原则

1. **零修改既有引擎**：通过适配器层调用现有引擎
2. **声明式 DSL**：JSON 定义工作流，便于审计
3. **事件驱动**：所有步骤通过事件总线解耦
4. **可观测性**：每步有结构化日志、指标、追踪
5. **故障容错**：自动重试、回滚、超时

---

## 三、核心类型定义

```typescript
// 工作流场景
export interface WorkflowScenario {
  id: string;                                    // sc-<name>
  name: string;
  description: string;
  category: 'onboarding' | 'review' | 'compliance' | 'security' | 'task' | 'custom';
  version: string;                               // 语义化版本
  steps: WorkflowStep[];                         // 步骤列表
  variables?: WorkflowVariable[];                // 输入变量定义
  outputs?: WorkflowOutput[];                    // 输出定义
  metadata?: Record<string, any>;
  tags?: string[];
  author?: string;
  createdAt: number;
  updatedAt: number;
}

// 工作流步骤
export interface WorkflowStep {
  id: string;                                    // step-<n>
  name: string;
  type: 'engine' | 'condition' | 'parallel' | 'loop' | 'approval' | 'delay' | 'subworkflow';
  // engine 类型
  engineId?: string;                             // 调用的引擎 ID
  method?: string;                               // 调用的方法
  args?: Record<string, any>;                    // 参数
  // condition 类型
  condition?: WorkflowCondition;                 // 条件表达式
  thenSteps?: string[];                          // 满足时执行的步骤 ID
  elseSteps?: string[];                          // 不满足时执行的步骤 ID
  // parallel 类型
  branches?: string[][];                         // 并行分支
  // loop 类型
  iterator?: string;                             // 迭代变量
  collection?: string;                           // 集合表达式
  body?: string[];                               // 循环体步骤
  // approval 类型
  approvers?: string[];                          // 审批人
  timeoutMs?: number;
  // delay 类型
  delayMs?: number;
  // subworkflow 类型
  scenarioId?: string;

  // 通用
  retryPolicy?: RetryPolicy;
  timeoutMs?: number;
  continueOnError?: boolean;
  dependsOn?: string[];                          // 依赖步骤
  metadata?: Record<string, any>;
}

// 重试策略
export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier?: number;
  retryOn?: string[];                            // 重试的错误类型
}

// 条件
export interface WorkflowCondition {
  expression: string;                            // 表达式，如 "$.steps.step1.output.success == true"
  language?: 'jsonpath' | 'jmespath' | 'simple';
}

// 变量定义
export interface WorkflowVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  default?: any;
  description?: string;
}

// 输出定义
export interface WorkflowOutput {
  name: string;
  value: string;                                 // 表达式
  description?: string;
}

// 工作流执行实例
export interface WorkflowExecution {
  id: string;                                    // wf-<timestamp>-<random>
  scenarioId: string;
  scenarioVersion: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  variables: Record<string, any>;
  context: Record<string, any>;                  // 步骤间共享上下文
  currentStepId?: string;
  stepExecutions: StepExecution[];
  startTime: number;
  endTime?: number;
  error?: string;
  metadata?: Record<string, any>;
}

// 步骤执行
export interface StepExecution {
  id: string;
  stepId: string;
  stepName: string;
  type: WorkflowStep['type'];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled' | 'awaiting_approval';
  attempt: number;
  input?: any;
  output?: any;
  error?: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  approvedBy?: string;
  approvalNotes?: string;
}

// 工作流事件
export type WorkflowEvent =
  | 'scenario-registered'
  | 'scenario-updated'
  | 'scenario-deleted'
  | 'execution-started'
  | 'execution-completed'
  | 'execution-failed'
  | 'execution-cancelled'
  | 'step-started'
  | 'step-completed'
  | 'step-failed'
  | 'step-retrying'
  | 'step-awaiting-approval'
  | 'step-approved'
  | 'step-rejected';
```

---

## 四、核心 API

```typescript
export class EnterpriseWorkflowEngine {
  // 场景管理
  registerScenario(scenario: Omit<WorkflowScenario, 'id' | 'createdAt' | 'updatedAt'>): WorkflowScenario;
  updateScenario(scenarioId: string, updates: Partial<WorkflowScenario>): WorkflowScenario;
  deleteScenario(scenarioId: string): void;
  getScenario(scenarioId: string): WorkflowScenario | undefined;
  listScenarios(filter?: { category?: string; tag?: string }): WorkflowScenario[];
  publishVersion(scenarioId: string, version: string, changelog?: string): WorkflowScenario;

  // 执行控制
  execute(scenarioId: string, variables?: Record<string, any>, options?: { executionId?: string }): Promise<WorkflowExecution>;
  pause(executionId: string): void;
  resume(executionId: string, approvalData?: Record<string, any>): Promise<WorkflowExecution>;
  cancel(executionId: string, reason?: string): void;
  retry(executionId: string, stepId?: string): Promise<WorkflowExecution>;

  // 状态查询
  getExecution(executionId: string): WorkflowExecution | undefined;
  listExecutions(filter?: { scenarioId?: string; status?: WorkflowExecution['status']; from?: number; to?: number }): WorkflowExecution[];
  getStepOutput(executionId: string, stepId: string): any;
  getExecutionLog(executionId: string): ExecutionLogEntry[];

  // 引擎注册
  registerEngine(engineId: string, engine: { [method: string]: (...args: any[]) => any }): void;
  listEngines(): string[];

  // 审批
  approveStep(executionId: string, stepId: string, approver: string, notes?: string): Promise<WorkflowExecution>;
  rejectStep(executionId: string, stepId: string, approver: string, reason: string): Promise<WorkflowExecution>;
  listPendingApprovals(userId: string): StepExecution[];

  // 事件订阅
  on(event: WorkflowEvent, listener: (e: any) => void): () => void;

  // 统计
  getStats(): { totalScenarios: number; totalExecutions: number; runningExecutions: number; successRate: number; averageDurationMs: number };
  getMetrics(): WorkflowEngineMetrics;
}
```

---

## 五、5 个预置场景模板

### 5.1 用户入职（user-onboarding）

```json
{
  "name": "User Onboarding",
  "category": "onboarding",
  "version": "1.0.0",
  "steps": [
    {
      "id": "step-1",
      "name": "SSO 验证",
      "type": "engine",
      "engineId": "sso",
      "method": "validateSession",
      "args": { "sessionId": "$.variables.sessionId" }
    },
    {
      "id": "step-2",
      "name": "策略检查",
      "type": "engine",
      "engineId": "policy",
      "method": "evaluate",
      "args": {
        "context": {
          "user": "$.steps.step-1.output.user",
          "action": "user.onboard",
          "resource": { "type": "user" }
        }
      }
    },
    {
      "id": "step-3",
      "name": "SCIM 同步",
      "type": "engine",
      "engineId": "sso",
      "method": "scimSyncUsers",
      "args": { "providerId": "$.variables.ssoProvider" }
    },
    {
      "id": "step-4",
      "name": "审计记录",
      "type": "engine",
      "engineId": "audit",
      "method": "log",
      "args": {
        "who": "$.steps.step-1.output.user",
        "what": "user.onboard",
        "resource": { "type": "user", "id": "$.variables.userId" },
        "outcome": "success"
      }
    },
    {
      "id": "step-5",
      "name": "通知团队",
      "type": "engine",
      "engineId": "communication",
      "method": "sendNotification",
      "args": {
        "channel": "team",
        "message": "新成员入职"
      }
    }
  ]
}
```

### 5.2 代码审查（code-review）

```json
{
  "name": "Code Review Workflow",
  "category": "review",
  "version": "1.0.0",
  "steps": [
    {
      "id": "step-1",
      "name": "创建 Worktree",
      "type": "engine",
      "engineId": "worktree",
      "method": "create",
      "args": { "branch": "$.variables.branch" }
    },
    {
      "id": "step-2",
      "name": "自动代码评审",
      "type": "engine",
      "engineId": "codeReview",
      "method": "review",
      "args": { "worktreeId": "$.steps.step-1.output.id" }
    },
    {
      "id": "step-3",
      "name": "运行测试",
      "type": "engine",
      "engineId": "test",
      "method": "run",
      "args": { "worktreeId": "$.steps.step-1.output.id" }
    },
    {
      "id": "step-4",
      "name": "策略检查",
      "type": "engine",
      "engineId": "policy",
      "method": "evaluate",
      "args": { "action": "pr.merge" }
    },
    {
      "id": "step-5",
      "name": "人工审批",
      "type": "approval",
      "approvers": ["$.variables.reviewers"],
      "timeoutMs": 86400000
    },
    {
      "id": "step-6",
      "name": "审计记录",
      "type": "engine",
      "engineId": "audit",
      "method": "log"
    }
  ]
}
```

### 5.3 合规审计（compliance-audit）

```json
{
  "name": "Compliance Audit",
  "category": "compliance",
  "version": "1.0.0",
  "steps": [
    {
      "id": "step-1",
      "name": "拉取审计事件",
      "type": "engine",
      "engineId": "audit",
      "method": "query",
      "args": { "from": "$.variables.from", "to": "$.variables.to" }
    },
    {
      "id": "step-2",
      "name": "验证 Hash Chain",
      "type": "engine",
      "engineId": "audit",
      "method": "verifyChain"
    },
    {
      "id": "step-3",
      "name": "生成 SOC 2 报告",
      "type": "engine",
      "engineId": "audit",
      "method": "generateSOC2Report"
    },
    {
      "id": "step-4",
      "name": "导出 PDF",
      "type": "engine",
      "engineId": "export",
      "method": "toPDF",
      "args": { "report": "$.steps.step-3.output" }
    },
    {
      "id": "step-5",
      "name": "归档",
      "type": "engine",
      "engineId": "archive",
      "method": "archive"
    }
  ]
}
```

### 5.4 安全应急（security-incident）

```json
{
  "name": "Security Incident Response",
  "category": "security",
  "version": "1.0.0",
  "steps": [
    {
      "id": "step-1",
      "name": "检测异常",
      "type": "engine",
      "engineId": "threatDetection",
      "method": "detect"
    },
    {
      "id": "step-2",
      "name": "条件分支",
      "type": "condition",
      "condition": "$.steps.step-1.output.severity == 'critical'",
      "thenSteps": ["step-3", "step-4", "step-5"],
      "elseSteps": ["step-6"]
    },
    {
      "id": "step-3",
      "name": "隔离用户",
      "type": "engine",
      "engineId": "sso",
      "method": "revokeAllSessions"
    },
    {
      "id": "step-4",
      "name": "通知 SOC",
      "type": "engine",
      "engineId": "notification",
      "method": "sendPagerDuty"
    },
    {
      "id": "step-5",
      "name": "审计告警",
      "type": "engine",
      "engineId": "audit",
      "method": "log",
      "args": { "severity": "critical" }
    },
    {
      "id": "step-6",
      "name": "记录日志",
      "type": "engine",
      "engineId": "audit",
      "method": "log"
    }
  ]
}
```

### 5.5 日常任务（daily-task）

```json
{
  "name": "Daily Task Automation",
  "category": "task",
  "version": "1.0.0",
  "steps": [
    {
      "id": "step-1",
      "name": "编排多代理",
      "type": "engine",
      "engineId": "orchestratedAgent",
      "method": "execute"
    },
    {
      "id": "step-2",
      "name": "成本归因",
      "type": "engine",
      "engineId": "costAttribution",
      "method": "attribute"
    },
    {
      "id": "step-3",
      "name": "阈值检查",
      "type": "engine",
      "engineId": "costThreshold",
      "method": "check"
    },
    {
      "id": "step-4",
      "name": "生成报告",
      "type": "engine",
      "engineId": "report",
      "method": "generate"
    }
  ]
}
```

---

## 六、执行算法

```typescript
async function executeStep(step: WorkflowStep, execution: WorkflowExecution): Promise<StepExecution> {
  const stepExec: StepExecution = {
    id: `sexec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    stepId: step.id,
    stepName: step.name,
    type: step.type,
    status: 'running',
    attempt: 0,
    startTime: Date.now(),
  };

  try {
    switch (step.type) {
      case 'engine':
        return await executeEngineStep(step, stepExec, execution);
      case 'condition':
        return await executeConditionStep(step, stepExec, execution);
      case 'parallel':
        return await executeParallelStep(step, stepExec, execution);
      case 'loop':
        return await executeLoopStep(step, stepExec, execution);
      case 'approval':
        return await executeApprovalStep(step, stepExec, execution);
      case 'delay':
        return await executeDelayStep(step, stepExec, execution);
      case 'subworkflow':
        return await executeSubworkflowStep(step, stepExec, execution);
    }
  } catch (err) {
    stepExec.status = 'failed';
    stepExec.error = err instanceof Error ? err.message : String(err);
    stepExec.endTime = Date.now();
    stepExec.durationMs = stepExec.endTime - stepExec.startTime;
    return stepExec;
  }
}
```

---

## 七、UI 组件设计

`EnterpriseWorkflowPanel`：
- 场景模板列表（5 个预置 + 自定义）
- 工作流执行历史
- 步骤时间轴可视化
- 审批队列
- 状态徽章（pending/running/completed/failed）

---

## 八、测试策略

### 8.1 单元测试（≥ 80 覆盖）
- 场景 CRUD
- 执行生命周期
- 步骤重试 + 超时
- 条件分支
- 并行执行
- 循环执行
- 审批流
- 子工作流嵌套
- 错误处理
- 事件订阅

### 8.2 集成测试
- 5 个预置场景端到端执行
- 30+ 引擎集成调用
- 跨场景协同

---

## 九、依赖

- DynamicWorkflowEngine (Cycle 30)
- OrchestratedAgentEngine (Cycle 30)
- CostAttributionEngine (Cycle 31)
- AuditTrailEngine (Cycle 32)
- SSOEngine (Cycle 32)
- PolicyEngine (Cycle 32)
- WorktreeSyncEngine (Cycle 31)
- CostThresholdAlertEngine (Cycle 30)

---

## 十、风险与缓解

| 风险 | 缓解 |
|------|------|
| 引擎方法签名变化 | 适配器层 + 类型检查 |
| 步骤执行时间过长 | 超时控制 + 异步 |
| 审批流死锁 | 超时自动拒绝 |

---

## 十一、验收标准

- [ ] 5 个预置场景可独立运行
- [ ] 自定义场景支持 JSON DSL
- [ ] 步骤时间轴可视化
- [ ] 审批流闭环
- [ ] 单元测试 ≥ 80 覆盖
- [ ] E2E 集成测试通过
