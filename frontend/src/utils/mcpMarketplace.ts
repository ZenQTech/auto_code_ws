/**
 * # ============================================================
 * # MCP Marketplace + Bridge (v1.0.0 Cycle 39 G39-04)
 * # ============================================================
 * # 核心作用：
 * #   - Marketplace: 内置 MCP 服务器市场目录 + 一键安装
 * #   - Bridge: MCP 工具/资源/提示词 与 LLM Provider 适配器的桥接
 * #              允许 LLM 工具调用使用 MCP 服务器能力
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 39 G39-04 初次创建
 * # ============================================================
 */

import type { McpClient } from './mcpClient';
import type { McpServerRegistry } from './mcpRegistry';
import { getDefaultMcpServerRegistry } from './mcpRegistry';
import type { Tool, Resource, Prompt } from './mcpTypes';

// ============ Marketplace 类型定义 ============

/**
 * Marketplace 服务器条目
 * 比注册表定义更丰富：包含评分、下载量、版本历史等
 */
export interface McpMarketplaceEntry {
  /** 唯一 ID */
  id: string;
  /** 名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 分类 */
  category: string;
  /** 标签 */
  tags: string[];
  /** 作者 */
  author: string;
  /** 版本 */
  version: string;
  /** 主页 */
  homepage: string;
  /** 仓库 */
  repository?: string;
  /** 图标 emoji */
  icon: string;
  /** 安装命令模板 */
  installCommand: string;
  /** 配置示例 */
  configExample: string;
  /** 是否官方认证 */
  official: boolean;
  /** 评分（0-5） */
  rating: number;
  /** 下载量 */
  downloads: number;
  /** 最后更新 */
  updatedAt: string;
  /** 所需环境变量 */
  envVars: string[];
  /** 操作系统兼容性 */
  platforms: Array<'darwin' | 'linux' | 'windows'>;
}

/**
 * 安装结果
 */
export interface McpInstallResult {
  /** 是否成功 */
  success: boolean;
  /** 已安装的服务器 ID */
  serverId: string;
  /** 错误信息 */
  error?: string;
  /** 安装的命令 */
  command: string;
}

// ============ Marketplace 目录（精选 12 个） ============

/**
 * 精选 12 个 MCP 服务器
 * 来源：MCP 官方仓库 + 社区热门项目
 */
