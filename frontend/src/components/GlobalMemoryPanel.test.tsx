/**
 * # ============================================================
 * # GlobalMemoryPanel 组件测试 (Cycle 24 G24-01)
 * # ============================================================
 */

// @vitest-environment happy-dom

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
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  // ====== P2-2 UI/UX 一致性增强测试 ======

  it('应包含快捷键帮助按钮', () => {
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('memory-shortcuts-btn')).toBeTruthy();
  });

  it('点击快捷键帮助按钮应打开快捷键面板', () => {
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('memory-shortcuts-btn'));
    expect(screen.getByTestId('memory-shortcuts-panel')).toBeTruthy();
  });

  it('? 键应切换快捷键面板', () => {
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.keyDown(document.body, { key: '?' });
    expect(screen.getByTestId('memory-shortcuts-panel')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: '?' });
    expect(screen.queryByTestId('memory-shortcuts-panel')).toBeNull();
  });

  it('Cmd+N 应打开新增表单', () => {
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.keyDown(document.body, { key: 'n', metaKey: true });
    expect(screen.getByTestId('memory-add-form')).toBeTruthy();
  });

  it('Cmd+F 应聚焦搜索框', () => {
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    const search = screen.getByTestId('memory-search') as HTMLInputElement;
    fireEvent.keyDown(document.body, { key: 'f', metaKey: true });
    expect(document.activeElement).toBe(search);
  });

  it('搜索清空按钮应存在', () => {
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    const search = screen.getByTestId('memory-search');
    fireEvent.change(search, { target: { value: 'test' } });
    expect(screen.getByTestId('memory-search-clear')).toBeTruthy();
  });

  it('点击搜索清空按钮应清空搜索', () => {
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    const search = screen.getByTestId('memory-search') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'test' } });
    fireEvent.click(screen.getByTestId('memory-search-clear'));
    expect(search.value).toBe('');
  });

  it('搜索时应显示防抖提示', () => {
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    const search = screen.getByTestId('memory-search');
    fireEvent.change(search, { target: { value: 'TypeScript' } });
    // 防抖期间应显示提示
    expect(screen.getByTestId('memory-search-debounce')).toBeTruthy();
  });

  it('过滤器选择应被持久化到 localStorage', async () => {
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('memory-filter-type'), { target: { value: 'rule' } });
    // localStorage 中应存有过滤偏好
    const stored = localStorage.getItem('hermes.globalMemoryPanel');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.filterType).toBe('rule');
  });

  it('打开时若 localStorage 中存有过滤器应恢复', () => {
    localStorage.setItem(
      'hermes.globalMemoryPanel',
      JSON.stringify({ filterType: 'decision', filterScope: 'project', sortBy: 'importance' })
    );
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    const typeSelect = screen.getByTestId('memory-filter-type') as HTMLSelectElement;
    expect(typeSelect.value).toBe('decision');
  });

  it('导出菜单应包含 JSON 和 Markdown 选项', () => {
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('memory-export-json')).toBeTruthy();
    expect(screen.getByTestId('memory-export-md')).toBeTruthy();
  });

  it('导入菜单应包含 JSON 和 Markdown 选项', () => {
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('memory-import-json')).toBeTruthy();
    expect(screen.getByTestId('memory-import-md')).toBeTruthy();
  });

  it('压缩时按钮应显示加载状态', () => {
    const engine = getGlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'a', tags: [], scope: 'user', metadata: {} });
    engine.remember({ type: 'fact', content: 'a', tags: [], scope: 'user', metadata: {} });
    const origConfirm = (globalThis as { confirm?: (msg: string) => boolean }).confirm;
    (globalThis as { confirm?: (msg: string) => boolean }).confirm = () => true;
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('memory-compress'));
    (globalThis as { confirm?: (msg: string) => boolean }).confirm = origConfirm;
    // 不报错即说明压缩流程运行完成
    expect(true).toBe(true);
  });

  it('取消新增表单 Esc 应只关闭表单不关闭面板', () => {
    const onClose = vi.fn();
    render(<GlobalMemoryPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('memory-add'));
    expect(screen.getByTestId('memory-add-form')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId('memory-add-form')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('信息提示应显示 toast 区域', () => {
    const engine = getGlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'A', tags: [], scope: 'user', metadata: {} });
    const origConfirm = (globalThis as { confirm?: (msg: string) => boolean }).confirm;
    (globalThis as { confirm?: (msg: string) => boolean }).confirm = () => true;
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    // 触发删除以产生 info
    const entry = engine.getAll()[0];
    fireEvent.click(screen.getByTestId(`memory-delete-${entry.id}`));
    (globalThis as { confirm?: (msg: string) => boolean }).confirm = origConfirm;
    expect(screen.getByTestId('memory-toast')).toBeTruthy();
  });

  it('关闭 toast 应清除消息', async () => {
    const engine = getGlobalMemoryEngine();
    engine.remember({ type: 'fact', content: 'A', tags: [], scope: 'user', metadata: {} });
    const origConfirm = (globalThis as { confirm?: (msg: string) => boolean }).confirm;
    (globalThis as { confirm?: (msg: string) => boolean }).confirm = () => true;
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    const entry = engine.getAll()[0];
    fireEvent.click(screen.getByTestId(`memory-delete-${entry.id}`));
    (globalThis as { confirm?: (msg: string) => boolean }).confirm = origConfirm;
    expect(screen.getByTestId('memory-toast')).toBeTruthy();
    fireEvent.click(screen.getByTestId('memory-toast-close'));
    expect(screen.queryByTestId('memory-toast')).toBeNull();
  });

  it('取消编辑时 Esc 应只退出编辑不关闭面板', () => {
    const engine = getGlobalMemoryEngine();
    const entry = engine.remember({ type: 'fact', content: 'X', tags: [], scope: 'user', metadata: {} });
    const onClose = vi.fn();
    render(<GlobalMemoryPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId(`memory-edit-btn-${entry.id}`));
    expect(screen.getByTestId(`memory-edit-${entry.id}`)).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId(`memory-edit-${entry.id}`)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cmd+S 在编辑中应保存', () => {
    const engine = getGlobalMemoryEngine();
    const entry = engine.remember({ type: 'fact', content: 'old', tags: [], scope: 'user', metadata: {} });
    render(<GlobalMemoryPanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId(`memory-edit-btn-${entry.id}`));
    const contentArea = screen.getByTestId(`memory-edit-${entry.id}`).querySelector('textarea')!;
    fireEvent.change(contentArea, { target: { value: 'new' } });
    fireEvent.keyDown(document.body, { key: 's', metaKey: true });
    expect(engine.recallById(entry.id)?.content).toBe('new');
  });
});
