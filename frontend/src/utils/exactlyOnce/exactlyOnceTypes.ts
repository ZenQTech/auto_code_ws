/**
 * # ============================================================
 * # Exactly-Once Semantics - 类型定义 (Cycle 57 G57-04)
 * # ============================================================
 * # 核心作用：Exactly-Once 语义核心类型
 * # 特性：事务性生产者 + 幂等消费者 + 状态快照 + 重放去重
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 57 G57-04 初次创建
 * # ====================================
 */

/** 处理语义 */
export type ProcessingSemantics = 'at-most-once' | 'at-least-once' | 'exactly-once';

/** 事务状态 */
export type TransactionState =
  | 'uninitialized'   // 未初始化
  | 'ready'           // 就绪
  | 'in-transaction'  // 事务中
  | 'committing'      // 提交中
  | 'committed'       // 已提交
  | 'abortable'       // 可中止
  | 'aborted'         // 已中止
  | 'fatal';          // 致命错误

/** 幂等级别 */
export type IdempotenceLevel = 'none' | 'producer' | 'consumer' | 'full';

/** 检查点状态 */
export type CheckpointState = 'pending' | 'in-progress' | 'completed' | 'failed' | 'expired';

/** 事务性生产者配置 */
export interface TransactionalProducerConfig {
  /** Bootstrap Servers */
  bootstrapServers: string[];
  /** 事务 ID（必须唯一） */
  transactionalId: string;
  /** 事务超时（毫秒） */
  transactionTimeoutMs: number;
  /** 是否启用幂等性 */
  enableIdempotence: boolean;
  /** 确认机制 */
  acks: '0' | '1' | 'all';
  /** 最大飞行中请求数（idempotent 时必须 <=5） */
  maxInFlightRequestsPerConnection: number;
  /** 重试次数 */
  retries: number;
  /** 压缩类型 */
  compressionType?: 'none' | 'gzip' | 'snappy' | 'lz4' | 'zstd';
  /** 投递超时（毫秒） */
  deliveryTimeoutMs?: number;
  /** 事务开始超时（毫秒） */
  beginTimeoutMs?: number;
}

/** 幂等消费者配置 */
export interface IdempotentConsumerConfig {
  /** Bootstrap Servers */
  bootstrapServers: string[];
  /** 消费组 ID */
  groupId: string;
  /** 消费主题 */
  topics: string[];
  /** 隔离级别 */
  isolationLevel: 'read_uncommitted' | 'read_committed';
  /** 启用自动提交 */
  enableAutoCommit: boolean;
  /** 自动提交间隔（毫秒） */
  autoCommitIntervalMs: number;
  /** 去重存储（已处理的 offset） */
  dedupStore: 'memory' | 'rocksdb' | 'redis' | 'kafka';
  /** 去重键 */
  dedupKey: 'offset' | 'message-id' | 'checksum' | 'hash';
  /** 偏移重置策略 */
  autoOffsetReset: 'earliest' | 'latest' | 'none';
}

/** 事务上下文 */
export interface TransactionContext {
  /** 事务 ID */
  transactionalId: string;
  /** 生产者 ID（PID） */
  producerId: number;
  /** 事务 epoch */
  epoch: number;
  /** 事务开始时间戳（毫秒） */
  startTimestamp: number;
  /** 状态 */
  state: TransactionState;
  /** 已缓冲的记录数 */
  bufferedRecords: number;
  /** 关联的检查点 ID */
  checkpointId?: string;
  /** 主题-分区 集合（已写入的） */
  writtenPartitions: string[];
}

/** 检查点 */
export interface ExactlyOnceCheckpoint {
  /** 检查点 ID */
  id: string;
  /** 关联的事务 ID */
  transactionalId: string;
  /** 状态 */
  state: CheckpointState;
  /** 创建时间戳 */
  createdAt: number;
  /** 完成时间戳 */
  completedAt?: number;
  /** 偏移量快照 */
  offsets: Record<string, number>;
  /** 状态大小（字节） */
  stateSize?: number;
  /** 持续时间（毫秒） */
  durationMs?: number;
}

/** 处理记录（带事务上下文） */
export interface TransactionalRecord<K, V> {
  /** 键 */
  key: K;
  /** 值 */
  value: V;
  /** 主题 */
  topic: string;
  /** 分区 */
  partition: number;
  /** 偏移量 */
  offset: number;
  /** 时间戳 */
  timestamp: number;
  /** 消息 ID（用于去重） */
  messageId?: string;
  /** 消息校验和（用于去重） */
  checksum?: string;
  /** 关联的事务 ID */
  transactionId?: string;
  /** 头部 */
  headers?: Record<string, string>;
}

/** 处理结果 */
export interface ProcessResult<K, V> {
  /** 输出记录 */
  outputs: TransactionalRecord<K, V>[];
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 处理语义 */
  semantics: ProcessingSemantics;
  /** 事务 ID */
  transactionId: string;
  /** 处理延迟（毫秒） */
  processingTimeMs: number;
  /** 去重命中数 */
  dedupHits: number;
  /** 提交偏移量 */
  committedOffsets: Record<string, number>;
}

/** Exactly-Once 处理选项 */
export interface ExactlyOnceOptions {
  /** 处理语义 */
  semantics: ProcessingSemantics;
  /** 幂等级别 */
  idempotenceLevel: IdempotenceLevel;
  /** 生产者配置 */
  producer: TransactionalProducerConfig;
  /** 消费者配置 */
  consumer: IdempotentConsumerConfig;
  /** 检查点间隔（毫秒） */
  checkpointIntervalMs: number;
  /** 检查点超时（毫秒） */
  checkpointTimeoutMs: number;
  /** 最大飞行中检查点数 */
  maxInFlightCheckpoints: number;
  /** 是否启用去重 */
  enableDeduplication: boolean;
  /** 是否启用状态快照 */
  enableStateSnapshot: boolean;
  /** 失败处理策略 */
  failureStrategy: 'retry' | 'fail-fast' | 'rebalance' | 'skip';
  /** 重试次数 */
  maxRetries: number;
}

/** Exactly-Once 统计 */
export interface ExactlyOnceStats {
  /** 处理记录总数 */
  totalProcessed: number;
  /** 已提交事务数 */
  transactionsCommitted: number;
  /** 已中止事务数 */
  transactionsAborted: number;
  /** 失败事务数 */
  transactionsFailed: number;
  /** 重复记录数 */
  duplicatesDetected: number;
  /** 检查点数 */
  checkpointsCompleted: number;
  /** 失败检查点数 */
  checkpointsFailed: number;
  /** 平均处理延迟 */
  avgLatencyMs: number;
  /** P99 处理延迟 */
  p99LatencyMs: number;
  /** 当前飞行中事务数 */
  inFlightTransactions: number;
  /** 去重存储大小 */
  dedupStoreSize: number;
}
