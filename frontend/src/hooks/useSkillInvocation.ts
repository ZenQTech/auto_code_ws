/**
 * # ============================================================
 * # useSkillInvocation Hook (v1.0.0)
 * # Cycle 70 G70-01
 * # ====================================
 * # 核心作用：封装 Skill 调用 API（隐式匹配 + 显式调用）
 * # 功能：
 * #   1. 隐式匹配（POST /match）
 * #   2. 显式调用（POST /invoke）
 * #   3. 调用历史（GET /history）
 * # 输入参数：options
 * # 输出结果：matches + history + actions
 * # 对标：Codex CLI Skill Invocation
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 70 G70-01 初次创建
 * # ====================================
 */

import { useCallback, useState } from 'react';
import type { SkillV2 } from './useSkillsV2';

// ============================================================
// 类型定义
// ============================================================

export type InvocationType = 'explicit' | 'implicit' | 'none';
export type InvocationStatus = 'success' | 'failed' | 'rate_limited' | 'disabled' | 'not_found';

export interface SkillMatchResult {
  skill: SkillV2;
  similarity: number;
  matched_tokens: string[];
}

export interface SkillInvocation {
  id: string;
  skill_id: string;
  skill_name: string;
  invocation_type: InvocationType;
  query: string;
  args?: Record<string, unknown>;
  status: InvocationStatus;
  result?: string;
  error?: string;
  timestamp: number;
  duration_ms: number;
}

export interface UseSkillInvocationResult {
  matches: SkillMatchResult[];
  history: SkillInvocation[];
  loading: boolean;
  error: string | null;
  lastInvocation: SkillInvocation | null;

  match: (query: string, topK?: number, threshold?: number) => Promise<SkillMatchResult[]>;
  invoke: (skillName: string, args?: Record<string, unknown>, context?: string) => Promise<SkillInvocation | null>;
  refreshHistory: (limit?: number) => Promise<void>;
  clearError: () => void;
}

// ============================================================
// 常量
// ============================================================

const DEFAULT_BASE_URL = '/api/skill-invocation';
const DEFAULT_TOP_K = 3;
const DEFAULT_THRESHOLD = 0.15;
const DEFAULT_HISTORY_LIMIT = 50;

// ============================================================
// 辅助函数
// ============================================================

function handleError(err: unknown, action: string): string {
  if (err instanceof Error) {
    return `${action}: ${err.message}`;
  }
  return `${action}: 未知错误`;
}

// ============================================================
// Hook 主实现
// ============================================================

export function useSkillInvocation(): UseSkillInvocationResult {
  const [matches, setMatches] = useState<SkillMatchResult[]>([]);
  const [history, setHistory] = useState<SkillInvocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInvocation, setLastInvocation] = useState<SkillInvocation | null>(null);

  // ============================================================
  // 隐式匹配
  // ============================================================

  const match = useCallback(
    async (
      query: string,
      topK: number = DEFAULT_TOP_K,
      threshold: number = DEFAULT_THRESHOLD
    ): Promise<SkillMatchResult[]> => {
      if (!query || !query.trim()) {
        setMatches([]);
        return [];
      }
      setError(null);
      setLoading(true);
      try {
        const resp = await fetch(`${DEFAULT_BASE_URL}/match`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            top_k: topK,
            threshold,
          }),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const result: SkillMatchResult[] = data.matches || [];
        setMatches(result);
        return result;
      } catch (err) {
        setError(handleError(err, 'match'));
        return [];
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // ============================================================
  // 显式调用
  // ============================================================

  const invoke = useCallback(
    async (
      skillName: string,
      args?: Record<string, unknown>,
      context?: string
    ): Promise<SkillInvocation | null> => {
      setError(null);
      try {
        const resp = await fetch(`${DEFAULT_BASE_URL}/invoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skill_name: skillName,
            args: args || {},
            context: context || '',
          }),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const invocation: SkillInvocation = data.invocation;
        setLastInvocation(invocation);
        // 自动追加到历史
        setHistory((prev) => [invocation, ...prev].slice(0, DEFAULT_HISTORY_LIMIT));
        return invocation;
      } catch (err) {
        setError(handleError(err, 'invoke'));
        return null;
      }
    },
    []
  );

  // ============================================================
  // 刷新历史
  // ============================================================

  const refreshHistory = useCallback(async (limit: number = DEFAULT_HISTORY_LIMIT) => {
    setError(null);
    try {
      const resp = await fetch(
        `${DEFAULT_BASE_URL}/history?limit=${limit}`,
        { method: 'GET' }
      );
      if (!resp.ok) {
        // 404 means no history yet
        if (resp.status === 404) {
          setHistory([]);
          return;
        }
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      const data = await resp.json();
      setHistory(data.history || []);
    } catch (err) {
      setError(handleError(err, 'refreshHistory'));
    }
  }, []);

  // ============================================================
  // 公开接口
  // ============================================================

  const clearError = useCallback(() => setError(null), []);

  return {
    matches,
    history,
    loading,
    error,
    lastInvocation,
    match,
    invoke,
    refreshHistory,
    clearError,
  };
}

export default useSkillInvocation;
