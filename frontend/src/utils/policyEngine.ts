/**
 * # ============================================================
 * # Policy Engine - 策略规则引擎 (v1.0.0 Cycle 32 G32-03)
 * # ============================================================
 * # 核心作用：实现企业级统一策略规则引擎
 * # 多维度作用域：org/team/project/user/resource 5 维
 * # 规则评估：条件表达式 + 冲突解决 + 强制执行
 * # 模板系统：6 大预置模板 (cost/model-whitelist/time-window/...)
 * # 测试系统：单策略单测 + 集成测试 + 测试用例管理
 * # 审计联动：每次决策自动写入 Audit Trail
 * # 参考：Open Policy Agent (OPA) / Rego 子集
 * # ============================================================
 * # 运行流程：
 * #   1. 初始化引擎 + 默认配置
 * #   2. createPolicy() 创建策略 (含规则 + 作用域 + 默认决策)
 * #   3. activatePolicy() 激活
 * #   4. evaluate(context) 评估决策
 * #      - 遍历 applicable policies
 * #      - 按 priority 排序
 * #      - 评估每条规则的 conditions (AND + OR)
 * #      - 冲突解决 (priority/deny-overrides/allow-overrides)
 * #      - 返回 PolicyDecision
 * #   5. enforce() 拦截器模式 (deny 即抛错)
 * #   6. 写入决策日志 + 触发 audit trail
 * # ============================================================
 * # 输入参数：PolicyContext (user + action + resource + environment)
 * # 输出结果：PolicyDecision (effect + reason + matchedPolicies)
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 32 G32-03 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

export type PolicyEffect = 'allow' | 'deny' | 'prompt';
export type PolicyPriority = number; // 1-1000
export type PolicyStatus = 'draft' | 'active' | 'deprecated' | 'archived';

/**
 * 策略定义
 */
export interface Policy {
  id: string;
  name: string;
  description?: string;
  version: string;
  status: PolicyStatus;
  priority: PolicyPriority;

  // 作用域
  scope: PolicyScope;
  appliesTo: PolicyAppliesTo;

  // 规则
  rules: PolicyRule[];
  defaultEffect: PolicyEffect;
  conflictResolution: 'priority' | 'deny-overrides' | 'allow-overrides';

  // 元数据
  tags?: string[];
  author?: string;
  createdAt: number;
  updatedAt: number;
  effectiveFrom?: number;
  effectiveUntil?: number;
  source?: 'manual' | 'template' | 'git' | 'auto-generated';
  sourceLocation?: string;
}

export interface PolicyScope {
  orgId?: string;
  teamId?: string;
  projectId?: string;
  userId?: string;
  resourceType?: string;
  resourceId?: string;
  environment?: 'dev' | 'staging' | 'prod' | 'all';
  region?: string;
}

export interface PolicyAppliesTo {
  actions: string[];
  subjects?: string[];
  resources?: string[];
  conditions?: PolicyCondition[];
}

/**
 * 规则
 */
export interface PolicyRule {
  id: string;
  name: string;
  description?: string;
  effect: PolicyEffect;
  conditions: PolicyCondition[];
  orGroups?: PolicyCondition[][];
  metadata?: Record<string, any>;
}

/**
 * 条件
 */
export interface BaseCondition {
  field: string;
  negated?: boolean;
}

export interface EqualsCondition extends BaseCondition {
  type: 'equals';
  value: string | number | boolean;
}

export interface NotEqualsCondition extends BaseCondition {
  type: 'not-equals';
  value: string | number | boolean;
}

export interface InCondition extends BaseCondition {
  type: 'in';
  values: (string | number)[];
}

