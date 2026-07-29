/**
 * HooksManagerPanel 集成测试 (v1.0.0 Cycle 20 P0-3)
 * 覆盖：UI 渲染、类型切换、注册表单、触发
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { HooksManagerPanel } from './HooksManagerPanel';
import { resetHooksEngine, getHooksEngine } from '../utils/hooksEngine';

// @vitest-environment happy-dom

describe('HooksManagerPanel', () => {
  beforeEach(() => {
    resetHooksEngine();
  });

  afterEach(() => {
    cleanup();
  });

  it('面板未打开时不渲染', () => {
    const { container } = render(<HooksManagerPanel isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('面板打开时显示标题', () => {
    render(<HooksManagerPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('事件钩子')).toBeTruthy();
  });

  it('显示所有 hook 类型按钮', () => {
    render(<HooksManagerPanel isOpen={true} onClose={vi.fn()} />);
    const types = ['before_prompt', 'after_prompt', 'before_response', 'after_response', 'thinking', 'subagent_start', 'subagent_end', 'compaction', 'turn_complete', 'tool_execution'];
    for (const t of types) {
      expect(screen.getByTestId(`hook-manager-type-${t}`)).toBeTruthy();
    }
  });

  it('显示触发和注册按钮', () => {
    render(<HooksManagerPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('hooks-manager-trigger')).toBeTruthy();
    expect(screen.getByTestId('hooks-manager-register')).toBeTruthy();
  });

  it('点击注册按钮显示表单', () => {
    render(<HooksManagerPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('hooks-manager-register'));
    expect(screen.getByTestId('hooks-manager-form-name')).toBeTruthy();
  });

  it('切换 hook 类型', () => {
    render(<HooksManagerPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('hook-manager-type-after_prompt'));
    expect(screen.getByTestId('hook-manager-type-after_prompt').className).toContain('bg-hermes-500');
  });

  it('注册 callback hook', () => {
    const engine = getHooksEngine();
    const initialCount = engine.list().length;
    render(<HooksManagerPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('hooks-manager-register'));
    const input = screen.getByTestId('hooks-manager-form-name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'test-hook' } });
    fireEvent.click(screen.getByTestId('hooks-manager-form-submit'));
    expect(engine.list().length).toBe(initialCount + 1);
  });

  it('关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<HooksManagerPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('hooks-manager-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('触发按钮调用 triggerHook', async () => {
    const engine = getHooksEngine();
    engine.registerHook({
      id: 'test-h1',
      type: 'before_prompt',
      name: 'test',
      scope: 'user',
      enabled: true,
      action: { type: 'callback', handler: () => undefined },
      createdAt: Date.now(),
      createdBy: 'test',
      priority: 100,
      timeoutMs: 1000,
      retries: 0,
      fallback: 'ignore',
    });
    render(<HooksManagerPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('hooks-manager-trigger'));
    await waitFor(() => {
      expect(engine.getExecutionLog().length).toBeGreaterThan(0);
    });
  });
});
