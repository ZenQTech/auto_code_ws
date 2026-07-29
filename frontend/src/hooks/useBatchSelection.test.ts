/**
 * # ============================================================
 * useBatchSelection Hook 单元测试（v1.0.0 P2-3）
 * # ============================================================
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBatchSelection } from './useBatchSelection';

interface TestItem {
  id: string;
  name: string;
}

const items: TestItem[] = [
  { id: '1', name: 'A' },
  { id: '2', name: 'B' },
  { id: '3', name: 'C' },
  { id: '4', name: 'D' },
  { id: '5', name: 'E' },
];

describe('useBatchSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('初始无选择', () => {
    const { result } = renderHook(() => useBatchSelection(items));
    expect(result.current.count).toBe(0);
    expect(result.current.isAllSelected).toBe(false);
    expect(result.current.isSomeSelected).toBe(false);
  });

  it('初始可传入 initialSelected', () => {
    const { result } = renderHook(() =>
      useBatchSelection(items, { initialSelected: ['1', '2'] })
    );
    expect(result.current.count).toBe(2);
    expect(result.current.isSelected('1')).toBe(true);
    expect(result.current.isSelected('3')).toBe(false);
  });

  it('toggle 切换选中状态', () => {
    const { result } = renderHook(() => useBatchSelection(items));
    act(() => result.current.toggle('1'));
    expect(result.current.isSelected('1')).toBe(true);
    act(() => result.current.toggle('1'));
    expect(result.current.isSelected('1')).toBe(false);
  });

  it('select / deselect', () => {
    const { result } = renderHook(() => useBatchSelection(items));
    act(() => result.current.select('1'));
    expect(result.current.isSelected('1')).toBe(true);
    act(() => result.current.deselect('1'));
    expect(result.current.isSelected('1')).toBe(false);
  });

  it('selectAll 选中全部', () => {
    const { result } = renderHook(() => useBatchSelection(items));
    act(() => result.current.selectAll());
    expect(result.current.count).toBe(5);
    expect(result.current.isAllSelected).toBe(true);
  });

  it('deselectAll 清空', () => {
    const { result } = renderHook(() => useBatchSelection(items));
    act(() => result.current.selectAll());
    expect(result.current.count).toBe(5);
    act(() => result.current.deselectAll());
    expect(result.current.count).toBe(0);
  });

  it('invertSelection 反选', () => {
    const { result } = renderHook(() => useBatchSelection(items, { initialSelected: ['1', '2'] }));
    act(() => result.current.invertSelection());
    expect(result.current.isSelected('1')).toBe(false);
    expect(result.current.isSelected('3')).toBe(true);
    expect(result.current.isSelected('4')).toBe(true);
    expect(result.current.isSelected('5')).toBe(true);
  });

  it('maxSelected 限制', () => {
    const { result } = renderHook(() => useBatchSelection(items, { maxSelected: 2 }));
    act(() => result.current.select('1'));
    act(() => result.current.select('2'));
    act(() => result.current.select('3')); // 已达上限，不应添加
    expect(result.current.count).toBe(2);
    expect(result.current.isAtMax).toBe(true);
  });

  it('selectAll 受 maxSelected 限制', () => {
    const { result } = renderHook(() => useBatchSelection(items, { maxSelected: 3 }));
    act(() => result.current.selectAll());
    expect(result.current.count).toBe(3);
  });

  it('selectRange 范围选择（Shift+Click）', () => {
    const { result } = renderHook(() => useBatchSelection(items));
    act(() => result.current.toggle('1')); // 起点
    act(() => result.current.selectRange('4')); // 范围到 4
    expect(result.current.isSelected('1')).toBe(true);
    expect(result.current.isSelected('2')).toBe(true);
    expect(result.current.isSelected('3')).toBe(true);
    expect(result.current.isSelected('4')).toBe(true);
    expect(result.current.isSelected('5')).toBe(false);
  });

  it('selectRange 反向范围', () => {
    const { result } = renderHook(() => useBatchSelection(items));
    act(() => result.current.toggle('4'));
    act(() => result.current.selectRange('2'));
    expect(result.current.isSelected('2')).toBe(true);
    expect(result.current.isSelected('3')).toBe(true);
    expect(result.current.isSelected('4')).toBe(true);
  });

  it('selectRange 无起点时单选', () => {
    const { result } = renderHook(() => useBatchSelection(items));
    act(() => result.current.selectRange('3'));
    expect(result.current.isSelected('3')).toBe(true);
    expect(result.current.count).toBe(1);
  });

  it('onSelectionChange 回调触发', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useBatchSelection(items, { onSelectionChange: onChange })
    );
    act(() => result.current.toggle('1'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0][0] as Set<string>;
    expect(arg.has('1')).toBe(true);
  });

  it('selectedItems 派生：返回已选项详情', () => {
    const { result } = renderHook(() =>
      useBatchSelection(items, { initialSelected: ['1', '3'] })
    );
    expect(result.current.selectedItems).toHaveLength(2);
    expect(result.current.selectedItems[0].name).toBe('A');
    expect(result.current.selectedItems[1].name).toBe('C');
  });

  it('items 变化时清理无效选择', () => {
    const { result, rerender } = renderHook(
      ({ data }: { data: TestItem[] }) => useBatchSelection(data, { initialSelected: ['1', '2', '3'] }),
      { initialProps: { data: items } }
    );
    expect(result.current.count).toBe(3);
    // items 变化：只保留 id=1 的项
    rerender({ data: [{ id: '1', name: 'A' }, { id: '99', name: 'Z' }] });
    expect(result.current.isSelected('1')).toBe(true);
    expect(result.current.isSelected('2')).toBe(false); // 被清理
    expect(result.current.isSelected('3')).toBe(false); // 被清理
  });

  it('isSomeSelected 部分选中状态', () => {
    const { result } = renderHook(() =>
      useBatchSelection(items, { initialSelected: ['1'] })
    );
    expect(result.current.isSomeSelected).toBe(true);
    expect(result.current.isAllSelected).toBe(false);
  });

  it('isAllSelected 全部选中状态', () => {
    const { result } = renderHook(() =>
      useBatchSelection(items, { initialSelected: ['1', '2', '3', '4', '5'] })
    );
    expect(result.current.isAllSelected).toBe(true);
    expect(result.current.isSomeSelected).toBe(false);
  });

  it('setSelectedIds 外部设置', () => {
    const { result } = renderHook(() => useBatchSelection(items));
    act(() => result.current.setSelectedIds(new Set(['2', '3'])));
    expect(result.current.count).toBe(2);
    expect(result.current.isSelected('2')).toBe(true);
  });
});
