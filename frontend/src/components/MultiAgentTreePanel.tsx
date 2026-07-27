/**
 * # ============================================================
 * MultiAgentTreePanel - Multi-Agent v2 Path Tree 可视化（v1.0.0）
 * # ============================================================
 * 核心作用：可视化 Codex v0.121+ Multi-Agent v2 path-based addressing
 *           多智能体编排系统，支持 spawn/wait/close 工具操作
 * 设计要点：
 *   1. 路径树状渲染：/root/researcher/summarizer 层级展开
 *   2. 状态徽章：pending / running / completed / failed / closed 彩色显示
 *   3. 槽位统计：active/max_threads, depth/max_depth, 状态分布
 *   4. 消息列表：跨层级 send_message 历史
 *   5. 自动折叠：超过阈值 completed 节点自动折叠（useNodeAutoCollapse）
 *   6. 操作按钮：spawn / wait / close / clean / list
 * 运行流程：
 *   1. 用户输入 session_id（默认 "default"）
 *   2. 自动加载 /api/multi-agents/{tree,stats,messages}
 *   3. 渲染树状结构 + 统计 + 消息列表
 *   4. 操作按钮调用对应 API 并刷新数据
 * 输入参数：onClose 回调
 * 输出结果：完整的 MultiAgent 管理面板 DOM
 * 复用说明：
 *   - 调用 /api/multi-agents/* 13 个端点
 *   - 复用 useNodeAutoCollapse 实现节点自动折叠
 *   - 对应后端 backend/app/services/multi_agent_registry.py
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P0-10 新建
 * ============================================================
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNodeAutoCollapse } from '../hooks/useNodeAutoCollapse';

const API_BASE = '/api/multi-agents';

// ============================================================
// 类型定义
// ============================================================

interface SubAgentNode {
  path: string;
  task_name: string;
  parent_path: string | null;
  subagent_id: string;
  model: string;
  sandbox: string;
  status: string;
  created_at: number;
  started_at: number | null;
  closed_at: number | null;
  result: string | null;
  error: string | null;
  depth: number;
  message: string;
  metadata: Record<string, any>;
  children: SubAgentNode[];
}

interface Stats {
  total: number;
  active_slots: number;
  max_threads: number;
  max_depth: number;
  max_actual_depth: number;
  by_status: Record<string, number>;
  message_count: number;
}

interface SubAgentMessage {
  msg_id: string;
  from_path: string;
  to_path: string;
  body: string;
  msg_type: string;
  sent_at: number;
  read: boolean;
}

export interface MultiAgentTreePanelProps {
  onClose: () => void;
}

// ============================================================
// 工具函数
// ============================================================

async function apiGet(path: string): Promise<any> {
  const resp = await fetch(`${API_BASE}${path}`);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
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
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  running: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  completed: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  failed: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  closed: 'bg-surface-500/20 text-surface-400 border-surface-500/40',
};

const STATUS_ICON: Record<string, string> = {
  pending: '⏳',
  running: '⚡',
  completed: '✓',
  failed: '✗',
  closed: '⊘',
};

const STATUS_LABEL: Record<string, string> = {
  pending: '待启动',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  closed: '已关闭',
};

function formatTimestamp(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleTimeString();
}

function truncate(s: string, max: number = 60): string {
  if (!s) return '';
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function durationSec(start: number | null, end: number | null): number {
  if (!start) return 0;
  return (end || Date.now() / 1000) - start;
}

// ============================================================
// 子组件：树节点
// ============================================================

interface TreeNodeProps {
  node: SubAgentNode;
  depth: number;
  collapsedMap: Record<string, boolean>;
  isVisible: (path: string) => boolean;
  isCollapsed: (path: string) => boolean;
  toggleCollapse: (path: string) => void;
  onWait: (path: string) => void;
  onClose: (path: string, recursive: boolean) => void;
  onSignal: (path: string) => void;
  onFollowup: (path: string) => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({
  node,
  depth,
  collapsedMap,
  isVisible,
  isCollapsed,
  toggleCollapse,
  onWait,
  onClose,
  onSignal,
  onFollowup,
}) => {
  if (!isVisible(node.path)) return null;

  const hasChildren = node.children && node.children.length > 0;
  const collapsed = isCollapsed(node.path);
  const dur = durationSec(node.started_at, node.closed_at);

  return (
    <>
      <div
        className="group flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-surface-200/50 transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* 折叠/展开箭头 */}
        {hasChildren ? (
          <button
            onClick={() => toggleCollapse(node.path)}
            className="w-4 h-4 flex items-center justify-center text-surface-500 hover:text-surface-900 transition-colors"
            aria-label={collapsed ? '展开' : '折叠'}
          >
            {collapsed ? '▶' : '▼'}
          </button>
        ) : (
          <span className="w-4 h-4 flex items-center justify-center text-surface-400">·</span>
        )}

        {/* 路径 */}
        <span className="font-mono text-xs text-surface-700 truncate max-w-[200px]" title={node.path}>
          {depth === 0 ? '🌳' : '📄'} <span className="font-semibold">{node.task_name}</span>
        </span>

        {/* 状态徽章 */}
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded-full border ${STATUS_COLOR[node.status] || STATUS_COLOR.pending}`}
        >
          {STATUS_ICON[node.status]} {STATUS_LABEL[node.status] || node.status}
        </span>

        {/* 模型 */}
        <span className="text-[10px] text-surface-500 font-mono">{node.model}</span>

        {/* 时长 */}
        {node.started_at && (
          <span className="text-[10px] text-surface-500">
            {dur > 0 ? `${dur.toFixed(1)}s` : ''}
          </span>
        )}

        {/* 子节点计数 */}
        {hasChildren && (
          <span className="text-[10px] text-surface-500">
            ({node.children!.length} 个子节点)
          </span>
        )}

        {/* 操作按钮（hover 出现） */}
        <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
          {node.status === 'running' && (
            <>
              <button
                onClick={() => onWait(node.path)}
                className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 border border-blue-500/30"
                title="等待完成"
              >
                ⏳ wait
              </button>
              <button
                onClick={() => onSignal(node.path)}
                className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30"
                title="标记完成"
              >
                ✓ done
              </button>
            </>
          )}
          {node.status !== 'closed' && (
            <button
              onClick={() => onClose(node.path, false)}
              className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/30"
              title="关闭节点"
            >
              🛑 close
            </button>
          )}
          {node.status === 'closed' && (
            <button
              onClick={() => onFollowup(node.path)}
              className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30"
              title="发起后续任务"
            >
              🔄 followup
            </button>
          )}
        </div>
      </div>

      {/* 子节点（如果未折叠） */}
      {hasChildren && !collapsed && (
        <>
          {node.children!.map(child => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              collapsedMap={collapsedMap}
              isVisible={isVisible}
              isCollapsed={isCollapsed}
              toggleCollapse={toggleCollapse}
              onWait={onWait}
              onClose={onClose}
              onSignal={onSignal}
              onFollowup={onFollowup}
            />
          ))}
        </>
      )}

      {/* 折叠摘要 */}
      {hasChildren && collapsed && (
        <div
          className="text-[10px] text-surface-500 italic"
          style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
        >
          … {node.children!.length} 个子节点已折叠（点击 ▶ 展开）
        </div>
      )}
    </>
  );
};

// ============================================================
// 主组件
// ============================================================

export const MultiAgentTreePanel: React.FC<MultiAgentTreePanelProps> = ({ onClose }) => {
  // Session ID（默认 "default"）
  const [sessionId, setSessionId] = useState('default');

  // 数据状态
  const [tree, setTree] = useState<SubAgentNode | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [messages, setMessages] = useState<SubAgentMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string>('');

  // Spawn 表单
  const [showSpawnForm, setShowSpawnForm] = useState(false);
  const [spawnParent, setSpawnParent] = useState('/root');
  const [spawnTaskName, setSpawnTaskName] = useState('');
  const [spawnMessage, setSpawnMessage] = useState('');
  const [spawnModel, setSpawnModel] = useState('claude-sonnet');

  // 自动折叠设置
  const [autoCollapseEnabled, setAutoCollapseEnabled] = useState(true);
  const [autoCollapseThreshold, setAutoCollapseThreshold] = useState(5);

  // 自动刷新
  const [autoRefresh, setAutoRefresh] = useState(false);
  const refreshIntervalRef = useRef<number | null>(null);

  // ============================================================
  // 数据加载
  // ============================================================

  const loadData = useCallback(async (sid: string) => {
    setLoading(true);
    setError(null);
    try {
      const [treeResp, statsResp, msgResp] = await Promise.all([
        apiGet(`/tree?session_id=${encodeURIComponent(sid)}`),
        apiGet(`/stats?session_id=${encodeURIComponent(sid)}`),
        apiGet(`/messages?session_id=${encodeURIComponent(sid)}&limit=20`),
      ]);
      setTree(treeResp.tree || null);
      setStats(statsResp.stats || null);
      setMessages(msgResp.messages || []);
    } catch (e) {
      setError(`加载失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(sessionId);
  }, [sessionId, loadData]);

  // 自动刷新
  useEffect(() => {
    if (autoRefresh) {
      refreshIntervalRef.current = window.setInterval(() => {
        loadData(sessionId);
      }, 3000);
      return () => {
        if (refreshIntervalRef.current !== null) {
          window.clearInterval(refreshIntervalRef.current);
          refreshIntervalRef.current = null;
        }
      };
    } else if (refreshIntervalRef.current !== null) {
      window.clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
  }, [autoRefresh, sessionId, loadData]);

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // 节点数组（从 tree 提取）
  const flatNodes = useMemo<SubAgentNode[]>(() => {
    if (!tree) return [];
    const result: SubAgentNode[] = [];
    const visit = (n: SubAgentNode) => {
      result.push(n);
      if (n.children) {
        for (const c of n.children) visit(c);
      }
    };
    visit(tree);
    return result;
  }, [tree]);

  // 自动折叠
  const {
    collapsedMap,
    toggleCollapse,
    expandAll,
    collapseAll,
    isCollapsed,
    isVisible,
  } = useNodeAutoCollapse(flatNodes, {
    enabled: autoCollapseEnabled,
    threshold: autoCollapseThreshold,
    storageKey: `multiagent_autocollapse_${sessionId}`,
  });

  // ============================================================
  // 操作回调
  // ============================================================

  const handleSpawn = useCallback(async () => {
    if (!spawnTaskName.trim() || !spawnMessage.trim()) {
      setError('task_name 和 message 不能为空');
      return;
    }
    setError(null);
    setActionMessage('正在 spawn SubAgent...');
    try {
      const result = await apiSend('POST', '/spawn', {
        session_id: sessionId,
        parent_path: spawnParent,
        task_name: spawnTaskName,
        message: spawnMessage,
        model: spawnModel,
      });
      setActionMessage(`✓ 已创建 ${result.path} (depth=${result.depth})`);
      setShowSpawnForm(false);
      setSpawnTaskName('');
      setSpawnMessage('');
      await loadData(sessionId);
    } catch (e) {
      setError(`spawn 失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [sessionId, spawnParent, spawnTaskName, spawnMessage, spawnModel, loadData]);

  const handleWait = useCallback(async (target: string) => {
    setError(null);
    setActionMessage(`等待 ${target} 完成...`);
    try {
      const result = await apiSend('POST', '/wait', {
        session_id: sessionId,
        target,
        timeout: 5,
      });
      if (result.success) {
        setActionMessage(`✓ ${target}: ${result.status} (${(result.duration_sec || 0).toFixed(2)}s)`);
      } else {
        setError(`wait: ${result.error}`);
      }
      await loadData(sessionId);
    } catch (e) {
      setError(`wait 失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [sessionId, loadData]);

  const handleClose = useCallback(async (target: string, recursive: boolean) => {
    if (!confirm(`确认关闭 ${target}${recursive ? '（含子节点）' : ''}？`)) return;
    setError(null);
    setActionMessage(`关闭 ${target}...`);
    try {
      const result = await apiSend('POST', '/close', {
        session_id: sessionId,
        target,
        recursive,
      });
      setActionMessage(`✓ 已关闭 ${result.closed} 个节点`);
      await loadData(sessionId);
    } catch (e) {
      setError(`close 失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [sessionId, loadData]);

  const handleSignal = useCallback(async (target: string) => {
    setError(null);
    setActionMessage(`标记 ${target} 完成...`);
    try {
      await apiSend('POST', '/signal-completion', {
        session_id: sessionId,
        target,
        result: '手动标记完成',
      });
      setActionMessage(`✓ ${target} 已标记完成`);
      await loadData(sessionId);
    } catch (e) {
      setError(`signal 失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [sessionId, loadData]);

  const handleFollowup = useCallback(async (target: string) => {
    const task = window.prompt('后续任务内容：', '继续之前的工作');
    if (!task) return;
    setError(null);
    setActionMessage(`对 ${target} 发起 followup...`);
    try {
      const result = await apiSend('POST', '/followup', {
        session_id: sessionId,
        from_path: '/root',
        to_path: target,
        task,
      });
      setActionMessage(`✓ followup 已发送${result.reactivated ? '（节点已重新激活）' : ''}`);
      await loadData(sessionId);
    } catch (e) {
      setError(`followup 失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [sessionId, loadData]);

  const handleAutoCleanup = useCallback(async () => {
    setError(null);
    setActionMessage('turn 结束自动清理...');
    try {
      const result = await apiSend('POST', '/auto-cleanup', {
        session_id: sessionId,
        parent_path: '/root',
      });
      setActionMessage(`✓ 清理了 ${result.cleaned} 个已完成节点的 slot`);
      await loadData(sessionId);
    } catch (e) {
      setError(`cleanup 失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [sessionId, loadData]);

  const handleClearAll = useCallback(async () => {
    if (!confirm(`确认清空 session "${sessionId}" 的所有 SubAgent？`)) return;
    setError(null);
    setActionMessage('清空中...');
    try {
      const result = await apiSend('POST', '/clear-all', { session_id: sessionId });
      setActionMessage(`✓ 已清空 ${result.cleared} 个节点`);
      await loadData(sessionId);
    } catch (e) {
      setError(`clear 失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [sessionId, loadData]);

  return (
    <div className="flex flex-col h-full max-h-[85vh] overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-surface-300/30 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🌳</span>
          <div>
            <h2 className="text-base font-bold text-surface-900">Multi-Agent v2 Path Tree</h2>
            <p className="text-[10px] text-surface-500 mt-0.5">
              Codex v0.121+ path-based · spawn/wait/close · 对应 TRAE Sub Agent 树状编排
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

      {/* 控制栏 */}
      <div className="px-5 py-3 border-b border-surface-300/20 bg-surface-50/40 flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            placeholder="session_id"
            className="text-xs px-2 py-1 rounded bg-white border border-surface-300/50 outline-none focus:border-hermes-500 w-32"
          />
          <button
            onClick={() => loadData(sessionId)}
            disabled={loading}
            className="text-xs px-2.5 py-1 rounded bg-hermes-500/20 text-hermes-300 hover:bg-hermes-500/30 border border-hermes-500/30 disabled:opacity-50"
          >
            {loading ? '⏳ 加载中' : '🔄 刷新'}
          </button>
          <label className="text-xs flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="cursor-pointer"
            />
            自动刷新 (3s)
          </label>

          <span className="text-surface-400">|</span>

          <button
            onClick={() => setShowSpawnForm(!showSpawnForm)}
            className="text-xs px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30"
          >
            🆕 Spawn
          </button>
          <button
            onClick={handleAutoCleanup}
            className="text-xs px-2.5 py-1 rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 border border-blue-500/30"
          >
            🧹 Auto Cleanup
          </button>
          <button
            onClick={expandAll}
            className="text-xs px-2.5 py-1 rounded bg-surface-200 text-surface-700 hover:bg-surface-300 border border-surface-300/50"
          >
            ⤢ 展开
          </button>
          <button
            onClick={collapseAll}
            className="text-xs px-2.5 py-1 rounded bg-surface-200 text-surface-700 hover:bg-surface-300 border border-surface-300/50"
          >
            ⤡ 折叠
          </button>
          <button
            onClick={handleClearAll}
            className="text-xs px-2.5 py-1 rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/30"
          >
            🗑️ Clear All
          </button>
        </div>

        {/* 自动折叠设置 */}
        <div className="mt-2 flex items-center gap-3 text-xs text-surface-600">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={autoCollapseEnabled}
              onChange={(e) => setAutoCollapseEnabled(e.target.checked)}
            />
            启用自动折叠
          </label>
          <label className="flex items-center gap-1">
            阈值：
            <input
              type="number"
              min={1}
              max={50}
              value={autoCollapseThreshold}
              onChange={(e) => setAutoCollapseThreshold(Math.max(1, parseInt(e.target.value, 10) || 5))}
              className="w-14 text-xs px-1.5 py-0.5 rounded bg-white border border-surface-300/50 outline-none focus:border-hermes-500"
            />
            个 completed 节点
          </label>
        </div>

        {/* Spawn 表单 */}
        {showSpawnForm && (
          <div className="mt-3 p-3 rounded-lg bg-surface-100 border border-surface-300/30 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-surface-600 w-20">Parent path:</span>
              <input
                type="text"
                value={spawnParent}
                onChange={(e) => setSpawnParent(e.target.value)}
                className="flex-1 px-2 py-1 rounded bg-white border border-surface-300/50 outline-none focus:border-hermes-500"
                placeholder="/root"
              />
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-surface-600 w-20">Task name:</span>
              <input
                type="text"
                value={spawnTaskName}
                onChange={(e) => setSpawnTaskName(e.target.value)}
                className="flex-1 px-2 py-1 rounded bg-white border border-surface-300/50 outline-none focus:border-hermes-500"
                placeholder="researcher"
              />
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-surface-600 w-20">Model:</span>
              <select
                value={spawnModel}
                onChange={(e) => setSpawnModel(e.target.value)}
                className="flex-1 px-2 py-1 rounded bg-white border border-surface-300/50 outline-none focus:border-hermes-500"
              >
                <option value="claude-sonnet">claude-sonnet</option>
                <option value="claude-opus">claude-opus</option>
                <option value="gpt-4">gpt-4</option>
              </select>
            </div>
            <div className="flex items-start gap-2 text-xs">
              <span className="text-surface-600 w-20 pt-1">Message:</span>
              <textarea
                value={spawnMessage}
                onChange={(e) => setSpawnMessage(e.target.value)}
                rows={2}
                className="flex-1 px-2 py-1 rounded bg-white border border-surface-300/50 outline-none focus:border-hermes-500"
                placeholder="分析 API 表面"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSpawnForm(false)}
                className="text-xs px-3 py-1 rounded bg-surface-200 text-surface-700 hover:bg-surface-300"
              >
                取消
              </button>
              <button
                onClick={handleSpawn}
                className="text-xs px-3 py-1 rounded bg-emerald-500 text-white hover:bg-emerald-600"
              >
                🆕 创建 SubAgent
              </button>
            </div>
          </div>
        )}

        {/* 状态消息 */}
        {(actionMessage || error) && (
          <div
            className={`mt-2 text-xs px-2 py-1 rounded ${
              error
                ? 'bg-rose-500/20 text-rose-300'
                : 'bg-emerald-500/20 text-emerald-300'
            }`}
          >
            {error || actionMessage}
          </div>
        )}
      </div>

      {/* 主体：左 70% 树 + 右 30% 消息/统计 */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* 左侧：统计 + 树 */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden border-r border-surface-300/20">
          {/* 统计卡片 */}
          {stats && (
            <div className="px-5 py-2 border-b border-surface-300/20 bg-gradient-to-r from-surface-50/40 to-surface-50/20 flex items-center gap-4 text-xs flex-shrink-0">
              <div>
                <span className="text-surface-500">Slot:</span>{' '}
                <span className="font-mono font-bold text-hermes-300">
                  {stats.active_slots}/{stats.max_threads}
                </span>
              </div>
              <div>
                <span className="text-surface-500">Depth:</span>{' '}
                <span className="font-mono font-bold text-blue-300">
                  {stats.max_actual_depth}/{stats.max_depth}
                </span>
              </div>
              <div>
                <span className="text-surface-500">Total:</span>{' '}
                <span className="font-mono font-bold">{stats.total}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {Object.entries(stats.by_status).map(([k, v]) => (
                  <span
                    key={k}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                      STATUS_COLOR[k] || STATUS_COLOR.pending
                    }`}
                  >
                    {k}: {v}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 树状结构 */}
          <div className="flex-1 overflow-y-auto px-3 py-2 bg-white/50">
            {loading && !tree ? (
              <div className="text-center text-xs text-surface-500 py-8">加载中…</div>
            ) : !tree ? (
              <div className="text-center text-xs text-surface-500 py-8">
                无数据，点击 🆕 Spawn 创建第一个 SubAgent
              </div>
            ) : (
              <TreeNode
                node={tree}
                depth={0}
                collapsedMap={collapsedMap}
                isVisible={isVisible}
                isCollapsed={isCollapsed}
                toggleCollapse={toggleCollapse}
                onWait={handleWait}
                onClose={handleClose}
                onSignal={handleSignal}
                onFollowup={handleFollowup}
              />
            )}
          </div>
        </div>

        {/* 右侧：消息列表 */}
        <div className="w-80 flex-shrink-0 flex flex-col bg-surface-50/30">
          <div className="px-3 py-2 border-b border-surface-300/20 text-xs font-semibold text-surface-700 flex items-center justify-between">
            <span>💬 最近消息</span>
            <span className="text-[10px] text-surface-500">{messages.length} 条</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {messages.length === 0 ? (
              <div className="text-center text-xs text-surface-500 py-4">暂无消息</div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.msg_id}
                  className="bg-white/70 rounded-md p-2 border border-surface-300/30 text-xs"
                >
                  <div className="flex items-center gap-1.5 text-[10px] text-surface-600 mb-1">
                    <span className="font-mono truncate max-w-[100px]" title={m.from_path}>
                      {m.from_path.split('/').pop()}
                    </span>
                    <span>→</span>
                    <span className="font-mono truncate max-w-[100px]" title={m.to_path}>
                      {m.to_path.split('/').pop()}
                    </span>
                    <span className="ml-auto text-surface-400">
                      {m.msg_type === 'followup' ? '🔄' : '📨'} {formatTimestamp(m.sent_at)}
                    </span>
                  </div>
                  <div className="text-surface-800 leading-snug">
                    {truncate(m.body, 100)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MultiAgentTreePanel;
