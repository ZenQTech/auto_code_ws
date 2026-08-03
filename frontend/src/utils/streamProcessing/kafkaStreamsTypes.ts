/**
 * # ============================================================
 * # Kafka Streams - 资源类型定义 (Cycle 57 G57-01)
 * # ============================================================
 * # 核心作用：定义 Kafka Streams 核心类型
 * # 拓扑：Source → Processor → Sink
 * # 算子：Map / Filter / Reduce / Join / Window / Aggregate
 * # 状态存储：In-Memory / RocksDB
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 57 G57-01 初次创建
 * # ====================================
 */

/** Kafka Streams API 版本 */
export type KafkaStreamsVersion = '3.0' | '3.5' | '3.7';

/** 记录（流中的基本数据单元） */
export interface StreamRecord<K, V> {
  /** 键 */
  key: K;
  /** 值 */
  value: V;
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 主题 */
  topic: string;
  /** 分区 */
  partition: number;
  /** 偏移量 */
  offset: number;
  /** 头部 */
  headers?: Record<string, string>;
}

/** 流处理节点类型 */
export type NodeType =
  | 'source'      // 数据源
  | 'sink'        // 数据汇
  | 'processor'   // 处理算子
  | 'stateStore'  // 状态存储
  | 'topic';      // Kafka topic 引用

/** 拓扑节点 */
export interface TopologyNode {
  /** 节点 ID */
  id: string;
  /** 节点类型 */
  type: NodeType;
  /** 节点名称（用于调试） */
  name: string;
  /** 算子配置（仅 processor） */
  operatorConfig?: OperatorConfig;
  /** 状态存储配置（仅 stateStore） */
  stateStoreConfig?: StateStoreConfig;
  /** 源/汇配置 */
  sourceSinkConfig?: SourceSinkConfig;
}

/** 拓扑边（节点连接） */
export interface TopologyEdge {
  /** 源节点 ID */
  from: string;
  /** 目标节点 ID */
  to: string;
  /** 关系：上游/下游/分支 */
  relationship: 'forward' | 'branch' | 'merge' | 'join';
  /** 分支谓词（仅 branch） */
  predicate?: string;
}

/** 算子配置（统一） */
export interface OperatorConfig {
  /** 算子类型 */
  type: StreamOperatorType;
  /** 算子参数 */
  params?: Record<string, unknown>;
  /** 算子函数源码（用于展示/调试） */
  functionCode?: string;
  /** 关联状态存储 */
  stateStore?: string;
  /** 值映射器（DSL 算子） */
  valueMapper?: string;
  /** 键映射器（DSL 算子） */
  keyMapper?: string;
}

/** 流处理算子类型 */
export type StreamOperatorType =
  | 'map'             // 值转换
  | 'filter'          // 值过滤
  | 'flatMap'         // 一对多转换
  | 'mapValues'       // 仅转换值
  | 'selectKey'       // 重新选择键
  | 'groupByKey'      // 按键分组
  | 'aggregate'       // 聚合
  | 'reduce'          // 归约
  | 'count'           // 计数
  | 'join'            // 流连接
  | 'merge'           // 合并
  | 'branch'          // 分支
  | 'window'          // 窗口化
  | 'peek'            // 副作用
  | 'foreach'         // 遍历
  | 'toStream'        // KTable → KStream
  | 'toTable';        // KStream → KTable

/** 状态存储配置 */
export interface StateStoreConfig {
  /** 存储类型 */
  type: 'in-memory' | 'rocksdb' | 'persistent' | 'lru';
  /** 存储名称 */
  name: string;
  /** 键类型 */
  keyType: 'string' | 'long' | 'bytes' | 'json';
  /** 值类型 */
  valueType: 'string' | 'long' | 'double' | 'bytes' | 'json';
  /** 缓存大小（条目数） */
  cacheSize?: number;
  /** 分段数（用于并行） */
  numSegments?: number;
  /** 是否日志存储（changelog topic） */
  loggingEnabled?: boolean;
  /** 日志主题名称 */
  loggingTopic?: string;
  /** 压缩策略 */
  retention?: 'compact' | 'delete' | 'compact,delete';
}

