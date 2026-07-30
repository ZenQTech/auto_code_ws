/**
 * # ============================================================
 * # CSV Batch Engine - CSV 批处理智能体引擎核心实现 (v1.0.0 Cycle 26 G26-01)
 * # ============================================================
 * # 核心作用：实现 CSV 驱动的批量智能体任务扇出（Map-Reduce 风格）
 * # 运行流程：
 * #   1. parseCsv 解析 CSV 内容（BOM/换行/引号兼容）
 * #   2. createJob 创建 Job，自动生成 Item + 渲染模板
 * #   3. startJob 启动并发执行（受 maxConcurrency 限制）
 * #   4. 每项执行通过用户传入的 ItemExecutor 完成
 * #   5. 失败自动重试 + ETA 实时计算
 * #   6. exportResults 导出结果为 CSV
 * # 输入参数：createJob(input), startJob(id), pause/resume/cancel
 * # 输出结果：Job/Item/Progress/Event
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 26 G26-01 初次创建
 * # ============================================================
 */

import {
  CsvBatchConfig,
  CsvBatchJob,
  CsvBatchItem,
  CsvBatchResult,
  CsvBatchProgress,
  CreateJobInput,
  ItemExecutor,
  CsvBatchEvent,
  CsvBatchEventType,
  TemplatePlaceholder,
  DEFAULT_CSV_BATCH_CONFIG,
  generateJobId,
  generateItemId,
} from './csvBatchEngineTypes';

// ============ 工具函数：CSV 解析 ============

/**
 * 解析 CSV 内容
 * 支持：BOM、换行（\r\n / \n）、引号转义、灵活列数、空行跳过
 */
export function parseCsvContent(content: string): {
  columns: string[];
  rows: Record<string, string>[];
} {
  // 去除 BOM
  const cleaned = content.replace(/^\uFEFF/, '');

  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < cleaned.length) {
    const ch = cleaned[i];

    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          // 转义的双引号
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (ch === ',') {
      current.push(field);
      field = '';
      i++;
      continue;
    }

    if (ch === '\r') {
      // 跳过单独的 \r（\r\n 会被下面处理）
      i++;
      continue;
    }

    if (ch === '\n') {
      current.push(field);
      field = '';
      // 跳过空行
      if (current.length > 1 || (current.length === 1 && current[0].trim() !== '')) {
        rows.push(current);
      }
      current = [];
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  // 处理最后一个字段
  if (field !== '' || current.length > 0) {
    current.push(field);
    if (current.length > 1 || (current.length === 1 && current[0].trim() !== '')) {
      rows.push(current);
    }
  }

  if (rows.length === 0) {
    return { columns: [], rows: [] };
  }

  const columns = rows[0].map((c) => c.trim());
  const dataRows: Record<string, string>[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row: Record<string, string> = {};
    for (let c = 0; c < columns.length; c++) {
      row[columns[c]] = (rows[r][c] ?? '').trim();
    }
    dataRows.push(row);
  }

  return { columns, rows: dataRows };
}

// ============ 工具函数：模板渲染 ============

/**
 * 解析模板中的占位符
 * 支持语法：{column} {column|upper} {column|lower} {column|trim}
 *           {column|default:FALLBACK} {column|json} {column|slice:0:10}
 */
export function parseTemplate(template: string): TemplatePlaceholder[] {
  const placeholders: TemplatePlaceholder[] = [];
  const regex = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template)) !== null) {
    const inner = match[1].trim();
    const parts = inner.split('|').map((p) => p.trim());
    const column = parts[0];
    let transform: TemplatePlaceholder['transform'] = 'plain';
    const options: TemplatePlaceholder['options'] = {};

    if (parts.length > 1) {
      const transformPart = parts[1];
      if (transformPart === 'upper' || transformPart === 'lower' || transformPart === 'trim' || transformPart === 'json') {
        transform = transformPart;
      } else if (transformPart.startsWith('default:')) {
        transform = 'default';
        options.fallback = transformPart.slice(8);
      } else if (transformPart.startsWith('slice:')) {
        transform = 'slice';
        const range = transformPart.slice(6).split(':');
        options.sliceRange = [parseInt(range[0], 10), parseInt(range[1] || '-1', 10)];
      }
    }

    placeholders.push({ column, transform, options });
  }

  return placeholders;
}

/**
 * 应用单个转换
 */