export interface NotInCondition extends BaseCondition {
  type: 'not-in';
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

export interface ContainsCondition extends BaseCondition {
  type: 'contains';
  value: string;
}

export interface StartsWithCondition extends BaseCondition {
  type: 'starts-with';
  value: string;
}

export interface EndsWithCondition extends BaseCondition {
  type: 'ends-with';
  value: string;
}

export interface RegexCondition extends BaseCondition {
  type: 'regex';
  pattern: string;
  flags?: string;
}

export interface ExistsCondition extends BaseCondition {
  type: 'exists';
}

export interface NotExistsCondition extends BaseCondition {
  type: 'not-exists';
}

export interface TimeWindowCondition extends BaseCondition {
  type: 'time-window';
  startHour: number;
  endHour: number;
  timezone?: string;
  daysOfWeek?: number[];
}

export interface IpRangeCondition extends BaseCondition {
  type: 'ip-range';
  cidrs: string[];
}

export interface DayOfWeekCondition extends BaseCondition {
  type: 'day-of-week';
  days: number[]; // 0-6 (0=Sunday)
}

export interface RateLimitCondition extends BaseCondition {
  type: 'rate-limit';
  windowMs: number;
  maxCount: number;
  scope: 'user' | 'org' | 'team' | 'project' | 'ip';
}

export interface CustomCondition extends BaseCondition {
  type: 'custom';
  evaluator: 'javascript';
  expression: string;
}

export type PolicyCondition =
  | EqualsCondition
  | NotEqualsCondition
  | InCondition
  | NotInCondition
  | GreaterThanCondition
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

/**
 * 策略上下文
 */
export interface PolicyContext {
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
  agent?: {
    id: string;
    type: string;
    parentId?: string;
    depth: number;
  };
  action: string;
  resource: {
    type: string;
    id: string;
    name?: string;
    path?: string;
    attributes?: Record<string, any>;
  };
  environment: {
    timestamp: number;
    ip?: string;
    location?: string;
    userAgent?: string;
    service?: string;
    sessionId?: string;
    requestId?: string;
    cost?: number;
    tokens?: number;
    model?: string;
  };
  custom?: Record<string, any>;
}

/**
 * 策略决策
 */
export interface PolicyDecision {
  effect: PolicyEffect;
  allowed: boolean;
  reason: string;
  code?: string;
  matchedPolicies: string[];
  matchedRule?: {
    policyId: string;
    ruleId: string;
  };
  evaluatedPolicies: number;
  evaluationDurationMs: number;
  prompt?: {
    message: string;
    approvers?: string[];
    timeoutMs?: number;
    metadata?: Record<string, any>;
  };
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

/**
 * 策略版本
 */
export interface PolicyVersion {
  version: string;
  changelog?: string;
  policy: Policy;
  publishedAt: number;
  publishedBy?: string;
}

/**
 * 策略模板
 */
export interface PolicyTemplate {
  id: string;
  name: string;
  description?: string;
  category: 'security' | 'cost' | 'compliance' | 'performance' | 'custom';
  variables: PolicyTemplateVariable[];
  policy: Omit<Policy, 'id' | 'createdAt' | 'updatedAt'>;
}

export interface PolicyTemplateVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'string[]';
  default?: any;
  required: boolean;
  description?: string;
}

/**
 * 策略过滤
 */
export interface PolicyFilter {
  status?: PolicyStatus;
  tags?: string[];
  scopeOrgId?: string;
  scopeTeamId?: string;
  scopeProjectId?: string;
  action?: string;
  search?: string;
}

/**
 * 决策日志
 */
export interface PolicyDecisionLog {
  id: string;
  context: PolicyContext;
  decision: PolicyDecision;
  timestamp: number;
}

/**
 * 决策日志过滤
 */
export interface DecisionLogFilter {
  effect?: PolicyEffect;
  userId?: string;
  action?: string;
  from?: number;
  to?: number;
  limit?: number;
}

/**
 * 测试用例
 */
export interface PolicyTestCase {
  id: string;
  name: string;
  description?: string;
  context: PolicyContext;
  expectedEffect: PolicyEffect;
}

export interface PolicyTestResult {
  policyId: string;
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  results: Array<{
    testCaseId: string;
    testName: string;
    expected: PolicyEffect;
    actual: PolicyEffect;
    passed: boolean;
    reason?: string;
  }>;
}

/**
 * 引擎配置
 */
export interface PolicyEngineConfig {
  enableCache: boolean;
  cacheMaxSize: number;
  cacheTtlMs: number;
  enableDecisionLog: boolean;
  maxDecisionLogs: number;
  enableMetrics: boolean;
  enableAuditTrailIntegration: boolean;
  enableEnforcement: boolean;
  defaultEffect: PolicyEffect;
  evaluationTimeoutMs: number;
  maxConcurrentEvaluations: number;
  enableRegoSubset: boolean;
  storageBackend: 'localStorage' | 'indexedDB' | 'memory';
  persist: boolean;
}

export interface PolicyEngineMetrics {
  totalPolicies: number;
  activePolicies: number;
  totalEvaluations: number;
  allowedCount: number;
  deniedCount: number;
  promptCount: number;
  averageEvaluationMs: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface PolicyGuard {
  check(context: Partial<PolicyContext> & { action: string }): PolicyDecision;
}

export type PolicyEventType =
  | 'policy-created'
  | 'policy-updated'
  | 'policy-deleted'
  | 'policy-activated'
  | 'policy-deactivated'
  | 'policy-archived'
  | 'version-published'
  | 'version-rolled-back'
  | 'policy-evaluated'
  | 'policy-enforced'
  | 'cache-invalidated'
  | 'test-completed';

export interface PolicyEvent {
  type: PolicyEventType;
  timestamp: number;
  data: unknown;
}

export interface SerializedPolicyState {
  policies: Policy[];
  versions: PolicyVersion[];
  decisionLogs: PolicyDecisionLog[];
  testCases: Record<string, PolicyTestCase[]>; // policyId -> test cases
}

/**
 * 策略违反错误
 */
export class PolicyViolationError extends Error {
  public readonly decision: PolicyDecision;
  public readonly code: string;

