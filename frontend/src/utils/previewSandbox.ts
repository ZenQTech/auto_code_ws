/**
 * # ============================================================
 * Preview Sandbox 工具 (v6.37.0 Cycle 17 P0-3)
 * # ============================================================
 * 核心作用：实现 Composer 的代码预览沙箱
 * 设计要点：
 *   - 3 种渲染模式：html / react / iframe
 *   - iframe sandbox 隔离
 *   - console 桥接
 *   - 错误捕获
 *   - 防抖更新
 * ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 17 P0-3 初次创建
 * ============================================================
 */

// ============================================================
// 类型定义
// ============================================================

export type PreviewMode = 'html' | 'react' | 'iframe';

export type PreviewStatus = 'idle' | 'compiling' | 'ready' | 'error';

export interface PreviewError {
  type: 'syntax' | 'runtime' | 'network' | 'unknown';
  message: string;
  line?: number;
  column?: number;
  stack?: string;
}

export interface PreviewConfig {
  mode: PreviewMode;
  /** 是否允许脚本 */
  allowScripts?: boolean;
  /** 是否允许同源 */
  allowSameOrigin?: boolean;
  /** 防抖延迟（ms） */
  debounceMs?: number;
}

export interface PreviewSnapshot {
  id: string;
  files: Record<string, string>;
  renderedHtml: string;
  status: PreviewStatus;
  error: PreviewError | null;
  createdAt: number;
}

const DEFAULT_CONFIG: Required<PreviewConfig> = {
  mode: 'html',
  allowScripts: true,
  allowSameOrigin: true,
  debounceMs: 500,
};

// ============================================================
// 工具函数
// ============================================================

/**
 * 检测文件类型
 */
export function detectFileType(filename: string): 'html' | 'react' | 'js' | 'css' | 'json' | 'other' {
  if (filename.endsWith('.html') || filename.endsWith('.htm')) return 'html';
  if (filename.endsWith('.tsx') || filename.endsWith('.jsx')) return 'react';
  if (filename.endsWith('.js') || filename.endsWith('.ts')) return 'js';
  if (filename.endsWith('.css')) return 'css';
  if (filename.endsWith('.json')) return 'json';
  return 'other';
}

/**
 * 生成 HTML 预览内容（html 模式）
 */
export function buildHtmlPreview(html: string, _config: Required<PreviewConfig>): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fff; color: #000; }
  .preview-error { color: #c00; padding: 12px; background: #fee; border-radius: 4px; }
</style>
</head>
<body>
${html}
</body>
</html>`;
}

/**
 * 生成 React 沙箱 HTML（react 模式）
 */
export function buildReactPreview(code: string, _config: Required<PreviewConfig>): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>body{margin:0;padding:16px;font-family:sans-serif}</style>
<script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head>
<body>
<div id="root"></div>
<script type="text/babel">
${code}
const root = ReactDOM.createRoot(document.getElementById('root'));
try {
  if (typeof App === 'function') {
    root.render(<App />);
  } else {
    document.getElementById('root').innerHTML = '<div>未检测到 App 组件</div>';
  }
} catch (err) {
  document.getElementById('root').innerHTML = '<div class="preview-error">渲染错误: ' + err.message + '</div>';
  window.parent.postMessage({ type: 'preview-error', error: { type: 'runtime', message: err.message, stack: err.stack } }, '*');
}
</script>
</body>
</html>`;
}

/**
 * 生成 iframe 沙箱 HTML（多文件模式）
 */
export function buildIframePreview(files: Record<string, string>, config: Required<PreviewConfig>): string {
  const htmlFile = files['index.html'] || files['index.htm'] || Object.values(files).find((c) => c.includes('<html')) || '';
  return buildHtmlPreview(htmlFile, config);
}

/**
 * 构造沙箱属性
 */
export function buildSandboxAttr(config: Required<PreviewConfig>): string {
  const parts: string[] = [];
  if (config.allowScripts) parts.push('allow-scripts');
  if (config.allowSameOrigin) parts.push('allow-same-origin');
  return parts.join(' ');
}

/**
 * 验证 HTML 内容（基础）
 */
export function validateHtml(html: string): { valid: boolean; error: PreviewError | null } {
  if (!html || !html.trim()) {
    return { valid: false, error: { type: 'unknown', message: '内容为空' } };
  }
  return { valid: true, error: null };
}

/**
 * 防抖
 */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number
): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = ((...args: any[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }) as T & { cancel: () => void };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
  };
  return debounced;
}

// ============================================================
// SandboxManager - 沙箱管理
// ============================================================

export class SandboxManager {
  private iframe: HTMLIFrameElement | null = null;
  private config: Required<PreviewConfig>;
  private currentFiles: Record<string, string> = {};
  private updateDebounced: ((files: Record<string, string>) => void) & { cancel: () => void };
  private listeners: Set<(snapshot: PreviewSnapshot) => void> = new Set();
  private consoleListener: ((event: MessageEvent) => void) | null = null;
  private lastSnapshot: PreviewSnapshot | null = null;

