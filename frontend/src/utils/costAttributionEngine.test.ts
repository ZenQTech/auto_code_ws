/**
 * CostAttributionEngine 单元测试
 * Cycle 31 G31-01
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  CostAttributionEngine,
  getDefaultCostAttributionEngine,
  resetDefaultCostAttributionEngine,
  convertToBase,
  DEFAULT_ATTRIBUTION_CONFIG,
  type OrgRef,
  type TeamRef,
  type ProjectRef,
  type RepoRef,
  type UserRef,
} from './costAttributionEngine';

describe('CostAttributionEngine', () => {
  let engine: CostAttributionEngine;
  const testOrg: OrgRef = { orgId: 'org-1', name: 'TestOrg' };
  const testTeam: TeamRef = { orgId: 'org-1', teamId: 'team-1', name: 'TestTeam' };
  const testProject: ProjectRef = { orgId: 'org-1', teamId: 'team-1', projectId: 'proj-1', name: 'TestProject' };
  const testRepo: RepoRef = { orgId: 'org-1', teamId: 'team-1', projectId: 'proj-1', repoId: 'repo-1', name: 'TestRepo' };
  const testUser: UserRef = { orgId: 'org-1', userId: 'user-1', name: 'TestUser', ssoId: 'sso-1' };

  beforeEach(() => {
    localStorage.clear();
    engine = new CostAttributionEngine({ persist: false });
    engine.registerOrg(testOrg);
    engine.registerTeam(testTeam);
    engine.registerProject(testProject);
    engine.registerRepo(testRepo);
    engine.registerUser(testUser);
  });

  describe('5 维注册', () => {
    it('注册和获取 Org', () => {
      expect(engine.getOrg('org-1')).toEqual(testOrg);
      expect(engine.listOrgs()).toContainEqual(testOrg);
    });
    it('注册和获取 Team', () => {
      expect(engine.getTeam('team-1')).toEqual(testTeam);
    });
    it('注册和获取 Project', () => {
      expect(engine.getProject('proj-1')).toEqual(testProject);
    });
    it('注册和获取 Repo', () => {
      expect(engine.getRepo('repo-1')).toEqual(testRepo);
    });
    it('注册和获取 User', () => {
      expect(engine.getUser('user-1')).toEqual(testUser);
    });
    it('触发 org-registered 事件', () => {
      const fn = vi.fn();
      engine.on('org-registered', fn);
      engine.registerOrg({ orgId: 'org-2', name: 'Org2' });
      expect(fn).toHaveBeenCalled();
    });
  });

  describe('归因记录', () => {
    it('单次 attribute 生成唯一 ID 和 timestamp', () => {
      const r = engine.attribute({
        user: testUser,
        repo: testRepo,
        project: testProject,
        team: testTeam,
        org: testOrg,
        source: 'llm-call',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
        totalCost: 1.0,
        currency: 'USD',
      });
      expect(r.id).toBeTruthy();
      expect(r.timestamp).toBeGreaterThan(0);
    });
    it('USD 保持原值', () => {
      const r = engine.attribute({
        user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
        source: 'llm-call', model: 'gpt-4', inputTokens: 100, outputTokens: 50, totalCost: 1.5, currency: 'USD',
      });
      expect(r.totalCost).toBe(1.5);
    });
    it('CNY 转换为 USD', () => {
      const r = engine.attribute({
        user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
        source: 'llm-call', model: 'gpt-4', inputTokens: 100, outputTokens: 50, totalCost: 72, currency: 'CNY',
      });
      expect(r.totalCost).toBeCloseTo(10, 1);
    });
    it('触发 attribution-recorded 事件', () => {
      const fn = vi.fn();
      engine.on('attribution-recorded', fn);
      engine.attribute({
        user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
        source: 'llm-call', model: 'gpt-4', inputTokens: 100, outputTokens: 50, totalCost: 1, currency: 'USD',
      });
      expect(fn).toHaveBeenCalled();
    });
    it('maxRecords 限制', () => {
      const smallEngine = new CostAttributionEngine({ persist: false, maxRecords: 3 });
      for (let i = 0; i < 5; i++) {
        smallEngine.attribute({
          user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
          source: 'llm-call', model: 'gpt-4', inputTokens: 10, outputTokens: 10, totalCost: 1, currency: 'USD',
        });
      }
      expect(smallEngine.getRecordCount()).toBe(3);
    });
  });

  describe('聚合查询', () => {
    beforeEach(() => {
      engine.attribute({
        user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
        source: 'llm-call', model: 'gpt-4', inputTokens: 100, outputTokens: 50, totalCost: 1.0, currency: 'USD',
      });
      engine.attribute({
        user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
        source: 'agent-run', model: 'claude-3', inputTokens: 200, outputTokens: 100, totalCost: 2.5, currency: 'USD',
      });
    });

    it('getByOrg 聚合', () => {
      const report = engine.getByOrg('org-1', { from: Date.now() - 60000, to: Date.now() + 60000 });
      expect(report.dimension).toBe('org');
      expect(report.totalCost).toBeCloseTo(3.5, 2);
      expect(report.callCount).toBe(2);
      expect(report.totalInputTokens).toBe(300);
    });
    it('getByTeam 聚合', () => {
      const report = engine.getByTeam('team-1', { from: Date.now() - 60000, to: Date.now() + 60000 });
      expect(report.dimension).toBe('team');
      expect(report.totalCost).toBeCloseTo(3.5, 2);
    });
    it('getByProject 聚合', () => {
      const report = engine.getByProject('proj-1', { from: Date.now() - 60000, to: Date.now() + 60000 });
      expect(report.dimension).toBe('project');
    });
    it('getByRepo 聚合', () => {
      const report = engine.getByRepo('repo-1', { from: Date.now() - 60000, to: Date.now() + 60000 });
      expect(report.dimension).toBe('repo');
    });
    it('getByUser 聚合', () => {
      const report = engine.getByUser('user-1', { from: Date.now() - 60000, to: Date.now() + 60000 });
      expect(report.dimension).toBe('user');
    });
    it('report 包含 averageCost', () => {
      const report = engine.getByOrg('org-1', { from: Date.now() - 60000, to: Date.now() + 60000 });
      expect(report.averageCost).toBeCloseTo(1.75, 2);
    });
    it('report 包含 topModels', () => {
      const report = engine.getByOrg('org-1', { from: Date.now() - 60000, to: Date.now() + 60000 });
      expect(report.topModels).toBeDefined();
      expect(report.topModels!.length).toBe(2);
    });
  });

  describe('跨维度复合查询', () => {
    it('按 model 过滤', () => {
      engine.attribute({
        user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
        source: 'llm-call', model: 'gpt-4', inputTokens: 100, outputTokens: 50, totalCost: 1, currency: 'USD',
      });
      engine.attribute({
        user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
        source: 'llm-call', model: 'claude-3', inputTokens: 100, outputTokens: 50, totalCost: 2, currency: 'USD',
      });
      const report = engine.getCrossDimensional({
        model: 'gpt-4',
        period: { from: Date.now() - 60000, to: Date.now() + 60000 },
      });
      expect(report.callCount).toBe(1);
    });
    it('按 user 过滤', () => {
      engine.attribute({
        user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
        source: 'llm-call', model: 'gpt-4', inputTokens: 100, outputTokens: 50, totalCost: 1, currency: 'USD',
      });
      const report = engine.getCrossDimensional({
        userId: 'user-1',
        period: { from: Date.now() - 60000, to: Date.now() + 60000 },
      });
      expect(report.callCount).toBe(1);
    });
  });

  describe('异常告警', () => {
    it('setAlertThreshold + getAlertThreshold', () => {
      engine.setAlertThreshold('user:user-1', 100);
      expect(engine.getAlertThreshold('user:user-1')).toBe(100);
    });
    it('预算超支告警', () => {
      engine.setAlertThreshold('user:user-1', 5);
      const fn = vi.fn();
      engine.on('anomaly-detected', fn);
      for (let i = 0; i < 6; i++) {
        engine.attribute({
          user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
          source: 'llm-call', model: 'gpt-4', inputTokens: 100, outputTokens: 50, totalCost: 1, currency: 'USD',
        });
      }
      expect(fn).toHaveBeenCalled();
    });
    it('单次成本异常', () => {
      // 准备 5 个低额记录作为基线
      for (let i = 0; i < 5; i++) {
        engine.attribute({
          user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
          source: 'llm-call', model: 'gpt-4', inputTokens: 100, outputTokens: 50, totalCost: 1, currency: 'USD',
        });
      }
      const fn = vi.fn();
      engine.on('anomaly-detected', fn);
      // 第 6 个高额记录
      engine.attribute({
        user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
        source: 'llm-call', model: 'gpt-4', inputTokens: 100, outputTokens: 50, totalCost: 100, currency: 'USD',
      });
      expect(fn).toHaveBeenCalled();
    });
    it('getAnomalies 返回超支告警', () => {
      engine.setAlertThreshold('user:user-1', 5);
      for (let i = 0; i < 6; i++) {
        engine.attribute({
          user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
          source: 'llm-call', model: 'gpt-4', inputTokens: 100, outputTokens: 50, totalCost: 1, currency: 'USD',
        });
      }
      const anomalies = engine.getAnomalies({ from: Date.now() - 60000, to: Date.now() + 60000 });
      expect(anomalies.length).toBeGreaterThan(0);
    });
  });

  describe('导出', () => {
    beforeEach(() => {
      engine.attribute({
        user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
        source: 'llm-call', model: 'gpt-4', inputTokens: 100, outputTokens: 50, totalCost: 1, currency: 'USD',
      });
    });
    it('exportCSV 包含表头和记录', () => {
      const csv = engine.exportCSV({ period: { from: Date.now() - 60000, to: Date.now() + 60000 } });
      expect(csv).toContain('id,timestamp,org,team,project,repo,user,model');
      expect(csv).toContain('user-1');
    });
    it('exportJSON 是有效 JSON', () => {
      const json = engine.exportJSON({ period: { from: Date.now() - 60000, to: Date.now() + 60000 } });
      const parsed = JSON.parse(json);
      expect(parsed.records).toBeDefined();
      expect(parsed.records.length).toBe(1);
    });
    it('exportChargeback 包含 lineItems', () => {
      const cb = engine.exportChargeback({ period: { from: Date.now() - 60000, to: Date.now() + 60000 } });
      expect(cb.lineItems).toBeDefined();
      expect(cb.lineItems.length).toBe(1);
      expect(cb.totalAmount).toBeCloseTo(1, 2);
    });
  });

  describe('事件系统', () => {
    it('on 返回退订函数', () => {
      const fn = vi.fn();
      const off = engine.on('attribution-recorded', fn);
      engine.attribute({
        user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
        source: 'llm-call', model: 'gpt-4', inputTokens: 100, outputTokens: 50, totalCost: 1, currency: 'USD',
      });
      expect(fn).toHaveBeenCalledTimes(1);
      off();
      engine.attribute({
        user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
        source: 'llm-call', model: 'gpt-4', inputTokens: 100, outputTokens: 50, totalCost: 1, currency: 'USD',
      });
      expect(fn).toHaveBeenCalledTimes(1);
    });
    it('监听器错误不影响其他监听器', () => {
      const fn1 = vi.fn(() => { throw new Error('oops'); });
      const fn2 = vi.fn();
      engine.on('org-registered', fn1);
      engine.on('org-registered', fn2);
      engine.registerOrg({ orgId: 'org-x', name: 'X' });
      expect(fn2).toHaveBeenCalled();
    });
  });

  describe('持久化', () => {
    it('持久化后新实例加载状态', () => {
      const e1 = new CostAttributionEngine();
      e1.registerOrg({ orgId: 'persist-org', name: 'Persist' });
      const e2 = new CostAttributionEngine();
      expect(e2.getOrg('persist-org')).toBeDefined();
    });
    it('reset 清空所有数据', () => {
      engine.reset();
      expect(engine.getOrg('org-1')).toBeUndefined();
      expect(engine.getRecordCount()).toBe(0);
    });
  });

  describe('单例', () => {
    it('getDefaultCostAttributionEngine 返回同一实例', () => {
      resetDefaultCostAttributionEngine();
      const a = getDefaultCostAttributionEngine();
      const b = getDefaultCostAttributionEngine();
      expect(a).toBe(b);
    });
  });

  describe('工具函数', () => {
    it('convertToBase USD 保持', () => {
      expect(convertToBase(10, 'USD', DEFAULT_ATTRIBUTION_CONFIG)).toBe(10);
    });
    it('convertToBase CNY 转换', () => {
      const result = convertToBase(72, 'CNY', DEFAULT_ATTRIBUTION_CONFIG);
      expect(result).toBeCloseTo(10, 1);
    });
    it('convertToBase 未知货币保持原值', () => {
      expect(convertToBase(10, 'XYZ', DEFAULT_ATTRIBUTION_CONFIG)).toBe(10);
    });
  });

  describe('边界条件', () => {
    it('空时段返回 0 成本', () => {
      const report = engine.getByOrg('org-1', { from: 0, to: 1 });
      expect(report.totalCost).toBe(0);
      expect(report.callCount).toBe(0);
    });
    it('clearRecords 清空记录但保留注册', () => {
      engine.attribute({
        user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
        source: 'llm-call', model: 'gpt-4', inputTokens: 100, outputTokens: 50, totalCost: 1, currency: 'USD',
      });
      engine.clearRecords();
      expect(engine.getRecordCount()).toBe(0);
      expect(engine.getOrg('org-1')).toBeDefined();
    });
    it('getRecords 无过滤返回全部', () => {
      engine.attribute({
        user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
        source: 'llm-call', model: 'gpt-4', inputTokens: 100, outputTokens: 50, totalCost: 1, currency: 'USD',
      });
      expect(engine.getRecords().length).toBe(1);
    });
    it('getRecords 带过滤返回子集', () => {
      engine.attribute({
        user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
        source: 'llm-call', model: 'gpt-4', inputTokens: 100, outputTokens: 50, totalCost: 1, currency: 'USD',
      });
      engine.attribute({
        user: testUser, repo: testRepo, project: testProject, team: testTeam, org: testOrg,
        source: 'workflow', model: 'gpt-4', inputTokens: 100, outputTokens: 50, totalCost: 1, currency: 'USD',
      });
      const filtered = engine.getRecords((r) => r.source === 'workflow');
      expect(filtered.length).toBe(1);
    });
  });
});

// 补充 vi.fn() 类型
declare const vi: any;