  constructor(decision: PolicyDecision, message?: string) {
    super(message || decision.reason);
    this.name = 'PolicyViolationError';
    this.decision = decision;
    this.code = decision.code || 'POLICY_VIOLATION';
  }
}

// ============ 默认配置 ============

export const DEFAULT_POLICY_CONFIG: PolicyEngineConfig = {
  enableCache: true,
  cacheMaxSize: 1000,
  cacheTtlMs: 60000,
  enableDecisionLog: true,
  maxDecisionLogs: 100000,
  enableMetrics: true,
  enableAuditTrailIntegration: true,
  enableEnforcement: true,
  defaultEffect: 'deny',
  evaluationTimeoutMs: 100,
  maxConcurrentEvaluations: 100,
  enableRegoSubset: false,
  storageBackend: 'memory',
  persist: true,
};

// ============ 工具函数 ============

export function generatePolicyId(): string {
  return `pol-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateRuleId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateVersionId(): string {
  return `ver-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateDecisionLogId(): string {
  return `dl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateTestCaseId(): string {
  return `tc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 解析 dot-path 到 context 值
 * 支持 "user.roles.0" (数组索引) 和 "user.attributes.x" (嵌套对象)
 */
export function resolveField(context: PolicyContext, path: string): any {
  if (!path) return undefined;
  const parts = path.split('.');
  let current: any = context;
  for (const part of parts) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const idx = parseInt(part, 10);
      if (isNaN(idx)) return undefined;
      current = current[idx];
    } else if (typeof current === 'object') {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * 比较两个值是否相等（深度）
 */
export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * 字符串模板替换 {{var}}
 * 如果原值不是字符串或不含 {{}} 占位符，返回原值
 * 如果整个值是单个 {{var}} 占位符，保持变量原始类型
 */
export function renderTemplate(template: string, vars: Record<string, any>): any {
  if (typeof template !== 'string') return template;
  if (!template.includes('{{')) return template;
  // 整个值是单个占位符：返回变量的原始类型
  const fullMatch = template.match(/^\{\{(\w+)\}\}$/);
  if (fullMatch) {
    const key = fullMatch[1];
    return vars[key] !== undefined ? vars[key] : template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (vars[key] === undefined) return `{{${key}}}`;
    return String(vars[key]);
  });
}

/**
 * 深度替换对象中的字符串模板
 */
export function deepRender(obj: any, vars: Record<string, any>): any {
  if (typeof obj === 'string') return renderTemplate(obj, vars);
  if (Array.isArray(obj)) return obj.map((v) => deepRender(v, vars));
  if (obj && typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = deepRender(v, vars);
    }
    return result;
  }
  return obj;
}

/**
 * 评估单个条件
 */
export function evaluateCondition(condition: PolicyCondition, context: PolicyContext): boolean {
  const value = resolveField(context, condition.field);
  let result = false;

  switch (condition.type) {
    case 'equals':
      result = deepEqual(value, (condition as EqualsCondition).value);
      break;
    case 'not-equals':
      result = !deepEqual(value, (condition as NotEqualsCondition).value);
      break;
    case 'in':
      if (Array.isArray(value)) {
        // 数组语义：value 数组中任一元素在 values 列表中
        result = value.some((v) => (condition as InCondition).values.some((cv) => deepEqual(v, cv)));
      } else {
        result = (condition as InCondition).values.some((v) => deepEqual(value, v));
      }
      break;
    case 'not-in':
      if (Array.isArray(value)) {
        result = !value.some((v) => (condition as NotInCondition).values.some((cv) => deepEqual(v, cv)));
      } else {
        result = !(condition as NotInCondition).values.some((v) => deepEqual(value, v));
      }
      break;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const v = (condition as GreaterThanCondition).value;
      if (typeof value !== 'number' || typeof v !== 'number') {
        result = false;
      } else if (condition.type === 'gt') result = value > v;
      else if (condition.type === 'gte') result = value >= v;
      else if (condition.type === 'lt') result = value < v;
      else if (condition.type === 'lte') result = value <= v;
      break;
    }
    case 'between': {
      const v = value as number;
      const { min, max, inclusive } = condition as BetweenCondition;
      if (typeof v !== 'number') {
        result = false;
      } else if (inclusive) {
        result = v >= min && v <= max;
      } else {
        result = v > min && v < max;
      }
      break;
    }
    case 'contains':
      result = typeof value === 'string' && value.includes((condition as ContainsCondition).value);
      break;
    case 'starts-with':
      result = typeof value === 'string' && value.startsWith((condition as StartsWithCondition).value);
      break;
    case 'ends-with':
      result = typeof value === 'string' && value.endsWith((condition as EndsWithCondition).value);
      break;
    case 'regex': {
      const c = condition as RegexCondition;
      try {
        const re = new RegExp(c.pattern, c.flags);
        result = typeof value === 'string' && re.test(value);
      } catch {
        result = false;
      }
      break;
    }
    case 'exists':
      result = value !== undefined && value !== null;
      break;
    case 'not-exists':
      result = value === undefined || value === null;
      break;
    case 'time-window': {
      const c = condition as TimeWindowCondition;
      const date = new Date(context.environment.timestamp);
      // 使用 UTC 小时，确保时区无关的语义（也可指定 timezone 字段）
      const hour = c.timezone && c.timezone !== 'UTC' ? date.getHours() : date.getUTCHours();
      const day = c.timezone && c.timezone !== 'UTC' ? date.getDay() : date.getUTCDay();
      if (c.daysOfWeek && c.daysOfWeek.length > 0 && !c.daysOfWeek.includes(day)) {
        result = false;
        break;
      }
      if (c.startHour <= c.endHour) {
        result = hour >= c.startHour && hour < c.endHour;
      } else {
        // 跨天
        result = hour >= c.startHour || hour < c.endHour;
      }
      break;
    }
    case 'ip-range': {
      const c = condition as IpRangeCondition;
      const ip = context.environment.ip;
      if (!ip) {
        result = false;
        break;
      }
      result = c.cidrs.some((cidr) => matchCIDR(ip, cidr));
      break;
    }
    case 'day-of-week': {
      const c = condition as DayOfWeekCondition;
      const date = new Date(context.environment.timestamp);
      // 使用 UTC day-of-week 以保证时区无关
      const day = date.getUTCDay();
      result = c.days.includes(day);
      break;
    }
    case 'rate-limit': {
      // 速率限制由 RateLimiter 处理
      result = true;
      break;
    }
    case 'custom': {
      const c = condition as CustomCondition;
      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function('ctx', `with(ctx) { return (${c.expression}); }`);
        result = !!fn(context);
      } catch {
        result = false;
      }
      break;
    }
    default:
      result = false;
  }

