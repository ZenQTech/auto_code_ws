/**
 * # ============================================================
 * Loading 统一入口单元测试（v1.0.0 P2-5）
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Loading } from './Loading';

describe('Loading', () => {
  it('默认 variant=spinner 渲染 Spinner', () => {
    render(<Loading />);
    const loading = screen.getByTestId('loading');
    expect(loading).toBeTruthy();
    expect(loading.getAttribute('data-variant')).toBe('spinner');
  });

  it('variant=skeleton 渲染 Skeleton', () => {
    render(<Loading variant="skeleton" />);
    const loading = screen.getByTestId('loading');
    expect(loading.getAttribute('data-variant')).toBe('skeleton');
  });

  it('variant=progress 渲染 ProgressBar', () => {
    render(<Loading variant="progress" value={50} />);
    const loading = screen.getByTestId('loading');
    expect(loading.getAttribute('data-variant')).toBe('progress');
  });

  it('variant=dots 渲染跳动点', () => {
    render(<Loading variant="dots" />);
    const loading = screen.getByTestId('loading');
    expect(loading.getAttribute('data-component')).toBe('loading-dots');
  });

  it('variant=streaming 渲染跳动点', () => {
    render(<Loading variant="streaming" />);
    const loading = screen.getByTestId('loading');
    expect(loading.getAttribute('data-component')).toBe('loading-dots');
  });

  it('text 在 spinner 模式下显示', () => {
    render(<Loading variant="spinner" text="加载数据中" />);
    expect(screen.getByText('加载数据中')).toBeTruthy();
  });

  it('layout=center 时使用 center 样式', () => {
    render(<Loading variant="spinner" layout="center" />);
    const loading = screen.getByTestId('loading');
    expect(loading.getAttribute('data-layout')).toBe('center');
    expect(loading.className).toContain('flex-col');
  });

  it('layout=inline 时使用 inline 样式', () => {
    render(<Loading variant="spinner" layout="inline" />);
    const loading = screen.getByTestId('loading');
    expect(loading.getAttribute('data-layout')).toBe('inline');
    expect(loading.className).toContain('inline-flex');
  });

  it('layout=overlay 时使用绝对定位', () => {
    render(<Loading variant="spinner" layout="overlay" />);
    const loading = screen.getByTestId('loading');
    expect(loading.className).toContain('absolute');
  });

  it('skeleton count=5 渲染多条', () => {
    render(<Loading variant="skeleton" skeleton={{ count: 5 }} />);
    expect(screen.getByTestId('loading-item-0')).toBeTruthy();
    expect(screen.getByTestId('loading-item-4')).toBeTruthy();
  });

  it('progress indeterminate 模式生效', () => {
    render(<Loading variant="progress" indeterminate />);
    const bar = screen.getByTestId('loading-bar');
    expect(bar.getAttribute('data-indeterminate')).toBe('true');
  });

  it('data-size 属性生效', () => {
    render(<Loading size="lg" />);
    const loading = screen.getByTestId('loading');
    expect(loading.getAttribute('data-size')).toBe('lg');
  });
});
