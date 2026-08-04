/**
 * TaskTabs 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TaskTabs, { type TaskTab } from '../components/TaskTabs';

const sampleTabs: TaskTab[] = [
  { id: 't1', title: '任务 1', status: 'running', progress: 30 },
  { id: 't2', title: '任务 2', status: 'paused' },
  { id: 't3', title: '任务 3', status: 'error' },
  { id: 't4', title: '任务 4', status: 'done' },
  { id: 't5', title: '任务 5', status: 'idle' },
];

describe('TaskTabs', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('空 tab 列表显示提示', () => {
    render(<TaskTabs tabs={[]} activeId={null} onSelect={vi.fn()} onClose={vi.fn()} onNew={vi.fn()} />);
    expect(screen.getByText('暂无任务，点击 + 创建')).toBeInTheDocument();
  });

  it('渲染所有 tabs', () => {
    render(<TaskTabs tabs={sampleTabs} activeId="t1" onSelect={vi.fn()} onClose={vi.fn()} onNew={vi.fn()} />);
    expect(screen.getByText('任务 1')).toBeInTheDocument();
    expect(screen.getByText('任务 2')).toBeInTheDocument();
    expect(screen.getByText('任务 3')).toBeInTheDocument();
    expect(screen.getByText('任务 4')).toBeInTheDocument();
    expect(screen.getByText('任务 5')).toBeInTheDocument();
  });

  it('点击 tab 触发 onSelect', () => {
    const onSelect = vi.fn();
    render(<TaskTabs tabs={sampleTabs} activeId="t1" onSelect={onSelect} onClose={vi.fn()} onNew={vi.fn()} />);
    fireEvent.click(screen.getByTestId('task-tabs-tab-t2'));
    expect(onSelect).toHaveBeenCalledWith('t2');
  });

  it('点击关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<TaskTabs tabs={sampleTabs} activeId="t1" onSelect={vi.fn()} onClose={onClose} onNew={vi.fn()} />);
    fireEvent.click(screen.getByTestId('task-tabs-close-t2'));
    expect(onClose).toHaveBeenCalledWith('t2');
  });

  it('点击 + 触发 onNew', () => {
    const onNew = vi.fn();
    render(<TaskTabs tabs={sampleTabs} activeId="t1" onSelect={vi.fn()} onClose={vi.fn()} onNew={onNew} />);
    fireEvent.click(screen.getByTestId('task-tabs-new'));
    expect(onNew).toHaveBeenCalled();
  });

  it('active tab 样式区分', () => {
    render(<TaskTabs tabs={sampleTabs} activeId="t1" onSelect={vi.fn()} onClose={vi.fn()} onNew={vi.fn()} />);
    const activeTab = screen.getByTestId('task-tabs-tab-t1');
    expect(activeTab).toHaveAttribute('aria-selected', 'true');
    const otherTab = screen.getByTestId('task-tabs-tab-t2');
    expect(otherTab).toHaveAttribute('aria-selected', 'false');
  });

  it('中键点击关闭 tab', () => {
    const onClose = vi.fn();
    render(<TaskTabs tabs={sampleTabs} activeId="t1" onSelect={vi.fn()} onClose={onClose} onNew={vi.fn()} />);
    const tab = screen.getByTestId('task-tabs-tab-t2');
    fireEvent.mouseDown(tab, { button: 1 });
    expect(onClose).toHaveBeenCalledWith('t2');
  });

  it('closable=false 隐藏关闭按钮', () => {
    const tabs: TaskTab[] = [
      { id: 'fixed', title: '固定 Tab', status: 'running', closable: false },
    ];
    render(<TaskTabs tabs={tabs} activeId="fixed" onSelect={vi.fn()} onClose={vi.fn()} onNew={vi.fn()} />);
    expect(screen.queryByTestId('task-tabs-close-fixed')).not.toBeInTheDocument();
  });

  it('双击触发重命名（输入框出现）', () => {
    const onRename = vi.fn();
    render(<TaskTabs tabs={sampleTabs} activeId="t1" onSelect={vi.fn()} onClose={vi.fn()} onNew={vi.fn()} onRename={onRename} />);
    const tab = screen.getByTestId('task-tabs-tab-t1');
    fireEvent.doubleClick(tab);
    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
  });

  it('进度条仅在 running + progress 时显示', () => {
    const { container } = render(<TaskTabs tabs={sampleTabs} activeId="t1" onSelect={vi.fn()} onClose={vi.fn()} onNew={vi.fn()} />);
    // t1 running + progress=30 应该有进度条
    const t1 = screen.getByTestId('task-tabs-tab-t1');
    // v1.1.0 G60-FIX-17: 进度条使用 Tailwind bg-hermes-500 类名
    expect(t1.querySelector('.bg-hermes-500')).toBeInTheDocument();
  });

  it('role=tablist 标识', () => {
    render(<TaskTabs tabs={sampleTabs} activeId="t1" onSelect={vi.fn()} onClose={vi.fn()} onNew={vi.fn()} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('每个 tab 都是 role=tab', () => {
    render(<TaskTabs tabs={sampleTabs} activeId="t1" onSelect={vi.fn()} onClose={vi.fn()} onNew={vi.fn()} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(sampleTabs.length);
  });

  it('subtitle 显示在 title 属性', () => {
    const tabs: TaskTab[] = [
      { id: 't1', title: 'Test', subtitle: '子标题', status: 'running' },
    ];
    render(<TaskTabs tabs={tabs} activeId="t1" onSelect={vi.fn()} onClose={vi.fn()} onNew={vi.fn()} />);
    const tab = screen.getByTestId('task-tabs-tab-t1');
    expect(tab.getAttribute('title')).toContain('子标题');
  });

  it('model 显示在 tooltip', () => {
    const tabs: TaskTab[] = [
      { id: 't1', title: 'Test', status: 'running', model: 'claude-sonnet-4' },
    ];
    render(<TaskTabs tabs={tabs} activeId="t1" onSelect={vi.fn()} onClose={vi.fn()} onNew={vi.fn()} />);
    const tab = screen.getByTestId('task-tabs-tab-t1');
    expect(tab.getAttribute('title')).toContain('claude-sonnet-4');
  });

  it('status=error 使用红色 emoji', () => {
    render(<TaskTabs tabs={sampleTabs} activeId="t1" onSelect={vi.fn()} onClose={vi.fn()} onNew={vi.fn()} />);
    const t3 = screen.getByTestId('task-tabs-tab-t3');
    const indicator = t3.querySelector('span');
    expect(indicator?.textContent).toBe('✕');
  });

  it('status=done 使用对勾', () => {
    render(<TaskTabs tabs={sampleTabs} activeId="t1" onSelect={vi.fn()} onClose={vi.fn()} onNew={vi.fn()} />);
    const t4 = screen.getByTestId('task-tabs-tab-t4');
    const indicator = t4.querySelector('span');
    expect(indicator?.textContent).toBe('✓');
  });

  it('status=running 时指示器有 pulse 动画', () => {
    render(<TaskTabs tabs={sampleTabs} activeId="t1" onSelect={vi.fn()} onClose={vi.fn()} onNew={vi.fn()} />);
    const t1 = screen.getByTestId('task-tabs-tab-t1');
    const indicator = t1.querySelector('.animate-pulse');
    expect(indicator).toBeInTheDocument();
  });

  it('进度条宽度匹配 progress', () => {
    const tabs: TaskTab[] = [
      { id: 't1', title: 'Test', status: 'running', progress: 50 },
    ];
    const { container } = render(<TaskTabs tabs={tabs} activeId="t1" onSelect={vi.fn()} onClose={vi.fn()} onNew={vi.fn()} />);
    const progressBar = container.querySelector('[style*="width: 50%"]');
    expect(progressBar).toBeInTheDocument();
  });

  it('进度 100% 时样式正确', () => {
    const tabs: TaskTab[] = [
      { id: 't1', title: 'Test', status: 'running', progress: 100 },
    ];
    const { container } = render(<TaskTabs tabs={tabs} activeId="t1" onSelect={vi.fn()} onClose={vi.fn()} onNew={vi.fn()} />);
    const progressBar = container.querySelector('[style*="width: 100%"]');
    expect(progressBar).toBeInTheDocument();
  });

  it('data-testid 可定制', () => {
    render(<TaskTabs tabs={sampleTabs} activeId="t1" onSelect={vi.fn()} onClose={vi.fn()} onNew={vi.fn()} data-testid="custom-tabs" />);
    expect(screen.getByTestId('custom-tabs')).toBeInTheDocument();
  });
});
