/**
 * # ============================================================
 * # Shiki Code Block Component (v1.0.0 - Cycle 15 P1-4)
 * # ============================================================
 * # 核心作用：基于 shiki 的代码块组件
 * #           支持复制、下载、语言标签
 * # 运行流程：
 * #   1. 接收 code + lang
 * #   2. 调用 shiki 异步高亮
 * #   3. 渲染高亮后的 HTML
 * #   4. 提供复制 / 下载按钮
 * # 输入参数：
 * #   - code: string，源代码
 * #   - lang: string，语言
 * #   - theme?: string，主题
 * #   - filename?: string，下载时的文件名
 * # 输出结果：代码块 DOM
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 15 P1-4 初始版本
 * # ============================================================
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { highlightCode, isLanguageSupported } from '../utils/shikiHighlighter';

export interface CodeBlockProps {
  /** 源代码 */
  code: string;
  /** 语言标识 */
  lang: string;
  /** 主题（默认 'github-dark'） */
  theme?: string;
  /** 下载时的文件名（不含扩展名） */
  filename?: string;
  /** 自定义 className */
  className?: string;
  /** 显示行号（默认 true） */
  showLineNumbers?: boolean;
}

export function CodeBlock({
  code,
  lang,
  theme = 'github-dark',
  filename = 'code',
  className = '',
  showLineNumbers = true,
}: CodeBlockProps) {
  const [html, setHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const mountedRef = useRef(true);

  // 高亮代码
  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    setError(null);

    highlightCode(code, lang, theme as any)
      .then((result) => {
        if (mountedRef.current) {
          setHtml(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mountedRef.current) {
          setError(err.message || '高亮失败');
          setLoading(false);
        }
      });

    return () => {
      mountedRef.current = false;
    };
  }, [code, lang, theme]);

  // 复制
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[CodeBlock] copy failed:', err);
    }
  }, [code]);

  // 下载
  const handleDownload = useCallback(() => {
    const ext = isLanguageSupported(lang) ? lang : 'txt';
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [code, lang, filename]);

  const supported = isLanguageSupported(lang);

  return (
    <div
      data-component="code-block"
      data-lang={lang}
      data-theme={theme}
      data-supported={supported}
      className={`relative my-2 rounded-lg overflow-hidden bg-[#0d1117] border border-surface-400/30 ${className}`}
    >
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-200/50 border-b border-surface-400/20">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-hermes-500/20 text-hermes-300">
            {lang}
          </span>
          {!supported && (
            <span className="text-[10px] text-amber-400" title="该语言使用降级渲染">
              ⚠ 降级
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            aria-label="复制代码"
            data-testid="code-copy"
            className="px-1.5 py-0.5 text-[10px] rounded
                       text-surface-500 hover:text-hermes-300
                       hover:bg-surface-300/50
                       transition-colors"
          >
            {copyState === 'copied' ? '✓ 已复制' : '📋 复制'}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            aria-label="下载代码"
            data-testid="code-download"
            className="px-1.5 py-0.5 text-[10px] rounded
                       text-surface-500 hover:text-hermes-300
                       hover:bg-surface-300/50
                       transition-colors"
          >
            ⬇ 下载
          </button>
        </div>
      </div>

      {/* 代码内容 */}
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-surface-500 bg-[#0d1117]/80 z-10">
            <span className="animate-pulse">高亮中...</span>
          </div>
        )}
        {error && (
          <div className="p-3 text-xs text-red-400 bg-red-500/10">
            高亮失败: {error}
          </div>
        )}
        {!error && (
          <div
            className="shiki-container text-xs overflow-x-auto"
            data-testid="code-content"
            data-line-numbers={showLineNumbers}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
}

export default CodeBlock;
