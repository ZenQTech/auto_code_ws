/**
 * # ============================================================
 * # useAgentRoles Hook 单元测试
 * # Cycle 63 G63-02
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
// @vitest-environment happy-dom
import { useAgentRoles } from '../hooks/useAgentRoles';

const originalFetch = globalThis.fetch;

describe('useAgentRoles - 基础', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('应正确初始化 hook', () => {
    const { result } = renderHook(() => useAgentRoles());
    expect(result.current.roles).toEqual([]);
    expect(result.current.instances).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('loadRoles 应正确获取角色列表', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        total: 2,
        roles: [
          { name: 'default', description: 'd', developer_instructions: 'i', nickname_candidates: [], builtin: true },
          { name: 'custom', description: 'c', developer_instructions: 'i', nickname_candidates: [], builtin: false },
        ],
      }),
    }) as typeof fetch;
    const { result } = renderHook(() => useAgentRoles());
    await act(async () => {
      await result.current.loadRoles();
    });
    expect(result.current.roles.length).toBe(2);
  });

  it('loadInstances 应正确获取实例列表', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        total: 1,
        instances: [
          { agent_id: 'a1', role_name: 'worker', nickname: 'Builder', status: 'running', task: 't1', started_at: 1000, finished_at: null, result: null, error: null },
        ],
      }),
    }) as typeof fetch;
    const { result } = renderHook(() => useAgentRoles());
    await act(async () => {
      await result.current.loadInstances();
    });
    expect(result.current.instances.length).toBe(1);
  });

  it('createRole 应正确创建角色', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      callCount++;
      if (url.endsWith('/api/agent-roles') && callCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, role: { name: 'new-role', builtin: false } }),
        };
      }
      // loadRoles 之后调用
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, total: 1, roles: [{ name: 'new-role', builtin: false }] }),
      };
    }) as typeof fetch;
    const { result } = renderHook(() => useAgentRoles());
    let role: unknown = null;
    await act(async () => {
      role = await result.current.createRole({ name: 'new-role', description: 'd', developer_instructions: 'i' });
    });
    expect(role).not.toBeNull();
  });

  it('deleteRole 应正确删除', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, name: 'x' }),
    }) as typeof fetch;
    const { result } = renderHook(() => useAgentRoles());
    let ok = false;
    await act(async () => {
      ok = await result.current.deleteRole('x');
    });
    expect(ok).toBe(true);
  });

  it('spawnInstance 应正确启动', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        instance: { agent_id: 'a1', role_name: 'worker', nickname: 'Builder', status: 'running' },
      }),
    }) as typeof fetch;
    const { result } = renderHook(() => useAgentRoles());
    let inst: unknown = null;
    await act(async () => {
      inst = await result.current.spawnInstance('worker', { task: 't1' });
    });
    expect(inst).not.toBeNull();
    expect((inst as { agent_id: string }).agent_id).toBe('a1');
  });

  it('clearError 应清除错误', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'err' }),
    }) as typeof fetch;
    const { result } = renderHook(() => useAgentRoles());
    await act(async () => {
      await result.current.loadRoles();
    });
    expect(result.current.error).not.toBeNull();
    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });
});
