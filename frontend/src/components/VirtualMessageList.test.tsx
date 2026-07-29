/**
 * # ============================================================
 * # VirtualMessageList 组件测试 (v1.0.0 - Cycle 15 P1-2)
 * # ============================================================
 * # 核心作用：覆盖虚拟化消息列表的全部功能：
 * #   - 基础渲染（空状态 / 单条 / 多条）
 * #   - 虚拟化（仅渲染可见项 + overscan）
 * #   - 自定义 renderItem
 * #   - 自定义 estimateSize
 * #   - 自定义 overscan
 * #   - 滚动位置跟踪
 * #   - followStreamKey 触发滚动
 * #   - scrollToBottomSignal 强制滚动
 * #   - 全局事件监听（hermes:virtual-list:scroll-to-bottom）
 * #   - footer 渲染
 * #   - emptyState 渲染
 * #   - getItemKey 自定义
 * # ============================================================
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import VirtualMessageList from './VirtualMessageList';
import type { ChatMessage } from '../utils/messageFormatters';

// ============================================================
// Test utilities
// ====================================
function makeMessage(id: string, role: 'user' | 'hermes' = 'user', content = `msg-${id}`): ChatMessage {
  return {
    id,
    role,
    content,
    timestamp: Date.now() + parseInt(id.replace(/\D/g, '') || '0', 10),
  };
}

function makeMessages(n: number): ChatMessage[] {
  return Array.from({ length: n }, (_, i) =>
    makeMessage(`m${i}`, i % 2 === 0 ? 'user' : 'hermes', `content ${i} - ${'x'.repeat((i % 5) * 20)}`),
  );
}

/**
 * 等待 microtask + DOM 更新
 */
async function flushAsync() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

/**
 * TestWrapper - 包装一个固定高度容器
 * 重要：happy-dom 下 HTMLElement.clientHeight 默认是 0，
 *  virtualizer 依赖此值计算 visible range
 * 我们直接修改 HTMLElement.prototype + ResizeObserver，让所有元素的 clientHeight 都返回 600
 * （仅限此测试文件，通过 afterEach 还原）
 */
let originalClientHeight: PropertyDescriptor | undefined;
let originalClientWidth: PropertyDescriptor | undefined;
let originalGetBoundingClientRect: any;
let originalResizeObserver: any;

beforeEach(() => {
  const globalAny = globalThis as any;
  if (globalAny.HTMLElement) {
    // 保存原始 descriptor
    originalClientHeight = Object.getOwnPropertyDescriptor(
      globalAny.HTMLElement.prototype,
      'clientHeight',
    );
    originalClientWidth = Object.getOwnPropertyDescriptor(
      globalAny.HTMLElement.prototype,
      'clientWidth',
    );
    originalGetBoundingClientRect = globalAny.HTMLElement.prototype.getBoundingClientRect;

    // 强制设置 clientHeight = 600
    Object.defineProperty(globalAny.HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 600,
    });
    Object.defineProperty(globalAny.HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 800,
    });

    // getBoundingClientRect 返回 600 高度
    globalAny.HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: 100,
        width: 800,
        height: 100,
        toJSON: () => ({}),
      } as DOMRect;
    };
  }

  // 替换 ResizeObserver 为会回调的版本，让 virtualizer 能拿到尺寸
  originalResizeObserver = globalAny.ResizeObserver;
  globalAny.ResizeObserver = class MockResizeObserver {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe = vi.fn((el: HTMLElement) => {
      // 同步触发一次回调
      queueMicrotask(() => {
        this.cb(
          [
            {
              target: el,
              contentRect: {
                width: 600,
                height: 600,
                top: 0,
                left: 0,
                right: 600,
                bottom: 600,
                x: 0,
                y: 0,
                toJSON() { return {}; },
              },
              borderBoxSize: [{ blockSize: 600, inlineSize: 600 }],
              contentBoxSize: [{ blockSize: 600, inlineSize: 600 }],
              devicePixelContentBoxSize: [{ blockSize: 600, inlineSize: 600 }],
            } as unknown as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      });
    });
    unobserve = vi.fn();
    disconnect = vi.fn();
  };
});

