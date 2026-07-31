/**
 * # ============================================================
 * # MCP Server Registry - MCP 服务器注册表 (v1.0.0 Cycle 39 G39-02)
 * # ============================================================
 * # 核心作用：统一管理 MCP 服务器定义、注册、查询、连接生命周期
 * #           内置 5 个常用 MCP 服务器（filesystem / git / github / fetch / sqlite）
 * #           支持运行时添加/删除/启用/禁用 + 持久化
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 39 G39-02 初次创建
 * # ============================================================
 */

import type { McpClient } from './mcpClient';
import { createMcpClient } from './mcpClient';
import type { TransportOptions, Tool, Resource, Prompt, ServerCapabilities } from './mcpTypes';

// ============ 类型定义 ============

/**
 * MCP 服务器元数据
 * 描述一个 MCP 服务器的配置信息和分类
 */
export interface McpServerDefinition {
  /** 唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 详细描述 */
  description: string;
  /** 分类 */
  category: McpServerCategory;
  /** 图标名称（前端使用） */
  icon: string;
  /** 传输配置 */
  transport: TransportOptions;
  /** 默认是否启用 */
  enabledByDefault: boolean;
  /** 是否为内置服务器（不可删除） */
  builtin: boolean;
  /** 标签 */
  tags: string[];
  /** 主页 URL */
  homepage?: string;
  /** 版本 */
  version: string;
  /** 作者/维护者 */
  author?: string;
}

/** MCP 服务器分类 */
export type McpServerCategory =
  | 'filesystem'
  | 'version-control'
  | 'network'
  | 'database'
  | 'search'
  | 'productivity'
  | 'ai'
  | 'custom';

/**
 * 服务器运行时状态
 */
export interface McpServerStatus {
  /** 服务器 ID */
  serverId: string;
  /** 客户端实例（已连接时存在） */
  client: McpClient | null;
  /** 是否已连接 */
  connected: boolean;
  /** 工具数量（已发现时） */
  toolCount: number;
  /** 资源数量 */
  resourceCount: number;
  /** 提示词数量 */
  promptCount: number;
  /** 上次连接时间 */
  lastConnectedAt?: number;
  /** 上次错误 */
  lastError?: string;
  /** 工具列表缓存 */
  tools: Tool[];
  /** 资源列表缓存 */
  resources: Resource[];
  /** 提示词列表缓存 */
  prompts: Prompt[];
}

/**
 * 注册表事件类型
 */
export type McpRegistryEvent =
  | 'server-added'
  | 'server-removed'
  | 'server-updated'
  | 'server-connected'
  | 'server-disconnected'
  | 'server-error';

export type McpRegistryListener = (event: McpRegistryEvent, serverId: string) => void;

// ============ 5 个内置 MCP 服务器 ============

/**
 * 1) Filesystem Server - 安全的本地文件系统访问
 * 官方参考：https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem
 */
export const BUILTIN_FILESYSTEM: McpServerDefinition = {
  id: 'builtin.filesystem',
  name: 'Filesystem',
  description: '安全的本地文件系统访问，支持读取/写入/列出目录。提供路径白名单以限制访问范围。',
  category: 'filesystem',
  icon: 'folder',
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '~/Documents', '~/Desktop'],
  },
  enabledByDefault: false,
  builtin: true,
  tags: ['filesystem', 'file', 'io', 'official'],
  homepage: 'https://github.com/modelcontextprotocol/servers',
  version: '1.0.0',
  author: 'Model Context Protocol',
};

/**
 * 2) Git Server - 本地 Git 仓库操作
 * 官方参考：https://github.com/modelcontextprotocol/servers/tree/main/src/git
 */
export const BUILTIN_GIT: McpServerDefinition = {
  id: 'builtin.git',
  name: 'Git',
  description: '本地 Git 仓库操作，支持 status/diff/log/commit/branch 等常用子命令。',
  category: 'version-control',
  icon: 'git-branch',
  transport: {
    type: 'stdio',
    command: 'uvx',
    args: ['mcp-server-git', '--repository', '.'],
  },
  enabledByDefault: false,
  builtin: true,
  tags: ['git', 'version-control', 'official'],
  homepage: 'https://github.com/modelcontextprotocol/servers',
  version: '1.0.0',
  author: 'Model Context Protocol',
};

/**
 * 3) GitHub Server - GitHub API 集成
 * 官方参考：https://github.com/modelcontextprotocol/servers/tree/main/src/github
 */
