# G33-03 SecurityAuditEngine 详细 SPEC

**周期**：Cycle 33 (v6.94.0)  
**任务**：G33-03 安全审计场景引擎  
**日期**：2026-07-30

---

## 一、目标

实现安全审计场景引擎，提供 7 个预置攻击场景的自动化执行 + 验证 + 报告。

---

## 二、设计原则

1. **零误报**：每个场景都有明确的预期
2. **可重放**：场景执行可重复
3. **可审计**：所有执行有详细日志
4. **CI/CD 友好**：可集成到流水线
5. **应急响应**：触发后可启动应急流程

---

## 三、核心类型定义

```typescript
// 攻击场景
export interface AttackScenario {
  id: string;                                    // atk-<name>
  name: string;
  description: string;
  category: 'authentication' | 'authorization' | 'data' | 'session' | 'privilege' | 'malicious' | 'integrity';
  severity: 'low' | 'medium' | 'high' | 'critical';
  version: string;

  // 场景定义
  setup: ScenarioStep[];                         // 准备步骤
  attack: ScenarioStep[];                        // 攻击步骤
  validation: ValidationStep[];                  // 验证步骤
  cleanup?: ScenarioStep[];                      // 清理步骤

  // 预期结果
  expectedOutcome: {
    blocked: boolean;                            // 是否被阻断
    alerted: boolean;                            // 是否告警
    audited: boolean;                            // 是否审计
    maxAllowedSteps?: number;                    // 允许的最大步骤
  };

  metadata?: Record<string, any>;
  tags?: string[];
  author?: string;
  createdAt: number;
  updatedAt: number;
}

// 场景步骤
export interface ScenarioStep {
  id: string;
  name: string;
  action: string;                                // 调用的方法
  args?: Record<string, any>;
  delayMs?: number;                              // 步骤间延迟
  repeat?: number;                               // 重复次数
  parallel?: boolean;
}

// 验证步骤
export interface ValidationStep {
  id: string;
  name: string;
  check: string;                                 // 检查表达式
  expected: any;
  message?: string;
}

// 场景执行
export interface ScenarioExecution {
  id: string;                                    // exec-<timestamp>-<random>
  scenarioId: string;
  scenarioVersion: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  endTime?: number;
  durationMs?: number;
  steps: ScenarioStepResult[];
  validations: ValidationResult[];
  outcome: {
    blocked: boolean;
    alerted: boolean;
    audited: boolean;
  };
  error?: string;
  logs: ScenarioLogEntry[];
}

// 步骤结果
export interface ScenarioStepResult {
  stepId: string;
  stepName: string;
  action: string;
  status: 'success' | 'failure' | 'skipped';
  startTime: number;
  endTime: number;
  durationMs: number;
  output?: any;
  error?: string;
}

// 验证结果
export interface ValidationResult {
  validationId: string;
  name: string;
  passed: boolean;
  actual: any;
  expected: any;
  message?: string;
  timestamp: number;
}

// 日志条目
export interface ScenarioLogEntry {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, any>;
}

// 应急响应
export interface IncidentResponse {
  id: string;
  scenarioId: string;
  executionId: string;
  severity: AttackScenario['severity'];
  status: 'detected' | 'analyzing' | 'containing' | 'eradicating' | 'recovering' | 'closed';
  steps: ResponseStep[];
  startTime: number;
  endTime?: number;
  notes?: string;
}

// 响应步骤
export interface ResponseStep {
  id: string;
  name: string;
  action: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startTime: number;
  endTime?: number;
  output?: any;
}

// 报告
export interface SecurityAuditReport {
  id: string;
  generatedAt: number;
  period: { from: number; to: number };
  totalScenarios: number;
  passed: number;
  failed: number;
  scenarios: ScenarioExecution[];
  summary: {
    blockedAttacks: number;
    unblockedAttacks: number;
    alertsTriggered: number;
    auditEvents: number;
  };
  recommendations: string[];
  compliance: {
    soc2: boolean;
    gdpr: boolean;
    iso27001: boolean;
  };
}

// 事件
export type SecurityAuditEvent =
  | 'scenario-registered'
  | 'scenario-updated'
  | 'execution-started'
  | 'execution-completed'
  | 'execution-failed'
  | 'validation-passed'
  | 'validation-failed'
  | 'incident-detected'
  | 'incident-responded'
  | 'report-generated';
```

---

## 四、核心 API

