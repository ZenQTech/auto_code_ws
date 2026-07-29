/**
 * # ============================================================
 * # ModelRouterEnhance 单元测试 (Cycle 22 G22-04)
 * # ============================================================
 * # 测试 ModelRouterEnhance 所有公开方法和边界条件
 * # ============================================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ModelRouterEnhance,
  getModelRouterEnhance,
  resetModelRouterEnhance,
  type RouteResult,
} from './modelRouterEnhance';

beforeEach(() => {
  resetModelRouterEnhance();
});

afterEach(() => {
  resetModelRouterEnhance();
});

/**
 * 构造模拟路由结果
 */
function makeRoute(model: string, candidates?: string[]): RouteResult {
  return {
    selectedModel: model,
    candidates: (candidates || [model, 'gpt-4o', 'deepseek-v3.2']).map((m) => ({ model: m, score: Math.random() })),
    reason: 'Mock route',
    mode: 'balance',
  };
}

describe('ModelRouterEnhance - 策略管理', () => {
  it('应能创建团队策略', () => {
    const enhancer = new ModelRouterEnhance();
    const policy = enhancer.createTeamPolicy('team-1', 'Team 1');
    expect(policy.teamId).toBe('team-1');
    expect(policy.policyId).toBeDefined();
    expect(policy.status).toBe('active');
  });

  it('重复创建应抛出', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'Team 1');
    expect(() => enhancer.createTeamPolicy('team-1', 'Team 1')).toThrow();
  });

  it('应能更新团队策略', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'Team 1');
    const updated = enhancer.updateTeamPolicy('team-1', { defaultMode: 'cost' });
    expect(updated?.defaultMode).toBe('cost');
  });

  it('应能删除团队策略', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'Team 1');
    expect(enhancer.deleteTeamPolicy('team-1')).toBe(true);
    expect(enhancer.getTeamPolicy('team-1')).toBeNull();
  });

  it('删除不存在的策略应返回 false', () => {
    const enhancer = new ModelRouterEnhance();
    expect(enhancer.deleteTeamPolicy('nonexistent')).toBe(false);
  });

  it('应能列出策略', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1');
    enhancer.createTeamPolicy('team-2', 'T2');
    const list = enhancer.listTeamPolicies();
    expect(list.length).toBe(2);
  });

  it('应能按状态过滤', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1');
    enhancer.setPolicyStatus('team-1', 'paused');
    const active = enhancer.listTeamPolicies({ status: 'active' });
    expect(active.length).toBe(0);
  });
});

describe('ModelRouterEnhance - 白名单管理', () => {
  it('应能添加到白名单', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1');
    expect(enhancer.addToWhitelist('team-1', 'claude-sonnet-4.5')).toBe(true);
    const policy = enhancer.getTeamPolicy('team-1')!;
    expect(policy.whitelist).toContain('claude-sonnet-4.5');
  });

  it('在黑名单中的模型不能再加入白名单', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1', { blacklist: ['claude-sonnet-4.5'] });
    expect(() => enhancer.addToWhitelist('team-1', 'claude-sonnet-4.5')).toThrow();
  });

  it('应能从白名单移除', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1', { whitelist: ['claude-sonnet-4.5'] });
    expect(enhancer.removeFromWhitelist('team-1', 'claude-sonnet-4.5')).toBe(true);
    expect(enhancer.getTeamPolicy('team-1')!.whitelist).not.toContain('claude-sonnet-4.5');
  });

  it('白名单中不存在的模型移除应返回 false', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1');
    expect(enhancer.removeFromWhitelist('team-1', 'nonexistent')).toBe(false);
  });
});

describe('ModelRouterEnhance - 黑名单管理', () => {
  it('应能添加到黑名单', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1');
    expect(enhancer.addToBlacklist('team-1', 'gpt-5')).toBe(true);
    expect(enhancer.getTeamPolicy('team-1')!.blacklist).toContain('gpt-5');
  });

  it('在白名单中的模型不能再加入黑名单', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1', { whitelist: ['claude-sonnet-4.5'] });
    expect(() => enhancer.addToBlacklist('team-1', 'claude-sonnet-4.5')).toThrow();
  });

  it('应能从黑名单移除', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1', { blacklist: ['gpt-5'] });
    expect(enhancer.removeFromBlacklist('team-1', 'gpt-5')).toBe(true);
  });
});

