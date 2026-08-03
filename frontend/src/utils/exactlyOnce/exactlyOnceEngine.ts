/**
 * # ============================================================
 * # Exactly-Once Semantics - 引擎 (Cycle 57 G57-04)
 * # ============================================================
 * # 核心作用：声明式 Exactly-Once 语义支持
 * # 特性：事务性生产者 + 幂等消费者 + 状态快照 + 重放去重
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 57 G57-04 初次创建
 * # ====================================
 */

import type {
  ProcessingSemantics,
  IdempotenceLevel,
  TransactionState,
  TransactionalProducerConfig,
  IdempotentConsumerConfig,
  TransactionContext,
  ExactlyOnceCheckpoint,
  TransactionalRecord,
  ProcessResult,
  ExactlyOnceOptions,
  ExactlyOnceStats,
} from './exactlyOnceTypes';

// ============================================================
// 配置校验
// ============================================================

/**
 * 校验事务性生产者配置
 */
export function validateTransactionalProducerConfig(config: TransactionalProducerConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!config.bootstrapServers || config.bootstrapServers.length === 0) {
    errors.push('bootstrapServers is required');
  }
  if (!config.transactionalId) {
    errors.push('transactionalId is required');
  }
  if (config.transactionalId && config.transactionalId.length < 1) {
    errors.push('transactionalId must not be empty');
  }
  if (config.transactionTimeoutMs < 1000) {
    errors.push('transactionTimeoutMs must be >= 1000');
  }
  if (config.transactionTimeoutMs > 900000) {
    errors.push('transactionTimeoutMs must be <= 900000 (15 min)');
  }
  if (config.enableIdempotence && config.maxInFlightRequestsPerConnection > 5) {
    errors.push('When enableIdempotence=true, maxInFlightRequestsPerConnection must be <= 5');
  }
  if (config.acks !== 'all' && config.transactionalId) {
    errors.push('Transactional producer requires acks=all');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * 校验幂等消费者配置
 */
export function validateIdempotentConsumerConfig(config: IdempotentConsumerConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!config.bootstrapServers || config.bootstrapServers.length === 0) {
    errors.push('bootstrapServers is required');
  }
  if (!config.groupId) {
    errors.push('groupId is required');
  }
  if (!config.topics || config.topics.length === 0) {
    errors.push('topics is required');
  }
  if (config.isolationLevel === 'read_uncommitted' && config.dedupStore !== 'memory') {
    // OK - read_uncommitted 不需要去重
  }
  return { valid: errors.length === 0, errors };
}

// ============================================================
// 事务上下文管理器
// ============================================================

/**
 * 事务上下文管理器
 */
export class TransactionContextManager {
  private contexts = new Map<string, TransactionContext>();
  private producerIdCounter = 1000000;

  /**
   * 初始化事务
   */
  initTransaction(transactionalId: string, transactionTimeoutMs: number): TransactionContext {
    if (this.contexts.has(transactionalId)) {
      const existing = this.contexts.get(transactionalId)!;
      if (existing.state === 'in-transaction' || existing.state === 'committing') {
        throw new Error(`Transaction ${transactionalId} is already in progress`);
      }
    }
    const ctx: TransactionContext = {
      transactionalId,
      producerId: this.producerIdCounter++,
      epoch: 0,
      startTimestamp: Date.now(),
      state: 'ready',
      bufferedRecords: 0,
      writtenPartitions: [],
    };
    this.contexts.set(transactionalId, ctx);
    return ctx;
  }

  /**
   * 开始事务
   */
  begin(transactionalId: string, timeoutMs?: number): TransactionContext {
    const ctx = this.contexts.get(transactionalId);
    if (!ctx) {
      throw new Error(`Transaction ${transactionalId} not initialized`);
    }
    if (ctx.state !== 'ready' && ctx.state !== 'abortable') {
      throw new Error(`Cannot begin transaction in state ${ctx.state}`);
    }
    ctx.state = 'in-transaction';
    ctx.startTimestamp = Date.now();
    ctx.bufferedRecords = 0;
    ctx.writtenPartitions = [];
    if (timeoutMs) {
      const handle = setTimeout(() => {
        if (ctx.state === 'in-transaction') {
          this.abort(transactionalId);
        }
      }, timeoutMs);
      // 仅在 Node 环境调用 unref
      const h = handle as unknown as { unref?: () => void };
      if (typeof h.unref === 'function') h.unref();
    }
    return ctx;
  }

