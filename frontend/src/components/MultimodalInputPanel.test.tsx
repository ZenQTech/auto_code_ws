// @vitest-environment happy-dom
/**
 * # ============================================================
 * # MultimodalInputPanel 组件测试
 * # Cycle 69 G69-03
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MultimodalInputPanel } from './MultimodalInputPanel';

describe('MultimodalInputPanel', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    // Mock Web Speech API
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
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    delete (window as any).webkitSpeechRecognition;
  });

  it('renders title and controls', () => {
    render(<MultimodalInputPanel testId="mm-test" />);
    expect(screen.getByText(/多模态输入/)).toBeTruthy();
    expect(screen.getByTestId('mm-test-text-input')).toBeTruthy();
    expect(screen.getByTestId('mm-test-send-btn')).toBeTruthy();
  });

  it('updates text on textarea change', () => {
    render(<MultimodalInputPanel testId="mm-test" />);
    const textarea = screen.getByTestId('mm-test-text-input') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    expect(textarea.value).toBe('Hello');
  });

  it('disables send button when empty', () => {
    render(<MultimodalInputPanel testId="mm-test" />);
    const btn = screen.getByTestId('mm-test-send-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('enables send button with text', async () => {
    render(<MultimodalInputPanel testId="mm-test" />);
    const textarea = screen.getByTestId('mm-test-text-input');
    fireEvent.change(textarea, { target: { value: 'hi' } });
    const btn = screen.getByTestId('mm-test-send-btn') as HTMLButtonElement;
    await waitFor(() => {
      expect(btn.disabled).toBe(false);
    });
  });

  it('sends multimodal message', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { content: 'AI response' },
      }),
    });
    render(<MultimodalInputPanel testId="mm-test" />);
    fireEvent.change(screen.getByTestId('mm-test-text-input'), {
      target: { value: 'Test message' },
    });
    fireEvent.click(screen.getByTestId('mm-test-send-btn'));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/multimodal-chat/chat',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('mm-test-response')).toBeTruthy();
    });
  });

  it('shows voice start button when supported', () => {
    render(<MultimodalInputPanel testId="mm-test" />);
    expect(screen.getByTestId('mm-test-voice-start')).toBeTruthy();
  });

  it('shows error when voice API throws', () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));
    render(<MultimodalInputPanel testId="mm-test" />);
    fireEvent.change(screen.getByTestId('mm-test-text-input'), {
      target: { value: 'hi' },
    });
    fireEvent.click(screen.getByTestId('mm-test-send-btn'));
    // Should not crash
  });

  it('changes language', () => {
    render(<MultimodalInputPanel testId="mm-test" />);
    const select = screen.getByTestId('mm-test-language-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'en-US' } });
    expect(select.value).toBe('en-US');
  });
});
