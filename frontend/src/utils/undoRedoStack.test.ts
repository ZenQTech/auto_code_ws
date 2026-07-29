/**
 * # ============================================================
 * UndoRedoStack 单元测试（Cycle 15 P1-6）
 * # ============================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { UndoRedoStack, createUndoRedoStack } from './undoRedoStack';

describe('UndoRedoStack 基础', () => {
  it('初始为空', () => {
    const s = new UndoRedoStack<number>();
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
    expect(s.getCurrent()).toBeUndefined();
  });

  it('push 后 getCurrent 返回最新', () => {
    const s = new UndoRedoStack<number>();
    s.push(1, 'init');
    expect(s.getCurrent()).toBe(1);
    s.push(2, 'change');
    expect(s.getCurrent()).toBe(2);
  });

  it('undo 后回到上一状态', () => {
    const s = new UndoRedoStack<number>();
    s.push(1, 'init');
    s.push(2, 'change');
    expect(s.undo()).toBe(1);
    expect(s.getCurrent()).toBe(1);
  });

  it('无法 undo 时返回 undefined', () => {
    const s = new UndoRedoStack<number>();
    s.push(1, 'init');
    expect(s.undo()).toBeUndefined();
  });

  it('redo 后回到下一状态', () => {
    const s = new UndoRedoStack<number>();
    s.push(1, 'init');
    s.push(2, 'change');
    s.undo();
    expect(s.redo()).toBe(2);
    expect(s.getCurrent()).toBe(2);
  });

  it('无法 redo 时返回 undefined', () => {
    const s = new UndoRedoStack<number>();
    s.push(1, 'init');
    expect(s.redo()).toBeUndefined();
  });

  it('undo 后新 push 会清空 redo 栈', () => {
    const s = new UndoRedoStack<number>();
    s.push(1, 'init');
    s.push(2, 'a');
    s.push(3, 'b');
    s.undo(); // 回到 2
    s.undo(); // 回到 1
    expect(s.canRedo()).toBe(true);
    s.push(99, 'new'); // 清空 redo
    expect(s.canRedo()).toBe(false);
    expect(s.getCurrent()).toBe(99);
  });

  it('maxDepth 限制', () => {
    const s = new UndoRedoStack<number>({ maxDepth: 3 });
    s.push(1, '1');
    s.push(2, '2');
    s.push(3, '3');
    s.push(4, '4');
    s.push(5, '5');
    expect(s.getDepth()).toBe(3);
    expect(s.getCurrent()).toBe(5);
  });
});

describe('UndoRedoStack 合并操作', () => {
  it('coalesceKey 相同时合并', async () => {
    const s = new UndoRedoStack<number>();
    s.push(1, 'init');
    // 100ms 后连续 push
    s.push(2, 'typing', 'text');
    await new Promise((r) => setTimeout(r, 50));
    s.push(3, 'typing', 'text');
    await new Promise((r) => setTimeout(r, 50));
    s.push(4, 'typing', 'text');
    // 合并后应该只有 1 条 entry（最新值）
    expect(s.getDepth()).toBe(2); // init + 合并后的 typing
    expect(s.getCurrent()).toBe(4);
  });

  it('coalesceKey 不同时不合并', () => {
    const s = new UndoRedoStack<number>();
    s.push(1, 'init');
    s.push(2, 'a', 'key1');
    s.push(3, 'b', 'key2');
    expect(s.getDepth()).toBe(3);
  });

  it('coalesce 合并后 undo 一步回到 init', () => {
    const s = new UndoRedoStack<number>();
    s.push(1, 'init');
    s.push(2, 'typing', 'text');
    s.push(3, 'typing', 'text');
    expect(s.undo()).toBe(1);
  });
});

describe('UndoRedoStack jumpTo', () => {
  it('jumpTo 中间位置', () => {
    const s = new UndoRedoStack<number>();
    s.push(1, 'a');
    s.push(2, 'b');
    s.push(3, 'c');
    s.push(4, 'd');
    expect(s.jumpTo(1)).toBe(2);
    expect(s.getCurrent()).toBe(2);
  });

  it('jumpTo 越界返回 undefined', () => {
    const s = new UndoRedoStack<number>();
    s.push(1, 'a');
    expect(s.jumpTo(99)).toBeUndefined();
  });
});

describe('UndoRedoStack 订阅', () => {
  it('subscribe 接收通知', () => {
    const s = new UndoRedoStack<number>();
    const cb = vi.fn();
    s.subscribe(cb);
    s.push(1, 'init');
    expect(cb).toHaveBeenCalledTimes(1);
    s.push(2, 'change');
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe 取消订阅', () => {
    const s = new UndoRedoStack<number>();
    const cb = vi.fn();
    const unsub = s.subscribe(cb);
    s.push(1, 'init');
    unsub();
    s.push(2, 'change');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('订阅者抛错不影响其他订阅者', () => {
    const s = new UndoRedoStack<number>();
    const errCb = vi.fn(() => { throw new Error('boom'); });
    const goodCb = vi.fn();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    s.subscribe(errCb);
    s.subscribe(goodCb);
    s.push(1, 'init');
    expect(errCb).toHaveBeenCalled();
    expect(goodCb).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('UndoRedoStack 序列化', () => {
  it('toJSON + fromJSON 恢复', () => {
    const s1 = new UndoRedoStack<string>();
    s1.push('a', '1');
    s1.push('b', '2');
    s1.push('c', '3');
    const json = s1.toJSON();
    const s2 = new UndoRedoStack<string>();
    s2.fromJSON(json);
    expect(s2.getCurrent()).toBe('c');
    expect(s2.getDepth()).toBe(3);
  });
});

describe('createUndoRedoStack 工厂函数', () => {
  it('使用初始状态创建', () => {
    const s = createUndoRedoStack<number>(10, { initialLabel: 'start' });
    expect(s.getCurrent()).toBe(10);
    expect(s.getCurrentLabel()).toBe('start');
  });

  it('无初始状态', () => {
    const s = createUndoRedoStack<number>();
    expect(s.getCurrent()).toBeUndefined();
  });
});

describe('UndoRedoStack getHistory/Entries', () => {
  it('getHistory 返回所有 entries', () => {
    const s = new UndoRedoStack<number>();
    s.push(1, 'a');
    s.push(2, 'b');
    s.push(3, 'c');
    expect(s.getHistory()).toHaveLength(3);
  });

  it('getUndoableEntries 不含当前', () => {
    const s = new UndoRedoStack<number>();
    s.push(1, 'a');
    s.push(2, 'b');
    s.push(3, 'c');
    expect(s.getUndoableEntries()).toHaveLength(2);
  });

  it('getRedoableEntries 反映 redo 栈', () => {
    const s = new UndoRedoStack<number>();
    s.push(1, 'a');
    s.push(2, 'b');
    s.push(3, 'c');
    s.undo();
    s.undo();
    expect(s.getRedoableEntries()).toHaveLength(2);
  });
});

describe('UndoRedoStack clear', () => {
  it('清空所有历史', () => {
    const s = new UndoRedoStack<number>();
    s.push(1, 'a');
    s.push(2, 'b');
    s.clear();
    expect(s.getDepth()).toBe(0);
    expect(s.getCurrent()).toBeUndefined();
  });
});