export const MCP_MARKETPLACE_CATALOG: McpMarketplaceEntry[] = [
  {
    id: 'marketplace.filesystem',
    name: 'Filesystem',
    description: '安全访问本地文件系统，支持读取/写入/搜索/目录列表，提供路径白名单保护。',
    category: 'filesystem',
    tags: ['filesystem', 'file', 'io', 'official'],
    author: 'Model Context Protocol',
    version: '1.0.0',
    homepage: 'https://github.com/modelcontextprotocol/servers',
    repository: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    icon: '📁',
    installCommand: 'npx -y @modelcontextprotocol/server-filesystem <allowed_dirs>',
    configExample: '{ "type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "~/Documents"] }',
    official: true,
    rating: 4.9,
    downloads: 124500,
    updatedAt: '2026-07-15',
    envVars: [],
    platforms: ['darwin', 'linux', 'windows'],
  },
  {
    id: 'marketplace.git',
    name: 'Git',
    description: 'Git 仓库操作，支持 status/diff/log/commit/branch/show/create_branch/init/add/commit等命令。',
    category: 'version-control',
    tags: ['git', 'version-control', 'official'],
    author: 'Model Context Protocol',
    version: '1.0.0',
    homepage: 'https://github.com/modelcontextprotocol/servers',
    repository: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
    icon: '🌿',
    installCommand: 'uvx mcp-server-git --repository <repo_path>',
    configExample: '{ "type": "stdio", "command": "uvx", "args": ["mcp-server-git", "--repository", "."] }',
    official: true,
    rating: 4.7,
    downloads: 89200,
    updatedAt: '2026-07-12',
    envVars: [],
    platforms: ['darwin', 'linux', 'windows'],
  },
  {
    id: 'marketplace.github',
    name: 'GitHub',
    description: 'GitHub API 集成，支持仓库、Issue、PR、Search、Actions、Releases。',
    category: 'version-control',
    tags: ['github', 'git', 'api', 'official'],
    author: 'Model Context Protocol',
    version: '1.0.0',
    homepage: 'https://github.com/modelcontextprotocol/servers',
    repository: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
    icon: '🐙',
    installCommand: 'npx -y @modelcontextprotocol/server-github',
    configExample: '{ "type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }',
    official: true,
    rating: 4.8,
    downloads: 156800,
    updatedAt: '2026-07-18',
    envVars: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    platforms: ['darwin', 'linux', 'windows'],
  },
  {
    id: 'marketplace.gitlab',
    name: 'GitLab',
    description: 'GitLab API 集成，支持项目、MR、Issue、Pipeline、Wiki。',
    category: 'version-control',
    tags: ['gitlab', 'git', 'api'],
    author: 'Community',
    version: '1.0.0',
    homepage: 'https://github.com/modelcontextprotocol/servers',
    icon: '🦊',
    installCommand: 'npx -y @modelcontextprotocol/server-gitlab',
    configExample: '{ "type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-gitlab"] }',
    official: false,
    rating: 4.3,
    downloads: 23400,
    updatedAt: '2026-06-28',
    envVars: ['GITLAB_PERSONAL_ACCESS_TOKEN', 'GITLAB_API_URL'],
    platforms: ['darwin', 'linux', 'windows'],
  },
  {
    id: 'marketplace.fetch',
    name: 'Fetch',
    description: 'Web 内容抓取和 HTML→Markdown 转换工具，提取可读内容。',
    category: 'network',
    tags: ['http', 'web', 'fetch', 'markdown', 'official'],
    author: 'Model Context Protocol',
    version: '1.0.0',
    homepage: 'https://github.com/modelcontextprotocol/servers',
    icon: '🌐',
    installCommand: 'uvx mcp-server-fetch',
    configExample: '{ "type": "stdio", "command": "uvx", "args": ["mcp-server-fetch"] }',
    official: true,
    rating: 4.5,
    downloads: 98700,
    updatedAt: '2026-07-10',
    envVars: [],
    platforms: ['darwin', 'linux', 'windows'],
  },
  {
    id: 'marketplace.brave-search',
    name: 'Brave Search',
    description: 'Brave 搜索引擎集成，支持网页/图片/视频搜索，注重隐私。',
    category: 'search',
    tags: ['search', 'brave', 'web', 'api'],
    author: 'Model Context Protocol',
    version: '1.0.0',
    homepage: 'https://github.com/modelcontextprotocol/servers',
    icon: '🦁',
    installCommand: 'npx -y @modelcontextprotocol/server-brave-search',
    configExample: '{ "type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-brave-search"] }',
    official: true,
    rating: 4.6,
    downloads: 67300,
    updatedAt: '2026-07-08',
    envVars: ['BRAVE_API_KEY'],
    platforms: ['darwin', 'linux', 'windows'],
  },
  {
    id: 'marketplace.sqlite',
    name: 'SQLite',
    description: 'SQLite 数据库操作，支持 list_tables/describe_table/read_query/write_query/create_table。',
    category: 'database',
    tags: ['sqlite', 'database', 'sql', 'official'],
    author: 'Model Context Protocol',
    version: '1.0.0',
    homepage: 'https://github.com/modelcontextprotocol/servers',
    icon: '🗃️',
    installCommand: 'uvx mcp-server-sqlite --db-path <db_file>',
    configExample: '{ "type": "stdio", "command": "uvx", "args": ["mcp-server-sqlite", "--db-path", "./data/app.db"] }',
    official: true,
    rating: 4.7,
    downloads: 78400,
    updatedAt: '2026-07-14',
    envVars: [],
    platforms: ['darwin', 'linux', 'windows'],
  },
  {
    id: 'marketplace.postgres',
    name: 'PostgreSQL',
    description: 'PostgreSQL 数据库操作，支持 schema 探索、查询、索引分析。',
    category: 'database',
    tags: ['postgres', 'database', 'sql', 'official'],
    author: 'Model Context Protocol',
    version: '1.0.0',
    homepage: 'https://github.com/modelcontextprotocol/servers',
    icon: '🐘',
    installCommand: 'npx -y @modelcontextprotocol/server-postgres',
    configExample: '{ "type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-postgres"] }',
    official: true,
    rating: 4.6,
    downloads: 56200,
    updatedAt: '2026-07-09',
    envVars: ['POSTGRES_CONNECTION_STRING'],
    platforms: ['darwin', 'linux', 'windows'],
  },
  {
    id: 'marketplace.puppeteer',
    name: 'Puppeteer',
    description: '无头浏览器自动化，支持网页导航、截图、表单填写、JS 执行。',
    category: 'network',
    tags: ['browser', 'automation', 'scraping', 'official'],
    author: 'Model Context Protocol',
    version: '1.0.0',
    homepage: 'https://github.com/modelcontextprotocol/servers',
    icon: '🎭',
    installCommand: 'npx -y @modelcontextprotocol/server-puppeteer',
    configExample: '{ "type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-puppeteer"] }',
    official: true,
    rating: 4.4,
    downloads: 42100,
    updatedAt: '2026-07-05',
    envVars: [],
    platforms: ['darwin', 'linux', 'windows'],
  },
  {
    id: 'marketplace.google-maps',
    name: 'Google Maps',
    description: 'Google Maps API 集成，支持地理编码、路径规划、地点搜索。',
    category: 'search',
    tags: ['maps', 'geocoding', 'google', 'api'],
    author: 'Community',
    version: '1.0.0',
    homepage: 'https://github.com/modelcontextprotocol/servers',
    icon: '🗺️',
    installCommand: 'npx -y @modelcontextprotocol/server-google-maps',
    configExample: '{ "type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-google-maps"] }',
    official: false,
    rating: 4.2,
    downloads: 18900,
    updatedAt: '2026-06-20',
    envVars: ['GOOGLE_MAPS_API_KEY'],
    platforms: ['darwin', 'linux', 'windows'],
  },
  {
    id: 'marketplace.sentry',
    name: 'Sentry',
    description: 'Sentry 错误监控集成，支持 Issue/Event 查询、Source Map 上传。',
    category: 'productivity',
    tags: ['sentry', 'monitoring', 'error-tracking'],
    author: 'Community',
    version: '1.0.0',
    homepage: 'https://github.com/modelcontextprotocol/servers',
    icon: '🚨',
    installCommand: 'npx -y @modelcontextprotocol/server-sentry',
    configExample: '{ "type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-sentry"] }',
    official: false,
    rating: 4.5,
    downloads: 15600,
    updatedAt: '2026-07-01',
    envVars: ['SENTRY_AUTH_TOKEN'],
    platforms: ['darwin', 'linux', 'windows'],
  },
  {
    id: 'marketplace.slack',
    name: 'Slack',
    description: 'Slack 集成，支持频道列表、消息发送/读取、用户搜索。',
    category: 'productivity',
    tags: ['slack', 'messaging', 'communication'],
    author: 'Community',
    version: '1.0.0',
    homepage: 'https://github.com/modelcontextprotocol/servers',
    icon: '💬',
    installCommand: 'npx -y @modelcontextprotocol/server-slack',
    configExample: '{ "type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-slack"] }',
    official: false,
    rating: 4.3,
    downloads: 28700,
    updatedAt: '2026-06-25',
    envVars: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
    platforms: ['darwin', 'linux', 'windows'],
  },
];

