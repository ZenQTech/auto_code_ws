/**
 * # ============================================================
 * MobileHeader 组件测试（v1.0.0 P2-1）
 * # ============================================================
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MobileHeader from './MobileHeader';

class MockMediaQueryList {
  matches: boolean;
  media: string;
  private listeners: Set<(e: { matches: boolean }) => void> = new Set();
  constructor(query: string, initialMatches: boolean) {
    this.media = query;
    this.matches = initialMatches;
  }
  addEventListener(_: string, cb: (e: { matches: boolean }) => void) {
    this.listeners.add(cb);
  }
  removeEventListener(_: string, cb: (e: { matches: boolean }) => void) {
    this.listeners.delete(cb);
  }
  addListener(cb: (e: { matches: boolean }) => void) {
    this.listeners.add(cb);
  }
  removeListener(cb: (e: { matches: boolean }) => void) {
    this.listeners.delete(cb);
  }
}

function setMobileMode(isMobile: boolean) {
  window.matchMedia = vi.fn((query: string) => {
    const match = query.match(/min-width: (\d+)px/);
    const minWidth = match ? parseInt(match[1], 10) : 0;
    const matches = isMobile ? false : minWidth >= 768;
    return new MockMediaQueryList(query, matches) as unknown as MediaQueryList;
  }) as unknown as typeof window.matchMedia;
}

describe('MobileHeader', () => {
  beforeEach(() => {
    setMobileMode(true);
  });

  afterEach(() => {
    setMobileMode(false);
    document.body.innerHTML = '';
  });

  it('移动端渲染顶栏', () => {
    setMobileMode(true);
    render(<MobileHeader title="测试" />);
    expect(screen.getByTestId('mobile-header')).not.toBeNull();
  });

  it('桌面端不渲染顶栏', () => {
    setMobileMode(false);
    const { container } = render(<MobileHeader title="测试" />);
    const header = container.querySelector('[data-testid="mobile-header"]');
    expect(header).toBeNull();
  });

  it('显示 title', () => {
    setMobileMode(true);
    render(<MobileHeader title="我的会话" />);
    const title = screen.getByTestId('mobile-header-title');
    expect(title.textContent).toBe('我的会话');
  });

  it('默认 title 为 Hermes', () => {
    setMobileMode(true);
    render(<MobileHeader />);
    expect(screen.getByTestId('mobile-header-title').textContent).toBe('Hermes');
  });

  it('点击汉堡按钮触发 onMenuClick', () => {
    setMobileMode(true);
    const onMenuClick = vi.fn();
    render(<MobileHeader onMenuClick={onMenuClick} />);
    fireEvent.click(screen.getByTestId('mobile-header-menu'));
    expect(onMenuClick).toHaveBeenCalledTimes(1);
  });

  it('点击主操作按钮触发 onPrimaryAction', () => {
    setMobileMode(true);
    const onPrimaryAction = vi.fn();
    render(<MobileHeader onPrimaryAction={onPrimaryAction} />);
    fireEvent.click(screen.getByTestId('mobile-header-primary'));
    expect(onPrimaryAction).toHaveBeenCalledTimes(1);
  });

  it('未传 onPrimaryAction 时不渲染主操作按钮', () => {
    setMobileMode(true);
    const { container } = render(<MobileHeader />);
    const btn = container.querySelector('[data-testid="mobile-header-primary"]');
    expect(btn).toBeNull();
  });

  it('主操作按钮显示自定义图标', () => {
    setMobileMode(true);
    render(<MobileHeader onPrimaryAction={() => {}} primaryActionIcon="⚡" />);
    const btn = screen.getByTestId('mobile-header-primary');
    expect(btn.textContent).toBe('⚡');
  });

  it('主操作按钮显示自定义 aria-label', () => {
    setMobileMode(true);
    render(<MobileHeader onPrimaryAction={() => {}} primaryActionLabel="新建会话" />);
    const btn = screen.getByTestId('mobile-header-primary');
    expect(btn.getAttribute('aria-label')).toBe('新建会话');
  });

  it('汉堡按钮包含 aria-label', () => {
    setMobileMode(true);
    render(<MobileHeader onMenuClick={() => {}} />);
    const btn = screen.getByTestId('mobile-header-menu');
    expect(btn.getAttribute('aria-label')).toBe('打开菜单');
  });
});
