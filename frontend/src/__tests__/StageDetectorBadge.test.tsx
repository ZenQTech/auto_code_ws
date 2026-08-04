/**
 * # ============================================================
 * # StageDetectorBadge 组件单元测试
 * # Cycle 63 G63-03
 * # ====================================
 */

/// <reference types="vitest" />

// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StageDetectorBadge } from '../components/StageDetectorBadge';

import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { expect as vitestExpect } from 'vitest';
(vitestExpect as any).extend(jestDomMatchers);

const originalFetch = globalThis.fetch;

const mockState = {
  session_id: 'sess-1',
  stage: 'coding' as const,
  substage: null,
  confidence: 0.85,
  auto_follow: true,
  entered_at: 1700000000,
  source: 'rule' as const,
  reason: 'detected coding keywords',
};

describe('StageDetectorBadge', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, state: mockState }),
    }) as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('compact 模式显示当前阶段徽章', async () => {
    render(<StageDetectorBadge sessionId="sess-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-badge')).toBeInTheDocument();
    });
    expect(screen.getByTestId('stage-detector-badge')).toHaveTextContent('编码');
  });

  it('显示置信度百分比', async () => {
    render(<StageDetectorBadge sessionId="sess-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-badge-confidence')).toBeInTheDocument();
    });
    expect(screen.getByTestId('stage-detector-badge-confidence').textContent).toBe('85%');
  });

  it('点击徽章展开详情面板', async () => {
    render(<StageDetectorBadge sessionId="sess-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-badge')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('stage-detector-badge'));
    expect(screen.getByTestId('stage-detector-badge-panel')).toBeInTheDocument();
  });

  it('详情面板显示 Auto-Follow 开关', async () => {
    render(<StageDetectorBadge sessionId="sess-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-badge')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('stage-detector-badge'));
    expect(screen.getByTestId('stage-detector-badge-panel-autofollow')).toBeInTheDocument();
    expect(
      screen.getByTestId('stage-detector-badge-panel-autofollow-toggle'),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('详情面板显示 6 个阶段切换按钮', async () => {
    render(<StageDetectorBadge sessionId="sess-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-badge')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('stage-detector-badge'));
    const stages = ['idle', 'prd', 'coding', 'preview', 'deploy', 'done'];
    stages.forEach((s) => {
      expect(
        screen.getByTestId(`stage-detector-badge-panel-stage-${s}`),
      ).toBeInTheDocument();
    });
  });

  it('点击 idle 按钮调用 forceStage', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, state: { ...mockState, stage: 'idle', source: 'manual' } }),
    });
    globalThis.fetch = fetchMock as typeof fetch;
    render(<StageDetectorBadge sessionId="sess-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-badge')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('stage-detector-badge'));
    fireEvent.click(screen.getByTestId('stage-detector-badge-panel-stage-idle'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/force'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('触发 onStageChange 回调', async () => {
    const onChange = vi.fn();
    render(<StageDetectorBadge sessionId="sess-1" onStageChange={onChange} />);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    expect(onChange.mock.calls.some((c) => c[0] === 'coding')).toBe(true);
  });

  it('触发 onAutoFollowChange 回调', async () => {
    const onAuto = vi.fn();
    render(<StageDetectorBadge sessionId="sess-1" onAutoFollowChange={onAuto} />);
    await waitFor(() => {
      expect(onAuto).toHaveBeenCalledWith(true);
    });
  });

  it('显示连接状态指示器', async () => {
    render(<StageDetectorBadge sessionId="sess-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-badge')).toBeInTheDocument();
    });
    // 紧凑模式下徽章有连接状态点
    const badge = screen.getByTestId('stage-detector-badge');
    expect(badge.querySelector('[aria-label]')).toBeTruthy();
  });

  it('无网络时显示错误', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connection failed')) as typeof fetch;
    render(<StageDetectorBadge sessionId="sess-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-badge')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('stage-detector-badge'));
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-badge-panel-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('stage-detector-badge-panel-error').textContent).toContain(
      'connection failed',
    );
  });

  it('显示初始空闲状态（无数据时）', () => {
    globalThis.fetch = vi.fn().mockImplementation(
      () =>
        new Promise(() => {
          /* 永不解析 */
        }),
    ) as typeof fetch;
    render(<StageDetectorBadge sessionId="sess-1" />);
    // 初始渲染时 state 仍为 null
    const badge = screen.getByTestId('stage-detector-badge');
    expect(badge.textContent).toContain('空闲');
  });
});


/**
 * # ============================================================
 * # StageDetectorBadge v2.0.0 新增功能测试
 * # Cycle 64 G64-03
 * # ====================================
 */

describe('StageDetectorBadge v2.0.0 - 新功能', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, state: mockState }),
    }) as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('详情面板显示阶段停留时长', async () => {
    render(<StageDetectorBadge sessionId="sess-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-badge')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('stage-detector-badge'));
    // 详情面板应包含 duration 元素
    expect(screen.getByTestId('stage-detector-badge-panel-duration')).toBeInTheDocument();
    // 包含时间格式
    const dur = screen.getByTestId('stage-detector-badge-panel-duration').textContent;
    expect(dur).toMatch(/[smh]/);
  });

  it('Esc 键关闭展开的面板', async () => {
    render(<StageDetectorBadge sessionId="sess-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-badge')).toBeInTheDocument();
    });
    // 展开
    fireEvent.click(screen.getByTestId('stage-detector-badge'));
    expect(screen.getByTestId('stage-detector-badge-panel')).toBeInTheDocument();
    // Esc 关闭
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('stage-detector-badge-panel')).not.toBeInTheDocument();
    });
  });

  it('点击背景遮罩关闭面板', async () => {
    const { container } = render(<StageDetectorBadge sessionId="sess-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-badge')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('stage-detector-badge'));
    expect(screen.getByTestId('stage-detector-badge-panel')).toBeInTheDocument();
    // 找到遮罩元素
    const overlay = container.querySelector('.fixed.inset-0');
    expect(overlay).toBeTruthy();
    if (overlay) {
      fireEvent.click(overlay);
    }
    await waitFor(() => {
      expect(screen.queryByTestId('stage-detector-badge-panel')).not.toBeInTheDocument();
    });
  });

  it('手动阶段按钮高亮当前阶段', async () => {
    render(<StageDetectorBadge sessionId="sess-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-badge')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('stage-detector-badge'));
    const codingBtn = screen.getByTestId('stage-detector-badge-panel-stage-coding');
    // 当前阶段（coding）应有 active 类（font-semibold）
    expect(codingBtn.className).toContain('font-semibold');
  });

  it('阶段切换按钮调用 forceStage API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, state: { ...mockState, stage: 'preview' } }),
    });
    globalThis.fetch = fetchMock as typeof fetch;
    render(<StageDetectorBadge sessionId="sess-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-badge')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('stage-detector-badge'));
    fireEvent.click(screen.getByTestId('stage-detector-badge-panel-stage-preview'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/force'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('close 按钮关闭面板', async () => {
    render(<StageDetectorBadge sessionId="sess-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-badge')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('stage-detector-badge'));
    expect(screen.getByTestId('stage-detector-badge-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('stage-detector-badge-panel-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('stage-detector-badge-panel')).not.toBeInTheDocument();
    });
  });
});
