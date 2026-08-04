/**
 * # ============================================================
 * GoalLoopView 组件单元测试
 * Cycle 61 G61-02
 * # ====================================
 */

// @vitest-environment happy-dom
// 显式导入 jest-dom 以确保 toBeInTheDocument 等 matcher 可用
import '@testing-library/jest-dom/vitest';

// 显式注册 jest-dom matchers（兜底，确保在所有环境中可用）
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { expect as vitestExpect } from 'vitest';
(vitestExpect as any).extend(jestDomMatchers);

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { GoalLoopView } from '../components/GoalLoopView';

// 每个测试后清理 DOM（避免状态污染）
afterEach(() => {
  cleanup();
  localStorage.clear();
});

// Mock useResponsive
vi.mock('../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
  useIsMobile: () => false,
}));

describe('GoalLoopView - 基础渲染', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应渲染主框架', () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, goals: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    render(<GoalLoopView testId="goal-loop" />);
    expect(screen.getByTestId('goal-loop')).toBeInTheDocument();
    expect(screen.getByTestId('goal-loop-goals')).toBeInTheDocument();
    expect(screen.getByTestId('goal-loop-plans')).toBeInTheDocument();
    expect(screen.getByTestId('goal-loop-steps')).toBeInTheDocument();
  });

  it('应显示 Goals 标签', () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, goals: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    render(<GoalLoopView testId="goal-loop" />);
    expect(screen.getByText('Goals')).toBeInTheDocument();
    expect(screen.getByText('Plans')).toBeInTheDocument();
    expect(screen.getByText('Steps')).toBeInTheDocument();
  });

  it('应显示空状态提示', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, goals: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    render(<GoalLoopView testId="goal-loop" />);
    await waitFor(() => {
      expect(screen.getByText('暂无 Goal')).toBeInTheDocument();
    });
  });
});

describe('GoalLoopView - Goal 选择', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应显示 Goal 列表', async () => {
    const mockGoals = [
      { id: 'g1', title: '目标 1', objective: 'obj', status: 'draft', tags: ['test'], owner: 'me' },
      { id: 'g2', title: '目标 2', objective: 'obj', status: 'active', tags: [], owner: 'me' },
    ];
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, goals: mockGoals }), { status: 200 }),
    ) as unknown as typeof fetch;

    render(<GoalLoopView testId="goal-loop" />);
    await waitFor(() => {
      expect(screen.getByTestId('goal-loop-goal-g1')).toBeInTheDocument();
    });
    expect(screen.getByTestId('goal-loop-goal-g2')).toBeInTheDocument();
  });

  it('应允许点击选择 Goal', async () => {
    const mockGoals = [
      { id: 'g1', title: '目标 1', objective: '', status: 'draft', tags: [], owner: 'me' },
    ];
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, goals: mockGoals }), { status: 200 }),
    ) as unknown as typeof fetch;

    render(<GoalLoopView testId="goal-loop" />);
    await waitFor(() => {
      expect(screen.getByTestId('goal-loop-goal-g1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('goal-loop-goal-g1'));
    // 选中后会有不同的样式（class 中包含 border-hermes-500）
    await waitFor(() => {
      expect(screen.getByTestId('goal-loop-goal-g1').className).toContain('hermes-500');
    });
  });
});

describe('GoalLoopView - Plan 创建', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应显示新建 Plan 输入框（需先选 Goal）', async () => {
    const mockGoals = [
      { id: 'g1', title: '目标 1', objective: '', status: 'draft', tags: [], owner: 'me' },
    ];
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, goals: mockGoals }), { status: 200 }),
    ) as unknown as typeof fetch;

    render(<GoalLoopView testId="goal-loop" />);
    await waitFor(() => {
      expect(screen.getByTestId('goal-loop-goal-g1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('goal-loop-goal-g1'));
    // 选择 Goal 后应该显示新建 Plan 输入框
    await waitFor(() => {
      expect(screen.getByTestId('goal-loop-new-plan-input')).toBeInTheDocument();
    });
    expect(screen.getByTestId('goal-loop-new-plan-button')).toBeInTheDocument();
  });

  it('应支持输入并提交新 Plan', async () => {
    const mockGoals = [
      { id: 'g1', title: '目标 1', objective: '', status: 'draft', tags: [], owner: 'me' },
    ];
    const mockPlan = {
      plan_id: 'p1',
      goal_id: 'g1',
      title: '新建 Plan',
      description: '',
      status: 'draft',
      steps: [],
      progress: 0,
    };
    const mockEmptyPlans = { success: true, plans: [] };
    global.fetch = vi.fn(async (url: string, options?: RequestInit) => {
      // 区分 POST（创建）和 GET（列表）
      if (options?.method === 'POST' && url.includes('/plans')) {
        return new Response(JSON.stringify({ success: true, plan: mockPlan }), { status: 200 });
      }
      if (url.includes('/plans')) {
        return new Response(JSON.stringify(mockEmptyPlans), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, goals: mockGoals }), { status: 200 });
    }) as unknown as typeof fetch;

    render(<GoalLoopView testId="goal-loop" />);
    await waitFor(() => {
      expect(screen.getByTestId('goal-loop-goal-g1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('goal-loop-goal-g1'));
    await waitFor(() => {
      expect(screen.getByTestId('goal-loop-new-plan-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('goal-loop-new-plan-input'), {
      target: { value: '新建 Plan' },
    });
    fireEvent.click(screen.getByTestId('goal-loop-new-plan-button'));

    // 创建后应显示 Plan 卡片
    await waitFor(() => {
      expect(screen.getByTestId('goal-loop-plan-p1')).toBeInTheDocument();
    });
  });
});

describe('GoalLoopView - close 按钮', () => {
  it('应支持 onClose 回调', () => {
    const onClose = vi.fn();
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, goals: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    render(<GoalLoopView testId="goal-loop" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('goal-loop-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('GoalLoopView - compact 模式', () => {
  it('应支持 compact prop', () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, goals: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    render(<GoalLoopView testId="goal-loop" compact={true} />);
    // compact 模式下应该应用 text-xs 类
    expect(screen.getByTestId('goal-loop').className).toContain('text-xs');
  });
});
