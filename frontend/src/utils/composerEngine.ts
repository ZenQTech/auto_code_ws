/**
 * # ============================================================
 * Composer 引擎 (v6.36.0 Cycle 16 P0-1)
 * # ============================================================
 * 核心作用：实现 Cursor Composer 风格的多文件协调编辑引擎
 * 运行流程：
 *   1. 解析 @ 引用上下文 (@File / @Folder / @Code / @Docs)
 *   2. 根据 prompt + context 生成多文件编辑计划
 *   3. 逐文件管理 diff（pending/accepted/rejected/modified）
 *   4. 创建检查点快照，支持回滚
 *   5. 跨文件 Undo/Redo
 * 输入参数：ComposerPrompt + ComposerContext
 * 输出结果：ComposerSession（含多个 ComposerEdit）
 * ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 16 P0-1 初次创建
 * #   - 2026-07-29 | v1.1.0 | P1-5 UI 状态下沉到引擎
 * #     - 新增 ComposerUIState（isOpen / isFullscreen）
 * #     - 新增 openPanel / closePanel / togglePanel / setFullscreen / toggleFullscreen
 * #     - 新增 subscribeUI 订阅 UI 变化
 * #     - 解决 useComposer 在多组件调用时状态不同步问题
 * # ============================================================
 */

// ============================================================
// 类型定义
// ============================================================

/** 上下文条目类型 */
export type ContextType = 'file' | 'folder' | 'symbol' | 'docs' | 'web' | 'codebase' | 'git' | 'diff';

// 重新导出扩展引用类型，便于其他模块使用
export type {
  CodebaseContext,
  CodebaseResult,
  GitContext,
  GitRefKind,
  GitCommit,
  GitBlameInfo,
  DiffContext,
  DiffFile,
  DiffHunk,
} from './referenceResolvers';

/** 文件上下文 */
export interface FileContext {
  type: 'file';
  path: string;
  content: string;
  language: string;
}

/** 文件夹上下文 */
export interface FolderContext {
  type: 'folder';
  path: string;
  recursive: boolean;
  fileCount: number;
}

/** 符号上下文（函数/类/变量） */
export interface SymbolContext {
  type: 'symbol';
  name: string;
  kind: 'function' | 'class' | 'variable' | 'type' | 'interface';
  filePath: string;
  line: number;
  snippet: string;
}

/** 文档上下文 */
export interface DocContext {
  type: 'docs';
  url: string;
  title: string;
  content: string;
}

/** Web 上下文 */
export interface WebContext {
  type: 'web';
  query: string;
  results: Array<{ title: string; url: string; snippet: string }>;
}

/** 统一上下文条目 */
export type ContextEntry =
  | FileContext
  | FolderContext
  | SymbolContext
  | DocContext
  | WebContext
  | import('./referenceResolvers').CodebaseContext
  | import('./referenceResolvers').GitContext
  | import('./referenceResolvers').DiffContext;

/** Composer 上下文 */
export interface ComposerContext {
  files: FileContext[];
  folders: FolderContext[];
  symbols: SymbolContext[];
  docs: DocContext[];
  web: WebContext[];
  codebase: import('./referenceResolvers').CodebaseContext[];
  git: import('./referenceResolvers').GitContext[];
  diff: import('./referenceResolvers').DiffContext[];
}

/** 编辑状态 */
export type EditStatus = 'pending' | 'accepted' | 'rejected' | 'modified';

/** Composer 编辑 */
export interface ComposerEdit {
  id: string;
  filePath: string;
  beforeContent: string;
  afterContent: string;
  description: string;
  status: EditStatus;
  feedback?: string;
  createdAt: number;
  appliedAt?: number;
}

/** 快照 */
export interface Snapshot {
  id: string;
  files: Record<string, string>;  // path -> content
  timestamp: number;
  description: string;
}