  /**
   * 记录缓冲（写入）
   */
  recordWrite(transactionalId: string, topic: string, partition: number): void {
    const ctx = this.contexts.get(transactionalId);
    if (!ctx) throw new Error(`Transaction ${transactionalId} not found`);
    if (ctx.state !== 'in-transaction') {
      throw new Error(`Transaction ${transactionalId} not in transaction state`);
    }
    ctx.bufferedRecords++;
    const partitionKey = `${topic}-${partition}`;
    if (!ctx.writtenPartitions.includes(partitionKey)) {
      ctx.writtenPartitions.push(partitionKey);
    }
  }

  /**
   * 提交事务
   */
  commit(transactionalId: string): TransactionContext {
    const ctx = this.contexts.get(transactionalId);
    if (!ctx) throw new Error(`Transaction ${transactionalId} not found`);
    if (ctx.state !== 'in-transaction') {
      throw new Error(`Transaction ${transactionalId} not in transaction state`);
    }
    ctx.state = 'committing';
    // 模拟提交
    ctx.state = 'committed';
    ctx.epoch++;
    return ctx;
  }

  /**
   * 中止事务
   */
  abort(transactionalId: string): TransactionContext {
    const ctx = this.contexts.get(transactionalId);
    if (!ctx) throw new Error(`Transaction ${transactionalId} not found`);
    ctx.state = 'aborted';
    ctx.epoch++;
    return ctx;
  }

  /**
   * 获取事务上下文
   */
  get(transactionalId: string): TransactionContext | undefined {
    return this.contexts.get(transactionalId);
  }

  /**
   * 列出所有活动事务
   */
  listActive(): TransactionContext[] {
    return Array.from(this.contexts.values()).filter(
      (c) => c.state === 'in-transaction' || c.state === 'committing'
    );
  }
}

// ============================================================
// 去重存储
// ============================================================

/**
 * 去重存储接口
 */
export interface DedupStore {
  /** 检查是否已处理 */
  has(key: string): boolean | Promise<boolean>;
  /** 标记已处理 */
  mark(key: string, ttlMs?: number): void | Promise<void>;
  /** 获取存储大小 */
  size(): number;
  /** 清理过期 */
  cleanup(): void | Promise<void>;
}

/**
 * 内存去重存储
 */
export class InMemoryDedupStore implements DedupStore {
  private store = new Map<string, number>();
  private maxSize: number;

  constructor(maxSize: number = 100000) {
    this.maxSize = maxSize;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  mark(key: string, ttlMs?: number): void {
    if (this.store.size >= this.maxSize) {
      // 简单的 LRU：删除第一个
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) this.store.delete(firstKey);
    }
    this.store.set(key, Date.now() + (ttlMs ?? 0));
  }

  size(): number {
    return this.store.size;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, expiry] of this.store.entries()) {
      if (expiry > 0 && expiry < now) {
        this.store.delete(key);
      }
    }
  }
}

// =============================================================
// 幂等消费者
// =============================================================

/**
 * 幂等消费者
 */
export class IdempotentConsumer<K, V> {
  private processed = new InMemoryDedupStore();
  private lastCommittedOffsets: Record<string, number> = {};

  constructor(private config: IdempotentConsumerConfig) {}

  /**
   * 计算去重键
   */
  private computeDedupKey(record: TransactionalRecord<K, V>): string {
    switch (this.config.dedupKey) {
      case 'offset':
        return `${record.topic}-${record.partition}-${record.offset}`;
      case 'message-id':
        return record.messageId ?? `${record.topic}-${record.partition}-${record.offset}`;
      case 'checksum':
        return record.checksum ?? '';
      case 'hash':
      default:
        return `${record.topic}-${record.partition}-${record.offset}-${record.timestamp}`;
    }
  }

  /**
   * 处理记录 - 返回是否应该处理（未重复）
   */
  shouldProcess(record: TransactionalRecord<K, V>): boolean {
    if (!this.config.enableAutoCommit && this.config.dedupStore !== 'memory') {
      // 仅对内存模式做去重
    }
    const key = this.computeDedupKey(record);
    if (this.processed.has(key)) {
      return false;
    }
    this.processed.mark(key);
    return true;
  }

  /**
   * 提交偏移量
   */
  commitOffsets(offsets: Record<string, number>): void {
    this.lastCommittedOffsets = { ...offsets };
  }

  /**
   * 获取已提交偏移量
   */
  getCommittedOffsets(): Record<string, number> {
    return { ...this.lastCommittedOffsets };
  }

  /**
   * 获取去重存储大小
   */
  getDedupSize(): number {
    return this.processed.size();
  }
}

// ============================================================
// 事务性生产者
// ============================================================

/**
 * 事务性生产者
 */
export class TransactionalProducer<K, V> {
  private txManager = new TransactionContextManager();
  private recordCount = 0;
  private bytesSent = 0;

  constructor(private config: TransactionalProducerConfig) {}