  constructor(config: PreviewConfig = { mode: 'html' }) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.updateDebounced = debounce(
      (files: Record<string, string>) => this._doUpdate(files),
      this.config.debounceMs
    );
  }

  /** 绑定 iframe 元素 */
  attach(iframe: HTMLIFrameElement): void {
    this.iframe = iframe;
    this._setupConsoleBridge();
  }

  /** 解绑 */
  detach(): void {
    if (this.consoleListener) {
      window.removeEventListener('message', this.consoleListener);
      this.consoleListener = null;
    }
    this.iframe = null;
  }

  /** 更新文件 */
  update(files: Record<string, string>): void {
    this.currentFiles = { ...files };
    this.updateDebounced(files);
  }

  /** 立即更新（无防抖） */
  updateNow(files: Record<string, string>): void {
    this.updateDebounced.cancel();
    this.currentFiles = { ...files };
    this._doUpdate(files);
  }

  /** 重置 */
  reset(): void {
    this.updateDebounced.cancel();
    this.currentFiles = {};
    const resetSnap: PreviewSnapshot = {
      id: 'reset',
      files: {},
      renderedHtml: '',
      status: 'idle',
      error: null,
      createdAt: Date.now(),
    };
    this.lastSnapshot = resetSnap;
    this._emit(resetSnap);
  }

  /** 获取当前快照 */
  getSnapshot(): PreviewSnapshot | null {
    return this.lastSnapshot;
  }

  /** 订阅快照变化 */
  subscribe(callback: (snapshot: PreviewSnapshot) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** 获取当前配置 */
  getConfig(): Required<PreviewConfig> {
    return { ...this.config };
  }

  /** 更新配置 */
  setConfig(config: Partial<PreviewConfig>): void {
    this.config = { ...this.config, ...config };
    // 重新构造 debounce
    this.updateDebounced = debounce(
      (files: Record<string, string>) => this._doUpdate(files),
      this.config.debounceMs
    );
  }

  /** 销毁 */
  destroy(): void {
    this.detach();
    this.updateDebounced.cancel();
    this.listeners.clear();
  }

  // ============================================================
  // 内部
  // ============================================================

  private _doUpdate(files: Record<string, string>): void {
    if (!this.iframe) {
      const errSnap: PreviewSnapshot = {
        id: `snap_${Date.now()}`,
        files,
        renderedHtml: '',
        status: 'error',
        error: { type: 'unknown', message: 'iframe 未绑定' },
        createdAt: Date.now(),
      };
      this.lastSnapshot = errSnap;
      this._emit(errSnap);
      return;
    }

    try {
      let html = '';
      switch (this.config.mode) {
        case 'html':
          html = buildHtmlPreview(files['index.html'] || Object.values(files)[0] || '', this.config);
          break;
        case 'react':
          html = buildReactPreview(
            files['App.tsx'] || files['App.jsx'] || Object.values(files)[0] || '',
            this.config
          );
          break;
        case 'iframe':
          html = buildIframePreview(files, this.config);
          break;
      }

      this.iframe.srcdoc = html;

      this.lastSnapshot = {
        id: `snap_${Date.now()}`,
        files: { ...files },
        renderedHtml: html,
        status: 'ready',
        error: null,
        createdAt: Date.now(),
      };
      this._emit(this.lastSnapshot);
    } catch (err) {
      const error: PreviewError = {
        type: 'syntax',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      };
      this.lastSnapshot = {
        id: `snap_${Date.now()}`,
        files: { ...files },
        renderedHtml: '',
        status: 'error',
        error,
        createdAt: Date.now(),
      };
      this._emit(this.lastSnapshot);
    }
  }

  private _setupConsoleBridge(): void {
    this.consoleListener = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'preview-error' && event.data.error) {
        this.lastSnapshot = {
          ...(this.lastSnapshot ?? {
            id: `snap_${Date.now()}`,
            files: this.currentFiles,
            renderedHtml: '',
            status: 'error',
            error: null,
            createdAt: Date.now(),
          }),
          status: 'error',
          error: event.data.error,
        };
        this._emit(this.lastSnapshot);
      }
    };
    window.addEventListener('message', this.consoleListener);
  }

  private _emit(snapshot: PreviewSnapshot): void {
    for (const cb of this.listeners) {
      try {
        cb(snapshot);
      } catch (err) {
        console.error('SandboxManager listener error:', err);
      }
    }
  }
}

// ============================================================
// 工厂函数
// ============================================================

export function createSandboxManager(config?: PreviewConfig): SandboxManager {
  return new SandboxManager(config);
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 创建快照
 */
export function createSnapshot(files: Record<string, string>, html: string, status: PreviewStatus = 'ready'): PreviewSnapshot {
  return {
    id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    files,
    renderedHtml: html,
    status,
    error: null,
    createdAt: Date.now(),
  };
}

/**
 * 比较快照差异
 */
export function diffSnapshots(a: PreviewSnapshot, b: PreviewSnapshot): {
  added: string[];
  removed: string[];
  changed: string[];
} {
  const aFiles = new Set(Object.keys(a.files));
  const bFiles = new Set(Object.keys(b.files));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const f of bFiles) {
    if (!aFiles.has(f)) {
      added.push(f);
    } else if (a.files[f] !== b.files[f]) {
      changed.push(f);
    }
  }
  for (const f of aFiles) {
    if (!bFiles.has(f)) removed.push(f);
  }
  return { added, removed, changed };
}
