/**
 * RemoteWorktreeAdapter 单元测试
 * Cycle 31 G31-02
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  RemoteWorktreeAdapter,
  LocalWorktreeBackend,
  RemoteWorktreeBackend,
  HybridWorktreeBackend,
  getDefaultRemoteWorktreeAdapter,
  resetDefaultRemoteWorktreeAdapter,
  generateWorktreeId,
  generateMigrationId,
  type LocalBackendConfig,
  type RemoteBackendConfig,
  type HybridBackendConfig,
} from './remoteWorktreeAdapter';

declare const vi: any;

describe('RemoteWorktreeAdapter', () => {
  let adapter: RemoteWorktreeAdapter;
  const localConfig: LocalBackendConfig = {
    id: 'local-1',
    name: 'Local',
    type: 'local',
    enabled: true,
    priority: 50,
    basePath: '/tmp/local',
  };
  const remoteConfig: RemoteBackendConfig = {
    id: 'remote-1',
    name: 'Remote',
    type: 'remote',
    enabled: true,
    priority: 30,
    endpoint: 'https://api.example.com',
    region: 'us-west',
  };
  const hybridConfig: HybridBackendConfig = {
    id: 'hybrid-1',
    name: 'Hybrid',
    type: 'hybrid',
    enabled: true,
    priority: 40,
    localPath: '/tmp/hybrid',
    remoteEndpoint: 'https://hybrid.example.com',
    syncMode: 'on-save',
  };

  beforeEach(() => {
    localStorage.clear();
    adapter = new RemoteWorktreeAdapter();
  });

  describe('后端注册', () => {
    it('注册 Local Backend', () => {
      adapter.registerBackend(localConfig);
      expect(adapter.getBackend('local-1')).toBeDefined();
      expect(adapter.getBackend('local-1')).toBeInstanceOf(LocalWorktreeBackend);
    });
    it('注册 Remote Backend', () => {
      adapter.registerBackend(remoteConfig);
      expect(adapter.getBackend('remote-1')).toBeInstanceOf(RemoteWorktreeBackend);
    });
    it('注册 Hybrid Backend', () => {
      adapter.registerBackend(hybridConfig);
      expect(adapter.getBackend('hybrid-1')).toBeInstanceOf(HybridWorktreeBackend);
    });
    it('listBackends 返回所有后端配置', () => {
      adapter.registerBackend(localConfig);
      adapter.registerBackend(remoteConfig);
      expect(adapter.listBackends().length).toBe(2);
    });
    it('unregisterBackend 移除后端', () => {
      adapter.registerBackend(localConfig);
      adapter.unregisterBackend('local-1');
      expect(adapter.getBackend('local-1')).toBeUndefined();
    });
    it('触发 backend-registered 事件', () => {
      const fn = vi.fn();
      adapter.on('backend-registered', fn);
      adapter.registerBackend(localConfig);
      expect(fn).toHaveBeenCalled();
    });
  });

  describe('智能选择', () => {
    it('优先选择本地后端（availability）', () => {
      adapter.registerBackend(remoteConfig);
      adapter.registerBackend(localConfig);
      const id = adapter.selectBackend({ optimizeFor: 'availability' });
      expect(id).toBe('local-1');
    });
    it('优先选择本地后端（cost）', () => {
      adapter.registerBackend(remoteConfig);
      adapter.registerBackend(localConfig);
      const id = adapter.selectBackend({ optimizeFor: 'cost' });
      expect(id).toBe('local-1');
    });
    it('优先选择本地后端（latency）', () => {
      adapter.registerBackend(remoteConfig);
      adapter.registerBackend(localConfig);
      const id = adapter.selectBackend({ optimizeFor: 'latency' });
      expect(id).toBe('local-1');
    });
    it('preferredBackendId 优先', () => {
      adapter.registerBackend(localConfig);
      adapter.registerBackend(remoteConfig);
      const id = adapter.selectBackend({ preferredBackendId: 'remote-1' });
      expect(id).toBe('remote-1');
    });
    it('无后端时抛错', () => {
      expect(() => adapter.selectBackend()).toThrow();
    });
  });

  describe('Worktree CRUD', () => {
    beforeEach(() => {
      adapter.registerBackend(localConfig);
    });

    it('创建 Worktree', async () => {
      const wt = await adapter.create({ branch: 'feature/test', baseBranch: 'main' });
      expect(wt.id).toBeTruthy();
      expect(wt.branch).toBe('feature/test');
      expect(wt.status).toBe('ready');
    });
    it('指定 backendId 创建', async () => {
      adapter.registerBackend(remoteConfig);
      const wt = await adapter.create({ branch: 'feat', baseBranch: 'main', backendId: 'remote-1' });
      expect(wt.backendId).toBe('remote-1');
    });
    it('list 返回所有 worktrees', async () => {
      await adapter.create({ branch: 'a', baseBranch: 'main' });
      await adapter.create({ branch: 'b', baseBranch: 'main' });
      const all = await adapter.list();
      expect(all.length).toBe(2);
    });
    it('list 按 backendId 过滤', async () => {
      adapter.registerBackend(remoteConfig);
      await adapter.create({ branch: 'a', baseBranch: 'main' });
      await adapter.create({ branch: 'b', baseBranch: 'main', backendId: 'remote-1' });
      const list = await adapter.list({ backendId: 'remote-1' });
      expect(list.length).toBe(1);
    });
    it('get 返回指定 worktree', async () => {
      const created = await adapter.create({ branch: 'a', baseBranch: 'main' });
      const got = await adapter.get(created.id);
      expect(got).toBeDefined();
    });
    it('delete 移除 worktree', async () => {
      const wt = await adapter.create({ branch: 'a', baseBranch: 'main' });
      await adapter.delete(wt.id);
      const got = await adapter.get(wt.id);
      expect(got).toBeNull();
    });
    it('sync 同步 worktree', async () => {
      const wt = await adapter.create({ branch: 'a', baseBranch: 'main' });
      const synced = await adapter.sync(wt.id);
      expect(synced.lastSyncAt).toBeGreaterThan(0);
    });
  });

  describe('会话迁移', () => {
    beforeEach(() => {
      adapter.registerBackend(localConfig);
      adapter.registerBackend(remoteConfig);
    });

    it('migrateToRemote 成功', async () => {
      const wt = await adapter.create({ branch: 'a', baseBranch: 'main' });
      const receipt = await adapter.migrateToRemote(wt.id, 'remote-1');
      expect(receipt.status).toBe('success');
      expect(receipt.fromBackend).toBe('local-1');
      expect(receipt.toBackend).toBe('remote-1');
      const updated = await adapter.get(wt.id);
      expect(updated!.backendId).toBe('remote-1');
    });
    it('migrateToLocal 成功', async () => {
      const wt = await adapter.create({ branch: 'a', baseBranch: 'main', backendId: 'remote-1' });
      const receipt = await adapter.migrateToLocal(wt.id);
      expect(receipt.status).toBe('success');
      expect(receipt.toBackend).toBe('local-1');
    });
    it('migrateBetweenRemotes 成功', async () => {
      const remoteConfig2: RemoteBackendConfig = {
        id: 'remote-2',
        name: 'Remote2',
        type: 'remote',
        enabled: true,
        priority: 25,
        endpoint: 'https://api2.example.com',
      };
      adapter.registerBackend(remoteConfig2);
      const wt = await adapter.create({ branch: 'a', baseBranch: 'main', backendId: 'remote-1' });
      const receipt = await adapter.migrateBetweenRemotes(wt.id, 'remote-2');
      expect(receipt.status).toBe('success');
    });
    it('迁移到同一后端直接成功', async () => {
      const wt = await adapter.create({ branch: 'a', baseBranch: 'main' });
      const receipt = await adapter.migrateToLocal(wt.id, 'local-1');
      expect(receipt.status).toBe('success');
      expect(receipt.filesTransferred).toBe(0);
    });
    it('触发 worktree-migrated 事件', async () => {
      const fn = vi.fn();
      adapter.on('worktree-migrated', fn);
      const wt = await adapter.create({ branch: 'a', baseBranch: 'main' });
      await adapter.migrateToRemote(wt.id, 'remote-1');
      expect(fn).toHaveBeenCalled();
    });
  });

  describe('健康检查', () => {
    it('healthCheck 单个后端', async () => {
      adapter.registerBackend(localConfig);
      const status = await adapter.healthCheck('local-1');
      expect(status).toBe('healthy');
    });
    it('healthCheckAll 返回所有后端状态', async () => {
      adapter.registerBackend(localConfig);
      adapter.registerBackend(remoteConfig);
      const result = await adapter.healthCheckAll();
      expect(result.size).toBe(2);
      expect(result.get('local-1')).toBe('healthy');
    });
    it('getBackendMetrics 返回指标', () => {
      adapter.registerBackend(localConfig);
      const m = adapter.getBackendMetrics('local-1');
      expect(m).toBeDefined();
      expect(m!.worktreeCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('事件系统', () => {
    it('on 返回退订函数', () => {
      const fn = vi.fn();
      const off = adapter.on('backend-registered', fn);
      adapter.registerBackend(localConfig);
      expect(fn).toHaveBeenCalledTimes(1);
      off();
      adapter.registerBackend({ ...localConfig, id: 'local-2' });
      expect(fn).toHaveBeenCalledTimes(1);
    });
    it('监听器错误不影响其他监听器', () => {
      const fn1 = vi.fn(() => { throw new Error('oops'); });
      const fn2 = vi.fn();
      adapter.on('backend-registered', fn1);
      adapter.on('backend-registered', fn2);
      adapter.registerBackend(localConfig);
      expect(fn2).toHaveBeenCalled();
    });
  });

  describe('自动健康检查', () => {
    it('startAutoHealthCheck + stopAutoHealthCheck', () => {
      adapter.startAutoHealthCheck(10000);
      adapter.stopAutoHealthCheck();
    });
  });

  describe('辅助', () => {
    it('generateWorktreeId 返回唯一 ID', () => {
      const a = generateWorktreeId();
      const b = generateWorktreeId();
      expect(a).not.toBe(b);
    });
    it('generateMigrationId 返回唯一 ID', () => {
      const a = generateMigrationId();
      const b = generateMigrationId();
      expect(a).not.toBe(b);
    });
  });

  describe('单例', () => {
    it('getDefaultRemoteWorktreeAdapter 返回同一实例', () => {
      resetDefaultRemoteWorktreeAdapter();
      const a = getDefaultRemoteWorktreeAdapter();
      const b = getDefaultRemoteWorktreeAdapter();
      expect(a).toBe(b);
    });
  });

  describe('reset', () => {
    it('清空所有后端', () => {
      adapter.registerBackend(localConfig);
      adapter.reset();
      expect(adapter.listBackends().length).toBe(0);
    });
  });
});
