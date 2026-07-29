/**
 * # ============================================================
 * PlanEngine 单元测试 (v6.37.0 Cycle 17 P0-1)
 * # ============================================================
 * 核心作用：验证 PlanEngine 的所有核心 API
 * 测试覆盖：35 个测试用例
 *   - 基础状态管理 (5)
 *   - Plan 生成 (8)
 *   - 步骤操作 (10)
 *   - 整体操作 (6)
 *   - 执行 (4)
 *   - 序列化 (3)
 *   - 订阅 (3)
 * ============================================================
 */

import { describe, it, expect, vi } from 'vitest';
import {
  PlanEngine,
  createPlanEngine,
  PlanEngineError,
  calculateOverallRisk,
  getApprovedSteps,
  getRejectedSteps,
  MAX_PLAN_STEPS,
  type Plan,
  type PlanStep,
  type PlanStage,
} from './composerEngine.plan';

describe('PlanEngine - 基础状态管理', () => {
  it('初始时无 plan，stage 为 idle', () => {
    const engine = createPlanEngine();
    expect(engine.getCurrentPlan()).toBeNull();
    expect(engine.getStage()).toBe('idle');
    expect(engine.hasActivePlan()).toBe(false);
  });

  it('hasActivePlan 在有 plan 时为 true', async () => {
    const engine = createPlanEngine();
    await engine.generatePlan('test', [
      { path: 'a.ts', content: 'x', language: 'ts' },
    ]);
    expect(engine.hasActivePlan()).toBe(true);
  });

  it('clearPlan 重置状态', async () => {
    const engine = createPlanEngine();
    await engine.generatePlan('test', [
      { path: 'a.ts', content: 'x', language: 'ts' },
    ]);
    engine.clearPlan();
    expect(engine.getCurrentPlan()).toBeNull();
    expect(engine.getStage()).toBe('idle');
  });

  it('stage 转换：idle → analyzing → planned', async () => {
    const engine = createPlanEngine();
    const stages: PlanStage[] = [];
    engine.subscribe((_, stage) => stages.push(stage));
    await engine.generatePlan('test', [
      { path: 'a.ts', content: 'x', language: 'ts' },
    ]);
    expect(stages).toContain('analyzing');
    expect(stages[stages.length - 1]).toBe('planned');
  });

  it('stage 转换：planned → approved → executing → completed', async () => {
    const engine = createPlanEngine();
    await engine.generatePlan('test', [
      { path: 'a.ts', content: 'x', language: 'ts' },
    ]);
    engine.approvePlan();
    expect(engine.getStage()).toBe('approved');
    await engine.executePlan(async (step) => ({
      beforeContent: '',
      afterContent: 'new',
    }));
    expect(engine.getStage()).toBe('completed');
  });
});

describe('PlanEngine - Plan 生成', () => {
  it('生成空 prompt 抛错', async () => {
    const engine = createPlanEngine();
    await expect(engine.generatePlan('', [])).rejects.toThrow(PlanEngineError);
  });

  it('空白 prompt 抛错', async () => {
    const engine = createPlanEngine();
    await expect(engine.generatePlan('   ', [])).rejects.toThrow();
  });

  it('已有 plan 时再生成抛错', async () => {
    const engine = createPlanEngine();
    await engine.generatePlan('first', [
      { path: 'a.ts', content: 'x', language: 'ts' },
    ]);
    await expect(
      engine.generatePlan('second', [
        { path: 'a.ts', content: 'x', language: 'ts' },
      ])
    ).rejects.toThrow(/已有活跃 Plan/);
  });

  it('生成时 stage 经历 analyzing', async () => {
    const engine = createPlanEngine();
    const stages: PlanStage[] = [];
    engine.subscribe((_, stage) => stages.push(stage));
    await engine.generatePlan('test', [
      { path: 'a.ts', content: 'x', language: 'ts' },
    ]);
    expect(stages).toContain('analyzing');
  });

  it('生成 rename 计划', async () => {
    const engine = createPlanEngine();
    const plan = await engine.generatePlan(
      'rename userName to username',
      [
        { path: 'a.ts', content: 'const userName = 1;', language: 'ts' },
      ]
    );
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps[0].description).toContain('重命名');
  });

  it('生成 refactor 计划', async () => {
    const engine = createPlanEngine();
    const plan = await engine.generatePlan(
      '重构 UserService',
      [
        { path: 'user.ts', content: 'class UserService {}', language: 'ts' },
      ]
    );
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps[0].riskLevel).toBe('high');
  });

  it('无匹配规则时使用默认 modify', async () => {
    const engine = createPlanEngine();
    const plan = await engine.generatePlan(
      'random unrelated prompt',
      [
        { path: 'a.ts', content: 'x', language: 'ts' },
      ]
    );
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0].operation).toBe('modify');
  });

  it('超 MAX_PLAN_STEPS 抛错', async () => {
    const engine = createPlanEngine();
    // 构造大量 step
    const bigPlan: Omit<Plan, 'id' | 'createdAt'> = {
      prompt: 'big',
      summary: 'big plan',
      steps: Array.from({ length: MAX_PLAN_STEPS + 1 }, (_, i) => ({
        id: `step_${i}`,
        filePath: `a${i}.ts`,
        operation: 'modify' as const,
        description: `step ${i}`,
        estimatedLines: 1,
        riskLevel: 'low' as const,
        status: 'pending' as const,
      })),
      estimatedDurationMs: 0,
      totalLines: 0,
      riskAssessment: '',
    };
    // 直接通过内部 generator 传入
    await expect(
      engine.generatePlan('big', [], async () => bigPlan)
    ).rejects.toThrow(/超过最大限制/);
  });
});

