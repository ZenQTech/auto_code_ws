/**
 * # ============================================================
 * # Apache Flink - 生成器 (Cycle 57 G57-02)
 * # ============================================================
 * # 核心作用：声明式构造 Flink JobGraph / Checkpointing / Watermarks
 * # 集成：FlinkKubernetesOperator / Flink REST API / Session Cluster
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 57 G57-02 初次创建
 * # ====================================
 */

import type {
  FlinkJobGraph,
  FlinkDeployOptions,
  FlinkOperator,
  FlinkEdge,
  FlinkOperatorType,
  FlinkWindowConfig,
  WatermarkConfig,
  CheckpointConfig,
  FlinkRestartConfig,
  FlinkRestResponse,
  FlinkCheckpointStatus,
  FlinkDeploymentMode,
  FlinkVersion,
  StateBackend,
  CheckpointStorage,
  RestartStrategy,
  WatermarkStrategyType,
} from './flinkTypes';

// ============================================================
// JobGraph Builder
// ============================================================

/**
 * 创建 Flink JobGraph
 */
export function createFlinkJobGraph(options: {
  jobName: string;
  flinkVersion?: FlinkVersion;
  deploymentMode?: FlinkDeploymentMode;
  defaultParallelism?: number;
  maxParallelism?: number;
  timeCharacteristic?: 'event-time' | 'processing-time' | 'ingestion-time';
}): FlinkJobGraph {
  return {
    jobId: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    jobName: options.jobName,
    flinkVersion: options.flinkVersion ?? '1.18',
    deploymentMode: options.deploymentMode ?? 'application',
    defaultParallelism: options.defaultParallelism ?? 4,
    maxParallelism: options.maxParallelism ?? 128,
    operators: [],
    edges: [],
    watermark: {
      strategy: 'periodic',
      maxOutOfOrdernessMs: 5000,
      autoWatermarkIntervalMs: 200,
      idleTimeoutMs: 60000,
    },
    checkpoint: {
      enabled: true,
      intervalMs: 60000,
      minPauseBetweenMs: 500,
      timeoutMs: 600000,
      maxConcurrent: 1,
      externalized: true,
      externalizedRetention: 'retain-on-cancellation',
      stateBackend: 'rocksdb',
      incremental: true,
      localRecovery: true,
    },
    restartStrategy: {
      strategy: 'exponential-delay',
      initialBackoffMs: 1000,
      maxBackoffMs: 60000,
      backoffMultiplier: 2.0,
      attempts: 10,
    },
    timeCharacteristic: options.timeCharacteristic ?? 'event-time',
    state: 'created',
    description: `Flink job ${options.jobName}`,
  };
}

/**
 * Flink JobGraph 流式构建器
 */
export class FlinkJobBuilder {
  private operators: FlinkOperator[] = [];
  private edges: FlinkEdge[] = [];
  private operatorIdCounter = 0;
  private lastOperatorId: string | null = null;

  constructor(private jobGraph: FlinkJobGraph) {}

  /**
   * 添加 Source
   */
  source(
    name: string,
    config?: {
      class?: string;
      params?: Record<string, unknown>;
      parallelism?: number;
    }
  ): this {
    const id = this.nextId('source');
    const op: FlinkOperator = {
      id,
      type: 'source',
      name,
      functionClass: config?.class ?? 'SourceFunction',
      params: config?.params,
      parallelism: config?.parallelism ?? this.jobGraph.defaultParallelism,
      slotSharingGroup: 'default',
      uid: `source-${id}`,
    };
    this.operators.push(op);
    this.lastOperatorId = id;
    return this;
  }

  /**
   * 添加 Sink
   */
  sink(
    name: string,
    config?: {
      class?: string;
      params?: Record<string, unknown>;
      parallelism?: number;
    }
  ): this {
    if (!this.lastOperatorId) {
      throw new Error('sink() must follow a source or operator');
    }
    const id = this.nextId('sink');
    const op: FlinkOperator = {
      id,
      type: 'sink',
      name,
      functionClass: config?.class ?? 'SinkFunction',
      params: config?.params,
      parallelism: config?.parallelism ?? this.jobGraph.defaultParallelism,
      slotSharingGroup: 'default',
      uid: `sink-${id}`,
    };
    this.operators.push(op);
    this.addEdge(this.lastOperatorId, id, 'forward');
    this.lastOperatorId = id;
    return this;
  }

  /**
   * Map 算子
   */
  map(
    name: string,
    mapFunctionClass: string,
    options?: { parallelism?: number; uid?: string }
  ): this {
    return this.addOperator('map', name, mapFunctionClass, options);
  }

