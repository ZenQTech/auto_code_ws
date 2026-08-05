// @vitest-environment happy-dom
/**
 * # ============================================================
 * # useCodebase Hook 单元测试
 * # Cycle 68 G68-01
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCodebase } from './useCodebase';

describe('useCodebase', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('buildIndex posts and sets stats', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        session_id: 'idx-1',
        project_root: '/tmp/proj',
        total_files: 10,
        total_symbols: 50,
        total_lines: 200,
        languages: { python: 8, javascript: 2 },
        build_time_ms: 100,
        status: 'completed',
      }),
    });
    const { result } = renderHook(() => useCodebase(''));
    let stats: any;
    await act(async () => {
      stats = await result.current.buildIndex('/tmp/proj');
    });
    expect(stats.total_files).toBe(10);
    expect(result.current.indexStats?.total_files).toBe(10);
    expect(result.current.activeSessionId).toBe('idx-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/codebase/index',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ project_root: '/tmp/proj', force_rebuild: false }),
      }),
    );
  });

  it('buildIndex handles error', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error',
      json: async () => ({ detail: 'PROJECT_NOT_FOUND' }),
    });
    const { result } = renderHook(() => useCodebase(''));
    await act(async () => {
      try {
        await result.current.buildIndex('/missing');
      } catch (e) {
        // expected
      }
    });
    expect(result.current.buildError).toContain('PROJECT_NOT_FOUND');
  });

  it('search posts query and sets results', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        session_id: 'idx-1',
        query: 'foo',
        total: 1,
        results: [
          {
            type: 'symbol',
            file: 'src/main.py',
            name: 'foo_func',
            kind: 'function',
            score: 0.9,
          },
        ],
      }),
    });
    const { result } = renderHook(() => useCodebase(''));
    let results: any[];
    await act(async () => {
      results = await result.current.search('idx-1', 'foo');
    });
    expect(results).toHaveLength(1);
    expect(result.current.searchResults[0].name).toBe('foo_func');
    expect(result.current.lastQuery).toBe('foo');
  });

  it('getFile reads file content', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        path: 'src/main.py',
        language: 'python',
        total_lines: 3,
        lines: [
          { line_no: 1, content: 'def foo():' },
          { line_no: 2, content: '    pass' },
        ],
      }),
    });
    const { result } = renderHook(() => useCodebase(''));
    let file: any;
    await act(async () => {
      file = await result.current.getFile('idx-1', 'src/main.py', { lineStart: 0, lineEnd: 10 });
    });
    expect(file.language).toBe('python');
    expect(result.current.currentFile?.path).toBe('src/main.py');
  });

  it('refreshSessions lists sessions', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total: 2,
        sessions: [
          { session_id: 's1', project_root: '/a', total_files: 5, total_symbols: 10 },
          { session_id: 's2', project_root: '/b', total_files: 8, total_symbols: 20 },
        ],
      }),
    });
    const { result } = renderHook(() => useCodebase(''));
    await act(async () => {
      await result.current.refreshSessions();
    });
    expect(result.current.sessions).toHaveLength(2);
  });

  it('reset clears state', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        session_id: 'idx-1',
        project_root: '/x',
        total_files: 1,
        total_symbols: 0,
        total_lines: 10,
        languages: {},
        build_time_ms: 1,
      }),
    });
    const { result } = renderHook(() => useCodebase(''));
    await act(async () => {
      await result.current.buildIndex('/x');
    });
    expect(result.current.indexStats).not.toBeNull();
    act(() => {
      result.current.reset();
    });
    expect(result.current.indexStats).toBeNull();
    expect(result.current.activeSessionId).toBeNull();
  });

  it('setActiveSession updates active session', () => {
    const { result } = renderHook(() => useCodebase(''));
    act(() => {
      result.current.setActiveSession('s-123');
    });
    expect(result.current.activeSessionId).toBe('s-123');
  });
});
