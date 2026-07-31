/**
 * # ============================================================
 * # MCP Tool Bridge - MCP 工具桥接 (v1.0.0 Cycle 42 G42-01)
 * # ============================================================
 * # 核心作用：将 MCP 工具自动发现并注册到 Hermes ToolRegistry
 * #           - MCP Tool ↔ Hermes ToolDefinition 双向转换
 * #           - 工具命名空间: mcp__<serverId>__<toolName>
 * #           - 监听 notifications/tools/list_changed 实时同步
 * #           - 工具调用路由：Hermes tool_call → MCP 服务器执行
 * # 对标产品：@modelcontextprotocol/sdk (TypeScript 官方 SDK)
 * # 协议版本：MCP 2024-11-05
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 42 G42-01 初次创建
 * # ============================================================
 */

import type { McpClient } from './mcpClient';
import { getDefaultMcpServerRegistry } from './mcpRegistry';
import type { Tool, ToolContent, ToolCallResult as McpToolCallResult } from './mcpTypes';
import type { JSONSchema } from './toolUseEngine';
import {
  type ToolDefinition as HermesToolDefinition,
  type ToolCall as HermesToolCall,
  type ToolCallResult as HermesToolCallResult,
  type ToolError,
  type ToolExecutor,
} from './toolUseEngine';

// ============ 类型定义 ============

/**
 * MCP 工具限定名
 * 格式: mcp__<serverId>__<toolName>
 */
export type McpToolQualifiedName = string;

/**
 * 工具桥接事件
 */
export type McpToolBridgeEvent =
  | { type: 'server-registered'; serverId: string; toolCount: number; at: number }
  | { type: 'server-unregistered'; serverId: string; toolCount: number; at: number }
  | { type: 'tools-updated'; serverId: string; added: string[]; removed: string[]; at: number }
  | { type: 'tool-executed'; serverId: string; toolName: string; qualifiedName: string; durationMs: number; success: boolean; at: number }
  | { type: 'error'; error: Error; at: number };

export type McpToolBridgeListener = (event: McpToolBridgeEvent) => void;

/**
 * 注册的工具
 */
export interface McpRegisteredTool {
  /** 限定名（用于 LLM 工具调用） */
  qualifiedName: McpToolQualifiedName;
  /** 服务器 ID */
  serverId: string;
  /** 服务器名称 */
  serverName: string;
  /** 原始 MCP 工具 */
  mcpTool: Tool;
  /** Hermes 工具定义 */
  hermesDefinition: HermesToolDefinition;
}

/**
 * 工具统计
 */
export interface McpToolStats {
  totalServers: number;
  totalTools: number;
  totalCalls: number;
  successCalls: number;
  failureCalls: number;
  avgDurationMs: number;
}

// ============ 工具函数 ============

/**
 * 构造 MCP 工具限定名
 */
export function buildMcpToolName(serverId: string, toolName: string): McpToolQualifiedName {
  return `mcp__${serverId}__${toolName}`;
}

/**
 * 解析 MCP 工具限定名
 * @returns null 表示不是 MCP 工具名
 */
export function parseMcpToolName(qualifiedName: string): { serverId: string; toolName: string } | null {
  const match = qualifiedName.match(/^mcp__([a-zA-Z0-9_-]+)__(.+)$/);
  if (!match) return null;
  return { serverId: match[1], toolName: match[2] };
}

/**
 * MCP Tool → Hermes ToolDefinition 转换
 */
export function convertMcpToolToHermes(serverId: string, serverName: string, tool: Tool): HermesToolDefinition {
  return {
    name: buildMcpToolName(serverId, tool.name),
    description: `${serverName}: ${tool.description ?? tool.name}`,
    parameters: (tool.inputSchema ?? { type: 'object' }) as unknown as JSONSchema,
    permission: 'auto', // MCP 工具走 MCP 自身权限
    category: 'mcp',
    version: '1.0.0',
  };
}

/**
 * 将 MCP ToolCallResult 转换为 Hermes ToolCallResult
 */
