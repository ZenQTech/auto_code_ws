/**
 * # ============================================================
 * # AgentsMdResolverPanel (v1.0.0)
 * # Cycle 70 G70-01
 * # ====================================
 * # 核心作用：可视化 AGENTS.md 多层级解析结果（Codex 风格）
 * # 功能：
 * #   1. 输入 cwd + 可选 config
 * #   2. 显示分层（global/project/directory）
 * #   3. 字节限制状态 + 截断提示
 * #   4. 项目根检测
 * #   5. 合并内容预览
 * #   6. 配置管理（max_bytes/max_depth/developer_instructions）
 * # 输入参数：isOpen, onClose, defaultCwd
 * # 输出结果：可交互的 AGENTS.md 解析面板
 * # 对标：Codex CLI v0.124.0+ AGENTS.md Multi-Level Discovery
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 70 G70-01 初次创建
 * # ====================================
 */

import React, { useState, useEffect } from 'react';
import { useAgentsMdV2, type LayerScope, type ResolvedLayer } from '../hooks/useAgentsMdV2';

interface AgentsMdResolverPanelProps {
  isOpen: boolean;
  onClose: () => void;
  defaultCwd?: string;
}

const SCOPE_COLORS: Record<LayerScope, string> = {
  developer: 'bg-pink-100 text-pink-700',
  global: 'bg-purple-100 text-purple-700',
  project: 'bg-blue-100 text-blue-700',
  directory: 'bg-green-100 text-green-700',
  model_override: 'bg-orange-100 text-orange-700',
};

const SCOPE_LABELS: Record<LayerScope, string> = {
  developer: '开发者注入',
  global: '全局',
  project: '项目',
  directory: '目录',
  model_override: '模型覆盖',
};

