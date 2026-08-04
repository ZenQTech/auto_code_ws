/**
 * # ============================================================
 * # BatchResultTable - 组件测试 (v1.0.0)
 * # Cycle 65 G65-02
 * # ====================================
 * # 核心作用：覆盖 BatchResultTable 的核心交互、过滤、错误展开
 * # 测试维度：
 * #   1. 空状态渲染
 * #   2. instance 列表渲染
 * #   3. 状态过滤（all/running/completed/failed/cancelled）
 * #   4. 错误详情展开/折叠
 * #   5. 失败行高亮
 * #   6. 表头与统计
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 65 G65-02 初次创建
 * # ====================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { BatchResultTable } from './BatchResultTable';
import type { BatchJob, BatchInstance } from '../hooks/useBatchSpawner';

// ============================================================
// 测试 fixture
// ============================================================

function makeInstance(overrides: Partial<BatchInstance> = {}): BatchInstance {
  return {
    agent_id: `agent-${Math.random().toString(36).slice(2, 10)}`,
    row_index: 1,
    task: 'Default task',
    role: 'default',
    context: {},
    status: 'pending',
    started_at: 0,
    ...overrides,
  };
}

function makeJob(instances: BatchInstance[], overrides: Partial<BatchJob> = {}): BatchJob {
  const instMap: Record<string, BatchInstance> = {};
  for (const inst of instances) instMap[inst.agent_id] = inst;
  return {
    batch_id: 'batch-test123',
    total: instances.length,
    accepted: instances.length,
    rejected: 0,
    in_progress: instances.filter((i) => i.status === 'running').length,
    completed: instances.filter((i) => i.status === 'completed').length,
    failed: instances.filter((i) => i.status === 'failed').length,
    progress: 0,
    status: 'running',
    max_concurrency: 5,
    started_at: 0,
    instances: instMap,
    errors: [],
    ...overrides,
  };
}

const SAMPLE_INSTANCES: BatchInstance[] = [
  makeInstance({ agent_id: 'a1', row_index: 1, task: 'task 1', status: 'completed' }),
  makeInstance({ agent_id: 'a2', row_index: 2, task: 'task 2', status: 'running' }),
  makeInstance({
    agent_id: 'a3',
    row_index: 3,
    task: 'task 3',
    status: 'failed',
    error: 'Tool timeout: 30s exceeded',
  }),
  makeInstance({ agent_id: 'a4', row_index: 4, task: 'task 4', status: 'cancelled' }),
];

// ============================================================
// 测试
// ============================================================

describe('BatchResultTable', () => {
  beforeEach(() => {
    // 清理副作用
  });

  afterEach(() => {
    cleanup();
  });

  it('job=null 显示空状态', () => {
    render(<BatchResultTable job={null} />);
    const el = screen.getByTestId('batch-result-table');
    expect(el).toBeTruthy();
    expect(screen.getByText(/暂无批量任务/)).toBeTruthy();
  });

  it('instances 为空时显示提示', () => {
    const job = makeJob([]);
    render(<BatchResultTable job={job} />);
    expect(screen.getByText(/等待子任务 spawn/)).toBeTruthy();
  });

  it('渲染所有 instance 行', () => {
    const job = makeJob(SAMPLE_INSTANCES);
    render(<BatchResultTable job={job} />);
    expect(screen.getByTestId('batch-instance-row-1')).toBeTruthy();
    expect(screen.getByTestId('batch-instance-row-2')).toBeTruthy();
    expect(screen.getByTestId('batch-instance-row-3')).toBeTruthy();
    expect(screen.getByTestId('batch-instance-row-4')).toBeTruthy();
  });

  it('失败行显示错误展开按钮', () => {
    const job = makeJob(SAMPLE_INSTANCES);
    render(<BatchResultTable job={job} />);
    expect(screen.getByTestId('batch-instance-error-toggle-3')).toBeTruthy();
  });

  it('点击错误按钮展开错误详情', () => {
    const job = makeJob(SAMPLE_INSTANCES);
    render(<BatchResultTable job={job} />);
    fireEvent.click(screen.getByTestId('batch-instance-error-toggle-3'));
    expect(screen.getByTestId('batch-instance-error-detail-3')).toBeTruthy();
    expect(screen.getByText(/Tool timeout: 30s exceeded/)).toBeTruthy();
  });

  it('点击错误按钮再次折叠', () => {
    const job = makeJob(SAMPLE_INSTANCES);
    render(<BatchResultTable job={job} />);
    const toggle = screen.getByTestId('batch-instance-error-toggle-3');
    fireEvent.click(toggle);
    expect(screen.getByTestId('batch-instance-error-detail-3')).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByTestId('batch-instance-error-detail-3')).toBeNull();
  });

  it('非失败行不显示错误按钮', () => {
    const job = makeJob(SAMPLE_INSTANCES);
    render(<BatchResultTable job={job} />);
    expect(screen.queryByTestId('batch-instance-error-toggle-1')).toBeNull();
    expect(screen.queryByTestId('batch-instance-error-toggle-2')).toBeNull();
    expect(screen.queryByTestId('batch-instance-error-toggle-4')).toBeNull();
  });

  it('过滤：点击已完成只显示 completed 行', () => {
    const job = makeJob(SAMPLE_INSTANCES);
    render(<BatchResultTable job={job} />);
    fireEvent.click(screen.getByTestId('batch-result-filter-completed'));
    expect(screen.getByTestId('batch-instance-row-1')).toBeTruthy();
    expect(screen.queryByTestId('batch-instance-row-2')).toBeNull();
    expect(screen.queryByTestId('batch-instance-row-3')).toBeNull();
    expect(screen.queryByTestId('batch-instance-row-4')).toBeNull();
  });

  it('过滤：点击失败只显示 failed 行', () => {
    const job = makeJob(SAMPLE_INSTANCES);
    render(<BatchResultTable job={job} />);
    fireEvent.click(screen.getByTestId('batch-result-filter-failed'));
    expect(screen.queryByTestId('batch-instance-row-1')).toBeNull();
    expect(screen.queryByTestId('batch-instance-row-2')).toBeNull();
    expect(screen.getByTestId('batch-instance-row-3')).toBeTruthy();
    expect(screen.queryByTestId('batch-instance-row-4')).toBeNull();
  });

  it('过滤：点击已取消只显示 cancelled 行', () => {
    const job = makeJob(SAMPLE_INSTANCES);
    render(<BatchResultTable job={job} />);
    fireEvent.click(screen.getByTestId('batch-result-filter-cancelled'));
    expect(screen.queryByTestId('batch-instance-row-1')).toBeNull();
    expect(screen.queryByTestId('batch-instance-row-2')).toBeNull();
    expect(screen.queryByTestId('batch-instance-row-3')).toBeNull();
    expect(screen.getByTestId('batch-instance-row-4')).toBeTruthy();
  });

  it('过滤：点击进行中显示 running/pending/spawning', () => {
    const job = makeJob(SAMPLE_INSTANCES);
    render(<BatchResultTable job={job} />);
    fireEvent.click(screen.getByTestId('batch-result-filter-running'));
    expect(screen.queryByTestId('batch-instance-row-1')).toBeNull();
    expect(screen.getByTestId('batch-instance-row-2')).toBeTruthy();
    expect(screen.queryByTestId('batch-instance-row-3')).toBeNull();
    expect(screen.queryByTestId('batch-instance-row-4')).toBeNull();
  });

  it('过滤：点击全部恢复所有行', () => {
    const job = makeJob(SAMPLE_INSTANCES);
    render(<BatchResultTable job={job} />);
    fireEvent.click(screen.getByTestId('batch-result-filter-failed'));
    fireEvent.click(screen.getByTestId('batch-result-filter-all'));
    expect(screen.getByTestId('batch-instance-row-1')).toBeTruthy();
    expect(screen.getByTestId('batch-instance-row-2')).toBeTruthy();
    expect(screen.getByTestId('batch-instance-row-3')).toBeTruthy();
    expect(screen.getByTestId('batch-instance-row-4')).toBeTruthy();
  });

  it('过滤计数准确', () => {
    const job = makeJob(SAMPLE_INSTANCES);
    render(<BatchResultTable job={job} />);
    const allBtn = screen.getByTestId('batch-result-filter-all');
    const completedBtn = screen.getByTestId('batch-result-filter-completed');
    const failedBtn = screen.getByTestId('batch-result-filter-failed');
    // 全部 4 / 已完成 1 / 失败 1
    expect(within(allBtn).getByText('4')).toBeTruthy();
    expect(within(completedBtn).getByText('1')).toBeTruthy();
    expect(within(failedBtn).getByText('1')).toBeTruthy();
  });

  it('无匹配时显示空提示', () => {
    const job = makeJob([makeInstance({ status: 'completed' })]);
    render(<BatchResultTable job={job} />);
    fireEvent.click(screen.getByTestId('batch-result-filter-failed'));
    expect(screen.getByTestId('batch-result-empty')).toBeTruthy();
  });

  it('表头显示 batch_id', () => {
    const job = makeJob(SAMPLE_INSTANCES);
    render(<BatchResultTable job={job} />);
    expect(screen.getByText(/batch-test123/)).toBeTruthy();
  });

  it('表头显示完成进度', () => {
    const job = makeJob(SAMPLE_INSTANCES, { completed: 1, total: 4 });
    render(<BatchResultTable job={job} />);
    expect(screen.getByText(/1\/4/)).toBeTruthy();
  });

  it('showHeader=false 隐藏表头', () => {
    const job = makeJob(SAMPLE_INSTANCES);
    render(<BatchResultTable job={job} showHeader={false} />);
    expect(screen.queryByText(/batch-test123/)).toBeNull();
  });

  it('渲染所有 6 种 instance 状态', () => {
    const job = makeJob([
      makeInstance({ agent_id: 'a1', row_index: 1, status: 'pending' }),
      makeInstance({ agent_id: 'a2', row_index: 2, status: 'spawning' }),
      makeInstance({ agent_id: 'a3', row_index: 3, status: 'running' }),
      makeInstance({ agent_id: 'a4', row_index: 4, status: 'completed' }),
      makeInstance({ agent_id: 'a5', row_index: 5, status: 'failed' }),
      makeInstance({ agent_id: 'a6', row_index: 6, status: 'cancelled' }),
    ]);
    render(<BatchResultTable job={job} />);
    // 使用 getAllByText 因为 filter 按钮也包含 "已完成" 等字样
    expect(screen.getAllByText(/等待中/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/启动中/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/执行中/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/已完成/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/失败/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/已取消/).length).toBeGreaterThan(0);
  });

  it('未知状态映射为默认 meta', () => {
    const job = makeJob([makeInstance({ agent_id: 'a1', row_index: 1, status: 'unknown_state' })]);
    render(<BatchResultTable job={job} />);
    expect(screen.getByText(/等待中/)).toBeTruthy();
  });
});
