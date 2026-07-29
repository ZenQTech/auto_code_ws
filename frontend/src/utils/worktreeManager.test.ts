/**
 * # ============================================================
 * # WorktreeManager 单元测试 (v1.0.0 Cycle 20 P0-1)
 * # ============================================================
 * # 覆盖范围：
 * #   1. 核心 CRUD：create / list / get / remove / merge / diff / discard
 * #   2. 状态管理：updateStatus / updateChanges
 * #   3. 事件订阅：subscribe / emit / 错误降级
 * #   4. 过滤与统计：list(filter) / countActive / count
 * #   5. 持久化：load / save
 * #   6. 单例工厂：get / reset / set
 * #   7. 异常路径：数量上限 / 重复合并 / 不存在 ID
 * # ============================================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  WorktreeManager,
  MockWorktreeBackend,
  MemoryWorktreeStorage,
  LocalStorageWorktreeStorage,
  getWorktreeManager,
  resetWorktreeManager,
  setWorktreeManager,
  type WorktreeInfo,
  type WorktreeEvent,
} from './worktreeManager';

describe('WorktreeManager - 核心 CRUD', () => {
  let manager: WorktreeManager;
  let backend: MockWorktreeBackend;
  let storage: MemoryWorktreeStorage;

  beforeEach(() => {
    backend = new MockWorktreeBackend(0); // 0 冲突率，便于测试
    storage = new MemoryWorktreeStorage();
    manager = new WorktreeManager({ backend, storage });
  });

  afterEach(() => {
    manager.dispose();
  });

  it('create() - 成功创建 worktree', async () => {
    const wt = await manager.create({
      type: 'isolated',
      baseBranch: 'main',
      label: '测试',
    });
    expect(wt.id).toBeTruthy();
    expect(wt.type).toBe('isolated');
    expect(wt.baseBranch).toBe('main');
    expect(wt.label).toBe('测试');
    expect(wt.status).toBe('ready');
    expect(wt.changes).toEqual({ added: 0, modified: 0, deleted: 0 });
  });

  it('create() - 自动生成分支名', async () => {
    const wt = await manager.create();
    expect(wt.branch).toMatch(/^wt-[a-f0-9]{8}$/);
  });

  it('create() - 自定义分支名', async () => {
    const wt = await manager.create({ branchName: 'feature/custom' });
    expect(wt.branch).toBe('feature/custom');
  });

  it('create() - 关联 taskId/sessionId', async () => {
    const wt = await manager.create({
      taskId: 'task-001',
      sessionId: 'session-001',
    });
    expect(wt.taskId).toBe('task-001');
    expect(wt.sessionId).toBe('session-001');
  });

  it('create() - 超过 maxWorktrees 抛错', async () => {
    const small = new WorktreeManager({
      backend,
      storage,
      config: { maxWorktrees: 2 },
    });
    try {
      await small.create();
      await small.create();
      await expect(small.create()).rejects.toThrow(/数量已达上限/);
    } finally {
      small.dispose();
    }
  });

  it('list() - 返回所有 worktree', async () => {
    await manager.create({ label: 'A' });
    await manager.create({ label: 'B' });
    const all = manager.list();
    expect(all.length).toBe(2);
  });

  it('list(filter) - 按状态过滤', async () => {
    const a = await manager.create();
    await manager.create();
    manager.updateStatus(a.id, 'merged');
    const merged = manager.list({ status: 'merged' });
    expect(merged.length).toBe(1);
    expect(merged[0].id).toBe(a.id);
  });

  it('list(filter) - 按多个状态过滤', async () => {
    const a = await manager.create();
    const b = await manager.create();
    manager.updateStatus(a.id, 'in-use');
    manager.updateStatus(b.id, 'discarded');
    const filtered = manager.list({ status: ['in-use', 'discarded'] });
    expect(filtered.length).toBe(2);
  });

  it('list(filter) - 按 type 过滤', async () => {
    await manager.create({ type: 'isolated' });
    await manager.create({ type: 'review' });
    const review = manager.list({ type: 'review' });
    expect(review.length).toBe(1);
    expect(review[0].type).toBe('review');
  });

  it('list(filter) - 按 taskId 过滤', async () => {
    await manager.create({ taskId: 'task-1' });
    await manager.create({ taskId: 'task-2' });
    const filtered = manager.list({ taskId: 'task-1' });
    expect(filtered.length).toBe(1);
    expect(filtered[0].taskId).toBe('task-1');
  });

  it('list(filter) - 按 sessionId 过滤', async () => {
    await manager.create({ sessionId: 'sess-1' });
    await manager.create({ sessionId: 'sess-2' });
    const filtered = manager.list({ sessionId: 'sess-2' });
    expect(filtered.length).toBe(1);
  });

  it('list(filter) - 按 baseBranch 过滤', async () => {
    await manager.create({ baseBranch: 'main' });
    await manager.create({ baseBranch: 'develop' });
    const filtered = manager.list({ baseBranch: 'develop' });
    expect(filtered.length).toBe(1);
  });

  it('get() - 返回存在的 worktree', async () => {
    const created = await manager.create();
    const fetched = manager.get(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
  });

  it('get() - 返回 null 当不存在', () => {
    const fetched = manager.get('non-existent');
    expect(fetched).toBeNull();
  });

  it('remove() - 成功删除', async () => {
    const wt = await manager.create();
    await manager.remove(wt.id);
    expect(manager.get(wt.id)).toBeNull();
    expect(manager.count()).toBe(0);
  });

  it('remove() - 抛出当 ID 不存在', async () => {
    await expect(manager.remove('non-existent')).rejects.toThrow(/不存在/);
  });

  it('merge() - 成功合并', async () => {
    const wt = await manager.create();
    const result = await manager.merge(wt.id);
    expect(result.success).toBe(true);
    expect(result.commitHash).toBeTruthy();
    expect(manager.get(wt.id)?.status).toBe('merged');
  });

  it('merge() - deleteBranch 选项', async () => {
    const wt = await manager.create();
    await manager.merge(wt.id, { deleteBranch: true });
    expect(manager.get(wt.id)).toBeNull();
  });

  it('merge() - 抛出当 ID 不存在', async () => {
    await expect(manager.merge('non-existent')).rejects.toThrow(/不存在/);
  });

  it('merge() - 抛出当已合并', async () => {
    const wt = await manager.create();
    await manager.merge(wt.id);
    await expect(manager.merge(wt.id)).rejects.toThrow(/已终态/);
  });

  it('merge() - 抛出当已丢弃', async () => {
    const wt = await manager.create();
    await manager.discard(wt.id);
    await expect(manager.merge(wt.id)).rejects.toThrow(/已终态/);
  });

  it('merge() - 冲突时返回 failure', async () => {
    const conflictBackend = new MockWorktreeBackend(1); // 100% 冲突
    const m = new WorktreeManager({ backend: conflictBackend, storage });
    try {
      const wt = await m.create();
      const result = await m.merge(wt.id);
      expect(result.success).toBe(false);
      expect(result.conflicts).toBeTruthy();
      expect(result.conflicts!.length).toBeGreaterThan(0);
    } finally {
      m.dispose();
    }
  });

  it('diff() - 返回 diff 结果', async () => {
    const wt = await manager.create();
    backend.injectMockFiles(wt.id, { 'src/test.ts': 'line1\nline2\nline3' });
    const result = await manager.diff(wt.id);
    expect(result.files.length).toBe(1);
    expect(result.files[0].path).toBe('src/test.ts');
    expect(result.totalAdditions).toBe(3);
  });

  it('diff() - 抛出当 ID 不存在', async () => {
    await expect(manager.diff('non-existent')).rejects.toThrow(/不存在/);
  });

  it('discard() - 成功丢弃', async () => {
    const wt = await manager.create();
    await manager.discard(wt.id);
    // 丢弃后状态变更但保留记录
    expect(manager.get(wt.id)?.status).toBe('discarded');
  });

  it('discard() - 抛出当已合并', async () => {
    const wt = await manager.create();
    await manager.merge(wt.id);
    await expect(manager.discard(wt.id)).rejects.toThrow(/已合并/);
  });
});

describe('WorktreeManager - 状态与元数据', () => {
  let manager: WorktreeManager;
  let backend: MockWorktreeBackend;
  let storage: MemoryWorktreeStorage;

  beforeEach(() => {
    backend = new MockWorktreeBackend(0);
    storage = new MemoryWorktreeStorage();
    manager = new WorktreeManager({ backend, storage });
  });

  afterEach(() => {
    manager.dispose();
  });

  it('updateStatus() - 正常更新', async () => {
    const wt = await manager.create();
    manager.updateStatus(wt.id, 'in-use');
    expect(manager.get(wt.id)?.status).toBe('in-use');
  });

  it('updateStatus() - 跳过相同时不触发事件', async () => {
    const wt = await manager.create();
    const events: WorktreeEvent[] = [];
    manager.subscribe((e) => events.push(e));
    manager.updateStatus(wt.id, 'ready'); // 已经是 ready
    expect(events.length).toBe(0);
  });

  it('updateStatus() - 静默忽略不存在的 ID', () => {
    expect(() => manager.updateStatus('non-existent', 'ready')).not.toThrow();
  });

  it('updateChanges() - 更新文件统计', async () => {
    const wt = await manager.create();
    manager.updateChanges(wt.id, { added: 5, modified: 3, deleted: 1 });
    expect(manager.get(wt.id)?.changes).toEqual({ added: 5, modified: 3, deleted: 1 });
  });

  it('attachToTask() - 关联任务', async () => {
    const wt = await manager.create();
    manager.attachToTask(wt.id, 'task-xyz');
    expect(manager.get(wt.id)?.taskId).toBe('task-xyz');
  });
});

describe('WorktreeManager - 事件订阅', () => {
  let manager: WorktreeManager;
  let backend: MockWorktreeBackend;
  let storage: MemoryWorktreeStorage;

  beforeEach(() => {
    backend = new MockWorktreeBackend(0);
    storage = new MemoryWorktreeStorage();
    manager = new WorktreeManager({ backend, storage });
  });

  afterEach(() => {
    manager.dispose();
  });

  it('subscribe() - 接收 created 事件', async () => {
    const events: WorktreeEvent[] = [];
    manager.subscribe((e) => events.push(e));
    await manager.create();
    expect(events.some((e) => e.type === 'created')).toBe(true);
  });

  it('subscribe() - 接收 status-changed 事件', async () => {
    const wt = await manager.create();
    const events: WorktreeEvent[] = [];
    manager.subscribe((e) => events.push(e));
    manager.updateStatus(wt.id, 'in-use');
    const evt = events.find((e) => e.type === 'status-changed') as Extract<
      WorktreeEvent,
      { type: 'status-changed' }
    >;
    expect(evt).toBeTruthy();
    expect(evt.previous).toBe('ready');
    expect(evt.current).toBe('in-use');
  });

  it('subscribe() - 接收 removed 事件', async () => {
    const wt = await manager.create();
    const events: WorktreeEvent[] = [];
    manager.subscribe((e) => events.push(e));
    await manager.remove(wt.id);
    expect(events.some((e) => e.type === 'removed')).toBe(true);
  });

  it('subscribe() - 接收 merged 事件', async () => {
    const wt = await manager.create();
    const events: WorktreeEvent[] = [];
    manager.subscribe((e) => events.push(e));
    await manager.merge(wt.id);
    expect(events.some((e) => e.type === 'merged')).toBe(true);
  });

  it('subscribe() - 接收 discarded 事件', async () => {
    const wt = await manager.create();
    const events: WorktreeEvent[] = [];
    manager.subscribe((e) => events.push(e));
    await manager.discard(wt.id);
    expect(events.some((e) => e.type === 'discarded')).toBe(true);
  });

  it('subscribe() - 返回取消订阅函数', async () => {
    const events: WorktreeEvent[] = [];
    const unsub = manager.subscribe((e) => events.push(e));
    await manager.create();
    const before = events.length;
    unsub();
    await manager.create();
    expect(events.length).toBe(before);
  });

  it('subscribe() - 订阅者异常不影响其他订阅者', async () => {
    const events2: WorktreeEvent[] = [];
    manager.subscribe(() => {
      throw new Error('boom');
    });
    manager.subscribe((e) => events2.push(e));
    // 抑制 console.error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await manager.create();
    expect(events2.length).toBeGreaterThan(0);
    spy.mockRestore();
  });
});

describe('WorktreeManager - 统计与清理', () => {
  let manager: WorktreeManager;
  let backend: MockWorktreeBackend;
  let storage: MemoryWorktreeStorage;

  beforeEach(() => {
    backend = new MockWorktreeBackend(0);
    storage = new MemoryWorktreeStorage();
    manager = new WorktreeManager({ backend, storage });
  });

  afterEach(() => {
    manager.dispose();
  });

  it('count() - 返回总数', async () => {
    await manager.create();
    await manager.create();
    expect(manager.count()).toBe(2);
  });

  it('countActive() - 只统计活跃状态', async () => {
    const a = await manager.create();
    const b = await manager.create();
    manager.updateStatus(a.id, 'merged');
    expect(manager.countActive()).toBe(1);
    expect(b.status).toBe('ready');
  });

  it('cleanup() - 清理过期已合并/已丢弃', async () => {
    const wt = await manager.create();
    manager.updateStatus(wt.id, 'discarded');
    // 模拟过期：手动更新 updatedAt
    const fetched = manager.get(wt.id);
    if (fetched) {
      fetched.updatedAt = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 天前
    }
    const removed = await manager.cleanup();
    expect(removed).toBe(1);
    expect(manager.get(wt.id)).toBeNull();
  });

  it('cleanup() - 保留未过期的', async () => {
    const wt = await manager.create();
    manager.updateStatus(wt.id, 'discarded');
    const removed = await manager.cleanup();
    expect(removed).toBe(0);
    expect(manager.get(wt.id)).not.toBeNull();
  });

  it('clear() - 清空所有', async () => {
    await manager.create();
    await manager.create();
    await manager.clear();
    expect(manager.count()).toBe(0);
  });
});

describe('WorktreeManager - 持久化', () => {
  it('load() - 从存储恢复 worktree', async () => {
    const storage = new MemoryWorktreeStorage();
    const backend = new MockWorktreeBackend(0);
    const m1 = new WorktreeManager({ backend, storage });
    await m1.create({ label: 'A' });
    await m1.create({ label: 'B' });
    m1.dispose();

    const m2 = new WorktreeManager({ backend, storage });
    expect(m2.count()).toBe(2);
    m2.dispose();
  });

  it('save() - 状态变更触发持久化', async () => {
    const storage = new MemoryWorktreeStorage();
    const backend = new MockWorktreeBackend(0);
    const m = new WorktreeManager({ backend, storage });
    const wt = await m.create();
    m.updateStatus(wt.id, 'in-use');
    const data = storage.load();
    expect(data[0].status).toBe('in-use');
    m.dispose();
  });
});

describe('WorktreeManager - 单例工厂', () => {
  afterEach(() => {
    resetWorktreeManager();
  });

  it('getWorktreeManager() - 返回单例', () => {
    const a = getWorktreeManager();
    const b = getWorktreeManager();
    expect(a).toBe(b);
  });

  it('resetWorktreeManager() - 清理后返回新实例', () => {
    const a = getWorktreeManager();
    resetWorktreeManager();
    const b = getWorktreeManager();
    expect(a).not.toBe(b);
  });

  it('setWorktreeManager() - 注入自定义实例', () => {
    const custom = new WorktreeManager({
      backend: new MockWorktreeBackend(0),
      storage: new MemoryWorktreeStorage(),
    });
    setWorktreeManager(custom);
    expect(getWorktreeManager()).toBe(custom);
    custom.dispose();
  });

  it('dispose() - 调用后操作抛错', async () => {
    const m = new WorktreeManager({
      backend: new MockWorktreeBackend(0),
      storage: new MemoryWorktreeStorage(),
    });
    m.dispose();
    await expect(m.create()).rejects.toThrow(/已 dispose/);
  });
});

describe('MockWorktreeBackend', () => {
  it('create - 返回基本字段', async () => {
    const backend = new MockWorktreeBackend(0);
    const wt = await backend.create({ type: 'review' });
    expect(wt.type).toBe('review');
    expect(wt.id).toBeTruthy();
    expect(wt.status).toBe('ready');
  });

  it('remove - 静默成功', async () => {
    const backend = new MockWorktreeBackend(0);
    await expect(backend.remove('any-id')).resolves.toBeUndefined();
  });

  it('diff - 空 worktree 返回空结果', async () => {
    const backend = new MockWorktreeBackend(0);
    const result = await backend.diff('empty-id');
    expect(result.files).toEqual([]);
    expect(result.totalAdditions).toBe(0);
  });

  it('status - 已存在返回 ready', async () => {
    const backend = new MockWorktreeBackend(0);
    const wt = await backend.create({});
    const status = await backend.status(wt.id);
    expect(status).toBe('ready');
  });

  it('status - 不存在返回 error', async () => {
    const backend = new MockWorktreeBackend(0);
    const status = await backend.status('non-existent');
    expect(status).toBe('error');
  });
});

describe('LocalStorageWorktreeStorage', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('load() - 空存储返回空数组', () => {
    const storage = new LocalStorageWorktreeStorage('test-key');
    expect(storage.load()).toEqual([]);
  });

  it('save() + load() - 往返一致', () => {
    const storage = new LocalStorageWorktreeStorage('test-key');
    const items: WorktreeInfo[] = [
      {
        id: 'a',
        type: 'isolated',
        path: '/p',
        branch: 'b',
        baseBranch: 'main',
        createdAt: 1,
        updatedAt: 1,
        status: 'ready',
      },
    ];
    storage.save(items);
    expect(storage.load()).toEqual(items);
  });

  it('save() - 超过 maxItems 截断', () => {
    const storage = new LocalStorageWorktreeStorage('test-key', 2);
    const items: WorktreeInfo[] = [
      { id: 'a', type: 'isolated', path: '/a', branch: 'a', baseBranch: 'main', createdAt: 1, updatedAt: 1, status: 'ready' },
      { id: 'b', type: 'isolated', path: '/b', branch: 'b', baseBranch: 'main', createdAt: 2, updatedAt: 2, status: 'ready' },
      { id: 'c', type: 'isolated', path: '/c', branch: 'c', baseBranch: 'main', createdAt: 3, updatedAt: 3, status: 'ready' },
    ];
    storage.save(items);
    expect(storage.load().length).toBe(2);
  });

  it('clear() - 清除数据', () => {
    const storage = new LocalStorageWorktreeStorage('test-key');
    storage.save([{ id: 'a', type: 'isolated', path: '/a', branch: 'a', baseBranch: 'main', createdAt: 1, updatedAt: 1, status: 'ready' }]);
    storage.clear();
    expect(storage.load()).toEqual([]);
  });
});
