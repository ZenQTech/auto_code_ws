/**
 * # ============================================================
 * # MCP Prompt Bridge - MCP 提示词桥接 (v1.0.0 Cycle 42 G42-03)
 * # ============================================================
 * # 核心作用：将 MCP 提示词深度集成到 Hermes Prompt 库
 * #           - MCP Prompt ↔ Hermes PromptDefinition 双向转换
 * #           - 命名空间: mcp:<serverId>::<promptName>
 * #           - 监听 notifications/prompts/list_changed 实时同步
 * #           - 提示词参数校验和插值
 * #           - 跨服务器提示词搜索 + 过滤
 * #           - 缓存：已渲染提示词 + 命中统计
 * # 对标产品：@modelcontextprotocol/sdk (TypeScript 官方 SDK)
 * # 协议版本：MCP 2024-11-05
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 42 G42-03 初次创建
 * # ============================================================
 */

import type { McpClient } from './mcpClient';
import type { Prompt, PromptArgument, PromptMessage, PromptMessageContent } from './mcpTypes';

// ============ 类型定义 ============

/**
 * MCP 提示词限定名
 * 格式: mcp:<serverId>::<promptName>
 */
export type McpPromptQualifiedName = string;

/**
 * Hermes 统一提示词定义
 * 来自 MCP 服务器，注册到 Hermes Prompt 库
 */
export interface HermesPromptDefinition {
  /** 限定名（mcp:<serverId>::<promptName>） */
  qualifiedName: McpPromptQualifiedName;
  /** 显示名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 参数定义 */
  arguments: HermesPromptArgument[];
  /** 分类标签 */
  tags: string[];
  /** 来源服务器 ID */
  serverId: string;
  /** 服务器名称 */
  serverName: string;
  /** 创建时间 */
  createdAt: number;
  /** 元数据 */
  metadata: {
    /** 协议版本 */
    protocol?: string;
    /** 原始 MCP 定义引用 */
    raw?: Prompt;
  };
}

/**
 * Hermes 提示词参数
 */
export interface HermesPromptArgument {
  name: string;
  description?: string;
  required: boolean;
  /** 默认值 */
  defaultValue?: string;
  /** 值的校验模式 (regex) */
  pattern?: string;
  /** 候选值 */
  enum?: string[];
}

/**
 * 提示词执行上下文
 */
export interface PromptExecutionContext {
  /** 用户提供的参数值 */
  args: Record<string, string>;
  /** 额外元数据（用于插值） */
  metadata?: {
    /** 当前时间 */
    now?: Date;
    /** 用户名 */
    user?: string;
    /** 项目名 */
    project?: string;
    /** 工作目录 */
    cwd?: string;
    /** 环境变量 */
    env?: Record<string, string>;
  };
  /** 渲染选项 */
  options?: {
    /** 缓存键前缀 */
    cacheKey?: string;
    /** 跳过缓存 */
    skipCache?: boolean;
    /** 超时（毫秒） */
    timeoutMs?: number;
  };
}

/**
 * 渲染后的提示词
 */
export interface RenderedHermesPrompt {
  /** 原始 Hermes 提示词定义 */
  prompt: HermesPromptDefinition;
  /** 渲染后的消息列表 */
  messages: PromptMessage[];
  /** 缺失的必填参数 */
  missingArgs: string[];
  /** 校验失败的参数 */
  invalidArgs: Array<{ name: string; reason: string }>;
  /** 渲染耗时 */
  durationMs: number;
  /** 是否来自缓存 */
  cached: boolean;
  /** 渲染时间 */
  renderedAt: number;
}

/**
 * 桥接事件
 */
export type McpPromptBridgeEvent =
  | { type: 'server-registered'; serverId: string; promptCount: number; at: number }
  | { type: 'server-unregistered'; serverId: string; promptCount: number; at: number }
  | { type: 'prompts-updated'; serverId: string; added: string[]; removed: string[]; at: number }
  | { type: 'prompt-rendered'; qualifiedName: string; durationMs: number; cached: boolean; at: number }
  | { type: 'error'; error: Error; at: number };

export type McpPromptBridgeListener = (event: McpPromptBridgeEvent) => void;

/**
 * 缓存项
 */
interface PromptCacheEntry {
  result: RenderedHermesPrompt;
  expiresAt: number;
}

/**
 * 提示词统计
 */
