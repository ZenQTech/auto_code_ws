/**
 * # ============================================================
 * # PlanExecutorPanel 组件单元测试
 * # Cycle 61 G61-04
 * # ====================================
 */

// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PlanExecutorPanel } from '../components/PlanExecutorPanel';

// 显式注册 jest-dom matchers（兜底，确保在所有环境中可用）
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { expect as vitestExpect } from 'vitest';
(vitestExpect as any).extend(jestDomMatchers);

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('PlanExecutorPanel - 基础渲染', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应渲染主框架', () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ plans: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    render(<PlanExecutorPanel testId="plan-panel" />);
    expect(screen.getByTestId('plan-panel')).toBeInTheDocument();
    expect(screen.getByTestId('plan-panel-prompt')).toBeInTheDocument();
    expect(screen.getByTestId('plan-panel-execute')).toBeInTheDocument();
  });

  it('应支持 close 回调', () => {
    const onClose = vi.fn();
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ plans: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    render(<PlanExecutorPanel testId="plan-panel" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('plan-panel-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('应支持 compact prop', () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ plans: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    render(<PlanExecutorPanel testId="plan-panel" compact={true} />);
    expect(screen.getByTestId('plan-panel').className).toContain('text-xs');
  });
});

describe('PlanExecutorPanel - 一键执行', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应允许输入 prompt', () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ plans: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    render(<PlanExecutorPanel testId="plan-panel" />);
    const input = screen.getByTestId('plan-panel-prompt');
    fireEvent.change(input, { target: { value: 'hello world' } });
    expect(input).toHaveValue('hello world');
  });

  it('应执行（成功路径）', async () => {
    const mockExecution = {
      execution_id: 'exec-1',
      plan_id: 'p1',
      status: 'running',
      progress: 0,
      step_results: [],
      started_at: Date.now() / 1000,
      finished_at: null,
    };
    const mockPlan = {
      plan_id: 'p1',
      title: 'Test',
      description: '',
      status: 'running',
      steps: [
        { step_id: 's1', title: 'Step 1', action: 'noop', status: 'completed', progress: 1, depends_on: [], attempts: 1, max_attempts: 1, output: {} },
      ],
      progress: 1,
      summary: { completed: 1, pending: 0, running: 0, failed: 0, skipped: 0, cancelled: 0, ready: 0 },
    };
    global.fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST' && url.endsWith('/plan-execute')) {
        return new Response(JSON.stringify({ ...mockExecution, plan: mockPlan }), { status: 200 });
      }
      return new Response(JSON.stringify({ plans: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    render(<PlanExecutorPanel testId="plan-panel" />);
    fireEvent.change(screen.getByTestId('plan-panel-prompt'), {
      target: { value: 'test prompt' },
    });
    fireEvent.click(screen.getByTestId('plan-panel-execute'));

    await waitFor(() => {
      expect(screen.getByTestId('plan-step-s1')).toBeInTheDocument();
    });
  });

  it('应显示错误', async () => {
    global.fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST' && url.endsWith('/plan-execute')) {
        return new Response(JSON.stringify({ detail: '分解失败' }), { status: 500 });
      }
      return new Response(JSON.stringify({ plans: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    render(<PlanExecutorPanel testId="plan-panel" />);
    fireEvent.change(screen.getByTestId('plan-panel-prompt'), {
      target: { value: 'test' },
    });
    fireEvent.click(screen.getByTestId('plan-panel-execute'));

    await waitFor(() => {
      expect(screen.getByTestId('plan-panel-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('plan-panel-error').textContent).toContain('分解失败');
  });

  it('空 prompt 应被禁用', () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ plans: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    render(<PlanExecutorPanel testId="plan-panel" />);
    const btn = screen.getByTestId('plan-panel-execute');
    expect(btn).toBeDisabled();
  });
});
