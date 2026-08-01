/**
 * # ============================================================
 * # CloudEvents - 单元测试 (Cycle 56 G56-04)
 * # ====================================
 */

import { describe, it, expect } from 'vitest';
import {
  validateCloudEvent,
  createCloudEvent,
  generateCloudEventId,
  serializeCloudEventJson,
  parseCloudEventJson,
  toHttpBinding,
  fromHttpBinding,
  toKafkaBinding,
  fromKafkaBinding,
  matchRoute,
  matchRoutes,
  createSubscriber,
  matchSubscriber,
  createSource,
  createBroker,
  computeEventStats,
  COMMON_EVENT_TYPES,
} from './cloudeventsGenerator';

describe('G56-04 CloudEvents Generator', () => {
  describe('validateCloudEvent', () => {
    it('完整事件应通过', () => {
      const r = validateCloudEvent({
        id: '1',
        source: 'test',
        type: 'com.test',
        specversion: '1.0',
        time: '2026-08-01T12:00:00Z',
        data: { foo: 'bar' },
        datacontenttype: 'application/json',
      });
      expect(r.valid).toBe(true);
    });

    it('缺 id 应失败', () => {
      const r = validateCloudEvent({
        id: '',
        source: 'test',
        type: 'com.test',
        specversion: '1.0',
      });
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes('id'))).toBe(true);
    });

    it('错误 specversion 应失败', () => {
      const r = validateCloudEvent({
        id: '1',
        source: 'test',
        type: 'com.test',
        specversion: '2.0' as '1.0',
      });
      expect(r.valid).toBe(false);
    });

    it('time 格式错误应失败', () => {
      const r = validateCloudEvent({
        id: '1',
        source: 'test',
        type: 'com.test',
        specversion: '1.0',
        time: 'invalid',
      });
      expect(r.valid).toBe(false);
    });

    it('data + data_base64 同时存在应失败', () => {
      const r = validateCloudEvent({
        id: '1',
        source: 'test',
        type: 'com.test',
        specversion: '1.0',
        data: { foo: 'bar' },
        data_base64: 'abcd',
      });
      expect(r.valid).toBe(false);
    });

    it('data 存在但无 datacontenttype 应警告', () => {
      const r = validateCloudEvent({
        id: '1',
        source: 'test',
        type: 'com.test',
        specversion: '1.0',
        data: { foo: 'bar' },
      });
      expect(r.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('createCloudEvent', () => {
    it('应自动生成 id 和 time', () => {
      const e = createCloudEvent({ source: 'test', type: 'com.test' });
      expect(e.id).toBeTruthy();
      expect(e.time).toBeTruthy();
      expect(e.specversion).toBe('1.0');
    });

    it('应注入 data 和 datacontenttype', () => {
      const e = createCloudEvent({
        source: 'test',
        type: 'com.test',
        data: { foo: 'bar' },
        datacontenttype: 'application/json',
      });
      expect(e.data).toEqual({ foo: 'bar' });
      expect(e.datacontenttype).toBe('application/json');
    });

    it('应支持扩展属性', () => {
      const e = createCloudEvent({
        source: 'test',
        type: 'com.test',
        extensions: { region: 'us-east-1', priority: 5 },
      });
      expect(e['region']).toBe('us-east-1');
      expect(e['priority']).toBe(5);
    });
  });

  describe('generateCloudEventId', () => {
    it('应生成唯一 ID', () => {
      const id1 = generateCloudEventId();
      const id2 = generateCloudEventId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('serializeCloudEventJson / parseCloudEventJson', () => {
    it('应支持往返序列化', () => {
      const e = createCloudEvent({
        source: 'test',
        type: 'com.test',
        data: { foo: 'bar' },
        datacontenttype: 'application/json',
      });
      const json = serializeCloudEventJson(e);
      const parsed = parseCloudEventJson(json);
      expect(parsed.id).toBe(e.id);
      expect(parsed.source).toBe('test');
      expect(parsed.data).toEqual({ foo: 'bar' });
    });

    it('无效事件应抛错', () => {
      expect(() =>
        serializeCloudEventJson({
          id: '',
          source: 'test',
          type: 't',
          specversion: '1.0',
        })
      ).toThrow();
    });
  });

  describe('toHttpBinding / fromHttpBinding', () => {
    it('应转换为 HTTP 头格式', () => {
      const e = createCloudEvent({
        source: '/orders',
        type: 'order.placed',
        data: { id: 1 },
        datacontenttype: 'application/json',
      });
      const binding = toHttpBinding(e);
      expect(binding.headers['ce-id']).toBe(e.id);
      expect(binding.headers['ce-source']).toBe('/orders');
      expect(binding.headers['ce-type']).toBe('order.placed');
      expect(binding.body).toContain('"id":1');
    });

    it('应从 HTTP 头还原', () => {
      const e = createCloudEvent({
        source: '/orders',
        type: 'order.placed',
        data: { id: 1 },
        datacontenttype: 'application/json',
      });
      const binding = toHttpBinding(e);
      const restored = fromHttpBinding(binding);
      expect(restored.id).toBe(e.id);
      expect(restored.source).toBe('/orders');
    });

    it('应保留扩展属性', () => {
      const e = createCloudEvent({
        source: 'test',
        type: 'com.test',
        extensions: { region: 'cn-north-1' },
      });
      const binding = toHttpBinding(e);
      expect(binding.headers['ce-region']).toBe('cn-north-1');
      const restored = fromHttpBinding(binding);
      expect(restored['region']).toBe('cn-north-1');
    });
  });

  describe('toKafkaBinding / fromKafkaBinding', () => {
    it('应转换 Kafka 消息', () => {
      const e = createCloudEvent({
        source: '/orders',
        type: 'order.placed',
        data: { id: 1 },
        subject: 'order-1',
      });
      const binding = toKafkaBinding(e, 'orders');
      expect(binding.topic).toBe('orders');
      expect(binding.key).toBe('order-1');
      expect(binding.headers['ce-type']).toBe('order.placed');
    });
  });

  describe('matchRoute', () => {
    it('完全匹配应通过', () => {
      const e = createCloudEvent({ source: '/orders', type: 'order.placed' });
      const matched = matchRoute(e, {
        id: '1',
        source: '/orders',
        type: 'order.placed',
        sink: { type: 'http', url: 'http://sink' },
        enabled: true,
      });
      expect(matched).toBe(true);
    });

    it('通配符应匹配', () => {
      const e = createCloudEvent({ source: '/orders', type: 'order.placed' });
      const matched = matchRoute(e, {
        id: '1',
        source: '*',
        type: '*',
        sink: { type: 'http', url: 'http://sink' },
        enabled: true,
      });
      expect(matched).toBe(true);
    });

    it('禁用路由不匹配', () => {
      const e = createCloudEvent({ source: '/orders', type: 'order.placed' });
      const matched = matchRoute(e, {
        id: '1',
        source: '/orders',
        type: 'order.placed',
        sink: { type: 'http', url: 'http://sink' },
        enabled: false,
      });
      expect(matched).toBe(false);
    });

    it('subject 过滤应工作', () => {
      const e = createCloudEvent({ source: '/x', type: 't', subject: 'order-1' });
      const matched = matchRoute(e, {
        id: '1',
        source: '/x',
        type: 't',
        subject: 'order-1',
        sink: { type: 'http', url: 'http://sink' },
        enabled: true,
      });
      expect(matched).toBe(true);
    });
  });

  describe('matchRoutes', () => {
    it('应返回所有匹配路由', () => {
      const e = createCloudEvent({ source: '/orders', type: 'order.placed' });
      const routes: ReturnType<typeof matchRoutes> = matchRoutes(e, [
        { id: '1', source: '/orders', type: '*', sink: { type: 'http', url: 'http://a' }, enabled: true },
        { id: '2', source: '*', type: 'order.placed', sink: { type: 'http', url: 'http://b' }, enabled: true },
        { id: '3', source: '/users', type: '*', sink: { type: 'http', url: 'http://c' }, enabled: true },
      ]);
      expect(routes).toHaveLength(2);
    });
  });

  describe('createSubscriber / matchSubscriber', () => {
    it('应创建订阅者', () => {
      const sub = createSubscriber({
        name: 'webhook-1',
        protocol: 'http',
        endpoint: 'http://webhook',
        filters: { type: 'order.*' },
      });
      expect(sub.protocol).toBe('http');
      expect(sub.status).toBe('active');
    });

    it('订阅者过滤应工作', () => {
      const sub = createSubscriber({
        name: 'sub-1',
        protocol: 'http',
        endpoint: 'http://e',
        filters: { type: 'order.*' },
      });
      const e = createCloudEvent({ source: 's', type: 'order.placed' });
      expect(matchSubscriber(e, sub)).toBe(true);
    });

    it('暂停订阅者不匹配', () => {
      const sub = createSubscriber({ name: 'sub-1', protocol: 'http', endpoint: 'http://e' });
      sub.status = 'paused';
      const e = createCloudEvent({ source: 's', type: 't' });
      expect(matchSubscriber(e, sub)).toBe(false);
    });
  });

  describe('createSource', () => {
    it('应创建 webhook 源', () => {
      const s = createSource({
        name: 'webhook-orders',
        type: 'webhook',
        connection: { url: 'http://webhook' },
      });
      expect(s.type).toBe('webhook');
      expect(s.status).toBe('active');
    });
  });

  describe('createBroker', () => {
    it('应创建事件总线', () => {
      const b = createBroker({
        name: 'main-broker',
        type: 'kafka',
        endpoint: 'kafka:9092',
      });
      expect(b.health).toBe('healthy');
      expect(b.throughputEps).toBe(0);
    });
  });

  describe('computeEventStats', () => {
    it('应正确计算统计', () => {
      const events = [
        createCloudEvent({ source: 'a', type: 't1' }),
        createCloudEvent({ source: 'a', type: 't1' }),
        createCloudEvent({ source: 'b', type: 't2' }),
      ];
      const stats = computeEventStats(events);
      expect(stats.total).toBe(3);
      expect(stats.byType['t1']).toBe(2);
      expect(stats.byType['t2']).toBe(1);
      expect(stats.bySource['a']).toBe(2);
    });

    it('空数组应返回零统计', () => {
      const stats = computeEventStats([]);
      expect(stats.total).toBe(0);
      expect(stats.uniqueIds).toBe(0);
    });
  });

  describe('COMMON_EVENT_TYPES', () => {
    it('应包含 10 个常用事件类型', () => {
      const keys = Object.keys(COMMON_EVENT_TYPES);
      expect(keys.length).toBe(10);
    });
  });
});
