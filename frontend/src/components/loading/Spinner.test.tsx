/**
 * # ============================================================
 * Spinner 单元测试（v1.0.0 P2-5）
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('默认渲染基础 spinner', () => {
    render(<Spinner />);
    const spinner = screen.getByTestId('spinner');
    expect(spinner).toBeTruthy();
    expect(spinner.getAttribute('data-component')).toBe('spinner');
    expect(spinner.getAttribute('role')).toBe('status');
  });

  it('设置 size=lg 时宽度为 32px', () => {
    render(<Spinner size="lg" />);
    const spinner = screen.getByTestId('spinner');
    expect(spinner.style.width).toBe('32px');
    expect(spinner.style.height).toBe('32px');
  });

  it('设置 size=24 时使用数字尺寸', () => {
    render(<Spinner size={48} />);
    const spinner = screen.getByTestId('spinner');
    expect(spinner.style.width).toBe('48px');
    expect(spinner.getAttribute('data-size')).toBe('48px');
  });

  it('设置 color=blue 时应用蓝色 class', () => {
    render(<Spinner color="blue" />);
    const spinner = screen.getByTestId('spinner');
    expect(spinner.getAttribute('data-color')).toBe('blue');
    expect(spinner.className).toContain('border-blue-200/40');
  });

  it('设置 thickness=thick 时边框宽度为 4px', () => {
    render(<Spinner thickness="thick" />);
    const spinner = screen.getByTestId('spinner');
    expect(spinner.style.borderWidth).toBe('4px');
  });

  it('设置 thickness=5 时使用数字厚度', () => {
    render(<Spinner thickness={5} />);
    const spinner = screen.getByTestId('spinner');
    expect(spinner.style.borderWidth).toBe('5px');
  });

  it('设置 label 时使用 aria-label', () => {
    render(<Spinner label="正在加载数据" />);
    const spinner = screen.getByTestId('spinner');
    expect(spinner.getAttribute('aria-label')).toBe('正在加载数据');
  });

  it('应用自定义 className', () => {
    render(<Spinner className="custom-class" />);
    const spinner = screen.getByTestId('spinner');
    expect(spinner.className).toContain('custom-class');
  });

  it('应用自定义 data-testid', () => {
    render(<Spinner data-testid="custom-spinner" />);
    expect(screen.getByTestId('custom-spinner')).toBeTruthy();
  });

  it('包含 animate-spin class', () => {
    render(<Spinner />);
    const spinner = screen.getByTestId('spinner');
    expect(spinner.className).toContain('animate-spin');
  });
});
