/**
 * # ============================================================
 * # MentionMenu - @ mention fuzzy search 弹窗 (v1.0.0 - Cycle 15 P1-5)
 * # ============================================================
 * # 核心作用：在 textarea 中输入 @ 触发 mention 弹窗
 * #           支持 fuzzy search + 键盘导航 + 鼠标点击
 * # 运行流程：
 * #   1. 父组件传入 textarea ref + 候选项列表
 * #   2. 监听 textarea 内容：检测 @ 位置 + 后续查询词
 * #   3. 弹出 fuzzy search 菜单
 * #   4. 用户选择（Enter / 点击）→ 替换 @ 段为 @type:value 字符串
 * # 输入参数：
 * #   - textareaRef: ref 到 textarea 元素
 * #   - value: textarea 当前值（受控）
 * #   - onChange: textarea 变化回调
 * #   - items: 候选项列表
 * #   - onSelect?: 选中后回调（用于同步到 engine）
 * #   - maxItems: 最多展示条数（默认 8）
 * # 输出结果：mention 弹窗 DOM
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 15 P1-5 初始版本
 * #     - 监听 @ 触发
 * #     - fuzzy search 集成
 * #     - 键盘导航（↑↓ Enter Esc）
 * #     - 鼠标点击
 * #     - 浮动定位（基于 textarea 坐标）
 * # ============================================================
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { fuzzySearch, type FuzzyItem } from '../utils/fuzzySearch';

export interface MentionMenuProps {
  /** textarea 元素 ref */
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  /** textarea 当前值 */
  value: string;
  /** textarea 变化回调 */
  onChange: (newValue: string) => void;
  /** 候选项列表 */
  items: FuzzyItem[];
  /** 选中后的额外回调（用于同步到 engine） */
  onSelect?: (item: FuzzyItem) => void;
  /** 最多展示条数（默认 8） */
  maxItems?: number;
  /** 触发关键字（默认 '@'） */
  trigger?: string;
}

interface ActiveMatch {
  /** @ 符号在 value 中的起始位置 */
  start: number;
  /** 当前 query（@ 之后的文本） */
  query: string;
  /** textarea 视口坐标（用于定位弹窗） */
  rect: { top: number; left: number; bottom: number; height: number };
}

/**
 * MentionMenu - @ mention 弹窗
 * 自动检测 textarea 中的 @ 触发，弹出 fuzzy search 菜单
 */
