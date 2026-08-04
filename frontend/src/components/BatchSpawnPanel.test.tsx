/**
 * # ============================================================
 * # BatchSpawnPanel - 组件测试 (v1.0.0)
 * # Cycle 65 G65-02
 * # ====================================
 * # 核心作用：覆盖 BatchSpawnPanel 的渲染、CSV 输入、配置、提交
 * # 测试维度：
 * #   1. 显隐控制（isOpen）
 * #   2. CSV 加载（示例 / 清空 / 上传）
 * #   3. 配置（角色 / 模型 / 并发度）
 * #   4. 提交按钮（启用/禁用）
 * #   5. 关闭 / 错误展示
 * #   6. 快捷键 Esc / Ctrl+Enter
 * #   7. localStorage 持久化
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 65 G65-02 初次创建
 * # ====================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { BatchSpawnPanel } from './BatchSpawnPanel';

// mock fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const EMPTY_ROLES = { success: true, roles: [], total: 0 };
const EMPTY_LIST = { success: true, jobs: [] };
const SAMPLE_ROLES = {
  success: true,
  roles: [
    { name: 'default', description: '', developer_instructions: '', nickname_candidates: [], model: null, model_reasoning_effort: null, sandbox_mode: null, mcp_servers: [], skills: [], builtin: true, created_at: 0, updated_at: 0 },
    { name: 'worker', description: '', developer_instructions: '', nickname_candidates: [], model: null, model_reasoning_effort: null, sandbox_mode: null, mcp_servers: [], skills: [], builtin: true, created_at: 0, updated_at: 0 },
  ],
  total: 2,
};

describe('BatchSpawnPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetch.mockReset();
    // 默认 mock 角色列表 + list
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.endsWith('/api/agent-roles')) {
        return Promise.resolve(mockJsonResponse(SAMPLE_ROLES));
      }
      if (typeof url === 'string' && url.includes('/batch/list')) {
        return Promise.resolve(mockJsonResponse(EMPTY_LIST));
      }
      if (typeof url === 'string' && url.includes('/batch/') && url.endsWith('/cancel')) {
        return Promise.resolve(mockJsonResponse({ success: true, cancelled_count: 0 }));
      }
      if (typeof url === 'string' && url.includes('/batch/') && url.includes('/export')) {
        return Promise.resolve(mockJsonResponse({ success: true, content: 'export' }));
      }
      return Promise.resolve(mockJsonResponse({ success: true }));
    });
    if (!URL.createObjectURL) {
      (URL as any).createObjectURL = vi.fn().mockReturnValue('blob:test');
    }
    if (!URL.revokeObjectURL) {
      (URL as any).revokeObjectURL = vi.fn();
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('isOpen=false 不渲染', () => {
    render(<BatchSpawnPanel isOpen={false} onClose={() => {}} />);
    expect(screen.queryByTestId('batch-spawn-panel')).toBeNull();
  });

  it('isOpen=true 渲染面板', () => {
    render(<BatchSpawnPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('batch-spawn-panel')).toBeTruthy();
    expect(screen.getByText('批量任务 SPAWN')).toBeTruthy();
  });

  it('关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<BatchSpawnPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('batch-spawn-close-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击背景关闭面板', () => {
    const onClose = vi.fn();
    render(<BatchSpawnPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('batch-spawn-panel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击面板内容不触发关闭', () => {
    const onClose = vi.fn();
    render(<BatchSpawnPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('批量任务 SPAWN'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('默认加载示例 CSV', () => {
    render(<BatchSpawnPanel isOpen={true} onClose={() => {}} />);
    const csvInput = screen.getByTestId('batch-spawn-csv-input') as HTMLTextAreaElement;
    expect(csvInput.value).toContain('task');
  });

  it('点击示例按钮重新加载示例', () => {
    render(<BatchSpawnPanel isOpen={true} onClose={() => {}} />);
    const csvInput = screen.getByTestId('batch-spawn-csv-input') as HTMLTextAreaElement;
    // 清空
    fireEvent.change(csvInput, { target: { value: '' } });
    expect(csvInput.value).toBe('');
    // 重新加载示例
    fireEvent.click(screen.getByTestId('batch-spawn-load-sample'));
    expect(csvInput.value.length).toBeGreaterThan(0);
  });

  it('修改并发度', () => {
    render(<BatchSpawnPanel isOpen={true} onClose={() => {}} />);
    const input = screen.getByTestId('batch-spawn-concurrency') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '10' } });
    expect(input.value).toBe('10');
  });

  it('并发度下限为 1', () => {
    render(<BatchSpawnPanel isOpen={true} onClose={() => {}} />);
    const input = screen.getByTestId('batch-spawn-concurrency') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });
    expect(input.value).toBe('1');
  });

  it('修改模型', () => {
    render(<BatchSpawnPanel isOpen={true} onClose={() => {}} />);
    const input = screen.getByTestId('batch-spawn-model-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'claude-opus-4' } });
    expect(input.value).toBe('claude-opus-4');
  });

  it('修改角色', async () => {
    render(<BatchSpawnPanel isOpen={true} onClose={() => {}} />);
    // 等待 roles 加载
    await waitFor(() => {
      const options = screen.getByTestId('batch-spawn-role-select').querySelectorAll('option');
      expect(options.length).toBeGreaterThan(1);
    });
    const select = screen.getByTestId('batch-spawn-role-select') as HTMLSelectElement;
    // happy-dom 下 select 的 change 需要用原型 setter
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      'value',
    )?.set;
    setter?.call(select, 'worker');
    fireEvent.change(select);
    expect(select.value).toBe('worker');
  });

  it('CSV 为空时提交按钮被禁用', () => {
    render(<BatchSpawnPanel isOpen={true} onClose={() => {}} />);
    const csvInput = screen.getByTestId('batch-spawn-csv-input') as HTMLTextAreaElement;
    fireEvent.change(csvInput, { target: { value: '' } });
    const submitBtn = screen.getByTestId('batch-spawn-submit-btn') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it('有 CSV 时提交按钮启用', () => {
    render(<BatchSpawnPanel isOpen={true} onClose={() => {}} />);
    const submitBtn = screen.getByTestId('batch-spawn-submit-btn') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
  });

  it('点击提交触发 fetch', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.endsWith('/api/agent-roles')) {
        return Promise.resolve(mockJsonResponse(EMPTY_ROLES));
      }
      if (typeof url === 'string' && url.includes('/batch/list')) {
        return Promise.resolve(mockJsonResponse(EMPTY_LIST));
      }
      if (typeof url === 'string' && url.endsWith('/batch/spawn')) {
        return Promise.resolve(
          mockJsonResponse({
            success: true,
            batch_id: 'batch-tt1',
            total: 1,
            accepted: 1,
            rejected: 0,
            status: 'pending',
            errors: [],
          }),
        );
      }
      if (typeof url === 'string' && url.includes('/batch/') && !url.includes('/cancel') && !url.includes('/export')) {
        return Promise.resolve(
          mockJsonResponse({
            success: true,
            batch_id: 'batch-tt1',
            total: 1,
            accepted: 1,
            rejected: 0,
            in_progress: 0,
            completed: 0,
            failed: 0,
            progress: 0,
            status: 'pending',
            max_concurrency: 5,
            started_at: 0,
            instances: {},
            errors: [],
          }),
        );
      }
      return Promise.resolve(mockJsonResponse({ success: true }));
    });
    render(<BatchSpawnPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('batch-spawn-submit-btn'));
    await waitFor(() => {
      const calls = mockFetch.mock.calls as Array<[string]>;
      const spawnCall = calls.find(([u]) => typeof u === 'string' && u.endsWith('/batch/spawn'));
      expect(spawnCall).toBeDefined();
    });
  });

  it('Esc 关闭面板', () => {
    const onClose = vi.fn();
    render(<BatchSpawnPanel isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Enter 提交', async () => {
    render(<BatchSpawnPanel isOpen={true} onClose={() => {}} />);
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      const calls = mockFetch.mock.calls as Array<[string]>;
      const spawnCall = calls.find(([u]) => typeof u === 'string' && u.endsWith('/batch/spawn'));
      expect(spawnCall).toBeDefined();
    });
  });

  it('Ctrl+L 加载示例', () => {
    render(<BatchSpawnPanel isOpen={true} onClose={() => {}} />);
    const csvInput = screen.getByTestId('batch-spawn-csv-input') as HTMLTextAreaElement;
    fireEvent.change(csvInput, { target: { value: '' } });
    fireEvent.keyDown(document.body, { key: 'l', ctrlKey: true });
    expect(csvInput.value.length).toBeGreaterThan(0);
  });

  it('? 切换帮助', () => {
    render(<BatchSpawnPanel isOpen={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('batch-spawn-help-btn'));
    expect(screen.getByText(/快捷键/)).toBeTruthy();
  });

  it('localStorage 持久化配置', () => {
    render(<BatchSpawnPanel isOpen={true} onClose={() => {}} />);
    const csvInput = screen.getByTestId('batch-spawn-csv-input') as HTMLTextAreaElement;
    fireEvent.change(csvInput, { target: { value: 'task\ncustom' } });
    const stored = JSON.parse(localStorage.getItem('hermes.batchSpawnPanel.cfg') || '{}');
    expect(stored.csv).toBe('task\ncustom');
  });
});
