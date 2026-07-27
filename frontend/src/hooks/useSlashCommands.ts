/**
 * # ============================================================
 * useSlashCommands - Slash Commands 注册表 Hook
 * # ============================================================
 * 核心作用：从后端获取所有可用的 Slash Commands
 * 封装 API：
 *   - useSlashCommands() - 自动加载并管理命令列表
 *   - useSlashCommandSearch() - 搜索命令
 *   - useSlashCommandByName() - 查询单个命令
 *
 * 创建日期：2026-07-27
 * 模块版本：v1.0.0 - Cycle 8 P0-12
 * ============================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from './apiShared';

// ============================================================
// 类型定义
// ============================================================

/** 命令分类 */
export type SlashCommandCategory =
  | 'navigation'
  | 'workspace'
  | 'mode'
  | 'agent'
  | 'ux'
  | 'loop'
  | 'custom';

/** 命令参数定义 */
export interface SlashCommandArg {
  name: string;
  description: string;
  required: boolean;
  default?: unknown;
  choices?: string[] | null;
}

/** Slash Command 定义 */
export interface SlashCommand {
  name: string;
  description: string;
  category: SlashCommandCategory;
  args: SlashCommandArg[];
  aliases: string[];
  handler: string;
  enabled: boolean;
  built_in: boolean;
  permission: string;
  icon: string;
  shortcut: string;
}

/** 命令分类（含本地化 label） */
export interface CommandCategoryInfo {
  name: SlashCommandCategory;
  label: string;
  total: number;
  enabled: number;
  commands: SlashCommand[];
}

/** 注册表摘要 */
export interface SlashCommandsSummary {
  total: number;
  enabled: number;
  disabled: number;
  built_in: number;
  custom: number;
  by_category: Record<string, number>;
}

// ============================================================
// 分类 label 映射
// ============================================================

export const CATEGORY_LABELS: Record<SlashCommandCategory, string> = {
  navigation: '导航与会话',
  workspace: '工作区与项目',
  mode: '模式切换',
  agent: '智能体管理',
  ux: '显示与设置',
  loop: 'Loop Engineering',
  custom: '用户自定义',
};

/** 分类显示顺序 */
export const CATEGORY_ORDER: SlashCommandCategory[] = [
  'navigation',
  'workspace',
  'mode',
  'agent',
  'ux',
  'loop',
  'custom',
];

// ============================================================
// Hook 1: 加载所有命令
// ============================================================

export interface UseSlashCommandsResult {
  /** 命令列表（已过滤：仅 enabled） */
  commands: SlashCommand[];
  /** 命令总数（含 disabled） */
  total: number;
  /** 按分类分组 */
  byCategory: CommandCategoryInfo[];
  /** 加载状态 */
  loading: boolean;
  /** 错误 */
  error: Error | null;
  /** 重新加载 */
  refetch: () => Promise<void>;
  /** 按名称获取 */
  getByName: (name: string) => SlashCommand | undefined;
  /** 按分类获取 */
  getByCategory: (cat: SlashCommandCategory) => SlashCommand[];
}

/**
 * useSlashCommands - 加载并缓存所有可用的 Slash Commands
 *
 * @param options.autoFetch 是否在挂载时自动加载（默认 true）
 * @returns UseSlashCommandsResult
 */
