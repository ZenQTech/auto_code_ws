/**
 * # ============================================================
 * Undo/Redo Stack（v6.34.0 P1-6 新增）
 * # ============================================================
 * 核心作用：通用撤销/重做栈，支持任意可序列化状态
 * 设计原则：
 *   - 不可变状态（每次 push 创建新对象）
 *   - 支持配置最大深度
 *   - 支持合并连续操作（coalesce）如连续输入
 *   - 订阅模式（subscribe/unsubscribe）便于 React 集成
 *   - 可序列化（toJSON/fromJSON）便于持久化
 * 使用场景：
 *   - 编辑器撤销/重做
 *   - 表单修改回退
 *   - 消息编辑恢复
 * ============================================================
 */

export interface UndoRedoEntry<T> {
  /** 状态快照 */
  state: T;
  /** 操作描述（用于 UI 展示） */
  label: string;
  /** 时间戳 */
  timestamp: number;
  /** 唯一 ID */
  id: string;
}

export interface UndoRedoOptions {
  /** 最大历史深度（默认 50） */
  maxDepth?: number;
  /** 初始 label（用于首次 push） */
  initialLabel?: string;
}

let _entryIdCounter = 0;
const _genEntryId = (): string => {
  _entryIdCounter += 1;
  return `entry_${Date.now()}_${_entryIdCounter}`;
};

export class UndoRedoStack<T> {
  private stack: UndoRedoEntry<T>[] = [];
  private redoStack: UndoRedoEntry<T>[] = [];
  private cursor = -1; // 指向当前状态在 stack 中的位置
  private maxDepth: number;
  private subscribers = new Set<() => void>();
  private lastEntryTimestamp = 0;
  private readonly coalesceWindowMs = 500; // 500ms 内的连续操作合并

  constructor(options: UndoRedoOptions = {}) {
    this.maxDepth = options.maxDepth ?? 50;
  }

  /**
   * 推入新状态
   * @param state 新状态
   * @param label 操作标签
   * @param coalesceKey 可选 - 同一 key 在 coalesceWindowMs 内的操作会合并
   */
  push(state: T, label: string = 'change', coalesceKey?: string): void {
    const now = Date.now();
    const isCoalesce =
      coalesceKey !== undefined &&
      this.cursor >= 0 &&
      now - this.lastEntryTimestamp < this.coalesceWindowMs &&
      this.stack[this.cursor].label === label;

    if (isCoalesce) {
      // 合并：仅更新 state 和 timestamp
      this.stack[this.cursor] = {
        ...this.stack[this.cursor],
        state,
        timestamp: now,
      };
      // 清空 redo 栈（新操作后无法重做）
      this.redoStack = [];
      this.lastEntryTimestamp = now;
      this.notify();
      return;
    }

    // 截断 redo 栈
    this.redoStack = [];

    // 创建新 entry
    const entry: UndoRedoEntry<T> = {
      state,
      label,
      timestamp: now,
      id: _genEntryId(),
    };

    // 移除 cursor 之后的所有 entries
    if (this.cursor < this.stack.length - 1) {
      this.stack = this.stack.slice(0, this.cursor + 1);
    }

    this.stack.push(entry);
    this.cursor = this.stack.length - 1;
    this.lastEntryTimestamp = now;

    // 限制最大深度
    if (this.stack.length > this.maxDepth) {
      const overflow = this.stack.length - this.maxDepth;
      this.stack = this.stack.slice(overflow);
      this.cursor = this.stack.length - 1;
    }

    this.notify();
  }

  /**
   * 撤销一步
   * @returns 撤销后的新状态，undefined 表示无法撤销
   */
  undo(): T | undefined {
    if (this.cursor <= 0) return undefined;
    this.cursor -= 1;
    const entry = this.stack[this.cursor];
    if (entry) {
      // 移动到 redo 栈
      this.redoStack.push(this.stack[this.cursor + 1]);
    }
    this.notify();
    return entry?.state;
  }

