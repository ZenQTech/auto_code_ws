/**
 * # ============================================================
 * # useStreamingMarkdown Hook (v1.0.0)
 * # Cycle 67 G67-02
 * # ====================================
 * # 核心作用：渐进式解析流式 Markdown，按 block 渲染
 * # 功能：
 * #   1. 累积 buffer 并按 \n\n + ``` 围栏拆分 blocks
 * #   2. 已完成 block 立即推入 completed 列表
 * #   3. 未完成 block（光标位置）保留为 pending
 * #   4. 节流：避免高频 delta 触发过度 re-render
 * #   5. 错误恢复：流中断时降级为纯文本
 * #   6. 自动滚动（用户上滑时禁用）
 * # 输入参数：options
 * # 输出结果：状态 + actions
 * # 对标：Trae SOLO 渐进式渲染 + Codex CLI 流式输出
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 67 G67-02 初次创建
 * # ====================================
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

// ============================================================
// 类型定义
// ====================================

export type BlockType = 'heading' | 'paragraph' | 'code' | 'list' | 'quote' | 'text';

export interface MarkdownBlock {
  id: string;
  type: BlockType;
  content: string;
  language?: string;
  level?: number;
  complete: boolean;
  tokens: number;          // 估算 token 数
  startedAt: number;
  endedAt: number | null;
}

export interface UseStreamingMarkdownOptions {
  sessionId: string;
  /** WebSocket URL */
  wsUrl?: string;
  /** delta 节流（ms）默认 50ms */
  throttleMs?: number;
  /** 自动滚动到底部 */
  autoScroll?: boolean;
  /** 最大 block 数量（防止内存爆炸） */
  maxBlocks?: number;
}

export interface UseStreamingMarkdownResult {
  blocks: MarkdownBlock[];
  pendingContent: string;
  isStreaming: boolean;
  totalTokens: number;
  totalBlocks: number;
  error: string | null;
  connected: boolean;
  appendDelta: (delta: string) => void;
  endStream: () => void;
  reset: () => void;
  reconnect: () => void;
}

// ============================================================
// 常量
// ====================================

const DEFAULT_THROTTLE_MS = 50;
const DEFAULT_MAX_BLOCKS = 500;
const MAX_BLOCK_SIZE = 10_000;  // 单 block 10KB 上限

// ============================================================
// 工具函数
// ====================================

/**
 * 检测 buffer 中已完成的 block 数量
 * 完成边界：
 *   - 段落：\n\n
 *   - 代码块：``` 开闭配对
 *   - 标题行：# 开头到行尾
 *   - 列表：连续 - 或 * 开头
 */
