/**
 * # ============================================================
 * # Apache Flink - 资源类型定义 (Cycle 57 G57-02)
 * # ============================================================
 * # 核心作用：定义 Apache Flink 核心类型
 * # 组件：JobGraph / Checkpointing / Watermarks / State Backends
 * # 集成：Flink REST API / FlinkKubernetesOperator / Session Cluster
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 57 G57-02 初次创建
 * # ====================================
 */

/** Flink 版本 */
export type FlinkVersion = '1.15' | '1.17' | '1.18' | '1.19' | '1.20';

/** Flink 部署模式 */
export type FlinkDeploymentMode = 'session' | 'application' | 'per-job';

/** Flink 算子类型 */
export type FlinkOperatorType =
  | 'source'        // 数据源
  | 'sink'          // 数据汇
  | 'map'           // 单值转换
  | 'flatMap'       // 一对多转换
  | 'filter'        // 过滤
  | 'keyBy'         // 按键分区
  | 'window'        // 窗口化
  | 'aggregate'     // 聚合
  | 'reduce'        // 归约
  | 'process'       // 通用处理
  | 'union'         // 联合
  | 'join'          // 连接
  | 'coGroup'       // 协同分组
  | 'iterate'       // 迭代
  | 'asyncIO'       // 异步 IO
  | 'broadcast'     // 广播
  | 'partition'     // 自定义分区
  | 'sideOutput';   // 侧输出

/** 水位线策略 */
export type WatermarkStrategyType =
  | 'monotonous'                  // 单调递增
  | 'periodic'                    // 周期性
  | 'punctuated'                  // 打点式
  | 'forBoundedOutOfOrderness'    // 有界乱序
  | 'noWatermarks';               // 无水位线

/** 窗口类型 */
export type FlinkWindowType =
  | 'tumbling'        // 滚动窗口
  | 'sliding'         // 滑动窗口
  | 'session'         // 会话窗口
  | 'global'          // 全局窗口
  | 'count'           // 计数窗口
  | 'processingTime'; // 处理时间窗口

/** 状态后端 */
export type StateBackend = 'hashmap' | 'rocksdb' | 'filesystem' | 'memory';

/** 检查点存储 */
export type CheckpointStorage =
  | 'filesystem'        // 文件系统
  | 'rocksdb'           // RocksDB
  | 's3'                // Amazon S3
  | 'gcs'               // Google Cloud Storage
  | 'azure'             // Azure Blob
  | 'oss'               // 阿里云 OSS
  | 'cos'               // 腾讯云 COS
  | 'hdfs';             // HDFS

/** 重启策略 */
export type RestartStrategy =
  | 'fixed-delay'       // 固定延迟
  | 'exponential-delay' // 指数延迟
  | 'failure-rate'      // 失败率
  | 'none';             // 不重启

/** Flink 算子配置 */
export interface FlinkOperator {
  /** 算子 ID */
  id: string;
  /** 算子类型 */
  type: FlinkOperatorType;
  /** 算子名称 */
  name: string;
  /** 算子函数（类名/函数引用） */
  functionClass?: string;
  /** 算子参数 */
  params?: Record<string, unknown>;
  /** 关联的槽位共享组 */
  slotSharingGroup?: string;
  /** 并行度 */
  parallelism?: number;
  /** 链式（chained）算子 */
  chainStrategy?: 'always' | 'never' | 'head';
  /** UID（用于状态恢复） */
  uid?: string;
}

/** 算子之间的边 */
export interface FlinkEdge {
  /** 源算子 */
  from: string;
  /** 目标算子 */
  to: string;
  /** 关系 */
  relationship: 'forward' | 'broadcast' | 'rebalance' | 'hash' | 'global' | 'custom';
  /** 分区键（仅 hash） */
  partitionKeys?: string[];
  /** 自定义分区器（仅 custom） */
  customPartitioner?: string;
}

/** 水位线配置 */
export interface WatermarkConfig {
  /** 水位线策略 */
  strategy: WatermarkStrategyType;
  /** 最大乱序时间（毫秒） */
  maxOutOfOrdernessMs?: number;
  /** 周期性发射间隔（毫秒） */
  autoWatermarkIntervalMs?: number;
  /** 水位线提取器（类名） */
  watermarkGeneratorClass?: string;
  /** 空闲超时（毫秒） */
  idleTimeoutMs?: number;
}

/** 窗口配置 */
export interface FlinkWindowConfig {
  /** 窗口类型 */
  type: FlinkWindowType;
  /** 窗口大小（毫秒，仅时间窗口） */
  sizeMs?: number;
  /** 滑动步长（毫秒，仅 sliding） */
  slideMs?: number;
  /** 会话间隔（毫秒，仅 session） */
  gapMs?: number;
  /** 计数窗口大小（仅 count） */
  count?: number;
  /** 触发器类名 */
  triggerClass?: string;
  /** 驱逐器类名 */
  evictorClass?: string;
  /** 允许延迟（毫秒） */
  allowedLatenessMs?: number;
  /** 侧输出标签（用于迟到事件） */
  sideOutputLateData?: string;
}

