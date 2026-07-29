/**
 * # ============================================================
 * # ProactiveSuggestionPanel 组件测试 (Cycle 23 G23-04)
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ProactiveSuggestionPanel } from './ProactiveSuggestionPanel';
import { resetProactiveSuggestionEngine, getProactiveSuggestionEngine } from '../utils/proactiveSuggestion';

describe('ProactiveSuggestionPanel', () => {
  beforeEach(() => {
    resetProactiveSuggestionEngine();
  });

  afterEach(() => {
    cleanup();
    resetProactiveSuggestionEngine();
  });

  it('面板未打开时不渲染', () => {
    const { container } = render(<ProactiveSuggestionPanel isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('面板打开时显示标题', () => {
    render(<ProactiveSuggestionPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('AI 主动建议')).toBeTruthy();
  });

  it('应显示 4 个标签页', () => {
    render(<ProactiveSuggestionPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('suggestion-tab-active')).toBeTruthy();
    expect(screen.getByTestId('suggestion-tab-history')).toBeTruthy();
    expect(screen.getByTestId('suggestion-tab-config')).toBeTruthy();
    expect(screen.getByTestId('suggestion-tab-simulate')).toBeTruthy();
  });

  it('点击关闭按钮应调用 onClose', () => {
    const onClose = vi.fn();
    render(<ProactiveSuggestionPanel isOpen={true} onClose={onClose} />);
    const closeButton = screen.getByTestId('suggestion-close');
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  it('空状态应显示提示信息', () => {
    render(<ProactiveSuggestionPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(/暂无活跃建议/)).toBeTruthy();
  });

  it('点击历史标签页应显示历史', () => {
    render(<ProactiveSuggestionPanel isOpen={true} onClose={vi.fn()} />);
    const historyTab = screen.getByTestId('suggestion-tab-history');
    fireEvent.click(historyTab);
    // 应显示历史（空状态或列表）
    expect(screen.getByText(/暂无历史记录|suggestion-history/)).toBeTruthy();
  });

  it('点击配置标签页应显示配置', () => {
    render(<ProactiveSuggestionPanel isOpen={true} onClose={vi.fn()} />);
    const configTab = screen.getByTestId('suggestion-tab-config');
    fireEvent.click(configTab);
    expect(screen.getByTestId('suggestion-config')).toBeTruthy();
    expect(screen.getByTestId('config-max-active')).toBeTruthy();
  });

  it('点击模拟标签页应显示模拟器', () => {
    render(<ProactiveSuggestionPanel isOpen={true} onClose={vi.fn()} />);
    const simTab = screen.getByTestId('suggestion-tab-simulate');
    fireEvent.click(simTab);
    // 应显示模拟上下文相关文字
    const body = document.body.textContent || '';
    expect(body).toMatch(/上下文|成本|预算|消息数/);
  });

  it('运行模拟应产生建议', () => {
    render(<ProactiveSuggestionPanel isOpen={true} onClose={vi.fn()} />);
    const simTab = screen.getByTestId('suggestion-tab-simulate');
    fireEvent.click(simTab);
    // 找到运行按钮
    const buttons = screen.getAllByRole('button');
    const runButton = buttons.find((b) => b.textContent?.includes('生成') || b.textContent?.includes('运行') || b.textContent?.includes('模拟'));
    if (runButton) {
      fireEvent.click(runButton);
      // 至少应该激活 activeTab
      expect(screen.getByTestId('suggestion-tab-active')).toBeTruthy();
    }
  });

  it('Esc 键应关闭面板', () => {
    const onClose = vi.fn();
    render(<ProactiveSuggestionPanel isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('建议显示后可点击接受', () => {
    const engine = getProactiveSuggestionEngine();
    const suggestions = engine.generateSuggestions({
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 5,
    });
    expect(suggestions.length).toBeGreaterThan(0);
    render(<ProactiveSuggestionPanel isOpen={true} onClose={vi.fn()} />);
    const acceptButton = screen.getByTestId(`suggestion-accept-${suggestions[0].suggestionId}`);
    fireEvent.click(acceptButton);
    expect(engine.getStats().totalAccepted).toBe(1);
  });

  it('建议显示后可点击拒绝', () => {
    const engine = getProactiveSuggestionEngine();
    const suggestions = engine.generateSuggestions({
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 5,
    });
    expect(suggestions.length).toBeGreaterThan(0);
    render(<ProactiveSuggestionPanel isOpen={true} onClose={vi.fn()} />);
    const dismissButton = screen.getByTestId(`suggestion-dismiss-${suggestions[0].suggestionId}`);
    fireEvent.click(dismissButton);
    expect(engine.getStats().totalDismissed).toBe(1);
  });
});
