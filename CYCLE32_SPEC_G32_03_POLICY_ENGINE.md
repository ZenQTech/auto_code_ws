# G32-03 SPEC: Policy Engine 策略引擎

**任务编号**：G32-03
**版本**：v6.91.0
**优先级**：P0
**日期**：2026-07-30
**状态**：🟡 设计阶段
**依赖**：G32-01 (Audit Trail)
**被依赖**：所有需要强制执行的入口（authz, cost, agent, worktree）

---

## 一、目标

实现企业级**统一策略规则引擎**，将业务规则从应用代码解耦，支持多维度作用域与强制执行，建立 Hermes 在安全合规维度的规则统一管理能力。

借鉴 **OPA (Open Policy Agent) 的 Rego 思想**，实现 JSON DSL + Rego 子集双语法。

---

## 二、设计原则

1. **声明式（Declarative）**：策略定义"什么"，引擎决定"怎么做"
2. **统一（Unified）**：合并 smartApproval / costThreshold / 用量策略
3. **多维度（Multi-scope）**：org/team/project/user/resource 5 维作用域
4. **可测试（Testable）**：策略可单元测试 + 集成测试
5. **可审计（Auditable）**：每个决策可记录 + 与 Audit Trail 联动
6. **可执行（Enforced）**：拦截器模式，违反即阻断
7. **高性能（Fast）**：< 5ms 决策，缓存命中 < 1ms

---

## 三、核心类型定义

### 3.1 Policy

```typescript
export type PolicyEffect = 'allow' | 'deny' | 'prompt';
export type PolicyPriority = number;          // 1-1000
export type PolicyStatus = 'draft' | 'active' | 'deprecated' | 'archived';

export interface Policy {
  id: string;                                 // pol-<random>
  name: string;
  description?: string;
  version: string;                            // 语义化版本 "1.2.3"
  status: PolicyStatus;
  priority: PolicyPriority;                   // 高优先级优先

  // 作用域
  scope: PolicyScope;
  appliesTo: PolicyAppliesTo;

  // 规则
  rules: PolicyRule[];
  defaultEffect: PolicyEffect;                // 默认决策
  conflictResolution: 'priority' | 'deny-overrides' | 'allow-overrides';

  // 元数据
  tags?: string[];                            // ['security', 'cost', 'compliance']
  author?: string;
  createdAt: number;
  updatedAt: number;
  effectiveFrom?: number;
  effectiveUntil?: number;
  source?: 'manual' | 'template' | 'git' | 'auto-generated';
  sourceLocation?: string;                    // Git path or template name
}

export interface PolicyScope {
  orgId?: string;
  teamId?: string;
  projectId?: string;
  userId?: string;
  resourceType?: string;                      // e.g. "agent", "worktree", "model"
  resourceId?: string;
  environment?: 'dev' | 'staging' | 'prod' | 'all';
  region?: string;
}

export interface PolicyAppliesTo {
  actions: string[];                          // ['agent.execute', 'cost.*', 'llm.call']
  subjects?: string[];                        // ['user', 'agent', 'service']
  resources?: string[];                       // resource types
  conditions?: PolicyCondition[];             // 额外条件
}
```

### 3.2 PolicyRule

