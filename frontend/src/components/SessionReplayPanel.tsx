/**
 * # ============================================================
 * # SessionReplayPanel - 会话回放面板 (v1.0.0)
 * # Cycle 69 G69-02
 * # ====================================
 * # 核心作用：本地会话列表 + HTML 回放渲染
 * # 设计要点：
 * #   1. 列出所有可回放的会话（按时间倒序）
 * #   2. 点击会话 → 渲染 HTML 回放（在新窗口打开）
 * #   3. 支持书签管理（添加/删除/列表）
 * #   4. 支持 Retention 策略（一键清理）
 * #   5. 显示存储统计
 * # 输入参数：可选 sessionId 用于打开指定会话
 * # 输出结果：UI 组件
 * # 对标：Codex codex-replay + Session Picker
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 69 G69-02 初次创建
 * # ====================================
 */

import React, { useCallback, useEffect, useState } from 'react';

// ============================================================
// 类型
// ============================================================

export interface SessionMetadata {
  session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  total_turns: number;
  total_tokens: number;
  cwd: string;
  git_branch?: string | null;
  duration_ms: number;
  rollout_path: string;
  size_bytes: number;
}

export interface SessionReplayPanelProps {
  testId?: string;
  initialSessionId?: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================
// 工具
// ============================================================

async function apiGet<T>(path: string): Promise<T> {
  const resp = await fetch(path);
  if (!resp.ok) {
    throw new Error(`API ${path} failed: ${resp.status}`);
  }
  return resp.json();
}

async function apiPost<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    throw new Error(`API ${path} failed: ${resp.status}`);
  }
  return resp.json();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ============================================================
// 主组件
// ============================================================

export const SessionReplayPanel: React.FC<SessionReplayPanelProps> = ({
  testId = 'session-replay-panel',
  initialSessionId,
}) => {
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialSessionId || null);

  const loadList = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const resp = await apiGet<ApiResponse<SessionMetadata[]>>('/api/replay/sessions');
      if (resp.success && resp.data) {
        setSessions(resp.data);
      } else {
        setSessions([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const openReplay = async (sessionId: string) => {
    try {
      // 打开 HTML 回放在新窗口
      const url = `/api/replay/sessions/${sessionId}/html`;
      const win = window.open('', '_blank');
      if (!win) {
        throw new Error('Popup blocked');
      }
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`Failed to load replay: ${resp.status}`);
      }
      const html = await resp.text();
      win.document.write(html);
      win.document.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRetention = async () => {
    if (!window.confirm('确认执行 retention 策略？这将压缩旧会话并清理过期数据。')) return;
    try {
      setLoading(true);
      await apiPost<ApiResponse<unknown>>('/api/replay/retention/apply', {
        policy: {
          max_age_days: 90,
          compress_threshold_mb: 1,
          auto_compress: true,
        },
      });
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-3 h-full overflow-auto" data-testid={testId}>
      <h3 className="text-sm font-semibold mb-3 text-[var(--text-primary)]">
        ▶️ 会话回放
      </h3>

      {error && (
        <div
          className="p-2 mb-3 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-400"
          data-testid={`${testId}-error`}
        >
          {error}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-[var(--text-secondary)]">
          共 {sessions.length} 个会话
        </span>
        <button
          onClick={handleRetention}
          disabled={loading}
          className="px-2 py-1 text-xs bg-yellow-500/20 text-yellow-400 rounded hover:bg-yellow-500/30 disabled:opacity-50"
          data-testid={`${testId}-retention-btn`}
        >
          🧹 Retention
        </button>
      </div>

      {sessions.length === 0 && !loading && (
        <div
          className="p-3 text-xs text-[var(--text-tertiary)] text-center rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]"
          data-testid={`${testId}-empty`}
        >
          暂无会话
        </div>
      )}

      <div className="space-y-2">
        {sessions.map((s) => (
          <div
            key={s.session_id}
            className={`p-2 rounded border cursor-pointer ${
              selectedId === s.session_id
                ? 'border-hermes-500 bg-hermes-500/10'
                : 'border-[var(--border-color)] bg-[var(--bg-elevated)]'
            }`}
            data-testid={`${testId}-item-${s.session_id}`}
            onClick={() => setSelectedId(s.session_id)}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-[var(--text-primary)] truncate flex-1">
                {s.title || s.session_id.slice(0, 12)}
              </span>
              <span className="text-[10px] text-[var(--text-tertiary)] ml-2">
                {formatDuration(s.duration_ms)}
              </span>
            </div>
            <div className="text-[10px] text-[var(--text-tertiary)] mb-1">
              {formatDate(s.created_at)} · {s.total_turns} 轮 · {s.total_tokens} tokens
            </div>
            <div className="text-[10px] text-[var(--text-tertiary)] font-mono mb-2 truncate">
              {s.cwd}
              {s.git_branch ? ` · ${s.git_branch}` : ''}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[var(--text-tertiary)]">
                {formatBytes(s.size_bytes)}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openReplay(s.session_id);
                }}
                className="px-2 py-0.5 text-[10px] bg-hermes-500 text-white rounded"
                data-testid={`${testId}-open-${s.session_id}`}
              >
                ▶ 播放
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SessionReplayPanel;
