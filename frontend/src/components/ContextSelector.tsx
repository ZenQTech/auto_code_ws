/**
 * # ============================================================
 * # ContextSelector 组件 (v1.0.0)
 * # Cycle 62 G62-02
 * # ====================================
 * # 核心作用：多源上下文选择器 UI
 * # 运行流程：
 * #   1. 显示已有 bundles 列表
 * #   2. 用户选择上下文源类型
 * #   3. 填写源参数并添加到 bundle
 * #   4. 实时显示加载状态、token 估算
 * # 输入参数：testId, initialBundleId
 * # 输出结果：UI 组件
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 62 G62-02 初次创建
 * # ====================================
 */

import { useEffect, useMemo, useState } from 'react';
import {
  useMultiContext,
  type ContextBundle,
  type ContextItem,
  type ContextSourceType,
} from '../hooks/useMultiContext';

export interface ContextSelectorProps {
  testId?: string;
  initialBundleId?: string;
  onItemAdded?: (item: ContextItem) => void;
  onBundleChanged?: (bundle: ContextBundle | null) => void;
}

const SOURCE_LABELS: Record<ContextSourceType, string> = {
  file: '文件',
  code: '代码片段',
  terminal: '终端',
  git: 'Git 仓库',
  document: '文档',
  web: '网页',
};

const SOURCE_ICONS: Record<ContextSourceType, string> = {
  file: '📄',
  code: '🔖',
  terminal: '⌨️',
  git: '🔀',
  document: '📋',
  web: '🌐',
};

const SOURCE_FIELDS: Record<ContextSourceType, { key: string; label: string; type?: string; placeholder?: string }[]> = {
  file: [
    { key: 'path', label: '文件路径', placeholder: '/abs/path/to/file.py' },
    { key: 'max_size', label: '最大字节数', type: 'number', placeholder: '100000' },
  ],
  code: [
    { key: 'path', label: '文件路径', placeholder: '/abs/path/to/file.py' },
    { key: 'start_line', label: '起始行', type: 'number', placeholder: '1' },
    { key: 'end_line', label: '结束行', type: 'number', placeholder: '100' },
  ],
  terminal: [
    { key: 'command', label: '命令', placeholder: 'ls -la' },
    { key: 'cwd', label: '工作目录', placeholder: '/path/to/cwd' },
  ],
  git: [
    { key: 'repo_path', label: '仓库路径', placeholder: '/abs/path/to/repo' },
    {
      key: 'type',
      label: '类型 (log/diff/branch)',
      placeholder: 'log',
    },
    { key: 'ref', label: '引用', placeholder: 'HEAD' },
  ],
  document: [
    { key: 'url', label: 'URL', placeholder: 'https://...' },
    { key: 'path', label: '或本地路径', placeholder: '/path/to/doc.md' },
  ],
  web: [
    { key: 'url', label: 'URL', placeholder: 'https://...' },
    { key: 'selector', label: 'CSS 选择器（可选）', placeholder: 'main' },
    { key: 'max_size', label: '最大字符数', type: 'number', placeholder: '20000' },
  ],
};

