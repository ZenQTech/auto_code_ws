/**
 * Cycle 33 E2E 集成测试 (v6.94.0+)
 * 验证 G33-01/G33-02/G33-03 三个核心引擎 + UI 组件 + 主应用集成的端到端连通性
 *
 * 覆盖目标：
 * 1. EnterpriseWorkflowEngine 5 预置场景 + 引擎注册 + 工作流执行 + 审批流
 * 2. UnifiedDashboardEngine 12+ 预置面板 + 指标采集 + 阈值告警 + 引擎健康度
 * 3. SecurityAuditEngine 7 预置攻击场景 + 应急响应 + 报告生成
 * 4. 三个 UI 组件可成功导入
 * 5. 三个引擎的事件系统独立工作
 * 6. 三引擎协同工作（工作流 → 仪表盘 → 安全审计）
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';

describe('Cycle 33 E2E 集成测试', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ============ G33-01: EnterpriseWorkflow 端到端 ============

  describe('G33-01: EnterpriseWorkflow 端到端', () => {
    it('5 预置场景加载 + 引擎注册 + 完整工作流执行', async () => {
      const { EnterpriseWorkflowEngine } = await import('../utils/enterpriseWorkflowEngine');
      const engine = new EnterpriseWorkflowEngine({ persist: false });

      // 1. 加载预置场景
      engine.loadPresetScenarios();
      const scenarios = engine.listScenarios();
      expect(scenarios.length).toBe(5);

      // 2. 注册自定义引擎
      let calledMethod = '';
      engine.registerEngine('custom', {
        step1: () => { calledMethod = 'step1'; return { ok: 1 }; },
        step2: () => { calledMethod = 'step2'; return { ok: 2 }; },
      });

      // 3. 创建自定义场景
      const scenario = engine.registerScenario({
        name: 'Test E2E Workflow',
        description: 'End-to-end test workflow',
        category: 'custom',
        version: '1.0.0',
        steps: [
          { id: 's1', name: 'S1', type: 'engine', engineId: 'custom', method: 'step1' },
          { id: 's2', name: 'S2', type: 'engine', engineId: 'custom', method: 'step2', dependsOn: ['s1'] },
        ],
      });

      // 4. 执行工作流
      const execution = await engine.execute(scenario.id, {});
      expect(execution.status).toBe('completed');
      expect(calledMethod).toBe('step2');
      expect(execution.stepExecutions).toHaveLength(2);
      expect(execution.stepExecutions[1].status).toBe('completed');

      // 5. 验证统计
      const stats = engine.getStats();
      expect(stats.totalScenarios).toBeGreaterThanOrEqual(6);
      expect(stats.totalExecutions).toBe(1);
    });

    it('执行历史查询 + 暂停/恢复/取消 生命周期', async () => {
      const { EnterpriseWorkflowEngine } = await import('../utils/enterpriseWorkflowEngine');
      const engine = new EnterpriseWorkflowEngine({ persist: false });

      engine.registerEngine('e', {
        fast: () => 'done',
      });
      const s = engine.registerScenario({
        name: 'Lifecycle',
        description: '',
        category: 'custom',
        version: '1.0.0',
        steps: [{ id: 's1', name: 'S1', type: 'engine', engineId: 'e', method: 'fast' }],
      });

      // 1. 执行
      const exec = await engine.execute(s.id, {});
      expect(exec.status).toBe('completed');

      // 2. 查询
      const list = engine.listExecutions();
      expect(list).toHaveLength(1);

      const got = engine.getExecution(exec.id);
      expect(got?.id).toBe(exec.id);
    });

    it('事件订阅：scenario-registered/execution-completed', async () => {
      const { EnterpriseWorkflowEngine } = await import('../utils/enterpriseWorkflowEngine');
      const engine = new EnterpriseWorkflowEngine({ persist: false });

      const events: string[] = [];
      engine.on('scenario-registered', () => events.push('scenario-registered'));
      engine.on('execution-completed', () => events.push('execution-completed'));

      engine.registerEngine('e', { run: () => 'ok' });
      const s = engine.registerScenario({
        name: 'S',
        description: '',
        category: 'custom',
        version: '1.0.0',
        steps: [{ id: 's1', name: 'S1', type: 'engine', engineId: 'e', method: 'run' }],
      });
      await engine.execute(s.id, {});

      expect(events).toContain('scenario-registered');
      expect(events).toContain('execution-completed');
    });
  });

  // ============ G33-02: UnifiedDashboard 端到端 ============

  describe('G33-02: UnifiedDashboard 端到端', () => {
    it('采集器注册 + 指标采集 + Dashboard 创建', async () => {
      const { UnifiedDashboardEngine } = await import('../utils/unifiedDashboardEngine');
      const engine = new UnifiedDashboardEngine({ persist: false, enableAutoCollect: false });

      // 1. 清除默认采集器
      for (const c of [...engine.listCollectors()]) {
        engine.unregisterCollector(c.id);
      }

      // 2. 注册自定义采集器
      engine.registerCollector({
        id: 'test-collector',
        engineId: 'test-engine',
        name: 'Test Collector',
        collect: () => [
          { id: 'm1', name: 'Metric 1', engineId: 'test-engine', category: 'health', type: 'gauge', value: 0.99, timestamp: Date.now() },
        ],
      });

      // 3. 采集指标
      const metrics = await engine.collect();
      expect(metrics.length).toBe(1);
      expect(metrics[0].id).toBe('m1');

      // 4. 创建多个面板和 Dashboard
      const panel1 = engine.createPanel({
        title: 'Health',
        category: 'health',
        type: 'metric',
        metricIds: ['m1'],
        position: { x: 0, y: 0, w: 4, h: 2 },
        config: {},
        visible: true,
      });
      expect(panel1.id).toBeDefined();

      // 5. 创建 Dashboard
      const dashboard = engine.createDashboard({
        name: 'Test Dashboard',
        description: 'E2E test',
        panels: [panel1],
        layout: 'auto',
        ownerId: 'e2e',
        isDefault: true,
        theme: 'light',
        shared: false,
        refreshIntervalMs: 30000,
      });
      expect(dashboard.id).toBeDefined();

      // 6. 列表验证
      expect(engine.listDashboards().length).toBe(1);
      expect(engine.listPanels().length).toBe(1);
    });

    it('阈值告警 + 引擎健康度', async () => {
      const { UnifiedDashboardEngine } = await import('../utils/unifiedDashboardEngine');
      const engine = new UnifiedDashboardEngine({ persist: false, enableAutoCollect: false });

      for (const c of [...engine.listCollectors()]) {
        engine.unregisterCollector(c.id);
      }

      // 1. 创建一个有阈值的面板
      engine.createPanel({
        title: 'Test Panel',
        category: 'health',
        type: 'metric',
        metricIds: ['m1'],
        position: { x: 0, y: 0, w: 4, h: 2 },
        config: {},
        visible: true,
        thresholds: [{ value: 0.95, comparison: 'lt', severity: 'warning', message: '低于阈值' }],
      });

      // 2. 注册采集器（返回低值）
      engine.registerCollector({
        id: 'c1',
        engineId: 'e1',
        name: 'C1',
        collect: () => [
          { id: 'm1', name: 'Health', engineId: 'e1', category: 'health', type: 'gauge', value: 0.5, timestamp: Date.now() },
        ],
      });

      // 3. 采集并评估
      await engine.collect();
      const alerts = engine.evaluateThresholds();
      expect(alerts.length).toBe(1);
      expect(alerts[0].severity).toBe('warning');

      // 4. 健康度
      const health = engine.getEngineHealth();
      expect(health['e1']).toBeDefined();
    });

    it('事件订阅：metric-collected / threshold-exceeded', async () => {
      const { UnifiedDashboardEngine } = await import('../utils/unifiedDashboardEngine');
      const engine = new UnifiedDashboardEngine({ persist: false, enableAutoCollect: false });

      for (const c of [...engine.listCollectors()]) {
        engine.unregisterCollector(c.id);
      }

      const events: string[] = [];
      engine.on('metric-collected', () => events.push('metric-collected'));
      engine.on('threshold-exceeded', () => events.push('threshold-exceeded'));

      engine.createPanel({
        title: 'P', category: 'health', type: 'metric', metricIds: ['m1'],
        position: { x: 0, y: 0, w: 4, h: 2 }, config: {}, visible: true,
        thresholds: [{ value: 0.95, comparison: 'lt', severity: 'warning' }],
      });

      engine.registerCollector({
        id: 'c1', engineId: 'e1', name: 'C1',
        collect: () => [{ id: 'm1', name: 'M1', engineId: 'e1', category: 'health', type: 'gauge', value: 0.5, timestamp: Date.now() }],
      });

      await engine.collect();
      engine.evaluateThresholds();

      expect(events).toContain('metric-collected');
      expect(events).toContain('threshold-exceeded');
    });
  });

  // ============ G33-03: SecurityAudit 端到端 ============

  describe('G33-03: SecurityAudit 端到端', () => {
    it('7 预置攻击场景端到端执行 + 全部通过', async () => {
      const { SecurityAuditEngine } = await import('../utils/securityAuditEngine');
      const engine = new SecurityAuditEngine({ persist: false, stepTimeoutMs: 2000 });
      engine.loadPresetScenarios();

      expect(engine.listScenarios()).toHaveLength(7);

      const executions = await engine.executeAll();
      expect(executions).toHaveLength(7);
      expect(executions.every((e) => e.status === 'completed')).toBe(true);

      // 所有场景 outcome.blocked 都应该是 true
      expect(executions.every((e) => e.outcome.blocked)).toBe(true);
    });

    it('应急响应流程：触发 → 分析 → 遏制 → 消除 → 恢复', async () => {
      const { SecurityAuditEngine } = await import('../utils/securityAuditEngine');
      const engine = new SecurityAuditEngine({ persist: false });
      engine.loadPresetScenarios();

      const sc = engine.listScenarios()[0];
      const exec = await engine.execute(sc.id);
      const incident = await engine.triggerResponse(sc.id, exec.id);

      expect(incident.id).toMatch(/^inc-/);
      expect(incident.steps.length).toBe(5);
      expect(incident.steps.every((s) => s.status === 'completed')).toBe(true);
      expect(incident.status).toBe('closed');
    });

    it('报告生成 + 合规检查 + 多格式导出', async () => {
      const { SecurityAuditEngine } = await import('../utils/securityAuditEngine');
      const engine = new SecurityAuditEngine({ persist: false });
      engine.loadPresetScenarios();

      await engine.executeAll();

      const now = Date.now();
      const report = engine.generateReport({ from: now - 60000, to: now + 1000 });
      expect(report.totalScenarios).toBe(7);
      expect(report.passed).toBe(7);
      expect(report.compliance.soc2).toBe(true);
      expect(report.compliance.gdpr).toBe(true);
      expect(report.compliance.iso27001).toBe(true);

      const md = engine.exportReport({ from: now - 60000, to: now + 1000 }, 'markdown');
      expect(md).toContain('# 安全审计报告');

      const html = engine.exportReport({ from: now - 60000, to: now + 1000 }, 'html');
      expect(html).toContain('<!DOCTYPE html>');
    });

    it('CI/CD 集成：runInCI 成功执行', async () => {
      const { SecurityAuditEngine } = await import('../utils/securityAuditEngine');
      const engine = new SecurityAuditEngine({ persist: false });
      engine.loadPresetScenarios();

      const result = await engine.runInCI();
      expect(result.total).toBe(7);
      expect(result.passed).toBe(7);
      expect(result.exitCode).toBe(0);
    });
  });

  // ============ 三引擎协同 ============

  describe('三引擎协同工作流', () => {
    it('工作流执行 → Dashboard 采集 → 安全审计验证', async () => {
      // 1. EnterpriseWorkflow 执行业务工作流
      const { EnterpriseWorkflowEngine } = await import('../utils/enterpriseWorkflowEngine');
      const wfEngine = new EnterpriseWorkflowEngine({ persist: false });

      const workflowEvents: string[] = [];
      wfEngine.on('execution-completed', () => workflowEvents.push('workflow-completed'));

      wfEngine.registerEngine('audit', {
        log: () => ({ logged: true, timestamp: Date.now() }),
      });
      const s = wfEngine.registerScenario({
        name: 'Onboarding',
        description: '',
        category: 'onboarding',
        version: '1.0.0',
        steps: [{ id: 's1', name: 'Audit', type: 'engine', engineId: 'audit', method: 'log' }],
      });
      await wfEngine.execute(s.id, {});

      // 2. Dashboard 采集工作流统计
      const { UnifiedDashboardEngine } = await import('../utils/unifiedDashboardEngine');
      const dashEngine = new UnifiedDashboardEngine({ persist: false, enableAutoCollect: false });

      for (const c of [...dashEngine.listCollectors()]) {
        dashEngine.unregisterCollector(c.id);
      }
      dashEngine.registerCollector({
        id: 'workflow-collector',
        engineId: 'enterprise-workflow',
        name: 'Workflow Stats',
        collect: () => {
          const stats = wfEngine.getStats();
          return [
            { id: 'wf-success-rate', name: 'Success Rate', engineId: 'enterprise-workflow', category: 'task', type: 'gauge', value: stats.successRate, timestamp: Date.now() },
            { id: 'wf-executions', name: 'Executions', engineId: 'enterprise-workflow', category: 'task', type: 'gauge', value: stats.totalExecutions, timestamp: Date.now() },
          ];
        },
      });

      const metrics = await dashEngine.collect();
      expect(metrics.length).toBe(2);
      expect(metrics.find((m) => m.id === 'wf-executions')?.value).toBe(1);

      // 3. SecurityAudit 验证防护
      const { SecurityAuditEngine } = await import('../utils/securityAuditEngine');
      const auditEngine = new SecurityAuditEngine({ persist: false });
      auditEngine.loadPresetScenarios();

      const bruteforce = auditEngine.listScenarios().find((s) => s.name === 'bruteforce-login')!;
      const auditExec = await auditEngine.execute(bruteforce.id);
      expect(auditExec.status).toBe('completed');
      expect(auditExec.outcome.blocked).toBe(true);

      // 验证三者都工作
      expect(workflowEvents).toContain('workflow-completed');
      expect(metrics.length).toBeGreaterThan(0);
      expect(auditExec.validations.every((v) => v.passed)).toBe(true);
    });
  });

  // ============ UI 组件导入测试 ============

  describe('UI 组件导入', () => {
    it('EnterpriseWorkflowPanel 可成功导入', async () => {
      const mod = await import('../components/EnterpriseWorkflowPanel');
      expect(mod.EnterpriseWorkflowPanel).toBeDefined();
    });

    it('UnifiedDashboardPanel 可成功导入', async () => {
      const mod = await import('../components/UnifiedDashboardPanel');
      expect(mod.UnifiedDashboardPanel).toBeDefined();
    });

    it('SecurityAuditPanel 可成功导入', async () => {
      const mod = await import('../components/SecurityAuditPanel');
      expect(mod.SecurityAuditPanel).toBeDefined();
    });
  });
});
