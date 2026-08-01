/**
 * # ============================================================
 * # KEDA Generator - 单元测试 (Cycle 56 G56-02)
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import {
  validateScalerMetadata,
  createKafkaTrigger,
  createRabbitMQTrigger,
  createPrometheusTrigger,
  createCronTrigger,
  createDatabaseTrigger,
  createRedisTrigger,
  createTriggerAuthentication,
  createScaledObject,
  buildKedaApplicationStack,
  buildKedaManifestYaml,
  listSupportedScalers,
  normalizeScalerType,
} from './kedaGenerator';

describe('G56-02 KEDA Generator', () => {
  describe('validateScalerMetadata', () => {
    it('Kafka 完整配置应通过', () => {
      const r = validateScalerMetadata({
        type: 'kafka',
        metadata: {
          bootstrapServers: 'localhost:9092',
          consumerGroup: 'g1',
          topic: 't1',
          lagThreshold: '10',
        },
      });
      expect(r.valid).toBe(true);
    });

    it('Kafka 缺字段应失败', () => {
      const r = validateScalerMetadata({
        type: 'kafka',
        metadata: { bootstrapServers: 'localhost:9092' },
      });
      expect(r.valid).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    });

    it('未知 Scaler 类型不应要求字段', () => {
      const r = validateScalerMetadata({
        type: 'unknown-scaler',
        metadata: {},
      });
      expect(r.valid).toBe(true);
    });
  });

  describe('createKafkaTrigger', () => {
    it('应生成 Kafka 触发器', () => {
      const t = createKafkaTrigger({
        name: 'kafka-events',
        bootstrapServers: 'kafka:9092',
        consumerGroup: 'g1',
        topic: 'orders',
        lagThreshold: 100,
      });
      expect(t.type).toBe('kafka');
      expect(t.metadata.bootstrapServers).toBe('kafka:9092');
      expect(t.metadata.lagThreshold).toBe('100');
      expect(t.metadata.offsetResetPolicy).toBe('latest');
    });

    it('带 authenticationRef 应注入引用', () => {
      const t = createKafkaTrigger({
        name: 'kafka-events',
        bootstrapServers: 'kafka:9092',
        consumerGroup: 'g1',
        topic: 'orders',
        lagThreshold: 100,
        authenticationRef: 'kafka-auth',
      });
      expect(t.authenticationRef?.name).toBe('kafka-auth');
      expect(t.authenticationRef?.kind).toBe('TriggerAuthentication');
    });
  });

  describe('createRabbitMQTrigger', () => {
    it('应生成 RabbitMQ 触发器', () => {
      const t = createRabbitMQTrigger({
        name: 'rmq-events',
        host: 'amqp://rmq:5672',
        queueName: 'tasks',
        mode: 'QueueLength',
        value: '20',
      });
      expect(t.type).toBe('rabbitmq');
      expect(t.metadata.queueName).toBe('tasks');
      expect(t.metadata.value).toBe('20');
    });
  });

  describe('createPrometheusTrigger', () => {
    it('应生成 Prometheus 触发器', () => {
      const t = createPrometheusTrigger({
        name: 'prom-qps',
        serverAddress: 'http://prom:9090',
        query: 'rate(http_requests_total[2m])',
        threshold: 100,
        ignoreNullValues: true,
      });
      expect(t.type).toBe('prometheus');
      expect(t.metadata.threshold).toBe('100');
      expect(t.metadata.ignoreNullValues).toBe('true');
    });
  });

  describe('createCronTrigger', () => {
    it('应生成 Cron 触发器', () => {
      const t = createCronTrigger({
        name: 'work-hours',
        schedule: '0 8 * * 1-5',
        startReplicaCount: 5,
        endReplicaCount: 0,
        timezone: 'Asia/Shanghai',
      });
      expect(t.type).toBe('cron');
      expect(t.metadata.timezone).toBe('Asia/Shanghai');
      expect(t.metadata.desiredReplicas).toBe('5');
    });
  });

  describe('createDatabaseTrigger', () => {
    it('MySQL 触发器', () => {
      const t = createDatabaseTrigger('mysql', {
        name: 'db-q',
        host: 'mysql',
        port: '3306',
        username: 'user',
        dbName: 'app',
        query: 'SELECT num FROM work_queue',
        queryValue: 'num',
        threshold: '5',
      });
      expect(t.type).toBe('mysql');
      expect(t.metadata.host).toBe('mysql');
    });

    it('PostgreSQL 触发器', () => {
      const t = createDatabaseTrigger('postgresql', {
        name: 'pg-q',
        host: 'pg',
        port: '5432',
        username: 'user',
        dbName: 'app',
        query: 'SELECT count(*) FROM jobs',
        queryValue: 'count',
        threshold: '10',
      });
      expect(t.type).toBe('postgresql');
    });
  });

  describe('createRedisTrigger', () => {
    it('list 模式', () => {
      const t = createRedisTrigger({
        name: 'redis-list',
        address: 'redis://redis:6379',
        listName: 'queue',
        listLength: '100',
      });
      expect(t.type).toBe('redis-list');
      expect(t.metadata.listName).toBe('queue');
    });

    it('stream 模式', () => {
      const t = createRedisTrigger({
        name: 'redis-stream',
        address: 'redis://redis:6379',
        stream: 'events',
        consumerGroup: 'g1',
        pendingEntriesCount: '5',
      });
      expect(t.type).toBe('redis-streams');
      expect(t.metadata.stream).toBe('events');
    });
  });

  describe('createTriggerAuthentication', () => {
    it('Secret 引用', () => {
      const auth = createTriggerAuthentication({
        name: 'kafka-auth',
        secrets: [{ parameter: 'sasl', secretName: 'kafka-secret', key: 'password' }],
      });
      expect(auth.kind).toBe('TriggerAuthentication');
      expect(auth.spec.secretTargetRef?.[0]?.parameter).toBe('sasl');
    });

    it('Pod Identity 引用', () => {
      const auth = createTriggerAuthentication({
        name: 'azure-identity',
        podIdentity: { provider: 'azure-workload', identityId: 'client-id' },
      });
      expect(auth.spec.podIdentity?.provider).toBe('azure-workload');
    });

    it('ConfigMap 引用', () => {
      const auth = createTriggerAuthentication({
        name: 'cm-auth',
        configMaps: [{ parameter: 'token', configMapName: 'config', key: 'api-token' }],
      });
      expect(auth.spec.configMapTargetRef?.[0]?.name).toBe('config');
    });
  });

  describe('createScaledObject', () => {
    it('应创建基本 ScaledObject', () => {
      const so = createScaledObject({
        name: 'worker',
        namespace: 'prod',
        workloadRef: { kind: 'Deployment', name: 'worker' },
        triggers: [
          {
            type: 'kafka',
            metadata: {
              bootstrapServers: 'kafka:9092',
              consumerGroup: 'g1',
              topic: 'tasks',
              lagThreshold: '10',
            },
          },
        ],
        minReplicaCount: 0,
        maxReplicaCount: 50,
      });
      expect(so.kind).toBe('ScaledObject');
      expect(so.spec.workloadRef.kind).toBe('Deployment');
      expect(so.spec.minReplicaCount).toBe(0);
      expect(so.spec.maxReplicaCount).toBe(50);
    });

    it('应支持 fallback 配置', () => {
      const so = createScaledObject({
        name: 'worker',
        workloadRef: { kind: 'Deployment', name: 'worker' },
        triggers: [],
        fallback: { failureThreshold: 3, replicas: 5 },
      });
      expect(so.spec.fallback?.replicas).toBe(5);
    });
  });

  describe('buildKedaApplicationStack', () => {
    it('应返回 ScaledObject + TriggerAuthentication', () => {
      const stack = buildKedaApplicationStack({
        name: 'kafka-worker',
        workloadRef: { kind: 'Deployment', name: 'kafka-worker' },
        triggers: [
          {
            type: 'kafka',
            metadata: {
              bootstrapServers: 'kafka:9092',
              consumerGroup: 'g1',
              topic: 'tasks',
              lagThreshold: '10',
            },
            authenticationRef: { name: 'kafka-auth', kind: 'TriggerAuthentication' },
          },
        ],
        triggerAuthentications: [
          {
            name: 'kafka-auth',
            secrets: [{ parameter: 'sasl', secretName: 'kafka-secret', key: 'password' }],
          },
        ],
      });
      expect(stack.scaledObject.kind).toBe('ScaledObject');
      expect(stack.triggerAuthentications).toHaveLength(1);
    });
  });

  describe('buildKedaManifestYaml', () => {
    it('应序列化为多文档 YAML', () => {
      const stack = buildKedaApplicationStack({
        name: 'kafka-worker',
        workloadRef: { kind: 'Deployment', name: 'kafka-worker' },
        triggers: [
          {
            type: 'kafka',
            metadata: {
              bootstrapServers: 'kafka:9092',
              consumerGroup: 'g1',
              topic: 'tasks',
              lagThreshold: '10',
            },
          },
        ],
      });
      const yaml = buildKedaManifestYaml(stack.scaledObject, stack.triggerAuthentications);
      expect(yaml).toContain('apiVersion: keda.sh/v1alpha1');
      expect(yaml).toContain('kind: ScaledObject');
    });
  });

  describe('listSupportedScalers', () => {
    it('应返回 30+ Scaler', () => {
      const list = listSupportedScalers();
      expect(list.length).toBeGreaterThanOrEqual(30);
    });

    it('应包含主流 Scaler', () => {
      const list = listSupportedScalers();
      expect(list).toContain('kafka');
      expect(list).toContain('rabbitmq');
      expect(list).toContain('prometheus');
      expect(list).toContain('cron');
    });
  });

  describe('normalizeScalerType', () => {
    it('应转小写', () => {
      expect(normalizeScalerType('KAFKA')).toBe('kafka');
    });

    it('应去除空格', () => {
      expect(normalizeScalerType('  prometheus  ')).toBe('prometheus');
    });
  });
});
