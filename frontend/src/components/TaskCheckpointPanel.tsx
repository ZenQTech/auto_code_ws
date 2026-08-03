/**
 * # ============================================================
 * # TaskCheckpointPanel - 任务检查点面板 (v1.0.0 Cycle 35 G35-03)
 * # ============================================================
 * # 核心作用：提供任务检查点引擎的可视化管理界面
 * # 功能：
 * #   - 线程管理（创建 / 列表 / 删除）
 * #   - 检查点保存（完整 / 增量）
 * #   - Time Travel（恢复 / Diff）
 * #   - 分支与标签管理
 * #   - 压缩与清理
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 35 G35-03 初次创建
 * # ============================================================
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  TaskCheckpointEngine,
  getDefaultTaskCheckpointEngine,
  type Thread,
  type CheckpointDiff,
} from '../utils/taskCheckpointEngine';

export interface TaskCheckpointPanelProps {
  engine?: TaskCheckpointEngine;
  isOpen?: boolean;
  onClose?: () => void;
}

type TabKey = 'threads' | 'checkpoints' | 'branches' | 'stats';

export const TaskCheckpointPanel: React.FC<TaskCheckpointPanelProps> = ({
  engine: engineProp,
  isOpen,
  onClose,
}) => {

  // G60-FIX-13: 面板关闭时早返回，避免在 DOM 中堆积所有面板
  if (isOpen === false) return null;
  const engine = useMemo(
    () => engineProp || getDefaultTaskCheckpointEngine(),
    [engineProp],
  );
  const [tab, setTab] = useState<TabKey>('threads');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  // 订阅引擎事件
  useEffect(() => {
    const events = [
      'thread-created',
      'thread-deleted',
      'checkpoint-saved',
      'version-created',
      'branch-created',
      'tag-created',
    ];
    const unsubs = events.map((evt) =>
      engine.on(evt as any, () => setRefreshKey((k) => k + 1)),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [engine]);

  const threads = useMemo(
    () => engine.listThreads(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, refreshKey],
  );

  // 自动选中第一个线程
  useEffect(() => {
    if (!selectedThreadId && threads.length > 0) {
      setSelectedThreadId(threads[0].id);
    }
  }, [threads, selectedThreadId]);

  return (
    <div
      className="task-checkpoint-panel"
      data-testid="task-checkpoint-panel"
    >
      <div className="panel-header flex items-center justify-between p-4 border-b border-surface-200">
        <h2 className="text-lg font-semibold">📸 任务检查点 (Task Checkpoint)</h2>
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

      <div className="panel-tabs flex border-b border-surface-200">
        {(['threads', 'checkpoints', 'branches', 'stats'] as TabKey[]).map((k) => (
          <button
            key={k}
            className={`px-4 py-2 text-sm ${
              tab === k
                ? 'border-b-2 border-green-500 text-green-600 font-medium'
                : 'text-surface-600 hover:text-surface-900'
            }`}
            onClick={() => setTab(k)}
            data-testid={`tab-${k}`}
          >
            {k === 'threads' && '线程'}
            {k === 'checkpoints' && '检查点'}
            {k === 'branches' && '分支/标签'}
            {k === 'stats' && '统计'}
          </button>
        ))}
      </div>

      <div className="panel-body p-4 overflow-y-auto" style={{ maxHeight: '65vh' }}>
        {tab === 'threads' && (
          <ThreadsTab
            engine={engine}
            threads={threads}
            selectedThreadId={selectedThreadId}
            onSelect={setSelectedThreadId}
          />
        )}
        {tab === 'checkpoints' && (
          <CheckpointsTab
            engine={engine}
            threadId={selectedThreadId}
            threads={threads}
          />
        )}
        {tab === 'branches' && (
          <BranchesTab engine={engine} threadId={selectedThreadId} />
        )}
        {tab === 'stats' && <StatsTab threads={threads} />}
      </div>
    </div>
  );
};

// ============ Threads Tab ============

const ThreadsTab: React.FC<{
  engine: TaskCheckpointEngine;
  threads: Thread[];
  selectedThreadId: string | null;
  onSelect: (id: string) => void;
}> = ({ engine, threads, selectedThreadId, onSelect }) => {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('New Thread');
  const [engine1, setEngine1] = useState('default');
  const [instanceId, setInstanceId] = useState('inst-1');

  const handleCreate = () => {
    const t = engine.createThread({
      name,
      engine: engine1,
      engineInstanceId: instanceId,
    });
    onSelect(t.id);
    setShowCreate(false);
    setName('New Thread');
  };

  return (
    <div className="threads-tab">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-medium">线程列表 ({threads.length})</h3>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600"
          data-testid="btn-create-thread"
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
            placeholder="线程名称"
            data-testid="input-thread-name"
          />
          <input
            value={engine1}
            onChange={(e) => setEngine1(e.target.value)}
            className="w-full px-2 py-1 border border-surface-300 rounded mb-2 text-sm"
            placeholder="引擎名"
          />
          <input
            value={instanceId}
            onChange={(e) => setInstanceId(e.target.value)}
            className="w-full px-2 py-1 border border-surface-300 rounded mb-2 text-sm"
            placeholder="实例 ID"
          />
          <button
            onClick={handleCreate}
            className="w-full px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
            data-testid="btn-submit-thread"
          >
            创建
          </button>
        </div>
      )}

      <div className="space-y-2" data-testid="thread-list">
        {threads.map((t) => (
          <div
            key={t.id}
            className={`border rounded p-3 cursor-pointer ${
              selectedThreadId === t.id
                ? 'border-green-500 bg-green-50'
                : 'border-surface-200 bg-white'
            }`}
            onClick={() => onSelect(t.id)}
            data-testid={`thread-item-${t.id}`}
          >
            <div className="flex justify-between items-start">
              <div>
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-surface-500">
                  引擎: {t.engine} · 实例: {t.engineInstanceId}
                </div>
                <div className="text-xs text-surface-400">
                  版本: {t.versionCount} · 分支: {t.branchCount} · 大小: {t.totalSize}b
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm('确定删除该线程？')) {
                    engine.deleteThread(t.id);
                    if (selectedThreadId === t.id) onSelect('');
                  }
                }}
                className="px-2 py-1 text-xs bg-red-500 text-white rounded"
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============ Checkpoints Tab ============

const CheckpointsTab: React.FC<{
  engine: TaskCheckpointEngine;
  threadId: string | null;
  threads: Thread[];
}> = ({ engine, threadId, threads: _threads }) => {
  const [stateJson, setStateJson] = useState('{"x": 1, "y": 2}');
  const [message, setMessage] = useState('');
  const [_refreshKey, setRefreshKey] = useState(0);
  const [diffFrom, setDiffFrom] = useState<number | null>(null);
  const [diffTo, setDiffTo] = useState<number | null>(null);
  const [diffResult, setDiffResult] = useState<CheckpointDiff | null>(null);

  const versions = useMemo(
    () => (threadId ? engine.listVersions(threadId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, threadId, _refreshKey],
  );

  const handleSave = () => {
    if (!threadId) return;
    try {
      const state = JSON.parse(stateJson);
      engine.saveCheckpoint(threadId, state, { message });
      setMessage('');
      setRefreshKey((k) => k + 1);
    } catch (e) {
      window.alert('JSON 格式错误: ' + (e as Error).message);
    }
  };

  const handleRestore = (version: number) => {
    if (!threadId) return;
    const state = engine.restore(threadId, version);
    setStateJson(JSON.stringify(state, null, 2));
  };

  const handleDiff = () => {
    if (!threadId || diffFrom === null || diffTo === null) return;
    const result = engine.diff(threadId, diffFrom, diffTo);
    setDiffResult(result);
  };

  if (!threadId) {
    return (
      <div className="text-sm text-surface-500 text-center py-8">
        请先在「线程」标签选择或创建一个线程
      </div>
    );
  }

  return (
    <div className="checkpoints-tab space-y-3">
      <div className="border border-surface-200 rounded p-3 bg-surface-50">
        <h4 className="font-medium mb-2">💾 保存检查点</h4>
        <textarea
          value={stateJson}
          onChange={(e) => setStateJson(e.target.value)}
          className="w-full px-2 py-1 border border-surface-300 rounded mb-2 text-xs font-mono"
          rows={3}
          data-testid="input-state"
        />
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="w-full px-2 py-1 border border-surface-300 rounded mb-2 text-sm"
          placeholder="提交信息"
        />
        <button
          onClick={handleSave}
          className="w-full px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
          data-testid="btn-save-checkpoint"
        >
          保存完整快照
        </button>
      </div>

      <div>
        <h4 className="font-medium mb-2">📜 版本历史 ({versions.length})</h4>
        <div className="space-y-1" data-testid="version-list">
          {versions.map((v) => (
            <div
              key={v.version}
              className="border border-surface-200 rounded p-2 bg-white text-xs flex justify-between items-center"
              data-testid={`version-item-${v.version}`}
            >
              <div>
                <div className="font-mono">v{v.version}</div>
                <div className="text-surface-500">
                  {v.message || '(无消息)'} · {new Date(v.createdAt).toLocaleTimeString()}
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => handleRestore(v.version)}
                  className="px-2 py-0.5 text-xs bg-blue-500 text-white rounded"
                  data-testid={`btn-restore-${v.version}`}
                >
                  恢复
                </button>
                <button
                  onClick={() => setDiffFrom(v.version)}
                  className={`px-2 py-0.5 text-xs rounded ${
                    diffFrom === v.version ? 'bg-orange-500 text-white' : 'bg-surface-200'
                  }`}
                >
                  起点
                </button>
                <button
                  onClick={() => setDiffTo(v.version)}
                  className={`px-2 py-0.5 text-xs rounded ${
                    diffTo === v.version ? 'bg-orange-500 text-white' : 'bg-surface-200'
                  }`}
                >
                  终点
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {diffFrom !== null && diffTo !== null && (
        <div className="border border-surface-200 rounded p-3 bg-orange-50">
          <h4 className="font-medium mb-2">🔍 Diff v{diffFrom} → v{diffTo}</h4>
          <button
            onClick={handleDiff}
            className="px-3 py-1 bg-orange-500 text-white rounded text-sm mb-2"
            data-testid="btn-diff"
          >
            计算差异
          </button>
          {diffResult && (
            <div className="text-xs space-y-1">
              <div>新增: <span className="font-mono">{diffResult.added.length}</span> 项</div>
              <div>删除: <span className="font-mono">{diffResult.removed.length}</span> 项</div>
              <div>修改: <span className="font-mono">{diffResult.modified.length}</span> 项</div>
              {diffResult.added.length > 0 && (
                <div className="text-green-700">+ {diffResult.added.join(', ')}</div>
              )}
              {diffResult.removed.length > 0 && (
                <div className="text-red-700">- {diffResult.removed.join(', ')}</div>
              )}
              {diffResult.modified.length > 0 && (
                <div className="text-orange-700">~ {diffResult.modified.join(', ')}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ============ Branches Tab ============

const BranchesTab: React.FC<{
  engine: TaskCheckpointEngine;
  threadId: string | null;
}> = ({ engine, threadId }) => {
  const [branchName, setBranchName] = useState('feature');
  const [tagName, setTagName] = useState('v1.0.0');
  const [tagVersion, setTagVersion] = useState<number | null>(null);

  if (!threadId) {
    return (
      <div className="text-sm text-surface-500 text-center py-8">
        请先在「线程」标签选择或创建一个线程
      </div>
    );
  }

  const branches = engine.listBranches(threadId);
  const tags = engine.listTags(threadId);
  const versions = engine.listVersions(threadId);

  const handleCreateBranch = () => {
    if (threadId) {
      const lastVersion = versions.length > 0 ? versions[versions.length - 1].version : 0;
      if (lastVersion > 0) {
        engine.createBranch(threadId, branchName, lastVersion);
      } else {
        window.alert('需要先有至少一个版本才能创建分支');
      }
    }
  };

  const handleCreateTag = () => {
    if (threadId && tagVersion !== null) {
      engine.createTag(threadId, tagName, tagVersion);
    }
  };

  return (
    <div className="branches-tab space-y-3">
      <div className="border border-surface-200 rounded p-3 bg-surface-50">
        <h4 className="font-medium mb-2">🌿 创建分支</h4>
        <div className="flex gap-2 mb-2">
          <input
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            className="flex-1 px-2 py-1 border border-surface-300 rounded text-sm"
            placeholder="分支名"
            data-testid="input-branch-name"
          />
          <button
            onClick={handleCreateBranch}
            className="px-3 py-1 bg-green-500 text-white rounded text-sm"
            data-testid="btn-create-branch"
          >
            创建
          </button>
        </div>
      </div>

      <div>
        <h4 className="font-medium mb-2">分支列表 ({branches.length})</h4>
        <div className="space-y-1" data-testid="branch-list">
          {branches.map((b) => (
            <div
              key={b.name}
              className="border border-surface-200 rounded p-2 bg-white text-xs"
              data-testid={`branch-item-${b.name}`}
            >
              <div className="flex justify-between">
                <span className="font-mono">{b.name}</span>
                <span className="text-surface-500">v{b.headVersion}</span>
              </div>
              {b.protected && <div className="text-orange-500 text-xs">🔒 受保护</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="border border-surface-200 rounded p-3 bg-surface-50">
        <h4 className="font-medium mb-2">🏷 创建标签</h4>
        <div className="flex gap-2 mb-2">
          <input
            value={tagName}
            onChange={(e) => setTagName(e.target.value)}
            className="flex-1 px-2 py-1 border border-surface-300 rounded text-sm"
            placeholder="标签名"
          />
          <select
            value={tagVersion ?? ''}
            onChange={(e) => setTagVersion(e.target.value ? Number(e.target.value) : null)}
            className="flex-1 px-2 py-1 border border-surface-300 rounded text-sm"
          >
            <option value="">-- 选择版本 --</option>
            {versions.map((v) => (
              <option key={v.version} value={v.version}>v{v.version}</option>
            ))}
          </select>
          <button
            onClick={handleCreateTag}
            className="px-3 py-1 bg-blue-500 text-white rounded text-sm"
            data-testid="btn-create-tag"
          >
            标记
          </button>
        </div>
      </div>

      <div>
        <h4 className="font-medium mb-2">标签列表 ({tags.length})</h4>
        <div className="space-y-1" data-testid="tag-list">
          {tags.map((t) => (
            <div
              key={t.name}
              className="border border-surface-200 rounded p-2 bg-white text-xs"
              data-testid={`tag-item-${t.name}`}
            >
              <div className="flex justify-between">
                <span className="font-mono">🏷 {t.name}</span>
                <span className="text-surface-500">v{t.version}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============ Stats Tab ============

const StatsTab: React.FC<{
  threads: Thread[];
}> = ({ threads }) => {
  const totalVersions = threads.reduce((sum, t) => sum + t.versionCount, 0);
  const totalBranches = threads.reduce((sum, t) => sum + t.branchCount, 0);
  const totalSize = threads.reduce((sum, t) => sum + t.totalSize, 0);

  return (
    <div className="stats-tab space-y-3" data-testid="stats-tab">
      <div className="border border-surface-200 rounded p-3">
        <h4 className="font-medium mb-2">🧵 线程统计</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>总线程: <span className="font-mono">{threads.length}</span></div>
          <div>总版本: <span className="font-mono">{totalVersions}</span></div>
          <div>总分支: <span className="font-mono">{totalBranches}</span></div>
          <div>总大小: <span className="font-mono">{totalSize}b</span></div>
        </div>
      </div>
      <div className="border border-surface-200 rounded p-3">
        <h4 className="font-medium mb-2">📋 线程详情</h4>
        <div className="space-y-2 text-sm">
          {threads.map((t) => (
            <div key={t.id} className="border-b border-surface-100 pb-2 last:border-0">
              <div className="font-medium">{t.name}</div>
              <div className="text-xs text-surface-500">
                {t.versionCount} 版本 · {t.branchCount} 分支 · {t.totalSize}b
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TaskCheckpointPanel;
