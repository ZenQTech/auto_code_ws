/**
 * # ============================================================
 * # StageDetectorView 组件单元测试
 * # Cycle 63 G63-03
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
// @vitest-environment happy-dom
import { StageDetectorView } from '../components/StageDetectorView';

const originalFetch = globalThis.fetch;

const mockState = {
  session_id: 'sess-1',
  stage: 'prd' as const,
  substage: null,
  confidence: 0.75,
  auto_follow: true,
  entered_at: 1700000000,
  source: 'rule' as const,
  reason: 'detected PRD keywords',
};

describe('StageDetectorView', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, state: mockState }),
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('显示当前阶段', async () => {
    render(<StageDetectorView sessionId="sess-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-view-label')).toHaveTextContent('需求分析');
    });
  });

  it('显示置信度', async () => {
    render(<StageDetectorView sessionId="sess-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-view-confidence')).toHaveTextContent('75%');
    });
  });

  it('显示 6 个阶段按钮', () => {
    render(<StageDetectorView sessionId="sess-1" />);
    const stages = ['idle', 'prd', 'coding', 'preview', 'deploy', 'done'];
    stages.forEach((s) => {
      expect(screen.getByTestId(`stage-detector-view-stage-${s}`)).toBeInTheDocument();
    });
  });

  it('点击 coding 按钮调用 forceStage', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        state: { ...mockState, stage: 'coding', source: 'manual' },
      }),
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const onTabSwitch = vi.fn();
    render(<StageDetectorView sessionId="sess-1" onTabSwitch={onTabSwitch} />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-view-label')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('stage-detector-view-stage-coding'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/force'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('点击 coding 触发 onTabSwitch(editor)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        state: { ...mockState, stage: 'coding', source: 'manual' },
      }),
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const onTabSwitch = vi.fn();
    render(<StageDetectorView sessionId="sess-1" onTabSwitch={onTabSwitch} />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-view-label')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('stage-detector-view-stage-coding'));
    await waitFor(() => {
      expect(onTabSwitch).toHaveBeenCalledWith('editor');
    });
  });

  it('Auto-Follow toggle 切换状态', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        state: { ...mockState, auto_follow: false },
      }),
    });
    globalThis.fetch = fetchMock as typeof fetch;
    render(<StageDetectorView sessionId="sess-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-detector-view-autofollow-toggle')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('stage-detector-view-autofollow-toggle'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/auto-follow'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('文本检测输入框可用', () => {
    render(<StageDetectorView sessionId="sess-1" />);
    const input = screen.getByTestId('stage-detector-view-detect-input');
    fireEvent.change(input, { target: { value: 'function foo() {}' } });
    expect(input).toHaveValue('function foo() {}');
  });

  it('规则检测按钮在输入非空时启用', async () => {
    render(<StageDetectorView sessionId="sess-1" />);
    const input = screen.getByTestId('stage-detector-view-detect-input');
    const btn = screen.getByTestId('stage-detector-view-detect-btn');
    expect(btn).toBeDisabled();
    fireEvent.change(input, { target: { value: 'let me write function' } });
    expect(btn).not.toBeDisabled();
  });

  it('使用默认 sessionId 时调用 API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, state: mockState }),
    });
    globalThis.fetch = fetchMock as typeof fetch;
    render(<StageDetectorView />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });
});