describe('PlanEngine - 步骤操作', () => {
  let engine: PlanEngine;
  let plan: Plan;

  beforeEach(async () => {
    engine = createPlanEngine();
    plan = await engine.generatePlan('add new feature', [
      { path: 'a.ts', content: 'x', language: 'ts' },
      { path: 'b.ts', content: 'y', language: 'ts' },
    ]);
  });

  it('approveStep 设置状态为 approved', () => {
    const stepId = plan.steps[0].id;
    engine.approveStep(stepId);
    const updated = engine.getCurrentPlan()!.steps[0];
    expect(updated.status).toBe('approved');
  });

  it('rejectStep 设置状态为 rejected 和原因', () => {
    const stepId = plan.steps[0].id;
    engine.rejectStep(stepId, '不需要这个修改');
    const updated = engine.getCurrentPlan()!.steps[0];
    expect(updated.status).toBe('rejected');
    expect(updated.rejectionReason).toBe('不需要这个修改');
  });

  it('modifyStep 更新描述', () => {
    const stepId = plan.steps[0].id;
    engine.modifyStep(stepId, '修改后的描述');
    const updated = engine.getCurrentPlan()!.steps[0];
    expect(updated.status).toBe('modified');
    expect(updated.modifiedDescription).toBe('修改后的描述');
  });

  it('modifyStep 空描述抛错', () => {
    const stepId = plan.steps[0].id;
    expect(() => engine.modifyStep(stepId, '')).toThrow(/不能为空/);
    expect(() => engine.modifyStep(stepId, '   ')).toThrow();
  });

  it('approveStep 不存在的 step 抛错', () => {
    expect(() => engine.approveStep('nonexistent')).toThrow(PlanEngineError);
  });

  it('rejectStep 不存在的 step 抛错', () => {
    expect(() => engine.rejectStep('nonexistent')).toThrow(PlanEngineError);
  });

  it('modifyStep 不存在的 step 抛错', () => {
    expect(() => engine.modifyStep('nonexistent', 'desc')).toThrow(PlanEngineError);
  });

  it('approveAll 批准所有 pending 步骤', () => {
    engine.approveAll();
    const updated = engine.getCurrentPlan()!;
    const allApproved = updated.steps.every(
      (s) => s.status === 'approved' || s.status === 'modified'
    );
    expect(allApproved).toBe(true);
  });

  it('rejectAll 拒绝所有 pending 步骤', () => {
    engine.rejectAll();
    const updated = engine.getCurrentPlan()!;
    const allRejected = updated.steps.every(
      (s) => s.status === 'rejected' || s.status === 'approved' || s.status === 'modified'
    );
    expect(allRejected).toBe(true);
  });

  it('approveAll 不影响已 rejected 步骤', () => {
    engine.rejectStep(plan.steps[0].id, 'no');
    engine.approveAll();
    const updated = engine.getCurrentPlan()!;
    expect(updated.steps[0].status).toBe('rejected');
    expect(updated.steps[1].status).toBe('approved');
  });
});

