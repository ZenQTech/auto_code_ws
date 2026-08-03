/**
 * # ============================================================
 * SessionHistorySidebar.test.tsx - 会话历史侧边栏单元测试
 * Cycle 60 G60-3.1
 * # ============================================================
 * 核心作用：验证侧边栏拉取 + 渲染 + 切换逻辑
 * ====================================
 * 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 60 G60-3.1 初次创建
 * #   - 2026-08-03 | v1.1.0 | G60-FIX-9 新增 2 个测试：setInterval 定时拉取 + 卸载清理
 * ====================================
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import { SessionHistorySidebar } from './SessionHistorySidebar';

// mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

const mockSession = {
  id: 'vibe-test-123',
  prompt: '创建一个 React TODO 应用',
  model: 'claude-sonnet-4',
  createdAt: '2026-08-03T10:00:00Z',
  updatedAt: '2026-08-03T10:01:00Z',
  state: 'done' as const,
  steps: [
    { id: 's1', name: '澄清', status: 'completed' },
    { id: 's2', name: 'Plan', status: 'completed' },
  ],
  metrics: { tokens: 100, duration: 60, filesChanged: 0 },
};

describe('SessionHistorySidebar 组件', () => {
  const mockVibeCoding = {
    session: null,
    state: 'idle' as const,
    isLoading: false,
    error: null,
    startSession: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    clearSession: vi.fn(),
    resumeSession: vi.fn(),
    retryStep: vi.fn(),
    completedSteps: [],
  };

  beforeEach(() => {
    localStorage.clear();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('G60-3.1-SHS-01: 挂载时拉取 /api/vibe-coding/sessions', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ sessions: [mockSession] }),
    });

    render(<SessionHistorySidebar vibeCoding={mockVibeCoding as any} />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/vibe-coding/sessions');
    });
  });

  test('G60-3.1-SHS-02: 拉取成功后渲染 session 列表', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ sessions: [mockSession] }),
    });

    render(<SessionHistorySidebar vibeCoding={mockVibeCoding as any} />);
    await waitFor(() => {
      expect(screen.getByTestId(`history-item-${mockSession.id}`)).toBeDefined();
    });
  });

  test('G60-3.1-SHS-03: 404 时显示空状态', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    });

    render(<SessionHistorySidebar vibeCoding={mockVibeCoding as any} />);
    await waitFor(() => {
      expect(screen.getByTestId('session-history-empty')).toBeDefined();
    });
  });

  test('G60-3.1-SHS-04: 点击 item 触发 resumeSession', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ sessions: [mockSession] }),
    });

    const resumeSession = vi.fn();
    render(
      <SessionHistorySidebar
        vibeCoding={{ ...mockVibeCoding, resumeSession } as any}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId(`history-item-${mockSession.id}`)).toBeDefined();
    });
    fireEvent.click(screen.getByTestId(`history-item-${mockSession.id}`));
    expect(resumeSession).toHaveBeenCalledWith(mockSession.id);
  });

  test('G60-3.1-SHS-05: 新建按钮触发 clearSession', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ sessions: [] }),
    });

    const clearSession = vi.fn();
    render(
      <SessionHistorySidebar
        vibeCoding={{ ...mockVibeCoding, clearSession } as any}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('session-new-btn')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('session-new-btn'));
    expect(clearSession).toHaveBeenCalled();
  });

  test('G60-3.1-SHS-06: 当前 active session 高亮', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ sessions: [mockSession] }),
    });

    render(
      <SessionHistorySidebar
        vibeCoding={{ ...mockVibeCoding, session: mockSession } as any}
      />,
    );
    await waitFor(() => {
      const btn = screen.getByTestId(`history-item-${mockSession.id}`);
      expect(btn.getAttribute('aria-current')).toBe('true');
      expect(btn.className).toContain('bg-hermes-500/15');
    });
  });

  /**
   * G60-FIX-9: 验证 setInterval 轮询机制
   * - 挂载后默认每 refreshInterval 拉取一次
   * - 卸载后定时器被清理
   */
  test('G60-FIX-9-SHS-07: setInterval 定时拉取（短间隔验证）', async () => {
    // 多次 mock 响应：组件会反复调用
    mockFetch.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ sessions: [mockSession] }),
    }));

    render(
      <SessionHistorySidebar
        vibeCoding={mockVibeCoding as any}
        refreshInterval={50}
      />,
    );

    // 初始挂载：等待组件触发首次 fetch
    await new Promise((resolve) => setTimeout(resolve, 100));
    const initialCount = mockFetch.mock.calls.length;
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // 等待 ~150ms：定时器应触发多次
    await new Promise((resolve) => setTimeout(resolve, 180));
    const finalCount = mockFetch.mock.calls.length;
    expect(finalCount).toBeGreaterThan(initialCount);
  }, 5000);

  test('G60-FIX-9-SHS-08: 卸载后定时器被清理（无额外拉取）', async () => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ sessions: [mockSession] }),
    }));

    const { unmount } = render(
      <SessionHistorySidebar
        vibeCoding={mockVibeCoding as any}
        refreshInterval={50}
      />,
    );

    // 等待初始挂载
    await new Promise((resolve) => setTimeout(resolve, 100));
    const beforeUnmount = mockFetch.mock.calls.length;
    expect(beforeUnmount).toBeGreaterThan(0);

    unmount();

    // 等待 ~200ms：卸载后不应再调用
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(mockFetch.mock.calls.length).toBe(beforeUnmount);
  }, 5000);
});
