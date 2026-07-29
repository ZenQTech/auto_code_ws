/**
 * # ============================================================
 * ModeToggle 组件测试 (v6.37.0 Cycle 17 P0-2)
 * # ============================================================
 * 测试覆盖：8 个测试
 * ============================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModeToggle, ModeIndicator } from './ModeToggle';
import type { HermesMode } from '../hooks/useMode';

describe('ModeToggle', () => {
  it('渲染三种模式选项', () => {
    render(<ModeToggle value="chat" onChange={vi.fn()} />);
    expect(screen.getByTestId('mode-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('mode-toggle-chat')).toBeInTheDocument();
    expect(screen.getByTestId('mode-toggle-composer')).toBeInTheDocument();
    expect(screen.getByTestId('mode-toggle-agent')).toBeInTheDocument();
  });

  it('当前模式有 data-active', () => {
    render(<ModeToggle value="composer" onChange={vi.fn()} />);
    const composerBtn = screen.getByTestId('mode-toggle-composer');
    expect(composerBtn).toHaveAttribute('aria-selected', 'true');
  });

  it('点击选项触发 onChange', () => {
    const onChange = vi.fn();
    render(<ModeToggle value="chat" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('mode-toggle-agent'));
    expect(onChange).toHaveBeenCalledWith('agent');
  });

  it('data-testid 反映当前值', () => {
    const { rerender } = render(<ModeToggle value="chat" onChange={vi.fn()} />);
    expect(screen.getByTestId('mode-toggle')).toHaveAttribute('data-mode', 'chat');

    rerender(<ModeToggle value="agent" onChange={vi.fn()} />);
    expect(screen.getByTestId('mode-toggle')).toHaveAttribute('data-mode', 'agent');
  });

  it('快捷键提示通过 title 属性展示', () => {
    render(<ModeToggle value="chat" onChange={vi.fn()} />);
    const chatBtn = screen.getByTestId('mode-toggle-chat');
    expect(chatBtn.getAttribute('title')).toContain('⌘L');
  });
});

describe('ModeIndicator', () => {
  it('显示当前模式', () => {
    render(<ModeIndicator mode="composer" />);
    expect(screen.getByTestId('mode-indicator')).toHaveAttribute('data-mode', 'composer');
  });

  it('包含模式 label', () => {
    render(<ModeIndicator mode="agent" />);
    expect(screen.getByText('Agent')).toBeInTheDocument();
  });

  it('未知模式返回 null', () => {
    const { container } = render(<ModeIndicator mode={'unknown' as HermesMode} />);
    expect(container.firstChild).toBeNull();
  });
});
