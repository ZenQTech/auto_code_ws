/**
 * BestOfNPanel 集成测试 (v1.0.0 Cycle 19 G19-02)
 */

// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BestOfNPanel } from './BestOfNPanel';
import { resetMultiModelExecutor } from '../utils/multiModelExecutor';

describe('BestOfNPanel', () => {
  beforeEach(() => {
    resetMultiModelExecutor();
  });

  it('isOpen=false 不渲染', () => {
    const { container } = render(<BestOfNPanel isOpen={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('打开时显示面板', () => {
    render(<BestOfNPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('best-of-n-panel')).toBeInTheDocument();
  });

  it('显示初始 prompt', () => {
    render(<BestOfNPanel isOpen={true} onClose={() => {}} initialPrompt="测试 prompt" />);
    const textarea = screen.getByTestId('best-of-n-prompt') as HTMLTextAreaElement;
    expect(textarea.value).toBe('测试 prompt');
  });

  it('显示空状态当无候选时', () => {
    render(<BestOfNPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/选择至少 2 个模型/)).toBeInTheDocument();
  });

  it('显示模型选择按钮', () => {
    render(<BestOfNPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('model-toggle-claude-sonnet-4.5')).toBeInTheDocument();
    expect(screen.getByTestId('model-toggle-gpt-5')).toBeInTheDocument();
  });

  it('默认选中 3 个模型', () => {
    render(<BestOfNPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('model-toggle-claude-sonnet-4.5').className).toContain('hermes');
    expect(screen.getByTestId('model-toggle-gpt-5').className).toContain('hermes');
    expect(screen.getByTestId('model-toggle-deepseek-v3.2').className).toContain('hermes');
  });

  it('至少 2 个模型不能取消最后一个', () => {
    render(<BestOfNPanel isOpen={true} onClose={() => {}} />);
    // 取消 1 个
    fireEvent.click(screen.getByTestId('model-toggle-deepseek-v3.2'));
    // 再取消 1 个
    fireEvent.click(screen.getByTestId('model-toggle-gpt-5'));
    // 尝试取消最后一个 - 应该无效
    const lastBtn = screen.getByTestId('model-toggle-claude-sonnet-4.5');
    fireEvent.click(lastBtn);
    // claude-sonnet-4.5 应该仍然选中
    expect(lastBtn.className).toContain('hermes');
  });

  it('运行按钮初始禁用（无 prompt）', () => {
    render(<BestOfNPanel isOpen={true} onClose={() => {}} />);
    const runBtn = screen.getByTestId('best-of-n-run');
    expect(runBtn).toBeDisabled();
  });

  it('输入 prompt 后启用运行按钮', () => {
    render(<BestOfNPanel isOpen={true} onClose={() => {}} />);
    const textarea = screen.getByTestId('best-of-n-prompt');
    fireEvent.change(textarea, { target: { value: 'hello' } });
    const runBtn = screen.getByTestId('best-of-n-run');
    expect(runBtn).not.toBeDisabled();
  });

  it('运行后显示候选卡片', async () => {
    render(<BestOfNPanel isOpen={true} onClose={() => {}} initialPrompt="test" />);
    fireEvent.click(screen.getByTestId('best-of-n-run'));
    await waitFor(() => {
      expect(screen.getByTestId('candidate-card-claude-sonnet-4.5')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('点击关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<BestOfNPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('best-of-n-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('切换列数', () => {
    render(<BestOfNPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('best-of-n-columns-toggle'));
    // 验证列数切换按钮
  });
});
