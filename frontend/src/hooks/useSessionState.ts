/**
 * # ============================================================
 * Session 状态管理 Hook
 * # ============================================================
 * 核心作用：从 App.tsx 抽离 Session 生命周期管理（v6.4.0 P0-2 阶段2）
 * 运行流程：
 *   1. 启动时读取 localStorage 中的 current_session_id
 *   2. 若有：加载该历史会话
 *   3. 若无：自动创建空 Session
 *   4. serverSessions 变化时同步到本地 sessions（支持乐观更新）
 * 抽取日期：2026-07-27
 * 模块版本：v6.4.0 - P0-2 App.tsx 拆分第二阶段
 * 修改记录：
 *   - 2026-07-27 | v6.4.0 | 从 App.tsx 抽离 4 个 useState + 2 个 useEffect + 会话生命周期
 * ============================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSessions, createSession } from './useSessionsApi';
import { LS_CURRENT_SESSION_ID } from '../utils/messageFormatters';
import type { Session } from '../types';

export interface UseSessionStateOptions {
  /** App 模式（chat/coding），用于过滤会话 */
  appMode?: 'chat' | 'coding' | null;
  /** 自动创建空 Session 的默认配置 */
  autoCreateTitle?: string;
  /** 自动创建空 Session 的 user_first_message */
  autoCreateFirstMessage?: string;
}

export interface UseSessionStateResult {
  /** 当前激活的会话 ID */
  currentSessionId: string | null;
  /** 设置当前会话 ID */
  setCurrentSessionId: (id: string | null) => void;
  /** 完整会话列表（server 数据 + 本地覆盖） */
  sessions: Session[];
  /** 设置本地会话列表（用于乐观更新） */
  setSessions: (sessions: Session[]) => void;
  /** 是否正在加载会话列表 */
  sessionsLoading: boolean;
  /** 刷新会话列表 */
  refetchSessions: () => void;
  /** 自动加载/创建初始 Session */
  bootstrapSession: () => Promise<void>;
  /** 切换到指定 Session（写 localStorage） */
  selectSession: (id: string) => void;
  /** 清理当前 Session（用于会话已删除场景） */
  handleSessionNotFound: () => void;
}

/**
 * v6.4.0 P0-2：从 App.tsx 抽离的 Session 状态管理
 *
 * 主要职责：
 *   - 维护 currentSessionId 状态 + localStorage 持久化
 *   - 同步 server sessions → local sessions
 *   - 启动时自动 bootstrap（加载历史或创建新会话）
 *   - 提供 selectSession / handleSessionNotFound 辅助方法
 */
export function useSessionState(
  options: UseSessionStateOptions = {},
): UseSessionStateResult {
  const {
    appMode = null,
    autoCreateTitle = '新对话',
    autoCreateFirstMessage = '',
  } = options;

  const [currentSessionId, setCurrentSessionIdState] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const initializedRef = useRef<boolean>(false);

  // 1. 拉取 server 端 session 列表
  const {
    sessions: serverSessions,
    loading: sessionsLoading,
    refetch: refetchSessions,
  } = useSessions('active', appMode ?? undefined);

  // 2. 同步 serverSessions → 本地 sessions（乐观更新）
  useEffect(() => {
    setSessions(serverSessions);
  }, [serverSessions]);

  // 3. setCurrentSessionId 的封装：自动写 localStorage
  const setCurrentSessionId = useCallback((id: string | null) => {
    setCurrentSessionIdState(id);
    if (id) {
      try {
        localStorage.setItem(LS_CURRENT_SESSION_ID, id);
      } catch {
        // 静默降级（Safari 隐私模式等）
      }
    } else {
      try {
        localStorage.removeItem(LS_CURRENT_SESSION_ID);
      } catch {
        // 静默降级
      }
    }
  }, []);

  // 4. bootstrap：加载历史或创建新 Session
  const bootstrapSession = useCallback(async () => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    let stored: string | null = null;
    try {
      stored = localStorage.getItem(LS_CURRENT_SESSION_ID);
    } catch {
      // 静默降级
    }

    if (stored) {
      setCurrentSessionIdState(stored);
      // 触发后续 useSessionDetail 加载（由调用方负责）
    } else {
      // 创建空 Session
      try {
        const created = await createSession({
          title: autoCreateTitle,
          user_first_message: autoCreateFirstMessage,
          mode: appMode ?? 'chat',
        });
        setCurrentSessionIdState(created.id);
        try {
          localStorage.setItem(LS_CURRENT_SESSION_ID, created.id);
        } catch {
          // 静默降级
        }
        refetchSessions();
      } catch (e) {
        console.error('useSessionState.bootstrap: 创建 Session 失败', e);
      }
    }
  }, [appMode, autoCreateTitle, autoCreateFirstMessage, refetchSessions]);

  // 5. 切换 Session
  const selectSession = useCallback((id: string) => {
    setCurrentSessionIdState(id);
    try {
      localStorage.setItem(LS_CURRENT_SESSION_ID, id);
    } catch {
      // 静默降级
    }
  }, []);

  // 6. 清理已删除的 Session
  const handleSessionNotFound = useCallback(() => {
    setCurrentSessionIdState(null);
    try {
      localStorage.removeItem(LS_CURRENT_SESSION_ID);
    } catch {
      // 静默降级
    }
  }, []);

  return {
    currentSessionId,
    setCurrentSessionId,
    sessions,
    setSessions,
    sessionsLoading,
    refetchSessions,
    bootstrapSession,
    selectSession,
    handleSessionNotFound,
  };
}
