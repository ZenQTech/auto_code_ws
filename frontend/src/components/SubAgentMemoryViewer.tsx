/**
 * # ============================================================
 * SubAgentMemoryViewer - SubAgent 记忆查看器（v1.0.0）
 * # ============================================================
 * 核心作用：可视化 SubAgent 独立 context 存储 + 父→子记忆继承
 *           对应 P0-4 SubAgent Memory Inheritance + 独立 Context
 * 运行流程：
 *   1. 加载所有 SubAgent context 列表
 *   2. 选择一个 SubAgent：查看完整消息（parent_snapshot + isolated）
 *   3. 支持创建 SubAgent（带 parent_id / skill_set / output_dir）
 *   4. 支持手动追加消息（user / assistant / tool 角色）
 *   5. 支持手动触发 inherit（从父 SubAgent）
 *   6. 支持清空 isolated（保留 parent_snapshot）
 * 输入参数：无（自动通过 fetch 加载数据）
 * 输出结果：完整的 SubAgent 记忆管理面板 DOM
 * 复用说明：
 *   - 调用 /api/agents/memory/{summary,list} 加载
 *   - 调用 /api/agents/{id}/memory/{initialize,inherit,append,clear,GET} 操作
 *   - 对应后端 backend/app/services/subagent_memory.py
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | P0-4 SubAgent Memory Viewer 新建
 * ============================================================
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';

const API_BASE = '/api/agents';

// ============================================================
// 类型定义
// ============================================================
export interface SubAgentContextInfo {
  subagent_id: string;
  name: string;
  parent_id: string | null;
  parent_context_size: number;
  skill_set: string[];
  isolated_messages_count: number;
  output_dir: string;
  isolated: boolean;
  created_at: number;
  metadata: Record<string, any>;
}

export interface MemoryEntry {
  entry_id: string;
  role: string;
  content: string;
  timestamp: number;
  metadata: Record<string, any>;
}

export interface MemorySummary {
  total_subagents: number;
  isolated_subagents: number;
  with_parent_inheritance: number;
  total_isolated_messages: number;
  total_parent_snapshots: number;
}

export interface SubAgentMemoryViewerProps {
  onClose: () => void;
}

// ============================================================
// 工具函数
// ============================================================
async function apiGet(path: string): Promise<any> {
  const resp = await fetch(`${API_BASE}${path}`);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  return resp.json();
}

async function apiSend(method: string, path: string, body?: any): Promise<any> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  return resp.json();
}

const ROLE_ICONS: Record<string, string> = {
  user: '👤',
  assistant: '🤖',
  system: '⚙️',
  tool: '🛠️',
  event: '⚡',
};

const ROLE_COLORS: Record<string, string> = {
  user: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
  assistant: 'bg-hermes-500/20 text-hermes-400 border-hermes-500/40',
  system: 'bg-surface-500/20 text-surface-400 border-surface-500/40',
  tool: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
  event: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
};

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function truncate(s: string, max: number = 80): string {
  if (!s) return '';
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

// ============================================================
// 组件
// ============================================================
export const SubAgentMemoryViewer: React.FC<SubAgentMemoryViewerProps> = ({ onClose }) => {
  // 状态
  const [summary, setSummary] = useState<MemorySummary | null>(null);
  const [subagents, setSubagents] = useState<SubAgentContextInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedMessages, setSelectedMessages] = useState<MemoryEntry[]>([]);
  const [includeParent, setIncludeParent] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string>('');

  // 表单状态
  const [showInitForm, setShowInitForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newParentId, setNewParentId] = useState('');
  const [newSkillSet, setNewSkillSet] = useState('');
  const [newOutputDir, setNewOutputDir] = useState('');

  // Append 状态
  const [appendRole, setAppendRole] = useState('user');
  const [appendContent, setAppendContent] = useState('');

  // 加载 summary + 列表
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryResp, listResp] = await Promise.all([
        apiGet('/memory/summary'),
        apiGet('/memory/list'),
      ]);
      setSummary(summaryResp);
      setSubagents(listResp.subagents || []);
    } catch (e) {
      setError(`加载失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载选中 SubAgent 的消息
  const loadMessages = useCallback(async (id: string, withParent: boolean) => {
    try {
      const resp = await apiGet(`/${id}/memory?include_parent=${withParent}&limit=500`);
      setSelectedMessages(resp.messages || []);
    } catch (e) {
      setError(`加载消息失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (selectedId) {
      loadMessages(selectedId, includeParent);
    } else {
      setSelectedMessages([]);
    }
  }, [selectedId, includeParent, loadMessages]);

  // 创建 SubAgent
  const handleInitialize = useCallback(async () => {
    if (!newName.trim()) {
      setError('名称不能为空');
      return;
    }
    setError(null);
    setActionMessage('正在创建 SubAgent...');
    try {
      const id = `subagent-${Date.now()}`;
      const resp = await apiSend('POST', `/${id}/memory/initialize`, {
        name: newName,
        parent_id: newParentId || null,
        skill_set: newSkillSet.split(',').map(s => s.trim()).filter(Boolean),
        output_dir: newOutputDir,
        isolated: true,
      });
      setActionMessage(
        `✓ SubAgent ${id} 已创建${resp.auto_inherit ? '（' + resp.auto_inherit + '）' : ''}`
      );
      setShowInitForm(false);
      setNewName('');
      setNewParentId('');
      setNewSkillSet('');
      setNewOutputDir('');
      await loadData();
      setSelectedId(id);
    } catch (e) {
      setError(`创建失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [newName, newParentId, newSkillSet, newOutputDir, loadData]);

  // 追加消息
  const handleAppend = useCallback(async () => {
    if (!selectedId || !appendContent.trim()) {
      setError('SubAgent ID 和内容不能为空');
      return;
    }
    setError(null);
    setActionMessage('正在追加消息...');
    try {
      await apiSend('POST', `/${selectedId}/memory/append`, {
        role: appendRole,
        content: appendContent,
        metadata: {},
      });
      setActionMessage(`✓ 消息已追加到 ${selectedId}`);
      setAppendContent('');
      await loadMessages(selectedId, includeParent);
      await loadData();
    } catch (e) {
      setError(`追加失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [selectedId, appendRole, appendContent, includeParent, loadData, loadMessages]);

  // 显式 inherit
  const handleInherit = useCallback(async (parentId: string) => {
    if (!selectedId) return;
    if (!parentId) {
      setError('请指定父 SubAgent ID');
      return;
    }
    setError(null);
    setActionMessage(`正在从 ${parentId} 继承...`);
    try {
      const resp = await apiSend('POST', `/${selectedId}/memory/inherit`, {
        parent_id: parentId,
      });
      setActionMessage(`✓ 已继承 ${resp.inherited_count} 条父记忆`);
      await loadMessages(selectedId, includeParent);
      await loadData();
    } catch (e) {
      setError(`继承失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [selectedId, includeParent, loadData, loadMessages]);

  // 清空 isolated
  const handleClear = useCallback(async () => {
    if (!selectedId) return;
    if (!confirm(`确认清空 ${selectedId} 的 isolated 记忆？`)) return;
    setError(null);
    setActionMessage('正在清空...');
    try {
      await apiSend('DELETE', `/${selectedId}/memory`);
      setActionMessage('✓ isolated 记忆已清空，parent_snapshot 保留');
      await loadMessages(selectedId, includeParent);
      await loadData();
    } catch (e) {
      setError(`清空失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [selectedId, includeParent, loadData, loadMessages]);

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const selectedSubagent = useMemo(
    () => subagents.find(s => s.subagent_id === selectedId) || null,
    [subagents, selectedId]
  );

  return (
    <div className="flex flex-col h-full max-h-[85vh] overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-surface-300/30 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🧠</span>
          <div>
            <h2 className="text-base font-bold text-surface-900">SubAgent 记忆管理</h2>
            <p className="text-[10px] text-surface-500 mt-0.5">
              独立 Context + 父→子记忆继承 · 对应 TRAE Sub Agent 独立工作区
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-surface-500 hover:text-surface-900 transition-colors text-xl leading-none"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      {/* 摘要卡片 */}
      {summary && (
        <div className="grid grid-cols-5 gap-2 p-4 border-b border-surface-300/30 flex-shrink-0">
          <StatCard label="SubAgent 总数" value={summary.total_subagents} color="text-hermes-500" />
          <StatCard label="隔离模式" value={summary.isolated_subagents} color="text-emerald-500" />
          <StatCard label="继承父记忆" value={summary.with_parent_inheritance} color="text-blue-500" />
          <StatCard label="独立消息" value={summary.total_isolated_messages} color="text-purple-500" />
          <StatCard label="父快照" value={summary.total_parent_snapshots} color="text-amber-500" />
        </div>
      )}

      {/* 消息条 */}
      {(actionMessage || error) && (
        <div
          className={`mx-4 mt-3 px-3 py-1.5 text-xs rounded ${
            error
              ? 'bg-red-500/10 text-red-400 border border-red-500/30'
              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
          }`}
        >
          {error || actionMessage}
        </div>
      )}

      {/* 主体两栏 */}
      <div className="flex-1 grid grid-cols-5 gap-3 p-4 min-h-0">
        {/* 左侧：SubAgent 列表 */}
        <div className="col-span-2 flex flex-col gap-2 min-h-0">
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setShowInitForm(!showInitForm)}
              className="px-3 py-1.5 text-xs bg-gradient-to-br from-hermes-500 to-hermes-600 hover:from-hermes-600 hover:to-hermes-700 text-white rounded font-medium transition-all"
            >
              {showInitForm ? '✕ 取消' : '➕ 创建 SubAgent'}
            </button>
            <button
              onClick={loadData}
              disabled={loading}
              className="px-3 py-1.5 text-xs bg-surface-200 hover:bg-surface-300 text-surface-700 rounded transition-colors disabled:opacity-50"
            >
              {loading ? '⟳' : '🔄'} 刷新
            </button>
          </div>

          {showInitForm && (
            <div className="bg-surface-100/50 border border-surface-300/50 rounded-lg p-3 space-y-2 flex-shrink-0">
              <h4 className="text-xs font-semibold text-surface-800">新建 SubAgent</h4>
              <input
                type="text"
                placeholder="名称（如 ModuleA_Dev）"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-2 py-1 text-xs bg-surface-200 border border-surface-300/50 rounded text-surface-900"
              />
              <input
                type="text"
                placeholder="父 ID（可选）"
                value={newParentId}
                onChange={(e) => setNewParentId(e.target.value)}
                className="w-full px-2 py-1 text-xs bg-surface-200 border border-surface-300/50 rounded text-surface-900"
              />
              <input
                type="text"
                placeholder="技能集（逗号分隔）"
                value={newSkillSet}
                onChange={(e) => setNewSkillSet(e.target.value)}
                className="w-full px-2 py-1 text-xs bg-surface-200 border border-surface-300/50 rounded text-surface-900"
              />
              <input
                type="text"
                placeholder="输出目录"
                value={newOutputDir}
                onChange={(e) => setNewOutputDir(e.target.value)}
                className="w-full px-2 py-1 text-xs bg-surface-200 border border-surface-300/50 rounded text-surface-900"
              />
              <button
                onClick={handleInitialize}
                className="w-full px-2 py-1 text-xs bg-emerald-500 hover:bg-emerald-600 text-white rounded font-medium"
              >
                ✓ 确认创建
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
            {subagents.length === 0 && !loading && (
              <div className="bg-surface-100/50 border border-dashed border-surface-400/50 rounded-lg p-4 text-center text-xs text-surface-500">
                尚无 SubAgent
              </div>
            )}
            {subagents.map(sa => (
              <div
                key={sa.subagent_id}
                onClick={() => setSelectedId(sa.subagent_id)}
                className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
                  selectedId === sa.subagent_id
                    ? 'bg-hermes-500/15 border-hermes-500/50'
                    : 'bg-surface-100/50 border-surface-300/40 hover:bg-surface-200/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-mono text-surface-800 truncate" title={sa.subagent_id}>
                    {sa.subagent_id}
                  </div>
                  {sa.parent_id && (
                    <span className="text-[9px] text-blue-400 flex-shrink-0">⇡ {sa.parent_id.slice(0, 8)}</span>
                  )}
                </div>
                <div className="text-[11px] font-semibold text-surface-700 mt-0.5">
                  {sa.name}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-surface-500 mt-1">
                  <span>📥 {sa.parent_context_size} 父</span>
                  <span>·</span>
                  <span>📤 {sa.isolated_messages_count} 独立</span>
                  <span>·</span>
                  <span>{sa.isolated ? '🔒 隔离' : '🔓 共享'}</span>
                </div>
                {sa.skill_set.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {sa.skill_set.map(sk => (
                      <span key={sk} className="text-[9px] px-1.5 py-0.5 bg-surface-200 border border-surface-300/50 rounded text-surface-600">
                        {sk}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 右侧：消息详情 */}
        <div className="col-span-3 flex flex-col gap-2 min-h-0">
          {!selectedSubagent ? (
            <div className="flex-1 flex items-center justify-center bg-surface-100/50 border border-dashed border-surface-400/50 rounded-lg">
              <div className="text-center text-xs text-surface-500">
                <div className="text-2xl mb-1 opacity-50">🧠</div>
                从左侧选择一个 SubAgent
              </div>
            </div>
          ) : (
            <>
              {/* SubAgent 详情头 */}
              <div className="bg-surface-100/70 border border-surface-300/50 rounded-lg p-3 flex-shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-surface-900">{selectedSubagent.name}</div>
                    <div className="text-[10px] font-mono text-surface-500">{selectedSubagent.subagent_id}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] text-surface-600 flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={includeParent}
                        onChange={(e) => setIncludeParent(e.target.checked)}
                        className="w-3 h-3"
                      />
                      含父快照
                    </label>
                    <button
                      onClick={handleClear}
                      className="px-2 py-0.5 text-[10px] text-red-400 hover:text-red-300 border border-red-500/30 rounded transition-colors"
                    >
                      🗑️ 清空
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 mt-2 text-[10px] text-surface-600">
                  <div>📥 父快照 <span className="font-mono font-semibold text-surface-800">{selectedSubagent.parent_context_size}</span></div>
                  <div>📤 独立 <span className="font-mono font-semibold text-surface-800">{selectedSubagent.isolated_messages_count}</span></div>
                  <div>🔒 隔离 <span className="font-mono font-semibold text-surface-800">{selectedSubagent.isolated ? '是' : '否'}</span></div>
                  <div>📁 {truncate(selectedSubagent.output_dir, 20) || '（未设置）'}</div>
                </div>
                {selectedSubagent.parent_id && (
                  <div className="mt-2 text-[10px] text-blue-400">
                    ⇡ 继承自：<span className="font-mono">{selectedSubagent.parent_id}</span>
                  </div>
                )}
              </div>

              {/* 操作区：append / inherit */}
              <div className="bg-surface-100/50 border border-surface-300/50 rounded-lg p-2 flex-shrink-0 space-y-2">
                <div className="flex gap-1.5">
                  <select
                    value={appendRole}
                    onChange={(e) => setAppendRole(e.target.value)}
                    className="px-2 py-1 text-xs bg-surface-200 border border-surface-300/50 rounded text-surface-900"
                  >
                    <option value="user">user</option>
                    <option value="assistant">assistant</option>
                    <option value="system">system</option>
                    <option value="tool">tool</option>
                    <option value="event">event</option>
                  </select>
                  <input
                    type="text"
                    placeholder="消息内容..."
                    value={appendContent}
                    onChange={(e) => setAppendContent(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAppend()}
                    className="flex-1 px-2 py-1 text-xs bg-surface-200 border border-surface-300/50 rounded text-surface-900"
                  />
                  <button
                    onClick={handleAppend}
                    className="px-2 py-1 text-xs bg-emerald-500 hover:bg-emerald-600 text-white rounded font-medium"
                  >
                    ➕ 追加
                  </button>
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="从父 ID 继承（手动）"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const v = (e.target as HTMLInputElement).value.trim();
                        if (v) handleInherit(v);
                      }
                    }}
                    className="flex-1 px-2 py-1 text-xs bg-surface-200 border border-surface-300/50 rounded text-surface-900"
                  />
                </div>
              </div>

              {/* 消息流 */}
              <div className="flex-1 overflow-y-auto bg-surface-100/30 border border-surface-300/40 rounded-lg p-2 space-y-1.5 min-h-0">
                {selectedMessages.length === 0 ? (
                  <div className="text-center text-xs text-surface-500 py-4">（无消息）</div>
                ) : (
                  selectedMessages.map((m, i) => {
                    const isParent = selectedSubagent.parent_context_size > i
                      && includeParent
                      && i < selectedSubagent.parent_context_size;
                    return (
                      <div
                        key={m.entry_id}
                        className={`p-2 rounded border ${
                          isParent
                            ? 'bg-blue-500/5 border-blue-500/20'
                            : 'bg-surface-100/60 border-surface-300/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded border ${
                              ROLE_COLORS[m.role] || ROLE_COLORS.event
                            }`}
                          >
                            {ROLE_ICONS[m.role] || '⚡'} {m.role}
                            {isParent && ' · 父快照'}
                          </span>
                          <span className="text-[9px] text-surface-500">
                            {formatTimestamp(m.timestamp)}
                          </span>
                        </div>
                        <div className="text-xs text-surface-800 whitespace-pre-wrap break-words">
                          {m.content}
                        </div>
                        {Object.keys(m.metadata || {}).length > 0 && (
                          <div className="text-[9px] text-surface-500 mt-1 font-mono">
                            metadata: {JSON.stringify(m.metadata)}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// 统计卡片子组件
// ============================================================
const StatCard: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div className="bg-surface-100/70 rounded p-2 text-center">
    <div className={`text-lg font-bold ${color}`}>{value}</div>
    <div className="text-[10px] text-surface-600">{label}</div>
  </div>
);

export default SubAgentMemoryViewer;