function convertMcpResultToHermes(
  call: HermesToolCall,
  result: McpToolCallResult,
  durationMs: number,
): HermesToolCallResult {
  if (result.isError) {
    const textItem = result.content.find((c) => c.type === 'text');
    const message = textItem && textItem.type === 'text' ? textItem.text : 'Tool execution failed';
    const error: ToolError = {
      code: 'EXECUTION_ERROR',
      message,
      details: result,
    };
    return {
      callId: call.id,
      name: call.name,
      success: false,
      error,
      durationMs,
      timestamp: Date.now(),
    };
  }
  return {
    callId: call.id,
    name: call.name,
    success: true,
    result: result.content,
    durationMs,
    timestamp: Date.now(),
  };
}

// ============ MCP 工具桥接主类 ============

/**
 * MCP 工具桥接
 * 负责：
 * 1. 将 MCP 工具自动注册到 Hermes ToolRegistry
 * 2. 监听工具列表变更实时同步
 * 3. 路由工具调用到对应 MCP 服务器
 */
export class McpToolBridge {
  /** 已注册的工具（key: qualifiedName） */
  private readonly tools: Map<McpToolQualifiedName, McpRegisteredTool> = new Map();
  /** 服务器工具映射（key: serverId, value: qualifiedNames） */
  private readonly serverTools: Map<string, Set<McpToolQualifiedName>> = new Map();
  /** 服务器客户端引用 */
  private readonly serverClients: Map<string, McpClient> = new Map();
  /** 工具变更通知解绑函数 */
  private readonly unsubscribers: Map<string, () => void> = new Map();
  /** 事件监听器 */
  private readonly listeners: Set<McpToolBridgeListener> = new Set();
  /** 统计 */
  private stats = {
    totalCalls: 0,
    successCalls: 0,
    failureCalls: 0,
    totalDurationMs: 0,
  };

  /**
   * 注册服务器的所有工具
   * @returns 注册的工具数量
   */
  async registerServer(serverId: string, client: McpClient): Promise<number> {
    if (!client.isReady()) {
      throw new Error(`Client for server '${serverId}' is not ready`);
    }

    // 已注册则先清理
    if (this.serverTools.has(serverId)) {
      await this.unregisterServer(serverId);
    }

    this.serverClients.set(serverId, client);

    // 获取工具列表
    const mcpTools = await client.listTools();

    // 服务器名称（从 client 提取）
    const serverName = client.getServerInfo()?.name ?? serverId;

    // 转换并注册
    const toolSet = new Set<McpToolQualifiedName>();
    for (const mcpTool of mcpTools) {
      const qualifiedName = buildMcpToolName(serverId, mcpTool.name);
      const hermesDef = convertMcpToolToHermes(serverId, serverName, mcpTool);
      const registered: McpRegisteredTool = {
        qualifiedName,
        serverId,
        serverName,
        mcpTool,
        hermesDefinition: hermesDef,
      };
      this.tools.set(qualifiedName, registered);
      toolSet.add(qualifiedName);
    }
    this.serverTools.set(serverId, toolSet);

    // 订阅工具列表变更
    const unsubscribe = client.onToolsListChanged(async () => {
      await this.handleServerToolsChanged(serverId, client);
    });
    this.unsubscribers.set(serverId, unsubscribe);

    this.emit({ type: 'server-registered', serverId, toolCount: toolSet.size, at: Date.now() });
    return toolSet.size;
  }

  /**
   * 注销服务器的所有工具
   */
  async unregisterServer(serverId: string): Promise<void> {
    const toolSet = this.serverTools.get(serverId);
    if (!toolSet) return;

    // 解绑变更通知
    const unsub = this.unsubscribers.get(serverId);
    if (unsub) {
      unsub();
      this.unsubscribers.delete(serverId);
    }

    // 移除工具
    for (const qualifiedName of toolSet) {
      this.tools.delete(qualifiedName);
    }
    this.serverTools.delete(serverId);
    this.serverClients.delete(serverId);

    const count = toolSet.size;
    this.emit({ type: 'server-unregistered', serverId, toolCount: count, at: Date.now() });
  }

