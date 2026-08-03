/**
 * # ============================================================
 * # Apache Flink Generator - 单元测试 (Cycle 57 G57-02)
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import {
  createFlinkJobGraph,
  createFlinkJobBuilder,
  FlinkJobBuilder,
  validateFlinkDeployOptions,
  serializeFlinkDeployment,
  generateFlinkConfig,
  submitFlinkJob,
  getFlinkJobStatus,
  listFlinkCheckpoints,
  cancelFlinkJob,
  listSupportedFlinkVersions,
  listSupportedStateBackends,
  listSupportedCheckpointStorages,
  listSupportedRestartStrategies,
  listSupportedWatermarkStrategies,
  normalizeFlinkVersion,
} from './flinkGenerator';
import type { FlinkDeployOptions } from './flinkTypes';

describe('G57-02 Apache Flink Generator', () => {
  describe('createFlinkJobGraph', () => {
    it('应该使用默认值创建 JobGraph', () => {
      const jg = createFlinkJobGraph({ jobName: 'test-job' });
      expect(jg.jobName).toBe('test-job');
      expect(jg.flinkVersion).toBe('1.18');
      expect(jg.deploymentMode).toBe('application');
      expect(jg.defaultParallelism).toBe(4);
      expect(jg.maxParallelism).toBe(128);
      expect(jg.timeCharacteristic).toBe('event-time');
      expect(jg.state).toBe('created');
      expect(jg.operators).toEqual([]);
      expect(jg.edges).toEqual([]);
    });

    it('应该生成唯一的 jobId', () => {
      const a = createFlinkJobGraph({ jobName: 'a' });
      const b = createFlinkJobGraph({ jobName: 'b' });
      expect(a.jobId).not.toBe(b.jobId);
    });
  });

  describe('FlinkJobBuilder - 基础算子', () => {
    it('应该创建 source → sink 基础拓扑', () => {
      const builder = createFlinkJobBuilder('basic');
      const jg = builder
        .source('kafka-source', { class: 'KafkaSource' })
        .sink('kafka-sink', { class: 'KafkaSink' })
        .build();

      expect(jg.operators.length).toBe(2);
      expect(jg.edges.length).toBe(1);
      const source = jg.operators.find((o) => o.type === 'source');
      const sink = jg.operators.find((o) => o.type === 'sink');
      expect(source).toBeDefined();
      expect(sink).toBeDefined();
      expect(source?.functionClass).toBe('KafkaSource');
      expect(sink?.functionClass).toBe('KafkaSink');
    });

    it('在 source 之前调用 sink 应抛错', () => {
      const builder = createFlinkJobBuilder('bad');
      expect(() => builder.sink('kafka-sink')).toThrow();
    });
  });

  describe('FlinkJobBuilder - DSL 算子', () => {
    it('应该支持 map 算子', () => {
      const jg = createFlinkJobBuilder('m')
        .source('s')
        .map('to-upper', 'UppercaseFunction')
        .sink('o')
        .build();
      const mapOp = jg.operators.find((o) => o.type === 'map');
      expect(mapOp).toBeDefined();
      expect(mapOp?.functionClass).toBe('UppercaseFunction');
    });

    it('应该支持 flatMap / filter 算子', () => {
      const jg = createFlinkJobBuilder('fm')
        .source('s')
        .flatMap('tokenize', 'TokenizerFunction')
        .filter('non-empty', 'NonEmptyFilter')
        .sink('o')
        .build();
      expect(jg.operators.find((o) => o.type === 'flatMap')).toBeDefined();
      expect(jg.operators.find((o) => o.type === 'filter')).toBeDefined();
    });

    it('应该支持 keyBy + window + aggregate', () => {
      const jg = createFlinkJobBuilder('kw')
        .source('s')
        .keyBy('k', 'userId')
        .window('tumbling-1m', {
          type: 'tumbling',
          sizeMs: 60000,
          allowedLatenessMs: 5000,
        })
        .aggregate('count', 'CountFunction')
        .sink('o')
        .build();
      const keyBy = jg.operators.find((o) => o.type === 'keyBy');
      const win = jg.operators.find((o) => o.type === 'window');
      const agg = jg.operators.find((o) => o.type === 'aggregate');
      expect(keyBy).toBeDefined();
      expect(win).toBeDefined();
      expect(agg).toBeDefined();
      expect(keyBy?.params?.keys).toEqual(['userId']);
    });

    it('应该支持 reduce / process', () => {
      const jg = createFlinkJobBuilder('rp')
        .source('s')
        .keyBy('k', 'k')
        .reduce('sum', 'SumReducer')
        .process('enrich', 'EnrichProcess')
        .sink('o')
        .build();
      expect(jg.operators.find((o) => o.type === 'reduce')).toBeDefined();
      expect(jg.operators.find((o) => o.type === 'process')).toBeDefined();
    });

    it('应该支持 join 算子', () => {
      const jg = createFlinkJobBuilder('j')
        .source('s')
        .keyBy('k', 'id')
        .join('stream-join', { where: 'a.id', equalTo: 'b.id', windowMs: 60000 })
        .sink('o')
        .build();
      const join = jg.operators.find((o) => o.type === 'join');
      expect(join).toBeDefined();
      expect(join?.params?.windowMs).toBe(60000);
    });

    it('应该支持 asyncIO 算子', () => {
      const jg = createFlinkJobBuilder('a')
        .source('s')
        .asyncIO('enrich-async', 'AsyncEnricher', { timeoutMs: 5000, capacity: 100 })
        .sink('o')
        .build();
      const async = jg.operators.find((o) => o.type === 'asyncIO');
      expect(async).toBeDefined();
      expect(async?.params?.timeoutMs).toBe(5000);
    });

    it('应该支持 union / broadcast / sideOutput', () => {
      const jg = createFlinkJobBuilder('u')
        .source('s')
        .union('merged')
        .broadcast('bcast')
        .sideOutput('late', 'late-tag')
        .sink('o')
        .build();
      expect(jg.operators.find((o) => o.type === 'union')).toBeDefined();
      expect(jg.operators.find((o) => o.type === 'broadcast')).toBeDefined();
      expect(jg.operators.find((o) => o.type === 'sideOutput')).toBeDefined();
    });
  });

  describe('FlinkJobBuilder - 配置', () => {
    it('应该支持自定义并行度', () => {
      const builder = createFlinkJobBuilder('par', { defaultParallelism: 8 });
      const jg = builder.source('s', { parallelism: 16 }).sink('o').build();
      const source = jg.operators.find((o) => o.type === 'source');
      expect(source?.parallelism).toBe(16);
      expect(jg.defaultParallelism).toBe(8);
    });

    it('应该支持 setParallelism / setSlotSharingGroup / setChainStrategy', () => {
      const builder = createFlinkJobBuilder('cfg');
      const jg = builder.source('s').map('m', 'MapFn').sink('o').build();
      const mapOpId = jg.operators.find((o) => o.type === 'map')!.id;
      builder.setParallelism(mapOpId, 32);
      builder.setSlotSharingGroup(mapOpId, 'fast');
      builder.setChainStrategy(mapOpId, 'always');
      const final = builder.build();
      const mapOp = final.operators.find((o) => o.id === mapOpId)!;
      expect(mapOp.parallelism).toBe(32);
      expect(mapOp.slotSharingGroup).toBe('fast');
      expect(mapOp.chainStrategy).toBe('always');
    });

    it('应该支持 setWatermark / setCheckpoint / setRestartStrategy', () => {
      const builder = createFlinkJobBuilder('cfg2');
      builder
        .source('s')
        .sink('o');
      builder.setWatermark({
        strategy: 'forBoundedOutOfOrderness',
        maxOutOfOrdernessMs: 10000,
      });
      builder.setCheckpoint({
        enabled: true,
        intervalMs: 30000,
        minPauseBetweenMs: 1000,
        timeoutMs: 300000,
        maxConcurrent: 2,
        stateBackend: 'rocksdb',
        incremental: true,
      });
      builder.setRestartStrategy({
        strategy: 'failure-rate',
        maxFailuresPerInterval: 10,
        failureRateIntervalMs: 120000,
        delayMs: 5000,
      });
      const jg = builder.build();
      expect(jg.watermark.strategy).toBe('forBoundedOutOfOrderness');
      expect(jg.checkpoint.intervalMs).toBe(30000);
      expect(jg.restartStrategy.strategy).toBe('failure-rate');
    });
  });

  describe('validateFlinkDeployOptions', () => {
    const baseOpts: FlinkDeployOptions = {
      jobName: 'test',
      image: 'flink:1.18',
      jobManagerReplicas: 1,
      taskManagerReplicas: 2,
      taskSlotsPerTm: 4,
      taskManagerResources: { cpu: 1, memoryMb: 2048 },
      jobManagerResources: { cpu: 1, memoryMb: 1024 },
      jobGraph: createFlinkJobGraph({ jobName: 'test' }),
    };

    it('应该通过合法配置', () => {
      const r = validateFlinkDeployOptions(baseOpts);
      expect(r.valid).toBe(true);
    });

    it('jobName 必填', () => {
      const r = validateFlinkDeployOptions({ ...baseOpts, jobName: '' });
      expect(r.valid).toBe(false);
    });

    it('image 必填', () => {
      const r = validateFlinkDeployOptions({ ...baseOpts, image: '' });
      expect(r.valid).toBe(false);
    });

    it('JM/TM 副本数必须 >= 1', () => {
      const r1 = validateFlinkDeployOptions({ ...baseOpts, jobManagerReplicas: 0 });
      expect(r1.valid).toBe(false);
      const r2 = validateFlinkDeployOptions({ ...baseOpts, taskManagerReplicas: 0 });
      expect(r2.valid).toBe(false);
    });

    it('taskSlotsPerTm 必须 >= 1', () => {
      const r = validateFlinkDeployOptions({ ...baseOpts, taskSlotsPerTm: 0 });
      expect(r.valid).toBe(false);
    });
  });

  describe('serializeFlinkDeployment', () => {
    it('应该序列化为 FlinkDeployment YAML', () => {
      const jg = createFlinkJobBuilder('yaml-test')
        .source('kafka-source', { class: 'KafkaSource' })
        .sink('kafka-sink', { class: 'KafkaSink' })
        .build();
      const yaml = serializeFlinkDeployment({
        jobName: 'yaml-test',
        image: 'flink:1.18',
        jobManagerReplicas: 1,
        taskManagerReplicas: 2,
        taskSlotsPerTm: 4,
        taskManagerResources: { cpu: 2, memoryMb: 4096 },
        jobManagerResources: { cpu: 1, memoryMb: 1024 },
        jobGraph: jg,
      });
      expect(yaml).toContain('apiVersion: flink.apache.org/v1beta1');
      expect(yaml).toContain('kind: FlinkDeployment');
      expect(yaml).toContain('name: yaml-test');
      expect(yaml).toContain('image: flink:1.18');
      expect(yaml).toContain('flinkVersion: 1.18');
    });
  });

  describe('generateFlinkConfig', () => {
    it('应该生成包含检查点配置', () => {
      const jg = createFlinkJobBuilder('cfg-test')
        .source('s')
        .sink('o')
        .setCheckpoint({
          enabled: true,
          intervalMs: 30000,
          minPauseBetweenMs: 1000,
          timeoutMs: 300000,
          maxConcurrent: 1,
          stateBackend: 'rocksdb',
          incremental: true,
          stateBackendStorage: { type: 's3', uri: 's3://flink/checkpoints' },
        })
        .build();
      const cfg = generateFlinkConfig({
        jobName: 'cfg-test',
        image: 'flink:1.18',
        jobManagerReplicas: 1,
        taskManagerReplicas: 2,
        taskSlotsPerTm: 4,
        taskManagerResources: { cpu: 1, memoryMb: 2048 },
        jobManagerResources: { cpu: 1, memoryMb: 1024 },
        jobGraph: jg,
      });
      expect(cfg).toContain('execution.checkpointing.interval: 30000ms');
      expect(cfg).toContain('state.backend: rocksdb');
      expect(cfg).toContain('state.backend.incremental: true');
      expect(cfg).toContain('state.checkpoints.dir: s3://flink/checkpoints');
    });

    it('应该生成指数退避重启策略', () => {
      const jg = createFlinkJobBuilder('rs')
        .source('s')
        .sink('o')
        .setRestartStrategy({
          strategy: 'exponential-delay',
          initialBackoffMs: 500,
          maxBackoffMs: 30000,
          backoffMultiplier: 1.5,
        })
        .build();
      const cfg = generateFlinkConfig({
        jobName: 'rs',
        image: 'flink:1.18',
        jobManagerReplicas: 1,
        taskManagerReplicas: 1,
        taskSlotsPerTm: 1,
        taskManagerResources: { cpu: 1, memoryMb: 1024 },
        jobManagerResources: { cpu: 1, memoryMb: 1024 },
        jobGraph: jg,
      });
      expect(cfg).toContain('restart-strategy: exponential-delay');
      expect(cfg).toContain('restart-strategy.exponential-delay.initial-backoff: 500ms');
      expect(cfg).toContain('restart-strategy.exponential-delay.max-backoff: 30000ms');
    });

    it('应该生成 fixed-delay 重启策略', () => {
      const jg = createFlinkJobBuilder('fd')
        .source('s')
        .sink('o')
        .setRestartStrategy({ strategy: 'fixed-delay', attempts: 5, delayMs: 10000 })
        .build();
      const cfg = generateFlinkConfig({
        jobName: 'fd',
        image: 'flink:1.18',
        jobManagerReplicas: 1,
        taskManagerReplicas: 1,
        taskSlotsPerTm: 1,
        taskManagerResources: { cpu: 1, memoryMb: 1024 },
        jobManagerResources: { cpu: 1, memoryMb: 1024 },
        jobGraph: jg,
      });
      expect(cfg).toContain('restart-strategy: fixed-delay');
      expect(cfg).toContain('restart-strategy.fixed-delay.attempts: 5');
    });
  });

  describe('Flink REST API Mock', () => {
    it('submitFlinkJob 应该成功', async () => {
      const jg = createFlinkJobGraph({ jobName: 'submit-test' });
      const r = await submitFlinkJob('http://localhost:8081', jg);
      expect(r.success).toBe(true);
      expect(r.jobId).toBe(jg.jobId);
    });

    it('submitFlinkJob 缺少 restUrl 应失败', async () => {
      const jg = createFlinkJobGraph({ jobName: 'x' });
      const r = await submitFlinkJob('', jg);
      expect(r.success).toBe(false);
    });

    it('getFlinkJobStatus 应该返回状态', async () => {
      const r = await getFlinkJobStatus('http://localhost:8081', 'job-123');
      expect(r.success).toBe(true);
      expect(r.data?.state).toBe('RUNNING');
    });

    it('listFlinkCheckpoints 应该返回检查点列表', async () => {
      const r = await listFlinkCheckpoints('http://localhost:8081', 'job-1');
      expect(r.success).toBe(true);
      expect(r.data?.length).toBeGreaterThan(0);
      expect(r.data?.[0]?.status).toBe('completed');
    });

    it('cancelFlinkJob 应该成功', async () => {
      const r = await cancelFlinkJob('http://localhost:8081', 'job-1');
      expect(r.success).toBe(true);
    });
  });

  describe('工具函数', () => {
    it('listSupportedFlinkVersions 应包含 1.18', () => {
      const v = listSupportedFlinkVersions();
      expect(v).toContain('1.18');
      expect(v.length).toBeGreaterThanOrEqual(3);
    });

    it('listSupportedStateBackends 应包含 rocksdb', () => {
      expect(listSupportedStateBackends()).toContain('rocksdb');
    });

    it('listSupportedCheckpointStorages 应包含 s3', () => {
      expect(listSupportedCheckpointStorages()).toContain('s3');
    });

    it('listSupportedRestartStrategies 应包含 4 种', () => {
      const s = listSupportedRestartStrategies();
      expect(s.length).toBe(4);
    });

    it('listSupportedWatermarkStrategies 应包含 5 种', () => {
      const s = listSupportedWatermarkStrategies();
      expect(s.length).toBe(5);
    });

    it('normalizeFlinkVersion 应规范化', () => {
      expect(normalizeFlinkVersion('1.18')).toBe('1.18');
      expect(normalizeFlinkVersion('  1.19  ')).toBe('1.19');
      expect(normalizeFlinkVersion('1.99')).toBe('1.18'); // 默认
    });
  });
});