export interface McpPromptStats {
  totalServers: number;
  totalPrompts: number;
  totalRenders: number;
  cacheHits: number;
  cacheMisses: number;
  failedRenders: number;
  avgRenderDurationMs: number;
}

// ============ 工具函数 ============

/**
 * 构造 MCP 提示词限定名
 * 格式: mcp:<serverId>::<promptName>
 */
export function buildMcpPromptName(serverId: string, promptName: string): McpPromptQualifiedName {
  return `mcp:${serverId}::${promptName}`;
}

/**
 * 解析 MCP 提示词限定名
 */
export function parseMcpPromptName(qualifiedName: string): { serverId: string; promptName: string } | null {
  const match = qualifiedName.match(/^mcp:([a-zA-Z0-9_-]+)::(.+)$/);
  if (!match) return null;
  return { serverId: match[1], promptName: match[2] };
}

/**
 * MCP PromptArgument → Hermes 转换
 */
export function convertMcpArgument(arg: PromptArgument): HermesPromptArgument {
  return {
    name: arg.name,
    description: arg.description,
    required: arg.required ?? false,
  };
}

/**
 * MCP Prompt → Hermes PromptDefinition 转换
 */
export function convertMcpPromptToHermes(
  serverId: string,
  serverName: string,
  prompt: Prompt,
): HermesPromptDefinition {
  return {
    qualifiedName: buildMcpPromptName(serverId, prompt.name),
    name: prompt.name,
    description: prompt.description,
    arguments: (prompt.arguments ?? []).map(convertMcpArgument),
    tags: ['mcp', serverId],
    serverId,
    serverName,
    createdAt: Date.now(),
    metadata: {
      raw: prompt,
    },
  };
}

// ============ 参数校验 ============

/**
 * 校验参数值
 */
export function validateHermesPromptArgs(
  prompt: HermesPromptDefinition,
  args: Record<string, string>,
): { missingArgs: string[]; invalidArgs: Array<{ name: string; reason: string }> } {
  const missingArgs: string[] = [];
  const invalidArgs: Array<{ name: string; reason: string }> = [];

  for (const argDef of prompt.arguments) {
    const value = args[argDef.name];

    if (argDef.required && (value === undefined || value === '')) {
      missingArgs.push(argDef.name);
      continue;
    }

    if (value !== undefined) {
      if (argDef.enum && !argDef.enum.includes(value)) {
        invalidArgs.push({
          name: argDef.name,
          reason: `值必须是 ${argDef.enum.join(', ')} 之一`,
        });
      }
      if (argDef.pattern) {
        try {
          const re = new RegExp(argDef.pattern);
          if (!re.test(value)) {
            invalidArgs.push({
              name: argDef.name,
              reason: `值不匹配模式 ${argDef.pattern}`,
            });
          }
        } catch {
          // 忽略无效 pattern
        }
      }
    }
  }

  return { missingArgs, invalidArgs };
}

// ============ 文本插值 ============

/**
 * 插值支持的变量
 */
export interface InterpolationVars {
  args: Record<string, string>;
  metadata?: PromptExecutionContext['metadata'];
}

/**
 * 替换文本中的 ${var} 变量
 */
export function interpolatePromptText(text: string, vars: InterpolationVars): string {
  return text.replace(/\$\{([^}]+)\}/g, (match, expr) => {
    const trimmed = expr.trim();
    if (trimmed.startsWith('args.')) {
      const key = trimmed.slice(5);
      const val = vars.args[key];
      if (val === undefined) return match;
      return val;
    }
    if (trimmed.startsWith('metadata.')) {
      const key = trimmed.slice(9);
      const meta = vars.metadata;
      if (!meta) return match;
      if (key === 'now') return meta.now ? meta.now.toISOString() : match;
      if (key === 'user') return meta.user ?? match;
      if (key === 'project') return meta.project ?? match;
      if (key === 'cwd') return meta.cwd ?? match;
      if (key.startsWith('env.')) {
        const envKey = key.slice(4);
        return meta.env?.[envKey] ?? match;
      }
      return match;
    }
    return match;
  });
}

/**
 * 递归插值消息内容
 */
function interpolateMessageContent(
  content: PromptMessageContent,
  vars: InterpolationVars,
): PromptMessageContent {
  if ('text' in content) {
    return { ...content, text: interpolatePromptText(content.text, vars) };
  }
  // resource / image 等不进行插值
  return content;
}

