/**
 * # ============================================================
 * # CodebasePanel 组件 (v1.0.0)
 * # Cycle 68 G68-01
 * # ====================================
 * # 核心作用：代码库浏览面板
 * # 功能：
 * #   1. 选择项目根目录 → 构建索引
 * #   2. 显示索引统计（文件数、符号数、语言分布）
 * #   3. 搜索代码（文本 + 符号）
 * #   4. 点击搜索结果 → 读取文件片段
 * # 输入参数：baseUrl
 * # 输出结果：UI 面板
 * # 对标：Codex codex-rs/project_index
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 68 G68-01 初次创建
 * # ====================================
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useCodebase, SearchResult, CodebaseFileRange } from '../hooks/useCodebase';

interface CodebasePanelProps {
  baseUrl?: string;
  defaultRoot?: string;
  onClose?: () => void;
}

const formatNumber = (n: number): string => {
  if (n >= 1000) {
    return n.toLocaleString();
  }
  return String(n);
};

export function CodebasePanel({
  baseUrl = '',
  defaultRoot = '',
  onClose,
}: CodebasePanelProps) {
  const {
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
    activeSessionId,
    setActiveSession,
    reset,
  } = useCodebase(baseUrl);

  const [projectRoot, setProjectRoot] = useState<string>(defaultRoot);
  const [query, setQuery] = useState<string>('');
  const [filePattern, setFilePattern] = useState<string>('');
  const [topK, setTopK] = useState<number>(20);

  // ============================================================
  // Actions
  // ============================================================

  const handleBuildIndex = useCallback(async () => {
    if (!projectRoot.trim()) {
      return;
    }
    try {
      await buildIndex(projectRoot.trim(), false);
    } catch {
      // error handled by hook
    }
  }, [buildIndex, projectRoot]);

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !activeSessionId) {
      return;
    }
    try {
      await search(activeSessionId, query.trim(), {
        topK,
        filePattern: filePattern.trim() || undefined,
      });
    } catch {
      // error handled by hook
    }
  }, [search, query, activeSessionId, topK, filePattern]);

  const handleResultClick = useCallback(
    async (result: SearchResult) => {
      if (!activeSessionId) {
        return;
      }
      try {
        await getFile(
          activeSessionId,
          result.file,
          result.line_start !== undefined
            ? { lineStart: result.line_start, lineEnd: result.line_end }
            : undefined,
        );
      } catch {
        // error handled by hook
      }
    },
    [getFile, activeSessionId],
  );

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="flex flex-col h-full bg-[var(--bg-panel)] text-[var(--text-primary)] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-[var(--border-color)]">
        <h3 className="text-sm font-semibold">📚 代码库索引</h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-xs px-2 py-1 hover:bg-[var(--bg-elevated)] rounded"
            aria-label="关闭面板"
          >
            ✕
          </button>
        )}
      </div>

      {/* Build section */}
      <div className="p-3 border-b border-[var(--border-color)] space-y-2">
        <label className="text-xs text-[var(--text-secondary)]">项目根目录</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={projectRoot}
            onChange={(e) => setProjectRoot(e.target.value)}
            placeholder="/path/to/project"
            className="flex-1 px-2 py-1 text-sm bg-[var(--bg-app)] border border-[var(--border-color)] rounded"
            data-testid="codebase-root-input"
          />
          <button
            onClick={handleBuildIndex}
            disabled={building || !projectRoot.trim()}
            className="px-3 py-1 text-sm bg-blue-500 text-white rounded disabled:opacity-50"
            data-testid="codebase-build-btn"
          >
            {building ? '构建中...' : '构建索引'}
          </button>
        </div>
        {buildError && (
          <div className="text-xs text-red-400" data-testid="codebase-error">
            {buildError}
          </div>
        )}
      </div>

      {/* Stats */}
      {indexStats && (
        <div className="p-3 border-b border-[var(--border-color)] text-xs space-y-1" data-testid="codebase-stats">
          <div className="flex justify-between">
            <span className="text-[var(--text-secondary)]">文件数</span>
            <span className="font-mono">{formatNumber(indexStats.total_files)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-secondary)]">符号数</span>
            <span className="font-mono">{formatNumber(indexStats.total_symbols)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-secondary)]">代码行数</span>
            <span className="font-mono">{formatNumber(indexStats.total_lines)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-secondary)]">构建耗时</span>
            <span className="font-mono">{indexStats.build_time_ms}ms</span>
          </div>
          {Object.keys(indexStats.languages).length > 0 && (
            <div className="pt-1">
              <div className="text-[var(--text-secondary)] mb-1">语言分布</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(indexStats.languages)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8)
                  .map(([lang, count]) => (
                    <span
                      key={lang}
                      className="px-1.5 py-0.5 text-[10px] bg-[var(--bg-elevated)] rounded"
                    >
                      {lang}: {count}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search */}
      {activeSessionId && (
        <div className="p-3 border-b border-[var(--border-color)] space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="搜索代码（函数名、关键字...）"
              className="flex-1 px-2 py-1 text-sm bg-[var(--bg-app)] border border-[var(--border-color)] rounded"
              data-testid="codebase-search-input"
            />
            <button
              onClick={handleSearch}
              disabled={searching || !query.trim()}
              className="px-3 py-1 text-sm bg-blue-500 text-white rounded disabled:opacity-50"
              data-testid="codebase-search-btn"
            >
              {searching ? '搜索中...' : '搜索'}
            </button>
          </div>
          <div className="flex gap-2 text-xs">
            <input
              type="text"
              value={filePattern}
              onChange={(e) => setFilePattern(e.target.value)}
              placeholder="文件模式（*.py）"
              className="flex-1 px-2 py-1 bg-[var(--bg-app)] border border-[var(--border-color)] rounded"
            />
            <select
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              className="px-2 py-1 bg-[var(--bg-app)] border border-[var(--border-color)] rounded"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>
          {lastQuery && (
            <div className="text-xs text-[var(--text-secondary)]">
              查询: {lastQuery} · {searchResults.length} 结果
            </div>
          )}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {searchResults.length > 0 && (
          <div className="p-2 space-y-1" data-testid="codebase-results">
            {searchResults.map((r, idx) => (
              <div
                key={idx}
                onClick={() => handleResultClick(r)}
                className="p-2 text-xs cursor-pointer hover:bg-[var(--bg-elevated)] rounded"
                data-testid="codebase-result-item"
              >
                <div className="flex items-center gap-2">
                  <span className="px-1 py-0.5 text-[10px] bg-blue-500/20 text-blue-300 rounded">
                    {r.type}
                  </span>
                  {r.name && (
                    <span className="font-mono font-semibold text-blue-300">{r.name}</span>
                  )}
                  {r.kind && (
                    <span className="text-[10px] text-[var(--text-secondary)]">{r.kind}</span>
                  )}
                </div>
                <div className="font-mono text-[var(--text-secondary)] mt-1 truncate">
                  {r.file}
                  {r.line !== undefined && `:${r.line}`}
                  {r.line_start !== undefined && r.line_end !== undefined &&
                    `:${r.line_start}-${r.line_end}`}
                </div>
                {r.signature && (
                  <div className="font-mono text-[10px] text-[var(--text-secondary)] mt-1 truncate">
                    {r.signature}
                  </div>
                )}
                {r.snippet && (
                  <div className="font-mono text-[10px] text-[var(--text-secondary)] mt-1 truncate opacity-70">
                    {r.snippet.slice(0, 100)}
                  </div>
                )}
                <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                  score: {r.score.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        )}
        {activeSessionId && searchResults.length === 0 && lastQuery && !searching && (
          <div className="p-3 text-xs text-[var(--text-secondary)] text-center">
            未找到匹配结果
          </div>
        )}
      </div>

      {/* File preview */}
      {currentFile && (
        <div
          className="border-t border-[var(--border-color)] p-3 max-h-64 overflow-y-auto"
          data-testid="codebase-file-preview"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono">{currentFile.path}</span>
            <span className="text-[10px] text-[var(--text-secondary)]">
              {currentFile.total_lines} 行
            </span>
          </div>
          <pre className="text-[10px] font-mono overflow-x-auto">
            {currentFile.lines.map((line) => (
              <div key={line.line_no} className="hover:bg-[var(--bg-elevated)]">
                <span className="inline-block w-10 text-right pr-2 text-[var(--text-secondary)]">
                  {line.line_no}
                </span>
                <span>{line.content}</span>
              </div>
            ))}
          </pre>
        </div>
      )}

      {!activeSessionId && !indexStats && (
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)]">
          请输入项目根目录并构建索引
        </div>
      )}
    </div>
  );
}

export default CodebasePanel;
