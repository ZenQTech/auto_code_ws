/**
 * # ============================================================
 * LocalLoading 单元测试（v1.0.0 P2-5）
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LocalLoading from './LocalLoading';

describe('LocalLoading', () => {
  it('loading=false 渲染 children', () => {
    render(
      <LocalLoading loading={false}>
        <div data-testid="content">我的内容</div>
      </LocalLoading>
    );
    expect(screen.getByTestId('content')).toBeTruthy();
  });

  it('loading=true inline 模式替换 children', () => {
    render(
      <LocalLoading loading={true} mode="inline" text="加载中">
        <div data-testid="content">我的内容</div>
      </LocalLoading>
    );
    expect(screen.queryByTestId('content')).toBeNull();
    expect(screen.getByText('加载中')).toBeTruthy();
  });

  it('loading=true overlay 模式覆盖在 children 之上', () => {
    render(
      <LocalLoading loading={true} mode="overlay" text="覆盖层">
        <div data-testid="content">我的内容</div>
      </LocalLoading>
    );
    // content 仍然渲染（透明）
    expect(screen.getByTestId('content')).toBeTruthy();
    // overlay 层存在
    expect(screen.getByTestId('local-loading-overlay')).toBeTruthy();
    expect(screen.getByText('覆盖层')).toBeTruthy();
  });

  it('loading=true skeleton 模式渲染多条骨架', () => {
    render(
      <LocalLoading loading={true} mode="skeleton" skeleton={{ count: 3 }}>
        <div>占位</div>
      </LocalLoading>
    );
    expect(screen.getByTestId('local-loading-skeleton-0')).toBeTruthy();
    expect(screen.getByTestId('local-loading-skeleton-1')).toBeTruthy();
    expect(screen.getByTestId('local-loading-skeleton-2')).toBeTruthy();
  });

  it('aria-busy=true 在加载时生效', () => {
    render(
      <LocalLoading loading={true} mode="inline">
        <div>占位</div>
      </LocalLoading>
    );
    const container = screen.getByTestId('local-loading');
    expect(container.getAttribute('aria-busy')).toBe('true');
  });

  it('data-loading 属性反映 loading 状态', () => {
    const { rerender } = render(
      <LocalLoading loading={true} mode="inline">
        <div>内容</div>
      </LocalLoading>
    );
    expect(screen.getByTestId('local-loading').getAttribute('data-loading')).toBe('true');

    rerender(
      <LocalLoading loading={false} mode="inline">
        <div>内容</div>
      </LocalLoading>
    );
    expect(screen.getByTestId('local-loading').getAttribute('data-loading')).toBe('false');
  });

  it('minHeight 样式生效', () => {
    render(
      <LocalLoading loading={true} mode="inline" minHeight="200px">
        <div>占位</div>
      </LocalLoading>
    );
    const container = screen.getByTestId('local-loading');
    expect(container.style.minHeight).toBe('200px');
  });

  it('data-mode 属性生效', () => {
    render(
      <LocalLoading loading={true} mode="overlay">
        <div>content</div>
      </LocalLoading>
    );
    expect(screen.getByTestId('local-loading').getAttribute('data-mode')).toBe('overlay');
  });
});
