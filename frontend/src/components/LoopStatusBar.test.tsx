/**
 * # ============================================================
 * LoopStatusBar.test.tsx - LoopStatusBar 单元测试
 * Cycle 60 G60-2.1
 * # ============================================================
 * 核心作用：验证 Goal mode 岛台按钮启用/禁用逻辑 + 主题切换器
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 60 G60-2.1 初次创建
 * ============================================================
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import LoopStatusBar from './LoopStatusBar';

// mock ThemeSwitcher
vi.mock('./ThemeSwitcher', () => ({
  ThemeSwitcher: () => <div data-testid="theme-switcher">ThemeSwitcher</div>,
}));

describe('LoopStatusBar 组件', () => {
  const baseProps = {
    loopState: null,
    progress: 0.5,
    eta: 0,
    history: [],
    vibeState: 'idle' as const,
    sessionActive: false,
  };

  beforeEach(() => {
    document.documentElement.dataset.theme = 'dark';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('G60-2.1-LSB-01: 基础渲染无崩溃', () => {
    render(<LoopStatusBar {...baseProps} />);
    expect(screen.getByTestId('loop-status-bar')).toBeDefined();
  });

  test('G60-2.1-LSB-02: sessionActive=true 显示 vibe-state-badge', () => {
    render(<LoopStatusBar {...baseProps} sessionActive={true} vibeState="executing" />);
    expect(screen.getByTestId('vibe-state-badge')).toBeDefined();
  });

  test('G60-2.1-LSB-03: 提供 onPause 时渲染暂停按钮', () => {
    const onPause = vi.fn();
    render(<LoopStatusBar {...baseProps} onPause={onPause} />);
    expect(screen.getByTestId('status-pause-btn')).toBeDefined();
  });

  test('G60-2.1-LSB-04: stage=executing 时暂停按钮可用', () => {
    const onPause = vi.fn();
    render(
      <LoopStatusBar
        {...baseProps}
        onPause={onPause}
        loopState={{ stage: 'executing' } as any}
      />,
    );
    const btn = screen.getByTestId('status-pause-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  test('G60-2.1-LSB-05: stage!=executing 时暂停按钮禁用', () => {
    const onPause = vi.fn();
    render(
      <LoopStatusBar
        {...baseProps}
        onPause={onPause}
        loopState={{ stage: 'paused' } as any}
      />,
    );
    const btn = screen.getByTestId('status-pause-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  test('G60-2.1-LSB-06: stage=paused 时恢复按钮可用', () => {
    const onResume = vi.fn();
    render(
      <LoopStatusBar
        {...baseProps}
        onResume={onResume}
        loopState={{ stage: 'paused' } as any}
      />,
    );
    const btn = screen.getByTestId('status-resume-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  test('G60-2.1-LSB-07: 取消按钮在 executing/paused 可用', () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <LoopStatusBar
        {...baseProps}
        onCancel={onCancel}
        loopState={{ stage: 'done' } as any}
      />,
    );
    expect((screen.getByTestId('status-cancel-btn') as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <LoopStatusBar
        {...baseProps}
        onCancel={onCancel}
        loopState={{ stage: 'executing' } as any}
      />,
    );
    expect((screen.getByTestId('status-cancel-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  test('G60-2.1-LSB-08: 提供 onToggleAutoFollow 时渲染 auto-follow 按钮', () => {
    const onToggle = vi.fn();
    render(
      <LoopStatusBar
        {...baseProps}
        onToggleAutoFollow={onToggle}
        autoFollowEnabled={true}
      />,
    );
    const btn = screen.getByTestId('status-auto-follow-btn') as HTMLButtonElement;
    expect(btn).toBeDefined();
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalled();
  });

  test('G60-2.1-LSB-09: 默认显示 ThemeSwitcher', () => {
    render(<LoopStatusBar {...baseProps} />);
    expect(screen.getByTestId('theme-switcher')).toBeDefined();
  });

  test('G60-2.1-LSB-10: showThemeSwitcher=false 隐藏', () => {
    render(<LoopStatusBar {...baseProps} showThemeSwitcher={false} />);
    expect(screen.queryByTestId('theme-switcher')).toBeNull();
  });

  test('G60-2.1-LSB-11: 向后兼容 - 不传 onPause 仍可渲染', () => {
    render(<LoopStatusBar {...baseProps} />);
    expect(screen.queryByTestId('status-pause-btn')).toBeNull();
    // 但 ThemeSwitcher 仍可见
    expect(screen.getByTestId('theme-switcher')).toBeDefined();
  });

  test('G60-2.1-LSB-12: progress=0.5 时进度条 50%', () => {
    render(<LoopStatusBar {...baseProps} progress={0.5} />);
    const bar = screen.getByTestId('loop-progress-bar') as HTMLDivElement;
    expect(bar.style.width).toBe('50%');
    expect(screen.getByTestId('loop-progress-percent').textContent).toBe('50%');
  });
});
