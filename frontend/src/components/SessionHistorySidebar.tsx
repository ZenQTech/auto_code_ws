/**
 * # ============================================================
 * SessionHistorySidebar - 会话历史侧边栏 (v1.0.0)
 * Cycle 60 G60-3.1
 * # ============================================================
 * 核心作用：Solo 模式左侧会话历史侧边栏（对标 Codex/Trae Solo）
 * 运行流程：
 *   1. 挂载时拉取 GET /api/vibe-coding/sessions
 *   2. 渲染最近 20 个 session（按 createdAt 倒序）
 *   3. 点击 item 触发 vibeCoding.resumeSession(id)
 *   4. 当前 active session 高亮
 *   5. "新建 Session" 按钮清空当前 session
 * 设计要点：
 *   - 5s 内不重复拉取（缓存）
 *   - 空状态友好提示
 *   - 主题感知样式
 *   - 失败容错：网络错误时显示空列表而非崩溃
 * 输入参数：{ vibeCoding: UseVibeCodingResult }
 * 输出结果：左侧侧边栏 UI
 * ====================================
 * 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 60 G60-3.1 初次创建
 * #   - 2026-08-03 | v1.1.0 | G60-FIX-9 修复：添加 setInterval 轮询，自动刷新会话状态
 * #                 （之前只在 mount/session.id 变化时刷新，导致进行中的 session
 * #                 状态在侧边栏一直停留在初始 clarifying）
 * ====================================
 */

import React, { useEffect, useState, useCallback } from 'react';
import type { UseVibeCodingResult, VibeState, VibeSession } from '../hooks/useVibeCoding';

// ============================================================
// 类型
// ============================================================

export interface SessionHistorySidebarProps {
  vibeCoding: UseVibeCodingResult;
  /** 拉取间隔（ms，默认 5000） */
  refreshInterval?: number;
  /** 最大显示数量（默认 20） */
  maxItems?: number;
}

const STATE_BADGE_COLORS: Record<VibeState, string> = {
  idle: 'bg-slate-100 text-slate-700',
  clarifying: 'bg-amber-100 text-amber-700',
  planning: 'bg-purple-100 text-purple-700',
  executing: 'bg-emerald-100 text-emerald-700',
  reviewing: 'bg-cyan-100 text-cyan-700',
  done: 'bg-green-100 text-green-700',
  paused: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-gray-100 text-gray-500',
  error: 'bg-red-100 text-red-700',
};

const STATE_LABELS: Record<VibeState, string> = {
  idle: '空闲',
  clarifying: '澄清',
  planning: 'Plan',
  executing: '执行',
  reviewing: '审核',
  done: '完成',
  paused: '暂停',
  cancelled: '取消',
  error: '错误',
};

// ============================================================
// 辅助函数
// ============================================================

const isBrowser = typeof window !== 'undefined';