  /**
   * FlatMap 算子
   */
  flatMap(
    name: string,
    flatMapFunctionClass: string,
    options?: { parallelism?: number; uid?: string }
  ): this {
    return this.addOperator('flatMap', name, flatMapFunctionClass, options);
  }

  /**
   * Filter 算子
   */
  filter(
    name: string,
    filterFunctionClass: string,
    options?: { parallelism?: number; uid?: string }
  ): this {
    return this.addOperator('filter', name, filterFunctionClass, options);
  }

  /**
   * KeyBy 算子
   */
  keyBy(
    name: string,
    keys: string | string[],
    options?: { parallelism?: number; uid?: string }
  ): this {
    return this.addOperator('keyBy', name, 'KeyBy', {
      ...options,
      params: { keys: Array.isArray(keys) ? keys : [keys] },
    });
  }

  /**
   * Window 算子
   */
  window(
    name: string,
    config: FlinkWindowConfig,
    options?: { parallelism?: number; uid?: string }
  ): this {
    return this.addOperator('window', name, 'Window', {
      ...options,
      params: { windowConfig: config },
    });
  }

  /**
   * Aggregate 算子
   */
  aggregate(
    name: string,
    aggregateFunctionClass: string,
    options?: { parallelism?: number; uid?: string }
  ): this {
    return this.addOperator('aggregate', name, aggregateFunctionClass, options);
  }

  /**
   * Reduce 算子
   */
  reduce(
    name: string,
    reduceFunctionClass: string,
    options?: { parallelism?: number; uid?: string }
  ): this {
    return this.addOperator('reduce', name, reduceFunctionClass, options);
  }

  /**
   * Process 算子
   */
  process(
    name: string,
    processFunctionClass: string,
    options?: { parallelism?: number; uid?: string }
  ): this {
    return this.addOperator('process', name, processFunctionClass, options);
  }

  /**
   * Union 算子
   */
  union(name: string, options?: { parallelism?: number }): this {
    return this.addOperator('union', name, 'Union', options);
  }

  /**
   * Join 算子
   */
  join(
    name: string,
    config: { where: string; equalTo: string; windowMs: number },
    options?: { parallelism?: number }
  ): this {
    return this.addOperator('join', name, 'Join', {
      ...options,
      params: config,
    });
  }

  /**
   * 异步 IO 算子
   */
  asyncIO(
    name: string,
    asyncFunctionClass: string,
    options?: { parallelism?: number; timeoutMs?: number; capacity?: number }
  ): this {
    return this.addOperator('asyncIO', name, asyncFunctionClass, {
      ...options,
      params: { timeoutMs: options?.timeoutMs, capacity: options?.capacity },
    });
  }

  /**
   * 广播流
   */
  broadcast(name: string, options?: { parallelism?: number }): this {
    return this.addOperator('broadcast', name, 'Broadcast', options);
  }

  /**
   * 侧输出
   */
  sideOutput(name: string, outputTag: string, options?: { parallelism?: number }): this {
    return this.addOperator('sideOutput', name, 'SideOutput', {
      ...options,
      params: { outputTag },
    });
  }

  /**
   * 添加算子
   */
  private addOperator(
    type: FlinkOperatorType,
    name: string,
    functionClass: string,
    options?: { parallelism?: number; uid?: string; params?: Record<string, unknown> }
  ): this {
    if (!this.lastOperatorId) {
      throw new Error(`${type}() must follow a source or operator`);
    }
    const id = this.nextId(type);
    const op: FlinkOperator = {
      id,
      type,
      name,
      functionClass,
      parallelism: options?.parallelism ?? this.jobGraph.defaultParallelism,
      slotSharingGroup: 'default',
      uid: options?.uid ?? `${type}-${id}`,
      params: options?.params,
    };
    this.operators.push(op);
    this.addEdge(this.lastOperatorId, id, 'forward');
    this.lastOperatorId = id;
    return this;
  }

  /**
   * 添加边
   */
  private addEdge(
    from: string,
    to: string,
    relationship: FlinkEdge['relationship'],
    extras?: { partitionKeys?: string[]; customPartitioner?: string }
  ): void {
    const edge: FlinkEdge = { from, to, relationship };
    if (extras?.partitionKeys) edge.partitionKeys = extras.partitionKeys;
    if (extras?.customPartitioner) edge.customPartitioner = extras.customPartitioner;
    this.edges.push(edge);
  }