export const BUILTIN_GITHUB: McpServerDefinition = {
  id: 'builtin.github',
  name: 'GitHub',
  description: 'GitHub API 集成，支持仓库管理、Issue、PR、搜索等。需要 GITHUB_PERSONAL_ACCESS_TOKEN 环境变量。',
  category: 'version-control',
  icon: 'github',
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
  },
  enabledByDefault: false,
  builtin: true,
  tags: ['github', 'api', 'git', 'official'],
  homepage: 'https://github.com/modelcontextprotocol/servers',
  version: '1.0.0',
  author: 'Model Context Protocol',
};

/**
 * 4) Fetch Server - Web 抓取与转换
 * 官方参考：https://github.com/modelcontextprotocol/servers/tree/main/src/fetch
 */
export const BUILTIN_FETCH: McpServerDefinition = {
  id: 'builtin.fetch',
  name: 'Fetch',
  description: 'Web 内容抓取和 Markdown 转换工具。支持 HTML 转 Markdown，提取可读内容。',
  category: 'network',
  icon: 'globe',
  transport: {
    type: 'stdio',
    command: 'uvx',
    args: ['mcp-server-fetch'],
  },
  enabledByDefault: true,
  builtin: true,
  tags: ['http', 'web', 'fetch', 'markdown', 'official'],
  homepage: 'https://github.com/modelcontextprotocol/servers',
  version: '1.0.0',
  author: 'Model Context Protocol',
};

/**
 * 5) SQLite Server - SQLite 数据库查询
 * 官方参考：https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite
 */
export const BUILTIN_SQLITE: McpServerDefinition = {
  id: 'builtin.sqlite',
  name: 'SQLite',
  description: 'SQLite 数据库查询和管理。支持 list_tables、describe_table、read_query、write_query 等。',
  category: 'database',
  icon: 'database',
  transport: {
    type: 'stdio',
    command: 'uvx',
    args: ['mcp-server-sqlite', '--db-path', './data/app.db'],
  },
  enabledByDefault: false,
  builtin: true,
  tags: ['sqlite', 'database', 'sql', 'official'],
  homepage: 'https://github.com/modelcontextprotocol/servers',
  version: '1.0.0',
  author: 'Model Context Protocol',
};

/** 内置服务器列表 */
export const BUILTIN_MCP_SERVERS: McpServerDefinition[] = [
  BUILTIN_FILESYSTEM,
  BUILTIN_GIT,
  BUILTIN_GITHUB,
  BUILTIN_FETCH,
  BUILTIN_SQLITE,
];

// ============ MCP 服务器注册表 ============

/**
 * MCP 服务器注册表
 * 负责：
 *   - 注册/注销/查询服务器定义
 *   - 管理连接状态
 *   - 自动持久化到 localStorage
 *   - 事件通知
 */
export class McpServerRegistry {
  private definitions: Map<string, McpServerDefinition> = new Map();
  private status: Map<string, McpServerStatus> = new Map();
  private listeners: Set<McpRegistryListener> = new Set();
  private storageKey: string;
  private persistEnabled: boolean;

  constructor(options: { storageKey?: string; persistEnabled?: boolean } = {}) {
    this.storageKey = options.storageKey ?? 'hermes.mcp.registry.v1';
    this.persistEnabled = options.persistEnabled ?? true;
    // 注册内置服务器
    for (const def of BUILTIN_MCP_SERVERS) {
      this.registerBuiltin(def);
    }
    // 加载持久化数据
    if (this.persistEnabled) {
      this.loadFromStorage();
    }
  }

  // ============ 服务器定义管理 ============

  /**
   * 注册内置服务器（不可被普通 remove 删除）
   */
  private registerBuiltin(def: McpServerDefinition): void {
    this.definitions.set(def.id, def);
    if (!this.status.has(def.id)) {
      this.status.set(def.id, this.createInitialStatus(def));
    }
  }

  /**
   * 添加自定义服务器定义
   */
  add(definition: McpServerDefinition): boolean {
    if (this.definitions.has(definition.id)) {
      return false;
    }
    this.definitions.set(definition.id, definition);
    this.status.set(definition.id, this.createInitialStatus(definition));
    this.emit('server-added', definition.id);
    this.persist();
    return true;
  }

  /**
   * 移除服务器定义
   * 内置服务器不能被移除
   */
  remove(serverId: string): boolean {
    const def = this.definitions.get(serverId);
    if (!def) return false;
    if (def.builtin) return false; // 内置不可删
    // 如果已连接，先关闭
    const status = this.status.get(serverId);
    if (status?.client) {
      status.client.close().catch(() => {
        /* ignore */
      });
    }
    this.definitions.delete(serverId);
    this.status.delete(serverId);
    this.emit('server-removed', serverId);
    this.persist();
    return true;
  }