// ============ Marketplace 操作 ============

/**
 * Marketplace 搜索
 */
export function searchMarketplace(
  query: string,
  options: { category?: string; officialOnly?: boolean } = {},
): McpMarketplaceEntry[] {
  const q = query.toLowerCase().trim();
  return MCP_MARKETPLACE_CATALOG.filter((entry) => {
    if (options.officialOnly && !entry.official) return false;
    if (options.category && entry.category !== options.category) return false;
    if (!q) return true;
    return (
      entry.name.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q) ||
      entry.tags.some((t) => t.toLowerCase().includes(q)) ||
      entry.author.toLowerCase().includes(q)
    );
  });
}

/**
 * 获取分类统计
 */
export function getMarketplaceStats(): {
  total: number;
  official: number;
  community: number;
  byCategory: Record<string, number>;
  totalDownloads: number;
} {
  const stats = {
    total: MCP_MARKETPLACE_CATALOG.length,
    official: MCP_MARKETPLACE_CATALOG.filter((e) => e.official).length,
    community: MCP_MARKETPLACE_CATALOG.filter((e) => !e.official).length,
    byCategory: {} as Record<string, number>,
    totalDownloads: MCP_MARKETPLACE_CATALOG.reduce((sum, e) => sum + e.downloads, 0),
  };
  for (const e of MCP_MARKETPLACE_CATALOG) {
    stats.byCategory[e.category] = (stats.byCategory[e.category] ?? 0) + 1;
  }
  return stats;
}

