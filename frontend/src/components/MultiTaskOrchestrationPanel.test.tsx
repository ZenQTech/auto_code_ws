/**
 * # ============================================================
 * # MultiTaskOrchestrationPanel 组件测试 (Cycle 24 G24-02)
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MultiTaskOrchestrationPanel } from './MultiTaskOrchestrationPanel';
import { resetMultiTaskOrchestrator, getMultiTaskOrchestrator } from '../utils/multiTaskOrchestrator';

describe('MultiTaskOrchestrationPanel', () => {
  beforeEach(() => {
    resetMultiTaskOrchestrator();
  });

  afterEach(() => {
    cleanup();
    resetMultiTaskOrchestrator();
  });

  it('面板未打开时不渲染', () => {
    const { container } = render(<MultiTaskOrchestrationPanel isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('面板打开时显示标题', () => {
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('多任务并行编排')).toBeTruthy();
  });

  it('应显示 4 个标签页', () => {
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('multi-task-tab-tasks')).toBeTruthy();
    expect(screen.getByTestId('multi-task-tab-graph')).toBeTruthy();
    expect(screen.getByTestId('multi-task-tab-conflicts')).toBeTruthy();
    expect(screen.getByTestId('multi-task-tab-config')).toBeTruthy();
  });

  it('应显示统计卡片', () => {
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('stat-total')).toBeTruthy();
    expect(screen.getByTestId('stat-running')).toBeTruthy();
    expect(screen.getByTestId('stat-completed')).toBeTruthy();
    expect(screen.getByTestId('stat-failed')).toBeTruthy();
    expect(screen.getByTestId('stat-concurrency')).toBeTruthy();
    expect(screen.getByTestId('stat-cost')).toBeTruthy();
    expect(screen.getByTestId('stat-budget')).toBeTruthy();
  });

  it('空任务列表应显示 EmptyState', () => {
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(/暂无任务/)).toBeTruthy();
  });

  it('点击关闭按钮应调用 onClose', () => {
    const onClose = vi.fn();
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('multi-task-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('点击背景应关闭面板', () => {
    const onClose = vi.fn();
    const { container } = render(<MultiTaskOrchestrationPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(container.querySelector('[data-testid="multi-task-panel"]')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('Esc 键应关闭面板', () => {
    const onClose = vi.fn();
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('应能切换到依赖图标签', () => {
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('multi-task-tab-graph'));
    // 依赖图空状态
    expect(screen.getByText(/暂无任务/)).toBeTruthy();
  });

  it('应能切换到冲突标签', () => {
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('multi-task-tab-conflicts'));
    expect(screen.getByTestId('empty-state')).toBeTruthy();
  });

  it('应能切换到配置标签', () => {
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('multi-task-tab-config'));
    expect(screen.getByTestId('config-max-concurrent')).toBeTruthy();
    expect(screen.getByTestId('config-conflict-policy')).toBeTruthy();
    expect(screen.getByTestId('config-auto-start')).toBeTruthy();
  });

  it('点击创建任务应显示表单', () => {
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('create-task'));
    expect(screen.getByTestId('create-task-drawer')).toBeTruthy();
    expect(screen.getByTestId('create-name')).toBeTruthy();
    expect(screen.getByTestId('create-type')).toBeTruthy();
  });

  it('创建任务后应显示在列表中', () => {
    const engine = getMultiTaskOrchestrator();
    const t = engine.createTask({
      name: 'my-task',
      type: 'implementation',
      description: 'test desc',
      priority: 5,
      dependsOn: [],
      totalSteps: 5,
      files: [],
      model: 'm',
      maxRetries: 2,
      metadata: {},
    });
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('my-task')).toBeTruthy();
    expect(screen.getByTestId(`task-card-${t.id}`)).toBeTruthy();
  });

  it('应能按状态过滤', () => {
    const engine = getMultiTaskOrchestrator({ autoStart: false });
    const t = engine.createTask({
      name: 'pending-task',
      type: 'implementation',
      description: '',
      priority: 5,
      dependsOn: [],
      totalSteps: 1,
      files: [],
      model: 'm',
      maxRetries: 0,
      metadata: {},
    });
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    const select = screen.getByTestId('filter-status') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'pending' } });
    expect(screen.getByTestId(`task-card-${t.id}`)).toBeTruthy();
  });

  it('应能按类型过滤', () => {
    const engine = getMultiTaskOrchestrator({ autoStart: false });
    const t = engine.createTask({
      name: 'review-task',
      type: 'review',
      description: '',
      priority: 5,
      dependsOn: [],
      totalSteps: 1,
      files: [],
      model: 'm',
      maxRetries: 0,
      metadata: {},
    });
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    const select = screen.getByTestId('filter-type') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'review' } });
    expect(screen.getByTestId(`task-card-${t.id}`)).toBeTruthy();
  });

  it('点击任务卡片应打开详情侧栏', () => {
    const engine = getMultiTaskOrchestrator({ autoStart: false });
    const t = engine.createTask({
      name: 'detail-task',
      type: 'implementation',
      description: 'detail description',
      priority: 5,
      dependsOn: [],
      totalSteps: 5,
      files: ['a.ts'],
      model: 'm',
      maxRetries: 0,
      metadata: {},
    });
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId(`task-card-${t.id}`));
    expect(screen.getByTestId('task-detail')).toBeTruthy();
  });

  it('运行中任务应显示暂停按钮', () => {
    const engine = getMultiTaskOrchestrator({ autoStart: false });
    const t = engine.createTask({
      name: 'running-task',
      type: 'implementation',
      description: '',
      priority: 5,
      dependsOn: [],
      totalSteps: 5,
      files: [],
      model: 'm',
      maxRetries: 0,
      metadata: {},
    });
    engine.start(t.id);
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId(`task-pause-${t.id}`)).toBeTruthy();
  });

  it('点击暂停应停止任务', () => {
    const engine = getMultiTaskOrchestrator({ autoStart: false });
    const t = engine.createTask({
      name: 'pause-task',
      type: 'implementation',
      description: '',
      priority: 5,
      dependsOn: [],
      totalSteps: 5,
      files: [],
      model: 'm',
      maxRetries: 0,
      metadata: {},
    });
    engine.start(t.id);
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId(`task-pause-${t.id}`));
    expect(engine.getTask(t.id)?.status).toBe('paused');
  });

  it('暂停任务应显示恢复按钮', () => {
    const engine = getMultiTaskOrchestrator({ autoStart: false });
    const t = engine.createTask({
      name: 'paused-task',
      type: 'implementation',
      description: '',
      priority: 5,
      dependsOn: [],
      totalSteps: 5,
      files: [],
      model: 'm',
      maxRetries: 0,
      metadata: {},
    });
    engine.start(t.id);
    engine.pause(t.id);
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId(`task-resume-${t.id}`)).toBeTruthy();
  });

  it('完成的任务不应显示操作按钮', () => {
    const engine = getMultiTaskOrchestrator({ autoStart: false });
    const t = engine.createTask({
      name: 'completed-task',
      type: 'implementation',
      description: '',
      priority: 5,
      dependsOn: [],
      totalSteps: 1,
      files: [],
      model: 'm',
      maxRetries: 0,
      metadata: {},
    });
    engine.start(t.id);
    engine.completeTask(t.id, 'done');
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.queryByTestId(`task-start-${t.id}`)).toBeNull();
    expect(screen.queryByTestId(`task-pause-${t.id}`)).toBeNull();
  });

  it('创建任务表单应能填写并提交', () => {
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('create-task'));
    fireEvent.change(screen.getByTestId('create-name'), {
      target: { value: 'new-task-from-form' },
    });
    fireEvent.click(screen.getByTestId('create-submit'));
    const engine = getMultiTaskOrchestrator();
    const tasks = engine.listTasks();
    expect(tasks.find((t) => t.name === 'new-task-from-form')).toBeTruthy();
  });

  it('空任务名应弹出 alert', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('create-task'));
    fireEvent.click(screen.getByTestId('create-submit'));
    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('依赖图标签应能显示已存在的任务', () => {
    const engine = getMultiTaskOrchestrator({ autoStart: false });
    const t = engine.createTask({
      name: 'graph-task',
      type: 'implementation',
      description: '',
      priority: 5,
      dependsOn: [],
      totalSteps: 1,
      files: [],
      model: 'm',
      maxRetries: 0,
      metadata: {},
    });
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('multi-task-tab-graph'));
    expect(screen.getByTestId(`graph-node-${t.id}`)).toBeTruthy();
  });

  it('配置标签页应能更新最大并发', () => {
    const engine = getMultiTaskOrchestrator();
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('multi-task-tab-config'));
    const input = screen.getByTestId('config-max-concurrent') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '8' } });
    expect(engine.getConfig().maxConcurrent).toBe(8);
  });

  it('冲突标签应显示冲突列表', () => {
    const engine = getMultiTaskOrchestrator({ autoStart: false });
    const t1 = engine.createTask({
      name: 'c1',
      type: 'implementation',
      description: '',
      priority: 5,
      dependsOn: [],
      totalSteps: 1,
      files: ['x.ts'],
      model: 'm',
      maxRetries: 0,
      metadata: {},
    });
    const t2 = engine.createTask({
      name: 'c2',
      type: 'implementation',
      description: '',
      priority: 5,
      dependsOn: [],
      totalSteps: 1,
      files: ['x.ts'],
      model: 'm',
      maxRetries: 0,
      metadata: {},
    });
    // 启动 t1 后，尝试启动 t2 会触发 conflict-detected 事件
    engine.start(t1.id);
    engine.start(t2.id);
    render(<MultiTaskOrchestrationPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('multi-task-tab-conflicts'));
    // 通过 testid 验证冲突卡片渲染
    expect(screen.getByTestId('conflict-0')).toBeTruthy();
    expect(screen.getByTestId('clear-conflicts')).toBeTruthy();
  });
});
