/**
 * # ============================================================
 * # McpStreamProcessingPanel - MCP × 实时数据流处理集成面板 (Cycle 57 G57-INTEGRATION)
 * # ============================================================
 * # 核心作用：5-Tab UI 集成 Kafka Streams + Apache Flink + 窗口聚合 + Exactly-Once
 * # Tab 结构：Kafka Streams | Apache Flink | 窗口聚合 | Exactly-Once | 集成文档
 * # 集成范围：Cycle 56 Serverless 底座 + Cycle 55 K8s 编排 + Cycle 54 可观测性
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 57 G57-INTEGRATION 初次创建
 * # ====================================
 */

import { useState, useMemo, useEffect } from 'react';
import {
  createKafkaStreamsTopology,
  createKafkaStreamsDeployOptions,
  generateKafkaStreamsProperties,
  serializeKafkaStreamsTopology,
} from '../utils/streamProcessing/kafkaStreamsGenerator';
import type {
  KafkaStreamsDeployOptions,
  KafkaStreamsTopology,
  StateStoreConfig,
} from '../utils/streamProcessing/kafkaStreamsTypes';
import {
  createFlinkJobBuilder,
  validateFlinkDeployOptions,
  serializeFlinkDeployment,
  generateFlinkConfig,
  listSupportedFlinkVersions,
  listSupportedStateBackends,
  listSupportedCheckpointStorages,
} from '../utils/flink/flinkGenerator';
import type {
  FlinkDeployOptions,
  FlinkWindowConfig,
  FlinkVersion,
  StateBackend,
  CheckpointStorage,
} from '../utils/flink/flinkTypes';
import {
  createWindowAggregator,
  countAggregator,
  sumAggregator,
  avgAggregator,
  minAggregator,
  maxAggregator,
  tumblingWindowKey,
  slidingWindowKeys,
  sessionWindowKey,
  listSupportedWindowTypes,
  listSupportedAggregationTypes,
} from '../utils/windowing/windowingEngine';
import type {
  WindowedEvent,
  WatermarkEvent,
  WindowResult,
  WindowConfig,
} from '../utils/windowing/windowingTypes';
import {
  createExactlyOnceProcessor,
  validateTransactionalProducerConfig,
  validateIdempotentConsumerConfig,
  generateTransactionalProducerProperties,
  generateIdempotentConsumerProperties,
  listSupportedSemantics,
} from '../utils/exactlyOnce/exactlyOnceEngine';
import type {
  ProcessingSemantics,
  TransactionalProducerConfig,
  IdempotentConsumerConfig,
  TransactionalRecord,
  ExactlyOnceOptions,
} from '../utils/exactlyOnce/exactlyOnceTypes';

/**
 * 组件 Props
 */
interface McpStreamProcessingPanelProps {
  /** 关闭回调 */
  onClose: () => void;
}

/** Tab 标识 */
type TabKey = 'kafka' | 'flink' | 'windowing' | 'exactly-once' | 'docs';

// ============================================================
// 默认配置常量
// ============================================================

/** Kafka Streams 默认部署配置 */
const DEFAULT_KAFKA_STREAMS_OPTIONS: KafkaStreamsDeployOptions = {
  applicationId: 'order-processor',
  bootstrapServers: ['kafka.kafka.svc.cluster.local:9092'],
  topology: createKafkaStreamsTopology('order-processor', 'exactly_once')
    .source('orders', {
      consumerConfig: {
        groupId: 'order-processor',
        enableAutoCommit: false,
        isolationLevel: 'read_committed',
        autoOffsetReset: 'earliest',
      },
    })
    .filter('value > 0')
    .groupByKey('user-sessions')
    .count('user-counts')
    .sink('order-counts', {
      producerConfig: {
        acks: 'all',
        compressionType: 'snappy',
        idempotent: true,
      },
    })
    .build(),
  stateDir: '/tmp/kafka-streams/order-processor',
  replicationFactor: 3,
  metricsIntervalMs: 30000,
  defaultKeySerde: 'string',
  defaultValueSerde: 'json',
};

