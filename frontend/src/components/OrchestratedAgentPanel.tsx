/**
 * OrchestratedAgentPanel - 编排多代理面板 (v1.0.0 Cycle 30 G30-03)
 *
 * 核心作用：实现 Codex Orchestrated Mode 风格的 6 阶段多代理协作 UI
 * 三个 Tab：构建任务 / 任务列表 / 角色管理
 *
 * 运行流程：
 *   1. Build Tab: 输入 userTurn + 选择路径 (Direct/Reviewed) + 启动编排
 *   2. Tasks Tab: 任务列表 + 阶段进度时间线 + Synthesis
 *   3. Roles Tab: 查看/编辑 Worker/Explorer/Reviewer/Synthesizer 角色配置
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  getDefaultOrchestratedAgentEngine,
  type OrchestratedTask,
  type ExecutionPath,
  type AgentRole,
  type PhaseStatus,
} from '../utils/orchestratedAgentEngine';

interface OrchestratedAgentPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'build' | 'tasks' | 'roles';

const ROLE_LABELS: Record<AgentRole, { name: string; icon: string; desc: string }> = {
  orchestrator: { name: 'Orchestrator', icon: '🎯', desc: '根编排器' },
  worker: { name: 'Worker', icon: '🔨', desc: '实现型' },
  explorer: { name: 'Explorer', icon: '🔍', desc: '只读探索' },
  reviewer: { name: 'Reviewer', icon: '🛡️', desc: '审查型' },
  synthesizer: { name: 'Synthesizer', icon: '✨', desc: '合成型' },
};

export const OrchestratedAgentPanel: React.FC<OrchestratedAgentPanelProps> = ({ isOpen, onClose }) => {
  const engine = useMemo(() => getDefaultOrchestratedAgentEngine(), []);
  const [activeTab, setActiveTab] = useState<Tab>('build');
  const [userTurn, setUserTurn] = useState<string>('实现一个 CSV 数据导入功能');
  const [forcePath, setForcePath] = useState<ExecutionPath | 'auto'>('reviewed');
  const [skipExplorer, setSkipExplorer] = useState<boolean>(false);
  const [autoApprovePlan, setAutoApprovePlan] = useState<boolean>(true);
  const [running, setRunning] = useState(false);
  const [tasks, setTasks] = useState<OrchestratedTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [roles, setRoles] = useState<AgentRole[]>([]);
  const [editingRole, setEditingRole] = useState<AgentRole | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    if (!isOpen) return;
    setTasks(engine.listTasks());
    setRoles(engine.listRoles());
  }, [isOpen, refreshKey, engine]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId),
    [tasks, selectedTaskId]
  );

  const handleRun = async () => {
    if (!userTurn.trim()) return;
    setRunning(true);
    try {
      const task = await engine.orchestrate(userTurn, {
        forcePath: forcePath === 'auto' ? undefined : forcePath,
        skipExplorer,
        autoApprovePlan,
      });
      setSelectedTaskId(task.id);
      setActiveTab('tasks');
    } finally {
      setRunning(false);
      refresh();
    }
  };

  const handleApprovePlan = (taskId: string) => {
    engine.approvePlan(taskId, 'worker-plan', 'user', 'approved via panel');
    refresh();
  };

  const handleRejectPlan = (taskId: string) => {
    engine.rejectPlan(taskId, 'worker-plan', 'user', ['rejected via panel']);
    refresh();
  };

  const getPhaseStatusColor = (status: PhaseStatus) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-700';
      case 'running': return 'bg-blue-100 text-blue-700';
      case 'failed': return 'bg-red-100 text-red-700';
      case 'malformed': return 'bg-orange-100 text-orange-700';
      case 'retrying': return 'bg-yellow-100 text-yellow-700';
      case 'skipped': return 'bg-gray-100 text-gray-500';
      default: return 'bg-gray-100 text-gray-400';
    }
  };

  const getTaskStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-700';
      case 'running': return 'bg-blue-100 text-blue-700';
      case 'failed': return 'bg-red-100 text-red-700';
      case 'paused': return 'bg-yellow-100 text-yellow-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎼</span>
            <h2 className="text-lg font-semibold text-gray-800">编排多代理引擎</h2>
            <span className="text-xs text-gray-500">6 阶段 · Worker/Explorer/Reviewer/Synthesizer</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-xl">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-4">
          {[
            { key: 'build', label: '构建任务' },
            { key: 'tasks', label: `任务列表 (${tasks.length})` },
            { key: 'roles', label: `角色管理 (${roles.length})` },
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
          {activeTab === 'build' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  任务描述 (userTurn)
                </label>
                <textarea
                  value={userTurn}
                  onChange={(e) => setUserTurn(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="例如：实现用户登录 API"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">执行路径</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: 'auto', label: '自动选择', desc: '基于 scope + evidence' },
                    { value: 'direct', label: 'Direct', desc: 'Worker → Synthesizer (2 phase)' },
                    { value: 'reviewed', label: 'Reviewed', desc: '完整 6 阶段流程' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setForcePath(opt.value as any)}
                      className={`p-2 text-left border rounded ${
                        forcePath === opt.value
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      <div className="text-sm font-medium text-gray-800">{opt.label}</div>
                      <div className="text-xs text-gray-500">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={skipExplorer}
                    onChange={(e) => setSkipExplorer(e.target.checked)}
                  />
                  跳过 Explorer 阶段（适用于明确任务）
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={autoApprovePlan}
                    onChange={(e) => setAutoApprovePlan(e.target.checked)}
                  />
                  自动批准 Plan（Reviewed 路径）
                </label>
              </div>

              <button
                onClick={handleRun}
                disabled={running || !userTurn.trim()}
                className="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white text-sm font-medium rounded hover:from-blue-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {running ? '⏳ 编排执行中...' : '🚀 启动编排'}
              </button>

              <div className="mt-4 p-3 bg-gray-50 rounded border border-gray-200 text-xs text-gray-600">
                <p className="font-medium text-gray-700 mb-1">📋 流程说明</p>
                <p><strong>Direct 路径:</strong> Worker 执行 → Synthesizer 合成（2 阶段）</p>
                <p><strong>Reviewed 路径:</strong> Explorer → Worker Plan → Plan Review → Worker Execute → Result Review → Synthesizer（6 阶段）</p>
                <p className="mt-1 text-gray-500">每阶段支持自动重试、Contract 验证、Packet 检查</p>
              </div>
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="space-y-3">
              {tasks.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">暂无任务</p>
              ) : (
                <>
                  <div className="space-y-2">
                    {tasks
                      .sort((a, b) => b.createdAt - a.createdAt)
                      .map((task) => (
                        <div
                          key={task.id}
                          onClick={() => setSelectedTaskId(task.id)}
                          className={`p-3 rounded border cursor-pointer ${
                            selectedTaskId === task.id
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 bg-white hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-800">{task.userTurn}</span>
                                <span className={`px-2 py-0.5 text-xs rounded font-medium ${getTaskStatusColor(task.status)}`}>
                                  {task.status.toUpperCase()}
                                </span>
                                <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                                  {task.path}
                                </span>
                              </div>
                              <p className="text-xs text-gray-500 mt-1">
                                {new Date(task.createdAt).toLocaleString()} · {task.phases.length} phases
                                {task.totalRetries > 0 && ` · ${task.totalRetries} retries`}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>

                  {selectedTask && (
                    <div className="mt-4 p-3 bg-white border border-gray-300 rounded">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="text-sm font-medium text-gray-800">任务详情: {selectedTask.id}</h3>
                        <button
                          onClick={() => setSelectedTaskId(null)}
                          className="text-xs text-blue-500 hover:underline"
                        >
                          关闭
                        </button>
                      </div>

                      {/* Phase timeline */}
                      <div className="space-y-1">
                        {selectedTask.phases.map((p) => (
                          <div key={p.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded text-xs">
                            <span className="font-mono text-gray-600 w-32">{p.id}</span>
                            <span className={`px-2 py-0.5 rounded text-xs ${getPhaseStatusColor(p.status)}`}>
                              {p.status}
                            </span>
                            <span className="text-gray-500">role: {p.role}</span>
                            {p.durationMs !== undefined && (
                              <span className="text-gray-500">{p.durationMs}ms</span>
                            )}
                            {p.currentRetries > 0 && (
                              <span className="text-orange-600">retries: {p.currentRetries}</span>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Plan approval buttons */}
                      {selectedTask.path === 'reviewed' && (() => {
                        const planPhase = selectedTask.phases.find((p) => p.id === 'worker-plan');
                        if (!planPhase) return null;
                        const planPacket = planPhase.packet as any;
                        if (planPacket && !planPacket.approved && planPhase.status === 'completed') {
                          return (
                            <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs flex gap-2">
                              <span className="flex-1">📋 Plan 等待审批</span>
                              <button
                                onClick={() => handleApprovePlan(selectedTask.id)}
                                className="px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600"
                              >
                                批准
                              </button>
                              <button
                                onClick={() => handleRejectPlan(selectedTask.id)}
                                className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                              >
                                拒绝
                              </button>
                            </div>
                          );
                        }
                        return null;
                      })()}

                      {/* Synthesis */}
                      {selectedTask.rootSynthesis && (
                        <div className="mt-3 p-3 bg-gray-50 rounded text-xs">
                          <h4 className="font-medium text-gray-700 mb-1">📝 Root Synthesis</h4>
                          <pre className="whitespace-pre-wrap text-gray-700">{selectedTask.rootSynthesis}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'roles' && (
            <div className="space-y-3">
              {editingRole ? (
                <RoleEditor
                  role={editingRole}
                  engine={engine}
                  onClose={() => {
                    setEditingRole(null);
                    refresh();
                  }}
                />
              ) : (
                <>
                  {roles.map((role) => {
                    const config = engine.getRole(role);
                    return (
                      <div key={role} className="p-3 bg-white border border-gray-200 rounded">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xl">{ROLE_LABELS[role].icon}</span>
                              <span className="text-sm font-medium text-gray-800">{ROLE_LABELS[role].name}</span>
                              <span className="text-xs text-gray-500">{ROLE_LABELS[role].desc}</span>
                            </div>
                            <div className="mt-2 text-xs text-gray-600 space-y-1">
                              <p><strong>模型:</strong> {config.model}</p>
                              <p><strong>沙箱:</strong> {config.sandboxMode}</p>
                              <p><strong>隔离:</strong> {config.isolation}</p>
                              <p><strong>工具:</strong> {config.allowedTools.join(', ')}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => setEditingRole(role)}
                            className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                          >
                            ✏️ 编辑
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-4 py-2 text-xs text-gray-500 flex justify-between">
          <span>编排多代理引擎 v1.0.0 · Cycle 30 G30-03</span>
          <span>💡 Direct/Reviewed · Phase Contract · Worker Packet</span>
        </div>
      </div>
    </div>
  );
};

// ============ 角色编辑器 ============
const RoleEditor: React.FC<{
  role: AgentRole;
  engine: ReturnType<typeof getDefaultOrchestratedAgentEngine>;
  onClose: () => void;
}> = ({ role, engine, onClose }) => {
  const config = engine.getRole(role);
  const [model, setModel] = useState(config.model);
  const [sandboxMode, setSandboxMode] = useState(config.sandboxMode);
  const [isolation, setIsolation] = useState(config.isolation);
  const [allowedTools, setAllowedTools] = useState(config.allowedTools.join(', '));
  const [systemPrompt, setSystemPrompt] = useState(config.systemPrompt);

  const handleSave = () => {
    engine.registerRole({
      ...config,
      model,
      sandboxMode,
      isolation,
      allowedTools: allowedTools.split(',').map((t) => t.trim()).filter(Boolean),
      systemPrompt,
    });
    onClose();
  };

  return (
    <div className="p-3 bg-blue-50 border border-blue-200 rounded">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm font-medium text-gray-800">
          {ROLE_LABELS[role].icon} {ROLE_LABELS[role].name} - 编辑
        </h3>
        <button onClick={onClose} className="text-xs text-blue-500 hover:underline">取消</button>
      </div>
      <div className="space-y-2">
        <div>
          <label className="text-xs text-gray-600">模型</label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-600">沙箱模式</label>
            <select
              value={sandboxMode}
              onChange={(e) => setSandboxMode(e.target.value as any)}
              className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
            >
              <option value="read-only">read-only</option>
              <option value="workspace-write">workspace-write</option>
              <option value="full">full</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600">隔离模式</label>
            <select
              value={isolation}
              onChange={(e) => setIsolation(e.target.value as any)}
              className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
            >
              <option value="thread">thread</option>
              <option value="worktree">worktree</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-600">允许工具 (逗号分隔)</label>
          <input
            type="text"
            value={allowedTools}
            onChange={(e) => setAllowedTools(e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-600">系统提示词</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={3}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
          />
        </div>
        <button
          onClick={handleSave}
          className="w-full px-3 py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
        >
          💾 保存
        </button>
      </div>
    </div>
  );
};

export default OrchestratedAgentPanel;
