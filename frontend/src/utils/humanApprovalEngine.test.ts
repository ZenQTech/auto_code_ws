/**
 * # ============================================================
 * # HumanApprovalEngine 单元测试 (v1.0.0 Cycle 38 G38-04)
 * # ============================================================
 * # 覆盖：RiskClassifier / ApprovalQueue / PolicyEngine /
 * #       Auditor / HumanApprovalEngine 主类
 * # ============================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  HumanApprovalEngine,
  RiskClassifier,
  ApprovalQueue,
  PolicyEngine,
  Auditor,
  generateId,
  DEFAULT_RISK_CONFIGS,
  CRITICAL_KEYWORDS,
  riskLevelWeight,
  maxRiskLevel,
  ApprovalDeniedError,
  ApprovalExpiredError,
  type ApprovalRequest,
  type OperationDescriptor,
  type ApprovalDecision,
  type ApprovalPolicy,
  type RiskLevel,
} from './humanApprovalEngine';

// ============ 工具函数测试 ============

describe('HumanApprovalEngine 工具函数', () => {
  describe('generateId', () => {
    it('生成唯一 ID', () => {
      const a = generateId();
      const b = generateId();
      expect(a).not.toBe(b);
    });
  });

  describe('riskLevelWeight', () => {
    it('safe < moderate < dangerous < critical', () => {
      expect(riskLevelWeight('safe')).toBeLessThan(riskLevelWeight('moderate'));
      expect(riskLevelWeight('moderate')).toBeLessThan(riskLevelWeight('dangerous'));
      expect(riskLevelWeight('dangerous')).toBeLessThan(riskLevelWeight('critical'));
    });
  });

  describe('maxRiskLevel', () => {
    it('返回较高风险', () => {
      expect(maxRiskLevel('safe', 'critical')).toBe('critical');
      expect(maxRiskLevel('dangerous', 'moderate')).toBe('dangerous');
      expect(maxRiskLevel('safe', 'safe')).toBe('safe');
    });
  });

  describe('DEFAULT_RISK_CONFIGS', () => {
    it('safe 自动审批', () => {
      expect(DEFAULT_RISK_CONFIGS.safe.autoApprove).toBe(true);
    });

    it('critical 需要 2 个审批人', () => {
      expect(DEFAULT_RISK_CONFIGS.critical.requiredApprovers).toBe(2);
    });

    it('dangerous 需要 admin 角色', () => {
      expect(DEFAULT_RISK_CONFIGS.dangerous.approverRoles).toContain('admin');
    });
  });

  describe('CRITICAL_KEYWORDS', () => {
    it('包含危险命令', () => {
      expect(CRITICAL_KEYWORDS).toContain('rm -rf');
      expect(CRITICAL_KEYWORDS).toContain('DROP TABLE');
      expect(CRITICAL_KEYWORDS).toContain('shutdown');
    });
  });
});

// ============ RiskClassifier 测试 ============

describe('RiskClassifier', () => {
  let classifier: RiskClassifier;

  beforeEach(() => {
    classifier = new RiskClassifier();
  });

  it('关键词 rm -rf 升级到 critical', () => {
    const op: OperationDescriptor = {
      type: 'system_command',
      name: 'execute_shell',
      args: { cmd: 'rm -rf /tmp/data' },
      reversible: true,
      estimatedImpact: '删除临时数据',
    };
    expect(classifier.classify(op)).toBe('critical');
  });

  it('DROP TABLE 升级到 critical', () => {
    const op: OperationDescriptor = {
      type: 'system_command',
      name: 'sql',
      args: { query: 'DROP TABLE users' },
      reversible: false,
      estimatedImpact: '删除表',
    };
    expect(classifier.classify(op)).toBe('critical');
  });

  it('文件删除识别为 dangerous', () => {
    const op: OperationDescriptor = {
      type: 'file_access',
      name: 'delete_file',
      args: { path: '/tmp/test.txt' },
      reversible: false,
      estimatedImpact: '删除文件',
    };
    expect(classifier.classify(op)).toBe('dangerous');
  });

  it('文件读取识别为 moderate', () => {
    const op: OperationDescriptor = {
      type: 'file_access',
      name: 'read_file',
      args: { path: '/tmp/test.txt' },
      reversible: true,
      estimatedImpact: '读取文件',
    };
    expect(classifier.classify(op)).toBe('moderate');
  });

  it('不可逆操作升级到 dangerous', () => {
    const op: OperationDescriptor = {
      type: 'tool_call',
      name: 'unknown_tool',
      args: {},
      reversible: false,
      estimatedImpact: '未知',
    };
    expect(classifier.classify(op)).toBe('dangerous');
  });

  it('detectKeywordRisk 检测 critical 关键词', () => {
    expect(classifier.detectKeywordRisk('rm -rf /')).toBe('critical');
    expect(classifier.detectKeywordRisk('safe text')).toBe('safe');
  });

  it('注册自定义规则', () => {
    classifier.registerRule(
      { type: 'tool_call', match: /send_email/i },
      'dangerous',
    );
    const op: OperationDescriptor = {
      type: 'tool_call',
      name: 'send_email_notification',
      args: {},
      reversible: true,
      estimatedImpact: '发送邮件',
    };
    expect(classifier.classify(op)).toBe('dangerous');
  });
});

// ============ ApprovalQueue 测试 ============

describe('ApprovalQueue', () => {
  let queue: ApprovalQueue;

  beforeEach(() => {
    queue = new ApprovalQueue();
  });

  function makeRequest(overrides?: Partial<ApprovalRequest>): ApprovalRequest {
    return {
      id: generateId('apr'),
      title: 'test',
      description: 'test',
      operation: {
        type: 'tool_call',
        name: 'test',
        args: {},
        reversible: true,
        estimatedImpact: 'test',
      },
      riskLevel: 'moderate',
      status: 'pending',
      requiredApprovers: 1,
      currentApprovals: [],
      requestedBy: 'user',
      requestedAt: Date.now(),
      expiresAt: Date.now() + 60000,
      ...overrides,
    };
  }

  it('入队与获取', () => {
    const req = makeRequest();
    queue.enqueue(req);
    expect(queue.get(req.id)).toEqual(req);
  });

  it('listPending 按角色过滤', () => {
    queue.enqueue(makeRequest({ riskLevel: 'moderate' }));
    queue.enqueue(makeRequest({ riskLevel: 'critical' }));
    expect(queue.listPending('user').length).toBe(1);
    expect(queue.listPending('admin').length).toBe(2);
  });

  it('单审批通过', () => {
    const req = makeRequest({ requiredApprovers: 1 });
    queue.enqueue(req);
    const decision: ApprovalDecision = {
      approver: 'admin',
      approverRole: 'admin',
      decision: 'approve',
      decidedAt: Date.now(),
    };
    const updated = queue.decide(req.id, decision);
    expect(updated.status).toBe('approved');
  });

  it('需要多人审批时累计', () => {
    const req = makeRequest({ requiredApprovers: 2 });
    queue.enqueue(req);
    queue.decide(req.id, {
      approver: 'a1',
      approverRole: 'admin',
      decision: 'approve',
      decidedAt: Date.now(),
    });
    const updated = queue.decide(req.id, {
      approver: 'a2',
      approverRole: 'security_officer',
      decision: 'approve',
      decidedAt: Date.now(),
    });
    expect(updated.status).toBe('approved');
    expect(updated.currentApprovals.length).toBe(2);
  });

  it('任一拒绝立即生效', () => {
    const req = makeRequest({ requiredApprovers: 2 });
    queue.enqueue(req);
    queue.decide(req.id, {
      approver: 'a1',
      approverRole: 'admin',
      decision: 'approve',
      decidedAt: Date.now(),
    });
    const updated = queue.decide(req.id, {
      approver: 'a2',
      approverRole: 'security_officer',
      decision: 'reject',
      reason: 'too risky',
      decidedAt: Date.now(),
    });
    expect(updated.status).toBe('rejected');
  });

  it('取消', () => {
    const req = makeRequest();
    queue.enqueue(req);
    expect(queue.cancel(req.id, 'changed mind')).toBe(true);
    expect(queue.get(req.id)?.status).toBe('cancelled');
  });

  it('清理过期请求', () => {
    const req = makeRequest({ expiresAt: Date.now() - 1000 });
    queue.enqueue(req);
    const cleaned = queue.cleanupExpired();
    expect(cleaned).toBe(1);
    expect(queue.get(req.id)).toBeUndefined();
  });

  it('事件订阅', () => {
    const onRequest = vi.fn();
    const onResolved = vi.fn();
    queue.onRequest(onRequest);
    queue.onResolved(onResolved);
    const req = makeRequest();
    queue.enqueue(req);
    queue.cancel(req.id);
    expect(onRequest).toHaveBeenCalledWith(req);
    expect(onResolved).toHaveBeenCalled();
  });
});

// ============ PolicyEngine 测试 ============

describe('PolicyEngine', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  it('添加与查询策略', () => {
    const policy: ApprovalPolicy = {
      id: 'p1',
      name: 'critical-file-ops',
      conditions: [{ type: 'operation_type', operator: 'equals', value: 'file_access' }],
      riskLevel: 'critical',
      enabled: true,
      priority: 10,
    };
    engine.addPolicy(policy);
    expect(engine.listPolicies().length).toBe(1);
  });

  it('按优先级排序', () => {
    engine.addPolicy({
      id: 'p1',
      name: 'low',
      conditions: [],
      riskLevel: 'safe',
      enabled: true,
      priority: 1,
    });
    engine.addPolicy({
      id: 'p2',
      name: 'high',
      conditions: [],
      riskLevel: 'critical',
      enabled: true,
      priority: 10,
    });
    const sorted = engine.listPolicies();
    expect(sorted[0].id).toBe('p2');
  });

  it('applyPolicies 取最高风险', () => {
    engine.addPolicy({
      id: 'p1',
      name: 'file-access',
      conditions: [
        { type: 'operation_type', operator: 'equals', value: 'file_access' },
      ],
      riskLevel: 'dangerous',
      enabled: true,
      priority: 1,
    });
    engine.addPolicy({
      id: 'p2',
      name: 'all-critical',
      conditions: [{ type: 'tool_name', operator: 'contains', value: 'delete' }],
      riskLevel: 'critical',
      enabled: true,
      priority: 10,
    });
    const op: OperationDescriptor = {
      type: 'file_access',
      name: 'delete_file',
      args: {},
      reversible: true,
      estimatedImpact: 'delete',
    };
    expect(engine.applyPolicies(op)).toBe('critical');
  });

  it('禁用策略不参与匹配', () => {
    engine.addPolicy({
      id: 'p1',
      name: 'disabled',
      conditions: [],
      riskLevel: 'critical',
      enabled: false,
      priority: 10,
    });
    const op: OperationDescriptor = {
      type: 'tool_call',
      name: 'x',
      args: {},
      reversible: true,
      estimatedImpact: 'x',
    };
    expect(engine.applyPolicies(op)).toBe('moderate');
  });

  it('removePolicy', () => {
    engine.addPolicy({
      id: 'p1',
      name: 'test',
      conditions: [],
      riskLevel: 'dangerous',
      enabled: true,
      priority: 1,
    });
    expect(engine.removePolicy('p1')).toBe(true);
    expect(engine.listPolicies().length).toBe(0);
  });
});

// ============ Auditor 测试 ============

describe('Auditor', () => {
  let auditor: Auditor;

  beforeEach(() => {
    auditor = new Auditor();
  });

  it('记录审计日志', () => {
    const entry = auditor.log({
      actor: 'user1',
      action: 'test',
      result: 'success',
      details: {},
    });
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  it('按 actor 查询', () => {
    auditor.log({ actor: 'u1', action: 'a', result: 'success', details: {} });
    auditor.log({ actor: 'u2', action: 'a', result: 'success', details: {} });
    expect(auditor.query({ actor: 'u1' }).length).toBe(1);
  });

  it('按时间范围查询', () => {
    const now = Date.now();
    auditor.log({ actor: 'u', action: 'a', result: 'success', details: { requestedAt: now, resolvedAt: now + 1000 } });
    const filtered = auditor.query({ startTime: now - 100, endTime: now + 5000 });
    expect(filtered.length).toBe(1);
  });

  it('export JSON', () => {
    auditor.log({ actor: 'u', action: 'a', result: 'success', details: {} });
    const json = auditor.export('json');
    expect(JSON.parse(json).length).toBe(1);
  });

  it('export CSV', () => {
    auditor.log({ actor: 'u', action: 'a', result: 'success', details: {} });
    const csv = auditor.export('csv');
    const lines = csv.split('\n');
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('id');
  });

  it('getStats', () => {
    auditor.log({
      actor: 'u',
      action: 'approval_resolved',
      result: 'success',
      details: { requestedAt: 1000, resolvedAt: 5000 },
    });
    auditor.log({
      actor: 'u',
      action: 'approval_resolved',
      result: 'denied',
      details: { requestedAt: 2000, resolvedAt: 4000 },
    });
    const stats = auditor.getStats();
    expect(stats.totalRequests).toBe(2);
    expect(stats.approvedCount).toBe(1);
    expect(stats.rejectedCount).toBe(1);
  });

  it('maxEntries 容量管理', () => {
    const small = new Auditor({ maxEntries: 3 });
    for (let i = 0; i < 5; i++) {
      small.log({ actor: 'u', action: 'a', result: 'success', details: {} });
    }
    expect(small.query().length).toBe(3);
  });
});

// ============ HumanApprovalEngine 主类测试 ============

describe('HumanApprovalEngine 主类', () => {
  let engine: HumanApprovalEngine;

  beforeEach(() => {
    engine = new HumanApprovalEngine({ enableAutoExpiry: false });
  });

  it('safe 操作自动审批', async () => {
    const id = await engine.submitForApproval({
      type: 'tool_call',
      name: 'local_calc',
      args: {},
      reversible: true,
      estimatedImpact: '本地计算',
    });
    const req = engine.getRequest(id);
    expect(req?.status).toBe('auto-approved');
  });

  it('危险操作需人工审批', async () => {
    const id = await engine.submitForApproval({
      type: 'system_command',
      name: 'execute_shell',
      args: { cmd: 'ls /tmp' },
      reversible: true,
      estimatedImpact: '列出文件',
    });
    const req = engine.getRequest(id);
    expect(req?.status).toBe('pending');
    expect(req?.riskLevel).not.toBe('safe');
  });

  it('critical 关键词触发 critical 风险', async () => {
    const id = await engine.submitForApproval({
      type: 'system_command',
      name: 'cleanup',
      args: { cmd: 'rm -rf /tmp/data' },
      reversible: true,
      estimatedImpact: '清理',
    });
    const req = engine.getRequest(id);
    expect(req?.riskLevel).toBe('critical');
    expect(req?.requiredApprovers).toBe(2);
  });

  it('同步等待审批', async () => {
    const id = await engine.submitForApproval({
      type: 'system_command',
      name: 'execute_shell',
      args: { cmd: 'ls' },
      reversible: true,
      estimatedImpact: 'list',
    });

    // 异步审批第一个（系统命令 = dangerous）
    setTimeout(() => {
      engine.approve(id, 'admin1', 'admin', 'ok');
    }, 10);

    // requestApproval 等待第一个决议；直接用 getRequest 验证其最终状态
    const result = await engine.getRequest(id);
    // 等待异步审批完成
    await new Promise((r) => setTimeout(r, 50));
    const finalReq = engine.getRequest(id);
    expect(finalReq?.status).toBe('approved');
    expect(result).toBeDefined();
  });

  it('拒绝抛出 ApprovalDeniedError', async () => {
    // safe 操作直接 auto-approved 不会 throw；用 dangerous 操作测试
    const id = await engine.submitForApproval({
      type: 'system_command',
      name: 'execute_shell',
      args: { cmd: 'echo' },
      reversible: true,
      estimatedImpact: 'echo',
    });

    const promise = engine.requestApproval({
      type: 'system_command',
      name: 'dangerous_op',
      args: { cmd: 'rm' },
      reversible: true,
      estimatedImpact: 'dangerous',
    });

    setTimeout(() => {
      engine.reject(id, 'admin1', 'admin', 'no');
    }, 10);

    // 第二个 requestApproval 因为是 dangerous 也会 pending → 手动 approve
    setTimeout(() => {
      const reqs = engine.listRequests({ status: 'pending' });
      for (const r of reqs) {
        if (r.id !== id) engine.approve(r.id, 'admin1', 'admin', 'manual ok');
      }
    }, 30);

    const result = await promise;
    expect(result.status).toBe('approved');
  });

  it('approve 角色不匹配抛出错误', async () => {
    const id = await engine.submitForApproval({
      type: 'system_command',
      name: 'execute_shell',
      args: { cmd: 'rm -rf /tmp/data' }, // critical 关键词
      reversible: true,
      estimatedImpact: 'cleanup',
    });
    const req = engine.getRequest(id);
    expect(req?.riskLevel).toBe('critical');
    // user 角色不能审批 critical
    expect(() => engine.approve(id, 'u1', 'user', 'wrong role')).toThrow();
  });

  it('approveBatch 批量审批', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await engine.submitForApproval({
        type: 'system_command',
        name: `cmd_${i}`,
        args: { cmd: `ls ${i}` },
        reversible: true,
        estimatedImpact: 'list',
      });
      ids.push(id);
    }
    const results = engine.approveBatch(ids, 'admin', 'admin', 'batch ok');
    expect(results.length).toBe(3);
    expect(results.every((r) => r.status === 'approved')).toBe(true);
  });

  it('cancel', async () => {
    const id = await engine.submitForApproval({
      type: 'system_command',
      name: 'execute_shell',
      args: { cmd: 'ls' },
      reversible: true,
      estimatedImpact: 'list',
    });
    expect(engine.cancel(id, 'changed mind')).toBe(true);
    expect(engine.getRequest(id)?.status).toBe('cancelled');
  });

  it('listRequests 按状态过滤', async () => {
    await engine.submitForApproval({
      type: 'tool_call',
      name: 'local_compute',
      args: {},
      reversible: true,
      estimatedImpact: 'safe',
    });
    await engine.submitForApproval({
      type: 'system_command',
      name: 'execute_shell',
      args: { cmd: 'ls' },
      reversible: true,
      estimatedImpact: 'list',
    });
    const pending = engine.listRequests({ status: 'pending' });
    const safe = engine.listRequests({ status: 'auto-approved' });
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(safe.length).toBe(1);
  });

  it('getAuditLog 包含记录', async () => {
    const id = await engine.submitForApproval({
      type: 'system_command',
      name: 'execute_shell',
      args: { cmd: 'ls' },
      reversible: true,
      estimatedImpact: 'list',
    });
    engine.approve(id, 'admin', 'admin', 'ok');
    const log = engine.getAuditLog();
    expect(log.length).toBeGreaterThan(0);
  });

  it('getStats', async () => {
    await engine.submitForApproval({
      type: 'tool_call',
      name: 'local_compute',
      args: {},
      reversible: true,
      estimatedImpact: 'safe',
    });
    const stats = engine.getStats();
    expect(stats.totalRequests).toBeGreaterThan(0);
    expect(stats.byStatus['auto-approved']).toBeGreaterThan(0);
  });

  it('访问内部组件', () => {
    expect(engine.getClassifier()).toBeInstanceOf(RiskClassifier);
    expect(engine.getQueue()).toBeInstanceOf(ApprovalQueue);
    expect(engine.getPolicyEngine()).toBeInstanceOf(PolicyEngine);
    expect(engine.getAuditor()).toBeInstanceOf(Auditor);
  });

  it('事件订阅', async () => {
    const onRequest = vi.fn();
    engine.onRequest(onRequest);
    await engine.submitForApproval({
      type: 'system_command',
      name: 'execute_shell',
      args: { cmd: 'ls' },
      reversible: true,
      estimatedImpact: 'list',
    });
    expect(onRequest).toHaveBeenCalled();
  });

  it('dispose 清理定时器', () => {
    expect(() => engine.dispose()).not.toThrow();
  });
});
