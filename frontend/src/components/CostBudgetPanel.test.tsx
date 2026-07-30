/**
 * CostBudgetPanel 组件测试 (v1.0.0 Cycle 28 G28-02)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CostBudgetPanel } from './CostBudgetPanel';
import { resetDefaultCostBudgetEngine } from '../utils/costBudgetEngine';

describe('CostBudgetPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultCostBudgetEngine();
  });

  it('打开时显示标题', () => {
    render(<CostBudgetPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/成本预算/)).toBeTruthy();
  });

  it('关闭时不渲染', () => {
    const { container } = render(<CostBudgetPanel isOpen={false} onClose={() => {}} />);
    expect(container.querySelector('[data-testid="cost-budget-panel"]')).toBeNull();
  });

  it('默认显示总览 Tab', () => {
    render(<CostBudgetPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('cost-budget-overview')).toBeTruthy();
  });

  it('切换到预算 Tab', () => {
    render(<CostBudgetPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('cost-budget-tab-budgets'));
    expect(screen.getByTestId('cost-budget-budgets')).toBeTruthy();
  });

  it('切换到模型 Tab', () => {
    render(<CostBudgetPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('cost-budget-tab-models'));
    expect(screen.getByTestId('cost-budget-models')).toBeTruthy();
  });

  it('点击关闭触发 onClose', () => {
    let closed = false;
    render(<CostBudgetPanel isOpen={true} onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByTestId('cost-budget-close'));
    expect(closed).toBe(true);
  });

  it('创建 Request 预算', () => {
    render(<CostBudgetPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('cost-budget-tab-budgets'));
    const input = screen.getByTestId('cost-budget-new-limit') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2.5' } });
    fireEvent.click(screen.getByTestId('cost-budget-create-request'));
  });

  it('总览显示 Fallback 链', () => {
    render(<CostBudgetPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/Fallback 链/)).toBeTruthy();
  });
});
