/**
 * # ============================================================
 * # AgentRoleManager 组件单元测试
 * # Cycle 63 G63-02 + Cycle 64 G64-01 升级
 * # ====================================
 */

/// <reference types="vitest" />

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import AgentRoleManager from '../components/AgentRoleManager';

import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { expect as vitestExpect } from 'vitest';
(vitestExpect as any).extend(jestDomMatchers);

const originalFetch = globalThis.fetch;

const MOCK_ROLES = [
  {
    name: 'default',
    description: '默认角色',
    developer_instructions: 'be helpful',
    nickname_candidates: ['Atlas', 'Delta'],
    model: null,
    model_reasoning_effort: null,
    sandbox_mode: 'workspace-write',
    mcp_servers: [],
    skills: [],
    builtin: true,
    created_at: 1000,
    updated_at: 1000,
  },
  {
    name: 'worker',
    description: 'Worker',
    developer_instructions: 'i',
    nickname_candidates: ['Builder'],
    model: 'gpt-5.5',
    model_reasoning_effort: 'medium',
    sandbox_mode: 'workspace-write',
    mcp_servers: [],
    skills: ['code-review'],
    builtin: true,
    created_at: 1000,
    updated_at: 1000,
  },
];

function mockFetch(roles = MOCK_ROLES, instances: unknown[] = []) {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url.endsWith('/_stats')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, stats: { total_roles: roles.length, builtin_roles: 2, custom_roles: 0, total_instances: instances.length, running_instances: 0, max_concurrency_per_role: 10 } }),
      };
    }
    if (url.endsWith('/instances')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, total: instances.length, instances }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, total: roles.length, roles }),
    };
  });
}

describe('AgentRoleManager - 基础渲染', () => {
  beforeEach(() => {
    globalThis.fetch = mockFetch();
  });
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('应渲染标题', async () => {
    render(<AgentRoleManager />);
    expect(await screen.findByText('Agent 角色管理')).toBeInTheDocument();
  });

  it('应渲染新建角色按钮', async () => {
    render(<AgentRoleManager />);
    expect(await screen.findByTestId('agent-role-manager-new-role')).toBeInTheDocument();
  });

  it('应渲染角色列表', async () => {
    render(<AgentRoleManager />);
    await waitFor(() => {
      expect(screen.getByTestId('agent-role-manager-role-default')).toBeInTheDocument();
    });
  });

  it('应显示内置徽章', async () => {
    render(<AgentRoleManager />);
    await waitFor(() => {
      expect(screen.getByTestId('agent-role-manager-role-default-builtin')).toBeInTheDocument();
    });
  });

  it('应显示统计', async () => {
    render(<AgentRoleManager />);
    await waitFor(() => {
      expect(screen.getByTestId('agent-role-manager-stats')).toBeInTheDocument();
    });
  });
});

describe('AgentRoleManager - spawn', () => {
  beforeEach(() => {
    globalThis.fetch = mockFetch();
  });
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('点击 spawn 按钮应打开 Modal', async () => {
    render(<AgentRoleManager />);
    await waitFor(() => {
      expect(screen.getByTestId('agent-role-manager-role-worker-spawn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('agent-role-manager-role-worker-spawn'));
    await waitFor(() => {
      expect(screen.getByTestId('agent-role-manager-spawn-modal')).toBeInTheDocument();
    });
  });
});

describe('AgentRoleManager - 新建角色', () => {
  beforeEach(() => {
    globalThis.fetch = mockFetch();
  });
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('点击新建按钮应打开 Modal', async () => {
    render(<AgentRoleManager />);
    const btn = await screen.findByTestId('agent-role-manager-new-role');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByTestId('agent-role-manager-create-modal')).toBeInTheDocument();
    });
  });
});