```typescript
export interface PolicyRule {
  id: string;
  name: string;
  description?: string;
  effect: PolicyEffect;
  conditions: PolicyCondition[];              // 全部 AND
  // OR group support
  orGroups?: PolicyCondition[][];             // 任一 OR 满足
  metadata?: Record<string, any>;
}

export type PolicyCondition =
  | EqualsCondition
  | NotEqualsCondition
  | InCondition
  | NotInCondition
  | GreaterThanCondition
  | GreaterThanOrEqualCondition
  | LessThanCondition
  | LessThanOrEqualCondition
  | BetweenCondition
  | ContainsCondition
  | StartsWithCondition
  | EndsWithCondition
  | RegexCondition
  | ExistsCondition
  | NotExistsCondition
  | TimeWindowCondition
  | IpRangeCondition
  | DayOfWeekCondition
  | RateLimitCondition
  | CustomCondition;

export interface BaseCondition {
  field: string;                              // dot-path: "user.role", "env.cost"
  negated?: boolean;
}

export interface EqualsCondition extends BaseCondition {
  type: 'equals';
  value: string | number | boolean;
}

export interface InCondition extends BaseCondition {
  type: 'in';
  values: (string | number)[];
}

export interface GreaterThanCondition extends BaseCondition {
  type: 'gt' | 'gte' | 'lt' | 'lte';
  value: number;
}

export interface BetweenCondition extends BaseCondition {
  type: 'between';
  min: number;
  max: number;
  inclusive?: boolean;
}

export interface RegexCondition extends BaseCondition {
  type: 'regex';
  pattern: string;
  flags?: string;
}

export interface TimeWindowCondition extends BaseCondition {
  type: 'time-window';
  startHour: number;                          // 0-23
  endHour: number;                            // 0-23
  timezone?: string;                          // 'UTC', 'America/Los_Angeles'
  daysOfWeek?: number[];                      // 0-6 (0=Sunday)
}

export interface RateLimitCondition extends BaseCondition {
  type: 'rate-limit';
  windowMs: number;
  maxCount: number;
  scope: 'user' | 'org' | 'team' | 'project' | 'ip';
}

export interface CustomCondition extends BaseCondition {
  type: 'custom';
  evaluator: 'rego' | 'javascript';
  expression: string;                         // Rego 子集 or JS expression
}
```

### 3.3 PolicyContext

```typescript
export interface PolicyContext {
  // 用户
  user: {
    id: string;
    ssoId?: string;
    email: string;
    name?: string;
    roles: string[];
    groups: string[];
    teamId?: string;
    projectId?: string;
    orgId?: string;
    attributes?: Record<string, any>;
  };

  // 代理（如有）
  agent?: {
    id: string;
    type: string;
    parentId?: string;
    depth: number;
  };

  // 动作
  action: string;                             // dot-namespaced: "agent.execute"

  // 资源
  resource: {
    type: string;
    id: string;
    name?: string;
    path?: string;
    attributes?: Record<string, any>;
  };

  // 环境
  environment: {
    timestamp: number;                        // ms epoch
    ip?: string;
    location?: string;
    userAgent?: string;
    service?: string;
    sessionId?: string;
    requestId?: string;
    cost?: number;                            // 预估成本
    tokens?: number;                          // 预估 token
    model?: string;
  };

  // 自定义上下文
  custom?: Record<string, any>;
}
```

### 3.4 PolicyDecision

```typescript
export interface PolicyDecision {
  // 结果
  effect: PolicyEffect;                       // 'allow' | 'deny' | 'prompt'
  allowed: boolean;                           // effect === 'allow' || (effect === 'prompt' && approved)

  // 原因
  reason: string;                             // 人类可读
  code?: string;                              // 错误码

  // 溯源
  matchedPolicies: string[];                  // 命中策略 ID 列表
  matchedRule?: {
    policyId: string;
    ruleId: string;
  };
  evaluatedPolicies: number;                  // 评估的策略数
  evaluationDurationMs: number;

  // Prompt 场景
  prompt?: {
    message: string;
    approvers?: string[];                     // 需要审批的角色
    timeoutMs?: number;
    metadata?: Record<string, any>;
  };

  // 决策后动作
  obligations?: PolicyObligation[];
  advice?: PolicyAdvice[];
}

export interface PolicyObligation {
  type: 'log' | 'audit' | 'notify' | 'tag' | 'rate-limit' | 'redirect';
  target?: string;
  value?: any;
  metadata?: Record<string, any>;
}

export interface PolicyAdvice {
  type: 'warn' | 'info' | 'suggest';
  message: string;
  action?: string;
  url?: string;
}
```

---

## 四、核心 API

### 4.1 引擎主类

