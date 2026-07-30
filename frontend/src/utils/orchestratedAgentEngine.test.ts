/**
 * # ============================================================
 * # Orchestrated Agent Engine 单元测试 (v1.0.0 Cycle 30 G30-03)
 * # ============================================================
 * # 覆盖：角色管理、任务构建、路径选择、阶段执行、计划审批、智能合成
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  OrchestratedAgentEngine,
  DEFAULT_ROLE_CONFIGS,
  DEFAULT_ORCHESTRATOR_CONFIG,
  DEFAULT_SANDBOX_CONFIG,
  generateOrchestratorId,
  getDefaultOrchestratedAgentEngine,
  resetDefaultOrchestratedAgentEngine,
  type OrchestratedTask,
  type WorkerPacket,
  type ReviewPacket,
  type AgentRole,
  type AgentRoleConfig,
} from './orchestratedAgentEngine';

describe('OrchestratedAgentEngine - 基础', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('生成唯一 ID', () => {
    const id1 = generateOrchestratorId();
    const id2 = generateOrchestratorId();
    expect(id1).toMatch(/^orch-\d+-[a-z0-9]+$/);
    expect(id2).toMatch(/^orch-\d+-[a-z0-9]+$/);
    expect(id1).not.toBe(id2);
  });

  it('支持自定义前缀', () => {
    const id = generateOrchestratorId('task');
    expect(id).toMatch(/^task-\d+/);
  });

  it('默认配置完整', () => {
    expect(DEFAULT_ORCHESTRATOR_CONFIG.maxThreads).toBe(6);
    expect(DEFAULT_ORCHESTRATOR_CONFIG.maxDepth).toBe(3);
    expect(DEFAULT_ORCHESTRATOR_CONFIG.maxRetriesPerPhase).toBe(2);
    expect(DEFAULT_ORCHESTRATOR_CONFIG.autoApprovePlan).toBe(true);
    expect(DEFAULT_ORCHESTRATOR_CONFIG.persist).toBe(true);
  });

  it('默认沙箱配置', () => {
    expect(DEFAULT_SANDBOX_CONFIG.mode).toBe('workspace-write');
    expect(DEFAULT_SANDBOX_CONFIG.approvalRequired).toBe(true);
  });

  it('默认角色完整 (5个)', () => {
    expect(Object.keys(DEFAULT_ROLE_CONFIGS)).toHaveLength(5);
    expect(DEFAULT_ROLE_CONFIGS.orchestrator).toBeDefined();
    expect(DEFAULT_ROLE_CONFIGS.worker).toBeDefined();
    expect(DEFAULT_ROLE_CONFIGS.explorer).toBeDefined();
    expect(DEFAULT_ROLE_CONFIGS.reviewer).toBeDefined();
    expect(DEFAULT_ROLE_CONFIGS.synthesizer).toBeDefined();
  });
});

describe('OrchestratedAgentEngine - 角色管理', () => {
  let engine: OrchestratedAgentEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new OrchestratedAgentEngine({ persist: false });
  });

  it('默认注册5个角色', () => {
    const roles = engine.listRoles();
    expect(roles).toHaveLength(5);
  });

  it('获取角色配置', () => {
    const worker = engine.getRole('worker');
    expect(worker.role).toBe('worker');
    expect(worker.sandboxMode).toBe('workspace-write');
    expect(worker.allowedTools).toContain('read');
    expect(worker.allowedTools).toContain('write');
  });

  it('Explorer 角色是只读', () => {
    const explorer = engine.getRole('explorer');
    expect(explorer.sandboxMode).toBe('read-only');
    expect(explorer.allowedTools).not.toContain('write');
  });

  it('注册自定义角色', () => {
    const customRole: AgentRoleConfig = {
      role: 'worker',
      sandboxMode: 'read-only',
      allowedTools: ['read'],
      model: 'custom-model',
      systemPrompt: 'custom',
      isolation: 'thread',
      description: 'custom worker',
    };
    engine.registerRole(customRole);
    const updated = engine.getRole('worker');
    expect(updated.model).toBe('custom-model');
    expect(updated.sandboxMode).toBe('read-only');
  });

  it('注册触发 role-registered 事件', () => {
    const events: any[] = [];
    engine.on('role-registered', (e) => events.push(e));
    engine.registerRole({
      role: 'synthesizer',
      sandboxMode: 'read-only',
      allowedTools: ['read'],
      model: 'm',
      systemPrompt: 'p',
      isolation: 'thread',
      description: 'd',
    });
    expect(events).toHaveLength(1);
  });

  it('获取不存在的角色抛出错误（删除后再获取）', () => {
    // 先清空默认角色
    engine.resetRoles();
    // 直接修改内部 roles map 来清空（仅测试用）
    (engine as any).roles.clear();
    expect(() => engine.getRole('worker')).toThrow();
  });

  it('重置角色为默认', () => {
    engine.registerRole({
      role: 'worker',
      sandboxMode: 'read-only',
      allowedTools: [],
      model: 'm',
      systemPrompt: 'p',
      isolation: 'thread',
      description: 'd',
    });
    expect(engine.getRole('worker').model).toBe('m');
    engine.resetRoles();
    expect(engine.getRole('worker').model).toBe('claude-sonnet-5');
  });
});

describe('OrchestratedAgentEngine - 路径选择', () => {
  let engine: OrchestratedAgentEngine;

  beforeEach(() => {
    engine = new OrchestratedAgentEngine({ persist: false });
  });

  it('高 scopeNarrowness + 高 evidence -> direct', () => {
    const path = engine.selectPath({ scopeNarrowness: 0.95, evidenceAvailable: 0.95 });
    expect(path).toBe('direct');
  });

  it('低 scopeNarrowness + 低 evidence -> reviewed', () => {
    const path = engine.selectPath({ scopeNarrowness: 0.1, evidenceAvailable: 0.1 });
    expect(path).toBe('reviewed');
  });

  it('中等指标倾向于 reviewed', () => {
    const path = engine.selectPath({ scopeNarrowness: 0.5, evidenceAvailable: 0.5 });
    expect(path).toBe('reviewed');
  });

  it('边界值：score = 0.6 -> reviewed (含等号)', () => {
    // scopeNarrowness=0.4, evidenceAvailable=1.0
    // score = (1-0.4) + (1-1.0) = 0.6 + 0 = 0.6
    // 0.6 < 0.6 为 false -> reviewed
    const path = engine.selectPath({ scopeNarrowness: 0.4, evidenceAvailable: 1.0 });
    expect(path).toBe('reviewed');
  });
});

describe('OrchestratedAgentEngine - 任务构建', () => {
  let engine: OrchestratedAgentEngine;

  beforeEach(() => {
    engine = new OrchestratedAgentEngine({ persist: false });
  });

  it('构建直接路径任务：2 phase', () => {
    const task = engine.buildTask('简单修改', { forcePath: 'direct' });
    expect(task.path).toBe('direct');
    expect(task.phases).toHaveLength(2);
    expect(task.phases[0].id).toBe('worker-execute');
    expect(task.phases[1].id).toBe('synthesizer');
  });

  it('构建 reviewed 路径任务：6 phase', () => {
    const task = engine.buildTask('复杂任务', { forcePath: 'reviewed' });
    expect(task.path).toBe('reviewed');
    expect(task.phases).toHaveLength(6);
    expect(task.phases.map((p) => p.id)).toEqual([
      'explorer',
      'worker-plan',
      'plan-review',
      'worker-execute',
      'result-review',
      'synthesizer',
    ]);
  });

  it('skipExplorer 减少 1 phase', () => {
    const task = engine.buildTask('任务', {
      forcePath: 'reviewed',
      skipExplorer: true,
    });
    expect(task.phases).toHaveLength(5);
    expect(task.phases[0].id).toBe('worker-plan');
  });

  it('任务包含 contract', () => {
    const task = engine.buildTask('任务', { forcePath: 'direct' });
    expect(task.contract.goal).toBe('任务');
    expect(task.contract.constraints).toEqual([]);
  });

  it('任务状态初始为 pending', () => {
    const task = engine.buildTask('任务');
    expect(task.status).toBe('pending');
  });

  it('任务 ID 唯一', () => {
    const t1 = engine.buildTask('A');
    const t2 = engine.buildTask('B');
    expect(t1.id).not.toBe(t2.id);
  });

  it('buildTask 不自动执行', () => {
    const task = engine.buildTask('任务');
    expect(task.status).toBe('pending');
    expect(task.startedAt).toBeUndefined();
  });

  it('阶段依赖正确', () => {
    const task = engine.buildTask('任务', { forcePath: 'reviewed' });
    const workerPlan = task.phases.find((p) => p.id === 'worker-plan')!;
    const planReview = task.phases.find((p) => p.id === 'plan-review')!;
    expect(workerPlan.dependsOn).toContain('explorer');
    expect(planReview.dependsOn).toContain('worker-plan');
  });

  it('每阶段有 maxRetries', () => {
    const task = engine.buildTask('任务', { forcePath: 'reviewed' });
    for (const p of task.phases) {
      expect(p.maxRetries).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('OrchestratedAgentEngine - 任务执行（直接路径）', () => {
  let engine: OrchestratedAgentEngine;

  beforeEach(() => {
    engine = new OrchestratedAgentEngine({ persist: false, autoApprovePlan: true });
  });

  it('orchestrate 直接路径执行成功', async () => {
    const task = await engine.orchestrate('简单任务', { forcePath: 'direct' });
    expect(task.status).toBe('completed');
    expect(task.rootSynthesis).toBeDefined();
    expect(task.rootSynthesis).toContain('任务已完成');
  });

  it('orchestrate 触发 task-started 和 task-completed 事件', async () => {
    const events: string[] = [];
    engine.on('task-started', () => events.push('task-started'));
    engine.on('task-completed', () => events.push('task-completed'));
    await engine.orchestrate('任务', { forcePath: 'direct' });
    expect(events).toContain('task-started');
    expect(events).toContain('task-completed');
  });

  it('orchestrate 触发 path-selected 事件', async () => {
    const events: any[] = [];
    engine.on('path-selected', (e) => events.push(e));
    await engine.orchestrate('任务', { forcePath: 'direct' });
    expect(events).toHaveLength(1);
    expect(events[0].data.path).toBe('direct');
  });

  it('orchestrate 触发 phase-started 和 phase-completed 事件', async () => {
    const started: any[] = [];
    const completed: any[] = [];
    engine.on('phase-started', (e) => started.push(e));
    engine.on('phase-completed', (e) => completed.push(e));
    await engine.orchestrate('任务', { forcePath: 'direct' });
    expect(started).toHaveLength(2);
    expect(completed).toHaveLength(2);
  });

  it('orchestrate 设置 startedAt 和 completedAt', async () => {
    const task = await engine.orchestrate('任务', { forcePath: 'direct' });
    expect(task.startedAt).toBeDefined();
    expect(task.completedAt).toBeDefined();
    expect(task.completedAt!).toBeGreaterThanOrEqual(task.startedAt!);
  });

  it('orchestrate 任务包含完整 phases', async () => {
    const task = await engine.orchestrate('任务', { forcePath: 'direct' });
    for (const p of task.phases) {
      expect(p.status).toBe('completed');
      expect(p.startedAt).toBeDefined();
      expect(p.completedAt).toBeDefined();
      expect(p.durationMs).toBeDefined();
    }
  });
});

describe('OrchestratedAgentEngine - 任务执行（Reviewed 路径）', () => {
  let engine: OrchestratedAgentEngine;

  beforeEach(() => {
    engine = new OrchestratedAgentEngine({ persist: false, autoApprovePlan: true });
  });

  it('reviewed 路径 6 phase 全部完成', async () => {
    const task = await engine.orchestrate('复杂任务', { forcePath: 'reviewed' });
    expect(task.status).toBe('completed');
    expect(task.phases).toHaveLength(6);
    expect(task.phases.every((p) => p.status === 'completed')).toBe(true);
  });

  it('reviewed 路径自动批准 plan', async () => {
    const events: any[] = [];
    engine.on('plan-approved', (e) => events.push(e));
    await engine.orchestrate('任务', { forcePath: 'reviewed' });
    expect(events.length).toBeGreaterThan(0);
  });

  it('reviewed 路径跳过 explorer', async () => {
    const task = await engine.orchestrate('任务', {
      forcePath: 'reviewed',
      skipExplorer: true,
    });
    expect(task.phases).toHaveLength(5);
    expect(task.phases.find((p) => p.id === 'explorer')).toBeUndefined();
  });

  it('Worker Packet 包含 verification', async () => {
    const task = await engine.orchestrate('任务', { forcePath: 'direct' });
    const workerPhase = task.phases.find((p) => p.id === 'worker-execute')!;
    const packet = workerPhase.packet as WorkerPacket;
    expect(packet.verification).toBeDefined();
    expect(packet.verification.testsRun).toBe(10);
    expect(packet.verification.testsPassed).toBe(10);
  });

  it('Review Packet reviewType 正确', async () => {
    const task = await engine.orchestrate('任务', { forcePath: 'reviewed' });
    const planReview = task.phases.find((p) => p.id === 'plan-review')!;
    const resultReview = task.phases.find((p) => p.id === 'result-review')!;
    const planPkt = planReview.packet as ReviewPacket;
    const resultPkt = resultReview.packet as ReviewPacket;
    expect(planPkt.reviewType).toBe('plan');
    expect(resultPkt.reviewType).toBe('result');
  });
});

describe('OrchestratedAgentEngine - 计划审批', () => {
  let engine: OrchestratedAgentEngine;
  let task: OrchestratedTask;

  beforeEach(async () => {
    engine = new OrchestratedAgentEngine({ persist: false, autoApprovePlan: false });
    task = engine.buildTask('任务', { forcePath: 'reviewed' });
    // 模拟 worker-plan 阶段已生成 plan packet
    const planPhase = task.phases.find((p) => p.id === 'worker-plan')!;
    planPhase.packet = {
      taskId: task.id,
      plan: [{ step: 1, description: 'd', filesAffected: [], estimatedMinutes: 1 }],
      risks: [],
      rollback: '',
      truncated: false,
      approved: false,
    };
  });

  it('approvePlan 设置 approved=true', () => {
    const plan = engine.approvePlan(task.id, 'worker-plan', 'user1', 'LGTM');
    expect(plan.approved).toBe(true);
    expect(plan.approvedBy).toBe('user1');
    expect(plan.approvedAt).toBeDefined();
  });

  it('approvePlan 触发 plan-approved 事件', () => {
    const events: any[] = [];
    engine.on('plan-approved', (e) => events.push(e));
    engine.approvePlan(task.id, 'worker-plan', 'user1');
    expect(events).toHaveLength(1);
  });

  it('rejectPlan 设置 approved=false', () => {
    const plan = engine.rejectPlan(task.id, 'worker-plan', 'user1', ['问题1']);
    expect(plan.approved).toBe(false);
  });

  it('rejectPlan 触发 plan-rejected 事件', () => {
    const events: any[] = [];
    engine.on('plan-rejected', (e) => events.push(e));
    engine.rejectPlan(task.id, 'worker-plan', 'user1', ['问题']);
    expect(events).toHaveLength(1);
  });

  it('approvePlan 不存在的任务抛出', () => {
    expect(() => engine.approvePlan('bad-id', 'worker-plan', 'u')).toThrow();
  });

  it('approvePlan 不存在的 phase 抛出', () => {
    expect(() => engine.approvePlan(task.id, 'bad-phase', 'u')).toThrow();
  });
});

describe('OrchestratedAgentEngine - Packet 验证', () => {
  let engine: OrchestratedAgentEngine;

  beforeEach(() => {
    engine = new OrchestratedAgentEngine({ persist: false });
  });

  it('验证完整 Packet -> valid', () => {
    const packet: WorkerPacket = {
      taskId: 't1',
      phaseId: 'worker-execute',
      status: 'complete',
      output: 'ok',
      changedFiles: ['a.ts'],
      verification: { testsRun: 10, testsPassed: 10, testsFailed: 0, linting: 'pass' },
      truncated: false,
      timestamp: Date.now(),
    };
    const r = engine.validateWorkerPacket(packet);
    expect(r.valid).toBe(true);
    expect(r.malformed).toBe(false);
  });

  it('验证 truncated Packet -> invalid', () => {
    const packet: WorkerPacket = {
      taskId: 't1',
      phaseId: 'worker-execute',
      status: 'complete',
      output: 'ok',
      changedFiles: [],
      verification: { testsRun: 0, testsPassed: 0, testsFailed: 0, linting: 'pass' },
      truncated: true,
      timestamp: Date.now(),
    };
    const r = engine.validateWorkerPacket(packet);
    expect(r.valid).toBe(false);
    expect(r.truncated).toBe(true);
  });

  it('验证有失败测试的 Packet', () => {
    const packet: WorkerPacket = {
      taskId: 't1',
      phaseId: 'worker-execute',
      status: 'complete',
      output: 'ok',
      changedFiles: [],
      verification: { testsRun: 10, testsPassed: 5, testsFailed: 5, linting: 'pass' },
      truncated: false,
      timestamp: Date.now(),
    };
    const r = engine.validateWorkerPacket(packet);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.includes('5 tests failed'))).toBe(true);
  });

  it('验证缺 changedFiles', () => {
    const packet: any = {
      taskId: 't1',
      phaseId: 'worker-execute',
      status: 'complete',
      output: 'ok',
      verification: { testsRun: 0, testsPassed: 0, testsFailed: 0, linting: 'pass' },
      truncated: false,
      timestamp: Date.now(),
    };
    const r = engine.validateWorkerPacket(packet);
    expect(r.malformed).toBe(true);
  });

  it('验证阶段输出（contract）', () => {
    const phase = {
      id: 'p',
      name: 'p',
      role: 'worker' as AgentRole,
      dependsOn: [],
      contract: {
        validateOutput: (output: unknown) =>
          output ? { valid: true } : { valid: false, errors: ['empty'] },
      },
      maxRetries: 0,
      currentRetries: 0,
      status: 'pending' as const,
    };
    const r1 = engine.validatePhaseOutput(phase, 'data');
    expect(r1.valid).toBe(true);
    const r2 = engine.validatePhaseOutput(phase, null);
    expect(r2.valid).toBe(false);
  });
});

describe('OrchestratedAgentEngine - 重试逻辑', () => {
  let engine: OrchestratedAgentEngine;

  beforeEach(() => {
    engine = new OrchestratedAgentEngine({ persist: false });
  });

  it('incrementRetry 增加重试次数', () => {
    const task = engine.buildTask('任务', { forcePath: 'direct' });
    const phase = task.phases[0];
    const newCount = engine.incrementRetry(task.id, phase.id);
    expect(newCount).toBe(1);
    expect(phase.currentRetries).toBe(1);
    expect(task.totalRetries).toBe(1);
  });

  it('shouldFailTask 在重试用尽时返回 true', () => {
    const task = engine.buildTask('任务', { forcePath: 'direct' });
    const phase = task.phases[0];
    expect(engine.shouldFailTask(task.id, phase.id)).toBe(false);
    phase.currentRetries = phase.maxRetries;
    expect(engine.shouldFailTask(task.id, phase.id)).toBe(true);
  });

  it('incrementRetry 不存在的任务返回 0', () => {
    expect(engine.incrementRetry('bad', 'phase')).toBe(0);
  });

  it('shouldFailTask 不存在的任务返回 true', () => {
    expect(engine.shouldFailTask('bad', 'phase')).toBe(true);
  });
});

describe('OrchestratedAgentEngine - Root Synthesis', () => {
  let engine: OrchestratedAgentEngine;

  beforeEach(() => {
    engine = new OrchestratedAgentEngine({ persist: false, autoApprovePlan: true });
  });

  it('成功任务合成包含变更文件数', async () => {
    const task = await engine.orchestrate('任务', { forcePath: 'direct' });
    expect(task.rootSynthesis).toContain('变更文件');
  });

  it('无 worker packet 时合成简单消息', () => {
    const task = engine.buildTask('任务', { forcePath: 'direct' });
    task.phases = []; // 清空 phases
    const s = engine.synthesize(task);
    expect(s).toContain('未产生');
  });

  it('任务失败时合成包含错误信息', async () => {
    const events: any[] = [];
    engine.on('task-failed', (e) => events.push(e));
    // 强制让 worker-execute 阶段产生空输出导致 phase-malformed -> 重试 -> 最终失败
    const originalSimulate = (engine as any).simulatePhaseExecution.bind(engine);
    (engine as any).simulatePhaseExecution = (phase: any, role: any, options: any) => {
      if (phase.id === 'worker-execute') return null;
      return originalSimulate(phase, role, options);
    };
    const task = await engine.orchestrate('任务', { forcePath: 'direct' });
    expect(task.status).toBe('failed');
    expect(task.rootSynthesis).toContain('任务失败');
  });
});

describe('OrchestratedAgentEngine - 沙箱继承', () => {
  let engine: OrchestratedAgentEngine;

  beforeEach(() => {
    engine = new OrchestratedAgentEngine({ persist: false });
  });

  it('Worker 角色继承 workspace-write', () => {
    const parent: typeof DEFAULT_SANDBOX_CONFIG = {
      ...DEFAULT_SANDBOX_CONFIG,
      mode: 'read-only',
    };
    const s = engine.inheritSandboxConfig(parent, 'worker');
    expect(s.mode).toBe('workspace-write');
    expect(s.approvalRequired).toBe(false);
  });

  it('Explorer 角色不允许写', () => {
    const parent: typeof DEFAULT_SANDBOX_CONFIG = { ...DEFAULT_SANDBOX_CONFIG };
    const s = engine.inheritSandboxConfig(parent, 'explorer');
    expect(s.deniedPaths).toContain('**/*');
  });

  it('Reviewer 继承父沙箱 approval', () => {
    const parent: typeof DEFAULT_SANDBOX_CONFIG = {
      ...DEFAULT_SANDBOX_CONFIG,
      approvalRequired: true,
    };
    const s = engine.inheritSandboxConfig(parent, 'reviewer');
    expect(s.approvalRequired).toBe(true);
  });
});