// ============ 提示词桥接主类 ============

/**
 * MCP 提示词桥接
 * 负责：
 * 1. 将 MCP 提示词自动注册到 Hermes Prompt 库
 * 2. 监听提示词列表变更实时同步
 * 3. 参数校验 + 文本插值 + 渲染
 * 4. 渲染结果缓存
 * 5. 跨服务器搜索 + 过滤
 */
export class McpPromptBridge {
  /** 已注册的提示词（key: qualifiedName） */
  private readonly prompts: Map<McpPromptQualifiedName, HermesPromptDefinition> = new Map();
  /** 服务器提示词映射（key: serverId, value: qualifiedNames） */
  private readonly serverPrompts: Map<string, Set<McpPromptQualifiedName>> = new Map();
  /** 服务器客户端引用 */
  private readonly serverClients: Map<string, McpClient> = new Map();
  /** 提示词列表变更解绑函数 */
  private readonly unsubscribers: Map<string, () => void> = new Map();
  /** 事件监听器 */
  private readonly listeners: Set<McpPromptBridgeListener> = new Set();
  /** 渲染缓存（key: cacheKey, value: 缓存项） */
  private readonly cache: Map<string, PromptCacheEntry> = new Map();
  /** 缓存 TTL（毫秒） */
  private readonly cacheTtlMs: number;
  /** 缓存最大大小 */
  private readonly maxCacheSize: number;
  /** 统计 */
  private stats = {
    totalRenders: 0,
    cacheHits: 0,
    cacheMisses: 0,
    failedRenders: 0,
    totalDurationMs: 0,
  };

  constructor(options: { cacheTtlMs?: number; maxCacheSize?: number } = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.maxCacheSize = options.maxCacheSize ?? 200;
  }

  /**
   * 注册服务器的所有提示词
   * @returns 注册的提示词数量
   */
  async registerServer(serverId: string, client: McpClient): Promise<number> {
    if (!client.isReady()) {
      throw new Error(`Client for server '${serverId}' is not ready`);
    }

    // 已注册则先清理
    if (this.serverPrompts.has(serverId)) {
      await this.unregisterServer(serverId);
    }

    this.serverClients.set(serverId, client);

    // 获取提示词列表
    const mcpPrompts = await client.listPrompts();
    const serverName = client.getServerInfo()?.name ?? serverId;

    // 转换并注册
    const promptSet = new Set<McpPromptQualifiedName>();
    for (const mcpPrompt of mcpPrompts) {
      const qualifiedName = buildMcpPromptName(serverId, mcpPrompt.name);
      const hermesDef = convertMcpPromptToHermes(serverId, serverName, mcpPrompt);
      this.prompts.set(qualifiedName, hermesDef);
      promptSet.add(qualifiedName);
    }
    this.serverPrompts.set(serverId, promptSet);

    // 订阅提示词列表变更
    const unsub = client.onPromptsListChanged(async () => {
      await this.handleServerPromptsChanged(serverId, client);
    });
    this.unsubscribers.set(serverId, unsub);

    this.emit({ type: 'server-registered', serverId, promptCount: promptSet.size, at: Date.now() });
    return promptSet.size;
  }

  /**
   * 注销服务器的所有提示词
   */
  async unregisterServer(serverId: string): Promise<void> {
    const promptSet = this.serverPrompts.get(serverId);
    if (!promptSet) return;

    // 解绑变更通知
    const unsub = this.unsubscribers.get(serverId);
    if (unsub) {
      unsub();
      this.unsubscribers.delete(serverId);
    }

    // 移除提示词
    for (const qualifiedName of promptSet) {
      this.prompts.delete(qualifiedName);
      // 清理该提示词的缓存
      this.invalidateCacheByPrompt(qualifiedName);
    }
    this.serverPrompts.delete(serverId);
    this.serverClients.delete(serverId);

    const count = promptSet.size;
    this.emit({ type: 'server-unregistered', serverId, promptCount: count, at: Date.now() });
  }

  /**
   * 注销所有服务器
   */
  async unregisterAll(): Promise<void> {
    const serverIds = Array.from(this.serverPrompts.keys());
    for (const serverId of serverIds) {
      await this.unregisterServer(serverId);
    }
  }

  /**
   * 获取所有 Hermes 提示词定义
   */
  getDefinitions(): HermesPromptDefinition[] {
    return Array.from(this.prompts.values());
  }