  /**
   * 注销所有服务器
   */
  async unregisterAll(): Promise<void> {
    const serverIds = Array.from(this.serverTools.keys());
    for (const serverId of serverIds) {
      await this.unregisterServer(serverId);
    }
  }

  /**
   * 获取所有 Hermes 工具定义
   */
  getDefinitions(): HermesToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.hermesDefinition);
  }

  /**
   * 获取限定名对应的工具定义
   */
  getDefinition(qualifiedName: string): HermesToolDefinition | undefined {
    return this.tools.get(qualifiedName)?.hermesDefinition;
  }

  /**
   * 获取限定名对应的注册信息
   */
  getRegisteredTool(qualifiedName: string): McpRegisteredTool | undefined {
    return this.tools.get(qualifiedName);
  }

  /**
   * 列出所有已注册工具
   */
  list(): McpRegisteredTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 列出指定服务器的工具
   */
  listByServer(serverId: string): McpRegisteredTool[] {
    const toolSet = this.serverTools.get(serverId);
    if (!toolSet) return [];
    return Array.from(toolSet)
      .map((qn) => this.tools.get(qn))
      .filter((t): t is McpRegisteredTool => t !== undefined);
  }

  /**
   * 执行 MCP 工具调用
   */
  async execute(call: HermesToolCall): Promise<HermesToolCallResult> {
    const startTime = Date.now();
    this.stats.totalCalls += 1;

    const parsed = parseMcpToolName(call.name);
    if (!parsed) {
      this.stats.failureCalls += 1;
      return {
        callId: call.id,
        name: call.name,
        success: false,
        error: { code: 'NOT_FOUND', message: `Not an MCP tool: ${call.name}` },
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
      };
    }

    const { serverId, toolName } = parsed;
    const registered = this.listByServer(serverId).find((t) => t.mcpTool.name === toolName);
    if (!registered) {
      this.stats.failureCalls += 1;
      return {
        callId: call.id,
        name: call.name,
        success: false,
        error: { code: 'NOT_FOUND', message: `Tool not found: ${call.name}` },
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
      };
    }

    const client = this.serverClients.get(serverId);
    if (!client || !client.isReady()) {
      this.stats.failureCalls += 1;
      return {
        callId: call.id,
        name: call.name,
        success: false,
        error: { code: 'EXECUTION_ERROR', message: `Server '${serverId}' is not connected` },
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
      };
    }

    try {
      const mcpResult = await client.callTool(toolName, call.arguments);
      const durationMs = Date.now() - startTime;
      this.stats.totalDurationMs += durationMs;
      const hermesResult = convertMcpResultToHermes(call, mcpResult, durationMs);
      if (hermesResult.success) {
        this.stats.successCalls += 1;
      } else {
        this.stats.failureCalls += 1;
      }
      this.emit({
        type: 'tool-executed',
        serverId,
        toolName,
        qualifiedName: call.name,
        durationMs,
        success: hermesResult.success,
        at: Date.now(),
      });
      return hermesResult;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      this.stats.failureCalls += 1;
      const error: ToolError = {
        code: 'EXECUTION_ERROR',
        message: err instanceof Error ? err.message : String(err),
        details: err,
      };
      this.emit({
        type: 'error',
        error: err instanceof Error ? err : new Error(String(err)),
        at: Date.now(),
      });
      return {
        callId: call.id,
        name: call.name,
        success: false,
        error,
        durationMs,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * 创建 ToolExecutor（用于注册到 Hermes ToolRegistry）
   * 注意：ToolRegistry.register 需要 executor，本方法返回绑定到本桥接的 executor
   */
  createExecutor(): ToolExecutor {
    return {
      type: 'mcp',
      execute: async (call: HermesToolCall, _tool: HermesToolDefinition): Promise<HermesToolCallResult> => {
        return await this.execute(call);
      },
    };
  }

  /**
   * 同步注册到外部 ToolRegistry
   * @returns 注册的工具数量
   */
  async registerToToolRegistry(registry: {
    register(definition: HermesToolDefinition, executor: ToolExecutor): void;
  }): Promise<number> {
    const defs = this.getDefinitions();
    const executor = this.createExecutor();
    for (const def of defs) {
      registry.register(def, executor);
    }
    return defs.length;
  }

  /**
   * 获取统计
   */
  getStats(): McpToolStats {
    return {
      totalServers: this.serverTools.size,
      totalTools: this.tools.size,
      totalCalls: this.stats.totalCalls,
      successCalls: this.stats.successCalls,
      failureCalls: this.stats.failureCalls,
      avgDurationMs:
        this.stats.totalCalls > 0 ? this.stats.totalDurationMs / this.stats.totalCalls : 0,
    };
  }

  /**
   * 订阅事件
   */
  on(listener: McpToolBridgeListener): () => void {
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
    this.tools.clear();
    this.serverTools.clear();
    this.serverClients.clear();
    this.listeners.clear();
  }

  // ============ 私有方法 ============

  /**
   * 处理服务器工具列表变更
   */
  private async handleServerToolsChanged(serverId: string, client: McpClient): Promise<void> {
    try {
      const oldToolSet = this.serverTools.get(serverId) ?? new Set<McpToolQualifiedName>();
      const newMcpTools = await client.listTools();
      const newToolSet = new Set<McpToolQualifiedName>();
      const added: string[] = [];
      const removed: string[] = [];

      // 检测新增
      for (const mcpTool of newMcpTools) {
        const qn = buildMcpToolName(serverId, mcpTool.name);
        newToolSet.add(qn);
        if (!oldToolSet.has(qn)) {
          added.push(mcpTool.name);
        }
      }

      // 检测删除
      for (const qn of oldToolSet) {
        if (!newToolSet.has(qn)) {
          removed.push(qn);
          this.tools.delete(qn);
        }
      }

      // 更新工具集
      this.serverTools.set(serverId, newToolSet);

      // 添加新工具
      const serverName = client.getServerInfo()?.name ?? serverId;
      for (const mcpTool of newMcpTools) {
        if (added.includes(mcpTool.name)) {
          const qn = buildMcpToolName(serverId, mcpTool.name);
          this.tools.set(qn, {
            qualifiedName: qn,
            serverId,
            serverName,
            mcpTool,
            hermesDefinition: convertMcpToolToHermes(serverId, serverName, mcpTool),
          });
        }
      }

      if (added.length > 0 || removed.length > 0) {
        this.emit({ type: 'tools-updated', serverId, added, removed, at: Date.now() });
      }
    } catch (err) {
      this.emit({
        type: 'error',
        error: err instanceof Error ? err : new Error(String(err)),
        at: Date.now(),
      });
    }
  }

  private emit(event: McpToolBridgeEvent): void {
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
 * 创建 MCP 工具桥接
 */
export function createMcpToolBridge(): McpToolBridge {
  return new McpToolBridge();
}

/**
 * 桥接到已注册服务器
 * 自动连接所有已启用的服务器并注册其工具
 * @returns 桥接实例 + 总注册工具数
 */
export async function bridgeAllEnabledServers(bridge: McpToolBridge): Promise<{ totalTools: number; serverCount: number }> {
  const registry = getDefaultMcpServerRegistry();
  const servers = registry.list().filter((s) => s.enabledByDefault);

  let totalTools = 0;
  for (const server of servers) {
    const status = registry.getStatus(server.id);
    if (!status?.connected) {
      try {
        await registry.connect(server.id);
      } catch {
        // 跳过无法连接的服务器
        continue;
      }
    }
    const client = registry.getClient(server.id);
    if (client) {
      try {
        const count = await bridge.registerServer(server.id, client);
        totalTools += count;
      } catch {
        // 跳过注册失败的服务器
      }
    }
  }

  return { totalTools, serverCount: servers.length };
}
