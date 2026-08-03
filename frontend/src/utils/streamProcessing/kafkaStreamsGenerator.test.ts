/**
 * # ============================================================
 * # Kafka Streams Generator - 单元测试 (Cycle 57 G57-01)
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import {
  createKafkaStreamsTopology,
  createKafkaStreamsDeployOptions,
  generateKafkaStreamsProperties,
  serializeKafkaStreamsTopology,
  processStream,
  TopologyBuilder,
} from './kafkaStreamsGenerator';
import type {
  StreamRecord,
  KafkaStreamsTopology,
  StateStoreConfig,
} from './kafkaStreamsTypes';

describe('G57-01 Kafka Streams Generator', () => {
  describe('createKafkaStreamsTopology', () => {
    it('应该创建 TopologyBuilder 实例', () => {
      const builder = createKafkaStreamsTopology('test-app', 'exactly_once');
      expect(builder).toBeInstanceOf(TopologyBuilder);
      expect(builder.applicationId).toBe('test-app');
      expect(builder.processingGuarantee).toBe('exactly_once');
    });

    it('默认处理保障应为 exactly_once', () => {
      const builder = createKafkaStreamsTopology('test-app');
      expect(builder.processingGuarantee).toBe('exactly_once');
    });
  });

  describe('TopologyBuilder - 基础算子', () => {
    it('应该构建 source → sink 基础拓扑', () => {
      const builder = createKafkaStreamsTopology('basic-app');
      const topology = builder
        .source('input-topic')
        .sink('output-topic')
        .build();

      expect(topology.applicationId).toBe('basic-app');
      expect(topology.nodes.length).toBe(2);
      expect(topology.edges.length).toBe(1);
      const source = topology.nodes.find((n) => n.type === 'source');
      const sink = topology.nodes.find((n) => n.type === 'sink');
      expect(source).toBeDefined();
      expect(sink).toBeDefined();
      expect(source?.sourceSinkConfig?.topic).toBe('input-topic');
      expect(sink?.sourceSinkConfig?.topic).toBe('output-topic');
    });

    it('应该在 source 之前调用 sink 时抛错', () => {
      const builder = createKafkaStreamsTopology('bad-app');
      expect(() => builder.sink('output-topic')).toThrow();
    });

    it('应该在 source 之前调用 map 时抛错', () => {
      const builder = createKafkaStreamsTopology('bad-app');
      expect(() => builder.map({ valueMapper: 'x' })).toThrow();
    });
  });

  describe('TopologyBuilder - DSL 算子', () => {
    it('应该支持 filter 算子', () => {
      const builder = createKafkaStreamsTopology('filter-app');
      const topology = builder
        .source('in')
        .filter('value > 100')
        .sink('out')
        .build();

      const filterNode = topology.nodes.find((n) => n.operatorConfig?.type === 'filter');
      expect(filterNode).toBeDefined();
      expect(filterNode?.operatorConfig?.functionCode).toBe('value > 100');
    });

    it('应该支持 map 算子', () => {
      const builder = createKafkaStreamsTopology('map-app');
      const topology = builder
        .source('in')
        .map({ valueMapper: 'value.toUpperCase()' })
        .sink('out')
        .build();

      const mapNode = topology.nodes.find((n) => n.operatorConfig?.type === 'map');
      expect(mapNode).toBeDefined();
    });

    it('应该支持 mapValues 算子', () => {
      const builder = createKafkaStreamsTopology('mv-app');
      const topology = builder
        .source('in')
        .mapValues('JSON.parse(value)')
        .sink('out')
        .build();

      const node = topology.nodes.find((n) => n.operatorConfig?.type === 'mapValues');
      expect(node).toBeDefined();
    });

    it('应该支持 selectKey 算子', () => {
      const builder = createKafkaStreamsTopology('sk-app');
      const topology = builder
        .source('in')
        .selectKey('key.userId')
        .sink('out')
        .build();

      const node = topology.nodes.find((n) => n.operatorConfig?.type === 'selectKey');
      expect(node).toBeDefined();
    });

    it('应该支持 window 算子（tumbling/sliding/session）', () => {
      const tumbling = createKafkaStreamsTopology('t')
        .source('in')
        .window('tumbling', 60000)
        .sink('out')
        .build();
      const sliding = createKafkaStreamsTopology('s')
        .source('in')
        .window('sliding', 60000)
        .sink('out')
        .build();
      const session = createKafkaStreamsTopology('se')
        .source('in')
        .window('session', 30000)
        .sink('out')
        .build();

      expect(tumbling.nodes.find((n) => n.operatorConfig?.type === 'window')).toBeDefined();
      expect(sliding.nodes.find((n) => n.operatorConfig?.type === 'window')).toBeDefined();
      expect(session.nodes.find((n) => n.operatorConfig?.type === 'window')).toBeDefined();
    });

    it('应该支持 groupByKey + aggregate + count', () => {
      const topology = createKafkaStreamsTopology('agg-app')
        .source('events')
        .groupByKey('user-sessions')
        .count('user-counts')
        .sink('counted')
        .build();

      const groupNode = topology.nodes.find((n) => n.operatorConfig?.type === 'groupByKey');
      const countNode = topology.nodes.find((n) => n.operatorConfig?.type === 'count');
      expect(groupNode).toBeDefined();
      expect(countNode).toBeDefined();
      expect(groupNode?.operatorConfig?.stateStore).toBe('user-sessions');
      expect(countNode?.operatorConfig?.stateStore).toBe('user-counts');
    });

    it('应该支持 reduce 算子', () => {
      const topology = createKafkaStreamsTopology('red-app')
        .source('in')
        .groupByKey('s')
        .reduce('(a, b) => a + b', 'sum-store')
        .sink('out')
        .build();

      const reduceNode = topology.nodes.find((n) => n.operatorConfig?.type === 'reduce');
      expect(reduceNode).toBeDefined();
      expect(reduceNode?.operatorConfig?.stateStore).toBe('sum-store');
    });

    it('应该支持 aggregate 算子（init+adder+subtractor）', () => {
      const topology = createKafkaStreamsTopology('agg-app2')
        .source('in')
        .groupByKey('s')
        .aggregate('() => 0', '(a, v) => a + v', '(a, v) => a - v', 'agg-store')
        .sink('out')
        .build();

      const node = topology.nodes.find((n) => n.operatorConfig?.type === 'aggregate');
      expect(node).toBeDefined();
      expect(node?.operatorConfig?.stateStore).toBe('agg-store');
    });

    it('应该支持 toStream/toTable 算子', () => {
      const t1 = createKafkaStreamsTopology('ts')
        .source('in')
        .groupByKey('s')
        .toStream()
        .sink('out')
        .build();
      const t2 = createKafkaStreamsTopology('tt')
        .source('in')
        .toTable('tbl')
        .sink('out')
        .build();

      expect(t1.nodes.find((n) => n.operatorConfig?.type === 'toStream')).toBeDefined();
      expect(t2.nodes.find((n) => n.operatorConfig?.type === 'toTable')).toBeDefined();
    });

    it('应该支持 branch 算子', () => {
      const topology = createKafkaStreamsTopology('br-app')
        .source('in')
        .branch(['value > 100', 'value > 10', 'value >= 0'])
        .sink('out')
        .build();

      const branchNode = topology.nodes.find((n) => n.operatorConfig?.type === 'branch');
      expect(branchNode).toBeDefined();
    });
  });

  describe('TopologyBuilder - 状态存储', () => {
    it('应该支持添加状态存储', () => {
      const storeConfig: StateStoreConfig = {
        type: 'rocksdb',
        name: 'user-sessions',
        keyType: 'string',
        valueType: 'json',
        cacheSize: 10000,
        loggingEnabled: true,
        loggingTopic: 'changelog-user-sessions',
        retention: 'compact',
      };
      const topology = createKafkaStreamsTopology('ss-app')
        .source('in')
        .addStateStore(storeConfig)
        .sink('out')
        .build();

      const storeNode = topology.nodes.find((n) => n.type === 'stateStore');
      expect(storeNode).toBeDefined();
      expect(storeNode?.stateStoreConfig?.name).toBe('user-sessions');
      expect(storeNode?.stateStoreConfig?.type).toBe('rocksdb');
      expect(storeNode?.stateStoreConfig?.cacheSize).toBe(10000);
      expect(storeNode?.stateStoreConfig?.loggingEnabled).toBe(true);
    });

    it('应该支持多种状态存储类型', () => {
      const types: StateStoreConfig['type'][] = ['in-memory', 'rocksdb', 'persistent', 'lru'];
      for (const t of types) {
        const topology = createKafkaStreamsTopology(`ss-${t}`)
          .source('in')
          .addStateStore({
            type: t,
            name: `store-${t}`,
            keyType: 'string',
            valueType: 'string',
          })
          .sink('out')
          .build();
        const node = topology.nodes.find((n) => n.type === 'stateStore');
        expect(node?.stateStoreConfig?.type).toBe(t);
      }
    });
  });

  describe('createKafkaStreamsDeployOptions', () => {
    it('应该使用默认值填充', () => {
      const topology = createKafkaStreamsTopology('test-app').source('in').sink('out').build();
      const opts = createKafkaStreamsDeployOptions({
        applicationId: 'test-app',
        bootstrapServers: ['localhost:9092'],
        topology,
      });
      expect(opts.processingGuarantee).toBe('exactly_once');
      expect(opts.stateDir).toBe('/tmp/kafka-streams/test-app');
      expect(opts.replicationFactor).toBe(3);
      expect(opts.metricsIntervalMs).toBe(30000);
      expect(opts.topologyOptimization).toBe('all');
    });

    it('应该校验 applicationId 必填', () => {
      const topology = createKafkaStreamsTopology('test-app').source('in').sink('out').build();
      expect(() =>
        createKafkaStreamsDeployOptions({
          applicationId: '',
          bootstrapServers: ['localhost:9092'],
          topology,
        })
      ).toThrow();
    });

    it('应该校验 bootstrapServers 必填', () => {
      const topology = createKafkaStreamsTopology('test-app').source('in').sink('out').build();
      expect(() =>
        createKafkaStreamsDeployOptions({
          applicationId: 'test-app',
          bootstrapServers: [],
          topology,
        })
      ).toThrow();
    });

    it('应该校验 topology 必填', () => {
      expect(() =>
        createKafkaStreamsDeployOptions({
          applicationId: 'test-app',
          bootstrapServers: ['localhost:9092'],
          topology: undefined as unknown as KafkaStreamsTopology,
        })
      ).toThrow();
    });
  });

  describe('generateKafkaStreamsProperties', () => {
    it('应该生成完整 Properties 文件', () => {
      const topology = createKafkaStreamsTopology('gen-app')
        .source('in', {
          consumerConfig: {
            groupId: 'gen-app',
            enableAutoCommit: false,
            autoCommitIntervalMs: 5000,
            sessionTimeoutMs: 30000,
            isolationLevel: 'read_committed',
            autoOffsetReset: 'earliest',
          },
        })
        .sink('out', {
          producerConfig: {
            acks: 'all',
            compressionType: 'snappy',
            retries: 10,
            idempotent: true,
          },
        })
        .build();
      const opts = createKafkaStreamsDeployOptions({
        applicationId: 'gen-app',
        bootstrapServers: ['broker1:9092', 'broker2:9092'],
        topology,
      });
      const props = generateKafkaStreamsProperties(opts, topology);
      expect(props).toContain('application.id=gen-app');
      expect(props).toContain('bootstrap.servers=broker1:9092,broker2:9092');
      expect(props).toContain('processing.guarantee=exactly_once');
      expect(props).toContain('group.id=gen-app');
      expect(props).toContain('enable.auto.commit=false');
      expect(props).toContain('isolation.level=read_committed');
      expect(props).toContain('acks=all');
      expect(props).toContain('compression.type=snappy');
      expect(props).toContain('enable.idempotence=true');
    });
  });

  describe('serializeKafkaStreamsTopology', () => {
    it('应该序列化为 YAML', () => {
      const topology = createKafkaStreamsTopology('yaml-app')
        .source('input')
        .filter('value > 0')
        .sink('output')
        .build();
      const yaml = serializeKafkaStreamsTopology(topology);
      expect(yaml).toContain('apiVersion:');
      expect(yaml).toContain('kind: KafkaConnector');
      expect(yaml).toContain('applicationId: yaml-app');
      expect(yaml).toContain('processingGuarantee: exactly_once');
      expect(yaml).toContain('type: source');
      expect(yaml).toContain('type: sink');
      expect(yaml).toContain('relationship: forward');
    });
  });

  describe('processStream - 流处理模拟', () => {
    it('应该处理基本流并返回结果', async () => {
      const topology = createKafkaStreamsTopology('proc-app')
        .source('in')
        .filter('value !== null')
        .sink('out')
        .build();
      const records: StreamRecord<string, number>[] = [
        { key: 'k1', value: 1, timestamp: 1000, topic: 'in', partition: 0, offset: 0 },
        { key: 'k1', value: 2, timestamp: 2000, topic: 'in', partition: 0, offset: 1 },
        { key: 'k1', value: 3, timestamp: 3000, topic: 'in', partition: 0, offset: 2 },
      ];
      const result = await processStream(records, { topology });
      expect(result.records.length).toBe(3);
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('应该过滤掉 null/undefined 值', async () => {
      const topology = createKafkaStreamsTopology('flt-app')
        .source('in')
        .filter('value !== null')
        .sink('out')
        .build();
      const records: StreamRecord<string, number | null>[] = [
        { key: 'k1', value: 1, timestamp: 1000, topic: 'in', partition: 0, offset: 0 },
        { key: 'k2', value: null, timestamp: 1500, topic: 'in', partition: 0, offset: 1 },
        { key: 'k3', value: 3, timestamp: 2000, topic: 'in', partition: 0, offset: 2 },
      ];
      const result = await processStream(records, { topology });
      expect(result.records.length).toBe(2);
    });

    it('应该生成窗口化结果（包含 window 算子）', async () => {
      const topology = createKafkaStreamsTopology('win-app')
        .source('in')
        .window('tumbling', 60000)
        .sink('out')
        .build();
      const baseTime = 1700000000000;
      const records: StreamRecord<string, number>[] = [
        { key: 'k1', value: 1, timestamp: baseTime, topic: 'in', partition: 0, offset: 0 },
        { key: 'k1', value: 2, timestamp: baseTime + 10000, topic: 'in', partition: 0, offset: 1 },
        { key: 'k2', value: 5, timestamp: baseTime + 70000, topic: 'in', partition: 0, offset: 2 },
      ];
      const result = await processStream(records, { topology });
      expect(result.windowedResults).toBeDefined();
      expect(result.windowedResults!.length).toBeGreaterThan(0);
    });
  });
});
