/**
 * # ============================================================
 * ProgressBar 单元测试（v1.0.0 P2-5）
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('默认渲染 0% 进度', () => {
    render(<ProgressBar />);
    const bar = screen.getByTestId('progress-bar');
    expect(bar).toBeTruthy();
    expect(bar.getAttribute('data-value')).toBe('0');
  });

  it('value=50 渲染 50% 宽度', () => {
    render(<ProgressBar value={50} />);
    const bar = screen.getByTestId('progress-bar');
    expect(bar.getAttribute('data-value')).toBe('50');
    const fill = screen.getByTestId('progress-bar-fill');
    expect(fill.style.width).toBe('50%');
  });

  it('value 超过 100 限制为 100', () => {
    render(<ProgressBar value={150} />);
    const bar = screen.getByTestId('progress-bar');
    expect(bar.getAttribute('data-value')).toBe('100');
  });

  it('value 小于 0 限制为 0', () => {
    render(<ProgressBar value={-10} />);
    const bar = screen.getByTestId('progress-bar');
    expect(bar.getAttribute('data-value')).toBe('0');
  });

  it('indeterminate=true 时不显示百分比', () => {
    render(<ProgressBar indeterminate showValue />);
    const bar = screen.getByTestId('progress-bar');
    expect(bar.getAttribute('data-indeterminate')).toBe('true');
    expect(screen.getByText('处理中…')).toBeTruthy();
  });

  it('indeterminate 时 fill 应用动画 class', () => {
    render(<ProgressBar indeterminate />);
    const fill = screen.getByTestId('progress-bar-fill');
    expect(fill.className).toContain('animate-progress-indeterminate');
  });

  it('showValue 时显示百分比文本', () => {
    render(<ProgressBar value={75} showValue />);
    expect(screen.getByText('75%')).toBeTruthy();
  });

  it('label 显示在顶部', () => {
    render(<ProgressBar label="下载进度" value={50} />);
    expect(screen.getByText('下载进度')).toBeTruthy();
  });

  it('formatValue 自定义格式化生效', () => {
    render(
      <ProgressBar
        value={5}
        showValue
        formatValue={(v) => `${v}/10`}
      />
    );
    expect(screen.getByText('5/10')).toBeTruthy();
  });

  it('size=lg 高度类名生效', () => {
    render(<ProgressBar size="lg" />);
    const bar = screen.getByTestId('progress-bar');
    // 通过 aria-valuenow 找内部 progressbar
    const innerBar = bar.querySelector('[role="progressbar"]');
    expect(innerBar?.className).toContain('h-3');
  });

  it('color=hermes 应用 hermes 颜色', () => {
    render(<ProgressBar value={50} color="hermes" />);
    const fill = screen.getByTestId('progress-bar-fill');
    expect(fill.className).toContain('bg-hermes-500');
  });

  it('color=gradient 应用渐变', () => {
    render(<ProgressBar value={50} color="gradient" />);
    const fill = screen.getByTestId('progress-bar-fill');
    expect(fill.className).toContain('bg-gradient-to-r');
  });

  it('role=progressbar 用于无障碍', () => {
    render(<ProgressBar value={50} />);
    const inner = screen.getByRole('progressbar');
    expect(inner.getAttribute('aria-valuenow')).toBe('50');
    expect(inner.getAttribute('aria-valuemin')).toBe('0');
    expect(inner.getAttribute('aria-valuemax')).toBe('100');
  });
});
