/**
 * # Task Checkpoint Engine - 单元测试
 * # Cycle 35 G35-03
 * # 覆盖：工具函数、初始化、线程、快照、增量、分支、标签、Time Travel、Diff、清理、统计
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  TaskCheckpointEngine,
  generateThreadId,
  generateCheckpointId,
  generateVersionNumber,
  calculateSize,
  shallowDiff,
  getDefaultTaskCheckpointEngine,
  resetDefaultTaskCheckpointEngine,
} from './taskCheckpointEngine';

describe('TaskCheckpointEngine - 工具函数', () => {
  it('generateXxxId 生成唯一 ID', () => {
    expect(generateThreadId()).toMatch(/^thread-/);
    expect(generateCheckpointId()).toMatch(/^ckpt-/);
  });

  it('generateVersionNumber 返回数字', () => {
    const v = generateVersionNumber();
    expect(typeof v).toBe('number');
    expect(v).toBeGreaterThan(0);
  });

  it('calculateSize 计算大小', () => {
    const size = calculateSize({ a: 1, b: 'x' });
    expect(size).toBeGreaterThan(0);
  });

  it('shallowDiff 计算差异', () => {
    const before = { a: 1, b: 2 };
    const after = { a: 1, c: 3 };
    const diff = shallowDiff(before, after);
    expect(diff.added).toContain('c');
    expect(diff.removed).toContain('b');
    expect(diff.modified).toHaveLength(0);
  });

  it('shallowDiff 修改检测', () => {
    const before = { a: 1 };
    const after = { a: 2 };
    const diff = shallowDiff(before, after);
    expect(diff.modified).toContain('a');
  });
});

describe('TaskCheckpointEngine - 初始化', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('使用默认配置创建', () => {
    const engine = new TaskCheckpointEngine();
    expect(engine).toBeInstanceOf(TaskCheckpointEngine);
  });

  it('自定义配置', () => {
    const engine = new TaskCheckpointEngine({ maxVersionsPerThread: 50 });
    expect(engine).toBeInstanceOf(TaskCheckpointEngine);
  });
});

describe('TaskCheckpointEngine - 线程管理', () => {
  let engine: TaskCheckpointEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new TaskCheckpointEngine({ enablePersistence: false });
  });

  it('createThread 创建', () => {
    const thread = engine.createThread({
      name: 'Test',
      engine: 'workflow',
      engineInstanceId: 'inst-1',
    });
    expect(thread.id).toBeDefined();
    expect(thread.branchCount).toBe(1);
  });

  it('deleteThread 删除', () => {
    const thread = engine.createThread({
      name: 'T',
      engine: 'w',
      engineInstanceId: 'i',
    });
    expect(engine.deleteThread(thread.id)).toBe(true);
    expect(engine.getThread(thread.id)).toBeUndefined();
  });

  it('getThread 获取', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    expect(engine.getThread(thread.id)?.id).toBe(thread.id);
  });

  it('listThreads 列表', () => {
    engine.createThread({ name: 'T1', engine: 'w', engineInstanceId: 'i' });
    engine.createThread({ name: 'T2', engine: 'w', engineInstanceId: 'i' });
    expect(engine.listThreads().length).toBe(2);
  });
});

describe('TaskCheckpointEngine - 完整快照', () => {
  let engine: TaskCheckpointEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new TaskCheckpointEngine({ enablePersistence: false });
  });

  it('saveCheckpoint 完整快照', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    const cp = engine.saveCheckpoint(thread.id, { x: 1 }, { message: 'first' });
    expect(cp.type).toBe('full');
    expect(cp.size).toBeGreaterThan(0);
  });

  it('saveCheckpoint 线程不存在抛错', () => {
    expect(() => engine.saveCheckpoint('not-exist', {})).toThrow();
  });

  it('saveCheckpoint 多次保存递增版本', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    const v1 = engine.saveCheckpoint(thread.id, { x: 1 });
    const v2 = engine.saveCheckpoint(thread.id, { x: 2 });
    expect(v2.version).toBeGreaterThan(v1.version);
  });

  it('saveCheckpoint 带标签', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    const cp = engine.saveCheckpoint(thread.id, { x: 1 }, { tag: 'v1.0' });
    expect(cp.tag).toBe('v1.0');
  });
});

describe('TaskCheckpointEngine - 增量快照', () => {
  let engine: TaskCheckpointEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new TaskCheckpointEngine({ enablePersistence: false });
  });

  it('saveIncremental 增量', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    engine.saveCheckpoint(thread.id, { a: 1, b: 2 });
    const cp = engine.saveIncremental(thread.id, { a: 1, b: 2, c: 3 });
    expect(cp.type).toBe('incremental');
  });

  it('saveIncremental 无基础版本则保存为完整', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    const cp = engine.saveIncremental(thread.id, { x: 1 });
    expect(cp.type).toBe('full');
  });
});

describe('TaskCheckpointEngine - 版本管理', () => {
  let engine: TaskCheckpointEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new TaskCheckpointEngine({ enablePersistence: false });
  });

  it('getVersion 获取', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    const cp = engine.saveCheckpoint(thread.id, { x: 1 });
    const v = engine.getVersion(thread.id, cp.version);
    expect(v?.version).toBe(cp.version);
  });

  it('listVersions 列表', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    engine.saveCheckpoint(thread.id, { x: 1 });
    engine.saveCheckpoint(thread.id, { x: 2 });
    expect(engine.listVersions(thread.id).length).toBe(2);
  });
});

describe('TaskCheckpointEngine - 分支管理', () => {
  let engine: TaskCheckpointEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new TaskCheckpointEngine({ enablePersistence: false });
  });

  it('createBranch 创建', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    const cp = engine.saveCheckpoint(thread.id, { x: 1 });
    const branch = engine.createBranch(thread.id, 'dev', cp.version);
    expect(branch.name).toBe('dev');
  });

  it('createBranch 同名抛错', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    engine.createBranch(thread.id, 'dev', 1);
    expect(() => engine.createBranch(thread.id, 'dev', 1)).toThrow();
  });

  it('switchBranch 切换', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    engine.createBranch(thread.id, 'dev', 1);
    expect(engine.switchBranch(thread.id, 'dev')).toBe(true);
  });

  it('switchBranch 不存在', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    expect(engine.switchBranch(thread.id, 'not-exist')).toBe(false);
  });

  it('deleteBranch 删除', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    engine.createBranch(thread.id, 'dev', 1);
    expect(engine.deleteBranch(thread.id, 'dev')).toBe(true);
  });

  it('deleteBranch main 不可删除', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    expect(engine.deleteBranch(thread.id, 'main')).toBe(false);
  });

  it('listBranches 列表', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    const list = engine.listBranches(thread.id);
    expect(list.find((b) => b.name === 'main')).toBeDefined();
  });
});

describe('TaskCheckpointEngine - 标签管理', () => {
  let engine: TaskCheckpointEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new TaskCheckpointEngine({ enablePersistence: false });
  });

  it('createTag 创建', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    const cp = engine.saveCheckpoint(thread.id, { x: 1 });
    const tag = engine.createTag(thread.id, 'v1.0', cp.version);
    expect(tag.name).toBe('v1.0');
  });

  it('createTag 同名抛错', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    const cp = engine.saveCheckpoint(thread.id, { x: 1 });
    engine.createTag(thread.id, 'v1.0', cp.version);
    expect(() => engine.createTag(thread.id, 'v1.0', cp.version)).toThrow();
  });

  it('deleteTag 删除', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    const cp = engine.saveCheckpoint(thread.id, { x: 1 });
    engine.createTag(thread.id, 'v1.0', cp.version);
    expect(engine.deleteTag(thread.id, 'v1.0')).toBe(true);
  });

  it('getTag 获取', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    const cp = engine.saveCheckpoint(thread.id, { x: 1 });
    engine.createTag(thread.id, 'v1.0', cp.version);
    expect(engine.getTag(thread.id, 'v1.0')?.name).toBe('v1.0');
  });

  it('listTags 列表', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    const cp = engine.saveCheckpoint(thread.id, { x: 1 });
    engine.createTag(thread.id, 'v1.0', cp.version);
    expect(engine.listTags(thread.id).length).toBe(1);
  });
});

describe('TaskCheckpointEngine - Time Travel', () => {
  let engine: TaskCheckpointEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new TaskCheckpointEngine({ enablePersistence: false });
  });

  it('restore 恢复到指定版本', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    const v1 = engine.saveCheckpoint(thread.id, { x: 1 });
    engine.saveCheckpoint(thread.id, { x: 2 });
    const state = engine.restore(thread.id, v1.version);
    expect((state as any).x).toBe(1);
  });

  it('restoreToTag 恢复到标签', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    const v1 = engine.saveCheckpoint(thread.id, { x: 1 });
    engine.createTag(thread.id, 'v1.0', v1.version);
    const state = engine.restoreToTag(thread.id, 'v1.0');
    expect((state as any).x).toBe(1);
  });

  it('restoreToBranch 恢复到分支', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    const v1 = engine.saveCheckpoint(thread.id, { x: 1 });
    engine.createBranch(thread.id, 'dev', v1.version);
    const state = engine.restoreToBranch(thread.id, 'dev');
    expect((state as any).x).toBe(1);
  });

  it('checkout 切换版本', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    const v1 = engine.saveCheckpoint(thread.id, { x: 1 });
    engine.checkout(thread.id, v1.version);
  });
});

describe('TaskCheckpointEngine - Diff', () => {
  let engine: TaskCheckpointEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new TaskCheckpointEngine({ enablePersistence: false });
  });

  it('diff 对比两版本', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    const v1 = engine.saveCheckpoint(thread.id, { a: 1, b: 2 });
    const v2 = engine.saveCheckpoint(thread.id, { a: 1, c: 3 });
    const diff = engine.diff(thread.id, v1.version, v2.version);
    expect(diff.added).toContain('c');
    expect(diff.removed).toContain('b');
  });

  it('diffBranches 跨分支对比', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    const v1 = engine.saveCheckpoint(thread.id, { x: 1 });
    engine.saveCheckpoint(thread.id, { x: 2 });
    engine.createBranch(thread.id, 'dev', v1.version);
    const diff = engine.diffBranches(thread.id, 'main', 'dev');
    expect(diff).toBeDefined();
  });
});

describe('TaskCheckpointEngine - 持久化与清理', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exportThread 导出', () => {
    const engine = new TaskCheckpointEngine({ enablePersistence: false });
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    engine.saveCheckpoint(thread.id, { x: 1 });
    const exported = engine.exportThread(thread.id);
    expect(exported).toBeDefined();
  });

  it('importThread 导入', () => {
    const e1 = new TaskCheckpointEngine({ enablePersistence: false });
    const thread = e1.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    e1.saveCheckpoint(thread.id, { x: 1 });
    const exported = e1.exportThread(thread.id)!;
    const e2 = new TaskCheckpointEngine({ enablePersistence: false });
    e2.importThread(exported);
    expect(e2.getThread(thread.id)).toBeDefined();
  });

  it('cleanup 清理旧版本', () => {
    const engine = new TaskCheckpointEngine({ enablePersistence: false, maxVersionsPerThread: 5 });
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    for (let i = 0; i < 10; i++) {
      engine.saveCheckpoint(thread.id, { i });
    }
    const deleted = engine.cleanup(thread.id, { keepCount: 3 });
    expect(deleted).toBeGreaterThan(0);
  });
});

describe('TaskCheckpointEngine - 引擎注册', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('registerEngine 创建线程', () => {
    const engine = new TaskCheckpointEngine({ enablePersistence: false });
    const threadId = engine.registerEngine('workflow-1', 'inst-1', 'workflow-thread');
    expect(engine.getThread(threadId)).toBeDefined();
  });
});

describe('TaskCheckpointEngine - 事件系统', () => {
  let engine: TaskCheckpointEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new TaskCheckpointEngine({ enablePersistence: false });
  });

  it('on 订阅事件', () => {
    const unsub = engine.on('thread-created', () => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('thread-created 触发', () => {
    const events: any[] = [];
    engine.on('thread-created', (e) => events.push(e));
    engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    expect(events.length).toBe(1);
  });
});

describe('TaskCheckpointEngine - 统计', () => {
  let engine: TaskCheckpointEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new TaskCheckpointEngine({ enablePersistence: false });
  });

  it('getStats 返回完整统计', () => {
    const thread = engine.createThread({ name: 'T', engine: 'w', engineInstanceId: 'i' });
    engine.saveCheckpoint(thread.id, { x: 1 });
    const stats = engine.getStats();
    expect(stats.threads.total).toBeGreaterThan(0);
    expect(stats.checkpoints.total).toBeGreaterThan(0);
  });
});

describe('TaskCheckpointEngine - 单例', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultTaskCheckpointEngine();
  });

  it('getDefault 返回单例', () => {
    const e1 = getDefaultTaskCheckpointEngine();
    const e2 = getDefaultTaskCheckpointEngine();
    expect(e1).toBe(e2);
  });

  it('resetDefault 重置', () => {
    const e1 = getDefaultTaskCheckpointEngine();
    resetDefaultTaskCheckpointEngine();
    const e2 = getDefaultTaskCheckpointEngine();
    expect(e1).not.toBe(e2);
  });
});