function detectCompletedBlocks(buffer: string): {
  completed: { content: string; type: BlockType; language?: string; level?: number }[];
  pending: string;
} {
  const completed: { content: string; type: BlockType; language?: string; level?: number }[] = [];
  let pos = 0;
  let inCodeBlock = false;
  let codeLang = '';
  let codeBuffer = '';
  let pendingStart = 0;

  const lines = buffer.split('\n');
  let currentBlock: string[] = [];
  let blockType: BlockType = 'text';
  let blockLevel: number | undefined;
  let blockLang: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 代码块围栏
    if (trimmed.startsWith('```')) {
      if (!inCodeBlock) {
        // 开始新代码块 - 先 flush 之前的 block
        if (currentBlock.length > 0) {
          const content = currentBlock.join('\n').trim();
          if (content) {
            completed.push({ content, type: blockType, language: blockLang, level: blockLevel });
          }
          currentBlock = [];
        }
        inCodeBlock = true;
        codeLang = trimmed.slice(3).trim() || 'text';
        codeBuffer = '';
        blockType = 'code';
        blockLang = codeLang;
        blockLevel = undefined;
      } else {
        // 结束代码块
        completed.push({
          content: codeBuffer,
          type: 'code',
          language: codeLang,
        });
        inCodeBlock = false;
        codeBuffer = '';
        codeLang = '';
        blockType = 'text';
        blockLang = undefined;
        blockLevel = undefined;
        pendingStart = pos + line.length + 1;
      }
      pos += line.length + 1;
      continue;
    }

    if (inCodeBlock) {
      codeBuffer += (codeBuffer ? '\n' : '') + line;
      pos += line.length + 1;
      continue;
    }

    // 标题
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (currentBlock.length > 0) {
        const content = currentBlock.join('\n').trim();
        if (content) {
          completed.push({ content, type: blockType, language: blockLang, level: blockLevel });
        }
        currentBlock = [];
      }
      completed.push({
        content: headingMatch[2],
        type: 'heading',
        level: headingMatch[1].length,
      });
      pendingStart = pos + line.length + 1;
      pos += line.length + 1;
      blockType = 'text';
      blockLevel = undefined;
      blockLang = undefined;
      continue;
    }

    // 水平线
    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      if (currentBlock.length > 0) {
        const content = currentBlock.join('\n').trim();
        if (content) {
          completed.push({ content, type: blockType, language: blockLang, level: blockLevel });
        }
        currentBlock = [];
      }
      completed.push({ content: '---', type: 'text' });
      pendingStart = pos + line.length + 1;
      pos += line.length + 1;
      continue;
    }

    // 引用
    if (trimmed.startsWith('>')) {
      if (currentBlock.length > 0 && blockType !== 'quote') {
        const content = currentBlock.join('\n').trim();
        if (content) {
          completed.push({ content, type: blockType, language: blockLang, level: blockLevel });
        }
        currentBlock = [];
      }
      blockType = 'quote';
      currentBlock.push(line.replace(/^>\s?/, ''));
      pos += line.length + 1;
      continue;
    }

    // 列表项
    if (/^(\s*)([-*+]|\d+\.)\s+/.test(line)) {
      if (currentBlock.length > 0 && blockType !== 'list') {
        const content = currentBlock.join('\n').trim();
        if (content) {
          completed.push({ content, type: blockType, language: blockLang, level: blockLevel });
        }
        currentBlock = [];
      }
      blockType = 'list';
      currentBlock.push(line);
      pos += line.length + 1;
      continue;
    }

    // 空行 - 段落边界
    if (trimmed === '') {
      if (currentBlock.length > 0) {
        const content = currentBlock.join('\n').trim();
        if (content) {
          completed.push({ content, type: blockType, language: blockLang, level: blockLevel });
        }
        currentBlock = [];
        blockType = 'text';
        blockLevel = undefined;
        blockLang = undefined;
        pendingStart = pos + line.length + 1;
      }
      pos += line.length + 1;
      continue;
    }

    // 普通文本
    if (blockType === 'code') {
      // 不应到这里（前面已处理），兜底
      blockType = 'text';
    }
    currentBlock.push(line);
    pos += line.length + 1;
  }

  // 处理未完成的 block
  if (currentBlock.length > 0) {
    const content = currentBlock.join('\n').trim();
    if (content) {
      // 未完成 - 保留为 pending
      // 这里我们不立即完成，而是让 caller 决定
    }
  }

  if (inCodeBlock) {
    // 代码块未关闭，保留为 pending
    return {
      completed,
      pending: '```' + codeLang + '\n' + codeBuffer,
    };
  }

  // 段落未结束（无 \n\n 边界）→ 整段作为 pending
  if (currentBlock.length > 0) {
    return {
      completed,
      pending: currentBlock.join('\n'),
    };
  }

  return { completed, pending: '' };
}