  return condition.negated ? !result : result;
}

/**
 * CIDR 简单匹配 (IPv4 only)
 */
export function matchCIDR(ip: string, cidr: string): boolean {
  if (!cidr.includes('/')) {
    return ip === cidr;
  }
  const [network, bits] = cidr.split('/');
  const prefixLen = parseInt(bits, 10);
  const ipParts = ip.split('.').map(Number);
  const netParts = network.split('.').map(Number);
  if (ipParts.length !== 4 || netParts.length !== 4) return false;
  if (ipParts.some(isNaN) || netParts.some(isNaN)) return false;

  const ipInt = (ipParts[0] << 24 | ipParts[1] << 16 | ipParts[2] << 8 | ipParts[3]) >>> 0;
  const netInt = (netParts[0] << 24 | netParts[1] << 16 | netParts[2] << 8 | netParts[3]) >>> 0;
  if (prefixLen === 0) return true;
  const mask = ((0xffffffff << (32 - prefixLen)) >>> 0);
  return (ipInt & mask) === (netInt & mask);
}

/**
 * 评估规则 (AND + OR 组)
 */
export function evaluateRule(rule: PolicyRule, context: PolicyContext): boolean {
  // 所有 conditions 必须满足 (AND)
  const allMatch = rule.conditions.every((c) => evaluateCondition(c, context));
  if (!allMatch) return false;

  // 如果没有 OR 组，则直接通过
  if (!rule.orGroups || rule.orGroups.length === 0) return true;

  // 任一 OR 组满足即可
  return rule.orGroups.some((group) => group.every((c) => evaluateCondition(c, context)));
}

// ============ 预置策略模板 ============

export const POLICY_TEMPLATES: PolicyTemplate[] = [
  {
    id: 'tpl-cost-limit',
    name: 'Cost Limit Policy',
    description: 'Per-user daily cost limit',
    category: 'cost',
    variables: [
      { name: 'maxDailyCost', type: 'number', required: true },
      { name: 'currency', type: 'string', default: 'USD', required: false },
    ],
    policy: {
      name: 'Cost Limit - {{maxDailyCost}} {{currency}}/day',
      version: '1.0.0',
      status: 'draft',
      priority: 100,
      scope: {},
      appliesTo: {
        actions: ['llm.call', 'agent.execute'],
        subjects: ['user'],
      },
      rules: [
        {
          id: 'rule-cost-limit',
          name: 'Deny if daily cost exceeds limit',
          effect: 'deny',
          conditions: [
            {
              type: 'gt',
              field: 'environment.cost',
              value: 0, // 由模板渲染
            },
          ],
        },
      ],
      defaultEffect: 'allow',
      conflictResolution: 'deny-overrides',
      tags: ['cost'],
      source: 'template',
    },
  },
  {
    id: 'tpl-admin-only',
    name: 'Admin Only Action',
    description: 'Restrict action to admin role',
    category: 'security',
    variables: [
      { name: 'adminRole', type: 'string', default: 'admin', required: false },
      { name: 'actions', type: 'string[]', required: true },
    ],
    policy: {
      name: 'Admin Only - {{adminRole}}',
      version: '1.0.0',
      status: 'draft',
      priority: 800,
      scope: {},
      appliesTo: {
        actions: [], // 由模板填充
        subjects: ['user'],
      },
      rules: [
        {
          id: 'rule-admin-only',
          name: 'Require admin role',
          effect: 'deny',
          conditions: [
            {
              type: 'not-in',
              field: 'user.roles',
              values: [], // 由模板填充
            },
          ],
        },
      ],
      defaultEffect: 'allow',
      conflictResolution: 'deny-overrides',
      tags: ['security', 'rbac'],
      source: 'template',
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
    policy: {
      name: 'Model Whitelist',
      version: '1.0.0',
      status: 'draft',
      priority: 500,
      scope: {},
      appliesTo: {
        actions: ['llm.call'],
      },
      rules: [
        {
          id: 'rule-model-whitelist',
          name: 'Allow whitelisted models only',
          effect: 'deny',
          conditions: [
            {
              type: 'not-in',
              field: 'environment.model',
              values: [], // 由模板填充
            },
          ],
        },
      ],
      defaultEffect: 'allow',
      conflictResolution: 'deny-overrides',
      tags: ['security', 'model'],
      source: 'template',
    },
  },
  {
    id: 'tpl-time-window',
    name: 'Time Window Restriction',
    description: 'Only allow actions during business hours',
    category: 'security',
    variables: [
      { name: 'startHour', type: 'number', default: 9, required: false },
      { name: 'endHour', type: 'number', default: 18, required: false },
    ],
    policy: {
      name: 'Business Hours Only',
      version: '1.0.0',
      status: 'draft',
      priority: 300,
      scope: {},
      appliesTo: {
        actions: ['*'],
      },
      rules: [
        {
          id: 'rule-time-window',
          name: 'Allow only during business hours',
          effect: 'allow',
          conditions: [
            {
              type: 'time-window',
              field: 'environment.timestamp',
              startHour: 9, // 由模板填充
              endHour: 18,
            },
          ],
        },
      ],
      defaultEffect: 'deny',
      conflictResolution: 'deny-overrides',
      tags: ['security', 'time'],
      source: 'template',
    },
  },
  {
    id: 'tpl-region-restriction',
    name: 'Region Restriction',
    description: 'Restrict action to specific regions',
    category: 'compliance',
    variables: [
      { name: 'allowedRegions', type: 'string[]', required: true },
    ],
    policy: {
      name: 'Region Restriction',
      version: '1.0.0',
      status: 'draft',
      priority: 600,
      scope: {},
      appliesTo: {
        actions: ['*'],
      },
      rules: [
        {
          id: 'rule-region',
          name: 'Restrict to allowed regions',
          effect: 'deny',
          conditions: [
            {
              type: 'not-in',
              field: 'environment.location',
              values: [],
            },
          ],
        },
      ],
      defaultEffect: 'allow',
      conflictResolution: 'deny-overrides',
      tags: ['compliance', 'region'],
      source: 'template',
    },
  },
  {
    id: 'tpl-pii-protection',
    name: 'PII Data Protection',
    description: 'Block actions that access PII data',
    category: 'compliance',
    variables: [],
    policy: {
      name: 'PII Data Protection',
      version: '1.0.0',
      status: 'draft',
      priority: 900,
      scope: {},
      appliesTo: {
        actions: ['data.read', 'data.write', 'data.export'],
        resources: ['user-data', 'customer-data'],
      },
      rules: [
        {
          id: 'rule-pii-attribute',
          name: 'Block PII attribute access',
          effect: 'deny',
          conditions: [
            {
              type: 'exists',
              field: 'resource.attributes.pii',
            },
            {
              type: 'equals',
              field: 'resource.attributes.pii',
              value: true,
            },
          ],
        },
      ],
      defaultEffect: 'allow',
      conflictResolution: 'deny-overrides',
      tags: ['compliance', 'pii', 'gdpr'],
      source: 'template',
    },
  },
];

// ============ 引擎主类 ============

interface CacheEntry {
  decision: PolicyDecision;
  expiresAt: number;
}

export class PolicyEngine {
  private config: PolicyEngineConfig;
  private policies: Map<string, Policy> = new Map();
  private versions: Map<string, PolicyVersion[]> = new Map(); // policyId -> versions
  private decisionLogs: PolicyDecisionLog[] = [];
  private testCases: Map<string, PolicyTestCase[]> = new Map();
  private cache: Map<string, CacheEntry> = new Map();
  private listeners: Map<PolicyEventType, Set<(e: PolicyEvent) => void>> = new Map();
  private rateLimitCounters: Map<string, Array<{ timestamp: number; key: string }>> = new Map();
  private metrics: PolicyEngineMetrics = {
    totalPolicies: 0,
    activePolicies: 0,
    totalEvaluations: 0,
    allowedCount: 0,
    deniedCount: 0,
    promptCount: 0,
    averageEvaluationMs: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };
  private storageKey = 'hermes.policyEngine';
  private auditTrailHook?: (event: string, data: any) => void;

  constructor(config: Partial<PolicyEngineConfig> = {}) {
    this.config = { ...DEFAULT_POLICY_CONFIG, ...config };
    if (this.config.persist) {
      this.load();
    }
    if (this.policies.size === 0) {
      // 不预置策略，由用户创建
    }
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
      if (raw) {
        const state: SerializedPolicyState = JSON.parse(raw);
        if (Array.isArray(state.policies)) {
          for (const p of state.policies) this.policies.set(p.id, p);
        }
        if (Array.isArray(state.versions)) {
          for (const v of state.versions) {
            const list = this.versions.get(v.policy.id) || [];
            list.push(v);
            this.versions.set(v.policy.id, list);
          }
        }
        if (Array.isArray(state.decisionLogs)) {
          this.decisionLogs = state.decisionLogs;
        }
        if (state.testCases) {
          for (const [k, v] of Object.entries(state.testCases)) {
            this.testCases.set(k, v);
          }
        }
      }
    } catch (e) {
      console.warn('PolicyEngine: failed to load state', e);
    }
    this.refreshMetrics();
  }

  private save(): void {
    if (!this.config.persist) return;
    try {
      const state: SerializedPolicyState = {
        policies: Array.from(this.policies.values()),
        versions: Array.from(this.versions.values()).flat(),
        decisionLogs: this.decisionLogs.slice(-this.config.maxDecisionLogs),
        testCases: Object.fromEntries(this.testCases),
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(state));
      }
    } catch (e) {
      console.warn('PolicyEngine: failed to save state', e);
    }
  }

