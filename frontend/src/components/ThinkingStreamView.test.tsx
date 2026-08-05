/**
 * # ============================================================
 * # ThinkingStreamView 组件测试
 * # Cycle 67 G67-01
 * # ====================================
 */

// @vitest-environment happy-dom

import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThinkingStreamView } from './ThinkingStreamView';

// ============================================================
// Mock useThinkingStream
// ====================================

const mockHookReturn = {
  steps: [] as any[],
  currentStep: null as any,
  isStreaming: false,
  totalSteps: 0,
  totalTokens: 0,
  totalDurationMs: 0,
  stats: null,
  loading: false,
  error: null as string | null,
  connected: false,
  refresh: vi.fn().mockResolvedValue(undefined),
  refreshStats: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
  exportThinking: vi.fn().mockResolvedValue(''),
  reconnect: vi.fn(),
  clearError: vi.fn(),
};

vi.mock('../hooks/useThinkingStream', () => ({
  useThinkingStream: () => mockHookReturn,
}));

// ============================================================
// Setup
// ====================================

beforeEach(() => {
  Object.assign(mockHookReturn, {
    steps: [],
    currentStep: null,
    isStreaming: false,
    totalSteps: 0,
    totalTokens: 0,
    totalDurationMs: 0,
    stats: null,
    loading: false,
    error: null,
    connected: false,
  });
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ============================================================
// 基础渲染
// ====================================

describe('ThinkingStreamView', () => {
  it('渲染面板标题', () => {
    render(<ThinkingStreamView sessionId="s1" />);
    expect(screen.getByText('思考流')).toBeTruthy();
  });

  it('无数据时显示空状态', () => {
    render(<ThinkingStreamView sessionId="s1" />);
    expect(screen.getByTestId('thinking-empty-state')).toBeTruthy();
  });

  it('显示统计信息（0 状态）', () => {
    render(<ThinkingStreamView sessionId="s1" />);
    expect(screen.getByTestId('thinking-total-steps').textContent).toBe('0');
    expect(screen.getByTestId('thinking-total-tokens').textContent).toBe('0');
    expect(screen.getByTestId('thinking-total-duration').textContent).toBe('0ms');
  });

  it('加载中显示 loading 文本', () => {
    mockHookReturn.loading = true;
    render(<ThinkingStreamView sessionId="s1" />);
    expect(screen.getByText('加载中...')).toBeTruthy();
  });

  it('错误时显示错误横幅', () => {
    mockHookReturn.error = '网络错误';
    render(<ThinkingStreamView sessionId="s1" />);
    expect(screen.getByTestId('thinking-error-banner')).toBeTruthy();
    expect(screen.getByText(/网络错误/)).toBeTruthy();
  });
});

// ============================================================
// 当前 step
// ====================================

describe('ThinkingStreamView - current step', () => {
  it('有 current step 时显示当前卡片', () => {
    mockHookReturn.currentStep = {
      step_id: 'think-1',
      session_id: 's1',
      agent_id: 'a1',
      step_index: 0,
      content: '正在分析问题...',
      started_at: 1000,
      ended_at: null,
      status: 'running',
      summary: '',
      model: 'claude-opus',
      tokens: 5,
      duration_ms: 0,
      metadata: {},
    };
    mockHookReturn.isStreaming = true;
    render(<ThinkingStreamView sessionId="s1" />);
    expect(screen.getByTestId('thinking-current-card')).toBeTruthy();
    expect(screen.getByText(/正在分析问题/)).toBeTruthy();
    expect(screen.getByTestId('thinking-streaming-badge')).toBeTruthy();
  });

  it('isStreaming 时显示进行中徽章', () => {
    mockHookReturn.isStreaming = true;
    render(<ThinkingStreamView sessionId="s1" />);
    expect(screen.getByTestId('thinking-streaming-badge')).toBeTruthy();
  });
});

// ============================================================
// 历史 step
// ====================================

describe('ThinkingStreamView - history', () => {
  beforeEach(() => {
    mockHookReturn.steps = [
      {
        step_id: 'think-1',
        session_id: 's1',
        agent_id: 'a1',
        step_index: 1,
        content: 'plan B content',
        started_at: 1000,
        ended_at: 1002,
        status: 'completed',
        summary: 'plan B',
        model: 'claude-opus',
        tokens: 50,
        duration_ms: 2000,
        metadata: {},
      },
      {
        step_id: 'think-0',
        session_id: 's1',
        agent_id: 'a1',
        step_index: 0,
        content: 'analyze content',
        started_at: 1000,
        ended_at: 1001,
        status: 'completed',
        summary: 'analysis',
        model: 'claude-opus',
        tokens: 30,
        duration_ms: 1000,
        metadata: {},
      },
    ];
    mockHookReturn.totalSteps = 2;
    mockHookReturn.totalTokens = 80;
    mockHookReturn.totalDurationMs = 3000;
  });

  it('显示历史步骤数量', () => {
    render(<ThinkingStreamView sessionId="s1" />);
    expect(screen.getByText(/历史步骤 \(2\)/)).toBeTruthy();
  });

  it('显示累计统计', () => {
    render(<ThinkingStreamView sessionId="s1" />);
    expect(screen.getByTestId('thinking-total-steps').textContent).toBe('2');
    expect(screen.getByTestId('thinking-total-tokens').textContent).toBe('80');
  });

  it('渲染历史 step 列表', () => {
    render(<ThinkingStreamView sessionId="s1" />);
    const items = screen.getAllByTestId('thinking-history-item');
    expect(items.length).toBe(2);
  });

  it('点击历史 step 展开内容', () => {
    render(<ThinkingStreamView sessionId="s1" />);
    const buttons = screen.getAllByRole('button', { expanded: false });
    fireEvent.click(buttons[0]);
    // 展开后存在 thinking-history-content
    expect(screen.getAllByTestId('thinking-history-content').length).toBeGreaterThan(0);
  });

  it('点击 history toggle 折叠/展开历史', () => {
    render(<ThinkingStreamView sessionId="s1" />);
    const toggle = screen.getByTestId('thinking-history-toggle');
    // 初始为展开
    expect(screen.getAllByTestId('thinking-history-item').length).toBe(2);
    fireEvent.click(toggle);
    // 折叠后无列表
    expect(screen.queryAllByTestId('thinking-history-item').length).toBe(0);
  });

  it('maxVisible 限制显示数量', () => {
    render(<ThinkingStreamView sessionId="s1" maxVisible={1} />);
    const items = screen.getAllByTestId('thinking-history-item');
    expect(items.length).toBe(1);
  });
});

// ============================================================
// 操作按钮
// ====================================

describe('ThinkingStreamView - buttons', () => {
  it('点击刷新按钮调用 refresh', () => {
    render(<ThinkingStreamView sessionId="s1" />);
    fireEvent.click(screen.getByTestId('thinking-refresh-btn'));
    expect(mockHookReturn.refresh).toHaveBeenCalled();
  });

  it('点击重连按钮调用 reconnect', () => {
    render(<ThinkingStreamView sessionId="s1" />);
    fireEvent.click(screen.getByTestId('thinking-reconnect-btn'));
    expect(mockHookReturn.reconnect).toHaveBeenCalled();
  });

  it('点击导出按钮调用 exportThinking', async () => {
    mockHookReturn.exportThinking.mockResolvedValue('# Test');
    // mock window.confirm
    const origConfirm = window.confirm;
    window.confirm = vi.fn(() => true);

    render(<ThinkingStreamView sessionId="s1" />);
    fireEvent.click(screen.getByTestId('thinking-export-btn'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(mockHookReturn.exportThinking).toHaveBeenCalled();

    window.confirm = origConfirm;
  });

  it('点击清空按钮调用 clear（带确认）', async () => {
    const origConfirm = window.confirm;
    window.confirm = vi.fn(() => true);

    render(<ThinkingStreamView sessionId="s1" />);
    fireEvent.click(screen.getByTestId('thinking-clear-btn'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(mockHookReturn.clear).toHaveBeenCalled();

    window.confirm = origConfirm;
  });
});

// ============================================================
// 连接状态
// ====================================

describe('ThinkingStreamView - connection', () => {
  it('connected=true 时显示绿色指示器', () => {
    mockHookReturn.connected = true;
    render(<ThinkingStreamView sessionId="s1" />);
    const indicator = screen.getByTestId('thinking-connection-indicator');
    expect(indicator.className).toContain('bg-green-500');
  });

  it('connected=false 时显示灰色指示器', () => {
    mockHookReturn.connected = false;
    render(<ThinkingStreamView sessionId="s1" />);
    const indicator = screen.getByTestId('thinking-connection-indicator');
    expect(indicator.className).toContain('bg-gray-400');
  });
});
