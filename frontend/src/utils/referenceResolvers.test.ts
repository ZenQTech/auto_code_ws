/**
 * Reference Resolvers 测试 (v6.38.0 Cycle 18 G18-01)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveCodebase,
  resolveGit,
  resolveDiff,
  formatCodebaseForPrompt,
  formatGitForPrompt,
  formatDiffForPrompt,
  isSensitivePath,
  filterSensitiveResults,
  LRUCache,
  resetGlobalCache,
  getCacheStats,
  type CodebaseContext,
  type GitContext,
  type DiffContext,
} from './referenceResolvers';

describe('Reference Resolvers (Cycle 18 G18-01)', () => {
  beforeEach(() => {
    resetGlobalCache();
  });

  // ============================================================
  // Sensitive Path Filter
  // ============================================================
  describe('isSensitivePath', () => {
    it('应该检测 .env 文件', () => {
      expect(isSensitivePath('.env')).toBe(true);
      expect(isSensitivePath('.env.production')).toBe(true);
      expect(isSensitivePath('config/.env.local')).toBe(true);
    });

    it('应该检测 SSH 密钥', () => {
      expect(isSensitivePath('.ssh/id_rsa')).toBe(true);
      expect(isSensitivePath('home/user/.ssh/id_dsa')).toBe(true);
    });

    it('应该检测 .pem / .key 文件', () => {
      expect(isSensitivePath('cert.pem')).toBe(true);
      expect(isSensitivePath('private.key')).toBe(true);
    });

    it('不应该误判普通文件', () => {
      expect(isSensitivePath('src/utils.ts')).toBe(false);
      expect(isSensitivePath('README.md')).toBe(false);
      expect(isSensitivePath('package.json')).toBe(false);
    });
  });

  describe('filterSensitiveResults', () => {
    it('应该过滤掉敏感结果', () => {
      const items = [
        { filePath: 'src/utils.ts', snippet: 'safe' },
        { filePath: '.env', snippet: 'danger' },
        { filePath: 'README.md', snippet: 'safe' },
      ];
      const filtered = filterSensitiveResults(items);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((i) => i.filePath)).not.toContain('.env');
    });
  });

  // ============================================================
  // LRU Cache
  // ============================================================
  describe('LRUCache', () => {
    it('应该正确存储和获取', () => {
      const cache = new LRUCache<string, number>(3, 60_000);
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBe(2);
    });

    it('应该 LRU 淘汰', () => {
      const cache = new LRUCache<string, number>(2, 60_000);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3); // a 应被淘汰
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
      expect(cache.has('c')).toBe(true);
    });

    it('应该支持 TTL 过期', async () => {
      const cache = new LRUCache<string, number>(2, 50);
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
      await new Promise((r) => setTimeout(r, 60));
      expect(cache.get('a')).toBeUndefined();
    });

    it('应该正确清空', () => {
      const cache = new LRUCache<string, number>(3, 60_000);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.has('a')).toBe(false);
    });
  });

  // ============================================================
  // Codebase Resolver
  // ============================================================
  describe('resolveCodebase', () => {
    it('应该返回 codebase 上下文', async () => {
      const ctx = await resolveCodebase('user authentication');
      expect(ctx.type).toBe('codebase');
      expect(ctx.query).toBe('user authentication');
      expect(ctx.results.length).toBeGreaterThan(0);
      expect(ctx.resolvedAt).toBeGreaterThan(0);
    });

    it('应该过滤敏感结果', async () => {
      const ctx = await resolveCodebase('test');
      const hasSensitive = ctx.results.some((r) => isSensitivePath(r.filePath));
      expect(hasSensitive).toBe(false);
    });

    it('应该支持 topK 选项', async () => {
      const ctx = await resolveCodebase('test', { topK: 3 });
      expect(ctx.results.length).toBeLessThanOrEqual(3);
    });

    it('应该使用缓存', async () => {
      const ctx1 = await resolveCodebase('cached query', { topK: 5 });
      const ctx2 = await resolveCodebase('cached query', { topK: 5 });
      expect(ctx1.query).toBe(ctx2.query);
      // 第二次应来自缓存
      expect(ctx2.source).toBe('cache');
    });

    it('结果应包含分数和代码片段', async () => {
      const ctx = await resolveCodebase('test');
      for (const r of ctx.results) {
        expect(r.score).toBeGreaterThan(0);
        expect(r.snippet).toBeTruthy();
        expect(r.filePath).toBeTruthy();
      }
    });
  });

  // ============================================================
  // Git Resolver
  // ============================================================
  describe('resolveGit', () => {
    it('应该支持 log 子命令', async () => {
      const ctx = await resolveGit('log', { limit: 3 });
      expect(ctx.type).toBe('git');
      expect(ctx.ref).toBe('log');
      expect(Array.isArray(ctx.data)).toBe(true);
      expect((ctx.data as any[]).length).toBe(3);
    });

    it('应该支持 blame 子命令', async () => {
      const ctx = await resolveGit('blame', { filePath: 'src/auth.ts', line: 42 });
      expect(ctx.ref).toBe('blame');
      expect(ctx.filePath).toBe('src/auth.ts');
      expect(ctx.line).toBe(42);
      const blame = ctx.data as any[];
      expect(blame[0].filePath).toBe('src/auth.ts');
      expect(blame[0].line).toBe(42);
    });

    it('应该支持 branch 子命令', async () => {
      const ctx = await resolveGit('branch');
      expect(ctx.ref).toBe('branch');
      const branches = ctx.data as string[];
      expect(branches).toContain('main');
    });

    it('应该支持 status 子命令', async () => {
      const ctx = await resolveGit('status');
      expect(ctx.ref).toBe('status');
      const status = ctx.data as { branch: string; ahead: number; behind: number };
      expect(status.branch).toBe('main');
    });

    it('应该支持 file 过滤的 log', async () => {
      const ctx = await resolveGit('log', { filePath: 'src/utils.ts', limit: 5 });
      expect(ctx.filePath).toBe('src/utils.ts');
      const commits = ctx.data as any[];
      for (const c of commits) {
        expect(c.files).toContain('src/utils.ts');
      }
    });

    it('应该使用缓存', async () => {
      await resolveGit('log', { limit: 3 });
      const ctx2 = await resolveGit('log', { limit: 3 });
      expect(ctx2.source).toBe('cache');
    });
  });

  // ============================================================
  // Diff Resolver
  // ============================================================
  describe('resolveDiff', () => {
    it('应该支持 working ref', async () => {
      const ctx = await resolveDiff('working');
      expect(ctx.type).toBe('diff');
      expect(ctx.ref).toBe('working');
      expect(ctx.files.length).toBeGreaterThan(0);
    });

    it('应该支持 HEAD ref', async () => {
      const ctx = await resolveDiff('HEAD');
      expect(ctx.ref).toBe('HEAD');
    });

    it('应该支持 commit SHA ref', async () => {
      const ctx = await resolveDiff('abc1234');
      expect(ctx.ref).toBe('abc1234');
    });

    it('应该包含 diff 统计', async () => {
      const ctx = await resolveDiff('working');
      expect(ctx.totalAdditions).toBeGreaterThanOrEqual(0);
      expect(ctx.totalDeletions).toBeGreaterThanOrEqual(0);
    });

    it('diff 文件应包含 hunks', async () => {
      const ctx = await resolveDiff('working');
      for (const f of ctx.files) {
        expect(f.hunks).toBeDefined();
        for (const h of f.hunks) {
          expect(h.oldStart).toBeGreaterThanOrEqual(0);
          expect(h.newStart).toBeGreaterThanOrEqual(0);
          expect(h.content).toBeTruthy();
        }
      }
    });
  });

  // ============================================================
  // Format Functions
  // ============================================================
  describe('formatCodebaseForPrompt', () => {
    it('应该格式化 codebase 上下文', () => {
      const ctx: CodebaseContext = {
        type: 'codebase',
        query: 'test',
        results: [
          {
            filePath: 'src/foo.ts',
            snippet: 'function foo() {}',
            score: 0.95,
            lineRange: { start: 1, end: 5 },
            language: 'typescript',
          },
        ],
        resolvedAt: Date.now(),
        source: 'mock',
      };
      const text = formatCodebaseForPrompt(ctx);
      expect(text).toContain('[codebase results for "test"]');
      expect(text).toContain('src/foo.ts');
      expect(text).toContain('0.95');
      expect(text).toContain('function foo()');
    });

    it('空结果应返回空字符串', () => {
      const ctx: CodebaseContext = {
        type: 'codebase',
        query: 'empty',
        results: [],
        resolvedAt: Date.now(),
        source: 'mock',
      };
      expect(formatCodebaseForPrompt(ctx)).toBe('');
    });
  });

  describe('formatGitForPrompt', () => {
    it('应该格式化 git log', () => {
      const ctx: GitContext = {
        type: 'git',
        ref: 'log',
        query: 'src/auth.ts',
        filePath: 'src/auth.ts',
        data: [
          {
            sha: 'abc1234567',
            shortSha: 'abc1234',
            message: 'Fix auth',
            author: 'Dev',
            email: 'd@e.com',
            date: '2026-07-29T00:00:00.000Z',
            files: ['src/auth.ts'],
          },
        ],
        resolvedAt: Date.now(),
        source: 'mock',
      };
      const text = formatGitForPrompt(ctx);
      expect(text).toContain('[git log for src/auth.ts');
      expect(text).toContain('abc1234');
      expect(text).toContain('Fix auth');
    });

    it('应该格式化 git branch', () => {
      const ctx: GitContext = {
        type: 'git',
        ref: 'branch',
        query: '',
        data: ['main', 'develop'],
        resolvedAt: Date.now(),
        source: 'mock',
      };
      const text = formatGitForPrompt(ctx);
      expect(text).toContain('[git branches]');
      expect(text).toContain('- main');
      expect(text).toContain('- develop');
    });
  });

  describe('formatDiffForPrompt', () => {
    it('应该格式化 diff 上下文', () => {
      const ctx: DiffContext = {
        type: 'diff',
        ref: 'working',
        files: [
          {
            path: 'src/foo.ts',
            status: 'modified',
            additions: 5,
            deletions: 2,
            hunks: [
              {
                oldStart: 1,
                oldLines: 2,
                newStart: 1,
                newLines: 5,
                content: '@@ -1,2 +1,5 @@\n+added\n+more',
              },
            ],
          },
        ],
        totalAdditions: 5,
        totalDeletions: 2,
        resolvedAt: Date.now(),
        source: 'mock',
      };
      const text = formatDiffForPrompt(ctx);
      expect(text).toContain('[diff: working]');
      expect(text).toContain('+5 -2');
      expect(text).toContain('src/foo.ts');
      expect(text).toContain('[modified]');
    });
  });

  // ============================================================
  // Cache Stats
  // ============================================================
  describe('Cache Statistics', () => {
    it('应该返回缓存统计', async () => {
      await resolveCodebase('test1');
      await resolveGit('log', { limit: 3 });
      const stats = getCacheStats();
      expect(stats.size).toBeGreaterThanOrEqual(2);
    });
  });
});