```typescript
export class SecurityAuditEngine {
  // 场景管理
  registerScenario(scenario: Omit<AttackScenario, 'id' | 'createdAt' | 'updatedAt'>): AttackScenario;
  updateScenario(scenarioId: string, updates: Partial<AttackScenario>): AttackScenario;
  deleteScenario(scenarioId: string): void;
  getScenario(scenarioId: string): AttackScenario | undefined;
  listScenarios(filter?: { category?: string; severity?: AttackScenario['severity'] }): AttackScenario[];

  // 执行控制
  execute(scenarioId: string, options?: { dryRun?: boolean }): Promise<ScenarioExecution>;
  executeAll(options?: { dryRun?: boolean }): Promise<ScenarioExecution[]>;
  pause(executionId: string): void;
  resume(executionId: string): Promise<ScenarioExecution>;
  cancel(executionId: string): void;

  // 状态查询
  getExecution(executionId: string): ScenarioExecution | undefined;
  listExecutions(filter?: { scenarioId?: string; status?: ScenarioExecution['status'] }): ScenarioExecution[];

  // 应急响应
  triggerResponse(scenarioId: string, executionId: string): Promise<IncidentResponse>;
  listActiveIncidents(): IncidentResponse[];
  closeIncident(incidentId: string, notes?: string): void;

  // 报告生成
  generateReport(period: Period): SecurityAuditReport;
  exportReport(period: Period, format: 'json' | 'html' | 'pdf' | 'markdown'): string | Promise<Blob>;

  // CI/CD 集成
  runInCI(scenarioIds?: string[]): Promise<{ passed: number; failed: number; total: number; exitCode: number }>;

  // 事件订阅
  on(event: SecurityAuditEvent, listener: (e: any) => void): () => void;

  // 统计
  getStats(): { totalScenarios: number; totalExecutions: number; passed: number; failed: number; activeIncidents: number };
}
```

---

## 五、7 个预置攻击场景

### 5.1 暴力破解登录（bruteforce-login）

```typescript
{
  name: '暴力破解登录',
  category: 'authentication',
  severity: 'high',
  setup: [
    { id: 's1', name: '创建测试用户', action: 'createTestUser' },
  ],
  attack: [
    { id: 'a1', name: '1000 次错误密码', action: 'ssoLogin', repeat: 1000, args: { wrongPassword: true } },
  ],
  validation: [
    { id: 'v1', name: '账户已锁定', check: 'sso.isAccountLocked', expected: true },
    { id: 'v2', name: '审计告警', check: 'audit.hasEvent', expected: { eventType: 'auth', severity: 'critical' } },
    { id: 'v3', name: '策略阻断', check: 'policy.isBlocked', expected: true },
  ],
  expectedOutcome: { blocked: true, alerted: true, audited: true }
}
```

### 5.2 越权访问（unauthorized-access）

```typescript
{
  name: '越权访问',
  category: 'authorization',
  severity: 'critical',
  setup: [
    { id: 's1', name: '创建普通用户', action: 'createTestUser', args: { role: 'user' } },
  ],
  attack: [
    { id: 'a1', name: '调用 admin API', action: 'callAdminAPI', args: { userRole: 'user' } },
  ],
  validation: [
    { id: 'v1', name: '策略拒绝', check: 'policy.decision', expected: 'deny' },
    { id: 'v2', name: '审计 authz denied', check: 'audit.hasEvent', expected: { eventType: 'authz', outcome: 'denied' } },
  ],
  expectedOutcome: { blocked: true, alerted: true, audited: true }
}
```

### 5.3 数据外泄（data-exfiltration）

```typescript
{
  name: '数据外泄',
  category: 'data',
  severity: 'critical',
  setup: [
    { id: 's1', name: '创建敏感文件', action: 'createSensitiveFiles', args: { count: 100 } },
  ],
  attack: [
    { id: 'a1', name: '批量下载', action: 'batchDownload', args: { limit: 1000 } },
  ],
  validation: [
    { id: 'v1', name: '策略限速', check: 'policy.isRateLimited', expected: true },
    { id: 'v2', name: '审计告警', check: 'audit.hasEvent', expected: { eventType: 'data', severity: 'warn' } },
  ],
  expectedOutcome: { blocked: true, alerted: true, audited: true }
}
```

### 5.4 会话劫持（session-hijack）

```typescript
{
  name: '会话劫持',
  category: 'session',
  severity: 'high',
  setup: [
    { id: 's1', name: '创建会话', action: 'createSession' },
  ],
  attack: [
    { id: 'a1', name: '从异常 IP 访问', action: 'accessFromAnomalousIP', args: { ip: '1.2.3.4' } },
  ],
  validation: [
    { id: 'v1', name: 'SSO 二次验证', check: 'sso.requiresMFA', expected: true },
    { id: 'v2', name: '会话被标记可疑', check: 'sso.isSessionSuspicious', expected: true },
  ],
  expectedOutcome: { blocked: true, alerted: true, audited: true }
}
```

### 5.5 权限提升（privilege-escalation）

