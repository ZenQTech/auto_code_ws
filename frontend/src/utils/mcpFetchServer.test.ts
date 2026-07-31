/**
 * # ============================================================
 * # MCP Fetch Server 集成测试 (v1.0.0 Cycle 43 G43-03)
 * # ============================================================
 * # 覆盖：fetch MCP 服务器连接 + 工具调用 + Bridge 集成
 * # 工具: fetch (GET/POST/PUT/DELETE)
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 43 G43-03 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createFetchServer,
  withFetchServer,
} from './mcpFetchServer';
import { McpClient } from './mcpClient';

describe('mcpFetchServer - mock 模式', () => {
  describe('服务器连接', () => {
    it('应该以 mock 模式启动', async () => {
      const ctx = await createFetchServer({ mode: 'mock' });
      expect(ctx.mode).toBe('mock');
      expect(ctx.client).toBeInstanceOf(McpClient);
      expect(ctx.client.isReady()).toBe(true);
      await ctx.close();
    });

    it('应该列出 fetch 工具', async () => {
      const ctx = await createFetchServer({ mode: 'mock' });
      const tools = await ctx.client.listTools();
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('fetch');
      await ctx.close();
    });
  });

  describe('工具调用', () => {
    it('fetch 默认 GET 请求', async () => {
      await withFetchServer(
        {
          mode: 'mock',
          mockResponses: [
            {
              url: 'https://api.example.com/data',
              status: 200,
              statusText: 'OK',
              body: '{"result": "success"}',
              contentType: 'application/json',
            },
          ],
        },
        async (ctx) => {
          const result = await ctx.client.callTool('fetch', { url: 'https://api.example.com/data' });
          expect(result.isError).toBeFalsy();
          const text = (result.content[0] as { type: string; text: string }).text;
          expect(text).toContain('200 OK');
          expect(text).toContain('application/json');
          expect(text).toContain('"result": "success"');
        },
      );
    });

    it('fetch HTML 响应', async () => {
      await withFetchServer(
        {
          mode: 'mock',
          mockResponses: [
            {
              url: 'https://example.com/',
              status: 200,
              statusText: 'OK',
              body: '<html><body>Hello</body></html>',
              contentType: 'text/html',
            },
          ],
        },
        async (ctx) => {
          const result = await ctx.client.callTool('fetch', { url: 'https://example.com/' });
          expect(result.isError).toBeFalsy();
          const text = (result.content[0] as { type: string; text: string }).text;
          expect(text).toContain('text/html');
          expect(text).toContain('<html>');
        },
      );
    });

    it('fetch POST 请求', async () => {
      await withFetchServer({ mode: 'mock' }, async (ctx) => {
        const result = await ctx.client.callTool('fetch', {
          url: 'https://api.example.com/data',
          method: 'POST',
          body: '{"key": "value"}',
        });
        // mock 模式下，POST 应正常返回（即使 response 来自 mock 列表）
        expect(result).toBeDefined();
      });
    });

    it('fetch 不存在的 URL 返回 404', async () => {
      await withFetchServer({ mode: 'mock' }, async (ctx) => {
        const result = await ctx.client.callTool('fetch', {
          url: 'https://notfound.example.com/',
        });
        // 默认 defaultResponse 状态为 404
        expect(result.isError).toBe(true);
        const text = (result.content[0] as { type: string; text: string }).text;
        expect(text).toContain('404');
      });
    });
  });

  describe('安全控制', () => {
    it('allowedUrls 限制只访问指定 URL', async () => {
      await withFetchServer(
        {
          mode: 'mock',
          allowedUrls: ['https://allowed.example.com/'],
          mockResponses: [
            {
              url: 'https://allowed.example.com/data',
              status: 200,
              statusText: 'OK',
              body: 'OK',
              contentType: 'text/plain',
            },
          ],
        },
        async (ctx) => {
          // 允许的 URL
          const okResult = await ctx.client.callTool('fetch', {
            url: 'https://allowed.example.com/data',
          });
          expect(okResult.isError).toBeFalsy();

          // 不允许的 URL
          const denyResult = await ctx.client.callTool('fetch', {
            url: 'https://blocked.example.com/data',
          });
          expect(denyResult.isError).toBe(true);
          const text = (denyResult.content[0] as { type: string; text: string }).text;
          expect(text).toMatch(/not allowed/);
        },
      );
    });
  });

  describe('Bridge 集成', () => {
    it('McpToolBridge 自动注册 fetch 工具', async () => {
      await withFetchServer({ mode: 'mock' }, async (ctx) => {
        const tools = ctx.toolBridge.list();
        expect(tools.length).toBeGreaterThan(0);
        const hermesDefs = ctx.toolBridge.getDefinitions();
        expect(hermesDefs[0].name).toMatch(/^mcp__fetch__/);
      });
    });

    it('通过 Bridge 调用 fetch', async () => {
      await withFetchServer(
        {
          mode: 'mock',
          mockResponses: [
            {
              url: 'https://api.example.com/test',
              status: 200,
              statusText: 'OK',
              body: 'Bridge test success',
              contentType: 'text/plain',
            },
          ],
        },
        async (ctx) => {
          const result = await ctx.toolBridge.execute({
            id: '1',
            name: 'mcp__fetch__fetch',
            arguments: { url: 'https://api.example.com/test' },
          });
          expect(result.success).toBe(true);
        },
      );
    });
  });
});

describe('mcpFetchServer - auto 模式', () => {
  it('auto 模式应该回退到 mock', async () => {
    const ctx = await createFetchServer({ mode: 'auto' });
    expect(ctx.mode).toBe('mock');
    await ctx.close();
  });
});

describe('mcpFetchServer - 错误处理', () => {
  it('空 URL 报错', async () => {
    await withFetchServer({ mode: 'mock' }, async (ctx) => {
      const result = await ctx.client.callTool('fetch', { url: '' });
      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: string; text: string }).text;
      expect(text).toMatch(/required/i);
    });
  });

  it('未知工具返回错误', async () => {
    await withFetchServer({ mode: 'mock' }, async (ctx) => {
      const result = await ctx.client.callTool('unknown_tool', {});
      expect(result.isError).toBe(true);
    });
  });
});