function applyTransform(value: string, placeholder: TemplatePlaceholder): string {
  switch (placeholder.transform) {
    case 'upper':
      return value.toUpperCase();
    case 'lower':
      return value.toLowerCase();
    case 'trim':
      return value.trim();
    case 'json':
      return JSON.stringify(value);
    case 'default':
      if (!value && placeholder.options?.fallback !== undefined) {
        return placeholder.options.fallback;
      }
      return value;
    case 'slice': {
      const range = placeholder.options?.sliceRange ?? [0, -1];
      const [start, end] = range;
      if (end === -1) {
        return value.slice(start);
      }
      return value.slice(start, end);
    }
    case 'plain':
    default:
      return value;
  }
}

/**
 * 渲染模板
 */
export function renderTemplate(template: string, row: Record<string, string>): string {
  const placeholders = parseTemplate(template);
  let result = template;

  for (const p of placeholders) {
    const rawValue = row[p.column] ?? '';
    const transformed = applyTransform(rawValue, p);
    // 替换所有匹配的占位符
    const pattern = new RegExp(`\\{${escapeRegex(p.column)}(\\|[^}]+)?\\}`, 'g');
    result = result.replace(pattern, transformed);
  }

  return result;
}

/**
 * 转义正则特殊字符
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============ 核心引擎类 ============

/**
 * CSV 批处理引擎
 */
export class CsvBatchEngine {
  private config: CsvBatchConfig;
  private jobs: Map<string, CsvBatchJob> = new Map();
  private listeners: Map<string, Set<Function>> = new Map();
  private stats = { jobs: 0, items: 0, completed: 0, failed: 0 };
  private abortControllers: Map<string, AbortController> = new Map();
  private storageKey = 'hermes.csvBatchEngine';