/** 安全读取 localStorage */
function readCache(): { data: VibeSession[]; ts: number } | null {
  if (!isBrowser) return null;
  try {
    const raw = window.localStorage.getItem('hermes.solo.sessionHistory');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCache(data: VibeSession[]): void {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(
      'hermes.solo.sessionHistory',
      JSON.stringify({ data, ts: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

// ============================================================
// 组件
// ============================================================

export const SessionHistorySidebar: React.FC<SessionHistorySidebarProps> = ({
  vibeCoding,
  refreshInterval = 5000,
  maxItems = 20,
}) => {
  const [history, setHistory] = useState<VibeSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number>(0);

  // 拉取历史 sessions
  const fetchHistory = useCallback(
    async (force = false) => {
      if (!isBrowser) return;

      // 缓存命中（< refreshInterval ms）
      if (!force && Date.now() - lastFetched < refreshInterval) return;

      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/vibe-coding/sessions');
        if (!res.ok) {
          // 404 表示还没有任何 session
          if (res.status === 404) {
            setHistory([]);
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        const sessions: VibeSession[] = (data.sessions || []).slice(0, maxItems);
        setHistory(sessions);
        writeCache(sessions);
        setLastFetched(Date.now());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        // 失败时使用缓存
        const cache = readCache();
        if (cache) {
          setHistory(cache.data);
        }
      } finally {
        setLoading(false);
      }
    },
    [lastFetched, refreshInterval, maxItems],
  );

  // 挂载时拉取 + 读缓存
  useEffect(() => {
    const cache = readCache();
    if (cache) {
      setHistory(cache.data);
      setLastFetched(cache.ts);
    }
    fetchHistory(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 当前 session 变化时刷新
  useEffect(() => {
    fetchHistory();
  }, [vibeCoding.session?.id, fetchHistory]);

  // G60-FIX-9: 添加 setInterval 轮询，自动刷新进行中 session 的状态
  useEffect(() => {
    const id = window.setInterval(() => {
      fetchHistory(true);
    }, refreshInterval);
    return () => window.clearInterval(id);
  }, [fetchHistory, refreshInterval]);

  // 切换 session
  const handleSelect = useCallback(
    async (id: string) => {
      if (id === vibeCoding.session?.id) return;
      try {
        await vibeCoding.resumeSession(id);
      } catch (err) {
        console.warn('SessionHistorySidebar: resumeSession failed', err);
      }
    },
    [vibeCoding],
  );

  // 新建
  const handleNew = useCallback(() => {
    vibeCoding.clearSession();
  }, [vibeCoding]);

  return (
    <aside
      className="h-full flex flex-col bg-[var(--bg-panel)] border-r border-[var(--border-color)]"
      data-testid="session-history-sidebar"
    >
      <header className="px-4 py-3 border-b border-[var(--border-color)]">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">会话历史</h3>
        <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
          最近 {maxItems} 个 Vibe Session
        </p>
      </header>

      <div
        className="flex-1 overflow-y-auto p-2 space-y-1"
        data-testid="session-history-list"
      >
        {loading && history.length === 0 ? (
          <div className="text-xs text-[var(--text-tertiary)] text-center py-8">
            加载中...
          </div>
        ) : history.length === 0 ? (
          <div
            className="text-xs text-[var(--text-tertiary)] text-center py-8"
            data-testid="session-history-empty"
          >
            暂无历史<br />
            <span className="text-[10px]">启动一个新 session 开始</span>
          </div>
        ) : (
          history.map((s) => {
            const isActive = s.id === vibeCoding.session?.id;
            const completed = s.steps.filter((step) => step.status === 'completed').length;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSelect(s.id)}
                className={[
                  'w-full text-left p-2 rounded-md text-xs transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-hermes-500',
                  isActive
                    ? 'bg-hermes-500/15 text-hermes-700 border border-hermes-500/40'
                    : 'hover:bg-[var(--bg-elevated)] text-[var(--text-primary)]',
                ].join(' ')}
                data-testid={`history-item-${s.id}`}
                aria-current={isActive ? 'true' : undefined}
              >
                <div className="font-medium truncate mb-1" title={s.prompt}>
                  {s.prompt || '(空 prompt)'}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]">
                  <span className={['px-1.5 py-0.5 rounded', STATE_BADGE_COLORS[s.state]].join(' ')}>
                    {STATE_LABELS[s.state]}
                  </span>
                  <span>
                    {completed}/{s.steps.length} 步
                  </span>
                </div>
                <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5 font-mono truncate">
                  {s.id}
                </div>
              </button>
            );
          })
        )}

        {error && (
          <div className="text-[10px] text-red-500 text-center py-2" data-testid="session-history-error">
            加载失败: {error}
          </div>
        )}
      </div>

      <footer className="p-2 border-t border-[var(--border-color)]">
        <button
          type="button"
          onClick={handleNew}
          className="w-full text-xs px-2 py-1.5 rounded-md
                     bg-[var(--bg-elevated)] text-[var(--text-primary)]
                     border border-[var(--border-color)]
                     hover:border-hermes-500 hover:text-hermes-700
                     transition-colors"
          data-testid="session-new-btn"
        >
          + 新建 Session
        </button>
      </footer>
    </aside>
  );
};

export default SessionHistorySidebar;
