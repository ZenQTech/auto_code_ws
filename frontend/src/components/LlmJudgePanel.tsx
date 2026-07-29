/**
 * # ============================================================
 * LlmJudgePanel - LLM-as-Judge 验证层管理面板 (v1.0.0 - Cycle 13 P1-2)
 * # ============================================================
 * 核心作用：可视化展示 LLM-as-Judge 完整状态（5 维度评分 + 多 Judge 共识
 *           + Safety 一票否决 + Judge 模型池），支持任务提交/查询/取消
 * 运行流程：
 *   1. 挂载时拉取统计 + 健康检查 + 任务列表 + Judge 列表
 *   2. 用户提交 Judge 任务 → 同步执行 → 展示 5 维度评分结果
 *   3. 任务详情面板显示：每个 Judge 报告 + 共识结果 + 改进建议
 *   4. Judge 管理：注册/启停/列表
 *   5. 统计信息：任务状态分布 + Judge 池状态
 * 输入参数：
 *   - onClose?: 关闭回调
 *   - standalone?: 是否独立页面模式
 * 输出结果：完整的 React 组件
 * 创建日期：2026-07-28
 * 模块版本：v1.0.0
 * ============================================================
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  cancelTask,
  fetchHealth,
  fetchStats,
  getTask,
  listJudges,
  listTasks,
  registerJudge,
  setJudgeEnabled,
  submitTask,
  type ConsensusStrategy,
  type Difficulty,
  type Domain,
  type AdapterType,
  type JudgeInfo,
  type JudgeStats,
  type JudgeTask,
  type JudgeTaskStatus,
  ALL_DIMENSIONS,
  CONSENSUS_STRATEGIES,
  DIFFICULTIES,
  DOMAINS,
  ADAPTERS,
  getDimensionColor,
  getStatusColor,
} from '../hooks/useLlmJudgeApi';
import { useToast } from '../hooks/useToast';

type ViewMode = 'submit' | 'tasks' | 'pool' | 'stats';

const LlmJudgePanel: React.FC<{ onClose?: () => void; standalone?: boolean }> = ({
  onClose,
}) => {
  const toast = useToast();
  const notify = {
    success: (msg: string) => toast.showToast(msg, 'success'),
    error: (msg: string) => toast.showToast(msg, 'error'),
    info: (msg: string) => toast.showToast(msg, 'info'),
  };

  const [viewMode, setViewMode] = useState<ViewMode>('submit');
  const [health, setHealth] = useState<any>(null);
  const [stats, setStats] = useState<JudgeStats | null>(null);
  const [tasks, setTasks] = useState<JudgeTask[]>([]);
  const [judges, setJudges] = useState<JudgeInfo[]>([]);
  const [selectedTask, setSelectedTask] = useState<JudgeTask | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 表单状态
  const [formTaskDescription, setFormTaskDescription] = useState('');
  const [formCodeDiff, setFormCodeDiff] = useState('');
  const [formTestResults, setFormTestResults] = useState('');
  const [formDifficulty, setFormDifficulty] = useState<Difficulty>('medium');
  const [formDomain, setFormDomain] = useState<Domain>('general');
  const [formUseConsensus, setFormUseConsensus] = useState(true);
  const [formConsensusStrategy, setFormConsensusStrategy] =
    useState<ConsensusStrategy>('weighted_average');
  const [formTags, setFormTags] = useState('');

  // Judge 注册表单
  const [showRegister, setShowRegister] = useState(false);
  const [regName, setRegName] = useState('');
  const [regModel, setRegModel] = useState('');
  const [regAdapter, setRegAdapter] = useState<AdapterType>('mock');
  const [regSpecialties, setRegSpecialties] = useState('');
  const [regWeight, setRegWeight] = useState(1.0);

  // 过滤
  const [statusFilter, setStatusFilter] = useState<JudgeTaskStatus | ''>('');

  // ============================================================
  // 数据加载
  // ============================================================
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, s, t, j] = await Promise.all([
        fetchHealth(),
        fetchStats(),
        listTasks(statusFilter || undefined, 50),
        listJudges(false),
      ]);
      setHealth(h);
      setStats(s.data);
      setTasks(t.tasks);
      setJudges(j.judges);
    } catch (e: any) {
      setError(e.message);
      notify.error(`加载失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, notify]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ============================================================
  // 操作
  // ============================================================
  const handleSubmit = useCallback(async () => {
    if (!formTaskDescription.trim()) {
      notify.error('请填写任务描述');
      return;
    }
    if (!formCodeDiff.trim()) {
      notify.error('请填写代码 Diff');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await submitTask({
        task_description: formTaskDescription,
        code_diff: formCodeDiff,
        test_results: formTestResults,
        difficulty: formDifficulty,
        domain: formDomain,
        use_consensus: formUseConsensus,
        consensus_strategy: formConsensusStrategy,
        tags: formTags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        execute_sync: true,
      });
      setSelectedTask(result.task);
      notify.success('任务提交成功');
      setViewMode('tasks');
      await loadAll();
    } catch (e: any) {
      setError(e.message);
      notify.error(`提交失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [
    formTaskDescription,
    formCodeDiff,
    formTestResults,
    formDifficulty,
    formDomain,
    formUseConsensus,
    formConsensusStrategy,
    formTags,
    loadAll,
    notify,
  ]);

  const handleCancel = useCallback(
    async (taskId: string) => {
      try {
        await cancelTask(taskId);
        notify.success('已取消');
        await loadAll();
      } catch (e: any) {
        notify.error(`取消失败: ${e.message}`);
      }
    },
    [loadAll, notify]
  );

  const handleViewTask = useCallback(
    async (taskId: string) => {
      try {
        const r = await getTask(taskId);
        setSelectedTask(r.task);
      } catch (e: any) {
        notify.error(`加载任务失败: ${e.message}`);
      }
    },
    [notify]
  );

  const handleRegisterJudge = useCallback(async () => {
    if (!regName.trim() || !regModel.trim()) {
      notify.error('请填写名称和模型');
      return;
    }
    try {
      await registerJudge({
        name: regName,
        model: regModel,
        adapter: regAdapter,
        weight: regWeight,
        specialties: regSpecialties
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      notify.success('注册成功');
      setShowRegister(false);
      setRegName('');
      setRegModel('');
      setRegSpecialties('');
      setRegWeight(1.0);
      await loadAll();
    } catch (e: any) {
      notify.error(`注册失败: ${e.message}`);
    }
  }, [regName, regModel, regAdapter, regSpecialties, regWeight, loadAll, notify]);

  const handleToggleJudge = useCallback(
    async (judgeId: string, enabled: boolean) => {
      try {
        await setJudgeEnabled(judgeId, enabled);
        notify.success(enabled ? '已启用' : '已禁用');
        await loadAll();
      } catch (e: any) {
        notify.error(`操作失败: ${e.message}`);
      }
    },
    [loadAll, notify]
  );

  // ============================================================
  // 渲染
  // ============================================================
  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* 顶部工具栏 */}
      <div className="p-3 bg-white border-b border-gray-200 flex items-center gap-2 flex-wrap">
        <h2 className="text-base font-semibold text-gray-800 mr-2">
          ⚖️ LLM-as-Judge
        </h2>
        <button
          onClick={() => setViewMode('submit')}
          className={`px-3 py-1.5 text-sm rounded ${
            viewMode === 'submit'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          提交评分
        </button>
        <button
          onClick={() => setViewMode('tasks')}
          className={`px-3 py-1.5 text-sm rounded ${
            viewMode === 'tasks'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          任务列表 ({tasks.length})
        </button>
        <button
          onClick={() => setViewMode('pool')}
          className={`px-3 py-1.5 text-sm rounded ${
            viewMode === 'pool'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Judge 池 ({judges.length})
        </button>
        <button
          onClick={() => setViewMode('stats')}
          className={`px-3 py-1.5 text-sm rounded ${
            viewMode === 'stats'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          统计
        </button>
        <div className="flex-1" />
        <button
          onClick={loadAll}
          disabled={loading}
          className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
        >
          {loading ? '加载中…' : '🔄 刷新'}
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            ✕ 关闭
          </button>
        )}
      </div>

      {/* 健康状态卡片 */}
      {health && (
        <div className="p-3 bg-blue-50 border-b border-blue-200 text-sm">
          <span className="text-blue-800">
            🟢 服务健康 · v{health.version} · Judge 总数 {health.total_judges} · 启用{' '}
            {health.enabled_judges}
          </span>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border-b border-red-200 text-sm text-red-700">
          ❌ {error}
        </div>
      )}

      {/* 主体内容 */}
      <div className="flex-1 overflow-auto p-4">
        {viewMode === 'submit' && (
          <SubmitView
            formTaskDescription={formTaskDescription}
            setFormTaskDescription={setFormTaskDescription}
            formCodeDiff={formCodeDiff}
            setFormCodeDiff={setFormCodeDiff}
            formTestResults={formTestResults}
            setFormTestResults={setFormTestResults}
            formDifficulty={formDifficulty}
            setFormDifficulty={setFormDifficulty}
            formDomain={formDomain}
            setFormDomain={setFormDomain}
            formUseConsensus={formUseConsensus}
            setFormUseConsensus={setFormUseConsensus}
            formConsensusStrategy={formConsensusStrategy}
            setFormConsensusStrategy={setFormConsensusStrategy}
            formTags={formTags}
            setFormTags={setFormTags}
            onSubmit={handleSubmit}
            loading={loading}
            selectedTask={selectedTask}
          />
        )}

        {viewMode === 'tasks' && (
          <TasksView
            tasks={tasks}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            onView={handleViewTask}
            onCancel={handleCancel}
            selectedTask={selectedTask}
            onClose={() => setSelectedTask(null)}
          />
        )}

        {viewMode === 'pool' && (
          <PoolView
            judges={judges}
            onRegister={() => setShowRegister(true)}
            onToggle={handleToggleJudge}
            showRegister={showRegister}
            onCloseRegister={() => setShowRegister(false)}
            regName={regName}
            setRegName={setRegName}
            regModel={regModel}
            setRegModel={setRegModel}
            regAdapter={regAdapter}
            setRegAdapter={setRegAdapter}
            regSpecialties={regSpecialties}
            setRegSpecialties={setRegSpecialties}
            regWeight={regWeight}
            setRegWeight={setRegWeight}
            onSubmitRegister={handleRegisterJudge}
          />
        )}

        {viewMode === 'stats' && stats && <StatsView stats={stats} />}
      </div>
    </div>
  );
};

