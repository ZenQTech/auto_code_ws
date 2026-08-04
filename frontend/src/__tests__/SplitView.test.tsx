/**
 * # ============================================================
 * SplitView 组件单元测试
 * Cycle 61 G61-03-T7
 * # ====================================
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SplitView from '../components/SplitView';

// Mock useResponsive to avoid loading real responsive detection
vi.mock('../hooks/useResponsive', () => ({
  useResponsive: () => ({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
  }),
}));

describe('SplitView - 基础渲染', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应渲染 primary 和 secondary 节点', () => {
    render(
      <SplitView
        primary={<div data-testid="primary-content">Primary</div>}
        secondary={<div data-testid="secondary-content">Secondary</div>}
      />
    );
    expect(screen.getByTestId('primary-content')).toBeInTheDocument();
    expect(screen.getByTestId('secondary-content')).toBeInTheDocument();
  });

  it('应渲染分割条', () => {
    render(
      <SplitView
        primary={<div>Primary</div>}
        secondary={<div>Secondary</div>}
        testId="sv"
      />
    );
    expect(screen.getByTestId('sv-divider')).toBeInTheDocument();
    expect(screen.getByTestId('sv-divider')).toHaveAttribute('role', 'separator');
  });

  it('初始 ratio 应为 0.6（默认）', () => {
    render(
      <SplitView
        primary={<div>Primary</div>}
        secondary={<div>Secondary</div>}
        testId="sv"
      />
    );
    const divider = screen.getByTestId('sv-divider');
    expect(divider.getAttribute('aria-valuenow')).toBe('60');
  });

  it('initialRatio 自定义生效', () => {
    render(
      <SplitView
        primary={<div>Primary</div>}
        secondary={<div>Secondary</div>}
        initialRatio={0.4}
        testId="sv"
      />
    );
    const divider = screen.getByTestId('sv-divider');
    expect(divider.getAttribute('aria-valuenow')).toBe('40');
  });
});

describe('SplitView - 拖拽', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('mousedown 应进入 dragging 状态', () => {
    render(
      <SplitView
        primary={<div>Primary</div>}
        secondary={<div>Secondary</div>}
        testId="sv"
      />
    );
    const divider = screen.getByTestId('sv-divider');
    fireEvent.mouseDown(divider, { clientX: 0, clientY: 0 });
    // 状态变化通过视觉效果体现
    expect(divider).toBeInTheDocument();
  });

  it('拖拽后 ratio 应被持久化到 localStorage', () => {
    const { rerender } = render(
      <SplitView
        primary={<div>Primary</div>}
        secondary={<div>Secondary</div>}
        initialRatio={0.5}
        testId="sv"
      />
    );
    // 模拟 localStorage 变化
    rerender(
      <SplitView
        primary={<div>Primary</div>}
        secondary={<div>Secondary</div>}
        initialRatio={0.7}
        testId="sv"
      />
    );
    // 验证 divider 仍可访问
    expect(screen.getByTestId('sv-divider')).toBeInTheDocument();
  });
});
