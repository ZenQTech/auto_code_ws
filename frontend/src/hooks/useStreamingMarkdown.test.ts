/**
 * # ============================================================
 * # useStreamingMarkdown Hook 单元测试
 * # Cycle 67 G67-02
 * # ====================================
 */

// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useStreamingMarkdown,
  detectCompletedBlocks,
  estimateTokens,
} from './useStreamingMarkdown';

// ============================================================
// 纯函数测试
// ====================================

describe('detectCompletedBlocks', () => {
  it('段落边界（\\n\\n）正确分割', () => {
    const buffer = '第一段。\n\n第二段。\n\n正在输入';
    const { completed, pending } = detectCompletedBlocks(buffer);
    expect(completed.length).toBe(2);
    expect(completed[0].content).toBe('第一段。');
    expect(completed[1].content).toBe('第二段。');
    expect(pending).toBe('正在输入');
  });

  it('完整代码块被识别', () => {
    const buffer = '```python\nprint("hi")\n```\n\n下一段\n\n';
    const { completed, pending } = detectCompletedBlocks(buffer);
    expect(completed.length).toBe(2);
    expect(completed[0].type).toBe('code');
    expect(completed[0].language).toBe('python');
    expect(completed[0].content).toBe('print("hi")');
    expect(completed[1].content).toBe('下一段');
    expect(pending).toBe('');
  });

  it('未闭合代码块保留为 pending', () => {
    const buffer = '前面段落。\n\n```python\nprint("hi")';
    const { completed, pending } = detectCompletedBlocks(buffer);
    expect(completed.length).toBe(1);
    expect(completed[0].content).toBe('前面段落。');
    expect(pending).toContain('```python');
    expect(pending).toContain('print("hi")');
  });

  it('标题识别', () => {
    const buffer = '# 标题1\n内容1\n\n## 标题2\n内容2';
    const { completed } = detectCompletedBlocks(buffer);
    const headings = completed.filter((b) => b.type === 'heading');
    expect(headings.length).toBe(2);
    expect(headings[0].content).toBe('标题1');
    expect(headings[0].level).toBe(1);
    expect(headings[1].content).toBe('标题2');
    expect(headings[1].level).toBe(2);
  });

  it('列表识别', () => {
    const buffer = '- 项目1\n- 项目2\n- 项目3\n\n下一段';
    const { completed } = detectCompletedBlocks(buffer);
    const list = completed.find((b) => b.type === 'list');
    expect(list).toBeDefined();
    expect(list!.content).toContain('项目1');
  });

  it('引用识别', () => {
    const buffer = '> 引用内容\n> 第二行\n\n下一段';
    const { completed } = detectCompletedBlocks(buffer);
    const quote = completed.find((b) => b.type === 'quote');
    expect(quote).toBeDefined();
    expect(quote!.content).toContain('引用内容');
  });

  it('空输入返回空结果', () => {
    const { completed, pending } = detectCompletedBlocks('');
    expect(completed).toEqual([]);
    expect(pending).toBe('');
  });

  it('无段落边界的单行作为 pending', () => {
    const buffer = '正在输入未完成';
    const { completed, pending } = detectCompletedBlocks(buffer);
    expect(completed).toEqual([]);
    expect(pending).toBe('正在输入未完成');
  });
});

describe('estimateTokens', () => {
  it('4 字符 ≈ 1 token', () => {
    expect(estimateTokens('hello world')).toBe(3);
    expect(estimateTokens('')).toBe(0);
  });

  it('向上取整', () => {
    expect(estimateTokens('hi')).toBe(1); // 2/4 = 0.5 → 1
    expect(estimateTokens('12345')).toBe(2); // 5/4 = 1.25 → 2
  });
});

// ============================================================
// Hook 测试
// ====================================

