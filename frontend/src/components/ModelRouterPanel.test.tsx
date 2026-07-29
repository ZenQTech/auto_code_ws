/**
 * ModelRouterPanel 集成测试 (v1.0.0 Cycle 20 P0-2)
 * 覆盖：UI 渲染、模式切换、路由测试、模型库展示
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ModelRouterPanel } from './ModelRouterPanel';
import { resetModelRouter, getModelRouter } from '../utils/modelRouter';

// @vitest-environment happy-dom

describe('ModelRouterPanel', () => {
  beforeEach(() => {
    resetModelRouter();
  });

  afterEach(() => {
    cleanup();
  });

  it('面板未打开时不渲染', () => {
    const { container } = render(<ModelRouterPanel isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('面板打开时显示标题', () => {
    render(<ModelRouterPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('模型路由')).toBeTruthy();
  });

  it('显示 3 种路由模式', () => {
    render(<ModelRouterPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('mode-cost')).toBeTruthy();
    expect(screen.getByTestId('mode-balance')).toBeTruthy();
    expect(screen.getByTestId('mode-intelligence')).toBeTruthy();
  });

  it('显示模型库', () => {
    render(<ModelRouterPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('model-router-models')).toBeTruthy();
    const m = getModelRouter();
    expect(m.listModels().length).toBeGreaterThan(0);
  });

  it('切换路由模式', () => {
    const m = getModelRouter();
    const initial = m.getMode();
    render(<ModelRouterPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('mode-cost'));
    expect(m.getMode()).toBe('cost');
    expect(m.getMode()).not.toBe(initial);
  });

  it('输入 prompt 后显示分类和复杂度', () => {
    render(<ModelRouterPanel isOpen={true} onClose={vi.fn()} />);
    const textarea = screen.getByTestId('model-router-prompt') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '请帮我实现 React 组件' } });
    // 分类与复杂度标签应出现（在按钮中查找）
    const buttons = screen.getAllByText(/代码生成|翻译|解释|头脑风暴/);
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('点击路由按钮生成推荐', () => {
    render(<ModelRouterPanel isOpen={true} onClose={vi.fn()} />);
    const textarea = screen.getByTestId('model-router-prompt') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Implement a sorting algorithm' } });
    fireEvent.click(screen.getByTestId('model-router-route'));
    expect(screen.getByTestId('model-router-result')).toBeTruthy();
  });

  it('关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<ModelRouterPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('model-router-close'));
    expect(onClose).toHaveBeenCalled();
  });
});
