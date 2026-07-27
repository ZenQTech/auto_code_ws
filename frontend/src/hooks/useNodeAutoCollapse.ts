/**
 * # ============================================================
 * useNodeAutoCollapse - 节点自动折叠 Hook（Cycle 7 P0-10）
 * # ============================================================
 * 核心作用：实现 TRAE 风格"对话流节点自动折叠"逻辑
 *           超过 N 条的 completed 任务自动折叠 + 手动展开持久化
 * 设计要点：
 *   1. 已完成节点（status === "completed"）且顺序索引 >= threshold → 自动折叠
 *   2. 用户手动展开 / 折叠状态写入 localStorage（path → boolean）
 *   3. expandAll / collapseAll 批量操作
 *   4. enabled=false 时禁用自动折叠（全部展示）
 * 复用说明：
 *   - 复用于 MultiAgentTreePanel（SubAgent 节点折叠）
 *   - 复用于 ChatView（已完成任务节点折叠 - 预留）
 * 输入参数：
 *   - nodes: 节点列表（按显示顺序）
 *   - options: { threshold, enabled, storageKey }
 * 输出结果：{
 *   collapsedMap, toggleCollapse, expandAll, collapseAll, isCollapsed
 * }
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P0-10 初始化
 * ============================================================
 */

import { useState, useCallback, useEffect, useMemo } from 'react';

export interface AutoCollapseOptions {
  /** 折叠阈值：超过该顺序索引的 completed 节点自动折叠（默认 5） */
  threshold?: number;
  /** 是否启用自动折叠（默认 true） */
  enabled?: boolean;
  /** localStorage 存储 key（默认 'multiagent_autocollapse_user'） */
  storageKey?: string;
}

export interface AutoCollapseResult {
  /** 节点 path → 是否折叠 */
  collapsedMap: Record<string, boolean>;
  /** 切换单个节点折叠状态 */
  toggleCollapse: (path: string) => void;
  /** 展开全部 */
  expandAll: () => void;
  /** 折叠全部 */
  collapseAll: () => void;
  /** 查询单个节点是否折叠 */
  isCollapsed: (path: string) => boolean;
  /** 节点是否可见（未折叠祖先的子孙可见） */
  isVisible: (path: string) => boolean;
  /** 获取用户覆盖的折叠设置（用于 UI 显示） */
  userOverrides: Record<string, boolean>;
}

interface MinimalNode {
  path: string;
  status: string;
  parent_path?: string | null;
  children?: MinimalNode[];
}

/**
 * useNodeAutoCollapse - 自动折叠已完成节点
 * @param nodes 节点列表（扁平或树形均可，hook 内部处理）
 * @param options 配置
 */
export function useNodeAutoCollapse(
  nodes: MinimalNode[],
  options: AutoCollapseOptions = {}
): AutoCollapseResult {
  const { threshold = 5, enabled = true, storageKey = 'multiagent_autocollapse_user' } = options;

  /** 用户手动覆盖：path → collapsed 状态 */
  const [userOverrides, setUserOverrides] = useState<Record<string, boolean>>({});

  /** 加载 localStorage */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          setUserOverrides(parsed as Record<string, boolean>);
        }
      }
    } catch (e) {
      // 静默失败：localStorage 不可用
    }
  }, [storageKey]);

  /** 持久化 userOverrides */
  const persist = useCallback((next: Record<string, boolean>) => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch (e) {
      // 静默失败
    }
  }, [storageKey]);

  /**
   * 计算节点顺序索引（扁平化树形结构）
   * 规则：深度优先遍历，根 → 子节点
   */
  const orderMap = useMemo(() => {
    const order: Record<string, number> = {};
    let idx = 0;
    const visit = (n: MinimalNode) => {
      order[n.path] = idx++;
      if (n.children && n.children.length > 0) {
        for (const c of n.children) {
          visit(c);
        }
      }
    };
    // 输入可能是扁平数组：先识别根
    const hasRoot = nodes.some(n => n.path === '/root');
    if (hasRoot) {
      // 树形输入：直接遍历根
      for (const n of nodes) {
        if (n.path === '/root') visit(n);
      }
    } else {
      // 扁平输入：按 createdAt 排序后遍历
      const sorted = [...nodes].sort((a: any, b: any) =>
        (a.created_at || 0) - (b.created_at || 0)
      );
      for (const n of sorted) {
        if (!(n.path in order)) {
          order[n.path] = idx++;
        }
      }
    }
    return order;
  }, [nodes]);

  /**
   * 计算 collapsedMap：合并用户覆盖 + 自动折叠规则
   * 自动折叠规则：enabled && status === 'completed' && orderIndex >= threshold
   */
  const collapsedMap = useMemo(() => {
    const result: Record<string, boolean> = {};
    for (const n of nodes) {
      const order = orderMap[n.path];
      const autoCollapsed =
        enabled && n.status === 'completed' && typeof order === 'number' && order >= threshold;
      // 优先用户覆盖
      if (n.path in userOverrides) {
        result[n.path] = userOverrides[n.path];
      } else {
        result[n.path] = autoCollapsed;
      }
    }
    return result;
  }, [nodes, orderMap, userOverrides, enabled, threshold]);

  const toggleCollapse = useCallback((path: string) => {
    setUserOverrides(prev => {
      const current = prev[path] ?? collapsedMap[path] ?? false;
      const next = { ...prev, [path]: !current };
      persist(next);
      return next;
    });
  }, [collapsedMap, persist]);

  const expandAll = useCallback(() => {
    setUserOverrides(prev => {
      const next: Record<string, boolean> = { ...prev };
      for (const k of Object.keys(collapsedMap)) {
        next[k] = false;
      }
      persist(next);
      return next;
    });
  }, [collapsedMap, persist]);

  const collapseAll = useCallback(() => {
    setUserOverrides(prev => {
      const next: Record<string, boolean> = { ...prev };
      for (const k of Object.keys(collapsedMap)) {
        next[k] = true;
      }
      persist(next);
      return next;
    });
  }, [collapsedMap, persist]);

  const isCollapsed = useCallback(
    (path: string) => collapsedMap[path] === true,
    [collapsedMap]
  );

  /**
   * 节点可见性：祖先全部未折叠
   * 路径 /root/a/b/c → 祖先 /root, /root/a, /root/a/b
   */
  const isVisible = useCallback(
    (path: string): boolean => {
      if (path === '/root') return true;
      const parts = path.split('/').filter(Boolean);
      // 逐级检查祖先是否折叠
      for (let i = 1; i < parts.length; i++) {
        const ancestor = '/' + parts.slice(0, i).join('/');
        if (isCollapsed(ancestor)) return false;
      }
      return true;
    },
    [isCollapsed]
  );

  return {
    collapsedMap,
    toggleCollapse,
    expandAll,
    collapseAll,
    isCollapsed,
    isVisible,
    userOverrides,
  };
}

export default useNodeAutoCollapse;
