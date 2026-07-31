/**
 * # ============================================================
 * # MCP Marketplace + Bridge 单元测试 (v1.0.0 Cycle 39 G39-04)
 * # ============================================================
 * # 覆盖：Marketplace 搜索/安装/Bridge 工具转换/执行
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 39 G39-04 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  MCP_MARKETPLACE_CATALOG,
  searchMarketplace,
  getMarketplaceStats,
  installFromMarketplace,
  mcpToolToLlmDefinition,
  parseMcpToolName,
  McpLlmBridge,
  getDefaultMcpLlmBridge,
  resetDefaultMcpLlmBridge,
  type McpMarketplaceEntry,
} from './mcpMarketplace';
import { createMcpServerRegistry, resetDefaultMcpServerRegistry } from './mcpRegistry';
import { McpClient } from './mcpClient';
import type { Tool } from './mcpTypes';

describe('MCP Marketplace 目录', () => {
  it('包含精选条目', () => {
    expect(MCP_MARKETPLACE_CATALOG.length).toBeGreaterThanOrEqual(10);
  });

  it('所有条目 ID 唯一', () => {
    const ids = MCP_MARKETPLACE_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('所有条目必要字段完整', () => {
    for (const e of MCP_MARKETPLACE_CATALOG) {
      expect(e.id).toBeTruthy();
      expect(e.name).toBeTruthy();
      expect(e.description).toBeTruthy();
      expect(e.category).toBeTruthy();
      expect(e.author).toBeTruthy();
      expect(e.version).toBeTruthy();
      expect(e.installCommand).toBeTruthy();
      expect(e.configExample).toBeTruthy();
      expect(e.icon).toBeTruthy();
      expect(e.rating).toBeGreaterThanOrEqual(0);
      expect(e.rating).toBeLessThanOrEqual(5);
      expect(Array.isArray(e.tags)).toBe(true);
      expect(e.tags.length).toBeGreaterThan(0);
      expect(Array.isArray(e.platforms)).toBe(true);
      expect(e.platforms.length).toBeGreaterThan(0);
    }
  });

  it('包含官方和社区服务器', () => {
    const official = MCP_MARKETPLACE_CATALOG.filter((e) => e.official);
    const community = MCP_MARKETPLACE_CATALOG.filter((e) => !e.official);
    expect(official.length).toBeGreaterThan(0);
    expect(community.length).toBeGreaterThan(0);
  });

  it('覆盖主要分类', () => {
    const cats = new Set(MCP_MARKETPLACE_CATALOG.map((e) => e.category));
    expect(cats.size).toBeGreaterThanOrEqual(4);
  });
});

describe('searchMarketplace', () => {
  it('空 query 返回所有', () => {
    expect(searchMarketplace('').length).toBe(MCP_MARKETPLACE_CATALOG.length);
  });

  it('按名称搜索', () => {
    const results = searchMarketplace('GitHub');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toContain('GitHub');
  });

  it('按标签搜索', () => {
    const results = searchMarketplace('database');
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const match = r.tags.includes('database') || r.name.toLowerCase().includes('database');
      expect(match).toBe(true);
    }
  });

  it('按描述搜索', () => {
    const results = searchMarketplace('browser');
    expect(results.length).toBeGreaterThan(0);
  });

  it('大小写不敏感', () => {
    const a = searchMarketplace('github');
    const b = searchMarketplace('GITHUB');
    expect(a.length).toBe(b.length);
  });

  it('按分类过滤', () => {
    const results = searchMarketplace('', { category: 'database' });
    for (const r of results) {
      expect(r.category).toBe('database');
    }
  });

  it('officialOnly 过滤', () => {
    const results = searchMarketplace('', { officialOnly: true });
    for (const r of results) {
      expect(r.official).toBe(true);
    }
  });

  it('无结果', () => {
    const results = searchMarketplace('zzz_nonexistent_zzz');
    expect(results.length).toBe(0);
  });
});

describe('getMarketplaceStats', () => {
  it('返回统计', () => {
    const stats = getMarketplaceStats();
    expect(stats.total).toBe(MCP_MARKETPLACE_CATALOG.length);
    expect(stats.official).toBeGreaterThan(0);
    expect(stats.community).toBeGreaterThan(0);
    expect(stats.totalDownloads).toBeGreaterThan(0);
    expect(Object.keys(stats.byCategory).length).toBeGreaterThan(0);
  });

  it('统计正确', () => {
    const stats = getMarketplaceStats();
    const all = Object.values(stats.byCategory).reduce((s, n) => s + n, 0);
    expect(all).toBe(stats.total);
  });
});

describe('installFromMarketplace', () => {
  beforeEach(() => {
    resetDefaultMcpServerRegistry();
  });

  it('成功安装', () => {
    const registry = createMcpServerRegistry({ persistEnabled: false });
    const entry = MCP_MARKETPLACE_CATALOG[0]!;
    const result = installFromMarketplace(entry, registry);
    expect(result.success).toBe(true);
    expect(registry.has(result.serverId)).toBe(true);
  });

  it('替换占位符', () => {
    const registry = createMcpServerRegistry({ persistEnabled: false });
    const entry = MCP_MARKETPLACE_CATALOG.find((e) => e.installCommand.includes('<allowed_dirs>'));
    if (entry) {
      const result = installFromMarketplace(entry, registry);
      expect(result.success).toBe(true);
      const def = registry.get(result.serverId);
      const args = (def?.transport as { args?: string[] }).args || [];
      expect(args).not.toContain('<allowed_dirs>');
    }
  });

  it('重复安装返回错误', () => {
    const registry = createMcpServerRegistry({ persistEnabled: false });
    const entry = MCP_MARKETPLACE_CATALOG[0]!;
    installFromMarketplace(entry, registry);
    const second = installFromMarketplace(entry, registry);
    expect(second.success).toBe(false);
    expect(second.error).toContain('exists');
  });

  it('生成的 ID 格式正确', () => {
    const registry = createMcpServerRegistry({ persistEnabled: false });
    const entry = MCP_MARKETPLACE_CATALOG[0]!;
    const result = installFromMarketplace(entry, registry);
    expect(result.serverId.startsWith('installed.')).toBe(true);
  });
});

describe('MCP <-> LLM 桥接工具函数', () => {
  it('mcpToolToLlmDefinition 正确转换', () => {
    const tool: Tool = {
      name: 'read_file',
      description: '读取文件',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    };
    const def = mcpToolToLlmDefinition(tool, 'builtin.filesystem', 'Filesystem');
    expect(def.type).toBe('function');
    expect(def.function.name).toBe('mcp__builtin_filesystem__read_file');
    expect(def.function.description).toContain('Filesystem');
    expect(def.function.description).toContain('读取文件');
    expect(def.function.parameters.properties).toBeDefined();
    expect(def._mcp?.serverId).toBe('builtin.filesystem');
  });

  it('parseMcpToolName 正确解析', () => {
    const parsed = parseMcpToolName('mcp__builtin_filesystem__read_file');
    expect(parsed).toEqual({
      serverId: 'builtin-filesystem',
      toolName: 'read_file',
    });
  });

  it('parseMcpToolName 拒绝非法名称', () => {
    expect(parseMcpToolName('regular_function')).toBeNull();
    expect(parseMcpToolName('mcp__server__')).toBeNull();
  });

  it('mcpToolToLlmDefinition + parseMcpToolName 互逆', () => {
    const tool: Tool = { name: 'list_tools', description: 'd', inputSchema: { type: 'object' } };
    const def = mcpToolToLlmDefinition(tool, 'test.server', 'Test');
    const parsed = parseMcpToolName(def.function.name);
    expect(parsed?.toolName).toBe('list_tools');
  });
});

describe('McpLlmBridge', () => {
  let bridge: McpLlmBridge;
  let registry: ReturnType<typeof createMcpServerRegistry>;

  beforeEach(() => {
    resetDefaultMcpServerRegistry();
    resetDefaultMcpLlmBridge();
    registry = createMcpServerRegistry({ persistEnabled: false });
    bridge = new McpLlmBridge(registry);
  });

  it('创建实例', () => {
    expect(bridge).toBeInstanceOf(McpLlmBridge);
  });

  it('初始 listLlmToolDefinitions 为空', () => {
    expect(bridge.listLlmToolDefinitions().length).toBe(0);
  });

  it('getStats 正确', () => {
    const stats = bridge.getStats();
    expect(stats.totalServers).toBe(5);
    expect(stats.connectedServers).toBe(0);
    expect(stats.totalTools).toBe(0);
  });

  it('executeLlmToolCall 拒绝非法名称', async () => {
    const result = await bridge.executeLlmToolCall('not_mcp_format', {});
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('executeLlmToolCall 未连接服务器', async () => {
    const result = await bridge.executeLlmToolCall('mcp__not_connected__tool', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('not connected');
  });
});

describe('全局 Bridge', () => {
  beforeEach(() => {
    resetDefaultMcpLlmBridge();
  });

  it('懒加载', () => {
    const b1 = getDefaultMcpLlmBridge();
    const b2 = getDefaultMcpLlmBridge();
    expect(b1).toBe(b2);
  });

  it('reset 创建新实例', () => {
    const b1 = getDefaultMcpLlmBridge();
    resetDefaultMcpLlmBridge();
    const b2 = getDefaultMcpLlmBridge();
    expect(b1).not.toBe(b2);
  });
});
