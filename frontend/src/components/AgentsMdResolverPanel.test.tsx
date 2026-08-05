/**
 * # ============================================================
 * # AgentsMdResolverPanel 组件测试
 * # Cycle 70 G70-01
 * # ====================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AgentsMdResolverPanel } from './AgentsMdResolverPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockResolved = {
  cwd: '/tmp/test',
  project_root: '/tmp/test',
  layers: [
    {
      scope: 'developer',
      path: '',
      content: 'You are a senior dev',
      size: 20,
      is_truncated: false,
      source: 'inline',
      level: 0,
    },
    {
      scope: 'global',
      path: '/home/user/.hermes/AGENTS.md',
      content: '# Global rules',
      size: 14,
      is_truncated: false,
      source: 'AGENTS.md',
      level: 1,
    },
    {
      scope: 'project',
      path: '/tmp/test/AGENTS.md',
      content: '# Project rules',
      size: 15,
      is_truncated: false,
      source: 'AGENTS.md',
      level: 2,
    },
  ],
  merged_content: 'You are a senior dev\n\n# Global rules\n\n# Project rules',
  total_bytes: 49,
  max_bytes: 32768,
  is_truncated: false,
  truncated_count: 0,
  layer_count: 3,
  resolved_at: '2026-08-05T00:00:00Z',
};

const mockConfig = {
  max_bytes: 32768,
  max_depth: 10,
  fallback_filenames: ['AGENTS.md', 'TEAM_GUIDE.md'],
  project_root_markers: ['.git', '.hg'],
  developer_instructions: '',
  global_paths: ['~/.hermes/AGENTS.md'],
};

describe('AgentsMdResolverPanel', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('打开时显示标题', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ config: mockConfig }),
    });

    render(<AgentsMdResolverPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/AGENTS\.md 多层级解析/)).toBeTruthy();
  });

  it('关闭时不渲染', () => {
    const { container } = render(
      <AgentsMdResolverPanel isOpen={false} onClose={() => {}} />
    );
    expect(container.querySelector('[data-testid="agents-md-resolver-panel"]')).toBeNull();
  });

  it('应该自动加载 config', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ config: mockConfig }),
    });

    render(<AgentsMdResolverPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/config'),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  it('点击解析按钮应该 POST /load', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ config: mockConfig }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockResolved,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cwd: '/tmp/test',
          project_root: '/tmp/test',
          marker_found: '.git',
          depth: 0,
          is_within_repo: true,
        }),
      });

    render(<AgentsMdResolverPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('cwd-input')).toBeTruthy();
    });

    const cwdInput = screen.getByTestId('cwd-input') as HTMLInputElement;
    fireEvent.change(cwdInput, { target: { value: '/tmp/test' } });
    fireEvent.click(screen.getByTestId('resolve-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('resolved-layer-count')).toBeTruthy();
    });
    expect(screen.getByTestId('resolved-layer-count').textContent).toBe('3');
  });

  it('应该显示所有 layer 项', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ config: mockConfig }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockResolved,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cwd: '/tmp/test',
          project_root: '/tmp/test',
          marker_found: '.git',
          depth: 0,
          is_within_repo: true,
        }),
      });

    render(<AgentsMdResolverPanel isOpen={true} onClose={() => {}} />);

    const cwdInput = screen.getByTestId('cwd-input') as HTMLInputElement;
    fireEvent.change(cwdInput, { target: { value: '/tmp/test' } });
    fireEvent.click(screen.getByTestId('resolve-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('layer-item-0')).toBeTruthy();
    });
    expect(screen.getByTestId('layer-item-1')).toBeTruthy();
    expect(screen.getByTestId('layer-item-2')).toBeTruthy();
  });

  it('应该显示 scope 徽章', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ config: mockConfig }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockResolved,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cwd: '/tmp/test',
          project_root: '/tmp/test',
          marker_found: '.git',
          depth: 0,
          is_within_repo: true,
        }),
      });

    render(<AgentsMdResolverPanel isOpen={true} onClose={() => {}} />);

    const cwdInput = screen.getByTestId('cwd-input') as HTMLInputElement;
    fireEvent.change(cwdInput, { target: { value: '/tmp/test' } });
    fireEvent.click(screen.getByTestId('resolve-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('layer-scope-0')).toBeTruthy();
    });
    expect(screen.getByTestId('layer-scope-0').textContent).toContain('开发者注入');
    expect(screen.getByTestId('layer-scope-1').textContent).toContain('全局');
    expect(screen.getByTestId('layer-scope-2').textContent).toContain('项目');
  });

  it('应该显示合并内容', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ config: mockConfig }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockResolved,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cwd: '/tmp/test',
          project_root: '/tmp/test',
          marker_found: '.git',
          depth: 0,
          is_within_repo: true,
        }),
      });

    render(<AgentsMdResolverPanel isOpen={true} onClose={() => {}} />);

    const cwdInput = screen.getByTestId('cwd-input') as HTMLInputElement;
    fireEvent.change(cwdInput, { target: { value: '/tmp/test' } });
    fireEvent.click(screen.getByTestId('resolve-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('merged-content')).toBeTruthy();
    });
    expect(screen.getByTestId('merged-content').textContent).toContain('You are a senior dev');
  });

  it('应该显示字节数', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ config: mockConfig }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockResolved,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cwd: '/tmp/test',
          project_root: '/tmp/test',
          marker_found: '.git',
          depth: 0,
          is_within_repo: true,
        }),
      });

    render(<AgentsMdResolverPanel isOpen={true} onClose={() => {}} />);

    const cwdInput = screen.getByTestId('cwd-input') as HTMLInputElement;
    fireEvent.change(cwdInput, { target: { value: '/tmp/test' } });
    fireEvent.click(screen.getByTestId('resolve-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('resolved-total-bytes').textContent).toBe('49/32768');
    });
  });

  it('应该显示截断徽章', async () => {
    const truncatedResolved = {
      ...mockResolved,
      is_truncated: true,
      truncated_count: 2,
    };

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ config: mockConfig }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => truncatedResolved,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cwd: '/tmp/test',
          project_root: '/tmp/test',
          marker_found: '.git',
          depth: 0,
          is_within_repo: true,
        }),
      });

    render(<AgentsMdResolverPanel isOpen={true} onClose={() => {}} />);

    const cwdInput = screen.getByTestId('cwd-input') as HTMLInputElement;
    fireEvent.change(cwdInput, { target: { value: '/tmp/test' } });
    fireEvent.click(screen.getByTestId('resolve-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('truncated-badge')).toBeTruthy();
    });
    expect(screen.getByTestId('truncated-badge').textContent).toContain('截断');
  });

  it('应该能展开 layer 详情', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ config: mockConfig }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockResolved,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cwd: '/tmp/test',
          project_root: '/tmp/test',
          marker_found: '.git',
          depth: 0,
          is_within_repo: true,
        }),
      });

    render(<AgentsMdResolverPanel isOpen={true} onClose={() => {}} />);

    const cwdInput = screen.getByTestId('cwd-input') as HTMLInputElement;
    fireEvent.change(cwdInput, { target: { value: '/tmp/test' } });
    fireEvent.click(screen.getByTestId('resolve-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('layer-expand-1')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('layer-expand-1'));
    // 展开后再次点击同一个按钮（文本变为"收起"）
    expect(screen.getByTestId('layer-expand-1').textContent).toContain('收起');
  });

  it('应该能切换 config 显示', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ config: mockConfig }),
    });

    render(<AgentsMdResolverPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('toggle-config-btn')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('toggle-config-btn'));
    expect(screen.getByTestId('config-max-bytes')).toBeTruthy();
    expect(screen.getByTestId('config-max-depth')).toBeTruthy();
    expect(screen.getByTestId('config-developer-instructions')).toBeTruthy();
  });

  it('应该能保存 config', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ config: mockConfig }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ config: { ...mockConfig, max_bytes: 65536 } }),
      });

    render(<AgentsMdResolverPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('toggle-config-btn')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('toggle-config-btn'));
    fireEvent.click(screen.getByTestId('save-config-btn'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/config'),
        expect.objectContaining({ method: 'PUT' })
      );
    });
  });

  it('点击关闭按钮触发 onClose', async () => {
    let closed = false;
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ config: mockConfig }),
    });

    render(<AgentsMdResolverPanel isOpen={true} onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByTestId('agents-md-close'));
    expect(closed).toBe(true);
  });

  it('空 cwd 不应该解析', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ config: mockConfig }),
    });

    render(<AgentsMdResolverPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('resolve-btn')).toBeTruthy();
    });

    const resolveBtn = screen.getByTestId('resolve-btn') as HTMLButtonElement;
    expect(resolveBtn.disabled).toBe(true);
  });

  it('错误应该被显示', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ config: mockConfig }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ detail: 'Internal error' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cwd: '/tmp/test',
          project_root: null,
          marker_found: null,
          depth: 0,
          is_within_repo: false,
        }),
      });

    render(<AgentsMdResolverPanel isOpen={true} onClose={() => {}} />);

    const cwdInput = screen.getByTestId('cwd-input') as HTMLInputElement;
    fireEvent.change(cwdInput, { target: { value: '/tmp/test' } });
    fireEvent.click(screen.getByTestId('resolve-btn'));

    await waitFor(() => {
      expect(screen.getByText(/Internal error/)).toBeTruthy();
    });
  });
});