/** Flink 默认部署配置 */
const DEFAULT_FLINK_DEPLOY: FlinkDeployOptions = {
  jobName: 'realtime-aggregator',
  image: 'flink:1.18',
  jobManagerReplicas: 1,
  taskManagerReplicas: 2,
  taskSlotsPerTm: 4,
  taskManagerResources: { cpu: 2, memoryMb: 4096 },
  jobManagerResources: { cpu: 1, memoryMb: 1024 },
  jobGraph: createFlinkJobBuilder('realtime-aggregator', {
    flinkVersion: '1.18',
    deploymentMode: 'application',
    defaultParallelism: 4,
    timeCharacteristic: 'event-time',
  })
    .source('kafka-source', { class: 'KafkaSource' })
    .keyBy('keyBy-user', 'userId')
    .window('tumbling-1m', {
      type: 'tumbling',
      sizeMs: 60000,
      allowedLatenessMs: 5000,
    } as FlinkWindowConfig)
    .aggregate('count', 'CountAggregate')
    .sink('kafka-sink', { class: 'KafkaSink' })
    .setWatermark({
      strategy: 'forBoundedOutOfOrderness',
      maxOutOfOrdernessMs: 5000,
      autoWatermarkIntervalMs: 200,
    })
    .setCheckpoint({
      enabled: true,
      intervalMs: 60000,
      minPauseBetweenMs: 500,
      timeoutMs: 600000,
      maxConcurrent: 1,
      stateBackend: 'rocksdb',
      incremental: true,
      externalized: true,
      externalizedRetention: 'retain-on-cancellation',
    })
    .setRestartStrategy({
      strategy: 'exponential-delay',
      initialBackoffMs: 1000,
      maxBackoffMs: 60000,
      backoffMultiplier: 2.0,
    })
    .build(),
};

/** Exactly-Once 默认配置 */
const DEFAULT_TRANSACTIONAL_PRODUCER: TransactionalProducerConfig = {
  bootstrapServers: ['kafka.kafka.svc.cluster.local:9092'],
  transactionalId: 'mcp-stream-tx-1',
  transactionTimeoutMs: 60000,
  enableIdempotence: true,
  acks: 'all',
  maxInFlightRequestsPerConnection: 5,
  retries: 10,
  compressionType: 'snappy',
};

const DEFAULT_IDEMPOTENT_CONSUMER: IdempotentConsumerConfig = {
  bootstrapServers: ['kafka.kafka.svc.cluster.local:9092'],
  groupId: 'mcp-stream-consumer',
  topics: ['input-topic'],
  isolationLevel: 'read_committed',
  enableAutoCommit: false,
  autoCommitIntervalMs: 5000,
  dedupStore: 'memory',
  dedupKey: 'offset',
  autoOffsetReset: 'earliest',
};

// ============================================================
// 主组件
// ============================================================