  /**
   * 重做一步
   * @returns 重做后的新状态，undefined 表示无法重做
   */
  redo(): T | undefined {
    const next = this.redoStack.pop();
    if (!next) return undefined;
    this.cursor += 1;
    if (this.cursor < this.stack.length) {
      this.stack[this.cursor] = next;
    } else {
      this.stack.push(next);
    }
    this.notify();
    return next.state;
  }

  /**
   * 获取当前状态
   */
  getCurrent(): T | undefined {
    return this.stack[this.cursor]?.state;
  }

  /**
   * 获取当前状态的 label
   */
  getCurrentLabel(): string | undefined {
    return this.stack[this.cursor]?.label;
  }

  /**
   * 是否可以撤销
   */
  canUndo(): boolean {
    return this.cursor > 0;
  }

  /**
   * 是否可以重做
   */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * 获取历史长度
   */
  getDepth(): number {
    return this.stack.length;
  }

  /**
   * 获取当前位置（0-based）
   */
  getCursor(): number {
    return this.cursor;
  }

  /**
   * 获取完整历史
   */
  getHistory(): UndoRedoEntry<T>[] {
    return [...this.stack];
  }

  /**
   * 获取当前可撤销的 entries（不含当前）
   */
  getUndoableEntries(): UndoRedoEntry<T>[] {
    return this.stack.slice(0, this.cursor);
  }

  /**
   * 获取当前可重做的 entries
   */
  getRedoableEntries(): UndoRedoEntry<T>[] {
    return [...this.redoStack].reverse();
  }

  /**
   * 清空所有历史
   */
  clear(): void {
    this.stack = [];
    this.redoStack = [];
    this.cursor = -1;
    this.lastEntryTimestamp = 0;
    this.notify();
  }

  /**
   * 跳转到指定位置
   */
  jumpTo(index: number): T | undefined {
    if (index < 0 || index >= this.stack.length) return undefined;
    if (index === this.cursor) return this.getCurrent();
    if (index > this.cursor) {
      // 前进 - 将 cursor..index 之间的 entries 移到 redo
      const toRedo = this.stack.slice(this.cursor + 1, index + 1);
      this.redoStack = [...toRedo.reverse(), ...this.redoStack];
    } else {
      // 后退 - 将 index+1..cursor 之间的 entries 移到 redo
      const toRedo = this.stack.slice(index + 1, this.cursor + 1);
      this.redoStack = [...toRedo, ...this.redoStack];
    }
    this.cursor = index;
    this.notify();
    return this.stack[index].state;
  }

  /**
   * 订阅状态变化
   * @returns 取消订阅函数
   */
  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  private notify(): void {
    for (const fn of this.subscribers) {
      try {
        fn();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[UndoRedoStack] subscriber error:', err);
      }
    }
  }

  /**
   * 序列化为 JSON（持久化）
   */
  toJSON(): { stack: UndoRedoEntry<T>[]; redoStack: UndoRedoEntry<T>[]; cursor: number } {
    return {
      stack: [...this.stack],
      redoStack: [...this.redoStack],
      cursor: this.cursor,
    };
  }

  /**
   * 从 JSON 恢复
   */
  fromJSON(data: { stack: UndoRedoEntry<T>[]; redoStack: UndoRedoEntry<T>[]; cursor: number }): void {
    this.stack = data.stack ?? [];
    this.redoStack = data.redoStack ?? [];
    this.cursor = data.cursor ?? -1;
    this.lastEntryTimestamp = this.stack[this.cursor]?.timestamp ?? 0;
    this.notify();
  }
}

/**
 * 创建一个新 UndoRedoStack 实例
 */
export function createUndoRedoStack<T>(initialState?: T, options?: UndoRedoOptions): UndoRedoStack<T> {
  const stack = new UndoRedoStack<T>(options);
  if (initialState !== undefined) {
    stack.push(initialState, options?.initialLabel ?? 'initial');
  }
  return stack;
}
