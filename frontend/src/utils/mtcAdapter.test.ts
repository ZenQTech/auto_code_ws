/**
 * # ============================================================
 * # MTC Adapter - 单元测试 (v1.0.0 Cycle 26 G26-03)
 * # ============================================================
 * # 核心作用：覆盖 MtcAdapter 的所有核心功能
 * # 测试维度：
 * #   1. 文件类型检测
 * #   2. 文件解析（CSV/JSON）
 * #   3. 7 种任务 handler
 * #   4. 任务生命周期
 * #   5. 结果导出
 * #   6. 事件订阅
 * #   7. 持久化
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 26 G26-03 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MtcAdapter,
  detectFileType,
  parseFileContent,
  getDefaultMtcAdapter,
  resetDefaultMtcAdapter,
} from './mtcAdapter';
import { MtcFile } from './mtcAdapterTypes';

describe('detectFileType', () => {
  it('should detect by extension', () => {
    expect(detectFileType('test.txt', 'hello')).toBe('text');
    expect(detectFileType('data.csv', 'a,b\n1,2')).toBe('data-csv');
    expect(detectFileType('config.json', '{}')).toBe('data-json');
    expect(detectFileType('app.tsx', 'const x = 1')).toBe('code-ts');
    expect(detectFileType('app.js', 'const x = 1')).toBe('code-js');
    expect(detectFileType('app.py', 'def x(): pass')).toBe('code-py');
    expect(detectFileType('app.html', '<html></html>')).toBe('code-html');
    expect(detectFileType('app.css', 'body {}')).toBe('code-css');
    expect(detectFileType('README.md', '# Title')).toBe('code-md');
  });

  it('should detect JSON by content', () => {
    expect(detectFileType('unknown', '{"key": "value"}')).toBe('data-json');
    expect(detectFileType('unknown', '[1, 2, 3]')).toBe('data-json');
  });

  it('should detect CSV by content', () => {
    expect(detectFileType('unknown', 'name,age\nAlice,30\nBob,25')).toBe('data-csv');
  });

  it('should fall back to text', () => {
    expect(detectFileType('unknown.xyz', 'some text')).toBe('text');
  });
});

describe('parseFileContent', () => {
  it('should parse CSV', () => {
    const file: MtcFile = {
      id: 'f1',
      name: 'data.csv',
      type: 'data-csv',
      size: 30,
      content: 'name,age\nAlice,30\nBob,25',
      loadedAt: Date.now(),
    };
    const parsed = parseFileContent(file);
    expect(parsed.parsed).toEqual({
      headers: ['name', 'age'],
      rows: [
        { name: 'Alice', age: '30' },
        { name: 'Bob', age: '25' },
      ],
    });
  });

  it('should parse JSON', () => {
    const file: MtcFile = {
      id: 'f1',
      name: 'data.json',
      type: 'data-json',
      size: 20,
      content: '{"key": "value"}',
      loadedAt: Date.now(),
    };
    const parsed = parseFileContent(file);
    expect(parsed.parsed).toEqual({ key: 'value' });
  });

  it('should handle invalid JSON', () => {
    const file: MtcFile = {
      id: 'f1',
      name: 'data.json',
      type: 'data-json',
      size: 10,
      content: 'not valid',
      loadedAt: Date.now(),
    };
    const parsed = parseFileContent(file);
    expect(parsed.parsed).toBeUndefined();
  });
});

describe('MtcAdapter - File Management', () => {
  let adapter: MtcAdapter;

  beforeEach(() => {
    localStorage.clear();
    adapter = new MtcAdapter({ persist: false });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should load file from content', () => {
    const file = adapter.loadFileFromContent('test.txt', 'hello world');
    expect(file.type).toBe('text');
    expect(adapter.getAllFiles().length).toBe(1);
  });

  it('should reject oversized files', async () => {
    const largeContent = 'a'.repeat(2 * 1024 * 1024);
    const blob = new Blob([largeContent], { type: 'text/plain' });
    const file = new File([blob], 'big.txt', { type: 'text/plain' });
    await expect(adapter.loadFile(file)).rejects.toThrow('File too large');
  });

  it('should load multiple files', async () => {
    const file1 = new File(['hello'], 'a.txt', { type: 'text/plain' });
    const file2 = new File(['world'], 'b.txt', { type: 'text/plain' });
    const files = await adapter.loadFiles([file1, file2]);
    expect(files.length).toBe(2);
  });

  it('should remove file', () => {
    const file = adapter.loadFileFromContent('test.txt', 'hello');
    expect(adapter.removeFile(file.id)).toBe(true);
    expect(adapter.getFile(file.id)).toBeUndefined();
  });

  it('should emit file-loaded event', () => {
    const handler = vi.fn();
    adapter.on('file-loaded', handler);
    adapter.loadFileFromContent('test.txt', 'hello');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('MtcAdapter - Tasks', () => {
  let adapter: MtcAdapter;
  let file: MtcFile;

  beforeEach(() => {
    localStorage.clear();
    adapter = new MtcAdapter({ persist: false });
    file = adapter.loadFileFromContent('doc.md', '# Title\n\nSome content here.');
  });

  it('should create task', () => {
    const task = adapter.createTask({
      type: 'summarize',
      fileIds: [file.id],
      params: { type: 'summarize', maxLength: 100, language: 'zh' },
      outputFormat: 'markdown',
    });
    expect(task.id).toBeTruthy();
    expect(task.status).toBe('pending');
  });

  it('should throw for non-existent file', () => {
    expect(() => {
      adapter.createTask({
        type: 'summarize',
        fileIds: ['nonexistent'],
        params: { type: 'summarize' },
        outputFormat: 'markdown',
      });
    }).toThrow('not found');
  });

  it('should run summarize task', async () => {
    const task = adapter.createTask({
      type: 'summarize',
      fileIds: [file.id],
      params: { type: 'summarize', language: 'zh' },
      outputFormat: 'markdown',
    });
    const result = await adapter.runTask(task.id);
    expect(result.content).toContain('MOCK');
    expect(adapter.getTask(task.id)?.status).toBe('completed');
  });

  it('should run translate task', async () => {
    const task = adapter.createTask({
      type: 'translate',
      fileIds: [file.id],
      params: { type: 'translate', from: 'en', to: 'zh' },
      outputFormat: 'text',
    });
    const result = await adapter.runTask(task.id);
    expect(result.content).toBeTruthy();
  });

  it('should run rewrite task', async () => {
    const task = adapter.createTask({
      type: 'rewrite',
      fileIds: [file.id],
      params: { type: 'rewrite', style: 'formal' },
      outputFormat: 'text',
    });
    const result = await adapter.runTask(task.id);
    expect(result.content).toBeTruthy();
  });

  it('should run analyze task and extract visualization', async () => {
    const csvFile = adapter.loadFileFromContent('data.csv', 'name,age\nAlice,30\nBob,25');
    adapter.setLLMCaller(async () => '## 关键洞察\n- 数据示例\n\n## 可视化建议\n- 图表类型: bar');
    const task = adapter.createTask({
      type: 'analyze',
      fileIds: [csvFile.id],
      params: { type: 'analyze', generateVisualization: true },
      outputFormat: 'markdown',
    });
    const result = await adapter.runTask(task.id);
    expect(result.visualization).toBeDefined();
    expect(result.visualization?.type).toBe('bar');
  });

  it('should run convert task', async () => {
    const task = adapter.createTask({
      type: 'convert',
      fileIds: [file.id],
      params: { type: 'convert', targetFormat: 'json' },
      outputFormat: 'json',
    });
    const result = await adapter.runTask(task.id);
    expect(result.content).toBeTruthy();
  });

  it('should run extract task with JSON format', async () => {
    adapter.setLLMCaller(async () => '[{"name": "Alice"}, {"name": "Bob"}]');
    const task = adapter.createTask({
      type: 'extract',
      fileIds: [file.id],
      params: { type: 'extract', fields: ['name'], format: 'json' },
      outputFormat: 'json',
    });
    const result = await adapter.runTask(task.id);
    expect(result.extracted).toHaveLength(2);
  });

  it('should run optimize task', async () => {
    const codeFile = adapter.loadFileFromContent('app.ts', 'function add(a: number, b: number) { return a + b; }');
    const task = adapter.createTask({
      type: 'optimize',
      fileIds: [codeFile.id],
      params: { type: 'optimize', goals: ['readability'], preserveApi: true },
      outputFormat: 'markdown',
    });
    const result = await adapter.runTask(task.id);
    expect(result.content).toBeTruthy();
  });

  it('should handle task failure', async () => {
    adapter.setLLMCaller(async () => { throw new Error('LLM failed'); });
    const task = adapter.createTask({
      type: 'summarize',
      fileIds: [file.id],
      params: { type: 'summarize' },
      outputFormat: 'markdown',
    });
    await expect(adapter.runTask(task.id)).rejects.toThrow('LLM failed');
    expect(adapter.getTask(task.id)?.status).toBe('failed');
  });

  it('should cancel pending task', () => {
    const task = adapter.createTask({
      type: 'summarize',
      fileIds: [file.id],
      params: { type: 'summarize' },
      outputFormat: 'markdown',
    });
    adapter.cancelTask(task.id);
    expect(adapter.getTask(task.id)?.status).toBe('cancelled');
  });

  it('should run batch tasks', async () => {
    const task1 = adapter.createTask({
      type: 'summarize',
      fileIds: [file.id],
      params: { type: 'summarize' },
      outputFormat: 'markdown',
    });
    const task2 = adapter.createTask({
      type: 'summarize',
      fileIds: [file.id],
      params: { type: 'summarize' },
      outputFormat: 'markdown',
    });
    const results = await adapter.runBatch([task1.id, task2.id]);
    expect(results.length).toBe(2);
  });
});

describe('MtcAdapter - Export', () => {
  let adapter: MtcAdapter;
  let file: MtcFile;

  beforeEach(() => {
    localStorage.clear();
    adapter = new MtcAdapter({ persist: false });
    file = adapter.loadFileFromContent('doc.md', '# Title\n\nSome content here.');
  });

  it('should export result as markdown', async () => {
    const task = adapter.createTask({
      type: 'summarize',
      fileIds: [file.id],
      params: { type: 'summarize' },
      outputFormat: 'markdown',
    });
    const result = await adapter.runTask(task.id);
    const exported = adapter.exportResult(result.id, 'markdown');
    expect(exported).toBe(result.content);
  });

  it('should export as JSON', async () => {
    const task = adapter.createTask({
      type: 'summarize',
      fileIds: [file.id],
      params: { type: 'summarize' },
      outputFormat: 'json',
    });
    const result = await adapter.runTask(task.id);
    const exported = adapter.exportResult(result.id, 'json');
    expect(() => JSON.parse(exported)).not.toThrow();
  });

  it('should export as HTML', async () => {
    const task = adapter.createTask({
      type: 'summarize',
      fileIds: [file.id],
      params: { type: 'summarize' },
      outputFormat: 'html',
    });
    const result = await adapter.runTask(task.id);
    const exported = adapter.exportResult(result.id, 'html');
    expect(exported).toContain('<!DOCTYPE html>');
  });

  it('should throw for non-existent result', () => {
    expect(() => adapter.exportResult('nonexistent', 'json')).toThrow('not found');
  });

  it('should export batch', async () => {
    const task1 = adapter.createTask({
      type: 'summarize',
      fileIds: [file.id],
      params: { type: 'summarize' },
      outputFormat: 'markdown',
    });
    const task2 = adapter.createTask({
      type: 'translate',
      fileIds: [file.id],
      params: { type: 'translate', from: 'en', to: 'zh' },
      outputFormat: 'markdown',
    });
    await adapter.runTask(task1.id);
    await adapter.runTask(task2.id);
    const exported = adapter.exportBatch([task1.id, task2.id]);
    expect(exported).toContain('---');
  });
});

describe('MtcAdapter - Stats & Persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should track stats', () => {
    const adapter = new MtcAdapter({ persist: false });
    adapter.loadFileFromContent('a.txt', 'a');
    adapter.loadFileFromContent('b.txt', 'b');
    const stats = adapter.getStats();
    expect(stats.files).toBe(2);
  });

  it('should persist and restore', () => {
    const a1 = new MtcAdapter({ persist: true });
    a1.loadFileFromContent('persist.txt', 'persistent data');
    const a2 = new MtcAdapter({ persist: true });
    expect(a2.getAllFiles().length).toBeGreaterThan(0);
  });

  it('should clear all data', () => {
    const adapter = new MtcAdapter({ persist: false });
    adapter.loadFileFromContent('a.txt', 'a');
    adapter.clear();
    expect(adapter.getAllFiles().length).toBe(0);
  });
});

describe('getDefaultMtcAdapter', () => {
  beforeEach(() => {
    resetDefaultMtcAdapter();
  });

  it('should return singleton', () => {
    const a = getDefaultMtcAdapter();
    const b = getDefaultMtcAdapter();
    expect(a).toBe(b);
  });

  it('should reset via resetDefault', () => {
    const a = getDefaultMtcAdapter();
    resetDefaultMtcAdapter();
    const b = getDefaultMtcAdapter();
    expect(a).not.toBe(b);
  });
});
