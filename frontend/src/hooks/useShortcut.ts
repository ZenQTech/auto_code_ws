/**
 * # ============================================================
 * 快捷键 Hook（v6.37.0 P2-2 新增 / v7.0.0 Solo 重构增强）
 * # ============================================================
 * 核心作用：提供统一的快捷键注册能力
 * 特性：
 *   - 支持组合键（Cmd/Ctrl/Shift/Alt + Key）
 *   - 支持 key 序列（如 "g g" → 跳到底部，类似 GitHub）
 *   - 输入框内快捷键可配置（默认阻止在 input/textarea 中触发）
 *   - 自动清理（组件卸载时）
 *   - 全局单例 ShortcutManager（避免重复监听）
 *   - v7.0.0 新增：Codex 风格多 Context 系统（global/chat/composer/editor/pager/list/approval）
 *   - v7.0.0 新增：当前活跃 context 切换 + 路由回退
 * 设计决策：
 *   - 使用单例 + 订阅模式：避免每个组件都 addEventListener
 *   - 组合键检测：基于 KeyboardEvent.metaKey/ctrlKey/shiftKey/altKey + key
 *   - 冲突解决：后注册的优先（zIndex 更高）
 *   - Context 优先级：activeContext > global
 * 输入参数：
 *   - id: 唯一标识（用于冲突检测）
 *   - combo: 快捷键组合，如 "mod+k" / "mod+shift+p" / "g g"
 *   - handler: 触发回调
 *   - options: { allowInInput?, description?, priority?, enabled?, context? }
 * 输出结果：自动清理（无需返回值）
 * ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | P2-2 初始版本
 * #   - 2026-08-04 | v7.0.0 | Solo 重构 - 引入 7 个 Codex 风格 contexts
 * # ============================================================
 */

import { useEffect, useRef } from 'react';

// ============================================================
// 类型定义
// ============================================================

/** 修饰键 */
export type ModKey = 'mod' | 'ctrl' | 'meta' | 'shift' | 'alt';

/** 快捷键组合（解析后的标准化形式） */
export interface ParsedShortcut {
  key: string; // 标准化为小写：'k' / 'enter' / 'escape' / 'arrowup' 等
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

/** 快捷键处理器 */
export type ShortcutHandler = (e: KeyboardEvent) => void;

/** 快捷键注册项 */
export interface ShortcutRegistration {
  id: string;
  combo: string;
  parsed: ParsedShortcut;
  handler: ShortcutHandler;
  allowInInput: boolean;
  description?: string;
  priority: number; // 数字越大越优先
  /** v7.0.0 新增：Codex 风格 context，默认 global */
  context: ShortcutContext;
}

/** useShortcut 选项 */
export interface UseShortcutOptions {
  /** 是否允许在 input/textarea/contenteditable 中触发（默认 false） */
  allowInInput?: boolean;
  /** 描述（用于未来快捷键帮助面板） */
  description?: string;
  /** 优先级（数字越大越优先，默认 0） */
  priority?: number;
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /**
   * v7.0.0 新增：Codex 风格快捷键 context
   * - global: 永远生效
   * - chat: 在主对话/AI Chat 区域激活时生效
   * - composer: 在输入框/composer 区域激活时生效
   * - editor: 在文件编辑器激活时生效
   * - pager: 在分页列表（pager 模式）激活时生效
   * - list: 在列表视图激活时生效
   * - approval: 在审批/确认对话框激活时生效
   */
  context?: ShortcutContext;
}

/** v7.0.0 新增：Codex 风格 7 个 context */
export type ShortcutContext =
  | 'global'
  | 'chat'
  | 'composer'
  | 'editor'
  | 'pager'
  | 'list'
  | 'approval';

export const ALL_CONTEXTS: ShortcutContext[] = [
  'global',
  'chat',
  'composer',
  'editor',
  'pager',
  'list',
  'approval',
];

/** 当前活跃 context 状态 */
let _activeContext: ShortcutContext = 'global';
const _contextListeners = new Set<(ctx: ShortcutContext) => void>();

/** v7.0.0 新增：设置当前活跃 context（被外部组件调用） */
export function setActiveShortcutContext(ctx: ShortcutContext): void {
  if (_activeContext === ctx) return;
  _activeContext = ctx;
  _contextListeners.forEach((fn) => fn(ctx));
}

/** v7.0.0 新增：获取当前活跃 context */
export function getActiveShortcutContext(): ShortcutContext {
  return _activeContext;
}

/** v7.0.0 新增：订阅 context 变化 */
export function subscribeShortcutContext(
  fn: (ctx: ShortcutContext) => void
): () => void {
  _contextListeners.add(fn);
  return () => {
    _contextListeners.delete(fn);
  };
}

// ============================================================
// 工具函数
// ============================================================

/** 解析快捷键组合字符串为标准化形式 */
export function parseShortcut(combo: string): ParsedShortcut {
  const parts = combo.toLowerCase().split(/[\s+]+/).filter(Boolean);
  const parsed: ParsedParsedShortcut = {
    key: '',
    ctrl: false,
    meta: false,
    shift: false,
    alt: false,
  };

  for (const part of parts) {
    switch (part) {
      case 'mod':
        // mod 在 macOS 上是 meta，在其他平台是 ctrl
        if (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform)) {
          parsed.meta = true;
        } else {
          parsed.ctrl = true;
        }
        break;
      case 'ctrl':
      case 'control':
        parsed.ctrl = true;
        break;
      case 'cmd':
      case 'meta':
      case 'super':
        parsed.meta = true;
        break;
      case 'shift':
        parsed.shift = true;
        break;
      case 'alt':
      case 'option':
        parsed.alt = true;
        break;
      default:
        // 最后一个非修饰键作为 key
        parsed.key = part;
    }
  }

