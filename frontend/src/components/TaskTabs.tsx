/**
 * # ============================================================
 * # TaskTabs 组件 (v1.0.0)
 * # Cycle 62 G62-01
 * # ====================================
 * # 核心作用：多任务标签页 UI
 * # 运行流程：
 * #   1. 显示所有任务（含活跃/历史）
 * #   2. 标签页切换查看不同任务
 * #   3. 支持新建/启动/暂停/取消/删除
 * #   4. 状态徽章 + 实时进度
 * # 输入参数：testId, useMultiTask
 * # 输出结果：JSX
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 62 G62-01 初次创建
 * # ====================================
 */

import { useState } from 'react';
import { useMultiTask, type Task, type TaskStatus } from '../hooks/useMultiTask';

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'bg-gray-500',
  running: 'bg-blue-500 animate-pulse',
  paused: 'bg-yellow-500',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  cancelled: 'bg-gray-400',
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '等待中',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export interface TaskTabsProps {
  testId?: string;
  initialPrompt?: string;
  onTaskSelect?: (task: Task) => void;
}

export function TaskTabs({
  testId = 'task-tabs',
  initialPrompt = '',
  onTaskSelect,
}: TaskTabsProps) {
  const {
    tasks,
    activeTaskId,
    setActiveTaskId,
    loading,
    error,
    createTask,
    startTask,
    pauseTask,
    resumeTask,
    cancelTask,
    deleteTask,
  } = useMultiTask();

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPrompt, setNewPrompt] = useState(initialPrompt);

  const activeTask = tasks.find((t) => t.task_id === activeTaskId) || tasks[0];

  const handleCreate = async () => {
    if (!newPrompt.trim()) return;
    const task = await createTask({
      title: newTitle.trim() || newPrompt.slice(0, 30),
      prompt: newPrompt,
    });
    if (task) {
      setShowCreate(false);
      setNewTitle('');
      setNewPrompt('');
      setActiveTaskId(task.task_id);
      // 自动启动
      await startTask(task.task_id);
    }
  };

  const handleSelect = (task: Task) => {
    setActiveTaskId(task.task_id);
    onTaskSelect?.(task);
  };

  return (
    <div
      className="flex flex-col h-full bg-[var(--bg-panel)] text-[var(--text-primary)]"
      data-testid={testId}
    >
      {/* 顶部标签栏 */}
      <div
        className="flex items-center gap-1 p-2 border-b border-[var(--border-color)] overflow-x-auto"
        data-testid={`${testId}-tabbar`}
      >
        {tasks.slice(0, 10).map((task) => (
          <button
            key={task.task_id}
            onClick={() => handleSelect(task)}
            className={`flex items-center gap-1 px-3 py-1 rounded-t text-xs whitespace-nowrap ${
              activeTask?.task_id === task.task_id
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] font-medium'
                : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
            }`}
            data-testid={`${testId}-tab-${task.task_id}`}
          >
            <span
              className={`inline-block w-2 h-2 rounded-full ${STATUS_COLORS[task.status]}`}
              data-testid={`${testId}-status-${task.status}`}
            />
            <span className="max-w-[120px] truncate">{task.title}</span>
          </button>
        ))}
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          data-testid={`${testId}-new-btn`}
        >
          + 新建
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div
          className="px-3 py-2 text-xs bg-red-100 text-red-700 border-b border-red-200"
          data-testid={`${testId}-error`}
        >
          {error}
        </div>
      )}

      {/* 创建对话框 */}
      {showCreate && (
        <div
          className="p-3 border-b border-[var(--border-color)] bg-[var(--bg-elevated)]"
          data-testid={`${testId}-create-form`}
        >
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="任务标题（可选）"
            className="w-full px-2 py-1 mb-2 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-app)]"
            data-testid={`${testId}-input-title`}
          />
          <textarea
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            placeholder="任务描述..."
            rows={3}
            className="w-full px-2 py-1 mb-2 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-app)]"
            data-testid={`${testId}-input-prompt`}
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!newPrompt.trim()}
              className="px-3 py-1 text-xs rounded bg-hermes-500 text-white hover:bg-hermes-600 disabled:opacity-50"
              data-testid={`${testId}-create-submit`}
            >
              创建并启动
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-3 py-1 text-xs rounded border border-[var(--border-color)]"
              data-testid={`${testId}-create-cancel`}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 任务详情区 */}
      {activeTask ? (
        <div
          className="flex-1 p-3 overflow-y-auto"
          data-testid={`${testId}-detail`}
        >
          <div className="flex items-center justify-between mb-2">
            <h3
              className="text-sm font-medium"
              data-testid={`${testId}-detail-title`}
            >
              {activeTask.title}
            </h3>
            <span
              className={`px-2 py-0.5 text-[10px] rounded text-white ${STATUS_COLORS[activeTask.status]}`}
              data-testid={`${testId}-detail-status`}
            >
              {STATUS_LABELS[activeTask.status]}
            </span>
          </div>

          {/* 控制按钮 */}
          <div className="flex gap-1 mb-3">
            {activeTask.status === 'pending' && (
              <button
                onClick={() => startTask(activeTask.task_id)}
                className="px-2 py-1 text-xs rounded bg-green-500 text-white"
                data-testid={`${testId}-action-start`}
              >
                启动
              </button>
            )}
            {activeTask.status === 'running' && (
              <>
                <button
                  onClick={() => pauseTask(activeTask.task_id)}
                  className="px-2 py-1 text-xs rounded bg-yellow-500 text-white"
                  data-testid={`${testId}-action-pause`}
                >
                  暂停
                </button>
                <button
                  onClick={() => cancelTask(activeTask.task_id)}
                  className="px-2 py-1 text-xs rounded bg-red-500 text-white"
                  data-testid={`${testId}-action-cancel`}
                >
                  取消
                </button>
              </>
            )}
            {activeTask.status === 'paused' && (
              <button
                onClick={() => resumeTask(activeTask.task_id)}
                className="px-2 py-1 text-xs rounded bg-blue-500 text-white"
                data-testid={`${testId}-action-resume`}
              >
                恢复
              </button>
            )}
            {['completed', 'failed', 'cancelled'].includes(activeTask.status) && (
              <button
                onClick={() => deleteTask(activeTask.task_id)}
                className="px-2 py-1 text-xs rounded border border-[var(--border-color)]"
                data-testid={`${testId}-action-delete`}
              >
                删除
              </button>
            )}
          </div>

          {/* 资源使用 */}
          <div
            className="text-xs space-y-1 text-[var(--text-secondary)]"
            data-testid={`${testId}-resource`}
          >
            <div>耗时: {activeTask.elapsed_s.toFixed(1)}s</div>
            <div>Token: {activeTask.resource_usage.tokens_used}</div>
            <div>内存: {activeTask.resource_usage.memory_mb.toFixed(0)} MB</div>
          </div>

          {/* 错误信息 */}
          {activeTask.error && (
            <div
              className="mt-2 p-2 text-xs bg-red-50 text-red-700 rounded"
              data-testid={`${testId}-error-detail`}
            >
              {activeTask.error}
            </div>
          )}

          {/* Prompt */}
          <details
            className="mt-3 text-xs"
            data-testid={`${testId}-prompt-section`}
          >
            <summary className="cursor-pointer text-[var(--text-secondary)]">
              原始 Prompt
            </summary>
            <pre className="mt-1 p-2 bg-[var(--bg-app)] rounded text-[var(--text-primary)] whitespace-pre-wrap">
              {activeTask.prompt}
            </pre>
          </details>
        </div>
      ) : (
        <div
          className="flex-1 flex items-center justify-center text-sm text-[var(--text-tertiary)]"
          data-testid={`${testId}-empty`}
        >
          {loading ? '加载中...' : '暂无任务，点击 + 新建创建第一个任务'}
        </div>
      )}
    </div>
  );
}

export default TaskTabs;