```typescript
export class PolicyEngine {
  // 初始化
  constructor(config?: Partial<PolicyEngineConfig>);
  static getInstance(): PolicyEngine;

  // 策略管理
  createPolicy(policy: Omit<Policy, 'id' | 'createdAt' | 'updatedAt'>): Policy;
  updatePolicy(policyId: string, updates: Partial<Policy>): Policy;
  deletePolicy(policyId: string): void;
  getPolicy(policyId: string): Policy | undefined;
  getPolicyVersion(policyId: string, version: string): Policy | undefined;
  listPolicies(filter?: PolicyFilter): Policy[];
  activatePolicy(policyId: string): void;
  deactivatePolicy(policyId: string): void;
  archivePolicy(policyId: string): void;

  // 版本管理
  publishVersion(policyId: string, version: string, changelog?: string): Policy;
  rollbackToVersion(policyId: string, version: string): Policy;
  listVersions(policyId: string): PolicyVersion[];

  // 导入 / 导出
  importPolicy(json: string, format: 'json' | 'yaml' | 'rego'): Policy;
  exportPolicy(policyId: string, format: 'json' | 'yaml' | 'rego'): string;
  importBulk(json: string): Policy[];
  exportAll(): string;

  // 模板
  listTemplates(): PolicyTemplate[];
  applyTemplate(templateId: string, variables: Record<string, any>): Policy;

  // 决策评估
  evaluate(context: PolicyContext, options?: { policyIds?: string[]; useCache?: boolean }): PolicyDecision;
  evaluateBulk(contexts: PolicyContext[]): PolicyDecision[];

  // 拦截器
  enforce(context: PolicyContext): PolicyDecision;     // 抛出 PolicyViolationError if denied
  guard(action: string): PolicyGuard;                 // 装饰器 / 中间件

  // 测试
  testPolicy(policyId: string, testCases: PolicyTestCase[]): PolicyTestResult;
  createTestCase(policyId: string, test: Omit<PolicyTestCase, 'id'>): PolicyTestCase;
  listTestCases(policyId: string): PolicyTestCase[];

  // 缓存
  invalidateCache(policyId?: string): void;
  getCacheStats(): { hits: number; misses: number; size: number };

  // 指标
  getMetrics(): PolicyEngineMetrics;
  getDecisionLog(filter?: DecisionLogFilter): PolicyDecisionLog[];

  // 事件
  on(event: PolicyEventType, listener: (e: PolicyEvent) => void): () => void;

  // 配置
  getConfig(): PolicyEngineConfig;
  updateConfig(config: Partial<PolicyEngineConfig>): void;
}
```

### 4.2 配置

```typescript
export interface PolicyEngineConfig {
  enableCache: boolean;                       // 默认 true
  cacheMaxSize: number;                       // 默认 1000
  cacheTtlMs: number;                         // 默认 60000 (1 min)
  enableDecisionLog: boolean;                 // 默认 true
  maxDecisionLogs: number;                    // 默认 100000
  enableMetrics: boolean;
  enableAuditTrailIntegration: boolean;       // 自动写入 Audit Trail
  enableEnforcement: boolean;                 // 强制模式 vs 监控模式
  defaultEffect: PolicyEffect;                // 默认 'deny' (fail-closed)
  evaluationTimeoutMs: number;                // 默认 100
  maxConcurrentEvaluations: number;           // 默认 100
  enableRegoSubset: boolean;                  // 是否启用 Rego 子集评估
  storageBackend: 'localStorage' | 'indexedDB' | 'memory';
}

export const DEFAULT_POLICY_CONFIG: PolicyEngineConfig = {
  enableCache: true,
  cacheMaxSize: 1000,
  cacheTtlMs: 60000,
  enableDecisionLog: true,
  maxDecisionLogs: 100_000,
  enableMetrics: true,
  enableAuditTrailIntegration: true,
  enableEnforcement: true,
  defaultEffect: 'deny',
  evaluationTimeoutMs: 100,
  maxConcurrentEvaluations: 100,
  enableRegoSubset: false,                    // 默认禁用，避免复杂度
  storageBackend: 'indexedDB',
};
```

### 4.3 预置策略模板

