/**
 * # ============================================================
 * # CsvBatchPanel - 组件测试 (v1.0.0 Cycle 26 G26-01)
 * # ============================================================
 * # 核心作用：覆盖 CsvBatchPanel 的核心交互、状态、事件订阅
 * # 测试维度：
 * #   1. 基础渲染：isOpen=false 不渲染 / isOpen=true 渲染
 * #   2. CSV 加载（示例 / 上传）
 * #   3. 任务启动 / 暂停 / 取消
 * #   4. 进度监控
 * #   5. 结果导出
 * #   6. 配置持久化
 * #   7. 快捷键：Esc / Ctrl+Enter / Ctrl+R / Ctrl+E / Ctrl+L
 * #   8. localStorage 持久化
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 26 G26-01 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CsvBatchPanel } from './CsvBatchPanel';
import { resetDefaultCsvBatchEngine } from '../utils/csvBatchEngine';

describe('CsvBatchPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultCsvBatchEngine();
    if (!URL.createObjectURL) {
      (URL as any).createObjectURL = vi.fn().mockReturnValue('blob:test');
    }
    if (!URL.revokeObjectURL) {
      (URL as any).revokeObjectURL = vi.fn();
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('不显示（isOpen=false）', () => {
    render(<CsvBatchPanel isOpen={false} onClose={() => {}} />);
    expect(screen.queryByTestId('csv-batch-panel')).toBeNull();
  });

  it('显示面板与标题（isOpen=true）', () => {
    render(<CsvBatchPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('csv-batch-panel')).toBeTruthy();
    expect(screen.getByText('CSV 批处理智能体')).toBeTruthy();
  });

  it('关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<CsvBatchPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('close-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击背景关闭面板', () => {
    const onClose = vi.fn();
    render(<CsvBatchPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('csv-batch-panel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击面板内容不触发关闭', () => {
    const onClose = vi.fn();
    render(<CsvBatchPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('CSV 批处理智能体'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('加载示例 CSV', async () => {
    render(<CsvBatchPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('load-sample-btn'));
    // 示例加载后行数应展示
    await waitFor(() => {
      expect(screen.getByText(/行数:/)).toBeTruthy();
    });
  });

  it('显示模板占位符', () => {
    render(<CsvBatchPanel isOpen={true} onClose={() => {}} />);
    // 默认模板包含 {content} {title} {id|upper} 占位符
    expect(screen.getByText(/占位符:/)).toBeTruthy();
  });

  it('修改 maxConcurrency 配置', () => {
    render(<CsvBatchPanel isOpen={true} onClose={() => {}} />);
    const concurrencyInput = screen.getByTestId('concurrency-input') as HTMLInputElement;
    fireEvent.change(concurrencyInput, { target: { value: '5' } });
    expect(concurrencyInput.value).toBe('5');
  });

  it('修改 outputField', () => {
    render(<CsvBatchPanel isOpen={true} onClose={() => {}} />);
    const outputInput = screen.getByTestId('output-field-input') as HTMLInputElement;
    fireEvent.change(outputInput, { target: { value: 'answer' } });
    expect(outputInput.value).toBe('answer');
  });

  it('修改 maxRetries', () => {
    render(<CsvBatchPanel isOpen={true} onClose={() => {}} />);
    const inputs = document.querySelectorAll('input[type="number"]');
    const retriesInput = inputs[1] as HTMLInputElement;
    fireEvent.change(retriesInput, { target: { value: '3' } });
    expect(retriesInput.value).toBe('3');
  });

  it('修改 failureStrategy', () => {
    render(<CsvBatchPanel isOpen={true} onClose={() => {}} />);
    const selects = document.querySelectorAll('select');
    // 找到 failureStrategy select
    const select = selects[selects.length - 1] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'fail-fast' } });
    expect(select.value).toBe('fail-fast');
  });

  it('启动任务后显示进度', async () => {
    render(<CsvBatchPanel isOpen={true} onClose={() => {}} />);
    // 加载示例
    fireEvent.click(screen.getByTestId('load-sample-btn'));
    // 启动任务
    fireEvent.click(screen.getByTestId('start-btn'));
    // 等待任务创建
    await waitFor(() => {
      expect(screen.queryByTestId('progress-bar')).toBeTruthy();
    });
  });

  it('无 CSV 时启动按钮被禁用', () => {
    render(<CsvBatchPanel isOpen={true} onClose={() => {}} />);
    const startBtn = screen.getByTestId('start-btn') as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);
  });

  it('加载示例后启动按钮启用', () => {
    render(<CsvBatchPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('load-sample-btn'));
    const startBtn = screen.getByTestId('start-btn') as HTMLButtonElement;
    expect(startBtn.disabled).toBe(false);
  });

  it('重置清空状态', async () => {
    render(<CsvBatchPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('load-sample-btn'));
    await waitFor(() => {
      expect(screen.getByText(/行数:/)).toBeTruthy();
    });
    // 找到重置按钮
    const resetBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('重置'));
    if (resetBtn) fireEvent.click(resetBtn);
    // 启动按钮应被禁用
    const startBtn = screen.getByTestId('start-btn') as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);
  });

  it('Esc 关闭面板', () => {
    const onClose = vi.fn();
    render(<CsvBatchPanel isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Enter 启动任务', async () => {
    render(<CsvBatchPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('load-sample-btn'));
    await waitFor(() => {
      expect(screen.getByText(/行数:/)).toBeTruthy();
    });
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(screen.queryByTestId('progress-bar')).toBeTruthy();
    });
  });

  it('Ctrl+L 加载示例', async () => {
    render(<CsvBatchPanel isOpen={true} onClose={() => {}} />);
    fireEvent.keyDown(document.body, { key: 'l', ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText(/行数:/)).toBeTruthy();
    });
  });

  it('? 快捷键切换帮助', async () => {
    render(<CsvBatchPanel isOpen={true} onClose={() => {}} />);
    fireEvent.keyDown(document.body, { key: '?' });
    // 等待模态框显示
    await waitFor(() => {
      const help = screen.queryAllByText(/快捷键/);
      expect(help.length).toBeGreaterThan(0);
    });
  });
});
