/**
 * # ============================================================
 * AutoFollowController 单元测试 (v1.0.0)
 * Cycle 58 G58-04
 * # ============================================================
 * 核心作用：验证 AutoFollowController 联动逻辑
 * 运行流程：
 *   1. mock useVibeCoding 与 useAutoFollow
 *   2. 渲染组件
 *   3. 改变 state，验证 follow 被调用
 *   4. 改变 steps，验证 step_completed 被触发
 * 输入参数：无
 * 输出结果：测试通过/失败
 * ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 58 G58-04 初次创建
 * ====================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import AutoFollowController from './AutoFollowController';

// ============================================================
// Mock hooks
// ====================================

const makeMockVibe = (overrides: Partial<{
  state: any;
  session: any;
}> = {}) => ({
  session: null,
  state: 'idle',
  isLoading: false,
  error: null,
  startSession: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  retryStep: vi.fn(),
  completedSteps: [],
  ...overrides,
} as any);

const makeMockAutoFollow = () => ({
  enabled: true,
  setEnabled: vi.fn(),
  follow: vi.fn(),
  lastFollowed: null,
} as any);

// ============================================================
// Tests
// ====================================

describe('AutoFollowController', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('渲染空（无 UI）', () => {
    const vibe = makeMockVibe();
    const autoFollow = makeMockAutoFollow();
    const { container } = render(
      <AutoFollowController autoFollow={autoFollow} vibeCoding={vibe} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('state 变为 planning 时触发 vibe_plan_generated', () => {
    const autoFollow = makeMockAutoFollow();
    const vibe = makeMockVibe({ state: 'planning' });
    render(<AutoFollowController autoFollow={autoFollow} vibeCoding={vibe} />);
    expect(autoFollow.follow).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'vibe_plan_generated' })
    );
  });

  it('state 变为 executing 时触发 vibe_step_started', () => {
    const autoFollow = makeMockAutoFollow();
    const vibe = makeMockVibe({ state: 'executing' });
    render(<AutoFollowController autoFollow={autoFollow} vibeCoding={vibe} />);
    expect(autoFollow.follow).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'vibe_step_started' })
    );
  });

  it('state 变为 reviewing 时触发 vibe_test_running', () => {
    const autoFollow = makeMockAutoFollow();
    const vibe = makeMockVibe({ state: 'reviewing' });
    render(<AutoFollowController autoFollow={autoFollow} vibeCoding={vibe} />);
    expect(autoFollow.follow).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'vibe_test_running' })
    );
  });

  it('state 变为 done 时触发 vibe_plan_completed', () => {
    const autoFollow = makeMockAutoFollow();
    const vibe = makeMockVibe({ state: 'done' });
    render(<AutoFollowController autoFollow={autoFollow} vibeCoding={vibe} />);
    expect(autoFollow.follow).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'vibe_plan_completed' })
    );
  });

  it('state 变为 error 时触发 vibe_step_failed', () => {
    const autoFollow = makeMockAutoFollow();
    const vibe = makeMockVibe({ state: 'error' });
    render(<AutoFollowController autoFollow={autoFollow} vibeCoding={vibe} />);
    expect(autoFollow.follow).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'vibe_step_failed' })
    );
  });

  it('state 为 idle 时不触发 follow', () => {
    const autoFollow = makeMockAutoFollow();
    const vibe = makeMockVibe({ state: 'idle' });
    render(<AutoFollowController autoFollow={autoFollow} vibeCoding={vibe} />);
    expect(autoFollow.follow).not.toHaveBeenCalled();
  });

  it('state 变为 clarifying 时不触发（vibe step 子映射无）', () => {
    const autoFollow = makeMockAutoFollow();
    const vibe = makeMockVibe({ state: 'clarifying' });
    render(<AutoFollowController autoFollow={autoFollow} vibeCoding={vibe} />);
    expect(autoFollow.follow).not.toHaveBeenCalled();
  });

  it('session.steps 含 completed step 时触发 vibe_step_completed', () => {
    const autoFollow = makeMockAutoFollow();
    const vibe = makeMockVibe({
      state: 'executing',
      session: {
        id: 's1',
        steps: [
          { id: 'step-1', name: '设计架构', status: 'completed' },
          { id: 'step-2', name: '实现', status: 'running' },
        ],
      },
    });
    render(<AutoFollowController autoFollow={autoFollow} vibeCoding={vibe} />);
    // 至少 1 次：state 变更 + step_completed
    expect(autoFollow.follow).toHaveBeenCalled();
    const calls = autoFollow.follow.mock.calls;
    const stepCompletedCall = calls.find(
      (c) => c[0].type === 'vibe_step_completed'
    );
    expect(stepCompletedCall).toBeTruthy();
    expect(stepCompletedCall![0].payload).toMatchObject({ stepId: 'step-1', stepName: '设计架构' });
  });

  it('session 为 null 时不触发 step_completed', () => {
    const autoFollow = makeMockAutoFollow();
    const vibe = makeMockVibe({ session: null });
    render(<AutoFollowController autoFollow={autoFollow} vibeCoding={vibe} />);
    const calls = autoFollow.follow.mock.calls;
    const stepCompletedCall = calls.find(
      (c) => c[0].type === 'vibe_step_completed'
    );
    expect(stepCompletedCall).toBeUndefined();
  });

  it('session.steps 全为 pending 时不触发 step_completed', () => {
    const autoFollow = makeMockAutoFollow();
    const vibe = makeMockVibe({
      session: {
        id: 's1',
        steps: [
          { id: 'step-1', status: 'pending' },
          { id: 'step-2', status: 'running' },
        ],
      },
    });
    render(<AutoFollowController autoFollow={autoFollow} vibeCoding={vibe} />);
    const calls = autoFollow.follow.mock.calls;
    const stepCompletedCall = calls.find(
      (c) => c[0].type === 'vibe_step_completed'
    );
    expect(stepCompletedCall).toBeUndefined();
  });
});
