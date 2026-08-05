// @vitest-environment happy-dom
/**
 * # ============================================================
 * # SessionReplayPanel 组件测试
 * # Cycle 69 G69-02
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SessionReplayPanel } from './SessionReplayPanel';

describe('SessionReplayPanel', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    // Mock window.open
    (global as any).open = vi.fn(() => ({
      document: { write: vi.fn(), close: vi.fn() },
    }));
    // Mock window.confirm
    (global as any).confirm = vi.fn(() => true);
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    delete (global as any).open;
    delete (global as any).confirm;
  });

  it('renders empty state when no sessions', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    });
    render(<SessionReplayPanel testId="replay-test" />);
    await waitFor(() => {
      expect(screen.getByTestId('replay-test-empty')).toBeTruthy();
    });
  });

  it('renders session list', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            session_id: 'sess-1',
            title: 'Test session',
            created_at: '2026-08-05T00:00:00Z',
            updated_at: '2026-08-05T00:00:00Z',
            total_turns: 5,
            total_tokens: 1000,
            cwd: '/home/test',
            git_branch: 'main',
            duration_ms: 60000,
            rollout_path: '/tmp/rollout/sess-1.jsonl',
            size_bytes: 1024,
          },
        ],
      }),
    });
    render(<SessionReplayPanel testId="replay-test" />);
    await waitFor(() => {
      expect(screen.getByTestId('replay-test-item-sess-1')).toBeTruthy();
      expect(screen.getByText(/Test session/)).toBeTruthy();
    });
  });

  it('handles fetch error', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));
    render(<SessionReplayPanel testId="replay-test" />);
    await waitFor(() => {
      expect(screen.getByTestId('replay-test-error')).toBeTruthy();
    });
  });

  it('opens replay on button click', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              session_id: 'sess-1',
              title: 'Test',
              created_at: '2026-08-05T00:00:00Z',
              updated_at: '2026-08-05T00:00:00Z',
              total_turns: 1,
              total_tokens: 100,
              cwd: '/tmp',
              duration_ms: 1000,
              rollout_path: '/tmp/sess-1.jsonl',
              size_bytes: 512,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<html><body>Replay</body></html>',
      });
    render(<SessionReplayPanel testId="replay-test" />);
    await waitFor(() => screen.getByTestId('replay-test-item-sess-1'));
    fireEvent.click(screen.getByTestId('replay-test-open-sess-1'));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/replay/sessions/sess-1/html');
    });
  });
});