```typescript
{
  name: '权限提升',
  category: 'privilege',
  severity: 'critical',
  setup: [
    { id: 's1', name: '创建普通用户', action: 'createTestUser', args: { role: 'user' } },
  ],
  attack: [
    { id: 'a1', name: '尝试获取 admin 角色', action: 'escalateToAdmin' },
  ],
  validation: [
    { id: 'v1', name: '策略拒绝', check: 'policy.decision', expected: 'deny' },
    { id: 'v2', name: '审计 critical', check: 'audit.hasEvent', expected: { eventType: 'authz', severity: 'critical' } },
  ],
  expectedOutcome: { blocked: true, alerted: true, audited: true }
}
```

### 5.6 恶意文件上传（malicious-upload）

```typescript
{
  name: '恶意文件上传',
  category: 'malicious',
  severity: 'high',
  setup: [
    { id: 's1', name: '准备恶意文件', action: 'prepareMaliciousFile' },
  ],
  attack: [
    { id: 'a1', name: '上传恶意文件', action: 'uploadFile', args: { malicious: true } },
  ],
  validation: [
    { id: 'v1', name: '上传被拦截', check: 'upload.wasBlocked', expected: true },
    { id: 'v2', name: '审计告警', check: 'audit.hasEvent', expected: { eventType: 'data', severity: 'critical' } },
  ],
  expectedOutcome: { blocked: true, alerted: true, audited: true }
}
```

### 5.7 审计日志篡改（audit-tampering）

```typescript
{
  name: '审计日志篡改',
  category: 'integrity',
  severity: 'critical',
  setup: [
    { id: 's1', name: '记录审计事件', action: 'logAuditEvent', repeat: 5 },
  ],
  attack: [
    { id: 'a1', name: '尝试修改事件', action: 'tamperAuditEvent' },
  ],
  validation: [
    { id: 'v1', name: 'Hash Chain 验证失败', check: 'audit.verifyChain', expected: { valid: false } },
    { id: 'v2', name: '紧急告警', check: 'audit.hasEvent', expected: { eventType: 'system', severity: 'critical' } },
  ],
  expectedOutcome: { blocked: true, alerted: true, audited: true }
}
```

---

## 六、执行算法

```typescript
async function executeScenario(scenario: AttackScenario, options?: { dryRun?: boolean }): Promise<ScenarioExecution> {
  const execution: ScenarioExecution = {
    id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    status: 'running',
    startTime: Date.now(),
    steps: [],
    validations: [],
    outcome: { blocked: false, alerted: false, audited: false },
    logs: [],
  };

  try {
    // Setup
    for (const step of scenario.setup) {
      await executeScenarioStep(step, execution, options);
    }

    // Attack
    for (const step of scenario.attack) {
      await executeScenarioStep(step, execution, options);
    }

    // Validation
    for (const validation of scenario.validation) {
      const result = await executeValidation(validation, execution);
      execution.validations.push(result);
    }

    // Evaluate outcome
    execution.outcome = {
      blocked: execution.validations.filter(v => v.name.includes('阻断') || v.name.includes('拒绝') || v.name.includes('拦截')).every(v => v.passed),
      alerted: execution.validations.filter(v => v.name.includes('告警')).every(v => v.passed),
      audited: execution.validations.filter(v => v.name.includes('审计')).every(v => v.passed),
    };

    execution.status = execution.validations.every(v => v.passed) ? 'completed' : 'failed';
  } catch (err) {
    execution.status = 'failed';
    execution.error = err instanceof Error ? err.message : String(err);
  } finally {
    execution.endTime = Date.now();
    execution.durationMs = execution.endTime - execution.startTime;
  }

  return execution;
}
```

---

## 七、UI 组件设计

`SecurityAuditPanel`：
- 7 个预置场景卡片
- 执行历史列表
- 实时进度条
- 验证结果可视化
- 应急响应启动按钮
- 报告导出

---

## 八、测试策略

### 8.1 单元测试（≥ 80 覆盖）
- 场景 CRUD
- 执行生命周期
- 步骤执行
- 验证逻辑
- 应急响应
- 报告生成
- CI/CD 集成
- 事件订阅

### 8.2 集成测试
- 7 个预置场景端到端执行
- 真实攻击模拟 + 真实防护验证
- 跨引擎协同

---

## 九、依赖

- AuditTrailEngine (Cycle 32)
- SSOEngine (Cycle 32)
- PolicyEngine (Cycle 32)
- EnterpriseWorkflowEngine (G33-01)
- UnifiedDashboardEngine (G33-02)

---

## 十、风险与缓解

| 风险 | 缓解 |
|------|------|
| 触发真实系统异常 | 沙箱环境 + 干运行模式 |
| 验证逻辑错误 | 多断言 + 重复验证 |
| 应急响应误启动 | 需要用户确认 |

---

## 十一、验收标准

- [ ] 7 个预置场景可独立执行
- [ ] 验证逻辑 100% 准确
- [ ] 报告可导出多格式
- [ ] CI/CD 集成可用
- [ ] 单元测试 ≥ 80 覆盖
- [ ] E2E 集成测试通过
