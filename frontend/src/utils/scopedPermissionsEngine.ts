/**
 * # ============================================================
 * # Scoped Permissions Engine - 作用域权限引擎 (v1.0.0 Cycle 28 G28-04)
 * # ============================================================
 * # 核心作用：嵌套子代理的细粒度权限控制
 * # 维度：工具 allowlist/blocklist + 文件路径白名单 + 网络主机白名单
 * # 参考：Claude Code 2026-06 #5 Scoped Permissions
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 28 G28-04 初次创建
 * # ============================================================
 */

export type PermissionMode = 'allow' | 'block' | 'ask';

export interface ToolPermission {
  tool: string;
  mode: PermissionMode;
}

export interface PathPermission {
  pattern: string;
  mode: PermissionMode;
  /** 是否递归（目录） */
  recursive?: boolean;
}

export interface NetworkPermission {
  host: string;
  mode: PermissionMode;
  /** 端口限制 */
  ports?: number[];
}

export interface PermissionScope {
  /** 代理路径 */
  agentPath: string;
  tools: ToolPermission[];
  paths: PathPermission[];
  networks: NetworkPermission[];
  /** 资源限制（token / time / 内存） */
  maxTokens?: number;
  maxDurationMs?: number;
  /** 创建时间 */
  createdAt: number;
  updatedAt: number;
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason: string;
  matchedRule?: string;
}

export type ScopedPermissionsEventType =
  | 'scope-created'
  | 'scope-updated'
  | 'permission-granted'
  | 'permission-denied'
  | 'permission-prompted';

export interface ScopedPermissionsEvent {
  type: ScopedPermissionsEventType;
  timestamp: number;
  data?: Record<string, unknown>;
}

export class ScopedPermissionsEngine {
  private scopes: Map<string, PermissionScope> = new Map();
  private listeners: Map<ScopedPermissionsEventType, Set<(e: ScopedPermissionsEvent) => void>> = new Map();
  private storageKey = 'hermes.scopedPermissions';

  constructor(options: { persist?: boolean } = {}) {
    if (options.persist !== false) {
      this.load();
    }
  }