  return parsed;
}

type ParsedParsedShortcut = ParsedShortcut;

/** 判断 KeyboardEvent 是否匹配 ParsedShortcut */
export function matchesShortcut(e: KeyboardEvent, parsed: ParsedShortcut): boolean {
  // 修饰键检查
  if (parsed.ctrl !== e.ctrlKey) return false;
  if (parsed.meta !== e.metaKey) return false;
  if (parsed.shift !== e.shiftKey) return false;
  if (parsed.alt !== e.altKey) return false;

  // 主键检查（normalize key）
  const eventKey = e.key.toLowerCase();
  return eventKey === parsed.key;
}

/** 序列检测：是否在 target 中 */
function isInEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

// ============================================================
// ShortcutManager 单例
// ============================================================

class ShortcutManagerImpl {
  private registrations: Map<string, ShortcutRegistration> = new Map();
  private boundHandler: (e: KeyboardEvent) => void;

  constructor() {
    this.boundHandler = this.handleKeyDown.bind(this);
  }

  /** 注册快捷键 */
  register(reg: ShortcutRegistration): () => void {
    this.registrations.set(reg.id, reg);
    if (this.registrations.size === 1) {
      window.addEventListener('keydown', this.boundHandler);
    }
    // 返回取消注册函数
    return () => {
      this.unregister(reg.id);
    };
  }

  /** 注销快捷键 */
  unregister(id: string): void {
    this.registrations.delete(id);
    if (this.registrations.size === 0) {
      window.removeEventListener('keydown', this.boundHandler);
    }
  }

  /** 获取所有注册 */
  getAll(): ShortcutRegistration[] {
    return Array.from(this.registrations.values());
  }

  /** 清空 */
  clear(): void {
    this.registrations.clear();
    window.removeEventListener('keydown', this.boundHandler);
  }

  /** 内部：键盘事件处理 */
  private handleKeyDown(e: KeyboardEvent): void {
    // 找出所有匹配的注册
    const matches: ShortcutRegistration[] = [];
    for (const reg of this.registrations.values()) {
      if (matchesShortcut(e, reg.parsed)) {
        matches.push(reg);
      }
    }
    if (matches.length === 0) return;

    // 按优先级排序（高 → 低）
    matches.sort((a, b) => b.priority - a.priority);

    // 检查输入框
    const inInput = isInEditableTarget(e.target);

    // v7.0.0：当前活跃 context，用于过滤非匹配的快捷键
    const active = _activeContext;

    // 找出第一个可用的注册：
    // 1) context 必须是 'global' 或与 active 匹配
    // 2) 在 input 中时，allowInInput 必须为 true
    for (const reg of matches) {
      if (reg.context !== 'global' && reg.context !== active) continue;
      if (inInput && !reg.allowInInput) continue;
      // 阻止默认行为 + 触发回调
      e.preventDefault();
      e.stopPropagation();
      try {
        reg.handler(e);
      } catch (err) {
        // 不让 handler 异常影响其他快捷键
        // eslint-disable-next-line no-console
        console.error(`[ShortcutManager] handler "${reg.id}" failed:`, err);
      }
      return; // 只触发第一个匹配的
    }
  }
}

/** 全局单例 */
let _shortcutManagerInstance: ShortcutManagerImpl | null = null;

export function getShortcutManager(): ShortcutManagerImpl {
  if (!_shortcutManagerInstance) {
    _shortcutManagerInstance = new ShortcutManagerImpl();
  }
  return _shortcutManagerInstance;
}

// ============================================================
// React Hook
// ============================================================

/**
 * 注册全局快捷键
 * @param id 唯一标识
 * @param combo 快捷键组合，如 "mod+k" / "mod+shift+p" / "escape" / "g g"
 * @param handler 触发回调
 * @param options 配置（allowInInput / description / priority / enabled）
 */
