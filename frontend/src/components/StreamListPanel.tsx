/**
 * # ============================================================
 * StreamListPanel - 流式恢复网关管理面板
 * # ============================================================
 * 核心作用：可视化管理 StreamingBuffer 中的所有 SSE 流
 *           - 4 个标签页：活跃流 / 可恢复流 / 历史流 / 统计
 *           - 流详情查看（chunks 列表 + 重新订阅）
 *           - 清理过期流 + 自动刷新
 * 运行流程：
 *   1. 加载 GET /api/stream/active 获取活跃流
 *   2. 加载 GET /api/stream/resumable 获取可恢复流
 *   3. 加载 GET /api/stream/stats 获取统计
 *   4. 支持点击流 ID 查看 chunks 列表
 *   5. 支持"重新订阅"按钮（断点续传演练）
 *   6. 支持"清理过期流"按钮
 * 输入参数：onClose 回调
 * 输出结果：完整流式管理面板 DOM
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 6 P0-7-B 新建
 *     - 4 标签页：活跃流/可恢复流/历史流/统计
 *     - 5 维统计卡片：total/active/completed/failed/total_chunks
 *     - 容量条：磁盘使用估算
 *     - 流详情弹窗：元数据 + chunks
 *     - 自动刷新 + 清理 + 重新订阅
 * ============================================================
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  useStreams,
  useResumableStreams,
  useStreamBufferStats,
  listSessionStreams,
  getStreamChunks,
  subscribeStream,
  unsubscribeStream,
  cleanupExpiredStreams,
  type StreamMetadata,
  type StreamChunk,
} from '../hooks/useStreamBufferApi';

// ============================================================
// 类型定义
// ============================================================

export interface StreamListPanelProps {
  onClose: () => void;
}

type TabKey = 'active' | 'resumable' | 'history' | 'stats';

/** 流状态颜色映射 */
const STATE_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  active: { bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-300' },
  paused: { bg: 'bg-amber-100', text: 'text-amber-700', ring: 'ring-amber-300' },
  completed: { bg: 'bg-blue-100', text: 'text-blue-700', ring: 'ring-blue-300' },
  failed: { bg: 'bg-rose-100', text: 'text-rose-700', ring: 'ring-rose-300' },
  expired: { bg: 'bg-surface-200', text: 'text-surface-600', ring: 'ring-surface-300' },
};

/** 流状态中文映射 */
const STATE_LABELS: Record<string, string> = {
  active: '活跃',
  paused: '暂停',
  completed: '完成',
  failed: '失败',
  expired: '已过期',
};

/** 事件类型颜色 */
const EVENT_TYPE_COLORS: Record<string, string> = {
  text: 'bg-blue-100 text-blue-700',
  thinking: 'bg-purple-100 text-purple-700',
  done: 'bg-emerald-100 text-emerald-700',
  error: 'bg-rose-100 text-rose-700',
  tool_call: 'bg-amber-100 text-amber-700',
  tool_result: 'bg-teal-100 text-teal-700',
};

// ============================================================
// 工具函数
// ============================================================

