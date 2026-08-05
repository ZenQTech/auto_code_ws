/**
 * # ============================================================
 * # SkillsRegistryPanel 组件测试
 * # Cycle 70 G70-01
 * # ====================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SkillsRegistryPanel } from './SkillsRegistryPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockSkills = [
  {
    id: 'defaults:code-reviewer',
    name: 'code-reviewer',
    display_name: 'Code Reviewer',
    description: 'Reviews code for quality',
    location: 'defaults',
    path: '/opt/hermes/skills/code-reviewer/SKILL.md',
    enabled: true,
    source: 'skill_md',
    version: '1.0.0',
    tags: ['code', 'review'],
    allowed_tools: ['read_file'],
    user_invocable: true,
    disable_model_invocation: false,
    system_prompt: '',
    scripts: [],
    references: [],
    last_scanned_at: '',
    content_hash: '',
  },
  {
    id: 'user:my-skill',
    name: 'my-skill',
    display_name: 'My Skill',
    description: 'A user-defined skill',
    location: 'user',
    path: '/home/user/.hermes/skills/my-skill/SKILL.md',
    enabled: false,
    source: 'skill_md',
    version: '1.0.0',
    tags: ['user'],
    allowed_tools: [],
    user_invocable: true,
    disable_model_invocation: false,
    system_prompt: '',
    scripts: [],
    references: [],
    last_scanned_at: '',
    content_hash: '',
  },
];

const mockLocations = [
  { name: 'defaults', paths: [], exists: true, skill_count: 1, scanned_at: '' },
  { name: 'system', paths: ['/opt/hermes/skills'], exists: true, skill_count: 0, scanned_at: '' },
  { name: 'admin', paths: ['/etc/hermes/skills'], exists: false, skill_count: 0, scanned_at: '' },
  { name: 'user', paths: ['~/.hermes/skills'], exists: true, skill_count: 1, scanned_at: '' },
  { name: 'repo', paths: [], exists: false, skill_count: 0, scanned_at: '' },
];

describe('SkillsRegistryPanel', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('打开时显示标题', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills, total: 2 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ locations: mockLocations }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conflicts: [] }),
      });

    render(<SkillsRegistryPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByText(/技能注册表/)).toBeTruthy();
  });

  it('关闭时不渲染', () => {
    const { container } = render(
      <SkillsRegistryPanel isOpen={false} onClose={() => {}} />
    );
    expect(container.querySelector('[data-testid="skills-registry-panel"]')).toBeNull();
  });

  it('应该显示 skills 列表', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills, total: 2 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ locations: mockLocations }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conflicts: [] }),
      });

    render(<SkillsRegistryPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('skill-item-code-reviewer')).toBeTruthy();
    });
    expect(screen.getByTestId('skill-item-my-skill')).toBeTruthy();
  });

  it('应该显示位置徽章', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills, total: 2 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ locations: mockLocations }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conflicts: [] }),
      });

    render(<SkillsRegistryPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('skill-location-code-reviewer')).toBeTruthy();
    });

    const locationBadge = screen.getByTestId('skill-location-code-reviewer');
    expect(locationBadge.textContent).toContain('内置');

    const userBadge = screen.getByTestId('skill-location-my-skill');
    expect(userBadge.textContent).toContain('用户');
  });

  it('应该显示 5 个位置卡片', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills, total: 2 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ locations: mockLocations }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conflicts: [] }),
      });

    render(<SkillsRegistryPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('location-card-defaults')).toBeTruthy();
    });

    expect(screen.getByTestId('location-card-system')).toBeTruthy();
    expect(screen.getByTestId('location-card-admin')).toBeTruthy();
    expect(screen.getByTestId('location-card-user')).toBeTruthy();
    expect(screen.getByTestId('location-card-repo')).toBeTruthy();
  });

  it('点击关闭按钮触发 onClose', async () => {
    let closed = false;
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: [], total: 0 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ locations: mockLocations }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conflicts: [] }),
      });

    render(<SkillsRegistryPanel isOpen={true} onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByTestId('skills-registry-close'));
    expect(closed).toBe(true);
  });

  it('应该能切换到 match tab', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills, total: 2 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ locations: mockLocations }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conflicts: [] }),
      });

    render(<SkillsRegistryPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('skill-item-code-reviewer')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('skills-tab-match'));
    expect(screen.getByTestId('skills-registry-match')).toBeTruthy();
  });

  it('match 输入并显示结果', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills, total: 2 }),
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
        json: async () => ({ history: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          matches: [
            {
              skill: mockSkills[0],
              similarity: 0.85,
              matched_tokens: ['review'],
            },
          ],
        }),
      });

    render(<SkillsRegistryPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('skill-item-code-reviewer')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('skills-tab-match'));
    const input = screen.getByTestId('match-query-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'review code' } });
    fireEvent.click(screen.getByTestId('match-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('match-item-code-reviewer')).toBeTruthy();
    });
  });

  it('应该能切换到 conflicts tab', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills, total: 2 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ locations: mockLocations }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conflicts: [] }),
      });

    render(<SkillsRegistryPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('skill-item-code-reviewer')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('skills-tab-conflicts'));
    expect(screen.getByTestId('skills-registry-conflicts')).toBeTruthy();
  });

  it('应该能切换到 history tab', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills, total: 2 }),
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
        json: async () => ({ history: [] }),
      });

    render(<SkillsRegistryPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('skill-item-code-reviewer')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('skills-tab-history'));
    expect(screen.getByTestId('skills-registry-history')).toBeTruthy();
  });

  it('应该能调用 invoke 按钮', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills, total: 2 }),
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
        json: async () => ({ history: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          invocation: {
            id: 'inv-1',
            skill_id: 'defaults:code-reviewer',
            skill_name: 'code-reviewer',
            invocation_type: 'explicit',
            query: '',
            status: 'success',
            timestamp: Date.now(),
            duration_ms: 5,
          },
        }),
      });

    render(<SkillsRegistryPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('skill-item-code-reviewer')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('skill-invoke-code-reviewer'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/invoke'),
        expect.any(Object)
      );
    });
  });

  it('应该能切换 enable/disable', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills, total: 2 }),
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
        json: async () => ({ history: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skill: { ...mockSkills[0], enabled: false } }),
      });

    render(<SkillsRegistryPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('skill-item-code-reviewer')).toBeTruthy();
    });

    const toggle = screen.getByTestId('skill-toggle-code-reviewer');
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/enabled'),
        expect.objectContaining({ method: 'PUT' })
      );
    });
  });

  it('应该能打开详情模态框', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills, total: 2 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ locations: mockLocations }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conflicts: [] }),
      });

    render(<SkillsRegistryPanel isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('skill-item-code-reviewer')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('skill-detail-code-reviewer'));
    expect(screen.getByTestId('skill-detail-modal')).toBeTruthy();

    // 关闭模态框
    fireEvent.click(screen.getByTestId('skill-detail-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('skill-detail-modal')).toBeNull();
    });
  });
});