/** Composer Session */
export interface ComposerSession {
  id: string;
  prompt: string;
  context: ComposerContext;
  edits: ComposerEdit[];
  snapshots: Snapshot[];
  cursor: number;  // 在 snapshots 中的位置
  createdAt: number;
  updatedAt: number;
}

/** @ 引用解析结果 */
export interface ParsedReference {
  type: ContextType;
  value: string;
  raw: string;  // 原始 @xxx 字符串
  position: number;  // 在 prompt 中的位置
}

// ============================================================
// @ 引用解析器
// ============================================================

/**
 * 解析 prompt 中的 @ 引用
 * 支持语法：
 *   - @file:src/components/Foo.tsx
 *   - @folder:src/utils
 *   - @code:handleSubmit
 *   - @codebase:user authentication (允许空格)
 *   - @docs:https://react.dev
 *   - @web:hook usage (允许空格)
 *   - @git:log?file=src/auth.ts&line=42 (允许 ? & =)
 *   - @diff
 *   - @diff:HEAD
 *   - @diff:abc1234
 * 注意：value 规则按类型区分
 *   - file/folder/code：排除空格/逗号/分号/句号
 *   - codebase/web：允许空格
 *   - docs：允许 URL（含 .）
 *   - git/diff：允许 query string 字符
 */
export function parseReferences(prompt: string): ParsedReference[] {
  const refs: ParsedReference[] = [];
  // 多模式匹配：每种类型使用对应的 value 规则
  const patterns: Array<{ type: ContextType; regex: RegExp }> = [
    {
      type: 'file' as ContextType,
      regex: /@(file|File):([^\s,;.]+)/g,
    },
    {
      type: 'folder' as ContextType,
      regex: /@(folder|Folder):([^\s,;.]+)/g,
    },
    {
      type: 'symbol' as ContextType,
      regex: /@(code|Code):([^\s,;.]+)/g,
    },
    {
      type: 'codebase' as ContextType,
      regex: /@(codebase|Codebase):([a-zA-Z0-9 _\-./+]{1,200})/g,
    },
    {
      type: 'web' as ContextType,
      regex: /@(web|Web):([a-zA-Z0-9 _\-./+?&=]{1,200})/g,
    },
    {
      type: 'docs' as ContextType,
      regex: /@(docs|Docs):(\S+)/g,
    },
    {
      type: 'git' as ContextType,
      regex: /@(git|Git):([^\s,;]+)/g,
    },
    {
      type: 'diff' as ContextType,
      regex: /@(DIFF|diff|Diff):?(\S*)/g,
    },
  ];

  for (const { type, regex } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(prompt)) !== null) {
      const value = (match[2] || '').trim();
      refs.push({
        type,
        value,
        raw: match[0],
        position: match.index,
      });
    }
  }

  // 按 position 排序
  refs.sort((a, b) => a.position - b.position);
  return refs;
}

