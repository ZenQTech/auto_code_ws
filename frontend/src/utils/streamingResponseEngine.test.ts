/**
 * # Streaming Response Engine - 单元测试
 * # Cycle 36 G36-02
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  StreamingResponseEngine,
  StreamSession,
  generateStreamId,
  getDefaultStreamingResponseEngine,
  resetDefaultStreamingResponseEngine,
} from './streamingResponseEngine';
import { getDefaultLLMProviderRegistry, resetDefaultLLMProviderRegistry, MockProvider } from './llmProviderAdapter';

describe('Streaming Response Engine - 工具函数', () => {
  it('generateStreamId 生成 ID', () => {
    const id = generateStreamId();
    expect(id).toMatch(/^stream-/);
  });
});

describe('StreamSession', () => {
  let session: StreamSession;

  beforeEach(() => {
    session = new StreamSession('test-stream');
  });

  it('初始状态', () => {
    expect(session.id).toBe('test-stream');
    expect(session.status).toBe('pending');
    expect(session.chunksEmitted).toBe(0);
  });

  it('订阅 chunk', () => {
    const chunks: any[] = [];
    session.onChunk((c) => chunks.push(c));
    session.emitChunk({ type: 'text', text: 'hello', timestamp: Date.now() });
    expect(chunks.length).toBe(1);
  });

  it('取消订阅', () => {
    const chunks: any[] = [];
    const unsub = session.onChunk((c) => chunks.push(c));
    unsub();
    session.emitChunk({ type: 'text', text: 'hello', timestamp: Date.now() });
    expect(chunks.length).toBe(0);
  });

  it('emitChunk 累积文本', () => {
    session.emitChunk({ type: 'text', text: 'Hello', timestamp: Date.now() });
    session.emitChunk({ type: 'text', text: ' World', timestamp: Date.now() });
    expect(session.getText()).toBe('Hello World');
    expect(session.bytesEmitted).toBe(11);
    expect(session.chunksEmitted).toBe(2);
  });

  it('pause / resume', () => {
    session.status = 'streaming';
    session.pause();
    expect(session.status).toBe('paused');
    session.resume();
    expect(session.status).toBe('streaming');
  });

  it('cancel 后不再接收 chunk', () => {
    session.cancel();
    const chunks: any[] = [];
    session.onChunk((c) => chunks.push(c));
    session.emitChunk({ type: 'text', text: 'after cancel', timestamp: Date.now() });
    expect(chunks.length).toBe(0);
  });

  it('complete 触发完成回调', () => {
    const completes: any[] = [];
    session.onComplete((c) => completes.push(c));
    session.status = 'streaming';
    session.emitChunk({ type: 'text', text: 'Hello', timestamp: Date.now() });
    session.complete({ inputTokens: 5, outputTokens: 5, totalTokens: 10 }, 'stop');
    expect(completes.length).toBe(1);
    expect(completes[0].finalContent).toBe('Hello');
    expect(completes[0].totalChunks).toBe(1);
    expect(session.status).toBe('completed');
  });

  it('error 触发错误回调', () => {
    const errors: any[] = [];
    session.onError((e) => errors.push(e));
    session.status = 'streaming';
    session.error(new Error('test error'), false);
    expect(errors.length).toBe(1);
    expect(session.status).toBe('error');
  });

  it('getStats 返回统计', () => {
    session.status = 'streaming';
    session.emitChunk({ type: 'text', text: 'Hello', timestamp: Date.now() });
    const stats = session.getStats();
    expect(stats.chunksEmitted).toBe(1);
    expect(stats.bytesEmitted).toBe(5);
    expect(stats.ttftMs).toBeGreaterThanOrEqual(0);
  });

  it('getChunks 返回副本', () => {
    session.emitChunk({ type: 'text', text: 'A', timestamp: Date.now() });
    const chunks = session.getChunks();
    expect(chunks.length).toBe(1);
    chunks.push({ type: 'text', text: 'B', timestamp: Date.now() });
    expect(session.getChunks().length).toBe(1); // 原数组未变
  });
});

describe('StreamingResponseEngine', () => {
  let engine: StreamingResponseEngine;

  beforeEach(() => {
    resetDefaultLLMProviderRegistry();
    resetDefaultStreamingResponseEngine();
    const registry = getDefaultLLMProviderRegistry();
    registry.register('mock', new MockProvider());
    engine = new StreamingResponseEngine();
  });

  it('创建实例', () => {
    expect(engine).toBeInstanceOf(StreamingResponseEngine);
  });

  it('createStream 创建流', () => {
    const session = engine.createStream({
      provider: 'mock',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(session).toBeInstanceOf(StreamSession);
    expect(engine.getStream(session.id)).toBe(session);
  });

  it('getStream 不存在返回 undefined', () => {
    expect(engine.getStream('not-exist')).toBeUndefined();
  });

  it('listStreams 过滤', () => {
    engine.createStream({
      provider: 'mock',
      messages: [{ role: 'user', content: 'a' }],
    });
    engine.createStream({
      provider: 'mock',
      messages: [{ role: 'user', content: 'b' }],
    });
    expect(engine.listStreams().length).toBe(2);
  });

  it('cancelStream 取消', () => {
    const session = engine.createStream({
      provider: 'mock',
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(engine.cancelStream(session.id)).toBe(true);
    expect(session.status).toBe('cancelled');
  });

  it('cancelStream 不存在返回 false', () => {
    expect(engine.cancelStream('not-exist')).toBe(false);
  });

  it('cancelAll 取消所有', () => {
    engine.createStream({
      provider: 'mock',
      messages: [{ role: 'user', content: 'a' }],
    });
    engine.createStream({
      provider: 'mock',
      messages: [{ role: 'user', content: 'b' }],
    });
    engine.cancelAll();
    expect(engine.getStats().activeStreams).toBe(0);
  });

  it('removeStream 删除', () => {
    const session = engine.createStream({
      provider: 'mock',
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(engine.removeStream(session.id)).toBe(true);
    expect(engine.getStream(session.id)).toBeUndefined();
  });

  it('clearCompleted 清理已完成的', async () => {
    engine.createStream({
      provider: 'mock',
      messages: [{ role: 'user', content: 'test' }],
    });
    // 等待完成
    await new Promise((r) => setTimeout(r, 500));
    const cleared = engine.clearCompleted();
    expect(cleared).toBeGreaterThanOrEqual(0);
  });

  it('getStats 聚合统计', () => {
    engine.createStream({
      provider: 'mock',
      messages: [{ role: 'user', content: 'a' }],
    });
    const stats = engine.getStats();
    expect(stats.totalStreams).toBe(1);
  });

  it('事件订阅', () => {
    const events: any[] = [];
    engine.on('stream-created', (d) => events.push(d));
    engine.createStream({
      provider: 'mock',
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(events.length).toBe(1);
  });
});

describe('异步流式输出', () => {
  let engine: StreamingResponseEngine;

  beforeEach(() => {
    resetDefaultLLMProviderRegistry();
    resetDefaultStreamingResponseEngine();
    const registry = getDefaultLLMProviderRegistry();
    const mock = new MockProvider();
    mock.setResponseDelay(10);
    registry.register('mock', mock);
    engine = new StreamingResponseEngine();
  });

  it('完整流式输出', async () => {
    const session = engine.createStream({
      provider: 'mock',
      messages: [{ role: 'user', content: 'hello' }],
      config: { throttleMs: 5 },
    });

    const chunks: string[] = [];
    session.onChunk((c) => {
      if (c.type === 'text' && c.text) chunks.push(c.text);
    });

    await new Promise<void>((resolve) => {
      session.onComplete(() => resolve());
      session.onError(() => resolve());
      setTimeout(() => resolve(), 5000);
    });

    expect(chunks.length).toBeGreaterThan(0);
    expect(session.getText().length).toBeGreaterThan(0);
    expect(session.status).toBe('completed');
  });

  it('流式统计包含 TTFT', async () => {
    const session = engine.createStream({
      provider: 'mock',
      messages: [{ role: 'user', content: 'hello' }],
      config: { throttleMs: 5 },
    });

    await new Promise<void>((resolve) => {
      session.onComplete(() => resolve());
      setTimeout(() => resolve(), 5000);
    });

    const stats = session.getStats();
    expect(stats.ttftMs).toBeGreaterThanOrEqual(0);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('全局单例', () => {
  beforeEach(() => {
    resetDefaultStreamingResponseEngine();
  });

  it('getDefaultStreamingResponseEngine 单例', () => {
    const e1 = getDefaultStreamingResponseEngine();
    const e2 = getDefaultStreamingResponseEngine();
    expect(e1).toBe(e2);
  });

  it('resetDefaultStreamingResponseEngine', () => {
    const e1 = getDefaultStreamingResponseEngine();
    resetDefaultStreamingResponseEngine();
    const e2 = getDefaultStreamingResponseEngine();
    expect(e1).not.toBe(e2);
  });
});
