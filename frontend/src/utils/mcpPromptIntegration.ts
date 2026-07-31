/**
 * # ============================================================
 * # MCP Prompt Integration - MCP 提示词集成层 (v1.0.0 Cycle 40 G40-03)
 * # ============================================================
 * # 核心作用：将 MCP 服务器提示词集成到 Hermes 提示词库
 * #           - MCP Prompt → Hermes 内部格式转换
 * #           - 提示词参数校验和插值
 * #           - 跨服务器提示词注册表
 * #           - 提示词缓存 + 失效检测
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 40 G40-03 初次创建
 * # ============================================================
 */

import type { Prompt, PromptArgument, PromptMessage, PromptMessageContent } from './mcpTypes';

// ============ 类型定义 ============

/**
 * Hermes 统一提示词定义
 * 不依赖 MCP 协议，可在系统内任意位置使用
 */
export interface HermesPrompt {
  /** 唯一 ID（由 serverId::promptName 构成） */
  id: string;
  /** 提示词名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 参数定义 */
  arguments: HermesPromptArgument[];
  /** 源服务器 ID（'mcp:<serverId>' 或 'builtin'） */
  source: string;
  /** 分类标签 */
  tags: string[];
  /** 创建时间 */
  createdAt: number;
  /** 元数据 */
  metadata: {
    /** 服务器名称 */
    serverName: string;
    /** 协议版本 */
    protocol?: string;
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
}

/**
 * 渲染后的提示词
 */
export interface RenderedPrompt {
  /** 原始 Hermes 提示词 */
  prompt: HermesPrompt;
  /** 渲染后的消息列表（与 MCP PromptMessage 等价） */
  messages: PromptMessage[];
  /** 缺失的必填参数 */
  missingArgs: string[];
  /** 校验失败的参数 */
  invalidArgs: Array<{ name: string; reason: string }>;
}

/**
 * MCP 客户端接口（解耦具体实现）
 */
export interface McpPromptClient {
  listPrompts(): Promise<Prompt[]>;
  getPrompt(name: string, args?: Record<string, string>): Promise<PromptMessage[]>;
}

// ============ ID 生成 ============

/**
 * 生成 Hermes 提示词唯一 ID
 * 格式: mcp:<serverId>::<promptName>
 */
export function makePromptId(serverId: string, promptName: string): string {
  return `mcp:${serverId}::${promptName}`;
}

/**
 * 从 ID 解析 serverId 和 promptName
 */
export function parsePromptId(id: string): { serverId: string; promptName: string } | null {
  const match = /^mcp:([^:]+)::(.+)$/.exec(id);
  if (!match) return null;
  return { serverId: match[1], promptName: match[2] };
}

// ============ 转换层 ============

/**
 * 将 MCP PromptArgument 转换为 Hermes 格式
 */
export function convertArgument(arg: PromptArgument): HermesPromptArgument {
  return {
    name: arg.name,
    description: arg.description,
    required: arg.required ?? false,
  };
}

/**
 * 将 MCP Prompt 转换为 Hermes 提示词
 */
export function convertMcpPrompt(
  prompt: Prompt,
  serverId: string,
  serverName: string,
): HermesPrompt {
  return {
    id: makePromptId(serverId, prompt.name),
    name: prompt.name,
    description: prompt.description,
    arguments: (prompt.arguments ?? []).map(convertArgument),
    source: `mcp:${serverId}`,
    tags: ['mcp', serverId],
    createdAt: Date.now(),
    metadata: {
      serverName,
    },
  };
}

// ============ 参数校验 ============

/**
 * 校验参数值
 * 返回缺失的必填参数和无效参数
 */
export function validateArgs(
  prompt: HermesPrompt,
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
  /** 参数值 */
  args: Record<string, string>;
  /** 元数据 */
  metadata?: PromptExecutionContext['metadata'];
}

/**
 * 替换文本中的 ${var} 变量
 * 支持 args.* 和 metadata.* 两类变量
 */
export function interpolate(text: string, vars: InterpolationVars): string {
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
    return { ...content, text: interpolate(content.text, vars) };
  }
  if ('resource' in content) {
    // 资源内容通常不插值
    return content;
  }
  // image 类
  return content;
}

// ============ 渲染层 ============

/**
 * 渲染提示词
 * 1. 校验参数
 * 2. 客户端调用 getPrompt
 * 3. 插值替换
 * 4. 返回结构化结果
 */
export async function renderPrompt(
  prompt: HermesPrompt,
  client: McpPromptClient,
  context: PromptExecutionContext,
): Promise<RenderedPrompt> {
  const { missingArgs, invalidArgs } = validateArgs(prompt, context.args);

  if (missingArgs.length > 0 || invalidArgs.length > 0) {
    return {
      prompt,
      messages: [],
      missingArgs,
      invalidArgs,
    };
  }

  // 调用 MCP 客户端获取原始消息
  const rawMessages = await client.getPrompt(prompt.name, context.args);

  // 插值
  const vars: InterpolationVars = { args: context.args, metadata: context.metadata };
  const messages: PromptMessage[] = rawMessages.map((msg) => ({
    role: msg.role,
    content: interpolateMessageContent(msg.content, vars),
  }));

  return {
    prompt,
    messages,
    missingArgs: [],
    invalidArgs: [],
  };
}