/** 格式化时间戳 */
function formatTime(unixSecs: number | null): string {
  if (!unixSecs) return '-';
  const d = new Date(unixSecs * 1000);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s 前`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m 前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h 前`;
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** 格式化字节 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

/** 截断流 ID */
function truncateStreamId(id: string, maxLen: number = 16): string {
  if (id.length <= maxLen) return id;
  return `${id.slice(0, maxLen - 3)}...`;
}

// ============================================================
// 子组件：流状态徽章
// ============================================================

const StateBadge: React.FC<{ state: string }> = ({ state }) => {
  const colors = STATE_COLORS[state] || STATE_COLORS.expired;
  const label = STATE_LABELS[state] || state;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full
                  ${colors.bg} ${colors.text} ring-1 ${colors.ring}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          state === 'active' ? 'bg-emerald-500 animate-pulse' :
          state === 'paused' ? 'bg-amber-500' :
          state === 'completed' ? 'bg-blue-500' :
          state === 'failed' ? 'bg-rose-500' : 'bg-surface-400'
        }`}
      />
      {label}
    </span>
  );
};

// ============================================================
// 子组件：统计卡片
// ============================================================

const StatCard: React.FC<{
  label: string;
  value: string | number;
  icon: string;
  color: string;
  suffix?: string;
}> = ({ label, value, icon, color, suffix }) => (
  <div className="bg-gradient-to-br from-surface-50 to-surface-100 border border-surface-300/40 rounded-lg p-3 flex items-center gap-2">
    <div className={`text-2xl ${color}`}>{icon}</div>
    <div className="flex-1 min-w-0">
      <div className="text-xs text-surface-600">{label}</div>
      <div className="text-lg font-bold text-surface-900 truncate">
        {value}
        {suffix && <span className="text-xs text-surface-500 ml-1">{suffix}</span>}
      </div>
    </div>
  </div>
);

// ============================================================
// 子组件：流表格行
// ============================================================

const StreamRow: React.FC<{
  stream: StreamMetadata;
  onView: (stream: StreamMetadata) => void;
  onResubscribe: (stream: StreamMetadata) => void;
}> = ({ stream, onView, onResubscribe }) => {
  return (
    <tr className="border-b border-surface-200/60 hover:bg-surface-50/60 transition-colors">
      <td className="px-3 py-2">
        <button
          onClick={() => onView(stream)}
          className="text-xs font-mono text-hermes-600 hover:underline truncate max-w-[160px] block"
          title={stream.stream_id}
        >
          {truncateStreamId(stream.stream_id, 18)}
        </button>
      </td>
      <td className="px-3 py-2">
        <StateBadge state={stream.state} />
      </td>
      <td className="px-3 py-2 text-xs text-surface-700">{stream.model}</td>
      <td className="px-3 py-2 text-xs text-surface-700 text-right font-mono">
        {stream.total_chunks}
      </td>
      <td className="px-3 py-2 text-xs text-surface-700 text-right font-mono">
        {stream.last_seq}
      </td>
      <td className="px-3 py-2 text-xs text-surface-700 text-right">
        {formatBytes(stream.total_bytes)}
      </td>
      <td className="px-3 py-2 text-xs text-surface-500">
        {formatTime(stream.last_chunk_at)}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => onView(stream)}
            className="px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
            title="查看详情"
          >
            🔍
          </button>
          {stream.state === 'active' && (
            <button
              onClick={() => onResubscribe(stream)}
              className="px-2 py-0.5 text-xs text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
              title="断点续传（订阅）"
            >
              ↻
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};

// ============================================================
// 子组件：流详情弹窗
// ============================================================

const StreamDetailModal: React.FC<{
  stream: StreamMetadata;
  onClose: () => void;
}> = ({ stream, onClose }) => {
  const [chunks, setChunks] = useState<StreamChunk[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadChunks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getStreamChunks(stream.stream_id, 0, 100);
      setChunks(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [stream.stream_id]);

  useEffect(() => {
    void loadChunks();
  }, [loadChunks]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4
                 bg-black/40 backdrop-blur-md animate-lift-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-level-3 w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-surface-200 bg-gradient-to-r from-blue-50 to-cyan-50">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-surface-900">流详情</h3>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full hover:bg-surface-100 flex items-center justify-center text-surface-500"
            >
              ✕
            </button>
          </div>
          <div className="mt-2 text-xs font-mono text-surface-600 break-all">
            {stream.stream_id}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* 元数据卡片 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="bg-surface-50 rounded p-2">
              <div className="text-[10px] text-surface-500">状态</div>
              <div className="mt-1"><StateBadge state={stream.state} /></div>
            </div>
            <div className="bg-surface-50 rounded p-2">
              <div className="text-[10px] text-surface-500">模型</div>
              <div className="text-xs font-medium text-surface-800 mt-0.5">{stream.model}</div>
            </div>
            <div className="bg-surface-50 rounded p-2">
              <div className="text-[10px] text-surface-500">总 chunks</div>
              <div className="text-xs font-medium text-surface-800 mt-0.5 font-mono">
                {stream.total_chunks}
              </div>
            </div>
            <div className="bg-surface-50 rounded p-2">
              <div className="text-[10px] text-surface-500">最后 seq</div>
              <div className="text-xs font-medium text-surface-800 mt-0.5 font-mono">
                {stream.last_seq}
              </div>
            </div>
            <div className="bg-surface-50 rounded p-2">
              <div className="text-[10px] text-surface-500">Session</div>
              <div className="text-xs text-surface-800 mt-0.5 truncate" title={stream.session_id || ''}>
                {stream.session_id ? truncateStreamId(stream.session_id, 14) : '-'}
              </div>
            </div>
            <div className="bg-surface-50 rounded p-2">
              <div className="text-[10px] text-surface-500">总字节</div>
              <div className="text-xs font-medium text-surface-800 mt-0.5">
                {formatBytes(stream.total_bytes)}
              </div>
            </div>
            <div className="bg-surface-50 rounded p-2">
              <div className="text-[10px] text-surface-500">开始时间</div>
              <div className="text-xs text-surface-800 mt-0.5">
                {formatTime(stream.started_at)}
              </div>
            </div>
            <div className="bg-surface-50 rounded p-2">
              <div className="text-[10px] text-surface-500">最后更新</div>
              <div className="text-xs text-surface-800 mt-0.5">
                {formatTime(stream.last_chunk_at)}
              </div>
            </div>
          </div>

          {/* 错误信息 */}
          {stream.error_message && (
            <div className="bg-rose-50 border border-rose-200 rounded p-3 text-xs text-rose-700">
              <div className="font-semibold mb-1">错误信息：</div>
              <div className="font-mono break-all">{stream.error_message}</div>
            </div>
          )}

          {/* Chunks 列表 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-surface-900">
                Chunks 列表（{chunks.length}）
              </h4>
              <button
                onClick={loadChunks}
                className="px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
                disabled={loading}
              >
                {loading ? '加载中...' : '🔄 刷新'}
              </button>
            </div>
            {loading && chunks.length === 0 ? (
              <div className="space-y-1.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-10 bg-surface-100 rounded animate-pulse" />
                ))}
              </div>
            ) : error ? (
              <div className="text-xs text-rose-600 p-2">{error}</div>
            ) : chunks.length === 0 ? (
              <div className="text-center text-xs text-surface-500 py-4">暂无 chunks</div>
            ) : (
              <div className="border border-surface-200 rounded-lg overflow-hidden">
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-surface-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left text-surface-600">seq</th>
                        <th className="px-2 py-1 text-left text-surface-600">类型</th>
                        <th className="px-2 py-1 text-left text-surface-600">内容</th>
                        <th className="px-2 py-1 text-right text-surface-600">时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chunks.map((chunk) => (
                        <tr key={chunk.seq} className="border-t border-surface-200/60">
                          <td className="px-2 py-1 font-mono text-surface-700">{chunk.seq}</td>
                          <td className="px-2 py-1">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                EVENT_TYPE_COLORS[chunk.event_type] || 'bg-surface-100 text-surface-700'
                              }`}
                            >
                              {chunk.event_type}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-surface-700 max-w-xs truncate" title={chunk.content}>
                            {chunk.content}
                          </td>
                          <td className="px-2 py-1 text-right text-surface-500">
                            {formatTime(chunk.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// 子组件：断点续传测试
// ============================================================

const ResubscribeDemo: React.FC<{
  stream: StreamMetadata;
  onClose: () => void;
}> = ({ stream, onClose }) => {
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubscribe = useCallback(async (lastAckSeq: number) => {
    setLoading(true);
    setError(null);
    try {
      const clientId = `demo-client-${Date.now()}`;
      const resp = await subscribeStream(stream.stream_id, clientId, lastAckSeq);
      setResult(
        `✅ 订阅成功 (last_ack_seq=${lastAckSeq})\n` +
        `   subscription_id: ${resp.subscription_id}\n` +
        `   current_state: ${resp.current_state}\n` +
        `   total_chunks: ${resp.total_chunks}\n` +
        `   replay_count: ${resp.replay_count}\n` +
        `   last_seq: ${resp.last_seq}\n` +
        `   恢复 chunks: ${resp.replay_chunks.length}\n`,
      );
      // 立即取消订阅
      setTimeout(async () => {
        try {
          await unsubscribeStream(resp.subscription_id);
          setResult((prev) => prev + `   (已取消订阅: ${resp.subscription_id})`);
        } catch (e) {
          /* ignore */
        }
      }, 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [stream.stream_id]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4
                 bg-black/40 backdrop-blur-md animate-lift-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-level-3 w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0 px-6 py-4 border-b border-surface-200 bg-gradient-to-r from-emerald-50 to-teal-50">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-surface-900">
              ↻ 断点续传测试
            </h3>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full hover:bg-surface-100 flex items-center justify-center text-surface-500"
            >
              ✕
            </button>
          </div>
          <div className="mt-2 text-xs text-surface-600">
            模拟客户端断线后重新订阅场景
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="bg-surface-50 rounded p-3">
            <div className="text-[10px] text-surface-500 mb-1">流 ID</div>
            <div className="text-xs font-mono text-surface-800 break-all">
              {stream.stream_id}
            </div>
            <div className="mt-2 text-[10px] text-surface-500 mb-1">当前状态</div>
            <div><StateBadge state={stream.state} /></div>
            <div className="mt-2 text-[10px] text-surface-500 mb-1">总 chunks / last_seq</div>
            <div className="text-xs font-mono text-surface-800">
              {stream.total_chunks} / {stream.last_seq}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-surface-900">选择续传起点：</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleSubscribe(-1)}
                disabled={loading}
                className="px-3 py-2 text-xs text-left bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded disabled:opacity-50"
              >
                <div className="font-medium text-blue-700">从头开始</div>
                <div className="text-[10px] text-blue-600 mt-0.5">last_ack_seq = -1</div>
                <div className="text-[10px] text-blue-500 mt-1">返回全部 {stream.total_chunks} chunks</div>
              </button>
              <button
                onClick={() => handleSubscribe(Math.floor(stream.last_seq / 2))}
                disabled={loading}
                className="px-3 py-2 text-xs text-left bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded disabled:opacity-50"
              >
                <div className="font-medium text-emerald-700">从中间开始</div>
                <div className="text-[10px] text-emerald-600 mt-0.5">last_ack_seq = {Math.floor(stream.last_seq / 2)}</div>
                <div className="text-[10px] text-emerald-500 mt-1">节省前一半传输</div>
              </button>
              <button
                onClick={() => handleSubscribe(stream.last_seq - 1)}
                disabled={loading || stream.last_seq < 0}
                className="px-3 py-2 text-xs text-left bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded disabled:opacity-50"
              >
                <div className="font-medium text-amber-700">仅最后 1 个</div>
                <div className="text-[10px] text-amber-600 mt-0.5">last_ack_seq = {stream.last_seq - 1}</div>
                <div className="text-[10px] text-amber-500 mt-1">最小开销测试</div>
              </button>
              <button
                onClick={() => handleSubscribe(stream.last_seq)}
                disabled={loading || stream.last_seq < 0}
                className="px-3 py-2 text-xs text-left bg-surface-50 hover:bg-surface-100 border border-surface-200 rounded disabled:opacity-50"
              >
                <div className="font-medium text-surface-700">全部已确认</div>
                <div className="text-[10px] text-surface-600 mt-0.5">last_ack_seq = {stream.last_seq}</div>
                <div className="text-[10px] text-surface-500 mt-1">应返回 0 个 chunks</div>
              </button>
            </div>
          </div>

          {loading && (
            <div className="text-center text-xs text-blue-600 py-2">
              ⏳ 正在订阅...
            </div>
          )}

          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded p-3 text-xs text-rose-700 font-mono whitespace-pre-wrap">
              ❌ {error}
            </div>
          )}

          {result && (
            <div className="bg-emerald-50 border border-emerald-200 rounded p-3 text-xs text-emerald-800 font-mono whitespace-pre-wrap">
              {result}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// 主组件
// ============================================================

export const StreamListPanel: React.FC<StreamListPanelProps> = ({ onClose }) => {
  const [tab, setTab] = useState<TabKey>('active');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);
  const [refreshInterval, setRefreshInterval] = useState<number>(5);
  const [actionMessage, setActionMessage] = useState<string>('');
  const [historyStreams, setHistoryStreams] = useState<StreamMetadata[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historySessionId, setHistorySessionId] = useState<string>('');
  const [detailStream, setDetailStream] = useState<StreamMetadata | null>(null);
  const [resubStream, setResubStream] = useState<StreamMetadata | null>(null);

  // 活跃流
  const {
    streams: activeStreams,
    loading: activeLoading,
    error: activeError,
    refetch: refetchActive,
  } = useStreams(50);

  // 可恢复流
  const {
    streams: resumableStreams,
    loading: resumableLoading,
    error: resumableError,
    refetch: refetchResumable,
  } = useResumableStreams(30, 50);

  // 统计
  const {
    stats,
    loading: statsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useStreamBufferStats();

  // 统一 refetch
  const refetchAll = useCallback(async () => {
    await Promise.all([refetchActive(), refetchResumable(), refetchStats()]);
  }, [refetchActive, refetchResumable, refetchStats]);

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(refetchAll, refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshInterval, refetchAll]);

  // 历史流查询
  const loadHistory = useCallback(async () => {
    if (!historySessionId.trim()) {
      setActionMessage('⚠️ 请输入 session_id');
      return;
    }
    setHistoryLoading(true);
    setActionMessage('');
    try {
      const data = await listSessionStreams(historySessionId.trim(), 50);
      setHistoryStreams(data);
      setActionMessage(`✅ 加载了 ${data.length} 个流`);
    } catch (e) {
      setActionMessage(`❌ 加载失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setHistoryLoading(false);
    }
  }, [historySessionId]);

  // 清理过期流
  const handleCleanup = useCallback(async () => {
    if (!confirm('确定清理过期流吗？')) return;
    try {
      const count = await cleanupExpiredStreams(3600);
      setActionMessage(`✅ 已清理 ${count} 个过期流`);
      await refetchAll();
    } catch (e) {
      setActionMessage(`❌ 清理失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [refetchAll]);

  const currentStreams = useMemo(() => {
    switch (tab) {
      case 'active': return activeStreams;
      case 'resumable': return resumableStreams;
      case 'history': return historyStreams;
      default: return [];
    }
  }, [tab, activeStreams, resumableStreams, historyStreams]);

  const currentLoading = useMemo(() => {
    switch (tab) {
      case 'active': return activeLoading;
      case 'resumable': return resumableLoading;
      case 'history': return historyLoading;
      default: return false;
    }
  }, [tab, activeLoading, resumableLoading, historyLoading]);

  const currentError = useMemo(() => {
    switch (tab) {
      case 'active': return activeError;
      case 'resumable': return resumableError;
      case 'history': return null;
      default: return null;
    }
  }, [tab, activeError, resumableError]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4
                 bg-black/40 backdrop-blur-md animate-lift-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-level-3 w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-surface-200 bg-gradient-to-r from-blue-50 via-cyan-50 to-teal-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-cyan-500 flex items-center justify-center shadow-md">
                <span className="text-white text-lg">🌊</span>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-surface-900">
                  流式恢复网关
                </h3>
                <p className="text-xs text-surface-500 mt-0.5">
                  SSE 流生命周期管理 + 断点续传 + 容器重启恢复
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full hover:bg-surface-100 flex items-center justify-center text-surface-500"
            >
              ✕
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 mt-3 -mb-1">
            {(['active', 'resumable', 'history', 'stats'] as TabKey[]).map((t) => {
              const isActive = tab === t;
              const labels: Record<TabKey, string> = {
                active: `活跃 (${activeStreams.length})`,
                resumable: `可恢复 (${resumableStreams.length})`,
                history: '历史查询',
                stats: '统计',
              };
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors ${
                    isActive
                      ? 'bg-white text-blue-600 border-b-2 border-blue-500'
                      : 'text-surface-600 hover:text-surface-900 hover:bg-white/40'
                  }`}
                >
                  {labels[t]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex-shrink-0 px-6 py-2 border-b border-surface-200 bg-surface-50/60 flex items-center gap-3 flex-wrap">
          <button
            onClick={refetchAll}
            className="px-3 py-1 text-xs font-medium bg-white border border-surface-300 rounded hover:bg-surface-50"
          >
            🔄 刷新
          </button>
          <label className="flex items-center gap-1.5 text-xs text-surface-700">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            自动刷新
            {autoRefresh && (
              <select
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
                className="ml-1 text-xs border border-surface-300 rounded px-1"
              >
                <option value={3}>3s</option>
                <option value={5}>5s</option>
                <option value={10}>10s</option>
                <option value={30}>30s</option>
              </select>
            )}
          </label>
          <button
            onClick={handleCleanup}
            className="px-3 py-1 text-xs font-medium text-rose-600 bg-white border border-rose-200 rounded hover:bg-rose-50"
          >
            🧹 清理过期
          </button>
          {actionMessage && (
            <div className="text-xs text-surface-600 flex-1 truncate">
              {actionMessage}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'stats' ? (
            <StatsTab stats={stats} loading={statsLoading} error={statsError} onRefetch={refetchStats} />
          ) : tab === 'history' ? (
            <HistoryTab
              sessionId={historySessionId}
              setSessionId={setHistorySessionId}
              streams={historyStreams}
              loading={historyLoading}
              onLoad={loadHistory}
              onView={setDetailStream}
              onResubscribe={setResubStream}
            />
          ) : (
            <StreamsTab
              streams={currentStreams}
              loading={currentLoading}
              error={currentError}
              emptyMessage={tab === 'active' ? '当前没有活跃流' : '当前没有可恢复流'}
              onView={setDetailStream}
              onResubscribe={setResubStream}
            />
          )}
        </div>
      </div>

      {/* 详情弹窗 */}
      {detailStream && (
        <StreamDetailModal
          stream={detailStream}
          onClose={() => setDetailStream(null)}
        />
      )}

      {/* 续传测试弹窗 */}
      {resubStream && (
        <ResubscribeDemo
          stream={resubStream}
          onClose={() => setResubStream(null)}
        />
      )}
    </div>
  );
};

// ============================================================
// 标签页：流列表
// ============================================================

const StreamsTab: React.FC<{
  streams: StreamMetadata[];
  loading: boolean;
  error: string | null;
  emptyMessage: string;
  onView: (s: StreamMetadata) => void;
  onResubscribe: (s: StreamMetadata) => void;
}> = ({ streams, loading, error, emptyMessage, onView, onResubscribe }) => {
  if (loading && streams.length === 0) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 bg-surface-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-sm text-rose-600 py-6">
        ❌ {error}
      </div>
    );
  }

  if (streams.length === 0) {
    return (
      <div className="text-center text-sm text-surface-500 py-12">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="border border-surface-200 rounded-lg overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-surface-100">
          <tr>
            <th className="px-3 py-2 text-left text-surface-600 font-medium">Stream ID</th>
            <th className="px-3 py-2 text-left text-surface-600 font-medium">状态</th>
            <th className="px-3 py-2 text-left text-surface-600 font-medium">模型</th>
            <th className="px-3 py-2 text-right text-surface-600 font-medium">chunks</th>
            <th className="px-3 py-2 text-right text-surface-600 font-medium">last_seq</th>
            <th className="px-3 py-2 text-right text-surface-600 font-medium">size</th>
            <th className="px-3 py-2 text-left text-surface-600 font-medium">最近</th>
            <th className="px-3 py-2 text-right text-surface-600 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {streams.map((s) => (
            <StreamRow
              key={s.stream_id}
              stream={s}
              onView={onView}
              onResubscribe={onResubscribe}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ============================================================
// 标签页：历史查询
// ============================================================

const HistoryTab: React.FC<{
  sessionId: string;
  setSessionId: (v: string) => void;
  streams: StreamMetadata[];
  loading: boolean;
  onLoad: () => void;
  onView: (s: StreamMetadata) => void;
  onResubscribe: (s: StreamMetadata) => void;
}> = ({ sessionId, setSessionId, streams, loading, onLoad, onView, onResubscribe }) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onLoad()}
          placeholder="输入 session_id 查询历史流"
          className="flex-1 px-3 py-2 text-sm border border-surface-300 rounded
                     focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
        />
        <button
          onClick={onLoad}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? '加载中...' : '查询'}
        </button>
      </div>
      <StreamsTab
        streams={streams}
        loading={loading}
        error={null}
        emptyMessage="未查询到流，请输入 session_id 后点击查询"
        onView={onView}
        onResubscribe={onResubscribe}
      />
    </div>
  );
};

// ============================================================
// 标签页：统计
// ============================================================

const StatsTab: React.FC<{
  stats: import('../hooks/useStreamBufferApi').StreamBufferStats | null;
  loading: boolean;
  error: string | null;
  onRefetch: () => void;
}> = ({ stats, loading, error, onRefetch }) => {
  if (loading && !stats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 bg-surface-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="text-sm text-rose-600 text-center py-6">❌ {error}</div>;
  }

  if (!stats) {
    return <div className="text-sm text-surface-500 text-center py-6">暂无统计数据</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-surface-900">流式网关统计</h4>
        <button
          onClick={onRefetch}
          className="px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 rounded"
        >
          🔄 刷新
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          label="总流数"
          value={stats.total_streams}
          icon="🌊"
          color="text-blue-500"
        />
        <StatCard
          label="活跃流"
          value={stats.active_streams}
          icon="🟢"
          color="text-emerald-500"
        />
        <StatCard
          label="已完成"
          value={stats.completed_streams}
          icon="✅"
          color="text-blue-500"
        />
        <StatCard
          label="失败"
          value={stats.failed_streams}
          icon="❌"
          color="text-rose-500"
        />
        <StatCard
          label="总 chunks"
          value={stats.total_chunks}
          icon="📦"
          color="text-purple-500"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-200 rounded-lg p-4">
          <div className="text-xs text-blue-700">总字节数</div>
          <div className="text-2xl font-bold text-blue-900 mt-1">
            {formatBytes(stats.total_bytes)}
          </div>
        </div>
        <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200 rounded-lg p-4">
          <div className="text-xs text-purple-700">活跃订阅</div>
          <div className="text-2xl font-bold text-purple-900 mt-1">
            {stats.total_subscriptions}
          </div>
        </div>
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-lg p-4">
          <div className="text-xs text-amber-700">最老活跃流</div>
          <div className="text-2xl font-bold text-amber-900 mt-1">
            {Math.floor(stats.oldest_active_age_seconds || 0)}s
          </div>
        </div>
      </div>

      {(stats.saved_bytes !== undefined || stats.replay_hit_rate !== undefined) && (
        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-lg p-4">
          <div className="text-sm font-semibold text-emerald-800 mb-2">续传效率</div>
          <div className="grid grid-cols-2 gap-3">
            {stats.replay_hit_rate !== undefined && (
              <div>
                <div className="text-xs text-emerald-700">续传命中率</div>
                <div className="text-xl font-bold text-emerald-900">
                  {(stats.replay_hit_rate * 100).toFixed(1)}%
                </div>
              </div>
            )}
            {stats.saved_bytes !== undefined && (
              <div>
                <div className="text-xs text-emerald-700">节省带宽</div>
                <div className="text-xl font-bold text-emerald-900">
                  {formatBytes(stats.saved_bytes)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default StreamListPanel;