  /**
   * 生成下一个算子 ID
   */
  private nextId(prefix: string): string {
    return `${prefix}-${++this.operatorIdCounter}`;
  }

  /**
   * 设置并行度
   */
  setParallelism(operatorId: string, parallelism: number): this {
    const op = this.operators.find((o) => o.id === operatorId);
    if (op) op.parallelism = parallelism;
    return this;
  }

  /**
   * 设置槽位共享组
   */
  setSlotSharingGroup(operatorId: string, group: string): this {
    const op = this.operators.find((o) => o.id === operatorId);
    if (op) op.slotSharingGroup = group;
    return this;
  }

  /**
   * 设置链策略
   */
  setChainStrategy(operatorId: string, strategy: 'always' | 'never' | 'head'): this {
    const op = this.operators.find((o) => o.id === operatorId);
    if (op) op.chainStrategy = strategy;
    return this;
  }

  /**
   * 设置水位线
   */
  setWatermark(config: WatermarkConfig): this {
    this.jobGraph.watermark = config;
    return this;
  }

  /**
   * 设置检查点
   */
  setCheckpoint(config: CheckpointConfig): this {
    this.jobGraph.checkpoint = config;
    return this;
  }

  /**
   * 设置重启策略
   */
  setRestartStrategy(config: FlinkRestartConfig): this {
    this.jobGraph.restartStrategy = config;
    return this;
  }

  /**
   * 构建 JobGraph
   */
  build(): FlinkJobGraph {
    return {
      ...this.jobGraph,
      operators: [...this.operators],
      edges: [...this.edges],
    };
  }
}

/**
 * 创建 Flink JobBuilder
 */
export function createFlinkJobBuilder(
  jobName: string,
  options?: {
    flinkVersion?: FlinkVersion;
    deploymentMode?: FlinkDeploymentMode;
    defaultParallelism?: number;
    maxParallelism?: number;
    timeCharacteristic?: 'event-time' | 'processing-time' | 'ingestion-time';
  }
): FlinkJobBuilder {
  const jobGraph = createFlinkJobGraph({
    jobName,
    flinkVersion: options?.flinkVersion,
    deploymentMode: options?.deploymentMode,
    defaultParallelism: options?.defaultParallelism,
    maxParallelism: options?.maxParallelism,
    timeCharacteristic: options?.timeCharacteristic,
  });
  return new FlinkJobBuilder(jobGraph);
}

// ============================================================
// 部署配置生成
// ============================================================

/**
 * 验证部署选项
 */
export function validateFlinkDeployOptions(options: FlinkDeployOptions): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!options.jobName) errors.push('jobName is required');
  if (!options.image) errors.push('image is required');
  if (options.jobManagerReplicas < 1) errors.push('jobManagerReplicas must be >= 1');
  if (options.taskManagerReplicas < 1) errors.push('taskManagerReplicas must be >= 1');
  if (options.taskSlotsPerTm < 1) errors.push('taskSlotsPerTm must be >= 1');
  if (!options.jobGraph) errors.push('jobGraph is required');
  return { valid: errors.length === 0, errors };
}

/**
 * 生成 FlinkDeployment YAML（Kubernetes Operator）
 */
export function serializeFlinkDeployment(options: FlinkDeployOptions): string {
  const lines: string[] = [];
  lines.push('apiVersion: flink.apache.org/v1beta1');
  lines.push('kind: FlinkDeployment');
  lines.push('metadata:');
  lines.push(`  name: ${options.jobName}`);
  lines.push(`  namespace: ${options.namespace ?? 'default'}`);
  if (options.labels) {
    lines.push('  labels:');
    for (const [k, v] of Object.entries(options.labels)) {
      lines.push(`    ${k}: ${v}`);
    }
  }
  lines.push('spec:');
  lines.push(`  image: ${options.image}`);
  lines.push(`  flinkVersion: ${options.jobGraph.flinkVersion}`);
  lines.push('  serviceAccount: ' + (options.serviceAccount ?? 'flink'));
  lines.push('  mode: ' + (options.jobGraph.deploymentMode === 'per-job' ? 'native' : 'kubernetes'));
  lines.push('  restartNonce: 0');
  lines.push('  upgradeMode: stateless');
  lines.push('  jobManager:');
  lines.push('  resource:');
  lines.push(`    cpu: ${options.jobManagerResources.cpu}`);
  lines.push(`    memory: ${options.jobManagerResources.memoryMb}m`);
  lines.push('  taskManager:');
  lines.push(`    resource:`);
  lines.push(`      cpu: ${options.taskManagerResources.cpu}`);
  lines.push(`      memory: ${options.taskManagerResources.memoryMb}m`);
  lines.push(`  job: |`);
  for (const op of options.jobGraph.operators) {
    lines.push(`    [${op.id}] ${op.type}: ${op.name} (parallelism=${op.parallelism}, uid=${op.uid})`);
  }
  return lines.join('\n');
}

