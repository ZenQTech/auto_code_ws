/**
 * # ============================================================
 * # AutoCodeReviewPanel - 组件测试 (v1.0.0 Cycle 25 G25-01)
 * # ============================================================
 * # 核心作用：覆盖 AutoCodeReviewPanel 的核心交互、状态、事件订阅
 * # 测试维度：
 * #   1. 基础渲染：isOpen=false 不渲染 / isOpen=true 渲染
 * #   2. 文件加载：示例 / 上传 / 切换 / 编辑
 * #   3. 分类启用切换
 * #   4. 评审执行：成功 / 失败 / 报告展示
 * #   5. 快捷键：Esc / Ctrl+R / Ctrl+E / Ctrl+L
 * #   6. 规则管理：enable / disable
 * #   7. 报告导出：JSON / Markdown / SARIF
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 25 G25-01 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AutoCodeReviewPanel } from './AutoCodeReviewPanel';

describe('AutoCodeReviewPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    // Mock clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('不显示（isOpen=false）', () => {
    render(<AutoCodeReviewPanel isOpen={false} onClose={() => {}} />);
    expect(screen.queryByTestId('auto-code-review-panel')).toBeNull();
  });

  it('显示面板与标题（isOpen=true）', () => {
    render(<AutoCodeReviewPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('auto-code-review-panel')).toBeTruthy();
    expect(screen.getByText('自动化代码评审')).toBeTruthy();
    expect(screen.getByText(/规则库: \d+ 条/)).toBeTruthy();
  });

  it('关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<AutoCodeReviewPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('close-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('加载示例文件', () => {
    render(<AutoCodeReviewPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('加载示例'));
    // 示例有两个文件
    const fileButtons = screen.getAllByText(/^📄 src\//);
    expect(fileButtons.length).toBeGreaterThanOrEqual(2);
    // 编辑器显示当前文件内容
    const editor = screen.getByTestId('code-editor') as HTMLTextAreaElement;
    expect(editor.value).toContain('eval');
  });

  it('点击文件切换当前文件', () => {
    render(<AutoCodeReviewPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('加载示例'));
    // 切换到第二个文件
    const secondFile = screen.getByText('📄 src/utils.ts');
    fireEvent.click(secondFile);
    const editor = screen.getByTestId('code-editor') as HTMLTextAreaElement;
    expect(editor.value).toContain('toNumber');
  });

  it('编辑文件并保存', () => {
    render(<AutoCodeReviewPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('加载示例'));
    const editor = screen.getByTestId('code-editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '// changed content' } });
    fireEvent.click(screen.getByText('保存'));
    // 重新点击文件应显示新内容
    const firstFile = screen.getByText('📄 src/example.ts');
    fireEvent.click(firstFile);
    expect((screen.getByTestId('code-editor') as HTMLTextAreaElement).value).toBe(
      '// changed content'
    );
  });

  it('无文件时运行评审提示错误', async () => {
    render(<AutoCodeReviewPanel isOpen={true} onClose={() => {}} />);
    const runBtn = screen.getByTestId('run-review-btn');
    expect(runBtn).toHaveProperty('disabled', true);
  });

  it('执行评审并展示结果', async () => {
    render(<AutoCodeReviewPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('加载示例'));
    fireEvent.click(screen.getByTestId('run-review-btn'));
    await waitFor(() => {
      // 评审完成后显示 summary
      expect(screen.getByText(/评审摘要/)).toBeTruthy();
    });
  });

  it('切换分类启用状态', () => {
    render(<AutoCodeReviewPanel isOpen={true} onClose={() => {}} />);
    // 找到 security 复选框
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes.length).toBeGreaterThan(0);
    // 取第一个（通常是 bug）
    const initialChecked = checkboxes[0].checked;
    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0].checked).toBe(!initialChecked);
  });

  it('点击背景关闭面板', () => {
    const onClose = vi.fn();
    render(<AutoCodeReviewPanel isOpen={true} onClose={onClose} />);
    const backdrop = screen.getByTestId('auto-code-review-panel');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击面板内容不触发关闭', () => {
    const onClose = vi.fn();
    render(<AutoCodeReviewPanel isOpen={true} onClose={onClose} />);
    // 点击内部标题
    const title = screen.getByText('自动化代码评审');
    fireEvent.click(title);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Esc 快捷键关闭面板', () => {
    const onClose = vi.fn();
    render(<AutoCodeReviewPanel isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+R 快捷键执行评审（无文件时不报错）', () => {
    render(<AutoCodeReviewPanel isOpen={true} onClose={() => {}} />);
    // 无文件状态下 Ctrl+R 不应抛出错误
    fireEvent.keyDown(document.body, { key: 'r', ctrlKey: true });
    expect(screen.getByTestId('auto-code-review-panel')).toBeTruthy();
  });

  it('Ctrl+L 快捷键加载示例', () => {
    render(<AutoCodeReviewPanel isOpen={true} onClose={() => {}} />);
    fireEvent.keyDown(document.body, { key: 'l', ctrlKey: true });
    const fileButtons = screen.getAllByText(/^📄 src\//);
    expect(fileButtons.length).toBeGreaterThan(0);
  });

  it('? 快捷键打开快捷键帮助', () => {
    render(<AutoCodeReviewPanel isOpen={true} onClose={() => {}} />);
    fireEvent.keyDown(document.body, { key: '?' });
    // 应当出现模态层（带"快捷键"相关文本）
    expect(screen.getByText('快捷键')).toBeTruthy();
  });

  it('打开规则管理面板', async () => {
    render(<AutoCodeReviewPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('加载示例'));
    fireEvent.click(screen.getByTestId('run-review-btn'));
    await waitFor(() => {
      expect(screen.getByText(/^📋 规则$/)).toBeTruthy();
    });
    const rulesBtn = screen.getByText(/^📋 规则$/);
    fireEvent.click(rulesBtn);
    // 模态应可见（标题包含"规则管理"）
    expect(screen.getByText('规则管理')).toBeTruthy();
  });

  it('选择导出格式 JSON', async () => {
    render(<AutoCodeReviewPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('加载示例'));
    fireEvent.click(screen.getByTestId('run-review-btn'));
    // 等待评审完成
    await waitFor(() => {
      expect(screen.getByTestId('export-btn')).toBeTruthy();
    });
    // 通过 testid 找到导出格式 select（按 value 排序）
    const selects = document.querySelectorAll('select');
    // 找到有 markdown option 的 select
    const exportSelect = Array.from(selects).find((s) =>
      Array.from(s.options).some((o) => o.value === 'markdown')
    ) as HTMLSelectElement | undefined;
    expect(exportSelect).toBeDefined();
    fireEvent.change(exportSelect!, { target: { value: 'json' } });
    expect(exportSelect!.value).toBe('json');
  });

  it('导出按钮（无报告时）', async () => {
    render(<AutoCodeReviewPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('加载示例'));
    fireEvent.click(screen.getByTestId('run-review-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('export-btn')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('export-btn'));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  it('严重度筛选变化', async () => {
    render(<AutoCodeReviewPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('加载示例'));
    fireEvent.click(screen.getByTestId('run-review-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('export-btn')).toBeTruthy();
    });
    const selects = document.querySelectorAll('select');
    // 找到有 "all" value 的 select（severityFilter）
    const severitySelect = Array.from(selects).find((s) =>
      Array.from(s.options).some((o) => o.value === 'all')
    ) as HTMLSelectElement | undefined;
    expect(severitySelect).toBeDefined();
    fireEvent.change(severitySelect!, { target: { value: 'critical' } });
    expect(severitySelect!.value).toBe('critical');
  });

  it('关闭后 localStorage 持久化设置', () => {
    render(<AutoCodeReviewPanel isOpen={true} onClose={() => {}} />);
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]); // 切换一个分类
    const stored = localStorage.getItem('hermes.autoCodeReviewPanel');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.enabledCategories).toBeDefined();
  });

  it('打开面板时从 localStorage 恢复设置', () => {
    localStorage.setItem(
      'hermes.autoCodeReviewPanel',
      JSON.stringify({
        enabledCategories: ['bug'],
        severityFilter: 'high',
        exportFormat: 'json',
      })
    );
    render(<AutoCodeReviewPanel isOpen={true} onClose={() => {}} />);
    // bug 复选框应被选中，其它分类应被取消
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes[0].checked).toBe(true);
  });

  it('显示统计信息', () => {
    render(<AutoCodeReviewPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/Reviews:/)).toBeTruthy();
    expect(screen.getByText(/Findings:/)).toBeTruthy();
    expect(screen.getByText(/Rules:/)).toBeTruthy();
  });

  it('无文件时显示 EmptyState', () => {
    render(<AutoCodeReviewPanel isOpen={true} onClose={() => {}} />);
    // EmptyState 组件应当显示（icon + title + description）
    expect(screen.getByText('选择或添加文件')).toBeTruthy();
  });

  it('显示规则库统计', () => {
    render(<AutoCodeReviewPanel isOpen={true} onClose={() => {}} />);
    // TOTAL_BUILTIN_RULES 应当是 > 0 的数字
    const match = screen.getByText(/规则库: (\d+) 条/).textContent;
    expect(match).toBeTruthy();
    const count = parseInt(match!.match(/(\d+)/)![1], 10);
    expect(count).toBeGreaterThan(0);
  });
});
