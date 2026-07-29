/**
 * # ============================================================
 * Composer 引擎单元测试 (v6.36.0 Cycle 16 P0-1)
 * # ============================================================
 * 核心作用：验证 ComposerEngine 的所有核心 API
 * 测试覆盖：30 个测试用例
 *   - 基础 session 管理 (5)
 *   - 上下文管理 (5)
 *   - @ 引用解析 (5)
 *   - 编辑管理 (5)
 *   - 快照与回滚 (5)
 *   - 订阅模式 (3)
 *   - 序列化 (2)
 * ============================================================
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ComposerEngine,
  createComposerEngine,
  parseReferences,
  serializeSession,
  deserializeSession,
  autoResolveReferences,
  type FileContext,
} from './composerEngine';

describe('ComposerEngine - 基础', () => {
  let engine: ComposerEngine;

  beforeEach(() => {
    engine = createComposerEngine();
  });

  it('创建时 session 为空', () => {
    const session = engine.getSession();
    expect(session.prompt).toBe('');
    expect(session.edits).toEqual([]);
    expect(session.snapshots).toEqual([]);
    expect(session.cursor).toBe(-1);
    expect(session.context.files).toEqual([]);
  });

  it('setPrompt 更新 prompt', () => {
    engine.setPrompt('重构用户类型');
    expect(engine.getSession().prompt).toBe('重构用户类型');
  });

  it('getPendingCount 初始为 0', () => {
    expect(engine.getPendingCount()).toBe(0);
  });

  it('canUndo/canRedo 初始为 false', () => {
    expect(engine.canUndo()).toBe(false);
    expect(engine.canRedo()).toBe(false);
  });

  it('reset 清空 session', () => {
    engine.setPrompt('test');
    engine.reset();
    expect(engine.getSession().prompt).toBe('');
  });
});

describe('ComposerEngine - 上下文管理', () => {
  let engine: ComposerEngine;

  beforeEach(() => {
    engine = createComposerEngine();
  });

  it('addContext 添加文件', () => {
    const file: FileContext = {
      type: 'file',
      path: 'src/Foo.tsx',
      content: 'export const Foo = () => null;',
      language: 'tsx',
    };
    engine.addContext(file);
    expect(engine.getSession().context.files).toHaveLength(1);
    expect(engine.getSession().context.files[0].path).toBe('src/Foo.tsx');
  });

  it('addContext 添加多种类型', () => {
    engine.addContext({
      type: 'file',
      path: 'a.ts',
      content: '',
      language: 'ts',
    });
    engine.addContext({
      type: 'folder',
      path: 'src/utils',
      recursive: true,
      fileCount: 5,
    });
    engine.addContext({
      type: 'symbol',
      name: 'handleSubmit',
      kind: 'function',
      filePath: 'src/Form.tsx',
      line: 10,
      snippet: 'function handleSubmit() {}',
    });
    const ctx = engine.getSession().context;
    expect(ctx.files).toHaveLength(1);
    expect(ctx.folders).toHaveLength(1);
    expect(ctx.symbols).toHaveLength(1);
  });

  it('removeContext 按路径移除', () => {
    engine.addContext({
      type: 'file',
      path: 'a.ts',
      content: '',
      language: 'ts',
    });
    engine.addContext({
      type: 'file',
      path: 'b.ts',
      content: '',
      language: 'ts',
    });
    engine.removeContext('file', 'a.ts');
    const ctx = engine.getSession().context;
    expect(ctx.files).toHaveLength(1);
    expect(ctx.files[0].path).toBe('b.ts');
  });

  it('clearContext 清空所有', () => {
    engine.addContext({
      type: 'file',
      path: 'a.ts',
      content: '',
      language: 'ts',
    });
    engine.addContext({
      type: 'folder',
      path: 'src',
      recursive: true,
      fileCount: 1,
    });
    engine.clearContext();
    const ctx = engine.getSession().context;
    expect(ctx.files).toHaveLength(0);
    expect(ctx.folders).toHaveLength(0);
  });

  it('removeContext 移除不存在的条目不报错', () => {
    expect(() => engine.removeContext('file', 'nonexistent.ts')).not.toThrow();
  });
});

describe('@ 引用解析', () => {
  it('解析 @file 引用', () => {
    const refs = parseReferences('请修改 @file:src/components/Foo');
    expect(refs).toHaveLength(1);
    expect(refs[0].type).toBe('file');
    expect(refs[0].value).toBe('src/components/Foo');
  });

  it('解析多种类型引用', () => {
    const refs = parseReferences(
      '基于 @file:a 和 @folder:src/utils 重构 @code:handleSubmit'
    );
    expect(refs).toHaveLength(3);
    expect(refs[0].type).toBe('file');
    expect(refs[1].type).toBe('folder');
    expect(refs[2].type).toBe('symbol');
  });

  it('大小写不敏感', () => {
    const refs = parseReferences('@File:abc');
    expect(refs[0].type).toBe('file');
  });

  it('支持 @docs 和 @web', () => {
    const refs = parseReferences('参考 @docs:https://react-dev 搜索 @web:hook 模式');
    expect(refs).toHaveLength(2);
    expect(refs[0].type).toBe('docs');
    expect(refs[0].value).toBe('https://react-dev');
    expect(refs[1].type).toBe('web');
    expect(refs[1].value).toBe('hook');
  });

  it('无引用时返回空数组', () => {
    const refs = parseReferences('普通文本');
    expect(refs).toEqual([]);
  });
});

describe('ComposerEngine - 编辑管理', () => {
  let engine: ComposerEngine;

  beforeEach(() => {
    engine = createComposerEngine();
  });

  it('addEdit 创建 pending 编辑', () => {
    const edit = engine.addEdit({
      filePath: 'a.ts',
      beforeContent: 'old',
      afterContent: 'new',
      description: 'Update variable',
    });
    expect(edit.id).toBeDefined();
    expect(edit.status).toBe('pending');
    expect(edit.createdAt).toBeGreaterThan(0);
    expect(engine.getSession().edits).toHaveLength(1);
  });

  it('acceptEdit 修改状态', () => {
    const edit = engine.addEdit({
      filePath: 'a.ts',
      beforeContent: 'old',
      afterContent: 'new',
      description: '',
    });
    engine.acceptEdit(edit.id);
    expect(engine.getSession().edits[0].status).toBe('accepted');
    expect(engine.getSession().edits[0].appliedAt).toBeDefined();
  });

  it('rejectEdit 设置 feedback', () => {
    const edit = engine.addEdit({
      filePath: 'a.ts',
      beforeContent: 'old',
      afterContent: 'new',
      description: '',
    });
    engine.rejectEdit(edit.id, '不要修改');
    expect(engine.getSession().edits[0].status).toBe('rejected');
    expect(engine.getSession().edits[0].feedback).toBe('不要修改');
  });

  it('modifyEdit 修改内容', () => {
    const edit = engine.addEdit({
      filePath: 'a.ts',
      beforeContent: 'old',
      afterContent: 'new',
      description: '',
    });
    engine.modifyEdit(edit.id, 'custom', 'manual edit');
    expect(engine.getSession().edits[0].status).toBe('modified');
    expect(engine.getSession().edits[0].afterContent).toBe('custom');
  });

  it('acceptAll/rejectAll 批量操作', () => {
    engine.addEdit({ filePath: 'a.ts', beforeContent: '', afterContent: 'a', description: '' });
    engine.addEdit({ filePath: 'b.ts', beforeContent: '', afterContent: 'b', description: '' });
    engine.addEdit({ filePath: 'c.ts', beforeContent: '', afterContent: 'c', description: '' });
    expect(engine.getPendingCount()).toBe(3);
    engine.acceptAll();
    expect(engine.getAcceptedCount()).toBe(3);
    expect(engine.getPendingCount()).toBe(0);
  });

  it('clearEdits 清空所有', () => {
    engine.addEdit({ filePath: 'a.ts', beforeContent: '', afterContent: 'a', description: '' });
    engine.clearEdits();
    expect(engine.getSession().edits).toHaveLength(0);
  });
});

describe('ComposerEngine - 快照与回滚', () => {
  let engine: ComposerEngine;

  beforeEach(() => {
    engine = createComposerEngine();
  });

  it('createSnapshot 添加快照', () => {
    const snap = engine.createSnapshot('init', { 'a.ts': 'content' });
    expect(snap.id).toBeDefined();
    expect(snap.files['a.ts']).toBe('content');
    expect(engine.getSession().snapshots).toHaveLength(1);
    expect(engine.getSession().cursor).toBe(0);
  });

  it('undo 回到上一个快照', () => {
    engine.createSnapshot('s1', { 'a.ts': 'v1' });
    engine.createSnapshot('s2', { 'a.ts': 'v2' });
    expect(engine.canUndo()).toBe(true);
    const prev = engine.undo();
    expect(prev?.files['a.ts']).toBe('v1');
  });

  it('redo 前进', () => {
    engine.createSnapshot('s1', { 'a.ts': 'v1' });
    engine.createSnapshot('s2', { 'a.ts': 'v2' });
    engine.undo();
    expect(engine.canRedo()).toBe(true);
    const next = engine.redo();
    expect(next?.files['a.ts']).toBe('v2');
  });

  it('canUndo 在第一项时为 false', () => {
    engine.createSnapshot('s1', { 'a.ts': 'v1' });
    expect(engine.canUndo()).toBe(false);
  });

  it('rollback 跳转到指定快照', () => {
    engine.createSnapshot('s1', { 'a.ts': 'v1' });
    engine.createSnapshot('s2', { 'a.ts': 'v2' });
    engine.createSnapshot('s3', { 'a.ts': 'v3' });
    const target = engine.getSession().snapshots[0];
    const result = engine.rollback(target.id);
    expect(result?.files['a.ts']).toBe('v1');
    expect(engine.getSession().cursor).toBe(0);
  });

  it('新建快照截断 cursor 之后', () => {
    engine.createSnapshot('s1', { 'a.ts': 'v1' });
    engine.createSnapshot('s2', { 'a.ts': 'v2' });
    engine.undo();
    engine.createSnapshot('s3', { 'a.ts': 'v3' });
    expect(engine.getSession().snapshots).toHaveLength(2);
  });
});

describe('ComposerEngine - 订阅模式', () => {
  it('subscribe 接收变化通知', () => {
    const engine = createComposerEngine();
    const callback = vi.fn();
    engine.subscribe(callback);
    engine.setPrompt('test');
    expect(callback).toHaveBeenCalled();
  });

  it('unsubscribe 不再接收', () => {
    const engine = createComposerEngine();
    const callback = vi.fn();
    const unsub = engine.subscribe(callback);
    unsub();
    engine.setPrompt('test');
    expect(callback).not.toHaveBeenCalled();
  });

  it('多次 setPrompt 触发多次通知', () => {
    const engine = createComposerEngine();
    const callback = vi.fn();
    engine.subscribe(callback);
    engine.setPrompt('a');
    engine.setPrompt('b');
    engine.setPrompt('c');
    expect(callback).toHaveBeenCalledTimes(3);
  });
});

describe('ComposerEngine - 序列化', () => {
  it('serializeSession 输出 JSON', () => {
    const engine = createComposerEngine();
    engine.setPrompt('test prompt');
    const json = serializeSession(engine.getSession());
    expect(json).toContain('test prompt');
  });

  it('deserializeSession 恢复 session', () => {
    const engine = createComposerEngine();
    engine.setPrompt('test');
    const json = serializeSession(engine.getSession());
    const restored = deserializeSession(json);
    expect(restored?.prompt).toBe('test');
  });

  it('deserializeSession 无效 JSON 返回 null', () => {
    const result = deserializeSession('not json{');
    expect(result).toBeNull();
  });
});

describe('autoResolveReferences', () => {
  it('自动调用 resolvers 并添加 context', async () => {
    const engine = createComposerEngine();
    const fileResolver = vi.fn().mockResolvedValue({
      type: 'file' as const,
      path: 'a.ts',
      content: 'x',
      language: 'ts',
    });
    await autoResolveReferences(engine, '修改 @file:a', {
      file: fileResolver,
    });
    expect(fileResolver).toHaveBeenCalledWith('a');
    expect(engine.getSession().context.files).toHaveLength(1);
  });

  it('resolver 返回 null 时跳过', async () => {
    const engine = createComposerEngine();
    await autoResolveReferences(engine, '修改 @file:missing', {
      file: vi.fn().mockResolvedValue(null),
    });
    expect(engine.getSession().context.files).toHaveLength(0);
  });

  it('resolver 抛错时容忍', async () => {
    const engine = createComposerEngine();
    await autoResolveReferences(engine, '修改 @file:err', {
      file: vi.fn().mockRejectedValue(new Error('fail')),
    });
    expect(engine.getSession().context.files).toHaveLength(0);
  });
});
