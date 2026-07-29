/**
 * # ============================================================
 * useBatchSelection Hook（v6.38.0 P2-3 新增）
 * # ============================================================
 * 核心作用：提供列表项批量选择的状态管理能力
 * 特性：
 *   - 单选/多选切换
 *   - 全选/反选
 *   - 范围选择（Shift+Click）
 *   - 选择上限保护
 *   - 派生状态：count / isAllSelected / isSomeSelected
 * 设计决策：
 *   - 使用 Set 存储 ID（O(1) 查找）
 *   - 不可变更新（返回新 Set）
 *   - 派生状态使用 useMemo 缓存
 * 输入参数：
 *   - items: T[]，候选列表
 *   - options: { maxSelected?: number, onSelectionChange?: (ids: Set<string>) => void }
 * 输出结果：{ selectedIds, isSelected, toggle, select, deselect, selectAll, deselectAll, invertSelection, selectRange, count, isAllSelected, isSomeSelected }
 * ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | P2-3 初始版本
 * # ============================================================
 */

import { useCallback, useMemo, useState, useRef, useEffect } from 'react';

/** 可选列表项必须包含 id 字段 */
export interface BatchSelectable {
  id: string;
}

export interface UseBatchSelectionOptions {
  /** 最多可选数量（默认 Infinity） */
  maxSelected?: number;
  /** 选择变化回调 */
  onSelectionChange?: (ids: Set<string>) => void;
  /** 初始已选项 ID 列表 */
  initialSelected?: string[];
}

export interface UseBatchSelectionResult<T extends BatchSelectable> {
  /** 当前已选的 ID Set */
  selectedIds: Set<string>;
  /** 派生：已选数量 */
  count: number;
  /** 派生：是否全部选中 */
  isAllSelected: boolean;
  /** 派生：是否部分选中（用于 indeterminate 状态） */
  isSomeSelected: boolean;
  /** 派生：是否超过选择上限 */
  isAtMax: boolean;
  /** 派生：已选项详情（id → item） */
  selectedItems: T[];
  /** 判断某项是否已选 */
  isSelected: (id: string) => boolean;
  /** 切换某项的选中状态 */
  toggle: (id: string) => void;
  /** 选中某项（不超过 maxSelected） */
  select: (id: string) => void;
  /** 取消选中某项 */
  deselect: (id: string) => void;
  /** 全选当前 items */
  selectAll: () => void;
  /** 清空选择 */
  deselectAll: () => void;
  /** 反选 */
  invertSelection: () => void;
  /** 范围选择（从 lastSelectedId 到 targetId 之间的所有 item） */
  selectRange: (targetId: string) => void;
  /** 批量设置（用于外部 API） */
  setSelectedIds: (ids: Set<string>) => void;
  /** 记录最近点击的 id（用于 range select 的起点） */
  lastSelectedIdRef: React.MutableRefObject<string | null>;
}

export function useBatchSelection<T extends BatchSelectable>(
  items: T[],
  options: UseBatchSelectionOptions = {}
): UseBatchSelectionResult<T> {
  const { maxSelected = Infinity, onSelectionChange, initialSelected } = options;

  // 初始化
  const [selectedIds, setSelectedIdsInternal] = useState<Set<string>>(
    () => new Set(initialSelected ?? [])
  );
  const lastSelectedIdRef = useRef<string | null>(null);

  // 包装 setter：自动触发回调
  const setSelectedIds = useCallback(
    (next: Set<string>) => {
      setSelectedIdsInternal(next);
      onSelectionChange?.(next);
    },
    [onSelectionChange]
  );

  // 派生：已选数量
  const count = selectedIds.size;

  // 派生：是否全部选中
  const isAllSelected = useMemo(
    () => items.length > 0 && items.every((item) => selectedIds.has(item.id)),
    [items, selectedIds]
  );

  // 派生：是否部分选中（用于 indeterminate 状态）
  const isSomeSelected = useMemo(
    () => count > 0 && !isAllSelected,
    [count, isAllSelected]
  );

  // 派生：是否达到上限
  const isAtMax = count >= maxSelected;

  // 派生：已选项详情（id → item）
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds]
  );

  // 判断某项是否已选
  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds]
  );

  // 切换某项的选中状态
  const toggle = useCallback(
    (id: string) => {
      setSelectedIdsInternal((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          if (next.size >= maxSelected) return prev; // 已达上限
          next.add(id);
        }
        onSelectionChange?.(next);
        return next;
      });
      lastSelectedIdRef.current = id;
    },
    [maxSelected, onSelectionChange]
  );

  // 选中某项
  const select = useCallback(
    (id: string) => {
      setSelectedIdsInternal((prev) => {
        if (prev.has(id)) return prev;
        if (prev.size >= maxSelected) return prev;
        const next = new Set(prev);
        next.add(id);
        onSelectionChange?.(next);
        return next;
      });
      lastSelectedIdRef.current = id;
    },
    [maxSelected, onSelectionChange]
  );

  // 取消选中
  const deselect = useCallback(
    (id: string) => {
      setSelectedIdsInternal((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        onSelectionChange?.(next);
        return next;
      });
      lastSelectedIdRef.current = id;
    },
    [onSelectionChange]
  );

  // 全选
  const selectAll = useCallback(() => {
    const next = new Set<string>();
    for (const item of items) {
      if (next.size >= maxSelected) break;
      next.add(item.id);
    }
    setSelectedIds(next);
  }, [items, maxSelected, setSelectedIds]);

  // 清空
  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, [setSelectedIds]);

  // 反选
  const invertSelection = useCallback(() => {
    setSelectedIdsInternal((prev) => {
      const next = new Set<string>();
      for (const item of items) {
        if (!prev.has(item.id)) {
          if (next.size >= maxSelected) break;
          next.add(item.id);
        }
      }
      onSelectionChange?.(next);
      return next;
    });
  }, [items, maxSelected, onSelectionChange]);

  // 范围选择（Shift+Click）
  const selectRange = useCallback(
    (targetId: string) => {
      const lastId = lastSelectedIdRef.current;
      if (!lastId) {
        // 没有上次点击，单选
        toggle(targetId);
        return;
      }
      const lastIdx = items.findIndex((i) => i.id === lastId);
      const targetIdx = items.findIndex((i) => i.id === targetId);
      if (lastIdx === -1 || targetIdx === -1) {
        toggle(targetId);
        return;
      }
      const [start, end] = lastIdx < targetIdx ? [lastIdx, targetIdx] : [targetIdx, lastIdx];
      setSelectedIdsInternal((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          if (next.size >= maxSelected) break;
          next.add(items[i].id);
        }
        onSelectionChange?.(next);
        return next;
      });
    },
    [items, maxSelected, toggle, onSelectionChange]
  );

  // 当 items 变化时清理无效选择（被过滤掉的 id）
  useEffect(() => {
    setSelectedIdsInternal((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(items.map((i) => i.id));
      const filtered = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id) && filtered.size < maxSelected) {
          filtered.add(id);
        }
      }
      if (filtered.size === prev.size) return prev;
      onSelectionChange?.(filtered);
      return filtered;
    });
  }, [items, maxSelected, onSelectionChange]);

  return {
    selectedIds,
    count,
    isAllSelected,
    isSomeSelected,
    isAtMax,
    selectedItems,
    isSelected,
    toggle,
    select,
    deselect,
    selectAll,
    deselectAll,
    invertSelection,
    selectRange,
    setSelectedIds,
    lastSelectedIdRef,
  };
}

export default useBatchSelection;
