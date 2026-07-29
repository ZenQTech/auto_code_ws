/**
 * # ============================================================
 * # MentionMenu 组件测试 (v1.0.0 - Cycle 15 P1-5)
 * # ============================================================
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import MentionMenu from './MentionMenu';
import type { FuzzyItem } from '../utils/fuzzySearch';

const mockItems: FuzzyItem[] = [
  {
    id: 'file-src-app.tsx',
    title: 'src/App.tsx',
    subtitle: '主入口文件',
    icon: '📄',
    keywords: ['app', 'main'],
    meta: { type: 'file', value: 'src/App.tsx' },
  },
  {
    id: 'file-src-index.tsx',
    title: 'src/index.tsx',
    subtitle: '根入口',
    icon: '📄',
    keywords: ['index', 'root'],
    meta: { type: 'file', value: 'src/index.tsx' },
  },
  {
    id: 'folder-src-components',
    title: 'src/components',
    subtitle: '组件目录 (12 files)',
    icon: '📁',
    keywords: ['components', 'comps'],
    meta: { type: 'folder', value: 'src/components' },
  },
  {
    id: 'symbol-UserService',
    title: 'UserService',
    subtitle: 'class · src/services/user.ts',
    icon: '🔣',
    keywords: ['user', 'service'],
    meta: { type: 'code', value: 'UserService' },
  },
  {
    id: 'docs-react',
    title: 'React 文档',
    subtitle: 'https://react.dev',
    icon: '📚',
    keywords: ['react', 'docs'],
    meta: { type: 'docs', value: 'https://react.dev' },
  },
];

/** 测试用 Harness 组件 */
function Harness({
  items,
  initialValue = '',
  onSelect,
  maxItems,
}: {
  items: FuzzyItem[];
  initialValue?: string;
  onSelect?: (item: FuzzyItem) => void;
  maxItems?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initialValue);
  return (
    <div>
      <textarea ref={ref} data-testid="ta" value={value} onChange={(e) => setValue(e.target.value)} />
      <MentionMenu
        textareaRef={ref}
        value={value}
        onChange={setValue}
        items={items}
        onSelect={onSelect}
        maxItems={maxItems}
      />
    </div>
  );
}

