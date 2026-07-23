/**
 * # ============================================================
 * # MemoryPanel 记忆库面板组件
 * # ============================================================
 * # 核心作用：提供代码片段搜索功能，展示搜索结果（含相似度
 * #           评分）和记忆库统计信息
 * # 运行流程：
 * #   1. 组件挂载时通过 useMemoryStats() 拉取统计信息
 * #   2. 用户在搜索框中输入关键词
 * #   3. 调用 useMemorySearch().search(query) 执行搜索
 * #   4. 渲染搜索结果列表（含相似度评分、语言、标签）
 * #   5. 渲染记忆库统计信息（片段数、标签数、语言分布）
 * # 输入参数：无（通过 useMemorySearch / useMemoryStats hooks 获取数据）
 * # 输出结果：记忆库面板 UI
 * # 修改记录：
 * #   - 2026-06-24 | v1.0.0 | 初始创建，实现记忆库面板
 * # ============================================================
 */

import { useState, useCallback } from 'react';
import { useMemorySearch, useMemoryStats } from '../hooks/useApi';

/**
 * 格式化字节大小
 * 作用：将字节数转换为易读的 KB/MB 格式
 * @param bytes - 字节数
 * @returns 格式化后的字符串
 */
function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

/**
 * 根据相似度评分返回颜色类名
 * 作用：将相似度评分（0-1）映射为对应的颜色
 * >=0.8 绿色高匹配，>=0.5 黄色中匹配，<0.5 灰色低匹配
 * @param score - 相似度评分（0-1）
 * @returns Tailwind 颜色类名
 */
function getSimilarityColor(score: number): string {
  if (score >= 0.8) return 'text-emerald-400 bg-emerald-500/20';
  if (score >= 0.5) return 'text-yellow-400 bg-yellow-500/20';
  return 'text-surface-500 bg-surface-300/50';
}

