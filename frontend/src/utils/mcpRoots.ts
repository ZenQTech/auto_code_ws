/**
 * # ============================================================
 * # MCP Roots - 根目录管理 (v1.0.0 Cycle 41 G41-04)
 * # ============================================================
 * # 核心作用：管理客户端根目录列表
 * #           - 根目录增删改
 * #           - 推送变更通知
 * #           - 路径校验
 * #           - 持久化支持
 * # 协议参考：MCP 2024-11-05 roots
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 41 G41-04 初次创建
 * # ============================================================
 */

import type { McpClient } from './mcpClient';

/**
 * 根目录
 */
export interface Root {
  /** 根目录 URI（file:// 或其他协议） */
  uri: string;
  /** 人类可读名称（可选） */
  name?: string;
}

/**
 * 根目录变更通知
 */
export interface RootsListChangedNotification {
  jsonrpc: '2.0';
  method: 'notifications/roots/list_changed';
  params?: Record<string, never>;
}

/**
 * 根目录事件
 */
export type RootEvent =
  | { type: 'added'; root: Root; at: number }
  | { type: 'removed'; root: Root; at: number }
  | { type: 'updated'; root: Root; previous: Root; at: number }
  | { type: 'cleared'; at: number };

export type RootEventListener = (event: RootEvent) => void;

/**
 * URI 解析结果
 */
export interface ParsedRootUri {
  protocol: string;
  path: string;
  valid: boolean;
}

/**
 * 解析根目录 URI
 */
export function parseRootUri(uri: string): ParsedRootUri {
  if (!uri || typeof uri !== 'string') {
    return { protocol: '', path: '', valid: false };
  }
  const match = uri.match(/^([a-z][a-z0-9+.-]*):\/\/(.+)$/i);
  if (!match) {
    return { protocol: '', path: uri, valid: false };
  }
  return {
    protocol: match[1],
    path: match[2],
    valid: true,
  };
}

/**
 * 校验根目录 URI
 */
export function validateRootUri(uri: string): boolean {
  return parseRootUri(uri).valid;
}

/**
 * 规范化根目录（去除末尾斜杠）
 */
export function normalizeRootUri(uri: string): string {
  const parsed = parseRootUri(uri);
  if (!parsed.valid) return uri;
  return `${parsed.protocol}://${parsed.path.replace(/\/+$/, '')}`;
}

/**
 * 根目录管理器
 */
export class RootsManager {
  private roots: Map<string, Root> = new Map();
  private listeners: Set<RootEventListener> = new Set();
  private client: McpClient | null = null;
  private autoNotify: boolean;

  constructor(options: { autoNotify?: boolean } = {}) {
    this.autoNotify = options.autoNotify ?? true;
  }

  /**
   * 绑定客户端
   */
  attachClient(client: McpClient | null): void {
    this.client = client;
  }

  /**
   * 添加根目录
   */
  add(root: Root): boolean {
    if (!validateRootUri(root.uri)) {
      throw new Error(`Invalid root URI: ${root.uri}`);
    }
    const normalized = normalizeRootUri(root.uri);
    if (this.roots.has(normalized)) {
      return false;
    }
    this.roots.set(normalized, { ...root, uri: normalized });
    this.emit({ type: 'added', root: this.roots.get(normalized)!, at: Date.now() });
    this.notifyChange();
    return true;
  }

  /**
   * 移除根目录
   */
  remove(uri: string): boolean {
    const normalized = normalizeRootUri(uri);
    const root = this.roots.get(normalized);
    if (!root) return false;
    this.roots.delete(normalized);
    this.emit({ type: 'removed', root, at: Date.now() });
    this.notifyChange();
    return true;
  }

  /**
   * 更新根目录
   */
  update(uri: string, updates: Partial<Root>): boolean {
    const normalized = normalizeRootUri(uri);
    const previous = this.roots.get(normalized);
    if (!previous) return false;
    const updated: Root = { ...previous, ...updates, uri: previous.uri };
    this.roots.set(normalized, updated);
    this.emit({ type: 'updated', root: updated, previous, at: Date.now() });
    this.notifyChange();
    return true;
  }

  /**
   * 清空所有根目录
   */
  clear(): void {
    if (this.roots.size === 0) return;
    this.roots.clear();
    this.emit({ type: 'cleared', at: Date.now() });
    this.notifyChange();
  }

  /**
   * 获取根目录
   */
  get(uri: string): Root | undefined {
    return this.roots.get(normalizeRootUri(uri));
  }

  /**
   * 列出所有根目录
   */
  list(): Root[] {
    return Array.from(this.roots.values());
  }

  /**
   * 根目录数量
   */
  size(): number {
    return this.roots.size;
  }

  /**
   * 检查 URI 是否为已注册根目录的子路径
   */
  contains(uri: string): boolean {
    const target = normalizeRootUri(uri);
    for (const root of this.roots.values()) {
      if (target === root.uri) return true;
      if (target.startsWith(root.uri + '/')) return true;
    }
    return false;
  }

  /**
   * 查找包含该 URI 的根目录
   */
  findRoot(uri: string): Root | undefined {
    const target = normalizeRootUri(uri);
    let bestMatch: Root | undefined;
    for (const root of this.roots.values()) {
      if (target === root.uri || target.startsWith(root.uri + '/')) {
        if (!bestMatch || root.uri.length > bestMatch.uri.length) {
          bestMatch = root;
        }
      }
    }
    return bestMatch;
  }

  /**
   * 订阅事件
   */
  on(listener: RootEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.roots.clear();
    this.listeners.clear();
    this.client = null;
  }

  // ============ 私有方法 ============

  private notifyChange(): void {
    if (!this.autoNotify || !this.client) return;
    if (this.client.getState() !== 'ready') return;
    // 通过通知告知服务器
    void this.client
      .notify('notifications/roots/list_changed', {})
      .catch(() => {
        // 通知失败不影响本地操作
      });
  }

  private emit(event: RootEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * 创建根目录管理器
 */
export function createRootsManager(options: { autoNotify?: boolean } = {}): RootsManager {
  return new RootsManager(options);
}
