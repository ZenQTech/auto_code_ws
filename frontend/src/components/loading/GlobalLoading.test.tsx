/**
 * # ============================================================
 * GlobalLoading 单元测试（v1.0.0 P2-5）
 * # ============================================================
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GlobalLoading from './GlobalLoading';

describe('GlobalLoading', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });

  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('visible=false 不渲染', () => {
    const { container } = render(<GlobalLoading visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('visible=true 渲染到 body 末尾（Portal）', () => {
    render(<GlobalLoading visible text="加载中" />);
    const loading = screen.getByTestId('global-loading');
    expect(loading).toBeTruthy();
    expect(loading.getAttribute('data-visible')).toBe('true');
    expect(loading.parentElement).toBe(document.body);
  });

  it('text 传递给 Loading', () => {
    render(<GlobalLoading visible text="数据加载中" />);
    expect(screen.getByText('数据加载中')).toBeTruthy();
  });

  it('默认 closable=false 点击背景不关闭', () => {
    const onClose = vi.fn();
    render(<GlobalLoading visible onClose={onClose} />);
    const backdrop = screen.getByTestId('global-loading');
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closable=true 点击背景触发 onClose', () => {
    const onClose = vi.fn();
    render(<GlobalLoading visible closable onClose={onClose} />);
    const backdrop = screen.getByTestId('global-loading');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('visible=true 时锁定 body 滚动', () => {
    render(<GlobalLoading visible />);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('visible=false 时恢复 body 滚动', () => {
    document.body.style.overflow = 'auto';
    const { rerender } = render(<GlobalLoading visible />);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<GlobalLoading visible={false} />);
    expect(document.body.style.overflow).toBe('auto');
  });

  it('点击 panel 不会触发背景关闭', () => {
    const onClose = vi.fn();
    render(<GlobalLoading visible closable onClose={onClose} />);
    const panel = screen.getByTestId('global-loading-panel');
    fireEvent.click(panel);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('role=dialog & aria-modal=true', () => {
    render(<GlobalLoading visible />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });
});