  /**
   * 开始事务
   */
  begin(): TransactionContext {
    this.txManager.initTransaction(this.config.transactionalId, this.config.transactionTimeoutMs);
    return this.txManager.begin(this.config.transactionalId, this.config.transactionTimeoutMs);
  }

  /**
   * 发送记录
   */
  send(record: TransactionalRecord<K, V>): void {
    const ctx = this.txManager.get(this.config.transactionalId);
    if (!ctx) throw new Error('Transaction not started');
    if (ctx.state !== 'in-transaction') {
      throw new Error('Transaction not in progress');
    }
    this.txManager.recordWrite(this.config.transactionalId, record.topic, record.partition);
    this.recordCount++;
    this.bytesSent += JSON.stringify(record.value ?? '').length;
  }

  /**
   * 提交事务
   */
  commit(): TransactionContext {
    return this.txManager.commit(this.config.transactionalId);
  }

  /**
   * 中止事务
   */
  abort(): TransactionContext {
    return this.txManager.abort(this.config.transactionalId);
  }

  /**
   * 获取统计
   */
  getStats(): { records: number; bytes: number } {
    return { records: this.recordCount, bytes: this.bytesSent };
  }
}

// ============================================================
// Exactly-Once 处理器
// ============================================================

/**
 * Exactly-Once 处理器
 */
export class ExactlyOnceProcessor<K, V> {
  private stats: ExactlyOnceStats = {
    totalProcessed: 0,
    transactionsCommitted: 0,
    transactionsAborted: 0,
    transactionsFailed: 0,
    duplicatesDetected: 0,
    checkpointsCompleted: 0,
    checkpointsFailed: 0,
    avgLatencyMs: 0,
    p99LatencyMs: 0,
    inFlightTransactions: 0,
    dedupStoreSize: 0,
  };
  private latencies: number[] = [];
  private checkpoints: ExactlyOnceCheckpoint[] = [];
  private txManager = new TransactionContextManager();

  constructor(public readonly options: ExactlyOnceOptions) {}

  /**
   * 处理记录
   */
  async process(
    records: TransactionalRecord<K, V>[],
    processor: (record: TransactionalRecord<K, V>) => TransactionalRecord<K, V> | null
  ): Promise<ProcessResult<K, V>> {
    const start = Date.now();
    const outputs: TransactionalRecord<K, V>[] = [];
    let dedupHits = 0;

    // 创建幂等消费者
    const consumer = new IdempotentConsumer<K, V>(this.options.consumer);
    // 创建事务性生产者
    const producer = new TransactionalProducer<K, V>(this.options.producer);

    if (this.options.semantics === 'exactly-once') {
      // 严格模式：每个事务完整提交
      producer.begin();

      for (const record of records) {
        // 幂等检查
        if (this.options.enableDeduplication && !consumer.shouldProcess(record)) {
          dedupHits++;
          this.stats.duplicatesDetected++;
          continue;
        }
        try {
          const output = processor(record);
          if (output) {
            producer.send(output);
            outputs.push(output);
            this.stats.totalProcessed++;
          }
        } catch (err) {
          this.stats.transactionsFailed++;
          producer.abort();
          return {
            outputs: [],
            success: false,
            error: (err as Error).message,
            semantics: this.options.semantics,
            transactionId: this.options.producer.transactionalId,
            processingTimeMs: Date.now() - start,
            dedupHits,
            committedOffsets: {},
          };
        }
      }
      // 提交事务
      try {
        producer.commit();
        this.stats.transactionsCommitted++;
        this.stats.inFlightTransactions = 0;
      } catch (err) {
        producer.abort();
        this.stats.transactionsAborted++;
        return {
          outputs: [],
          success: false,
          error: (err as Error).message,
          semantics: this.options.semantics,
          transactionId: this.options.producer.transactionalId,
          processingTimeMs: Date.now() - start,
          dedupHits,
          committedOffsets: {},
        };
      }
    } else if (this.options.semantics === 'at-least-once') {
      // At-least-once: 处理所有，可能重复
      for (const record of records) {
        if (this.options.enableDeduplication && !consumer.shouldProcess(record)) {
          dedupHits++;
          continue;
        }
        const output = processor(record);
        if (output) {
          outputs.push(output);
          this.stats.totalProcessed++;
        }
      }
    } else {
      // At-most-once: 跳过失败
      for (const record of records) {
        try {
          const output = processor(record);
          if (output) {
            outputs.push(output);
            this.stats.totalProcessed++;
          }
        } catch {
          // skip
        }
      }
    }

    const latency = Date.now() - start;
    this.latencies.push(latency);
    this.stats.avgLatencyMs = this.computeAvg();
    this.stats.p99LatencyMs = this.computeP99();
    this.stats.dedupStoreSize = consumer.getDedupSize();

    return {
      outputs,
      success: true,
      semantics: this.options.semantics,
      transactionId: this.options.producer.transactionalId,
      processingTimeMs: latency,
      dedupHits,
      committedOffsets: consumer.getCommittedOffsets(),
    };
  }

