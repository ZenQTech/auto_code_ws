/**
 * # ============================================================
 * # useAgentsMdV2 Hook 测试
 * # Cycle 70 G70-01
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import { useAgentsMdV2 } from './useAgentsMdV2';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useAgentsMdV2', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('resolve 应该 POST /load', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        cwd: '/tmp/test',
        project_root: '/tmp/test',
        layers: [
          {
            scope: 'project',
            path: '/tmp/test/AGENTS.md',
            content: '# Project Rules',
            size: 15,
            is_truncated: false,
            source: 'AGENTS.md',
            level: 1,
          },
        ],
        merged_content: '# Project Rules',
        total_bytes: 15,
        max_bytes: 32768,
        is_truncated: false,
        truncated_count: 0,
        layer_count: 1,
        resolved_at: '2026-08-05T00:00:00Z',
      }),
    });

    const { result } = renderHook(() => useAgentsMdV2());

    let resolved: any = null;
    await act(async () => {
      resolved = await result.current.resolve('/tmp/test', { max_bytes: 32768 });
    });

    expect(resolved).toBeDefined();
    expect(resolved.layers).toHaveLength(1);
    expect(resolved.layers[0].scope).toBe('project');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/load'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('loadConfig 应该 GET /config', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        config: {
          max_bytes: 32768,
          max_depth: 10,
          fallback_filenames: ['AGENTS.md', 'TEAM_GUIDE.md'],
          project_root_markers: ['.git', '.hg'],
          developer_instructions: '',
          global_paths: ['~/.hermes/AGENTS.md'],
        },
      }),
    });

    const { result } = renderHook(() => useAgentsMdV2());

    let cfg: any = null;
    await act(async () => {
      cfg = await result.current.loadConfig();
    });

    expect(cfg).toBeDefined();
    expect(cfg.max_bytes).toBe(32768);
    expect(cfg.fallback_filenames).toContain('AGENTS.md');
  });

  it('saveConfig 应该 PUT /config', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        config: {
          max_bytes: 65536,
          max_depth: 5,
          fallback_filenames: ['AGENTS.md'],
          project_root_markers: ['.git'],
          developer_instructions: 'always use TS',
          global_paths: [],
        },
      }),
    });

    const { result } = renderHook(() => useAgentsMdV2());

    let success: boolean = false;
    await act(async () => {
      success = await result.current.saveConfig({
        max_bytes: 65536,
        max_depth: 5,
        fallback_filenames: ['AGENTS.md'],
        project_root_markers: ['.git'],
        developer_instructions: 'always use TS',
        global_paths: [],
      });
    });

    expect(success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/config'),
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('detectRoot 应该 POST /detect-root', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        cwd: '/tmp/test',
        project_root: '/tmp/test',
        marker_found: '.git',
        depth: 0,
        is_within_repo: true,
      }),
    });

    const { result } = renderHook(() => useAgentsMdV2());

    let root: any = null;
    await act(async () => {
      root = await result.current.detectRoot('/tmp/test');
    });

    expect(root).toBeDefined();
    expect(root.project_root).toBe('/tmp/test');
    expect(root.marker_found).toBe('.git');
  });

  it('空 cwd 应该被拒绝', async () => {
    const { result } = renderHook(() => useAgentsMdV2());

    let resolved: any = null;
    await act(async () => {
      resolved = await result.current.resolve('');
    });

    expect(resolved).toBeNull();
    expect(result.current.error).toContain('cwd');
  });

  it('错误应该被捕获', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('Parse error'));

    const { result } = renderHook(() => useAgentsMdV2());

    await act(async () => {
      await result.current.resolve('/tmp/test');
    });

    expect(result.current.error).toContain('Parse error');
  });
});
