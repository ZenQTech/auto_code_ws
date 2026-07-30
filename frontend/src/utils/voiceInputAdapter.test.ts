/**
 * # ============================================================
 * # VoiceInputAdapter 单元测试 (Cycle 24 G24-03)
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  VoiceInputAdapter,
  VoiceEventBus,
  DEFAULT_VOICE_CONFIG,
  SUPPORTED_LANGUAGES,
  getVoiceInputAdapter,
  resetVoiceInputAdapter,
  type SpeechRecognitionConstructor,
  type VoiceCommand,
} from './voiceInputAdapter';

// 创建一个可控制的 mock 识别器
class MockSpeechRecognition {
  lang = 'zh-CN';
  continuous = true;
  interimResults = true;
  maxAlternatives = 1;
  onresult: ((ev: any) => any) | null = null;
  onerror: ((ev: any) => any) | null = null;
  onend: ((ev: any) => any) | null = null;
  onstart: ((ev: any) => any) | null = null;

  startCalls = 0;
  stopCalls = 0;
  abortCalls = 0;

  start() {
    this.startCalls += 1;
    // 同步触发 onstart
    setTimeout(() => this.onstart?.(new Event('start')), 0);
  }
  stop() {
    this.stopCalls += 1;
    setTimeout(() => this.onend?.(new Event('end')), 0);
  }
  abort() {
    this.abortCalls += 1;
    this.onend?.(new Event('end'));
  }

  // 模拟识别结果
  emitResult(transcript: string, isFinal = true, confidence = 0.9) {
    const ev: any = {
      resultIndex: 0,
      results: [
        {
          isFinal,
          0: { transcript, confidence },
          length: 1,
          item: () => ({ transcript, confidence }),
        },
      ],
    };
    this.onresult?.(ev);
  }

  emitInterim(transcript: string, confidence = 0.7) {
    this.emitResult(transcript, false, confidence);
  }

  emitError(error: string) {
    const ev: any = { error };
    this.onerror?.(ev);
  }
}

function makeMockCtor(): { ctor: SpeechRecognitionConstructor; latestRef: { current: MockSpeechRecognition | null } } {
  const latestRef: { current: MockSpeechRecognition | null } = { current: null };
  const ctor: any = function () {
    latestRef.current = new MockSpeechRecognition();
    return latestRef.current;
  };
  return { ctor: ctor as SpeechRecognitionConstructor, latestRef };
}

describe('VoiceInputAdapter - 构造与配置', () => {
  it('应使用默认配置构造', () => {
    const adapter = new VoiceInputAdapter(undefined, (() => { return {} as any; }) as unknown as SpeechRecognitionConstructor);
    const config = adapter.getConfig();
    expect(config.lang).toBe(DEFAULT_VOICE_CONFIG.lang);
    expect(config.continuous).toBe(true);
    expect(config.interimResults).toBe(true);
  });

  it('应能更新配置', () => {
    const adapter = new VoiceInputAdapter(undefined, (() => { return {} as any; }) as unknown as SpeechRecognitionConstructor);
    adapter.updateConfig({ lang: 'en-US', silenceTimeoutMs: 5000 });
    const config = adapter.getConfig();
    expect(config.lang).toBe('en-US');
    expect(config.silenceTimeoutMs).toBe(5000);
  });

  it('应能合并自定义命令', () => {
    const adapter = new VoiceInputAdapter(
      {
        commandShortcuts: {
          custom: { pattern: /custom/i, action: 'custom', description: 'Custom' },
        },
      },
      (() => { return {} as any; }) as unknown as SpeechRecognitionConstructor
    );
    const config = adapter.getConfig();
    expect(config.commandShortcuts.send).toBeDefined();
    expect(config.commandShortcuts.custom).toBeDefined();
  });

  it('应触发 config-updated 事件', () => {
    const adapter = new VoiceInputAdapter(undefined, (() => { return {} as any; }) as unknown as SpeechRecognitionConstructor);
    const handler = vi.fn();
    adapter.on('config-updated', handler);
    adapter.updateConfig({ lang: 'ja-JP' });
    expect(handler).toHaveBeenCalled();
  });
});

describe('VoiceInputAdapter - 支持检测', () => {
  it('有 SpeechRecognition 时应支持', () => {
    const adapter = new VoiceInputAdapter(undefined, (() => { return {} as any; }) as unknown as SpeechRecognitionConstructor);
    expect(adapter.isSupported()).toBe(true);
  });

  it('无 SpeechRecognition 时不支持', () => {
    const adapter = new VoiceInputAdapter();
    // happy-dom 没有 SpeechRecognition
    expect(adapter.isSupported()).toBe(false);
  });
});

describe('VoiceInputAdapter - 启动/停止', () => {
  let adapter: VoiceInputAdapter;
  let mock: { ctor: SpeechRecognitionConstructor; latestRef: { current: MockSpeechRecognition | null } };

  beforeEach(() => {
    mock = makeMockCtor();
    adapter = new VoiceInputAdapter(undefined, mock.ctor);
  });

  afterEach(() => {
    adapter.destroy();
  });

  it('应能启动识别', async () => {
    await adapter.start();
    // 等待 setTimeout
    await new Promise((r) => setTimeout(r, 5));
    expect(adapter.getState().isListening).toBe(true);
  });

  it('start 应触发 start 事件', async () => {
    const handler = vi.fn();
    adapter.on('start', handler);
    await adapter.start();
    await new Promise((r) => setTimeout(r, 5));
    expect(handler).toHaveBeenCalled();
  });

  it('应能停止识别', async () => {
    await adapter.start();
    await new Promise((r) => setTimeout(r, 5));
    adapter.stop();
    expect(mock.latestRef.current!.stopCalls).toBe(1);
  });

  it('应能 abort 识别', async () => {
    await adapter.start();
    await new Promise((r) => setTimeout(r, 5));
    adapter.abort();
    expect(adapter.getState().isListening).toBe(false);
  });

  it('未支持时应抛出错误', async () => {
    const a = new VoiceInputAdapter();
    await expect(a.start()).rejects.toThrow();
  });

  it('重复 start 不应再次启动', async () => {
    await adapter.start();
    await new Promise((r) => setTimeout(r, 5));
    await adapter.start();
    expect(mock.latestRef.current!.startCalls).toBe(1);
  });
});

describe('VoiceInputAdapter - 识别结果', () => {
  let adapter: VoiceInputAdapter;
  let mock: { ctor: SpeechRecognitionConstructor; latestRef: { current: MockSpeechRecognition | null } };

  beforeEach(() => {
    mock = makeMockCtor();
    adapter = new VoiceInputAdapter(undefined, mock.ctor);
  });

  afterEach(() => {
    adapter.destroy();
  });

  it('最终结果应累积到 transcript', async () => {
    await adapter.start();
    await new Promise((r) => setTimeout(r, 5));
    mock.latestRef.current!.emitResult('你好');
    mock.latestRef.current!.emitResult('世界');
    const state = adapter.getState();
    expect(state.transcript).toContain('你好');
    expect(state.transcript).toContain('世界');
  });

  it('中间结果应存储在 interimTranscript', async () => {
    await adapter.start();
    await new Promise((r) => setTimeout(r, 5));
    mock.latestRef.current!.emitInterim('正在识别');
    const state = adapter.getState();
    expect(state.interimTranscript).toBe('正在识别');
  });

  it('应触发 result 事件', async () => {
    const handler = vi.fn();
    adapter.on('result', handler);
    await adapter.start();
    await new Promise((r) => setTimeout(r, 5));
    mock.latestRef.current!.emitResult('测试');
    expect(handler).toHaveBeenCalled();
  });

  it('应触发 interim 事件', async () => {
    const handler = vi.fn();
    adapter.on('interim', handler);
    await adapter.start();
    await new Promise((r) => setTimeout(r, 5));
    mock.latestRef.current!.emitInterim('中间');
    expect(handler).toHaveBeenCalled();
  });

  it('应记录最高置信度', async () => {
    await adapter.start();
    await new Promise((r) => setTimeout(r, 5));
    mock.latestRef.current!.emitResult('高置信度', true, 0.95);
    expect(adapter.getState().confidence).toBeCloseTo(0.95, 2);
  });
});

describe('VoiceInputAdapter - 错误处理', () => {
  it('应能处理识别错误', async () => {
    const mock = makeMockCtor();
    const adapter = new VoiceInputAdapter(undefined, mock.ctor);
    const handler = vi.fn();
    adapter.on('error', handler);
    await adapter.start();
    await new Promise((r) => setTimeout(r, 5));
    mock.latestRef.current!.emitError('no-speech');
    expect(adapter.getState().error).toBe('no-speech');
    expect(adapter.getState().isListening).toBe(false);
    expect(handler).toHaveBeenCalled();
    adapter.destroy();
  });
});

describe('VoiceInputAdapter - 命令匹配', () => {
  let adapter: VoiceInputAdapter;
  let mock: { ctor: SpeechRecognitionConstructor; latestRef: { current: MockSpeechRecognition | null } };

  beforeEach(() => {
    mock = makeMockCtor();
    adapter = new VoiceInputAdapter(undefined, mock.ctor);
  });

  afterEach(() => {
    adapter.destroy();
  });

  it('应能匹配 send 命令', async () => {
    const handler = vi.fn();
    adapter.on('command', handler);
    await adapter.start();
    await new Promise((r) => setTimeout(r, 5));
    mock.latestRef.current!.emitResult('请帮我查一下 然后发送');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ name: 'send' }));
  });

  it('应能匹配 clear 命令', async () => {
    const handler = vi.fn();
    adapter.on('command', handler);
    await adapter.start();
    await new Promise((r) => setTimeout(r, 5));
    mock.latestRef.current!.emitResult('清空');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ name: 'clear' }));
  });

  it('应能匹配 stop 命令', async () => {
    const handler = vi.fn();
    adapter.on('command', handler);
    await adapter.start();
    await new Promise((r) => setTimeout(r, 5));
    mock.latestRef.current!.emitResult('停止');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ name: 'stop' }));
  });

  it('应能添加自定义命令', async () => {
    const customCmd: VoiceCommand = { pattern: /执行/i, action: 'custom', description: 'Run' };
    adapter.addCommand('run', customCmd);
    expect(adapter.getConfig().commandShortcuts.run).toEqual(customCmd);
  });

  it('应能移除命令', () => {
    expect(adapter.removeCommand('send')).toBe(true);
    expect(adapter.removeCommand('non-existent')).toBe(false);
  });

  it('命令 callback 应被调用', async () => {
    const cb = vi.fn();
    adapter.addCommand('test', { pattern: /test/i, action: 'custom', description: 'T', callback: cb });
    await adapter.start();
    await new Promise((r) => setTimeout(r, 5));
    mock.latestRef.current!.emitResult('this is a test');
    expect(cb).toHaveBeenCalled();
  });
});

describe('VoiceInputAdapter - 静音自动停止', () => {
  it('应能启用/禁用自动停止', () => {
    const adapter = new VoiceInputAdapter(undefined, (() => { return {} as any; }) as unknown as SpeechRecognitionConstructor);
    adapter.updateConfig({ autoStopOnSilence: false });
    expect(adapter.getConfig().autoStopOnSilence).toBe(false);
  });
});

describe('VoiceInputAdapter - reset', () => {
  it('应能重置状态', async () => {
    const mock = makeMockCtor();
    const adapter = new VoiceInputAdapter(undefined, mock.ctor);
    await adapter.start();
    await new Promise((r) => setTimeout(r, 5));
    mock.latestRef.current!.emitResult('hello');
    adapter.reset();
    const state = adapter.getState();
    expect(state.transcript).toBe('');
    expect(state.isListening).toBe(false);
    adapter.destroy();
  });

  it('应触发 engine-reset 事件', () => {
    const adapter = new VoiceInputAdapter(undefined, (() => { return {} as any; }) as unknown as SpeechRecognitionConstructor);
    const handler = vi.fn();
    adapter.on('engine-reset', handler);
    adapter.reset();
    expect(handler).toHaveBeenCalled();
  });
});

describe('VoiceInputAdapter - 事件总线', () => {
  it('VoiceEventBus 应独立工作', () => {
    const bus = new VoiceEventBus();
    const handler = vi.fn();
    bus.on('start', handler);
    bus.emit('start', { x: 1 });
    expect(handler).toHaveBeenCalledWith({ x: 1 });
    expect(bus.listenerCount('start')).toBe(1);
    bus.clear();
    expect(bus.listenerCount()).toBe(0);
  });
});

describe('VoiceInputAdapter - 单例', () => {
  it('getVoiceInputAdapter 应返回单例', () => {
    resetVoiceInputAdapter();
    const a = getVoiceInputAdapter(undefined, (() => { return {} as any; }) as unknown as SpeechRecognitionConstructor);
    const b = getVoiceInputAdapter();
    expect(a).toBe(b);
  });
});

describe('VoiceInputAdapter - 工具', () => {
  it('SUPPORTED_LANGUAGES 应包含中文/英文/日文', () => {
    const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
    expect(codes).toContain('zh-CN');
    expect(codes).toContain('en-US');
    expect(codes).toContain('ja-JP');
  });

  it('应能切换语言', () => {
    const adapter = new VoiceInputAdapter(undefined, (() => { return {} as any; }) as unknown as SpeechRecognitionConstructor);
    adapter.setLanguage('en-US');
    expect(adapter.getConfig().lang).toBe('en-US');
  });
});