// ============================================================
// ID 生成
// ============================================================
let _idCounter = 0;
function _genId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${_idCounter.toString(36)}`;
}

// ============================================================
// 扩展引用解析（异步） - G18-01
// ============================================================

import {
  resolveCodebase,
  resolveGit,
  resolveDiff,
  type CodebaseContext,
  type GitContext,
  type DiffContext,
  type GitRefKind,
} from './referenceResolvers';

/** 解析 git 子命令及参数 */
export function parseGitRef(value: string): { ref: GitRefKind; file?: string; line?: number } {
  // 支持 @git:log?file=src/auth.ts&line=42 形式
  // 也支持 @git:log (默认)
  const trimmed = value.trim();
  if (!trimmed) return { ref: 'log' };

  // 解析 query string
  const [refPart, queryStr] = trimmed.split('?');
  const ref = (refPart || 'log') as GitRefKind;

  const result: { ref: GitRefKind; file?: string; line?: number } = { ref };

  if (queryStr) {
    const params = new URLSearchParams(queryStr);
    if (params.has('file')) result.file = params.get('file') || undefined;
    if (params.has('line')) {
      const ln = parseInt(params.get('line') || '0', 10);
      if (!isNaN(ln)) result.line = ln;
    }
  }

  return result;
}

/** 解析 diff ref */
export function parseDiffRef(value: string): string {
  return (value || 'working').trim();
}

/**
 * 解析并解析 prompt 中的 @ 引用（异步）
 * 支持：
 *   - @codebase:query
 *   - @git:log[?file=...][&line=...]
 *   - @git:blame[?file=...&line=...]
 *   - @diff[:ref]
 */
export async function parseAndResolveReferences(
  prompt: string,
  options?: {
    codebaseTopK?: number;
    gitLimit?: number;
    apiBase?: string;
  }
): Promise<{
  references: ParsedReference[];
  resolved: {
    codebase: CodebaseContext[];
    git: GitContext[];
    diff: DiffContext[];
  };
  errors: Array<{ ref: string; error: string }>;
}> {
  const refs = parseReferences(prompt);
  const errors: Array<{ ref: string; error: string }> = [];
  const codebase: CodebaseContext[] = [];
  const git: GitContext[] = [];
  const diff: DiffContext[] = [];

  // 并发解析
  const promises: Promise<void>[] = [];

  for (const ref of refs) {
    if (ref.type === 'codebase') {
      promises.push(
        resolveCodebase(ref.value, {
          topK: options?.codebaseTopK,
          apiBase: options?.apiBase,
        })
          .then((ctx) => {
            codebase.push(ctx);
          })
          .catch((err) => {
            errors.push({ ref: ref.raw, error: String(err) });
          })
      );
    } else if (ref.type === 'git') {
      const parsed = parseGitRef(ref.value);
      promises.push(
        resolveGit(parsed.ref, {
          filePath: parsed.file,
          line: parsed.line,
          limit: options?.gitLimit,
          apiBase: options?.apiBase,
        })
          .then((ctx) => {
            git.push(ctx);
          })
          .catch((err) => {
            errors.push({ ref: ref.raw, error: String(err) });
          })
      );
    } else if (ref.type === 'diff') {
      const diffRef = parseDiffRef(ref.value);
      promises.push(
        resolveDiff(diffRef, { apiBase: options?.apiBase })
          .then((ctx) => {
            diff.push(ctx);
          })
          .catch((err) => {
            errors.push({ ref: ref.raw, error: String(err) });
          })
      );
    }
  }

  await Promise.all(promises);

  return { references: refs, resolved: { codebase, git, diff }, errors };
}

// ============================================================
// Composer 引擎
// ============================================================

/**
 * UI 状态：是否打开 / 是否全屏
 * 存储在 engine 中以支持跨组件共享
 */
export interface ComposerUIState {
  isOpen: boolean;
  isFullscreen: boolean;
}

/**
 * Composer 引擎：管理多文件编辑的核心逻辑
 */
export class ComposerEngine {
  private session: ComposerSession;
  private ui: ComposerUIState;
  private subscribers: Set<(session: ComposerSession) => void> = new Set();
  private uiSubscribers: Set<(ui: ComposerUIState) => void> = new Set();

  constructor() {
    this.session = this._createEmptySession();
    this.ui = { isOpen: false, isFullscreen: false };
  }

  // ============================================================
  // Session 管理
  // ============================================================

  private _createEmptySession(): ComposerSession {
    const now = Date.now();
    return {
      id: _genId('session'),
      prompt: '',
      context: {
        files: [],
        folders: [],
        symbols: [],
        docs: [],
        web: [],
        codebase: [],
        git: [],
        diff: [],
      },
      edits: [],
      snapshots: [],
      cursor: -1,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** 获取当前 session */
  getSession(): ComposerSession {
    return { ...this.session };
  }

  /** 设置 prompt */
  setPrompt(prompt: string): void {
    this.session.prompt = prompt;
    this.session.updatedAt = Date.now();
    this._notify();
  }

  /** 添加上下文条目 */
  addContext(entry: ContextEntry): void {
    switch (entry.type) {
      case 'file':
        this.session.context.files.push(entry);
        break;
      case 'folder':
        this.session.context.folders.push(entry);
        break;
      case 'symbol':
        this.session.context.symbols.push(entry);
        break;
      case 'docs':
        this.session.context.docs.push(entry);
        break;
      case 'web':
        this.session.context.web.push(entry);
        break;
      case 'codebase':
        this.session.context.codebase.push(entry);
        break;
      case 'git':
        this.session.context.git.push(entry);
        break;
      case 'diff':
        this.session.context.diff.push(entry);
        break;
    }
    this.session.updatedAt = Date.now();
    this._notify();
  }

  /** 移除上下文条目 */
  removeContext(type: ContextType, identifier: string): void {
    switch (type) {
      case 'file':
        this.session.context.files = this.session.context.files.filter(
          (e) => e.path !== identifier
        );
        break;
      case 'folder':
        this.session.context.folders = this.session.context.folders.filter(
          (e) => e.path !== identifier
        );
        break;
      case 'symbol':
        this.session.context.symbols = this.session.context.symbols.filter(
          (e) => e.name !== identifier
        );
        break;
      case 'docs':
        this.session.context.docs = this.session.context.docs.filter(
          (e) => e.url !== identifier
        );
        break;
      case 'web':
        this.session.context.web = this.session.context.web.filter(
          (e) => e.query !== identifier
        );
        break;
      case 'codebase':
        this.session.context.codebase = this.session.context.codebase.filter(
          (e) => e.query !== identifier
        );
        break;
      case 'git':
        this.session.context.git = this.session.context.git.filter(
          (e) => `${e.ref}:${e.filePath ?? ''}` !== identifier
        );
        break;
      case 'diff':
        this.session.context.diff = this.session.context.diff.filter(
          (e) => e.ref !== identifier
        );
        break;
    }
    this.session.updatedAt = Date.now();
    this._notify();
  }

  /** 清空上下文 */
  clearContext(): void {
    this.session.context = {
      files: [],
      folders: [],
      symbols: [],
      docs: [],
      web: [],
      codebase: [],
      git: [],
      diff: [],
    };
    this.session.updatedAt = Date.now();
    this._notify();
  }

  // ============================================================
  // 编辑管理
  // ============================================================

  /**
   * 添加编辑（通常由 plan() 生成）
   */
  addEdit(edit: Omit<ComposerEdit, 'id' | 'status' | 'createdAt'>): ComposerEdit {
    const fullEdit: ComposerEdit = {
      ...edit,
      id: _genId('edit'),
      status: 'pending',
      createdAt: Date.now(),
    };
    this.session.edits.push(fullEdit);
    this.session.updatedAt = Date.now();
    this._notify();
    return fullEdit;
  }

  /** 接受编辑 */
  acceptEdit(editId: string): void {
    const edit = this.session.edits.find((e) => e.id === editId);
    if (!edit) return;
    edit.status = 'accepted';
    edit.appliedAt = Date.now();
    this.session.updatedAt = Date.now();
    this._notify();
  }

  /** 拒绝编辑 */
  rejectEdit(editId: string, feedback?: string): void {
    const edit = this.session.edits.find((e) => e.id === editId);
    if (!edit) return;
    edit.status = 'rejected';
    edit.feedback = feedback;
    this.session.updatedAt = Date.now();
    this._notify();
  }

  /** 修改编辑内容 */
  modifyEdit(editId: string, newAfterContent: string, description?: string): void {
    const edit = this.session.edits.find((e) => e.id === editId);
    if (!edit) return;
    edit.afterContent = newAfterContent;
    if (description) edit.description = description;
    edit.status = 'modified';
    this.session.updatedAt = Date.now();
    this._notify();
  }

  /** 接受所有 pending 编辑 */
  acceptAll(): void {
    let changed = false;
    for (const edit of this.session.edits) {
      if (edit.status === 'pending' || edit.status === 'modified') {
        edit.status = 'accepted';
        edit.appliedAt = Date.now();
        changed = true;
      }
    }
    if (changed) {
      this.session.updatedAt = Date.now();
      this._notify();
    }
  }

  /** 拒绝所有 pending 编辑 */
  rejectAll(): void {
    let changed = false;
    for (const edit of this.session.edits) {
      if (edit.status === 'pending' || edit.status === 'modified') {
        edit.status = 'rejected';
        changed = true;
      }
    }
    if (changed) {
      this.session.updatedAt = Date.now();
      this._notify();
    }
  }

  /** 清除所有编辑 */
  clearEdits(): void {
    this.session.edits = [];
    this.session.updatedAt = Date.now();
    this._notify();
  }

  // ============================================================
  // 快照与回滚
  // ============================================================

  /**
   * 创建快照（当前所有已接受编辑应用后的状态）
   * @param description 快照描述
   * @param fileStates 当前各文件内容（由调用方提供）
   */
  createSnapshot(description: string, fileStates: Record<string, string>): Snapshot {
    const snapshot: Snapshot = {
      id: _genId('snapshot'),
      files: { ...fileStates },
      timestamp: Date.now(),
      description,
    };
    // 截断 cursor 之后的快照（保证线性历史）
    if (this.session.cursor < this.session.snapshots.length - 1) {
      this.session.snapshots = this.session.snapshots.slice(0, this.session.cursor + 1);
    }
    this.session.snapshots.push(snapshot);
    this.session.cursor = this.session.snapshots.length - 1;
    this.session.updatedAt = Date.now();
    this._notify();
    return snapshot;
  }

  /** 撤销（回到上一个快照） */
  undo(): Snapshot | null {
    if (this.session.cursor <= 0) return null;
    this.session.cursor -= 1;
    this.session.updatedAt = Date.now();
    this._notify();
    return this.session.snapshots[this.session.cursor];
  }

  /** 重做（前进到下一个快照） */
  redo(): Snapshot | null {
    if (this.session.cursor >= this.session.snapshots.length - 1) return null;
    this.session.cursor += 1;
    this.session.updatedAt = Date.now();
    this._notify();
    return this.session.snapshots[this.session.cursor];
  }

  /** 回滚到指定快照 */
  rollback(snapshotId: string): Snapshot | null {
    const idx = this.session.snapshots.findIndex((s) => s.id === snapshotId);
    if (idx === -1) return null;
    this.session.cursor = idx;
    this.session.updatedAt = Date.now();
    this._notify();
    return this.session.snapshots[idx];
  }

  /** 获取当前快照 */
  getCurrentSnapshot(): Snapshot | null {
    if (this.session.cursor < 0) return null;
    return this.session.snapshots[this.session.cursor];
  }

  // ============================================================
  // 订阅
  // ============================================================

  /** 订阅 session 变化 */
  subscribe(callback: (session: ComposerSession) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  // ============================================================
  // UI 状态（面板开关 / 全屏）
  // ============================================================

  /** 获取 UI 状态 */
  getUIState(): ComposerUIState {
    return { ...this.ui };
  }

  /** 打开面板 */
  openPanel(): void {
    this.ui.isOpen = true;
    this._notifyUI();
  }

  /** 关闭面板 */
  closePanel(): void {
    this.ui.isOpen = false;
    this._notifyUI();
  }

  /** 切换面板 */
  togglePanel(): void {
    this.ui.isOpen = !this.ui.isOpen;
    this._notifyUI();
  }

  /** 设置全屏 */
  setFullscreen(fullscreen: boolean): void {
    this.ui.isFullscreen = fullscreen;
    this._notifyUI();
  }

  /** 切换全屏 */
  toggleFullscreen(): void {
    this.ui.isFullscreen = !this.ui.isFullscreen;
    this._notifyUI();
  }

  /** 订阅 UI 变化 */
  subscribeUI(callback: (ui: ComposerUIState) => void): () => void {
    this.uiSubscribers.add(callback);
    return () => this.uiSubscribers.delete(callback);
  }

  private _notifyUI(): void {
    const uiSnapshot = this.getUIState();
    for (const cb of this.uiSubscribers) {
      cb(uiSnapshot);
    }
  }

  private _notify(): void {
    const snapshot = this.getSession();
    for (const cb of this.subscribers) {
      cb(snapshot);
    }
  }

  // ============================================================
  // 工具方法
  // ============================================================

  /** 获取 pending 编辑数量 */
  getPendingCount(): number {
    return this.session.edits.filter(
      (e) => e.status === 'pending' || e.status === 'modified'
    ).length;
  }

  /** 获取 accepted 编辑数量 */
  getAcceptedCount(): number {
    return this.session.edits.filter((e) => e.status === 'accepted').length;
  }

  /** 获取 rejected 编辑数量 */
  getRejectedCount(): number {
    return this.session.edits.filter((e) => e.status === 'rejected').length;
  }

  /** 是否可以 undo */
  canUndo(): boolean {
    return this.session.cursor > 0;
  }

  /** 是否可以 redo */
  canRedo(): boolean {
    return this.session.cursor < this.session.snapshots.length - 1;
  }

  /** 重置 session */
  reset(): void {
    this.session = this._createEmptySession();
    this._notify();
  }

  /** 销毁 */
  destroy(): void {
    this.subscribers.clear();
    this.uiSubscribers.clear();
  }
}

// ============================================================
// 工厂函数
// ============================================================
export function createComposerEngine(): ComposerEngine {
  return new ComposerEngine();
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 从 prompt 中提取 @ 引用并自动添加到 context
 * @param engine ComposerEngine
 * @param prompt 用户输入
 * @param resolvers 各类型 resolver（从引用值到完整上下文）
 */
export async function autoResolveReferences(
  engine: ComposerEngine,
  prompt: string,
  resolvers: {
    file?: (path: string) => Promise<FileContext | null>;
    folder?: (path: string, recursive: boolean) => Promise<FolderContext | null>;
    symbol?: (name: string) => Promise<SymbolContext[]>;
    docs?: (url: string) => Promise<DocContext | null>;
    web?: (query: string) => Promise<WebContext | null>;
  }
): Promise<ParsedReference[]> {
  const refs = parseReferences(prompt);
  for (const ref of refs) {
    try {
      switch (ref.type) {
        case 'file':
          if (resolvers.file) {
            const ctx = await resolvers.file(ref.value);
            if (ctx) engine.addContext(ctx);
          }
          break;
        case 'folder':
          if (resolvers.folder) {
            const ctx = await resolvers.folder(ref.value, true);
            if (ctx) engine.addContext(ctx);
          }
          break;
        case 'symbol':
          if (resolvers.symbol) {
            const results = await resolvers.symbol(ref.value);
            for (const r of results) engine.addContext(r);
          }
          break;
        case 'docs':
          if (resolvers.docs) {
            const ctx = await resolvers.docs(ref.value);
            if (ctx) engine.addContext(ctx);
          }
          break;
        case 'web':
          if (resolvers.web) {
            const ctx = await resolvers.web(ref.value);
            if (ctx) engine.addContext(ctx);
          }
          break;
      }
    } catch (err) {
      console.warn(`Failed to resolve ${ref.type}:${ref.value}`, err);
    }
  }
  return refs;
}

/**
 * 序列化 session 为 JSON
 */
export function serializeSession(session: ComposerSession): string {
  return JSON.stringify(session, null, 2);
}

/**
 * 从 JSON 反序列化 session
 */
export function deserializeSession(json: string): ComposerSession | null {
  try {
    return JSON.parse(json) as ComposerSession;
  } catch {
    return null;
  }
}

export default ComposerEngine;
