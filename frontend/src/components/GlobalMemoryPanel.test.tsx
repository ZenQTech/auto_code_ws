/**
 * # ============================================================
 * # GlobalMemoryPanel 组件测试 (Cycle 24 G24-01)
 * # ============================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GlobalMemoryPanel } from './GlobalMemoryPanel';
import { resetGlobalMemoryEngine, getGlobalMemoryEngine } from '../utils/globalMemory';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
  get length() { return this.store.size; }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
}

beforeEach(() => {
  if (typeof globalThis.localStorage !== 'undefined') {
    try {
      (globalThis.localStorage as Storage).clear();
    } catch {
      // ignore
    }
  } else {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      writable: true,
      configurable: true,
    });
  }
  resetGlobalMemoryEngine();
});

describe('GlobalMemoryPanel', () => {
  it('应正确渲染标题', () => {
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('跨会话记忆引擎')).toBeTruthy();
  });

  it('初始状态应显示空状态', () => {
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('memory-empty')).toBeTruthy();
  });

  it('isOpen=false 时不渲染', () => {
    const { container } = render(<GlobalMemoryPanel isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('点击关闭按钮应调用 onClose', () => {
    const onClose = vi.fn();
    render(<GlobalMemoryPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('memory-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击新增按钮应显示表单', () => {
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('memory-add'));
    expect(screen.getByTestId('memory-add-form')).toBeTruthy();
  });

  it('应能添加记忆', async () => {
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('memory-add'));
    fireEvent.change(screen.getByTestId('add-content'), {
      target: { value: '用户偏好 TypeScript 严格模式' },
    });
    fireEvent.change(screen.getByTestId('add-tags'), {
      target: { value: 'lang, ts' },
    });
    fireEvent.click(screen.getByTestId('add-confirm'));
    await waitFor(() => {
      expect(screen.getByText('用户偏好 TypeScript 严格模式')).toBeTruthy();
    });
  });

  it('应能搜索记忆', async () => {
    const engine = getGlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'TypeScript 严格模式', tags: ['lang'], scope: 'user', metadata: {} });
    engine.remember({ type: 'fact', content: 'Python 解释器', tags: ['lang'], scope: 'user', metadata: {} });

    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    const search = screen.getByTestId('memory-search');
    fireEvent.change(search, { target: { value: 'TypeScript' } });

    await waitFor(() => {
      expect(screen.getByText('TypeScript 严格模式')).toBeTruthy();
      expect(screen.queryByText('Python 解释器')).toBeNull();
    });
  });

  it('应能按类型过滤', async () => {
    const engine = getGlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'F1', tags: [], scope: 'user', metadata: {} });
    engine.remember({ type: 'rule', content: 'R1', tags: [], scope: 'user', metadata: {} });

    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('memory-filter-type'), { target: { value: 'rule' } });

    await waitFor(() => {
      expect(screen.getByText('R1')).toBeTruthy();
      expect(screen.queryByText('F1')).toBeNull();
    });
  });

  it('应能编辑记忆', async () => {
    const engine = getGlobalMemoryEngine();
    const entry = engine.remember({ type: 'fact', content: 'old', tags: [], scope: 'user', metadata: {} });

    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId(`memory-edit-btn-${entry.id}`));
    const contentArea = screen.getByTestId(`memory-edit-${entry.id}`).querySelector('textarea')!;
    fireEvent.change(contentArea, { target: { value: 'new' } });
    fireEvent.click(screen.getByTestId(`memory-save-${entry.id}`));

    await waitFor(() => {
      expect(screen.getByText('new')).toBeTruthy();
    });
  });

  it('应能删除记忆', async () => {
    const engine = getGlobalMemoryEngine();
    const entry = engine.remember({ type: 'fact', content: 'to delete', tags: [], scope: 'user', metadata: {} });

    // 模拟 confirm
    const originalConfirm = (globalThis as { confirm?: (msg: string) => boolean }).confirm;
    (globalThis as { confirm?: (msg: string) => boolean }).confirm = () => true;

    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId(`memory-delete-${entry.id}`));

    await waitFor(() => {
      expect(screen.queryByTestId(`memory-entry-${entry.id}`)).toBeNull();
    });

    (globalThis as { confirm?: (msg: string) => boolean }).confirm = originalConfirm;
  });

  it('应显示统计信息', () => {
    const engine = getGlobalMemoryEngine();
    engine.remember({ type: 'preference', content: 'p1', tags: [], scope: 'user', metadata: {} });
    engine.remember({ type: 'fact', content: 'f1', tags: [], scope: 'user', metadata: {} });
    engine.touchAccess(engine.getAll()[0].id);
    engine.touchAccess(engine.getAll()[0].id);

    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('memory-stats')).toBeTruthy();
    expect(screen.getByText('总条数').nextElementSibling?.textContent).toBe('2');
  });

  it('Esc 键应关闭面板', () => {
    const onClose = vi.fn();
    render(<GlobalMemoryPanel isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
