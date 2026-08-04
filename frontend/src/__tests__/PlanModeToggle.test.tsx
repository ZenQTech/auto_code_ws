/**
 * PlanModeToggle 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlanModeToggle, {
  getPlanMode,
  setPlanModeGlobal,
  subscribePlanMode,
  type PlanMode,
} from '../components/PlanModeToggle';

describe('PlanModeToggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('渲染三种模式选项', () => {
    render(<PlanModeToggle />);
    expect(screen.getByText('直接执行')).toBeInTheDocument();
    expect(screen.getByText('仅规划')).toBeInTheDocument();
    expect(screen.getByText('规划后执行')).toBeInTheDocument();
  });

  it('默认模式为 plan-only', () => {
    render(<PlanModeToggle />);
    const planOnlyRadio = screen.getByRole('radio', { name: /仅规划/ });
    expect(planOnlyRadio).toHaveAttribute('aria-checked', 'true');
  });

  it('点击切换模式', () => {
    render(<PlanModeToggle />);
    const offRadio = screen.getByRole('radio', { name: /直接执行/ });
    fireEvent.click(offRadio);
    expect(offRadio).toHaveAttribute('aria-checked', 'true');
  });

  it('onChange 回调被触发', () => {
    const onChange = vi.fn();
    render(<PlanModeToggle onChange={onChange} />);
    const offRadio = screen.getByRole('radio', { name: /直接执行/ });
    fireEvent.click(offRadio);
    expect(onChange).toHaveBeenCalledWith('off');
  });

  it('持久化到 localStorage', () => {
    render(<PlanModeToggle />);
    const offRadio = screen.getByRole('radio', { name: /直接执行/ });
    fireEvent.click(offRadio);
    expect(window.localStorage.getItem('hermes.solo.planMode')).toBe('off');
  });

  it('compact 模式只显示 emoji + 标签', () => {
    render(<PlanModeToggle compact={true} showLabel={true} />);
    // v1.1.0 G60-FIX-17: compact 模式使用 shortLabel（PLAN/OFF/AUTO）
    expect(screen.getByText('PLAN')).toBeInTheDocument();
  });

  it('getPlanMode 返回当前模式', () => {
    window.localStorage.setItem('hermes.solo.planMode', 'plan-then-execute');
    expect(getPlanMode()).toBe('plan-then-execute');
  });

  it('getPlanMode 默认返回 plan-only', () => {
    expect(getPlanMode()).toBe('plan-only');
  });

  it('setPlanModeGlobal 更新并通知订阅者', () => {
    const listener = vi.fn();
    const unsub = subscribePlanMode(listener);
    setPlanModeGlobal('off');
    expect(listener).toHaveBeenCalledWith('off');
    unsub();
  });

  it('订阅者清理函数有效', () => {
    const listener = vi.fn();
    const unsub = subscribePlanMode(listener);
    unsub();
    setPlanModeGlobal('plan-then-execute');
    expect(listener).not.toHaveBeenCalled();
  });

  it('data-testid 可定制', () => {
    render(<PlanModeToggle data-testid="my-toggle" />);
    expect(screen.getByTestId('my-toggle')).toBeInTheDocument();
  });

  it('mode=off 时显示为非激活态', () => {
    window.localStorage.setItem('hermes.solo.planMode', 'off');
    render(<PlanModeToggle />);
    const offRadio = screen.getByRole('radio', { name: /直接执行/ });
    expect(offRadio).toHaveAttribute('aria-checked', 'true');
  });

  it('role=radiogroup 标识正确', () => {
    render(<PlanModeToggle />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });

  it('所有模式都被映射为正确 label', () => {
    const { rerender } = render(<PlanModeToggle />);
    expect(screen.getByText('直接执行')).toBeInTheDocument();
    expect(screen.getByText('仅规划')).toBeInTheDocument();
    expect(screen.getByText('规划后执行')).toBeInTheDocument();
    rerender(<PlanModeToggle />);
  });

  it('多次切换后保持正确状态', () => {
    render(<PlanModeToggle />);
    const offRadio = screen.getByRole('radio', { name: /直接执行/ });
    const planOnlyRadio = screen.getByRole('radio', { name: /仅规划/ });
    const planThenExecRadio = screen.getByRole('radio', { name: /规划后执行/ });

    fireEvent.click(offRadio);
    expect(offRadio).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(planOnlyRadio);
    expect(planOnlyRadio).toHaveAttribute('aria-checked', 'true');
    expect(offRadio).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(planThenExecRadio);
    expect(planThenExecRadio).toHaveAttribute('aria-checked', 'true');
    expect(planOnlyRadio).toHaveAttribute('aria-checked', 'false');
  });

  it('PlanMode 类型导出正确', () => {
    const modes: PlanMode[] = ['off', 'plan-only', 'plan-then-execute'];
    expect(modes.length).toBe(3);
  });
});