export function MentionMenu({
  textareaRef,
  value,
  onChange,
  items,
  onSelect,
  maxItems = 8,
  trigger = '@',
}: MentionMenuProps) {
  const [active, setActive] = useState<ActiveMatch | null>(null);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  /**
   * 检测 @ 触发
   * 找到光标前最近的 @ 符号，作为 query 起始
   */
  const detectMention = useCallback((): ActiveMatch | null => {
    const ta = textareaRef.current;
    if (!ta) return null;
    const cursorPos = ta.selectionStart ?? 0;
    const textBefore = value.slice(0, cursorPos);
    // 从 cursorPos 向前找最近的 @
    const lastAt = textBefore.lastIndexOf(trigger);
    if (lastAt === -1) return null;
    // @ 必须在空白字符或行首之后（避免 email 误判）
    if (lastAt > 0) {
      const charBefore = textBefore[lastAt - 1];
      if (charBefore && !/\s/.test(charBefore) && charBefore !== trigger) {
        return null;
      }
    }
    // @ 之后到 cursorPos 之间不能有空白（否则认为 mention 已结束）
    const query = textBefore.slice(lastAt + 1);
    if (/\s/.test(query)) {
      return null;
    }
    // 计算 textarea 视口坐标
    // 使用一个隐藏的镜像 div 测量 cursor 位置（简化：用 textarea 本身的 bounds 近似）
    const taRect = ta.getBoundingClientRect();
    // 简单做法：在 textarea 底部偏上 4px 显示
    return {
      start: lastAt,
      query,
      rect: {
        top: taRect.top + 4,
        left: taRect.left + 16,
        bottom: taRect.bottom,
        height: taRect.height,
      },
    };
  }, [textareaRef, value, trigger]);

  /**
   * 监听 value 变化和光标变化
   */
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const handler = () => {
      const m = detectMention();
      setActive(m);
      setHighlightIdx(0);
    };
    // 初次
    handler();
    // 监听 selectionchange 事件（更可靠）
    document.addEventListener('selectionchange', handler);
    return () => {
      document.removeEventListener('selectionchange', handler);
    };
  }, [detectMention, textareaRef]);

  /**
   * 计算 fuzzy search 结果
   */
  const results = useMemo(() => {
    if (!active) return [];
    return fuzzySearch(active.query, items, maxItems);
  }, [active, items, maxItems]);

  /**
   * 插入 mention
   * 替换 @query 为 @type:value（如果 item 有 meta.type 和 meta.value）
   * 或 @item.id（兜底）
   */
  const insertMention = useCallback(
    (item: FuzzyItem) => {
      const ta = textareaRef.current;
      if (!ta || !active) return;
      const cursorPos = ta.selectionStart ?? 0;
      // 构造 mention 文本
      const meta = item.meta as { type?: string; value?: string } | undefined;
      const mentionText = meta?.type && meta?.value
        ? `@${meta.type}:${meta.value}`
        : `${trigger}${item.id}`;
      // 替换：value[active.start..cursorPos] -> mentionText
      const before = value.slice(0, active.start);
      const after = value.slice(cursorPos);
      const newValue = before + mentionText + ' ' + after;
      onChange(newValue);
      // 光标移到 mention 末尾
      requestAnimationFrame(() => {
        const newCursor = before.length + mentionText.length + 1;
        ta.focus();
        ta.setSelectionRange(newCursor, newCursor);
      });
      onSelect?.(item);
      setActive(null);
    },
    [active, value, onChange, onSelect, textareaRef, trigger],
  );

  /**
   * 键盘事件处理
   */
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta || !active) return;
    const handler = (e: KeyboardEvent) => {
      if (results.length === 0) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setActive(null);
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIdx((i) => (i + 1) % results.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIdx((i) => (i - 1 + results.length) % results.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(results[highlightIdx].item);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setActive(null);
      }
    };
    ta.addEventListener('keydown', handler);
    return () => ta.removeEventListener('keydown', handler);
  }, [active, results, highlightIdx, insertMention, textareaRef]);

  // 弹窗定位：textarea 下方，水平对齐 cursor
  if (!active || results.length === 0) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    top: active.rect.bottom + 2,
    left: active.rect.left,
    zIndex: 1000,
  };

  return (
    <div
      ref={menuRef}
      data-component="mention-menu"
      data-active="true"
      data-query={active.query}
      data-result-count={results.length}
      className="w-80 max-h-64 overflow-y-auto bg-surface-900 border border-surface-700 rounded-lg shadow-2xl"
      style={style}
    >
      <div className="px-3 py-1.5 text-[10px] text-surface-500 border-b border-surface-800">
        提到 · {results.length} 个结果 · ↑↓ 选择 Enter 确认 Esc 取消
      </div>
      {results.map((r, idx) => (
        <button
          key={r.item.id}
          type="button"
          onMouseDown={(e) => {
            // 使用 mousedown 而非 click，避免 textarea 失焦
            e.preventDefault();
            insertMention(r.item);
          }}
          onMouseEnter={() => setHighlightIdx(idx)}
          data-item-id={r.item.id}
          data-highlighted={idx === highlightIdx}
          className={`
            w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs
            ${idx === highlightIdx
              ? 'bg-hermes-500/20 text-hermes-100'
              : 'text-surface-200 hover:bg-surface-800'}
            transition-colors
          `}
        >
          {r.item.icon && <span className="text-sm flex-shrink-0">{r.item.icon}</span>}
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{r.item.title}</div>
            {r.item.subtitle && (
              <div className="text-[10px] text-surface-500 truncate">
                {r.item.subtitle}
              </div>
            )}
          </div>
          <div className="text-[10px] text-surface-500 flex-shrink-0">
            {(r.score * 100).toFixed(0)}
          </div>
        </button>
      ))}
    </div>
  );
}

export default MentionMenu;