```typescript
export const POLICY_TEMPLATES: PolicyTemplate[] = [
  {
    id: 'tpl-cost-limit',
    name: 'Cost Limit Policy',
    description: 'Per-user daily cost limit',
    category: 'cost',
    variables: [
      { name: 'maxDailyCost', type: 'number', required: true },
      { name: 'currency', type: 'string', default: 'USD' },
    ],
    policy: {
      name: 'Cost Limit - {{maxDailyCost}} {{currency}}/day',
      priority: 100,
      scope: { /* variables */ },
      rules: [{
        id: 'rule-1',
        name: 'Check daily cost',
        effect: 'deny',
        conditions: [{
          type: 'gt',
          field: 'environment.cost',
          value: '{{maxDailyCost}}',
        }],
      }],
    },
  },
  {
    id: 'tpl-model-whitelist',
    name: 'Model Whitelist',
    description: 'Only allow specific LLM models',
    category: 'security',
    variables: [
      { name: 'allowedModels', type: 'string[]', required: true },
    ],
    policy: { /* ... */ },
  },
  {
    id: 'tpl-time-window',
    name: 'Time Window Restriction',
    description: 'Only allow actions during business hours',
    category: 'security',
    variables: [
      { name: 'startHour', type: 'number', default: 9 },
      { name: 'endHour', type: 'number', default: 18 },
      { name: 'timezone', type: 'string', default: 'UTC' },
    ],
    policy: { /* ... */ },
  },
  {
    id: 'tpl-rate-limit',
    name: 'Rate Limit',
    description: 'Limit request rate per user',
    category: 'performance',
    variables: [
      { name: 'maxRequests', type: 'number', required: true },
      { name: 'windowMs', type: 'number', required: true },
    ],
    policy: { /* ... */ },
  },
  {
    id: 'tpl-pii-protection',
    name: 'PII Data Protection',
    description: 'Block actions that access PII data',
    category: 'compliance',
    variables: [],
    policy: { /* ... */ },
  },
  {
    id: 'tpl-admin-only',
    name: 'Admin Only Action',
    description: 'Restrict action to admin role',
    category: 'security',
    variables: [
      { name: 'adminRole', type: 'string', default: 'admin' },
    ],
    policy: { /* ... */ },
  },
  {
    id: 'tpl-region-restriction',
    name: 'Region Restriction',
    description: 'Restrict action to specific regions',
    category: 'compliance',
    variables: [
      { name: 'allowedRegions', type: 'string[]', required: true },
    ],
    policy: { /* ... */ },
  },
];
```

---

## 五、Rego 子集支持

### 5.1 Rego vs JSON DSL 对比

| 维度 | JSON DSL | Rego 子集 |
|------|---------|-----------|
| **学习曲线** | 低 | 中 |
| **表达力** | 中 | 高 |
| **IDE 支持** | 中 | 高（VSCode 插件） |
| **复用** | 通过 import | 通过 import |
| **测试** | JSON 测试用例 | Rego `test_` 函数 |
| **生态** | 自有 | OPA 生态 |

**策略**：JSON DSL 作为默认，Rego 子集作为高级选项。

### 5.2 Rego 子集语法

```rego
package hermes.cost

# 默认 deny
default allow := false

# 单条规则
allow if {
    input.user.roles[_] == "admin"
}

allow if {
    input.environment.cost < 100
    input.user.team == "platform"
}

# 多条规则
allow if {
    input.action == "agent.read"
    not is_pii(input.resource)
}

# helper
is_pii(resource) if {
    resource.attributes.pii == true
}

# deny with reason
deny_msg := "cost limit exceeded" if {
    input.environment.cost > 100
}
```

### 5.3 决策映射

| Rego 决策 | JSON DSL 等价 | 最终结果 |
|----------|-------------|---------|
| `allow := true` | rules.effect = 'allow' | 允许 |
| `allow := false` + `deny_msg` | rules.effect = 'deny' + reason | 拒绝 |
| 多个冲突 | conflictResolution 决定 | 取决于配置 |

---

## 六、决策评估算法

### 6.1 评估流程

```typescript
function evaluate(context: PolicyContext): PolicyDecision {
  const start = performance.now();
  const candidates = this.findApplicablePolicies(context);
  const sorted = this.sortByPriority(candidates);
  const decisions: PolicyDecision[] = [];
  let matchedPolicies: string[] = [];

  for (const policy of sorted) {
    const decision = this.evaluatePolicy(policy, context);
    decisions.push(decision);
    if (decision.matchedRule) {
      matchedPolicies.push(policy.id);

      // 短路：deny-overrides 模式
      if (policy.conflictResolution === 'deny-overrides' && decision.effect === 'deny') {
        return this.buildFinalDecision(decisions, 'deny', matchedPolicies, start);
      }
    }
  }

  return this.resolveConflict(decisions, matchedPolicies, start);
}
```

