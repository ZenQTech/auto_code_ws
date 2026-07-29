/**
 * BackgroundTasksPanel 集成测试 (v1.0.0 Cycle 19 G19-01)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BackgroundTasksPanel } from './BackgroundTasksPanel';
import { getBackgroundTaskEngine, resetBackgroundTaskEngine } from '../utils/backgroundTaskEngine';

describe('BackgroundTasksPanel', () => {
  beforeEach(() => {
    resetBackgroundTaskEngine();
  });

  it('isOpen=false 不渲染', () => {
    const { container } = render(<BackgroundTasksPanel isOpen={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('打开时显示面板', () => {
    render(<BackgroundTasksPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('background-tasks-panel')).toBeInTheDocument();
  });

  it('显示空状态', () => {
    render(<BackgroundTasksPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('暂无任务')).toBeInTheDocument();
  });

  it('显示任务统计', () => {
    const engine = getBackgroundTaskEngine({ maxConcurrent: 5 });
    engine.createTask({ type: 'composer', prompt: 'a' });
    engine.createTask({ type: 'review', files: ['x.ts'] });
    render(<BackgroundTasksPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/运行 2 个 · 总计 2/)).toBeInTheDocument();
  });

  it('显示任务卡片', () => {
    const engine = getBackgroundTaskEngine({ maxConcurrent: 5 });
    engine.createTask({ type: 'composer', prompt: '重构代码' });
    render(<BackgroundTasksPanel isOpen={true} onClose={() => {}} />);
    // 任务默认 title 为 "Composer: 重构代码"，使用正则宽松匹配
    expect(screen.getByText(/重构代码/)).toBeInTheDocument();
  });

  it('切换状态过滤器', () => {
    const engine = getBackgroundTaskEngine({ maxConcurrent: 5 });
    engine.createTask({ type: 'composer', prompt: 'a' });
    render(<BackgroundTasksPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('status-filter-done'));
    // 没有已完成任务，应该显示空状态
    expect(screen.getByText('暂无任务')).toBeInTheDocument();
  });

  it('搜索功能', () => {
    const engine = getBackgroundTaskEngine({ maxConcurrent: 5 });
    engine.createTask({ type: 'composer', prompt: '重构认证模块' });
    engine.createTask({ type: 'composer', prompt: '添加新功能' });
    render(<BackgroundTasksPanel isOpen={true} onClose={() => {}} />);
    const searchInput = screen.getByTestId('background-tasks-search') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: '认证' } });
    // 任务默认 title 为 "Composer: <prompt>"，使用正则宽松匹配
    expect(screen.getByText(/重构认证模块/)).toBeInTheDocument();
    expect(screen.queryByText(/添加新功能/)).not.toBeInTheDocument();
  });

  it('切换列数', () => {
    render(<BackgroundTasksPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('columns-3'));
    // 验证列数按钮被激活
    expect(screen.getByTestId('columns-3').className).toContain('hermes-500');
  });

  it('点击关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<BackgroundTasksPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('background-tasks-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('Esc 键关闭面板', () => {
    const onClose = vi.fn();
    render(<BackgroundTasksPanel isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('点击背景关闭', () => {
    const onClose = vi.fn();
    const { container } = render(<BackgroundTasksPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it('点击任务卡片触发 onTaskClick', () => {
    const engine = getBackgroundTaskEngine({ maxConcurrent: 5 });
    const task = engine.createTask({ type: 'composer', prompt: 'test' });
    const onTaskClick = vi.fn();
    render(<BackgroundTasksPanel isOpen={true} onClose={() => {}} onTaskClick={onTaskClick} />);
    fireEvent.click(screen.getByTestId(`task-card-${task.id}`));
    expect(onTaskClick).toHaveBeenCalled();
  });

  it('点击取消按钮显示确认对话框', () => {
    const engine = getBackgroundTaskEngine({ maxConcurrent: 5 });
    const task = engine.createTask({ type: 'composer', prompt: 'test' });
    render(<BackgroundTasksPanel isOpen={true} onClose={() => {}} />);
    const cancelBtn = screen.getByTestId(`task-cancel-${task.id}`);
    if (cancelBtn) {
      fireEvent.click(cancelBtn);
      expect(screen.getByTestId('cancel-confirm-dialog')).toBeInTheDocument();
    }
  });

  it('清空历史按钮', () => {
    const engine = getBackgroundTaskEngine({ maxConcurrent: 5 });
    const task = engine.createTask(
      { type: 'composer', prompt: 'test' },
      { autoStart: false }
    );
    engine.completeTask(task.id, { type: 'composer', summary: 'ok' });
    render(<BackgroundTasksPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('background-tasks-clear'));
    expect(engine.getTask(task.id)).toBeNull();
  });
});
