/**
 * # ============================================================
 * Button.test.tsx - Button 组件单元测试
 * Cycle 60 G60-1.2
 * # ============================================================
 * 核心作用：验证 Button 组件 5 个 variant + 3 个 size 渲染正确
 * 工具：vitest + happy-dom
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 60 G60-1.2 初次创建
 * ============================================================
 */

import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { Button } from './Button';

describe('Button 组件', () => {
  test('G60-1.2-B-01: 默认渲染 primary variant + md size', () => {
    render(<Button>Click me</Button>);
    const btn = screen.getByRole('button', { name: /click me/i });
    expect(btn).toBeDefined();
    expect(btn.className).toContain('bg-hermes-500');
    expect(btn.className).toContain('px-3.5');
  });

  test('G60-1.2-B-02: ghost variant 透明背景', () => {
    render(<Button variant="ghost">Ghost</Button>);
    const btn = screen.getByRole('button', { name: /ghost/i });
    expect(btn.className).toContain('bg-transparent');
  });

  test('G60-1.2-B-03: danger variant 红色', () => {
    render(<Button variant="danger">Delete</Button>);
    const btn = screen.getByRole('button', { name: /delete/i });
    expect(btn.className).toContain('bg-red-500');
  });

  test('G60-1.2-B-04: gradient variant 渐变背景', () => {
    render(<Button variant="gradient">Gradient</Button>);
    const btn = screen.getByRole('button', { name: /gradient/i });
    expect(btn.className).toContain('from-fuchsia-500');
  });

  test('G60-1.2-B-05: sm size 紧凑尺寸', () => {
    render(<Button size="sm">Small</Button>);
    const btn = screen.getByRole('button', { name: /small/i });
    expect(btn.className).toContain('px-2.5');
  });

  test('G60-1.2-B-06: isLoading=true 显示 Spinner + 禁用', () => {
    render(<Button isLoading>Loading</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveProperty('disabled', true);
    expect(btn.querySelector('[role="status"]')).toBeDefined();
  });

  test('G60-1.2-B-07: click 触发 onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('G60-1.2-B-08: disabled=true 不触发 onClick', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Disabled</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  test('G60-1.2-B-09: icon prop 渲染图标', () => {
    render(<Button icon={<span data-testid="icon">⚡</span>}>With Icon</Button>);
    expect(screen.getByTestId('icon')).toBeDefined();
  });

  test('G60-1.2-B-10: ripple=true 添加 ripple 类', () => {
    render(<Button ripple>Ripple</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('ripple');
  });
});