  // ============ 策略管理 ============

  createPolicy(policy: Omit<Policy, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Policy {
    const full: Policy = {
      ...policy,
      id: generatePolicyId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.policies.set(full.id, full);
    this.invalidateCache(full.id);
    this.save();
    this.refreshMetrics();
    this.emit('policy-created', { policy: full });
    return full;
  }

  updatePolicy(policyId: string, updates: Partial<Policy>): Policy {
    const existing = this.policies.get(policyId);
    if (!existing) throw new Error(`Policy ${policyId} not found`);
    const updated: Policy = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
    this.policies.set(policyId, updated);
    this.invalidateCache(policyId);
    this.save();
    this.refreshMetrics();
    this.emit('policy-updated', { policy: updated });
    return updated;
  }

  deletePolicy(policyId: string): void {
    const existed = this.policies.delete(policyId);
    if (existed) {
      this.versions.delete(policyId);
      this.testCases.delete(policyId);
      this.invalidateCache(policyId);
      this.save();
      this.refreshMetrics();
      this.emit('policy-deleted', { policyId });
    }
  }

  getPolicy(policyId: string): Policy | undefined {
    return this.policies.get(policyId);
  }

  getPolicyVersion(policyId: string, version: string): Policy | undefined {
    const versions = this.versions.get(policyId);
    if (!versions) return undefined;
    const v = versions.find((ver) => ver.version === version);
    return v?.policy;
  }

  listPolicies(filter?: PolicyFilter): Policy[] {
    let result = Array.from(this.policies.values());
    if (filter) {
      if (filter.status) {
        result = result.filter((p) => p.status === filter.status);
      }
      if (filter.tags && filter.tags.length > 0) {
        result = result.filter((p) => p.tags && filter.tags!.some((t) => p.tags!.includes(t)));
      }
      if (filter.scopeOrgId) {
        result = result.filter((p) => !p.scope.orgId || p.scope.orgId === filter.scopeOrgId);
      }
      if (filter.scopeTeamId) {
        result = result.filter((p) => !p.scope.teamId || p.scope.teamId === filter.scopeTeamId);
      }
      if (filter.scopeProjectId) {
        result = result.filter((p) => !p.scope.projectId || p.scope.projectId === filter.scopeProjectId);
      }
      if (filter.action) {
        result = result.filter((p) =>
          p.appliesTo.actions.includes(filter.action!) ||
          p.appliesTo.actions.includes('*')
        );
      }
      if (filter.search) {
        const s = filter.search.toLowerCase();
        result = result.filter((p) =>
          p.name.toLowerCase().includes(s) ||
          (p.description || '').toLowerCase().includes(s)
        );
      }
    }
    return result.sort((a, b) => b.priority - a.priority);
  }

  activatePolicy(policyId: string): void {
    const policy = this.policies.get(policyId);
    if (!policy) throw new Error(`Policy ${policyId} not found`);
    this.updatePolicy(policyId, { status: 'active' });
    this.emit('policy-activated', { policyId });
  }

  deactivatePolicy(policyId: string): void {
    const policy = this.policies.get(policyId);
    if (!policy) throw new Error(`Policy ${policyId} not found`);
    this.updatePolicy(policyId, { status: 'deprecated' });
    this.emit('policy-deactivated', { policyId });
  }

  archivePolicy(policyId: string): void {
    const policy = this.policies.get(policyId);
    if (!policy) throw new Error(`Policy ${policyId} not found`);
    this.updatePolicy(policyId, { status: 'archived' });
    this.emit('policy-archived', { policyId });
  }

  // ============ 版本管理 ============

  publishVersion(policyId: string, version: string, changelog?: string): Policy {
    const policy = this.policies.get(policyId);
    if (!policy) throw new Error(`Policy ${policyId} not found`);
    const versionRecord: PolicyVersion = {
      version,
      changelog,
      policy: { ...policy, version },
      publishedAt: Date.now(),
    };
    const list = this.versions.get(policyId) || [];
    list.push(versionRecord);
    this.versions.set(policyId, list);
    this.save();
    this.emit('version-published', { policyId, version, changelog });
    return versionRecord.policy;
  }

  rollbackToVersion(policyId: string, version: string): Policy {
    const target = this.getPolicyVersion(policyId, version);
    if (!target) throw new Error(`Version ${version} not found for policy ${policyId}`);
    const updated = this.updatePolicy(policyId, target);
    this.emit('version-rolled-back', { policyId, version });
    return updated;
  }

  listVersions(policyId: string): PolicyVersion[] {
    return this.versions.get(policyId) || [];
  }

  // ============ 模板 ============

  listTemplates(): PolicyTemplate[] {
    return [...POLICY_TEMPLATES];
  }

  getTemplate(templateId: string): PolicyTemplate | undefined {
    return POLICY_TEMPLATES.find((t) => t.id === templateId);
  }

  applyTemplate(templateId: string, variables: Record<string, any>): Policy {
    const template = this.getTemplate(templateId);
    if (!template) throw new Error(`Template ${templateId} not found`);

    // 校验必需变量
    for (const v of template.variables) {
      if (v.required && (variables[v.name] === undefined || variables[v.name] === null)) {
        throw new Error(`Missing required variable: ${v.name}`);
      }
    }

    // 应用默认值
    const vars: Record<string, any> = {};
    for (const v of template.variables) {
      vars[v.name] = variables[v.name] !== undefined ? variables[v.name] : v.default;
    }

    // 深渲染模板
    const policyInput = deepRender(template.policy, vars);

    // 自定义模板特定逻辑
    if (templateId === 'tpl-cost-limit' && vars.maxDailyCost !== undefined) {
      const rule = policyInput.rules[0];
      if (rule && rule.conditions[0] && rule.conditions[0].type === 'gt') {
        (rule.conditions[0] as any).value = vars.maxDailyCost;
      }
    }
    if (templateId === 'tpl-admin-only' && vars.adminRole) {
      const rule = policyInput.rules[0];
      if (rule && rule.conditions[0] && rule.conditions[0].type === 'not-in') {
        (rule.conditions[0] as any).values = [vars.adminRole];
      }
      if (vars.actions && Array.isArray(vars.actions)) {
        policyInput.appliesTo.actions = vars.actions;
      }
    }
    if (templateId === 'tpl-model-whitelist' && vars.allowedModels) {
      const rule = policyInput.rules[0];
      if (rule && rule.conditions[0] && rule.conditions[0].type === 'not-in') {
        (rule.conditions[0] as any).values = vars.allowedModels;
      }
    }
    if (templateId === 'tpl-time-window') {
      const rule = policyInput.rules[0];
      if (rule && rule.conditions[0] && rule.conditions[0].type === 'time-window') {
        (rule.conditions[0] as any).startHour = vars.startHour;
        (rule.conditions[0] as any).endHour = vars.endHour;
      }
    }
    if (templateId === 'tpl-region-restriction' && vars.allowedRegions) {
      const rule = policyInput.rules[0];
      if (rule && rule.conditions[0] && rule.conditions[0].type === 'not-in') {
        (rule.conditions[0] as any).values = vars.allowedRegions;
      }
    }

    return this.createPolicy(policyInput);
  }

  /**
   * 应用模板并自动激活 (便利方法): 创建后立即设为 active
   */
  applyTemplateAndActivate(templateId: string, variables: Record<string, any>): Policy {
    const policy = this.applyTemplate(templateId, variables);
    this.activatePolicy(policy.id);
    return this.getPolicy(policy.id)!;
  }

  // ============ 决策评估 ============

  evaluate(context: PolicyContext, options: { policyIds?: string[]; useCache?: boolean } = {}): PolicyDecision {
    const startTime = Date.now();
    const useCache = options.useCache !== false && this.config.enableCache;
    const cacheKey = useCache ? this.buildCacheKey(context) : '';

    // 查缓存
    if (useCache && cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        this.metrics.cacheHits++;
        return cached.decision;
      }
      this.metrics.cacheMisses++;
    }

    // 收集 applicable 策略
    const policies = this.getApplicablePolicies(context, options.policyIds);
    const matchedPolicies: string[] = [];
    let matchedRule: PolicyDecision['matchedRule'];
    const denyEffects: PolicyEffect[] = [];
    const allowEffects: PolicyEffect[] = [];
    const promptEffects: PolicyEffect[] = [];
    // 用于 priority 模式下的最高优先级命中
    let highestPriorityAllow = -Infinity;
    let highestPriorityDeny = -Infinity;
    let highestPriorityPrompt = -Infinity;

    for (const policy of policies) {
      matchedPolicies.push(policy.id);
      for (const rule of policy.rules) {
        if (evaluateRule(rule, context)) {
          matchedRule = { policyId: policy.id, ruleId: rule.id };
          if (rule.effect === 'allow') {
            allowEffects.push(rule.effect);
            if (policy.priority > highestPriorityAllow) highestPriorityAllow = policy.priority;
          } else if (rule.effect === 'deny') {
            denyEffects.push(rule.effect);
            if (policy.priority > highestPriorityDeny) highestPriorityDeny = policy.priority;
          } else if (rule.effect === 'prompt') {
            promptEffects.push(rule.effect);
            if (policy.priority > highestPriorityPrompt) highestPriorityPrompt = policy.priority;
          }
          break; // 一条规则命中后退出
        }
      }
    }

    // 冲突解决：检查各策略的 conflictResolution
    // 全局策略：deny > prompt > allow
    // allow-overrides：allow 优先于 deny
    // priority：按 priority 取最高的
    let effect: PolicyEffect;
    const hasAllowOverrides = policies.some((p) => p.conflictResolution === 'allow-overrides');
    const hasPriorityMode = policies.some((p) => p.conflictResolution === 'priority');
    const hasAnyRuleMatched = allowEffects.length > 0 || denyEffects.length > 0 || promptEffects.length > 0;

    if (hasAnyRuleMatched) {
      if (hasPriorityMode && policies.length > 0) {
        if (denyEffects.length > 0 && highestPriorityDeny >= highestPriorityAllow && highestPriorityDeny >= highestPriorityPrompt) {
          effect = 'deny';
        } else if (allowEffects.length > 0 && highestPriorityAllow >= highestPriorityDeny && highestPriorityAllow >= highestPriorityPrompt) {
          effect = 'allow';
        } else if (promptEffects.length > 0) {
          effect = 'prompt';
        } else {
          effect = this.config.defaultEffect;
        }
      } else if (hasAllowOverrides) {
        if (allowEffects.length > 0) {
          effect = 'allow';
        } else if (denyEffects.length > 0) {
          effect = 'deny';
        } else if (promptEffects.length > 0) {
          effect = 'prompt';
        } else {
          effect = this.config.defaultEffect;
        }
      } else {
        if (denyEffects.length > 0) {
          effect = 'deny';
        } else if (promptEffects.length > 0) {
          effect = 'prompt';
        } else if (allowEffects.length > 0) {
          effect = 'allow';
        } else {
          effect = this.config.defaultEffect;
        }
      }
    } else {
      // 没有规则命中：使用第一个匹配的策略的 defaultEffect
      // 如果没有任何策略匹配，使用 config.defaultEffect
      if (policies.length > 0) {
        effect = policies[0].defaultEffect;
      } else {
        effect = this.config.defaultEffect;
      }
    }

    const decision: PolicyDecision = {
      effect,
      allowed: effect === 'allow',
      reason: this.buildReason(effect, matchedPolicies, matchedRule),
      matchedPolicies,
      matchedRule,
      evaluatedPolicies: policies.length,
      evaluationDurationMs: Date.now() - startTime,
    };

    if (effect === 'prompt') {
      decision.prompt = {
        message: `Action "${context.action}" requires approval`,
        approvers: ['admin'],
        timeoutMs: 60000,
      };
    }

    // 记录决策日志
    if (this.config.enableDecisionLog) {
      this.recordDecisionLog(context, decision);
    }

    // 写入缓存
    if (useCache && cacheKey) {
      this.setCache(cacheKey, decision);
    }

    // 更新指标
    this.metrics.totalEvaluations++;
    if (effect === 'allow') this.metrics.allowedCount++;
    else if (effect === 'deny') this.metrics.deniedCount++;
    else if (effect === 'prompt') this.metrics.promptCount++;
    const totalMs = this.metrics.averageEvaluationMs * (this.metrics.totalEvaluations - 1) + decision.evaluationDurationMs;
    this.metrics.averageEvaluationMs = totalMs / this.metrics.totalEvaluations;

    // 审计联动
    if (this.config.enableAuditTrailIntegration && this.auditTrailHook) {
      this.auditTrailHook('policy.evaluated', { context, decision });
    }

    this.emit('policy-evaluated', { context, decision });
    return decision;
  }

  evaluateBulk(contexts: PolicyContext[]): PolicyDecision[] {
    return contexts.map((c) => this.evaluate(c));
  }

  /**
   * 强制执行：违反 deny 策略时抛出错误
   */
  enforce(context: PolicyContext): PolicyDecision {
    const decision = this.evaluate(context);
    if (decision.effect === 'deny') {
      const err = new PolicyViolationError(decision);
      this.emit('policy-enforced', { context, decision, denied: true });
      throw err;
    }
    this.emit('policy-enforced', { context, decision, denied: false });
    return decision;
  }

  /**
   * 守卫：返回 guard 对象
   */
  guard(_action: string): PolicyGuard {
    return {
      check: (ctx: Partial<PolicyContext> & { action: string }) => {
        const { action, ...rest } = ctx;
        const fullContext: PolicyContext = {
          user: ctx.user || { id: 'anonymous', email: '', roles: [], groups: [] },
          action,
          resource: ctx.resource || { type: 'unknown', id: 'unknown' },
          environment: ctx.environment || { timestamp: Date.now() },
          ...rest,
        } as PolicyContext;
        return this.evaluate(fullContext);
      },
    };
  }

  // ============ 测试 ============

  createTestCase(policyId: string, test: Omit<PolicyTestCase, 'id'>): PolicyTestCase {
    const full: PolicyTestCase = { ...test, id: generateTestCaseId() };
    const list = this.testCases.get(policyId) || [];
    list.push(full);
    this.testCases.set(policyId, list);
    this.save();
    return full;
  }

  listTestCases(policyId: string): PolicyTestCase[] {
    return this.testCases.get(policyId) || [];
  }

  testPolicy(policyId: string, testCases: PolicyTestCase[]): PolicyTestResult {
    const start = Date.now();
    const results: PolicyTestResult['results'] = [];
    let passed = 0;
    let failed = 0;

    for (const tc of testCases) {
      const decision = this.evaluate(tc.context, { policyIds: [policyId] });
      const ok = decision.effect === tc.expectedEffect;
      if (ok) passed++;
      else failed++;
      results.push({
        testCaseId: tc.id,
        testName: tc.name,
        expected: tc.expectedEffect,
        actual: decision.effect,
        passed: ok,
        reason: ok ? undefined : `Expected ${tc.expectedEffect} but got ${decision.effect}`,
      });
    }

    const result: PolicyTestResult = {
      policyId,
      total: testCases.length,
      passed,
      failed,
      durationMs: Date.now() - start,
      results,
    };
    this.emit('test-completed', result);
    return result;
  }

  // ============ 缓存 ============

  invalidateCache(policyId?: string): void {
    if (policyId) {
      // 简单实现：清理所有缓存（生产环境应做关联追踪）
      this.cache.clear();
    } else {
      this.cache.clear();
    }
    this.emit('cache-invalidated', { policyId });
  }

  getCacheStats(): { hits: number; misses: number; size: number } {
    return {
      hits: this.metrics.cacheHits,
      misses: this.metrics.cacheMisses,
      size: this.cache.size,
    };
  }

  // ============ 指标 ============

  getMetrics(): PolicyEngineMetrics {
    return { ...this.metrics };
  }

  getDecisionLog(filter?: DecisionLogFilter): PolicyDecisionLog[] {
    let logs = this.decisionLogs;
    if (filter) {
      if (filter.effect) {
        logs = logs.filter((l) => l.decision.effect === filter.effect);
      }
      if (filter.userId) {
        logs = logs.filter((l) => l.context.user.id === filter.userId);
      }
      if (filter.action) {
        logs = logs.filter((l) => l.context.action === filter.action);
      }
      if (filter.from !== undefined) {
        logs = logs.filter((l) => l.timestamp >= filter.from!);
      }
      if (filter.to !== undefined) {
        logs = logs.filter((l) => l.timestamp <= filter.to!);
      }
      if (filter.limit) {
        logs = logs.slice(-filter.limit);
      }
    }
    return logs.slice();
  }

  // ============ 集成 ============

  setAuditTrailHook(hook: (event: string, data: any) => void): void {
    this.auditTrailHook = hook;
  }

  // ============ 配置 ============

  getConfig(): PolicyEngineConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<PolicyEngineConfig>): void {
    this.config = { ...this.config, ...updates };
    this.save();
  }