describe('PlanEngine - 整体操作', () => {
  it('approvePlan 转换 stage 为 approved', async () => {
    const engine = createPlanEngine();
    await engine.generatePlan('test', [
      { path: 'a.ts', content: 'x', language: 'ts' },
    ]);
    engine.approvePlan();
    expect(engine.getStage()).toBe('approved');
  });

  it('approvePlan 在 non-planned 阶段抛错', async () => {
    const engine = createPlanEngine();
    // 先创建 plan（此时 stage = planned）
    await engine.generatePlan('test', [
      { path: 'a.ts', content: 'x', language: 'ts' },
    ]);
    // 第一次 approve：进入 approved 阶段
    engine.approvePlan();
    expect(engine.getStage()).toBe('approved');
    // 再次 approve 应抛错（不再处于 planned 阶段）
    expect(() => engine.approvePlan()).toThrow(/当前阶段/);
  });

  it('rejectPlan 转换 stage 为 rejected', async () => {
    const engine = createPlanEngine();
    await engine.generatePlan('test', [
      { path: 'a.ts', content: 'x', language: 'ts' },
    ]);
    engine.rejectPlan('整体不需要');
    expect(engine.getStage()).toBe('rejected');
  });

  it('rejectPlan 拒绝时无活跃 plan 不抛错', () => {
    const engine = createPlanEngine();
    expect(() => engine.rejectPlan('test')).not.toThrow();
  });

  it('clearPlan 后 stage 为 idle', async () => {
    const engine = createPlanEngine();
    await engine.generatePlan('test', [
      { path: 'a.ts', content: 'x', language: 'ts' },
    ]);
    engine.clearPlan();
    expect(engine.getStage()).toBe('idle');
  });

  it('clearPlan 不影响 stage 当 plan 不存在', () => {
    const engine = createPlanEngine();
    expect(() => engine.clearPlan()).not.toThrow();
  });
});

describe('PlanEngine - 执行', () => {
  it('executePlan 转换 stage 为 executing → completed', async () => {
    const engine = createPlanEngine();
    await engine.generatePlan('add feature', [
      { path: 'a.ts', content: 'x', language: 'ts' },
    ]);
    engine.approvePlan();
    const result = await engine.executePlan(async () => ({
      beforeContent: 'x',
      afterContent: 'y',
    }));
    expect(result.length).toBe(1);
    expect(result[0].stepId).toBeDefined();
    expect(result[0].editId).toBeDefined();
    expect(engine.getStage()).toBe('completed');
  });

  it('executePlan 只为 approved/modified 步骤生成 edit', async () => {
    const engine = createPlanEngine();
    const plan = await engine.generatePlan('add', [
      { path: 'a.ts', content: 'x', language: 'ts' },
      { path: 'b.ts', content: 'y', language: 'ts' },
    ]);
    engine.approveStep(plan.steps[0].id);
    engine.rejectStep(plan.steps[1].id, 'no');
    const result = await engine.executePlan(async () => ({
      beforeContent: '',
      afterContent: 'new',
    }));
    expect(result.length).toBe(1);
    expect(result[0].stepId).toBe(plan.steps[0].id);
  });

  it('executePlan 在 idle 阶段抛错', async () => {
    const engine = createPlanEngine();
    await expect(
      engine.executePlan(async () => ({ beforeContent: '', afterContent: '' }))
    ).rejects.toThrow(/没有活跃 Plan/);
  });

  it('executePlan 在 rejected 阶段抛错', async () => {
    const engine = createPlanEngine();
    await engine.generatePlan('test', [
      { path: 'a.ts', content: 'x', language: 'ts' },
    ]);
    engine.rejectPlan('no');
    await expect(
      engine.executePlan(async () => ({ beforeContent: '', afterContent: '' }))
    ).rejects.toThrow();
  });
});

describe('PlanEngine - 序列化', () => {
  it('serializePlan 输出 JSON', async () => {
    const engine = createPlanEngine();
    await engine.generatePlan('test', [
      { path: 'a.ts', content: 'x', language: 'ts' },
    ]);
    const json = engine.serializePlan();
    expect(json).toContain('planned');
    expect(json).toContain('test');
  });

  it('deserializePlan 恢复状态', async () => {
    const engine1 = createPlanEngine();
    await engine1.generatePlan('test', [
      { path: 'a.ts', content: 'x', language: 'ts' },
    ]);
    const json = engine1.serializePlan();

    const engine2 = createPlanEngine();
    const ok = engine2.deserializePlan(json);
    expect(ok).toBe(true);
    expect(engine2.getStage()).toBe('planned');
    expect(engine2.getCurrentPlan()?.prompt).toBe('test');
  });

  it('deserializePlan 无效 JSON 返回 false', () => {
    const engine = createPlanEngine();
    expect(engine.deserializePlan('not json{')).toBe(false);
  });
});