export default function McpStreamProcessingPanel({ onClose }: McpStreamProcessingPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('kafka');
  const [kafkaOptions, setKafkaOptions] = useState<KafkaStreamsDeployOptions>(DEFAULT_KAFKA_STREAMS_OPTIONS);
  const [flinkOptions, setFlinkOptions] = useState<FlinkDeployOptions>(DEFAULT_FLINK_DEPLOY);
  const [flinkVersion, setFlinkVersion] = useState<FlinkVersion>('1.18');
  const [stateBackend, setStateBackend] = useState<StateBackend>('rocksdb');
  const [checkpointStorage, setCheckpointStorage] = useState<CheckpointStorage>('s3');
  const [windowConfig, setWindowConfig] = useState<WindowConfig>({
    type: 'tumbling',
    sizeMs: 60000,
    slideMs: 30000,
    gapMs: 10000,
    allowedLatenessMs: 5000,
    lateDataOutputTag: 'late-data',
  });
  const [aggregationType, setAggregationType] = useState<string>('count');
  const [semantics, setSemantics] = useState<ProcessingSemantics>('exactly-once');

  // Kafka Streams 输出
  const kafkaProps = useMemo(() => {
    try {
      const opts = createKafkaStreamsDeployOptions(kafkaOptions);
      return generateKafkaStreamsProperties(opts, kafkaOptions.topology);
    } catch (e) {
      return `// 错误: ${(e as Error).message}`;
    }
  }, [kafkaOptions]);

  const kafkaYaml = useMemo(() => {
    try {
      return serializeKafkaStreamsTopology(kafkaOptions.topology);
    } catch (e) {
      return `// 错误: ${(e as Error).message}`;
    }
  }, [kafkaOptions.topology]);

  // Flink 输出
  const flinkDeploymentYaml = useMemo(() => {
    try {
      return serializeFlinkDeployment(flinkOptions);
    } catch (e) {
      return `// 错误: ${(e as Error).message}`;
    }
  }, [flinkOptions]);

  const flinkConfig = useMemo(() => {
    try {
      return generateFlinkConfig(flinkOptions);
    } catch (e) {
      return `// 错误: ${(e as Error).message}`;
    }
  }, [flinkOptions]);

  const flinkValidation = useMemo(
    () => validateFlinkDeployOptions(flinkOptions),
    [flinkOptions]
  );

  // 窗口聚合模拟
  const windowingDemo = useMemo(() => {
    try {
      const baseTime = Date.now();
      const events: WindowedEvent<string, number>[] = [];
      for (let i = 0; i < 10; i++) {
        events.push({
          key: i % 2 === 0 ? 'even' : 'odd',
          value: i + 1,
          eventTime: baseTime + i * 5000,
          ingestionTime: baseTime + i * 5000,
        });
      }

      let aggregator;
      switch (aggregationType) {
        case 'count':
          aggregator = countAggregator<number>();
          break;
        case 'sum':
          aggregator = sumAggregator<number>();
          break;
        case 'avg':
          aggregator = avgAggregator<number>();
          break;
        case 'min':
          aggregator = minAggregator<number>();
          break;
        case 'max':
          aggregator = maxAggregator<number>();
          break;
        default:
          aggregator = countAggregator<number>();
      }

      const agg = createWindowAggregator<string, number, unknown>({
        config: windowConfig,
        aggregator: aggregator as never,
        keyExtractor: { name: 'k', extract: (e) => e.key },
        timeExtractor: (e) => e.eventTime,
        handleLateEvents: true,
      });
      let allResults: WindowResult<string, unknown>[] = [];
      for (const e of events) {
        allResults = allResults.concat(agg.addEvent(e));
      }
      // 关闭水位线
      const watermark: WatermarkEvent = { timestamp: baseTime + 60000, source: 'demo', id: 1 };
      allResults = allResults.concat(agg.addWatermark(watermark));
      const flushed = agg.flush();
      allResults = allResults.concat(flushed);
      const stats = agg.getStats();
      return { results: allResults, stats };
    } catch (e) {
      return { results: [], stats: null, error: (e as Error).message };
    }
  }, [windowConfig, aggregationType]);

  // Exactly-Once 配置校验
  const producerValidation = useMemo(
    () => validateTransactionalProducerConfig(DEFAULT_TRANSACTIONAL_PRODUCER),
    []
  );
  const consumerValidation = useMemo(
    () => validateIdempotentConsumerConfig(DEFAULT_IDEMPOTENT_CONSUMER),
    []
  );

  const producerProps = useMemo(
    () => generateTransactionalProducerProperties(DEFAULT_TRANSACTIONAL_PRODUCER),
    []
  );
  const consumerProps = useMemo(
    () => generateIdempotentConsumerProperties(DEFAULT_IDEMPOTENT_CONSUMER),
    []
  );

  // Exactly-Once 处理器模拟
  const [exactlyOnceDemo, setExactlyOnceDemo] = useState<{ result?: unknown; stats?: unknown; error?: string; loading: boolean }>({ loading: false });

  useEffect(() => {
    let cancelled = false;
    const runDemo = async () => {
      setExactlyOnceDemo({ loading: true });
      try {
        const options: ExactlyOnceOptions = {
          semantics,
          idempotenceLevel: semantics === 'exactly-once' ? 'full' : 'consumer',
          producer: DEFAULT_TRANSACTIONAL_PRODUCER,
          consumer: DEFAULT_IDEMPOTENT_CONSUMER,
          checkpointIntervalMs: 60000,
          checkpointTimeoutMs: 300000,
          maxInFlightCheckpoints: 1,
          enableDeduplication: true,
          enableStateSnapshot: true,
          failureStrategy: 'retry',
          maxRetries: 3,
        };
        const processor = createExactlyOnceProcessor<string, number>(options);
        const records: TransactionalRecord<string, number>[] = [];
        for (let i = 0; i < 5; i++) {
          records.push({
            key: `k${i}`,
            value: i + 1,
            topic: 'input-topic',
            partition: 0,
            offset: i,
            timestamp: Date.now() + i * 1000,
          });
        }
        const result = await processor.process(records, (r) => ({ ...r, topic: 'output-topic' }));
        const stats = processor.getStats();
        if (!cancelled) setExactlyOnceDemo({ result, stats, loading: false });
      } catch (e) {
        if (!cancelled) setExactlyOnceDemo({ error: (e as Error).message, loading: false });
      }
    };
    runDemo();
    return () => {
      cancelled = true;
    };
  }, [semantics]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-surface-900 text-surface-100 rounded-lg shadow-2xl flex flex-col w-full"
        style={{ maxWidth: '1400px', maxHeight: '92vh' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: '#333' }}
        >
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <span>🌊</span>
              <span>MCP × 实时数据流处理</span>
              <span
                className="text-xs px-2 py-1 rounded"
                style={{ background: '#1e3a8a', color: '#bfdbfe' }}
              >
                v1.0.0
              </span>
            </h2>
            <p className="text-xs text-surface-400 mt-1">
              Kafka Streams + Apache Flink + 窗口聚合 + Exactly-Once 语义
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-surface-300 hover:text-white px-3 py-1 rounded transition-colors"
            style={{ background: '#dc2626' }}
          >
            ✕ 关闭
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b" style={{ borderColor: '#333' }}>
          <TabButton
            active={activeTab === 'kafka'}
            onClick={() => setActiveTab('kafka')}
            icon="📨"
            label="Kafka Streams"
          />
          <TabButton
            active={activeTab === 'flink'}
            onClick={() => setActiveTab('flink')}
            icon="⚡"
            label="Apache Flink"
          />
          <TabButton
            active={activeTab === 'windowing'}
            onClick={() => setActiveTab('windowing')}
            icon="🪟"
            label="窗口聚合"
          />
          <TabButton
            active={activeTab === 'exactly-once'}
            onClick={() => setActiveTab('exactly-once')}
            icon="🔒"
            label="Exactly-Once"
          />
          <TabButton
            active={activeTab === 'docs'}
            onClick={() => setActiveTab('docs')}
            icon="📚"
            label="集成文档"
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6" style={{ minHeight: 0 }}>
          {activeTab === 'kafka' && (
            <KafkaStreamsTab
              options={kafkaOptions}
              setOptions={setKafkaOptions}
              props={kafkaProps}
              yaml={kafkaYaml}
            />
          )}
          {activeTab === 'flink' && (
            <FlinkTab
              options={flinkOptions}
              setOptions={setFlinkOptions}
              deploymentYaml={flinkDeploymentYaml}
              config={flinkConfig}
              validation={flinkValidation}
              flinkVersion={flinkVersion}
              setFlinkVersion={setFlinkVersion}
              stateBackend={stateBackend}
              setStateBackend={setStateBackend}
              checkpointStorage={checkpointStorage}
              setCheckpointStorage={setCheckpointStorage}
            />
          )}
          {activeTab === 'windowing' && (
            <WindowingTab
              config={windowConfig}
              setConfig={setWindowConfig}
              aggregationType={aggregationType}
              setAggregationType={setAggregationType}
              demo={windowingDemo}
            />
          )}
          {activeTab === 'exactly-once' && (
            <ExactlyOnceTab
              semantics={semantics}
              setSemantics={setSemantics}
              producerValidation={producerValidation}
              consumerValidation={consumerValidation}
              producerProps={producerProps}
              consumerProps={consumerProps}
              demo={exactlyOnceDemo}
            />
          )}
          {activeTab === 'docs' && <DocsTab />}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Tab 按钮组件
// ============================================================

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-medium transition-colors flex items-center gap-2 ${
        active ? 'text-white' : 'text-surface-400 hover:text-surface-200'
      }`}
      style={{
        background: active ? '#1e40af' : 'transparent',
        borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ============================================================
// Tab 1: Kafka Streams
// ============================================================

function KafkaStreamsTab({
  options,
  setOptions,
  props,
  yaml,
}: {
  options: KafkaStreamsDeployOptions;
  setOptions: (o: KafkaStreamsDeployOptions) => void;
  props: string;
  yaml: string;
}) {
  return (
    <div>
      <Section title="应用配置">
        <FieldGroup label="基础设置">
          <Field label="Application ID">
            <input
              type="text"
              value={options.applicationId}
              onChange={(e) => setOptions({ ...options, applicationId: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="Bootstrap Servers (逗号分隔)">
            <input
              type="text"
              value={options.bootstrapServers.join(',')}
              onChange={(e) =>
                setOptions({ ...options, bootstrapServers: e.target.value.split(',').map((s) => s.trim()) })
              }
              style={inputStyle}
            />
          </Field>
          <Field label="State Dir">
            <input
              type="text"
              value={options.stateDir ?? ''}
              onChange={(e) => setOptions({ ...options, stateDir: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="处理保障">
            <select
              value={options.processingGuarantee ?? 'exactly_once'}
              onChange={(e) =>
                setOptions({
                  ...options,
                  processingGuarantee: e.target.value as KafkaStreamsDeployOptions['processingGuarantee'],
                })
              }
              style={inputStyle}
            >
              <option value="at_most_once">at_most_once</option>
              <option value="at_least_once">at_least_once</option>
              <option value="exactly_once">exactly_once (推荐)</option>
            </select>
          </Field>
        </FieldGroup>
        <FieldGroup label="拓扑概览">
          <pre style={codeBlockStyle}>
{`拓扑节点数: ${options.topology.nodes.length}
边数: ${options.topology.edges.length}
算子链: ${options.topology.nodes
  .filter((n) => n.type === 'processor')
  .map((n) => n.operatorConfig?.type)
  .join(' → ')}
源/汇:
  Sources: ${options.topology.nodes.filter((n) => n.type === 'source').length}
  Sinks: ${options.topology.nodes.filter((n) => n.type === 'sink').length}
  State Stores: ${options.topology.nodes.filter((n) => n.type === 'stateStore').length}`}
          </pre>
        </FieldGroup>
      </Section>

      <Section title="输出: Properties 配置 (Kafka Streams)">
        <CodeBlock content={props} />
      </Section>

      <Section title="输出: 拓扑 YAML (Strimzi)">
        <CodeBlock content={yaml} />
      </Section>
    </div>
  );
}

// ============================================================
// Tab 2: Apache Flink
// ============================================================

function FlinkTab({
  options,
  setOptions,
  deploymentYaml,
  config,
  validation,
  flinkVersion,
  setFlinkVersion,
  stateBackend,
  setStateBackend,
  checkpointStorage,
  setCheckpointStorage,
}: {
  options: FlinkDeployOptions;
  setOptions: (o: FlinkDeployOptions) => void;
  deploymentYaml: string;
  config: string;
  validation: { valid: boolean; errors: string[] };
  flinkVersion: FlinkVersion;
  setFlinkVersion: (v: FlinkVersion) => void;
  stateBackend: StateBackend;
  setStateBackend: (s: StateBackend) => void;
  checkpointStorage: CheckpointStorage;
  setCheckpointStorage: (s: CheckpointStorage) => void;
}) {
  return (
    <div>
      <Section title="基础设置">
        <FieldGroup label="Job 配置">
          <Field label="Job 名称">
            <input
              type="text"
              value={options.jobName}
              onChange={(e) => setOptions({ ...options, jobName: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="镜像">
            <input
              type="text"
              value={options.image}
              onChange={(e) => setOptions({ ...options, image: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="Flink 版本">
            <select
              value={flinkVersion}
              onChange={(e) => {
                setFlinkVersion(e.target.value as FlinkVersion);
                setOptions({
                  ...options,
                  jobGraph: { ...options.jobGraph, flinkVersion: e.target.value as FlinkVersion },
                });
              }}
              style={inputStyle}
            >
              {listSupportedFlinkVersions().map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
        </FieldGroup>

        <FieldGroup label="集群资源">
          <Field label="JobManager CPU">
            <input
              type="number"
              value={options.jobManagerResources.cpu}
              onChange={(e) =>
                setOptions({
                  ...options,
                  jobManagerResources: {
                    ...options.jobManagerResources,
                    cpu: Number(e.target.value),
                  },
                })
              }
              style={inputStyle}
            />
          </Field>
          <Field label="JobManager Memory (MB)">
            <input
              type="number"
              value={options.jobManagerResources.memoryMb}
              onChange={(e) =>
                setOptions({
                  ...options,
                  jobManagerResources: {
                    ...options.jobManagerResources,
                    memoryMb: Number(e.target.value),
                  },
                })
              }
              style={inputStyle}
            />
          </Field>
          <Field label="TaskManager 副本数">
            <input
              type="number"
              value={options.taskManagerReplicas}
              onChange={(e) =>
                setOptions({ ...options, taskManagerReplicas: Number(e.target.value) })
              }
              style={inputStyle}
            />
          </Field>
          <Field label="每 TM Task Slots">
            <input
              type="number"
              value={options.taskSlotsPerTm}
              onChange={(e) => setOptions({ ...options, taskSlotsPerTm: Number(e.target.value) })}
              style={inputStyle}
            />
          </Field>
          <Field label="TaskManager Memory (MB)">
            <input
              type="number"
              value={options.taskManagerResources.memoryMb}
              onChange={(e) =>
                setOptions({
                  ...options,
                  taskManagerResources: {
                    ...options.taskManagerResources,
                    memoryMb: Number(e.target.value),
                  },
                })
              }
              style={inputStyle}
            />
          </Field>
        </FieldGroup>

        <FieldGroup label="检查点配置">
          <Field label="状态后端">
            <select
              value={stateBackend}
              onChange={(e) => {
                setStateBackend(e.target.value as StateBackend);
                setOptions({
                  ...options,
                  jobGraph: {
                    ...options.jobGraph,
                    checkpoint: { ...options.jobGraph.checkpoint, stateBackend: e.target.value as StateBackend },
                  },
                });
              }}
              style={inputStyle}
            >
              {listSupportedStateBackends().map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="检查点存储">
            <select
              value={checkpointStorage}
              onChange={(e) => setCheckpointStorage(e.target.value as CheckpointStorage)}
              style={inputStyle}
            >
              {listSupportedCheckpointStorages().map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="检查点间隔 (ms)">
            <input
              type="number"
              value={options.jobGraph.checkpoint.intervalMs}
              onChange={(e) =>
                setOptions({
                  ...options,
                  jobGraph: {
                    ...options.jobGraph,
                    checkpoint: { ...options.jobGraph.checkpoint, intervalMs: Number(e.target.value) },
                  },
                })
              }
              style={inputStyle}
            />
          </Field>
        </FieldGroup>
      </Section>

      <Section title="校验">
        {validation.valid ? (
          <div
            style={{
              padding: '10px',
              background: '#064e3b',
              color: '#6ee7b7',
              borderRadius: '4px',
              fontSize: '12px',
            }}
          >
            ✓ 所有配置合法，可直接部署
          </div>
        ) : (
          <div
            style={{
              padding: '10px',
              background: '#7f1d1d',
              color: '#fca5a5',
              borderRadius: '4px',
              fontSize: '12px',
            }}
          >
            ⚠ 校验失败:
            <ul style={{ marginTop: '4px', paddingLeft: '20px' }}>
              {validation.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="输出: FlinkDeployment YAML (Kubernetes Operator)">
        <CodeBlock content={deploymentYaml} />
      </Section>

      <Section title="输出: Flink Config (flink-conf.yaml)">
        <CodeBlock content={config} />
      </Section>
    </div>
  );
}

// ============================================================
// Tab 3: 窗口聚合
// ============================================================

function WindowingTab({
  config,
  setConfig,
  aggregationType,
  setAggregationType,
  demo,
}: {
  config: WindowConfig;
  setConfig: (c: WindowConfig) => void;
  aggregationType: string;
  setAggregationType: (a: string) => void;
  demo: { results: WindowResult<string, unknown>[]; stats: unknown; error?: string };
}) {
  return (
    <div>
      <Section title="窗口配置">
        <FieldGroup label="基础设置">
          <Field label="窗口类型">
            <select
              value={config.type}
              onChange={(e) => setConfig({ ...config, type: e.target.value as WindowConfig['type'] })}
              style={inputStyle}
            >
              {listSupportedWindowTypes().map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="窗口大小 (ms)">
            <input
              type="number"
              value={config.sizeMs ?? 60000}
              onChange={(e) => setConfig({ ...config, sizeMs: Number(e.target.value) })}
              style={inputStyle}
            />
          </Field>
          <Field label="滑动步长 (ms, 仅 sliding)">
            <input
              type="number"
              value={config.slideMs ?? 30000}
              onChange={(e) => setConfig({ ...config, slideMs: Number(e.target.value) })}
              style={inputStyle}
            />
          </Field>
          <Field label="会话间隔 (ms, 仅 session)">
            <input
              type="number"
              value={config.gapMs ?? 10000}
              onChange={(e) => setConfig({ ...config, gapMs: Number(e.target.value) })}
              style={inputStyle}
            />
          </Field>
          <Field label="允许延迟 (ms)">
            <input
              type="number"
              value={config.allowedLatenessMs ?? 0}
              onChange={(e) => setConfig({ ...config, allowedLatenessMs: Number(e.target.value) })}
              style={inputStyle}
            />
          </Field>
        </FieldGroup>

        <FieldGroup label="聚合函数">
          <Field label="聚合类型">
            <select
              value={aggregationType}
              onChange={(e) => setAggregationType(e.target.value)}
              style={inputStyle}
            >
              {listSupportedAggregationTypes().map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </FieldGroup>
      </Section>

      <Section title="实时模拟">
        {demo.error ? (
          <div style={{ color: '#fca5a5', fontSize: '12px' }}>错误: {demo.error}</div>
        ) : (
          <div>
            <h4 style={{ color: '#fbbf24', fontSize: '13px', marginBottom: '8px' }}>
              窗口结果 ({demo.results.length} 条)
            </h4>
            <CodeBlock
              content={demo.results
                .slice(0, 10)
                .map(
                  (r) =>
                    `窗口 [${r.windowStart}-${r.windowEnd}] key=${r.key} count=${r.eventCount} result=${JSON.stringify(r.result)}`
                )
                .join('\n')}
            />
            <h4 style={{ color: '#fbbf24', fontSize: '13px', marginTop: '12px', marginBottom: '8px' }}>
              统计
            </h4>
            <CodeBlock
              content={JSON.stringify(demo.stats, null, 2)}
            />
          </div>
        )}
      </Section>
    </div>
  );
}

// ============================================================
// Tab 4: Exactly-Once
// ============================================================

function ExactlyOnceTab({
  semantics,
  setSemantics,
  producerValidation,
  consumerValidation,
  producerProps,
  consumerProps,
  demo,
}: {
  semantics: ProcessingSemantics;
  setSemantics: (s: ProcessingSemantics) => void;
  producerValidation: { valid: boolean; errors: string[] };
  consumerValidation: { valid: boolean; errors: string[] };
  producerProps: string;
  consumerProps: string;
  demo: { result?: unknown; stats?: unknown; error?: string };
}) {
  return (
    <div>
      <Section title="处理语义">
        <FieldGroup label="配置">
          <Field label="处理语义">
            <select
              value={semantics}
              onChange={(e) => setSemantics(e.target.value as ProcessingSemantics)}
              style={inputStyle}
            >
              {listSupportedSemantics().map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </FieldGroup>
      </Section>

      <Section title="事务性生产者校验">
        {producerValidation.valid ? (
          <div
            style={{
              padding: '10px',
              background: '#064e3b',
              color: '#6ee7b7',
              borderRadius: '4px',
              fontSize: '12px',
            }}
          >
            ✓ 事务性生产者配置合法
          </div>
        ) : (
          <div
            style={{
              padding: '10px',
              background: '#7f1d1d',
              color: '#fca5a5',
              borderRadius: '4px',
              fontSize: '12px',
            }}
          >
            ✗ 校验失败:
            <ul style={{ marginTop: '4px', paddingLeft: '20px' }}>
              {producerValidation.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="幂等消费者校验">
        {consumerValidation.valid ? (
          <div
            style={{
              padding: '10px',
              background: '#064e3b',
              color: '#6ee7b7',
              borderRadius: '4px',
              fontSize: '12px',
            }}
          >
            ✓ 幂等消费者配置合法
          </div>
        ) : (
          <div
            style={{
              padding: '10px',
              background: '#7f1d1d',
              color: '#fca5a5',
              borderRadius: '4px',
              fontSize: '12px',
            }}
          >
            ✗ 校验失败:
            <ul style={{ marginTop: '4px', paddingLeft: '20px' }}>
              {consumerValidation.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="输出: 事务性生产者配置">
        <CodeBlock content={producerProps} />
      </Section>

      <Section title="输出: 幂等消费者配置">
        <CodeBlock content={consumerProps} />
      </Section>

      <Section title="处理模拟">
        {demo.error ? (
          <div style={{ color: '#fca5a5', fontSize: '12px' }}>错误: {demo.error}</div>
        ) : (
          <div>
            <h4 style={{ color: '#fbbf24', fontSize: '13px', marginBottom: '8px' }}>处理结果</h4>
            <CodeBlock content={JSON.stringify(demo.result, null, 2)} />
            <h4 style={{ color: '#fbbf24', fontSize: '13px', marginTop: '12px', marginBottom: '8px' }}>
              统计
            </h4>
            <CodeBlock content={JSON.stringify(demo.stats, null, 2)} />
          </div>
        )}
      </Section>
    </div>
  );
}

// ============================================================
// Tab 5: 集成文档
// ============================================================

function DocsTab() {
  return (
    <div>
      <Section title="Cycle 57 实时数据流处理总览">
        <p style={{ color: '#bbb', fontSize: '13px', lineHeight: 1.6 }}>
          MCP × 实时数据流处理集成面板整合 Kafka Streams、Apache Flink、窗口聚合、Exactly-Once
          语义四大核心引擎，为生产级实时数据流处理提供端到端能力。
        </p>
      </Section>

      <Section title="核心引擎">
        <CodeTable
          rows={[
            ['Kafka Streams', '声明式流处理拓扑 + DSL 算子 + 状态存储 (In-Memory/RocksDB)'],
            ['Apache Flink', 'JobGraph + Checkpointing + Watermarks + Savepoints'],
            ['窗口聚合', 'Tumbling/Sliding/Session + 水位线 + 迟到事件 + 侧输出'],
            ['Exactly-Once', '事务性生产者 + 幂等消费者 + 检查点 + 重放去重'],
          ]}
        />
      </Section>

      <Section title="API 摘要">
        <CodeTable
          rows={[
            ['createKafkaStreamsTopology(id, guarantee)', '创建 Kafka Streams 拓扑构建器'],
            ['createKafkaStreamsDeployOptions(opts)', '构造部署选项'],
            ['generateKafkaStreamsProperties(opts, topology)', '生成 Properties 文件'],
            ['serializeKafkaStreamsTopology(topology)', '序列化为 YAML'],
            ['createFlinkJobBuilder(name, options)', '创建 Flink JobBuilder'],
            ['FlinkJobBuilder', '链式 API: source/sink/map/keyBy/window/aggregate'],
            ['serializeFlinkDeployment(opts)', '生成 FlinkDeployment YAML (K8s Operator)'],
            ['generateFlinkConfig(opts)', '生成 flink-conf.yaml'],
            ['submitFlinkJob(restUrl, jg)', '提交 Flink Job (REST API)'],
            ['createWindowAggregator(options)', '创建窗口聚合器'],
            ['countAggregator/sumAggregator/avgAggregator', '内置聚合器工厂'],
            ['tumblingWindowKey/slidingWindowKeys/sessionWindowKey', '窗口键生成器'],
            ['createExactlyOnceProcessor(options)', '创建 Exactly-Once 处理器'],
            ['validateTransactionalProducerConfig(cfg)', '事务性生产者配置校验'],
            ['validateIdempotentConsumerConfig(cfg)', '幂等消费者配置校验'],
            ['generateTransactionalProducerProperties(cfg)', '生成生产者 Properties'],
          ]}
        />
      </Section>

      <Section title="与其它 Cycle 集成点">
        <CodeTable
          rows={[
            ['Cycle 56 Serverless', 'Knative + KEDA 提供流处理部署运行时'],
            ['Cycle 55 Kubernetes', 'Manifest + Helm + Operator 部署 Flink/Kafka Streams'],
            ['Cycle 54 平台可观测性', 'OTLP + Prometheus + Grafana 监控流处理指标'],
            ['Cycle 53 混沌工程', '故障注入测试 Exactly-Once 语义在异常下的保证'],
          ]}
        />
      </Section>

      <Section title="最佳实践">
        <ul style={{ color: '#bbb', fontSize: '13px', lineHeight: 1.8, paddingLeft: '20px' }}>
          <li>Exactly-Once 语义需要事务性生产者 + 幂等消费者 + 检查点三件套</li>
          <li>Flink 检查点间隔建议 30-60s，RocksDB 增量检查点可降低存储开销</li>
          <li>窗口聚合应设置合理 allowedLateness 平衡延迟与正确性</li>
          <li>Kafka Streams 状态存储建议 RocksDB + changelog topic (RF=3)</li>
          <li>水位线策略推荐 forBoundedOutOfOrderness(5s) + 处理时间特征</li>
        </ul>
      </Section>
    </div>
  );
}

// ============================================================
// 通用样式 + 组件
// ============================================================

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#0d1117',
  border: '1px solid #444',
  color: '#e0e0e0',
  padding: '6px 10px',
  borderRadius: '4px',
  fontSize: '12px',
};

const codeBlockStyle: React.CSSProperties = {
  background: '#0d1117',
  color: '#c9d1d9',
  padding: '12px',
  borderRadius: '6px',
  fontSize: '11px',
  overflow: 'auto',
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  whiteSpace: 'pre',
};

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        marginBottom: '16px',
        padding: '12px',
        background: '#1a1a1a',
        borderRadius: '6px',
        border: '1px solid #2a2a2a',
      }}
    >
      <div
        style={{
          fontSize: '11px',
          color: '#999',
          textTransform: 'uppercase',
          marginBottom: '8px',
          letterSpacing: '0.5px',
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '11px', color: '#bbb', marginBottom: '4px' }}>{label}</div>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '24px' }}>
      <h4
        style={{
          fontSize: '15px',
          color: '#e0e0e0',
          marginBottom: '8px',
          borderLeft: '3px solid #6b7280',
          paddingLeft: '10px',
        }}
      >
        {title}
      </h4>
      {children}
    </div>
  );
}

function CodeBlock({ content }: { content: string }) {
  return <pre style={codeBlockStyle}>{content}</pre>;
}

function CodeTable({ rows }: { rows: Array<[string, string]> }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
      <thead>
        <tr style={{ background: '#222' }}>
          <th style={{ padding: '8px', textAlign: 'left', color: '#999', borderBottom: '1px solid #333' }}>
            API / 引擎
          </th>
          <th style={{ padding: '8px', textAlign: 'left', color: '#999', borderBottom: '1px solid #333' }}>
            说明
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([api, desc], i) => (
          <tr key={i} style={{ borderBottom: '1px solid #2a2a2a' }}>
            <td style={{ padding: '8px', fontFamily: 'ui-monospace, monospace', color: '#10b981' }}>{api}</td>
            <td style={{ padding: '8px', color: '#bbb' }}>{desc}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