  // ============ 事件 ============

  on(event: PolicyEventType, listener: (e: PolicyEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.listeners.get(event)!.delete(listener);
  }

  // ============ 辅助方法 ============

  private getApplicablePolicies(context: PolicyContext, policyIds?: string[]): Policy[] {
    let candidates = Array.from(this.policies.values()).filter((p) => p.status === 'active');

    if (policyIds && policyIds.length > 0) {
      const idSet = new Set(policyIds);
      candidates = candidates.filter((p) => idSet.has(p.id));
    }

    // 作用域匹配
    candidates = candidates.filter((p) => this.matchesScope(p, context));

    // 应用范围匹配
    candidates = candidates.filter((p) => this.matchesAppliesTo(p, context));

    // 时间有效性
    const now = Date.now();
    candidates = candidates.filter((p) => {
      if (p.effectiveFrom && now < p.effectiveFrom) return false;
      if (p.effectiveUntil && now > p.effectiveUntil) return false;
      return true;
    });

    return candidates.sort((a, b) => b.priority - a.priority);
  }

  private matchesScope(policy: Policy, context: PolicyContext): boolean {
    const s = policy.scope;
    if (s.orgId && s.orgId !== context.user.orgId) return false;
    if (s.teamId && s.teamId !== context.user.teamId) return false;
    if (s.projectId && s.projectId !== context.user.projectId) return false;
    if (s.userId && s.userId !== context.user.id) return false;
    if (s.resourceType && s.resourceType !== context.resource.type) return false;
    if (s.resourceId && s.resourceId !== context.resource.id) return false;
    if (s.environment && s.environment !== 'all') {
      // 简化：env 通过 user.attributes.env 推断
      const env = context.user.attributes?.environment;
      if (env && env !== s.environment) return false;
    }
    return true;
  }

  private matchesAppliesTo(policy: Policy, context: PolicyContext): boolean {
    const a = policy.appliesTo;
    // actions 匹配 (支持通配符 *)
    if (a.actions.length > 0) {
      const matches = a.actions.some((pattern) => {
        if (pattern === '*') return true;
        if (pattern.endsWith('.*')) {
          const prefix = pattern.slice(0, -2);
          return context.action === prefix || context.action.startsWith(prefix + '.');
        }
        return context.action === pattern;
      });
      if (!matches) return false;
    }
    // subjects
    if (a.subjects && a.subjects.length > 0) {
      const subject = context.agent ? 'agent' : 'user';
      if (!a.subjects.includes(subject)) return false;
    }
    // resources
    if (a.resources && a.resources.length > 0) {
      if (!a.resources.includes(context.resource.type)) return false;
    }
    // 额外 conditions
    if (a.conditions && a.conditions.length > 0) {
      if (!a.conditions.every((c) => evaluateCondition(c, context))) return false;
    }
    return true;
  }

  private buildCacheKey(context: PolicyContext): string {
    return [
      context.user.id,
      context.action,
      context.resource.type,
      context.resource.id,
      context.environment.ip || '',
      context.environment.model || '',
    ].join(':');
  }

  private setCache(key: string, decision: PolicyDecision): void {
    if (this.cache.size >= this.config.cacheMaxSize) {
      // 简单 LRU: 删除第一个
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      decision,
      expiresAt: Date.now() + this.config.cacheTtlMs,
    });
  }

