/**
 * # ============================================================
 * # useSkillInvocation Hook 测试
 * # Cycle 70 G70-01
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import { useSkillInvocation } from './useSkillInvocation';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useSkillInvocation', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('match 应该 POST /match', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        matches: [
          {
            skill: {
              id: 'defaults:code-reviewer',
              name: 'code-reviewer',
              description: 'Reviews code',
              location: 'defaults',
              path: '',
              enabled: true,
              source: 'skill_md',
              version: '1.0.0',
              tags: [],
              allowed_tools: [],
              user_invocable: true,
              disable_model_invocation: false,
              system_prompt: '',
              scripts: [],
              references: [],
              last_scanned_at: '',
              content_hash: '',
            },
            similarity: 0.85,
            matched_tokens: ['review'],
          },
        ],
      }),
    });

    const { result } = renderHook(() => useSkillInvocation());

    let matches: any = [];
    await act(async () => {
      matches = await result.current.match('review this code');
    });

    expect(matches).toHaveLength(1);
    expect(matches[0].similarity).toBe(0.85);
  });

  it('空 query 不应发送请求', async () => {
    const { result } = renderHook(() => useSkillInvocation());

    let matches: any = ['sentinel'];
    await act(async () => {
      matches = await result.current.match('');
    });

    expect(matches).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('invoke 应该 POST /invoke', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        invocation: {
          id: 'inv-1',
          skill_id: 'defaults:test',
          skill_name: 'test',
          invocation_type: 'explicit',
          query: '$test',
          args: {},
          status: 'success',
          result: 'ok',
          timestamp: Date.now(),
          duration_ms: 12,
        },
      }),
    });

    const { result } = renderHook(() => useSkillInvocation());

    let invocation: any = null;
    await act(async () => {
      invocation = await result.current.invoke('test', { foo: 'bar' });
    });

    expect(invocation).toBeDefined();
    expect(invocation.status).toBe('success');
    expect(result.current.lastInvocation?.id).toBe('inv-1');
  });

  it('refreshHistory 应该 GET /history', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        history: [
          {
            id: 'h-1',
            skill_id: 'defaults:foo',
            skill_name: 'foo',
            invocation_type: 'explicit',
            query: '$foo',
            status: 'success',
            timestamp: 1000,
            duration_ms: 5,
          },
        ],
      }),
    });

    const { result } = renderHook(() => useSkillInvocation());

    await act(async () => {
      await result.current.refreshHistory();
    });

    expect(result.current.history).toHaveLength(1);
  });

  it('错误应该被捕获', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('Network fail'));

    const { result } = renderHook(() => useSkillInvocation());

    await act(async () => {
      await result.current.match('test');
    });

    expect(result.current.error).toContain('Network fail');
  });
});