/**
 * 生成 Flink JobManager 配置
 */
export function generateFlinkConfig(options: FlinkDeployOptions): string {
  const lines: string[] = [];
  lines.push('# ====================================');
  lines.push(`# Flink Configuration - ${options.jobName}`);
  lines.push('# ====================================');
  lines.push('');

  // 基础
  lines.push(`jobmanager.memory.process.size: ${options.jobManagerResources.memoryMb}m`);
  lines.push(`taskmanager.memory.process.size: ${options.taskManagerResources.memoryMb}m`);
  lines.push(`taskmanager.numberOfTaskSlots: ${options.taskSlotsPerTm}`);
  lines.push(`parallelism.default: ${options.jobGraph.defaultParallelism}`);
  lines.push('');

  // 检查点
  if (options.jobGraph.checkpoint.enabled) {
    lines.push('execution.checkpointing.enabled: true');
    lines.push(`execution.checkpointing.interval: ${options.jobGraph.checkpoint.intervalMs}ms`);
    lines.push(`execution.checkpointing.min-pause: ${options.jobGraph.checkpoint.minPauseBetweenMs}ms`);
    lines.push(`execution.checkpointing.timeout: ${options.jobGraph.checkpoint.timeoutMs}ms`);
    lines.push(`execution.checkpointing.max-concurrent-checkpoints: ${options.jobGraph.checkpoint.maxConcurrent}`);
    if (options.jobGraph.checkpoint.externalized) {
      lines.push('execution.checkpointing.externalized-checkpoint-retention: ' + options.jobGraph.checkpoint.externalizedRetention);
    }
    if (options.jobGraph.checkpoint.tolerableCheckpointFailureNumber !== undefined) {
      lines.push(`execution.checkpointing.tolerable-failed-checkpoints: ${options.jobGraph.checkpoint.tolerableCheckpointFailureNumber}`);
    }
    if (options.jobGraph.checkpoint.alignmentTimeoutMs !== undefined) {
      lines.push(`execution.checkpointing.alignment-timeout: ${options.jobGraph.checkpoint.alignmentTimeoutMs}ms`);
    }
    lines.push('');
    lines.push(`state.backend: ${options.jobGraph.checkpoint.stateBackend}`);
    if (options.jobGraph.checkpoint.incremental) {
      lines.push('state.backend.incremental: true');
    }
    if (options.jobGraph.checkpoint.stateBackendStorage) {
      lines.push('state.checkpoints.dir: ' + options.jobGraph.checkpoint.stateBackendStorage.uri);
    }
    lines.push('');
  }

  // 重启策略
  switch (options.jobGraph.restartStrategy.strategy) {
    case 'fixed-delay':
      lines.push('restart-strategy: fixed-delay');
      lines.push(`restart-strategy.fixed-delay.attempts: ${options.jobGraph.restartStrategy.attempts ?? 3}`);
      lines.push(`restart-strategy.fixed-delay.delay: ${options.jobGraph.restartStrategy.delayMs ?? 10000}ms`);
      break;
    case 'exponential-delay':
      lines.push('restart-strategy: exponential-delay');
      lines.push(`restart-strategy.exponential-delay.initial-backoff: ${options.jobGraph.restartStrategy.initialBackoffMs ?? 1000}ms`);
      lines.push(`restart-strategy.exponential-delay.max-backoff: ${options.jobGraph.restartStrategy.maxBackoffMs ?? 60000}ms`);
      lines.push(`restart-strategy.exponential-delay.backoff-multiplier: ${options.jobGraph.restartStrategy.backoffMultiplier ?? 2.0}`);
      lines.push(`restart-strategy.exponential-delay.reset-backoff-threshold: 2min`);
      lines.push(`restart-strategy.exponential-delay.jitter-factor: 0.1`);
      break;
    case 'failure-rate':
      lines.push('restart-strategy: failure-rate');
      lines.push(`restart-strategy.failure-rate.max-failures-per-interval: ${options.jobGraph.restartStrategy.maxFailuresPerInterval ?? 5}`);
      lines.push(`restart-strategy.failure-rate.failure-rate-interval: ${options.jobGraph.restartStrategy.failureRateIntervalMs ?? 60000}ms`);
      lines.push(`restart-strategy.failure-rate.delay: ${options.jobGraph.restartStrategy.delayMs ?? 10000}ms`);
      break;
    case 'none':
      lines.push('restart-strategy: none');
      break;
  }
  lines.push('');

  // 时间特征
  if (options.jobGraph.timeCharacteristic) {
    lines.push(`pipeline.time-characteristic: ${options.jobGraph.timeCharacteristic === 'event-time' ? 'event-time' : options.jobGraph.timeCharacteristic}`);
  }

  return lines.join('\n');
}

