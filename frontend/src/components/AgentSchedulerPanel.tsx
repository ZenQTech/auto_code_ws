/**
 * # ============================================================
 * # AgentSchedulerPanel - 智能体调度面板 (v1.0.0 Cycle 35 G35-04)
 * # ============================================================
 * # 核心作用：提供智能体调度引擎的可视化管理界面
 * # 功能：
 * #   - 任务提交与调度
 * #   - 资源池管理
 * #   - 调度策略（WFQ/MLFQ/Priority）
 * #   - 抢占控制
 * #   - 性能统计
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 35 G35-04 初次创建
 * # ============================================================
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AgentSchedulerEngine,
  getDefaultAgentSchedulerEngine,
  type SchedulableTask,
  type ResourcePool,
  type SchedulingPolicy,
  type SchedulingEvent,
  type SchedulingStats,
} from '../utils/agentSchedulerEngine';

export interface AgentSchedulerPanelProps {
  engine?: AgentSchedulerEngine;
  isOpen?: boolean;
  onClose?: () => void;
}

type TabKey = 'tasks' | 'pools' | 'policies' | 'stats';

export const AgentSchedulerPanel: React.FC<AgentSchedulerPanelProps> = ({
  engine: engineProp,
  isOpen: _isOpen,
  onClose,
}) => {
  const engine = useMemo(
    () => engineProp || getDefaultAgentSchedulerEngine(),
    [engineProp],
  );
  const [tab, setTab] = useState<TabKey>('tasks');
  const [refreshKey, setRefreshKey] = useState(0);

  // 订阅引擎事件
  useEffect(() => {
    const events = [
      'task-submitted',
      'task-started',
      'task-completed',
      'task-failed',
      'task-preempted',
      'pool-updated',
      'policy-updated',
    ];
    const unsubs = events.map((evt) =>
      engine.on(evt as any, () => setRefreshKey((k) => k + 1)),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [engine]);

  const tasks = useMemo(
    () => engine.listTasks(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, refreshKey],
  );
  const pools = useMemo(
    () => engine.listPools(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, refreshKey],
  );
  const policies = useMemo(
    () => engine.listPolicies(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, refreshKey],
  );
  const stats = useMemo(
    () => engine.getStats(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, refreshKey],
  );

  return (
    <div className="agent-scheduler-panel" data-testid="agent-scheduler-panel">
      <div className="panel-header flex items-center justify-between p-4 border-b border-surface-200">
        <h2 className="text-lg font-semibold">⚡ 智能体调度 (Agent Scheduler)</h2>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="关闭"
            className="text-2xl text-surface-500 hover:text-surface-700"
          >
            ×
          </button>
        )}
      </div>

      <div className="panel-stats flex gap-4 p-3 bg-surface-50 border-b border-surface-200 text-sm">
        <span>📋 提交: {stats.totalSubmitted}</span>
        <span>🏃 运行: {stats.currentRunning}</span>
        <span>✅ 完成: {stats.totalCompleted}</span>
        <span>❌ 失败: {stats.totalFailed}</span>
        <span>⏸ 队列: {stats.currentQueued}</span>
      </div>

      <div className="panel-controls flex items-center gap-2 p-3 border-b border-surface-200 bg-rose-50">
        <span className="text-sm font-medium">调度器:</span>
        {engine.isRunning() ? (
          <button
            onClick={() => engine.stop()}
            className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
            data-testid="btn-stop-scheduler"
          >
            ⏸ 停止
          </button>
        ) : (
          <button
            onClick={() => engine.start()}
            className="px-3 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
            data-testid="btn-start-scheduler"
          >
            ▶ 启动
          </button>
        )}
        <span className={`text-xs ml-2 ${engine.isRunning() ? 'text-green-600' : 'text-surface-500'}`}>
          {engine.isRunning() ? '运行中' : '已停止'}
        </span>
      </div>

      <div className="panel-tabs flex border-b border-surface-200">
        {(['tasks', 'pools', 'policies', 'stats'] as TabKey[]).map((k) => (
          <button
            key={k}
            className={`px-4 py-2 text-sm ${
              tab === k
                ? 'border-b-2 border-rose-500 text-rose-600 font-medium'
                : 'text-surface-600 hover:text-surface-900'
            }`}
            onClick={() => setTab(k)}
            data-testid={`tab-${k}`}
          >
            {k === 'tasks' && '任务'}
            {k === 'pools' && '资源池'}
            {k === 'policies' && '策略'}
            {k === 'stats' && '统计'}
          </button>
        ))}
      </div>

      <div className="panel-body p-4 overflow-y-auto" style={{ maxHeight: '55vh' }}>
        {tab === 'tasks' && <TasksTab engine={engine} tasks={tasks} pools={pools} />}
        {tab === 'pools' && <PoolsTab engine={engine} pools={pools} />}
        {tab === 'policies' && <PoliciesTab engine={engine} policies={policies} />}
        {tab === 'stats' && <StatsTab engine={engine} stats={stats} tasks={tasks} events={engine.listEvents()} />}
      </div>
    </div>
  );
};

// ============ Tasks Tab ============

const TasksTab: React.FC<{
  engine: AgentSchedulerEngine;
  tasks: SchedulableTask[];
  pools: ResourcePool[];
}> = ({ engine, tasks, pools }) => {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('New Task');
  const [priority, setPriority] = useState(5);
  const [poolId, setPoolId] = useState('');

  const handleCreate = () => {
    engine.submit({
      name,
      type: 'agent',
      priority: priority as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
      weight: 1,
      requirements: {
        cpu: { minCores: 1, estimatedLoadPercent: 50 },
        memory: { minMb: 256, maxMb: 1024 },
      },
      payload: {},
    });
    setShowCreate(false);
    setName('New Task');
    setPriority(5);
  };

  return (
    <div className="tasks-tab">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-medium">任务列表 ({tasks.length})</h3>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1 text-sm bg-rose-500 text-white rounded hover:bg-rose-600"
          data-testid="btn-create-task"
        >
          {showCreate ? '取消' : '+ 提交'}
        </button>
      </div>

      {showCreate && (
        <div className="create-form border border-surface-200 rounded p-3 mb-3 bg-surface-50">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-2 py-1 border border-surface-300 rounded mb-2 text-sm"
            placeholder="任务名称"
            data-testid="input-task-name"
          />
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="w-full px-2 py-1 border border-surface-300 rounded mb-2 text-sm"
            placeholder="优先级 (0-10)"
            min={0}
            max={10}
          />
          <select
            value={poolId}
            onChange={(e) => setPoolId(e.target.value)}
            className="w-full px-2 py-1 border border-surface-300 rounded mb-2 text-sm"
            data-testid="select-pool"
          >
            <option value="">默认资源池</option>
            {pools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleCreate}
            className="w-full px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
            data-testid="btn-submit-task"
          >
            提交
          </button>
        </div>
      )}

      <div className="space-y-1" data-testid="task-list">
        {tasks.length === 0 && (
          <div className="text-sm text-surface-500 text-center py-4">暂无任务</div>
        )}
        {tasks.map((t) => (
          <div
            key={t.id}
            className={`border rounded p-2 text-xs ${
              t.status === 'completed'
                ? 'border-green-200 bg-green-50'
                : t.status === 'failed'
                ? 'border-red-200 bg-red-50'
                : t.status === 'running'
                ? 'border-blue-200 bg-blue-50'
                : 'border-surface-200 bg-white'
            }`}
            data-testid={`task-item-${t.id}`}
          >
            <div className="flex justify-between items-start">
              <div>
                <div className="font-medium">{t.name}</div>
                <div className="text-surface-500">
                  状态: {t.status} · 优先级: {t.priority} · 尝试: {t.attempts}
                </div>
                {t.assignedPool && (
                  <div className="text-surface-400">资源池: {t.assignedPool}</div>
                )}
              </div>
              <div className="flex gap-1">
                {(t.status === 'pending' || t.status === 'running') && (
                  <button
                    onClick={() => engine.preempt(t.id, 'manual')}
                    className="px-2 py-0.5 text-xs bg-orange-500 text-white rounded"
                  >
                    抢占
                  </button>
                )}
                {t.status !== 'completed' && t.status !== 'failed' && t.status !== 'cancelled' && (
                  <button
                    onClick={() => engine.cancel(t.id)}
                    className="px-2 py-0.5 text-xs bg-red-500 text-white rounded"
                  >
                    取消
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============ Pools Tab ============

const PoolsTab: React.FC<{
  engine: AgentSchedulerEngine;
  pools: ResourcePool[];
}> = ({ engine, pools }) => {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('New Pool');
  const [cpu, setCpu] = useState(4);
  const [memory, setMemory] = useState(8192);

  const handleCreate = () => {
    const capacity = {
      cpu: { totalCores: cpu, availableCores: cpu, usagePercent: 0 },
      memory: { totalMb: memory, availableMb: memory },
      slots: { total: 10, available: 10 },
    };
    engine.registerPool({
      id: `pool-${Date.now()}`,
      name,
      type: 'device',
      available: capacity,
      total: capacity,
      reserved: {
        cpu: { totalCores: 0, availableCores: 0, usagePercent: 0 },
        memory: { totalMb: 0, availableMb: 0 },
        slots: { total: 0, available: 0 },
      },
      agents: [],
      load: 0,
      metadata: {},
    });
    setShowCreate(false);
    setName('New Pool');
  };

  return (
    <div className="pools-tab">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-medium">资源池 ({pools.length})</h3>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1 text-sm bg-rose-500 text-white rounded hover:bg-rose-600"
          data-testid="btn-create-pool"
        >
          {showCreate ? '取消' : '+ 新建'}
        </button>
      </div>

      {showCreate && (
        <div className="create-form border border-surface-200 rounded p-3 mb-3 bg-surface-50">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-2 py-1 border border-surface-300 rounded mb-2 text-sm"
            placeholder="资源池名"
          />
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input
              type="number"
              value={cpu}
              onChange={(e) => setCpu(Number(e.target.value))}
              className="px-2 py-1 border border-surface-300 rounded text-sm"
              placeholder="CPU 核心"
              min={1}
            />
            <input
              type="number"
              value={memory}
              onChange={(e) => setMemory(Number(e.target.value))}
              className="px-2 py-1 border border-surface-300 rounded text-sm"
              placeholder="内存 (MB)"
              min={128}
            />
          </div>
          <button
            onClick={handleCreate}
            className="w-full px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
          >
            创建
          </button>
        </div>
      )}

      <div className="space-y-2" data-testid="pool-list">
        {pools.map((p) => (
          <div
            key={p.id}
            className="border border-surface-200 rounded p-3 bg-white"
            data-testid={`pool-item-${p.id}`}
          >
            <div className="flex justify-between items-start">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-surface-500">
                  类型: {p.type} · ID: {p.id}
                </div>
                <div className="text-xs text-surface-400">
                  容量 CPU: {p.total.cpu?.totalCores || 0} · 内存: {p.total.memory?.totalMb || 0} MB
                </div>
                <div className="text-xs text-surface-400">
                  可用 CPU: {p.available.cpu?.availableCores || 0} · 内存: {p.available.memory?.availableMb || 0} MB
                </div>
                <div className="text-xs text-surface-400">
                  智能体: {p.agents.length} · 负载: {(p.load * 100).toFixed(0)}%
                </div>
              </div>
              <button
                onClick={() => engine.unregisterPool(p.id)}
                className="px-2 py-1 text-xs bg-red-500 text-white rounded"
              >
                注销
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============ Policies Tab ============

const PoliciesTab: React.FC<{
  engine: AgentSchedulerEngine;
  policies: SchedulingPolicy[];
}> = ({ engine, policies }) => {
  return (
    <div className="policies-tab space-y-2" data-testid="policy-list">
      {policies.map((p) => (
        <div
          key={p.id}
          className="border border-surface-200 rounded p-3 bg-white"
          data-testid={`policy-item-${p.id}`}
        >
          <div className="flex justify-between items-start">
            <div>
              <div className="font-medium">{p.name}</div>
              <div className="text-xs text-surface-500">算法: {p.algorithm}</div>
              <div className="text-xs text-surface-400">
                抢占: {p.preemptive ? '✓' : '✗'} · 时间片: {p.timeSliceMs || '无'}ms
              </div>
              <div className="text-xs text-surface-400">
                老化: {p.agingEnabled ? '✓' : '✗'} · 启用: {p.enabled ? '✓' : '✗'}
              </div>
            </div>
            <div>
              {p.id === engine.getActivePolicyId() ? (
                <span className="px-2 py-0.5 text-xs bg-green-500 text-white rounded">
                  活跃
                </span>
              ) : (
                <button
                  onClick={() => engine.setActivePolicy(p.id)}
                  className="px-2 py-1 text-xs bg-blue-500 text-white rounded"
                >
                  激活
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// ============ Stats Tab ============

const StatsTab: React.FC<{
  engine: AgentSchedulerEngine;
  stats: SchedulingStats;
  tasks: SchedulableTask[];
  events: SchedulingEvent[];
}> = ({ stats, tasks, events }) => {
  const running = tasks.filter((t) => t.status === 'running').length;
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;
  const pending = tasks.filter((t) => t.status === 'pending').length;
  const cancelled = tasks.filter((t) => t.status === 'cancelled').length;

  return (
    <div className="stats-tab space-y-3" data-testid="stats-tab">
      <div className="border border-surface-200 rounded p-3">
        <h4 className="font-medium mb-2">📋 任务统计</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>总任务: <span className="font-mono">{tasks.length}</span></div>
          <div>运行: <span className="font-mono">{running}</span></div>
          <div>完成: <span className="font-mono">{completed}</span></div>
          <div>失败: <span className="font-mono">{failed}</span></div>
          <div>等待: <span className="font-mono">{pending}</span></div>
          <div>取消: <span className="font-mono">{cancelled}</span></div>
          <div>被抢占: <span className="font-mono">{stats.totalPreempted}</span></div>
        </div>
      </div>
      <div className="border border-surface-200 rounded p-3">
        <h4 className="font-medium mb-2">⏱ 延迟分析</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>P50: <span className="font-mono">{stats.latencyP50.toFixed(0)}ms</span></div>
          <div>P95: <span className="font-mono">{stats.latencyP95.toFixed(0)}ms</span></div>
          <div>P99: <span className="font-mono">{stats.latencyP99.toFixed(0)}ms</span></div>
          <div>平均: <span className="font-mono">{stats.latencyAvg.toFixed(0)}ms</span></div>
          <div>最大: <span className="font-mono">{stats.latencyMax.toFixed(0)}ms</span></div>
        </div>
      </div>
      <div className="border border-surface-200 rounded p-3">
        <h4 className="font-medium mb-2">📊 资源利用率</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>CPU: <span className="font-mono">{(stats.resourceUtilization.cpu * 100).toFixed(1)}%</span></div>
          <div>内存: <span className="font-mono">{(stats.resourceUtilization.memory * 100).toFixed(1)}%</span></div>
          <div>GPU: <span className="font-mono">{(stats.resourceUtilization.gpu * 100).toFixed(1)}%</span></div>
          <div>Token: <span className="font-mono">{(stats.resourceUtilization.tokens * 100).toFixed(1)}%</span></div>
        </div>
      </div>
      <div className="border border-surface-200 rounded p-3">
        <h4 className="font-medium mb-2">📜 最近事件 ({events.length})</h4>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {events.slice(0, 20).map((e) => (
            <div key={e.id} className="text-xs flex justify-between border-b border-surface-100 pb-1">
              <span className="font-mono">{e.type}</span>
              <span className="text-surface-500">{new Date(e.timestamp).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AgentSchedulerPanel;
