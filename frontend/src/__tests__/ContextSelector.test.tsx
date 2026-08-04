/**
 * # ============================================================
 * # ContextSelector 组件单元测试
 * # Cycle 62 G62-02
 * # ====================================
 */

/// <reference types="vitest" />

// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ContextSelector } from '../components/ContextSelector';

import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { expect as vitestExpect } from 'vitest';
(vitestExpect as any).extend(jestDomMatchers);

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('ContextSelector - 基础渲染', () => {
  beforeEach(() => {
    // 默认 fetch mock：返回空 bundles
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/context/bundles')) {
        return new Response(JSON.stringify({ bundles: [], count: 0 }), { status: 200 });
      }
      if (String(url).includes('/context/stats')) {
        return new Response(
          JSON.stringify({
            success: true,
            stats: { bundle_count: 0, total_items: 0, total_tokens: 0 },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;
  });

  it('应渲染主框架', async () => {
    render(<ContextSelector testId="ctx-sel" />);
    await waitFor(() => {
      expect(screen.getByTestId('ctx-sel')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ctx-sel-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-sel-add-btn')).toBeInTheDocument();
  });

  it('应显示空状态', async () => {
    render(<ContextSelector testId="ctx-sel" />);
    await waitFor(() => {
      expect(screen.getByTestId('ctx-sel-empty')).toBeInTheDocument();
    });
  });

  it('应能切换添加表单', async () => {
    render(<ContextSelector testId="ctx-sel" />);
    await waitFor(() => {
      expect(screen.getByTestId('ctx-sel-add-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('ctx-sel-add-btn'));
    expect(screen.getByTestId('ctx-sel-add-form')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-sel-bundle-id')).toBeInTheDocument();
  });

  it('应支持 6 种源类型', async () => {
    render(<ContextSelector testId="ctx-sel" />);
    fireEvent.click(screen.getByTestId('ctx-sel-add-btn'));
    expect(screen.getByTestId('ctx-sel-src-file')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-sel-src-code')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-sel-src-terminal')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-sel-src-git')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-sel-src-document')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-sel-src-web')).toBeInTheDocument();
  });

  it('切换源类型应显示对应字段', async () => {
    render(<ContextSelector testId="ctx-sel" />);
    fireEvent.click(screen.getByTestId('ctx-sel-add-btn'));
    // file 源：path 字段
    expect(screen.getByTestId('ctx-sel-field-path')).toBeInTheDocument();
    // 切换到 git
    fireEvent.click(screen.getByTestId('ctx-sel-src-git'));
    expect(screen.getByTestId('ctx-sel-field-repo_path')).toBeInTheDocument();
  });
});

describe('ContextSelector - bundle 列表', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).includes('/context/bundles') && (!options || options.method !== 'POST')) {
        return new Response(
          JSON.stringify({
            bundles: [
              {
                bundle_id: 'b1',
                items: [
                  {
                    item_id: 'i1',
                    source_type: 'file',
                    source_data: { path: '/tmp/x.py' },
                    content: 'print(1)',
                    token_count: 2,
                    loaded_at: Date.now() / 1000,
                    error: null,
                    metadata: {},
                    loaded: true,
                  },
                ],
                item_count: 1,
                combined_content: 'print(1)',
                total_tokens: 2,
                created_at: Date.now() / 1000,
              },
            ],
            count: 1,
          }),
          { status: 200 },
        );
      }
      if (String(url).includes('/context/stats')) {
        return new Response(
          JSON.stringify({
            success: true,
            stats: { bundle_count: 1, total_items: 1, total_tokens: 2 },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as unknown as typeof fetch;
  });

  it('应显示已有 bundle', async () => {
    render(<ContextSelector testId="ctx-sel" />);
    await waitFor(() => {
      const select = screen.getByTestId('ctx-sel-bundle-select') as HTMLSelectElement;
      expect(select.options.length).toBeGreaterThan(1);
    });
  });

  it('应显示 bundle 中的 items', async () => {
    render(<ContextSelector testId="ctx-sel" />);
    await waitFor(() => {
      expect(screen.getByTestId('ctx-sel-item-i1')).toBeInTheDocument();
    });
  });
});

describe('ContextSelector - 添加上下文项', () => {
  it('应提交添加请求', async () => {
    let addCalled = false;
    global.fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).includes('/context/bundles') && (!options || options.method !== 'POST')) {
        return new Response(JSON.stringify({ bundles: [], count: 0 }), { status: 200 });
      }
      if (String(url).includes('/context/items') && options?.method === 'POST') {
        addCalled = true;
        const body = JSON.parse(options.body as string);
        expect(body.bundle_id).toBe('test-bundle');
        expect(body.source_type).toBe('file');
        return new Response(
          JSON.stringify({
            success: true,
            item: {
              item_id: 'ctx-new',
              source_type: 'file',
              source_data: { path: '/tmp/test.py' },
              content: 'print(1)',
              token_count: 2,
              loaded_at: Date.now() / 1000,
              error: null,
              metadata: {},
              loaded: true,
            },
          }),
          { status: 200 },
        );
      }
      if (String(url).includes('/context/stats')) {
        return new Response(
          JSON.stringify({ stats: { bundle_count: 0, total_items: 0, total_tokens: 0 } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as unknown as typeof fetch;

    render(<ContextSelector testId="ctx-sel" />);
    fireEvent.click(screen.getByTestId('ctx-sel-add-btn'));
    fireEvent.change(screen.getByTestId('ctx-sel-bundle-id'), {
      target: { value: 'test-bundle' },
    });
    fireEvent.change(screen.getByTestId('ctx-sel-field-path'), {
      target: { value: '/tmp/test.py' },
    });
    fireEvent.click(screen.getByTestId('ctx-sel-submit-btn'));

    await waitFor(() => {
      expect(addCalled).toBe(true);
    });
  });
});
