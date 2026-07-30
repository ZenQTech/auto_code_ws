/**
 * # ============================================================
 * # Nested Sub-Agent Panel - 嵌套子代理 UI 组件 (v1.0.0 Cycle 27 G27-01)
 * # ============================================================
 * # 核心作用：提供嵌套子代理引擎的图形化管理界面
 * # 主要功能：
 * #   1. 树形视图展示代理层级结构
 * #   2. 创建/启动/暂停/恢复/取消代理
 * #   3. 时间线视图展示事件流
 * #   4. 详情面板展示节点属性
 * #   5. 统计信息面板
 * #   6. 导入/导出树
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 27 G27-01 初次创建
 * # ============================================================
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getDefaultNestedSubAgentEngine,
  NestedSubAgentEngine,
} from '../utils/nestedSubAgentEngine';
import {
  SubAgentNode,
  SubAgentConfig,
  AgentRole,
  ModelChoice,
  ReasoningEffort,
  ROLE_METADATA,
  STATUS_METADATA,
  MODEL_METADATA,
  REASONING_METADATA,
  isValidPathSegment,
} from '../utils/nestedSubAgentTypes';

interface NestedSubAgentPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type ViewMode = 'tree' | 'timeline' | 'stats';

export function NestedSubAgentPanel({ isOpen, onClose }: NestedSubAgentPanelProps) {
  const engine = useMemo(() => getDefaultNestedSubAgentEngine(), []);
  const [, forceUpdate] = useState(0);
  const refresh = useCallback(() => forceUpdate((n) => n + 1), []);

  // 视图模式
  const [view, setView] = useState<ViewMode>('tree');
  // 选中节点
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  // 创建对话框
  const [showCreateRoot, setShowCreateRoot] = useState(false);
  const [showCreateChild, setShowCreateChild] = useState(false);
  // 事件历史
  const [events, setEvents] = useState<Array<{
    timestamp: number;
    type: string;
    agentPath: string;
    message: string;
  }>>([]);

  // 订阅所有事件
  useEffect(() => {
    if (!isOpen) return;
    const eventTypes = [
      'agent-created', 'agent-started', 'agent-completed', 'agent-failed',
      'agent-timed-out', 'agent-paused', 'agent-resumed', 'agent-cancelled',
      'task-started', 'task-completed', 'task-failed', 'tree-restored',
      'depth-limit-reached', 'cycle-detected', 'context-compacted',
    ] as const;
    const offs: Array<() => void> = [];
    for (const type of eventTypes) {
      const off = engine.on(type as any, (e) => {
        setEvents((prev) => [
          {
            timestamp: e.timestamp,
            type: e.type,
            agentPath: e.agentPath,
            message: formatEventMessage(e),
          },
          ...prev,
        ].slice(0, 200));
        refresh();
      });
      offs.push(off);
    }
    return () => offs.forEach((off) => off());
  }, [isOpen, engine, refresh]);

  // 快捷键
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showCreateRoot) setShowCreateRoot(false);
        else if (showCreateChild) setShowCreateChild(false);
        else onClose();
      } else if (e.ctrlKey && e.key === '1') {
        e.preventDefault();
        setView('tree');
      } else if (e.ctrlKey && e.key === '2') {
        e.preventDefault();
        setView('timeline');
      } else if (e.ctrlKey && e.key === '3') {
        e.preventDefault();
        setView('stats');
      } else if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setShowCreateRoot(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, showCreateRoot, showCreateChild, onClose]);

  if (!isOpen) return null;

  const stats = engine.getStats();
  const selectedNode = selectedUuid ? engine.getAgent(selectedUuid) : null;

  return (
    <div
      data-testid="nested-sub-agent-panel"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        data-testid="nested-sub-agent-content"
        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-7xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🪆</span>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              嵌套子代理引擎
            </h2>
            <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs font-mono">
              v1.0.0
            </span>
            <span className="text-xs text-slate-500">
              总 {stats.totalAgents} | 完成 {stats.totalCompleted} | 失败 {stats.totalFailed}
            </span>
          </div>
          <button
            data-testid="close-btn"
            onClick={onClose}
            className="px-3 py-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-lg"
          >
            ✕
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between p-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <div className="flex gap-2">
            <button
              data-testid="view-tree-btn"
              onClick={() => setView('tree')}
              className={`px-3 py-1 text-sm rounded ${
                view === 'tree'
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              🌲 树形
            </button>
            <button
              data-testid="view-timeline-btn"
              onClick={() => setView('timeline')}
              className={`px-3 py-1 text-sm rounded ${
                view === 'timeline'
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              📜 时间线 ({events.length})
            </button>
            <button
              data-testid="view-stats-btn"
              onClick={() => setView('stats')}
              className={`px-3 py-1 text-sm rounded ${
                view === 'stats'
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              📊 统计
            </button>
          </div>
          <div className="flex gap-2">
            <button
              data-testid="create-root-btn"
              onClick={() => setShowCreateRoot(true)}
              className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600"
            >
              ➕ 创建根
            </button>
            <button
              data-testid="create-child-btn"
              onClick={() => selectedUuid && setShowCreateChild(true)}
              disabled={!selectedUuid}
              className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              ➕ 创建子
            </button>
            <button
              data-testid="export-btn"
              onClick={() => handleExport(engine)}
              className="px-3 py-1 text-sm bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-300"
            >
              📤 导出
            </button>
            <button
              data-testid="clear-btn"
              onClick={() => {
                if (confirm('确定清空所有节点？')) {
                  engine.clear();
                  setSelectedUuid(null);
                  setEvents([]);
                  refresh();
                }
              }}
              className="px-3 py-1 text-sm bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded hover:bg-red-200"
            >
              🗑️ 清空
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex">
          {/* Main Content */}
          <div className="flex-1 overflow-auto p-4">
            {view === 'tree' && (
              <TreeView
                engine={engine}
                selectedUuid={selectedUuid}
                onSelect={setSelectedUuid}
              />
            )}
            {view === 'timeline' && (
              <TimelineView events={events} />
            )}
            {view === 'stats' && (
              <StatsView stats={stats} engine={engine} />
            )}
          </div>

          {/* Detail Panel */}
          {selectedNode && (
            <div className="w-96 border-l border-slate-200 dark:border-slate-700 p-4 overflow-auto bg-slate-50 dark:bg-slate-800/30">
              <DetailPanel
                node={selectedNode}
                engine={engine}
                onUpdate={refresh}
                onDeselect={() => setSelectedUuid(null)}
              />
            </div>
          )}
        </div>

        {/* Create Root Dialog */}
        {showCreateRoot && (
          <CreateAgentDialog
            isRoot
            onClose={() => setShowCreateRoot(false)}
            onSubmit={(config) => {
              const uuid = engine.createRootAgent(config);
              setSelectedUuid(uuid);
              setShowCreateRoot(false);
              refresh();
            }}
          />
        )}

        {/* Create Child Dialog */}
        {showCreateChild && selectedNode && (
          <CreateAgentDialog
            isRoot={false}
            parentPath={selectedNode.path}
            onClose={() => setShowCreateChild(false)}
            onSubmit={(config) => {
              try {
                const uuid = engine.createChildAgent(selectedNode.uuid, config);
                setSelectedUuid(uuid);
                setShowCreateChild(false);
                refresh();
              } catch (err) {
                alert(`创建失败: ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================
// 子组件
// ============================================================

function TreeView({
  engine,
  selectedUuid,
  onSelect,
}: {
  engine: NestedSubAgentEngine;
  selectedUuid: string | null;
  onSelect: (uuid: string) => void;
}) {
  const roots = engine.getRoots();
  if (roots.length === 0) {
    return (
      <div className="text-center text-slate-500 py-12">
        <div className="text-4xl mb-2">🪆</div>
        <p>暂无代理。点击"创建根"开始。</p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {roots.map((root) => (
        <TreeNode
          key={root.uuid}
          node={root}
          depth={0}
          engine={engine}
          selectedUuid={selectedUuid}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function TreeNode({
  node,
  depth,
  engine,
  selectedUuid,
  onSelect,
}: {
  node: SubAgentNode;
  depth: number;
  engine: NestedSubAgentEngine;
  selectedUuid: string | null;
  onSelect: (uuid: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const children = engine.getChildren(node.uuid);
  const statusMeta = STATUS_METADATA[node.status];
  const roleMeta = ROLE_METADATA[node.config.role];

  return (
    <div>
      <div
        data-testid={`tree-node-${node.uuid}`}
        className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 ${
          selectedUuid === node.uuid ? 'bg-blue-100 dark:bg-blue-900/30 ring-2 ring-blue-500' : ''
        }`}
        style={{ marginLeft: depth * 24 }}
        onClick={() => onSelect(node.uuid)}
      >
        {children.length > 0 ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="text-slate-500 text-sm w-4"
          >
            {expanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <span title={statusMeta.label}>{statusMeta.icon}</span>
        <span title={roleMeta.label} className={roleMeta.color}>{roleMeta.icon}</span>
        <span className="font-mono text-sm text-slate-700 dark:text-slate-300">{node.path}</span>
        <span className="text-xs text-slate-500">({node.config.model})</span>
        {node.currentTask && (
          <span className="text-xs text-blue-500 truncate max-w-xs">
            ⚙️ {node.currentTask.description}
          </span>
        )}
      </div>
      {expanded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.uuid}
              node={child}
              depth={depth + 1}
              engine={engine}
              selectedUuid={selectedUuid}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TimelineView({ events }: { events: Array<{ timestamp: number; type: string; agentPath: string; message: string }> }) {
  if (events.length === 0) {
    return (
      <div className="text-center text-slate-500 py-12">
        <div className="text-4xl mb-2">📜</div>
        <p>暂无事件。创建并启动代理以查看事件流。</p>
      </div>
    );
  }
  return (
    <div className="space-y-1 font-mono text-xs">
      {events.map((e, i) => (
        <div
          key={i}
          className="flex items-start gap-2 px-2 py-1 border-b border-slate-100 dark:border-slate-800"
        >
          <span className="text-slate-400 whitespace-nowrap">
            {new Date(e.timestamp).toLocaleTimeString()}
          </span>
          <span className="text-purple-500 whitespace-nowrap">[{e.type}]</span>
          <span className="text-blue-500 whitespace-nowrap">{e.agentPath}</span>
          <span className="text-slate-600 dark:text-slate-400 flex-1">{e.message}</span>
        </div>
      ))}
    </div>
  );
}

function StatsView({ stats }: { stats: ReturnType<NestedSubAgentEngine['getStats']>; engine: NestedSubAgentEngine }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
        <div className="text-xs text-slate-500 mb-1">总代理数</div>
        <div className="text-3xl font-bold text-blue-500">{stats.totalAgents}</div>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
        <div className="text-xs text-slate-500 mb-1">已完成</div>
        <div className="text-3xl font-bold text-green-500">{stats.totalCompleted}</div>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
        <div className="text-xs text-slate-500 mb-1">已失败</div>
        <div className="text-3xl font-bold text-red-500">{stats.totalFailed}</div>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
        <div className="text-xs text-slate-500 mb-1">总 Tokens</div>
        <div className="text-3xl font-bold text-purple-500">{stats.totalTokensUsed.toLocaleString()}</div>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
        <div className="text-xs text-slate-500 mb-1">最大深度</div>
        <div className="text-3xl font-bold text-orange-500">{stats.maxDepthReached}</div>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
        <div className="text-xs text-slate-500 mb-1">平均深度</div>
        <div className="text-3xl font-bold text-cyan-500">{stats.averageDepth.toFixed(2)}</div>
      </div>

      <div className="col-span-2 bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
        <h3 className="text-sm font-semibold mb-2 text-slate-700 dark:text-slate-300">按角色分布</h3>
        <div className="space-y-1">
          {Object.entries(stats.byRole).map(([role, count]) => {
            const meta = ROLE_METADATA[role as AgentRole];
            return (
              <div key={role} className="flex items-center gap-2">
                <span className="text-lg">{meta?.icon || '⚙️'}</span>
                <span className="text-sm flex-1">{meta?.label || role}</span>
                <span className="text-sm font-mono text-slate-500">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="col-span-2 bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
        <h3 className="text-sm font-semibold mb-2 text-slate-700 dark:text-slate-300">按状态分布</h3>
        <div className="space-y-1">
          {Object.entries(stats.byStatus).map(([status, count]) => {
            const meta = STATUS_METADATA[status as keyof typeof STATUS_METADATA];
            return (
              <div key={status} className="flex items-center gap-2">
                <span className="text-lg">{meta?.icon || '⚪'}</span>
                <span className="text-sm flex-1">{meta?.label || status}</span>
                <span className="text-sm font-mono text-slate-500">{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DetailPanel({
  node,
  engine,
  onUpdate,
  onDeselect,
}: {
  node: SubAgentNode;
  engine: NestedSubAgentEngine;
  onUpdate: () => void;
  onDeselect: () => void;
}) {
  const statusMeta = STATUS_METADATA[node.status];
  const roleMeta = ROLE_METADATA[node.config.role];

  const handleStart = async () => {
    const desc = prompt('请输入任务描述：', '分析当前状态');
    if (!desc) return;
    await engine.startAgent(node.uuid, { description: desc, input: desc });
    onUpdate();
  };

  const handlePause = () => {
    engine.pauseAgent(node.uuid);
    onUpdate();
  };

  const handleResume = async () => {
    await engine.resumeAgent(node.uuid);
    onUpdate();
  };

  const handleCancel = () => {
    if (confirm('确定取消该代理及其所有子代理？')) {
      engine.cancelAgent(node.uuid);
      onDeselect();
      onUpdate();
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-900 dark:text-slate-100">节点详情</h3>
        <button
          onClick={onDeselect}
          className="text-slate-500 hover:text-slate-700"
        >
          ✕
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between">
          <span className="text-slate-500">路径</span>
          <span className="font-mono text-xs">{node.path}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">角色</span>
          <span className={roleMeta.color}>{roleMeta.icon} {roleMeta.label}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">模型</span>
          <span>{MODEL_METADATA[node.config.model].label}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">推理</span>
          <span>{REASONING_METADATA[node.config.reasoningEffort].label}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">状态</span>
          <span className={statusMeta.color}>{statusMeta.icon} {statusMeta.label}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">深度</span>
          <span>{node.depth} / 3</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">完成/失败</span>
          <span className="font-mono text-xs">{node.completedTasks} / {node.failedTasks}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Tokens</span>
          <span className="font-mono text-xs">{node.tokensUsed.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Context 使用</span>
          <span className="font-mono text-xs">{(node.contextUsage * 100).toFixed(1)}%</span>
        </div>
        {node.error && (
          <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs text-red-600 dark:text-red-300">
            ⚠️ {node.error}
          </div>
        )}
      </div>

      {node.config.description && (
        <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded text-xs">
          <div className="text-slate-500 mb-1">描述</div>
          <div>{node.config.description}</div>
        </div>
      )}

      {node.config.tools.length > 0 && (
        <div>
          <div className="text-slate-500 mb-1">工具</div>
          <div className="flex flex-wrap gap-1">
            {node.config.tools.map((tool) => (
              <span
                key={tool}
                className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs"
              >
                {tool}
              </span>
            ))}
          </div>
        </div>
      )}

      {node.currentTask && (
        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-xs">
          <div className="text-slate-500 mb-1">当前任务</div>
          <div className="font-semibold">{node.currentTask.description}</div>
          {node.currentTask.output && (
            <div className="mt-1 text-slate-600 dark:text-slate-400">{node.currentTask.output}</div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        <button
          data-testid="start-btn"
          onClick={handleStart}
          disabled={node.status === 'running'}
          className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-slate-300"
        >
          ▶️ 启动
        </button>
        <button
          data-testid="pause-btn"
          onClick={handlePause}
          disabled={node.status !== 'running'}
          className="px-2 py-1 text-xs bg-yellow-500 text-white rounded hover:bg-yellow-600 disabled:bg-slate-300"
        >
          ⏸️ 暂停
        </button>
        <button
          data-testid="resume-btn"
          onClick={handleResume}
          disabled={node.status !== 'paused'}
          className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-slate-300"
        >
          ▶️ 恢复
        </button>
        <button
          data-testid="cancel-btn"
          onClick={handleCancel}
          className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
        >
          ⏹️ 取消
        </button>
      </div>

      <div className="text-xs text-slate-500 pt-2 border-t border-slate-200 dark:border-slate-700">
        <div>UUID: <span className="font-mono">{node.uuid}</span></div>
        {node.createdAt > 0 && (
          <div>创建: {new Date(node.createdAt).toLocaleString()}</div>
        )}
        {node.completedAt && (
          <div>完成: {new Date(node.completedAt).toLocaleString()}</div>
        )}
      </div>
    </div>
  );
}

function CreateAgentDialog({
  isRoot,
  parentPath,
  onClose,
  onSubmit,
}: {
  isRoot: boolean;
  parentPath?: string;
  onClose: () => void;
  onSubmit: (config: Omit<SubAgentConfig, 'id'>) => void;
}) {
  const [name, setName] = useState(isRoot ? 'root' : '');
  const [role, setRole] = useState<AgentRole>(isRoot ? 'coordinator' : 'analyzer');
  const [description, setDescription] = useState('');
  const [model, setModel] = useState<ModelChoice>('sonnet');
  const [reasoning, setReasoning] = useState<ReasoningEffort>('medium');
  const [systemPrompt, setSystemPrompt] = useState(isRoot ? '你是协调者，管理子代理的协作。' : '');
  const [tools, setTools] = useState('Read,Grep,Glob');
  const [timeoutMs, setTimeoutMs] = useState(10000);

  const nameValid = isValidPathSegment(name);

  const handleSubmit = () => {
    if (!nameValid) {
      alert('名称必须是 kebab-case 格式（仅小写字母、数字、连字符）');
      return;
    }
    onSubmit({
      name,
      role,
      description,
      model,
      reasoningEffort: reasoning,
      systemPrompt,
      tools: tools.split(',').map((t) => t.trim()).filter(Boolean),
      constraints: [],
      contextWindow: 8000,
      timeoutMs,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold mb-4 text-slate-900 dark:text-slate-100">
          {isRoot ? '创建根代理' : `创建子代理 (父: ${parentPath})`}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500">名称 (kebab-case)</label>
            <input
              data-testid="create-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
            />
            {!nameValid && name && (
              <div className="text-xs text-red-500 mt-1">名称格式无效</div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">角色</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as AgentRole)}
                className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
              >
                {Object.entries(ROLE_METADATA).map(([k, v]) => (
                  <option key={k} value={k}>{v.icon} {v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500">模型</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as ModelChoice)}
                className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
              >
                {Object.entries(MODEL_METADATA).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">推理强度</label>
            <select
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value as ReasoningEffort)}
              className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
            >
              {Object.entries(REASONING_METADATA).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">描述</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">系统提示词</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={3}
              className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 font-mono text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">工具 (逗号分隔)</label>
              <input
                type="text"
                value={tools}
                onChange={(e) => setTools(e.target.value)}
                className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">超时 (毫秒)</label>
              <input
                type="number"
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(parseInt(e.target.value, 10) || 0)}
                className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-3 py-1 text-sm bg-slate-200 dark:bg-slate-700 rounded"
          >
            取消
          </button>
          <button
            data-testid="create-submit-btn"
            onClick={handleSubmit}
            disabled={!nameValid || !name}
            className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-slate-300"
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 工具函数
// ============================================================

function formatEventMessage(event: any): string {
  const data = event.data || {};
  switch (event.type) {
    case 'agent-created':
      return `创建代理 (${data.config?.role || 'unknown'})`;
    case 'agent-started':
      return `启动任务: ${data.task?.description || ''}`;
    case 'agent-completed':
      return `完成 (${data.tokensUsed || 0} tokens)`;
    case 'agent-failed':
      return `失败: ${data.error || 'unknown'}`;
    case 'agent-timed-out':
      return `超时 (${data.timeoutMs}ms)`;
    case 'agent-paused':
      return `暂停`;
    case 'agent-resumed':
      return `恢复`;
    case 'agent-cancelled':
      return `取消`;
    case 'depth-limit-reached':
      return `达到深度限制 (尝试: ${data.attemptedPath})`;
    case 'cycle-detected':
      return `检测到循环: ${data.childName}`;
    case 'context-compacted':
      return `Context 压缩 (${data.beforeTokens} → ${data.afterTokens})`;
    default:
      return event.type;
  }
}

function handleExport(engine: NestedSubAgentEngine) {
  const data = engine.exportTree();
  if (!data || !data.rootUuid) {
    alert('无内容可导出');
    return;
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nested-sub-agent-tree-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
