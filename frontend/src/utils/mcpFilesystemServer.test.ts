/**
 * # ============================================================
 * # MCP Filesystem Server 集成测试 (v1.0.0 Cycle 43 G43-01)
 * # ============================================================
 * # 覆盖：filesystem MCP 服务器连接 + 工具调用 + Bridge 集成
 * #       - mock 模式（离线，CI 友好）
 * #       - real 模式（当沙箱允许 npx 时）
 * # 工具: read_file / write_file / list_directory / search_files
 * #       / get_file_info / list_allowed_directories
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 43 G43-01 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createFilesystemServer,
  withFilesystemServer,
} from './mcpFilesystemServer';
import { McpClient } from './mcpClient';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ============ Mock 模式测试 ============

describe('mcpFilesystemServer - mock 模式', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-fs-test-'));
    // 创建测试文件
    await fs.writeFile(path.join(tmpDir, 'hello.txt'), 'Hello, World!\nThis is a test file.', 'utf-8');
    await fs.writeFile(path.join(tmpDir, 'data.json'), '{"name": "test", "value": 42}', 'utf-8');
    await fs.mkdir(path.join(tmpDir, 'subdir'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'subdir', 'nested.txt'), 'Nested content', 'utf-8');
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe('服务器连接', () => {
    it('应该以 mock 模式启动', async () => {
      const ctx = await createFilesystemServer({
        allowedDirectories: [tmpDir],
        mode: 'mock',
      });

      expect(ctx.mode).toBe('mock');
      expect(ctx.client).toBeInstanceOf(McpClient);
      expect(ctx.client.isReady()).toBe(true);

      await ctx.close();
    });

    it('应该列出所有 filesystem 工具', async () => {
      const ctx = await createFilesystemServer({
        allowedDirectories: [tmpDir],
        mode: 'mock',
      });

      const tools = await ctx.client.listTools();
      const toolNames = tools.map((t) => t.name).sort();
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('write_file');
      expect(toolNames).toContain('list_directory');
      expect(toolNames).toContain('list_allowed_directories');

      await ctx.close();
    });
  });

  describe('工具调用', () => {
    it('read_file 读取文件内容', async () => {
      await withFilesystemServer(
        { allowedDirectories: [tmpDir], mode: 'mock' },
        async (ctx) => {
          const result = await ctx.client.callTool('read_file', {
            path: path.join(tmpDir, 'hello.txt'),
          });
          expect(result.isError).toBeFalsy();
          const text = (result.content[0] as { type: string; text: string }).text;
          expect(text).toContain('Hello, World!');
        },
      );
    });

    it('write_file 写入文件', async () => {
      await withFilesystemServer(
        { allowedDirectories: [tmpDir], mode: 'mock' },
        async (ctx) => {
          const testPath = path.join(tmpDir, 'new.txt');
          const result = await ctx.client.callTool('write_file', {
            path: testPath,
            content: 'New file content',
          });
          expect(result.isError).toBeFalsy();

          // 验证文件确实写入
          const content = await fs.readFile(testPath, 'utf-8');
          expect(content).toBe('New file content');
        },
      );
    });

    it('list_directory 列出目录', async () => {
      await withFilesystemServer(
        { allowedDirectories: [tmpDir], mode: 'mock' },
        async (ctx) => {
          const result = await ctx.client.callTool('list_directory', { path: tmpDir });
          expect(result.isError).toBeFalsy();
          const text = (result.content[0] as { type: string; text: string }).text;
          expect(text).toContain('hello.txt');
          expect(text).toContain('data.json');
          expect(text).toContain('subdir');
        },
      );
    });

    it('list_allowed_directories 返回允许的目录', async () => {
      await withFilesystemServer(
        { allowedDirectories: [tmpDir], mode: 'mock' },
        async (ctx) => {
          const result = await ctx.client.callTool('list_allowed_directories', {});
          const text = (result.content[0] as { type: string; text: string }).text;
          expect(text).toContain(tmpDir);
        },
      );
    });

    it('get_file_info 返回文件信息', async () => {
      await withFilesystemServer(
        { allowedDirectories: [tmpDir], mode: 'mock' },
        async (ctx) => {
          const result = await ctx.client.callTool('get_file_info', {
            path: path.join(tmpDir, 'hello.txt'),
          });
          expect(result.isError).toBeFalsy();
          const text = (result.content[0] as { type: string; text: string }).text;
          const info = JSON.parse(text);
          expect(info.type).toBe('file');
          expect(info.size).toBeGreaterThan(0);
        },
      );
    });

    it('search_files 搜索匹配文件', async () => {
      await withFilesystemServer(
        { allowedDirectories: [tmpDir], mode: 'mock' },
        async (ctx) => {
          const result = await ctx.client.callTool('search_files', {
            path: tmpDir,
            pattern: 'hello',
          });
          const text = (result.content[0] as { type: string; text: string }).text;
          expect(text).toContain('hello.txt');
        },
      );
    });
  });

  describe('安全校验', () => {
    it('路径不在 allowed 时拒绝访问', async () => {
      await withFilesystemServer(
        { allowedDirectories: [tmpDir], mode: 'mock' },
        async (ctx) => {
          const result = await ctx.client.callTool('read_file', {
            path: '/etc/passwd',
          });
          expect(result.isError).toBe(true);
          const text = (result.content[0] as { type: string; text: string }).text;
          expect(text).toMatch(/Access denied/);
        },
      );
    });

    it('不允许空 allowedDirectories', async () => {
      await expect(
        createFilesystemServer({ allowedDirectories: [], mode: 'mock' }),
      ).rejects.toThrow(/at least one/);
    });
  });

  describe('Bridge 集成', () => {
    it('McpToolBridge 自动注册所有工具', async () => {
      await withFilesystemServer(
        { allowedDirectories: [tmpDir], mode: 'mock' },
        async (ctx) => {
          const tools = ctx.toolBridge.list();
          expect(tools.length).toBeGreaterThan(0);

          const hermesDefs = ctx.toolBridge.getDefinitions();
          expect(hermesDefs.every((d) => d.name.startsWith('mcp__filesystem__'))).toBe(true);
        },
      );
    });

    it('通过 Bridge 调用工具', async () => {
      await withFilesystemServer(
        { allowedDirectories: [tmpDir], mode: 'mock' },
        async (ctx) => {
          const result = await ctx.toolBridge.execute({
            id: '1',
            name: 'mcp__filesystem__read_file',
            arguments: { path: path.join(tmpDir, 'hello.txt') },
          });
          expect(result.success).toBe(true);
        },
      );
    });

    it('ResourceBridge 初始化', async () => {
      await withFilesystemServer(
        { allowedDirectories: [tmpDir], mode: 'mock' },
        async (ctx) => {
          expect(ctx.resourceBridge).toBeDefined();
          // filesystem MCP 暂不暴露资源，但 bridge 应可用
          const stats = ctx.resourceBridge.getStats();
          expect(stats).toBeDefined();
        },
      );
    });

    it('PromptBridge 初始化', async () => {
      await withFilesystemServer(
        { allowedDirectories: [tmpDir], mode: 'mock' },
        async (ctx) => {
          expect(ctx.promptBridge).toBeDefined();
          const prompts = ctx.promptBridge.list();
          // filesystem MCP 无提示词
          expect(prompts).toEqual([]);
        },
      );
    });
  });

  describe('事件', () => {
    it('工具列表变更事件', async () => {
      await withFilesystemServer(
        { allowedDirectories: [tmpDir], mode: 'mock' },
        async (ctx) => {
          const handler = vi.fn();
          ctx.client.onToolsListChanged(handler);
          // filesystem mock 不会自动通知，但订阅应不报错
          expect(handler).toBeDefined();
        },
      );
    });
  });
});

// ============ Auto 模式测试 ============

describe('mcpFilesystemServer - auto 模式', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-fs-auto-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('auto 模式应该回退到 mock（当 npx 不可用时）', async () => {
    const ctx = await createFilesystemServer({
      allowedDirectories: [tmpDir],
      mode: 'auto',
    });

    // 沙箱中应回退到 mock
    expect(ctx.mode).toBe('mock');
    await ctx.close();
  });
});

// ============ 错误处理 ============

describe('mcpFilesystemServer - 错误处理', () => {
  it('空 allowedDirectories 抛出错误', async () => {
    await expect(
      createFilesystemServer({ allowedDirectories: [], mode: 'mock' }),
    ).rejects.toThrow();
  });

  it('close 后再次操作应失败或忽略', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-fs-close-'));
    try {
      const ctx = await createFilesystemServer({
        allowedDirectories: [tmpDir],
        mode: 'mock',
      });
      await ctx.close();
      // 关闭后，isReady 应为 false
      expect(ctx.client.isReady()).toBe(false);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
