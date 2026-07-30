/**
 * WorktreeSyncEngine 单元测试
 * Cycle 31 G31-03
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  WorktreeSyncEngine,
  VectorClockImpl,
  getDefaultWorktreeSyncEngine,
  resetDefaultWorktreeSyncEngine,
  generateSnapshotId,
  generateChangeId,
  generateConflictId,
  generateSessionId,
  type SyncEndpoint,
  type DeviceInfo,
} from './worktreeSyncEngine';

declare const vi: any;

describe('WorktreeSyncEngine', () => {
  let engine: WorktreeSyncEngine;
  const testEndpoint: SyncEndpoint = {
    id: 'ep-1',
    type: 'websocket',
    url: 'wss://example.com',
    deviceId: 'dev-other',
    connected: true,
  };

  beforeEach(() => {
    localStorage.clear();
    engine = new WorktreeSyncEngine();
  });

  describe('VectorClock', () => {
    it('increment 增加自身', () => {
      const vc = VectorClockImpl.from({});
      const result = vc.increment('dev-1');
      expect(result['dev-1']).toBe(1);
    });
    it('多次 increment 累加', () => {
      const vc = VectorClockImpl.from({});
      vc.increment('dev-1');
      vc.increment('dev-1');
      expect(vc.toJSON()['dev-1']).toBe(2);
    });
    it('merge 取最大值', () => {
      const vc = VectorClockImpl.from({ a: 3, b: 1 });
      vc.merge({ a: 1, b: 5 });
      expect(vc.toJSON()).toEqual({ a: 3, b: 5 });
    });
    it('compare equal', () => {
      const vc = VectorClockImpl.from({ a: 3, b: 5 });
      expect(vc.compare({ a: 3, b: 5 })).toBe('equal');
    });
    it('compare after', () => {
      const vc = VectorClockImpl.from({ a: 5, b: 3 });
      expect(vc.compare({ a: 3, b: 3 })).toBe('after');
    });
    it('compare before', () => {
      const vc = VectorClockImpl.from({ a: 3, b: 3 });
      expect(vc.compare({ a: 5, b: 3 })).toBe('before');
    });
    it('compare concurrent', () => {
      const vc = VectorClockImpl.from({ a: 5, b: 3 });
      expect(vc.compare({ a: 3, b: 5 })).toBe('concurrent');
    });
  });

  describe('同步会话', () => {
    it('startSync 创建会话', () => {
      const session = engine.startSync('wt-1', testEndpoint);
      expect(session.id).toBeTruthy();
      expect(session.status).toBe('active');
    });
    it('stopSync 停止会话', () => {
      const session = engine.startSync('wt-1', testEndpoint);
      engine.stopSync(session.id);
      const got = engine.getSession(session.id);
      expect(got!.status).toBe('stopped');
    });
    it('listSessions 按 worktreeId 过滤', () => {
      engine.startSync('wt-1', testEndpoint);
      engine.startSync('wt-2', testEndpoint);
      const list = engine.listSessions('wt-1');
      expect(list.length).toBe(1);
    });
    it('触发 sync-started 事件', () => {
      const fn = vi.fn();
      engine.on('sync-started', fn);
      engine.startSync('wt-1', testEndpoint);
      expect(fn).toHaveBeenCalled();
    });
  });

  describe('状态快照', () => {
    it('snapshot 创建快照', () => {
      const snap = engine.snapshot('wt-1', { branch: 'main', commitHash: 'abc123' });
      expect(snap.id).toBeTruthy();
      expect(snap.state.branch).toBe('main');
      expect(snap.state.commitHash).toBe('abc123');
    });
    it('snapshot 包含 uncommittedChanges', () => {
      const snap = engine.snapshot('wt-1', {
        branch: 'main',
        commitHash: 'abc',
        uncommittedChanges: [
          { path: 'a.ts', content: 'hello', op: 'modify' },
          { path: 'b.ts', content: 'world', op: 'add' },
        ],
      });
      expect(snap.size).toBe(10);
    });
    it('listSnapshots 按 worktreeId 过滤', () => {
      engine.snapshot('wt-1');
      engine.snapshot('wt-2');
      engine.snapshot('wt-1');
      const list = engine.listSnapshots('wt-1');
      expect(list.length).toBe(2);
    });
    it('getSnapshot 返回指定快照', () => {
      const snap = engine.snapshot('wt-1');
      const got = engine.getSnapshot(snap.id);
      expect(got).toBeDefined();
    });
    it('触发 snapshot-created 事件', () => {
      const fn = vi.fn();
      engine.on('snapshot-created', fn);
      engine.snapshot('wt-1');
      expect(fn).toHaveBeenCalled();
    });
  });

  describe('状态广播', () => {
    it('publishChange 创建变更', () => {
      const change = engine.publishChange('wt-1', { type: 'file-change', path: 'a.ts', payload: { content: 'x' } });
      expect(change.id).toBeTruthy();
      expect(change.type).toBe('file-change');
    });
    it('subscribe 接收变更', () => {
      const fn = vi.fn();
      engine.subscribe('wt-1', fn);
      engine.publishChange('wt-1', { type: 'commit', payload: { hash: 'abc' } });
      expect(fn).toHaveBeenCalled();
    });
    it('subscribe 返回退订函数', () => {
      const fn = vi.fn();
      const off = engine.subscribe('wt-1', fn);
      engine.publishChange('wt-1', { type: 'commit', payload: {} });
      expect(fn).toHaveBeenCalledTimes(1);
      off();
      engine.publishChange('wt-1', { type: 'commit', payload: {} });
      expect(fn).toHaveBeenCalledTimes(1);
    });
    it('subscribe 只接收对应 worktreeId 的变更', () => {
      const fn = vi.fn();
      engine.subscribe('wt-1', fn);
      engine.publishChange('wt-2', { type: 'commit', payload: {} });
      expect(fn).not.toHaveBeenCalled();
    });
    it('触发 change-published 事件', () => {
      const fn = vi.fn();
      engine.on('change-published', fn);
      engine.publishChange('wt-1', { type: 'commit', payload: {} });
      expect(fn).toHaveBeenCalled();
    });
  });

  describe('冲突检测与解决', () => {
    it('detectConflict 检测并发修改', () => {
      engine.snapshot('wt-1', { commitHash: 'local-commit' });
      // 模拟远程 snapshot
      const remoteSnap = {
        id: 'remote-snap',
        worktreeId: 'wt-1',
        timestamp: Date.now(),
        vectorClock: { 'dev-other': 100, [engine.getCurrentDeviceId()]: 50 },
        state: { branch: 'main', commitHash: 'remote-commit' },
        deviceId: 'dev-other',
        size: 0,
      };
      const conflicts = engine.detectConflict('wt-1', remoteSnap);
      expect(conflicts.length).toBeGreaterThan(0);
    });
    it('resolveConflict 解决冲突', () => {
      engine.snapshot('wt-1', { commitHash: 'local-commit' });
      const remoteSnap = {
        id: 'remote-snap',
        worktreeId: 'wt-1',
        timestamp: Date.now(),
        vectorClock: { 'dev-other': 100, [engine.getCurrentDeviceId()]: 50 },
        state: { branch: 'main', commitHash: 'remote-commit' },
        deviceId: 'dev-other',
        size: 0,
      };
      const conflicts = engine.detectConflict('wt-1', remoteSnap);
      const conflict = engine.resolveConflict(conflicts[0].id, { strategy: 'local', resolvedBy: 'admin' });
      expect(conflict.status).toBe('resolved');
      expect(conflict.resolution!.strategy).toBe('local');
    });
    it('abandonConflict 放弃冲突', () => {
      engine.snapshot('wt-1', { commitHash: 'local' });
      const remoteSnap = {
        id: 'remote-snap',
        worktreeId: 'wt-1',
        timestamp: Date.now(),
        vectorClock: { 'dev-other': 100, [engine.getCurrentDeviceId()]: 50 },
        state: { branch: 'main', commitHash: 'remote' },
        deviceId: 'dev-other',
        size: 0,
      };
      const conflicts = engine.detectConflict('wt-1', remoteSnap);
      engine.abandonConflict(conflicts[0].id);
      expect(engine.getConflict(conflicts[0].id)!.status).toBe('abandoned');
    });
    it('listConflicts 返回所有冲突', () => {
      engine.snapshot('wt-1', { commitHash: 'a' });
      const remoteSnap = {
        id: 'rs',
        worktreeId: 'wt-1',
        timestamp: Date.now(),
        vectorClock: { 'dev-other': 100, [engine.getCurrentDeviceId()]: 50 },
        state: { branch: 'main', commitHash: 'b' },
        deviceId: 'dev-other',
        size: 0,
      };
      engine.detectConflict('wt-1', remoteSnap);
      expect(engine.listConflicts('wt-1').length).toBeGreaterThan(0);
    });
    it('detectConflict 对相同 remote snapshot 去重', () => {
      engine.snapshot('wt-1', { commitHash: 'a' });
      const remoteSnap = {
        id: 'rs',
        worktreeId: 'wt-1',
        timestamp: Date.now(),
        vectorClock: { 'dev-other': 100, [engine.getCurrentDeviceId()]: 50 },
        state: { branch: 'main', commitHash: 'b' },
        deviceId: 'dev-other',
        size: 0,
      };
      const c1 = engine.detectConflict('wt-1', remoteSnap);
      const c2 = engine.detectConflict('wt-1', remoteSnap);
      expect(c1.length).toBeGreaterThan(0);
      expect(c2.length).toBe(0);
    });
  });

  describe('设备管理', () => {
    it('registerDevice 注册设备', () => {
      const device: DeviceInfo = {
        deviceId: 'dev-laptop',
        name: 'My Laptop',
        type: 'laptop',
        lastSeenAt: Date.now(),
        online: true,
      };
      engine.registerDevice(device);
      expect(engine.listDevices()).toContainEqual(device);
    });
    it('unregisterDevice 移除设备', () => {
      const device: DeviceInfo = {
        deviceId: 'dev-laptop',
        name: 'My Laptop',
        type: 'laptop',
        lastSeenAt: Date.now(),
        online: true,
      };
      engine.registerDevice(device);
      engine.unregisterDevice('dev-laptop');
      expect(engine.listDevices().find((d) => d.deviceId === 'dev-laptop')).toBeUndefined();
    });
    it('setCurrentDevice 切换当前设备', () => {
      engine.setCurrentDevice('dev-new');
      expect(engine.getCurrentDeviceId()).toBe('dev-new');
    });
    it('setDeviceOnline 更新在线状态', () => {
      engine.registerDevice({
        deviceId: 'dev-tablet',
        name: 'Tablet',
        type: 'tablet',
        lastSeenAt: Date.now(),
        online: true,
      });
      engine.setDeviceOnline('dev-tablet', false);
      const d = engine.listDevices().find((x) => x.deviceId === 'dev-tablet');
      expect(d!.online).toBe(false);
    });
    it('触发 device-registered 事件', () => {
      const fn = vi.fn();
      engine.on('device-registered', fn);
      engine.registerDevice({
        deviceId: 'dev-x',
        name: 'X',
        type: 'desktop',
        lastSeenAt: Date.now(),
        online: true,
      });
      expect(fn).toHaveBeenCalled();
    });
  });

  describe('事件系统', () => {
    it('监听器错误不影响其他监听器', () => {
      const fn1 = vi.fn(() => { throw new Error('oops'); });
      const fn2 = vi.fn();
      engine.on('snapshot-created', fn1);
      engine.on('snapshot-created', fn2);
      engine.snapshot('wt-1');
      expect(fn2).toHaveBeenCalled();
    });
  });

  describe('工具函数', () => {
    it('generateSnapshotId 返回唯一 ID', () => {
      const a = generateSnapshotId();
      const b = generateSnapshotId();
      expect(a).not.toBe(b);
    });
    it('generateChangeId 返回唯一 ID', () => {
      const a = generateChangeId();
      const b = generateChangeId();
      expect(a).not.toBe(b);
    });
    it('generateConflictId 返回唯一 ID', () => {
      const a = generateConflictId();
      const b = generateConflictId();
      expect(a).not.toBe(b);
    });
    it('generateSessionId 返回唯一 ID', () => {
      const a = generateSessionId();
      const b = generateSessionId();
      expect(a).not.toBe(b);
    });
  });

  describe('单例', () => {
    it('getDefaultWorktreeSyncEngine 返回同一实例', () => {
      resetDefaultWorktreeSyncEngine();
      const a = getDefaultWorktreeSyncEngine();
      const b = getDefaultWorktreeSyncEngine();
      expect(a).toBe(b);
    });
  });

  describe('reset', () => {
    it('清空所有数据', () => {
      engine.snapshot('wt-1');
      engine.reset();
      expect(engine.listSnapshots('wt-1').length).toBe(0);
    });
  });

  describe('restore', () => {
    it('restore 触发 snapshot-restored 事件', async () => {
      const snap = engine.snapshot('wt-1');
      const fn = vi.fn();
      engine.on('snapshot-restored', fn);
      await engine.restore(snap.id);
      expect(fn).toHaveBeenCalled();
    });
    it('restore 不存在的快照抛错', async () => {
      await expect(engine.restore('not-exist')).rejects.toThrow();
    });
  });
});