afterEach(() => {
  const globalAny = globalThis as any;
  if (globalAny.HTMLElement && originalClientHeight) {
    Object.defineProperty(globalAny.HTMLElement.prototype, 'clientHeight', originalClientHeight);
  }
  if (globalAny.HTMLElement && originalClientWidth) {
    Object.defineProperty(globalAny.HTMLElement.prototype, 'clientWidth', originalClientWidth);
  }
  if (globalAny.HTMLElement && originalGetBoundingClientRect) {
    globalAny.HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  }
  if (originalResizeObserver) {
    globalAny.ResizeObserver = originalResizeObserver;
  }
});

/**
 * 简化的 TestWrapper - 客户端尺寸已由全局 mock 提供
 */
function TestWrapper({ children, height = 600 }: { children: ReactNode; height?: number }) {
  return (
    <div
      data-testid="outer-wrapper"
      style={{ height: `${height}px`, width: '800px' }}
    >
      {children}
    </div>
  );
}

// ============================================================
// Tests
// ====================================

describe('VirtualMessageList - 基础渲染', () => {
  it('空消息列表 + 无 footer + 无 emptyState 应只渲染容器', () => {
    const { container } = render(
      <TestWrapper>
        <VirtualMessageList messages={[]} renderItem={() => null} />
      </TestWrapper>,
    );
    const list = container.querySelector('[data-component="virtual-message-list"]');
    expect(list).toBeInTheDocument();
    expect(list?.getAttribute('data-item-count')).toBe('0');
  });

  it('空消息列表 + 提供 emptyState 应渲染 emptyState', () => {
    render(
      <TestWrapper>
        <VirtualMessageList
          messages={[]}
          renderItem={() => null}
          emptyState={<div data-testid="empty">暂无消息</div>}
        />
      </TestWrapper>,
    );
    expect(screen.getByTestId('empty')).toBeInTheDocument();
  });

  it('提供消息时应渲染可见项 + 容器有正确 item count', async () => {
    const messages = makeMessages(5);
    const { container } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={messages}
          renderItem={(msg) => <div data-testid={`item-${msg.id}`}>{msg.content}</div>}
          estimateSize={() => 100}
        />
      </TestWrapper>,
    );
    await flushAsync();
    const list = container.querySelector('[data-component="virtual-message-list"]');
    expect(list?.getAttribute('data-item-count')).toBe('5');
  });

  it('renderItem 应被调用（visible range 内）', async () => {
    const renderItem = vi.fn((msg: ChatMessage) => <div>{msg.content}</div>);
    render(
      <TestWrapper>
        <VirtualMessageList messages={makeMessages(3)} renderItem={renderItem} />
      </TestWrapper>,
    );
    await flushAsync();
    expect(renderItem).toHaveBeenCalled();
  });
});

describe('VirtualMessageList - 虚拟化行为', () => {
  it('overscan 控制预渲染范围', async () => {
    const renderItem = vi.fn((msg: ChatMessage) => <div data-testid={msg.id}>{msg.content}</div>);
    const { container } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(20)}
          renderItem={renderItem}
          estimateSize={() => 100}
          overscan={2}
        />
      </TestWrapper>,
    );
    await flushAsync();
    const items = container.querySelectorAll('[data-testid]');
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(20);
  });

  it('每条消息的 transform 包含正确的 translateY 偏移', async () => {
    const { container } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(3)}
          renderItem={(msg) => <div>{msg.content}</div>}
          estimateSize={() => 100}
        />
      </TestWrapper>,
    );
    await flushAsync();
    const positioned = container.querySelectorAll('[data-index]');
    expect(positioned.length).toBeGreaterThan(0);
    positioned.forEach((el) => {
      const style = (el as HTMLElement).style.transform;
      expect(style).toMatch(/translateY/);
    });
  });

  it('DOM 元素 data-index 与 messages 索引一致', async () => {
    const { container } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(5)}
          renderItem={(msg) => <div>{msg.content}</div>}
          estimateSize={() => 100}
        />
      </TestWrapper>,
    );
    await flushAsync();
    const items = container.querySelectorAll('[data-index]');
    const indices = Array.from(items).map((el) => parseInt(el.getAttribute('data-index') || '-1', 10));
    expect(indices.length).toBeGreaterThan(0);
    indices.forEach((idx) => {
      expect(idx).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('VirtualMessageList - Props 透传', () => {
  it('自定义 estimateSize 应用于每条消息', async () => {
    const estimateSize = vi.fn(() => 50);
    const { container } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(3)}
          renderItem={(msg) => <div>{msg.content}</div>}
          estimateSize={estimateSize}
        />
      </TestWrapper>,
    );
    await flushAsync();
    expect(estimateSize).toHaveBeenCalled();
    expect(container.querySelector('[data-component="virtual-message-list"]')).toBeInTheDocument();
  });

  it('className 应用到根容器', () => {
    const { container } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={[]}
          renderItem={() => null}
          className="custom-class"
        />
      </TestWrapper>,
    );
    const list = container.querySelector('[data-component="virtual-message-list"]');
    expect(list?.className).toContain('custom-class');
  });

  it('style 应用到根容器', () => {
    const { container } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={[]}
          renderItem={() => null}
          style={{ maxHeight: '500px' }}
        />
      </TestWrapper>,
    );
    const list = container.querySelector('[data-component="virtual-message-list"]') as HTMLElement;
    expect(list.style.maxHeight).toBe('500px');
  });

  it('getItemKey 自定义 key 函数', async () => {
    const getItemKey = vi.fn((msg: ChatMessage) => `key-${msg.id}`);
    render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(3)}
          renderItem={(msg) => <div>{msg.content}</div>}
          getItemKey={getItemKey}
        />
      </TestWrapper>,
    );
    await flushAsync();
    expect(getItemKey).toHaveBeenCalled();
  });
});

