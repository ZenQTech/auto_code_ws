/**
 * ContextWindowMeter 组件测试 (v6.40.0 Cycle 18 G18-03)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ContextWindowMeter, SummarizationHistory } from './ContextWindowMeter';
import type { ConversationItem, Summary } from '../utils/composerEngine.summary';

describe('ContextWindowMeter 组件 (Cycle 18 G18-03)', () => {
  const mockItems: ConversationItem[] = [
    { id: '1', role: 'user', content: '你好世界', timestamp: 1 },
    { id: '2', role: 'assistant', content: 'Hello', timestamp: 2 },
  ];

  it('应该正确渲染', () => {
    render(<ContextWindowMeter items={mockItems} />);
    expect(screen.getByTestId('context-window-meter')).toBeInTheDocument();
  });

  it('应该显示 token 数', () => {
    render(<ContextWindowMeter items={mockItems} />);
    const meter = screen.getByTestId('context-window-meter');
    expect(meter.getAttribute('data-tokens')).toBeTruthy();
    expect(meter.getAttribute('data-threshold')).toBeTruthy();
  });

  it('在低 token 时不应该显示摘要按钮', () => {
    render(<ContextWindowMeter items={mockItems} />);
    expect(screen.queryByTestId('context-meter-summarize')).not.toBeInTheDocument();
  });

  it('在高 token 时应该显示摘要按钮', () => {
    const largeItems: ConversationItem[] = [];
    // 使用更长的内容以达到 token 阈值
    for (let i = 0; i < 50; i++) {
      largeItems.push({
        id: `${i}`,
        role: 'user',
        content: '实现复杂功能 ' + '详细'.repeat(200),
        timestamp: i,
      });
    }
    render(<ContextWindowMeter items={largeItems} config={{ triggerThreshold: 100 }} />);
    expect(screen.getByTestId('context-meter-summarize')).toBeInTheDocument();
  });

  it('点击摘要按钮应该触发回调', async () => {
    const onSummarize = vi.fn();
    const largeItems: ConversationItem[] = [];
    for (let i = 0; i < 50; i++) {
      largeItems.push({
        id: `${i}`,
        role: 'user',
        content: '实现复杂功能 ' + '详细'.repeat(200),
        timestamp: i,
        acceptedEdits: 1,
      });
    }
    render(
      <ContextWindowMeter
        items={largeItems}
        onSummarize={onSummarize}
        config={{ triggerThreshold: 100 }}
      />
    );
    fireEvent.click(screen.getByTestId('context-meter-summarize'));
    await waitFor(() => {
      expect(onSummarize).toHaveBeenCalled();
    });
  });

  it('应该显示摘要历史数量', () => {
    const history: Summary[] = [
      {
        id: 'sum_1',
        createdAt: Date.now(),
        strategy: 'balanced',
        stats: { originalTokens: 100, summaryTokens: 50, reductionRatio: 0.5 },
        recentCount: 0,
        olderCount: 0,
        decisions: [],
        keypoints: [],
        editsSummary: [],
        contextSummary: [],
        text: 'test',
      },
    ];
    render(<ContextWindowMeter items={mockItems} history={history} />);
    expect(screen.getByTestId('context-meter-history-info')).toHaveTextContent('1');
  });
});

describe('SummarizationHistory 组件 (Cycle 18 G18-03)', () => {
  const mockSummary: Summary = {
    id: 'sum_test_1',
    createdAt: Date.now(),
    strategy: 'balanced',
    stats: { originalTokens: 100, summaryTokens: 50, reductionRatio: 0.5 },
    recentCount: 0,
    olderCount: 0,
    decisions: [],
    keypoints: [],
    editsSummary: [],
    contextSummary: [],
    text: '# Test Summary\nThis is a test',
  };

  it('空历史应该显示提示', () => {
    render(<SummarizationHistory summaries={[]} />);
    expect(screen.getByTestId('summarization-history-empty')).toBeInTheDocument();
  });

  it('应该显示摘要卡片', () => {
    render(<SummarizationHistory summaries={[mockSummary]} />);
    expect(screen.getByTestId(`summary-card-${mockSummary.id}`)).toBeInTheDocument();
  });

  it('点击展开应该显示内容', async () => {
    render(<SummarizationHistory summaries={[mockSummary]} />);
    fireEvent.click(screen.getByTestId(`summary-toggle-${mockSummary.id}`));
    await waitFor(() => {
      expect(screen.getByTestId(`summary-text-${mockSummary.id}`)).toBeInTheDocument();
    });
  });

  it('应该支持应用回调', () => {
    const onApply = vi.fn();
    render(<SummarizationHistory summaries={[mockSummary]} onApply={onApply} />);
    fireEvent.click(screen.getByTestId(`summary-apply-${mockSummary.id}`));
    expect(onApply).toHaveBeenCalledWith(mockSummary);
  });

  it('应该支持删除回调', () => {
    const onDelete = vi.fn();
    render(<SummarizationHistory summaries={[mockSummary]} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId(`summary-delete-${mockSummary.id}`));
    expect(onDelete).toHaveBeenCalledWith(mockSummary.id);
  });
});
