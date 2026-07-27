/**
 * # ============================================================
 * # SessionRolloutPanel - 会话 JSONL Rollout 可视化
 * # ============================================================
 * # 核心作用：可视化管理会话 rollout JSONL 持久化
 * # 功能：
 * #   - 分页加载 rollout items
 * #   - 5 种 item 类型彩色显示
 * #   - beforeTurnId fork 按钮
 * #   - 导出/导入 JSONL
 * #   - rollout 状态信息
 * # 运行流程：
 * #   1. 用户输入 session_id
 * #   2. 自动加载 /api/sessions/{id}/rollout
 * #   3. 渲染分页列表，懒加载下一页
 * #   4. 提供 beforeTurnId fork + 导出按钮
 * # 输入参数：onClose 回调
 * # 输出结果：完整 rollout 面板 DOM
 * # 修改记录：
 * #   - 2026-07-27 | v1.0.0 | Cycle 7 P0-9 新建
 * # ============================================================
 */

import React, { useState, useCallback, useEffect } from 'react';

export interface SessionRolloutPanelProps {
  onClose: () => void;
}

// ============================================================
// 类型定义
// ============================================================

interface RolloutItem {
  type: string;
  ts: number;
  turn_id: string | null;
  payload: Record<string, any>;
  line_no: number;
}

interface RolloutResponse {
  success: boolean;
  session_id: string;
  total_items: number;
  limit: number;
  offset: number;
  has_more: boolean;
  items: RolloutItem[];
  error?: string;
}

interface RolloutInfo {
  success: boolean;
  session_id: string;
  exists: boolean;
  file_size_bytes?: number;
  compressed?: boolean;
  item_count?: number;
  type_counts?: Record<string, number>;
  turn_count?: number;
  turn_ids?: string[];
}

interface ForkResult {
  success: boolean;
  session?: {
    id: string;
    title: string;
    parent_session_id: string;
    fork_turn_id: string;
    created_at: string;
  };
  items_copied?: number;
  error?: string;
}

// ============================================================
// 工具函数
// ============================================================

const TYPE_COLORS: Record<string, string> = {
  session_meta: 'bg-blue-100 text-blue-800 border-blue-300',
  turn_context: 'bg-purple-100 text-purple-800 border-purple-300',
  response_item: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  event_msg: 'bg-amber-100 text-amber-800 border-amber-300',
  compacted: 'bg-rose-100 text-rose-800 border-rose-300',
};

const TYPE_ICONS: Record<string, string> = {
  session_meta: '📋',
  turn_context: '🎯',
  response_item: '💬',
  event_msg: '⚡',
  compacted: '📦',
};

function formatTimestamp(ts: number): string {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function truncate(s: string, max: number = 80): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '...' : s;
}

async function fetchRollout(
  sessionId: string,
  limit: number,
  offset: number,
): Promise<RolloutResponse> {
  const res = await fetch(`/api/sessions/${sessionId}/rollout?limit=${limit}&offset=${offset}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

async function fetchRolloutInfo(sessionId: string): Promise<RolloutInfo> {
  const res = await fetch(`/api/sessions/${sessionId}/rollout/info`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

async function forkAtTurn(
  sessionId: string,
  beforeTurnId: string,
  title?: string,
): Promise<ForkResult> {
  const res = await fetch(`/api/sessions/${sessionId}/fork-turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ before_turn_id: beforeTurnId, title }),
  });
  return res.json();
}

async function exportSession(sessionId: string, compressed: boolean = false): Promise<any> {
  const res = await fetch(`/api/sessions/${sessionId}/export?compressed=${compressed}`);
  return res.json();
}

async function deleteRollout(sessionId: string): Promise<any> {
  const res = await fetch(`/api/sessions/${sessionId}/rollout`, { method: 'DELETE' });
  return res.json();
}

// ============================================================
// 主组件
// ============================================================