describe('OrchestratedAgentEngine - 并发控制', () => {
  let engine: OrchestratedAgentEngine;

  beforeEach(() => {
    engine = new OrchestratedAgentEngine({ persist: false });
  });

  it('setMaxThreads 更新配置', () => {
    engine.setMaxThreads(20);
    expect(engine['config'].maxThreads).toBe(20);
  });

  it('setMaxThreads 不能小于 1', () => {
    engine.setMaxThreads(0);
    expect(engine['config'].maxThreads).toBe(1);
  });

  it('setMaxDepth 更新配置', () => {
    engine.setMaxDepth(5);
    expect(engine['config'].maxDepth).toBe(5);
  });

  it('setMaxDepth 不能小于 0', () => {
    engine.setMaxDepth(-1);
    expect(engine['config'].maxDepth).toBe(0);
  });
});

describe('OrchestratedAgentEngine - 查询', () => {
  let engine: OrchestratedAgentEngine;

  beforeEach(async () => {
    engine = new OrchestratedAgentEngine({ persist: false, autoApprovePlan: true });
    await engine.orchestrate('A', { forcePath: 'direct' });
    await engine.orchestrate('B', { forcePath: 'reviewed' });
  });

  it('getTask 返回任务', () => {
    const tasks = engine.listTasks();
    expect(tasks.length).toBe(2);
    const t = engine.getTask(tasks[0].id);
    expect(t).toBeDefined();
  });

  it('listTasks 按 status 过滤', () => {
    const completed = engine.listTasks({ status: 'completed' });
    expect(completed.length).toBe(2);
    const failed = engine.listTasks({ status: 'failed' });
    expect(failed.length).toBe(0);
  });

  it('listTasks 按 path 过滤', () => {
    const direct = engine.listTasks({ path: 'direct' });
    expect(direct.length).toBe(1);
    const reviewed = engine.listTasks({ path: 'reviewed' });
    expect(reviewed.length).toBe(1);
  });

  it('getStats 返回正确统计', () => {
    const stats = engine.getStats();
    expect(stats.totalTasks).toBe(2);
    expect(stats.completedTasks).toBe(2);
    expect(stats.failedTasks).toBe(0);
    expect(stats.directTasks).toBe(1);
    expect(stats.reviewedTasks).toBe(1);
  });
});

