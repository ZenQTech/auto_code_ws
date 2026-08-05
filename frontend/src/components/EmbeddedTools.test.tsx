// @vitest-environment happy-dom
/**
 * # ============================================================
 * # EmbeddedTools 组件测试 (Tab 切换)
 * # Cycle 69 G69-01/02/03
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { EmbeddedTools } from './EmbeddedTools';

describe('EmbeddedTools - G69 Tab Integration', () => {
  beforeEach(() => {
    // Mock localStorage
    (global as any).localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    (window as any).localStorage = (global as any).localStorage;
    // Mock fetch to prevent real network calls
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({}),
        text: async () => '',
      } as any),
    ) as any;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders all 17 tabs including new sandbox, replay, multimodal', () => {
    render(<EmbeddedTools />);
    // 17 tabs expected
    const expectedTabs = [
      'overview', 'editor', 'terminal', 'browser', 'diff', 'memory',
      'files', 'metrics', 'context', 'stage', 'batch', 'snapshot',
      'thinking', 'stream', 'sandbox', 'replay', 'multimodal',
    ];
    for (const t of expectedTabs) {
      const el = screen.queryByTestId(`embedded-tools-tab-${t}`);
      if (!el) {
        // Print which tab is missing
        throw new Error(`Missing tab: ${t}`);
      }
    }
    expect(true).toBe(true);
  });

  it('switches to sandbox tab and renders SandboxPanel', async () => {
    render(<EmbeddedTools />);
    const sandboxTab = screen.getByTestId('embedded-tools-tab-sandbox');
    fireEvent.click(sandboxTab);
    await waitFor(() => {
      expect(screen.getByTestId('embedded-tool-sandbox')).toBeTruthy();
    });
  });

  it('switches to replay tab and renders SessionReplayPanel', async () => {
    render(<EmbeddedTools />);
    fireEvent.click(screen.getByTestId('embedded-tools-tab-replay'));
    await waitFor(() => {
      expect(screen.getByTestId('embedded-tool-replay')).toBeTruthy();
    });
  });

  it('switches to multimodal tab and renders MultimodalInputPanel', async () => {
    render(<EmbeddedTools />);
    fireEvent.click(screen.getByTestId('embedded-tools-tab-multimodal'));
    await waitFor(() => {
      expect(screen.getByTestId('embedded-tool-multimodal')).toBeTruthy();
    });
  });

  it('preserves default tab from props', () => {
    render(<EmbeddedTools defaultTab="multimodal" />);
    expect(screen.getByTestId('embedded-tool-multimodal')).toBeTruthy();
  });
});
