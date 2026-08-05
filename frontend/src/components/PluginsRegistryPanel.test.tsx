/**
 * # ============================================================
 * # PluginsRegistryPanel 组件测试
 * # Cycle 70 G70-01
 * # ====================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PluginsRegistryPanel } from './PluginsRegistryPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockPlugin = {
  id: 'plugin-1',
  name: 'test-plugin',
  version: '1.0.0',
  description: 'Test plugin',
  enabled: true,
  source: 'local',
  install_path: '/home/user/.hermes/plugins/test-plugin',
  dependencies: [{ name: 'dep-a', version_spec: '>=1.0.0', installed: false }],
  skills: ['skill-a'],
  mcp_servers: ['github'],
  agents: ['reviewer'],
  installed_at: '2026-08-05T00:00:00Z',
  plugin_toml_path: '/home/user/.hermes/plugins/test-plugin/plugin.toml',
};

describe('PluginsRegistryPanel', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('打开时显示标题', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ plugins: [] }),
    });

    render(<PluginsRegistryPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/Plugin 管理/)).toBeTruthy();
  });

  it('关闭时不渲染', () => {
    const { container } = render(
      <PluginsRegistryPanel isOpen={false} onClose={() => {}} />
    );
    expect(container.querySelector('[data-testid="plugins-registry-panel"]')).toBeNull();
  });

  it('应该显示 plugins 列表', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ plugins: [mockPlugin] }),
    });

    render(<PluginsRegistryPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('plugin-item-test-plugin')).toBeTruthy();
    });
  });

  it('应该能输入安装路径', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ plugins: [] }),
    });

    render(<PluginsRegistryPanel isOpen={true} onClose={() => {}} />);

    const input = screen.getByTestId('install-path-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/tmp/my-plugin' } });
    expect(input.value).toBe('/tmp/my-plugin');
  });

  it('点击安装应该 POST /install-path', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugins: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plugin: mockPlugin }),
      });

    render(<PluginsRegistryPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('install-btn')).toBeTruthy();
    });

    const input = screen.getByTestId('install-path-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/tmp/my-plugin' } });
    fireEvent.click(screen.getByTestId('install-btn'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/install-path'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('应该能切换 enable/disable', async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/list')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ plugins: [mockPlugin] }),
        });
      }
      if (url.includes('/enable')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ plugin: { ...mockPlugin, enabled: false } }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<PluginsRegistryPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('plugin-item-test-plugin')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('plugin-toggle-test-plugin'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/enable'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('应该能打开详情模态框', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ plugins: [mockPlugin] }),
    });

    render(<PluginsRegistryPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('plugin-item-test-plugin')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('plugin-detail-test-plugin'));
    expect(screen.getByTestId('plugin-detail-modal')).toBeTruthy();
  });

  it('点击关闭按钮触发 onClose', async () => {
    let closed = false;
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ plugins: [] }),
    });

    render(<PluginsRegistryPanel isOpen={true} onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByTestId('plugins-close'));
    expect(closed).toBe(true);
  });

  it('空路径时安装按钮应该 disabled', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ plugins: [] }),
    });

    render(<PluginsRegistryPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('install-btn')).toBeTruthy();
    });

    const btn = screen.getByTestId('install-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