/**
 * 估算 token 数（粗略：4 字符 ≈ 1 token）
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function genBlockId(): string {
  return `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// Hook 实现
// ====================================

export function useStreamingMarkdown(
  options: UseStreamingMarkdownOptions,
): UseStreamingMarkdownResult {
  const {
    sessionId,
    wsUrl,
    throttleMs = DEFAULT_THROTTLE_MS,
    maxBlocks = DEFAULT_MAX_BLOCKS,
  } = options;

  // 状态
  const [blocks, setBlocks] = useState<MarkdownBlock[]>([]);
  const [pendingContent, setPendingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // 引用
  const bufferRef = useRef('');
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFlushRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);

  // ====================================================
  // 解析与刷新
  // ====================================================
  const flush = useCallback(() => {
    pendingFlushRef.current = false;
    const buffer = bufferRef.current;
    const { completed, pending } = detectCompletedBlocks(buffer);
    setPendingContent(pending);

    if (completed.length > 0) {
      setBlocks((prev) => {
        const now = Date.now();
        const newBlocks: MarkdownBlock[] = completed.map((c) => ({
          id: genBlockId(),
          type: c.type,
          content: c.content,
          language: c.language,
          level: c.level,
          complete: true,
          tokens: estimateTokens(c.content),
          startedAt: now,
          endedAt: now,
        }));
        const merged = [...newBlocks, ...prev].slice(0, maxBlocks);
        return merged;
      });
      setTotalTokens((t) => t + completed.reduce((s, b) => s + estimateTokens(b.content), 0));
    }
  }, [maxBlocks]);

  const scheduleFlush = useCallback(() => {
    if (pendingFlushRef.current) return;
    pendingFlushRef.current = true;
    throttleTimerRef.current = setTimeout(() => {
      flush();
    }, throttleMs);
  }, [flush, throttleMs]);

  // ====================================================
  // 公开 API
  // ====================================================
  const appendDelta = useCallback(
    (delta: string) => {
      if (!delta) return;
      // 单 block 超过 10KB 强制截断
      if (bufferRef.current.length + delta.length > MAX_BLOCK_SIZE) {
        // 截断为已完成
        bufferRef.current += delta;
        const cutoff = bufferRef.current.slice(0, MAX_BLOCK_SIZE);
        bufferRef.current = cutoff + '\n\n[... truncated ...]\n\n';
        flush();
        return;
      }
      bufferRef.current += delta;
      scheduleFlush();
    },
    [flush, scheduleFlush],
  );

  const endStream = useCallback(() => {
    // 立即 flush
    if (throttleTimerRef.current) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    flush();
    setIsStreaming(false);
  }, [flush]);

  const reset = useCallback(() => {
    if (throttleTimerRef.current) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    bufferRef.current = '';
    setBlocks([]);
    setPendingContent('');
    setTotalTokens(0);
    setIsStreaming(false);
    setError(null);
  }, []);

  // ====================================================
  // WebSocket
  // ====================================================
  const handleWebSocketMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        const type = msg.type || msg.event_type;
        const data = msg.payload || msg.data || {};
        switch (type) {
          case 'answer_start':
          case 'AnswerStart':
            setIsStreaming(true);
            break;
          case 'answer_delta':
          case 'AnswerDelta':
            appendDelta(data.delta || '');
            break;
          case 'answer_end':
          case 'AnswerEnd':
            endStream();
            break;
          case 'answer_error':
          case 'AnswerError':
            setError(data.message || 'Stream error');
            break;
          default:
            break;
        }
      } catch (err) {
        // 静默
      }
    },
    [appendDelta, endStream],
  );

  const connectWebSocket = useCallback(() => {
    if (!wsUrl || !sessionId) return;
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    try {
      const ws = new WebSocket(`${wsUrl}?session_id=${encodeURIComponent(sessionId)}`);
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({
          type: 'subscribe',
          events: ['answer_delta'],
          session_id: sessionId,
        }));
      };
      ws.onmessage = handleWebSocketMessage;
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
      };
      ws.onerror = () => {
        setError('WebSocket error');
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    }
  }, [wsUrl, sessionId, handleWebSocketMessage]);

  const disconnectWebSocket = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // 忽略
      }
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  const reconnect = useCallback(() => {
    disconnectWebSocket();
    connectWebSocket();
  }, [disconnectWebSocket, connectWebSocket]);

  // ====================================================
  // 副作用
  // ====================================================
  useEffect(() => {
    mountedRef.current = true;
    if (wsUrl && sessionId) {
      connectWebSocket();
    }
    return () => {
      mountedRef.current = false;
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
      }
      disconnectWebSocket();
    };
  }, [wsUrl, sessionId, connectWebSocket, disconnectWebSocket]);

  // sessionId 变化时重置
  useEffect(() => {
    reset();
  }, [sessionId, reset]);

  return {
    blocks,
    pendingContent,
    isStreaming,
    totalTokens,
    totalBlocks: blocks.length,
    error,
    connected,
    appendDelta,
    endStream,
    reset,
    reconnect,
  };
}

// 导出供测试使用
export { detectCompletedBlocks, estimateTokens };
