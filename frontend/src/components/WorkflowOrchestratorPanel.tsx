/**
 * # ============================================================
 * # WorkflowOrchestratorPanel - 工作流编排面板 (v1.0.0 Cycle 35 G35-01)
 * # ============================================================
 * # 核心作用：提供工作流编排引擎的可视化管理界面
 * # 功能：
 * #   - 工作流定义列表（预置 + 自定义）
 * #   - 工作流实例管理（创建 / 启动 / 取消）
 * #   - 节点状态监控
 * #   - 执行图可视化
 * #   - 工作流统计
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 35 G35-01 初次创建
 * # ============================================================
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  WorkflowOrchestratorEngine,
  getDefaultWorkflowOrchestratorEngine,
  type WorkflowDefinition,
  type WorkflowInstance,
  type ExecutionGraph,
  type WorkflowNode,
  type WorkflowEdge,
} from '../utils/workflowOrchestratorEngine';

export interface WorkflowOrchestratorPanelProps {
  engine?: WorkflowOrchestratorEngine;
  isOpen?: boolean;
  onClose?: () => void;
}

type TabKey = 'workflows' | 'instances' | 'graph' | 'stats';

export const WorkflowOrchestratorPanel: React.FC<WorkflowOrchestratorPanelProps> = ({
  engine: engineProp,
  isOpen,
  onClose,
}) => {

  // G60-FIX-13: 面板关闭时早返回，避免在 DOM 中堆积所有面板
  if (isOpen === false) return null;
  const engine = useMemo(
    () => engineProp || getDefaultWorkflowOrchestratorEngine(),
    [engineProp],
  );
  const [tab, setTab] = useState<TabKey>('workflows');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);

  // 订阅引擎事件
  useEffect(() => {
    const events = [
      'workflow-registered',
      'instance-created',
      'instance-started',
      'instance-completed',
      'instance-failed',
      'node-completed',
    ];
    const unsubs = events.map((evt) =>
      engine.on(evt as any, () => setRefreshKey((k) => k + 1)),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [engine]);

  const workflows = useMemo(
    () => engine.listWorkflows(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, refreshKey],
  );
  const instances = useMemo(
    () => engine.listInstances(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, refreshKey],
  );
  const stats = useMemo(
    () => engine.getStats(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, refreshKey],
  );

  return (
    <div
      className="workflow-orchestrator-panel"
      data-testid="workflow-orchestrator-panel"
    >
      <div className="panel-header flex items-center justify-between p-4 border-b border-surface-200">
        <h2 className="text-lg font-semibold">🔀 工作流编排 (Workflow Orchestrator)</h2>
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
        <span>📋 定义: {stats.workflows}</span>
        <span>🟢 运行中: {stats.instances.running}</span>
        <span>✅ 已完成: {stats.instances.completed}</span>
        <span>❌ 失败: {stats.instances.failed}</span>
        <span>📊 节点总数: {stats.totalNodes}</span>
      </div>

      <div className="panel-tabs flex border-b border-surface-200">
        {(['workflows', 'instances', 'graph', 'stats'] as TabKey[]).map((k) => (
          <button
            key={k}
            className={`px-4 py-2 text-sm ${
              tab === k
                ? 'border-b-2 border-blue-500 text-blue-600 font-medium'
                : 'text-surface-600 hover:text-surface-900'
            }`}
            onClick={() => setTab(k)}
            data-testid={`tab-${k}`}
          >
            {k === 'workflows' && '工作流'}
            {k === 'instances' && '实例'}
            {k === 'graph' && '执行图'}
            {k === 'stats' && '统计'}
          </button>
        ))}
      </div>

      <div className="panel-body p-4 overflow-y-auto" style={{ maxHeight: '60vh' }}>
        {tab === 'workflows' && (
          <WorkflowsTab
            engine={engine}
            workflows={workflows}
            onCreateInstance={(defId) => {
              const inst = engine.createInstance(defId, {});
              setSelectedInstanceId(inst.id);
            }}
          />
        )}
        {tab === 'instances' && (
          <InstancesTab
            engine={engine}
            instances={instances}
            selectedInstanceId={selectedInstanceId}
            onSelect={setSelectedInstanceId}
          />
        )}
        {tab === 'graph' && (
          <GraphTab
            engine={engine}
            instanceId={selectedInstanceId}
            onSelect={setSelectedInstanceId}
          />
        )}
        {tab === 'stats' && <StatsTab stats={stats} />}
      </div>
    </div>
  );
};

// ============ Workflows Tab ============

const WorkflowsTab: React.FC<{
  engine: WorkflowOrchestratorEngine;
  workflows: WorkflowDefinition[];
  onCreateInstance: (defId: string) => void;
}> = ({ engine, workflows, onCreateInstance }) => {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('New Workflow');
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [edges, setEdges] = useState<WorkflowEdge[]>([]);

  const handleAddNode = () => {
    setNodes((prev) => [
      ...prev,
      {
        id: `node-${Date.now()}-${prev.length}`,
        type: 'tool',
        name: `Node ${prev.length + 1}`,
        config: { handler: 'default' },
      },
    ]);
  };

  const handleCreate = () => {
    const finalNodes = nodes.length > 0 ? nodes : [
      { id: 'n1', type: 'tool' as const, name: 'Start', config: { handler: 'default' } },
      { id: 'n2', type: 'tool' as const, name: 'End', config: { handler: 'default' } },
    ];
    const finalEdges = edges.length > 0 ? edges : [
      { id: 'e1', source: 'n1', target: 'n2', type: 'default' as const },
    ];
    const wf = engine.registerWorkflow({
      id: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      description: 'Custom workflow',
      version: '1.0.0',
      nodes: finalNodes,
      edges: finalEdges,
      entryPoint: finalNodes[0].id,
      metadata: {},
    });
    onCreateInstance(wf.id);
    setShowCreate(false);
    setNodes([]);
    setEdges([]);
  };

  return (
    <div className="workflows-tab">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-medium">工作流定义 ({workflows.length})</h3>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
          data-testid="btn-create-workflow"
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
            placeholder="工作流名称"
            data-testid="input-workflow-name"
          />
          <div className="flex gap-2 mb-2">
            <button
              onClick={handleAddNode}
              className="px-2 py-1 text-xs bg-surface-200 hover:bg-surface-300 rounded"
            >
              + 节点
            </button>
            <span className="text-xs text-surface-500 self-center">
              节点: {nodes.length}
            </span>
          </div>
          <button
            onClick={handleCreate}
            className="w-full px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
            data-testid="btn-submit-workflow"
          >
            创建
          </button>
        </div>
      )}

      <div className="space-y-2" data-testid="workflow-list">
        {workflows.map((wf) => (
          <div
            key={wf.id}
            className="border border-surface-200 rounded p-3 bg-white"
            data-testid={`workflow-item-${wf.id}`}
          >
            <div className="flex justify-between items-start">
              <div>
                <div className="font-medium">{wf.name}</div>
                <div className="text-xs text-surface-500">
                  {wf.nodes.length} 节点 · {wf.edges.length} 边 · v{wf.version}
                </div>
              </div>
              <button
                onClick={() => onCreateInstance(wf.id)}
                className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                data-testid={`btn-run-workflow-${wf.id}`}
              >
                ▶ 运行
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============ Instances Tab ============

const InstancesTab: React.FC<{
  engine: WorkflowOrchestratorEngine;
  instances: WorkflowInstance[];
  selectedInstanceId: string | null;
  onSelect: (id: string) => void;
}> = ({ engine, instances, selectedInstanceId, onSelect }) => {
  const handleStart = async (id: string) => {
    await engine.startInstance(id);
  };

  const handleCancel = (id: string) => {
    engine.cancelInstance(id);
  };

  return (
    <div className="instances-tab">
      <h3 className="font-medium mb-3">工作流实例 ({instances.length})</h3>
      <div className="space-y-2" data-testid="instance-list">
        {instances.length === 0 && (
          <div className="text-sm text-surface-500 text-center py-4">
            暂无实例，请先创建工作流并运行
          </div>
        )}
        {instances.map((inst) => {
          const totalNodes = Object.keys(inst.nodeStates).length;
          const completedNodes = Object.values(inst.nodeStates).filter(
            (n) => n.status === 'completed',
          ).length;
          return (
          <div
            key={inst.id}
            className={`border rounded p-3 cursor-pointer ${
              selectedInstanceId === inst.id
                ? 'border-blue-500 bg-blue-50'
                : 'border-surface-200 bg-white'
            }`}
            onClick={() => onSelect(inst.id)}
            data-testid={`instance-item-${inst.id}`}
          >
            <div className="flex justify-between items-start">
              <div>
                <div className="font-medium text-sm">{inst.id.slice(0, 16)}...</div>
                <div className="text-xs text-surface-500">
                  状态: {inst.status} · 进度: {completedNodes}/{totalNodes}
                </div>
              </div>
              <div className="flex gap-1">
                {inst.status === 'pending' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStart(inst.id);
                    }}
                    className="px-2 py-1 text-xs bg-green-500 text-white rounded"
                  >
                    启动
                  </button>
                )}
                {(inst.status === 'running' || inst.status === 'pending') && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCancel(inst.id);
                    }}
                    className="px-2 py-1 text-xs bg-red-500 text-white rounded"
                  >
                    取消
                  </button>
                )}
              </div>
            </div>
            <div className="mt-2 w-full bg-surface-200 rounded-full h-1.5">
              <div
                className="bg-blue-500 h-1.5 rounded-full"
                style={{
                  width: `${totalNodes > 0 ? (completedNodes / totalNodes) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
};

// ============ Graph Tab ============

const GraphTab: React.FC<{
  engine: WorkflowOrchestratorEngine;
  instanceId: string | null;
  onSelect: (id: string) => void;
}> = ({ engine, instanceId, onSelect }) => {
  const [graph, setGraph] = useState<ExecutionGraph | null>(null);

  useEffect(() => {
    if (instanceId) {
      const g = engine.getExecutionGraph(instanceId);
      setGraph(g || null);
    } else {
      setGraph(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, engine]);

  const instances = useMemo(() => engine.listInstances(), [engine]);

  return (
    <div className="graph-tab">
      <div className="mb-3">
        <label className="text-sm font-medium mr-2">选择实例:</label>
        <select
          className="px-2 py-1 text-sm border border-surface-300 rounded"
          value={instanceId || ''}
          onChange={(e) => onSelect(e.target.value)}
          data-testid="select-instance"
        >
          <option value="">-- 请选择 --</option>
          {instances.map((inst) => (
            <option key={inst.id} value={inst.id}>
              {inst.id.slice(0, 16)}... ({inst.status})
            </option>
          ))}
        </select>
      </div>

      {graph ? (
        <div className="graph-container border border-surface-200 rounded p-3 bg-surface-50" data-testid="execution-graph">
          <h4 className="text-sm font-medium mb-2">执行图: {instanceId?.slice(0, 16)}...</h4>
          <div className="space-y-1">
            {graph.nodes.map((node) => (
              <div
                key={node.id}
                className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
                  node.status === 'completed'
                    ? 'bg-green-100'
                    : node.status === 'running'
                    ? 'bg-blue-100'
                    : node.status === 'failed'
                    ? 'bg-red-100'
                    : 'bg-surface-100'
                }`}
                data-testid={`graph-node-${node.id}`}
              >
                <span className="font-mono">[{node.id.slice(0, 8)}]</span>
                <span>{node.label}</span>
                <span className="ml-auto">{node.status}</span>
              </div>
            ))}
          </div>
          {graph.edges.length > 0 && (
            <div className="mt-3 text-xs text-surface-600">
              边数: {graph.edges.length}
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-surface-500 text-center py-8 border border-dashed border-surface-300 rounded">
          请选择一个工作流实例以查看执行图
        </div>
      )}
    </div>
  );
};

// ============ Stats Tab ============

const StatsTab: React.FC<{ stats: ReturnType<WorkflowOrchestratorEngine['getStats']> }> = ({ stats }) => {
  return (
    <div className="stats-tab space-y-3" data-testid="stats-tab">
      <div className="border border-surface-200 rounded p-3">
        <h4 className="font-medium mb-2">📋 工作流统计</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>总定义数: <span className="font-mono">{stats.workflows}</span></div>
          <div>总节点数: <span className="font-mono">{stats.totalNodes}</span></div>
        </div>
      </div>
      <div className="border border-surface-200 rounded p-3">
        <h4 className="font-medium mb-2">⚡ 实例统计</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>总实例: <span className="font-mono">{stats.instances.total}</span></div>
          <div>运行中: <span className="font-mono">{stats.instances.running}</span></div>
          <div>已完成: <span className="font-mono">{stats.instances.completed}</span></div>
          <div>失败: <span className="font-mono">{stats.instances.failed}</span></div>
          <div>暂停: <span className="font-mono">{stats.instances.paused}</span></div>
          <div>取消: <span className="font-mono">{stats.instances.cancelled}</span></div>
          <div>成功率: <span className="font-mono">
            {stats.instances.total > 0
              ? ((stats.instances.completed / stats.instances.total) * 100).toFixed(1)
              : 0}
            %
          </span></div>
        </div>
      </div>
    </div>
  );
};

export default WorkflowOrchestratorPanel;