  private load(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.scopes)) {
        for (const s of data.scopes) {
          this.scopes.set(s.agentPath, s);
        }
      }
    } catch (e) {
      console.warn('ScopedPermissionsEngine: failed to load', e);
    }
  }

  private save(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify({ scopes: Array.from(this.scopes.values()) }));
      }
    } catch (e) {
      console.warn('ScopedPermissionsEngine: failed to save', e);
    }
  }

  on(event: ScopedPermissionsEventType, listener: (e: ScopedPermissionsEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: ScopedPermissionsEventType, listener: (e: ScopedPermissionsEvent) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: ScopedPermissionsEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(event);
        } catch (err) {
          console.error('ScopedPermissionsEngine: error in handler', err);
        }
      }
    }
  }

  // ============ 作用域管理 ============

  createScope(agentPath: string, scope: Partial<Omit<PermissionScope, 'agentPath' | 'createdAt' | 'updatedAt'>> = {}): PermissionScope {
    if (this.scopes.has(agentPath)) {
      throw new Error(`Scope already exists: ${agentPath}`);
    }
    const now = Date.now();
    const full: PermissionScope = {
      agentPath,
      tools: scope.tools || [],
      paths: scope.paths || [],
      networks: scope.networks || [],
      maxTokens: scope.maxTokens,
      maxDurationMs: scope.maxDurationMs,
      createdAt: now,
      updatedAt: now,
    };
    this.scopes.set(agentPath, full);
    this.save();
    this.emit({ type: 'scope-created', timestamp: now, data: { agentPath } });
    return full;
  }

  getScope(agentPath: string): PermissionScope | undefined {
    return this.scopes.get(agentPath);
  }

  updateScope(agentPath: string, updates: Partial<Omit<PermissionScope, 'agentPath' | 'createdAt'>>): PermissionScope {
    const scope = this.scopes.get(agentPath);
    if (!scope) throw new Error(`Scope not found: ${agentPath}`);
    const updated: PermissionScope = { ...scope, ...updates, updatedAt: Date.now() };
    this.scopes.set(agentPath, updated);
    this.save();
    this.emit({ type: 'scope-updated', timestamp: Date.now(), data: { agentPath } });
    return updated;
  }

  deleteScope(agentPath: string): boolean {
    if (!this.scopes.has(agentPath)) return false;
    this.scopes.delete(agentPath);
    this.save();
    return true;
  }

  listScopes(): PermissionScope[] {
    return Array.from(this.scopes.values());
  }

  // ============ 权限检查 ============

  checkToolPermission(agentPath: string, tool: string): PermissionCheckResult {
    const scope = this.scopes.get(agentPath);
    if (!scope) {
      return { allowed: true, reason: 'No scope defined, default allow' };
    }
    for (const tp of scope.tools) {
      if (tp.tool === tool || tp.tool === '*') {
        if (tp.mode === 'allow') {
          this.emit({ type: 'permission-granted', timestamp: Date.now(), data: { agentPath, tool } });
          return { allowed: true, reason: 'Allowed by scope', matchedRule: tp.tool };
        }
        if (tp.mode === 'block') {
          this.emit({ type: 'permission-denied', timestamp: Date.now(), data: { agentPath, tool } });
          return { allowed: false, reason: 'Blocked by scope', matchedRule: tp.tool };
        }
        if (tp.mode === 'ask') {
          this.emit({ type: 'permission-prompted', timestamp: Date.now(), data: { agentPath, tool } });
          return { allowed: false, reason: 'Requires user confirmation', matchedRule: tp.tool };
        }
      }
    }
    return { allowed: true, reason: 'No matching rule, default allow' };
  }

  checkPathPermission(agentPath: string, path: string): PermissionCheckResult {
    const scope = this.scopes.get(agentPath);
    if (!scope) {
      return { allowed: true, reason: 'No scope defined, default allow' };
    }
    for (const pp of scope.paths) {
      const matched = pp.recursive
        ? path.startsWith(pp.pattern)
        : path === pp.pattern;
      if (matched) {
        if (pp.mode === 'allow') {
          return { allowed: true, reason: 'Path allowed by scope', matchedRule: pp.pattern };
        }
        if (pp.mode === 'block') {
          return { allowed: false, reason: 'Path blocked by scope', matchedRule: pp.pattern };
        }
      }
    }
    return { allowed: true, reason: 'No matching path rule' };
  }

  checkNetworkPermission(agentPath: string, host: string, port?: number): PermissionCheckResult {
    const scope = this.scopes.get(agentPath);
    if (!scope) {
      return { allowed: true, reason: 'No scope defined, default allow' };
    }
    for (const np of scope.networks) {
      if (np.host === host || np.host === '*') {
        if (port && np.ports && !np.ports.includes(port)) {
          continue;
        }
        if (np.mode === 'allow') {
          return { allowed: true, reason: 'Network allowed', matchedRule: np.host };
        }
        if (np.mode === 'block') {
          return { allowed: false, reason: 'Network blocked', matchedRule: np.host };
        }
      }
    }
    return { allowed: true, reason: 'No matching network rule' };
  }

  // ============ 继承 ============

  /**
   * 解析代理路径的所有祖先（用于继承父级权限）
   */
  getInheritedScopes(agentPath: string): PermissionScope[] {
    const parts = agentPath.split('/').filter(Boolean);
    const ancestors: PermissionScope[] = [];
    for (let i = parts.length; i > 0; i--) {
      const ancestorPath = '/' + parts.slice(0, i).join('/');
      const scope = this.scopes.get(ancestorPath);
      if (scope) ancestors.push(scope);
    }
    return ancestors.reverse();
  }

  checkToolPermissionWithInheritance(agentPath: string, tool: string): PermissionCheckResult {
    const scopes = this.getInheritedScopes(agentPath);
    for (const scope of scopes) {
      for (const tp of scope.tools) {
        if (tp.tool === tool || tp.tool === '*') {
          if (tp.mode === 'block') {
            return { allowed: false, reason: `Blocked by ${scope.agentPath}`, matchedRule: tp.tool };
          }
          if (tp.mode === 'allow') {
            return { allowed: true, reason: `Allowed by ${scope.agentPath}`, matchedRule: tp.tool };
          }
        }
      }
    }
    return { allowed: true, reason: 'No matching rule' };
  }
}

let defaultEngine: ScopedPermissionsEngine | null = null;
export function getDefaultScopedPermissionsEngine(): ScopedPermissionsEngine {
  if (!defaultEngine) {
    defaultEngine = new ScopedPermissionsEngine();
  }
  return defaultEngine;
}
export function resetDefaultScopedPermissionsEngine(): void {
  defaultEngine = null;
}
