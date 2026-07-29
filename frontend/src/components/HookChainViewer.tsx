/**
 * # ============================================================
 * # HookChainViewer - Hook 链路可视化 (v1.0.0 Cycle 21 G21-02)
 * # ============================================================
 * # 核心作用：可视化 Hook 执行链路（时间线 / DAG / 列表三种模式）
 * # 主要功能：
 * #   1. 时间线模式：横向条形图展示 hook 执行序列
 * #   2. DAG 模式：节点 + 边展示触发关系
 * #   3. 列表模式：表格展示所有节点
 * #   4. 导出 Mermaid / JSON 格式
 * #   5. 实时更新新链路
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 21 G21-02 初次创建
 * # ============================================================
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getHookChainTracker,
  type HookChain,
  type HookChainNode,
  type ChainEvent,
  type HookType,
} from '../utils/hookChainTracker';

interface HookChainViewerProps {
  isOpen?: boolean;
  onClose: () => void;
}

type ViewMode = 'timeline' | 'dag' | 'list';

const STATUS_COLORS: Record<HookChainNode['status'], string> = {
  pending: 'bg-slate-500',
  running: 'bg-blue-500 animate-pulse',
  success: 'bg-green-500',
  failed: 'bg-red-500',
  timeout: 'bg-orange-500',
  cancelled: 'bg-slate-400',
};

const STATUS_TEXT_COLORS: Record<HookChainNode['status'], string> = {
  pending: 'text-slate-300',
  running: 'text-blue-300',
  success: 'text-green-300',
  failed: 'text-red-300',
  timeout: 'text-orange-300',
  cancelled: 'text-slate-400',
};

const CHAIN_STATUS_LABELS: Record<HookChain['status'], string> = {
  running: '执行中',
  success: '成功',
  failed: '失败',
  partial: '部分失败',
};

const TYPE_COLORS: Record<HookType, string> = {
  before_prompt: 'bg-blue-500/20 text-blue-300',
  after_prompt: 'bg-blue-500/20 text-blue-300',
  before_response: 'bg-purple-500/20 text-purple-300',
  after_response: 'bg-purple-500/20 text-purple-300',
  thinking: 'bg-yellow-500/20 text-yellow-300',
  subagent_start: 'bg-pink-500/20 text-pink-300',
  subagent_end: 'bg-pink-500/20 text-pink-300',
  compaction: 'bg-orange-500/20 text-orange-300',
  turn_complete: 'bg-green-500/20 text-green-300',
  tool_execution: 'bg-cyan-500/20 text-cyan-300',
};

export function HookChainViewer({ isOpen: isOpenProp = true, onClose }: HookChainViewerProps) {
  const isOpen = isOpenProp;
  const tracker = useMemo(() => getHookChainTracker(), []);
  const [chains, setChains] = useState<HookChain[]>([]);
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [exportedFormat, setExportedFormat] = useState<string>('');

  // 刷新链路列表
  useEffect(() => {
    if (!isOpen) return;
    const refresh = () => {
      setChains(tracker.getChains({ sortBy: 'startTime', sortOrder: 'desc', limit: 50 }));
    };
    refresh();
    const unsub = (_event: ChainEvent) => {
      refresh();
    };
    const off1 = tracker.on('chain-started', unsub);
    const off2 = tracker.on('chain-finished', unsub);
    const off3 = tracker.on('node-added', unsub);
    return () => {
      off1();
      off2();
      off3();
    };
  }, [tracker, isOpen]);

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // 选中的链路
  const selectedChain = useMemo(
    () => chains.find((c) => c.chainId === selectedChainId) ?? chains[0] ?? null,
    [chains, selectedChainId]
  );

  // 模拟创建测试链路（演示用）
  const handleCreateDemo = useCallback(() => {
    const event = {
      id: `demo-evt-${Date.now()}`,
      type: 'before_prompt' as HookType,
      hookId: 'demo-hook',
      payload: { prompt: 'demo' },
      timestamp: Date.now(),
    };
    const chain = tracker.startChain(event);
    const node1 = tracker.addNode(chain.chainId, {
      hookId: 'h1',
      hookName: 'Lint Check',
      hookType: 'before_prompt',
    });
    setTimeout(() => {
      tracker.updateNode(chain.chainId, node1.nodeId, { status: 'success' });
      const node2 = tracker.addNode(chain.chainId, {
        hookId: 'h2',
        hookName: 'AI Response',
        hookType: 'after_response',
        triggeredByNodeId: node1.nodeId,
      });
      setTimeout(() => {
        tracker.updateNode(chain.chainId, node2.nodeId, { status: 'success' });
        tracker.finishChain(chain.chainId, 'success');
      }, 100);
    }, 100);
  }, [tracker]);

  // 导出
  const handleExport = useCallback(
    (format: 'json' | 'mermaid' | 'dot') => {
      if (!selectedChain) return;
      setExportedFormat(tracker.exportChain(selectedChain.chainId, format));
    },
    [tracker, selectedChain]
  );

  if (!isOpen) return null;

  // 统计
  const stats = tracker.getStats();

  return (
    <div
      data-testid="hook-chain-viewer"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gradient-to-br from-surface-900 to-surface-950 border border-surface-700 rounded-2xl w-[1100px] max-w-[95vw] max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-surface-700">
          <div>
            <h2 className="text-xl font-semibold text-white">Hook 链路可视化</h2>
            <p className="text-sm text-slate-400 mt-1">
              链路: {stats.totalChains} · 节点: {stats.totalNodes} · 执行中: {stats.runningCount} · 成功率: {(stats.successRate * 100).toFixed(0)}%
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-surface-700 transition"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧：链路列表 */}
          <div className="w-72 border-r border-surface-700 overflow-y-auto">
            <div className="p-3 space-y-1">
              <button
                onClick={handleCreateDemo}
                data-testid="create-demo-chain"
                className="w-full px-3 py-2 bg-primary-500/20 hover:bg-primary-500/30 text-primary-300 text-sm rounded border border-primary-500/30"
              >
                + 创建演示链路
              </button>
            </div>
            <div className="space-y-1 px-2" data-testid="chain-list">
              {chains.length === 0 ? (
                <div className="text-center text-slate-500 text-sm py-8">暂无链路</div>
              ) : (
                chains.map((c) => (
                  <button
                    key={c.chainId}
                    onClick={() => setSelectedChainId(c.chainId)}
                    data-testid={`chain-${c.chainId}`}
                    className={`w-full text-left px-3 py-2 rounded border transition ${
                      selectedChain?.chainId === c.chainId
                        ? 'bg-primary-500/20 border-primary-500/50'
                        : 'bg-surface-800/50 border-surface-700 hover:border-surface-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-white truncate">{c.triggerType}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        c.status === 'success' ? 'bg-green-500/20 text-green-300' :
                        c.status === 'failed' ? 'bg-red-500/20 text-red-300' :
                        c.status === 'running' ? 'bg-blue-500/20 text-blue-300 animate-pulse' :
                        'bg-slate-500/20 text-slate-300'
                      }`}>
                        {CHAIN_STATUS_LABELS[c.status]}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {c.nodes.length} 节点 · {c.totalDuration ?? 0}ms
                    </div>
                    <div className="text-xs text-slate-600">
                      {new Date(c.startTime).toLocaleTimeString()}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* 右侧：详情 */}
          <div className="flex-1 overflow-y-auto p-4">
            {selectedChain ? (
              <div className="space-y-4">
                {/* 视图切换 */}
                <div className="flex items-center justify-between">
                  <div className="flex gap-1">
                    {(['timeline', 'dag', 'list'] as ViewMode[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setViewMode(m)}
                        data-testid={`view-${m}`}
                        className={`px-3 py-1 text-sm rounded ${
                          viewMode === m
                            ? 'bg-primary-500/20 text-primary-300'
                            : 'bg-surface-800 text-slate-400 hover:bg-surface-700'
                        }`}
                      >
                        {m === 'timeline' ? '时间线' : m === 'dag' ? 'DAG' : '列表'}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleExport('json')}
                      data-testid="export-json"
                      className="px-2 py-1 text-xs bg-surface-800 text-slate-300 rounded hover:bg-surface-700"
                    >
                      导出 JSON
                    </button>
                    <button
                      onClick={() => handleExport('mermaid')}
                      data-testid="export-mermaid"
                      className="px-2 py-1 text-xs bg-surface-800 text-slate-300 rounded hover:bg-surface-700"
                    >
                      导出 Mermaid
                    </button>
                    <button
                      onClick={() => handleExport('dot')}
                      data-testid="export-dot"
                      className="px-2 py-1 text-xs bg-surface-800 text-slate-300 rounded hover:bg-surface-700"
                    >
                      导出 DOT
                    </button>
                  </div>
                </div>

                {/* 导出结果 */}
                {exportedFormat && (
                  <pre
                    data-testid="export-result"
                    className="bg-surface-800 border border-surface-700 rounded p-3 text-xs text-slate-300 overflow-x-auto max-h-40"
                  >
                    {exportedFormat}
                  </pre>
                )}

                {/* 链路信息 */}
                <div className="bg-surface-800/50 rounded-lg p-3 border border-surface-700">
                  <div className="text-sm text-slate-300">
                    <span className="text-slate-500">触发类型:</span> {selectedChain.triggerType}
                  </div>
                  <div className="text-sm text-slate-300">
                    <span className="text-slate-500">状态:</span> {CHAIN_STATUS_LABELS[selectedChain.status]}
                  </div>
                  <div className="text-sm text-slate-300">
                    <span className="text-slate-500">开始时间:</span> {new Date(selectedChain.startTime).toLocaleString()}
                  </div>
                  {selectedChain.totalDuration !== undefined && (
                    <div className="text-sm text-slate-300">
                      <span className="text-slate-500">总耗时:</span> {selectedChain.totalDuration}ms
                    </div>
                  )}
                </div>

                {/* 视图内容 */}
                {viewMode === 'timeline' && (
                  <div data-testid="timeline-view" className="bg-surface-800/30 rounded-lg p-3 border border-surface-700">
                    <h3 className="text-sm font-medium text-slate-300 mb-3">时间线</h3>
                    <TimelineView chain={selectedChain} />
                  </div>
                )}

                {viewMode === 'dag' && (
                  <div data-testid="dag-view" className="bg-surface-800/30 rounded-lg p-3 border border-surface-700">
                    <h3 className="text-sm font-medium text-slate-300 mb-3">DAG</h3>
                    <DagView chain={selectedChain} />
                  </div>
                )}

                {viewMode === 'list' && (
                  <div data-testid="list-view" className="space-y-2">
                    <h3 className="text-sm font-medium text-slate-300 mb-3">节点列表</h3>
                    {selectedChain.nodes.map((node) => (
                      <div
                        key={node.nodeId}
                        className="bg-surface-800/50 rounded-lg p-3 border border-surface-700"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[node.status]}`}></span>
                            <span className="font-medium text-white">{node.hookName}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_COLORS[node.hookType]}`}>
                              {node.hookType}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500">
                            depth: {node.depth} · {node.duration ?? 0}ms · p:{node.priority}
                          </div>
                        </div>
                        {node.error && (
                          <div className="text-xs text-red-400 mt-2">错误: {node.error}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center text-slate-500 py-12">选择一条链路查看详情</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 时间线视图
function TimelineView({ chain }: { chain: HookChain }) {
  if (chain.nodes.length === 0) {
    return <div className="text-slate-500 text-sm">无节点</div>;
  }
  const start = chain.startTime;
  const end = chain.endTime ?? Date.now();
  const total = end - start || 1;

  return (
    <div className="space-y-2">
      {chain.nodes.map((node) => {
        const offset = ((node.startTime - start) / total) * 100;
        const width = (((node.duration ?? 50) / total) * 100) || 2;
        return (
          <div key={node.nodeId} className="flex items-center gap-2 text-xs">
            <span className="w-32 truncate text-slate-300" title={node.hookName}>
              {node.hookName}
            </span>
            <div className="flex-1 h-4 bg-surface-900 rounded relative">
              <div
                className={`absolute h-4 rounded ${STATUS_COLORS[node.status]}`}
                style={{ left: `${offset}%`, width: `${Math.max(width, 1)}%`, minWidth: '8px' }}
                title={`${node.hookName}: ${node.duration ?? 0}ms`}
              ></div>
            </div>
            <span className={`w-20 text-right ${STATUS_TEXT_COLORS[node.status]}`}>
              {node.duration ?? 0}ms
            </span>
          </div>
        );
      })}
    </div>
  );
}

// DAG 视图
function DagView({ chain }: { chain: HookChain }) {
  if (chain.nodes.length === 0) {
    return <div className="text-slate-500 text-sm">无节点</div>;
  }

  // 按层分组
  const layers: Record<number, HookChainNode[]> = {};
  chain.nodes.forEach((n) => {
    if (!layers[n.depth]) layers[n.depth] = [];
    layers[n.depth]!.push(n);
  });

  return (
    <div className="space-y-3">
      {Object.keys(layers).map((depth) => (
        <div key={depth} className="flex items-center gap-2">
          <span className="text-xs text-slate-500 w-12">L{depth}</span>
          <div className="flex flex-wrap gap-2">
            {layers[Number(depth)]?.map((node) => (
              <div
                key={node.nodeId}
                className={`px-2 py-1 rounded text-xs border ${
                  node.status === 'success'
                    ? 'bg-green-500/20 border-green-500/30 text-green-300'
                    : node.status === 'failed'
                    ? 'bg-red-500/20 border-red-500/30 text-red-300'
                    : node.status === 'running'
                    ? 'bg-blue-500/20 border-blue-500/30 text-blue-300 animate-pulse'
                    : 'bg-slate-500/20 border-slate-500/30 text-slate-300'
                }`}
                title={`${node.hookName} (${node.hookType})`}
              >
                {node.hookName}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default HookChainViewer;
