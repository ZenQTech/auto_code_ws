import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './apiShared';
import type { Session, SessionDetail, SessionStatus, WSMessage } from '../types';

/**
 * # ============================================================
 * 会话 API 模块
 * # ============================================================
 * 核心作用：封装 WebSocket + 会话 CRUD + 回收站 API
 * 拆分日期：2026-07-27
 * 来源文件：hooks/useApi.ts (v3.0.0, 1872 行单文件)
 * 模块版本：v6.5.0 - P0-3 useApi.ts 拆分第一阶段
 * 修改记录：
 *   - 2026-07-27 | v6.5.0 | 从 useApi.ts 抽离 useWebSocket + useSessions + useSessionDetail + createSession + updateSession + deleteSession + batchDeleteSessions + fetchTrashSessions + restoreSessions + emptyTrash 共 10 个函数
 * ============================================================
 */

/**
 * 共享类型导入
 */
export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WSMessage;
        setLastMessage(msg);
      } catch {
        // ignore parse errors
      }
    };

    // 心跳
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    return () => {
      clearInterval(pingInterval);
      ws.close();
    };
  }, []);

  const send = useCallback((msg: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { connected, lastMessage, send };
}

// ============================================================
// Session API（v1.2.0 新增）
// 核心作用：封装"会话（Session）"的 CRUD + 详情聚合操作
// 端点契约：
//   - POST   /api/sessions              创建
//   - GET    /api/sessions?status=...   列表
//   - GET    /api/sessions/{id}         单条
//   - GET    /api/sessions/{id}/detail  聚合详情
//   - PATCH  /api/sessions/{id}         更新
//   - DELETE /api/sessions/{id}         删除
// ============================================================

/**
 * 获取会话列表
 * 作用：拉取所有 Session 列表（按 last_active_at 倒序）
 * 调用方：Sidebar.tsx 边栏会话列表
 * 被调用方：GET /api/sessions
 * 参数：
 *   - status?: SessionStatus，可选状态过滤（active / archived）
 *   - mode?: 'chat' | 'coding'，可选模式过滤（v1.8.0 新增），传入后追加 &mode= 查询参数
 * 返回值：{ sessions, loading, refetch }
 */
export function useSessions(status?: SessionStatus, mode?: 'chat' | 'coding') {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (mode) params.set('mode', mode);
      const qs = params.toString();
      const data = await apiFetch<Session[]>(`/sessions${qs ? '?' + qs : ''}`);
      setSessions(data);
    } catch (e) {
      console.error('获取会话列表失败:', e);
    } finally {
      setLoading(false);
    }
  }, [status, mode]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  return { sessions, loading, refetch: fetchSessions };
}

/**
 * 获取会话详情（聚合）
 * 作用：一次拉取完整上下文（session + messages + agents + tasks + conversations）
 * 调用方：App.tsx 切换 Session 时
 * 被调用方：GET /api/sessions/{id}/detail
 * 参数：
 *   - sessionId: string | null，会话 ID；传入 null 时清空 detail 并跳过请求
 *   - options?: { onNotFound?: () => void }，v1.9.0 新增；可选回调配置：
 *       - onNotFound：当后端返回 404（Session 不存在）时静默触发（不 console.error），
 *         用于父组件实现启动 / 切换时的 404 自动回退逻辑（清除 localStorage + createSession）
 *       - 404 之外的其他错误（500 / 网络 / JSON 解析）**不**触发 onNotFound，
 *         改为 console.warn + setDetail(null)，避免误报
 *       - 使用 useRef 模式保持回调引用最新，避免 useEffect 依赖项变更引发的重渲染
 * 返回值：{ detail, loading }
 */
export function useSessionDetail(
  sessionId: string | null,
  options?: { onNotFound?: () => void },
) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  // v1.9.0：用 useRef 保持 onNotFound 引用最新，避免 useEffect 因回调变化而重复触发请求
  const onNotFoundRef = useRef(options?.onNotFound);
  onNotFoundRef.current = options?.onNotFound;

  useEffect(() => {
    if (!sessionId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    apiFetch<SessionDetail>(`/sessions/${sessionId}/detail`)
      .then(setDetail)
      .catch((e) => {
        // v1.9.0：区分 404 与其他错误
        // 404 检测：apiFetch 抛出的 Error.message 包含后端 HTTPException 的 detail 字段
        //          后端 /api/sessions/{id}/detail 在 Session 不存在时返回 detail="Session 不存在"
        //          兼容匹配：消息含 "Session 不存在" 或 "404" 即视为 404
        const isNotFound = e instanceof Error && (
          e.message.includes('Session 不存在') ||
          e.message.includes('404')
        );
        if (isNotFound) {
          // 404 是预期清理场景（localStorage 残留 / Session 被删除 / 归档），
          // 静默触发 onNotFound 回调 + console.debug，**不**console.error
          console.debug(`Session ${sessionId} 不存在，自动回退`);
          onNotFoundRef.current?.();
          setDetail(null);
        } else {
          // 其他错误（500 / 网络中断 / JSON 解析）：console.warn（非 error），
          // 可能是临时网络问题，用户刷新即可恢复
          console.warn('获取会话详情失败:', e);
          setDetail(null);
        }
      })
      .finally(() => setLoading(false));
  }, [sessionId]);

  return { detail, loading };
}