  /**
   * 获取限定名对应的提示词定义
   */
  getDefinition(qualifiedName: string): HermesPromptDefinition | undefined {
    return this.prompts.get(qualifiedName);
  }

  /**
   * 列出所有已注册提示词
   */
  list(): HermesPromptDefinition[] {
    return Array.from(this.prompts.values());
  }

  /**
   * 列出指定服务器的提示词
   */
  listByServer(serverId: string): HermesPromptDefinition[] {
    const set = this.serverPrompts.get(serverId);
    if (!set) return [];
    return Array.from(set)
      .map((qn) => this.prompts.get(qn))
      .filter((p): p is HermesPromptDefinition => p !== undefined);
  }

  /**
   * 列出指定 tag 的提示词
   */
  listByTag(tag: string): HermesPromptDefinition[] {
    return this.list().filter((p) => p.tags.includes(tag));
  }

  /**
   * 搜索提示词
   */
  search(query: string, options: { serverId?: string; tag?: string } = {}): HermesPromptDefinition[] {
    const q = query.toLowerCase();
    let results = Array.from(this.prompts.values());
    if (options.serverId) {
      results = results.filter((p) => p.serverId === options.serverId);
    }
    if (options.tag) {
      results = results.filter((p) => p.tags.includes(options.tag!));
    }
    if (q) {
      results = results.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description?.toLowerCase().includes(q) ?? false) ||
          p.qualifiedName.toLowerCase().includes(q),
      );
    }
    return results;
  }

  /**
   * 渲染提示词
   * 1. 校验参数
   * 2. 检查缓存
   * 3. 调用 MCP getPrompt
   * 4. 文本插值
   * 5. 缓存结果
   */
  async render(qualifiedName: string, context: PromptExecutionContext): Promise<RenderedHermesPrompt> {
    const startTime = Date.now();
    this.stats.totalRenders += 1;

    const prompt = this.prompts.get(qualifiedName);
    if (!prompt) {
      this.stats.failedRenders += 1;
      throw new Error(`Prompt not found: ${qualifiedName}`);
    }

    // 1. 校验参数
    const { missingArgs, invalidArgs } = validateHermesPromptArgs(prompt, context.args);

    // 2. 检查缓存
    const cacheKey = this.buildCacheKey(qualifiedName, context);
    if (!context.options?.skipCache && missingArgs.length === 0 && invalidArgs.length === 0) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        this.stats.cacheHits += 1;
        const durationMs = Date.now() - startTime;
        this.emit({ type: 'prompt-rendered', qualifiedName, durationMs, cached: true, at: Date.now() });
        return { ...cached.result, cached: true, durationMs };
      }
    }

    this.stats.cacheMisses += 1;

    // 如果有缺失或无效参数，直接返回错误结果
    if (missingArgs.length > 0 || invalidArgs.length > 0) {
      this.stats.failedRenders += 1;
      const durationMs = Date.now() - startTime;
      this.stats.totalDurationMs += durationMs;
      return {
        prompt,
        messages: [],
        missingArgs,
        invalidArgs,
        durationMs,
        cached: false,
        renderedAt: Date.now(),
      };
    }

    // 3. 调用 MCP 客户端获取原始消息
    const client = this.serverClients.get(prompt.serverId);
    if (!client || !client.isReady()) {
      this.stats.failedRenders += 1;
      const durationMs = Date.now() - startTime;
      this.stats.totalDurationMs += durationMs;
      throw new Error(`Server '${prompt.serverId}' is not connected`);
    }

    let rawMessages: PromptMessage[];
    try {
      const timeoutMs = context.options?.timeoutMs ?? 30000;
      rawMessages = await Promise.race([
        client.getPrompt(prompt.name, context.args),
        new Promise<PromptMessage[]>((_, reject) =>
          setTimeout(() => reject(new Error(`Render timeout after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
    } catch (err) {
      this.stats.failedRenders += 1;
      const durationMs = Date.now() - startTime;
      this.stats.totalDurationMs += durationMs;
      this.emit({
        type: 'error',
        error: err instanceof Error ? err : new Error(String(err)),
        at: Date.now(),
      });
      throw err;
    }

    // 4. 插值
    const vars: InterpolationVars = { args: context.args, metadata: context.metadata };
    const messages: PromptMessage[] = rawMessages.map((msg) => ({
      role: msg.role,
      content: interpolateMessageContent(msg.content, vars),
    }));

    const durationMs = Date.now() - startTime;
    this.stats.totalDurationMs += durationMs;

    const result: RenderedHermesPrompt = {
      prompt,
      messages,
      missingArgs: [],
      invalidArgs: [],
      durationMs,
      cached: false,
      renderedAt: Date.now(),
    };

    // 5. 缓存结果
    this.putCache(cacheKey, result);

    this.emit({ type: 'prompt-rendered', qualifiedName, durationMs, cached: false, at: Date.now() });
    return result;
  }

  /**
   * 批量渲染多个提示词
   */
  async renderBatch(
    items: Array<{ qualifiedName: string; context: PromptExecutionContext }>,
  ): Promise<RenderedHermesPrompt[]> {
    return await Promise.all(
      items.map((item) => this.render(item.qualifiedName, item.context)),
    );
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 失效指定提示词的缓存
   */
  invalidateCacheByPrompt(qualifiedName: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${qualifiedName}:`)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * 获取统计
   */
  getStats(): McpPromptStats {
    return {
      totalServers: this.serverPrompts.size,
      totalPrompts: this.prompts.size,
      totalRenders: this.stats.totalRenders,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      failedRenders: this.stats.failedRenders,
      avgRenderDurationMs:
        this.stats.totalRenders > 0 ? this.stats.totalDurationMs / this.stats.totalRenders : 0,
    };
  }

  /**
   * 订阅事件
   */
  on(listener: McpPromptBridgeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 释放资源
   */
  dispose(): void {
    for (const unsub of this.unsubscribers.values()) {
      unsub();
    }
    this.unsubscribers.clear();
    this.prompts.clear();
    this.serverPrompts.clear();
    this.serverClients.clear();
    this.cache.clear();
    this.listeners.clear();
  }

  // ============ 私有方法 ============

  private buildCacheKey(qualifiedName: string, context: PromptExecutionContext): string {
    const prefix = context.options?.cacheKey ?? '';
    const argsKey = JSON.stringify(context.args, Object.keys(context.args).sort());
    return `${prefix}${qualifiedName}:${argsKey}`;
  }

  private putCache(key: string, result: RenderedHermesPrompt): void {
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, {
      result,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  /**
   * 处理服务器提示词列表变更
   */
  private async handleServerPromptsChanged(serverId: string, client: McpClient): Promise<void> {
    try {
      const oldSet = this.serverPrompts.get(serverId) ?? new Set<McpPromptQualifiedName>();
      const newMcpPrompts = await client.listPrompts();
      const newSet = new Set<McpPromptQualifiedName>();
      const added: string[] = [];
      const removed: string[] = [];
      const serverName = client.getServerInfo()?.name ?? serverId;

      // 检测新增
      for (const mcpPrompt of newMcpPrompts) {
        const qn = buildMcpPromptName(serverId, mcpPrompt.name);
        newSet.add(qn);
        if (!oldSet.has(qn)) {
          added.push(mcpPrompt.name);
        }
      }

      // 检测删除
      for (const qn of oldSet) {
        if (!newSet.has(qn)) {
          removed.push(qn);
          this.prompts.delete(qn);
          this.invalidateCacheByPrompt(qn);
        }
      }

      // 添加新提示词
      for (const mcpPrompt of newMcpPrompts) {
        if (added.includes(mcpPrompt.name)) {
          const qn = buildMcpPromptName(serverId, mcpPrompt.name);
          this.prompts.set(qn, convertMcpPromptToHermes(serverId, serverName, mcpPrompt));
        }
      }

      this.serverPrompts.set(serverId, newSet);

      if (added.length > 0 || removed.length > 0) {
        this.emit({ type: 'prompts-updated', serverId, added, removed, at: Date.now() });
      }
    } catch (err) {
      this.emit({
        type: 'error',
        error: err instanceof Error ? err : new Error(String(err)),
        at: Date.now(),
      });
    }
  }

  private emit(event: McpPromptBridgeEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* ignore */
      }
    }
  }
}

// ============ 工厂函数 ============

/**
 * 创建 MCP 提示词桥接
 */
export function createMcpPromptBridge(options?: { cacheTtlMs?: number; maxCacheSize?: number }): McpPromptBridge {
  return new McpPromptBridge(options);
}
