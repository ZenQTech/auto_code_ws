/**
 * DynamicWorkflowPanel - 动态工作流面板 (v1.0.0 Cycle 30 G30-02)
 *
 * 核心作用：实现 Codex Dynamic Workflows 风格的 Phase-based 编排 UI
 * 三个 Tab：模板 / 运行 / 日志
 *
 * 运行流程：
 *   1. Templates Tab: 浏览内置模板 (Pipeline/Fan-out/Review-Repair) + 创建自定义
 *   2. Runs Tab: 工作流实例列表 + 启动/暂停/恢复/重放/取消
 *   3. Journal Tab: 执行日志时间线
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  getDefaultDynamicWorkflowEngine,
  type WorkflowDefinition,
  type WorkflowInstance,
  type WorkflowStatus,
  type JournalEntry,
} from '../utils/dynamicWorkflowEngine';

interface DynamicWorkflowPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'templates' | 'runs' | 'journal';

export const DynamicWorkflowPanel: React.FC<DynamicWorkflowPanelProps> = ({ isOpen, onClose }) => {
  const engine = useMemo(() => getDefaultDynamicWorkflowEngine(), []);
  const [activeTab, setActiveTab] = useState<Tab>('templates');
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    if (!isOpen) return;
    setWorkflows(engine.listWorkflows());
    setInstances(engine.listInstances());
  }, [isOpen, refreshKey, engine]);

  useEffect(() => {
    if (selectedInstance) {
      setJournal(engine.getJournal(selectedInstance));
    } else {
      setJournal([]);
    }
  }, [selectedInstance, refreshKey, engine]);

  const handleStart = async (workflowId: string) => {
    await engine.startAndWait(workflowId, { initialInput: {} });
    refresh();
  };

  const handlePause = (instanceId: string) => {
    engine.pause(instanceId);
    refresh();
  };

  const handleResume = (instanceId: string) => {
    engine.resume(instanceId);
    refresh();
  };

  const handleReplay = (instanceId: string) => {
    const inst = engine.getInstance(instanceId);
    if (inst) {
      const phaseIds = Object.keys(inst.phaseStates);
      if (phaseIds.length > 0) {
        engine.replay(instanceId, phaseIds[0]);
      }
    }
    refresh();
  };

  const handleCancel = (instanceId: string) => {
    engine.cancel(instanceId);
    refresh();
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    const id = 'wf-custom-' + Date.now().toString(36);
    const noopExecute = async () => ({
      success: true,
      status: 'success' as const,
      output: {},
      durationMs: 0,
      retries: 0,
    });
    engine.registerWorkflow({
      id,
      name: newName,
      description: newDesc || '自定义工作流',
      version: '1.0.0',
      phases: [
        {
          id: 'p1',
          name: 'Phase 1',
          type: 'execute',
          description: '执行阶段1',
          dependsOn: [],
          contract: {},
          execute: noopExecute,
          retryBudget: 1,
        },
        {
          id: 'p2',
          name: 'Phase 2',
          type: 'execute',
          description: '执行阶段2',
          dependsOn: ['p1'],
          contract: {},
          execute: noopExecute,
          retryBudget: 1,
        },
      ],
      metadata: { tag: 'custom' },
    });
    setShowCreate(false);
    setNewName('');
    setNewDesc('');
    refresh();
  };

  const getStatusColor = (status: WorkflowStatus) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-700';
      case 'running': return 'bg-blue-100 text-blue-700';
      case 'failed': return 'bg-red-100 text-red-700';
      case 'paused': return 'bg-yellow-100 text-yellow-700';
      case 'cancelled': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const getJournalIcon = (status: string) => {
    switch (status) {
      case 'completed': return '✅';
      case 'failed': return '❌';
      case 'running': return '▶️';
      case 'paused': return '⏸️';
      case 'pending': return '⏳';
      case 'skipped': return '⏭';
      case 'retrying': return '🔄';
      case 'malformed': return '⚠️';
      default: return '📝';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⚙️</span>
            <h2 className="text-lg font-semibold text-gray-800">动态工作流</h2>
            <span className="text-xs text-gray-500">Phase 编排 · Journaled · Resume/Replay</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-xl">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-4">
          {[
            { key: 'templates', label: `模板 (${workflows.length})` },
            { key: 'runs', label: `运行 (${instances.length})` },
            { key: 'journal', label: '日志' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as Tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 ${
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'templates' && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button
                  onClick={() => setShowCreate(true)}
                  className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  + 创建自定义
                </button>
              </div>

              {showCreate && (
                <div className="p-3 bg-blue-50 rounded border border-blue-200">
                  <h3 className="text-sm font-medium text-gray-800 mb-2">创建自定义工作流</h3>
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="工作流名称"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                    <textarea
                      placeholder="工作流描述"
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                      rows={2}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                    <div className="flex gap-2">
                      <button onClick={handleCreate} className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600">
                        创建
                      </button>
                      <button onClick={() => setShowCreate(false)} className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
                        取消
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {workflows.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">暂无可用工作流</p>
              ) : (
                workflows.map((w) => (
                  <div key={w.id} className="p-3 bg-white rounded border border-gray-200">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-800">{w.name}</span>
                          <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                            v{w.version}
                          </span>
                          {w.parallelGroups && w.parallelGroups.length > 0 && (
                            <span className="px-1.5 py-0.5 text-xs bg-purple-100 text-purple-600 rounded">parallel</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mt-1">{w.description}</p>
                        <p className="text-xs text-gray-500 mt-1">{w.phases.length} phases</p>
                      </div>
                      <button
                        onClick={() => handleStart(w.id)}
                        className="px-3 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600"
                      >
                        ▶ 启动
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'runs' && (
            <div className="space-y-2">
              {instances.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">暂无运行实例</p>
              ) : (
                instances
                  .sort((a, b) => b.startedAt - a.startedAt)
                  .map((inst) => (
                    <div key={inst.id} className="p-3 bg-white rounded border border-gray-200">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-800">{inst.definitionSnapshot?.name || inst.definitionId}</span>
                            <span className={`px-2 py-0.5 text-xs rounded font-medium ${getStatusColor(inst.status)}`}>
                              {inst.status.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {new Date(inst.startedAt).toLocaleString()}
                            {inst.completedAt && ` → ${new Date(inst.completedAt).toLocaleString()}`}
                          </p>
                          {/* Phase progress */}
                          <div className="mt-2 flex gap-1 flex-wrap">
                            {Object.values(inst.phaseStates).map((p) => (
                              <span
                                key={p.phaseId}
                                className={`px-1.5 py-0.5 text-xs rounded ${
                                  p.status === 'completed'
                                    ? 'bg-green-100 text-green-700'
                                    : p.status === 'failed'
                                    ? 'bg-red-100 text-red-700'
                                    : p.status === 'running'
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-gray-100 text-gray-500'
                                }`}
                              >
                                {p.phaseId}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 ml-2">
                          {inst.status === 'running' && (
                            <button
                              onClick={() => handlePause(inst.id)}
                              className="px-2 py-1 text-xs bg-yellow-500 text-white rounded hover:bg-yellow-600"
                            >
                              ⏸ 暂停
                            </button>
                          )}
                          {inst.status === 'paused' && (
                            <button
                              onClick={() => handleResume(inst.id)}
                              className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                            >
                              ▶ 恢复
                            </button>
                          )}
                          {(inst.status === 'completed' || inst.status === 'failed') && (
                            <button
                              onClick={() => handleReplay(inst.id)}
                              className="px-2 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600"
                            >
                              🔄 重放
                            </button>
                          )}
                          {(inst.status === 'running' || inst.status === 'paused') && (
                            <button
                              onClick={() => handleCancel(inst.id)}
                              className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                            >
                              ✕ 取消
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setSelectedInstance(inst.id);
                              setActiveTab('journal');
                            }}
                            className="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                          >
                            📜 日志
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
              )}
            </div>
          )}

          {activeTab === 'journal' && (
            <div className="space-y-2">
              {selectedInstance ? (
                <>
                  <div className="flex justify-between items-center">
                    <h3 className="text-sm font-medium text-gray-700">执行日志: {selectedInstance}</h3>
                    <button
                      onClick={() => setSelectedInstance(null)}
                      className="text-xs text-blue-500 hover:underline"
                    >
                      ← 返回实例列表
                    </button>
                  </div>
                  {journal.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-8">暂无日志</p>
                  ) : (
                    <div className="space-y-1">
                      {journal.map((entry, i) => (
                        <div key={i} className="flex items-start gap-2 p-2 bg-gray-50 rounded text-xs">
                          <span className="text-base">{getJournalIcon(entry.status)}</span>
                          <div className="flex-1">
                            <div className="font-medium text-gray-800">{entry.status}</div>
                            <div className="text-gray-600">phase: {entry.phaseId}</div>
                            <div className="text-gray-500">{new Date(entry.timestamp).toLocaleString()}</div>
                            {entry.error && (
                              <div className="text-red-600 mt-1">⚠ {entry.error}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-500 text-center py-8">请先在「运行」中选择一个实例</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-4 py-2 text-xs text-gray-500 flex justify-between">
          <span>动态工作流引擎 v1.0.0 · Cycle 30 G30-02</span>
          <span>💡 Pipeline · Fan-out · Review-Repair-Validate</span>
        </div>
      </div>
    </div>
  );
};

export default DynamicWorkflowPanel;
