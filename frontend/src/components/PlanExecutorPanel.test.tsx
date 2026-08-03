/**
 * # ============================================================
 * PlanExecutorPanel 集成测试 (v1.0.0)
 * Cycle 58 G58-INTEGRATION
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 58 G58-INTEGRATION 初次创建
 * ====================================
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlanExecutorPanel from './PlanExecutorPanel';

// 模拟 EventSource 避免 happy-dom 警告
class MockEventSource {
  addEventListener() {}
  close() {}
  onerror: any = null;
}
(global as any).EventSource = MockEventSource;

describe('PlanExecutorPanel - 基础渲染', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('无 planId 时应显示空状态', () => {
    render(<PlanExecutorPanel onClose={() => {}} />);
    expect(screen.getByTestId('plan-empty').textContent).toContain('当前没有 Plan');
  });

  it('显示 panel 标题', () => {
    render(<PlanExecutorPanel onClose={() => {}} />);
    expect(screen.getByText('Plan Executor')).toBeTruthy();
  });

  it('点击关闭按钮触发 onClose', () => {
    let closed = 0;
    render(<PlanExecutorPanel onClose={() => { closed = 1; }} />);
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(closed).toBe(1);
  });
});

describe('PlanExecutorPanel - Plan 数据展示', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('拉取 plan 成功应显示标题与状态', async () => {
    const mockPlan = {
      plan_id: 'plan-1',
      title: '测试 Plan',
      description: '描述文本',
      steps: [
        {
          step_id: 's1',
          title: '步骤 1',
          description: 'desc',
          action: 'noop',
          depends_on: [],
          status: 'ready',
          progress: 0,
          attempts: 0,
          max_attempts: 1,
        },
      ],
      status: 'draft',
      progress: 0,
      summary: { ready: 1, pending: 0, running: 0, completed: 0, failed: 0, skipped: 0, cancelled: 0 },
    };

    // 使用 sync 的 fetch 避免 React 18 act 警告
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ plan: mockPlan }),
      } as Response)
    ) as any;

    const { findByTestId } = render(<PlanExecutorPanel planId="plan-1" onClose={() => {}} />);
    const titleEl = await findByTestId('plan-title', {}, { timeout: 3000 });
    expect(titleEl.textContent).toContain('测试 Plan');
    const statusEl = await findByTestId('plan-status');
    expect(statusEl.textContent).toContain('草稿');
    expect(screen.getByTestId('plan-start-btn')).toBeTruthy();
  });

  it('拉取失败应显示错误信息', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500 } as Response)
    ) as any;

    const { findByTestId } = render(<PlanExecutorPanel planId="plan-err" onClose={() => {}} />);
    const errEl = await findByTestId('plan-error', {}, { timeout: 3000 });
    expect(errEl).toBeTruthy();
  });
});

describe('PlanExecutorPanel - step 渲染', () => {
  it('运行中 step 应显示进度条', async () => {
    const mockPlan = {
      plan_id: 'plan-2',
      title: 'p2',
      description: '',
      steps: [
        {
          step_id: 'running-step',
          title: '执行中步骤',
          description: '',
          action: 'noop',
          depends_on: [],
          status: 'running',
          progress: 0.5,
          attempts: 1,
          max_attempts: 3,
        },
      ],
      status: 'running',
      progress: 0.5,
      summary: { running: 1 },
    };

    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ plan: mockPlan }) } as Response)
    ) as any;

    const { findByTestId } = render(<PlanExecutorPanel planId="plan-2" onClose={() => {}} />);
    await findByTestId('plan-status');
    expect(screen.getByTestId('plan-step-running-step')).toBeTruthy();
  });

  it('失败 step 应显示重试/跳过按钮', async () => {
    const mockPlan = {
      plan_id: 'plan-3',
      title: 'p3',
      description: '',
      steps: [
        {
          step_id: 'failed-step',
          title: '失败步骤',
          description: '',
          action: 'fail',
          depends_on: [],
          status: 'failed',
          progress: 0,
          attempts: 1,
          max_attempts: 1,
          error: 'something went wrong',
        },
      ],
      status: 'failed',
      progress: 0,
      summary: { failed: 1 },
    };

    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ plan: mockPlan }) } as Response)
    ) as any;

    const { findByTestId } = render(<PlanExecutorPanel planId="plan-3" onClose={() => {}} />);
    await findByTestId('plan-status');
    expect(screen.getByTestId('step-retry-failed-step')).toBeTruthy();
    expect(screen.getByTestId('step-skip-failed-step')).toBeTruthy();
  });
});
