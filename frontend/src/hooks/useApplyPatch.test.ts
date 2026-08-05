// @vitest-environment happy-dom
/**
 * # ============================================================
 * # useApplyPatch Hook 单元测试
 * # Cycle 68 G68-02
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useApplyPatch } from './useApplyPatch';

describe('useApplyPatch', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('validate posts and sets result', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        valid: true,
        ops_count: 2,
        files: ['a.py', 'b.py'],
        file_hashes: { 'a.py': 'abc123' },
        error: '',
        error_line: 0,
        ops: [{ type: 'update', file: 'a.py', hunks: 1 }],
      }),
    });
    const { result } = renderHook(() => useApplyPatch(''));
    let validate: any;
    await act(async () => {
      validate = await result.current.validate('*** Begin Patch', '/root');
    });
    expect(validate.valid).toBe(true);
    expect(result.current.lastValidate?.ops_count).toBe(2);
  });

  it('preview posts and sets result with diffs', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        safe: true,
        ops_count: 1,
        diffs: [
          {
            file: 'a.py',
            type: 'update',
            before_hash: 'aaa',
            after_hash: 'bbb',
            diff: '--- a.py\n+++ b.py\n@@\n-old\n+new',
          },
        ],
        conflicts: [],
        error: '',
      }),
    });
    const { result } = renderHook(() => useApplyPatch(''));
    let preview: any;
    await act(async () => {
      preview = await result.current.preview('*** Begin Patch', '/root');
    });
    expect(preview.safe).toBe(true);
    expect(result.current.lastPreview?.diffs[0].file).toBe('a.py');
  });

  it('apply posts and sets result', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        snapshot_id: 'snap-123',
        applied_ops: 3,
        duration_ms: 50,
        error: '',
        failed_op: null,
        rolled_back: false,
        diffs: [],
      }),
    });
    const { result } = renderHook(() => useApplyPatch(''));
    let apply: any;
    await act(async () => {
      apply = await result.current.apply('*** Begin Patch', '/root', { force: false });
    });
    expect(apply.success).toBe(true);
    expect(result.current.lastApply?.snapshot_id).toBe('snap-123');
  });

  it('apply handles 409 conflicts gracefully', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        detail: {
          error: 'CONFLICTS_DETECTED',
          conflicts: [
            { file: 'a.py', expected_hash: 'aaa', actual_hash: 'bbb', op_type: 'add', reason: 'exists' },
          ],
        },
      }),
    });
    const { result } = renderHook(() => useApplyPatch(''));
    let apply: any;
    await act(async () => {
      apply = await result.current.apply('*** Begin Patch', '/root');
    });
    expect(apply.success).toBe(false);
    expect(apply.error).toBe('CONFLICTS_DETECTED');
    expect(apply.failed_op?.conflicts).toHaveLength(1);
  });

  it('apply with force=true', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        snapshot_id: 'snap-456',
        applied_ops: 1,
        duration_ms: 30,
        error: '',
        failed_op: null,
        rolled_back: false,
        diffs: [],
      }),
    });
    const { result } = renderHook(() => useApplyPatch(''));
    let apply: any;
    await act(async () => {
      apply = await result.current.apply('*** Begin Patch', '/root', { force: true, createSnapshot: false });
    });
    expect(apply.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/apply-patch/apply',
      expect.objectContaining({
        body: expect.stringContaining('"force":true'),
      }),
    );
  });

  it('reset clears all state', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ valid: true, ops_count: 1, files: [], file_hashes: {}, error: '', error_line: 0, ops: [] }),
    });
    const { result } = renderHook(() => useApplyPatch(''));
    await act(async () => {
      await result.current.validate('*** Begin Patch', '/root');
    });
    expect(result.current.lastValidate).not.toBeNull();
    act(() => {
      result.current.reset();
    });
    expect(result.current.lastValidate).toBeNull();
    expect(result.current.lastPreview).toBeNull();
    expect(result.current.lastApply).toBeNull();
  });

  it('error state is set on failure', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Bad Request',
      json: async () => ({ detail: 'PARSE_ERROR: invalid syntax' }),
    });
    const { result } = renderHook(() => useApplyPatch(''));
    await act(async () => {
      try {
        await result.current.validate('*** invalid', '/root');
      } catch (e) {
        // expected
      }
    });
    expect(result.current.error).toContain('PARSE_ERROR');
  });
});