export function useShortcut(
  id: string,
  combo: string,
  handler: ShortcutHandler,
  options: UseShortcutOptions = {}
): void {
  const {
    allowInInput = false,
    description,
    priority = 0,
    enabled = true,
    context = 'global',
  } = options;
  // 使用 ref 存储最新的 handler，避免 handler 变化时重新注册
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;
    const manager = getShortcutManager();
    const stableHandler: ShortcutHandler = (e) => handlerRef.current(e);
    const unregister = manager.register({
      id,
      combo,
      parsed: parseShortcut(combo),
      handler: stableHandler,
      allowInInput,
      description,
      priority,
      context,
    });
    return unregister;
  }, [id, combo, allowInInput, description, priority, enabled, context]);
}

// ============================================================
// 预设快捷键（用于快捷键帮助面板）
// ============================================================

/** 常用快捷键预设 */
export const COMMON_SHORTCUTS = {
  NEW_CHAT: 'mod+n',
  TOGGLE_SIDEBAR: 'mod+b',
  TOGGLE_COMPOSER: 'mod+i',
  COMMAND_PALETTE: 'mod+k',
  SHOW_SHORTCUTS: 'mod+/',
  SUBMIT: 'mod+enter',
  ESCAPE: 'escape',
  NEXT_MESSAGE: 'mod+j',
  PREV_MESSAGE: 'mod+k',
  FOCUS_INPUT: '/',
  // v7.0.0 新增：Codex/Trae Solo 风格快捷键
  TOGGLE_PLAN_MODE: 'mod+shift+p',
  TOGGLE_AUTO_FOLLOW: 'mod+shift+f',
  NEW_TASK: 'mod+t',
  CLOSE_TASK: 'mod+w',
  NEXT_TASK: 'mod+alt+arrowright',
  PREV_TASK: 'mod+alt+arrowleft',
  TOGGLE_LEFT_PANEL: 'mod+1',
  TOGGLE_RIGHT_PANEL: 'mod+2',
  TOGGLE_TERMINAL: 'mod+`',
  TOGGLE_BROWSER: 'mod+shift+b',
  APPROVE: 'mod+y',
  REJECT: 'mod+n',
  CYCLE_THEME: 'mod+shift+t',
} as const;

/**
 * v7.0.0 新增：Codex 风格 keymap 描述
 * 用于快捷键帮助面板（⌘/）显示
 */
export const CODEX_KEYMAP_CONTEXTS: Array<{
  ctx: ShortcutContext;
  label: string;
  description: string;
  bindings: Array<{ combo: string; description: string }>;
}> = [
  {
    ctx: 'global',
    label: '全局 (Global)',
    description: '任何上下文都生效',
    bindings: [
      { combo: 'mod+k', description: '打开命令面板' },
      { combo: 'mod+/', description: '显示快捷键帮助' },
      { combo: 'mod+shift+t', description: '循环切换主题' },
      { combo: 'mod+b', description: '切换左侧历史' },
      { combo: 'mod+1', description: '切换左面板' },
      { combo: 'mod+2', description: '切换右面板' },
    ],
  },
  {
    ctx: 'chat',
    label: '对话 (Chat)',
    description: 'AI 对话主区域激活时',
    bindings: [
      { combo: 'mod+enter', description: '发送消息' },
      { combo: 'mod+n', description: '新建对话' },
      { combo: 'mod+shift+p', description: '切换 Plan 模式' },
      { combo: 'mod+shift+f', description: '切换 Auto-Follow' },
    ],
  },
  {
    ctx: 'composer',
    label: '输入框 (Composer)',
    description: '输入提示词时',
    bindings: [
      { combo: 'mod+enter', description: '提交' },
      { combo: 'shift+enter', description: '换行' },
      { combo: 'escape', description: '取消焦点' },
    ],
  },
  {
    ctx: 'editor',
    label: '编辑器 (Editor)',
    description: '文件编辑器激活时',
    bindings: [
      { combo: 'mod+s', description: '保存文件' },
      { combo: 'mod+/', description: '注释切换' },
    ],
  },
  {
    ctx: 'pager',
    label: '分页 (Pager)',
    description: '长列表/分页模式',
    bindings: [
      { combo: 'j', description: '下一项' },
      { combo: 'k', description: '上一项' },
      { combo: 'g g', description: '跳到顶部' },
      { combo: 'shift+g', description: '跳到底部' },
    ],
  },
  {
    ctx: 'list',
    label: '列表 (List)',
    description: '会话历史/任务列表',
    bindings: [
      { combo: 'arrowup/arrowdown', description: '上下选择' },
      { combo: 'enter', description: '打开' },
      { combo: 'mod+delete', description: '删除' },
    ],
  },
  {
    ctx: 'approval',
    label: '审批 (Approval)',
    description: '命令/代码审批弹窗',
    bindings: [
      { combo: 'mod+y', description: '批准' },
      { combo: 'mod+n', description: '拒绝' },
      { combo: 'escape', description: '取消' },
    ],
  },
];

export default useShortcut;