/** 检查点配置 */
export interface CheckpointConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 检查点间隔（毫秒） */
  intervalMs: number;
  /** 最小暂停间隔（毫秒） */
  minPauseBetweenMs: number;
  /** 超时时间（毫秒） */
  timeoutMs: number;
  /** 最大并发检查点数 */
  maxConcurrent: number;
  /** 是否强制 */
  externalized?: boolean;
  /** 外部化删除策略 */
  externalizedRetention?: 'delete-on-cancellation' | 'retain-on-cancellation';
  /** 状态后端 */
  stateBackend: StateBackend;
  /** 状态后端存储 */
  stateBackendStorage?: {
    type: CheckpointStorage;
    /** 存储 URI */
    uri: string;
    /** 访问凭证（Secret Key 引用） */
    credentials?: {
      accessKeyRef: string;
      secretKeyRef: string;
    };
  };
  /** 是否增量检查点（仅 RocksDB） */
  incremental?: boolean;
  /** 本地恢复 */
  localRecovery?: boolean;
  /** 对齐超时（毫秒） */
  alignmentTimeoutMs?: number;
  /** 容忍失败检查点数 */
  tolerableCheckpointFailureNumber?: number;
}

/** 重启策略配置 */
export interface FlinkRestartConfig {
  /** 策略 */
  strategy: RestartStrategy;
  /** 固定延迟重启次数 */
  attempts?: number;
  /** 固定延迟间隔（毫秒） */
  delayMs?: number;
  /** 指数延迟初始间隔（毫秒） */
  initialBackoffMs?: number;
  /** 指数延迟最大间隔（毫秒） */
  maxBackoffMs?: number;
  /** 指数延迟倍数 */
  backoffMultiplier?: number;
  /** 失败率（每时间窗口） */
  failureRateIntervalMs?: number;
  /** 失败率阈值 */
  maxFailuresPerInterval?: number;
}

/** Flink JobGraph */
export interface FlinkJobGraph {
  /** Job ID */
  jobId: string;
  /** Job 名称 */
  jobName: string;
  /** Flink 版本 */
  flinkVersion: FlinkVersion;
  /** 部署模式 */
  deploymentMode: FlinkDeploymentMode;
  /** 默认并行度 */
  defaultParallelism: number;
  /** 最大并行度 */
  maxParallelism: number;
  /** 算子列表 */
  operators: FlinkOperator[];
  /** 边列表 */
  edges: FlinkEdge[];
  /** 水位线配置 */
  watermark: WatermarkConfig;
  /** 检查点配置 */
  checkpoint: CheckpointConfig;
  /** 重启策略 */
  restartStrategy: FlinkRestartConfig;
  /** 时间特征 */
  timeCharacteristic: 'event-time' | 'processing-time' | 'ingestion-time';
  /** Job 状态（运行时填充） */
  state?: 'created' | 'running' | 'finished' | 'failed' | 'cancelled' | 'suspended';
  /** 任务描述 */
  description?: string;
}

/** Flink 部署选项 */
export interface FlinkDeployOptions {
  /** Job 名称 */
  jobName: string;
  /** Flink 版本 */
  flinkVersion?: FlinkVersion;
  /** 镜像 */
  image: string;
  /** JobManager 副本数 */
  jobManagerReplicas: number;
  /** TaskManager 副本数 */
  taskManagerReplicas: number;
  /** 每个 TM 的 Task Slot */
  taskSlotsPerTm: number;
  /** TM 资源 */
  taskManagerResources: {
    cpu: number;
    memoryMb: number;
  };
  /** JM 资源 */
  jobManagerResources: {
    cpu: number;
    memoryMb: number;
  };
  /** JobGraph */
  jobGraph: FlinkJobGraph;
  /** 命名空间 */
  namespace?: string;
  /** 标签 */
  labels?: Record<string, string>;
  /** Service Account */
  serviceAccount?: string;
}

/** Flink REST API 操作结果 */
export interface FlinkRestResponse<T = unknown> {
  /** 是否成功 */
  success: boolean;
  /** 状态码 */
  status: number;
  /** 响应数据 */
  data?: T;
  /** 错误信息 */
  error?: string;
  /** 任务 ID */
  jobId?: string;
}

/** 检查点状态 */
export interface FlinkCheckpointStatus {
  /** 状态 */
  status: 'in-progress' | 'completed' | 'failed';
  /** 检查点 ID */
  id: number;
  /** 时间戳 */
  timestamp: number;
  /** 持续时间（毫秒） */
  duration: number;
  /** 状态大小（字节） */
  stateSize?: number;
  /** 路径 */
  externalPath?: string;
}
