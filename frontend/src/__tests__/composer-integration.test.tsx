/**
 * # ============================================================
 * Composer 集成测试 (v6.36.0 Cycle 16 P0-1)
 * # ============================================================
 * 核心作用：ComposerEngine + useComposer + ComposerPanel 完整链路集成测试
 * 测试覆盖：
 *   1. 上下文管理（添加/移除/清空）
 *   2. 编辑管理（add/accept/reject/modify/acceptAll/rejectAll）
 *   3. 快照管理（create/undo/redo/rollback）
 *   4. @ 引用解析
 *   5. 端到端工作流（Context → Prompt → Plan → Edit → Review → Accept）
 *   6. 错误场景（接受/拒绝不存在的 edit）
 * ============================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { useState } from 'react';
import { ComposerEngine, createComposerEngine, parseReferences } from '../utils/composerEngine';
import { ComposerPanel } from '../components/ComposerPanel';
import { ComposerProvider, useComposer } from '../hooks/useComposer';

// ============================================================
// Engine 层集成测试
// ============================================================
describe('ComposerEngine 集成 - Context 工作流', () => {
  let engine: ComposerEngine;

  beforeEach(() => {
    engine = createComposerEngine();
  });

  it('完整的 Context 流程：添加 → 修改 prompt → 解析 @ 引用 → 注入', () => {
    // 1. 添加 2 个 file context
    engine.addContext({
      type: 'file',
      path: 'src/index.ts',
      content: 'const x = 1;',
      language: 'typescript',
    });
    engine.addContext({
      type: 'file',
      path: 'src/utils.ts',
      content: 'export const y = 2;',
      language: 'typescript',
    });

    // 2. 设置 prompt
    engine.setPrompt('Rename x to foo across @file:src/index.ts');

    // 3. 解析 prompt 中的 @ 引用
    const refs = parseReferences(engine.getSession().prompt);
    expect(refs).toHaveLength(1);
    expect(refs[0].type).toBe('file');
    expect(refs[0].value).toBe('src/index');

    // 4. Session 状态正确
    const session = engine.getSession();
    expect(session.context.files).toHaveLength(2);
    expect(session.prompt).toContain('Rename x to foo');
  });

  it('移除单个 context 保留其他', () => {
    engine.addContext({ type: 'file', path: 'a.ts', content: '', language: 'ts' });
    engine.addContext({ type: 'file', path: 'b.ts', content: '', language: 'ts' });
    engine.addContext({ type: 'file', path: 'c.ts', content: '', language: 'ts' });
    expect(engine.getSession().context.files).toHaveLength(3);

    engine.removeContext('file', 'b.ts');
    const files = engine.getSession().context.files;
    expect(files).toHaveLength(2);
    expect(files.map(f => f.path)).toEqual(['a.ts', 'c.ts']);
  });

  it('清空 context 移除所有类型', () => {
    engine.addContext({ type: 'file', path: 'a.ts', content: '', language: 'ts' });
    engine.addContext({ type: 'folder', path: 'src', recursive: true, fileCount: 5 });
    engine.addContext({ type: 'symbol', name: 'foo', kind: 'function', filePath: 'a.ts', line: 10, snippet: 'function foo() {}' });
    engine.clearContext();
    const ctx = engine.getSession().context;
    expect(ctx.files).toHaveLength(0);
    expect(ctx.folders).toHaveLength(0);
    expect(ctx.symbols).toHaveLength(0);
  });
});

// ============================================================
// Engine 层集成测试 - Edit 工作流
// ============================================================
describe('ComposerEngine 集成 - Edit 工作流', () => {
  let engine: ComposerEngine;

  beforeEach(() => {
    engine = createComposerEngine();
  });

  it('完整的多文件编辑流程', () => {
    // 1. 添加 3 个 edits
    const edit1 = engine.addEdit({
      filePath: 'a.ts',
      beforeContent: 'const x = 1;',
      afterContent: 'const x = 2;',
      description: 'Update x value',
    });
    const edit2 = engine.addEdit({
      filePath: 'b.ts',
      beforeContent: 'export const y = 1;',
      afterContent: 'export const y = 2;',
      description: 'Update y export',
    });
    const edit3 = engine.addEdit({
      filePath: 'c.ts',
      beforeContent: 'class Foo {}',
      afterContent: 'class Foo {\n  bar() {}\n}',
      description: 'Add method',
    });

    // 2. 状态验证
    expect(engine.getPendingCount()).toBe(3);
    expect(engine.getAcceptedCount()).toBe(0);
    expect(engine.getRejectedCount()).toBe(0);

    // 3. 接受 edit1
    engine.acceptEdit(edit1.id);
    expect(engine.getPendingCount()).toBe(2);
    expect(engine.getAcceptedCount()).toBe(1);

    // 4. 拒绝 edit2
    engine.rejectEdit(edit2.id, 'no longer needed');
    expect(engine.getPendingCount()).toBe(1);
    expect(engine.getRejectedCount()).toBe(1);
    expect(engine.getSession().edits[1].feedback).toBe('no longer needed');

    // 5. 修改 edit3
    engine.modifyEdit(edit3.id, 'class Foo {\n  bar() { return 42; }\n}', 'Add return');
    expect(engine.getSession().edits[2].afterContent).toContain('return 42');
    expect(engine.getSession().edits[2].status).toBe('modified');
    expect(engine.getPendingCount()).toBe(1);
  });

  it('acceptAll/rejectAll 批量操作', () => {
    for (let i = 0; i < 5; i++) {
      engine.addEdit({
        filePath: `f${i}.ts`,
        beforeContent: 'old',
        afterContent: 'new',
        description: `edit ${i}`,
      });
    }
    expect(engine.getPendingCount()).toBe(5);

    engine.acceptAll();
    expect(engine.getPendingCount()).toBe(0);
    expect(engine.getAcceptedCount()).toBe(5);

    // 添加更多并 rejectAll
    for (let i = 0; i < 3; i++) {
      engine.addEdit({
        filePath: `g${i}.ts`,
        beforeContent: 'a',
        afterContent: 'b',
        description: '',
      });
    }
    engine.rejectAll();
    expect(engine.getPendingCount()).toBe(0);
    expect(engine.getRejectedCount()).toBe(3);
  });

  it('接受/拒绝不存在的 edit 不抛错', () => {
    expect(() => engine.acceptEdit('non-existent')).not.toThrow();
    expect(() => engine.rejectEdit('non-existent')).not.toThrow();
    expect(() => engine.modifyEdit('non-existent', 'new')).not.toThrow();
  });
});

// ============================================================
// Engine 层集成测试 - Snapshot 工作流
// ============================================================
describe('ComposerEngine 集成 - Snapshot 工作流', () => {
  let engine: ComposerEngine;

  beforeEach(() => {
    engine = createComposerEngine();
  });

  it('快照创建与 Undo/Redo', () => {
    const s1 = engine.createSnapshot('initial', { 'a.ts': 'v1' });
    const s2 = engine.createSnapshot('after edit 1', { 'a.ts': 'v2' });
    const s3 = engine.createSnapshot('after edit 2', { 'a.ts': 'v3' });

    expect(engine.getCurrentSnapshot()?.id).toBe(s3.id);
    expect(engine.canUndo()).toBe(true);
    expect(engine.canRedo()).toBe(false);

    // Undo
    const undone = engine.undo();
    expect(undone?.id).toBe(s2.id);
    expect(engine.canUndo()).toBe(true);
    expect(engine.canRedo()).toBe(true);

    // 再次 Undo
    engine.undo();
    expect(engine.getCurrentSnapshot()?.id).toBe(s1.id);
    expect(engine.canUndo()).toBe(false);

    // Redo 两次
    engine.redo();
    engine.redo();
    expect(engine.getCurrentSnapshot()?.id).toBe(s3.id);
  });

  it('回滚到指定 snapshot', () => {
    engine.createSnapshot('snap1', { 'a.ts': 'v1' });
    const s2 = engine.createSnapshot('snap2', { 'a.ts': 'v2' });
    engine.createSnapshot('snap3', { 'a.ts': 'v3' });

    const result = engine.rollback(s2.id);
    expect(result?.id).toBe(s2.id);
    expect(engine.getCurrentSnapshot()?.id).toBe(s2.id);
    expect(engine.canRedo()).toBe(true); // 还可以 redo 到 s3
  });

  it('创建快照截断 cursor 之后的历史', () => {
    engine.createSnapshot('s1', {});
    engine.createSnapshot('s2', {});
    engine.createSnapshot('s3', {});
    engine.undo(); // cursor 回到 s2
    engine.undo(); // cursor 回到 s1

    // 此时在 s1 创建新快照，s2 和 s3 应被截断
    engine.createSnapshot('s1.5', {});
    const snaps = engine.getSession().snapshots;
    expect(snaps).toHaveLength(2); // s1 + s1.5
  });
});

// ============================================================
// UI 集成测试 - 完整端到端
// ============================================================
describe('ComposerPanel 集成 - 端到端工作流', () => {
  function makeHarness() {
    const engine = createComposerEngine();
    let apiRef: any = null;

    function Harness() {
      const [isOpen, setIsOpen] = useState(true);
      const composer = useComposer();
      if (!apiRef) {
        apiRef = {
          ...composer,
          open: () => setIsOpen(true),
          close: () => setIsOpen(false),
        };
      }
      return <ComposerPanel externalIsOpen={isOpen} />;
    }

    return {
      Wrapper: () => (
        <ComposerProvider engine={engine}>
          <Harness />
        </ComposerProvider>
      ),
      engine,
      getApi: () => apiRef,
    };
  }

  it('完整流程：添加 context → 添加 3 个 edit → 接受 2 个拒绝 1 个', () => {
    const { Wrapper, getApi, engine } = makeHarness();
    render(<Wrapper />);

    act(() => {
      getApi().addContext({ type: 'file', path: 'foo.ts', content: 'x', language: 'ts' });
    });

    let editIds: string[] = [];
    act(() => {
      editIds = [
        getApi().addEdit({ filePath: 'a.ts', beforeContent: '1', afterContent: '2', description: '' }).id,
        getApi().addEdit({ filePath: 'b.ts', beforeContent: 'a', afterContent: 'b', description: '' }).id,
        getApi().addEdit({ filePath: 'c.ts', beforeContent: 'x', afterContent: 'y', description: '' }).id,
      ];
    });

    // 验证 3 个 edit 显示
    expect(screen.getByTestId('composer-edit-list')).toBeInTheDocument();
    expect(engine.getPendingCount()).toBe(3);

    // 接受前 2 个
    act(() => {
      getApi().acceptEdit(editIds[0]);
      getApi().acceptEdit(editIds[1]);
      getApi().rejectEdit(editIds[2]);
    });

    // 验证状态
    expect(engine.getAcceptedCount()).toBe(2);
    expect(engine.getRejectedCount()).toBe(1);
    expect(engine.getPendingCount()).toBe(0);

    // 验证 DOM 状态
    expect(screen.getByTestId(`composer-edit-${editIds[0]}`)).toHaveAttribute('data-status', 'accepted');
    expect(screen.getByTestId(`composer-edit-${editIds[1]}`)).toHaveAttribute('data-status', 'accepted');
    expect(screen.getByTestId(`composer-edit-${editIds[2]}`)).toHaveAttribute('data-status', 'rejected');
  });

  it('添加 context 标签显示在 context bar', () => {
    const { Wrapper, getApi } = makeHarness();
    render(<Wrapper />);

    act(() => {
      getApi().addContext({ type: 'file', path: 'src/utils.ts', content: '', language: 'ts' });
      getApi().addContext({ type: 'folder', path: 'src/components', recursive: true, fileCount: 12 });
    });

    const contextBar = screen.getByTestId('composer-context-bar');
    expect(within(contextBar).getByText(/src\/utils\.ts/)).toBeInTheDocument();
    expect(within(contextBar).getByText(/src\/components/)).toBeInTheDocument();
  });

  it('accept-all / reject-all 按钮批量操作', () => {
    const { Wrapper, getApi, engine } = makeHarness();
    render(<Wrapper />);

    act(() => {
      for (let i = 0; i < 4; i++) {
        getApi().addEdit({ filePath: `f${i}.ts`, beforeContent: 'a', afterContent: 'b', description: '' });
      }
    });

    // 点击 accept-all
    fireEvent.click(screen.getByTestId('composer-accept-all'));
    expect(engine.getAcceptedCount()).toBe(4);
    expect(engine.getPendingCount()).toBe(0);

    // 添加新 edit，点击 reject-all
    act(() => {
      for (let i = 0; i < 2; i++) {
        getApi().addEdit({ filePath: `g${i}.ts`, beforeContent: 'a', afterContent: 'b', description: '' });
      }
    });
    fireEvent.click(screen.getByTestId('composer-reject-all'));
    expect(engine.getRejectedCount()).toBe(2);
    expect(engine.getPendingCount()).toBe(0);
  });

  it('点击 diff 展开按钮展开 diff 内容', () => {
    const { Wrapper, getApi } = makeHarness();
    render(<Wrapper />);

    let editId = '';
    act(() => {
      editId = getApi().addEdit({
        filePath: 'foo.ts',
        beforeContent: 'line1\nline2\nline3',
        afterContent: 'line1\nline2 modified\nline3',
        description: 'test',
      }).id;
    });

    // 找到展开按钮（带 cursor-pointer 类的 div）
    const editItem = screen.getByTestId(`composer-edit-${editId}`);
    const expandButton = editItem.querySelector('div[class*="cursor-pointer"]')!;
    fireEvent.click(expandButton);

    // 展开后应该看到 diff 文本（不再隐藏）
    const item = screen.getByTestId(`composer-edit-${editId}`);
    // 验证展开后 innerHTML 包含 beforeContent
    expect(item.innerHTML).toContain('line1');
  });
});

// ============================================================
// @ 引用解析集成测试
// ============================================================
describe('parseReferences - 多类型 @ 引用', () => {
  it('解析混合类型 @ 引用', () => {
    const prompt = 'Refactor @file:src/foo and @folder:src/components. Also check @code:handleSubmit and @docs:https://react-dev and @web:react hooks';
    const refs = parseReferences(prompt);
    expect(refs).toHaveLength(5);
    // 实现中 @code: 映射为 'symbol' 类型（@code: → symbol）
    // @web: 允许空格（@web:react hooks → "react hooks"）
    expect(refs.map(r => r.type)).toEqual(['file', 'folder', 'symbol', 'docs', 'web']);
    expect(refs.map(r => r.value)).toEqual([
      'src/foo',
      'src/components',
      'handleSubmit',
      'https://react-dev',
      'react hooks',
    ]);
  });

  it('处理重复引用', () => {
    const prompt = 'Update @file:a and @file:a again';
    const refs = parseReferences(prompt);
    expect(refs).toHaveLength(2);
    expect(refs[0].value).toBe('a');
    expect(refs[1].value).toBe('a');
  });

  it('空 prompt 返回空数组', () => {
    expect(parseReferences('')).toEqual([]);
    expect(parseReferences('no references here')).toEqual([]);
  });
});