describe('MentionMenu - 触发', () => {
  beforeEach(() => {
    // selectionchange 事件需要 document 焦点，模拟一下
    document.body.focus();
  });

  it('默认不渲染弹窗（无 @ 触发）', () => {
    const { container } = render(<Harness items={mockItems} initialValue="hello world" />);
    expect(container.querySelector('[data-component="mention-menu"]')).toBeNull();
  });

  it('输入 @ 后弹出菜单', async () => {
    const { container } = render(<Harness items={mockItems} initialValue="@" />);
    await waitFor(() => {
      expect(container.querySelector('[data-component="mention-menu"]')).toBeInTheDocument();
    });
  });

  it('@ 在行首时也触发', async () => {
    const { container } = render(<Harness items={mockItems} initialValue="hello @" />);
    await waitFor(() => {
      expect(container.querySelector('[data-component="mention-menu"]')).toBeInTheDocument();
    });
  });

  it('email 中的 @ 不触发', async () => {
    const { container } = render(<Harness items={mockItems} initialValue="foo@bar" />);
    // selectionchange + initial value 都不会触发，因为 @ 前面是非空白字符
    // 但默认 value="foo@bar" 会被 selectionchange handler 处理
    // 我们等待一下确保不出现
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[data-component="mention-menu"]')).toBeNull();
  });

  it('@ 后有空格时弹窗关闭', async () => {
    const { container } = render(<Harness items={mockItems} initialValue="@ " />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[data-component="mention-menu"]')).toBeNull();
  });
});

describe('MentionMenu - fuzzy search', () => {
  it('应显示 fuzzy 搜索结果', async () => {
    const { container } = render(<Harness items={mockItems} initialValue="@" />);
    await waitFor(() => {
      const menu = container.querySelector('[data-component="mention-menu"]');
      expect(menu).toBeInTheDocument();
      expect(menu?.getAttribute('data-result-count')).toBe('5');
    });
  });

  it('输入查询词后过滤结果', async () => {
    const { container } = render(<Harness items={mockItems} initialValue="@" />);
    await waitFor(() => {
      expect(container.querySelector('[data-component="mention-menu"]')).toBeInTheDocument();
    });
    // 模拟用户在 textarea 中输入 "app"
    const ta = screen.getByTestId('ta') as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(1, 1);
    await act(async () => {
      fireEvent.change(ta, { target: { value: '@app' } });
    });
    // 触发 selectionchange
    document.dispatchEvent(new Event('selectionchange'));
    await waitFor(() => {
      const menu = container.querySelector('[data-component="mention-menu"]');
      expect(menu?.getAttribute('data-result-count')).toBe('1');
    });
  });

  it('无匹配时不渲染菜单', async () => {
    const { container } = render(<Harness items={mockItems} initialValue="@zzzz" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[data-component="mention-menu"]')).toBeNull();
  });
});

describe('MentionMenu - 键盘导航', () => {
  it('ArrowDown 高亮下一项', async () => {
    const { container } = render(<Harness items={mockItems} initialValue="@" />);
    await waitFor(() => {
      expect(container.querySelector('[data-component="mention-menu"]')).toBeInTheDocument();
    });
    const ta = screen.getByTestId('ta') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'ArrowDown' });
    });
    const items = container.querySelectorAll('[data-item-id]');
    expect(items[1]?.getAttribute('data-highlighted')).toBe('true');
  });

  it('ArrowUp 高亮上一项', async () => {
    const { container } = render(<Harness items={mockItems} initialValue="@" />);
    await waitFor(() => {
      expect(container.querySelector('[data-component="mention-menu"]')).toBeInTheDocument();
    });
    const ta = screen.getByTestId('ta') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'ArrowUp' });
    });
    const items = container.querySelectorAll('[data-item-id]');
    // 向上回到最后一项
    expect(items[items.length - 1]?.getAttribute('data-highlighted')).toBe('true');
  });

  it('Enter 选中当前高亮项', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <Harness items={mockItems} initialValue="@" onSelect={onSelect} />,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-component="mention-menu"]')).toBeInTheDocument();
    });
    const ta = screen.getByTestId('ta') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter' });
    });
    expect(onSelect).toHaveBeenCalled();
    expect((ta as HTMLTextAreaElement).value).toMatch(/@file:src\/App\.tsx/);
  });

  it('Esc 关闭弹窗', async () => {
    const { container } = render(<Harness items={mockItems} initialValue="@" />);
    await waitFor(() => {
      expect(container.querySelector('[data-component="mention-menu"]')).toBeInTheDocument();
    });
    const ta = screen.getByTestId('ta') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Escape' });
    });
    expect(container.querySelector('[data-component="mention-menu"]')).toBeNull();
  });
});

describe('MentionMenu - 鼠标选择', () => {
  it('点击候选项应插入 mention', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <Harness items={mockItems} initialValue="@" onSelect={onSelect} />,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-component="mention-menu"]')).toBeInTheDocument();
    });
    const firstItem = container.querySelector('[data-item-id]') as HTMLElement;
    fireEvent.mouseDown(firstItem);
    expect(onSelect).toHaveBeenCalled();
    const ta = screen.getByTestId('ta') as HTMLTextAreaElement;
    expect(ta.value).toMatch(/@file:/);
  });

  it('鼠标悬浮应高亮当前项', async () => {
    const { container } = render(<Harness items={mockItems} initialValue="@" />);
    await waitFor(() => {
      expect(container.querySelector('[data-component="mention-menu"]')).toBeInTheDocument();
    });
    const items = container.querySelectorAll('[data-item-id]');
    fireEvent.mouseEnter(items[2] as HTMLElement);
    expect(items[2]?.getAttribute('data-highlighted')).toBe('true');
  });
});

describe('MentionMenu - 边界', () => {
  it('空 items 列表不渲染菜单', async () => {
    const { container } = render(<Harness items={[]} initialValue="@" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[data-component="mention-menu"]')).toBeNull();
  });

  it('maxItems 限制返回条数', async () => {
    const { container } = render(<Harness items={mockItems} initialValue="@" maxItems={2} />);
    await waitFor(() => {
      const menu = container.querySelector('[data-component="mention-menu"]');
      expect(menu?.getAttribute('data-result-count')).toBe('2');
    });
  });
});