/**
 * 一键安装 marketplace 条目
 * 解析 installCommand 并添加到注册表
 */
export function installFromMarketplace(
  entry: McpMarketplaceEntry,
  registry: McpServerRegistry = getDefaultMcpServerRegistry(),
): McpInstallResult {
  try {
    // 解析 installCommand: "npx -y @modelcontextprotocol/server-filesystem <allowed_dirs>"
    const tokens = entry.installCommand.trim().split(/\s+/);
    const command = tokens[0] ?? 'unknown';
    const args = tokens.slice(1);

    // 替换占位符为示例值
    const resolvedArgs = args.map((a) => {
      if (a === '<allowed_dirs>') return '~/Documents';
      if (a === '<repo_path>') return '.';
      if (a === '<db_file>') return './data/app.db';
      return a;
    });

    const newId = `installed.${entry.id.replace(/^marketplace\./, '')}`;
    const ok = registry.add({
      id: newId,
      name: entry.name,
      description: entry.description,
      category: entry.category as 'filesystem' | 'version-control' | 'network' | 'database' | 'search' | 'productivity' | 'ai' | 'custom',
      icon: entry.icon,
      transport: { type: 'stdio', command, args: resolvedArgs },
      enabledByDefault: false,
      builtin: false,
      tags: entry.tags,
      homepage: entry.homepage,
      version: entry.version,
      author: entry.author,
    });
    if (!ok) {
      return {
        success: false,
        serverId: newId,
        error: `Server ${newId} already exists`,
        command: entry.installCommand,
      };
    }
    return { success: true, serverId: newId, command: entry.installCommand };
  } catch (err) {
    return {
      success: false,
      serverId: '',
      error: err instanceof Error ? err.message : String(err),
      command: entry.installCommand,
    };
  }
}

// ============ Bridge: MCP <-> LLM 适配器 ============

/**
 * MCP 工具转换为 LLM ToolDefinition
 * 桥接 MCP 服务器能力到 LLM Function Calling
 */
export function mcpToolToLlmDefinition(
  tool: Tool,
  serverId: string,
  serverName: string,
): {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  _mcp?: { serverId: string; serverName: string };
} {
  return {
    type: 'function',
    function: {
      name: `mcp__${serverId.replace(/[.-]/g, '_')}__${tool.name}`,
      description: `[${serverName}] ${tool.description || tool.name}`,
      parameters: (tool.inputSchema || { type: 'object', properties: {} }) as Record<string, unknown>,
    },
    _mcp: { serverId, serverName },
  };
}

/**
 * 反向：从 LLM tool_call name 解析为 MCP 服务器 + 工具
 * 命名约定：mcp__<serverId>__<toolName>
 */
export function parseMcpToolName(
  name: string,
): { serverId: string; toolName: string } | null {
  const match = name.match(/^mcp__(.+?)__(.+)$/);
  if (!match) return null;
  const serverId = (match[1] ?? '').replace(/_/g, '-');
  const toolName = match[2] ?? '';
  return { serverId, toolName };
}