### 6.2 冲突解决

| 模式 | 描述 |
|------|------|
| **priority** | 按 priority 排序，第一个匹配的策略胜出 |
| **deny-overrides** | 任何一个 deny 立即拒绝（最安全） |
| **allow-overrides** | 任何一个 allow 立即允许（最宽松） |

### 6.3 条件评估

```typescript
function evaluateCondition(condition: PolicyCondition, context: PolicyContext): boolean {
  const value = getFieldValue(context, condition.field);
  let result: boolean;

  switch (condition.type) {
    case 'equals': result = value === condition.value; break;
    case 'in': result = condition.values.includes(value); break;
    case 'gt': result = Number(value) > condition.value; break;
    case 'gte': result = Number(value) >= condition.value; break;
    case 'lt': result = Number(value) < condition.value; break;
    case 'lte': result = Number(value) <= condition.value; break;
    case 'between':
      const num = Number(value);
      result = condition.inclusive
        ? num >= condition.min && num <= condition.max
        : num > condition.min && num < condition.max;
      break;
    case 'contains': result = String(value).includes(String(condition.value)); break;
    case 'regex': result = new RegExp(condition.pattern, condition.flags).test(String(value)); break;
    case 'time-window': result = isInTimeWindow(value, condition); break;
    case 'rate-limit': result = checkRateLimit(context, condition); break;
    case 'custom': result = evaluateCustom(condition, context); break;
    default: result = false;
  }

  return condition.negated ? !result : result;
}
```

### 6.4 Rate Limit 实现

```typescript
class RateLimiter {
  private buckets: Map<string, number[]> = new Map();

  check(key: string, windowMs: number, maxCount: number): boolean {
    const now = Date.now();
    const windowStart = now - windowMs;
    const bucket = this.buckets.get(key) || [];
    const recent = bucket.filter(t => t > windowStart);

    if (recent.length >= maxCount) {
      return false;  // 超出限制
    }

    recent.push(now);
    this.buckets.set(key, recent);
    return true;
  }
}
```

---

## 七、集成方案

### 7.1 与现有引擎集成

```typescript
// 1. 智能审批 → 替换为 Policy Engine
// 之前：smartApprovalEngine.evaluate(...)
// 之后：
policyEngine.evaluate({
  user: ...,
  action: 'shell.execute',
  resource: { type: 'command', id: 'rm-rf' },
  environment: { ... },
});

// 2. 成本告警 → 增强为内置策略
const costLimitPolicy = policyEngine.applyTemplate('tpl-cost-limit', {
  maxDailyCost: 50,
  currency: 'USD',
});
// 自动应用到 cost attribution

// 3. 用量归因 → 增强为内置策略
const usagePolicy = policyEngine.applyTemplate('tpl-model-whitelist', {
  allowedModels: ['claude-opus-4', 'gpt-4-turbo'],
});

// 4. Worktree 创建 → 强制检查
async function createWorktree(options) {
  const decision = policyEngine.enforce({
    action: 'worktree.create',
    resource: { type: 'worktree', id: options.id, attributes: options },
    ...
  });
  if (!decision.allowed) throw new PolicyViolationError(decision);
  return adapter.create(options);
}
```

### 7.2 React Hook

```typescript
// React 组件中使用
function usePolicy() {
  const engine = usePolicyEngine();
  return {
    evaluate: (context) => engine.evaluate(context),
    can: (action, resource) => engine.evaluate({ ... }).allowed,
    enforce: (context) => {
      const d = engine.enforce(context);
      if (!d.allowed) throw new PolicyViolationError(d);
    },
  };
}

// 在组件中
function CostlyAction() {
  const { can } = usePolicy();
  const user = useUser();

  if (!can('agent.execute', { type: 'agent', id: 'gpt-4', attributes: { cost: 1.5 } })) {
    return <div>Policy denied: {reason}</div>;
  }

  return <button>Execute</button>;
}
```