/**
 * 创建新会话
 * 作用：调用 POST /api/sessions 创建一个空 Session
 * 调用方：App.tsx 启动初始化 / 新建任务按钮
 * 被调用方：POST /api/sessions
 * 参数：
 *   - payload?: { title?, user_first_message?, mode? }，可选元数据；
 *     mode 为 'chat' | 'coding'（v1.8.0 新增），指定会话所属模式
 * 返回值：Promise<Session>
 */
export async function createSession(payload?: { title?: string; user_first_message?: string; mode?: 'chat' | 'coding' }): Promise<Session> {
  return apiFetch<Session>('/sessions', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

/**
 * 更新会话
 * 作用：调用 PATCH /api/sessions/{id} 更新 title / status / last_active_at
 * 调用方：App.tsx 切会话后更新活跃时间 / Sidebar 归档 / 重命名
 * 被调用方：PATCH /api/sessions/{id}
 * 参数：
 *   - sessionId: string，会话 ID
 *   - payload: { title?, status?, last_active_at? }
 * 返回值：Promise<Session>
 */
export async function updateSession(
  sessionId: string,
  payload: { title?: string; status?: SessionStatus; last_active_at?: string },
): Promise<Session> {
  return apiFetch<Session>(`/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/**
 * 删除会话
 * 作用：调用 DELETE /api/sessions/{id} 级联删除关联数据
 * 调用方：App.tsx handleDeleteSession
 * 被调用方：DELETE /api/sessions/{id}
 * 参数：
 *   - sessionId: string，会话 ID
 * 返回值：Promise<{ message, session_id, deleted_counts }>
 */
export async function deleteSession(
  sessionId: string,
): Promise<{ message: string; session_id: string; deleted_counts: Record<string, number> }> {
  return apiFetch(`/sessions/${sessionId}`, { method: 'DELETE' });
}

// ============================================================
// 批量删除与回收站 API（v1.6.0 新增）
// 核心作用：封装批量删除、回收站查询、恢复、清空等回收站管理操作
// 端点契约：
//   - POST   /api/sessions/batch-delete     批量删除（迁移至回收站）
//   - GET    /api/sessions/trash            获取回收站会话列表
//   - POST   /api/sessions/trash/restore    恢复回收站会话
//   - DELETE /api/sessions/trash/empty      清空回收站
// ============================================================

/**
 * 批量删除会话（软删除，迁移至回收站）
 * 作用：调用 POST /api/sessions/batch-delete 批量将活跃/归档会话标记为 deleted
 * 调用方：App.tsx handleBatchDelete
 * 被调用方：POST /api/sessions/batch-delete
 * 参数：
 *   - sessionIds: string[]，待批量删除的会话 ID 列表
 * 返回值：Promise<{ message: string; deleted_count: number }>
 */
export async function batchDeleteSessions(
  sessionIds: string[],
): Promise<{ message: string; deleted_count: number }> {
  return apiFetch('/sessions/batch-delete', {
    method: 'POST',
    body: JSON.stringify({ session_ids: sessionIds }),
  });
}

/**
 * 获取回收站会话列表
 * 作用：调用 GET /api/sessions/trash 拉取所有 status='deleted' 的会话
 * 调用方：Sidebar.tsx 回收站视图
 * 被调用方：GET /api/sessions/trash
 * 参数：无
 * 返回值：Promise<Session[]>
 */
export async function fetchTrashSessions(): Promise<Session[]> {
  return apiFetch<Session[]>('/sessions/trash');
}

/**
 * 恢复回收站会话
 * 作用：调用 POST /api/sessions/trash/restore 将 deleted 会话恢复为 active
 * 调用方：Sidebar.tsx 回收站视图
 * 被调用方：POST /api/sessions/trash/restore
 * 参数：
 *   - sessionIds: string[]，待恢复的会话 ID 列表
 * 返回值：Promise<{ message: string; restored_count: number }>
 */
export async function restoreSessions(
  sessionIds: string[],
): Promise<{ message: string; restored_count: number }> {
  return apiFetch('/sessions/trash/restore', {
    method: 'POST',
    body: JSON.stringify({ session_ids: sessionIds }),
  });
}

/**
 * 清空回收站
 * 作用：调用 DELETE /api/sessions/trash/empty 永久删除回收站中所有会话
 * 调用方：Sidebar.tsx 回收站视图
 * 被调用方：DELETE /api/sessions/trash/empty
 * 参数：无
 * 返回值：Promise<{ message: string; deleted_count: number }>
 */
export async function emptyTrash(): Promise<{ message: string; deleted_count: number }> {
  return apiFetch('/sessions/trash/empty', { method: 'DELETE' });
}

