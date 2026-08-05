/**
 * # ============================================================
 * # useCodebase Hook (v1.0.0)
 * # Cycle 68 G68-01
 * # ====================================
 * # 核心作用：封装 Codebase Indexer REST API
 * # 功能：
 * #   1. 构建项目代码库索引
 * #   2. 搜索代码（文本 + 符号）
 * #   3. 读取文件片段
 * #   4. 获取索引统计
 * #   5. 列出所有会话
 * # 输入参数：baseUrl
 * # 输出结果：UseCodebaseResult
 * # 对标：Codex codex-rs/project_index
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 68 G68-01 初次创建
 * # ====================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================
// 类型定义
// ============================================================

export interface CodebaseStats {
  session_id: string;
  project_root: string;
  total_files: number;
  total_symbols: number;
  total_lines: number;
  languages: Record<string, number>;
  indexed_at: number;
  build_time_ms: number;
  fs_watch_active: boolean;
}

export interface SearchResult {
  type: 'file' | 'symbol' | 'text';
  file: string;
  line?: number;
  line_start?: number;
  line_end?: number;
  name?: string;
  kind?: string;
  signature?: string;
  snippet?: string;
  score: number;
}

export interface CodebaseFileRange {
  path: string;
  language: string;
  total_lines: number;
  lines: Array<{ line_no: number; content: string }>;
}

export interface CodebaseSession {
  session_id: string;
  project_root: string;
  total_files: number;
  total_symbols: number;
}

export interface UseCodebaseResult {
  // Index
  buildIndex: (projectRoot: string, forceRebuild?: boolean) => Promise<CodebaseStats>;
  indexStats: CodebaseStats | null;
  building: boolean;
  buildError: string | null;

  // Search
  search: (
    sessionId: string,
    query: string,
    options?: { topK?: number; filePattern?: string; includeSymbols?: boolean },
  ) => Promise<SearchResult[]>;
  searchResults: SearchResult[];
  searching: boolean;
  lastQuery: string;

  // File
  getFile: (
    sessionId: string,
    path: string,
    options?: { lineStart?: number; lineEnd?: number },
  ) => Promise<CodebaseFileRange>;
  currentFile: CodebaseFileRange | null;
  loadingFile: boolean;

  // Sessions
  sessions: CodebaseSession[];
  refreshSessions: () => Promise<void>;

  // Active session
  activeSessionId: string | null;
  setActiveSession: (sessionId: string | null) => void;

  // Reset
  reset: () => void;
}

// ============================================================
// Hook
// ============================================================

export function useCodebase(baseUrl: string = ''): UseCodebaseResult {
  const [indexStats, setIndexStats] = useState<CodebaseStats | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [lastQuery, setLastQuery] = useState('');

  const [currentFile, setCurrentFile] = useState<CodebaseFileRange | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  const [sessions, setSessions] = useState<CodebaseSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // ============================================================
  // Helpers
  // ============================================================

  const apiUrl = useCallback(
    (path: string): string => {
      const base = baseUrl || '';
      return `${base}/api/codebase${path}`;
    },
    [baseUrl],
  );

  // ============================================================
  // Build index
  // ============================================================

  const buildIndex = useCallback(
    async (projectRoot: string, forceRebuild: boolean = false): Promise<CodebaseStats> => {
      setBuilding(true);
      setBuildError(null);
      try {
        const resp = await fetch(apiUrl('/index'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_root: projectRoot,
            force_rebuild: forceRebuild,
          }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ detail: resp.statusText }));
          throw new Error(err.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const stats: CodebaseStats = {
          session_id: data.session_id,
          project_root: data.project_root,
          total_files: data.total_files,
          total_symbols: data.total_symbols,
          total_lines: data.total_lines,
          languages: data.languages || {},
          indexed_at: Date.now() / 1000,
          build_time_ms: data.build_time_ms || 0,
          fs_watch_active: false,
        };
        if (isMounted.current) {
          setIndexStats(stats);
          setActiveSessionId(stats.session_id);
        }
        return stats;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isMounted.current) {
          setBuildError(msg);
        }
        throw e;
      } finally {
        if (isMounted.current) {
          setBuilding(false);
        }
      }
    },
    [apiUrl],
  );

  // ============================================================
  // Search
  // ============================================================

  const search = useCallback(
    async (
      sessionId: string,
      query: string,
      options: { topK?: number; filePattern?: string; includeSymbols?: boolean } = {},
    ): Promise<SearchResult[]> => {
      setSearching(true);
      try {
        const resp = await fetch(apiUrl('/search'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            query,
            top_k: options.topK ?? 20,
            file_pattern: options.filePattern,
            include_symbols: options.includeSymbols ?? true,
          }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ detail: resp.statusText }));
          throw new Error(err.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const results: SearchResult[] = (data.results || []).map((r: any) => ({
          type: r.type || 'text',
          file: r.file || '',
          line: r.line,
          line_start: r.line_start,
          line_end: r.line_end,
          name: r.name,
          kind: r.kind,
          signature: r.signature,
          snippet: r.snippet,
          score: r.score || 0,
        }));
        if (isMounted.current) {
          setSearchResults(results);
          setLastQuery(query);
        }
        return results;
      } finally {
        if (isMounted.current) {
          setSearching(false);
        }
      }
    },
    [apiUrl],
  );

  // ============================================================
  // Get file
  // ============================================================

  const getFile = useCallback(
    async (
      sessionId: string,
      path: string,
      options: { lineStart?: number; lineEnd?: number } = {},
    ): Promise<CodebaseFileRange> => {
      setLoadingFile(true);
      try {
        const params = new URLSearchParams({
          session_id: sessionId,
          path,
        });
        if (options.lineStart !== undefined) {
          params.set('line_start', String(options.lineStart));
        }
        if (options.lineEnd !== undefined) {
          params.set('line_end', String(options.lineEnd));
        }
        const resp = await fetch(`${apiUrl('/file')}?${params.toString()}`);
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ detail: resp.statusText }));
          throw new Error(err.detail || `HTTP ${resp.status}`);
        }
        const data: CodebaseFileRange = await resp.json();
        if (isMounted.current) {
          setCurrentFile(data);
        }
        return data;
      } finally {
        if (isMounted.current) {
          setLoadingFile(false);
        }
      }
    },
    [apiUrl],
  );

  // ============================================================
  // Sessions
  // ============================================================

  const refreshSessions = useCallback(async () => {
    try {
      const resp = await fetch(apiUrl('/sessions'));
      if (!resp.ok) {
        return;
      }
      const data = await resp.json();
      if (isMounted.current) {
        setSessions(data.sessions || []);
      }
    } catch {
      // ignore
    }
  }, [apiUrl]);

  // ============================================================
  // Reset
  // ============================================================

  const reset = useCallback(() => {
    setIndexStats(null);
    setBuildError(null);
    setSearchResults([]);
    setLastQuery('');
    setCurrentFile(null);
    setActiveSessionId(null);
  }, []);

  return {
    buildIndex,
    indexStats,
    building,
    buildError,
    search,
    searchResults,
    searching,
    lastQuery,
    getFile,
    currentFile,
    loadingFile,
    sessions,
    refreshSessions,
    activeSessionId,
    setActiveSession: setActiveSessionId,
    reset,
  };
}
