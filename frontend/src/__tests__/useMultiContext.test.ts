/**
 * # ============================================================
 * # useMultiContext Hook 单元测试
 * # Cycle 62 G62-02
 * # ====================================
 */

/// <reference types="vitest" />

// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, act, waitFor } from '@testing-library/react';
import { useMultiContext } from '../hooks/useMultiContext';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useMultiContext - 基础功能', () => {
  it('应初始加载 bundles', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/context/bundles')) {
        return new Response(
          JSON.stringify({
            bundles: [
              {
                bundle_id: 'b1',
                items: [],
                item_count: 0,
                combined_content: '',
                total_tokens: 0,
                created_at: 0,
              },
            ],
            count: 1,
          }),
          { status: 200 },
        );
      }
      if (String(url).includes('/context/stats')) {
        return new Response(
          JSON.stringify({ stats: { bundle_count: 1, total_items: 0, total_tokens: 0 } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useMultiContext());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.bundles.length).toBe(1);
    expect(result.current.activeBundle?.bundle_id).toBe('b1');
  });

  it('应处理加载错误', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ detail: 'fail' }), { status: 500 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useMultiContext());
    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });
  });

  it('应能添加 item', async () => {
    global.fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).includes('/context/items') && options?.method === 'POST') {
        return new Response(
          JSON.stringify({
            success: true,
            item: {
              item_id: 'new',
              source_type: 'file',
              source_data: {},
              content: 'x',
              token_count: 1,
              loaded_at: 0,
              error: null,
              metadata: {},
              loaded: true,
            },
          }),
          { status: 200 },
        );
      }
      if (String(url).includes('/context/bundles')) {
        return new Response(JSON.stringify({ bundles: [], count: 0 }), { status: 200 });
      }
      if (String(url).includes('/context/stats')) {
        return new Response(
          JSON.stringify({ stats: { bundle_count: 0, total_items: 0, total_tokens: 0 } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useMultiContext());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    let item: Awaited<ReturnType<typeof result.current.addItem>> = null;
    await act(async () => {
      item = await result.current.addItem({
        bundle_id: 'b1',
        source_type: 'file',
        source_data: { path: '/x' },
      });
    });
    expect(item).not.toBeNull();
    expect(item!.item_id).toBe('new');
  });

  it('应能删除 bundle', async () => {
    let deleteCalled = false;
    global.fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).includes('/context/bundles/') && options?.method === 'DELETE') {
        deleteCalled = true;
        return new Response(JSON.stringify({ success: true, removed: true }), { status: 200 });
      }
      if (String(url).includes('/context/bundles')) {
        return new Response(JSON.stringify({ bundles: [], count: 0 }), { status: 200 });
      }
      if (String(url).includes('/context/stats')) {
        return new Response(
          JSON.stringify({ stats: { bundle_count: 0, total_items: 0, total_tokens: 0 } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useMultiContext());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    await act(async () => {
      await result.current.deleteBundle('b1');
    });
    expect(deleteCalled).toBe(true);
  });
});
