/**
 * TaskTabs 单元测试 (G62-01 重写版)
 * 匹配 useMultiTask Hook 接口的版本
 */

// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TaskTabs from '../components/TaskTabs';

// ============================================================
// Mock useMultiTask Hook
// ============================================================
const mockState = {
  tasks: [] as any[],
  activeTaskId: null as string | null,
  setActiveTaskId: vi.fn(),
  loading: false,
  error: null as string | null,
  createTask: vi.fn(),
  startTask: vi.fn(),
  pauseTask: vi.fn(),
  resumeTask: vi.fn(),
  cancelTask: vi.fn(),
  deleteTask: vi.fn(),
};

vi.mock('../hooks/useMultiTask', () => ({
  useMultiTask: () => mockState,
}));

// 工具函数：重置 mock
function resetMock() {
  mockState.tasks = [];
  mockState.activeTaskId = null;
  mockState.loading = false;
  mockState.error = null;
  mockState.setActiveTaskId.mockClear();
  mockState.createTask.mockReset();
  mockState.startTask.mockReset();
  mockState.pauseTask.mockReset();
  mockState.resumeTask.mockReset();
  mockState.cancelTask.mockReset();
  mockState.deleteTask.mockReset();
  // 默认 createTask 返回成功
  mockState.createTask.mockResolvedValue({
    task_id: 'new-task-id',
    title: '新任务',
    prompt: '测试 prompt',
    status: 'pending',
    elapsed_s: 0,
    resource_usage: { tokens_used: 0, memory_mb: 0 },
    error: null,
  });
  mockState.startTask.mockResolvedValue(undefined);
  mockState.pauseTask.mockResolvedValue(undefined);
  mockState.resumeTask.mockResolvedValue(undefined);
  mockState.cancelTask.mockResolvedValue(undefined);
  mockState.deleteTask.mockResolvedValue(undefined);
}

