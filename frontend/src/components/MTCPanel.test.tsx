/**
 * # ============================================================
 * # MTCPanel - 组件测试 (v1.0.0 Cycle 26 G26-03)
 * # ============================================================
 * # 核心作用：覆盖 MTCPanel 的核心交互、状态、事件订阅
 * # 测试维度：
 * #   1. 基础渲染：isOpen=false 不渲染 / isOpen=true 渲染
 * #   2. Tab 切换：files/tasks/history
 * #   3. 文件管理：加载示例/上传/删除/选择
 * #   4. 任务执行：选择任务类型/参数配置/执行
 * #   5. 历史记录：查看/重新加载
 * #   6. 结果展示与导出
 * #   7. 快捷键：Esc / Ctrl+N / Ctrl+R / Ctrl+E / Ctrl+1/2/3
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 26 G26-03 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MTCPanel } from './MTCPanel';
import { resetDefaultMtcAdapter } from '../utils/mtcAdapter';

describe('MTCPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultMtcAdapter();
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
    render(<MTCPanel isOpen={false} onClose={() => {}} />);
    expect(screen.queryByTestId('mtc-panel')).toBeNull();
  });

  it('显示面板与标题（isOpen=true）', () => {
    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('mtc-panel')).toBeTruthy();
    expect(screen.getByText('MTC 多模任务协作')).toBeTruthy();
  });

  it('关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<MTCPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('close-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击背景关闭面板', () => {
    const onClose = vi.fn();
    render(<MTCPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('mtc-panel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击面板内容不触发关闭', () => {
    const onClose = vi.fn();
    render(<MTCPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('MTC 多模任务协作'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('默认显示任务执行 Tab', () => {
    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('1️⃣ 选择任务类型')).toBeTruthy();
  });

  it('显示 7 种任务类型', () => {
    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('task-type-summarize')).toBeTruthy();
    expect(screen.getByTestId('task-type-translate')).toBeTruthy();
    expect(screen.getByTestId('task-type-rewrite')).toBeTruthy();
    expect(screen.getByTestId('task-type-analyze')).toBeTruthy();
    expect(screen.getByTestId('task-type-convert')).toBeTruthy();
    expect(screen.getByTestId('task-type-extract')).toBeTruthy();
    expect(screen.getByTestId('task-type-optimize')).toBeTruthy();
  });

  it('切换任务类型', () => {
    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('task-type-translate'));
    // 翻译参数面板应显示
    expect(screen.getByText('源语言')).toBeTruthy();
    expect(screen.getByText('目标语言')).toBeTruthy();
  });

  it('切换任务类型 - convert', () => {
    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('task-type-convert'));
    expect(screen.getByText('目标格式')).toBeTruthy();
  });

  it('切换任务类型 - extract', () => {
    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('task-type-extract'));
    expect(screen.getByTestId('extract-fields')).toBeTruthy();
  });

  it('切换到文件管理 Tab', () => {
    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('tab-files'));
    expect(screen.getByTestId('upload-file-btn')).toBeTruthy();
  });

  it('加载示例文件', () => {
    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('tab-files'));
    fireEvent.click(screen.getByTestId('load-samples-btn'));
    // 3 个示例文件
    const fileCards = screen.getAllByTestId('file-card');
    expect(fileCards.length).toBe(3);
  });

  it('删除文件', () => {
    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('tab-files'));
    fireEvent.click(screen.getByTestId('load-samples-btn'));
    const beforeCount = screen.getAllByTestId('file-card').length;
    const removeBtns = screen.getAllByTestId('file-remove');
    fireEvent.click(removeBtns[0]);
    const afterCount = screen.getAllByTestId('file-card').length;
    expect(afterCount).toBe(beforeCount - 1);
  });

  it('选择/取消选择文件', () => {
    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('tab-files'));
    fireEvent.click(screen.getByTestId('load-samples-btn'));
    const checkboxes = screen.getAllByTestId('file-checkbox') as HTMLInputElement[];
    expect(checkboxes[0].checked).toBe(false);
    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0].checked).toBe(true);
  });

  it('未选择文件时运行按钮被禁用', () => {
    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    const runBtn = screen.getByTestId('run-task-btn') as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
  });

  it('选择文件后运行按钮启用', () => {
    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('tab-files'));
    fireEvent.click(screen.getByTestId('load-samples-btn'));
    const checkboxes = screen.getAllByTestId('file-checkbox') as HTMLInputElement[];
    fireEvent.click(checkboxes[0]);
    // 切回任务 tab
    fireEvent.click(screen.getByTestId('tab-tasks'));
    const runBtn = screen.getByTestId('run-task-btn') as HTMLButtonElement;
    expect(runBtn.disabled).toBe(false);
  });

  it('执行任务显示结果', async () => {
    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    // 加载文件
    fireEvent.click(screen.getByTestId('tab-files'));
    fireEvent.click(screen.getByTestId('load-samples-btn'));
    const checkboxes = screen.getAllByTestId('file-checkbox') as HTMLInputElement[];
    fireEvent.click(checkboxes[0]);
    // 切回任务 tab
    fireEvent.click(screen.getByTestId('tab-tasks'));
    // 执行
    fireEvent.click(screen.getByTestId('run-task-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('result-content')).toBeTruthy();
    });
  });

  it('显示历史任务', async () => {
    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    // 加载文件
    fireEvent.click(screen.getByTestId('tab-files'));
    fireEvent.click(screen.getByTestId('load-samples-btn'));
    const checkboxes = screen.getAllByTestId('file-checkbox') as HTMLInputElement[];
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByTestId('tab-tasks'));
    fireEvent.click(screen.getByTestId('run-task-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('result-content')).toBeTruthy();
    });
    // 查看历史
    fireEvent.click(screen.getByTestId('tab-history'));
    expect(screen.getAllByTestId('history-task').length).toBeGreaterThan(0);
  });

  it('切换到历史 Tab', () => {
    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('tab-history'));
    expect(screen.getByText('暂无历史任务')).toBeTruthy();
  });

  it('Esc 关闭面板', () => {
    const onClose = vi.fn();
    render(<MTCPanel isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+N 加载示例文件', () => {
    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true });
    // 切到文件 tab 验证
    fireEvent.click(screen.getByTestId('tab-files'));
    expect(screen.getAllByTestId('file-card').length).toBeGreaterThan(0);
  });

  it('Ctrl+1/2/3 切换 Tab', async () => {
    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    // 默认 tab=tasks，先切到 files
    fireEvent.keyDown(document.body, { key: '1', ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByTestId('upload-file-btn')).toBeTruthy();
    });
    // 切到 tasks
    fireEvent.keyDown(document.body, { key: '2', ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText(/选择任务类型/)).toBeTruthy();
    });
    // 切到 history
    fireEvent.keyDown(document.body, { key: '3', ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText(/暂无历史任务/)).toBeTruthy();
    });
  });

  it('? 显示帮助', () => {
    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    fireEvent.keyDown(document.body, { key: '?' });
    expect(screen.getByText('⌨️ 快捷键')).toBeTruthy();
  });

  it('执行 summarize 任务', async () => {
    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('tab-files'));
    fireEvent.click(screen.getByTestId('load-samples-btn'));
    const checkboxes = screen.getAllByTestId('file-checkbox') as HTMLInputElement[];
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByTestId('tab-tasks'));
    // 默认是 summarize
    fireEvent.click(screen.getByTestId('run-task-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('result-content')).toBeTruthy();
    });
    expect(screen.getByTestId('result-content')?.textContent).toContain('MOCK');
  });

  it('导出结果', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:test');
    const revokeObjectURL = vi.fn();
    (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: typeof revokeObjectURL }).revokeObjectURL = revokeObjectURL;

    render(<MTCPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('tab-files'));
    fireEvent.click(screen.getByTestId('load-samples-btn'));
    const checkboxes = screen.getAllByTestId('file-checkbox') as HTMLInputElement[];
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByTestId('tab-tasks'));
    fireEvent.click(screen.getByTestId('run-task-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('result-content')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('export-result-btn'));
    expect(createObjectURL).toHaveBeenCalled();
  });
});