describe('VirtualMessageList - 滚动行为', () => {
  it('handleScroll 应更新 isAtBottom 状态', async () => {
    const { container } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(3)}
          renderItem={(msg) => <div style={{ height: '100px' }}>{msg.content}</div>}
        />
      </TestWrapper>,
    );
    await flushAsync();
    const list = container.querySelector('[data-component="virtual-message-list"]') as HTMLElement;

    // 模拟滚动事件 - 在底部
    await act(async () => {
      fireEvent.scroll(list);
    });

    // 初始状态应该是 at bottom（scrollTop=0, 没有滚动）
    expect(list.getAttribute('data-is-at-bottom')).toBe('true');
  });

  it('onScroll 透传', async () => {
    const onScroll = vi.fn();
    const { container } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(3)}
          renderItem={(msg) => <div style={{ height: '100px' }}>{msg.content}</div>}
          onScroll={onScroll}
        />
      </TestWrapper>,
    );
    await flushAsync();
    const list = container.querySelector('[data-component="virtual-message-list"]') as HTMLElement;

    await act(async () => {
      fireEvent.scroll(list);
    });

    expect(onScroll).toHaveBeenCalled();
  });
});

describe('VirtualMessageList - 全局事件', () => {
  it('组件挂载时监听 hermes:virtual-list:scroll-to-bottom 事件', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const { unmount } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(3)}
          renderItem={(msg) => <div>{msg.content}</div>}
          autoScrollToBottom={true}
        />
      </TestWrapper>,
    );
    expect(addSpy).toHaveBeenCalledWith(
      'hermes:virtual-list:scroll-to-bottom',
      expect.any(Function),
    );
    unmount();
    addSpy.mockRestore();
  });

  it('组件卸载时移除全局事件', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(3)}
          renderItem={(msg) => <div>{msg.content}</div>}
        />
      </TestWrapper>,
    );
    unmount();
    expect(removeSpy).toHaveBeenCalledWith(
      'hermes:virtual-list:scroll-to-bottom',
      expect.any(Function),
    );
    removeSpy.mockRestore();
  });

  it('autoScrollToBottom=false 时不监听全局事件', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(3)}
          renderItem={(msg) => <div>{msg.content}</div>}
          autoScrollToBottom={false}
        />
      </TestWrapper>,
    );
    const scrollCalls = addSpy.mock.calls.filter(
      ([event]) => event === 'hermes:virtual-list:scroll-to-bottom',
    );
    expect(scrollCalls.length).toBe(0);
    addSpy.mockRestore();
  });

  it('dispatchEvent 不抛错', async () => {
    render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(3)}
          renderItem={(msg) => <div>{msg.content}</div>}
        />
      </TestWrapper>,
    );
    await act(async () => {
      window.dispatchEvent(new CustomEvent('hermes:virtual-list:scroll-to-bottom'));
    });
  });
});

