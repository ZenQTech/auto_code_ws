/**
 * # ============================================================
 * # PRDGeneratorPanel 组件单元测试
 * # Cycle 63 G63-01
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import PRDGeneratorPanel from '../components/PRDGeneratorPanel';

const originalFetch = globalThis.fetch;

const MOCK_PRD = {
  prd_id: 'prd-test-1',
  title: '测试 PRD',
  goals: ['目标 A', '目标 B'],
  user_scenarios: [
    {
      name: '基础场景',
      description: '用户使用核心功能',
      preconditions: ['已登录'],
      steps: ['打开', '使用'],
    },
  ],
  acceptance_criteria: [
    { id: 'AC-1', description: '功能正常', metric: '可用性', target: '100%' },
    { id: 'AC-2', description: '响应快', metric: 'P95', target: '< 200ms' },
  ],
  tasks: [
    {
      id: 'T-1',
      name: '需求分析',
      description: '分析需求',
      dependencies: [],
      estimated_hours: 4,
      risk_level: 'low',
    },
  ],
  risks: ['技术风险'],
  version: 1,
  created_at: 1700000000,
  updated_at: 1700000000,
};

function mockFetchList(extra: unknown[] = []) {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url.includes('/_list')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, total: extra.length, prds: extra }),
      };
    }
    if (url.includes('/_stats')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          stats: { total_prds: extra.length, total_versions: extra.length, rate_limit_per_hour: 100 },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

describe('PRDGeneratorPanel - 基础渲染', () => {
  beforeEach(() => {
    globalThis.fetch = mockFetchList();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('应正确渲染标题', () => {
    render(<PRDGeneratorPanel />);
    expect(screen.getByText('PRD 生成器')).toBeInTheDocument();
  });

  it('应渲染需求输入框', () => {
    render(<PRDGeneratorPanel />);
    expect(screen.getByTestId('prd-generator-panel-requirement')).toBeInTheDocument();
  });

  it('应渲染生成按钮', () => {
    render(<PRDGeneratorPanel />);
    expect(screen.getByTestId('prd-generator-panel-generate-btn')).toBeInTheDocument();
  });

  it('应渲染空状态', () => {
    render(<PRDGeneratorPanel />);
    expect(screen.getByTestId('prd-generator-panel-empty')).toBeInTheDocument();
  });

  it('应渲染阶段过滤按钮', () => {
    render(<PRDGeneratorPanel />);
    expect(screen.getByTestId('prd-generator-panel-stage-all')).toBeInTheDocument();
    expect(screen.getByTestId('prd-generator-panel-stage-prd')).toBeInTheDocument();
    expect(screen.getByTestId('prd-generator-panel-stage-coding')).toBeInTheDocument();
    expect(screen.getByTestId('prd-generator-panel-stage-preview')).toBeInTheDocument();
    expect(screen.getByTestId('prd-generator-panel-stage-deploy')).toBeInTheDocument();
  });
});

describe('PRDGeneratorPanel - PRD 列表', () => {
  beforeEach(() => {
    globalThis.fetch = mockFetchList([MOCK_PRD]);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllAll?.();
    vi.restoreAllMocks();
  });

  it('应显示 PRD 项', async () => {
    render(<PRDGeneratorPanel />);
    await waitFor(() => {
      expect(screen.getByTestId('prd-generator-panel-prd-item-prd-test-1')).toBeInTheDocument();
    });
  });

  it('点击 PRD 项应加载详情', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/_list')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, total: 1, prds: [MOCK_PRD] }),
        };
      }
      if (url.includes('/_stats')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            stats: { total_prds: 1, total_versions: 1, rate_limit_per_hour: 100 },
          }),
        };
      }
      if (url.includes('/prd-test-1')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            prd: MOCK_PRD,
            current_version: 1,
            history: [{ version: 1, content: MOCK_PRD, diff_summary: 'initial', created_at: 1700000000 }],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as typeof fetch;
    render(<PRDGeneratorPanel />);
    await waitFor(() => {
      expect(screen.getByTestId('prd-generator-panel-prd-item-prd-test-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('prd-generator-panel-prd-item-prd-test-1'));
    await waitFor(() => {
      expect(screen.getByTestId('prd-generator-panel-prd-title')).toBeInTheDocument();
    });
    expect(screen.getByTestId('prd-generator-panel-prd-title').textContent).toContain('测试 PRD');
  });
});

describe('PRDGeneratorPanel - 阶段过滤', () => {
  beforeEach(() => {
    globalThis.fetch = mockFetchList([MOCK_PRD]);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('点击阶段按钮应高亮', async () => {
    render(<PRDGeneratorPanel />);
    const codingBtn = screen.getByTestId('prd-generator-panel-stage-coding');
    fireEvent.click(codingBtn);
    expect(codingBtn.className).toContain('accent-primary');
  });
});

describe('PRDGeneratorPanel - 错误处理', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'server error' }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('错误时应显示错误条', async () => {
    render(<PRDGeneratorPanel />);
    await waitFor(() => {
      expect(screen.getByTestId('prd-generator-panel-error')).toBeInTheDocument();
    });
  });
});
