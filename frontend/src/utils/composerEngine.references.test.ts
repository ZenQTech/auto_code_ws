/**
 * parseReferences 扩展测试 (v6.38.0 Cycle 18 G18-01)
 */

import { describe, it, expect } from 'vitest';
import { parseReferences, parseAndResolveReferences } from './composerEngine';

describe('parseReferences 扩展 (Cycle 18 G18-01)', () => {
  it('应该解析 @codebase 引用', () => {
    const prompt = '请帮我在 @codebase:user authentication 中查找登录实现';
    const refs = parseReferences(prompt);
    const codebase = refs.filter((r) => r.type === 'codebase');
    expect(codebase.length).toBe(1);
    expect(codebase[0].value).toBe('user authentication');
  });

  it('应该解析 @git 引用', () => {
    const prompt = '查看 @git:log?file=src/auth.ts 最近的提交';
    const refs = parseReferences(prompt);
    const git = refs.filter((r) => r.type === 'git');
    expect(git.length).toBe(1);
    expect(git[0].value).toBe('log?file=src/auth.ts');
  });

  it('应该解析 @git blame 引用', () => {
    const prompt = '使用 @git:blame?file=src/auth.ts&line=42 查看 blame';
    const refs = parseReferences(prompt);
    const git = refs.filter((r) => r.type === 'git');
    expect(git.length).toBe(1);
    expect(git[0].value).toContain('blame');
  });

  it('应该解析 @diff 引用（无 value）', () => {
    const prompt = '基于当前 @diff 修改';
    const refs = parseReferences(prompt);
    const diff = refs.filter((r) => r.type === 'diff');
    expect(diff.length).toBe(1);
    expect(diff[0].value).toBe('');
  });

  it('应该解析 @diff:HEAD 引用', () => {
    const prompt = '对比 @diff:HEAD 和当前修改';
    const refs = parseReferences(prompt);
    const diff = refs.filter((r) => r.type === 'diff');
    expect(diff.length).toBe(1);
    expect(diff[0].value).toBe('HEAD');
  });

  it('应该解析 @diff:<sha> 引用', () => {
    const prompt = '查看 @diff:abc1234 的差异';
    const refs = parseReferences(prompt);
    const diff = refs.filter((r) => r.type === 'diff');
    expect(diff.length).toBe(1);
    expect(diff[0].value).toBe('abc1234');
  });

  it('应该解析多种引用混合', () => {
    const prompt = '用 @codebase:auth + @git:log?file=auth.ts + @diff 修改';
    const refs = parseReferences(prompt);
    expect(refs.length).toBe(3);
    expect(refs.map((r) => r.type)).toEqual(
      expect.arrayContaining(['codebase', 'git', 'diff'])
    );
  });

  it('应该保持原有 @file/@folder/@code/@docs/@web 解析', () => {
    const prompt = '@file:src/foo @folder:src/utils @code:bar @docs:https://react.dev @web:hooks';
    const refs = parseReferences(prompt);
    expect(refs.length).toBe(5);
    expect(refs.map((r) => r.type)).toEqual(
      expect.arrayContaining(['file', 'folder', 'symbol', 'docs', 'web'])
    );
    expect(refs[0].value).toBe('src/foo');
    expect(refs[1].value).toBe('src/utils');
    expect(refs[2].value).toBe('bar');
  });

  it('应该支持大小写不敏感', () => {
    const prompt = '@Codebase:auth @Git:log @DIFF:HEAD';
    const refs = parseReferences(prompt);
    expect(refs.length).toBe(3);
    expect(refs[0].type).toBe('codebase');
    expect(refs[1].type).toBe('git');
    expect(refs[2].type).toBe('diff');
  });
});

describe('parseAndResolveReferences 异步 (Cycle 18 G18-01)', () => {
  it('应该异步解析 @codebase 引用', async () => {
    const prompt = '查询 @codebase:user authentication';
    const result = await parseAndResolveReferences(prompt);
    expect(result.references.length).toBe(1);
    expect(result.resolved.codebase.length).toBe(1);
    expect(result.resolved.codebase[0].query).toBe('user authentication');
  });

  it('应该异步解析 @git 引用', async () => {
    const prompt = '@git:log?file=src/auth.ts&line=42';
    const result = await parseAndResolveReferences(prompt);
    expect(result.resolved.git.length).toBe(1);
    expect(result.resolved.git[0].ref).toBe('log');
    expect(result.resolved.git[0].filePath).toBe('src/auth.ts');
    expect(result.resolved.git[0].line).toBe(42);
  });

  it('应该异步解析 @diff 引用', async () => {
    const prompt = '@diff:HEAD';
    const result = await parseAndResolveReferences(prompt);
    expect(result.resolved.diff.length).toBe(1);
    expect(result.resolved.diff[0].ref).toBe('HEAD');
  });

  it('应该并发解析多个引用', async () => {
    const prompt = '@codebase:auth @git:log?file=auth.ts @diff';
    const start = Date.now();
    const result = await parseAndResolveReferences(prompt);
    const elapsed = Date.now() - start;
    expect(result.resolved.codebase.length).toBe(1);
    expect(result.resolved.git.length).toBe(1);
    expect(result.resolved.diff.length).toBe(1);
    // 并发执行应该很快（< 1000ms）
    expect(elapsed).toBeLessThan(1000);
  });

  it('空 prompt 应该返回空结果', async () => {
    const result = await parseAndResolveReferences('');
    expect(result.references.length).toBe(0);
    expect(result.resolved.codebase.length).toBe(0);
    expect(result.resolved.git.length).toBe(0);
    expect(result.resolved.diff.length).toBe(0);
  });

  it('应该处理无效 git 子命令', async () => {
    const prompt = '@git:invalidcmd';
    const result = await parseAndResolveReferences(prompt);
    // 即使是 mock，也会返回结构化数据
    expect(result.resolved.git.length).toBe(1);
  });

  it('errors 数组应该捕获错误（如果发生）', async () => {
    // 此测试只验证 errors 数组结构存在
    const result = await parseAndResolveReferences('@codebase:test');
    expect(Array.isArray(result.errors)).toBe(true);
  });
});