  constructor(config: Partial<CsvBatchConfig> = {}) {
    this.config = { ...DEFAULT_CSV_BATCH_CONFIG, ...config };
    if (this.config.persist) {
      this.load();
    }
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.jobs)) {
          for (const j of data.jobs) {
            // 恢复时重置运行中状态
            if (j.status === 'running') {
              j.status = 'paused';
            }
            this.jobs.set(j.id, j);
          }
        }
        this.stats = data.stats ?? this.stats;
      }
    } catch (e) {
      console.warn('CsvBatchEngine: failed to load from localStorage', e);
    }
  }

  private save(): void {
    if (!this.config.persist) return;
    try {
      const data = {
        jobs: Array.from(this.jobs.values()).map((j) => ({
          ...j,
          // 不持久化 AbortController 等运行时对象
        })),
        stats: this.stats,
      };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (e) {
      console.warn('CsvBatchEngine: failed to save to localStorage', e);
    }
  }

  // ============ 事件系统 ============

  /**
   * 订阅事件
   */
  on(event: CsvBatchEventType, listener: (e: CsvBatchEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  /**
   * 取消订阅
   */
  off(event: CsvBatchEventType, listener: Function): void {
    this.listeners.get(event)?.delete(listener);
  }

  /**
   * 触发事件
   */
  private emit(event: CsvBatchEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(event);
        } catch (err) {
          console.error(`CsvBatchEngine: error in event handler for ${event.type}`, err);
        }
      }
    }
  }

  // ============ Job 管理 ============

  /**
   * 创建 Job
   */
  createJob(input: CreateJobInput): CsvBatchJob {
    const id = generateJobId();
    const config = { ...this.config, ...(input.config || {}) };
    const items: CsvBatchItem[] = [];

    // 检测 ID 重复
    const seenIds = new Set<string>();
    for (let i = 0; i < input.rows.length; i++) {
      const row = input.rows[i];
      const baseId = generateItemId(i, input.idColumn, row);
      let itemId = baseId;
      let suffix = 2;
      while (seenIds.has(itemId)) {
        itemId = `${baseId}-${suffix}`;
        suffix++;
      }
      seenIds.add(itemId);

      const rendered = renderTemplate(input.instruction, row);
      items.push({
        id: itemId,
        rowIndex: i,
        renderedInstruction: rendered,
        rawRow: row,
        status: 'pending',
        retries: 0,
      });
    }

    const job: CsvBatchJob = {
      id,
      status: 'pending',
      name: input.name,
      inputFile: input.inputFile,
      columns: input.columns,
      instruction: input.instruction,
      idColumn: input.idColumn,
      outputField: input.outputField,
      items,
      config,
      createdAt: Date.now(),
      metadata: input.metadata,
    };

    this.jobs.set(id, job);
    this.stats.jobs++;
    this.stats.items += items.length;
    this.save();
    this.emit({ type: 'job-created', job });
    return job;
  }

  /**
   * 获取 Job
   */
  getJob(jobId: string): CsvBatchJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * 获取所有 Jobs
   */
  getAllJobs(): CsvBatchJob[] {
    // 使用稳定的二级排序：先按 createdAt 倒序，再按 id 倒序（id 包含时间戳+随机后缀）
    return Array.from(this.jobs.values()).sort((a, b) => {
      if (b.createdAt !== a.createdAt) {
        return b.createdAt - a.createdAt;
      }
      return b.id.localeCompare(a.id);
    });
  }

  /**
   * 获取进度
   */
  getProgress(jobId: string): CsvBatchProgress | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;

    const total = job.items.length;
    const completed = job.items.filter((i) => i.status === 'completed').length;
    const failed = job.items.filter((i) => i.status === 'failed').length;
    const running = job.items.filter((i) => i.status === 'running').length;
    const pending = job.items.filter((i) => i.status === 'pending').length;
    const done = completed + failed;
    const rate = total > 0 ? done / total : 0;

    const now = Date.now();
    const elapsed = job.startedAt ? (now - job.startedAt) / 1000 : 0;
    // 简单的 ETA 计算：基于已完成项的平均耗时
    let etaSeconds = 0;
    if (rate > 0 && rate < 1 && job.startedAt) {
      const avgPerItem = elapsed / done;
      etaSeconds = Math.ceil(avgPerItem * pending);
    }

    return {
      jobId,
      total,
      completed,
      failed,
      running,
      pending,
      etaSeconds,
      elapsedSeconds: Math.floor(elapsed),
      rate,
    };
  }

  /**
   * 启动 Job
   */
  async startJob(jobId: string, executor: ItemExecutor): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.status === 'running') return;

    job.status = 'running';
    job.startedAt = job.startedAt ?? Date.now();
    job.error = undefined;
    this.save();
    this.emit({ type: 'job-started', jobId });

    const abortController = new AbortController();
    this.abortControllers.set(jobId, abortController);

    try {
      await this.runJobItems(job, executor, abortController.signal);
      // 检查最终状态
      const hasFailed = job.items.some((i) => i.status === 'failed');
      const hasPending = job.items.some((i) => i.status === 'pending' || i.status === 'running');

      // 已被取消的 job 不再更新状态
      if (job.status === ('cancelled' as typeof job.status)) {
        // 已被取消
        return;
      }

      if (hasPending) {
        // 还有未完成项（可能是暂停）
        return;
      }

      if (hasFailed && job.config.failureStrategy === 'fail-fast') {
        job.status = 'failed';
      } else {
        job.status = 'completed';
      }
      job.completedAt = Date.now();
      this.save();
      this.emit({ type: 'job-completed', jobId });
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      job.completedAt = Date.now();
      this.save();
      this.emit({ type: 'job-failed', jobId, error: job.error });
    } finally {
      this.abortControllers.delete(jobId);
    }
  }

  /**
   * 暂停 Job
   */
  pauseJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.status !== 'running') return;
    // 取消当前执行，下次启动会从 pending 继续
    this.abortControllers.get(jobId)?.abort();
    job.status = 'paused';
    this.save();
  }

  /**
   * 恢复 Job
   */
  async resumeJob(jobId: string, executor: ItemExecutor): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.status !== 'paused') return;
    await this.startJob(jobId, executor);
  }

  /**
   * 取消 Job
   */
  cancelJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    this.abortControllers.get(jobId)?.abort();
    job.status = 'cancelled';
    // 标记未开始项为 skipped
    for (const item of job.items) {
      if (item.status === 'pending' || item.status === 'running') {
        item.status = 'skipped';
      }
    }
    job.completedAt = Date.now();
    this.save();
    this.emit({ type: 'job-cancelled', jobId });
  }

  /**
   * 重试失败项
   */
  async retryFailed(jobId: string, executor: ItemExecutor): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.status === 'running') return;
    // 将失败项重置为 pending
    for (const item of job.items) {
      if (item.status === 'failed') {
        item.status = 'pending';
        item.error = undefined;
        item.retries++;
      }
    }
    job.status = 'pending';
    this.save();
    await this.startJob(jobId, executor);
  }

  /**
   * 删除 Job
   */
  removeJob(jobId: string): boolean {
    return this.jobs.delete(jobId);
  }

  /**
   * 导出结果为 CSV
   */
  exportResults(jobId: string): string {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    const headers = [...job.columns, job.outputField];
    const lines: string[] = [];
    lines.push(headers.map(csvEscape).join(','));

    for (const item of job.items) {
      const values = job.columns.map((col) => item.rawRow[col] ?? '');
      const resultValue = item.result?.value !== undefined ? String(item.result.value) : (item.error ? `ERROR: ${item.error}` : '');
      values.push(resultValue);
      lines.push(values.map(csvEscape).join(','));
    }

    return lines.join('\n');
  }

  /**
   * 获取统计
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * 清理所有已完成/失败/取消的 Job
   */
  cleanup(): number {
    let count = 0;
    for (const [id, job] of this.jobs) {
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        this.jobs.delete(id);
        count++;
      }
    }
    this.save();
    return count;
  }

  // ============ 内部执行逻辑 ============

  /**
   * 执行 Job 的所有项（带并发控制）
   */
  private async runJobItems(
    job: CsvBatchJob,
    executor: ItemExecutor,
    signal: AbortSignal
  ): Promise<void> {
    const concurrency = Math.max(1, Math.min(10, job.config.maxConcurrency));
    const queue = job.items.filter((i) => i.status === 'pending');
    let cursor = 0;

    const workers: Promise<void>[] = [];
    for (let w = 0; w < concurrency; w++) {
      workers.push(
        (async () => {
          while (true) {
            if (signal.aborted) return;
            const idx = cursor++;
            if (idx >= queue.length) return;
            const item = queue[idx];
            await this.runItem(job, item, executor, signal);
            this.emit({ type: 'progress', progress: this.getProgress(job.id)! });
          }
        })()
      );
    }

    await Promise.all(workers);
  }

  /**
   * 执行单个 Item（带重试）
   */
  private async runItem(
    job: CsvBatchJob,
    item: CsvBatchItem,
    executor: ItemExecutor,
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted) {
      item.status = 'skipped';
      return;
    }

    item.status = 'running';
    item.startedAt = Date.now();
    this.emit({ type: 'item-started', jobId: job.id, itemId: item.id });

    const maxRetries = job.config.autoRetry ? job.config.maxRetries : 0;
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal.aborted) {
        item.status = 'skipped';
        return;
      }
      try {
        const startTime = Date.now();
        // 加入超时控制
        const result = await this.executeWithTimeout(
          executor(item.renderedInstruction, item),
          job.config.maxRuntimeSeconds * 1000,
          signal
        );
        const duration = Date.now() - startTime;
        const resultObj: CsvBatchResult = {
          outputField: job.outputField,
          value: result,
          rawJson: typeof result === 'object' ? JSON.stringify(result) : undefined,
          duration,
        };
        item.result = resultObj;
        item.status = 'completed';
        item.completedAt = Date.now();
        this.stats.completed++;
        this.save();
        this.emit({ type: 'item-completed', jobId: job.id, itemId: item.id, result: resultObj });
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        item.retries = attempt + 1;
        if (attempt < maxRetries) {
          // 重试前指数退避
          await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 5000)));
        }
      }
    }

    item.status = 'failed';
    item.error = lastError ?? 'Unknown error';
    item.completedAt = Date.now();
    this.stats.failed++;
    this.save();
    this.emit({ type: 'item-failed', jobId: job.id, itemId: item.id, error: item.error });

    if (job.config.failureStrategy === 'fail-fast') {
      throw new Error(`Item ${item.id} failed: ${item.error}`);
    }
  }

  /**
   * 带超时的执行
   */
  private executeWithTimeout<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Execution timed out after ${ms}ms`));
      }, ms);

      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('Execution aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      promise
        .then((result) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          reject(err);
        });
    });
  }
}

// ============ CSV 转义 ============

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ============ 单例 ============

let _defaultEngine: CsvBatchEngine | undefined;

export function getDefaultCsvBatchEngine(): CsvBatchEngine {
  if (!_defaultEngine) {
    _defaultEngine = new CsvBatchEngine();
  }
  return _defaultEngine;
}

export function resetDefaultCsvBatchEngine(): void {
  _defaultEngine?.cleanup();
  _defaultEngine = undefined;
}