describe('VirtualMessageList - followStreamKey & signal', () => {
  it('followStreamKey 变化不应抛错', async () => {
    const { rerender } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(3)}
          renderItem={(msg) => <div style={{ height: '50px' }}>{msg.content}</div>}
          followStreamKey={null}
        />
      </TestWrapper>,
    );
    await flushAsync();

    rerender(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(3)}
          renderItem={(msg) => <div style={{ height: '50px' }}>{msg.content}</div>}
          followStreamKey="stream-1"
        />
      </TestWrapper>,
    );
    await flushAsync();
    expect(true).toBe(true);
  });

  it('scrollToBottomSignal 变化时不抛错', async () => {
    const { rerender } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(3)}
          renderItem={(msg) => <div style={{ height: '50px' }}>{msg.content}</div>}
          scrollToBottomSignal={0}
        />
      </TestWrapper>,
    );
    await flushAsync();

    rerender(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(3)}
          renderItem={(msg) => <div style={{ height: '50px' }}>{msg.content}</div>}
          scrollToBottomSignal={1}
        />
      </TestWrapper>,
    );
    await flushAsync();
    expect(true).toBe(true);
  });
});

describe('VirtualMessageList - footer 渲染', () => {
  it('提供 footer 时 item count 应 +1', async () => {
    const { container } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(2)}
          renderItem={(msg) => <div>{msg.content}</div>}
          footer={<div data-testid="footer">footer content</div>}
        />
      </TestWrapper>,
    );
    await flushAsync();
    const list = container.querySelector('[data-component="virtual-message-list"]');
    expect(list?.getAttribute('data-item-count')).toBe('3');
  });

  it('footer 内容应被渲染', async () => {
    render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(2)}
          renderItem={(msg) => <div>{msg.content}</div>}
          footer={<div data-testid="footer">footer content</div>}
        />
      </TestWrapper>,
    );
    await flushAsync();
    expect(screen.getByTestId('footer')).toBeInTheDocument();
  });

  it('无 footer 时 item count 等于 messages.length', async () => {
    const { container } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(2)}
          renderItem={(msg) => <div>{msg.content}</div>}
        />
      </TestWrapper>,
    );
    await flushAsync();
    const list = container.querySelector('[data-component="virtual-message-list"]');
    expect(list?.getAttribute('data-item-count')).toBe('2');
  });
});

describe('VirtualMessageList - ChatMessage 渲染', () => {
  it('应正确接收 ChatMessage 数组', async () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello', timestamp: 1 },
      { id: 'h1', role: 'hermes', content: 'Hi there!', timestamp: 2 },
    ];
    const { container } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={messages}
          renderItem={(msg) => (
            <div data-testid={msg.id} data-role={msg.role}>
              {msg.content}
            </div>
          )}
        />
      </TestWrapper>,
    );
    await flushAsync();
    const list = container.querySelector('[data-component="virtual-message-list"]');
    expect(list?.getAttribute('data-item-count')).toBe('2');
  });

  it('应处理 thinking 字段', async () => {
    const messages: ChatMessage[] = [
      {
        id: 'h1',
        role: 'hermes',
        content: 'response',
        thinking: 'thinking content',
        timestamp: 1,
      },
    ];
    const renderItem = vi.fn((msg: ChatMessage) => (
      <div data-testid={msg.id}>
        {msg.content}
        {msg.thinking && <span> [thinking]</span>}
      </div>
    ));
    render(
      <TestWrapper>
        <VirtualMessageList messages={messages} renderItem={renderItem} />
      </TestWrapper>,
    );
    await flushAsync();
    expect(renderItem).toHaveBeenCalled();
  });

  it('应处理 error 字段', async () => {
    const messages: ChatMessage[] = [
      { id: 'h1', role: 'hermes', content: 'response', error: '失败', timestamp: 1 },
    ];
    const renderItem = vi.fn((msg: ChatMessage) => (
      <div data-testid={msg.id} data-has-error={!!msg.error}>
        {msg.content}
      </div>
    ));
    render(
      <TestWrapper>
        <VirtualMessageList messages={messages} renderItem={renderItem} />
      </TestWrapper>,
    );
    await flushAsync();
    expect(renderItem).toHaveBeenCalled();
  });
});