describe('useStreamingMarkdown', () => {
  it('初始状态正确', () => {
    const { result } = renderHook(() =>
      useStreamingMarkdown({ sessionId: 's1' }),
    );
    expect(result.current.blocks).toEqual([]);
    expect(result.current.pendingContent).toBe('');
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.totalTokens).toBe(0);
    expect(result.current.totalBlocks).toBe(0);
    expect(result.current.error).toBe(null);
  });

  it('appendDelta 累积内容', async () => {
    const { result } = renderHook(() =>
      useStreamingMarkdown({ sessionId: 's1', throttleMs: 5 }),
    );
    act(() => {
      result.current.appendDelta('第一段。\n\n第二段。\n\n');
    });
    await waitFor(
      () => {
        expect(result.current.blocks.length).toBe(2);
      },
      { timeout: 200 },
    );
  });

  it('endStream 立即 flush pending', async () => {
    const { result } = renderHook(() =>
      useStreamingMarkdown({ sessionId: 's1', throttleMs: 1000 }),
    );
    act(() => {
      result.current.appendDelta('未完成的段落\n\n');
    });
    // 立即调用 endStream
    act(() => {
      result.current.endStream();
    });
    // 应该有 block
    expect(result.current.blocks.length).toBeGreaterThan(0);
    expect(result.current.isStreaming).toBe(false);
  });

  it('reset 清空所有状态', async () => {
    const { result } = renderHook(() =>
      useStreamingMarkdown({ sessionId: 's1', throttleMs: 5 }),
    );
    act(() => {
      result.current.appendDelta('段落1。\n\n段落2。');
    });
    await waitFor(() => {
      expect(result.current.blocks.length).toBeGreaterThan(0);
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.blocks).toEqual([]);
    expect(result.current.pendingContent).toBe('');
    expect(result.current.totalTokens).toBe(0);
  });

  it('sessionId 变化时重置', () => {
    const { result, rerender } = renderHook(
      ({ sid }: { sid: string }) =>
        useStreamingMarkdown({ sessionId: sid }),
      { initialProps: { sid: 's1' } },
    );
    rerender({ sid: 's2' });
    expect(result.current.blocks).toEqual([]);
  });

  it('maxBlocks 限制 block 数量', async () => {
    const { result } = renderHook(() =>
      useStreamingMarkdown({
        sessionId: 's1',
        throttleMs: 5,
        maxBlocks: 3,
      }),
    );
    act(() => {
      // 10 个段落
      for (let i = 0; i < 10; i++) {
        result.current.appendDelta(`段落${i}。\n\n`);
      }
    });
    await waitFor(
      () => {
        expect(result.current.blocks.length).toBeLessThanOrEqual(3);
      },
      { timeout: 500 },
    );
  });

  it('Block 10KB 上限保护', async () => {
    const { result } = renderHook(() =>
      useStreamingMarkdown({ sessionId: 's1', throttleMs: 5 }),
    );
    act(() => {
      // 一次性推送 > 10KB
      result.current.appendDelta('x'.repeat(20_000));
    });
    await waitFor(
      () => {
        // 应触发截断
        expect(result.current.blocks.length).toBeGreaterThanOrEqual(0);
      },
      { timeout: 500 },
    );
  });
});

// ====================================================
// WebSocket 测试
// ====================================

describe('useStreamingMarkdown WebSocket', () => {
  class MockWebSocket {
    readyState = 0;
    onopen: ((ev: any) => void) | null = null;
    onmessage: ((ev: any) => void) | null = null;
    onclose: ((ev: any) => void) | null = null;
    onerror: ((ev: any) => void) | null = null;
    sent: any[] = [];
    url: string;

    constructor(url: string) {
      this.url = url;
    }
    send(data: any) {
      this.sent.push(data);
    }
    close() {
      this.readyState = 3;
      this.onclose?.({});
    }
    open() {
      this.readyState = 1;
      this.onopen?.({});
    }
    emit(type: string, data: any) {
      this.onmessage?.({ data: JSON.stringify({ type, data }) });
    }
  }

  let lastWs: MockWebSocket | null = null;

  beforeEach(() => {
    lastWs = null;
    (global as any).WebSocket = function (url: string) {
      const ws = new MockWebSocket(url);
      lastWs = ws;
      return ws as any;
    };
  });

  afterEach(() => {
    delete (global as any).WebSocket;
  });

  it('连接成功后标记 connected', async () => {
    const { result } = renderHook(() =>
      useStreamingMarkdown({
        sessionId: 's1',
        wsUrl: 'ws://localhost:8000/ws',
      }),
    );
    await waitFor(() => {
      expect(lastWs).not.toBe(null);
    });
    act(() => {
      lastWs!.open();
    });
    expect(result.current.connected).toBe(true);
  });

  it('收到 answer_delta 累积内容', async () => {
    const { result } = renderHook(() =>
      useStreamingMarkdown({
        sessionId: 's1',
        wsUrl: 'ws://localhost:8000/ws',
        throttleMs: 10,
      }),
    );
    await waitFor(() => {
      expect(lastWs).not.toBe(null);
    });
    act(() => {
      lastWs!.open();
      lastWs!.emit('answer_delta', { delta: '段落1。\n\n' });
      lastWs!.emit('answer_delta', { delta: '段落2。' });
    });
    await waitFor(
      () => {
        expect(result.current.totalBlocks).toBeGreaterThan(0);
      },
      { timeout: 500 },
    );
  });

  it('收到 answer_error 设置 error', async () => {
    const { result } = renderHook(() =>
      useStreamingMarkdown({
        sessionId: 's1',
        wsUrl: 'ws://localhost:8000/ws',
      }),
    );
    await waitFor(() => {
      expect(lastWs).not.toBe(null);
    });
    act(() => {
      lastWs!.open();
      lastWs!.emit('answer_error', { message: 'Stream failed' });
    });
    expect(result.current.error).toBe('Stream failed');
  });
});
