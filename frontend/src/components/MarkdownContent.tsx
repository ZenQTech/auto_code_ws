/**
 * # ============================================================
 * # MarkdownContent - Markdown 渲染组件 (v1.0.0 - Cycle 15 P1-4)
 * # ============================================================
 * # 核心作用：将 Markdown 文本解析为 React 节点，
 * #           代码块使用 shiki 高亮（替换原 renderMarkdown 的 <pre>）
 * # 运行流程：
 * #   1. 接收 markdown 字符串
 * #   2. 解析为块级节点数组（code block / heading / list / paragraph / text）
 * #   3. code block 节点 → <CodeBlock> 组件（shiki 高亮）
 * #   4. 其他节点 → 内联样式 React 节点
 * #   5. 流式场景下按行数拆分（每 50ms 渲染新增行）
 * # 输入参数：
 * #   - content: string，原始 Markdown 文本
 * #   - theme?: 'dark' | 'light'，代码高亮主题
 * #   - className?: string，外层 className
 * #   - streamingSpeedMs?: number，流式渲染时每批间隔（默认 0 = 一次性）
 * #   - maxStreamingLines?: number，流式渲染触发节流的最大行数
 * # 输出结果：React 节点树
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 15 P1-4 初始版本
 * #     - 解析 markdown → React 节点
 * #     - 代码块接入 shiki CodeBlock
 * #     - 支持流式按行渲染
 * #     - XSS 防护（用户内容转义）
 * # ============================================================
 */

import { useMemo, useState, useEffect, useRef, Fragment } from 'react';
import CodeBlock from './CodeBlock';

// ============================================================
// 类型定义
// ============================================================

/** 块级节点类型 */
type BlockNode =
  | { kind: 'code'; lang: string; code: string; key: string }
  | { kind: 'heading'; level: 1 | 2 | 3; text: string; key: string }
  | { kind: 'ul'; items: string[]; key: string }
  | { kind: 'ol'; items: string[]; key: string }
  | { kind: 'hr'; key: string }
  | { kind: 'table'; headers: string[]; rows: string[][]; key: string }
  | { kind: 'paragraph'; text: string; key: string };

/** 内联节点（粗体 / 斜体 / 行内代码 / 文本） */
type InlineNode = { kind: 'text' | 'bold' | 'italic' | 'code'; value: string };

export interface MarkdownContentProps {
  /** 原始 markdown 文本 */
  content: string;
  /** 代码块主题（默认 'dark'） */
  theme?: 'dark' | 'light';
  /** 外层 className */
  className?: string;
  /**
   * 流式渲染时每批渲染的最大行数（默认 0 = 一次性渲染）
   * 用于减少长内容流式更新时的卡顿
   */
  streamingBatchSize?: number;
  /**
   * 流式渲染时批次间间隔（ms，默认 0 = 一次性）
   * 仅在 streamingBatchSize > 0 时生效
   */
  streamingBatchIntervalMs?: number;
  /**
   * 关闭流式批渲染（用于性能测试或特殊场景）
   * 启用后将一次性渲染完整内容
   */
  disableStreaming?: boolean;
}

// ============================================================
// HTML 转义
// ============================================================

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// 解析：将 markdown 字符串转为块级节点数组
// ====================================

let _nodeKeyCounter = 0;
const _nextKey = (prefix: string): string => {
  _nodeKeyCounter += 1;
  return `${prefix}_${_nodeKeyCounter}`;
};

