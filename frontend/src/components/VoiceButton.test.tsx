/**
 * # ============================================================
 * # VoiceButton 组件测试 (Cycle 24 G24-03)
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { VoiceButton } from './VoiceButton';
import { resetVoiceInputAdapter } from '../utils/voiceInputAdapter';

class MockSpeechRecognition {
  lang = 'zh-CN';
  continuous = true;
  interimResults = true;
  maxAlternatives = 1;
  onresult: any = null;
  onerror: any = null;
  onend: any = null;
  onstart: any = null;
  startCalls = 0;
  stopCalls = 0;

  start() {
    this.startCalls += 1;
    setTimeout(() => this.onstart?.(new Event('start')), 0);
  }
  stop() {
    this.stopCalls += 1;
  }
  abort() {
    this.onend?.(new Event('end'));
  }
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
  emitInterim(transcript: string) {
    this.emitResult(transcript, false);
  }
}

function installMockRecognition() {
  const ref: { current: MockSpeechRecognition | null } = { current: null };
  const Ctor: any = function () {
    ref.current = new MockSpeechRecognition();
    return ref.current;
  };
  (globalThis as any).SpeechRecognition = Ctor;
  (window as any).SpeechRecognition = Ctor;
  return ref;
}

describe('VoiceButton', () => {
  let mockRef: { current: MockSpeechRecognition | null };

  beforeEach(() => {
    resetVoiceInputAdapter();
    mockRef = installMockRecognition();
  });

  afterEach(() => {
    resetVoiceInputAdapter();
    delete (globalThis as any).SpeechRecognition;
    delete (window as any).SpeechRecognition;
    cleanup();
  });

  it('应渲染麦克风按钮', () => {
    render(<VoiceButton />);
    expect(screen.getByTestId('voice-button')).toBeTruthy();
  });

  it('应显示当前语言', () => {
    render(<VoiceButton />);
    expect(screen.getByTestId('voice-lang').textContent).toBe('zh-CN');
  });

  it('不支持时不应渲染', () => {
    delete (globalThis as any).SpeechRecognition;
    delete (window as any).SpeechRecognition;
    resetVoiceInputAdapter();
    const { container } = render(<VoiceButton />);
    expect(container.firstChild).toBeNull();
  });

  it('点击按钮应启动识别', async () => {
    render(<VoiceButton />);
    fireEvent.click(screen.getByTestId('voice-button'));
    await new Promise((r) => setTimeout(r, 5));
    expect(mockRef.current!.startCalls).toBe(1);
  });

  it('监听中再次点击应停止', async () => {
    render(<VoiceButton />);
    fireEvent.click(screen.getByTestId('voice-button'));
    await new Promise((r) => setTimeout(r, 5));
    fireEvent.click(screen.getByTestId('voice-button'));
    expect(mockRef.current!.stopCalls).toBe(1);
  });

  it('应触发 onListenStart 回调', async () => {
    const onStart = vi.fn();
    render(<VoiceButton onListenStart={onStart} />);
    fireEvent.click(screen.getByTestId('voice-button'));
    await new Promise((r) => setTimeout(r, 10));
    expect(onStart).toHaveBeenCalled();
  });

  it('应触发 onTranscriptChange 回调', async () => {
    const onChange = vi.fn();
    render(<VoiceButton onTranscriptChange={onChange} />);
    fireEvent.click(screen.getByTestId('voice-button'));
    await new Promise((r) => setTimeout(r, 5));
    mockRef.current!.emitResult('hello');
    expect(onChange).toHaveBeenCalled();
  });

  it('应触发 onFinalTranscript 回调（end 事件）', async () => {
    const onFinal = vi.fn();
    render(<VoiceButton onFinalTranscript={onFinal} />);
    fireEvent.click(screen.getByTestId('voice-button'));
    await new Promise((r) => setTimeout(r, 5));
    mockRef.current!.emitResult('test');
    mockRef.current!.onend?.(new Event('end'));
    await new Promise((r) => setTimeout(r, 5));
    expect(onFinal).toHaveBeenCalledWith('test');
  });

  it('应触发 onError 回调', async () => {
    const onError = vi.fn();
    render(<VoiceButton onError={onError} />);
    fireEvent.click(screen.getByTestId('voice-button'));
    await new Promise((r) => setTimeout(r, 5));
    mockRef.current!.onerror?.({ error: 'no-speech' });
    expect(onError).toHaveBeenCalledWith('no-speech');
  });

  it('点击语言按钮应打开语言菜单', () => {
    render(<VoiceButton />);
    fireEvent.click(screen.getByTestId('voice-lang'));
    expect(screen.getByTestId('voice-lang-menu')).toBeTruthy();
  });

  it('选择语言应切换', () => {
    render(<VoiceButton />);
    fireEvent.click(screen.getByTestId('voice-lang'));
    fireEvent.click(screen.getByTestId('voice-lang-en-US'));
    expect(screen.getByTestId('voice-lang').textContent).toBe('en-US');
  });

  it('点击外部应关闭语言菜单', () => {
    render(<VoiceButton />);
    fireEvent.click(screen.getByTestId('voice-lang'));
    expect(screen.getByTestId('voice-lang-menu')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('voice-lang-menu')).toBeNull();
  });

  it('点击帮助按钮应打开命令帮助', () => {
    render(<VoiceButton />);
    fireEvent.click(screen.getByTestId('voice-help'));
    expect(screen.getByTestId('voice-help-panel')).toBeTruthy();
    expect(screen.getByText(/语音命令/)).toBeTruthy();
  });

  it('实时转写时应显示气泡', async () => {
    render(<VoiceButton />);
    fireEvent.click(screen.getByTestId('voice-button'));
    await new Promise((r) => setTimeout(r, 10));
    act(() => {
      mockRef.current!.emitResult('你好');
    });
    await waitFor(() => {
      expect(screen.getByTestId('voice-bubble')).toBeTruthy();
    }, { timeout: 1000 });
  });

  it('错误状态应显示错误提示', async () => {
    render(<VoiceButton />);
    fireEvent.click(screen.getByTestId('voice-button'));
    await new Promise((r) => setTimeout(r, 10));
    act(() => {
      mockRef.current!.onerror?.({ error: 'audio-capture' });
    });
    await waitFor(() => {
      expect(screen.getByTestId('voice-error')).toBeTruthy();
    }, { timeout: 1000 });
  });

  it('应支持自定义大小', () => {
    const { container } = render(<VoiceButton size="sm" />);
    const btn = container.querySelector('[data-testid="voice-button"]');
    expect(btn?.className).toContain('w-7');
  });

  it('showBubble=false 时不应显示气泡', async () => {
    render(<VoiceButton showBubble={false} />);
    fireEvent.click(screen.getByTestId('voice-button'));
    await new Promise((r) => setTimeout(r, 5));
    mockRef.current!.emitResult('test');
    expect(screen.queryByTestId('voice-bubble')).toBeNull();
  });

  it('应触发 onCommand 回调', async () => {
    const onCmd = vi.fn();
    render(<VoiceButton onCommand={onCmd} />);
    fireEvent.click(screen.getByTestId('voice-button'));
    await new Promise((r) => setTimeout(r, 5));
    mockRef.current!.emitResult('请帮我查一下 然后发送');
    expect(onCmd).toHaveBeenCalledWith('send', expect.stringContaining('发送'));
  });

  it('应支持自定义 label', () => {
    render(<VoiceButton label="语音" />);
    expect(screen.getByText('语音')).toBeTruthy();
  });
});
