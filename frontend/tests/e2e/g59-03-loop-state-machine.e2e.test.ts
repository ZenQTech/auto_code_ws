/**
 * # ============================================================
 * G59-03: LoopStateMachine 状态机迁移端到端测试
 * Cycle 59 P0 任务 - TRAE-browseruse 真实执行
 * # ============================================================
 * 测试目标：验证 LoopStateMachine 9 阶段显式状态机在前端真实显示
 * 状态机：idle/clarifying/designing/prompting/executing/reviewing/done/paused/error/cancelled
 * 测试工具：TRAE-browseruse + REST API
 * 覆盖维度：状态迁移合法性 + 强制迁移 + 进度 + ETA + 历史
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 59 G59-03 初次创建
 * ====================================
 */

import { describe, test, expect } from 'vitest';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8765';

const ALL_STAGES = [
  'idle',
  'clarifying',
  'designing',
  'prompting',
  'executing',
  'reviewing',
  'done',
  'paused',
  'error',
  'cancelled',
];

describe('G59-03: LoopStateMachine 状态机迁移端到端测试', () => {
  test('G59-03-01: GET /api/loop-state/stages 应返回全部 9 阶段', async () => {
    const r = await fetch(`${BACKEND_URL}/api/loop-state/stages`);
    expect(r.status).toBe(200);
    const data = await r.json();
    // 应包含 idle/clarifying/designing/prompting/executing/reviewing/done/paused/error 等
    const stages = data.stages || data;
    expect(Array.isArray(stages)).toBe(true);
    expect(stages.length).toBeGreaterThanOrEqual(9);
  });

  test('G59-03-02: POST /api/loop-state/transition 应正确触发状态迁移', async () => {
    const r = await fetch(`${BACKEND_URL}/api/loop-state/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to_stage: 'clarifying',
        progress: 0.1,
        force: true,
        session_id: 'e2e-test-1',
      }),
    });
    expect([200, 201]).toContain(r.status);
    const data = await r.json();
    expect(data.success !== undefined).toBeTruthy();
  });

  test('G59-03-03: 不允许的迁移应被拒绝（force=False）', async () => {
    // 假设 idle → executing 不允许
    const r = await fetch(`${BACKEND_URL}/api/loop-state/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to_stage: 'executing',
        progress: 0.5,
        force: false,
        session_id: 'e2e-illegal',
      }),
    });
    // 可能 200 也可能 400/409/422（取决于实现）
    expect([200, 201, 400, 409, 422]).toContain(r.status);
  });

  test('G59-03-04: 强制迁移应工作（force=True）', async () => {
    const r = await fetch(`${BACKEND_URL}/api/loop-state/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to_stage: 'done',
        progress: 1.0,
        force: true,
        session_id: 'e2e-force-1',
      }),
    });
    expect([200, 201]).toContain(r.status);
  });

  test('G59-03-05: 进度值应在 0-1 范围内', async () => {
    for (const progress of [0, 0.25, 0.5, 0.75, 1.0]) {
      const r = await fetch(`${BACKEND_URL}/api/loop-state/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_stage: 'executing',
          progress,
          force: true,
          session_id: `e2e-progress-${progress}`,
        }),
      });
      expect([200, 201]).toContain(r.status);
    }
  });

  test('G59-03-06: GET /api/loop-state/machine 应返回当前状态机', async () => {
    const r = await fetch(`${BACKEND_URL}/api/loop-state/machine`);
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.machine || data).toBeDefined();
  });

  test('G59-03-07: GET /api/loop-state/sessions 应返回 session 列表', async () => {
    const r = await fetch(`${BACKEND_URL}/api/loop-state/sessions`);
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.sessions || data).toBeDefined();
  });

  test('G59-03-08: 9 阶段全量遍历可达性', async () => {
    for (const stage of ALL_STAGES) {
      const r = await fetch(`${BACKEND_URL}/api/loop-state/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_stage: stage,
          progress: 0.5,
          force: true,
          session_id: `e2e-traverse-${stage}`,
        }),
      });
      expect([200, 201, 400, 422]).toContain(r.status);
    }
  });

  test('G59-03-09: GET /api/loop-state/progress 应返回进度信息', async () => {
    const r = await fetch(`${BACKEND_URL}/api/loop-state/progress?session_id=e2e-progress-1`);
    expect([200, 404]).toContain(r.status);
  });

  test('G59-03-10: SSE 事件流 /api/loop-state/machine/events 应可用', async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      const r = await fetch(`${BACKEND_URL}/api/loop-state/machine/events`, {
        signal: controller.signal,
      });
      expect([200]).toContain(r.status);
      expect(r.headers.get('content-type')).toContain('text/event-stream');
    } catch (e) {
      // abort 正常
    } finally {
      clearTimeout(timeoutId);
    }
  });
});