describe('OrchestratedAgentEngine - 序列化', () => {
  let engine: OrchestratedAgentEngine;

  beforeEach(() => {
    engine = new OrchestratedAgentEngine({ persist: false });
  });

  it('exportState 导出任务和角色', () => {
    engine.buildTask('任务');
    const state = engine.exportState();
    expect(state.tasks).toHaveLength(1);
    expect(state.roles).toHaveLength(5);
  });

  it('importState 导入任务和角色', () => {
    const source = new OrchestratedAgentEngine({ persist: false });
    source.buildTask('A');
    source.buildTask('B');
    const state = source.exportState();

    const target = new OrchestratedAgentEngine({ persist: false });
    target.importState(state);
    expect(target.listTasks().length).toBe(2);
  });

  it('clear 清空所有数据', () => {
    engine.buildTask('A');
    engine.clear();
    expect(engine.listTasks().length).toBe(0);
    expect(engine.listRoles().length).toBe(5); // 恢复默认角色
  });
});

describe('OrchestratedAgentEngine - 持久化', () => {
  it('persist=true 时任务写入 localStorage', async () => {
    localStorage.clear();
    const engine = new OrchestratedAgentEngine({ persist: true, autoApprovePlan: true });
    await engine.orchestrate('任务', { forcePath: 'direct' });
    const raw = localStorage.getItem('hermes.orchestratedAgent');
    expect(raw).toBeDefined();
    const data = JSON.parse(raw!);
    expect(data.tasks.length).toBe(1);
  });

  it('persist=false 时不写入 localStorage', async () => {
    localStorage.clear();
    const engine = new OrchestratedAgentEngine({ persist: false, autoApprovePlan: true });
    await engine.orchestrate('任务', { forcePath: 'direct' });
    const raw = localStorage.getItem('hermes.orchestratedAgent');
    expect(raw).toBeNull();
  });

  it('新实例读取持久化状态', async () => {
    localStorage.clear();
    const e1 = new OrchestratedAgentEngine({ persist: true, autoApprovePlan: true });
    await e1.orchestrate('任务', { forcePath: 'direct' });
    const e2 = new OrchestratedAgentEngine({ persist: true });
    expect(e2.listTasks().length).toBe(1);
  });
});

