/**
 * # Cost Threshold Alert Engine 单元测试 (Cycle 30 G30-01)
 * # 覆盖 30 个核心测试用例
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  CostThresholdAlertEngine,
  generateAlertId,
  scopeKey,
  compareAlertLevel,
  alertLevelLabel,
  DEFAULT_THRESHOLD_CONFIG,
  getDefaultCostThresholdAlertEngine,
  resetDefaultCostThresholdAlertEngine,
} from './costThresholdAlertEngine';
import type { ScopeRef, ThresholdConfig } from './costThresholdAlertEngine';

describe('CostThresholdAlertEngine', () => {
  let engine: CostThresholdAlertEngine;
  const orgScope: ScopeRef = { scope: 'org', scopeId: 'org-1' };
  const teamScope: ScopeRef = { scope: 'team', scopeId: 'team-1' };
  const userScope: ScopeRef = { scope: 'user', scopeId: 'user-1' };

  beforeEach(() => {
    localStorage.clear();
    engine = new CostThresholdAlertEngine({ persist: false });
  });

  // ============ 工具函数测试 ============

  describe('工具函数', () => {
    it('generateAlertId 生成唯一 ID', () => {
      const id1 = generateAlertId();
      const id2 = generateAlertId();
      expect(id1).not.toBe(id2);
      expect(id1.startsWith('alert-')).toBe(true);
    });

    it('scopeKey 正确格式化', () => {
      expect(scopeKey(orgScope)).toBe('org:org-1');
      expect(scopeKey(teamScope)).toBe('team:team-1');
      expect(scopeKey(userScope)).toBe('user:user-1');
    });

    it('compareAlertLevel 正确比较级别', () => {
      expect(compareAlertLevel('warning', 'critical')).toBeLessThan(0);
      expect(compareAlertLevel('critical', 'warning')).toBeGreaterThan(0);
      expect(compareAlertLevel('info', 'info')).toBe(0);
      expect(compareAlertLevel('blocked', 'info')).toBeGreaterThan(0);
    });

    it('alertLevelLabel 返回正确标签', () => {
      expect(alertLevelLabel('info')).toBe('信息');
      expect(alertLevelLabel('warning')).toBe('警告');
      expect(alertLevelLabel('critical')).toBe('严重');
      expect(alertLevelLabel('blocked')).toBe('已阻断');
    });
  });

  // ============ 阈值配置 ============

  describe('阈值配置', () => {
    it('默认阈值正确', () => {
      const thresholds = engine.getThresholds(orgScope);
      expect(thresholds).toEqual(DEFAULT_THRESHOLD_CONFIG);
    });

    it('设置并获取自定义阈值', () => {
      const custom: Partial<ThresholdConfig> = {
        warning: 0.5,
        critical: 0.8,
        blocked: 0.95,
      };
      engine.setThresholds(orgScope, custom);
      expect(engine.getThresholds(orgScope)).toEqual({
        ...DEFAULT_THRESHOLD_CONFIG,
        ...custom,
      });
    });

    it('不同 scope 独立配置', () => {
      engine.setThresholds(orgScope, { warning: 0.5 });
      engine.setThresholds(teamScope, { warning: 0.6 });
      expect(engine.getThresholds(orgScope).warning).toBe(0.5);
      expect(engine.getThresholds(teamScope).warning).toBe(0.6);
    });
  });

  // ============ 预算管理 ============

  describe('预算管理', () => {
    it('默认预算为 0', () => {
      expect(engine.getBudget(orgScope)).toBe(0);
      expect(engine.getCurrentSpend(orgScope)).toBe(0);
    });

    it('设置并获取预算', () => {
      engine.setBudget(orgScope, 100);
      expect(engine.getBudget(orgScope)).toBe(100);
    });

    it('拒绝负数预算', () => {
      expect(() => engine.setBudget(orgScope, -10)).toThrow();
    });

    it('计算利用率', () => {
      engine.setBudget(orgScope, 100);
      engine.recordSpend(orgScope, 25, 'test');
      expect(engine.getUtilization(orgScope)).toBe(0.25);
    });

    it('0 预算时利用率为 0', () => {
      expect(engine.getUtilization(orgScope)).toBe(0);
    });
  });

  // ============ 监控 ============

  describe('监控与告警', () => {
    beforeEach(() => {
      engine.setBudget(orgScope, 100);
    });

    it('记录花费不触发告警（< 75%）', () => {
      const alerts = engine.recordSpend(orgScope, 50, 'test');
      expect(alerts).toHaveLength(0);
    });

    it('75% 触发 warning 告警', () => {
      const alerts = engine.recordSpend(orgScope, 75, 'test');
      expect(alerts).toHaveLength(1);
      expect(alerts[0].level).toBe('warning');
      expect(alerts[0].utilization).toBe(0.75);
    });

    it('90% 触发 critical 告警（同时跨越 warning）', () => {
      // recordSpend 是累加，记录 90 后总花费 90/100 = 90%
      // 跨越 75% (warning) + 90% (critical) 两个阈值
      const alerts = engine.recordSpend(orgScope, 90, 'test');
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      const levels = alerts.map((a) => a.level);
      expect(levels).toContain('critical');
    });

    it('100% 触发 blocked 告警（同时跨越 warning+critical）', () => {
      // 记录 100 后总花费 100/100 = 100%
      // 跨越 75% + 90% + 100% 三个阈值
      const alerts = engine.recordSpend(orgScope, 100, 'test');
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      const levels = alerts.map((a) => a.level);
      expect(levels).toContain('blocked');
    });

    it('降级不重复触发（已触发 warning，再次记录不重复）', () => {
      engine.recordSpend(orgScope, 80, 'test');
      // 已经在 warning，再次记录 5（总 85）仍在 warning 级别，不重复触发 warning
      const alerts = engine.recordSpend(orgScope, 5, 'test');
      expect(alerts.filter((a) => a.level === 'warning')).toHaveLength(0);
    });

    it('升级触发新级别', () => {
      // 第一次记录 76（总 76%，触发 warning）
      engine.recordSpend(orgScope, 76, 'test');
      // 第二次记录 16（总 92%，从 warning 升级到 critical）
      const alerts = engine.recordSpend(orgScope, 16, 'test');
      expect(alerts).toHaveLength(1);
      expect(alerts[0].level).toBe('critical');
    });

    it('0 预算不触发告警', () => {
      const emptyEngine = new CostThresholdAlertEngine({ persist: false });
      const alerts = emptyEngine.recordSpend(orgScope, 1000, 'test');
      expect(alerts).toHaveLength(0);
    });

    it('负数花费报错', () => {
      expect(() => engine.recordSpend(orgScope, -10, 'test')).toThrow();
    });
  });

  // ============ 告警管理 ============

  describe('告警管理', () => {
    beforeEach(() => {
      engine.setBudget(orgScope, 100);
    });

    it('列出活跃告警', () => {
      engine.recordSpend(orgScope, 80, 'test');
      const active = engine.getActiveAlerts(orgScope);
      expect(active).toHaveLength(1);
      expect(active[0].acknowledged).toBe(false);
    });

    it('列出告警历史', () => {
      engine.recordSpend(orgScope, 80, 'test');
      engine.recordSpend(orgScope, 95, 'test');
      const history = engine.getAlertHistory(orgScope);
      expect(history.length).toBeGreaterThanOrEqual(2);
    });

    it('确认告警', () => {
      engine.recordSpend(orgScope, 80, 'test');
      const alertId = engine.getActiveAlerts(orgScope)[0].id;
      const acked = engine.acknowledge(alertId, 'admin-1');
      expect(acked.acknowledged).toBe(true);
      expect(acked.acknowledgedBy).toBe('admin-1');
      expect(engine.getActiveAlerts(orgScope)).toHaveLength(0);
    });

    it('确认不存在的告警报错', () => {
      expect(() => engine.acknowledge('non-existent', 'admin-1')).toThrow();
    });

    it('按 scope 过滤告警', () => {
      engine.setBudget(teamScope, 100);
      engine.recordSpend(orgScope, 80, 'test');
      engine.recordSpend(teamScope, 80, 'test');
      const orgAlerts = engine.getAllAlerts(orgScope);
      const teamAlerts = engine.getAllAlerts(teamScope);
      expect(orgAlerts.every((a) => a.scope.scope === 'org')).toBe(true);
      expect(teamAlerts.every((a) => a.scope.scope === 'team')).toBe(true);
    });
  });

  // ============ 提额申请 ============

  describe('提额申请', () => {
    beforeEach(() => {
      engine.setBudget(orgScope, 100);
    });

    it('提交申请', () => {
      const req = engine.requestQuotaIncrease({
        requester: 'user-1',
        scope: orgScope,
        requestedBudget: 200,
        reason: '需要更多预算',
      });
      expect(req.status).toBe('pending');
      expect(req.incrementAmount).toBe(100);
    });

    it('低于当前预算的申请报错', () => {
      expect(() =>
        engine.requestQuotaIncrease({
          requester: 'user-1',
          scope: orgScope,
          requestedBudget: 50,
          reason: '不合理的申请',
        })
      ).toThrow();
    });

    it('批准申请', () => {
      const req = engine.requestQuotaIncrease({
        requester: 'user-1',
        scope: orgScope,
        requestedBudget: 200,
        reason: '需要',
      });
      const approved = engine.reviewQuotaRequest(req.id, 'approved', 'admin-1');
      expect(approved.status).toBe('approved');
      expect(approved.reviewer).toBe('admin-1');
    });

    it('拒绝申请', () => {
      const req = engine.requestQuotaIncrease({
        requester: 'user-1',
        scope: orgScope,
        requestedBudget: 200,
        reason: '需要',
      });
      const denied = engine.reviewQuotaRequest(
        req.id,
        'denied',
        'admin-1',
        '理由不充分'
      );
      expect(denied.status).toBe('denied');
      expect(denied.reviewComment).toBe('理由不充分');
    });

    it('应用已批准申请', () => {
      const req = engine.requestQuotaIncrease({
        requester: 'user-1',
        scope: orgScope,
        requestedBudget: 200,
        reason: '需要',
      });
      engine.reviewQuotaRequest(req.id, 'approved', 'admin-1');
      const applied = engine.applyApprovedRequest(req.id);
      expect(applied.status).toBe('applied');
      expect(engine.getBudget(orgScope)).toBe(200);
    });

    it('应用未批准的申请报错', () => {
      const req = engine.requestQuotaIncrease({
        requester: 'user-1',
        scope: orgScope,
        requestedBudget: 200,
        reason: '需要',
      });
      expect(() => engine.applyApprovedRequest(req.id)).toThrow();
    });

    it('取消申请', () => {
      const req = engine.requestQuotaIncrease({
        requester: 'user-1',
        scope: orgScope,
        requestedBudget: 200,
        reason: '需要',
      });
      const cancelled = engine.cancelQuotaRequest(req.id, 'user-1');
      expect(cancelled.status).toBe('cancelled');
    });

    it('只有申请人能取消', () => {
      const req = engine.requestQuotaIncrease({
        requester: 'user-1',
        scope: orgScope,
        requestedBudget: 200,
        reason: '需要',
      });
      expect(() => engine.cancelQuotaRequest(req.id, 'user-2')).toThrow();
    });

    it('列出待审批申请', () => {
      engine.requestQuotaIncrease({
        requester: 'user-1',
        scope: orgScope,
        requestedBudget: 200,
        reason: '需要',
      });
      engine.requestQuotaIncrease({
        requester: 'user-2',
        scope: orgScope,
        requestedBudget: 300,
        reason: '需要',
      });
      const pending = engine.listQuotaRequests({ status: 'pending' });
      expect(pending).toHaveLength(2);
    });
  });

  // ============ 阻断控制 ============

  describe('阻断控制', () => {
    beforeEach(() => {
      engine.setBudget(orgScope, 100);
    });

    it('正常情况下不阻断', () => {
      engine.recordSpend(orgScope, 50, 'test');
      expect(engine.isBlocked(orgScope)).toBe(false);
    });

    it('超 100% 触发阻断', () => {
      engine.recordSpend(orgScope, 100, 'test');
      expect(engine.isBlocked(orgScope)).toBe(true);
    });

    it('enforceBlock 返回结果', () => {
      engine.recordSpend(orgScope, 100, 'test');
      const result = engine.enforceBlock(orgScope);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('正常时 enforceBlock 允许', () => {
      const result = engine.enforceBlock(orgScope);
      expect(result.allowed).toBe(true);
    });

    it('绕过阻断', () => {
      engine.recordSpend(orgScope, 100, 'test');
      const record = engine.bypassBlock(orgScope, 'admin-1', '紧急情况');
      expect(record.bypassed).toBe(true);
      expect(record.bypassedBy).toBe('admin-1');
    });

    it('阻断历史', () => {
      engine.recordSpend(orgScope, 100, 'test');
      engine.enforceBlock(orgScope);
      const history = engine.getBlockHistory(orgScope);
      expect(history).toHaveLength(1);
    });
  });

  // ============ 通知 ============

  describe('通知', () => {
    beforeEach(() => {
      engine.setBudget(orgScope, 100);
    });

    it('发送 in-app 通知', () => {
      engine.recordSpend(orgScope, 80, 'test');
      const alert = engine.getActiveAlerts(orgScope)[0];
      const records = engine.sendNotification(alert, {
        channels: ['in-app'],
      });
      expect(records).toHaveLength(1);
      expect(records[0].channel).toBe('in-app');
      expect(records[0].status).toBe('sent');
    });

    it('发送多渠道通知', () => {
      engine.recordSpend(orgScope, 80, 'test');
      const alert = engine.getActiveAlerts(orgScope)[0];
      const records = engine.sendNotification(alert, {
        channels: ['in-app', 'email'],
        emailRecipients: ['admin@example.com'],
      });
      expect(records.length).toBeGreaterThanOrEqual(2);
    });

    it('通知历史', () => {
      engine.recordSpend(orgScope, 80, 'test');
      const alert = engine.getActiveAlerts(orgScope)[0];
      engine.sendNotification(alert, { channels: ['in-app'] });
      const history = engine.getNotificationHistory();
      expect(history).toHaveLength(1);
    });
  });

  // ============ 事件总线 ============

  describe('事件总线', () => {
    beforeEach(() => {
      engine.setBudget(orgScope, 100);
    });

    it('订阅 alert-triggered 事件', () => {
      const events: any[] = [];
      engine.on('alert-triggered', (e) => events.push(e));
      engine.recordSpend(orgScope, 80, 'test');
      expect(events).toHaveLength(1);
      expect(events[0].data.alert.level).toBe('warning');
    });

    it('订阅 quota-requested 事件', () => {
      const events: any[] = [];
      engine.on('quota-requested', (e) => events.push(e));
      engine.requestQuotaIncrease({
        requester: 'user-1',
        scope: orgScope,
        requestedBudget: 200,
        reason: '需要',
      });
      expect(events).toHaveLength(1);
    });

    it('取消订阅', () => {
      const events: any[] = [];
      const unsub = engine.on('alert-triggered', (e) => events.push(e));
      engine.recordSpend(orgScope, 80, 'test');
      expect(events).toHaveLength(1);
      unsub();
      engine.recordSpend(orgScope, 90, 'test');
      expect(events).toHaveLength(1);  // 不再增加
    });
  });

  // ============ 统计与持久化 ============

  describe('统计与持久化', () => {
    beforeEach(() => {
      engine.setBudget(orgScope, 100);
    });

    it('统计正确', () => {
      engine.recordSpend(orgScope, 80, 'test');
      engine.requestQuotaIncrease({
        requester: 'user-1',
        scope: orgScope,
        requestedBudget: 200,
        reason: '需要',
      });
      const stats = engine.getStats(orgScope);
      expect(stats.activeAlerts).toBeGreaterThanOrEqual(1);
      expect(stats.pendingRequests).toBe(1);
    });

    it('导出状态', () => {
      engine.setBudget(teamScope, 200);
      const state = engine.exportState();
      expect(state.budgets.length).toBeGreaterThanOrEqual(2);
    });

    it('导入状态', () => {
      const newEngine = new CostThresholdAlertEngine({ persist: false });
      newEngine.importState({
        alerts: [
          {
            id: 'a1',
            scope: orgScope,
            level: 'warning',
            threshold: 0.75,
            currentSpend: 80,
            budget: 100,
            utilization: 0.8,
            message: 'test',
            timestamp: Date.now(),
            acknowledged: false,
          },
        ],
        quotaRequests: [],
        notifications: [],
        blocks: [],
        budgets: [{ key: 'org:org-1', budget: 100, spend: 80, thresholds: DEFAULT_THRESHOLD_CONFIG }],
        lastAlertedLevels: [],
      });
      expect(newEngine.getAllAlerts()).toHaveLength(1);
    });

    it('清空状态', () => {
      engine.recordSpend(orgScope, 80, 'test');
      engine.clear();
      expect(engine.getAllAlerts()).toHaveLength(0);
    });
  });

  // ============ 全局单例 ============

  describe('全局单例', () => {
    it('可重复获取', () => {
      resetDefaultCostThresholdAlertEngine();
      const a = getDefaultCostThresholdAlertEngine();
      const b = getDefaultCostThresholdAlertEngine();
      expect(a).toBe(b);
    });
  });
});
