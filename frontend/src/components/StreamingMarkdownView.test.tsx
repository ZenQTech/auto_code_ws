/**
 * # ============================================================
 * # StreamingMarkdownView 组件测试
 * # Cycle 67 G67-02
 * # ====================================
 */

// @vitest-environment happy-dom

import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamingMarkdownView } from './StreamingMarkdownView';

// ============================================================
// Mock useStreamingMarkdown
// ====================================

const mockHookReturn = {
  blocks: [] as any[],
  pendingContent: '',
  isStreaming: false,
  totalTokens: 0,
  totalBlocks: 0,
  error: null as string | null,
  connected: false,
  appendDelta: vi.fn(),
  endStream: vi.fn(),
  reset: vi.fn(),
  reconnect: vi.fn(),
};

vi.mock('../hooks/useStreamingMarkdown', () => ({
  useStreamingMarkdown: () => mockHookReturn,
}));

// ====================================
// Setup
// ====================================

beforeEach(() => {
  Object.assign(mockHookReturn, {
    blocks: [],
    pendingContent: '',
    isStreaming: false,
    totalTokens: 0,
    totalBlocks: 0,
    error: null,
    connected: false,
  });
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ====================================
// 基础渲染
// ====================================

describe('StreamingMarkdownView', () => {
  it('渲染组件', () => {
    render(<StreamingMarkdownView sessionId="s1" />);
    expect(screen.getByText('流式渲染')).toBeTruthy();
  });

  it('无内容时显示空状态', () => {
    render(<StreamingMarkdownView sessionId="s1" />);
    expect(screen.getByTestId('streaming-md-empty')).toBeTruthy();
  });

  it('显示进度信息', () => {
    render(<StreamingMarkdownView sessionId="s1" />);
    expect(screen.getByTestId('streaming-md-block-count').textContent).toBe('0');
    expect(screen.getByTestId('streaming-md-token-count').textContent).toBe('0');
  });

  it('错误时显示错误信息', () => {
    mockHookReturn.error = '网络错误';
    render(<StreamingMarkdownView sessionId="s1" />);
    expect(screen.getByTestId('streaming-md-error')).toBeTruthy();
    expect(screen.getByText(/网络错误/)).toBeTruthy();
  });
});

// ====================================
// Block 渲染
// ====================================

describe('StreamingMarkdownView - blocks', () => {
  it('渲染 paragraph block', () => {
    mockHookReturn.blocks = [
      {
        id: 'b1',
        type: 'paragraph',
        content: '这是段落内容',
        complete: true,
        tokens: 5,
        startedAt: 1000,
        endedAt: 1001,
      },
    ];
    render(<StreamingMarkdownView sessionId="s1" />);
    expect(screen.getByTestId('streaming-md-paragraph')).toBeTruthy();
  });

  it('渲染 heading block', () => {
    mockHookReturn.blocks = [
      {
        id: 'b1',
        type: 'heading',
        content: '标题',
        level: 1,
        complete: true,
        tokens: 1,
        startedAt: 1000,
        endedAt: 1001,
      },
    ];
    render(<StreamingMarkdownView sessionId="s1" />);
    const heading = screen.getByTestId('streaming-md-heading');
    expect(heading).toBeTruthy();
    expect(heading.getAttribute('data-level')).toBe('1');
    expect(heading.textContent).toBe('标题');
  });

  it('渲染 code block', () => {
    mockHookReturn.blocks = [
      {
        id: 'b1',
        type: 'code',
        content: 'print("hi")',
        language: 'python',
        complete: true,
        tokens: 3,
        startedAt: 1000,
        endedAt: 1001,
      },
    ];
    render(<StreamingMarkdownView sessionId="s1" />);
    const codeBlock = screen.getByTestId('streaming-md-code-block');
    expect(codeBlock).toBeTruthy();
    expect(codeBlock.getAttribute('data-language')).toBe('python');
  });

  it('渲染 list block', () => {
    mockHookReturn.blocks = [
      {
        id: 'b1',
        type: 'list',
        content: '- item1\n- item2',
        complete: true,
        tokens: 3,
        startedAt: 1000,
        endedAt: 1001,
      },
    ];
    render(<StreamingMarkdownView sessionId="s1" />);
    expect(screen.getByTestId('streaming-md-list')).toBeTruthy();
  });

  it('渲染 quote block', () => {
    mockHookReturn.blocks = [
      {
        id: 'b1',
        type: 'quote',
        content: '引用内容',
        complete: true,
        tokens: 2,
        startedAt: 1000,
        endedAt: 1001,
      },
    ];
    render(<StreamingMarkdownView sessionId="s1" />);
    expect(screen.getByTestId('streaming-md-quote')).toBeTruthy();
  });

  it('pending content 显示光标', () => {
    mockHookReturn.pendingContent = '正在输入...';
    render(<StreamingMarkdownView sessionId="s1" />);
    const pending = screen.getByTestId('streaming-md-pending');
    expect(pending).toBeTruthy();
    expect(pending.textContent).toContain('正在输入');
  });
});

// ====================================
// 状态显示
// ====================================

describe('StreamingMarkdownView - state', () => {
  it('isStreaming 时显示渲染中徽章', () => {
    mockHookReturn.isStreaming = true;
    render(<StreamingMarkdownView sessionId="s1" />);
    expect(screen.getByTestId('streaming-md-badge')).toBeTruthy();
  });

  it('connected=true 时绿色指示器', () => {
    mockHookReturn.connected = true;
    render(<StreamingMarkdownView sessionId="s1" />);
    const indicator = screen.getByTestId('streaming-md-connection');
    expect(indicator.className).toContain('bg-green-500');
  });

  it('connected=false 时灰色指示器', () => {
    mockHookReturn.connected = false;
    render(<StreamingMarkdownView sessionId="s1" />);
    const indicator = screen.getByTestId('streaming-md-connection');
    expect(indicator.className).toContain('bg-gray-400');
  });

  it('显示 tokens 累计', () => {
    mockHookReturn.totalTokens = 150;
    mockHookReturn.totalBlocks = 3;
    render(<StreamingMarkdownView sessionId="s1" />);
    expect(screen.getByTestId('streaming-md-token-count').textContent).toBe('150');
    expect(screen.getByTestId('streaming-md-block-count').textContent).toBe('3');
  });
});

// ====================================
// 操作按钮
// ====================================

describe('StreamingMarkdownView - buttons', () => {
  it('点击重连按钮调用 reconnect', () => {
    render(<StreamingMarkdownView sessionId="s1" />);
    fireEvent.click(screen.getByTestId('streaming-md-reconnect-btn'));
    expect(mockHookReturn.reconnect).toHaveBeenCalled();
  });

  it('点击清空按钮调用 reset（带确认）', () => {
    const origConfirm = window.confirm;
    window.confirm = vi.fn(() => true);

    render(<StreamingMarkdownView sessionId="s1" />);
    fireEvent.click(screen.getByTestId('streaming-md-reset-btn'));
    expect(mockHookReturn.reset).toHaveBeenCalled();

    window.confirm = origConfirm;
  });
});

// ====================================
// Block 回调
// ====================================

describe('StreamingMarkdownView - onBlockRender', () => {
  it('block 渲染时回调', () => {
    const onBlockRender = vi.fn();
    const block = {
      id: 'b1',
      type: 'paragraph',
      content: 'test',
      complete: true,
      tokens: 1,
      startedAt: 1000,
      endedAt: 1001,
    };
    mockHookReturn.blocks = [block];
    render(
      <StreamingMarkdownView
        sessionId="s1"
        onBlockRender={onBlockRender}
      />,
    );
    // BlockRenderer 内部 useEffect 触发
    expect(onBlockRender).toHaveBeenCalledWith(block);
  });
});