  /**
   * 触发检查点
   */
  async checkpoint(): Promise<ExactlyOnceCheckpoint> {
    const id = `chk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const start = Date.now();
    const cp: ExactlyOnceCheckpoint = {
      id,
      transactionalId: this.options.producer.transactionalId,
      state: 'in-progress',
      createdAt: start,
      offsets: {},
    };
    this.checkpoints.push(cp);
    try {
      // 模拟检查点完成
      cp.state = 'completed';
      cp.completedAt = Date.now();
      cp.durationMs = cp.completedAt - start;
      this.stats.checkpointsCompleted++;
    } catch (err) {
      cp.state = 'failed';
      this.stats.checkpointsFailed++;
      throw err;
    }
    return cp;
  }

  /**
   * 获取统计信息
   */
  getStats(): ExactlyOnceStats {
    return { ...this.stats };
  }

  /**
   * 获取所有检查点
   */
  getCheckpoints(): ExactlyOnceCheckpoint[] {
    return [...this.checkpoints];
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalProcessed: 0,
      transactionsCommitted: 0,
      transactionsAborted: 0,
      transactionsFailed: 0,
      duplicatesDetected: 0,
      checkpointsCompleted: 0,
      checkpointsFailed: 0,
      avgLatencyMs: 0,
      p99LatencyMs: 0,
      inFlightTransactions: 0,
      dedupStoreSize: 0,
    };
    this.latencies = [];
    this.checkpoints = [];
  }

  private computeAvg(): number {
    if (this.latencies.length === 0) return 0;
    return this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
  }

  private computeP99(): number {
    if (this.latencies.length === 0) return 0;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const idx = Math.min(Math.floor(sorted.length * 0.99), sorted.length - 1);
    return sorted[idx]!;
  }
}

// ====================================
// 工厂函数
// ====================================

/**
 * 创建 Exactly-Once 处理器
 */
export function createExactlyOnceProcessor<K, V>(options: ExactlyOnceOptions): ExactlyOnceProcessor<K, V> {
  return new ExactlyOnceProcessor(options);
}

/**
 * 生成事务性 Properties 文件
 */
export function generateTransactionalProducerProperties(config: TransactionalProducerConfig): string {
  const lines: string[] = [];
  lines.push('# ====================================');
  lines.push('# Transactional Producer Properties');
  lines.push('# ====================================');
  lines.push(`bootstrap.servers=${config.bootstrapServers.join(',')}`);
  lines.push(`transactional.id=${config.transactionalId}`);
  lines.push(`transaction.timeout.ms=${config.transactionTimeoutMs}`);
  lines.push(`enable.idempotence=${config.enableIdempotence}`);
  lines.push(`acks=${config.acks}`);
  lines.push(`max.in.flight.requests.per.connection=${config.maxInFlightRequestsPerConnection}`);
  lines.push(`retries=${config.retries}`);
  if (config.compressionType) lines.push(`compression.type=${config.compressionType}`);
  if (config.deliveryTimeoutMs) lines.push(`delivery.timeout.ms=${config.deliveryTimeoutMs}`);
  return lines.join('\n');
}

/**
 * 生成幂等消费者 Properties 文件
 */
export function generateIdempotentConsumerProperties(config: IdempotentConsumerConfig): string {
  const lines: string[] = [];
  lines.push('# ====================================');
  lines.push('# Idempotent Consumer Properties');
  lines.push('# ====================================');
  lines.push(`bootstrap.servers=${config.bootstrapServers.join(',')}`);
  lines.push(`group.id=${config.groupId}`);
  lines.push(`enable.auto.commit=${config.enableAutoCommit}`);
  lines.push(`auto.commit.interval.ms=${config.autoCommitIntervalMs}`);
  lines.push(`isolation.level=${config.isolationLevel}`);
  lines.push(`auto.offset.reset=${config.autoOffsetReset}`);
  return lines.join('\n');
}

// ====================================
// 工具函数
// ====================================

/** 支持的处理语义 */
export function listSupportedSemantics(): ProcessingSemantics[] {
  return ['at-most-once', 'at-least-once', 'exactly-once'];
}

/** 支持的幂等级别 */
export function listSupportedIdempotenceLevels(): IdempotenceLevel[] {
  return ['none', 'producer', 'consumer', 'full'];
}

/** 规范化处理语义 */
export function normalizeSemantics(input: string): ProcessingSemantics {
  const v = input.trim().toLowerCase();
  if (['at-most-once', 'at-least-once', 'exactly-once'].includes(v)) {
    return v as ProcessingSemantics;
  }
  return 'at-least-once';
}
