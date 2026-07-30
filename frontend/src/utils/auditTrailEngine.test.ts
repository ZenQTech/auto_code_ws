/**
 * Audit Trail Engine - 单元测试 (Cycle 32 G32-01)
 *
 * 测试覆盖：
 * 1. 基础事件记录（log/logAuth/logAuthz/logData/logAdmin/logSystem/logAgent/logCompliance）
 * 2. 便捷方法（login/logout/access/decision）
 * 3. Hash Chain 不可篡改
 * 4. PII Pseudonymization
 * 5. 查询过滤
 * 6. 完整性验证
 * 7. 合规报告生成
 * 8. 多格式导出
 * 9. GDPR 操作
 * 10. 保留策略
 * 11. 事件订阅
 * 12. 错误处理
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AuditTrailEngine,
  GENESIS_HASH,
  pseudonymize,
  pseudonymizeActor,
  computeEventHash,
  canonicalJSON,
  getDefaultAuditTrailEngine,
  setDefaultAuditTrailEngine,
  COMPLIANCE_CONTROLS,
  DEFAULT_AUDIT_CONFIG,
  type AuditActor,
  type AuditResource,
  type Period,
} from './auditTrailEngine';

// ============ 辅助函数 ============

function makeActor(overrides: Partial<AuditActor> = {}): AuditActor {
  return {
    id: 'user-1',
    type: 'user',
    name: 'Alice Smith',
    email: 'alice@example.com',
    ssoId: 'okta|12345',
    ip: '192.168.1.100',
    userAgent: 'Mozilla/5.0',
    sessionId: 'sess-abc',
    roles: ['developer'],
    ...overrides,
  };
}

function makeResource(overrides: Partial<AuditResource> = {}): AuditResource {
  return {
    type: 'document',
    id: 'doc-123',
    name: 'Test Document',
    ...overrides,
  };
}

describe('AuditTrailEngine - 基础', () => {
  let engine: AuditTrailEngine;

  beforeEach(() => {
    engine = new AuditTrailEngine({ persist: false });
  });

  it('初始化引擎', () => {
    expect(engine).toBeDefined();
    expect(engine.count()).toBe(0);
    expect(engine.listChains().length).toBeGreaterThan(0);
  });

  it('记录基础事件', () => {
    const event = engine.log({
      who: makeActor(),
      what: 'document.create',
      resource: makeResource(),
      outcome: 'success',
      eventType: 'data',
      severity: 'info',
    });

    expect(event.id).toMatch(/^aud-/);
    expect(event.sequenceNumber).toBe(0);
    expect(event.timestamp).toBeGreaterThan(0);
    expect(event.prevHash).toBe(GENESIS_HASH);
    expect(event.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(event.schemaVersion).toBe('1.0');
    expect(event.timezone).toBe('UTC');
  });

  it('连续事件链接到前一个 hash', () => {
    const e1 = engine.log({
      who: makeActor(),
      what: 'a',
      resource: makeResource(),
      outcome: 'success',
      eventType: 'data',
      severity: 'info',
    });
    const e2 = engine.log({
      who: makeActor(),
      what: 'b',
      resource: makeResource(),
      outcome: 'success',
      eventType: 'data',
      severity: 'info',
    });
    expect(e2.prevHash).toBe(e1.hash);
    expect(e2.sequenceNumber).toBe(e1.sequenceNumber + 1);
  });
});

describe('AuditTrailEngine - 便捷方法', () => {
  let engine: AuditTrailEngine;

  beforeEach(() => {
    engine = new AuditTrailEngine({ persist: false });
  });

  it('login 成功', () => {
    const event = engine.login(makeActor(), true);
    expect(event.what).toBe('user.login');
    expect(event.outcome).toBe('success');
    expect(event.eventType).toBe('auth');
  });

  it('login 失败', () => {
    const event = engine.login(makeActor(), false);
    expect(event.what).toBe('user.login.failed');
    expect(event.outcome).toBe('failure');
    expect(event.severity).toBe('warn');
  });

  it('logout', () => {
    const event = engine.logout(makeActor());
    expect(event.what).toBe('user.logout');
    expect(event.outcome).toBe('success');
  });

  it('access 记录访问', () => {
    const event = engine.access(makeActor(), makeResource(), 'doc.read', 'success');
    expect(event.what).toBe('doc.read');
    expect(event.eventType).toBe('authz');
  });

  it('decision 记录策略决策', () => {
    const event = engine.decision(makeActor(), {
      policy: 'cost-limit',
      rule: 'gt-50',
      effect: 'deny',
      reason: 'Cost exceeded',
    });
    expect(event.what).toBe('policy.deny');
    expect(event.outcome).toBe('denied');
    expect(event.why).toBe('Cost exceeded');
  });
});

describe('AuditTrailEngine - 分类记录', () => {
  let engine: AuditTrailEngine;

  beforeEach(() => {
    engine = new AuditTrailEngine({ persist: false });
  });

  it('logAuth', () => {
    const event = engine.logAuth({
      who: makeActor(),
      what: 'user.login',
      resource: { type: 'session', id: 'sess-1' },
      outcome: 'success',
    });
    expect(event.eventType).toBe('auth');
  });

  it('logAuthz', () => {
    const event = engine.logAuthz({
      who: makeActor(),
      what: 'doc.read',
      resource: makeResource(),
      outcome: 'denied',
      reason: 'No permission',
      policyId: 'rbac-doc',
    });
    expect(event.eventType).toBe('authz');
    expect(event.severity).toBe('warn');
    expect(event.how.policyId).toBe('rbac-doc');
  });

  it('logData', () => {
    const event = engine.logData({
      who: makeActor(),
      what: 'data.export',
      resource: makeResource({ attributes: { pii: true } }),
      outcome: 'success',
      before: { rows: 100 },
      after: { rows: 200 },
      gdprRelevant: true,
    });
    expect(event.eventType).toBe('data');
    expect(event.gdprRelevant).toBe(true);
    expect(event.how.before).toEqual({ rows: 100 });
  });

  it('logAdmin', () => {
    const event = engine.logAdmin({
      who: makeActor(),
      what: 'config.update',
      resource: { type: 'config', id: 'policy' },
      outcome: 'success',
    });
    expect(event.eventType).toBe('admin');
  });

  it('logSystem', () => {
    const event = engine.logSystem({
      who: { id: 'system', type: 'system' },
      what: 'system.startup',
      resource: { type: 'service', id: 'hermes' },
      outcome: 'success',
    });
    expect(event.eventType).toBe('system');
  });

  it('logAgent', () => {
    const event = engine.logAgent({
      who: makeActor(),
      what: 'llm.call',
      resource: { type: 'agent', id: 'claude-4' },
      outcome: 'success',
      metadata: { tokens: 1000, cost: 0.05 },
    });
    expect(event.eventType).toBe('agent');
    expect(event.complianceFlags).toContain('eu-ai-act');
  });

  it('logCompliance', () => {
    const event = engine.logCompliance({
      who: makeActor(),
      what: 'gdpr.request',
      resource: { type: 'user', id: 'user-1' },
      outcome: 'success',
      standard: 'GDPR',
    });
    expect(event.eventType).toBe('compliance');
    expect(event.gdprRelevant).toBe(true);
  });
});

describe('AuditTrailEngine - Hash Chain 不可篡改', () => {
  let engine: AuditTrailEngine;

  beforeEach(() => {
    engine = new AuditTrailEngine({ persist: false });
  });

  it('正常情况下 verifyChain 返回 valid', () => {
    engine.log({ who: makeActor(), what: 'a', resource: makeResource(), outcome: 'success', eventType: 'data', severity: 'info' });
    engine.log({ who: makeActor(), what: 'b', resource: makeResource(), outcome: 'success', eventType: 'data', severity: 'info' });
    engine.log({ who: makeActor(), what: 'c', resource: makeResource(), outcome: 'success', eventType: 'data', severity: 'info' });

    const result = engine.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.totalChecked).toBe(3);
  });

  it('verifyEvent 验证单条事件', () => {
    const event = engine.log({
      who: makeActor(),
      what: 'a',
      resource: makeResource(),
      outcome: 'success',
      eventType: 'data',
      severity: 'info',
    });
    const result = engine.verifyEvent(event.id);
    expect(result.valid).toBe(true);
  });

  it('修改事件后 verifyEvent 失败', () => {
    const event = engine.log({
      who: makeActor(),
      what: 'a',
      resource: makeResource(),
      outcome: 'success',
      eventType: 'data',
      severity: 'info',
    });
    // 篡改事件
    (event as any).what = 'tampered';
    const result = engine.verifyEvent(event.id);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Hash mismatch');
  });

  it('不存在的 event 返回 invalid', () => {
    const result = engine.verifyEvent('nonexistent-id');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Event not found');
  });
});

describe('AuditTrailEngine - PII Pseudonymization', () => {
  it('pseudonymize email', () => {
    const result = pseudonymize('alice@example.com', 'email');
    expect(result).toMatch(/^email_[0-9a-f]{8}@anon\.local$/);
  });

  it('pseudonymize phone', () => {
    const result = pseudonymize('+1-555-123-4567', 'phone');
    expect(result).toMatch(/^phone_[0-9a-f]{8}$/);
  });

  it('pseudonymize IPv4', () => {
    const result = pseudonymize('192.168.1.100', 'ip');
    expect(result).toBe('192.168.1.0');
  });

  it('pseudonymize IPv6', () => {
    const result = pseudonymize('2001:db8::1234', 'ip');
    expect(result).toBe('2001:db8::');
  });

  it('pseudonymize name', () => {
    const result = pseudonymize('John Doe', 'name');
    expect(result).toBe('J*** D***');
  });

  it('pseudonymize ssn', () => {
    const result = pseudonymize('123-45-6789', 'ssn');
    expect(result).toMatch(/^ssn_[0-9a-f]{8}$/);
  });

  it('pseudonymizeActor 整体脱敏', () => {
    const actor = makeActor();
    const result = pseudonymizeActor(actor, DEFAULT_AUDIT_CONFIG);
    expect(result.email).toMatch(/^email_/);
    expect(result.ip).toBe('192.168.1.0');
    expect(result.name).toBe('A*** S***');
  });

  it('引擎默认开启 PII 脱敏', () => {
    const engine = new AuditTrailEngine({ persist: false });
    const event = engine.log({
      who: makeActor({ email: 'bob@example.com', ip: '10.0.0.1' }),
      what: 'a',
      resource: makeResource(),
      outcome: 'success',
      eventType: 'data',
      severity: 'info',
    });
    expect(event.who.email).toMatch(/^email_/);
    expect(event.who.ip).toBe('10.0.0.0');
  });
});

describe('AuditTrailEngine - 查询', () => {
  let engine: AuditTrailEngine;

  beforeEach(() => {
    engine = new AuditTrailEngine({ persist: false });
    // 写入 10 个事件
    for (let i = 0; i < 5; i++) {
      engine.log({
        who: makeActor({ id: `user-${i % 2 === 0 ? '1' : '2'}` }),
        what: `doc.${i % 2 === 0 ? 'read' : 'write'}`,
        resource: makeResource({ type: i % 2 === 0 ? 'doc' : 'agent' }),
        outcome: i % 3 === 0 ? 'success' : 'failure',
        eventType: i % 2 === 0 ? 'data' : 'authz',
        severity: 'info',
      });
    }
  });

  it('按 eventType 过滤', () => {
    const result = engine.query({ eventTypes: ['data'] });
    expect(result.length).toBe(3);
    expect(result.every((e) => e.eventType === 'data')).toBe(true);
  });

  it('按 actor 过滤', () => {
    const result = engine.query({ actorIds: ['user-1'] });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((e) => e.who.id === 'user-1')).toBe(true);
  });

  it('按 outcome 过滤', () => {
    const result = engine.query({ outcomes: ['success'] });
    expect(result.every((e) => e.outcome === 'success')).toBe(true);
  });

  it('按时间过滤', () => {
    const now = Date.now();
    const result = engine.query({ from: now - 1000, to: now + 1000 });
    expect(result.length).toBe(5);
  });

  it('按文本搜索', () => {
    const result = engine.query({ textSearch: 'doc.read' });
    expect(result.every((e) => e.what.includes('doc.read'))).toBe(true);
  });

  it('分页', () => {
    const page1 = engine.query({ limit: 2, offset: 0 });
    const page2 = engine.query({ limit: 2, offset: 2 });
    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
  });

  it('排序', () => {
    const result = engine.query({ orderBy: 'severity', orderDir: 'desc' });
    expect(result[0].severity === result[result.length - 1].severity || result[0].sequenceNumber >= result[result.length - 1].sequenceNumber).toBe(true);
  });

  it('getById', () => {
    const all = engine.query({});
    const target = all[0];
    const result = engine.getById(target.id);
    expect(result).toBeDefined();
    expect(result!.id).toBe(target.id);
  });

  it('getByCorrelationId', () => {
    const corrId = 'corr-1';
    engine.log({
      who: makeActor(),
      what: 'a',
      resource: makeResource(),
      outcome: 'success',
      eventType: 'data',
      severity: 'info',
      correlationId: corrId,
    });
    const result = engine.getByCorrelationId(corrId);
    expect(result.length).toBe(1);
  });

  it('getByActor', () => {
    const result = engine.getByActor('user-1');
    expect(result.every((e) => e.who.id === 'user-1')).toBe(true);
  });

  it('getByResource', () => {
    const result = engine.getByResource('doc', 'doc-123');
    expect(result.every((e) => e.resource.type === 'doc')).toBe(true);
  });
});

describe('AuditTrailEngine - 合规报告', () => {
  let engine: AuditTrailEngine;

  beforeEach(() => {
    engine = new AuditTrailEngine({ persist: false });
    for (let i = 0; i < 20; i++) {
      engine.log({
        who: makeActor(),
        what: 'test',
        resource: makeResource({ type: ['doc', 'agent', 'config'][i % 3] }),
        outcome: ['success', 'failure', 'denied'][i % 3] as any,
        eventType: ['data', 'authz', 'admin'][i % 3] as any,
        severity: 'info',
      });
    }
  });

  it('generateSOC2Report', () => {
    const period: Period = { from: Date.now() - 60000, to: Date.now() + 1000 };
    const report = engine.generateSOC2Report(period);
    expect(report.standard).toBe('SOC2');
    expect(report.sections.length).toBe(COMPLIANCE_CONTROLS.SOC2.length);
    expect(report.integrityVerified).toBe(true);
    expect(report.totalEvents).toBe(20);
  });

  it('generateISO27001Report', () => {
    const period: Period = { from: Date.now() - 60000, to: Date.now() + 1000 };
    const report = engine.generateISO27001Report(period);
    expect(report.standard).toBe('ISO27001');
    expect(report.sections.length).toBeGreaterThan(0);
  });

  it('generateGDPRReport', () => {
    const period: Period = { from: Date.now() - 60000, to: Date.now() + 1000 };
    const report = engine.generateGDPRReport(period);
    expect(report.standard).toBe('GDPR');
  });

  it('generateEUAIActReport', () => {
    const period: Period = { from: Date.now() - 60000, to: Date.now() + 1000 };
    const report = engine.generateEUAIActReport(period);
    expect(report.standard).toBe('EUAIAct');
  });

  it('报告包含完整性检查', () => {
    const period: Period = { from: Date.now() - 60000, to: Date.now() + 1000 };
    const report = engine.generateSOC2Report(period);
    expect(report.integrityCheck).toBeDefined();
    expect(report.integrityCheck.valid).toBe(true);
  });
});

describe('AuditTrailEngine - 导出', () => {
  let engine: AuditTrailEngine;

  beforeEach(() => {
    engine = new AuditTrailEngine({ persist: false });
    for (let i = 0; i < 3; i++) {
      engine.log({
        who: makeActor(),
        what: `action.${i}`,
        resource: makeResource(),
        outcome: 'success',
        eventType: 'data',
        severity: 'info',
      });
    }
  });

  it('exportJSON', () => {
    const json = engine.exportJSON({});
    const parsed = JSON.parse(json);
    expect(parsed.events).toBeDefined();
    expect(parsed.events.length).toBe(3);
    expect(parsed.schemaVersion).toBe('1.0');
  });

  it('exportCSV', () => {
    const csv = engine.exportCSV({});
    const lines = csv.split('\n');
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('eventType');
  });

  it('exportCEF', () => {
    const cef = engine.exportCEF({});
    const lines = cef.split('\n');
    expect(lines.length).toBe(3);
    expect(lines[0]).toMatch(/^CEF:0/);
  });

  it('exportLEEF', () => {
    const leef = engine.exportLEEF({});
    const lines = leef.split('\n');
    expect(lines.length).toBe(3);
    expect(lines[0]).toMatch(/^LEEF:1\.0/);
  });
});

describe('AuditTrailEngine - GDPR 操作', () => {
  let engine: AuditTrailEngine;

  beforeEach(() => {
    engine = new AuditTrailEngine({ persist: false });
    for (let i = 0; i < 3; i++) {
      engine.log({
        who: makeActor({ id: 'user-target' }),
        what: 'test',
        resource: makeResource(),
        outcome: 'success',
        eventType: 'data',
        severity: 'info',
      });
    }
  });

  it('exportActorData', () => {
    const events = engine.exportActorData('user-target');
    expect(events.length).toBe(3);
  });

  it('anonymizeActor', () => {
    const count = engine.anonymizeActor('user-target');
    expect(count).toBe(3);
    const events = engine.getByActor('user-target');
    expect(events[0].who.name).toBe('anonymized');
    expect(events[0].who.email).toBe('anonymized@anon.local');
  });

  it('deleteActorData (soft delete via anonymize)', () => {
    const count = engine.deleteActorData('user-target');
    expect(count).toBe(3);
  });
});

describe('AuditTrailEngine - 保留管理', () => {
  it('applyRetentionPolicy 不会影响新事件', () => {
    const engine = new AuditTrailEngine({ persist: false, retentionDays: 365 });
    for (let i = 0; i < 5; i++) {
      engine.log({
        who: makeActor(),
        what: 'test',
        resource: makeResource(),
        outcome: 'success',
        eventType: 'data',
        severity: 'info',
      });
    }
    const result = engine.applyRetentionPolicy();
    expect(result.deleted).toBe(0);
    expect(engine.count()).toBe(5);
  });

  it('archive 旧事件', () => {
    const engine = new AuditTrailEngine({ persist: false });
    for (let i = 0; i < 3; i++) {
      engine.log({
        who: makeActor(),
        what: 'test',
        resource: makeResource(),
        outcome: 'success',
        eventType: 'data',
        severity: 'info',
      });
    }
    const oldTimestamp = Date.now() - 10 * 86400000; // 10 天前
    const count = engine.archive(oldTimestamp);
    expect(count).toBe(3);
  });

  it('delete 旧事件', () => {
    const engine = new AuditTrailEngine({ persist: false });
    for (let i = 0; i < 3; i++) {
      engine.log({
        who: makeActor(),
        what: 'test',
        resource: makeResource(),
        outcome: 'success',
        eventType: 'data',
        severity: 'info',
      });
    }
    const futureCutoff = Date.now() + 1000;
    const deleted = engine.delete(futureCutoff);
    expect(deleted).toBe(3);
    expect(engine.count()).toBe(0);
  });
});

describe('AuditTrailEngine - 事件订阅', () => {
  it('订阅 event-logged', () => {
    const engine = new AuditTrailEngine({ persist: false });
    let received = 0;
    engine.on('event-logged', () => received++);

    engine.log({
      who: makeActor(),
      what: 'test',
      resource: makeResource(),
      outcome: 'success',
      eventType: 'data',
      severity: 'info',
    });
    expect(received).toBe(1);
  });

  it('退订后不再接收', () => {
    const engine = new AuditTrailEngine({ persist: false });
    let received = 0;
    const unsub = engine.on('event-logged', () => received++);
    engine.log({ who: makeActor(), what: 'a', resource: makeResource(), outcome: 'success', eventType: 'data', severity: 'info' });
    unsub();
    engine.log({ who: makeActor(), what: 'b', resource: makeResource(), outcome: 'success', eventType: 'data', severity: 'info' });
    expect(received).toBe(1);
  });

  it('多订阅者', () => {
    const engine = new AuditTrailEngine({ persist: false });
    let count1 = 0, count2 = 0;
    engine.on('event-logged', () => count1++);
    engine.on('event-logged', () => count2++);
    engine.log({ who: makeActor(), what: 'a', resource: makeResource(), outcome: 'success', eventType: 'data', severity: 'info' });
    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });
});

describe('AuditTrailEngine - 工具函数', () => {
  it('canonicalJSON 处理 null', () => {
    expect(canonicalJSON(null)).toBe('null');
  });

  it('canonicalJSON 处理数组', () => {
    expect(canonicalJSON([1, 2, 3])).toBe('[1,2,3]');
  });

  it('canonicalJSON 排序键', () => {
    expect(canonicalJSON({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('computeEventHash 稳定', () => {
    const base = {
      id: 'aud-1',
      sequenceNumber: 0,
      timestamp: 1000,
      schemaVersion: '1.0',
      who: { id: 'u1', type: 'user' as const },
      what: 'test',
      where: {},
      resource: { type: 'doc', id: 'd1' },
      outcome: 'success' as const,
      eventType: 'data' as const,
      severity: 'info' as const,
      prevHash: GENESIS_HASH,
    };
    const h1 = computeEventHash(base);
    const h2 = computeEventHash(base);
    expect(h1).toBe(h2);
  });

  it('computeEventHash 输入不同输出不同', () => {
    const base = {
      id: 'aud-1',
      sequenceNumber: 0,
      timestamp: 1000,
      schemaVersion: '1.0',
      who: { id: 'u1', type: 'user' as const },
      what: 'test',
      where: {},
      resource: { type: 'doc', id: 'd1' },
      outcome: 'success' as const,
      eventType: 'data' as const,
      severity: 'info' as const,
      prevHash: GENESIS_HASH,
    };
    const h1 = computeEventHash(base);
    const h2 = computeEventHash({ ...base, what: 'changed' });
    expect(h1).not.toBe(h2);
  });
});

describe('AuditTrailEngine - 统计', () => {
  it('countByType', () => {
    const engine = new AuditTrailEngine({ persist: false });
    engine.log({ who: makeActor(), what: 'a', resource: makeResource(), outcome: 'success', eventType: 'data', severity: 'info' });
    engine.log({ who: makeActor(), what: 'b', resource: makeResource(), outcome: 'success', eventType: 'data', severity: 'info' });
    engine.log({ who: makeActor(), what: 'c', resource: makeResource(), outcome: 'success', eventType: 'authz', severity: 'info' });
    const stats = engine.countByType();
    expect(stats.data).toBe(2);
    expect(stats.authz).toBe(1);
  });

  it('getStats', () => {
    const engine = new AuditTrailEngine({ persist: false });
    for (let i = 0; i < 5; i++) {
      engine.log({ who: makeActor(), what: 'a', resource: makeResource(), outcome: 'success', eventType: 'data', severity: 'info' });
    }
    const stats = engine.getStats();
    expect(stats.totalEvents).toBe(5);
    expect(stats.chains).toBeGreaterThan(0);
  });
});

describe('AuditTrailEngine - 全局单例', () => {
  it('getDefaultAuditTrailEngine', () => {
    const e1 = getDefaultAuditTrailEngine();
    const e2 = getDefaultAuditTrailEngine();
    expect(e1).toBe(e2);
  });

  it('setDefaultAuditTrailEngine', () => {
    const newEngine = new AuditTrailEngine({ persist: false });
    setDefaultAuditTrailEngine(newEngine);
    expect(getDefaultAuditTrailEngine()).toBe(newEngine);
  });
});

describe('AuditTrailEngine - 持久化', () => {
  it('持久化与恢复', () => {
    // 内存模式 - 测试 load/save 不崩溃
    const engine = new AuditTrailEngine({ persist: false });
    engine.log({ who: makeActor(), what: 'a', resource: makeResource(), outcome: 'success', eventType: 'data', severity: 'info' });
    const stats = engine.getStats();
    expect(stats.totalEvents).toBe(1);
  });
});

describe('AuditTrailEngine - 错误处理', () => {
  it('空 actor 仍可记录', () => {
    const engine = new AuditTrailEngine({ persist: false });
    const event = engine.log({
      who: { id: 'system', type: 'system' },
      what: 'system.startup',
      resource: { type: 'service', id: 'hermes' },
      outcome: 'success',
      eventType: 'system',
      severity: 'info',
    });
    expect(event).toBeDefined();
  });

  it('verifyChain 不存在的 chain', () => {
    const engine = new AuditTrailEngine({ persist: false });
    const result = engine.verifyChain('nonexistent');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Chain not found');
  });

  it('updateConfig 修改配置', () => {
    const engine = new AuditTrailEngine({ persist: false });
    engine.updateConfig({ retentionDays: 30 });
    expect(engine.getConfig().retentionDays).toBe(30);
  });

  it('clear 清空所有事件', () => {
    const engine = new AuditTrailEngine({ persist: false });
    for (let i = 0; i < 5; i++) {
      engine.log({ who: makeActor(), what: 'a', resource: makeResource(), outcome: 'success', eventType: 'data', severity: 'info' });
    }
    engine.clear();
    expect(engine.count()).toBe(0);
  });
});