describe('ModelRouterEnhance - 策略应用', () => {
  it('无策略时应透传', () => {
    const enhancer = new ModelRouterEnhance();
    const route = makeRoute('claude-sonnet-4.5');
    const result = enhancer.applyPolicyToRoute('team-1', route);
    expect(result.policyApplied).toBe(false);
    expect(result.blocked).toBe(false);
    expect(result.actualModel).toBe('claude-sonnet-4.5');
    expect(result.displayModel).toBe('claude-sonnet-4.5');
  });

  it('正常路由应通过策略', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1');
    const route = makeRoute('claude-sonnet-4.5');
    const result = enhancer.applyPolicyToRoute('team-1', route);
    expect(result.policyApplied).toBe(true);
    expect(result.actualModel).toBe('claude-sonnet-4.5');
  });

  it('黑名单命中且有候选 fallback', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1', { blacklist: ['claude-sonnet-4.5'] });
    const route = makeRoute('claude-sonnet-4.5', ['gpt-4o', 'deepseek-v3.2']);
    const result = enhancer.applyPolicyToRoute('team-1', route);
    expect(result.actualModel).not.toBe('claude-sonnet-4.5');
    expect(result.fallbackApplied).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('黑名单命中且无候选 fallback 时应阻止', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1', { blacklist: ['claude-sonnet-4.5', 'gpt-4o', 'deepseek-v3.2'] });
    const route = makeRoute('claude-sonnet-4.5', ['claude-sonnet-4.5', 'gpt-4o', 'deepseek-v3.2']);
    const result = enhancer.applyPolicyToRoute('team-1', route);
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBeDefined();
  });

  it('bypassBlacklist 可绕过黑名单', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1', { blacklist: ['claude-sonnet-4.5'] });
    const route = makeRoute('claude-sonnet-4.5');
    const result = enhancer.applyPolicyToRoute('team-1', route, { bypassBlacklist: true });
    expect(result.blocked).toBe(false);
    expect(result.actualModel).toBe('claude-sonnet-4.5');
  });

  it('白名单不命中且有候选 fallback', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1', { whitelist: ['gpt-4o'] });
    const route = makeRoute('claude-sonnet-4.5', ['claude-sonnet-4.5', 'gpt-4o']);
    const result = enhancer.applyPolicyToRoute('team-1', route);
    expect(result.actualModel).toBe('gpt-4o');
    expect(result.fallbackApplied).toBe(true);
  });

  it('白名单不命中且无候选 fallback 时应阻止', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1', { whitelist: ['gpt-4o'] });
    const route = makeRoute('claude-sonnet-4.5', ['claude-sonnet-4.5', 'deepseek-v3.2']);
    const result = enhancer.applyPolicyToRoute('team-1', route);
    expect(result.blocked).toBe(true);
  });
});

describe('ModelRouterEnhance - 显示控制', () => {
  it('hideActualModel=true 时应隐藏', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1', { hideActualModel: true });
    const route = makeRoute('claude-sonnet-4.5');
    const result = enhancer.applyPolicyToRoute('team-1', route);
    expect(result.displayModel).not.toBe('claude-sonnet-4.5');
    expect(result.displayModel).toBe('premium-model');
  });

  it('hideActualModel=false 时应显示真实模型', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1', { hideActualModel: false });
    const route = makeRoute('claude-sonnet-4.5');
    const result = enhancer.applyPolicyToRoute('team-1', route);
    expect(result.displayModel).toBe('claude-sonnet-4.5');
  });

  it('gpt 模型应显示为 fast-model', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1', { hideActualModel: true });
    const route = makeRoute('gpt-4o');
    const result = enhancer.applyPolicyToRoute('team-1', route);
    expect(result.displayModel).toBe('fast-model');
  });

  it('deepseek 模型应显示为 budget-model', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1', { hideActualModel: true });
    const route = makeRoute('deepseek-v3.2');
    const result = enhancer.applyPolicyToRoute('team-1', route);
    expect(result.displayModel).toBe('budget-model');
  });

  it('应能动态切换 hideActualModel', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1');
    enhancer.setHideActualModel('team-1', true);
    expect(enhancer.getTeamPolicy('team-1')!.hideActualModel).toBe(true);
    enhancer.setHideActualModel('team-1', false);
    expect(enhancer.getTeamPolicy('team-1')!.hideActualModel).toBe(false);
  });
});

describe('ModelRouterEnhance - 模式控制', () => {
  it('应能设置团队默认模式', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1');
    expect(enhancer.setTeamMode('team-1', 'cost')).toBe(true);
    expect(enhancer.getTeamPolicy('team-1')!.defaultMode).toBe('cost');
  });

  it('不在 allowedModes 中应抛出', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1', { allowedModes: ['cost', 'balance'] });
    expect(() => enhancer.setTeamMode('team-1', 'intelligence')).toThrow();
  });

  it('应能切换策略状态', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1');
    enhancer.setPolicyStatus('team-1', 'paused');
    expect(enhancer.getTeamPolicy('team-1')!.status).toBe('paused');
  });
});

