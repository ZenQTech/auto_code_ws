/**
 * # ============================================================
 * VerificationPanel - 验证闭环机制管理面板 (v1.0.0 - Cycle 10 P1-10)
 * # ============================================================
 * 核心作用：可视化展示 Verification Loop 完整状态（4 维度验证 + 自动修复 +
 *           基线管理 + Webhook），支持创建/执行/取消/重试验证任务
 * 运行流程：
 *   1. 挂载时拉取统计 + 健康检查 + 任务列表 + 基线列表
 *   2. 用户创建任务 → 立即执行 → 轮询获取结果
 *   3. 任务详情面板显示：4 维度结果 + 修复记录 + 重试次数
 *   4. 基线管理：列出 / 创建 / 删除性能基线
 *   5. Webhook 触发：模拟 git push / PR 事件
 * 输入参数：
 *   - onClose?: 关闭回调（注入到 AppLayout 模式时不传）
 *   - standalone?: 是否独立页面模式
 * 输出结果：完整的 React 组件
 * 创建日期：2026-07-28
 * 模块版本：v1.0.0
 * ============================================================
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  cancelTask,
  createBaseline,
  createTask,
  fetchHealth,
  fetchStats,
  formatDuration,
  formatTime,
  getDimensionColor,
  getStatusColor,
  getTriggerIcon,
  listBaselines,
  listTasks,
  retryTask,
  runTask,
  triggerWebhook,
  type BaselineFormState,
  type Dimension,
  type HealthInfo,
  type PerformanceBaseline,
  type TaskDetail,
  type TriggerType,
  type VerificationStats,
  type VerificationTask,
} from '../hooks/useVerificationApi';
import { useToast } from '../hooks/useToast';

// ============================================================
// 常量
// ============================================================

const DIMENSIONS: Dimension[] = [
  'syntax',
  'module',
  'integration',
  'performance',
];

const TRIGGERS: TriggerType[] = ['manual', 'commit', 'pr', 'cron'];

// 维度说明
const DIMENSION_DESC: Record<Dimension, string> = {
  syntax: '代码语法与类型检查（mypy / tsc）',
  module: '模块独立单元测试（pytest / jest）',
  integration: '端到端集成测试（bash e2e）',
  performance: '性能基准测试 + 基线对比',
};

// ============================================================
// 主组件
// ============================================================

interface VerificationPanelProps {
  onClose?: () => void;
  standalone?: boolean;
}

const VerificationPanel: React.FC<VerificationPanelProps> = ({
  onClose,
  standalone = false,
}) => {
  const toast = useToast();
  // useToast 返回 { showToast, ... }，封装便捷调用
  const notify = {
    success: (msg: string) => toast.showToast(msg, 'success'),
    error: (msg: string) => toast.showToast(msg, 'error'),
  };
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [stats, setStats] = useState<VerificationStats | null>(null);
  const [tasks, setTasks] = useState<VerificationTask[]>([]);
  const [baselines, setBaselines] = useState<PerformanceBaseline[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 过滤
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [triggerFilter, setTriggerFilter] = useState<string>('');

  // 选中的任务
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);

  // 创建任务表单
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formState, setFormState] = useState<{
    trigger: TriggerType;
    commit_sha: string;
    project_path: string;
    dimensions: Dimension[];
  }>({
    trigger: 'manual',
    commit_sha: '',
    project_path: '/home/qizheng/auto_code_ws',
    dimensions: ['syntax'],
  });

  // 基线表单
  const [showBaselineForm, setShowBaselineForm] = useState(false);
  const [baselineForm, setBaselineForm] = useState<BaselineFormState>({
    name: '',
    project_path: '/home/qizheng/auto_code_ws',
    metric_name: 'execution_ms',
    metric_value: 10.0,
    unit: 'ms',
    commit_sha: '',
  });

  // Webhook 触发表单
  const [showWebhookForm, setShowWebhookForm] = useState(false);
  const [webhookForm, setWebhookForm] = useState<{
    event: 'push' | 'pull_request';
    commit_sha: string;
  }>({
    event: 'push',
    commit_sha: '',
  });

  // ============================================================
  // 数据加载
  // ============================================================

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, s, t, b] = await Promise.all([
        fetchHealth(),
        fetchStats(),
        listTasks({ limit: 100 }),
        listBaselines(),
      ]);
      setHealth(h);
      setStats(s.data);
      setTasks(t.data);
      setBaselines(b.data);
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
    // 30s 自动刷新
    const t = setInterval(() => {
      loadAll();
    }, 30000);
    return () => clearInterval(t);
  }, [loadAll]);

  // 任务详情加载
  useEffect(() => {
    if (!selectedTaskId) {
      setTaskDetail(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const detail = await import('../hooks/useVerificationApi').then((m) =>
          m.getTask(selectedTaskId!),
        );
        if (!cancelled) setTaskDetail(detail);
      } catch (e: any) {
        if (!cancelled) setError(e.message || '加载任务详情失败');
      }
    };
    load();
    // 任务运行时 2s 轮询
    const interval = setInterval(() => {
      if (taskDetail?.task?.status === 'running' || taskDetail?.task?.status === 'pending') {
        load();
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedTaskId, taskDetail?.task?.status]);

  // 过滤后的任务
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false;
      if (triggerFilter && t.trigger !== triggerFilter) return false;
      return true;
    });
  }, [tasks, statusFilter, triggerFilter]);

  // ============================================================
  // 任务操作
  // ============================================================

  const handleCreateTask = async () => {
    if (!formState.commit_sha) {
      notify.error('请输入 commit SHA');
      return;
    }
    if (formState.dimensions.length === 0) {
      notify.error('请至少选择一个验证维度');
      return;
    }
    try {
      const r = await createTask(formState);
      notify.success(`任务创建成功: ${r.task_id}`);
      setShowCreateForm(false);
      setFormState((s) => ({ ...s, commit_sha: '' }));
      await loadAll();
    } catch (e: any) {
      notify.error(`创建失败: ${e.message}`);
    }
  };

  const handleRunTask = async (taskId: string) => {
    try {
      await runTask(taskId);
      notify.success('任务已启动');
      setSelectedTaskId(taskId);
      await loadAll();
    } catch (e: any) {
      notify.error(`执行失败: ${e.message}`);
    }
  };

  const handleCancelTask = async (taskId: string) => {
    if (!confirm('确认取消此任务？')) return;
    try {
      await cancelTask(taskId);
      notify.success('任务已取消');
      await loadAll();
      if (selectedTaskId === taskId) {
        const detail = await import('../hooks/useVerificationApi').then((m) =>
          m.getTask(taskId),
        );
        setTaskDetail(detail);
      }
    } catch (e: any) {
      notify.error(`取消失败: ${e.message}`);
    }
  };

  const handleRetryTask = async (taskId: string) => {
    try {
      await retryTask(taskId);
      notify.success('任务已重试');
      setSelectedTaskId(taskId);
      await loadAll();
    } catch (e: any) {
      notify.error(`重试失败: ${e.message}`);
    }
  };

  // ============================================================
  // 基线操作
  // ============================================================

  const handleCreateBaseline = async () => {
    if (!baselineForm.name) {
      notify.error('请输入基线名称');
      return;
    }
    try {
      await createBaseline(baselineForm);
      notify.success('基线已创建');
      setShowBaselineForm(false);
      setBaselineForm((s) => ({ ...s, name: '', commit_sha: '' }));
      const b = await listBaselines();
      setBaselines(b.data);
    } catch (e: any) {
      notify.error(`创建失败: ${e.message}`);
    }
  };

  // ============================================================
  // Webhook 触发
  // ============================================================

  const handleTriggerWebhook = async () => {
    if (!webhookForm.commit_sha) {
      notify.error('请输入 commit SHA');
      return;
    }
    try {
      const payload =
        webhookForm.event === 'push'
          ? {
              ref: 'refs/heads/main',
              after: webhookForm.commit_sha,
              repository: { full_name: 'hermes/hermes' },
              pusher: { name: 'test@example.com' },
              commits: [
                {
                  id: webhookForm.commit_sha,
                  message: 'webhook test',
                  author: { name: 'tester' },
                },
              ],
            }
          : {
              repository: { full_name: 'hermes/hermes' },
              pull_request: {
                head: { sha: webhookForm.commit_sha, ref: 'feature' },
                user: { login: 'dev1' },
                title: 'Webhook test PR',
              },
            };
      const r = await triggerWebhook({
        event: webhookForm.event,
        project_path: '/home/qizheng/auto_code_ws',
        payload,
      });
      notify.success(`Webhook 已触发: ${r.task_id}`);
      setShowWebhookForm(false);
      setWebhookForm((s) => ({ ...s, commit_sha: '' }));
      await loadAll();
    } catch (e: any) {
      notify.error(`触发失败: ${e.message}`);
    }
  };

  // ============================================================
  // 渲染
  // ============================================================

  return (
    <div
      className={`flex flex-col h-full bg-gray-50 ${
        standalone ? '' : 'rounded-lg shadow border border-gray-200'
      }`}
    >
      {/* 头部 */}
      <div className="px-4 py-3 bg-white border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-gray-800">
            🔁 Verification Loop
            {health && (
              <span className="ml-2 text-xs text-gray-500 font-normal">
                v{health.version}
              </span>
            )}
          </h2>
          {health && (
            <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
              ● healthy
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            + 新建任务
          </button>
          <button
            onClick={() => setShowBaselineForm(true)}
            className="px-3 py-1.5 text-sm bg-amber-500 text-white rounded hover:bg-amber-600"
          >
            + 新建基线
          </button>
          <button
            onClick={() => setShowWebhookForm(true)}
            className="px-3 py-1.5 text-sm bg-purple-500 text-white rounded hover:bg-purple-600"
          >
            ⚡ 触发 Webhook
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
          ⚠ {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-500">
            ✕
          </button>
        </div>
      )}

      {/* 统计概览 */}
      {stats && (
        <div className="px-4 py-2 bg-white border-b border-gray-200 grid grid-cols-6 gap-3 text-xs">
          <div>
            <div className="text-gray-500">总任务</div>
            <div className="text-lg font-semibold text-gray-800">{stats.total_tasks}</div>
          </div>
          <div>
            <div className="text-gray-500">通过</div>
            <div className="text-lg font-semibold text-green-600">
              {stats.by_status.passed || 0}
            </div>
          </div>
          <div>
            <div className="text-gray-500">失败</div>
            <div className="text-lg font-semibold text-red-600">
              {stats.by_status.failed || 0}
            </div>
          </div>
          <div>
            <div className="text-gray-500">运行中</div>
            <div className="text-lg font-semibold text-blue-600">
              {stats.by_status.running || 0}
            </div>
          </div>
          <div>
            <div className="text-gray-500">待执行</div>
            <div className="text-lg font-semibold text-yellow-600">
              {stats.by_status.pending || 0}
            </div>
          </div>
          <div>
            <div className="text-gray-500">性能基线</div>
            <div className="text-lg font-semibold text-amber-600">
              {stats.total_baselines}
            </div>
          </div>
        </div>
      )}

      {/* 主体：左侧任务列表 + 右侧任务详情 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：任务列表 + 基线 */}
        <div className="w-1/2 border-r border-gray-200 flex flex-col overflow-hidden">
          {/* 过滤器 */}
          <div className="px-3 py-2 bg-white border-b border-gray-200 flex items-center gap-2 text-xs">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2 py-1 border border-gray-300 rounded"
            >
              <option value="">所有状态</option>
              <option value="pending">pending</option>
              <option value="running">running</option>
              <option value="passed">passed</option>
              <option value="failed">failed</option>
              <option value="cancelled">cancelled</option>
              <option value="blocked">blocked</option>
            </select>
            <select
              value={triggerFilter}
              onChange={(e) => setTriggerFilter(e.target.value)}
              className="px-2 py-1 border border-gray-300 rounded"
            >
              <option value="">所有触发源</option>
              <option value="manual">manual</option>
              <option value="commit">commit</option>
              <option value="pr">pr</option>
              <option value="cron">cron</option>
            </select>
            <button
              onClick={loadAll}
              className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
            >
              🔄 刷新
            </button>
            <div className="flex-1" />
            <span className="text-gray-500">
              显示 {filteredTasks.length} / {tasks.length}
            </span>
          </div>

          {/* 任务列表 */}
          <div className="flex-1 overflow-y-auto">
            {loading && tasks.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">加载中...</div>
            ) : filteredTasks.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">暂无任务</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filteredTasks.map((task) => (
                  <li
                    key={task.task_id}
                    onClick={() => setSelectedTaskId(task.task_id)}
                    className={`px-3 py-2 cursor-pointer hover:bg-gray-50 ${
                      selectedTaskId === task.task_id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{getTriggerIcon(task.trigger)}</span>
                        <span className="text-xs font-mono text-gray-600">
                          {task.commit_sha || '(no-sha)'}
                        </span>
                      </div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded border ${getStatusColor(
                          task.status,
                        )}`}
                      >
                        {task.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mb-1">
                      {task.dimensions.map((d) => (
                        <span
                          key={d}
                          className={`text-xs px-1.5 py-0.5 rounded ${getDimensionColor(
                            d,
                          )}`}
                        >
                          {d}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{task.task_id.slice(-12)}</span>
                      <span>{formatTime(task.created_at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 基线列表 */}
          {baselines.length > 0 && (
            <div className="border-t border-gray-200 bg-white">
              <div className="px-3 py-1.5 text-xs font-semibold text-gray-600 border-b border-gray-100">
                📏 性能基线 ({baselines.length})
              </div>
              <div className="max-h-32 overflow-y-auto">
                {baselines.slice(0, 5).map((bl) => (
                  <div
                    key={bl.baseline_id}
                    className="px-3 py-1 text-xs flex items-center justify-between hover:bg-gray-50"
                  >
                    <span className="font-mono text-gray-700">{bl.name}</span>
                    <span className="text-amber-600">
                      {bl.metric_value}
                      {bl.unit}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 右侧：任务详情 */}
        <div className="w-1/2 overflow-y-auto bg-white">
          {!selectedTaskId ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              ← 请选择左侧任务查看详情
            </div>
          ) : !taskDetail ? (
            <div className="p-8 text-center text-gray-400 text-sm">加载中...</div>
          ) : (
            <div className="p-4">
              {/* 任务基本信息 */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-800">任务详情</h3>
                  <span
                    className={`text-xs px-2 py-0.5 rounded border ${getStatusColor(
                      taskDetail.task.status,
                    )}`}
                  >
                    {taskDetail.task.status}
                  </span>
                </div>
                <div className="bg-gray-50 rounded p-3 text-xs space-y-1">
                  <div>
                    <span className="text-gray-500">Task ID:</span>{' '}
                    <span className="font-mono">{taskDetail.task.task_id}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Trigger:</span>{' '}
                    {getTriggerIcon(taskDetail.task.trigger)} {taskDetail.task.trigger}
                  </div>
                  <div>
                    <span className="text-gray-500">Commit SHA:</span>{' '}
                    <span className="font-mono">{taskDetail.task.commit_sha || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Project:</span>{' '}
                    <span className="font-mono">{taskDetail.task.project_path}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Created:</span>{' '}
                    {formatTime(taskDetail.task.created_at)}
                  </div>
                  {taskDetail.task.started_at && (
                    <div>
                      <span className="text-gray-500">Started:</span>{' '}
                      {formatTime(taskDetail.task.started_at)}
                    </div>
                  )}
                  {taskDetail.task.completed_at && (
                    <div>
                      <span className="text-gray-500">Completed:</span>{' '}
                      {formatTime(taskDetail.task.completed_at)}
                    </div>
                  )}
                  <div>
                    <span className="text-gray-500">Retry Count:</span>{' '}
                    {taskDetail.task.retry_count} / 3
                  </div>
                </div>
                <div className="mt-2 flex gap-2">
                  {taskDetail.task.status === 'pending' && (
                    <button
                      onClick={() => handleRunTask(taskDetail.task.task_id)}
                      className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      ▶ 立即执行
                    </button>
                  )}
                  {(taskDetail.task.status === 'pending' ||
                    taskDetail.task.status === 'running') && (
                    <button
                      onClick={() => handleCancelTask(taskDetail.task.task_id)}
                      className="px-3 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
                    >
                      ⏸ 取消
                    </button>
                  )}
                  {(taskDetail.task.status === 'failed' ||
                    taskDetail.task.status === 'blocked' ||
                    taskDetail.task.status === 'cancelled') && (
                    <button
                      onClick={() => handleRetryTask(taskDetail.task.task_id)}
                      className="px-3 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600"
                    >
                      🔁 重试
                    </button>
                  )}
                </div>
              </div>

              {/* 维度结果 */}
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-2">
                  验证结果 ({taskDetail.results.length})
                </h3>
                {taskDetail.results.length === 0 ? (
                  <div className="text-xs text-gray-400">暂无结果（任务可能未执行）</div>
                ) : (
                  <div className="space-y-2">
                    {taskDetail.results.map((r) => (
                      <div
                        key={r.result_id}
                        className="border border-gray-200 rounded p-2 text-xs"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={`px-2 py-0.5 rounded ${getDimensionColor(
                              r.dimension,
                            )}`}
                          >
                            {r.dimension}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded border ${getStatusColor(
                              r.status,
                            )}`}
                          >
                            {r.status}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-gray-600">
                          <div>
                            <div className="text-gray-400">总检查</div>
                            <div className="font-mono">{r.total_checks}</div>
                          </div>
                          <div>
                            <div className="text-gray-400">通过</div>
                            <div className="font-mono text-green-600">
                              {r.passed_checks}
                            </div>
                          </div>
                          <div>
                            <div className="text-gray-400">失败</div>
                            <div className="font-mono text-red-600">
                              {r.failed_checks}
                            </div>
                          </div>
                        </div>
                        <div className="mt-1 text-gray-500">
                          耗时: {formatDuration(r.duration_seconds)}
                        </div>
                        {r.error_details && r.error_details.length > 0 && (
                          <details className="mt-1">
                            <summary className="text-red-600 cursor-pointer">
                              错误详情 ({r.error_details.length})
                            </summary>
                            <pre className="mt-1 text-xs bg-red-50 p-2 rounded overflow-x-auto max-h-40">
                              {r.error_details.join('\n')}
                            </pre>
                          </details>
                        )}
                        {r.output && (
                          <details className="mt-1">
                            <summary className="text-gray-600 cursor-pointer">
                              完整输出
                            </summary>
                            <pre className="mt-1 text-xs bg-gray-50 p-2 rounded overflow-x-auto max-h-40">
                              {r.output}
                            </pre>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 修复记录 */}
              {taskDetail.fix_actions.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-2">
                    自动修复 ({taskDetail.fix_actions.length})
                  </h3>
                  <div className="space-y-2">
                    {taskDetail.fix_actions.map((a) => (
                      <div
                        key={a.action_id}
                        className="border border-amber-200 rounded p-2 text-xs bg-amber-50"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono text-amber-700">
                            {a.error_type}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded ${getStatusColor(
                              a.status,
                            )}`}
                          >
                            {a.status}
                          </span>
                        </div>
                        <div className="text-gray-600">
                          <div>
                            <span className="text-gray-400">Agent:</span> {a.agent_invoked}
                          </div>
                          <div>
                            <span className="text-gray-400">Strategy:</span>{' '}
                            {a.fix_strategy}
                          </div>
                          {a.result_summary && (
                            <div>
                              <span className="text-gray-400">Result:</span>{' '}
                              {a.result_summary}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 创建任务弹窗 */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[500px] p-5">
            <h3 className="text-base font-semibold text-gray-800 mb-3">新建验证任务</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">触发源</label>
                <select
                  value={formState.trigger}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, trigger: e.target.value as TriggerType }))
                  }
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                >
                  {TRIGGERS.map((t) => (
                    <option key={t} value={t}>
                      {getTriggerIcon(t)} {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Commit SHA</label>
                <input
                  type="text"
                  value={formState.commit_sha}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, commit_sha: e.target.value }))
                  }
                  placeholder="例如：abc1234"
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded font-mono"
                />
                <div className="text-xs text-gray-400 mt-1">
                  7-40 字符 hex（小写 a-f0-9），空表示 cron 任务
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">项目路径</label>
                <input
                  type="text"
                  value={formState.project_path}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, project_path: e.target.value }))
                  }
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded font-mono"
                />
                <div className="text-xs text-gray-400 mt-1">
                  必须在白名单内：/home/qizheng/auto_code_ws 或 /home/qizheng/auto_code_data
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">验证维度</label>
                <div className="space-y-1">
                  {DIMENSIONS.map((d) => (
                    <label key={d} className="flex items-start gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={formState.dimensions.includes(d)}
                        onChange={(e) =>
                          setFormState((s) => ({
                            ...s,
                            dimensions: e.target.checked
                              ? [...s.dimensions, d]
                              : s.dimensions.filter((x) => x !== d),
                          }))
                        }
                        className="mt-0.5"
                      />
                      <div>
                        <div className="font-medium text-gray-700">{d}</div>
                        <div className="text-gray-500">{DIMENSION_DESC[d]}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowCreateForm(false)}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={handleCreateTask}
                className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 创建基线弹窗 */}
      {showBaselineForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[450px] p-5">
            <h3 className="text-base font-semibold text-gray-800 mb-3">新建性能基线</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">基线名称</label>
                <input
                  type="text"
                  value={baselineForm.name}
                  onChange={(e) =>
                    setBaselineForm((s) => ({ ...s, name: e.target.value }))
                  }
                  placeholder="例如：python_list_op"
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">项目路径</label>
                <input
                  type="text"
                  value={baselineForm.project_path}
                  onChange={(e) =>
                    setBaselineForm((s) => ({ ...s, project_path: e.target.value }))
                  }
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">指标名</label>
                  <input
                    type="text"
                    value={baselineForm.metric_name}
                    onChange={(e) =>
                      setBaselineForm((s) => ({ ...s, metric_name: e.target.value }))
                    }
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">单位</label>
                  <input
                    type="text"
                    value={baselineForm.unit}
                    onChange={(e) =>
                      setBaselineForm((s) => ({ ...s, unit: e.target.value }))
                    }
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">指标值</label>
                <input
                  type="number"
                  step="0.01"
                  value={baselineForm.metric_value}
                  onChange={(e) =>
                    setBaselineForm((s) => ({
                      ...s,
                      metric_value: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Commit SHA（可选）</label>
                <input
                  type="text"
                  value={baselineForm.commit_sha}
                  onChange={(e) =>
                    setBaselineForm((s) => ({ ...s, commit_sha: e.target.value }))
                  }
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded font-mono"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowBaselineForm(false)}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={handleCreateBaseline}
                className="px-3 py-1.5 text-sm bg-amber-500 text-white rounded hover:bg-amber-600"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Webhook 触发弹窗 */}
      {showWebhookForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[400px] p-5">
            <h3 className="text-base font-semibold text-gray-800 mb-3">触发 Webhook</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">事件类型</label>
                <select
                  value={webhookForm.event}
                  onChange={(e) =>
                    setWebhookForm((s) => ({
                      ...s,
                      event: e.target.value as 'push' | 'pull_request',
                    }))
                  }
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                >
                  <option value="push">push</option>
                  <option value="pull_request">pull_request</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Commit SHA</label>
                <input
                  type="text"
                  value={webhookForm.commit_sha}
                  onChange={(e) =>
                    setWebhookForm((s) => ({ ...s, commit_sha: e.target.value }))
                  }
                  placeholder="例如：abc1234"
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded font-mono"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowWebhookForm(false)}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={handleTriggerWebhook}
                className="px-3 py-1.5 text-sm bg-purple-500 text-white rounded hover:bg-purple-600"
              >
                触发
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VerificationPanel;