export function ContextSelector({
  testId = 'context-selector',
  initialBundleId,
  onItemAdded,
  onBundleChanged,
}: ContextSelectorProps) {
  const {
    bundles,
    activeBundle,
    setActiveBundleId,
    loading,
    error,
    stats,
    addItem,
    removeItem,
    deleteBundle,
  } = useMultiContext({ bundleId: initialBundleId });

  const [showAdd, setShowAdd] = useState(false);
  const [newBundleId, setNewBundleId] = useState(initialBundleId || 'default');
  const [newSourceType, setNewSourceType] = useState<ContextSourceType>('file');
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (onBundleChanged) {
      onBundleChanged(activeBundle);
    }
  }, [activeBundle, onBundleChanged]);

  const sourceFields = useMemo(
    () => SOURCE_FIELDS[newSourceType] || [],
    [newSourceType],
  );

  const handleAdd = async () => {
    if (!newBundleId.trim()) return;
    // 转换数据类型
    const sourceData: Record<string, unknown> = {};
    for (const field of sourceFields) {
      const v = formData[field.key];
      if (v === undefined || v === '') continue;
      if (field.type === 'number') {
        const n = Number(v);
        if (!Number.isNaN(n)) sourceData[field.key] = n;
      } else {
        sourceData[field.key] = v;
      }
    }
    setSubmitting(true);
    const item = await addItem({
      bundle_id: newBundleId,
      source_type: newSourceType,
      source_data: sourceData,
    });
    setSubmitting(false);
    if (item) {
      setShowAdd(false);
      setFormData({});
      if (onItemAdded) onItemAdded(item);
      setActiveBundleId(newBundleId);
    }
  };

  return (
    <div
      className="flex flex-col h-full bg-[var(--bg-panel)] text-[var(--text-primary)]"
      data-testid={testId}
    >
      {/* 顶部：bundle 选择 + 操作 */}
      <div
        className="flex items-center gap-2 p-2 border-b border-[var(--border-color)]"
        data-testid={`${testId}-toolbar`}
      >
        <select
          value={activeBundle?.bundle_id || ''}
          onChange={(e) => setActiveBundleId(e.target.value || null)}
          className="flex-1 px-2 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-primary)]"
          data-testid={`${testId}-bundle-select`}
        >
          <option value="">-- 选择 bundle --</option>
          {bundles.map((b) => (
            <option key={b.bundle_id} value={b.bundle_id}>
              {b.bundle_id} ({b.item_count} 项, {b.total_tokens} tok)
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-2 py-1 text-xs rounded bg-[var(--accent)] text-white hover:opacity-90"
          data-testid={`${testId}-add-btn`}
        >
          {showAdd ? '取消' : '+ 添加'}
        </button>
        {activeBundle && (
          <button
            onClick={() => deleteBundle(activeBundle.bundle_id)}
            className="px-2 py-1 text-xs rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            data-testid={`${testId}-delete-btn`}
            title="删除 bundle"
          >
            🗑
          </button>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div
          className="p-2 text-xs text-red-400 border-b border-[var(--border-color)]"
          data-testid={`${testId}-error`}
        >
          ⚠ {error}
        </div>
      )}

      {/* 添加上下文项表单 */}
      {showAdd && (
        <div
          className="p-3 border-b border-[var(--border-color)] bg-[var(--bg-elevated)]"
          data-testid={`${testId}-add-form`}
        >
          <div className="flex flex-col gap-2">
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">Bundle ID</label>
              <input
                type="text"
                value={newBundleId}
                onChange={(e) => setNewBundleId(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-app)] text-[var(--text-primary)]"
                placeholder="default"
                data-testid={`${testId}-bundle-id`}
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">源类型</label>
              <div className="grid grid-cols-3 gap-1" data-testid={`${testId}-source-types`}>
                {(Object.keys(SOURCE_LABELS) as ContextSourceType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setNewSourceType(t);
                      setFormData({});
                    }}
                    className={`px-2 py-1 text-xs rounded ${
                      newSourceType === t
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--bg-app)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                    data-testid={`${testId}-src-${t}`}
                  >
                    {SOURCE_ICONS[t]} {SOURCE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
            {sourceFields.map((f) => (
              <div key={f.key}>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">{f.label}</label>
                <input
                  type={f.type || 'text'}
                  value={formData[f.key] || ''}
                  onChange={(e) => setFormData({ ...formData, [f.key]: e.target.value })}
                  className="w-full px-2 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-app)] text-[var(--text-primary)]"
                  placeholder={f.placeholder}
                  data-testid={`${testId}-field-${f.key}`}
                />
              </div>
            ))}
            <button
              onClick={handleAdd}
              disabled={submitting}
              className="w-full px-2 py-1 text-xs rounded bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
              data-testid={`${testId}-submit-btn`}
            >
              {submitting ? '加载中...' : '添加上下文'}
            </button>
          </div>
        </div>
      )}

      {/* 统计 */}
      {stats && (
        <div
          className="px-3 py-1 text-xs text-[var(--text-secondary)] border-b border-[var(--border-color)]"
          data-testid={`${testId}-stats`}
        >
          📊 共 {stats.bundle_count} 个 bundle / {stats.total_items} 项 / {stats.total_tokens} tokens
        </div>
      )}

      {/* bundle 内容 */}
      <div className="flex-1 overflow-y-auto p-2" data-testid={`${testId}-content`}>
        {loading ? (
          <div className="text-xs text-[var(--text-tertiary)] p-2">加载中...</div>
        ) : !activeBundle ? (
          <div
            className="text-xs text-[var(--text-tertiary)] p-2"
            data-testid={`${testId}-empty`}
          >
            {bundles.length === 0 ? '暂无 bundle，点击 + 添加创建第一个' : '请选择 bundle'}
          </div>
        ) : activeBundle.items.length === 0 ? (
          <div
            className="text-xs text-[var(--text-tertiary)] p-2"
            data-testid={`${testId}-empty-items`}
          >
            bundle 为空，点击 + 添加上下文项
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {activeBundle.items.map((item) => (
              <ContextItemCard
                key={item.item_id}
                item={item}
                onRemove={() => removeItem(activeBundle.bundle_id, item.item_id)}
                testId={`${testId}-item-${item.item_id}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ContextItemCard({
  item,
  onRemove,
  testId,
}: {
  item: ContextItem;
  onRemove: () => void;
  testId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => {
    if (item.source_type === 'file' || item.source_type === 'code') {
      return String(item.source_data.path || '');
    }
    if (item.source_type === 'git') {
      return `${item.source_data.repo_path || ''} (${item.source_data.type || 'log'})`;
    }
    if (item.source_type === 'terminal') {
      return String(item.source_data.command || '');
    }
    if (item.source_type === 'web' || item.source_type === 'document') {
      return String(item.source_data.url || item.source_data.path || '');
    }
    return JSON.stringify(item.source_data);
  }, [item]);

  return (
    <div
      className="border border-[var(--border-color)] rounded p-2 bg-[var(--bg-elevated)]"
      data-testid={testId}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 text-xs">
            <span>{SOURCE_ICONS[item.source_type]}</span>
            <span className="text-[var(--text-secondary)]">{SOURCE_LABELS[item.source_type]}</span>
            <span className="text-[var(--text-tertiary)] truncate" title={summary}>
              {summary}
            </span>
          </div>
          <div className="mt-1 text-xs text-[var(--text-tertiary)]">
            {item.error ? (
              <span className="text-red-400">⚠ {item.error}</span>
            ) : (
              <>
                ✓ {item.token_count} tokens
                {item.loaded_at > 0 && (
                  <span className="ml-2">
                    加载于 {new Date(item.loaded_at * 1000).toLocaleTimeString()}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          {item.content && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-1"
              data-testid={`${testId}-toggle`}
            >
              {expanded ? '▲' : '▼'}
            </button>
          )}
          <button
            onClick={onRemove}
            className="text-xs text-[var(--text-secondary)] hover:text-red-400 px-1"
            data-testid={`${testId}-remove`}
            title="移除"
          >
            ✕
          </button>
        </div>
      </div>
      {expanded && item.content && (
        <pre
          className="mt-2 p-2 text-xs bg-[var(--bg-app)] rounded overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap"
          data-testid={`${testId}-content`}
        >
          {item.content}
        </pre>
      )}
    </div>
  );
}

export default ContextSelector;