describe('ModelRouterEnhance - 历史与报告', () => {
  it('应记录路由历史', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1');
    const route = makeRoute('claude-sonnet-4.5');
    enhancer.applyPolicyToRoute('team-1', route);
    const history = enhancer.getHistory();
    expect(history.length).toBe(1);
  });

  it('应能按 teamId 过滤历史', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1');
    enhancer.createTeamPolicy('team-2', 'T2');
    enhancer.applyPolicyToRoute('team-1', makeRoute('claude-sonnet-4.5'));
    enhancer.applyPolicyToRoute('team-2', makeRoute('gpt-4o'));
    const filtered = enhancer.getHistory({ teamId: 'team-1' });
    expect(filtered.length).toBe(1);
  });

  it('应能按 blocked 过滤历史', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1', { blacklist: ['claude-sonnet-4.5', 'gpt-4o', 'deepseek-v3.2'] });
    enhancer.applyPolicyToRoute('team-1', makeRoute('claude-sonnet-4.5', ['claude-sonnet-4.5', 'gpt-4o', 'deepseek-v3.2']));
    enhancer.applyPolicyToRoute('team-1', makeRoute('gpt-4o'));
    const blocked = enhancer.getHistory({ blocked: true });
    expect(blocked.length).toBeGreaterThan(0);
  });

  it('应能生成管理员报告', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1');
    enhancer.createTeamPolicy('team-2', 'T2');
    enhancer.applyPolicyToRoute('team-1', makeRoute('claude-sonnet-4.5'));
    enhancer.applyPolicyToRoute('team-1', makeRoute('gpt-4o'));
    enhancer.applyPolicyToRoute('team-2', makeRoute('gpt-4o'));
    const report = enhancer.generateAdminReport();
    expect(report.totalPolicies).toBe(2);
    expect(report.activePolicies).toBe(2);
    expect(report.totalRoutes).toBe(3);
    expect(report.topModelsUsed.length).toBeGreaterThan(0);
  });
});

describe('ModelRouterEnhance - 事件订阅', () => {
  it('应触发 policy-created 事件', () => {
    const enhancer = new ModelRouterEnhance();
    const handler = vi.fn();
    enhancer.on('policy-created', handler);
    enhancer.createTeamPolicy('team-1', 'T1');
    expect(handler).toHaveBeenCalled();
  });

  it('应触发 route-blocked 事件', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1', { blacklist: ['claude-sonnet-4.5', 'gpt-4o', 'deepseek-v3.2'] });
    const handler = vi.fn();
    enhancer.on('route-blocked', handler);
    enhancer.applyPolicyToRoute('team-1', makeRoute('claude-sonnet-4.5', ['claude-sonnet-4.5', 'gpt-4o', 'deepseek-v3.2']));
    expect(handler).toHaveBeenCalled();
  });

  it('应触发 model-whitelisted 事件', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1');
    const handler = vi.fn();
    enhancer.on('model-whitelisted', handler);
    enhancer.addToWhitelist('team-1', 'claude-sonnet-4.5');
    expect(handler).toHaveBeenCalled();
  });
});

describe('ModelRouterEnhance - 配置与清理', () => {
  it('应能更新配置', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.updateConfig({ defaultMode: 'cost', defaultHideActualModel: true });
    const config = enhancer.getConfig();
    expect(config.defaultMode).toBe('cost');
    expect(config.defaultHideActualModel).toBe(true);
  });

  it('应能清空所有', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1');
    enhancer.applyPolicyToRoute('team-1', makeRoute('claude-sonnet-4.5'));
    enhancer.clear();
    expect(enhancer.getStats().policyCount).toBe(0);
    expect(enhancer.getStats().historyEntries).toBe(0);
  });

  it('应能获取统计', () => {
    const enhancer = new ModelRouterEnhance();
    enhancer.createTeamPolicy('team-1', 'T1', { whitelist: ['claude-sonnet-4.5'], blacklist: ['gpt-5'] });
    enhancer.createTeamPolicy('team-2', 'T2', { whitelist: ['gpt-4o'] });
    enhancer.applyPolicyToRoute('team-1', makeRoute('claude-sonnet-4.5'));
    const stats = enhancer.getStats();
    expect(stats.policyCount).toBe(2);
    expect(stats.activePolicies).toBe(2);
    expect(stats.totalWhitelistedModels).toBe(2);
    expect(stats.totalBlacklistedModels).toBe(1);
    expect(stats.historyEntries).toBe(1);
  });
});

describe('ModelRouterEnhance - 单例工厂', () => {
  it('getModelRouterEnhance 应返回单例', () => {
    const e1 = getModelRouterEnhance();
    const e2 = getModelRouterEnhance();
    expect(e1).toBe(e2);
  });

  it('resetModelRouterEnhance 应清空状态', () => {
    getModelRouterEnhance();
    resetModelRouterEnhance();
    const e = getModelRouterEnhance();
    expect(e.getStats().policyCount).toBe(0);
  });
});