export const SessionRolloutPanel: React.FC<SessionRolloutPanelProps> = ({ onClose }) => {
  const [sessionId, setSessionId] = useState<string>('');
  const [info, setInfo] = useState<RolloutInfo | null>(null);
  const [items, setItems] = useState<RolloutItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pageSize] = useState<number>(20);
  const [offset, setOffset] = useState<number>(0);
  const [forkingTurnId, setForkingTurnId] = useState<string | null>(null);
  const [forkResult, setForkResult] = useState<ForkResult | null>(null);

  // ============================================================
  // 加载 info + 第一页
  // ============================================================
  const loadSession = useCallback(async (sid: string) => {
    if (!sid.trim()) return;
    setLoading(true);
    setError(null);
    setOffset(0);
    try {
      const [infoData, pageData] = await Promise.all([
        fetchRolloutInfo(sid),
        fetchRollout(sid, pageSize, 0),
      ]);
      setInfo(infoData);
      setItems(pageData.items || []);
      setTotal(pageData.total_items);
      setHasMore(pageData.has_more);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setInfo(null);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  // ============================================================
  // 加载下一页
  // ============================================================
  const loadMore = useCallback(async () => {
    if (!hasMore || loading) return;
    setLoading(true);
    try {
      const nextOffset = offset + pageSize;
      const pageData = await fetchRollout(sessionId, pageSize, nextOffset);
      setItems(prev => [...prev, ...(pageData.items || [])]);
      setOffset(nextOffset);
      setHasMore(pageData.has_more);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId, offset, pageSize, hasMore, loading]);

  // ============================================================
  // Fork 处理
  // ============================================================
  const handleFork = useCallback(async (turnId: string) => {
    if (!sessionId) return;
    setForkingTurnId(turnId);
    setForkResult(null);
    try {
      const result = await forkAtTurn(sessionId, turnId, `Fork from ${turnId.slice(0, 12)}`);
      setForkResult(result);
      if (result.success) {
        // 3秒后自动清除提示
        setTimeout(() => setForkResult(null), 3000);
      }
    } catch (e) {
      setForkResult({ success: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setForkingTurnId(null);
    }
  }, [sessionId]);

  // ============================================================
  // 导出处理
  // ============================================================
  const handleExport = useCallback(async (compressed: boolean) => {
    if (!sessionId) return;
    try {
      const result = await exportSession(sessionId, compressed);
      if (result.success) {
        if (compressed) {
          // 解码 base64 + 下载
          const link = document.createElement('a');
          link.href = `data:application/octet-stream;base64,${result.content}`;
          link.download = `${sessionId}.jsonl.zst`;
          link.click();
        } else {
          // 下载 JSONL 文本
          const blob = new Blob([result.content], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${sessionId}.jsonl`;
          link.click();
          URL.revokeObjectURL(url);
        }
      } else {
        setError(result.error || '导出失败');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [sessionId]);

  // ============================================================
  // 删除处理
  // ============================================================
  const handleDelete = useCallback(async () => {
    if (!sessionId) return;
    if (!confirm(`确定要删除会话 ${sessionId} 的 rollout 文件吗？`)) return;
    try {
      const result = await deleteRollout(sessionId);
      if (result.success) {
        await loadSession(sessionId);
      } else {
        setError('删除失败');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [sessionId, loadSession]);

  // ============================================================
  // 自动加载（URL 参数 ?sessionId=xxx）
  // ============================================================
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('sessionId');
    if (sid) {
      setSessionId(sid);
      void loadSession(sid);
    }
  }, [loadSession]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-md animate-lift-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-level-3 w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-surface-200 bg-gradient-to-r from-blue-500 via-cyan-500 to-teal-500 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <span className="text-2xl">📜</span>
                <span>Session Rollout JSONL</span>
              </h2>
              <p className="text-sm text-white/80 mt-1">Codex v0.145.0 thread/fork · 5 种 item 类型 · 分页加载 · beforeTurnId fork</p>
            </div>
            <button onClick={onClose} className="text-white/80 hover:text-white text-2xl" aria-label="关闭">×</button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Session ID 输入 */}
          <div className="flex gap-2">
            <input
              type="text"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void loadSession(sessionId); }}
              placeholder="输入 session_id"
              className="flex-1 px-3 py-2 text-sm border border-surface-300 rounded-lg focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={() => void loadSession(sessionId)}
              disabled={loading || !sessionId.trim()}
              className="px-4 py-2 text-sm bg-gradient-to-br from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 text-white rounded-lg disabled:opacity-50"
            >
              {loading ? '加载中...' : '加载'}
            </button>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="px-4 py-2 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg">
              ❌ {error}
            </div>
          )}

          {/* Fork 结果 */}
          {forkResult && (
            <div className={`px-4 py-2 text-sm rounded-lg ${forkResult.success ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
              {forkResult.success
                ? `✅ Fork 成功: ${forkResult.session?.id} (复制 ${forkResult.items_copied} items)`
                : `❌ Fork 失败: ${forkResult.error}`
              }
            </div>
          )}

          {/* Info 卡片 */}
          {info && info.exists && (
            <div className="grid grid-cols-4 gap-3">
              <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="text-xs text-blue-600">Items</div>
                <div className="text-2xl font-bold text-blue-700">{info.item_count}</div>
              </div>
              <div className="px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg">
                <div className="text-xs text-purple-600">Turns</div>
                <div className="text-2xl font-bold text-purple-700">{info.turn_count}</div>
              </div>
              <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                <div className="text-xs text-emerald-600">Size</div>
                <div className="text-2xl font-bold text-emerald-700">{Math.round((info.file_size_bytes || 0) / 1024)}KB</div>
              </div>
              <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="text-xs text-amber-600">压缩</div>
                <div className="text-2xl font-bold text-amber-700">{info.compressed ? '是' : '否'}</div>
              </div>
            </div>
          )}

          {/* 类型分布 */}
          {info?.type_counts && (
            <div className="px-4 py-3 bg-surface-50 border border-surface-200 rounded-lg">
              <div className="text-xs font-semibold text-surface-600 mb-2">类型分布</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(info.type_counts).map(([type, count]) => (
                  <span key={type} className={`px-2 py-1 text-xs rounded border ${TYPE_COLORS[type] || 'bg-gray-100'}`}>
                    {TYPE_ICONS[type] || '📌'} {type}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          {info?.exists && (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => void handleExport(false)} className="px-3 py-1.5 text-sm bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded-lg">
                📥 导出 JSONL
              </button>
              <button onClick={() => void handleExport(true)} className="px-3 py-1.5 text-sm bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded-lg">
                📥 导出 zstd
              </button>
              <button onClick={() => void handleDelete()} className="px-3 py-1.5 text-sm bg-red-100 hover:bg-red-200 text-red-700 rounded-lg">
                🗑️ 删除 Rollout
              </button>
            </div>
          )}

          {/* Item 列表 */}
          {items.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-surface-600 px-1">
                Items ({items.length} / {total})
              </div>
              {items.map((item) => (
                <div key={`${item.line_no}-${item.type}`} className={`px-3 py-2 border rounded-lg ${TYPE_COLORS[item.type] || 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono">#{item.line_no}</span>
                      <span className="text-sm font-semibold">{TYPE_ICONS[item.type] || '📌'} {item.type}</span>
                      {item.turn_id && (
                        <span className="text-xs px-1.5 py-0.5 bg-white/60 rounded">turn: {truncate(item.turn_id, 16)}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs">{formatTimestamp(item.ts)}</span>
                      {item.turn_id && item.type === 'turn_context' && (
                        <button
                          onClick={() => void handleFork(item.turn_id!)}
                          disabled={forkingTurnId === item.turn_id}
                          className="text-xs px-2 py-0.5 bg-white/80 hover:bg-white text-surface-700 rounded disabled:opacity-50"
                        >
                          {forkingTurnId === item.turn_id ? '⏳' : '🔀 Fork'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-xs font-mono bg-white/60 px-2 py-1 rounded">
                    {truncate(JSON.stringify(item.payload), 200)}
                  </div>
                </div>
              ))}

              {/* 加载更多 */}
              {hasMore && (
                <button
                  onClick={() => void loadMore()}
                  disabled={loading}
                  className="w-full px-3 py-2 text-sm bg-surface-100 hover:bg-surface-200 text-surface-700 rounded-lg disabled:opacity-50"
                >
                  {loading ? '加载中...' : `加载更多 (还有 ${total - items.length} 条)`}
                </button>
              )}
            </div>
          )}

          {/* 空状态 */}
          {info && !info.exists && !error && (
            <div className="text-center py-8 text-surface-500">
              <div className="text-4xl mb-2">📭</div>
              <div>该会话没有 rollout 文件</div>
              <div className="text-xs mt-1">先记录一些 turns 再来查看</div>
            </div>
          )}

          {!info && !loading && !error && (
            <div className="text-center py-8 text-surface-500">
              <div className="text-4xl mb-2">📜</div>
              <div>输入 session_id 加载 rollout</div>
              <div className="text-xs mt-1">支持分页、fork、导出</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SessionRolloutPanel;