  private buildReason(effect: PolicyEffect, matchedPolicies: string[], matchedRule?: PolicyDecision['matchedRule']): string {
    if (effect === 'deny') {
      return matchedRule
        ? `Denied by policy ${matchedRule.policyId} rule ${matchedRule.ruleId}`
        : 'Denied by default policy';
    }
    if (effect === 'prompt') {
      return 'Action requires approval';
    }
    if (matchedPolicies.length === 0) {
      return 'Allowed (default)';
    }
    return matchedRule
      ? `Allowed by policy ${matchedRule.policyId} rule ${matchedRule.ruleId}`
      : 'Allowed';
  }

  private recordDecisionLog(context: PolicyContext, decision: PolicyDecision): void {
    const log: PolicyDecisionLog = {
      id: generateDecisionLogId(),
      context,
      decision,
      timestamp: Date.now(),
    };
    this.decisionLogs.push(log);
    if (this.decisionLogs.length > this.config.maxDecisionLogs) {
      this.decisionLogs = this.decisionLogs.slice(-this.config.maxDecisionLogs);
    }
  }

  private refreshMetrics(): void {
    this.metrics.totalPolicies = this.policies.size;
    this.metrics.activePolicies = Array.from(this.policies.values()).filter((p) => p.status === 'active').length;
  }

  private emit(event: PolicyEventType, data: unknown): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      const e: PolicyEvent = { type: event, timestamp: Date.now(), data };
      for (const fn of listeners) {
        try {
          fn(e);
        } catch (err) {
          console.warn(`PolicyEngine: listener for ${event} threw`, err);
        }
      }
    }
  }

  /**
   * 清空所有状态
   */
  clear(): void {
    this.policies.clear();
    this.versions.clear();
    this.decisionLogs = [];
    this.testCases.clear();
    this.cache.clear();
    this.rateLimitCounters.clear();
    this.metrics = {
      totalPolicies: 0,
      activePolicies: 0,
      totalEvaluations: 0,
      allowedCount: 0,
      deniedCount: 0,
      promptCount: 0,
      averageEvaluationMs: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
    this.save();
  }
}

// ============ 全局单例 ============

let defaultInstance: PolicyEngine | null = null;

export function getDefaultPolicyEngine(): PolicyEngine {
  if (!defaultInstance) {
    defaultInstance = new PolicyEngine();
  }
  return defaultInstance;
}

export function setDefaultPolicyEngine(engine: PolicyEngine): void {
  defaultInstance = engine;
}
