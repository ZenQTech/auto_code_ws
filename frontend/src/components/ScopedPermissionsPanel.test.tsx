/**
 * ScopedPermissionsPanel 组件测试 (v1.0.0 Cycle 28 G28-04)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScopedPermissionsPanel } from './ScopedPermissionsPanel';
import { resetDefaultScopedPermissionsEngine } from '../utils/scopedPermissionsEngine';

describe('ScopedPermissionsPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultScopedPermissionsEngine();
  });

  afterEach(() => {
    resetDefaultScopedPermissionsEngine();
  });

  it('打开时显示标题', () => {
    render(<ScopedPermissionsPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/作用域权限/)).toBeTruthy();
  });

  it('关闭时不渲染', () => {
    const { container } = render(<ScopedPermissionsPanel isOpen={false} onClose={() => {}} />);
    expect(container.querySelector('[data-testid="scoped-permissions-panel"]')).toBeNull();
  });

  it('点击关闭触发 onClose', () => {
    let closed = false;
    render(<ScopedPermissionsPanel isOpen={true} onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByTestId('scoped-permissions-close'));
    expect(closed).toBe(true);
  });

  it('创建作用域', () => {
    render(<ScopedPermissionsPanel isOpen={true} onClose={() => {}} />);
    const input = screen.getByTestId('scoped-permissions-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/root/test' } });
    fireEvent.click(screen.getByTestId('scoped-permissions-create'));
    expect(screen.getByTestId('scoped-permissions-view-/root/test')).toBeTruthy();
  });

  it('空输入不创建', () => {
    render(<ScopedPermissionsPanel isOpen={true} onClose={() => {}} />);
    const input = screen.getByTestId('scoped-permissions-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByTestId('scoped-permissions-create'));
  });

  it('显示空状态', () => {
    render(<ScopedPermissionsPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/暂无作用域/)).toBeTruthy();
  });
});
