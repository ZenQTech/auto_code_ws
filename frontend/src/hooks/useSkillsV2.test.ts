/**
 * # ============================================================
 * # useSkillsV2 Hook 测试
 * # Cycle 70 G70-01
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSkillsV2 } from './useSkillsV2';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockSkills = [
  {
    id: 'defaults:code-reviewer',
    name: 'code-reviewer',
    display_name: 'Code Reviewer',
    description: 'Reviews code',
    location: 'defaults',
    path: '/opt/hermes/skills/code-reviewer/SKILL.md',
    enabled: true,
    source: 'skill_md',
    version: '1.0.0',
    tags: ['code', 'review'],
    allowed_tools: ['read_file'],
    user_invocable: true,
    disable_model_invocation: false,
    system_prompt: 'You are a code reviewer',
    scripts: [],
    references: [],
    last_scanned_at: '2026-08-05T00:00:00Z',
    content_hash: 'abc123',
  },
];

const mockLocations = [
  { name: 'defaults', paths: [], exists: true, skill_count: 1, scanned_at: '2026-08-05T00:00:00Z' },
  { name: 'system', paths: ['/opt/hermes/skills'], exists: true, skill_count: 0, scanned_at: '2026-08-05T00:00:00Z' },
  { name: 'admin', paths: ['/etc/hermes/skills'], exists: false, skill_count: 0, scanned_at: '2026-08-05T00:00:00Z' },
  { name: 'user', paths: ['~/.hermes/skills'], exists: true, skill_count: 0, scanned_at: '2026-08-05T00:00:00Z' },
  { name: 'repo', paths: [], exists: false, skill_count: 0, scanned_at: '2026-08-05T00:00:00Z' },
];

describe('useSkillsV2', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('应该初始化并加载 skills + locations', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills, total: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ locations: mockLocations }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conflicts: [] }),
      });

    const { result } = renderHook(() => useSkillsV2());

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1);
    });

    expect(result.current.skills[0].name).toBe('code-reviewer');
    expect(result.current.locations).toHaveLength(5);
  });

  it('应该支持按 location 过滤', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills, total: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ locations: mockLocations }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conflicts: [] }),
      });

    const { result } = renderHook(() => useSkillsV2({ location: 'defaults' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('location=defaults'),
        expect.any(Object)
      );
    });
  });

  it('getByName 应返回正确 skill', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills, total: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ locations: mockLocations }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conflicts: [] }),
      });

    const { result } = renderHook(() => useSkillsV2());

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1);
    });

    const found = result.current.getByName('code-reviewer');
    expect(found).toBeDefined();
    expect(found?.name).toBe('code-reviewer');
    expect(result.current.getByName('nonexistent')).toBeUndefined();
  });

  it('getLocationCounts 应正确统计', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills, total: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ locations: mockLocations }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conflicts: [] }),
      });

    const { result } = renderHook(() => useSkillsV2());

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1);
    });

    const counts = result.current.getLocationCounts();
    expect(counts.defaults).toBe(1);
    expect(counts.system).toBe(0);
  });

  it('setEnabled 应该 PUT /enabled', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills, total: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ locations: mockLocations }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conflicts: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skill: { ...mockSkills[0], enabled: false } }),
      });

    const { result } = renderHook(() => useSkillsV2());

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1);
    });

    await act(async () => {
      await result.current.setEnabled('defaults:code-reviewer', false);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/enabled'),
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('rescan 应该 POST /rescan', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills, total: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ locations: mockLocations }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conflicts: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          skills_found: 5,
          skills_added: 1,
          skills_removed: 0,
          conflicts: [],
          duration_ms: 42,
          scanned_at: '2026-08-05T00:00:00Z',
        }),
      });

    const { result } = renderHook(() => useSkillsV2());

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1);
    });

    let rescanResult: any = null;
    await act(async () => {
      rescanResult = await result.current.rescan('/tmp/repo');
    });

    expect(rescanResult).toBeDefined();
    expect(rescanResult.skills_found).toBe(5);
  });

  it('错误应该被捕获到 error state', async () => {
    // 模拟所有 3 个初始 fetch 全部失败
    (global.fetch as any)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useSkillsV2());

    await waitFor(() => {
      expect(result.current.error).toContain('Network error');
    });
  });

  it('clearError 应该清除 error', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('Some error'));

    const { result } = renderHook(() => useSkillsV2());

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });
});
