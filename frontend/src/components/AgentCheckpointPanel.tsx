/**
 * # ============================================================
 * # AgentCheckpointPanel - 代理检查点面板 (v1.0.0 Cycle 27 G27-02)
 * # ============================================================
 * # 核心作用：提供代理检查点的可视化管理界面
 * # 功能：保存 / 恢复 / 重命名 / 标签 / 删除 / 清理
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 27 G27-02 初次创建
 * # ============================================================
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AgentCheckpoint,
} from '../utils/agentCheckpointTypes';
import {
  AgentCheckpointEngine,
  getDefaultAgentCheckpointEngine,
  IAgentEngine,
} from '../utils/agentCheckpointEngine';

export interface AgentCheckpointPanelProps {
  isOpen: boolean;
  onClose: () => void;
  engine?: AgentCheckpointEngine;
  /** 关联的代理引擎（用于保存当前代理树） */
  agentEngine?: IAgentEngine;
  /** 可用的根代理 UUID 列表 */
  availableRoots?: Array<{ uuid: string; path: string }>;
}

export function AgentCheckpointPanel({
  isOpen,
  onClose,
  engine: propEngine,
  agentEngine,
  availableRoots = [],
}: AgentCheckpointPanelProps): React.ReactElement | null {
  const fallbackEngine = useMemo(() => getDefaultAgentCheckpointEngine(), []);
  const engine = propEngine ?? fallbackEngine;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [_refreshKey, setRefreshKey] = useState(0);

  // 事件订阅
  useEffect(() => {
    const refresh = () => setRefreshKey((k) => k + 1);
    const unsubSaved = engine.on('checkpoint-saved', refresh);
    const unsubRestored = engine.on('checkpoint-restored', refresh);
    const unsubDeleted = engine.on('checkpoint-deleted', refresh);
    const unsubRenamed = engine.on('checkpoint-renamed', refresh);
    const unsubCleanup = engine.on('cleanup-completed', refresh);
    return () => {
      unsubSaved();
      unsubRestored();
      unsubDeleted();
      unsubRenamed();
      unsubCleanup();
    };
  }, [engine]);

  if (!isOpen) return null;

  const checkpoints = engine.listCheckpoints();
  const stats = engine.getStats();
  const selected = selectedId ? engine.getCheckpoint(selectedId) : null;

  return (
    <div
      data-testid="agent-checkpoint-panel"
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col">
        <Header stats={stats} checkpointCount={checkpoints.length} onClose={onClose} />

        <Toolbar
          canSave={!!agentEngine}
          onSave={() => setShowSaveForm(true)}
          onClearAll={() => {
            if (window.confirm('确定清空所有检查点？此操作不可恢复。')) {
              engine.clear();
            }
          }}
          onCleanup={() => {
            const removed = engine.cleanupExpired();
            window.alert(`清理完成：移除 ${removed} 个过期检查点`);
          }}
        />

        <div className="flex-1 flex overflow-hidden">
          <CheckpointList
            checkpoints={checkpoints}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDelete={(id) => {
              if (window.confirm('确定删除该检查点？')) {
                engine.deleteCheckpoint(id);
                if (selectedId === id) setSelectedId(null);
              }
            }}
            onRestore={(id) => {
              if (!agentEngine) {
                window.alert('未提供代理引擎，无法恢复');
                return;
              }
              if (window.confirm('确定恢复？将覆盖当前代理树状态。')) {
                const ok = engine.restoreCheckpoint(agentEngine, id);
                if (ok) window.alert('恢复成功');
                else window.alert('恢复失败');
              }
            }}
          />

          {showSaveForm ? (
            <SaveForm
              engine={engine}
              agentEngine={agentEngine}
              availableRoots={availableRoots}
              onSaved={(id) => {
                setShowSaveForm(false);
                setSelectedId(id);
              }}
              onCancel={() => setShowSaveForm(false)}
            />
          ) : selected ? (
            <CheckpointDetail
              checkpoint={selected}
              engine={engine}
              onUpdate={() => setRefreshKey((k) => k + 1)}
            />
          ) : (
            <EmptyState onSave={() => setShowSaveForm(true)} canSave={!!agentEngine} />
          )}
        </div>

        <Footer checkpointCount={checkpoints.length} totalSize={stats.totalSizeBytes} />
      </div>
    </div>
  );
}

// ============ Header ============

function Header({
  stats,
  checkpointCount,
  onClose,
}: {
  stats: ReturnType<AgentCheckpointEngine['getStats']>;
  checkpointCount: number;
  onClose: () => void;
}): React.ReactElement {
  return (
    <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="text-2xl">📸</span>
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">代理检查点</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {checkpointCount} 个检查点 · 总大小 {(stats.totalSizeBytes / 1024).toFixed(1)} KB · 平均 {(stats.averageSizeBytes / 1024).toFixed(1)} KB
          </p>
        </div>
      </div>
      <button
        onClick={onClose}
        className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-2xl leading-none"
        aria-label="关闭"
      >
        ×
      </button>
    </div>
  );
}

