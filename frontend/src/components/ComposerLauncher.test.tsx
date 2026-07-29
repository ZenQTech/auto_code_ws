/**
 * # ============================================================
 * ComposerLauncher 入口组件测试 (v6.36.0 Cycle 16 P0-1)
 * # ============================================================
 * 核心作用：验证 ComposerLauncher 入口组件
 * 测试覆盖：5 个测试
 * ============================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComposerLauncher, useSharedEngine, resetSharedEngine } from './ComposerLauncher';

describe('ComposerLauncher - 基础', () => {
  beforeEach(() => {
    resetSharedEngine();
  });

  it('默认不渲染面板', () => {
    render(<ComposerLauncher />);
    expect(screen.queryByTestId('composer-panel')).not.toBeInTheDocument();
  });

  it('externalIsOpen=true 时渲染面板', () => {
    render(<ComposerLauncher externalIsOpen={true} />);
    expect(screen.getByTestId('composer-panel')).toBeInTheDocument();
  });

  it('回调触发 onVisibilityChange', () => {
    const onVisibilityChange = vi.fn();
    render(
      <ComposerLauncher
        externalIsOpen={true}
        onVisibilityChange={onVisibilityChange}
      />,
    );
    // 第一次渲染时应触发一次回调
    expect(onVisibilityChange).toHaveBeenCalledWith(true);
  });

  it('useSharedEngine 返回同一实例', () => {
    const e1 = useSharedEngine();
    const e2 = useSharedEngine();
    expect(e1).toBe(e2);
  });

  it('resetSharedEngine 销毁后创建新实例', () => {
    const e1 = useSharedEngine();
    resetSharedEngine();
    const e2 = useSharedEngine();
    expect(e1).not.toBe(e2);
  });
});
