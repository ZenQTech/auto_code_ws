// @vitest-environment happy-dom
/**
 * # ============================================================
 * # CodebasePanel 组件测试
 * # Cycle 68 G68-01
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CodebasePanel } from './CodebasePanel';

describe('CodebasePanel', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('渲染面板', () => {
    render(<CodebasePanel />);
    expect(screen.getByText('📚 代码库索引')).toBeTruthy();
    expect(screen.getByTestId('codebase-root-input')).toBeTruthy();
    expect(screen.getByTestId('codebase-build-btn')).toBeTruthy();
  });

  it('构建索引', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        session_id: 'idx-1',
        project_root: '/tmp/proj',
        total_files: 10,
        total_symbols: 50,
        total_lines: 200,
        languages: { python: 8 },
        build_time_ms: 100,
      }),
    });
    render(<CodebasePanel defaultRoot="/tmp/proj" />);
    const buildBtn = screen.getByTestId('codebase-build-btn');
    fireEvent.click(buildBtn);
    await waitFor(() => {
      expect(screen.getByTestId('codebase-stats')).toBeTruthy();
    });
  });

  it('构建失败显示错误', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ detail: 'PROJECT_NOT_FOUND' }),
    });
    render(<CodebasePanel defaultRoot="/missing" />);
    const buildBtn = screen.getByTestId('codebase-build-btn');
    fireEvent.click(buildBtn);
    await waitFor(() => {
      expect(screen.getByTestId('codebase-error')).toBeTruthy();
    });
  });

  it('搜索结果显示', async () => {
    const mockFetch = global.fetch as any;
    // First call: build index
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        session_id: 'idx-1',
        project_root: '/x',
        total_files: 1,
        total_symbols: 0,
        total_lines: 1,
        languages: {},
        build_time_ms: 1,
      }),
    });
    // Second call: search
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        session_id: 'idx-1',
        query: 'foo',
        total: 1,
        results: [
          { type: 'symbol', file: 'a.py', name: 'foo', kind: 'function', score: 0.9 },
        ],
      }),
    });
    render(<CodebasePanel defaultRoot="/x" />);
    fireEvent.click(screen.getByTestId('codebase-build-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('codebase-search-input')).toBeTruthy();
    });
    const searchInput = screen.getByTestId('codebase-search-input');
    fireEvent.change(searchInput, { target: { value: 'foo' } });
    fireEvent.click(screen.getByTestId('codebase-search-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('codebase-results')).toBeTruthy();
    });
  });
});
