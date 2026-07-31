/**
 * Security Audit Engine 单元测试 (v1.0.0 Cycle 33 G33-03)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SecurityAuditEngine,
  PRESET_ATTACK_SCENARIOS,
  generateScenarioId,
  generateExecutionId,
  generateIncidentId,
  generateReportId,
  deepEqual,
  parseAction,
  type AttackScenario,
} from './securityAuditEngine';

// 辅助：创建基础场景
function makeScenario(overrides: Partial<AttackScenario> = {}): Omit<AttackScenario, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'test-scenario',
    description: 'Test scenario',
    category: 'authentication',
    severity: 'medium',
    version: '1.0.0',
    setup: [{ id: 's1', name: 'Setup', action: 'sso.createTestUser' }],
    attack: [{ id: 'a1', name: 'Attack', action: 'sso.ssoLogin', args: { wrongPassword: true } }],
    validation: [
      { id: 'v1', name: '账户已锁定', check: 'sso.isAccountLocked', expected: true },
      { id: 'v2', name: '审计告警', check: 'audit.hasEvent', expected: { matched: true, eventType: 'auth' } },
      { id: 'v3', name: '策略阻断', check: 'policy.isBlocked', expected: true },
    ],
    expectedOutcome: { blocked: true, alerted: true, audited: true },
    ...overrides,
  };
}

describe('SecurityAuditEngine - 工具函数', () => {
  it('generateScenarioId 生成 ID 含前缀', () => {
    const id = generateScenarioId('bruteforce login');
    expect(id).toMatch(/^atk-bruteforce-login-/);
  });

  it('generateExecutionId 生成唯一 ID', () => {
    const a = generateExecutionId();
    const b = generateExecutionId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^exec-/);
  });

  it('generateIncidentId 生成唯一 ID', () => {
    const a = generateIncidentId();
    const b = generateIncidentId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^inc-/);
  });

  it('generateReportId 生成唯一 ID', () => {
    const id = generateReportId();
    expect(id).toMatch(/^rpt-/);
  });

  it('deepEqual 深度比较基本类型', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual('a', 'b')).toBe(false);
  });

  it('deepEqual 深度比较数组', () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual([1, 2, 3], [1, 3, 2])).toBe(false);
  });

  it('deepEqual 深度比较对象', () => {
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('parseAction 解析 engineId.method', () => {
    const r = parseAction('sso.login');
    expect(r.engineId).toBe('sso');
    expect(r.method).toBe('login');
  });

  it('parseAction 解析单一方法', () => {
    const r = parseAction('myMethod');
    expect(r.engineId).toBeNull();
    expect(r.method).toBe('myMethod');
  });
});

describe('SecurityAuditEngine - 初始化', () => {
  it('默认构造自动注册内部 mock 引擎', () => {
    const engine = new SecurityAuditEngine({ persist: false }, { autoLoadPresets: false });
    const engines = engine.listEngines();
    expect(engines).toContain('sso');
    expect(engines).toContain('audit');
    expect(engines).toContain('policy');
  });

  it('不自动加载预置场景时场景数量为 0', () => {
    const engine = new SecurityAuditEngine({ persist: false }, { autoLoadPresets: false });
    expect(engine.listScenarios()).toHaveLength(0);
  });

  it('loadPresetScenarios 加载 7 个预置场景', () => {
    const engine = new SecurityAuditEngine({ persist: false }, { autoLoadPresets: false });
    const loaded = engine.loadPresetScenarios();
    expect(loaded).toBe(7);
    expect(engine.listScenarios()).toHaveLength(7);
  });

  it('PRESET_ATTACK_SCENARIOS 包含 7 个场景', () => {
    expect(PRESET_ATTACK_SCENARIOS).toHaveLength(7);
    const names = PRESET_ATTACK_SCENARIOS.map((s) => s.name);
    expect(names).toContain('bruteforce-login');
    expect(names).toContain('unauthorized-access');
    expect(names).toContain('data-exfiltration');
    expect(names).toContain('session-hijack');
    expect(names).toContain('privilege-escalation');
    expect(names).toContain('malicious-upload');
    expect(names).toContain('audit-tampering');
  });
});

describe('SecurityAuditEngine - 场景 CRUD', () => {
  let engine: SecurityAuditEngine;

  beforeEach(() => {
    engine = new SecurityAuditEngine({ persist: false }, { autoLoadPresets: false });
  });

  it('registerScenario 注册新场景', () => {
    const sc = engine.registerScenario(makeScenario());
    expect(sc.id).toMatch(/^atk-/);
    expect(sc.createdAt).toBeGreaterThan(0);
    expect(sc.updatedAt).toBeGreaterThan(0);
    expect(engine.getScenario(sc.id)).toBeDefined();
  });

  it('updateScenario 更新场景', () => {
    const sc = engine.registerScenario(makeScenario());
    const updated = engine.updateScenario(sc.id, { name: 'updated-name' });
    expect(updated.name).toBe('updated-name');
    expect(updated.id).toBe(sc.id);
    expect(updated.createdAt).toBe(sc.createdAt);
  });

  it('updateScenario 场景不存在抛出错误', () => {
    expect(() => engine.updateScenario('not-exists', {})).toThrow();
  });

  it('deleteScenario 删除场景', () => {
    const sc = engine.registerScenario(makeScenario());
    const result = engine.deleteScenario(sc.id);
    expect(result).toBe(true);
    expect(engine.getScenario(sc.id)).toBeUndefined();
  });

  it('deleteScenario 删除不存在的场景返回 false', () => {
    expect(engine.deleteScenario('not-exists')).toBe(false);
  });

  it('listScenarios 按 category 过滤', () => {
    engine.registerScenario(makeScenario({ name: 'a', category: 'authentication' }));
    engine.registerScenario(makeScenario({ name: 'b', category: 'authorization' }));
    const auth = engine.listScenarios({ category: 'authentication' });
    expect(auth).toHaveLength(1);
    expect(auth[0].name).toBe('a');
  });

  it('listScenarios 按 severity 过滤', () => {
    engine.registerScenario(makeScenario({ name: 'a', severity: 'low' }));
    engine.registerScenario(makeScenario({ name: 'b', severity: 'critical' }));
    const crit = engine.listScenarios({ severity: 'critical' });
    expect(crit).toHaveLength(1);
    expect(crit[0].name).toBe('b');
  });
});

describe('SecurityAuditEngine - 场景执行', () => {
  let engine: SecurityAuditEngine;

  beforeEach(() => {
    engine = new SecurityAuditEngine({ persist: false, stepTimeoutMs: 1000 }, { autoLoadPresets: false });
  });

  it('execute 成功执行场景（验证全部通过）', async () => {
    const sc = engine.registerScenario(makeScenario());
    const exec = await engine.execute(sc.id);
    expect(exec.status).toBe('completed');
    expect(exec.steps.length).toBe(2); // setup + attack
    expect(exec.validations.length).toBe(3);
    expect(exec.validations.every((v) => v.passed)).toBe(true);
    expect(exec.outcome.blocked).toBe(true);
    expect(exec.outcome.alerted).toBe(true);
    expect(exec.outcome.audited).toBe(true);
  });

  it('execute 验证失败时 status 为 failed', async () => {
    const sc = engine.registerScenario(
      makeScenario({
        validation: [
          { id: 'v1', name: '阻断', check: 'policy.isBlocked', expected: true },
          { id: 'v2', name: '告警失败', check: 'audit.hasNonExistMethod', expected: { matched: true } },
        ],
      }),
    );
    const exec = await engine.execute(sc.id);
    expect(exec.status).toBe('failed');
    expect(exec.validations.filter((v) => v.passed).length).toBe(1);
  });

  it('execute dryRun 模式不执行真实步骤', async () => {
    const sc = engine.registerScenario(makeScenario());
    const exec = await engine.execute(sc.id, { dryRun: true });
    expect(exec.dryRun).toBe(true);
    // dryRun 模式步骤 output 为 { dryRun: true }
    expect(exec.steps[0].output).toEqual({ dryRun: true });
  });

  it('execute 步骤超时', async () => {
    engine.registerEngine('slow', {
      slow: () => new Promise((resolve) => setTimeout(() => resolve('done'), 2000)),
    });
    const sc = engine.registerScenario(
      makeScenario({
        attack: [{ id: 'a1', name: 'Slow', action: 'slow.slow' }],
      }),
    );
    const exec = await engine.execute(sc.id);
    const attackStep = exec.steps.find((s) => s.action === 'slow.slow');
    expect(attackStep?.status).toBe('failure');
    expect(attackStep?.error).toContain('timed out');
  });

  it('execute 执行不存在的方法', async () => {
    const sc = engine.registerScenario(
      makeScenario({
        attack: [{ id: 'a1', name: 'Bad', action: 'sso.nonExist' }],
      }),
    );
    const exec = await engine.execute(sc.id);
    const step = exec.steps.find((s) => s.action === 'sso.nonExist');
    expect(step?.status).toBe('failure');
    expect(step?.error).toContain('not found');
  });

  it('execute 不存在的引擎', async () => {
    const sc = engine.registerScenario(
      makeScenario({
        attack: [{ id: 'a1', name: 'No Engine', action: 'unknownEngine.someMethod' }],
      }),
    );
    const exec = await engine.execute(sc.id);
    const step = exec.steps.find((s) => s.action === 'unknownEngine.someMethod');
    expect(step?.status).toBe('failure');
  });

  it('execute 设置持续时间', async () => {
    const sc = engine.registerScenario(makeScenario());
    const exec = await engine.execute(sc.id);
    expect(exec.endTime).toBeDefined();
    expect(exec.endTime).toBeGreaterThanOrEqual(exec.startTime);
  });

  it('execute repeat 多次执行攻击步骤', async () => {
    let callCount = 0;
    engine.registerEngine('counter', {
      increment: () => { callCount++; return callCount; },
    });
    const sc = engine.registerScenario(
      makeScenario({
        attack: [{ id: 'a1', name: 'Counter', action: 'counter.increment', repeat: 5 }],
      }),
    );
    const exec = await engine.execute(sc.id);
    expect(callCount).toBe(5);
    const attackStep = exec.steps.find((s) => s.action === 'counter.increment');
    expect(Array.isArray(attackStep?.output)).toBe(true);
    expect((attackStep?.output as any[]).length).toBe(5);
  });

  it('execute 不存在的场景抛出错误', async () => {
    await expect(engine.execute('not-exists')).rejects.toThrow();
  });
});

describe('SecurityAuditEngine - 验证逻辑', () => {
  let engine: SecurityAuditEngine;

  beforeEach(() => {
    engine = new SecurityAuditEngine({ persist: false }, { autoLoadPresets: false });
  });

  it('验证成功时 passed = true', async () => {
    const sc = engine.registerScenario(
      makeScenario({
        validation: [{ id: 'v1', name: '测试', check: 'sso.isAccountLocked', expected: true }],
      }),
    );
    const exec = await engine.execute(sc.id);
    expect(exec.validations[0].passed).toBe(true);
  });

  it('验证失败时 passed = false', async () => {
    const sc = engine.registerScenario(
      makeScenario({
        validation: [{ id: 'v1', name: '测试', check: 'sso.isAccountLocked', expected: false }],
      }),
    );
    const exec = await engine.execute(sc.id);
    expect(exec.validations[0].passed).toBe(false);
  });

  it('验证对象类型 deepEqual 比较', async () => {
    const sc = engine.registerScenario(
      makeScenario({
        validation: [
          { id: 'v1', name: '告警', check: 'audit.hasEvent', expected: { matched: true, eventType: 'auth' } },
        ],
      }),
    );
    const exec = await engine.execute(sc.id);
    expect(exec.validations[0].passed).toBe(true);
    expect(exec.validations[0].actual).toEqual({ matched: true, eventType: 'auth' });
  });

  it('outcome 评估 - 阻断类验证全部通过', async () => {
    const sc = engine.registerScenario(
      makeScenario({
        validation: [
          { id: 'v1', name: '阻断', check: 'policy.isBlocked', expected: true },
          { id: 'v2', name: '拦截', check: 'upload.wasBlocked', expected: true },
        ],
      }),
    );
    const exec = await engine.execute(sc.id);
    expect(exec.outcome.blocked).toBe(true);
  });

  it('outcome 评估 - 告警类验证全部通过', async () => {
    const sc = engine.registerScenario(
      makeScenario({
        validation: [{ id: 'v1', name: '告警', check: 'audit.hasEvent', expected: { matched: true } }],
      }),
    );
    const exec = await engine.execute(sc.id);
    expect(exec.outcome.alerted).toBe(true);
  });

  it('outcome 评估 - 审计类验证全部通过', async () => {
    const sc = engine.registerScenario(
      makeScenario({
        validation: [{ id: 'v1', name: '审计', check: 'audit.hasEvent', expected: { matched: true } }],
      }),
    );
    const exec = await engine.execute(sc.id);
    expect(exec.outcome.audited).toBe(true);
  });
});

describe('SecurityAuditEngine - 应急响应', () => {
  let engine: SecurityAuditEngine;

  beforeEach(() => {
    engine = new SecurityAuditEngine({ persist: false, stepTimeoutMs: 1000 }, { autoLoadPresets: false });
  });

  it('triggerResponse 启动应急响应', async () => {
    const sc = engine.registerScenario(makeScenario());
    const exec = await engine.execute(sc.id);
    const incident = await engine.triggerResponse(sc.id, exec.id);
    expect(incident.id).toMatch(/^inc-/);
    expect(incident.scenarioId).toBe(sc.id);
    expect(incident.executionId).toBe(exec.id);
    expect(incident.status).toBe('closed');
    expect(incident.steps.length).toBe(5);
    expect(incident.steps.every((s) => s.status === 'completed')).toBe(true);
  });

  it('triggerResponse 不存在的 scenario 抛出错误', async () => {
    const sc = engine.registerScenario(makeScenario());
    const exec = await engine.execute(sc.id);
    await expect(engine.triggerResponse('not-exists', exec.id)).rejects.toThrow();
  });

  it('triggerResponse 不存在的 execution 抛出错误', async () => {
    const sc = engine.registerScenario(makeScenario());
    await expect(engine.triggerResponse(sc.id, 'not-exists')).rejects.toThrow();
  });

  it('listActiveIncidents 列出未关闭事件', async () => {
    const sc = engine.registerScenario(makeScenario());
    const exec = await engine.execute(sc.id);
    const incident = await engine.triggerResponse(sc.id, exec.id);
    // triggerResponse 完成后 status = closed，因此 listActiveIncidents 为空
    expect(engine.listActiveIncidents()).toHaveLength(0);
    expect(incident.status).toBe('closed');
  });

  it('closeIncident 关闭事件', async () => {
    const sc = engine.registerScenario(makeScenario());
    const exec = await engine.execute(sc.id);
    const incident = await engine.triggerResponse(sc.id, exec.id);
    const closed = engine.closeIncident(incident.id, 'manual close');
    expect(closed?.status).toBe('closed');
    expect(closed?.notes).toBe('manual close');
  });

  it('getIncident 获取事件', async () => {
    const sc = engine.registerScenario(makeScenario());
    const exec = await engine.execute(sc.id);
    const incident = await engine.triggerResponse(sc.id, exec.id);
    expect(engine.getIncident(incident.id)?.id).toBe(incident.id);
  });

  it('listIncidents 列出所有事件', async () => {
    const sc = engine.registerScenario(makeScenario());
    const exec = await engine.execute(sc.id);
    await engine.triggerResponse(sc.id, exec.id);
    expect(engine.listIncidents().length).toBe(1);
  });
});

describe('SecurityAuditEngine - 报告生成', () => {
  let engine: SecurityAuditEngine;

  beforeEach(() => {
    engine = new SecurityAuditEngine({ persist: false }, { autoLoadPresets: false });
  });

  it('generateReport 包含基本字段', async () => {
    const sc = engine.registerScenario(makeScenario());
    await engine.execute(sc.id);
    const now = Date.now();
    const report = engine.generateReport({ from: now - 60000, to: now + 1000 });
    expect(report.id).toMatch(/^rpt-/);
    expect(report.totalScenarios).toBe(1);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.summary.blockedAttacks).toBe(1);
  });

  it('generateReport 包含合规字段', async () => {
    const sc = engine.registerScenario(makeScenario());
    await engine.execute(sc.id);
    const now = Date.now();
    const report = engine.generateReport({ from: now - 60000, to: now + 1000 });
    expect(report.compliance.soc2).toBe(true);
    expect(report.compliance.gdpr).toBe(true);
    expect(report.compliance.iso27001).toBe(true);
  });

  it('generateReport 失败时合规为 false', async () => {
    const sc = engine.registerScenario(
      makeScenario({
        validation: [
          { id: 'v1', name: '阻断', check: 'policy.isBlocked', expected: false },
        ],
      }),
    );
    await engine.execute(sc.id);
    const now = Date.now();
    const report = engine.generateReport({ from: now - 60000, to: now + 1000 });
    expect(report.failed).toBe(1);
    expect(report.compliance.soc2).toBe(false);
  });

  it('generateReport 包含建议', async () => {
    const sc = engine.registerScenario(
      makeScenario({
        validation: [
          { id: 'v1', name: '阻断', check: 'policy.isBlocked', expected: false },
        ],
      }),
    );
    await engine.execute(sc.id);
    const now = Date.now();
    const report = engine.generateReport({ from: now - 60000, to: now + 1000 });
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it('exportReport JSON 格式', async () => {
    const sc = engine.registerScenario(makeScenario());
    await engine.execute(sc.id);
    const now = Date.now();
    const json = engine.exportReport({ from: now - 60000, to: now + 1000 }, 'json');
    const parsed = JSON.parse(json);
    expect(parsed.id).toMatch(/^rpt-/);
  });

  it('exportReport Markdown 格式', async () => {
    const sc = engine.registerScenario(makeScenario());
    await engine.execute(sc.id);
    const now = Date.now();
    const md = engine.exportReport({ from: now - 60000, to: now + 1000 }, 'markdown');
    expect(md).toContain('# 安全审计报告');
    expect(md).toContain('## 汇总');
    expect(md).toContain('## 合规');
  });

  it('exportReport HTML 格式', async () => {
    const sc = engine.registerScenario(makeScenario());
    await engine.execute(sc.id);
    const now = Date.now();
    const html = engine.exportReport({ from: now - 60000, to: now + 1000 }, 'html');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('安全审计报告');
  });
});

describe('SecurityAuditEngine - CI/CD 集成', () => {
  let engine: SecurityAuditEngine;

  beforeEach(() => {
    engine = new SecurityAuditEngine({ persist: false }, { autoLoadPresets: false });
  });

  it('runInCI 执行指定场景', async () => {
    const sc1 = engine.registerScenario(makeScenario({ name: 'a' }));
    const sc2 = engine.registerScenario(makeScenario({ name: 'b' }));
    const result = await engine.runInCI([sc1.id, sc2.id]);
    expect(result.total).toBe(2);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.exitCode).toBe(0);
  });

  it('runInCI 默认执行所有场景', async () => {
    engine.loadPresetScenarios();
    const result = await engine.runInCI();
    expect(result.total).toBe(7);
    expect(result.exitCode).toBe(0);
  });

  it('runInCI 失败时 exitCode = 1', async () => {
    const sc = engine.registerScenario(
      makeScenario({
        validation: [
          { id: 'v1', name: '阻断', check: 'policy.isBlocked', expected: false },
        ],
      }),
    );
    const result = await engine.runInCI([sc.id]);
    expect(result.failed).toBe(1);
    expect(result.exitCode).toBe(1);
  });
});

describe('SecurityAuditEngine - 状态查询', () => {
  let engine: SecurityAuditEngine;

  beforeEach(() => {
    engine = new SecurityAuditEngine({ persist: false }, { autoLoadPresets: false });
  });

  it('getExecution 获取执行记录', async () => {
    const sc = engine.registerScenario(makeScenario());
    const exec = await engine.execute(sc.id);
    expect(engine.getExecution(exec.id)?.id).toBe(exec.id);
  });

  it('listExecutions 按 scenarioId 过滤', async () => {
    const sc1 = engine.registerScenario(makeScenario({ name: 'a' }));
    const sc2 = engine.registerScenario(makeScenario({ name: 'b' }));
    await engine.execute(sc1.id);
    await engine.execute(sc2.id);
    const list = engine.listExecutions({ scenarioId: sc1.id });
    expect(list).toHaveLength(1);
  });

  it('listExecutions 按 status 过滤', async () => {
    const sc = engine.registerScenario(makeScenario());
    await engine.execute(sc.id);
    const list = engine.listExecutions({ status: 'completed' });
    expect(list.length).toBeGreaterThan(0);
  });

  it('cancel 取消执行', async () => {
    const sc = engine.registerScenario(makeScenario());
    const exec = await engine.execute(sc.id);
    // 执行已完成，cancel 无效
    const result = engine.cancel(exec.id);
    expect(result?.status).toBe('completed');
  });
});

describe('SecurityAuditEngine - 事件订阅', () => {
  let engine: SecurityAuditEngine;

  beforeEach(() => {
    engine = new SecurityAuditEngine({ persist: false }, { autoLoadPresets: false });
  });

  it('订阅 scenario-registered 事件', () => {
    const events: any[] = [];
    engine.on('scenario-registered', (e) => events.push(e));
    engine.registerScenario(makeScenario());
    expect(events.length).toBe(1);
    expect(events[0].scenario.id).toMatch(/^atk-/);
  });

  it('订阅 execution-started 事件', async () => {
    const events: any[] = [];
    engine.on('execution-started', (e) => events.push(e));
    const sc = engine.registerScenario(makeScenario());
    await engine.execute(sc.id);
    expect(events.length).toBe(1);
  });

  it('订阅 validation-passed 事件', async () => {
    const events: any[] = [];
    engine.on('validation-passed', (e) => events.push(e));
    const sc = engine.registerScenario(makeScenario());
    await engine.execute(sc.id);
    expect(events.length).toBe(3);
  });

  it('订阅 validation-failed 事件', async () => {
    const events: any[] = [];
    engine.on('validation-failed', (e) => events.push(e));
    const sc = engine.registerScenario(
      makeScenario({
        validation: [
          { id: 'v1', name: '阻断', check: 'policy.isBlocked', expected: false },
        ],
      }),
    );
    await engine.execute(sc.id);
    expect(events.length).toBe(1);
  });

  it('订阅 incident-detected 事件', async () => {
    const events: any[] = [];
    engine.on('incident-detected', (e) => events.push(e));
    const sc = engine.registerScenario(makeScenario());
    const exec = await engine.execute(sc.id);
    await engine.triggerResponse(sc.id, exec.id);
    expect(events.length).toBe(1);
  });

  it('off 取消订阅', () => {
    const events: any[] = [];
    const listener = (e: any) => events.push(e);
    engine.on('scenario-registered', listener);
    engine.off('scenario-registered', listener);
    engine.registerScenario(makeScenario());
    expect(events.length).toBe(0);
  });
});

describe('SecurityAuditEngine - 引擎注册', () => {
  let engine: SecurityAuditEngine;

  beforeEach(() => {
    engine = new SecurityAuditEngine({ persist: false }, { autoLoadPresets: false });
  });

  it('registerEngine 注册新方法', () => {
    engine.registerEngine('custom', { myMethod: () => 'hello' });
    expect(engine.listEngines()).toContain('custom');
  });

  it('unregisterEngine 注销引擎', () => {
    engine.registerEngine('temp', { foo: () => 'bar' });
    const result = engine.unregisterEngine('temp');
    expect(result).toBe(true);
    expect(engine.listEngines()).not.toContain('temp');
  });

  it('注册新方法后可在场景中使用', async () => {
    engine.registerEngine('custom', { myMethod: () => 'result' });
    const sc = engine.registerScenario(
      makeScenario({
        attack: [{ id: 'a1', name: 'Use', action: 'custom.myMethod' }],
        validation: [{ id: 'v1', name: 'Check', check: 'custom.myMethod', expected: 'result' }],
      }),
    );
    const exec = await engine.execute(sc.id);
    expect(exec.status).toBe('completed');
  });
});

describe('SecurityAuditEngine - 7 个预置场景', () => {
  let engine: SecurityAuditEngine;

  beforeEach(() => {
    engine = new SecurityAuditEngine({ persist: false, stepTimeoutMs: 2000 }, { autoLoadPresets: false });
    engine.loadPresetScenarios();
  });

  it('bruteforce-login 通过', async () => {
    const sc = engine.listScenarios().find((s) => s.name === 'bruteforce-login');
    expect(sc).toBeDefined();
    const exec = await engine.execute(sc!.id);
    expect(exec.status).toBe('completed');
    expect(exec.outcome.blocked).toBe(true);
  });

  it('unauthorized-access 通过', async () => {
    const sc = engine.listScenarios().find((s) => s.name === 'unauthorized-access');
    const exec = await engine.execute(sc!.id);
    expect(exec.status).toBe('completed');
  });

  it('data-exfiltration 通过', async () => {
    const sc = engine.listScenarios().find((s) => s.name === 'data-exfiltration');
    const exec = await engine.execute(sc!.id);
    expect(exec.status).toBe('completed');
  });

  it('session-hijack 通过', async () => {
    const sc = engine.listScenarios().find((s) => s.name === 'session-hijack');
    const exec = await engine.execute(sc!.id);
    expect(exec.status).toBe('completed');
  });

  it('privilege-escalation 通过', async () => {
    const sc = engine.listScenarios().find((s) => s.name === 'privilege-escalation');
    const exec = await engine.execute(sc!.id);
    expect(exec.status).toBe('completed');
  });

  it('malicious-upload 通过', async () => {
    const sc = engine.listScenarios().find((s) => s.name === 'malicious-upload');
    const exec = await engine.execute(sc!.id);
    expect(exec.status).toBe('completed');
  });

  it('audit-tampering 通过', async () => {
    const sc = engine.listScenarios().find((s) => s.name === 'audit-tampering');
    const exec = await engine.execute(sc!.id);
    expect(exec.status).toBe('completed');
  });

  it('executeAll 批量执行 7 个预置场景', async () => {
    const executions = await engine.executeAll();
    expect(executions).toHaveLength(7);
    expect(executions.every((e) => e.status === 'completed')).toBe(true);
  });
});

describe('SecurityAuditEngine - 统计', () => {
  let engine: SecurityAuditEngine;

  beforeEach(() => {
    engine = new SecurityAuditEngine({ persist: false }, { autoLoadPresets: false });
  });

  it('getStats 返回基本统计', () => {
    const stats = engine.getStats();
    expect(stats.totalScenarios).toBe(0);
    expect(stats.totalExecutions).toBe(0);
    expect(stats.passed).toBe(0);
    expect(stats.failed).toBe(0);
  });

  it('getStats 包含事件数', async () => {
    const sc = engine.registerScenario(makeScenario());
    const exec = await engine.execute(sc.id);
    await engine.triggerResponse(sc.id, exec.id);
    const stats = engine.getStats();
    expect(stats.totalScenarios).toBe(1);
    expect(stats.totalExecutions).toBe(1);
    expect(stats.passed).toBe(1);
    expect(stats.totalIncidents).toBe(1);
  });

  it('getStats 失败计数', async () => {
    const sc = engine.registerScenario(
      makeScenario({
        validation: [
          { id: 'v1', name: '阻断', check: 'policy.isBlocked', expected: false },
        ],
      }),
    );
    await engine.execute(sc.id);
    const stats = engine.getStats();
    expect(stats.failed).toBe(1);
  });
});

describe('SecurityAuditEngine - 单例与持久化', () => {
  it('同一实例多次创建独立', () => {
    const e1 = new SecurityAuditEngine({ persist: false }, { autoLoadPresets: false });
    const e2 = new SecurityAuditEngine({ persist: false }, { autoLoadPresets: false });
    e1.registerScenario(makeScenario({ name: 'a' }));
    expect(e2.listScenarios()).toHaveLength(0);
  });

  it('持久化后再次创建可读取场景', () => {
    if (typeof localStorage === 'undefined') {
      // 跳过持久化测试
      return;
    }
    localStorage.clear();
    const e1 = new SecurityAuditEngine({ persist: true }, { autoLoadPresets: false });
    e1.registerScenario(makeScenario({ name: 'persist-test' }));
    // 重新创建实例（注意 mock 引擎也会被重新注册）
    const e2 = new SecurityAuditEngine({ persist: true }, { autoLoadPresets: false });
    const sc = e2.listScenarios().find((s) => s.name === 'persist-test');
    expect(sc).toBeDefined();
    localStorage.clear();
  });
});
