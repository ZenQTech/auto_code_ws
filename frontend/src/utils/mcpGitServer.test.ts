/**
 * # ============================================================
 * # MCP Git Server 集成测试 (v1.0.0 Cycle 43 G43-02)
 * # ============================================================
 * # 覆盖：git MCP 服务器连接 + 工具调用 + Bridge 集成
 * # 工具: git_status / git_diff / git_log / git_show / git_branch_list
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 43 G43-02 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createGitServer,
  withGitServer,
} from './mcpGitServer';
import { McpClient } from './mcpClient';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('mcpGitServer - mock 模式', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-git-test-'));
    // 创建 .git 目录标识为 git 仓库
    await fs.mkdir(path.join(tmpDir, '.git'), { recursive: true });
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
      const ctx = await createGitServer({
        repositoryPath: tmpDir,
        mode: 'mock',
      });

      expect(ctx.mode).toBe('mock');
      expect(ctx.client).toBeInstanceOf(McpClient);
      expect(ctx.client.isReady()).toBe(true);

      await ctx.close();
    });

    it('应该列出所有 git 工具', async () => {
      const ctx = await createGitServer({
        repositoryPath: tmpDir,
        mode: 'mock',
      });

      const tools = await ctx.client.listTools();
      const toolNames = tools.map((t) => t.name).sort();
      expect(toolNames).toContain('git_status');
      expect(toolNames).toContain('git_diff');
      expect(toolNames).toContain('git_log');
      expect(toolNames).toContain('git_show');
      expect(toolNames).toContain('git_branch_list');

      await ctx.close();
    });
  });

  describe('工具调用', () => {
    it('git_status 显示工作区状态', async () => {
      await withGitServer({ repositoryPath: tmpDir, mode: 'mock' }, async (ctx) => {
        const result = await ctx.client.callTool('git_status', {});
        expect(result.isError).toBeFalsy();
        const text = (result.content[0] as { type: string; text: string }).text;
        expect(text).toContain('On branch');
      });
    });

    it('git_diff 显示差异', async () => {
      await withGitServer({ repositoryPath: tmpDir, mode: 'mock' }, async (ctx) => {
        const result = await ctx.client.callTool('git_diff', {});
        expect(result.isError).toBeFalsy();
        const text = (result.content[0] as { type: string; text: string }).text;
        expect(text).toContain('diff --git');
      });
    });

    it('git_log 显示提交历史', async () => {
      await withGitServer({ repositoryPath: tmpDir, mode: 'mock' }, async (ctx) => {
        const result = await ctx.client.callTool('git_log', {});
        expect(result.isError).toBeFalsy();
        const text = (result.content[0] as { type: string; text: string }).text;
        expect(text).toContain('commit');
        expect(text).toContain('Author:');
      });
    });

    it('git_show 显示提交详情', async () => {
      await withGitServer({ repositoryPath: tmpDir, mode: 'mock' }, async (ctx) => {
        const result = await ctx.client.callTool('git_show', { commit: 'a1b2c3d4' });
        expect(result.isError).toBeFalsy();
        const text = (result.content[0] as { type: string; text: string }).text;
        expect(text).toContain('commit');
      });
    });

    it('git_branch_list 列出分支', async () => {
      await withGitServer({ repositoryPath: tmpDir, mode: 'mock' }, async (ctx) => {
        const result = await ctx.client.callTool('git_branch_list', {});
        expect(result.isError).toBeFalsy();
        const text = (result.content[0] as { type: string; text: string }).text;
        expect(text).toContain('main');
        expect(text).toContain('develop');
        expect(text).toContain('*'); // 当前分支标记
      });
    });
  });

  describe('Bridge 集成', () => {
    it('McpToolBridge 自动注册所有 git 工具', async () => {
      await withGitServer({ repositoryPath: tmpDir, mode: 'mock' }, async (ctx) => {
        const tools = ctx.toolBridge.list();
        expect(tools.length).toBeGreaterThan(0);

        const hermesDefs = ctx.toolBridge.getDefinitions();
        expect(hermesDefs.every((d) => d.name.startsWith('mcp__git__'))).toBe(true);
      });
    });

    it('通过 Bridge 调用 git_status', async () => {
      await withGitServer({ repositoryPath: tmpDir, mode: 'mock' }, async (ctx) => {
        const result = await ctx.toolBridge.execute({
          id: '1',
          name: 'mcp__git__git_status',
          arguments: {},
        });
        expect(result.success).toBe(true);
        // 验证结果
        const text = (result as unknown as { data?: { content?: Array<{ text: string }> } }).data?.content?.[0]?.text;
        if (text) {
          expect(text).toContain('On branch');
        }
      });
    });
  });

  describe('自定义配置', () => {
    it('支持自定义提交历史', async () => {
      const customCommit = {
        hash: 'custom123',
        author: 'Custom',
        email: 'c@example.com',
        date: '2026-08-01T00:00:00Z',
        message: 'Custom commit',
      };

      await withGitServer(
        {
          repositoryPath: tmpDir,
          mode: 'mock',
          commits: [customCommit],
        },
        async (ctx) => {
          const result = await ctx.client.callTool('git_show', { commit: 'custom123' });
          const text = (result.content[0] as { type: string; text: string }).text;
          expect(text).toContain('Custom commit');
        },
      );
    });

    it('支持自定义分支列表', async () => {
      await withGitServer(
        {
          repositoryPath: tmpDir,
          mode: 'mock',
          branches: [{ name: 'experimental', current: true }],
        },
        async (ctx) => {
          const result = await ctx.client.callTool('git_branch_list', {});
          const text = (result.content[0] as { type: string; text: string }).text;
          expect(text).toContain('* experimental');
        },
      );
    });
  });
});

describe('mcpGitServer - auto 模式', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-git-auto-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('auto 模式应该回退到 mock', async () => {
    const ctx = await createGitServer({
      repositoryPath: tmpDir,
      mode: 'auto',
    });
    expect(ctx.mode).toBe('mock');
    await ctx.close();
  });
});

describe('mcpGitServer - 错误处理', () => {
  it('空 repositoryPath 抛出错误', async () => {
    await expect(
      createGitServer({ repositoryPath: '', mode: 'mock' }),
    ).rejects.toThrow(/repositoryPath/);
  });
});
