/**
 * # ============================================================
 * useStreamBufferApi - 流式恢复网关 API 封装
 * # ============================================================
 * 核心作用：封装流式恢复网关（StreamingBuffer）的所有 REST API
 *           供 StreamListPanel 与 useSSEReconnect 调用
 * 包含：
 *   - 列出活跃流 / 可恢复流 / 会话流
 *   - 查询流元数据 / chunks
 *   - 客户端订阅 / ACK / 取消订阅
 *   - 清理过期流 / 获取统计
 * 创建日期：2026-07-27
 * 模块版本：v1.0.0 - Cycle 6 P0-7-B
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | 初始版本
 *     - 8 个核心 API：listActive / listResumable / listBySession / getMeta
 *       / getChunks / subscribe / ack / unsubscribe
 *     - 1 个统计 API：getStats
 * ============================================================
 */

import { useCallback, useState } from 'react';
import { apiFetch } from './apiShared';

// ============================================================
// 类型定义
// ============================================================

/** 流元数据（与后端 StreamMetadata.to_dict() 对齐） */
export interface StreamMetadata {
  stream_id: string;
  session_id: string | null;
  user_id: string | null;
  model: string;
  state: 'active' | 'paused' | 'completed' | 'failed' | 'expired';
  started_at: number;
  last_chunk_at: number;
  completed_at: number | null;
  total_chunks: number;
  total_bytes: number;
  last_seq: number;
  error_message: string | null;
  extra: Record<string, unknown> | null;
}

/** SSE chunk 数据结构（与后端 StreamChunk.to_dict() 对齐） */
export interface StreamChunk {
  stream_id: string;
  seq: number;
  event_type: string;
  content: string;
  created_at: number;
}

/** 订阅响应 */
export interface SubscribeResponse {
  subscription_id: string;
  stream_id: string;
  current_state: 'active' | 'paused' | 'completed' | 'failed' | 'expired';
  last_seq: number;
  total_chunks: number;
  replay_count: number;
  replay_chunks: StreamChunk[];
}

/** 统计信息 */
export interface StreamBufferStats {
  total_streams: number;
  active_streams: number;
  completed_streams: number;
  failed_streams: number;
  total_chunks: number;
  total_bytes: number;
  total_subscriptions: number;
  oldest_active_age_seconds: number;
  /** 命中率（断点续传 vs 全量重传） */
  replay_hit_rate?: number;
  /** 累计节省字节数（通过续传避免重传） */
  saved_bytes?: number;
}

// ============================================================
// API 客户端
// ============================================================

/** 列出活跃流 */
export async function listActiveStreams(limit: number = 50): Promise<StreamMetadata[]> {
  const data = await apiFetch<{ success: boolean; count: number; streams: StreamMetadata[] }>(
    `/stream/active?limit=${limit}`,
  );
  return data.streams || [];
}

/** 列出可恢复流 */
export async function listResumableStreams(
  maxIdleSeconds: number = 30,
  limit: number = 50,
): Promise<StreamMetadata[]> {
  const data = await apiFetch<{ success: boolean; count: number; streams: StreamMetadata[] }>(
    `/stream/resumable?max_idle_seconds=${maxIdleSeconds}&limit=${limit}`,
  );
  return data.streams || [];
}

/** 列出会话的所有流 */
export async function listSessionStreams(
  sessionId: string,
  limit: number = 20,
): Promise<StreamMetadata[]> {
  const data = await apiFetch<{ success: boolean; count: number; streams: StreamMetadata[] }>(
    `/stream/session/${encodeURIComponent(sessionId)}?limit=${limit}`,
  );
  return data.streams || [];
}

/** 获取流元数据 */
export async function getStreamMeta(streamId: string): Promise<StreamMetadata | null> {
  try {
    const data = await apiFetch<{ success: boolean; stream: StreamMetadata }>(
      `/stream/${encodeURIComponent(streamId)}`,
    );
    return data.stream || null;
  } catch {
    return null;
  }
}

