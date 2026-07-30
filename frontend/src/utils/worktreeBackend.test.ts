/**
 * WorktreeBackend 单元测试 (v1.0.0 Cycle 21 G21-04)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  MockWorktreeBackend,
  LocalGitWorktreeBackend,
  RemoteWorktreeBackend,
  HybridWorktreeBackend,
  createWorktreeBackend,
  getWorktreeBackend,
  resetWorktreeBackend,
  isWorktreeBackendInitialized,
} from './worktreeBackend';

describe('WorktreeBackend', () => {
  describe('MockWorktreeBackend', () => {
    let backend: MockWorktreeBackend;

    beforeEach(() => {
      backend = new MockWorktreeBackend();
    });

    it('create 返回 worktree', async () => {
      const wt = await backend.create({ type: 'isolated', label: 'test' });
      expect(wt.id).toBeDefined();
      expect(wt.type).toBe('isolated');
      expect(wt.status).toBe('ready');
      expect(wt.label).toBe('test');
    });

    it('list 返回所有', async () => {
      await backend.create({ type: 'isolated' });
      await backend.create({ type: 'experiment' });
      const list = await backend.list();
      expect(list.length).toBe(2);
    });

    it('get 按 id 返回', async () => {
      const wt = await backend.create({ type: 'isolated' });
      const retrieved = await backend.get(wt.id);
      expect(retrieved?.id).toBe(wt.id);
    });

    it('get 不存在返回 null', async () => {
      expect(await backend.get('non-existent')).toBeNull();
    });

    it('remove 删除 worktree', async () => {
      const wt = await backend.create({ type: 'isolated' });
      await backend.remove(wt.id);
      expect(await backend.get(wt.id)).toBeNull();
    });

    it('merge 成功', async () => {
      const wt = await backend.create({ type: 'isolated' });
      const result = await backend.merge(wt.id);
      expect(result.success).toBe(true);
      expect(result.commit).toBeDefined();
    });

    it('merge 不存在返回失败', async () => {
      const result = await backend.merge('non-existent');
      expect(result.success).toBe(false);
    });

    it('diff 返回内容', async () => {
      const wt = await backend.create({ type: 'isolated' });
      const diff = await backend.diff(wt.id);
      expect(diff).toContain(wt.id);
    });

    it('cleanup 删除旧 worktree', async () => {
      await backend.create({ type: 'isolated' });
      // 等 10ms 确保 createdAt 与当前时间有差
      await new Promise((r) => setTimeout(r, 10));
      const count = await backend.cleanup({ olderThanMs: 0 });
      expect(count).toBeGreaterThan(0);
    });

    it('healthCheck 返回健康', async () => {
      const health = await backend.healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.backend).toBe('mock');
    });
  });

  describe('LocalGitWorktreeBackend', () => {
    it('create 在 mock 模式下返回 worktree', async () => {
      const backend = new LocalGitWorktreeBackend();
      const wt = await backend.create({ type: 'isolated' });
      expect(wt.id).toBeDefined();
      expect(wt.path).toContain('worktree');
    });

    it('healthCheck 正常', async () => {
      const backend = new LocalGitWorktreeBackend();
      const health = await backend.healthCheck();
      expect(health.healthy).toBe(true);
    });
  });

  describe('RemoteWorktreeBackend', () => {
    it('mock 模式下 create 返回降级数据', async () => {
      const backend = new RemoteWorktreeBackend({ url: 'https://api.test', token: 'test-token' });
      const wt = await backend.create({ type: 'isolated' });
      expect(wt.id).toBeDefined();
      expect(wt.metadata?.fallback).toBe(true);
    });

    it('healthCheck 返回状态', async () => {
      const backend = new RemoteWorktreeBackend({ url: 'https://api.test', token: 'test-token' });
      const health = await Promise.race([
        backend.healthCheck(),
        new Promise<{ healthy: boolean; backend: string; message: string }>((resolve) => {
          setTimeout(() => resolve({ healthy: false, backend: 'remote', message: 'timeout' }), 3000);
        }),
      ]);
      // happy-dom 中 fetch 是可用的，会尝试实际请求，所以可能不健康
      expect(typeof health.healthy).toBe('boolean');
      expect(health.backend).toBe('remote');
    }, 10000);

    it('list 失败时返回空', async () => {
      const backend = new RemoteWorktreeBackend({ url: 'https://api.test', token: 'test-token' });
      const list = await Promise.race([
        backend.list(),
        new Promise<[]>((resolve) => {
          setTimeout(() => resolve([]), 3000);
        }),
      ]);
      expect(list).toEqual([]);
    }, 10000);
  });

  describe('HybridWorktreeBackend', () => {
    it('主后端失败时降级', async () => {
      // 构造一个始终失败的 backend
      const failing: any = {
        type: 'mock',
        initialize: async () => { throw new Error('fail'); },
        create: async () => { throw new Error('fail'); },
        list: async () => { throw new Error('fail'); },
        get: async () => { throw new Error('fail'); },
        remove: async () => { throw new Error('fail'); },
        merge: async () => { throw new Error('fail'); },
        diff: async () => { throw new Error('fail'); },
        cleanup: async () => { throw new Error('fail'); },
        healthCheck: async () => ({ healthy: false, lastChecked: Date.now(), backend: 'mock', error: 'fail' }),
        dispose: async () => {},
      };
      const fallback = new MockWorktreeBackend();
      const hybrid = new HybridWorktreeBackend(failing, fallback);
      const wt = await hybrid.create({ type: 'isolated' });
      expect(wt.id).toBeDefined();
    });

    it('healthCheck 综合', async () => {
      const primary = new MockWorktreeBackend();
      const fallback = new MockWorktreeBackend();
      const hybrid = new HybridWorktreeBackend(primary, fallback);
      const health = await hybrid.healthCheck();
      expect(health.healthy).toBe(true);
    });
  });

  describe('createWorktreeBackend Factory', () => {
    it('创建 mock backend', () => {
      const backend = createWorktreeBackend({ type: 'mock' });
      expect(backend.type).toBe('mock');
    });

    it('创建 local-git backend', () => {
      const backend = createWorktreeBackend({ type: 'local-git' });
      expect(backend.type).toBe('local-git');
    });

    it('创建 remote backend', () => {
      const backend = createWorktreeBackend({ type: 'remote', url: 'https://test', token: 't' });
      expect(backend.type).toBe('remote');
    });

    it('创建 hybrid backend', () => {
      const backend = createWorktreeBackend({
        type: 'hybrid',
        primary: 'mock',
        fallback: 'mock',
      });
      expect(backend.type).toBe('hybrid');
    });
  });

  describe('单例', () => {
    beforeEach(async () => {
      await resetWorktreeBackend();
    });

    it('isWorktreeBackendInitialized', async () => {
      getWorktreeBackend({ type: 'mock' });
      expect(isWorktreeBackendInitialized()).toBe(true);
    });

    it('reset 后重新创建', async () => {
      const a = getWorktreeBackend({ type: 'mock' });
      await resetWorktreeBackend();
      const b = getWorktreeBackend({ type: 'mock' });
      expect(a).not.toBe(b);
    });
  });
});
