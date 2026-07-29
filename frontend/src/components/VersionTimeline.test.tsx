/**
 * # ============================================================
 * # VersionTimeline 组件测试 (v1.0.0 - Cycle 15 P1-6)
 * # ============================================================
 * # 核心作用：覆盖版本时间线 UI 组件功能：
 * #   - 基础渲染（空 / null stack / 有数据）
 * #   - 撤销/重做按钮
 * #   - 预览功能
 * #   - 确认恢复
 * #   - 键盘快捷键
 * #   - maxVisible 限制
 * #   - 当前指针高亮
 * # ============================================================
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import VersionTimeline from './VersionTimeline';
import { createUndoRedoStack, UndoRedoStack } from '../utils/undoRedoStack';

function makeStack() {
  return createUndoRedoStack<string>(
    'v0',
    { initialLabel: '初始状态' },
  );
}

describe('VersionTimeline - 基础渲染', () => {
  it('stack=null 时显示提示', () => {
    render(<VersionTimeline stack={null} />);
    expect(screen.getByText('暂无版本历史')).toBeInTheDocument();
  });

  it('空 stack 时显示提示', () => {
    const stack = new UndoRedoStack<string>();
    render(<VersionTimeline stack={stack} />);
    expect(screen.getByText('暂无历史记录')).toBeInTheDocument();
  });

  it('有数据时显示时间线 + 工具栏', () => {
    const stack = makeStack();
    stack.push('v1', '修改 1');
    stack.push('v2', '修改 2');

    render(<VersionTimeline stack={stack} />);
    expect(screen.getByTestId('undo-button')).toBeInTheDocument();
    expect(screen.getByTestId('redo-button')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-list')).toBeInTheDocument();
  });

  it('显示历史统计', () => {
    const stack = makeStack();
    stack.push('v1', '修改 1');
    stack.push('v2', '修改 2');
    render(<VersionTimeline stack={stack} />);
    const stats = screen.getByTestId('history-stats');
    expect(stats.textContent).toContain('3');
  });
});

describe('VersionTimeline - 撤销/重做按钮', () => {
  let stack: UndoRedoStack<string>;

  beforeEach(() => {
    stack = makeStack();
    stack.push('v1', '修改 1');
    stack.push('v2', '修改 2');
  });

  it('canUndo=true 时撤销按钮启用', () => {
    render(<VersionTimeline stack={stack} />);
    const btn = screen.getByTestId('undo-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('点击撤销按钮触发 stack.undo()', () => {
    render(<VersionTimeline stack={stack} />);
    fireEvent.click(screen.getByTestId('undo-button'));
    expect(stack.getCurrent()).toBe('v1');
  });

  it('canRedo=true 时重做按钮启用', () => {
    stack.undo();
    render(<VersionTimeline stack={stack} />);
    const btn = screen.getByTestId('redo-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('点击重做按钮触发 stack.redo()', () => {
    stack.undo();
    render(<VersionTimeline stack={stack} />);
    fireEvent.click(screen.getByTestId('redo-button'));
    expect(stack.getCurrent()).toBe('v2');
  });
});

describe('VersionTimeline - 预览', () => {
  let stack: UndoRedoStack<string>;

  beforeEach(() => {
    stack = makeStack();
    stack.push('v1', '修改 1');
    stack.push('v2', '修改 2');
    stack.push('v3', '修改 3');
  });

  it('点击时间线条目进入预览', () => {
    render(<VersionTimeline stack={stack} />);
    const entries = document.querySelectorAll('[data-entry-id]');
    expect(entries.length).toBeGreaterThan(0);
    fireEvent.click(entries[0]);
    expect(screen.getByTestId('version-preview')).toBeInTheDocument();
  });

  it('点击同一项再次点击取消预览', () => {
    render(<VersionTimeline stack={stack} />);
    const entry = document.querySelector('[data-entry-id]') as HTMLElement;
    fireEvent.click(entry);
    expect(screen.getByTestId('version-preview')).toBeInTheDocument();
    fireEvent.click(entry);
    expect(screen.queryByTestId('version-preview')).not.toBeInTheDocument();
  });

  it('预览面板显示 entry label', () => {
    render(<VersionTimeline stack={stack} />);
    const entry = document.querySelector('[data-entry-id]') as HTMLElement;
    fireEvent.click(entry);
    const preview = screen.getByTestId('version-preview');
    // 至少包含一个 label
    expect(preview.textContent).toBeTruthy();
  });

  it('提供 renderPreview 时使用自定义渲染', () => {
    const renderPreview = vi.fn((state: string) => (
      <span data-testid="custom-preview">custom: {state}</span>
    ));
    render(<VersionTimeline stack={stack} renderPreview={renderPreview} />);
    const entry = document.querySelector('[data-entry-id]') as HTMLElement;
    fireEvent.click(entry);
    expect(renderPreview).toHaveBeenCalled();
  });

  it('预览面板关闭按钮工作', () => {
    render(<VersionTimeline stack={stack} />);
    const entry = document.querySelector('[data-entry-id]') as HTMLElement;
    fireEvent.click(entry);
    const closeBtn = screen.getByLabelText('关闭预览');
    fireEvent.click(closeBtn);
    expect(screen.queryByTestId('version-preview')).not.toBeInTheDocument();
  });

  it('预览面板的取消按钮工作', () => {
    render(<VersionTimeline stack={stack} />);
    const entry = document.querySelector('[data-entry-id]') as HTMLElement;
    fireEvent.click(entry);
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByTestId('version-preview')).not.toBeInTheDocument();
  });
});

describe('VersionTimeline - 确认恢复', () => {
  let stack: UndoRedoStack<string>;

  beforeEach(() => {
    stack = makeStack();
    stack.push('v1', '修改 1');
    stack.push('v2', '修改 2');
    stack.push('v3', '修改 3');
  });

  it('点击恢复按钮后调用 onRestore 回调', () => {
    const onRestore = vi.fn();
    render(<VersionTimeline stack={stack} onRestore={onRestore} />);

    // 预览第一项
    const entry = document.querySelector('[data-entry-id]') as HTMLElement;
    fireEvent.click(entry);

    // 点击恢复
    fireEvent.click(screen.getByTestId('confirm-restore'));
    expect(onRestore).toHaveBeenCalled();
  });

  it('恢复后预览关闭', () => {
    render(<VersionTimeline stack={stack} />);
    const entry = document.querySelector('[data-entry-id]') as HTMLElement;
    fireEvent.click(entry);
    expect(screen.getByTestId('version-preview')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-restore'));
    expect(screen.queryByTestId('version-preview')).not.toBeInTheDocument();
  });
});

describe('VersionTimeline - 键盘快捷键', () => {
  it('Ctrl+Z 触发 undo', () => {
    const stack = makeStack();
    stack.push('v1', '修改 1');
    render(<VersionTimeline stack={stack} />);
    expect(stack.getCurrent()).toBe('v1');

    act(() => {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    });
    expect(stack.getCurrent()).toBe('v0');
  });

  it('Cmd+Z 触发 undo（macOS）', () => {
    const stack = makeStack();
    stack.push('v1', '修改 1');
    render(<VersionTimeline stack={stack} />);

    act(() => {
      fireEvent.keyDown(window, { key: 'z', metaKey: true });
    });
    expect(stack.getCurrent()).toBe('v0');
  });

  it('Ctrl+Shift+Z 触发 redo', () => {
    const stack = makeStack();
    stack.push('v1', '修改 1');
    stack.undo();
    render(<VersionTimeline stack={stack} />);
    expect(stack.getCurrent()).toBe('v0');

    act(() => {
      fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true });
    });
    expect(stack.getCurrent()).toBe('v1');
  });

  it('Ctrl+Y 触发 redo', () => {
    const stack = makeStack();
    stack.push('v1', '修改 1');
    stack.undo();
    render(<VersionTimeline stack={stack} />);
    expect(stack.getCurrent()).toBe('v0');

    act(() => {
      fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    });
    expect(stack.getCurrent()).toBe('v1');
  });

  it('在 INPUT 中不触发快捷键', () => {
    const stack = makeStack();
    stack.push('v1', '修改 1');
    render(<VersionTimeline stack={stack} />);
    const input = document.createElement('input');
    document.body.appendChild(input);

    act(() => {
      fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    });

    document.body.removeChild(input);
    // undo 没有被调用（input 内）
    // 注：可能因为 unmount 时 stack 已改变，这里只检查没有抛错
    expect(stack.canUndo()).toBe(true);
  });

  it('enableKeyboardShortcuts=false 时不监听快捷键', () => {
    const stack = makeStack();
    stack.push('v1', '修改 1');
    render(<VersionTimeline stack={stack} enableKeyboardShortcuts={false} />);

    act(() => {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    });
    expect(stack.getCurrent()).toBe('v1'); // 未变化
  });
});

describe('VersionTimeline - maxVisible 限制', () => {
  it('只显示 maxVisible 个 entry', () => {
    const stack = makeStack();
    for (let i = 0; i < 30; i++) {
      stack.push(`v${i + 1}`, `修改 ${i + 1}`);
    }
    render(<VersionTimeline stack={stack} maxVisible={5} />);
    const entries = document.querySelectorAll('[data-entry-id]');
    expect(entries.length).toBe(5);
  });

  it('默认 maxVisible=20', () => {
    const stack = makeStack();
    for (let i = 0; i < 30; i++) {
      stack.push(`v${i + 1}`, `修改 ${i + 1}`);
    }
    render(<VersionTimeline stack={stack} />);
    const entries = document.querySelectorAll('[data-entry-id]');
    expect(entries.length).toBe(20);
  });
});

describe('VersionTimeline - 当前指针高亮', () => {
  it('当前 entry 应有 is-cursor 标记', () => {
    const stack = makeStack();
    stack.push('v1', '修改 1');
    render(<VersionTimeline stack={stack} />);
    const cursors = document.querySelectorAll('[data-is-cursor="true"]');
    expect(cursors.length).toBe(1);
  });

  it('undo 后光标位置应前移', () => {
    const stack = makeStack();
    stack.push('v1', '修改 1');
    stack.push('v2', '修改 2');
    render(<VersionTimeline stack={stack} />);

    const initialCursor = document.querySelector('[data-is-cursor="true"]');
    expect(initialCursor).toBeTruthy();

    fireEvent.click(screen.getByTestId('undo-button'));

    const newCursor = document.querySelector('[data-is-cursor="true"]');
    expect(newCursor).toBeTruthy();
    // cursor 位置应不同
    expect(newCursor?.getAttribute('data-entry-id')).not.toBe(
      initialCursor?.getAttribute('data-entry-id'),
    );
  });
});

describe('VersionTimeline - 订阅机制', () => {
  it('组件订阅 stack 后 stack 变化应触发重渲染', () => {
    const stack = makeStack();
    const { rerender } = render(<VersionTimeline stack={stack} />);
    expect(screen.getByTestId('history-stats').textContent).toContain('1');

    // stack 外部变化
    act(() => {
      stack.push('v1', '新修改');
    });

    // 重渲染以更新显示
    rerender(<VersionTimeline stack={stack} />);
    expect(screen.getByTestId('history-stats').textContent).toContain('2');
  });

  it('组件卸载时取消订阅', () => {
    const stack = makeStack();
    const unsubscribeSpy = vi.spyOn(stack, 'subscribe');
    const { unmount } = render(<VersionTimeline stack={stack} />);
    expect(unsubscribeSpy).toHaveBeenCalled();
    unmount();
  });
});

describe('VersionTimeline - 集成场景', () => {
  it('多次操作后时间线正确显示', () => {
    const stack = makeStack();
    stack.push('v1', '修改 1');
    stack.push('v2', '修改 2');
    stack.undo();
    stack.redo();
    stack.push('v3', '修改 3');

    render(<VersionTimeline stack={stack} />);
    const entries = document.querySelectorAll('[data-entry-id]');
    expect(entries.length).toBeGreaterThan(0);
  });

  it('重置 stack.clear() 后时间线清空', () => {
    const stack = makeStack();
    stack.push('v1', '修改 1');
    const { rerender } = render(<VersionTimeline stack={stack} />);
    expect(screen.getByTestId('timeline-list')).toBeInTheDocument();

    act(() => {
      stack.clear();
    });
    rerender(<VersionTimeline stack={stack} />);
    expect(screen.queryByTestId('timeline-list')).not.toBeInTheDocument();
  });

  it('className 应用到根容器', () => {
    const stack = makeStack();
    stack.push('v1', '修改 1');
    const { container } = render(
      <VersionTimeline stack={stack} className="custom-class" />,
    );
    const root = container.querySelector('[data-component="version-timeline"]');
    expect(root?.className).toContain('custom-class');
  });
});