  /**
   * 更新服务器定义
   */
  update(serverId: string, updates: Partial<McpServerDefinition>): boolean {
    const existing = this.definitions.get(serverId);
    if (!existing) return false;
    const updated: McpServerDefinition = { ...existing, ...updates, id: serverId };
    this.definitions.set(serverId, updated);
    this.emit('server-updated', serverId);
    this.persist();
    return true;
  }

  /**
   * 获取服务器定义
   */
  get(serverId: string): McpServerDefinition | undefined {
    return this.definitions.get(serverId);
  }

  /**
   * 列出所有服务器定义
   */
  list(filter?: { category?: McpServerCategory; builtin?: boolean }): McpServerDefinition[] {
    let result = Array.from(this.definitions.values());
    if (filter?.category) {
      result = result.filter((d) => d.category === filter.category);
    }
    if (filter?.builtin !== undefined) {
      result = result.filter((d) => d.builtin === filter.builtin);
    }
    return result;
  }

  /**
   * 检查服务器是否存在
   */
  has(serverId: string): boolean {
    return this.definitions.has(serverId);
  }

  /** 已注册服务器数量 */
  size(): number {
    return this.definitions.size;
  }

  // ============ 连接管理 ============

  /**
   * 连接到指定服务器
   */
  async connect(serverId: string): Promise<McpClient> {
    const def = this.definitions.get(serverId);
    if (!def) {
      throw new Error(`MCP server not found: ${serverId}`);
    }
    let status = this.status.get(serverId);
    if (!status) {
      status = this.createInitialStatus(def);
      this.status.set(serverId, status);
    }
    if (status.connected && status.client) {
      return status.client;
    }
    try {
      const client = createMcpClient({
        serverId: def.id,
        serverName: def.name,
        transport: def.transport,
        defaultTimeoutMs: 30000,
      });
      await client.connect();
      // 缓存工具/资源/提示词
      try {
        status.tools = await client.listTools();
        status.toolCount = status.tools.length;
      } catch {
        status.tools = [];
        status.toolCount = 0;
      }
      try {
        status.resources = await client.listResources();
        status.resourceCount = status.resources.length;
      } catch {
        status.resources = [];
        status.resourceCount = 0;
      }
      try {
        status.prompts = await client.listPrompts();
        status.promptCount = status.prompts.length;
      } catch {
        status.prompts = [];
        status.promptCount = 0;
      }
      status.client = client;
      status.connected = true;
      status.lastConnectedAt = Date.now();
      status.lastError = undefined;
      this.emit('server-connected', serverId);
      return client;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      status.lastError = msg;
      status.connected = false;
      this.emit('server-error', serverId);
      throw err;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(serverId: string): Promise<void> {
    const status = this.status.get(serverId);
    if (!status?.client) return;
    try {
      await status.client.close();
    } catch {
      /* ignore */
    }
    status.client = null;
    status.connected = false;
    status.toolCount = 0;
    status.resourceCount = 0;
    status.promptCount = 0;
    status.tools = [];
    status.resources = [];
    status.prompts = [];
    this.emit('server-disconnected', serverId);
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.status.keys());
    for (const id of ids) {
      await this.disconnect(id);
    }
  }

  /**
   * 获取服务器状态
   */
  getStatus(serverId: string): McpServerStatus | undefined {
    return this.status.get(serverId);
  }

  /**
   * 获取所有服务器状态
   */
  getAllStatus(): McpServerStatus[] {
    return Array.from(this.status.values());
  }

  /**
   * 获取已连接的客户端
   */
  getClient(serverId: string): McpClient | undefined {
    return this.status.get(serverId)?.client ?? undefined;
  }

  /**
   * 列出所有工具（跨所有已连接服务器）
   */
  listAllTools(): Array<{ serverId: string; tool: Tool }> {
    const result: Array<{ serverId: string; tool: Tool }> = [];
    for (const [serverId, status] of this.status.entries()) {
      if (status.connected) {
        for (const tool of status.tools) {
          result.push({ serverId, tool });
        }
      }
    }
    return result;
  }

  /**
   * 列出所有资源
   */
  listAllResources(): Array<{ serverId: string; resource: Resource }> {
    const result: Array<{ serverId: string; resource: Resource }> = [];
    for (const [serverId, status] of this.status.entries()) {
      if (status.connected) {
        for (const resource of status.resources) {
          result.push({ serverId, resource });
        }
      }
    }
    return result;
  }

  /**
   * 列出所有提示词
   */
  listAllPrompts(): Array<{ serverId: string; prompt: Prompt }> {
    const result: Array<{ serverId: string; prompt: Prompt }> = [];
    for (const [serverId, status] of this.status.entries()) {
      if (status.connected) {
        for (const prompt of status.prompts) {
          result.push({ serverId, prompt });
        }
      }
    }
    return result;
  }

  // ============ 事件订阅 ============

  /**
   * 订阅注册表事件
   */
  subscribe(listener: McpRegistryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: McpRegistryEvent, serverId: string): void {
    for (const l of this.listeners) {
      try {
        l(event, serverId);
      } catch {
        /* ignore */
      }
    }
  }

  // ============ 持久化 ============

  /**
   * 持久化到 localStorage
   */
  private persist(): void {
    if (!this.persistEnabled) return;
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const customServers = Array.from(this.definitions.values())
        .filter((d) => !d.builtin)
        .map((d) => d);
      const data = {
        version: 1,
        customServers,
        updatedAt: Date.now(),
      };
      window.localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch {
      /* localStorage 不可用时静默失败 */
    }
  }

  /**
   * 从 localStorage 加载
   */
  private loadFromStorage(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return;
      const data = JSON.parse(raw) as { customServers?: McpServerDefinition[] };
      if (data.customServers && Array.isArray(data.customServers)) {
        for (const def of data.customServers) {
          if (!this.definitions.has(def.id)) {
            this.definitions.set(def.id, def);
            this.status.set(def.id, this.createInitialStatus(def));
          }
        }
      }
    } catch {
      /* 数据损坏时静默失败 */
    }
  }

