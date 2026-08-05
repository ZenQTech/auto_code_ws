// @vitest-environment happy-dom
/**
 * # ============================================================
 * # useVoiceInput Hook 单元测试
 * # Cycle 69 G69-03
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceInput, SUPPORTED_LANGUAGES } from './useVoiceInput';

describe('useVoiceInput', () => {
  beforeEach(() => {
    // 清理 window 上的 SpeechRecognition mock
    delete (window as any).SpeechRecognition;
    delete (window as any).webkitSpeechRecognition;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with correct defaults', () => {
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.isListening).toBe(false);
    expect(result.current.transcript).toBe('');
    expect(result.current.interimTranscript).toBe('');
    expect(result.current.error).toBe(null);
    expect(result.current.language).toBe('zh-CN');
  });

  it('detects unsupported browser', () => {
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.supported).toBe(false);
  });

  it('detects Web Speech API support', () => {
    const MockSR = vi.fn().mockImplementation(function (this: any) {
      this.start = vi.fn();
      this.stop = vi.fn();
      this.abort = vi.fn();
      this.continuous = false;
      this.interimResults = false;
      this.lang = '';
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      this.onstart = null;
    });
    (window as any).webkitSpeechRecognition = MockSR;
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.supported).toBe(true);
  });

  it('calls onError when not supported', () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onError }));
    act(() => {
      result.current.start();
    });
    expect(onError).toHaveBeenCalled();
    expect(result.current.error).toContain('not supported');
  });

  it('starts recognition when supported', () => {
    const startFn = vi.fn();
    const MockSR = vi.fn().mockImplementation(function (this: any) {
      this.start = startFn;
      this.stop = vi.fn();
      this.abort = vi.fn();
      this.continuous = false;
      this.interimResults = false;
      this.lang = '';
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      this.onstart = null;
    });
    (window as any).webkitSpeechRecognition = MockSR;
    const { result } = renderHook(() => useVoiceInput());
    act(() => {
      result.current.start();
    });
    expect(startFn).toHaveBeenCalled();
  });

  it('stops recognition', () => {
    const stopFn = vi.fn();
    const MockSR = vi.fn().mockImplementation(function (this: any) {
      this.start = vi.fn();
      this.stop = stopFn;
      this.abort = vi.fn();
      this.continuous = false;
      this.interimResults = false;
      this.lang = '';
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      this.onstart = null;
    });
    (window as any).webkitSpeechRecognition = MockSR;
    const { result } = renderHook(() => useVoiceInput());
    act(() => {
      result.current.start();
    });
    act(() => {
      result.current.stop();
    });
    expect(stopFn).toHaveBeenCalled();
  });

  it('resets transcript', () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => {
      result.current.reset();
    });
    expect(result.current.transcript).toBe('');
    expect(result.current.interimTranscript).toBe('');
    expect(result.current.error).toBe(null);
  });

  it('sets language', () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => {
      result.current.setLanguage('en-US');
    });
    expect(result.current.language).toBe('en-US');
  });

  it('exposes supported languages', () => {
    expect(SUPPORTED_LANGUAGES['zh-CN']).toBe('中文（普通话）');
    expect(SUPPORTED_LANGUAGES['en-US']).toBe('English (US)');
    expect(SUPPORTED_LANGUAGES['ja-JP']).toBe('日本語');
  });

  it('handles onresult with interim', () => {
    let instance: any;
    const MockSR = vi.fn().mockImplementation(function (this: any) {
      instance = this;
      this.start = vi.fn();
      this.stop = vi.fn();
      this.abort = vi.fn();
      this.continuous = false;
      this.interimResults = false;
      this.lang = '';
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      this.onstart = null;
    });
    (window as any).webkitSpeechRecognition = MockSR;
    const onFinal = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onFinal }));
    act(() => {
      result.current.start();
    });
    // 触发 onresult
    act(() => {
      instance.onresult({
        resultIndex: 0,
        results: [
          { isFinal: false, 0: { transcript: 'hello', confidence: 0.9 }, length: 1 },
        ],
      });
    });
    expect(result.current.interimTranscript).toBe('hello');

    // 触发 final
    act(() => {
      instance.onresult({
        resultIndex: 0,
        results: [
          { isFinal: true, 0: { transcript: ' world', confidence: 0.95 }, length: 1 },
        ],
      });
    });
    expect(result.current.transcript).toContain('world');
    expect(onFinal).toHaveBeenCalledWith(' world');
  });

  it('handles onerror event', () => {
    let instance: any;
    const MockSR = vi.fn().mockImplementation(function (this: any) {
      instance = this;
      this.start = vi.fn();
      this.stop = vi.fn();
      this.abort = vi.fn();
      this.continuous = false;
      this.interimResults = false;
      this.lang = '';
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      this.onstart = null;
    });
    (window as any).webkitSpeechRecognition = MockSR;
    const onError = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onError }));
    act(() => {
      result.current.start();
    });
    act(() => {
      instance.onerror({ error: 'no-speech' });
    });
    expect(result.current.error).toBe('no-speech');
    expect(onError).toHaveBeenCalledWith('no-speech');
  });

  it('handles onend event', () => {
    let instance: any;
    const MockSR = vi.fn().mockImplementation(function (this: any) {
      instance = this;
      this.start = vi.fn();
      this.stop = vi.fn();
      this.abort = vi.fn();
      this.continuous = false;
      this.interimResults = false;
      this.lang = '';
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      this.onstart = null;
    });
    (window as any).webkitSpeechRecognition = MockSR;
    const onEnd = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onEnd }));
    act(() => {
      result.current.start();
    });
    act(() => {
      instance.onend({});
    });
    expect(result.current.isListening).toBe(false);
    expect(onEnd).toHaveBeenCalled();
  });

  it('handles onstart event', () => {
    let instance: any;
    const MockSR = vi.fn().mockImplementation(function (this: any) {
      instance = this;
      this.start = vi.fn();
      this.stop = vi.fn();
      this.abort = vi.fn();
      this.continuous = false;
      this.interimResults = false;
      this.lang = '';
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      this.onstart = null;
    });
    (window as any).webkitSpeechRecognition = MockSR;
    const onStart = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onStart }));
    act(() => {
      result.current.start();
    });
    act(() => {
      instance.onstart({});
    });
    expect(result.current.isListening).toBe(true);
    expect(onStart).toHaveBeenCalled();
  });

  it('accumulates transcript across multiple final results', () => {
    let instance: any;
    const MockSR = vi.fn().mockImplementation(function (this: any) {
      instance = this;
      this.start = vi.fn();
      this.stop = vi.fn();
      this.abort = vi.fn();
      this.continuous = false;
      this.interimResults = false;
      this.lang = '';
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      this.onstart = null;
    });
    (window as any).webkitSpeechRecognition = MockSR;
    const { result } = renderHook(() => useVoiceInput());
    act(() => {
      result.current.start();
    });
    act(() => {
      instance.onresult({
        resultIndex: 0,
        results: [
          { isFinal: true, 0: { transcript: 'Hello', confidence: 0.9 }, length: 1 },
        ],
      });
    });
    act(() => {
      instance.onresult({
        resultIndex: 0,
        results: [
          { isFinal: true, 0: { transcript: 'World', confidence: 0.9 }, length: 1 },
        ],
      });
    });
    expect(result.current.transcript).toContain('Hello');
    expect(result.current.transcript).toContain('World');
  });

  it('cleans up on unmount', () => {
    const abortFn = vi.fn();
    const MockSR = vi.fn().mockImplementation(function (this: any) {
      this.start = vi.fn();
      this.stop = vi.fn();
      this.abort = abortFn;
      this.continuous = false;
      this.interimResults = false;
      this.lang = '';
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      this.onstart = null;
    });
    (window as any).webkitSpeechRecognition = MockSR;
    const { unmount, result } = renderHook(() => useVoiceInput());
    act(() => {
      result.current.start();
    });
    unmount();
    expect(abortFn).toHaveBeenCalled();
  });
});
