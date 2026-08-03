/**
 * # ============================================================
 * # Exactly-Once Semantics - 单元测试 (Cycle 57 G57-04)
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import {
  validateTransactionalProducerConfig,
  validateIdempotentConsumerConfig,
  TransactionContextManager,
  TransactionalProducer,
  IdempotentConsumer,
  InMemoryDedupStore,
  ExactlyOnceProcessor,
  createExactlyOnceProcessor,
  generateTransactionalProducerProperties,
  generateIdempotentConsumerProperties,
  listSupportedSemantics,
  listSupportedIdempotenceLevels,
  normalizeSemantics,
} from './exactlyOnceEngine';
import type {
  TransactionalProducerConfig,
  IdempotentConsumerConfig,
  TransactionalRecord,
  ExactlyOnceOptions,
} from './exactlyOnceTypes';

const baseProducerConfig: TransactionalProducerConfig = {
  bootstrapServers: ['localhost:9092'],
  transactionalId: 'tx-test-1',
  transactionTimeoutMs: 60000,
  enableIdempotence: true,
  acks: 'all',
  maxInFlightRequestsPerConnection: 5,
  retries: 10,
};

const baseConsumerConfig: IdempotentConsumerConfig = {
  bootstrapServers: ['localhost:9092'],
  groupId: 'g1',
  topics: ['in'],
  isolationLevel: 'read_committed',
  enableAutoCommit: false,
  autoCommitIntervalMs: 5000,
  dedupStore: 'memory',
  dedupKey: 'offset',
  autoOffsetReset: 'earliest',
};

describe('G57-04 Exactly-Once Semantics', () => {
  // ============================================================
  // 配置校验测试
  // ============================================================
  describe('validateTransactionalProducerConfig', () => {
    it('应该通过合法配置', () => {
      const r = validateTransactionalProducerConfig(baseProducerConfig);
      expect(r.valid).toBe(true);
    });

    it('bootstrapServers 必填', () => {
      const r = validateTransactionalProducerConfig({
        ...baseProducerConfig,
        bootstrapServers: [],
      });
      expect(r.valid).toBe(false);
    });

    it('transactionalId 必填', () => {
      const r = validateTransactionalProducerConfig({
        ...baseProducerConfig,
        transactionalId: '',
      });
      expect(r.valid).toBe(false);
    });

    it('transactionTimeoutMs 必须 >= 1000', () => {
      const r = validateTransactionalProducerConfig({
        ...baseProducerConfig,
        transactionTimeoutMs: 500,
      });
      expect(r.valid).toBe(false);
    });

    it('transactionTimeoutMs 必须 <= 900000', () => {
      const r = validateTransactionalProducerConfig({
        ...baseProducerConfig,
        transactionTimeoutMs: 1200000,
      });
      expect(r.valid).toBe(false);
    });

    it('enableIdempotence=true 时 maxInFlight 必须 <= 5', () => {
      const r = validateTransactionalProducerConfig({
        ...baseProducerConfig,
        maxInFlightRequestsPerConnection: 10,
      });
      expect(r.valid).toBe(false);
    });

    it('事务性生产者必须 acks=all', () => {
      const r = validateTransactionalProducerConfig({
        ...baseProducerConfig,
        acks: '1',
      });
      expect(r.valid).toBe(false);
    });
  });

  describe('validateIdempotentConsumerConfig', () => {
    it('应该通过合法配置', () => {
      const r = validateIdempotentConsumerConfig(baseConsumerConfig);
      expect(r.valid).toBe(true);
    });

    it('groupId 必填', () => {
      const r = validateIdempotentConsumerConfig({
        ...baseConsumerConfig,
        groupId: '',
      });
      expect(r.valid).toBe(false);
    });

    it('topics 必填', () => {
      const r = validateIdempotentConsumerConfig({
        ...baseConsumerConfig,
        topics: [],
      });
      expect(r.valid).toBe(false);
    });
  });

  // ============================================================
  // TransactionContextManager 测试
  // ============================================================
  describe('TransactionContextManager', () => {
    it('应该初始化事务', () => {
      const mgr = new TransactionContextManager();
      const ctx = mgr.initTransaction('tx-1', 60000);
      expect(ctx.transactionalId).toBe('tx-1');
      expect(ctx.state).toBe('ready');
      expect(ctx.producerId).toBeGreaterThan(0);
    });

    it('应该开始/提交事务', () => {
      const mgr = new TransactionContextManager();
      mgr.initTransaction('tx-1', 60000);
      const ctx = mgr.begin('tx-1');
      expect(ctx.state).toBe('in-transaction');
      mgr.recordWrite('tx-1', 'topic1', 0);
      expect(mgr.get('tx-1')!.bufferedRecords).toBe(1);
      const committed = mgr.commit('tx-1');
      expect(committed.state).toBe('committed');
    });

    it('应该中止事务', () => {
      const mgr = new TransactionContextManager();
      mgr.initTransaction('tx-1', 60000);
      mgr.begin('tx-1');
      mgr.recordWrite('tx-1', 'topic1', 0);
      const aborted = mgr.abort('tx-1');
      expect(aborted.state).toBe('aborted');
    });

    it('应该正确处理未初始化的事务', () => {
      const mgr = new TransactionContextManager();
      expect(() => mgr.begin('not-initialized')).toThrow();
    });

    it('应该列出活动事务', () => {
      const mgr = new TransactionContextManager();
      mgr.initTransaction('tx-1', 60000);
      mgr.initTransaction('tx-2', 60000);
      mgr.begin('tx-1');
      mgr.begin('tx-2');
      const active = mgr.listActive();
      expect(active.length).toBe(2);
    });
  });

  // ============================================================
  // InMemoryDedupStore 测试
  // ============================================================
  describe('InMemoryDedupStore', () => {
    it('应该检测重复', () => {
      const store = new InMemoryDedupStore();
      expect(store.has('key1')).toBe(false);
      store.mark('key1');
      expect(store.has('key1')).toBe(true);
    });

    it('应该限制最大容量', () => {
      const store = new InMemoryDedupStore(3);
      store.mark('k1');
      store.mark('k2');
      store.mark('k3');
      store.mark('k4'); // 应该触发 LRU
      expect(store.size()).toBeLessThanOrEqual(3);
    });

    it('应该支持 TTL 清理', () => {
      const store = new InMemoryDedupStore();
      store.mark('k1', -1); // 已过期
      store.cleanup();
      expect(store.has('k1')).toBe(false);
    });
  });

  // ============================================================
  // TransactionalProducer 测试
  // ============================================================
  describe('TransactionalProducer', () => {
    it('应该开始/提交事务', () => {
      const producer = new TransactionalProducer<string, number>(baseProducerConfig);
      producer.begin();
      producer.send({ key: 'k1', value: 1, topic: 'out', partition: 0, offset: 0, timestamp: 0 });
      producer.send({ key: 'k2', value: 2, topic: 'out', partition: 0, offset: 0, timestamp: 0 });
      const ctx = producer.commit();
      expect(ctx.state).toBe('committed');
      expect(producer.getStats().records).toBe(2);
    });

    it('未开始事务发送应抛错', () => {
      const producer = new TransactionalProducer<string, number>(baseProducerConfig);
      expect(() =>
        producer.send({ key: 'k1', value: 1, topic: 'out', partition: 0, offset: 0, timestamp: 0 })
      ).toThrow();
    });

    it('应该支持事务中止', () => {
      const producer = new TransactionalProducer<string, number>(baseProducerConfig);
      producer.begin();
      producer.send({ key: 'k1', value: 1, topic: 'out', partition: 0, offset: 0, timestamp: 0 });
      const ctx = producer.abort();
      expect(ctx.state).toBe('aborted');
    });
  });

  // ============================================================
  // IdempotentConsumer 测试
  // ============================================================
  describe('IdempotentConsumer', () => {
    it('应该处理新记录', () => {
      const consumer = new IdempotentConsumer<string, number>(baseConsumerConfig);
      const record: TransactionalRecord<string, number> = {
        key: 'k1',
        value: 1,
        topic: 'in',
        partition: 0,
        offset: 0,
        timestamp: 0,
      };
      expect(consumer.shouldProcess(record)).toBe(true);
      expect(consumer.shouldProcess(record)).toBe(false);
    });

    it('应该使用 messageId 去重', () => {
      const consumer = new IdempotentConsumer<string, number>({
        ...baseConsumerConfig,
        dedupKey: 'message-id',
      });
      const record: TransactionalRecord<string, number> = {
        key: 'k1',
        value: 1,
        topic: 'in',
        partition: 0,
        offset: 0,
        timestamp: 0,
        messageId: 'msg-1',
      };
      expect(consumer.shouldProcess(record)).toBe(true);
      expect(consumer.shouldProcess(record)).toBe(false);
    });

    it('应该提交偏移量', () => {
      const consumer = new IdempotentConsumer<string, number>(baseConsumerConfig);
      consumer.commitOffsets({ 'in-0': 100 });
      expect(consumer.getCommittedOffsets()).toEqual({ 'in-0': 100 });
    });
  });

  // ============================================================
  // ExactlyOnceProcessor 测试
  // ============================================================
  describe('ExactlyOnceProcessor - exactly-once 语义', () => {
    const baseOptions: ExactlyOnceOptions = {
      semantics: 'exactly-once',
      idempotenceLevel: 'full',
      producer: baseProducerConfig,
      consumer: baseConsumerConfig,
      checkpointIntervalMs: 60000,
      checkpointTimeoutMs: 300000,
      maxInFlightCheckpoints: 1,
      enableDeduplication: true,
      enableStateSnapshot: true,
      failureStrategy: 'retry',
      maxRetries: 3,
    };

    it('应该成功处理记录', async () => {
      const processor = createExactlyOnceProcessor<string, number>(baseOptions);
      const records: TransactionalRecord<string, number>[] = [
        { key: 'k1', value: 1, topic: 'in', partition: 0, offset: 0, timestamp: 0 },
        { key: 'k2', value: 2, topic: 'in', partition: 0, offset: 1, timestamp: 0 },
        { key: 'k3', value: 3, topic: 'in', partition: 0, offset: 2, timestamp: 0 },
      ];
      const result = await processor.process(records, (r) => ({
        ...r,
        topic: 'out',
      }));
      expect(result.success).toBe(true);
      expect(result.outputs.length).toBe(3);
      expect(result.semantics).toBe('exactly-once');
    });

    it('应该检测重复记录', async () => {
      const processor = createExactlyOnceProcessor<string, number>(baseOptions);
      const records: TransactionalRecord<string, number>[] = [
        { key: 'k1', value: 1, topic: 'in', partition: 0, offset: 0, timestamp: 0 },
        { key: 'k1', value: 1, topic: 'in', partition: 0, offset: 0, timestamp: 0 }, // 重复
      ];
      const result = await processor.process(records, (r) => ({ ...r, topic: 'out' }));
      expect(result.dedupHits).toBe(1);
      expect(result.outputs.length).toBe(1);
    });

    it('应该在 processor 抛错时中止事务', async () => {
      const processor = createExactlyOnceProcessor<string, number>(baseOptions);
      const records: TransactionalRecord<string, number>[] = [
        { key: 'k1', value: 1, topic: 'in', partition: 0, offset: 0, timestamp: 0 },
      ];
      const result = await processor.process(records, () => {
        throw new Error('Processing error');
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Processing error');
    });

    it('应该触发检查点', async () => {
      const processor = createExactlyOnceProcessor<string, number>(baseOptions);
      const cp = await processor.checkpoint();
      expect(cp.state).toBe('completed');
      expect(cp.completedAt).toBeDefined();
      expect(cp.durationMs).toBeGreaterThanOrEqual(0);
      const stats = processor.getStats();
      expect(stats.checkpointsCompleted).toBe(1);
    });

    it('应该正确跟踪统计信息', async () => {
      const processor = createExactlyOnceProcessor<string, number>(baseOptions);
      const records: TransactionalRecord<string, number>[] = [
        { key: 'k1', value: 1, topic: 'in', partition: 0, offset: 0, timestamp: 0 },
        { key: 'k2', value: 2, topic: 'in', partition: 0, offset: 1, timestamp: 0 },
      ];
      await processor.process(records, (r) => ({ ...r, topic: 'out' }));
      const stats = processor.getStats();
      expect(stats.totalProcessed).toBe(2);
      expect(stats.transactionsCommitted).toBe(1);
      expect(stats.transactionsAborted).toBe(0);
    });

    it('应该支持 at-least-once 语义', async () => {
      const processor = createExactlyOnceProcessor<string, number>({
        ...baseOptions,
        semantics: 'at-least-once',
      });
      const records: TransactionalRecord<string, number>[] = [
        { key: 'k1', value: 1, topic: 'in', partition: 0, offset: 0, timestamp: 0 },
      ];
      const result = await processor.process(records, (r) => ({ ...r, topic: 'out' }));
      expect(result.semantics).toBe('at-least-once');
      expect(result.success).toBe(true);
    });

    it('应该支持 at-most-once 语义（跳过失败）', async () => {
      const processor = createExactlyOnceProcessor<string, number>({
        ...baseOptions,
        semantics: 'at-most-once',
      });
      const records: TransactionalRecord<string, number>[] = [
        { key: 'k1', value: 1, topic: 'in', partition: 0, offset: 0, timestamp: 0 },
        { key: 'k2', value: 2, topic: 'in', partition: 0, offset: 1, timestamp: 0 },
      ];
      const result = await processor.process(records, () => {
        throw new Error('fail');
      });
      expect(result.semantics).toBe('at-most-once');
      expect(result.success).toBe(true);
      expect(result.outputs.length).toBe(0);
    });

    it('应该支持 resetStats', async () => {
      const processor = createExactlyOnceProcessor<string, number>(baseOptions);
      const records: TransactionalRecord<string, number>[] = [
        { key: 'k1', value: 1, topic: 'in', partition: 0, offset: 0, timestamp: 0 },
      ];
      await processor.process(records, (r) => ({ ...r, topic: 'out' }));
      processor.resetStats();
      const stats = processor.getStats();
      expect(stats.totalProcessed).toBe(0);
    });
  });

  // ============================================================
  // Properties 文件生成测试
  // ============================================================
  describe('Properties 文件生成', () => {
    it('应该生成事务性生产者配置', () => {
      const props = generateTransactionalProducerProperties(baseProducerConfig);
      expect(props).toContain('bootstrap.servers=localhost:9092');
      expect(props).toContain('transactional.id=tx-test-1');
      expect(props).toContain('transaction.timeout.ms=60000');
      expect(props).toContain('enable.idempotence=true');
      expect(props).toContain('acks=all');
      expect(props).toContain('max.in.flight.requests.per.connection=5');
    });

    it('应该生成幂等消费者配置', () => {
      const props = generateIdempotentConsumerProperties(baseConsumerConfig);
      expect(props).toContain('bootstrap.servers=localhost:9092');
      expect(props).toContain('group.id=g1');
      expect(props).toContain('isolation.level=read_committed');
    });
  });

  // ============================================================
  // 工具函数测试
  // ============================================================
  describe('工具函数', () => {
    it('listSupportedSemantics 应包含 3 种', () => {
      expect(listSupportedSemantics().length).toBe(3);
    });

    it('listSupportedIdempotenceLevels 应包含 4 种', () => {
      expect(listSupportedIdempotenceLevels().length).toBe(4);
    });

    it('normalizeSemantics 应该规范化', () => {
      expect(normalizeSemantics('EXACTLY-ONCE')).toBe('exactly-once');
      expect(normalizeSemantics('unknown')).toBe('at-least-once');
    });
  });
});