describe('PlanEngine - 订阅', () => {
  it('subscribe 接收变化通知', async () => {
    const engine = createPlanEngine();
    const cb = vi.fn();
    engine.subscribe(cb);
    await engine.generatePlan('test', [
      { path: 'a.ts', content: 'x', language: 'ts' },
    ]);
    expect(cb).toHaveBeenCalled();
  });

  it('unsubscribe 不再接收', async () => {
    const engine = createPlanEngine();
    const cb = vi.fn();
    const unsub = engine.subscribe(cb);
    unsub();
    await engine.generatePlan('test', [
      { path: 'a.ts', content: 'x', language: 'ts' },
    ]);
    expect(cb).not.toHaveBeenCalled();
  });

  it('subscribe 接收 stage 变化', async () => {
    const engine = createPlanEngine();
    const stages: PlanStage[] = [];
    engine.subscribe((_, stage) => stages.push(stage));
    await engine.generatePlan('test', [
      { path: 'a.ts', content: 'x', language: 'ts' },
    ]);
    engine.approvePlan();
    expect(stages).toContain('planned');
    expect(stages).toContain('approved');
  });
});

describe('辅助函数', () => {
  it('calculateOverallRisk - high 当有 high risk 步骤', () => {
    const plan: Plan = {
      id: 'p1',
      prompt: 'test',
      summary: 's',
      steps: [
        { id: 's1', filePath: 'a.ts', operation: 'modify', description: '', estimatedLines: 1, riskLevel: 'high', status: 'pending' },
      ],
      estimatedDurationMs: 0,
      totalLines: 1,
      riskAssessment: '',
      createdAt: 0,
    };
    expect(calculateOverallRisk(plan)).toBe('high');
  });

  it('calculateOverallRisk - low 当全部 low', () => {
    const plan: Plan = {
      id: 'p1',
      prompt: 'test',
      summary: 's',
      steps: [
        { id: 's1', filePath: 'a.ts', operation: 'modify', description: '', estimatedLines: 1, riskLevel: 'low', status: 'pending' },
      ],
      estimatedDurationMs: 0,
      totalLines: 1,
      riskAssessment: '',
      createdAt: 0,
    };
    expect(calculateOverallRisk(plan)).toBe('low');
  });

  it('getApprovedSteps 过滤', () => {
    const plan: Plan = {
      id: 'p1',
      prompt: 'test',
      summary: 's',
      steps: [
        { id: 's1', filePath: 'a.ts', operation: 'modify', description: '', estimatedLines: 1, riskLevel: 'low', status: 'approved' },
        { id: 's2', filePath: 'b.ts', operation: 'modify', description: '', estimatedLines: 1, riskLevel: 'low', status: 'rejected' },
        { id: 's3', filePath: 'c.ts', operation: 'modify', description: '', estimatedLines: 1, riskLevel: 'low', status: 'modified' },
      ],
      estimatedDurationMs: 0,
      totalLines: 3,
      riskAssessment: '',
      createdAt: 0,
    };
    const approved = getApprovedSteps(plan);
    expect(approved.length).toBe(2);
    expect(approved[0].id).toBe('s1');
    expect(approved[1].id).toBe('s3');
  });

  it('getRejectedSteps 过滤', () => {
    const plan: Plan = {
      id: 'p1',
      prompt: 'test',
      summary: 's',
      steps: [
        { id: 's1', filePath: 'a.ts', operation: 'modify', description: '', estimatedLines: 1, riskLevel: 'low', status: 'approved' },
        { id: 's2', filePath: 'b.ts', operation: 'modify', description: '', estimatedLines: 1, riskLevel: 'low', status: 'rejected' },
      ],
      estimatedDurationMs: 0,
      totalLines: 2,
      riskAssessment: '',
      createdAt: 0,
    };
    const rejected = getRejectedSteps(plan);
    expect(rejected.length).toBe(1);
    expect(rejected[0].id).toBe('s2');
  });
});