/**
 * MCP Tool Call 桥接器
 * 提供：
 *   - 列出所有可用的 LLM 工具定义
 *   - 解析并执行 LLM tool_call
 *   - 转换为 LLM Tool 响应格式
 */
export class McpLlmBridge {
  private registry: McpServerRegistry;

  constructor(registry: McpServerRegistry = getDefaultMcpServerRegistry()) {
    this.registry = registry;
  }

  /**
   * 获取所有已连接 MCP 工具的 LLM 定义
   */
  listLlmToolDefinitions(): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
    _mcp?: { serverId: string; serverName: string };
  }> {
    const defs: Array<{
      type: 'function';
      function: { name: string; description: string; parameters: Record<string, unknown> };
      _mcp?: { serverId: string; serverName: string };
    }> = [];
    for (const status of this.registry.getAllStatus()) {
      if (!status.connected || !status.client) continue;
      const serverDef = this.registry.get(status.serverId);
      const serverName = serverDef?.name ?? status.serverId;
      for (const tool of status.tools) {
        defs.push(mcpToolToLlmDefinition(tool, status.serverId, serverName));
      }
    }
    return defs;
  }

  /**
   * 从已连接服务器列出所有资源 URI
   */
  listAllResourceUris(): Array<{ serverId: string; resource: Resource }> {
    return this.registry.listAllResources();
  }

  /**
   * 从已连接服务器列出所有提示词
   */
  listAllPromptNames(): Array<{ serverId: string; prompt: Prompt }> {
    return this.registry.listAllPrompts();
  }

  /**
   * 执行 LLM tool_call
   * @param name LLM 返回的工具名称（mcp__<serverId>__<toolName> 格式）
   * @param args 工具参数
   * @returns 工具执行结果 + 元数据
   */
  async executeLlmToolCall(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{
    success: boolean;
    result?: unknown;
    content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    error?: string;
    serverId?: string;
    toolName?: string;
  }> {
    const parsed = parseMcpToolName(name);
    if (!parsed) {
      return { success: false, error: `Invalid MCP tool name: ${name}` };
    }
    const client = this.registry.getClient(parsed.serverId);
    if (!client) {
      return {
        success: false,
        error: `Server not connected: ${parsed.serverId}`,
        serverId: parsed.serverId,
        toolName: parsed.toolName,
      };
    }
    try {
      const result = await client.callTool(parsed.toolName, args);
      // 转换为 LLM 友好的格式
      const content = result.content.map((c) => {
        if (c.type === 'text') return { type: 'text', text: c.text };
        if (c.type === 'image')
          return { type: 'image', data: c.data, mimeType: c.mimeType };
        return { type: 'resource', text: JSON.stringify(c.resource) };
      });
      return {
        success: !result.isError,
        result,
        content,
        serverId: parsed.serverId,
        toolName: parsed.toolName,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        serverId: parsed.serverId,
        toolName: parsed.toolName,
      };
    }
  }

  /**
   * 获取桥接统计
   */
  getStats(): {
    totalServers: number;
    connectedServers: number;
    totalTools: number;
    totalResources: number;
    totalPrompts: number;
  } {
    const allStatus = this.registry.getAllStatus();
    return {
      totalServers: this.registry.size(),
      connectedServers: allStatus.filter((s) => s.connected).length,
      totalTools: allStatus.reduce((sum, s) => sum + s.toolCount, 0),
      totalResources: allStatus.reduce((sum, s) => sum + s.resourceCount, 0),
      totalPrompts: allStatus.reduce((sum, s) => sum + s.promptCount, 0),
    };
  }
}

// ============ 全局单例 ============

let globalBridge: McpLlmBridge | null = null;

export function getDefaultMcpLlmBridge(): McpLlmBridge {
  if (!globalBridge) {
    globalBridge = new McpLlmBridge();
  }
  return globalBridge;
}

export function resetDefaultMcpLlmBridge(): void {
  globalBridge = null;
}
