/**
 * # ============================================================
 * # Smart Approval Engine - 单元测试 (v1.0.0 Cycle 26 G26-02)
 * # ============================================================
 * # 核心作用：覆盖 SmartApprovalEngine 的所有核心功能
 * # 测试维度：
 * #   1. 表达式求值：prefix/contains/regex/exact/length/cmd-in-cmd
 * #   2. 组合逻辑：all/any/not
 * #   3. 规则 CRUD
 * #   4. 决策逻辑 + 优先级
 * #   5. 审计日志 + 查询
 * #   6. 人工覆盖
 * #   7. 40+ 内置规则覆盖
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 26 G26-02 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SmartApprovalEngine,
  evaluateSimple,
  evaluateExpression,
  getDefaultSmartApprovalEngine,
  resetDefaultSmartApprovalEngine,
} from './smartApprovalEngine';
import {
  TOTAL_BUILTIN_RULES,
} from './smartApprovalRules';
import type { CompositeExpr } from './smartApprovalTypes';

describe('evaluateSimple', () => {
  it('should match prefix', () => {
    expect(evaluateSimple({ type: 'prefix', value: 'git ' }, 'git status')).toBe(true);
    expect(evaluateSimple({ type: 'prefix', value: 'git ' }, 'npm install')).toBe(false);
  });

  it('should match contains', () => {
    expect(evaluateSimple({ type: 'contains', value: 'rm -rf' }, 'rm -rf /tmp')).toBe(true);
    expect(evaluateSimple({ type: 'contains', value: 'rm -rf' }, 'rm -r /tmp')).toBe(false);
  });

  it('should match regex', () => {
    expect(evaluateSimple({ type: 'regex', value: '\\.env' }, 'path/to/.env')).toBe(true);
    expect(evaluateSimple({ type: 'regex', value: '^npm' }, 'npm install')).toBe(true);
  });

  it('should match exact', () => {
    expect(evaluateSimple({ type: 'exact', value: 'package.json' }, 'package.json')).toBe(true);
    expect(evaluateSimple({ type: 'exact', value: 'package.json' }, 'src/package.json')).toBe(false);
  });

  it('should match length', () => {
    expect(evaluateSimple({ type: 'length', value: '5' }, 'abcde')).toBe(true);
    expect(evaluateSimple({ type: 'length', value: '5' }, 'abc')).toBe(false);
  });

  it('should match cmd-in-cmd', () => {
    expect(evaluateSimple({ type: 'cmd-in-cmd', value: 'rm' }, 'curl | rm file')).toBe(true);
    expect(evaluateSimple({ type: 'cmd-in-cmd', value: 'rm' }, 'remove file')).toBe(false);
  });

  it('should support case-insensitive', () => {
    expect(evaluateSimple({ type: 'contains', value: 'GIT', caseSensitive: false }, 'git status')).toBe(true);
    expect(evaluateSimple({ type: 'contains', value: 'GIT', caseSensitive: true }, 'git status')).toBe(false);
  });

  it('should handle invalid regex gracefully', () => {
    expect(evaluateSimple({ type: 'regex', value: '[invalid' }, 'any string')).toBe(false);
  });
});

describe('evaluateExpression', () => {
  it('should evaluate simple expressions', () => {
    expect(evaluateExpression({ type: 'contains', value: 'test' }, 'this is a test', 'shell')).toBe(true);
  });

  it('should evaluate all (AND)', () => {
    const expr = {
      all: [
        { type: 'contains', value: 'git ' } as any,
        { type: 'contains', value: 'push' } as any,
        { type: 'contains', value: '--force' } as any,
      ],
    };
    expect(evaluateExpression(expr, 'git push --force', 'shell')).toBe(true);
    expect(evaluateExpression(expr, 'git push', 'shell')).toBe(false);
  });

  it('should evaluate any (OR)', () => {
    const expr = {
      any: [
        { type: 'contains', value: 'rm -rf' } as any,
        { type: 'contains', value: 'dd if=' } as any,
      ],
    };
    expect(evaluateExpression(expr, 'rm -rf /', 'shell')).toBe(true);
    expect(evaluateExpression(expr, 'dd if=/dev/zero', 'shell')).toBe(true);
    expect(evaluateExpression(expr, 'ls -la', 'shell')).toBe(false);
  });

  it('should evaluate not', () => {
    const expr: CompositeExpr = { not: { type: 'contains', value: 'rm' } };
    expect(evaluateExpression(expr, 'ls -la', 'shell')).toBe(true);
    expect(evaluateExpression(expr, 'rm file', 'shell')).toBe(false);
  });

  it('should handle nested expressions', () => {
    const expr = {
      all: [
        { type: 'contains', value: 'git ' } as any,
        { not: { type: 'contains', value: '--force' } } as any,
      ],
    };
    expect(evaluateExpression(expr, 'git push', 'shell')).toBe(true);
    expect(evaluateExpression(expr, 'git push --force', 'shell')).toBe(false);
  });
});

describe('SmartApprovalEngine - Builtin Rules', () => {
  let engine: SmartApprovalEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new SmartApprovalEngine({ persist: false });
  });

  it('should load 40+ builtin rules', () => {
    expect(engine.getAllRules().length).toBeGreaterThanOrEqual(40);
    expect(TOTAL_BUILTIN_RULES).toBeGreaterThanOrEqual(40);
  });

  it('builtin rules should be marked as system author', () => {
    const rules = engine.getAllRules();
    expect(rules.every((r) => r.author === 'system')).toBe(true);
  });

  it('builtin rules should be enabled by default', () => {
    const rules = engine.getEnabledRules();
    expect(rules.length).toBeGreaterThanOrEqual(40);
  });
});

describe('SmartApprovalEngine - Rule Management', () => {
  let engine: SmartApprovalEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new SmartApprovalEngine({ persist: false });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should add user rule', () => {
    const rule = engine.addRule({
      name: 'Test Rule',
      description: 'A test rule',
      actionTypes: ['shell'],
      match: { type: 'contains', value: 'test' },
      decision: 'allow',
      reason: 'Test allowed',
      priority: 50,
      enabled: true,
      tags: ['test'],
      author: 'user',
    });
    expect(rule.id).toBeTruthy();
    expect(rule.author).toBe('user');
    expect(rule.createdAt).toBeGreaterThan(0);
  });

  it('should update rule', () => {
    const rule = engine.addRule({
      name: 'Test',
      description: 'Test',
      actionTypes: ['shell'],
      match: { type: 'contains', value: 'test' },
      decision: 'allow',
      reason: 'Test',
      priority: 50,
      enabled: true,
      tags: [],
      author: 'user',
    });
    const updated = engine.updateRule(rule.id, { name: 'Updated' });
    expect(updated?.name).toBe('Updated');
  });

  it('should remove user rule but not system rule', () => {
    const userRule = engine.addRule({
      name: 'User',
      description: 'User',
      actionTypes: ['shell'],
      match: { type: 'contains', value: 'user' },
      decision: 'allow',
      reason: 'user',
      priority: 50,
      enabled: true,
      tags: [],
      author: 'user',
    });
    const removed = engine.removeRule(userRule.id);
    expect(removed).toBe(true);
    expect(engine.getRule(userRule.id)).toBeUndefined();

    // System rule should not be removable
    const systemRule = engine.getAllRules().find((r) => r.author === 'system');
    expect(systemRule).toBeDefined();
    const sysRemoved = engine.removeRule(systemRule!.id);
    expect(sysRemoved).toBe(false);
    expect(engine.getRule(systemRule!.id)).toBeDefined();
  });

  it('should toggle rule', () => {
    const rule = engine.addRule({
      name: 'Toggle',
      description: 'Toggle',
      actionTypes: ['shell'],
      match: { type: 'contains', value: 'toggle' },
      decision: 'allow',
      reason: 'toggle',
      priority: 50,
      enabled: true,
      tags: [],
      author: 'user',
    });
    expect(engine.toggleRule(rule.id, false)).toBe(true);
    expect(engine.getRule(rule.id)?.enabled).toBe(false);
  });

  it('should return rules sorted by priority descending', () => {
    const rules = engine.getAllRules();
    for (let i = 1; i < rules.length; i++) {
      expect(rules[i - 1].priority).toBeGreaterThanOrEqual(rules[i].priority);
    }
  });
});

describe('SmartApprovalEngine - Request & Decision', () => {
  let engine: SmartApprovalEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new SmartApprovalEngine({ persist: false });
  });

  it('should block rm -rf', () => {
    const decision = engine.request('shell', 'rm -rf /tmp');
    expect(decision.decision).toBe('block');
    expect(decision.ruleId).toContain('rm-rf');
  });

  it('should allow git status', () => {
    const decision = engine.request('shell', 'git status');
    expect(decision.decision).toBe('allow');
  });

  it('should allow git log', () => {
    const decision = engine.request('shell', 'git log --oneline');
    expect(decision.decision).toBe('allow');
  });

  it('should prompt on git commit', () => {
    const decision = engine.request('shell', 'git commit -m "test"');
    expect(decision.decision).toBe('prompt');
  });

  it('should block reading .env', () => {
    const decision = engine.request('file:read', '/path/to/.env');
    expect(decision.decision).toBe('block');
  });

  it('should block writing .env', () => {
    const decision = engine.request('file:write', '/path/to/.env');
    expect(decision.decision).toBe('block');
  });

  it('should allow localhost', () => {
    const decision = engine.request('network', 'http://localhost:3000/api');
    expect(decision.decision).toBe('allow');
  });

  it('should use default decision when no rule matches', () => {
    const decision = engine.request('shell', 'some random command xyz');
    // defaultDecision = 'prompt'
    expect(decision.decision).toBe('prompt');
  });

  it('should prioritize higher priority rules', () => {
    // safety rules have priority 100, default has priority 50
    // even if both would match, the higher priority wins
    const decision = engine.request('shell', 'rm -rf /');
    expect(decision.ruleId).toContain('rm-rf');
    const rule = engine.getRule(decision.ruleId!);
    expect(rule?.priority).toBeGreaterThanOrEqual(100);
  });

  it('should not match rules for wrong action types', () => {
    // file:read of .env should match file rule, not shell
    const decision = engine.request('file:read', '.env');
    expect(decision.ruleId).toContain('file-env');
  });

  it('should respect rule disabled state', () => {
    const rule = engine.getAllRules().find((r) => r.id === 'builtin-safety-rm-rf')!;
    engine.toggleRule(rule.id, false);
    const decision = engine.request('shell', 'rm -rf /');
    expect(decision.decision).toBe('prompt'); // falls back to default
  });

  it('should handle batch requests', () => {
    const decisions = engine.requestBatch([
      { actionType: 'shell', payload: 'rm -rf /' },
      { actionType: 'shell', payload: 'git status' },
      { actionType: 'shell', payload: 'git commit -m x' },
    ]);
    expect(decisions[0].decision).toBe('block');
    expect(decisions[1].decision).toBe('allow');
    expect(decisions[2].decision).toBe('prompt');
  });
});

describe('SmartApprovalEngine - Override', () => {
  let engine: SmartApprovalEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new SmartApprovalEngine({ persist: false });
  });

  it('should override decision', () => {
    const decision = engine.request('shell', 'rm -rf /');
    expect(decision.decision).toBe('block');
    const overridden = engine.override(decision.requestId, 'allow', 'User overrode for testing');
    expect(overridden).toBe(true);
    const log = engine.getAuditLog().find((l) => l.request.id === decision.requestId);
    expect(log?.decision.decision).toBe('allow');
    expect(log?.decision.overridden).toBe(true);
    expect(log?.decision.overrideReason).toBe('User overrode for testing');
  });

  it('should return false for unknown requestId', () => {
    expect(engine.override('nonexistent', 'allow', 'test')).toBe(false);
  });
});

describe('SmartApprovalEngine - Audit', () => {
  let engine: SmartApprovalEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new SmartApprovalEngine({ persist: false });
  });

  it('should record audit logs', () => {
    engine.request('shell', 'rm -rf /');
    engine.request('shell', 'git status');
    const logs = engine.getAuditLog();
    expect(logs.length).toBe(2);
  });

  it('should filter audit logs by ruleId', () => {
    engine.request('shell', 'rm -rf /');
    engine.request('shell', 'git status');
    const logs = engine.getAuditLog({ ruleId: 'builtin-safety-rm-rf' });
    expect(logs.length).toBe(1);
  });

  it('should filter audit logs by decision', () => {
    engine.request('shell', 'rm -rf /');
    engine.request('shell', 'git status');
    const blockLogs = engine.getAuditLog({ decision: 'block' });
    expect(blockLogs.length).toBeGreaterThan(0);
  });

  it('should filter audit logs by time', () => {
    const since = Date.now() - 1000;
    engine.request('shell', 'rm -rf /');
    const logs = engine.getAuditLog({ since });
    expect(logs.length).toBeGreaterThan(0);
  });

  it('should clear audit logs', () => {
    engine.request('shell', 'rm -rf /');
    expect(engine.getAuditLog().length).toBeGreaterThan(0);
    engine.clearAuditLog();
    expect(engine.getAuditLog().length).toBe(0);
  });

  it('should export audit logs as JSON', () => {
    engine.request('shell', 'rm -rf /');
    const json = engine.exportAuditLog();
    expect(json).toContain('requestId');
  });

  it('should respect max audit log limit', () => {
    const limitedEngine = new SmartApprovalEngine({ persist: false, maxAuditLogs: 5 });
    for (let i = 0; i < 20; i++) {
      limitedEngine.request('shell', `random command ${i}`);
    }
    expect(limitedEngine.getAuditLog().length).toBeLessThanOrEqual(5);
  });
});

describe('SmartApprovalEngine - DSL', () => {
  let engine: SmartApprovalEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new SmartApprovalEngine({ persist: false });
  });

  it('should parse rule DSL', () => {
    const dsl = JSON.stringify({
      name: 'Test',
      description: 'Test',
      actionTypes: ['shell'],
      match: { type: 'contains', value: 'test' },
      decision: 'allow',
      reason: 'Test',
      priority: 50,
      enabled: true,
      tags: [],
    });
    const parsed = engine.parseRuleDSL(dsl);
    expect(parsed.name).toBe('Test');
    expect(parsed.actionTypes).toEqual(['shell']);
  });

  it('should serialize rule to DSL', () => {
    const rule = engine.getAllRules()[0];
    const dsl = engine.serializeRule(rule);
    expect(() => JSON.parse(dsl)).not.toThrow();
  });
});

describe('SmartApprovalEngine - Events', () => {
  let engine: SmartApprovalEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new SmartApprovalEngine({ persist: false });
  });

  it('should emit rule-added', () => {
    const handler = vi.fn();
    engine.on('rule-added', handler);
    engine.addRule({
      name: 'Test',
      description: '',
      actionTypes: ['shell'],
      match: { type: 'contains', value: 'test' },
      decision: 'allow',
      reason: 'test',
      priority: 50,
      enabled: true,
      tags: [],
      author: 'user',
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should emit decision-made', () => {
    const handler = vi.fn();
    engine.on('decision-made', handler);
    engine.request('shell', 'rm -rf /');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should support unsubscribe', () => {
    const handler = vi.fn();
    const off = engine.on('rule-added', handler);
    off();
    engine.addRule({
      name: 'T',
      description: '',
      actionTypes: ['shell'],
      match: { type: 'contains', value: 't' },
      decision: 'allow',
      reason: 't',
      priority: 50,
      enabled: true,
      tags: [],
      author: 'user',
    });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('SmartApprovalEngine - Stats', () => {
  let engine: SmartApprovalEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new SmartApprovalEngine({ persist: false });
  });

  it('should track decision counts', () => {
    engine.request('shell', 'rm -rf /'); // block
    engine.request('shell', 'git status'); // allow
    engine.request('shell', 'git commit -m x'); // prompt
    const stats = engine.getStats();
    expect(stats.allow).toBeGreaterThanOrEqual(1);
    expect(stats.block).toBeGreaterThanOrEqual(1);
    expect(stats.prompt).toBeGreaterThanOrEqual(1);
  });

  it('should track overrides', () => {
    const decision = engine.request('shell', 'rm -rf /');
    engine.override(decision.requestId, 'allow', 'override test');
    const stats = engine.getStats();
    expect(stats.overrides).toBe(1);
  });
});

describe('SmartApprovalEngine - Persistence', () => {
  it('should save user rules to localStorage', () => {
    const e1 = new SmartApprovalEngine({ persist: true });
    e1.addRule({
      name: 'Persistent',
      description: 'Persist',
      actionTypes: ['shell'],
      match: { type: 'contains', value: 'persist' },
      decision: 'allow',
      reason: 'persist',
      priority: 50,
      enabled: true,
      tags: [],
      author: 'user',
    });
    const stored = localStorage.getItem('hermes.smartApprovalEngine');
    expect(stored).toBeTruthy();
  });

  it('should restore user rules on new engine', () => {
    const e1 = new SmartApprovalEngine({ persist: true });
    e1.addRule({
      name: 'Restored',
      description: 'Restore',
      actionTypes: ['shell'],
      match: { type: 'contains', value: 'restore' },
      decision: 'allow',
      reason: 'restore',
      priority: 50,
      enabled: true,
      tags: [],
      author: 'user',
    });
    const e2 = new SmartApprovalEngine({ persist: true });
    const restored = e2.getAllRules().find((r) => r.name === 'Restored');
    expect(restored).toBeDefined();
  });
});

describe('SmartApprovalEngine - Reset to Builtins', () => {
  it('should clear user rules', () => {
    const e = new SmartApprovalEngine({ persist: false });
    e.addRule({
      name: 'User',
      description: '',
      actionTypes: ['shell'],
      match: { type: 'contains', value: 'user' },
      decision: 'allow',
      reason: 'user',
      priority: 50,
      enabled: true,
      tags: [],
      author: 'user',
    });
    expect(e.getAllRules().length).toBeGreaterThan(TOTAL_BUILTIN_RULES);
    e.resetToBuiltins();
    expect(e.getAllRules().length).toBe(TOTAL_BUILTIN_RULES);
  });
});

describe('getDefaultSmartApprovalEngine', () => {
  beforeEach(() => {
    resetDefaultSmartApprovalEngine();
  });

  it('should return singleton', () => {
    const a = getDefaultSmartApprovalEngine();
    const b = getDefaultSmartApprovalEngine();
    expect(a).toBe(b);
  });

  it('should reset via resetDefault', () => {
    const a = getDefaultSmartApprovalEngine();
    resetDefaultSmartApprovalEngine();
    const b = getDefaultSmartApprovalEngine();
    expect(a).not.toBe(b);
  });
});