/** 获取流 chunks */
export async function getStreamChunks(
  streamId: string,
  fromSeq: number = 0,
  limit?: number,
): Promise<StreamChunk[]> {
  const params = new URLSearchParams({ from_seq: String(fromSeq) });
  if (limit !== undefined) params.set('limit', String(limit));
  const data = await apiFetch<{
    success: boolean;
    count: number;
    chunks: StreamChunk[];
  }>(`/stream/${encodeURIComponent(streamId)}/chunks?${params.toString()}`);
  return data.chunks || [];
}

/** 订阅流（断点续传） */
export async function subscribeStream(
  streamId: string,
  clientId: string,
  lastAckSeq: number = -1,
): Promise<SubscribeResponse> {
  return apiFetch<SubscribeResponse>(`/stream/${encodeURIComponent(streamId)}/subscribe`, {
    method: 'POST',
    body: JSON.stringify({
      client_id: clientId,
      last_ack_seq: lastAckSeq,
    }),
  });
}

/** 客户端 ACK */
export async function ackSubscription(
  subscriptionId: string,
  lastAckSeq: number,
): Promise<void> {
  await apiFetch(`/stream/subscription/${encodeURIComponent(subscriptionId)}/ack`, {
    method: 'POST',
    body: JSON.stringify({ last_ack_seq: lastAckSeq }),
  });
}

/** 取消订阅 */
export async function unsubscribeStream(subscriptionId: string): Promise<void> {
  await apiFetch(`/stream/subscription/${encodeURIComponent(subscriptionId)}/unsubscribe`, {
    method: 'POST',
  });
}

/** 清理过期流 */
export async function cleanupExpiredStreams(maxAgeSeconds: number = 3600): Promise<number> {
  const data = await apiFetch<{ success: boolean; deleted_count: number }>(
    '/stream/cleanup',
    {
      method: 'POST',
      body: JSON.stringify({ max_age_seconds: maxAgeSeconds }),
    },
  );
  return data.deleted_count || 0;
}

/** 获取统计 */
export async function getStreamBufferStats(): Promise<StreamBufferStats | null> {
  try {
    const data = await apiFetch<{ success: boolean; stats: StreamBufferStats }>(
      '/stream/stats',
    );
    return data.stats || null;
  } catch {
    return null;
  }
}

/** 获取配置 */
export async function getStreamBufferConfig(): Promise<Record<string, unknown> | null> {
  try {
    const data = await apiFetch<{ success: boolean; config: Record<string, unknown> }>(
      '/stream/config',
    );
    return data.config || null;
  } catch {
    return null;
  }
}

// ============================================================
// React Hooks
// ============================================================

/** useStreams 通用 hook：管理活跃流列表 */
export function useStreams(limit: number = 50) {
  const [streams, setStreams] = useState<StreamMetadata[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listActiveStreams(limit);
      setStreams(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [limit]);

  return { streams, loading, error, refetch };
}

/** useResumableStreams hook：管理可恢复流列表 */
export function useResumableStreams(maxIdleSeconds: number = 30, limit: number = 50) {
  const [streams, setStreams] = useState<StreamMetadata[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listResumableStreams(maxIdleSeconds, limit);
      setStreams(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [maxIdleSeconds, limit]);

  return { streams, loading, error, refetch };
}

/** useStreamBufferStats hook：管理流统计 */
export function useStreamBufferStats() {
  const [stats, setStats] = useState<StreamBufferStats | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getStreamBufferStats();
      setStats(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  return { stats, loading, error, refetch };
}

export default {
  listActiveStreams,
  listResumableStreams,
  listSessionStreams,
  getStreamMeta,
  getStreamChunks,
  subscribeStream,
  ackSubscription,
  unsubscribeStream,
  cleanupExpiredStreams,
  getStreamBufferStats,
  getStreamBufferConfig,
};