export const AgentsMdResolverPanel: React.FC<AgentsMdResolverPanelProps> = ({
  isOpen,
  onClose,
  defaultCwd = '',
}) => {
  const {
    resolved,
    config,
    loading,
    error,
    resolve,
    loadConfig,
    saveConfig,
    detectRoot,
  } = useAgentsMdV2();

  const [cwd, setCwd] = useState(defaultCwd);
  const [maxBytes, setMaxBytes] = useState<number>(32 * 1024);
  const [maxDepth, setMaxDepth] = useState<number>(10);
  const [developerInstructions, setDeveloperInstructions] = useState<string>('');
  const [rootInfo, setRootInfo] = useState<{
    project_root: string | null;
    marker_found: string | null;
    depth: number;
  } | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // hook 内部已经处理
      void loadConfig();
    }
  }, [isOpen, loadConfig]);

  useEffect(() => {
    if (config) {
      setMaxBytes(config.max_bytes);
      setMaxDepth(config.max_depth);
      setDeveloperInstructions(config.developer_instructions || '');
    }
  }, [config]);

  useEffect(() => {
    if (defaultCwd && !cwd) {
      setCwd(defaultCwd);
    }
  }, [defaultCwd, cwd]);

  const handleResolve = async () => {
    if (!cwd.trim()) return;
    await resolve(cwd, {
      max_bytes: maxBytes,
      max_depth: maxDepth,
      developer_instructions: developerInstructions,
    });
    // 同时检测项目根
    const info = await detectRoot(cwd);
    if (info) {
      setRootInfo({
        project_root: info.project_root,
        marker_found: info.marker_found,
        depth: info.depth,
      });
    }
  };

  const handleSaveConfig = async () => {
    if (!config) return;
    setSavingConfig(true);
    try {
      await saveConfig({
        ...config,
        max_bytes: maxBytes,
        max_depth: maxDepth,
        developer_instructions: developerInstructions,
      });
    } finally {
      setSavingConfig(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="agents-md-resolver-panel"
    >
      <div className="bg-white rounded-lg shadow-xl w-[1080px] max-w-[95vw] h-[720px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📚</span>
            <h2 className="text-lg font-semibold">AGENTS.md 多层级解析</h2>
            <span className="text-xs text-gray-500">Codex 兼容</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-xl"
            data-testid="agents-md-close"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="px-5 py-2 bg-red-50 text-red-700 text-sm border-b border-red-200">
            {error}
          </div>
        )}

        {/* 输入区 */}
        <div className="px-5 py-3 border-b bg-gray-50 space-y-2">
          <div className="flex gap-2 items-center">
            <span className="text-xs text-gray-500 whitespace-nowrap w-16">CWD:</span>
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="/path/to/project"
              className="flex-1 px-2 py-1 text-sm border rounded font-mono"
              data-testid="cwd-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleResolve();
              }}
            />
            <button
              onClick={handleResolve}
              disabled={loading || !cwd.trim()}
              className="px-4 py-1 text-sm bg-indigo-500 text-white rounded hover:bg-indigo-600 disabled:opacity-50"
              data-testid="resolve-btn"
            >
              {loading ? '解析中…' : '解析'}
            </button>
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="px-2 py-1 text-sm border rounded hover:bg-gray-100"
              data-testid="toggle-config-btn"
            >
              {showConfig ? '隐藏配置' : '配置'}
            </button>
          </div>

          {showConfig && (
            <div className="grid grid-cols-2 gap-2 p-2 bg-white rounded border">
              <label className="text-xs text-gray-600 flex items-center gap-2">
                最大字节:
                <input
                  type="number"
                  value={maxBytes}
                  onChange={(e) => setMaxBytes(Number(e.target.value))}
                  className="w-24 px-1 py-0.5 text-xs border rounded"
                  data-testid="config-max-bytes"
                />
              </label>
              <label className="text-xs text-gray-600 flex items-center gap-2">
                最大深度:
                <input
                  type="number"
                  value={maxDepth}
                  onChange={(e) => setMaxDepth(Number(e.target.value))}
                  className="w-16 px-1 py-0.5 text-xs border rounded"
                  data-testid="config-max-depth"
                />
              </label>
              <label className="text-xs text-gray-600 col-span-2 flex flex-col gap-1">
                开发者指令（注入到所有 AGENTS.md 之前）:
                <textarea
                  value={developerInstructions}
                  onChange={(e) => setDeveloperInstructions(e.target.value)}
                  className="w-full px-2 py-1 text-xs border rounded font-mono"
                  rows={2}
                  data-testid="config-developer-instructions"
                />
              </label>
              <div className="col-span-2">
                <button
                  onClick={handleSaveConfig}
                  disabled={savingConfig}
                  className="px-3 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
                  data-testid="save-config-btn"
                >
                  {savingConfig ? '保存中…' : '保存配置'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 状态栏 */}
        {resolved && (
          <div className="px-5 py-2 border-b bg-blue-50 text-xs flex flex-wrap gap-4">
            <span>
              <strong>层数:</strong>{' '}
              <span data-testid="resolved-layer-count">{resolved.layer_count}</span>
            </span>
            <span>
              <strong>字节:</strong>{' '}
              <span data-testid="resolved-total-bytes">
                {resolved.total_bytes}/{resolved.max_bytes}
              </span>
              {resolved.is_truncated && (
                <span className="ml-1 text-red-600" data-testid="truncated-badge">
                  截断 {resolved.truncated_count}
                </span>
              )}
            </span>
            {resolved.project_root && (
              <span>
                <strong>项目根:</strong>{' '}
                <code className="bg-white px-1 rounded">{resolved.project_root}</code>
              </span>
            )}
            {rootInfo?.marker_found && (
              <span>
                <strong>检测标记:</strong>{' '}
                <code className="bg-white px-1 rounded">{rootInfo.marker_found}</code>
              </span>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {!resolved && !loading && (
            <div className="text-center py-12 text-gray-500 text-sm">
              请输入 cwd 并点击"解析"
            </div>
          )}

          {loading && (
            <div className="text-center py-12 text-gray-500 text-sm">解析中…</div>
          )}

          {resolved && (
            <div className="space-y-4">
              {/* 层列表 */}
              <div>
                <h3 className="text-sm font-semibold mb-2">
                  分层 (按优先级合并)
                </h3>
                <div className="space-y-2" data-testid="layers-list">
                  {resolved.layers.length === 0 ? (
                    <div className="text-gray-500 text-xs italic">
                      未发现任何 AGENTS.md
                    </div>
                  ) : (
                    resolved.layers.map((layer, idx) => (
                      <LayerCard key={idx} layer={layer} />
                    ))
                  )}
                </div>
              </div>

              {/* 合并内容 */}
              {resolved.merged_content && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">合并内容预览</h3>
                  <pre
                    className="text-xs bg-gray-50 p-3 rounded border overflow-x-auto whitespace-pre-wrap"
                    data-testid="merged-content"
                  >
                    {resolved.merged_content}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Layer card 子组件
const LayerCard: React.FC<{ layer: ResolvedLayer }> = ({ layer }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="border rounded p-3 hover:bg-gray-50"
      data-testid={`layer-item-${layer.level}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">L{layer.level}</span>
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                SCOPE_COLORS[layer.scope]
              }`}
              data-testid={`layer-scope-${layer.level}`}
            >
              {SCOPE_LABELS[layer.scope]}
            </span>
            {layer.source !== 'AGENTS.md' && (
              <span className="text-xs text-gray-500">({layer.source})</span>
            )}
            {layer.is_truncated && (
              <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                已截断
              </span>
            )}
            <span className="text-xs text-gray-400">
              {layer.size} bytes
            </span>
          </div>
          <div className="text-xs text-gray-600 mt-1 font-mono truncate">
            {layer.path || '(inline)'}
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs px-2 py-1 border rounded hover:bg-gray-100 ml-2 flex-shrink-0"
          data-testid={`layer-expand-${layer.level}`}
        >
          {expanded ? '收起' : '展开'}
        </button>
      </div>
      {expanded && (
        <pre className="text-xs bg-gray-50 p-2 rounded mt-2 overflow-x-auto whitespace-pre-wrap">
          {layer.content}
        </pre>
      )}
    </div>
  );
};

export default AgentsMdResolverPanel;