// ============ 提示词注册表 ============

/**
 * 提示词注册表事件
 */
export type PromptRegistryEvent = 'added' | 'removed' | 'cleared';

/**
 * 提示词注册表事件回调
 */
export type PromptRegistryListener = (
  event: PromptRegistryEvent,
  promptId: string,
) => void;

/**
 * 提示词注册表
 * 集中管理来自多个 MCP 服务器的提示词
 */
export class McpPromptRegistry {
  private prompts: Map<string, HermesPrompt> = new Map();
  private clients: Map<string, McpPromptClient> = new Map();
  private listeners: Set<PromptRegistryListener> = new Set();

  /**
   * 注册客户端（替换已有）
   */
  registerClient(serverId: string, client: McpPromptClient): void {
    this.clients.set(serverId, client);
  }

  /**
   * 注销客户端及其所有提示词
   */
  unregisterClient(serverId: string): void {
    this.clients.delete(serverId);
    // 移除该服务器的所有提示词
    const toRemove: string[] = [];
    for (const [id, prompt] of this.prompts) {
      if (prompt.source === `mcp:${serverId}`) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.prompts.delete(id);
      this.emit('removed', id);
    }
  }

  /**
   * 从服务器加载并注册所有提示词
   */
  async loadFromServer(serverId: string, serverName: string): Promise<HermesPrompt[]> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`MCP client for server ${serverId} not registered`);
    }
    const mcpPrompts = await client.listPrompts();
    const hermesPrompts = mcpPrompts.map((p) => convertMcpPrompt(p, serverId, serverName));
    for (const hp of hermesPrompts) {
      this.prompts.set(hp.id, hp);
      this.emit('added', hp.id);
    }
    return hermesPrompts;
  }

  /**
   * 手动注册一个提示词（用于测试或自定义源）
   */
  register(prompt: HermesPrompt): void {
    this.prompts.set(prompt.id, prompt);
    this.emit('added', prompt.id);
  }

  /**
   * 移除一个提示词
   */
  unregister(promptId: string): boolean {
    const existed = this.prompts.delete(promptId);
    if (existed) this.emit('removed', promptId);
    return existed;
  }

  /**
   * 清空所有提示词
   */
  clear(): void {
    const ids = Array.from(this.prompts.keys());
    this.prompts.clear();
    for (const id of ids) {
      this.emit('removed', id);
    }
    this.emit('cleared', '');
  }

  /**
   * 获取提示词
   */
  get(promptId: string): HermesPrompt | null {
    return this.prompts.get(promptId) ?? null;
  }

  /**
   * 列出所有提示词
   */
  list(): HermesPrompt[] {
    return Array.from(this.prompts.values());
  }

  /**
   * 按服务器过滤
   */
  listByServer(serverId: string): HermesPrompt[] {
    return this.list().filter((p) => p.source === `mcp:${serverId}`);
  }

  /**
   * 按 tag 过滤
   */
  listByTag(tag: string): HermesPrompt[] {
    return this.list().filter((p) => p.tags.includes(tag));
  }

  /**
   * 搜索提示词（按名称/描述）
   */
  search(query: string): HermesPrompt[] {
    const q = query.toLowerCase();
    return this.list().filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false) ||
        p.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  /**
   * 渲染提示词
   */
  async render(
    promptId: string,
    context: PromptExecutionContext,
  ): Promise<RenderedPrompt | null> {
    const prompt = this.get(promptId);
    if (!prompt) return null;
    const parsed = parsePromptId(promptId);
    if (!parsed) return null;
    const client = this.clients.get(parsed.serverId);
    if (!client) return null;
    return await renderPrompt(prompt, client, context);
  }

  /**
   * 订阅注册表事件
   */
  subscribe(listener: PromptRegistryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: PromptRegistryEvent, promptId: string): void {
    for (const l of this.listeners) {
      try {
        l(event, promptId);
      } catch {
        // 静默吞掉 listener 错误
      }
    }
  }

  /**
   * 统计信息
   */
  stats(): { total: number; byServer: Record<string, number> } {
    const byServer: Record<string, number> = {};
    for (const p of this.prompts.values()) {
      byServer[p.source] = (byServer[p.source] ?? 0) + 1;
    }
    return { total: this.prompts.size, byServer };
  }
}

/**
 * 全局默认注册表（单例）
 */
let defaultRegistry: McpPromptRegistry | null = null;

export function getDefaultMcpPromptRegistry(): McpPromptRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new McpPromptRegistry();
  }
  return defaultRegistry;
}

export function resetDefaultMcpPromptRegistry(): void {
  if (defaultRegistry) {
    defaultRegistry.clear();
  }
  defaultRegistry = null;
}
