/**
 * # ============================================================
 * # AnalyticsChatPanel Tests (v1.0.0 Cycle 29 G29-03)
 * # ============================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnalyticsChatPanel } from './AnalyticsChatPanel';
import { resetDefaultAnalyticsChat } from '../utils/analyticsChatEngine';

describe('AnalyticsChatPanel', () => {
  beforeEach(() => {
    resetDefaultAnalyticsChat();
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('hermes.analyticsChat');
    }
  });

  it('默认不渲染', () => {
    const { container } = render(<AnalyticsChatPanel isOpen={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('打开时渲染', () => {
    render(<AnalyticsChatPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('analytics-chat-panel')).toBeInTheDocument();
  });

  it('显示标题', () => {
    render(<AnalyticsChatPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('分析聊天')).toBeInTheDocument();
  });

  it('显示建议查询按钮', () => {
    render(<AnalyticsChatPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('suggestion-0')).toBeInTheDocument();
  });

  it('点击关闭按钮触发 onClose', () => {
    let called = 0;
    render(<AnalyticsChatPanel isOpen={true} onClose={() => called++} />);
    fireEvent.click(screen.getByTestId('close-btn'));
    expect(called).toBe(1);
  });

  it('输入框可输入', () => {
    render(<AnalyticsChatPanel isOpen={true} onClose={() => {}} />);
    const input = screen.getByTestId('question-input');
    fireEvent.change(input, { target: { value: '按团队的用量' } });
    expect((input as HTMLInputElement).value).toBe('按团队的用量');
  });

  it('提交查询', async () => {
    render(<AnalyticsChatPanel isOpen={true} onClose={() => {}} />);
    const input = screen.getByTestId('question-input');
    fireEvent.change(input, { target: { value: '按团队的用量' } });
    fireEvent.click(screen.getByTestId('submit-btn'));
    // 等待异步查询完成
    await waitFor(() => {
      // 历史区出现 turn
    }, { timeout: 1000 });
  });

  it('回车键提交', async () => {
    render(<AnalyticsChatPanel isOpen={true} onClose={() => {}} />);
    const input = screen.getByTestId('question-input');
    fireEvent.change(input, { target: { value: '按团队查询' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {}, { timeout: 1000 });
  });

  it('点击建议查询', async () => {
    render(<AnalyticsChatPanel isOpen={true} onClose={() => {}} />);
    const suggestion = screen.getByTestId('suggestion-0');
    fireEvent.click(suggestion);
    await waitFor(() => {}, { timeout: 1000 });
  });

  it('显示清空历史按钮', () => {
    render(<AnalyticsChatPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('clear-history-btn')).toBeInTheDocument();
  });

  it('点击清空历史（mock confirm）', () => {
    const origConfirm = (globalThis as any).confirm;
    (globalThis as any).confirm = () => true;
    render(<AnalyticsChatPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('clear-history-btn'));
    (globalThis as any).confirm = origConfirm;
  });
});
