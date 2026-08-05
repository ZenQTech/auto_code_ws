// @vitest-environment happy-dom
/**
 * # ============================================================
 * # SandboxPanel 组件测试
 * # Cycle 69 G69-01
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SandboxPanel } from './SandboxPanel';

describe('SandboxPanel', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders empty state when no sandboxes', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    });
    render(<SandboxPanel testId="sandbox-test" />);
    await waitFor(() => {
      expect(screen.getByTestId('sandbox-test-empty')).toBeTruthy();
    });
  });

  it('renders sandbox list', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            sandbox_id: 'sb-12345',
            work_dir: '/tmp',
            status: 'running',
            resource_preset: 'default',
            created_at: '2026-08-05T00:00:00Z',
            ttl_seconds: 3600,
            backend: 'docker',
          },
        ],
      }),
    });
    render(<SandboxPanel testId="sandbox-test" />);
    await waitFor(() => {
      expect(screen.getByTestId('sandbox-test-item-sb-12345')).toBeTruthy();
    });
  });

  it('creates sandbox', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            sandbox_id: 'sb-new-1',
            work_dir: '/tmp',
            status: 'created',
            resource_preset: 'default',
            created_at: '2026-08-05T00:00:00Z',
            ttl_seconds: 3600,
            backend: 'docker',
          },
        }),
      });
    render(<SandboxPanel testId="sandbox-test" />);
    await waitFor(() => screen.getByTestId('sandbox-test-empty'));
    fireEvent.click(screen.getByTestId('sandbox-test-create-btn'));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sandbox/create',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('shows error on API failure', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));
    render(<SandboxPanel testId="sandbox-test" />);
    await waitFor(() => {
      expect(screen.getByTestId('sandbox-test-error')).toBeTruthy();
    });
  });
});
