/**
 * # ============================================================
 * # EmptyState 单元测试 (v1.0.0 Cycle 23 UI/UX 优化)
 * # ============================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState 组件', () => {
  it('应渲染标题和描述', () => {
    render(<EmptyState title="暂无数据" description="当前没有可显示的内容" />);
    expect(screen.getByText('暂无数据')).toBeTruthy();
    expect(screen.getByText('当前没有可显示的内容')).toBeTruthy();
  });

  it('应渲染 emoji 图标', () => {
    render(<EmptyState icon="🎯" title="Test" />);
    const el = screen.getByText('🎯');
    expect(el).toBeTruthy();
  });

  it('主操作按钮点击应触发回调', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="Test"
        action={{ label: '新建', onClick }}
      />
    );
    fireEvent.click(screen.getByText('新建'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('次操作按钮点击应触发回调', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="Test"
        secondaryAction={{ label: '刷新', onClick }}
      />
    );
    fireEvent.click(screen.getByText('刷新'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('应使用 testId 渲染', () => {
    render(<EmptyState title="Test" testId="custom-empty" />);
    expect(screen.getByTestId('custom-empty')).toBeTruthy();
  });

  it('不同 tone 应生成不同的 data 属性', () => {
    const { rerender } = render(<EmptyState title="T" tone="info" testId="es-1" />);
    expect(screen.getByTestId('es-1').getAttribute('data-tone')).toBe('info');
    rerender(<EmptyState title="T" tone="danger" testId="es-1" />);
    expect(screen.getByTestId('es-1').getAttribute('data-tone')).toBe('danger');
  });

  it('compact 模式应正常渲染', () => {
    render(<EmptyState title="T" compact testId="es-c" />);
    expect(screen.getByTestId('es-c')).toBeTruthy();
  });
});
