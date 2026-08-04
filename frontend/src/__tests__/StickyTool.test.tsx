/**
 * # ============================================================
 * StickyTool 组件单元测试
 * Cycle 61 G61-03-T7
 * # ====================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StickyTool from '../components/StickyTool';

describe('StickyTool - 基础渲染', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应渲染 children', () => {
    render(
      <StickyTool panel="vibeCoding">
        <div data-testid="child">Content</div>
      </StickyTool>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('应显示 📌 pin 标记', () => {
    render(
      <StickyTool panel="vibeCoding">
        <div>Content</div>
      </StickyTool>
    );
    const pin = screen.getByTestId('sticky-tool-vibeCoding-pin');
    expect(pin).toBeInTheDocument();
    expect(pin).toHaveAttribute('aria-label', 'sticky');
    expect(pin.textContent).toContain('📌');
  });

  it('应设置 data-sticky-panel 属性', () => {
    render(
      <StickyTool panel="planExecutor">
        <div>Content</div>
      </StickyTool>
    );
    const el = screen.getByTestId('sticky-tool-planExecutor');
    expect(el.getAttribute('data-sticky-panel')).toBe('planExecutor');
  });
});

describe('StickyTool - hover 行为', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('未提供 onUnstick 时不应显示 unpin 按钮', () => {
    render(
      <StickyTool panel="vibeCoding">
        <div>Content</div>
      </StickyTool>
    );
    expect(screen.queryByTestId('sticky-tool-vibeCoding-unpin')).not.toBeInTheDocument();
  });

  it('hover 时显示 unpin 按钮', () => {
    render(
      <StickyTool panel="vibeCoding" onUnstick={vi.fn()}>
        <div>Content</div>
      </StickyTool>
    );
    const el = screen.getByTestId('sticky-tool-vibeCoding');
    fireEvent.mouseEnter(el);
    expect(screen.getByTestId('sticky-tool-vibeCoding-unpin')).toBeInTheDocument();
  });

  it('mouseleave 隐藏 unpin 按钮', () => {
    render(
      <StickyTool panel="vibeCoding" onUnstick={vi.fn()}>
        <div>Content</div>
      </StickyTool>
    );
    const el = screen.getByTestId('sticky-tool-vibeCoding');
    fireEvent.mouseEnter(el);
    fireEvent.mouseLeave(el);
    expect(screen.queryByTestId('sticky-tool-vibeCoding-unpin')).not.toBeInTheDocument();
  });

  it('点击 unpin 应调用 onUnstick', () => {
    const onUnstick = vi.fn();
    render(
      <StickyTool panel="vibeCoding" onUnstick={onUnstick}>
        <div>Content</div>
      </StickyTool>
    );
    const el = screen.getByTestId('sticky-tool-vibeCoding');
    fireEvent.mouseEnter(el);
    fireEvent.click(screen.getByTestId('sticky-tool-vibeCoding-unpin'));
    expect(onUnstick).toHaveBeenCalledWith('vibeCoding');
  });
});
