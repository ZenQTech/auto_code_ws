/**
 * # ============================================================
 * useCustomCommands - 自定义命令 API Hook (v1.0.0) - Cycle 8 P0-13
 * # ============================================================
 * 核心作用：提供 .trae/commands/ 自定义命令的 CRUD + 执行 API
 * 支持：
 *   - 列出所有/项目级/全局级命令
 *   - 查询命令详情
 *   - 执行命令（生成 LLM 提示词）
 *   - 重新扫描目录
 *   - 创建/删除命令
 * 创建日期：2026-07-27
 * ============================================================
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './apiShared';

// ============================================================
// 类型定义
// ============================================================

export type CustomCommandScope = 'project' | 'global';

export interface CustomCommandArg {
  name: string;
  required: boolean;
  type: string;
  description: string;
  choices?: string[] | null;
  default?: unknown;
}

export interface CustomCommand {
  name: string;
  description: string;
  instructions: string;
  category: string;
  icon: string;
  aliases: string[];
  permission: string;
  args: CustomCommandArg[];
  allowed_tools: string[];
  file_path: string | null;
  scope: CustomCommandScope;
  parent_category: string;
  parse_error: string | null;
}

export interface CustomCommandSummary {
  total: number;
  categories: string[];
  project_path: string | null;
  last_refresh: number;
  by_scope: {
    project: number;
    global: number;
  };
}

export interface CommandExecutionResult {
  name: string;
  success: boolean;
  instructions: string;
  args: Record<string, string>;
  message: string;
  error: string | null;
  duration_ms: number;
}

// ============================================================
// Hook: useCustomCommandsList
// ============================================================

export interface UseCustomCommandsListOptions {
  scope?: CustomCommandScope;
  category?: string;
  projectPath?: string;
  autoFetch?: boolean;
}

export interface UseCustomCommandsListResult {
  commands: CustomCommand[];
  categories: string[];
  total: number;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useCustomCommandsList(
  options: UseCustomCommandsListOptions = {}
): UseCustomCommandsListResult {
  const { scope, category, projectPath, autoFetch = true } = options;
  const [commands, setCommands] = useState<CustomCommand[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(autoFetch);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (scope) params.set('scope', scope);
      if (category) params.set('category', category);
      if (projectPath) params.set('project_path', projectPath);
      const query = params.toString();
      const url = `/custom-commands${query ? `?${query}` : ''}`;
      const data = await apiFetch<{
        success: boolean;
        commands: CustomCommand[];
        total: number;
        categories: string[];
      }>(url);
      setCommands(data.commands || []);
      setCategories(data.categories || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      console.error('[useCustomCommandsList] 加载失败:', err);
    } finally {
      setLoading(false);
    }
  }, [scope, category, projectPath]);

  useEffect(() => {
    if (autoFetch) {
      refetch();
    }
  }, [autoFetch, refetch]);

  return { commands, categories, total, loading, error, refetch };
}

// ============================================================
// Hook: useCustomCommandSummary
// ============================================================

export function useCustomCommandSummary(
  projectPath?: string
): {
  summary: CustomCommandSummary | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const [summary, setSummary] = useState<CustomCommandSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (projectPath) params.set('project_path', projectPath);
      const query = params.toString();
      const url = `/custom-commands/summary${query ? `?${query}` : ''}`;
      const data = await apiFetch<{ success: boolean; summary: CustomCommandSummary }>(url);
      setSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { summary, loading, error, refetch };
}

// ============================================================
// Hook: useExecuteCustomCommand
// ============================================================

export function useExecuteCustomCommand() {
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async (
      name: string,
      args: Record<string, string> = {}
    ): Promise<CommandExecutionResult | null> => {
      setExecuting(true);
      setError(null);
      try {
        const data = await apiFetch<{
          success: boolean;
          result: CommandExecutionResult;
        }>(`/custom-commands/${encodeURIComponent(name)}/execute`, {
          method: 'POST',
          body: JSON.stringify({ args }),
        });
        return data.result;
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        return null;
      } finally {
        setExecuting(false);
      }
    },
    []
  );

  return { execute, executing, error };
}

// ============================================================
// Hook: useRefreshCustomCommands
// ============================================================

export function useRefreshCustomCommands() {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async (projectPath?: string) => {
    setRefreshing(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (projectPath) params.set('project_path', projectPath);
      const query = params.toString();
      const url = `/custom-commands/refresh${query ? `?${query}` : ''}`;
      const data = await apiFetch<{
        success: boolean;
        scan: {
          total: number;
          project_count: number;
          global_count: number;
          categories: string[];
        };
      }>(url, { method: 'POST' });
      return data.scan;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      return null;
    } finally {
      setRefreshing(false);
    }
  }, []);

  return { refresh, refreshing, error };
}

// ============================================================
// Hook: useDeleteCustomCommand
// ============================================================

export function useDeleteCustomCommand() {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const remove = useCallback(async (name: string) => {
    setDeleting(true);
    setError(null);
    try {
      const data = await apiFetch<{ success: boolean }>(
        `/custom-commands/${encodeURIComponent(name)}`,
        { method: 'DELETE' }
      );
      return data.success;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      return false;
    } finally {
      setDeleting(false);
    }
  }, []);

  return { remove, deleting, error };
}