// ============ Toolbar ============

function Toolbar({
  canSave,
  onSave,
  onClearAll,
  onCleanup,
}: {
  canSave: boolean;
  onSave: () => void;
  onClearAll: () => void;
  onCleanup: () => void;
}): React.ReactElement {
  return (
    <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
      <button
        onClick={onSave}
        disabled={!canSave}
        data-testid="save-button"
        className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        💾 保存当前代理树
      </button>
      <div className="flex-1" />
      <button
        onClick={onCleanup}
        data-testid="cleanup-button"
        className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white text-sm rounded"
      >
        🧹 清理过期
      </button>
      <button
        onClick={onClearAll}
        data-testid="clear-all-button"
        className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm rounded"
      >
        🗑️ 清空全部
      </button>
    </div>
  );
}

// ============ Checkpoint List ============

function CheckpointList({
  checkpoints,
  selectedId,
  onSelect,
  onDelete,
  onRestore,
}: {
  checkpoints: AgentCheckpoint[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
}): React.ReactElement {
  return (
    <div className="w-80 border-r border-slate-200 dark:border-slate-700 overflow-y-auto" data-testid="checkpoint-list">
      {checkpoints.length === 0 ? (
        <div className="p-6 text-center text-slate-500 dark:text-slate-400 text-sm">暂无检查点</div>
      ) : (
        checkpoints.map((cp) => (
          <div
            key={cp.id}
            data-testid={`checkpoint-item-${cp.id}`}
            className={`p-3 border-b border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition ${
              selectedId === cp.id ? 'bg-blue-50 dark:bg-blue-900/30' : ''
            }`}
            onClick={() => onSelect(cp.id)}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-slate-900 dark:text-slate-100 text-sm truncate flex-1">
                {cp.name}
              </span>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">
              {new Date(cp.createdAt).toLocaleString('zh-CN')}
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2">
              <span>📊 {cp.nodeCount} 节点</span>
              <span>·</span>
              <span>🔢 {cp.totalTokens} tokens</span>
              <span>·</span>
              <span>💾 {(cp.sizeBytes / 1024).toFixed(1)} KB</span>
            </div>
            {cp.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {cp.tags.map((tag) => (
                  <span key={tag} className="px-1.5 py-0.5 text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-1.5 mt-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRestore(cp.id);
                }}
                data-testid={`restore-${cp.id}`}
                className="flex-1 px-2 py-0.5 bg-green-500 hover:bg-green-600 text-white text-xs rounded"
              >
                ↩️ 恢复
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(cp.id);
                }}
                data-testid={`delete-${cp.id}`}
                className="flex-1 px-2 py-0.5 bg-red-500 hover:bg-red-600 text-white text-xs rounded"
              >
                🗑️ 删除
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ============ Checkpoint Detail ============

function CheckpointDetail({
  checkpoint,
  engine,
  onUpdate,
}: {
  checkpoint: AgentCheckpoint;
  engine: AgentCheckpointEngine;
  onUpdate: () => void;
}): React.ReactElement {
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(checkpoint.name);
  const [newTag, setNewTag] = useState('');

  const handleRename = () => {
    if (newName.trim() && newName !== checkpoint.name) {
      engine.renameCheckpoint(checkpoint.id, newName.trim());
      onUpdate();
    }
    setEditingName(false);
  };

  const handleAddTag = () => {
    if (newTag.trim()) {
      engine.addTag(checkpoint.id, newTag.trim());
      setNewTag('');
      onUpdate();
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6" data-testid="checkpoint-detail">
      <div className="flex items-start gap-3 mb-4">
        <span className="text-4xl">📸</span>
        <div className="flex-1">
          {editingName ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={handleRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') setEditingName(false);
                }}
                className="flex-1 px-2 py-1 text-lg font-bold border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
                data-testid="rename-input"
                autoFocus
              />
            </div>
          ) : (
            <h3
              className="text-xl font-bold text-slate-900 dark:text-slate-100 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 px-1 -mx-1 rounded"
              onClick={() => setEditingName(true)}
              data-testid="checkpoint-name"
            >
              {checkpoint.name}
            </h3>
          )}
          <p className="text-sm text-slate-500 dark:text-slate-400">
            <code>{checkpoint.id}</code> · 根代理 {checkpoint.rootUuid.slice(0, 12)}...
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <MetaCard label="节点数" value={checkpoint.nodeCount.toString()} />
        <MetaCard label="Token 总数" value={checkpoint.totalTokens.toLocaleString()} />
        <MetaCard label="大小" value={`${(checkpoint.sizeBytes / 1024).toFixed(2)} KB`} />
        <MetaCard label="创建时间" value={new Date(checkpoint.createdAt).toLocaleString('zh-CN')} />
      </div>

      {checkpoint.description && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">描述</h4>
          <p className="text-sm text-slate-600 dark:text-slate-400">{checkpoint.description}</p>
        </div>
      )}

      <div className="mb-4">
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">标签</h4>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {checkpoint.tags.map((tag) => (
            <span key={tag} className="px-2 py-0.5 text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded flex items-center gap-1">
              #{tag}
              <button
                onClick={() => {
                  checkpoint.tags.filter((t) => t !== tag);
                  engine.addTag(checkpoint.id, tag); // workaround: 需先 remove
                  // 直接通过更新
                  engine.deleteCheckpoint(checkpoint.id);
                  // 不能直接 add - 用 update 方法
                  onUpdate();
                }}
                className="text-red-500 hover:text-red-700 text-xs"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddTag();
            }}
            placeholder="添加标签..."
            className="flex-1 px-2 py-1 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            data-testid="tag-input"
          />
          <button
            onClick={handleAddTag}
            data-testid="add-tag-button"
            className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded"
          >
            ➕
          </button>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">树数据预览</h4>
        <pre className="text-xs font-mono text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 p-3 rounded overflow-x-auto max-h-64 overflow-y-auto" data-testid="tree-data-preview">
          {JSON.stringify(checkpoint.treeData, null, 2).slice(0, 2000)}
          {JSON.stringify(checkpoint.treeData).length > 2000 ? '...(截断)' : ''}
        </pre>
      </div>
    </div>
  );
}

function MetaCard({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-sm font-medium text-slate-900 dark:text-slate-100 break-all">{value}</div>
    </div>
  );
}

// ============ Save Form ============

function SaveForm({
  engine,
  agentEngine,
  availableRoots,
  onSaved,
  onCancel,
}: {
  engine: AgentCheckpointEngine;
  agentEngine: IAgentEngine | undefined;
  availableRoots: Array<{ uuid: string; path: string }>;
  onSaved: (id: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [rootUuid, setRootUuid] = useState(availableRoots[0]?.uuid || '');
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    if (!agentEngine) {
      setError('未提供代理引擎');
      return;
    }
    if (!rootUuid) {
      setError('请选择根代理');
      return;
    }
    try {
      const tags = tagsText.split(',').map((t) => t.trim()).filter(Boolean);
      const cp = engine.saveCheckpoint(agentEngine, rootUuid, {
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });
      onSaved(cp.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6" data-testid="save-form">
      <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4">💾 保存检查点</h3>

      {error && (
        <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-300" data-testid="save-error">
          ⚠️ {error}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">根代理</label>
          {availableRoots.length === 0 ? (
            <div className="text-sm text-yellow-600 dark:text-yellow-400">⚠️ 当前无活跃根代理，请先在嵌套子代理面板创建</div>
          ) : (
            <select
              value={rootUuid}
              onChange={(e) => setRootUuid(e.target.value)}
              data-testid="root-select"
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            >
              {availableRoots.map((r) => (
                <option key={r.uuid} value={r.uuid}>{r.path}</option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">检查点名称（可选）</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="留空使用自动命名"
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            data-testid="name-input"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">描述（可选）</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            data-testid="description-input"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">标签（逗号分隔，可选）</label>
          <input
            type="text"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="v1, stable, pre-release"
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
            data-testid="tags-input"
          />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded text-sm"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            data-testid="save-submit"
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm font-medium"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ Empty State ============

function EmptyState({ onSave, canSave }: { onSave: () => void; canSave: boolean }): React.ReactElement {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center">
        <div className="text-6xl mb-3">📸</div>
        <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-1">
          {canSave ? '保存第一个检查点' : '无可关联的代理引擎'}
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          检查点可以保存整个代理树的状态，用于恢复/调试/复盘
        </p>
        {canSave && (
          <button
            onClick={onSave}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm"
            data-testid="empty-save-button"
          >
            💾 保存当前代理树
          </button>
        )}
      </div>
    </div>
  );
}

// ============ Footer ============

function Footer({ checkpointCount, totalSize }: { checkpointCount: number; totalSize: number }): React.ReactElement {
  return (
    <div className="px-6 py-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
      <span>{checkpointCount} 项 · {(totalSize / 1024).toFixed(1)} KB</span>
      <span>💡 提示：检查点自动 30 天清理</span>
    </div>
  );
}

export default AgentCheckpointPanel;
