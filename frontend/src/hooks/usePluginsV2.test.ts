/**
 * # ============================================================
 * # usePluginsV2 Hook 测试
 * # Cycle 70 G70-01
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import { usePluginsV2 } from './usePluginsV2';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('usePluginsV2', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('应该自动加载 plugins', async () => {
    const mockPlugin = {
      id: 'plugin-1',
      name: 'test-plugin',
      version: '1.0.0',
      description: 'Test',
      enabled: true,
      source: 'local',
      install_path: '/home/user/.hermes/plugins/test-plugin',
      dependencies: [],
      skills: ['skill-a'],
      mcp_servers: [],
      agents: [],
      installed_at: '2026-08-05T00:00:00Z',
      plugin_toml_path: '/home/user/.hermes/plugins/test-plugin/plugin.toml',
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ plugins: [mockPlugin] }),
    });

    const { result } = renderHook(() => usePluginsV2());

    await waitFor(() => {
      expect(result.current.plugins).toHaveLength(1);
    });

    expect(result.current.plugins[0].name).toBe('test-plugin');
  });

  it('installFromPath 应该 POST /install-path', async () => {
    const mockPlugin = {
      id: 'plugin-1',
      name: 'new-plugin',
      version: '1.0.0',
      description: 'New',
      enabled: true,
      source: 'local',
      install_path: '/home/user/.hermes/plugins/new-plugin',
      dependencies: [],
      skills: [],
      mcp_servers: [],
      agents: [],
      installed_at: '2026-08-05T00:00:00Z',
      plugin_toml_path: '',
    };

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugin: mockPlugin }),
      });

    const { result } = renderHook(() => usePluginsV2());

    await waitFor(() => {
      expect(result.current.plugins).toHaveLength(0);
    });

    let plugin: any = null;
    await act(async () => {
      plugin = await result.current.installFromPath('/tmp/my-plugin', false);
    });

    expect(plugin).toBeDefined();
    expect(plugin.name).toBe('new-plugin');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/install-path'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('setEnabled 应该 POST /enable', async () => {
    const mockPlugin = {
      id: 'plugin-1',
      name: 'test',
      version: '1.0.0',
      description: '',
      enabled: true,
      source: 'local',
      install_path: '',
      dependencies: [],
      skills: [],
      mcp_servers: [],
      agents: [],
      installed_at: '',
      plugin_toml_path: '',
    };

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: [mockPlugin] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugin: { ...mockPlugin, enabled: false } }),
      });

    const { result } = renderHook(() => usePluginsV2());

    await waitFor(() => {
      expect(result.current.plugins).toHaveLength(1);
    });

    await act(async () => {
      await result.current.setEnabled('plugin-1', false);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/enable'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('uninstall 应该 DELETE /:id', async () => {
    const mockPlugin = {
      id: 'plugin-1',
      name: 'test',
      version: '1.0.0',
      description: '',
      enabled: true,
      source: 'local',
      install_path: '',
      dependencies: [],
      skills: [],
      mcp_servers: [],
      agents: [],
      installed_at: '',
      plugin_toml_path: '',
    };

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: [mockPlugin] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

    const { result } = renderHook(() => usePluginsV2());

    await waitFor(() => {
      expect(result.current.plugins).toHaveLength(1);
    });

    let ok: boolean = false;
    await act(async () => {
      ok = await result.current.uninstall('plugin-1');
    });

    expect(ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('plugin-1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('uninstall 不存在的 plugin 应返回 true', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'not found' }),
      });

    const { result } = renderHook(() => usePluginsV2());

    await waitFor(() => {
      expect(result.current.plugins).toHaveLength(0);
    });

    let ok: boolean = false;
    await act(async () => {
      ok = await result.current.uninstall('missing-id');
    });

    expect(ok).toBe(true);
  });

  it('错误应该被捕获', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('Net fail'));

    const { result } = renderHook(() => usePluginsV2());

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });
  });
});