describe('TaskTabs', () => {
  beforeEach(() => {
    resetMock();
  });

  it('空任务列表显示提示', () => {
    render(<TaskTabs />);
    expect(screen.getByText(/暂无任务/)).toBeInTheDocument();
  });

  it('加载中状态', () => {
    mockState.loading = true;
    render(<TaskTabs />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('错误状态显示错误信息', () => {
    mockState.error = '加载失败';
    render(<TaskTabs />);
    expect(screen.getByText('加载失败')).toBeInTheDocument();
  });

  it('渲染任务列表', () => {
    mockState.tasks = [
      { task_id: 't1', title: '任务 1', status: 'running', prompt: 'p1', elapsed_s: 1.0, resource_usage: { tokens_used: 100, memory_mb: 50 }, error: null },
      { task_id: 't2', title: '任务 2', status: 'paused', prompt: 'p2', elapsed_s: 2.0, resource_usage: { tokens_used: 200, memory_mb: 80 }, error: null },
      { task_id: 't3', title: '任务 3', status: 'completed', prompt: 'p3', elapsed_s: 3.0, resource_usage: { tokens_used: 300, memory_mb: 60 }, error: null },
    ];
    mockState.activeTaskId = 't1';
    render(<TaskTabs />);
    // 每个任务在 tab 栏和 detail 区中均会渲染，使用 getAllByText
    expect(screen.getAllByText('任务 1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('任务 2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('任务 3').length).toBeGreaterThanOrEqual(1);
  });

  it('点击 tab 切换 active', () => {
    mockState.tasks = [
      { task_id: 't1', title: '任务 1', status: 'running', prompt: 'p1', elapsed_s: 0, resource_usage: { tokens_used: 0, memory_mb: 0 }, error: null },
      { task_id: 't2', title: '任务 2', status: 'paused', prompt: 'p2', elapsed_s: 0, resource_usage: { tokens_used: 0, memory_mb: 0 }, error: null },
    ];
    mockState.activeTaskId = 't1';
    render(<TaskTabs />);
    fireEvent.click(screen.getByTestId('task-tabs-tab-t2'));
    expect(mockState.setActiveTaskId).toHaveBeenCalledWith('t2');
  });

  it('点击 + 按钮显示创建表单', () => {
    render(<TaskTabs />);
    fireEvent.click(screen.getByTestId('task-tabs-new-btn'));
    expect(screen.getByTestId('task-tabs-create-form')).toBeInTheDocument();
    expect(screen.getByTestId('task-tabs-input-title')).toBeInTheDocument();
    expect(screen.getByTestId('task-tabs-input-prompt')).toBeInTheDocument();
  });

  it('创建任务时调用 createTask + startTask', async () => {
    render(<TaskTabs />);
    fireEvent.click(screen.getByTestId('task-tabs-new-btn'));
    fireEvent.change(screen.getByTestId('task-tabs-input-prompt'), {
      target: { value: '新建 prompt' },
    });
    fireEvent.click(screen.getByTestId('task-tabs-create-submit'));
    await waitFor(() => {
      expect(mockState.createTask).toHaveBeenCalled();
      expect(mockState.startTask).toHaveBeenCalled();
    });
  });

  it('取消创建关闭表单', () => {
    render(<TaskTabs />);
    fireEvent.click(screen.getByTestId('task-tabs-new-btn'));
    expect(screen.getByTestId('task-tabs-create-form')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('task-tabs-create-cancel'));
    expect(screen.queryByTestId('task-tabs-create-form')).not.toBeInTheDocument();
  });

  it('空 prompt 不能创建', () => {
    render(<TaskTabs />);
    fireEvent.click(screen.getByTestId('task-tabs-new-btn'));
    const submit = screen.getByTestId('task-tabs-create-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('active 任务 pending 状态显示启动按钮', () => {
    mockState.tasks = [
      { task_id: 't1', title: '待启动', status: 'pending', prompt: 'p', elapsed_s: 0, resource_usage: { tokens_used: 0, memory_mb: 0 }, error: null },
    ];
    mockState.activeTaskId = 't1';
    render(<TaskTabs />);
    expect(screen.getByTestId('task-tabs-action-start')).toBeInTheDocument();
  });

  it('active 任务 running 状态显示暂停/取消按钮', () => {
    mockState.tasks = [
      { task_id: 't1', title: '运行中', status: 'running', prompt: 'p', elapsed_s: 5, resource_usage: { tokens_used: 100, memory_mb: 50 }, error: null },
    ];
    mockState.activeTaskId = 't1';
    render(<TaskTabs />);
    expect(screen.getByTestId('task-tabs-action-pause')).toBeInTheDocument();
    expect(screen.getByTestId('task-tabs-action-cancel')).toBeInTheDocument();
  });

  it('active 任务 paused 状态显示恢复按钮', () => {
    mockState.tasks = [
      { task_id: 't1', title: '已暂停', status: 'paused', prompt: 'p', elapsed_s: 5, resource_usage: { tokens_used: 100, memory_mb: 50 }, error: null },
    ];
    mockState.activeTaskId = 't1';
    render(<TaskTabs />);
    expect(screen.getByTestId('task-tabs-action-resume')).toBeInTheDocument();
  });

  it('active 任务 completed 状态显示删除按钮', () => {
    mockState.tasks = [
      { task_id: 't1', title: '已完成', status: 'completed', prompt: 'p', elapsed_s: 5, resource_usage: { tokens_used: 100, memory_mb: 50 }, error: null },
    ];
    mockState.activeTaskId = 't1';
    render(<TaskTabs />);
    expect(screen.getByTestId('task-tabs-action-delete')).toBeInTheDocument();
  });

  it('暂停按钮点击触发 pauseTask', () => {
    mockState.tasks = [
      { task_id: 't1', title: '运行中', status: 'running', prompt: 'p', elapsed_s: 5, resource_usage: { tokens_used: 100, memory_mb: 50 }, error: null },
    ];
    mockState.activeTaskId = 't1';
    render(<TaskTabs />);
    fireEvent.click(screen.getByTestId('task-tabs-action-pause'));
    expect(mockState.pauseTask).toHaveBeenCalledWith('t1');
  });

  it('data-testid 可定制', () => {
    render(<TaskTabs testId="custom-tabs" />);
    expect(screen.getByTestId('custom-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('custom-tabs-new-btn')).toBeInTheDocument();
  });
});