export default function MemoryPanel() {
  /** 搜索输入框内容 */
  const [query, setQuery] = useState('');
  /** 记忆库搜索结果 */
  const { results, loading: searchLoading, search } = useMemorySearch();
  /** 记忆库统计信息 */
  const { stats, loading: statsLoading } = useMemoryStats();

  /**
   * 处理搜索提交
   * 作用：在用户按下回车键或点击搜索按钮时触发搜索
   */
  const handleSearch = useCallback(() => {
    if (query.trim()) {
      search(query.trim());
    }
  }, [query, search]);

  /**
   * 处理键盘事件
   * 作用：监听回车键触发搜索
   * @param e - 键盘事件
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  // ============================================================
  // 加载态
  // ============================================================
  if (statsLoading && !stats) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in">
        <div className="skeleton h-6 w-32 rounded mb-4" />
        <div className="skeleton h-10 rounded-lg mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="skeleton h-16 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl p-5 animate-fade-in flex flex-col max-h-[70vh]">
      {/* ============================================================
       * 标题栏：图标 + 标题
       * ============================================================ */}
      <div className="flex items-center gap-3 mb-4 pb-3 border-b border-surface-300">
        {/* 记忆库图标 */}
        <div className="w-8 h-8 rounded-lg bg-hermes-500/20 flex items-center justify-center">
          <svg className="w-5 h-5 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-surface-950">记忆库</h3>
      </div>

      {/* ============================================================
       * 搜索栏
       * ============================================================ */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 relative">
          {/* 搜索图标 */}
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {/* 搜索输入框 */}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索代码片段..."
            className="input-glow w-full pl-10 pr-4 py-2 text-sm"
          />
        </div>
        {/* 搜索按钮 */}
        <button
          onClick={handleSearch}
          disabled={!query.trim() || searchLoading}
          className="btn-primary text-sm px-4"
        >
          {searchLoading ? (
            <span className="w-4 h-4 border-2 border-surface-50 border-t-transparent rounded-full animate-spin" />
          ) : (
            '搜索'
          )}
        </button>
      </div>

      {/* ============================================================
       * 搜索结果区域
       * ============================================================ */}
      <div className="flex-1 overflow-y-auto pr-2 min-h-0">
        {results.length > 0 ? (
          <div className="space-y-2 mb-4">
            <div className="text-xs text-surface-500 mb-2">
              找到 {results.length} 个结果
            </div>
            {results.map(result => (
              <div
                key={result.id}
                className="bg-surface-100/50 rounded-lg p-3 border border-surface-300 hover:border-hermes-500/20 transition-colors"
              >
                {/* 标题行：标题 + 相似度 + 语言 */}
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-surface-900 truncate flex-1 mr-2">
                    {result.title}
                  </span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* 语言标签 */}
                    <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-surface-200 text-surface-600">
                      {result.language}
                    </span>
                    {/* 相似度评分 */}
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${getSimilarityColor(result.similarity)}`}>
                      {(result.similarity * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>

                {/* 代码片段预览（截断显示） */}
                <pre className="text-xs text-surface-700 font-mono bg-surface-50 rounded p-2 overflow-x-auto max-h-20 overflow-y-hidden">
                  {result.content.length > 200
                    ? result.content.slice(0, 200) + '...'
                    : result.content}
                </pre>

                {/* 标签列表 */}
                {result.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {result.tags.map(tag => (
                      <span key={tag} className="px-1.5 py-0.5 rounded text-xs bg-hermes-500/10 text-hermes-400">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* 入库时间 */}
                <div className="text-xs text-surface-500 mt-1.5">
                  入库：{new Date(result.created_at).toLocaleDateString('zh-CN')}
                </div>
              </div>
            ))}
          </div>
        ) : query && !searchLoading ? (
          /* 搜索无结果 */
          <div className="text-xs text-surface-500 text-center py-6">
            未找到匹配的代码片段
          </div>
        ) : !query ? (
          /* 未搜索时的提示 */
          <div className="text-xs text-surface-500 text-center py-6">
            输入关键词搜索记忆库中的代码片段
          </div>
        ) : null}
      </div>

      {/* ============================================================
       * 记忆库统计信息
       * ============================================================ */}
      {stats && (
        <div className="mt-4 pt-3 border-t border-surface-300">
          <h4 className="text-sm font-semibold text-surface-700 mb-3 flex items-center gap-2">
            <svg className="w-4 h-4 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            统计信息
          </h4>

          {/* 统计卡片网格 */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            <div className="bg-surface-100/50 rounded-lg p-2.5 border border-surface-300 text-center">
              <div className="text-lg font-semibold text-hermes-400">{stats.total_snippets}</div>
              <div className="text-xs text-surface-500">片段数</div>
            </div>
            <div className="bg-surface-100/50 rounded-lg p-2.5 border border-surface-300 text-center">
              <div className="text-lg font-semibold text-emerald-400">{stats.total_tags}</div>
              <div className="text-xs text-surface-500">标签数</div>
            </div>
            <div className="bg-surface-100/50 rounded-lg p-2.5 border border-surface-300 text-center">
              <div className="text-lg font-semibold text-surface-700">{formatBytes(stats.total_size_bytes)}</div>
              <div className="text-xs text-surface-500">存储大小</div>
            </div>
            <div className="bg-surface-100/50 rounded-lg p-2.5 border border-surface-300 text-center">
              <div className="text-lg font-semibold text-surface-500">
                {Object.keys(stats.language_distribution).length}
              </div>
              <div className="text-xs text-surface-500">语言种类</div>
            </div>
          </div>

          {/* 语言分布 */}
          {Object.keys(stats.language_distribution).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(stats.language_distribution).map(([lang, count]) => (
                <span key={lang} className="px-2 py-0.5 rounded text-xs bg-surface-200 text-surface-600 font-mono">
                  {lang}: {count}
                </span>
              ))}
            </div>
          )}

          {/* 最后更新时间 */}
          <div className="text-xs text-surface-500 mt-2">
            最后更新：{new Date(stats.last_updated).toLocaleString('zh-CN')}
          </div>
        </div>
      )}
    </div>
  );
}
