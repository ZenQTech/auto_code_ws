/**
 * Nested Sub-Agent Panel 组件测试 (v1.0.0 Cycle 27 G27-01)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { NestedSubAgentPanel } from './NestedSubAgentPanel';
import { resetDefaultNestedSubAgentEngine, getDefaultNestedSubAgentEngine } from '../utils/nestedSubAgentEngine';

describe('NestedSubAgentPanel', () => {
  beforeEach(() => {
    resetDefaultNestedSubAgentEngine();
  });

  afterEach(() => {
    cleanup();
  });

  it('关闭时不渲染', () => {
    const { container } = render(<NestedSubAgentPanel isOpen={false} onClose={() => {}} />);
    expect(container.querySelector('[data-testid="nested-sub-agent-panel"]')).toBeNull();
  });

  it('打开时渲染面板', () => {
    render(<NestedSubAgentPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('nested-sub-agent-panel')).toBeTruthy();
    expect(screen.getByText('嵌套子代理引擎')).toBeTruthy();
  });

  it('显示三个视图按钮', () => {
    render(<NestedSubAgentPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('view-tree-btn')).toBeTruthy();
    expect(screen.getByTestId('view-timeline-btn')).toBeTruthy();
    expect(screen.getByTestId('view-stats-btn')).toBeTruthy();
  });

  it('点击关闭按钮调用 onClose', () => {
    const onClose = vi.fn();
    render(<NestedSubAgentPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('close-btn'));
    expect(onClose).toHaveBeenCalled();
  });

  it('显示空状态', () => {
    render(<NestedSubAgentPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/暂无代理/)).toBeTruthy();
  });

  it('创建根代理对话框', () => {
    render(<NestedSubAgentPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('create-root-btn'));
    expect(screen.getByText('创建根代理')).toBeTruthy();
  });

  it('切换到时间线视图', () => {
    render(<NestedSubAgentPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('view-timeline-btn'));
    expect(screen.getByText(/暂无事件/)).toBeTruthy();
  });

  it('切换到统计视图', () => {
    render(<NestedSubAgentPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('view-stats-btn'));
    expect(screen.getByText('总代理数')).toBeTruthy();
    expect(screen.getByText('已完成')).toBeTruthy();
    expect(screen.getByText('按角色分布')).toBeTruthy();
    expect(screen.getByText('按状态分布')).toBeTruthy();
  });

  it('清空按钮触发确认', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<NestedSubAgentPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('clear-btn'));
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('创建根代理后显示在树中', async () => {
    const engine = getDefaultNestedSubAgentEngine();
    // 预先创建一个根代理
    const uuid = engine.createRootAgent({
      name: 'test-coordinator',
      role: 'coordinator',
      description: 'Test',
      model: 'sonnet',
      reasoningEffort: 'medium',
      systemPrompt: 'Test',
      tools: ['Read'],
      constraints: [],
      contextWindow: 8000,
      timeoutMs: 10000,
    });
    render(<NestedSubAgentPanel isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('/test-coordinator')).toBeTruthy();
    });
    expect(uuid).toBeTruthy();
  });

  it('点击树节点显示详情', async () => {
    const engine = getDefaultNestedSubAgentEngine();
    engine.createRootAgent({
      name: 'test-root',
      role: 'coordinator',
      description: 'Test description',
      model: 'sonnet',
      reasoningEffort: 'medium',
      systemPrompt: 'Test',
      tools: ['Read', 'Write'],
      constraints: [],
      contextWindow: 8000,
      timeoutMs: 10000,
    });
    render(<NestedSubAgentPanel isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('/test-root')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('/test-root'));
    await waitFor(() => {
      expect(screen.getByText('节点详情')).toBeTruthy();
      expect(screen.getByText('Test description')).toBeTruthy();
    });
  });

  it('详情面板显示工具列表', async () => {
    const engine = getDefaultNestedSubAgentEngine();
    engine.createRootAgent({
      name: 'test-root-2',
      role: 'analyzer',
      description: 'Test',
      model: 'haiku',
      reasoningEffort: 'low',
      systemPrompt: 'Test',
      tools: ['Read', 'Grep', 'Glob'],
      constraints: [],
      contextWindow: 4000,
      timeoutMs: 5000,
    });
    render(<NestedSubAgentPanel isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('/test-root-2')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('/test-root-2'));
    await waitFor(() => {
      expect(screen.getByText('工具')).toBeTruthy();
    });
  });
});
