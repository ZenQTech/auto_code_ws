/**
 * Policy Engine - 单元测试 (v1.0.0 Cycle 32 G32-03)
 *
 * 覆盖：
 * - 工具函数 (resolveField / deepEqual / renderTemplate / deepRender / evaluateCondition / evaluateRule / matchCIDR)
 * - 引擎初始化与配置
 * - 策略 CRUD (createPolicy / updatePolicy / deletePolicy / getPolicy / listPolicies)
 * - 策略状态管理 (activate / deactivate / archive)
 * - 版本管理 (publishVersion / rollbackToVersion / listVersions)
 * - 模板系统 (listTemplates / getTemplate / applyTemplate)
 * - 决策评估 (evaluate / evaluateBulk / enforce)
 * - 冲突解决 (priority / deny-overrides / allow-overrides)
 * - 作用域匹配 (org/team/project/user/resource)
 * - 应用范围匹配 (actions / subjects / resources / conditions)
 * - 测试系统 (createTestCase / listTestCases / testPolicy)
 * - 缓存 (invalidateCache / getCacheStats)
 * - 指标 (getMetrics)
 * - 决策日志 (getDecisionLog)
 * - 审计集成 (setAuditTrailHook)
 * - 事件订阅 (on)
 * - 错误处理 (PolicyViolationError)
 * - 清理 (clear)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PolicyEngine,
  PolicyViolationError,
  getDefaultPolicyEngine,
  setDefaultPolicyEngine,
  DEFAULT_POLICY_CONFIG,
  POLICY_TEMPLATES,
  generatePolicyId,
  generateRuleId,
  generateVersionId,
  generateDecisionLogId,
  generateTestCaseId,
  resolveField,
  deepEqual,
  renderTemplate,
  deepRender,
  evaluateCondition,
  evaluateRule,
  matchCIDR,
  type Policy,
  type PolicyContext,
  type PolicyRule,
  type PolicyCondition,
} from './policyEngine';

// ============ 测试辅助 ============

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    user: {
      id: 'user-1',
      email: 'user@example.com',
      roles: ['developer'],
      groups: ['team-a'],
      orgId: 'org-1',
      teamId: 'team-1',
      projectId: 'proj-1',
    },
    action: 'agent.execute',
    resource: {
      type: 'agent',
      id: 'agent-1',
    },
    environment: {
      timestamp: new Date('2026-07-30T12:00:00Z').getTime(),
      ip: '10.0.0.1',
      model: 'gpt-4',
      cost: 0.05,
    },
    ...overrides,
  };
}

function makeRule(overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: 'rule-1',
    name: 'Test rule',
    effect: 'allow',
    conditions: [],
    ...overrides,
  };
}

function makePolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: 'pol-test',
    name: 'Test Policy',
    version: '1.0.0',
    status: 'active',
    priority: 100,
    scope: {},
    appliesTo: { actions: ['*'] },
    rules: [],
    defaultEffect: 'deny',
    conflictResolution: 'deny-overrides',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ============ 工具函数测试 ============

describe('PolicyEngine - 工具函数', () => {
  it('resolveField 简单路径', () => {
    const ctx = makeContext();
    expect(resolveField(ctx, 'user.id')).toBe('user-1');
    expect(resolveField(ctx, 'user.email')).toBe('user@example.com');
    expect(resolveField(ctx, 'action')).toBe('agent.execute');
  });

  it('resolveField 数组索引', () => {
    const ctx = makeContext();
    expect(resolveField(ctx, 'user.roles.0')).toBe('developer');
  });

  it('resolveField 不存在的路径返回 undefined', () => {
    const ctx = makeContext();
    expect(resolveField(ctx, 'user.nonexistent')).toBeUndefined();
    expect(resolveField(ctx, 'foo.bar.baz')).toBeUndefined();
  });

  it('resolveField 空路径', () => {
    const ctx = makeContext();
    expect(resolveField(ctx, '')).toBeUndefined();
  });

  it('deepEqual 原始值', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
  });

  it('deepEqual null/undefined', () => {
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(undefined, undefined)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  it('deepEqual 数组', () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2, 3], [1, 2])).toBe(false);
  });

  it('deepEqual 对象', () => {
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
  });

  it('renderTemplate 替换变量', () => {
    expect(renderTemplate('Hello {{name}}', { name: 'World' })).toBe('Hello World');
  });

  it('renderTemplate 未定义变量保留', () => {
    expect(renderTemplate('Hello {{name}}', {})).toBe('Hello {{name}}');
  });

  it('deepRender 嵌套对象', () => {
    const obj = {
      name: 'pol-{{id}}',
      rules: [
        { name: 'rule-{{rid}}', conditions: [{ value: '{{x}}' }] },
      ],
    };
    const result = deepRender(obj, { id: '123', rid: 'r1', x: 42 });
    expect(result.name).toBe('pol-123');
    expect(result.rules[0].name).toBe('rule-r1');
    expect(result.rules[0].conditions[0].value).toBe(42);
  });

  it('matchCIDR 匹配', () => {
    expect(matchCIDR('10.0.0.5', '10.0.0.0/24')).toBe(true);
    expect(matchCIDR('10.0.1.5', '10.0.0.0/24')).toBe(false);
    expect(matchCIDR('192.168.1.1', '192.168.1.0/24')).toBe(true);
  });

  it('matchCIDR 无 CIDR 格式', () => {
    expect(matchCIDR('10.0.0.1', '10.0.0.1')).toBe(true);
    expect(matchCIDR('10.0.0.1', '10.0.0.2')).toBe(false);
  });

  it('matchCIDR /0 匹配所有', () => {
    expect(matchCIDR('1.2.3.4', '0.0.0.0/0')).toBe(true);
  });

  it('matchCIDR 非法 IP', () => {
    expect(matchCIDR('invalid', '10.0.0.0/24')).toBe(false);
  });

  it('evaluateCondition equals', () => {
    const ctx = makeContext();
    const cond: PolicyCondition = { type: 'equals', field: 'user.id', value: 'user-1' };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('evaluateCondition not-equals', () => {
    const ctx = makeContext();
    const cond: PolicyCondition = { type: 'not-equals', field: 'user.id', value: 'user-2' };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('evaluateCondition in / not-in', () => {
    const ctx = makeContext();
    expect(evaluateCondition({ type: 'in', field: 'user.roles', values: ['developer', 'admin'] }, ctx)).toBe(true);
    expect(evaluateCondition({ type: 'in', field: 'user.roles', values: ['admin'] }, ctx)).toBe(false);
    expect(evaluateCondition({ type: 'not-in', field: 'user.roles', values: ['admin'] }, ctx)).toBe(true);
  });

  it('evaluateCondition gt/gte/lt/lte', () => {
    const ctx = makeContext({ environment: { ...makeContext().environment, cost: 100 } });
    expect(evaluateCondition({ type: 'gt', field: 'environment.cost', value: 50 }, ctx)).toBe(true);
    expect(evaluateCondition({ type: 'gte', field: 'environment.cost', value: 100 }, ctx)).toBe(true);
    expect(evaluateCondition({ type: 'lt', field: 'environment.cost', value: 200 }, ctx)).toBe(true);
    expect(evaluateCondition({ type: 'lte', field: 'environment.cost', value: 100 }, ctx)).toBe(true);
  });

  it('evaluateCondition between', () => {
    const ctx = makeContext({ environment: { ...makeContext().environment, cost: 50 } });
    expect(evaluateCondition({ type: 'between', field: 'environment.cost', min: 10, max: 100 }, ctx)).toBe(true);
    expect(evaluateCondition({ type: 'between', field: 'environment.cost', min: 100, max: 200, inclusive: true }, ctx)).toBe(false);
  });

  it('evaluateCondition contains/starts-with/ends-with', () => {
    const ctx = makeContext();
    ctx.user.email = 'alice@example.com';
    expect(evaluateCondition({ type: 'contains', field: 'user.email', value: 'example' }, ctx)).toBe(true);
    expect(evaluateCondition({ type: 'starts-with', field: 'user.email', value: 'alice' }, ctx)).toBe(true);
    expect(evaluateCondition({ type: 'ends-with', field: 'user.email', value: '.com' }, ctx)).toBe(true);
  });

  it('evaluateCondition regex', () => {
    const ctx = makeContext();
    expect(evaluateCondition({ type: 'regex', field: 'user.email', pattern: '.*@example\\.com$' }, ctx)).toBe(true);
    expect(evaluateCondition({ type: 'regex', field: 'user.email', pattern: '[invalid(' }, ctx)).toBe(false);
  });

  it('evaluateCondition exists/not-exists', () => {
    const ctx = makeContext();
    expect(evaluateCondition({ type: 'exists', field: 'user.id' }, ctx)).toBe(true);
    expect(evaluateCondition({ type: 'not-exists', field: 'user.id' }, ctx)).toBe(false);
    expect(evaluateCondition({ type: 'exists', field: 'user.nonexistent' }, ctx)).toBe(false);
  });

  it('evaluateCondition time-window', () => {
    // 12:00 UTC - 在 9-18 范围内
    const ctx = makeContext({ environment: { ...makeContext().environment, timestamp: new Date('2026-07-30T12:00:00Z').getTime() } });
    expect(evaluateCondition({ type: 'time-window', field: 'environment.timestamp', startHour: 9, endHour: 18 }, ctx)).toBe(true);
    // 20:00 UTC - 超出 9-18
    const ctx2 = makeContext({ environment: { ...makeContext().environment, timestamp: new Date('2026-07-30T20:00:00Z').getTime() } });
    expect(evaluateCondition({ type: 'time-window', field: 'environment.timestamp', startHour: 9, endHour: 18 }, ctx2)).toBe(false);
  });

  it('evaluateCondition time-window 跨天', () => {
    const ctx = makeContext({ environment: { ...makeContext().environment, timestamp: new Date('2026-07-30T02:00:00Z').getTime() } });
    expect(evaluateCondition({ type: 'time-window', field: 'environment.timestamp', startHour: 22, endHour: 6 }, ctx)).toBe(true);
  });

  it('evaluateCondition day-of-week', () => {
    // 2026-07-30 是周四
    const ctx = makeContext();
    expect(evaluateCondition({ type: 'day-of-week', field: 'environment.timestamp', days: [4] }, ctx)).toBe(true);
    expect(evaluateCondition({ type: 'day-of-week', field: 'environment.timestamp', days: [1, 2] }, ctx)).toBe(false);
  });

  it('evaluateCondition ip-range', () => {
    const ctx = makeContext();
    expect(evaluateCondition({ type: 'ip-range', field: 'environment.ip', cidrs: ['10.0.0.0/24'] }, ctx)).toBe(true);
    expect(evaluateCondition({ type: 'ip-range', field: 'environment.ip', cidrs: ['192.168.0.0/24'] }, ctx)).toBe(false);
  });

  it('evaluateCondition rate-limit', () => {
    const ctx = makeContext();
    expect(evaluateCondition({ type: 'rate-limit', field: 'user.id', windowMs: 60000, maxCount: 10, scope: 'user' }, ctx)).toBe(true);
  });

  it('evaluateCondition custom JS', () => {
    const ctx = makeContext();
    expect(evaluateCondition({ type: 'custom', field: 'user.id', evaluator: 'javascript', expression: 'user.id === "user-1"' }, ctx)).toBe(true);
  });

  it('evaluateCondition custom JS 错误处理', () => {
    const ctx = makeContext();
    expect(evaluateCondition({ type: 'custom', field: 'user.id', evaluator: 'javascript', expression: 'invalid syntax !!!' }, ctx)).toBe(false);
  });

  it('evaluateCondition negated', () => {
    const ctx = makeContext();
    const cond: PolicyCondition = { type: 'equals', field: 'user.id', value: 'user-2', negated: true };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('evaluateRule AND 逻辑', () => {
    const ctx = makeContext();
    const rule: PolicyRule = {
      id: 'r1',
      name: 'AND',
      effect: 'allow',
      conditions: [
        { type: 'equals', field: 'user.id', value: 'user-1' },
        { type: 'in', field: 'user.roles', values: ['developer'] },
      ],
    };
    expect(evaluateRule(rule, ctx)).toBe(true);
  });

  it('evaluateRule AND 一个不满足则不通过', () => {
    const ctx = makeContext();
    const rule: PolicyRule = {
      id: 'r1',
      name: 'AND fail',
      effect: 'allow',
      conditions: [
        { type: 'equals', field: 'user.id', value: 'user-1' },
        { type: 'in', field: 'user.roles', values: ['admin'] },
      ],
    };
    expect(evaluateRule(rule, ctx)).toBe(false);
  });

  it('evaluateRule OR group', () => {
    const ctx = makeContext();
    const rule: PolicyRule = {
      id: 'r1',
      name: 'OR',
      effect: 'allow',
      conditions: [
        { type: 'equals', field: 'user.id', value: 'user-1' },
      ],
      orGroups: [
        [{ type: 'in', field: 'user.roles', values: ['admin'] }],
        [{ type: 'in', field: 'user.roles', values: ['developer'] }],
      ],
    };
    expect(evaluateRule(rule, ctx)).toBe(true);
  });

  it('evaluateRule 没有 OR 组时 conditions 全部满足即可', () => {
    const ctx = makeContext();
    const rule: PolicyRule = {
      id: 'r1',
      name: 'no OR',
      effect: 'allow',
      conditions: [{ type: 'equals', field: 'user.id', value: 'user-1' }],
    };
    expect(evaluateRule(rule, ctx)).toBe(true);
  });
});

// ============ ID 生成测试 ============

describe('PolicyEngine - ID 生成', () => {
  it('generatePolicyId 格式正确', () => {
    const id = generatePolicyId();
    expect(id).toMatch(/^pol-\d+-[a-z0-9]+$/);
  });

  it('generateRuleId 格式正确', () => {
    expect(generateRuleId()).toMatch(/^rule-\d+-[a-z0-9]+$/);
  });

  it('generateVersionId 格式正确', () => {
    expect(generateVersionId()).toMatch(/^ver-\d+-[a-z0-9]+$/);
  });

  it('generateDecisionLogId 格式正确', () => {
    expect(generateDecisionLogId()).toMatch(/^dl-\d+-[a-z0-9]+$/);
  });

  it('generateTestCaseId 格式正确', () => {
    expect(generateTestCaseId()).toMatch(/^tc-\d+-[a-z0-9]+$/);
  });

  it('生成的 ID 唯一', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(generatePolicyId());
    expect(ids.size).toBe(100);
  });
});

// ============ 引擎初始化测试 ============

describe('PolicyEngine - 初始化与配置', () => {
  it('默认配置', () => {
    const engine = new PolicyEngine({ persist: false });
    const config = engine.getConfig();
    expect(config.defaultEffect).toBe('deny');
    expect(config.enableCache).toBe(true);
    expect(config.cacheMaxSize).toBe(1000);
  });

  it('自定义配置', () => {
    const engine = new PolicyEngine({ persist: false, defaultEffect: 'allow', cacheMaxSize: 500 });
    expect(engine.getConfig().defaultEffect).toBe('allow');
    expect(engine.getConfig().cacheMaxSize).toBe(500);
  });

  it('updateConfig 合并', () => {
    const engine = new PolicyEngine({ persist: false });
    engine.updateConfig({ cacheMaxSize: 2000 });
    expect(engine.getConfig().cacheMaxSize).toBe(2000);
    expect(engine.getConfig().enableCache).toBe(true); // 保留
  });

  it('DEFAULT_POLICY_CONFIG 默认值', () => {
    expect(DEFAULT_POLICY_CONFIG.defaultEffect).toBe('deny');
    expect(DEFAULT_POLICY_CONFIG.cacheTtlMs).toBe(60000);
  });
});

// ============ 策略 CRUD 测试 ============

describe('PolicyEngine - 策略 CRUD', () => {
  let engine: PolicyEngine;
  beforeEach(() => {
    engine = new PolicyEngine({ persist: false });
  });

  it('createPolicy 生成 ID 和时间戳', () => {
    const p = engine.createPolicy({
      name: 'Test',
      version: '1.0.0',
      status: 'draft',
      priority: 100,
      scope: {},
      appliesTo: { actions: ['*'] },
      rules: [],
      defaultEffect: 'allow',
      conflictResolution: 'deny-overrides',
    });
    expect(p.id).toMatch(/^pol-/);
    expect(p.createdAt).toBeGreaterThan(0);
    expect(p.updatedAt).toBeGreaterThan(0);
  });

  it('getPolicy 检索', () => {
    const p = engine.createPolicy({
      name: 'Test',
      version: '1.0.0',
      status: 'active',
      priority: 100,
      scope: {},
      appliesTo: { actions: ['*'] },
      rules: [],
      defaultEffect: 'allow',
      conflictResolution: 'deny-overrides',
    });
    expect(engine.getPolicy(p.id)).toEqual(p);
    expect(engine.getPolicy('nonexistent')).toBeUndefined();
  });

  it('updatePolicy 修改字段', () => {
    const p = engine.createPolicy({
      name: 'Test',
      version: '1.0.0',
      status: 'draft',
      priority: 100,
      scope: {},
      appliesTo: { actions: ['*'] },
      rules: [],
      defaultEffect: 'allow',
      conflictResolution: 'deny-overrides',
    });
    const updated = engine.updatePolicy(p.id, { priority: 200, name: 'Updated' });
    expect(updated.priority).toBe(200);
    expect(updated.name).toBe('Updated');
    expect(updated.id).toBe(p.id);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(p.updatedAt);
  });

  it('updatePolicy 不存在的策略', () => {
    expect(() => engine.updatePolicy('nonexistent', { name: 'X' })).toThrow();
  });

  it('deletePolicy', () => {
    const p = engine.createPolicy({
      name: 'Test',
      version: '1.0.0',
      status: 'active',
      priority: 100,
      scope: {},
      appliesTo: { actions: ['*'] },
      rules: [],
      defaultEffect: 'allow',
      conflictResolution: 'deny-overrides',
    });
    engine.deletePolicy(p.id);
    expect(engine.getPolicy(p.id)).toBeUndefined();
  });

  it('listPolicies 无过滤', () => {
    engine.createPolicy({ ...makePolicy({ name: 'P1' }), id: undefined as any });
    engine.createPolicy({ ...makePolicy({ name: 'P2' }), id: undefined as any });
    expect(engine.listPolicies().length).toBe(2);
  });

  it('listPolicies 按 status 过滤', () => {
    engine.createPolicy({ ...makePolicy({ name: 'P1', status: 'active' }), id: undefined as any });
    engine.createPolicy({ ...makePolicy({ name: 'P2', status: 'draft' }), id: undefined as any });
    expect(engine.listPolicies({ status: 'active' }).length).toBe(1);
  });

  it('listPolicies 按 tag 过滤', () => {
    engine.createPolicy({ ...makePolicy({ name: 'P1', tags: ['security'] }), id: undefined as any });
    engine.createPolicy({ ...makePolicy({ name: 'P2', tags: ['cost'] }), id: undefined as any });
    expect(engine.listPolicies({ tags: ['security'] }).length).toBe(1);
  });

  it('listPolicies 按 action 过滤', () => {
    engine.createPolicy({ ...makePolicy({ name: 'P1', appliesTo: { actions: ['llm.call'] } }), id: undefined as any });
    engine.createPolicy({ ...makePolicy({ name: 'P2', appliesTo: { actions: ['agent.execute'] } }), id: undefined as any });
    expect(engine.listPolicies({ action: 'llm.call' }).length).toBe(1);
  });

  it('listPolicies 按搜索', () => {
    engine.createPolicy({ ...makePolicy({ name: 'Security Policy' }), id: undefined as any });
    engine.createPolicy({ ...makePolicy({ name: 'Cost Policy' }), id: undefined as any });
    expect(engine.listPolicies({ search: 'sec' }).length).toBe(1);
  });

  it('listPolicies 按 orgId 过滤', () => {
    engine.createPolicy({ ...makePolicy({ name: 'P1', scope: { orgId: 'org-1' } }), id: undefined as any });
    engine.createPolicy({ ...makePolicy({ name: 'P2', scope: { orgId: 'org-2' } }), id: undefined as any });
    engine.createPolicy({ ...makePolicy({ name: 'P3', scope: {} }), id: undefined as any });
    // 作用域匹配：scope.orgId 匹配传入的 orgId，或无 orgId 限制
    expect(engine.listPolicies({ scopeOrgId: 'org-1' }).length).toBe(2);
  });

  it('listPolicies 按 priority 排序', () => {
    engine.createPolicy({ ...makePolicy({ name: 'Low', priority: 50 }), id: undefined as any });
    engine.createPolicy({ ...makePolicy({ name: 'High', priority: 500 }), id: undefined as any });
    const list = engine.listPolicies();
    expect(list[0].priority).toBe(500);
    expect(list[1].priority).toBe(50);
  });
});

// ============ 策略状态管理测试 ============

describe('PolicyEngine - 状态管理', () => {
  let engine: PolicyEngine;
  beforeEach(() => {
    engine = new PolicyEngine({ persist: false });
  });

  it('activatePolicy', () => {
    const p = engine.createPolicy({ ...makePolicy({ status: 'draft' }), id: undefined as any });
    engine.activatePolicy(p.id);
    expect(engine.getPolicy(p.id)!.status).toBe('active');
  });

  it('deactivatePolicy', () => {
    const p = engine.createPolicy({ ...makePolicy({ status: 'active' }), id: undefined as any });
    engine.deactivatePolicy(p.id);
    expect(engine.getPolicy(p.id)!.status).toBe('deprecated');
  });

  it('archivePolicy', () => {
    const p = engine.createPolicy({ ...makePolicy({ status: 'active' }), id: undefined as any });
    engine.archivePolicy(p.id);
    expect(engine.getPolicy(p.id)!.status).toBe('archived');
  });

  it('activatePolicy 不存在报错', () => {
    expect(() => engine.activatePolicy('nonexistent')).toThrow();
  });
});

// ============ 版本管理测试 ============

describe('PolicyEngine - 版本管理', () => {
  let engine: PolicyEngine;
  beforeEach(() => {
    engine = new PolicyEngine({ persist: false });
  });

  it('publishVersion', () => {
    const p = engine.createPolicy({ ...makePolicy(), id: undefined as any });
    const versioned = engine.publishVersion(p.id, '1.0.1', 'Test changelog');
    expect(versioned.version).toBe('1.0.1');
    const versions = engine.listVersions(p.id);
    expect(versions.length).toBe(1);
    expect(versions[0].changelog).toBe('Test changelog');
  });

  it('rollbackToVersion 还原', () => {
    const p = engine.createPolicy({ ...makePolicy({ priority: 100 }), id: undefined as any });
    engine.publishVersion(p.id, '1.0.0', 'initial');
    engine.updatePolicy(p.id, { priority: 200 });
    const rolled = engine.rollbackToVersion(p.id, '1.0.0');
    expect(rolled.priority).toBe(100);
  });

  it('rollbackToVersion 不存在的版本', () => {
    const p = engine.createPolicy({ ...makePolicy(), id: undefined as any });
    expect(() => engine.rollbackToVersion(p.id, '99.0.0')).toThrow();
  });

  it('getPolicyVersion 检索', () => {
    const p = engine.createPolicy({ ...makePolicy(), id: undefined as any });
    engine.publishVersion(p.id, '1.0.0');
    const v = engine.getPolicyVersion(p.id, '1.0.0');
    expect(v).toBeDefined();
    expect(v!.version).toBe('1.0.0');
    expect(engine.getPolicyVersion(p.id, '99.0.0')).toBeUndefined();
  });

  it('listVersions 空', () => {
    const p = engine.createPolicy({ ...makePolicy(), id: undefined as any });
    expect(engine.listVersions(p.id).length).toBe(0);
  });
});

// ============ 模板系统测试 ============

describe('PolicyEngine - 模板系统', () => {
  let engine: PolicyEngine;
  beforeEach(() => {
    engine = new PolicyEngine({ persist: false });
  });

  it('listTemplates 包含 6 个预置模板', () => {
    const templates = engine.listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(6);
    expect(templates.find((t) => t.id === 'tpl-cost-limit')).toBeDefined();
    expect(templates.find((t) => t.id === 'tpl-admin-only')).toBeDefined();
  });

  it('getTemplate 检索', () => {
    expect(engine.getTemplate('tpl-cost-limit')).toBeDefined();
    expect(engine.getTemplate('nonexistent')).toBeUndefined();
  });

  it('applyTemplate cost-limit', () => {
    const p = engine.applyTemplate('tpl-cost-limit', { maxDailyCost: 100, currency: 'USD' });
    expect(p.id).toMatch(/^pol-/);
    expect(p.rules[0].conditions[0]).toMatchObject({ type: 'gt', value: 100 });
  });

  it('applyTemplate 缺少必需变量', () => {
    expect(() => engine.applyTemplate('tpl-cost-limit', {})).toThrow();
  });

  it('applyTemplate model-whitelist', () => {
    const p = engine.applyTemplate('tpl-model-whitelist', { allowedModels: ['gpt-4', 'claude-3'] });
    expect(p.appliesTo.actions).toContain('llm.call');
  });

  it('applyTemplate admin-only', () => {
    const p = engine.applyTemplate('tpl-admin-only', { adminRole: 'superadmin', actions: ['admin.delete'] });
    expect(p.appliesTo.actions).toContain('admin.delete');
  });

  it('applyTemplate time-window', () => {
    const p = engine.applyTemplate('tpl-time-window', { startHour: 8, endHour: 20 });
    expect(p.rules[0].conditions[0]).toMatchObject({ startHour: 8, endHour: 20 });
  });

  it('applyTemplate region-restriction', () => {
    const p = engine.applyTemplate('tpl-region-restriction', { allowedRegions: ['us-east-1', 'us-west-2'] });
    expect(p.rules[0].conditions[0]).toMatchObject({ type: 'not-in' });
  });

  it('applyTemplate pii-protection', () => {
    const p = engine.applyTemplate('tpl-pii-protection', {});
    expect(p.appliesTo.actions).toContain('data.read');
  });

  it('applyTemplate 不存在', () => {
    expect(() => engine.applyTemplate('nonexistent', {})).toThrow();
  });
});

// ============ 决策评估测试 ============

describe('PolicyEngine - 决策评估', () => {
  let engine: PolicyEngine;
  beforeEach(() => {
    engine = new PolicyEngine({ persist: false, enableCache: false });
  });

  it('evaluate 无策略返回 defaultEffect', () => {
    const decision = engine.evaluate(makeContext());
    expect(decision.effect).toBe('deny'); // 默认 deny
    expect(decision.allowed).toBe(false);
    expect(decision.evaluatedPolicies).toBe(0);
  });

  it('evaluate allow 规则', () => {
    engine.createPolicy({
      ...makePolicy({
        name: 'Allow all',
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'equals', field: 'user.id', value: 'user-1' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    const decision = engine.evaluate(makeContext());
    expect(decision.effect).toBe('allow');
    expect(decision.allowed).toBe(true);
  });

  it('evaluate deny 规则', () => {
    engine.createPolicy({
      ...makePolicy({
        rules: [makeRule({ effect: 'deny', conditions: [{ type: 'equals', field: 'user.id', value: 'user-1' }] })],
      }),
      id: undefined as any,
    });
    const decision = engine.evaluate(makeContext());
    expect(decision.effect).toBe('deny');
    expect(decision.allowed).toBe(false);
  });

  it('evaluate prompt 规则', () => {
    engine.createPolicy({
      ...makePolicy({
        rules: [makeRule({ effect: 'prompt', conditions: [{ type: 'equals', field: 'user.id', value: 'user-1' }] })],
      }),
      id: undefined as any,
    });
    const decision = engine.evaluate(makeContext());
    expect(decision.effect).toBe('prompt');
    expect(decision.allowed).toBe(false);
    expect(decision.prompt).toBeDefined();
    expect(decision.prompt!.approvers).toContain('admin');
  });

  it('evaluate conflictResolution deny-overrides', () => {
    engine.createPolicy({
      ...makePolicy({
        name: 'Allow high priority',
        priority: 100,
        rules: [makeRule({ id: 'r1', effect: 'allow', conditions: [{ type: 'equals', field: 'user.id', value: 'user-1' }] })],
      }),
      id: undefined as any,
    });
    engine.createPolicy({
      ...makePolicy({
        name: 'Deny low priority',
        priority: 50,
        rules: [makeRule({ id: 'r2', effect: 'deny', conditions: [{ type: 'equals', field: 'user.id', value: 'user-1' }] })],
        conflictResolution: 'deny-overrides',
      }),
      id: undefined as any,
    });
    const decision = engine.evaluate(makeContext());
    expect(decision.effect).toBe('deny');
  });

  it('evaluate conflictResolution allow-overrides', () => {
    engine.createPolicy({
      ...makePolicy({
        name: 'Deny high',
        priority: 100,
        rules: [makeRule({ id: 'r1', effect: 'deny', conditions: [{ type: 'equals', field: 'user.id', value: 'user-1' }] })],
        conflictResolution: 'allow-overrides',
      }),
      id: undefined as any,
    });
    engine.createPolicy({
      ...makePolicy({
        name: 'Allow low',
        priority: 50,
        rules: [makeRule({ id: 'r2', effect: 'allow', conditions: [{ type: 'equals', field: 'user.id', value: 'user-1' }] })],
        conflictResolution: 'allow-overrides',
      }),
      id: undefined as any,
    });
    const decision = engine.evaluate(makeContext());
    expect(decision.effect).toBe('allow');
  });

  it('evaluate 仅 active 策略', () => {
    engine.createPolicy({
      ...makePolicy({
        status: 'draft',
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'equals', field: 'user.id', value: 'user-1' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    const decision = engine.evaluate(makeContext());
    expect(decision.effect).toBe('deny'); // draft 不参与
  });

  it('evaluate 指定 policyIds', () => {
    const p1 = engine.createPolicy({ ...makePolicy({ name: 'P1', defaultEffect: 'allow' }), id: undefined as any });
    const p2 = engine.createPolicy({ ...makePolicy({ name: 'P2', defaultEffect: 'deny' }), id: undefined as any });
    const decision = engine.evaluate(makeContext(), { policyIds: [p1.id] });
    expect(decision.evaluatedPolicies).toBe(1);
  });

  it('evaluate effectiveFrom/effectiveUntil', () => {
    const now = Date.now();
    engine.createPolicy({
      ...makePolicy({
        effectiveFrom: now + 10000,
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    const decision = engine.evaluate(makeContext());
    expect(decision.effect).toBe('deny'); // 还未生效
  });

  it('evaluate 过期策略', () => {
    engine.createPolicy({
      ...makePolicy({
        effectiveUntil: Date.now() - 1000,
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    const decision = engine.evaluate(makeContext());
    expect(decision.effect).toBe('deny');
  });

  it('evaluate action 通配符 *', () => {
    engine.createPolicy({
      ...makePolicy({
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'equals', field: 'user.id', value: 'user-1' }] })],
        defaultEffect: 'allow',
        appliesTo: { actions: ['*'] },
      }),
      id: undefined as any,
    });
    const decision = engine.evaluate(makeContext({ action: 'anything' }));
    expect(decision.effect).toBe('allow');
  });

  it('evaluate action 前缀通配符', () => {
    engine.createPolicy({
      ...makePolicy({
        rules: [makeRule({ effect: 'deny', conditions: [{ type: 'exists', field: 'user.id' }] })],
        appliesTo: { actions: ['agent.*'] },
      }),
      id: undefined as any,
    });
    const decision = engine.evaluate(makeContext({ action: 'agent.execute' }));
    expect(decision.effect).toBe('deny');
    const decision2 = engine.evaluate(makeContext({ action: 'llm.call' }));
    expect(decision2.effect).toBe('deny'); // 不适用
  });

  it('evaluate matchedPolicies 包含命中策略', () => {
    engine.createPolicy({
      ...makePolicy({
        name: 'P1',
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'exists', field: 'user.id' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    const decision = engine.evaluate(makeContext());
    expect(decision.matchedPolicies.length).toBe(1);
  });

  it('evaluate matchedRule 记录', () => {
    engine.createPolicy({
      ...makePolicy({
        rules: [makeRule({ id: 'rule-xyz', effect: 'allow', conditions: [{ type: 'exists', field: 'user.id' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    const decision = engine.evaluate(makeContext());
    expect(decision.matchedRule).toBeDefined();
    expect(decision.matchedRule!.ruleId).toBe('rule-xyz');
  });

  it('evaluate reason 文案', () => {
    engine.createPolicy({
      ...makePolicy({
        rules: [makeRule({ effect: 'deny', conditions: [{ type: 'exists', field: 'user.id' }] })],
      }),
      id: undefined as any,
    });
    const decision = engine.evaluate(makeContext());
    expect(decision.reason).toContain('Denied');
  });

  it('evaluateBulk', () => {
    const decisions = engine.evaluateBulk([makeContext(), makeContext()]);
    expect(decisions.length).toBe(2);
  });
});

// ============ enforce 测试 ============

describe('PolicyEngine - enforce 强制执行', () => {
  let engine: PolicyEngine;
  beforeEach(() => {
    engine = new PolicyEngine({ persist: false, enableCache: false });
  });

  it('enforce allow 不抛错', () => {
    engine.createPolicy({
      ...makePolicy({
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'exists', field: 'user.id' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    expect(() => engine.enforce(makeContext())).not.toThrow();
  });

  it('enforce deny 抛 PolicyViolationError', () => {
    engine.createPolicy({
      ...makePolicy({
        rules: [makeRule({ effect: 'deny', conditions: [{ type: 'exists', field: 'user.id' }] })],
      }),
      id: undefined as any,
    });
    expect(() => engine.enforce(makeContext())).toThrow(PolicyViolationError);
  });

  it('PolicyViolationError 包含 decision', () => {
    engine.createPolicy({
      ...makePolicy({
        rules: [makeRule({ effect: 'deny', conditions: [{ type: 'exists', field: 'user.id' }] })],
      }),
      id: undefined as any,
    });
    try {
      engine.enforce(makeContext());
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PolicyViolationError);
      expect((e as PolicyViolationError).decision.effect).toBe('deny');
    }
  });
});

// ============ guard 测试 ============

describe('PolicyEngine - guard', () => {
  it('guard.check 评估', () => {
    const engine = new PolicyEngine({ persist: false, enableCache: false });
    engine.createPolicy({
      ...makePolicy({
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'equals', field: 'user.id', value: 'u1' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    const guard = engine.guard('agent.execute');
    const decision = guard.check({ user: { id: 'u1', email: 'u1@x.com', roles: [], groups: [] } as any });
    expect(decision.effect).toBe('allow');
  });
});

// ============ 作用域匹配测试 ============

describe('PolicyEngine - 作用域匹配', () => {
  let engine: PolicyEngine;
  beforeEach(() => {
    engine = new PolicyEngine({ persist: false, enableCache: false });
  });

  it('scope.orgId 匹配', () => {
    engine.createPolicy({
      ...makePolicy({
        scope: { orgId: 'org-1' },
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'exists', field: 'user.id' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    const ctx1 = makeContext({ user: { ...makeContext().user, orgId: 'org-1' } });
    const ctx2 = makeContext({ user: { ...makeContext().user, orgId: 'org-2' } });
    expect(engine.evaluate(ctx1).effect).toBe('allow');
    expect(engine.evaluate(ctx2).effect).toBe('deny');
  });

  it('scope.teamId 匹配', () => {
    engine.createPolicy({
      ...makePolicy({
        scope: { teamId: 'team-a' },
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'exists', field: 'user.id' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    const ctx = makeContext({ user: { ...makeContext().user, teamId: 'team-b' } });
    expect(engine.evaluate(ctx).effect).toBe('deny');
  });

  it('scope.userId 匹配', () => {
    engine.createPolicy({
      ...makePolicy({
        scope: { userId: 'user-special' },
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'exists', field: 'user.id' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    const ctx = makeContext({ user: { ...makeContext().user, id: 'user-normal' } });
    expect(engine.evaluate(ctx).effect).toBe('deny');
  });

  it('scope.resourceType 匹配', () => {
    engine.createPolicy({
      ...makePolicy({
        scope: { resourceType: 'agent' },
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'exists', field: 'user.id' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    const ctx = makeContext({ resource: { type: 'tool', id: 't1' } });
    expect(engine.evaluate(ctx).effect).toBe('deny');
  });

  it('appliesTo.subjects 匹配', () => {
    engine.createPolicy({
      ...makePolicy({
        appliesTo: { actions: ['*'], subjects: ['user'] },
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'exists', field: 'user.id' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    const ctx = makeContext({ agent: { id: 'a1', type: 'sub', depth: 1 } });
    expect(engine.evaluate(ctx).effect).toBe('deny'); // agent 主体不适用
  });

  it('appliesTo.resources 匹配', () => {
    engine.createPolicy({
      ...makePolicy({
        appliesTo: { actions: ['*'], resources: ['agent'] },
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'exists', field: 'user.id' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    const ctx = makeContext({ resource: { type: 'tool', id: 't1' } });
    expect(engine.evaluate(ctx).effect).toBe('deny');
  });

  it('appliesTo.conditions 额外条件', () => {
    engine.createPolicy({
      ...makePolicy({
        appliesTo: { actions: ['*'], conditions: [{ type: 'equals', field: 'environment.model', value: 'gpt-4' }] },
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'exists', field: 'user.id' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    const ctx = makeContext({ environment: { ...makeContext().environment, model: 'claude-3' } });
    expect(engine.evaluate(ctx).effect).toBe('deny');
  });
});

// ============ 缓存测试 ============

describe('PolicyEngine - 缓存', () => {
  it('缓存命中', () => {
    const engine = new PolicyEngine({ persist: false, enableCache: true });
    engine.createPolicy({
      ...makePolicy({
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'exists', field: 'user.id' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    const ctx = makeContext();
    engine.evaluate(ctx);
    const stats1 = engine.getCacheStats();
    expect(stats1.misses).toBe(1);
    engine.evaluate(ctx);
    const stats2 = engine.getCacheStats();
    expect(stats2.hits).toBe(1);
  });

  it('invalidateCache', () => {
    const engine = new PolicyEngine({ persist: false, enableCache: true });
    engine.createPolicy({
      ...makePolicy({
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'exists', field: 'user.id' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    const ctx = makeContext();
    engine.evaluate(ctx);
    engine.invalidateCache();
    expect(engine.getCacheStats().size).toBe(0);
  });

  it('禁用缓存', () => {
    const engine = new PolicyEngine({ persist: false, enableCache: false });
    engine.createPolicy({
      ...makePolicy({
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'exists', field: 'user.id' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    engine.evaluate(makeContext());
    expect(engine.getCacheStats().size).toBe(0);
  });
});

// ============ 测试系统测试 ============

describe('PolicyEngine - 测试系统', () => {
  let engine: PolicyEngine;
  beforeEach(() => {
    engine = new PolicyEngine({ persist: false, enableCache: false });
  });

  it('createTestCase', () => {
    const p = engine.createPolicy({ ...makePolicy(), id: undefined as any });
    const tc = engine.createTestCase(p.id, {
      name: 'Test 1',
      context: makeContext(),
      expectedEffect: 'allow',
    });
    expect(tc.id).toMatch(/^tc-/);
    expect(engine.listTestCases(p.id).length).toBe(1);
  });

  it('testPolicy 全部通过', () => {
    const p = engine.createPolicy({
      ...makePolicy({
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'equals', field: 'user.id', value: 'user-1' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    const result = engine.testPolicy(p.id, [
      { id: 't1', name: 'T1', context: makeContext(), expectedEffect: 'allow' },
    ]);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('testPolicy 部分失败', () => {
    const p = engine.createPolicy({
      ...makePolicy({
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'equals', field: 'user.id', value: 'user-1' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    const result = engine.testPolicy(p.id, [
      { id: 't1', name: 'T1', context: makeContext(), expectedEffect: 'allow' },
      { id: 't2', name: 'T2', context: makeContext(), expectedEffect: 'deny' },
    ]);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('testPolicy results 详细', () => {
    const p = engine.createPolicy({ ...makePolicy(), id: undefined as any });
    const result = engine.testPolicy(p.id, [
      { id: 't1', name: 'T1', context: makeContext(), expectedEffect: 'deny' },
    ]);
    expect(result.results.length).toBe(1);
    expect(result.results[0].passed).toBe(true);
  });
});

// ============ 指标测试 ============

describe('PolicyEngine - 指标', () => {
  let engine: PolicyEngine;
  beforeEach(() => {
    engine = new PolicyEngine({ persist: false, enableCache: false });
  });

  it('getMetrics 初始', () => {
    const m = engine.getMetrics();
    expect(m.totalEvaluations).toBe(0);
    expect(m.allowedCount).toBe(0);
    expect(m.deniedCount).toBe(0);
  });

  it('getMetrics 评估后', () => {
    engine.createPolicy({
      ...makePolicy({
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'exists', field: 'user.id' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    engine.evaluate(makeContext());
    engine.evaluate(makeContext());
    const m = engine.getMetrics();
    expect(m.totalEvaluations).toBe(2);
    expect(m.allowedCount).toBe(2);
    expect(m.activePolicies).toBe(1);
  });

  it('averageEvaluationMs 计算', () => {
    engine.evaluate(makeContext());
    const m = engine.getMetrics();
    expect(m.averageEvaluationMs).toBeGreaterThanOrEqual(0);
  });
});

// ============ 决策日志测试 ============

describe('PolicyEngine - 决策日志', () => {
  let engine: PolicyEngine;
  beforeEach(() => {
    engine = new PolicyEngine({ persist: false, enableCache: false });
  });

  it('记录决策日志', () => {
    engine.evaluate(makeContext());
    expect(engine.getDecisionLog().length).toBe(1);
  });

  it('getDecisionLog 按 effect 过滤', () => {
    engine.evaluate(makeContext());
    expect(engine.getDecisionLog({ effect: 'deny' }).length).toBe(1);
    expect(engine.getDecisionLog({ effect: 'allow' }).length).toBe(0);
  });

  it('getDecisionLog 按 userId 过滤', () => {
    engine.evaluate(makeContext());
    expect(engine.getDecisionLog({ userId: 'user-1' }).length).toBe(1);
    expect(engine.getDecisionLog({ userId: 'user-2' }).length).toBe(0);
  });

  it('getDecisionLog 按时间过滤', () => {
    engine.evaluate(makeContext());
    const now = Date.now();
    expect(engine.getDecisionLog({ from: now - 1000, to: now + 1000 }).length).toBe(1);
  });

  it('getDecisionLog 按 action 过滤', () => {
    engine.evaluate(makeContext({ action: 'llm.call' }));
    expect(engine.getDecisionLog({ action: 'llm.call' }).length).toBe(1);
  });

  it('禁用决策日志', () => {
    engine.updateConfig({ enableDecisionLog: false });
    engine.evaluate(makeContext());
    expect(engine.getDecisionLog().length).toBe(0);
  });
});

// ============ 审计集成测试 ============

describe('PolicyEngine - 审计集成', () => {
  it('setAuditTrailHook 接收评估事件', () => {
    const engine = new PolicyEngine({ persist: false, enableCache: false });
    const hook = vi.fn();
    engine.setAuditTrailHook(hook);
    engine.createPolicy({
      ...makePolicy({
        rules: [makeRule({ effect: 'allow', conditions: [{ type: 'exists', field: 'user.id' }] })],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    engine.evaluate(makeContext());
    expect(hook).toHaveBeenCalled();
  });
});

// ============ 事件订阅测试 ============

describe('PolicyEngine - 事件订阅', () => {
  let engine: PolicyEngine;
  beforeEach(() => {
    engine = new PolicyEngine({ persist: false, enableCache: false });
  });

  it('订阅 policy-created', () => {
    const listener = vi.fn();
    engine.on('policy-created', listener);
    engine.createPolicy({ ...makePolicy(), id: undefined as any });
    expect(listener).toHaveBeenCalled();
  });

  it('订阅 policy-updated', () => {
    const p = engine.createPolicy({ ...makePolicy(), id: undefined as any });
    const listener = vi.fn();
    engine.on('policy-updated', listener);
    engine.updatePolicy(p.id, { name: 'X' });
    expect(listener).toHaveBeenCalled();
  });

  it('订阅 policy-deleted', () => {
    const p = engine.createPolicy({ ...makePolicy(), id: undefined as any });
    const listener = vi.fn();
    engine.on('policy-deleted', listener);
    engine.deletePolicy(p.id);
    expect(listener).toHaveBeenCalled();
  });

  it('订阅 policy-activated', () => {
    const p = engine.createPolicy({ ...makePolicy({ status: 'draft' }), id: undefined as any });
    const listener = vi.fn();
    engine.on('policy-activated', listener);
    engine.activatePolicy(p.id);
    expect(listener).toHaveBeenCalled();
  });

  it('订阅 policy-evaluated', () => {
    const listener = vi.fn();
    engine.on('policy-evaluated', listener);
    engine.evaluate(makeContext());
    expect(listener).toHaveBeenCalled();
  });

  it('订阅 version-published', () => {
    const p = engine.createPolicy({ ...makePolicy(), id: undefined as any });
    const listener = vi.fn();
    engine.on('version-published', listener);
    engine.publishVersion(p.id, '2.0.0');
    expect(listener).toHaveBeenCalled();
  });

  it('订阅 test-completed', () => {
    const p = engine.createPolicy({ ...makePolicy(), id: undefined as any });
    const listener = vi.fn();
    engine.on('test-completed', listener);
    engine.testPolicy(p.id, []);
    expect(listener).toHaveBeenCalled();
  });

  it('退订', () => {
    const listener = vi.fn();
    const unsub = engine.on('policy-created', listener);
    unsub();
    engine.createPolicy({ ...makePolicy(), id: undefined as any });
    expect(listener).not.toHaveBeenCalled();
  });

  it('监听器抛错不影响其他监听器', () => {
    const goodListener = vi.fn();
    engine.on('policy-created', () => { throw new Error('Listener error'); });
    engine.on('policy-created', goodListener);
    expect(() => engine.createPolicy({ ...makePolicy(), id: undefined as any })).not.toThrow();
    expect(goodListener).toHaveBeenCalled();
  });
});

// ============ 清理测试 ============

describe('PolicyEngine - clear', () => {
  it('clear 清理所有状态', () => {
    const engine = new PolicyEngine({ persist: false, enableCache: false });
    engine.createPolicy({ ...makePolicy(), id: undefined as any });
    engine.evaluate(makeContext());
    engine.clear();
    expect(engine.getPolicy(engine.listPolicies()[0]?.id || '')).toBeUndefined();
    expect(engine.getDecisionLog().length).toBe(0);
  });
});

// ============ 单例测试 ============

describe('PolicyEngine - 全局单例', () => {
  it('getDefaultPolicyEngine 同一实例', () => {
    const e1 = getDefaultPolicyEngine();
    const e2 = getDefaultPolicyEngine();
    expect(e1).toBe(e2);
  });

  it('setDefaultPolicyEngine 替换', () => {
    const e = new PolicyEngine({ persist: false });
    setDefaultPolicyEngine(e);
    expect(getDefaultPolicyEngine()).toBe(e);
    setDefaultPolicyEngine(new PolicyEngine({ persist: false }));
  });
});

// ============ 集成场景测试 ============

describe('PolicyEngine - 集成场景', () => {
  it('管理员才能执行 admin.delete', () => {
    const engine = new PolicyEngine({ persist: false, enableCache: false });
    engine.createPolicy({
      ...makePolicy({
        name: 'Admin Only',
        priority: 800,
        appliesTo: { actions: ['admin.delete'] },
        rules: [
          makeRule({
            id: 'r1',
            effect: 'deny',
            conditions: [{ type: 'not-in', field: 'user.roles', values: ['admin'] }],
          }),
        ],
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });

    // 普通用户被拒
    const ctxUser = makeContext({ action: 'admin.delete', user: { ...makeContext().user, roles: ['developer'] } });
    expect(engine.evaluate(ctxUser).effect).toBe('deny');

    // 管理员通过
    const ctxAdmin = makeContext({ action: 'admin.delete', user: { ...makeContext().user, roles: ['admin'] } });
    expect(engine.evaluate(ctxAdmin).effect).toBe('allow');
  });

  it('成本超限被拒', () => {
    const engine = new PolicyEngine({ persist: false, enableCache: false });
    engine.applyTemplate('tpl-cost-limit', { maxDailyCost: 1.0 });
    const ctx = makeContext({ environment: { ...makeContext().environment, cost: 5.0 } });
    expect(engine.evaluate(ctx).effect).toBe('deny');
  });

  it('仅允许工作时间', () => {
    const engine = new PolicyEngine({ persist: false, enableCache: false });
    const p = engine.applyTemplate('tpl-time-window', { startHour: 9, endHour: 18 });
    engine.activatePolicy(p.id);
    const ts12 = new Date('2026-07-30T12:00:00Z').getTime();
    const ts20 = new Date('2026-07-30T20:00:00Z').getTime();
    const ctxWork = makeContext({ environment: { ...makeContext().environment, timestamp: ts12 } });
    const ctxAfter = makeContext({ environment: { ...makeContext().environment, timestamp: ts20 } });
    expect(engine.evaluate(ctxWork).effect).toBe('allow');
    expect(engine.evaluate(ctxAfter).effect).toBe('deny');
  });

  it('多策略 + 冲突解决', () => {
    const engine = new PolicyEngine({ persist: false, enableCache: false });
    engine.createPolicy({
      ...makePolicy({
        name: 'Cost Deny',
        priority: 100,
        rules: [makeRule({ effect: 'deny', conditions: [{ type: 'gt', field: 'environment.cost', value: 0.1 }] })],
        conflictResolution: 'deny-overrides',
      }),
      id: undefined as any,
    });
    engine.createPolicy({
      ...makePolicy({
        name: 'Default Allow',
        priority: 50,
        defaultEffect: 'allow',
      }),
      id: undefined as any,
    });
    const ctx = makeContext({ environment: { ...makeContext().environment, cost: 5.0 } });
    expect(engine.evaluate(ctx).effect).toBe('deny');
  });
});