// ============================================================
// Flink REST API 客户端（Mock）
// ============================================================

/**
 * 提交 Flink Job（Mock 实现 - 真实环境调用 Flink REST API）
 * @param restUrl Flink REST API URL
 * @param jobGraph JobGraph
 * @returns 提交结果
 */
export async function submitFlinkJob(
  restUrl: string,
  jobGraph: FlinkJobGraph
): Promise<FlinkRestResponse<{ jobId: string; status: string }>> {
  if (!restUrl) {
    return { success: false, status: 400, error: 'restUrl is required' };
  }
  if (!jobGraph) {
    return { success: false, status: 400, error: 'jobGraph is required' };
  }
  // Mock 成功响应
  return {
    success: true,
    status: 200,
    data: { jobId: jobGraph.jobId, status: 'RUNNING' },
    jobId: jobGraph.jobId,
  };
}

/**
 * 获取 Flink Job 状态
 */
export async function getFlinkJobStatus(
  restUrl: string,
  jobId: string
): Promise<FlinkRestResponse<{ state: string; duration: number; startTime: number }>> {
  if (!restUrl || !jobId) {
    return { success: false, status: 400, error: 'restUrl and jobId are required' };
  }
  return {
    success: true,
    status: 200,
    data: { state: 'RUNNING', duration: 60000, startTime: Date.now() - 60000 },
  };
}

/**
 * 列出所有检查点
 */
export async function listFlinkCheckpoints(
  restUrl: string,
  jobId: string
): Promise<FlinkRestResponse<FlinkCheckpointStatus[]>> {
  if (!restUrl || !jobId) {
    return { success: false, status: 400, error: 'restUrl and jobId are required' };
  }
  const now = Date.now();
  const checkpoints: FlinkCheckpointStatus[] = [
    { id: 3, status: 'completed', timestamp: now - 60000, duration: 120, stateSize: 1048576, externalPath: 's3://checkpoints/job-1/chk-3' },
    { id: 4, status: 'completed', timestamp: now, duration: 100, stateSize: 1100000, externalPath: 's3://checkpoints/job-1/chk-4' },
  ];
  return { success: true, status: 200, data: checkpoints };
}

/**
 * 取消 Flink Job
 */
export async function cancelFlinkJob(restUrl: string, jobId: string): Promise<FlinkRestResponse> {
  if (!restUrl || !jobId) {
    return { success: false, status: 400, error: 'restUrl and jobId are required' };
  }
  return { success: true, status: 200, data: { cancelled: true } };
}

// ============================================================
// 工具函数
// ============================================================

/** 支持的 Flink 版本列表 */
export function listSupportedFlinkVersions(): FlinkVersion[] {
  return ['1.15', '1.17', '1.18', '1.19', '1.20'];
}

/** 支持的状态后端 */
export function listSupportedStateBackends(): StateBackend[] {
  return ['hashmap', 'rocksdb', 'filesystem', 'memory'];
}

/** 支持的检查点存储 */
export function listSupportedCheckpointStorages(): CheckpointStorage[] {
  return ['filesystem', 'rocksdb', 's3', 'gcs', 'azure', 'oss', 'cos', 'hdfs'];
}

/** 支持的重启策略 */
export function listSupportedRestartStrategies(): RestartStrategy[] {
  return ['fixed-delay', 'exponential-delay', 'failure-rate', 'none'];
}

/** 支持的水位线策略 */
export function listSupportedWatermarkStrategies(): WatermarkStrategyType[] {
  return ['monotonous', 'periodic', 'punctuated', 'forBoundedOutOfOrderness', 'noWatermarks'];
}

/** 规范化 Flink 版本 */
export function normalizeFlinkVersion(input: string): FlinkVersion {
  const v = input.trim();
  if (['1.15', '1.17', '1.18', '1.19', '1.20'].includes(v)) {
    return v as FlinkVersion;
  }
  return '1.18';
}