  /**
   * 清除持久化数据
   */
  clearStorage(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.removeItem(this.storageKey);
    } catch {
      /* ignore */
    }
  }

  // ============ 工具方法 ============

  private createInitialStatus(def: McpServerDefinition): McpServerStatus {
    return {
      serverId: def.id,
      client: null,
      connected: false,
      toolCount: 0,
      resourceCount: 0,
      promptCount: 0,
      tools: [],
      resources: [],
      prompts: [],
    };
  }
}

// ============ 全局单例 ============

let globalRegistry: McpServerRegistry | null = null;

/**
 * 获取全局注册表实例（懒加载）
 */
export function getDefaultMcpServerRegistry(): McpServerRegistry {
  if (!globalRegistry) {
    globalRegistry = new McpServerRegistry();
  }
  return globalRegistry;
}

/**
 * 重置全局注册表（主要用于测试）
 */
export function resetDefaultMcpServerRegistry(): void {
  if (globalRegistry) {
    globalRegistry.disconnectAll().catch(() => {
      /* ignore */
    });
  }
  globalRegistry = null;
}

/**
 * 创建新的注册表实例
 */
export function createMcpServerRegistry(
  options: { storageKey?: string; persistEnabled?: boolean } = {},
): McpServerRegistry {
  return new McpServerRegistry(options);
}

// ============ 分类元数据 ============

/**
 * MCP 服务器分类元数据
 */
export const MCP_CATEGORY_META: Record<McpServerCategory, { label: string; icon: string; color: string }> = {
  filesystem: { label: '文件系统', icon: 'folder', color: '#f59e0b' },
  'version-control': { label: '版本控制', icon: 'git-branch', color: '#8b5cf6' },
  network: { label: '网络', icon: 'globe', color: '#06b6d4' },
  database: { label: '数据库', icon: 'database', color: '#10b981' },
  search: { label: '搜索', icon: 'search', color: '#ef4444' },
  productivity: { label: '生产力', icon: 'briefcase', color: '#3b82f6' },
  ai: { label: 'AI', icon: 'sparkles', color: '#a855f7' },
  custom: { label: '自定义', icon: 'puzzle', color: '#6b7280' },
};

/**
 * 统计信息
 */
export interface McpRegistryStats {
  total: number;
  builtin: number;
  custom: number;
  connected: number;
  totalTools: number;
  totalResources: number;
  totalPrompts: number;
  byCategory: Record<string, number>;
}

/**
 * 计算注册表统计信息
 */
export function computeRegistryStats(registry: McpServerRegistry): McpRegistryStats {
  const defs = registry.list();
  const status = registry.getAllStatus();
  const stats: McpRegistryStats = {
    total: defs.length,
    builtin: defs.filter((d) => d.builtin).length,
    custom: defs.filter((d) => !d.builtin).length,
    connected: status.filter((s) => s.connected).length,
    totalTools: status.reduce((sum, s) => sum + s.toolCount, 0),
    totalResources: status.reduce((sum, s) => sum + s.resourceCount, 0),
    totalPrompts: status.reduce((sum, s) => sum + s.promptCount, 0),
    byCategory: {},
  };
  for (const d of defs) {
    stats.byCategory[d.category] = (stats.byCategory[d.category] ?? 0) + 1;
  }
  return stats;
}

// 显式引用防止 tree-shake 警告
export type { ServerCapabilities };
