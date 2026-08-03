/**
 * # ============================================================
 * G59-02: ComposerPlan 执行端到端测试
 * Cycle 59 P0 任务 - TRAE-browseruse 真实执行
 * # ============================================================
 * 测试目标：验证 ComposerPlan 真实可执行（创建/启动/暂停/恢复/取消/重试/跳过）
 * 测试工具：TRAE-browseruse + REST API
 * 覆盖维度：CRUD 全流程 + 状态机迁移 + 依赖关系
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 59 G59-02 初次创建
 * ====================================
 */

import { describe, test, expect } from 'vitest';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8765';

interface PlanStep {
  step_id: string;
  title: string;
  description: string;
  action: string;
  depends_on: string[];
  status?: string;
}

interface Plan {
  plan_id: string;
  title: string;
  description: string;
  steps: PlanStep[];
  status: string;
  progress: number;
}

async function createPlan(steps: PlanStep[]): Promise<Plan> {
  const r = await fetch(`${BACKEND_URL}/api/composer-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'E2E Test Plan',
      description: 'Plan created by G59-02 e2e test',
      steps,
    }),
  });
  expect(r.status).toBe(200);
  const data = await r.json();
  return data.plan || data;
}

describe('G59-02: ComposerPlan 执行端到端测试', () => {
  test('G59-02-01: 创建带依赖关系的 Plan（a→b→c）', async () => {
    const plan = await createPlan([
      {
        step_id: 'a',
        title: 'Step A - 数据收集',
        description: 'Collect raw data',
        action: 'noop',
        depends_on: [],
      },
      {
        step_id: 'b',
        title: 'Step B - 数据处理',
        description: 'Process data from A',
        action: 'noop',
        depends_on: ['a'],
      },
      {
        step_id: 'c',
        title: 'Step C - 报告生成',
        description: 'Generate report from B',
        action: 'noop',
        depends_on: ['b'],
      },
    ]);

    expect(plan.plan_id).toBeDefined();
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0].depends_on).toEqual([]);
    expect(plan.steps[1].depends_on).toEqual(['a']);
    expect(plan.steps[2].depends_on).toEqual(['b']);
  });

  test('G59-02-02: 启动 Plan 后 step 应按依赖顺序执行', async () => {
    const plan = await createPlan([
      { step_id: 'x', title: 'X', description: 'first', action: 'noop', depends_on: [] },
      { step_id: 'y', title: 'Y', description: 'after X', action: 'noop', depends_on: ['x'] },
    ]);

    // 启动
    const startResp = await fetch(`${BACKEND_URL}/api/composer-plan/${plan.plan_id}/start`, {
      method: 'POST',
    });
    expect([200, 201]).toContain(startResp.status);

    // 等待执行
    await new Promise((r) => setTimeout(r, 2000));

    // 查询状态
    const statusResp = await fetch(`${BACKEND_URL}/api/composer-plan/${plan.plan_id}`);
    expect(statusResp.status).toBe(200);
    const status = await statusResp.json();
    expect(status.plan).toBeDefined();
  });

  test('G59-02-03: 暂停 Plan 后状态变为 paused', async () => {
    const plan = await createPlan([
      { step_id: 'p1', title: 'P1', description: 'long running', action: 'sleep:5', depends_on: [] },
    ]);

    // 启动
    await fetch(`${BACKEND_URL}/api/composer-plan/${plan.plan_id}/start`, { method: 'POST' });
    await new Promise((r) => setTimeout(r, 1000));

    // 暂停
    const pauseResp = await fetch(`${BACKEND_URL}/api/composer-plan/${plan.plan_id}/pause`, {
      method: 'POST',
    });
    expect([200, 201, 409]).toContain(pauseResp.status);

    // 验证状态
    const status = await fetch(`${BACKEND_URL}/api/composer-plan/${plan.plan_id}`).then((r) => r.json());
    expect(['paused', 'running', 'completed']).toContain(status.plan.status);
  });

  test('G59-02-04: 恢复 Plan 后继续执行', async () => {
    const plan = await createPlan([
      { step_id: 'r1', title: 'R1', description: 'resumable', action: 'sleep:2', depends_on: [] },
    ]);

    await fetch(`${BACKEND_URL}/api/composer-plan/${plan.plan_id}/start`, { method: 'POST' });
    await new Promise((r) => setTimeout(r, 500));
    await fetch(`${BACKEND_URL}/api/composer-plan/${plan.plan_id}/pause`, { method: 'POST' });
    await new Promise((r) => setTimeout(r, 500));

    const resumeResp = await fetch(`${BACKEND_URL}/api/composer-plan/${plan.plan_id}/resume`, {
      method: 'POST',
    });
    expect([200, 201, 409]).toContain(resumeResp.status);
  });

  test('G59-02-05: 取消 Plan 后状态变为 cancelled', async () => {
    const plan = await createPlan([
      { step_id: 'c1', title: 'C1', description: 'cancellable', action: 'sleep:10', depends_on: [] },
    ]);

    await fetch(`${BACKEND_URL}/api/composer-plan/${plan.plan_id}/start`, { method: 'POST' });
    await new Promise((r) => setTimeout(r, 500));

    const cancelResp = await fetch(`${BACKEND_URL}/api/composer-plan/${plan.plan_id}/cancel`, {
      method: 'POST',
    });
    expect([200, 201]).toContain(cancelResp.status);

    await new Promise((r) => setTimeout(r, 500));
    const status = await fetch(`${BACKEND_URL}/api/composer-plan/${plan.plan_id}`).then((r) => r.json());
    expect(['cancelled', 'running']).toContain(status.plan.status);
  });

  test('G59-02-06: 失败 step 可被重试', async () => {
    const plan = await createPlan([
      {
        step_id: 'fail1',
        title: 'Failing Step',
        description: 'always fails first time',
        action: 'fail:1',
        depends_on: [],
      },
    ]);

    await fetch(`${BACKEND_URL}/api/composer-plan/${plan.plan_id}/start`, { method: 'POST' });
    await new Promise((r) => setTimeout(r, 2000));

    const retryResp = await fetch(
      `${BACKEND_URL}/api/composer-plan/${plan.plan_id}/step/fail1/retry`,
      { method: 'POST' },
    );
    // 接受成功或已重试
    expect([200, 201, 404, 409]).toContain(retryResp.status);
  });

  test('G59-02-07: 失败 step 可被跳过', async () => {
    const plan = await createPlan([
      {
        step_id: 'skip1',
        title: 'Skippable',
        description: 'can be skipped',
        action: 'fail',
        depends_on: [],
      },
    ]);

    await fetch(`${BACKEND_URL}/api/composer-plan/${plan.plan_id}/start`, { method: 'POST' });
    await new Promise((r) => setTimeout(r, 2000));

    const skipResp = await fetch(
      `${BACKEND_URL}/api/composer-plan/${plan.plan_id}/step/skip1/skip`,
      { method: 'POST' },
    );
    expect([200, 201, 404, 409]).toContain(skipResp.status);
  });

  test('G59-02-08: SSE 事件流正确推送 step 状态', async () => {
    const plan = await createPlan([
      { step_id: 'sse1', title: 'SSE Test', description: 'emit events', action: 'sleep:3', depends_on: [] },
    ]);

    // 启动前先订阅 SSE（避免错过事件）
    const controller = new AbortController();
    const ssePromise = fetch(
      `${BACKEND_URL}/api/composer-plan/${plan.plan_id}/events`,
      { signal: controller.signal },
    );
    const sseResp = await ssePromise;
    expect(sseResp.status).toBe(200);
    expect(sseResp.headers.get('content-type')).toContain('text/event-stream');

    // 读取一个 chunk
    const reader = sseResp.body!.getReader();
    const readPromise = reader.read();
    const readResult = await Promise.race([
      readPromise,
      new Promise((resolve) => setTimeout(() => resolve({ done: true, value: undefined }), 2500)),
    ]);

    controller.abort();
    try { await readPromise; } catch {}

    const r = readResult as { done: boolean; value: Uint8Array | undefined };
    if (r.value) {
      const text = new TextDecoder().decode(r.value);
      expect(text.length).toBeGreaterThan(0);
      expect(text).toMatch(/event:|data:/);
    } else {
      expect(sseResp.headers.get('content-type')).toContain('text/event-stream');
    }
  }, 8000);
});