export function useSlashCommands(options: { autoFetch?: boolean } = {}): UseSlashCommandsResult {
  const { autoFetch = true } = options;
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [loading, setLoading] = useState<boolean>(autoFetch);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{
        total: number;
        commands: SlashCommand[];
      }>('/slash-commands');
      // 仅保留启用的
      setCommands(result.commands.filter((c) => c.enabled));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      console.error('[useSlashCommands] 加载失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (autoFetch) {
      refetch();
    }
  }, [autoFetch, refetch]);

  /** 按分类分组 */
  const byCategory = useMemo<CommandCategoryInfo[]>(() => {
    const grouped: Record<string, SlashCommand[]> = {};
    for (const cmd of commands) {
      if (!grouped[cmd.category]) grouped[cmd.category] = [];
      grouped[cmd.category].push(cmd);
    }

    return CATEGORY_ORDER
      .filter((cat) => grouped[cat] && grouped[cat].length > 0)
      .map((cat) => ({
        name: cat,
        label: CATEGORY_LABELS[cat] || cat,
        total: grouped[cat].length,
        enabled: grouped[cat].length,
        commands: grouped[cat],
      }));
  }, [commands]);

  const getByName = useCallback(
    (name: string) => commands.find((c) => c.name === name || c.aliases.includes(name)),
    [commands]
  );

  const getByCategory = useCallback(
    (cat: SlashCommandCategory) => commands.filter((c) => c.category === cat),
    [commands]
  );

  return {
    commands,
    total: commands.length,
    byCategory,
    loading,
    error,
    refetch,
    getByName,
    getByCategory,
  };
}

// ============================================================
// Hook 2: 搜索命令
// ============================================================

export interface UseSlashCommandSearchResult {
  /** 搜索结果 */
  results: SlashCommand[];
  /** 加载状态 */
  loading: boolean;
  /** 错误 */
  error: Error | null;
  /** 是否正在搜索（防抖中） */
  isSearching: boolean;
  /** 当前查询 */
  query: string;
  /** 设置查询（带防抖） */
  setQuery: (q: string) => void;
  /** 立即清空 */
  clear: () => void;
}

/**
 * useSlashCommandSearch - 搜索 Slash Commands（带前端过滤 + 后端搜索 API）
 *
 * @param options.debounceMs 防抖延迟（毫秒，默认 150）
 * @returns UseSlashCommandSearchResult
 */
export function useSlashCommandSearch(
  allCommands: SlashCommand[],
  options: { debounceMs?: number } = {}
): UseSlashCommandSearchResult {
  const { debounceMs = 150 } = options;
  const [query, setQueryRaw] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  // 防抖
  useEffect(() => {
    if (debouncedQuery === query) return;
    const t = setTimeout(() => setDebouncedQuery(query), debounceMs);
    return () => clearTimeout(t);
  }, [query, debounceMs, debouncedQuery]);

  // 前端过滤（避免不必要的网络请求）
  const results = useMemo<SlashCommand[]>(() => {
    if (!debouncedQuery) return allCommands;

    const q = debouncedQuery.toLowerCase();
    const scored: Array<{ score: number; cmd: SlashCommand }> = [];

    for (const cmd of allCommands) {
      let score = 0;
      if (cmd.name.toLowerCase() === q) score += 100;
      else if (cmd.name.toLowerCase().startsWith(q)) score += 50;
      else if (cmd.name.toLowerCase().includes(q)) score += 20;

      for (const alias of cmd.aliases) {
        if (alias.toLowerCase() === q) score += 40;
        else if (alias.toLowerCase().startsWith(q)) score += 15;
      }

      if (cmd.description.toLowerCase().includes(q)) score += 10;

      if (score > 0) scored.push({ score, cmd });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.cmd);
  }, [debouncedQuery, allCommands]);

  const setQuery = useCallback((q: string) => {
    setLoading(true);
    setQueryRaw(q);
    // 防抖结束后会更新 debouncedQuery
    setTimeout(() => setLoading(false), debounceMs);
  }, [debounceMs]);

  const clear = useCallback(() => {
    setQueryRaw('');
    setDebouncedQuery('');
  }, []);

  return {
    results,
    loading,
    error: null,
    isSearching: query !== debouncedQuery,
    query: debouncedQuery,
    setQuery,
    clear,
  };
}

// ============================================================
// Hook 3: 加载摘要
// ============================================================

export interface UseSlashCommandsSummaryResult {
  summary: SlashCommandsSummary | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * useSlashCommandsSummary - 加载注册表摘要统计
 */
export function useSlashCommandsSummary(): UseSlashCommandsSummaryResult {
  const [summary, setSummary] = useState<SlashCommandsSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<SlashCommandsSummary>('/slash-commands/summary');
      setSummary(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { summary, loading, error, refetch };
}

// ============================================================
// 默认导出
// ============================================================

export default useSlashCommands;
