/**
 * # ============================================================
 * ClaudeCLIStage 组件单元测试
 * Cycle 61 G61-01-T8
 * # ====================================
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ClaudeCLIStage from '../components/ClaudeCLIStage';
import type { UseClaudeCLIResult } from '../hooks/useClaudeCLI';

function createMockClaude(overrides: Partial<UseClaudeCLIResult> = {}): UseClaudeCLIResult {
  return {
    isRunning: false,
    isAvailable: true,
    sandboxStatus: { docker: false, none: true },
    mode: 'subprocess',
    output: '',
    thinking: '',
    toolCalls: [],
    errors: [],
    events: [],
    processId: null,
    state: 'idle',
    invoke: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
    refreshHealth: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('ClaudeCLIStage - 基础渲染', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应渲染 prompt 输入框', () => {
    const claude = createMockClaude();
    render(<ClaudeCLIStage claude={claude} />);
    expect(screen.getByTestId('claude-cli-stage-prompt')).toBeInTheDocument();
  });

  it('应渲染 invoke 按钮', () => {
    const claude = createMockClaude();
    render(<ClaudeCLIStage claude={claude} />);
    expect(screen.getByTestId('claude-cli-stage-invoke')).toBeInTheDocument();
  });

  it('应渲染 cancel 按钮', () => {
    const claude = createMockClaude();
    render(<ClaudeCLIStage claude={claude} />);
    expect(screen.getByTestId('claude-cli-stage-cancel')).toBeInTheDocument();
  });

  it('应渲染 clear 按钮', () => {
    const claude = createMockClaude();
    render(<ClaudeCLIStage claude={claude} />);
    expect(screen.getByTestId('claude-cli-stage-clear')).toBeInTheDocument();
  });

  it('应显示 mode', () => {
    const claude = createMockClaude({ mode: 'subprocess' });
    render(<ClaudeCLIStage claude={claude} />);
    expect(screen.getByText(/mode: subprocess/)).toBeInTheDocument();
  });

  it('应显示 state', () => {
    const claude = createMockClaude({ state: 'running' });
    render(<ClaudeCLIStage claude={claude} />);
    expect(screen.getByText(/state: running/)).toBeInTheDocument();
  });
});

describe('ClaudeCLIStage - invoke 交互', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('点击 invoke 应调用 claude.invoke', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const claude = createMockClaude({ invoke });
    render(<ClaudeCLIStage claude={claude} />);
    const prompt = screen.getByTestId('claude-cli-stage-prompt') as HTMLTextAreaElement;
    fireEvent.change(prompt, { target: { value: 'test prompt' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('claude-cli-stage-invoke'));
    });

    expect(invoke).toHaveBeenCalled();
    const callArgs = invoke.mock.calls[0][0];
    expect(callArgs.prompt).toBe('test prompt');
  });

  it('空 prompt 时 invoke 按钮应禁用', () => {
    const claude = createMockClaude();
    render(<ClaudeCLIStage claude={claude} />);
    const btn = screen.getByTestId('claude-cli-stage-invoke') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('运行中时 invoke 按钮应禁用', () => {
    const claude = createMockClaude({ isRunning: true });
    render(<ClaudeCLIStage claude={claude} />);
    const btn = screen.getByTestId('claude-cli-stage-invoke') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('运行中时 cancel 按钮应启用', () => {
    const claude = createMockClaude({ isRunning: true });
    render(<ClaudeCLIStage claude={claude} />);
    const btn = screen.getByTestId('claude-cli-stage-cancel') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});

describe('ClaudeCLIStage - clear 交互', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('点击 clear 应调用 claude.clear', () => {
    const clear = vi.fn();
    const claude = createMockClaude({ clear });
    render(<ClaudeCLIStage claude={claude} />);
    fireEvent.click(screen.getByTestId('claude-cli-stage-clear'));
    expect(clear).toHaveBeenCalled();
  });
});

describe('ClaudeCLIStage - 状态显示', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应显示 thinking 区域当有内容', () => {
    const claude = createMockClaude({ thinking: 'I am thinking...' });
    render(<ClaudeCLIStage claude={claude} />);
    expect(screen.getByTestId('claude-cli-stage-thinking')).toBeInTheDocument();
    expect(screen.getByText('I am thinking...')).toBeInTheDocument();
  });

  it('应显示工具调用区域当有内容', () => {
    const claude = createMockClaude({
      toolCalls: [
        { id: 't1', type: 'cli_tool_call', timestamp: Date.now(), content: 'read_file' },
      ],
    });
    render(<ClaudeCLIStage claude={claude} />);
    expect(screen.getByTestId('claude-cli-stage-tools')).toBeInTheDocument();
  });

  it('应显示错误区域当有错误', () => {
    const claude = createMockClaude({ errors: ['Test error 1', 'Test error 2'] });
    render(<ClaudeCLIStage claude={claude} />);
    const errs = screen.getByTestId('claude-cli-stage-errors');
    expect(errs).toBeInTheDocument();
    expect(screen.getByText('Test error 1')).toBeInTheDocument();
    expect(screen.getByText('Test error 2')).toBeInTheDocument();
  });

  it('应显示 processId 当有时', () => {
    const claude = createMockClaude({ processId: 'cli-abcdef1234567890' });
    render(<ClaudeCLIStage claude={claude} />);
    // The text "pid: cli-abcdef..." is split across multiple text nodes
    expect(screen.getByText((content) => content.includes('pid: cli-abcdef'))).toBeInTheDocument();
  });
});

describe('ClaudeCLIStage - 沙箱指示器', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('应显示每个沙箱的状态', () => {
    const claude = createMockClaude({
      sandboxStatus: { docker: true, gvisor: false, firejail: true, none: true },
    });
    render(<ClaudeCLIStage claude={claude} />);
    expect(screen.getByTestId('claude-cli-stage-sandbox-docker')).toBeInTheDocument();
    expect(screen.getByTestId('claude-cli-stage-sandbox-gvisor')).toBeInTheDocument();
    expect(screen.getByTestId('claude-cli-stage-sandbox-firejail')).toBeInTheDocument();
    expect(screen.getByTestId('claude-cli-stage-sandbox-none')).toBeInTheDocument();
  });
});