/** 源/汇配置 */
export interface SourceSinkConfig {
  /** 主题名 */
  topic: string;
  /** 消费位置（仅 source） */
  offsetReset?: 'earliest' | 'latest' | 'none';
  /** 时间戳提取器（仅 source） */
  timestampExtractor?: 'create' | 'log' | 'wallclock' | 'custom';
  /** 分区分配器（仅 source） */
  partitionAssignor?: 'range' | 'roundrobin' | 'sticky' | 'cooperative-sticky';
  /** 生产者配置（仅 sink） */
  producerConfig?: ProducerConfig;
  /** 消费者配置（仅 source） */
  consumerConfig?: ConsumerConfig;
}

/** 生产者配置 */
export interface ProducerConfig {
  /** 幂等性 */
  idempotent?: boolean;
  /** 事务 ID */
  transactionalId?: string;
  /** 压缩类型 */
  compressionType?: 'none' | 'gzip' | 'snappy' | 'lz4' | 'zstd';
  /** 确认机制 */
  acks?: '0' | '1' | 'all';
  /** 最大飞行中请求数 */
  maxInFlightRequestsPerConnection?: number;
  /** 投递超时（毫秒） */
  deliveryTimeoutMs?: number;
  /** 重试次数 */
  retries?: number;
}

/** 消费者配置 */
export interface ConsumerConfig {
  /** 消费组 ID */
  groupId: string;
  /** 自动提交 */
  enableAutoCommit?: boolean;
  /** 自动提交间隔（毫秒） */
  autoCommitIntervalMs?: number;
  /** 最大轮询记录数 */
  maxPollRecords?: number;
  /** 会话超时（毫秒） */
  sessionTimeoutMs?: number;
  /** 心跳间隔（毫秒） */
  heartbeatIntervalMs?: number;
  /** 隔离级别 */
  isolationLevel?: 'read_uncommitted' | 'read_committed';
  /** 自动偏移重置 */
  autoOffsetReset?: 'earliest' | 'latest' | 'none';
}

/** 流处理拓扑 */
export interface KafkaStreamsTopology {
  /** 拓扑 ID（应用 ID） */
  applicationId: string;
  /** 客户端 ID */
  clientId?: string;
  /** 节点列表 */
  nodes: TopologyNode[];
  /** 边列表 */
  edges: TopologyEdge[];
  /** 序列化配置 */
  serdes?: {
    defaultKeySerde: string;
    defaultValueSerde: string;
  };
  /** 处理保障 */
  processingGuarantee: 'at_least_once' | 'at_most_once' | 'exactly_once';
  /** 拓扑描述（自动生成） */
  description?: string;
}

/** 流处理结果（用于输出） */
export interface StreamResult<K, V> {
  /** 输出记录 */
  records: Array<StreamRecord<K, V>>;
  /** 处理耗时（毫秒） */
  processingTimeMs: number;
  /** 窗口触发信息 */
  windowedResults?: WindowedResult<V>[];
  /** 状态存储快照 */
  stateSnapshot?: Record<string, unknown>;
}

/** 窗口化结果 */
export interface WindowedResult<V> {
  /** 窗口键 */
  windowKey: string;
  /** 窗口开始时间（毫秒） */
  windowStart: number;
  /** 窗口结束时间（毫秒） */
  windowEnd: number;
  /** 聚合值 */
  value: V;
  /** 记录数 */
  count: number;
}

/** 流处理部署配置 */
export interface KafkaStreamsDeployOptions {
  /** 应用 ID */
  applicationId: string;
  /** Bootstrap Servers */
  bootstrapServers: string[];
  /** 拓扑 */
  topology: KafkaStreamsTopology;
  /** 处理保障 */
  processingGuarantee?: 'at_least_once' | 'at_most_once' | 'exactly_once';
  /** 状态目录（用于 RocksDB 持久化） */
  stateDir?: string;
  /** 副本因子（用于 changelog topic） */
  replicationFactor?: number;
  /** 度量间隔（毫秒） */
  metricsIntervalMs?: number;
  /** 拓扑优化 */
  topologyOptimization?: 'none' | 'all' | 'on';
  /** 失败处理 */
  deserializationFailureHandler?: 'fail' | 'log' | 'continue';
  /** 生产失败处理 */
  productionExceptionHandler?: 'fail' | 'log' | 'continue';
  /** 默认键序列化器 */
  defaultKeySerde?: 'string' | 'long' | 'bytes' | 'json';
  /** 默认值序列化器 */
  defaultValueSerde?: 'string' | 'long' | 'double' | 'bytes' | 'json';
}
