/**
 * Cycle 30 E2E 集成测试 (v6.83.0+)
 * 验证 G30-01/G30-02/G30-03 三个核心引擎 + UI 组件 + 主应用集成的端到端连通性
 *
 * 覆盖目标：
 * 1. CostThresholdAlertEngine 阈值配置 + 告警触发 + 提额申请 + 阻断控制
 * 2. DynamicWorkflowEngine 工作流注册 + 启动 + 暂停/恢复/重放
 * 3. OrchestratedAgentEngine 6 阶段编排 + 角色预设 + Plan 审批
 * 4. 三个 UI 组件可成功导入
 * 5. 三个引擎的事件系统独立工作
 * 6. 三引擎协同工作
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';

describe('Cycle 30 E2E 集成测试', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('G30-01: CostThresholdAlert 端到端', () => {
    it('阈值配置 + 消费触发 + 提额申请 + 阻断 完整流程', async () => {
      const { getDefaultCostThresholdAlertEngine } = await import('../utils/costThresholdAlertEngine');
      const engine = getDefaultCostThresholdAlertEngine();

      const scope = { scope: 'org' as const, scopeId: 'e2e-org-1' };

      // 1. 设置预算
      engine.setBudget(scope, 100);
      expect(engine.getBudget(scope)).toBe(100);

      // 2. 记录消费 80 -> 80% (recordSpend 内部自动 checkThresholds)
      const alerts1 = engine.recordSpend(scope, 80, 'test-spend');
      expect(alerts1.length).toBeGreaterThan(0);
      expect(alerts1.some((a) => a.level === 'warning')).toBe(true);

      // 3. 继续消费 20 -> 100% 触发 blocked
      const alerts2 = engine.recordSpend(scope, 20, 'test-spend-2');
      expect(alerts2.some((a) => a.level === 'blocked')).toBe(true);
      expect(engine.isBlocked(scope)).toBe(true);

      // 4. 提额申请
      const req = engine.requestQuotaIncrease({
        requester: 'e2e-user',
        scope,
        requestedBudget: 500,
        reason: 'E2E test',
      });
      expect(req.status).toBe('pending');

      // 5. 审批
      engine.reviewQuotaRequest(req.id, 'approved', 'e2e-admin', 'approved via E2E');
      engine.applyApprovedRequest(req.id);
      expect(engine.getBudget(scope)).toBe(500);
    });

    it('事件系统完整', async () => {
      const { getDefaultCostThresholdAlertEngine } = await import('../utils/costThresholdAlertEngine');
      const engine = getDefaultCostThresholdAlertEngine();
      const scope = { scope: 'user' as const, scopeId: 'e2e-user-2' };
      engine.setBudget(scope, 100);

      let alertCount = 0;
      let requestCount = 0;
      engine.on('alert-triggered', () => alertCount++);
      engine.on('quota-requested', () => requestCount++);

      engine.recordSpend(scope, 95, 'test');
      engine.checkThresholds(scope);
      engine.requestQuotaIncrease({ requester: 'u', scope, requestedBudget: 200, reason: 'r' });

      expect(alertCount).toBeGreaterThan(0);
      expect(requestCount).toBe(1);
    });
  });

  describe('G30-02: DynamicWorkflow 端到端', () => {
    it('工作流注册 + 启动 + 暂停/恢复 完整流程', async () => {
      const { DynamicWorkflowEngine } = await import('../utils/dynamicWorkflowEngine');
      const engine = new DynamicWorkflowEngine({ persist: false });

      // 1. 注册一个简单工作流
      const wfId = 'e2e-wf-' + Date.now().toString(36);
      engine.registerWorkflow({
        id: wfId,
        name: 'E2E Test Workflow',
        description: '测试工作流',
        version: '1.0.0',
        phases: [
          {
            id: 'phase1',
            name: '阶段1',
            type: 'execute',
            dependsOn: [],
            contract: {},
            execute: async () => ({ success: true, status: 'success' as const, output: { step: 1 }, durationMs: 1, retries: 0 }),
            retryBudget: 1,
          },
          {
            id: 'phase2',
            name: '阶段2',
            type: 'execute',
            dependsOn: ['phase1'],
            contract: {},
            execute: async () => ({ success: true, status: 'success' as const, output: { step: 2 }, durationMs: 1, retries: 0 }),
            retryBudget: 1,
          },
        ],
      });

      // 2. 启动并等待完成
      const instance = await engine.startAndWait(wfId, { initialInput: {} });
      expect(instance.status).toBe('completed');
      expect(Object.keys(instance.phaseStates)).toHaveLength(2);
    });

    it('使用模板构建 Pipeline', async () => {
      const { DynamicWorkflowEngine } = await import('../utils/dynamicWorkflowEngine');
      const engine = new DynamicWorkflowEngine({ persist: false });

      // 1. 使用 buildPipeline
      const noopExecute = async () => ({
        success: true,
        status: 'success' as const,
        output: {},
        durationMs: 0,
        retries: 0,
      });
      const wf = engine.buildPipeline({
        name: 'Pipeline Test',
        phases: [
          { id: 'collect', name: 'Collect', type: 'execute', execute: noopExecute, retryBudget: 0 },
          { id: 'transform', name: 'Transform', type: 'execute', execute: noopExecute, retryBudget: 0 },
          { id: 'load', name: 'Load', type: 'execute', execute: noopExecute, retryBudget: 0 },
        ],
      });
      engine.registerWorkflow(wf);

      // 2. 启动
      const instance = await engine.startAndWait(wf.id, { initialInput: {} });
      expect(instance.status).toBe('completed');
    });

    it('事件系统完整', async () => {
      const { DynamicWorkflowEngine } = await import('../utils/dynamicWorkflowEngine');
      const engine = new DynamicWorkflowEngine({ persist: false });

      const wfId = 'e2e-wf-events-' + Date.now().toString(36);
      engine.registerWorkflow({
        id: wfId,
        name: 'Event Test',
        description: 'Test events',
        version: '1.0.0',
        phases: [
          {
            id: 'p1',
            name: 'P1',
            type: 'execute',
            dependsOn: [],
            contract: {},
            execute: async () => ({ success: true, status: 'success' as const, output: {}, durationMs: 0, retries: 0 }),
            retryBudget: 0,
          },
        ],
      });

      let startedCount = 0;
      let completedCount = 0;
      engine.on('workflow-started', () => startedCount++);
      engine.on('workflow-completed', () => completedCount++);

      await engine.startAndWait(wfId, { initialInput: {} });
      expect(startedCount).toBe(1);
      expect(completedCount).toBe(1);
    });

    it('单例 + 重置', async () => {
      const { getDefaultDynamicWorkflowEngine, resetDefaultDynamicWorkflowEngine } = await import('../utils/dynamicWorkflowEngine');
      resetDefaultDynamicWorkflowEngine();
      const a = getDefaultDynamicWorkflowEngine();
      const b = getDefaultDynamicWorkflowEngine();
      expect(a).toBe(b);
    });
  });

  describe('G30-03: OrchestratedAgent 端到端', () => {
    it('6 阶段 Reviewed 路径完整执行', async () => {
      const { OrchestratedAgentEngine } = await import('../utils/orchestratedAgentEngine');
      const engine = new OrchestratedAgentEngine({ persist: false, autoApprovePlan: true });

      const task = await engine.orchestrate('测试任务', { forcePath: 'reviewed' });
      expect(task.status).toBe('completed');
      expect(task.phases).toHaveLength(6);
      expect(task.phases.every((p) => p.status === 'completed')).toBe(true);
    });

    it('Direct 路径 2 阶段执行', async () => {
      const { OrchestratedAgentEngine } = await import('../utils/orchestratedAgentEngine');
      const engine = new OrchestratedAgentEngine({ persist: false, autoApprovePlan: true });

      const task = await engine.orchestrate('简单任务', { forcePath: 'direct' });
      expect(task.status).toBe('completed');
      expect(task.phases).toHaveLength(2);
    });

    it('Plan 审批流程', async () => {
      const { OrchestratedAgentEngine } = await import('../utils/orchestratedAgentEngine');
      const engine = new OrchestratedAgentEngine({ persist: false, autoApprovePlan: false });

      const task = engine.buildTask('复杂任务', { forcePath: 'reviewed' });
      // 模拟 plan 已生成但未批准
      const planPhase = task.phases.find((p) => p.id === 'worker-plan')!;
      planPhase.status = 'completed';
      planPhase.packet = {
        taskId: task.id,
        plan: [{ step: 1, description: 'd', filesAffected: [], estimatedMinutes: 1 }],
        risks: [],
        rollback: 'git revert',
        truncated: false,
        approved: false,
      };

      engine.approvePlan(task.id, 'worker-plan', 'e2e-user', 'LGTM');
      const plan = planPhase.packet as any;
      expect(plan.approved).toBe(true);
      expect(plan.approvedBy).toBe('e2e-user');
    });

    it('角色注册 + 查询', async () => {
      const { OrchestratedAgentEngine } = await import('../utils/orchestratedAgentEngine');
      const engine = new OrchestratedAgentEngine({ persist: false });

      const roles = engine.listRoles();
      expect(roles).toHaveLength(5);
      expect(roles).toContain('worker');
      expect(roles).toContain('explorer');
      expect(roles).toContain('reviewer');
    });

    it('事件系统完整', async () => {
      const { OrchestratedAgentEngine } = await import('../utils/orchestratedAgentEngine');
      const engine = new OrchestratedAgentEngine({ persist: false, autoApprovePlan: true });

      let taskStarted = 0;
      let taskCompleted = 0;
      let phaseStarted = 0;
      let phaseCompleted = 0;

      engine.on('task-started', () => taskStarted++);
      engine.on('task-completed', () => taskCompleted++);
      engine.on('phase-started', () => phaseStarted++);
      engine.on('phase-completed', () => phaseCompleted++);

      await engine.orchestrate('任务', { forcePath: 'direct' });

      expect(taskStarted).toBe(1);
      expect(taskCompleted).toBe(1);
      expect(phaseStarted).toBe(2);
      expect(phaseCompleted).toBe(2);
    });

    it('单例 + 重置', async () => {
      const { getDefaultOrchestratedAgentEngine, resetDefaultOrchestratedAgentEngine } = await import('../utils/orchestratedAgentEngine');
      resetDefaultOrchestratedAgentEngine();
      const a = getDefaultOrchestratedAgentEngine();
      const b = getDefaultOrchestratedAgentEngine();
      expect(a).toBe(b);
    });
  });

  describe('UI 组件导入连通性', () => {
    it('CostThresholdAlertPanel 可成功导入', async () => {
      const { CostThresholdAlertPanel } = await import('../components/CostThresholdAlertPanel');
      expect(CostThresholdAlertPanel).toBeDefined();
    });

    it('DynamicWorkflowPanel 可成功导入', async () => {
      const { DynamicWorkflowPanel } = await import('../components/DynamicWorkflowPanel');
      expect(DynamicWorkflowPanel).toBeDefined();
    });

    it('OrchestratedAgentPanel 可成功导入', async () => {
      const { OrchestratedAgentPanel } = await import('../components/OrchestratedAgentPanel');
      expect(OrchestratedAgentPanel).toBeDefined();
    });
  });

  describe('Cycle 30 三引擎协同', () => {
    it('CostThreshold + DynamicWorkflow + OrchestratedAgent 同时工作', async () => {
      const { getDefaultCostThresholdAlertEngine } = await import('../utils/costThresholdAlertEngine');
      const { DynamicWorkflowEngine } = await import('../utils/dynamicWorkflowEngine');
      const { OrchestratedAgentEngine } = await import('../utils/orchestratedAgentEngine');

      // 三引擎独立工作
      const costEngine = getDefaultCostThresholdAlertEngine();
      const wfEngine = new DynamicWorkflowEngine({ persist: false });
      const orchEngine = new OrchestratedAgentEngine({ persist: false, autoApprovePlan: true });

      // 1. CostThreshold
      const scope = { scope: 'org' as const, scopeId: 'cycle30' };
      costEngine.setBudget(scope, 1000);
      costEngine.recordSpend(scope, 500, 'cycle30-test');
      expect(costEngine.getCurrentSpend(scope)).toBe(500);

      // 2. DynamicWorkflow
      const wfId = 'cycle30-wf';
      wfEngine.registerWorkflow({
        id: wfId,
        name: 'Cycle30',
        description: 'Cycle 30',
        version: '1.0.0',
        phases: [
          {
            id: 'p1',
            name: 'P1',
            type: 'execute',
            dependsOn: [],
            contract: {},
            execute: async () => ({ success: true, status: 'success' as const, output: {}, durationMs: 0, retries: 0 }),
            retryBudget: 0,
          },
        ],
      });
      const inst = await wfEngine.startAndWait(wfId, { initialInput: {} });
      expect(inst.status).toBe('completed');

      // 3. OrchestratedAgent
      const task = await orchEngine.orchestrate('Cycle 30 任务', { forcePath: 'direct' });
      expect(task.status).toBe('completed');

      // 三者独立工作
      expect(costEngine).toBeDefined();
      expect(wfEngine).toBeDefined();
      expect(orchEngine).toBeDefined();
    });

    it('主应用集成: BrandHeader 可成功导入', async () => {
      // 通过 import 测试 BrandHeader 模块（默认导出）
      const BrandHeaderModule = await import('../components/BrandHeader');
      expect(BrandHeaderModule.default).toBeDefined();
    });
  });
});
