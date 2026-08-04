/**
 * # ============================================================
 * ClaudeCLIWorkbench 组件单元测试
 * Cycle 61 G61-03-T7
 * # ====================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ClaudeCLIWorkbench from '../components/ClaudeCLIWorkbench';

// Mock useResponsive
vi.mock('../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));

// Mock EventSource
class MockEventSource {
  url: string;
  onerror: ((e: Event) => void) | null = null;
  constructor(url: string) { this.url = url; }
  addEventListener() {}
  close() {}
}
(global as unknown as { EventSource: typeof MockEventSource }).EventSource = MockEventSource;

describe('ClaudeCLIWorkbench - 基础渲染', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应渲染主舞台（Claude CLI Stage）', () => {
    render(<ClaudeCLIWorkbench />);
    expect(screen.getByTestId('claude-cli-workbench-stage-prompt')).toBeInTheDocument();
    expect(screen.getByTestId('claude-cli-workbench-stage-invoke')).toBeInTheDocument();
  });

  it('应渲染 Auto-Follow Config 组件', () => {
    render(<ClaudeCLIWorkbench />);
    expect(screen.getByTestId('claude-cli-workbench-config')).toBeInTheDocument();
  });

  it('应渲染 SplitView 布局', () => {
    render(<ClaudeCLIWorkbench />);
    expect(screen.getByTestId('claude-cli-workbench-split')).toBeInTheDocument();
    expect(screen.getByTestId('claude-cli-workbench-split-divider')).toBeInTheDocument();
  });

  it('应渲染顶部状态栏', () => {
    render(<ClaudeCLIWorkbench />);
    expect(screen.getByTestId('claude-cli-workbench-topbar')).toBeInTheDocument();
  });

  it('应显示 Auto-Follow 状态', () => {
    render(<ClaudeCLIWorkbench />);
    expect(screen.getByTestId('claude-cli-workbench-autofollow-status')).toBeInTheDocument();
  });

  it('应显示 SplitView 状态', () => {
    render(<ClaudeCLIWorkbench />);
    expect(screen.getByTestId('claude-cli-workbench-splitview-status')).toBeInTheDocument();
  });

  it('应显示 Sticky 计数', () => {
    render(<ClaudeCLIWorkbench />);
    expect(screen.getByTestId('claude-cli-workbench-sticky-count')).toBeInTheDocument();
  });
});

describe('ClaudeCLIWorkbench - 沙箱卡片', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应渲染沙箱状态卡片', () => {
    render(<ClaudeCLIWorkbench />);
    expect(screen.getByTestId('claude-cli-workbench-sandbox-card')).toBeInTheDocument();
  });
});

describe('ClaudeCLIWorkbench - 事件历史', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应渲染事件历史区域', () => {
    render(<ClaudeCLIWorkbench />);
    expect(screen.getByTestId('claude-cli-workbench-events')).toBeInTheDocument();
  });
});