// ============================================================
// 子视图
// ============================================================

interface SubmitViewProps {
  formTaskDescription: string;
  setFormTaskDescription: (s: string) => void;
  formCodeDiff: string;
  setFormCodeDiff: (s: string) => void;
  formTestResults: string;
  setFormTestResults: (s: string) => void;
  formDifficulty: Difficulty;
  setFormDifficulty: (d: Difficulty) => void;
  formDomain: Domain;
  setFormDomain: (d: Domain) => void;
  formUseConsensus: boolean;
  setFormUseConsensus: (b: boolean) => void;
  formConsensusStrategy: ConsensusStrategy;
  setFormConsensusStrategy: (s: ConsensusStrategy) => void;
  formTags: string;
  setFormTags: (s: string) => void;
  onSubmit: () => void;
  loading: boolean;
  selectedTask: JudgeTask | null;
}

const SubmitView: React.FC<SubmitViewProps> = ({
  formTaskDescription,
  setFormTaskDescription,
  formCodeDiff,
  setFormCodeDiff,
  formTestResults,
  setFormTestResults,
  formDifficulty,
  setFormDifficulty,
  formDomain,
  setFormDomain,
  formUseConsensus,
  setFormUseConsensus,
  formConsensusStrategy,
  setFormConsensusStrategy,
  formTags,
  setFormTags,
  onSubmit,
  loading,
  selectedTask,
}) => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <div className="bg-white rounded border border-gray-200 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-700">📝 评分表单</h3>

      <div>
        <label className="block text-xs text-gray-600 mb-1">任务描述 *</label>
        <textarea
          value={formTaskDescription}
          onChange={(e) => setFormTaskDescription(e.target.value)}
          rows={2}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded font-mono"
          placeholder="例: 实现用户登录接口的密码加密逻辑"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-600 mb-1">代码 Diff *</label>
        <textarea
          value={formCodeDiff}
          onChange={(e) => setFormCodeDiff(e.target.value)}
          rows={6}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded font-mono"
          placeholder={`+ def hash_password(pwd: str) -> str:\n+     return bcrypt.hashpw(pwd.encode(), bcrypt.gensalt())`}
        />
      </div>

      <div>
        <label className="block text-xs text-gray-600 mb-1">测试结果（可选）</label>
        <textarea
          value={formTestResults}
          onChange={(e) => setFormTestResults(e.target.value)}
          rows={2}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded font-mono"
          placeholder="3 passed, 0 failed in 0.4s"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">难度</label>
          <select
            value={formDifficulty}
            onChange={(e) => setFormDifficulty(e.target.value as Difficulty)}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">领域</label>
          <select
            value={formDomain}
            onChange={(e) => setFormDomain(e.target.value as Domain)}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          >
            {DOMAINS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={formUseConsensus}
          onChange={(e) => setFormUseConsensus(e.target.checked)}
          id="use-consensus"
        />
        <label htmlFor="use-consensus" className="text-sm text-gray-700">
          多 Judge 共识
        </label>
      </div>

      {formUseConsensus && (
        <div>
          <label className="block text-xs text-gray-600 mb-1">共识策略</label>
          <select
            value={formConsensusStrategy}
            onChange={(e) => setFormConsensusStrategy(e.target.value as ConsensusStrategy)}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          >
            {CONSENSUS_STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-600 mb-1">标签（逗号分隔）</label>
        <input
          type="text"
          value={formTags}
          onChange={(e) => setFormTags(e.target.value)}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          placeholder="auth, security, backend"
        />
      </div>

      <button
        onClick={onSubmit}
        disabled={loading}
        className="w-full px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? '提交中…' : '🚀 提交评分任务'}
      </button>
    </div>

    <div>
      {selectedTask ? (
        <TaskDetailCard task={selectedTask} />
      ) : (
        <div className="bg-white rounded border border-gray-200 p-8 text-center text-sm text-gray-500">
          提交评分任务后，结果将显示在此处
        </div>
      )}
    </div>
  </div>
);

interface TasksViewProps {
  tasks: JudgeTask[];
  statusFilter: JudgeTaskStatus | '';
  setStatusFilter: (s: JudgeTaskStatus | '') => void;
  onView: (id: string) => void;
  onCancel: (id: string) => void;
  selectedTask: JudgeTask | null;
  onClose: () => void;
}

const TasksView: React.FC<TasksViewProps> = ({
  tasks,
  statusFilter,
  setStatusFilter,
  onView,
  onCancel,
  selectedTask,
  onClose,
}) => {
  const filtered = statusFilter
    ? tasks.filter((t) => t.status === statusFilter)
    : tasks;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="space-y-2">
        <div className="flex gap-2 items-center">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as JudgeTaskStatus | '')}
            className="px-2 py-1 text-sm border border-gray-300 rounded"
          >
            <option value="">全部状态</option>
            <option value="pending">pending</option>
            <option value="running">running</option>
            <option value="completed">completed</option>
            <option value="failed">failed</option>
            <option value="vetoed">vetoed</option>
            <option value="cancelled">cancelled</option>
          </select>
          <span className="text-sm text-gray-600">共 {filtered.length} 个任务</span>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white rounded border border-gray-200 p-8 text-center text-sm text-gray-500">
            暂无任务
          </div>
        ) : (
          filtered.map((t) => (
            <div
              key={t.task_id}
              className={`p-3 bg-white rounded border cursor-pointer transition ${
                selectedTask?.task_id === t.task_id
                  ? 'border-blue-500 ring-2 ring-blue-200'
                  : 'border-gray-200 hover:border-blue-300'
              }`}
              onClick={() => onView(t.task_id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`px-2 py-0.5 text-xs rounded border ${getStatusColor(
                        t.status
                      )}`}
                    >
                      {t.status}
                    </span>
                    <span className="text-xs text-gray-500">{t.difficulty}</span>
                    <span className="text-xs text-gray-500">·</span>
                    <span className="text-xs text-gray-500">{t.domain}</span>
                    {t.consensus && t.consensus.safety_veto && (
                      <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded">
                        ⚠️ Safety Veto
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-800 truncate">
                    {t.task_description}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {t.created_at.substring(0, 19)}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  {t.status === 'pending' || t.status === 'running' ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCancel(t.task_id);
                      }}
                      className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      取消
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div>
        {selectedTask ? (
          <div>
            <div className="flex justify-end mb-2">
              <button
                onClick={onClose}
                className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                ✕ 关闭
              </button>
            </div>
            <TaskDetailCard task={selectedTask} />
          </div>
        ) : (
          <div className="bg-white rounded border border-gray-200 p-8 text-center text-sm text-gray-500">
            点击任务查看详情
          </div>
        )}
      </div>
    </div>
  );
};

interface PoolViewProps {
  judges: JudgeInfo[];
  onRegister: () => void;
  onToggle: (id: string, enabled: boolean) => void;
  showRegister: boolean;
  onCloseRegister: () => void;
  regName: string;
  setRegName: (s: string) => void;
  regModel: string;
  setRegModel: (s: string) => void;
  regAdapter: AdapterType;
  setRegAdapter: (a: AdapterType) => void;
  regSpecialties: string;
  setRegSpecialties: (s: string) => void;
  regWeight: number;
  setRegWeight: (n: number) => void;
  onSubmitRegister: () => void;
}

const PoolView: React.FC<PoolViewProps> = ({
  judges,
  onRegister,
  onToggle,
  showRegister,
  onCloseRegister,
  regName,
  setRegName,
  regModel,
  setRegModel,
  regAdapter,
  setRegAdapter,
  regSpecialties,
  setRegSpecialties,
  regWeight,
  setRegWeight,
  onSubmitRegister,
}) => (
  <div className="space-y-3">
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-600">共 {judges.length} 个 Judge</span>
      <button
        onClick={onRegister}
        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        ➕ 注册 Judge
      </button>
    </div>

    {showRegister && (
      <div className="bg-white rounded border border-blue-300 p-4 space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold text-gray-700">📋 注册新 Judge</h3>
          <button
            onClick={onCloseRegister}
            className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded"
          >
            ✕
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">名称 *</label>
            <input
              type="text"
              value={regName}
              onChange={(e) => setRegName(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
              placeholder="claude-sonnet-judge"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">模型 *</label>
            <input
              type="text"
              value={regModel}
              onChange={(e) => setRegModel(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
              placeholder="claude-sonnet-4.5"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Adapter</label>
            <select
              value={regAdapter}
              onChange={(e) => setRegAdapter(e.target.value as AdapterType)}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
            >
              {ADAPTERS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">权重 (0-2)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={regWeight}
              onChange={(e) => setRegWeight(parseFloat(e.target.value))}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">专长（逗号分隔）</label>
          <input
            type="text"
            value={regSpecialties}
            onChange={(e) => setRegSpecialties(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
            placeholder="security, backend, performance"
          />
        </div>
        <button
          onClick={onSubmitRegister}
          className="w-full px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          注册
        </button>
      </div>
    )}

    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {judges.map((j) => (
        <div
          key={j.judge_id}
          className={`p-3 bg-white rounded border ${
            j.enabled ? 'border-green-300' : 'border-gray-300'
          }`}
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-800 truncate">
                {j.name}
              </div>
              <div className="text-xs text-gray-500 truncate">{j.model}</div>
            </div>
            <span
              className={`px-2 py-0.5 text-xs rounded ${
                j.enabled
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {j.enabled ? '启用' : '禁用'}
            </span>
          </div>
          <div className="space-y-1 text-xs text-gray-600">
            <div>Adapter: {j.adapter}</div>
            <div>权重: {j.weight}</div>
            <div>运行: {j.total_runs} / 失败: {j.total_failures}</div>
            <div>平均延迟: {j.avg_latency_ms.toFixed(0)} ms</div>
            {j.specialties.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {j.specialties.map((s, i) => (
                  <span
                    key={i}
                    className="px-1.5 py-0.5 text-xs bg-blue-50 text-blue-700 rounded"
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => onToggle(j.judge_id, !j.enabled)}
            className={`w-full mt-2 px-2 py-1 text-xs rounded ${
              j.enabled
                ? 'bg-red-100 text-red-700 hover:bg-red-200'
                : 'bg-green-100 text-green-700 hover:bg-green-200'
            }`}
          >
            {j.enabled ? '禁用' : '启用'}
          </button>
        </div>
      ))}
    </div>
  </div>
);

const StatsView: React.FC<{ stats: JudgeStats }> = ({ stats }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div className="bg-white rounded border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">🤖 Judge 池</h3>
      <div className="space-y-2">
        <StatRow label="总 Judge 数" value={stats.pool_stats.total_judges} />
        <StatRow label="启用数" value={stats.pool_stats.enabled_judges} />
        <div>
          <div className="text-xs text-gray-600 mb-1">按 Adapter</div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(stats.pool_stats.adapters || {}).map(([k, v]) => (
              <span
                key={k}
                className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded"
              >
                {k}: {v}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>

    <div className="bg-white rounded border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">📊 任务统计</h3>
      <div className="space-y-2">
        <StatRow label="总任务数" value={stats.store_stats.total_tasks} />
        <StatRow
          label="共识数"
          value={stats.store_stats.consensus_count}
          color="text-green-600"
        />
        <StatRow
          label="Vetoed 数"
          value={stats.store_stats.vetoed_count}
          color="text-red-600"
        />
        <div>
          <div className="text-xs text-gray-600 mb-1">按状态</div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(stats.store_stats.by_status || {}).map(([k, v]) => (
              <span
                key={k}
                className={`px-2 py-0.5 text-xs rounded border ${getStatusColor(k)}`}
              >
                {k}: {v}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
);

const StatRow: React.FC<{ label: string; value: any; color?: string }> = ({
  label,
  value,
  color = 'text-gray-800',
}) => (
  <div className="flex justify-between items-center">
    <span className="text-xs text-gray-600">{label}</span>
    <span className={`text-sm font-semibold ${color}`}>{value}</span>
  </div>
);

const TaskDetailCard: React.FC<{ task: JudgeTask }> = ({ task }) => (
  <div className="bg-white rounded border border-gray-200 p-4 space-y-3">
    <div>
      <h3 className="text-sm font-semibold text-gray-700">📋 任务详情</h3>
      <div className="text-xs text-gray-500 mt-1">ID: {task.task_id}</div>
    </div>

    <div>
      <div className="text-xs text-gray-600 mb-1">任务描述</div>
      <div className="text-sm text-gray-800 bg-gray-50 p-2 rounded">
        {task.task_description}
      </div>
    </div>

    <div className="grid grid-cols-3 gap-2 text-xs">
      <div>
        <div className="text-gray-500">难度</div>
        <div className="font-medium">{task.difficulty}</div>
      </div>
      <div>
        <div className="text-gray-500">领域</div>
        <div className="font-medium">{task.domain}</div>
      </div>
      <div>
        <div className="text-gray-500">共识</div>
        <div className="font-medium">{task.use_consensus ? '是' : '否'}</div>
      </div>
    </div>

    {task.tags.length > 0 && (
      <div>
        <div className="text-xs text-gray-600 mb-1">标签</div>
        <div className="flex flex-wrap gap-1">
          {task.tags.map((t, i) => (
            <span
              key={i}
              className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    )}

    {task.code_diff && (
      <details className="text-xs">
        <summary className="cursor-pointer text-gray-600 hover:text-gray-800">
          📄 代码 Diff
        </summary>
        <pre className="mt-1 p-2 bg-gray-50 rounded font-mono text-xs overflow-auto max-h-40">
          {task.code_diff}
        </pre>
      </details>
    )}

    {task.consensus && (
      <div className="border-t pt-3">
        <h4 className="text-sm font-semibold text-gray-700 mb-2">
          🎯 共识结果
          {task.consensus.safety_veto && (
            <span className="ml-2 px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded">
              ⚠️ Safety Veto
            </span>
          )}
        </h4>
        <div className="mb-2">
          <span
            className={`px-3 py-1 text-sm rounded ${
              task.consensus.overall_pass
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700'
            }`}
          >
            {task.consensus.overall_pass ? '✅ 通过' : '❌ 未通过'} · 分数{' '}
            {task.consensus.overall_score.toFixed(1)}
          </span>
          {task.consensus.needs_review && (
            <span className="ml-2 px-2 py-0.5 text-xs bg-yellow-100 text-yellow-700 rounded">
              ⚠️ 需要审查
            </span>
          )}
        </div>

        <div className="grid grid-cols-5 gap-2">
          {ALL_DIMENSIONS.map((dim) => {
            const score = task.consensus!.aggregated_scores[dim];
            return (
              <div
                key={dim}
                className={`p-2 rounded border text-center ${getDimensionColor(score)}`}
              >
                <div className="text-xs capitalize">{dim}</div>
                <div className="text-lg font-bold">{score}</div>
              </div>
            );
          })}
        </div>

        {Object.keys(task.consensus.divergence).length > 0 && (
          <div className="mt-2">
            <div className="text-xs text-gray-600 mb-1">分歧度</div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(task.consensus.divergence).map(([k, v]) => (
                <span
                  key={k}
                  className={`px-2 py-0.5 text-xs rounded ${
                    v > 3
                      ? 'bg-red-50 text-red-700'
                      : v > 1
                      ? 'bg-yellow-50 text-yellow-700'
                      : 'bg-green-50 text-green-700'
                  }`}
                >
                  {k}: {typeof v === 'number' ? v.toFixed(1) : v}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    )}

    {task.reports && task.reports.length > 0 && (
      <div className="border-t pt-3">
        <h4 className="text-sm font-semibold text-gray-700 mb-2">
          👥 Judge 报告 ({task.reports.length})
        </h4>
        {task.reports.map((r) => (
          <div
            key={r.report_id}
            className="p-2 bg-gray-50 rounded mb-2 text-xs"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium">{r.judge_name || r.judge_id}</span>
              <span
                className={`px-1.5 py-0.5 rounded ${
                  r.overall_pass
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700'
                }`}
              >
                {r.overall_score.toFixed(1)}
              </span>
            </div>
            {r.issues.length > 0 && (
              <div className="text-red-600">⚠ {r.issues.join('; ')}</div>
            )}
            {r.suggestions.length > 0 && (
              <div className="text-blue-600">💡 {r.suggestions.join('; ')}</div>
            )}
            <div className="text-gray-500 mt-1">
              延迟: {r.latency_ms}ms
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

export default LlmJudgePanel;