describe('OrchestratedAgentEngine - 全局单例', () => {
  beforeEach(() => {
    resetDefaultOrchestratedAgentEngine();
  });

  it('getDefaultOrchestratedAgentEngine 返回单例', () => {
    const a = getDefaultOrchestratedAgentEngine();
    const b = getDefaultOrchestratedAgentEngine();
    expect(a).toBe(b);
  });

  it('resetDefaultOrchestratedAgentEngine 清空单例', () => {
    const a = getDefaultOrchestratedAgentEngine();
    resetDefaultOrchestratedAgentEngine();
    const b = getDefaultOrchestratedAgentEngine();
    expect(a).not.toBe(b);
  });
});

describe('OrchestratedAgentEngine - 事件订阅退订', () => {
  let engine: OrchestratedAgentEngine;

  beforeEach(() => {
    engine = new OrchestratedAgentEngine({ persist: false });
  });

  it('on 返回退订函数', async () => {
    let count = 0;
    const off = engine.on('task-started', () => count++);
    await engine.orchestrate('A', { forcePath: 'direct' });
    expect(count).toBe(1);
    off();
    await engine.orchestrate('B', { forcePath: 'direct' });
    expect(count).toBe(1);
  });

  it('off 手动退订', async () => {
    const fn = vi.fn();
    engine.on('task-completed', fn);
    engine.off('task-completed', fn);
    await engine.orchestrate('A', { forcePath: 'direct' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('监听器抛出错误不影响其他监听器', async () => {
    const fn1 = vi.fn(() => {
      throw new Error('oops');
    });
    const fn2 = vi.fn();
    engine.on('task-completed', fn1);
    engine.on('task-completed', fn2);
    await engine.orchestrate('A', { forcePath: 'direct' });
    expect(fn1).toHaveBeenCalled();
    expect(fn2).toHaveBeenCalled();
  });
});