function parseMarkdown(md: string): BlockNode[] {
  if (!md) return [];
  const nodes: BlockNode[] = [];

  // 按双换行分割为段落
  const lines = md.split('\n');
  let buffer: string[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let codeLang = '';

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const text = buffer.join('\n').trim();
    if (text) {
      // 尝试识别块级结构
      const tableMatch = tryParseTable(buffer);
      if (tableMatch) {
        nodes.push({ kind: 'table', ...tableMatch, key: _nextKey('table') });
        buffer = [];
        return;
      }
      // 标题检测
      const hMatch = text.match(/^(#{1,3})\s+(.+)$/);
      if (hMatch) {
        const level = hMatch[1].length as 1 | 2 | 3;
        nodes.push({
          kind: 'heading',
          level,
          text: hMatch[2],
          key: _nextKey('h'),
        });
        buffer = [];
        return;
      }
      // 分隔线
      if (text === '---' || /^---+\s*$/.test(text)) {
        nodes.push({ kind: 'hr', key: _nextKey('hr') });
        buffer = [];
        return;
      }
      // 无序列表
      const ulItems = parseListItems(buffer, /^\s*-\s+(.+)$/);
      if (ulItems) {
        nodes.push({ kind: 'ul', items: ulItems, key: _nextKey('ul') });
        buffer = [];
        return;
      }
      // 有序列表
      const olItems = parseListItems(buffer, /^\s*\d+\.\s+(.+)$/);
      if (olItems) {
        nodes.push({ kind: 'ol', items: olItems, key: _nextKey('ol') });
        buffer = [];
        return;
      }
      // 普通段落
      nodes.push({ kind: 'paragraph', text, key: _nextKey('p') });
    }
    buffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // 代码块开始/结束
    const fenceMatch = line.match(/^```(\w*)\s*$/);
    if (fenceMatch) {
      if (!inCodeBlock) {
        // 开始
        flushBuffer();
        inCodeBlock = true;
        codeLang = fenceMatch[1] || 'txt';
        codeBuffer = [];
      } else {
        // 结束
        nodes.push({
          kind: 'code',
          lang: codeLang,
          code: codeBuffer.join('\n'),
          key: _nextKey('code'),
        });
        inCodeBlock = false;
        codeBuffer = [];
        codeLang = '';
      }
      continue;
    }
    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }
    // 普通段落累积
    if (line.trim() === '') {
      flushBuffer();
    } else {
      buffer.push(line);
    }
  }
  flushBuffer();
  // 未闭合的代码块也输出
  if (inCodeBlock && codeBuffer.length > 0) {
    nodes.push({
      kind: 'code',
      lang: codeLang,
      code: codeBuffer.join('\n'),
      key: _nextKey('code'),
    });
  }

  return nodes;
}

function tryParseTable(
  lines: string[],
): { headers: string[]; rows: string[][] } | null {
  if (lines.length < 2) return null;
  if (!/^\|.*\|$/.test(lines[0])) return null;
  // 第二行必须是分隔符行
  const alignLine = lines[1];
  if (!/^\|[-: |]+\|$/.test(alignLine)) return null;
  const headers = lines[0]
    .split('|')
    .map((c) => c.trim())
    .filter(Boolean);
  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (!/^\|.*\|$/.test(line)) return null;
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    rows.push(cells);
  }
  return { headers, rows };
}

function parseListItems(lines: string[], regex: RegExp): string[] | null {
  const items: string[] = [];
  for (const line of lines) {
    const m = line.match(regex);
    if (!m) return null;
    items.push(m[1]);
  }
  return items.length > 0 ? items : null;
}

// ============================================================
// 内联解析：处理粗体、斜体、行内代码
// ====================================

function parseInline(text: string): InlineNode[] {
  // 用占位符保护行内代码
  const codePlaceholders: string[] = [];
  let processed = text.replace(/`([^`]+)`/g, (_m, code) => {
    codePlaceholders.push(code);
    return `\u0000CODE${codePlaceholders.length - 1}\u0000`;
  });

  // 粗体
  const boldParts: { isBold: boolean; value: string }[] = [];
  const boldRe = /\*\*([^*]+)\*\*/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = boldRe.exec(processed)) !== null) {
    if (m.index > lastIdx) {
      boldParts.push({ isBold: false, value: processed.slice(lastIdx, m.index) });
    }
    boldParts.push({ isBold: true, value: m[1] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < processed.length) {
    boldParts.push({ isBold: false, value: processed.slice(lastIdx) });
  }

  const out: InlineNode[] = [];
  for (const part of boldParts) {
    if (part.isBold) {
      out.push({ kind: 'bold', value: part.value });
    } else {
      // 斜体 *text*
      const italicParts: { isItalic: boolean; value: string }[] = [];
      const italicRe = /\*([^*]+)\*/g;
      let lastI = 0;
      let im: RegExpExecArray | null;
      while ((im = italicRe.exec(part.value)) !== null) {
        if (im.index > lastI) {
          italicParts.push({
            isItalic: false,
            value: part.value.slice(lastI, im.index),
          });
        }
        italicParts.push({ isItalic: true, value: im[1] });
        lastI = im.index + im[0].length;
      }
      if (lastI < part.value.length) {
        italicParts.push({
          isItalic: false,
          value: part.value.slice(lastI),
        });
      }
      for (const ip of italicParts) {
        if (ip.isItalic) {
          out.push({ kind: 'italic', value: ip.value });
        } else {
          // 检查是否含占位符
          const segments = ip.value.split(/\u0000CODE(\d+)\u0000/);
          for (let i = 0; i < segments.length; i += 1) {
            if (i % 2 === 0) {
              // 普通文本
              if (segments[i]) {
                out.push({ kind: 'text', value: segments[i] });
              }
            } else {
              // 占位符 → 行内代码
              out.push({
                kind: 'code',
                value: codePlaceholders[Number(segments[i])] || '',
              });
            }
          }
        }
      }
    }
  }

  return out;
}

// ============================================================
// 渲染：将内联节点数组转为 React 节点
// ============================================================

function renderInline(nodes: InlineNode[], keyPrefix: string): React.ReactNode {
  return nodes.map((n, i) => {
    const k = `${keyPrefix}_${i}`;
    switch (n.kind) {
      case 'bold':
        return (
          <strong key={k} className="text-surface-950 font-semibold">
            {n.value}
          </strong>
        );
      case 'italic':
        return (
          <em key={k} className="text-surface-800 italic">
            {n.value}
          </em>
        );
      case 'code':
        return (
          <code
            key={k}
            className="bg-surface-200 text-hermes-300 px-1.5 py-0.5 rounded text-[0.85em] font-mono"
          >
            {n.value}
          </code>
        );
      case 'text':
      default:
        return <Fragment key={k}>{escapeHtml(n.value)}</Fragment>;
    }
  });
}

// ============================================================
// 流式批渲染 Hook
// ====================================

function useStreamingLimit(
  content: string,
  batchSize: number,
  batchIntervalMs: number,
  disableStreaming: boolean,
): string {
  const [limited, setLimited] = useState<string>(
    batchSize > 0 && !disableStreaming ? '' : content,
  );
  const lastUpdateRef = useRef<number>(0);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (disableStreaming || batchSize <= 0) {
      setLimited(content);
      return;
    }
    // 立即同步截取已有的部分（如果 content 减少或未超过限制）
    if (content.length <= batchSize) {
      setLimited(content);
      return;
    }
    // 节流扩展
    const now = Date.now();
    const elapsed = now - lastUpdateRef.current;
    if (elapsed >= batchIntervalMs) {
      setLimited(content);
      lastUpdateRef.current = now;
    } else {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
      }
      pendingTimerRef.current = setTimeout(() => {
        setLimited(content);
        lastUpdateRef.current = Date.now();
      }, batchIntervalMs - elapsed);
    }
    return () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, [content, batchSize, batchIntervalMs, disableStreaming]);

  return limited;
}

// ============================================================
// 主组件
// ============================================================

/**
 * Markdown 渲染组件
 * - 块级：代码块（shiki 高亮）/ 标题 / 列表 / 表格 / 分隔线 / 段落
 * - 内联：粗体 / 斜体 / 行内代码
 * - XSS：用户内容已 escapeHtml
 */
export function MarkdownContent({
  content,
  theme = 'dark',
  className = '',
  streamingBatchSize = 0,
  streamingBatchIntervalMs = 0,
  disableStreaming = false,
}: MarkdownContentProps) {
  // 流式批渲染：仅在 streamingBatchSize > 0 且未禁用时启用
  const limited = useStreamingLimit(
    content,
    streamingBatchSize,
    streamingBatchIntervalMs,
    disableStreaming,
  );

  const blocks = useMemo(() => parseMarkdown(limited), [limited]);

  return (
    <div
      data-component="markdown-content"
      data-block-count={blocks.length}
      data-theme={theme}
      className={`markdown-content ${className}`}
    >
      {blocks.map((block) => renderBlock(block, theme))}
    </div>
  );
}

function renderBlock(block: BlockNode, theme: 'dark' | 'light'): React.ReactNode {
  switch (block.kind) {
    case 'code':
      return (
        <CodeBlock
          key={block.key}
          code={block.code}
          lang={block.lang}
          theme={theme === 'light' ? 'github-light' : 'github-dark'}
        />
      );
    case 'heading': {
      const inner = parseInline(block.text);
      if (block.level === 1) {
        return (
          <h1
            key={block.key}
            className="text-xl font-bold text-hermes-100 mt-6 mb-3"
          >
            {renderInline(inner, `${block.key}_inline`)}
          </h1>
        );
      }
      if (block.level === 2) {
        return (
          <h2
            key={block.key}
            className="text-lg font-semibold text-hermes-200 mt-5 mb-3 border-b border-surface-400 pb-1"
          >
            {renderInline(inner, `${block.key}_inline`)}
          </h2>
        );
      }
      return (
        <h3
          key={block.key}
          className="text-base font-semibold text-hermes-300 mt-4 mb-2"
        >
          {renderInline(inner, `${block.key}_inline`)}
        </h3>
      );
    }
    case 'ul':
      return (
        <ul key={block.key} className="my-2 list-disc pl-6">
          {block.items.map((item, i) => (
            <li
              key={`${block.key}_${i}`}
              className="text-surface-800 my-1 leading-relaxed"
            >
              {renderInline(parseInline(item), `${block.key}_${i}_inline`)}
            </li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={block.key} className="my-2 list-decimal pl-6">
          {block.items.map((item, i) => (
            <li
              key={`${block.key}_${i}`}
              className="text-surface-800 my-1 leading-relaxed"
            >
              {renderInline(parseInline(item), `${block.key}_${i}_inline`)}
            </li>
          ))}
        </ol>
      );
    case 'hr':
      return (
        <hr
          key={block.key}
          className="border-surface-400 my-4"
          data-block="hr"
        />
      );
    case 'table':
      return (
        <div
          key={block.key}
          className="overflow-x-auto my-3"
          data-block="table"
        >
          <table className="w-full border-collapse border border-surface-400 rounded-lg">
            <thead className="bg-surface-100">
              <tr>
                {block.headers.map((h, i) => (
                  <th
                    key={`${block.key}_h_${i}`}
                    className="border border-surface-400 px-3 py-2 text-left text-sm font-semibold text-surface-900"
                  >
                    {renderInline(parseInline(h), `${block.key}_h_${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr
                  key={`${block.key}_r_${ri}`}
                  className={ri % 2 === 0 ? 'bg-transparent' : 'bg-surface-50'}
                >
                  {row.map((cell, ci) => (
                    <td
                      key={`${block.key}_r_${ri}_c_${ci}`}
                      className="border border-surface-400 px-3 py-2 text-sm text-surface-800"
                    >
                      {renderInline(
                        parseInline(cell),
                        `${block.key}_r_${ri}_c_${ci}`,
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'paragraph':
    default: {
      // 将单换行转为 <br>（在 React 中用 <br/>）
      // 简化：仅用 <br/> 替换 \n
      const segments: React.ReactNode[] = [];
      let keyCounter = 0;
      // 简单做法：将 text 中的 \n 拆分，前后段独立解析
      const subLines = block.text.split('\n');
      for (let i = 0; i < subLines.length; i += 1) {
        if (i > 0) {
          segments.push(<br key={`${block.key}_br_${keyCounter}`} />);
          keyCounter += 1;
        }
        const lineNodes = parseInline(subLines[i]);
        segments.push(
          <span key={`${block.key}_seg_${keyCounter}`}>
            {renderInline(lineNodes, `${block.key}_seg_${keyCounter}`)}
          </span>,
        );
        keyCounter += 1;
      }
      return (
        <p
          key={block.key}
          className="text-surface-800 my-2 leading-relaxed"
        >
          {segments}
        </p>
      );
    }
  }
}

export default MarkdownContent;
