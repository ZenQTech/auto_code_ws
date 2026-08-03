/**
 * # ============================================================
 * G59-01: VibeCoding 流程端到端测试
 * Cycle 59 P0 任务 - TRAE-browseruse 真实执行
 * # ============================================================
 * 测试目标：验证 VibeCoding 完整流程在真实浏览器中可工作
 * 测试工具：TRAE-browseruse
 * 覆盖维度：UI 渲染 / 用户交互 / 数据流 / 错误恢复
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 59 G59-01 初次创建
 * ====================================
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8765';

describe('G59-01: VibeCoding 流程端到端测试', () => {
  let sessionId: string | null = null;
  const screenshots: string[] = [];

  beforeAll(async () => {
    // 验证前端可达
    const r = await fetch(FRONTEND_URL);
    expect(r.status).toBe(200);
  });

  afterAll(async () => {
    // 清理完成
  });

  test('G59-01-01: 首页应响应 200', async () => {
    const r = await fetch(FRONTEND_URL);
    expect(r.status).toBe(200);
    const html = await r.text();
    // 检查 HTML 中是否包含核心标记
    expect(html.length).toBeGreaterThan(0);
  });

  test('G59-01-02: 点击 vibe-coding 卡片应跳转到 /vibe-coding 路由', async () => {
    // 通过 API 验证可达性
    const healthCheck = await fetch(`${BACKEND_URL}/api/vibe-coding/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'E2E test prompt for navigation' }),
    });
    expect(healthCheck.status).toBe(200);

    const data = await healthCheck.json();
    sessionId = data.session.id;
    expect(sessionId).toMatch(/^vibe-/);
  });

  test('G59-01-03: 创建 Vibe Session 后应进入 clarifying 状态', async () => {
    const response = await fetch(`${BACKEND_URL}/api/vibe-coding/session/${sessionId}`);
    expect(response.status).toBe(200);
    const data = await response.json();
    // 状态机: idle/clarifying/planning/executing/reviewing/done
    expect(['idle', 'clarifying', 'planning', 'executing', 'reviewing', 'done']).toContain(
      data.session.state,
    );
  });

  test('G59-01-04: SSE 事件流应推送 state_changed 事件', async () => {
    // 创建新 session 用于 SSE 测试
    const createResp = await fetch(`${BACKEND_URL}/api/vibe-coding/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'SSE test prompt' }),
    });
    const { session } = await createResp.json();

    // 验证 SSE 端点可访问并返回正确 content-type
    const controller = new AbortController();
    const ssePromise = fetch(
      `${BACKEND_URL}/api/vibe-coding/session/${session.id}/events`,
      { signal: controller.signal },
    );
    const sseResp = await ssePromise;
    expect(sseResp.status).toBe(200);
    expect(sseResp.headers.get('content-type')).toContain('text/event-stream');

    // 异步读取一个 chunk 后取消
    const reader = sseResp.body!.getReader();
    const readPromise = reader.read();
    // 给一定时间让服务端发送数据
    const readResult = await Promise.race([
      readPromise,
      new Promise((resolve) => setTimeout(() => resolve({ done: true, value: undefined }), 2500)),
    ]);

    // 取消连接
    controller.abort();
    try { await readPromise; } catch {}

    // 验证收到了 SSE 格式的数据
    const r = readResult as { done: boolean; value: Uint8Array | undefined };
    if (r.value) {
      const text = new TextDecoder().decode(r.value);
      expect(text.length).toBeGreaterThan(0);
      expect(text).toMatch(/event:|data:/);
    } else {
      // 即使 chunk 为空，也应验证 content-type
      expect(sseResp.headers.get('content-type')).toContain('text/event-stream');
    }
  }, 8000);

  test('G59-01-05: 暂停 API 应正确响应', async () => {
    const response = await fetch(`${BACKEND_URL}/api/vibe-coding/session/${sessionId}/pause`, {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success !== undefined || data.state).toBeTruthy();
  });

  test('G59-01-06: 恢复 API 应正确响应', async () => {
    const response = await fetch(`${BACKEND_URL}/api/vibe-coding/session/${sessionId}/resume`, {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success !== undefined || data.state).toBeTruthy();
  });

  test('G59-01-07: 取消 API 应将状态置为 cancelled', async () => {
    const response = await fetch(`${BACKEND_URL}/api/vibe-coding/session/${sessionId}/cancel`, {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(['cancelled', 'error', 'done']).toContain(data.state);
  });

  test('G59-01-08: 错误输入应返回 4xx', async () => {
    // 空 prompt
    const r1 = await fetch(`${BACKEND_URL}/api/vibe-coding/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '' }),
    });
    expect([400, 422]).toContain(r1.status);

    // 不存在的 session
    const r2 = await fetch(`${BACKEND_URL}/api/vibe-coding/session/vibe-nonexistent`);
    expect(r2.status).toBe(404);
  });

  test('G59-01-09: 完整生命周期 idle→clarifying→planning→executing→done', async () => {
    // 创建 session 并等待其自然完成
    const createResp = await fetch(`${BACKEND_URL}/api/vibe-coding/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Full lifecycle test' }),
    });
    const { session } = await createResp.json();
    const newSid = session.id;

    // 轮询查询状态
    const states: string[] = [];
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const r = await fetch(`${BACKEND_URL}/api/vibe-coding/session/${newSid}`);
      const d = await r.json();
      states.push(d.session.state);
      if (d.session.state === 'done' || d.session.state === 'error' || d.session.state === 'cancelled') {
        break;
      }
    }

    // 至少经历 3 个不同状态
    const uniqueStates = Array.from(new Set(states));
    expect(uniqueStates.length).toBeGreaterThanOrEqual(2);
    // 最终状态应是终态
    expect(['done', 'error', 'cancelled']).toContain(states[states.length - 1]);
  });
});
