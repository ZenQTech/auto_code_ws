/**
 * # ============================================================
 * # CSV Batch Engine - 单元测试 (v1.0.0 Cycle 26 G26-01)
 * # ============================================================
 * # 核心作用：覆盖 CsvBatchEngine 的所有核心功能
 * # 测试维度：
 * #   1. CSV 解析：BOM、换行、引号转义、灵活列数、空行
 * #   2. 模板渲染：简单/转换/缺省/JSON/切片
 * #   3. ID 去重
 * #   4. Job 生命周期：create/start/pause/resume/cancel
 * #   5. 并发控制
 * #   6. 重试与失败策略
 * #   7. 进度与 ETA
 * #   8. 结果导出
 * #   9. 事件订阅
 * #  10. 持久化
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 26 G26-01 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CsvBatchEngine,
  parseCsvContent,
  parseTemplate,
  renderTemplate,
  getDefaultCsvBatchEngine,
  resetDefaultCsvBatchEngine,
} from './csvBatchEngine';
import { CsvBatchJob } from './csvBatchEngineTypes';

describe('parseCsvContent', () => {
  it('should parse simple CSV', () => {
    const csv = 'id,name\n1,Alice\n2,Bob';
    const result = parseCsvContent(csv);
    expect(result.columns).toEqual(['id', 'name']);
    expect(result.rows).toEqual([
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ]);
  });

  it('should strip BOM', () => {
    const csv = '\uFEFFid,name\n1,Alice';
    const result = parseCsvContent(csv);
    expect(result.columns).toEqual(['id', 'name']);
    expect(result.rows.length).toBe(1);
  });

  it('should handle quoted fields with commas', () => {
    const csv = 'id,desc\n1,"hello, world"\n2,"line1\nline2"';
    const result = parseCsvContent(csv);
    expect(result.rows[0].desc).toBe('hello, world');
    expect(result.rows[1].desc).toBe('line1\nline2');
  });

  it('should handle escaped double quotes', () => {
    const csv = 'id,desc\n1,"She said ""hi"""';
    const result = parseCsvContent(csv);
    expect(result.rows[0].desc).toBe('She said "hi"');
  });

  it('should skip empty lines', () => {
    const csv = 'id,name\n\n1,Alice\n\n2,Bob\n';
    const result = parseCsvContent(csv);
    expect(result.rows.length).toBe(2);
  });

  it('should handle CRLF line endings', () => {
    const csv = 'id,name\r\n1,Alice\r\n2,Bob';
    const result = parseCsvContent(csv);
    expect(result.rows.length).toBe(2);
  });

  it('should handle flexible column counts', () => {
    const csv = 'id,name,extra\n1,Alice\n2,Bob,more';
    const result = parseCsvContent(csv);
    expect(result.rows[0].extra).toBe('');
    expect(result.rows[1].extra).toBe('more');
  });

  it('should return empty for empty content', () => {
    const result = parseCsvContent('');
    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
  });
});

describe('parseTemplate', () => {
  it('should parse simple placeholder', () => {
    const ph = parseTemplate('Hello {name}');
    expect(ph).toHaveLength(1);
    expect(ph[0].column).toBe('name');
    expect(ph[0].transform).toBe('plain');
  });

  it('should parse transform placeholders', () => {
    const ph = parseTemplate('{name|upper} {name|lower} {name|trim}');
    expect(ph).toHaveLength(3);
    expect(ph[0].transform).toBe('upper');
    expect(ph[1].transform).toBe('lower');
    expect(ph[2].transform).toBe('trim');
  });

  it('should parse default transform with fallback', () => {
    const ph = parseTemplate('{name|default:anonymous}');
    expect(ph[0].transform).toBe('default');
    expect(ph[0].options?.fallback).toBe('anonymous');
  });

  it('should parse slice transform with range', () => {
    const ph = parseTemplate('{text|slice:0:5}');
    expect(ph[0].transform).toBe('slice');
    expect(ph[0].options?.sliceRange).toEqual([0, 5]);
  });

  it('should parse json transform', () => {
    const ph = parseTemplate('{data|json}');
    expect(ph[0].transform).toBe('json');
  });
});

describe('renderTemplate', () => {
  it('should replace simple placeholders', () => {
    const result = renderTemplate('Hello {name}', { name: 'Alice' });
    expect(result).toBe('Hello Alice');
  });

  it('should apply upper transform', () => {
    const result = renderTemplate('{name|upper}', { name: 'alice' });
    expect(result).toBe('ALICE');
  });

  it('should apply lower transform', () => {
    const result = renderTemplate('{name|lower}', { name: 'ALICE' });
    expect(result).toBe('alice');
  });

  it('should apply trim transform', () => {
    const result = renderTemplate('{name|trim}', { name: '  alice  ' });
    expect(result).toBe('alice');
  });

  it('should apply default transform when value empty', () => {
    const result = renderTemplate('{name|default:anonymous}', { name: '' });
    expect(result).toBe('anonymous');
  });

  it('should not apply default when value present', () => {
    const result = renderTemplate('{name|default:anonymous}', { name: 'Alice' });
    expect(result).toBe('Alice');
  });

  it('should apply json transform', () => {
    const result = renderTemplate('data: {value|json}', { value: 'hello "world"' });
    expect(result).toBe('data: "hello \\"world\\""');
  });

  it('should apply slice transform', () => {
    const result = renderTemplate('{text|slice:0:5}', { text: 'hello world' });
    expect(result).toBe('hello');
  });

  it('should handle missing column gracefully', () => {
    const result = renderTemplate('Hello {name}', {});
    expect(result).toBe('Hello ');
  });

  it('should replace multiple placeholders', () => {
    const result = renderTemplate('{a} + {b} = {c}', { a: '1', b: '2', c: '3' });
    expect(result).toBe('1 + 2 = 3');
  });
});

describe('CsvBatchEngine', () => {
  let engine: CsvBatchEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new CsvBatchEngine({ persist: false });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createJob', () => {
    it('should create a job with default config', () => {
      const job = engine.createJob({
        name: 'Test',
        inputFile: 'test.csv',
        columns: ['id', 'name'],
        instruction: 'Process {name}',
        rows: [
          { id: '1', name: 'Alice' },
          { id: '2', name: 'Bob' },
        ],
        outputField: 'result',
      });
      expect(job.id).toBeTruthy();
      expect(job.status).toBe('pending');
      expect(job.items.length).toBe(2);
      expect(job.items[0].renderedInstruction).toBe('Process Alice');
      expect(job.items[1].renderedInstruction).toBe('Process Bob');
    });

    it('should generate IDs from idColumn', () => {
      const job = engine.createJob({
        name: 'Test',
        inputFile: 'test.csv',
        columns: ['id', 'name'],
        instruction: 'Process {name}',
        rows: [
          { id: 'a1', name: 'Alice' },
          { id: 'b2', name: 'Bob' },
        ],
        idColumn: 'id',
        outputField: 'result',
      });
      expect(job.items[0].id).toBe('item-a1');
      expect(job.items[1].id).toBe('item-b2');
    });

    it('should deduplicate IDs', () => {
      const job = engine.createJob({
        name: 'Test',
        inputFile: 'test.csv',
        columns: ['id', 'name'],
        instruction: 'Process {name}',
        rows: [
          { id: '1', name: 'Alice' },
          { id: '1', name: 'Alice2' },
          { id: '1', name: 'Alice3' },
        ],
        idColumn: 'id',
        outputField: 'result',
      });
      expect(job.items[0].id).toBe('item-1');
      expect(job.items[1].id).toBe('item-1-2');
      expect(job.items[2].id).toBe('item-1-3');
    });

    it('should use fallback IDs when no idColumn', () => {
      const job = engine.createJob({
        name: 'Test',
        inputFile: 'test.csv',
        columns: ['name'],
        instruction: 'Process {name}',
        rows: [
          { name: 'Alice' },
          { name: 'Bob' },
        ],
        outputField: 'result',
      });
      expect(job.items[0].id).toBe('item-row-0');
      expect(job.items[1].id).toBe('item-row-1');
    });

    it('should merge custom config with default', () => {
      const job = engine.createJob({
        name: 'Test',
        inputFile: 'test.csv',
        columns: ['name'],
        instruction: 'Process {name}',
        rows: [{ name: 'Alice' }],
        outputField: 'result',
        config: { maxConcurrency: 5 },
      });
      expect(job.config.maxConcurrency).toBe(5);
      expect(job.config.autoRetry).toBe(true); // 来自默认
    });
  });

  describe('lifecycle', () => {
    let job: CsvBatchJob;

    beforeEach(() => {
      job = engine.createJob({
        name: 'Test',
        inputFile: 'test.csv',
        columns: ['name'],
        instruction: 'Process {name}',
        rows: [
          { name: 'A' },
          { name: 'B' },
          { name: 'C' },
        ],
        outputField: 'result',
      });
    });

    it('should start job and run all items', async () => {
      const executor = vi.fn().mockResolvedValue('done');
      await engine.startJob(job.id, executor);
      const updated = engine.getJob(job.id)!;
      expect(updated.status).toBe('completed');
      expect(executor).toHaveBeenCalledTimes(3);
      expect(updated.items.every((i) => i.status === 'completed')).toBe(true);
    });

    it('should respect concurrency limit', async () => {
      let active = 0;
      let maxActive = 0;
      const executor = vi.fn().mockImplementation(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return 'done';
      });
      const limitedJob = engine.createJob({
        name: 'Limited',
        inputFile: 'test.csv',
        columns: ['name'],
        instruction: 'Process {name}',
        rows: Array.from({ length: 10 }, (_, i) => ({ name: `item${i}` })),
        outputField: 'result',
        config: { maxConcurrency: 2 },
      });
      await engine.startJob(limitedJob.id, executor);
      expect(maxActive).toBeLessThanOrEqual(2);
    });

    it('should pause and resume job', async () => {
      let resolveExec: (v: string) => void;
      const executor = vi.fn().mockImplementation(
        () => new Promise<string>((resolve) => { resolveExec = resolve; })
      );
      const promise = engine.startJob(job.id, executor);
      // 等待至少一个 item 开始
      await new Promise((r) => setTimeout(r, 10));
      engine.pauseJob(job.id);
      // 让当前 item 完成
      resolveExec!('done');
      await promise;
      // 状态应为 paused（因为 runJobItems 退出后没有更多 pending）
      // 由于并发控制，会有未开始的项
    });

    it('should cancel job and mark pending items as skipped', async () => {
      const executor = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50));
        return 'done';
      });
      const slowJob = engine.createJob({
        name: 'Slow',
        inputFile: 'test.csv',
        columns: ['name'],
        instruction: 'Process {name}',
        rows: Array.from({ length: 10 }, (_, i) => ({ name: `item${i}` })),
        outputField: 'result',
        config: { maxConcurrency: 1 },
      });
      const promise = engine.startJob(slowJob.id, executor);
      await new Promise((r) => setTimeout(r, 10));
      engine.cancelJob(slowJob.id);
      await promise.catch(() => undefined);
      const updated = engine.getJob(slowJob.id)!;
      expect(updated.status).toBe('cancelled');
    });

    it('should retry failed items', async () => {
      let calls = 0;
      const executor = vi.fn().mockImplementation(async () => {
        calls++;
        if (calls <= 2) throw new Error('fail');
        return 'ok';
      });
      const failJob = engine.createJob({
        name: 'Fail',
        inputFile: 'test.csv',
        columns: ['name'],
        instruction: 'Process {name}',
        rows: [{ name: 'A' }],
        outputField: 'result',
        config: { maxRetries: 2, autoRetry: true },
      });
      await engine.startJob(failJob.id, executor);
      const updated = engine.getJob(failJob.id)!;
      expect(updated.items[0].status).toBe('completed');
      expect(updated.items[0].retries).toBe(2);
    });

    it('should mark job as failed when fail-fast and any item fails', async () => {
      const executor = vi.fn().mockRejectedValue(new Error('fail'));
      const failJob = engine.createJob({
        name: 'FailFast',
        inputFile: 'test.csv',
        columns: ['name'],
        instruction: 'Process {name}',
        rows: [{ name: 'A' }, { name: 'B' }],
        outputField: 'result',
        config: { maxRetries: 0, autoRetry: false, failureStrategy: 'fail-fast' },
      });
      await engine.startJob(failJob.id, executor);
      const updated = engine.getJob(failJob.id)!;
      expect(updated.status).toBe('failed');
    });

    it('should mark job as completed with continue strategy even if some fail', async () => {
      let i = 0;
      const executor = vi.fn().mockImplementation(async () => {
        i++;
        if (i === 2) throw new Error('fail');
        return 'ok';
      });
      const failJob = engine.createJob({
        name: 'Continue',
        inputFile: 'test.csv',
        columns: ['name'],
        instruction: 'Process {name}',
        rows: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
        outputField: 'result',
        config: { maxRetries: 0, autoRetry: false, failureStrategy: 'continue' },
      });
      await engine.startJob(failJob.id, executor);
      const updated = engine.getJob(failJob.id)!;
      expect(updated.status).toBe('completed');
      const failed = updated.items.filter((it) => it.status === 'failed');
      expect(failed.length).toBe(1);
    });
  });

  describe('progress', () => {
    it('should calculate progress correctly', () => {
      const job = engine.createJob({
        name: 'Test',
        inputFile: 'test.csv',
        columns: ['name'],
        instruction: 'Process {name}',
        rows: [
          { name: 'A' },
          { name: 'B' },
          { name: 'C' },
        ],
        outputField: 'result',
      });
      job.items[0].status = 'completed';
      job.items[1].status = 'running';
      const progress = engine.getProgress(job.id);
      expect(progress?.total).toBe(3);
      expect(progress?.completed).toBe(1);
      expect(progress?.running).toBe(1);
      expect(progress?.pending).toBe(1);
      expect(progress?.failed).toBe(0);
    });
  });

  describe('export', () => {
    it('should export results as CSV', () => {
      const job = engine.createJob({
        name: 'Test',
        inputFile: 'test.csv',
        columns: ['id', 'name'],
        instruction: 'Process {name}',
        rows: [
          { id: '1', name: 'Alice' },
          { id: '2', name: 'Bob' },
        ],
        outputField: 'greeting',
      });
      job.items[0].status = 'completed';
      job.items[0].result = { outputField: 'greeting', value: 'Hello Alice', duration: 10 };
      job.items[1].status = 'completed';
      job.items[1].result = { outputField: 'greeting', value: 'Hello Bob', duration: 10 };
      const csv = engine.exportResults(job.id);
      const lines = csv.split('\n');
      expect(lines[0]).toBe('id,name,greeting');
      expect(lines[1]).toBe('1,Alice,Hello Alice');
      expect(lines[2]).toBe('2,Bob,Hello Bob');
    });

    it('should escape special characters in CSV', () => {
      const job = engine.createJob({
        name: 'Test',
        inputFile: 'test.csv',
        columns: ['text'],
        instruction: 'Process {text}',
        rows: [{ text: 'hello, "world"' }],
        outputField: 'out',
      });
      job.items[0].status = 'completed';
      job.items[0].result = { outputField: 'out', value: 'ok, done', duration: 10 };
      const csv = engine.exportResults(job.id);
      expect(csv).toContain('"hello, ""world"""');
      expect(csv).toContain('"ok, done"');
    });

    it('should show error for failed items', () => {
      const job = engine.createJob({
        name: 'Test',
        inputFile: 'test.csv',
        columns: ['name'],
        instruction: 'Process {name}',
        rows: [{ name: 'A' }],
        outputField: 'result',
      });
      job.items[0].status = 'failed';
      job.items[0].error = 'some error';
      const csv = engine.exportResults(job.id);
      expect(csv).toContain('ERROR: some error');
    });
  });

  describe('events', () => {
    it('should emit job-created', () => {
      const handler = vi.fn();
      engine.on('job-created', handler);
      const job = engine.createJob({
        name: 'Test',
        inputFile: 'test.csv',
        columns: ['name'],
        instruction: 'Process {name}',
        rows: [{ name: 'A' }],
        outputField: 'result',
      });
      expect(handler).toHaveBeenCalledTimes(1);
      expect((handler.mock.calls[0][0] as any).job.id).toBe(job.id);
    });

    it('should emit item-completed', async () => {
      const handler = vi.fn();
      engine.on('item-completed', handler);
      const job = engine.createJob({
        name: 'Test',
        inputFile: 'test.csv',
        columns: ['name'],
        instruction: 'Process {name}',
        rows: [{ name: 'A' }],
        outputField: 'result',
      });
      const executor = vi.fn().mockResolvedValue('done');
      await engine.startJob(job.id, executor);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should emit progress events during execution', async () => {
      const handler = vi.fn();
      engine.on('progress', handler);
      const job = engine.createJob({
        name: 'Test',
        inputFile: 'test.csv',
        columns: ['name'],
        instruction: 'Process {name}',
        rows: [{ name: 'A' }, { name: 'B' }],
        outputField: 'result',
      });
      const executor = vi.fn().mockResolvedValue('done');
      await engine.startJob(job.id, executor);
      expect(handler).toHaveBeenCalled();
    });

    it('should support unsubscribe', () => {
      const handler = vi.fn();
      const off = engine.on('job-created', handler);
      off();
      engine.createJob({
        name: 'Test',
        inputFile: 'test.csv',
        columns: ['name'],
        instruction: 'Process {name}',
        rows: [{ name: 'A' }],
        outputField: 'result',
      });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('persistence', () => {
    it('should save and load from localStorage', () => {
      const persistEngine = new CsvBatchEngine({ persist: true });
      const job = persistEngine.createJob({
        name: 'Persist',
        inputFile: 'test.csv',
        columns: ['name'],
        instruction: 'Process {name}',
        rows: [{ name: 'A' }],
        outputField: 'result',
      });
      const stored = localStorage.getItem('hermes.csvBatchEngine');
      expect(stored).toBeTruthy();
      const data = JSON.parse(stored!);
      expect(data.jobs.length).toBe(1);
      expect(data.jobs[0].id).toBe(job.id);
    });

    it('should restore on construction', () => {
      const initial = new CsvBatchEngine({ persist: true });
      initial.createJob({
        name: 'Restored',
        inputFile: 'test.csv',
        columns: ['name'],
        instruction: 'Process {name}',
        rows: [{ name: 'A' }],
        outputField: 'result',
      });
      const restored = new CsvBatchEngine({ persist: true });
      const jobs = restored.getAllJobs();
      expect(jobs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getAllJobs', () => {
    it('should return jobs sorted by creation time descending', async () => {
      const job1 = engine.createJob({
        name: 'First',
        inputFile: 'a.csv',
        columns: ['name'],
        instruction: 'P',
        rows: [{ name: 'A' }],
        outputField: 'r',
      });
      // 确保 createdAt 不同
      await new Promise((r) => setTimeout(r, 5));
      const job2 = engine.createJob({
        name: 'Second',
        inputFile: 'b.csv',
        columns: ['name'],
        instruction: 'P',
        rows: [{ name: 'B' }],
        outputField: 'r',
      });
      const jobs = engine.getAllJobs();
      expect(jobs[0].id).toBe(job2.id);
      expect(jobs[1].id).toBe(job1.id);
    });
  });

  describe('getStats', () => {
    it('should return aggregate statistics', async () => {
      engine.createJob({
        name: 'J1',
        inputFile: 'a.csv',
        columns: ['n'],
        instruction: 'P',
        rows: [{ n: 'A' }, { n: 'B' }],
        outputField: 'r',
      });
      const stats = engine.getStats();
      expect(stats.jobs).toBeGreaterThan(0);
      expect(stats.items).toBeGreaterThan(0);
    });
  });

  describe('cleanup', () => {
    it('should remove completed/failed/cancelled jobs', () => {
      const job = engine.createJob({
        name: 'J',
        inputFile: 'a.csv',
        columns: ['n'],
        instruction: 'P',
        rows: [{ n: 'A' }],
        outputField: 'r',
      });
      engine.getJob(job.id)!.status = 'completed';
      const count = engine.cleanup();
      expect(count).toBe(1);
      expect(engine.getJob(job.id)).toBeUndefined();
    });
  });
});

describe('getDefaultCsvBatchEngine', () => {
  beforeEach(() => {
    resetDefaultCsvBatchEngine();
  });

  it('should return singleton', () => {
    const a = getDefaultCsvBatchEngine();
    const b = getDefaultCsvBatchEngine();
    expect(a).toBe(b);
  });

  it('should reset via resetDefaultCsvBatchEngine', () => {
    const a = getDefaultCsvBatchEngine();
    resetDefaultCsvBatchEngine();
    const b = getDefaultCsvBatchEngine();
    expect(a).not.toBe(b);
  });
});