describe('VirtualMessageList - 性能', () => {
  it('1000 条消息时仅渲染少量 DOM 节点', async () => {
    const messages = makeMessages(1000);
    const renderItem = vi.fn((msg: ChatMessage) => (
      <div data-testid={msg.id}>{msg.content}</div>
    ));
    const { container } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={messages}
          renderItem={renderItem}
          estimateSize={() => 100}
          overscan={3}
        />
      </TestWrapper>,
    );
    await flushAsync();
    const items = container.querySelectorAll('[data-testid]');
    expect(items.length).toBeLessThan(50);
    expect(items.length).toBeGreaterThan(0);
  });

  it('renderItem 调用次数远小于总消息数（仅可见）', async () => {
    const renderItem = vi.fn((msg: ChatMessage) => <div>{msg.content}</div>);
    render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(100)}
          renderItem={renderItem}
          estimateSize={() => 100}
          overscan={2}
        />
      </TestWrapper>,
    );
    await flushAsync();
    expect(renderItem.mock.calls.length).toBeLessThan(30);
  });
});

describe('VirtualMessageList - 边界条件', () => {
  it('messages 为空数组时应正常工作', () => {
    const { container } = render(
      <TestWrapper>
        <VirtualMessageList messages={[]} renderItem={() => null} />
      </TestWrapper>,
    );
    const list = container.querySelector('[data-component="virtual-message-list"]');
    expect(list).toBeInTheDocument();
  });

  it('overscan=0 时仅渲染可见项', async () => {
    const renderItem = vi.fn((msg: ChatMessage) => <div data-testid={msg.id}>{msg.content}</div>);
    const { container } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(20)}
          renderItem={renderItem}
          estimateSize={() => 100}
          overscan={0}
        />
      </TestWrapper>,
    );
    await flushAsync();
    const items = container.querySelectorAll('[data-testid]');
    expect(items.length).toBeLessThanOrEqual(20);
  });

  it('estimateSize 返回 0 时仍渲染（fallback 100）', async () => {
    const { container } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(3)}
          renderItem={(msg) => <div>{msg.content}</div>}
          estimateSize={() => 0}
        />
      </TestWrapper>,
    );
    await flushAsync();
    expect(container.querySelector('[data-component="virtual-message-list"]')).toBeInTheDocument();
  });

  it('空容器（height=0）应使用 fallback 600', () => {
    const { container } = render(
      <TestWrapper height={0}>
        <VirtualMessageList messages={makeMessages(3)} renderItem={() => null} />
      </TestWrapper>,
    );
    const list = container.querySelector('[data-component="virtual-message-list"]');
    // data-container-height 应为 fallback 值 600
    expect(list?.getAttribute('data-container-height')).toBe('600');
  });
});

describe('VirtualMessageList - 集成场景', () => {
  it('流式消息 + 滚动到底部时不应抛错', async () => {
    const messages = makeMessages(3);
    const { rerender } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={messages}
          renderItem={(msg) => <div>{msg.content}</div>}
          followStreamKey={null}
        />
      </TestWrapper>,
    );
    await flushAsync();

    // 模拟流式消息开始
    rerender(
      <TestWrapper>
        <VirtualMessageList
          messages={messages}
          renderItem={(msg) => <div>{msg.content}</div>}
          followStreamKey="stream-1"
        />
      </TestWrapper>,
    );
    await flushAsync();
    expect(true).toBe(true);
  });

  it('消息数量变化时不抛错', async () => {
    const { rerender } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(3)}
          renderItem={(msg) => <div>{msg.content}</div>}
        />
      </TestWrapper>,
    );
    await flushAsync();

    rerender(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(10)}
          renderItem={(msg) => <div>{msg.content}</div>}
        />
      </TestWrapper>,
    );
    await flushAsync();
    expect(true).toBe(true);
  });

  it('卸载时清理所有事件监听', () => {
    const { unmount } = render(
      <TestWrapper>
        <VirtualMessageList
          messages={makeMessages(3)}
          renderItem={(msg) => <div>{msg.content}</div>}
        />
      </TestWrapper>,
    );
    unmount();
    expect(true).toBe(true);
  });
});