---

## 八、UI 组件（PolicyPanel）

### 8.1 布局

```
┌──────────────────────────────────────────────────┐
│ Policy Engine                  [+ Create] [⛯]  │
├──────────────────────────────────────────────────┤
│ Tabs: [Policies] [Decisions] [Templates] [Test]  │
├──────────────────────────────────────────────────┤
│ Active Policies (3):                             │
│ ┌──────────────────────────────────────────┐    │
│ │ 🟢 Cost Limit ($50/day)         v1.2.0   │    │
│ │    Scope: org:acme | Effect: deny        │    │
│ │    Priority: 100 | Status: active        │    │
│ │    [Edit] [Versions] [Test] [Disable]    │    │
│ └──────────────────────────────────────────┘    │
│                                                  │
│ Recent Decisions (last 100):                     │
│ ┌──────────────────────────────────────────┐    │
│ │ 14:32:05  DENY  cost.attribute           │    │
│ │   User: bob  Policy: cost-limit          │    │
│ │   Reason: Exceeded 90% of $50            │    │
│ │   Duration: 2.3ms                        │    │
│ └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

### 8.2 功能

1. **策略列表** - 过滤 / 排序 / 搜索
2. **策略编辑** - 表单 + JSON DSL 编辑器
3. **版本管理** - 历史版本 + 回滚
4. **决策日志** - 最近 100 条决策
5. **模板应用** - 一键应用预置模板
6. **策略测试** - 输入 context 查看决策
7. **指标统计** - 命中率 / 平均评估时间
8. **批量导入** - JSON/YAML/Rego 导入

---

## 九、测试策略

### 9.1 单元测试（40+ 个）

| 类别 | 数量 | 覆盖点 |
|------|------|-------|
| **策略 CRUD** | 6 | 创建 / 更新 / 删除 / 获取 / 列表 / 状态 |
| **版本管理** | 3 | 发布 / 回滚 / 历史 |
| **导入导出** | 4 | JSON / YAML / Rego / 批量 |
| **决策评估** | 6 | 单条 / 批量 / 缓存 / 默认 / 优先级 / 冲突解决 |
| **条件评估** | 10 | equals/in/gt/lt/between/regex/time-window/rate-limit/custom/exists |
| **模板** | 2 | 应用 / 变量替换 |
| **测试框架** | 3 | 单元测试 / 集成测试 / 覆盖率 |
| **拦截器** | 2 | enforce / guard |
| **指标** | 2 | hits / misses / duration |
| **事件** | 2 | 决策事件 / 策略变更 |

### 9.2 E2E 测试

- **完整决策流程**：注册策略 → 触发评估 → 决策 → 审计 → 拦截
- **多维度作用域**：org / team / project / user / resource 策略分别生效
- **冲突解决**：deny-overrides / allow-overrides / priority
- **Rate Limit**：超出限制自动 deny
- **Time Window**：非工作时间 deny

---

## 十、依赖

### 10.1 外部依赖

- 无新增 npm 依赖

### 10.2 内部依赖

- **G32-01 Audit Trail** — 决策自动审计
- 被依赖：所有需要强制执行的入口

---

## 十一、风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| Rego 完整支持复杂度高 | 高 | 优先 JSON DSL，Rego 作 P1 |
| 误用宽松策略导致风险 | 高 | 默认 deny + 强制审计 |
| 缓存陈旧 | 中 | TTL + 手动失效 |
| 性能（高频评估） | 中 | LRU 缓存 + 短路评估 |
| 策略冲突 | 中 | 显式 conflictResolution |

---

## 十二、验收标准

1. ✅ JSON DSL 完整支持
2. ✅ 10+ 条件类型全部实现
3. ✅ 多维度作用域正确强制
4. ✅ 3 种冲突解决模式正确
5. ✅ 7 种预置策略模板可用
6. ✅ 与 Audit Trail 联动
7. ✅ 单元测试 40+ 全通过
8. ✅ E2E 测试 10+ 全通过
9. ✅ TypeScript 严格模式 0 错误

---

**G32-03 SPEC 状态**：✅ 设计完成，下一步进入实现阶段。
