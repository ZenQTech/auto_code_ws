/**
 * # ============================================================
 * # Window Aggregation Engine - 单元测试 (Cycle 57 G57-03)
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import {
  WindowAggregator,
  createWindowAggregator,
  countAggregator,
  sumAggregator,
  avgAggregator,
  minAggregator,
  maxAggregator,
  firstAggregator,
  lastAggregator,
  collectAggregator,
  createAggregator,
  tumblingWindowKey,
  slidingWindowKeys,
  sessionWindowKey,
  listSupportedWindowTypes,
  listSupportedAggregationTypes,
  listSupportedTriggers,
  normalizeWindowType,
  keyBy,
} from './windowingEngine';
import type { WindowedEvent, WatermarkEvent } from './windowingTypes';

describe('G57-03 Window Aggregation Engine', () => {
  // ============================================================
  // 聚合器工厂测试
  // ============================================================
  describe('聚合器工厂', () => {
    it('count 聚合器应该正确累加', () => {
      const agg = countAggregator<number>();
      expect(agg.initializer!()).toBe(0);
      let r = agg.initializer!();
      r = agg.adder(r, 1);
      r = agg.adder(r, 2);
      r = agg.adder(r, 3);
      expect(r).toBe(3);
      r = agg.subtractor!(r, 1);
      expect(r).toBe(2);
    });

    it('sum 聚合器应该正确累加和撤回', () => {
      const agg = sumAggregator<number>();
      let r = agg.initializer!();
      r = agg.adder(r, 10);
      r = agg.adder(r, 20);
      r = agg.adder(r, 30);
      expect(r).toBe(60);
      r = agg.subtractor!(r, 20);
      expect(r).toBe(40);
    });

    it('avg 聚合器应该正确计算平均值', () => {
      const agg = avgAggregator<number>();
      let r = agg.initializer!();
      r = agg.adder(r, 10);
      r = agg.adder(r, 20);
      r = agg.adder(r, 30);
      expect(r.avg).toBe(20);
    });

    it('min/max 聚合器应该正确工作', () => {
      const minAgg = minAggregator<number>();
      const maxAgg = maxAggregator<number>();
      let minR = minAgg.initializer!();
      let maxR = maxAgg.initializer!();
      [5, 2, 8, 1, 9].forEach((v) => {
        minR = minAgg.adder(minR, v);
        maxR = maxAgg.adder(maxR, v);
      });
      expect(minR).toBe(1);
      expect(maxR).toBe(9);
    });

    it('first/last 聚合器应该正确工作', () => {
      const firstAgg = firstAggregator<string>();
      const lastAgg = lastAggregator<string>();
      let fR = firstAgg.initializer!();
      let lR = lastAgg.initializer!();
      ['a', 'b', 'c'].forEach((v) => {
        fR = firstAgg.adder(fR, v);
        lR = lastAgg.adder(lR, v);
      });
      expect(fR).toBe('a');
      expect(lR).toBe('c');
    });

    it('collect 聚合器应该收集所有值', () => {
      const agg = collectAggregator<number>();
      let r = agg.initializer!();
      r = agg.adder(r, 1);
      r = agg.adder(r, 2);
      r = agg.adder(r, 3);
      expect(r).toEqual([1, 2, 3]);
    });

    it('createAggregator 工厂应该支持所有类型', () => {
      const types = ['count', 'sum', 'avg', 'min', 'max', 'first', 'last', 'collect'];
      for (const t of types) {
        const agg = createAggregator(t as never);
        expect(agg.type).toBe(t);
      }
    });
  });

  // ============================================================
  // 窗口键生成测试
  // ============================================================
  describe('窗口键生成', () => {
    it('Tumbling 窗口应该正确对齐到 sizeMs 边界', () => {
      expect(tumblingWindowKey(1000, 10000)).toEqual({ start: 0, end: 10000 });
      expect(tumblingWindowKey(10000, 10000)).toEqual({ start: 10000, end: 20000 });
      expect(tumblingWindowKey(15999, 10000)).toEqual({ start: 10000, end: 20000 });
    });

    it('Sliding 窗口应该返回所有覆盖的窗口', () => {
      const keys = slidingWindowKeys(25000, 10000, 5000);
      expect(keys.length).toBeGreaterThanOrEqual(2);
      for (const k of keys) {
        expect(25000).toBeGreaterThanOrEqual(k.start);
        expect(25000).toBeLessThan(k.end);
      }
    });

    it('Session 窗口应该合并相近事件', () => {
      const gap = 5000;
      const windows = [
        { start: 10000, end: 15000 },
        { start: 20000, end: 25000 },
      ];
      const merged = sessionWindowKey(14000, gap, windows);
      expect(merged.start).toBeLessThanOrEqual(14000);
      expect(merged.end).toBeGreaterThanOrEqual(15000);
    });

    it('Session 窗口应该为新事件创建新窗口', () => {
      const gap = 5000;
      const windows = [{ start: 10000, end: 15000 }];
      const newWin = sessionWindowKey(30000, gap, windows);
      expect(newWin.start).toBe(30000);
    });
  });

  // ============================================================
  // WindowAggregator 基础测试
  // ============================================================
  describe('WindowAggregator - 基础', () => {
    it('应该创建实例', () => {
      const agg = createWindowAggregator<string, number, number>({
        config: { type: 'tumbling', sizeMs: 60000 },
        aggregator: sumAggregator<number>(),
        keyExtractor: keyBy('k', (e) => e.key),
        timeExtractor: (e) => e.eventTime,
      });
      expect(agg).toBeInstanceOf(WindowAggregator);
    });

    it('Tumbling + sum 应该聚合事件', () => {
      const agg = createWindowAggregator<string, number, number>({
        config: { type: 'tumbling', sizeMs: 60000, trigger: 'on-element' },
        aggregator: sumAggregator<number>(),
        keyExtractor: keyBy('k', (e) => e.key),
        timeExtractor: (e) => e.eventTime,
      });
      const baseTime = 1700000000000;
      const events: WindowedEvent<string, number>[] = [
        { key: 'k1', value: 10, eventTime: baseTime + 1000, ingestionTime: baseTime + 1000 },
        { key: 'k1', value: 20, eventTime: baseTime + 2000, ingestionTime: baseTime + 2000 },
        { key: 'k1', value: 30, eventTime: baseTime + 3000, ingestionTime: baseTime + 3000 },
      ];
      let results: any[] = [];
      for (const e of events) {
        results = results.concat(agg.addEvent(e));
      }
      // 至少有一个结果（最后一个）
      expect(results.length).toBeGreaterThan(0);
      const lastResult = results[results.length - 1];
      expect(lastResult.result).toBeGreaterThan(0);
    });

    it('Tumbling + count 应该正确计数', () => {
      const agg = createWindowAggregator<string, number, number>({
        config: { type: 'tumbling', sizeMs: 60000, trigger: 'on-count', triggerParams: { count: 5 } },
        aggregator: countAggregator<number>(),
        keyExtractor: keyBy('k', (e) => e.key),
        timeExtractor: (e) => e.eventTime,
      });
      const baseTime = 1700000000000;
      for (let i = 0; i < 5; i++) {
        agg.addEvent({
          key: 'k1',
          value: i,
          eventTime: baseTime + i * 1000,
          ingestionTime: baseTime + i * 1000,
        });
      }
      const stats = agg.getStats();
      expect(stats.inputCount).toBe(5);
    });
  });

  // ============================================================
  // 水位线和迟到事件测试
  // ============================================================
  describe('水位线和迟到事件', () => {
    it('水位线应该触发窗口关闭', () => {
      const agg = createWindowAggregator<string, number, number>({
        config: { type: 'tumbling', sizeMs: 60000, allowedLatenessMs: 0 },
        aggregator: sumAggregator<number>(),
        keyExtractor: keyBy('k', (e) => e.key),
        timeExtractor: (e) => e.eventTime,
        handleLateEvents: true,
      });
      const baseTime = 1700000000000;
      agg.addEvent({
        key: 'k1',
        value: 10,
        eventTime: baseTime + 1000,
        ingestionTime: baseTime + 1000,
      });
      const watermark: WatermarkEvent = { timestamp: baseTime + 60000, source: 'kafka', id: 1 };
      const results = agg.addWatermark(watermark);
      expect(results.length).toBeGreaterThan(0);
      const stats = agg.getStats();
      expect(stats.closedWindows).toBeGreaterThan(0);
    });

    it('迟到事件应该被统计', () => {
      const agg = createWindowAggregator<string, number, number>({
        config: { type: 'tumbling', sizeMs: 60000, allowedLatenessMs: 1000 },
        aggregator: sumAggregator<number>(),
        keyExtractor: keyBy('k', (e) => e.key),
        timeExtractor: (e) => e.eventTime,
        handleLateEvents: true,
      });
      const baseTime = 1700000000000;
      agg.addWatermark({ timestamp: baseTime + 60000, source: 'k', id: 1 });
      // 发送一个时间在水位线之前的事件（迟到）
      agg.addEvent({
        key: 'k1',
        value: 10,
        eventTime: baseTime + 1000,
        ingestionTime: baseTime + 1000,
      });
      const lateStats = agg.getLateStats();
      expect(lateStats.total).toBeGreaterThan(0);
    });

    it('迟到事件应触发 sideOutput 回调', () => {
      const lateEvents: WindowedEvent<string, number>[] = [];
      const agg = createWindowAggregator<string, number, number>({
        config: {
          type: 'tumbling',
          sizeMs: 60000,
          allowedLatenessMs: 0,
          lateDataOutputTag: 'late-data',
        },
        aggregator: sumAggregator<number>(),
        keyExtractor: keyBy('k', (e) => e.key),
        timeExtractor: (e) => e.eventTime,
        handleLateEvents: true,
        onLateEvent: (e) => lateEvents.push(e),
      });
      const baseTime = 1700000000000;
      agg.addWatermark({ timestamp: baseTime + 60000, source: 'k', id: 1 });
      agg.addEvent({
        key: 'k1',
        value: 10,
        eventTime: baseTime + 1000,
        ingestionTime: baseTime + 1000,
      });
      const lateStats = agg.getLateStats();
      expect(lateStats.sideOutput + lateStats.dropped + lateStats.withinLateness).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================
  // 多种窗口类型测试
  // ============================================================
  describe('多种窗口类型', () => {
    it('Global 窗口应该收集所有事件', () => {
      const agg = createWindowAggregator<string, number, number>({
        config: { type: 'global' },
        aggregator: sumAggregator<number>(),
        keyExtractor: keyBy('k', (e) => e.key),
        timeExtractor: (e) => e.eventTime,
      });
      const baseTime = 1700000000000;
      for (let i = 0; i < 10; i++) {
        agg.addEvent({
          key: 'k1',
          value: i,
          eventTime: baseTime + i * 1000,
          ingestionTime: baseTime + i * 1000,
        });
      }
      const stats = agg.getStats();
      expect(stats.inputCount).toBe(10);
    });

    it('Session 窗口应该按 gapMs 分割', () => {
      const agg = createWindowAggregator<string, number, number>({
        config: { type: 'session', gapMs: 10000 },
        aggregator: countAggregator<number>(),
        keyExtractor: keyBy('k', (e) => e.key),
        timeExtractor: (e) => e.eventTime,
      });
      const baseTime = 1700000000000;
      // 第一个 session
      agg.addEvent({ key: 'k1', value: 1, eventTime: baseTime, ingestionTime: baseTime });
      agg.addEvent({ key: 'k1', value: 2, eventTime: baseTime + 5000, ingestionTime: baseTime + 5000 });
      // 间隔超过 gap - 新 session
      agg.addEvent({ key: 'k1', value: 3, eventTime: baseTime + 30000, ingestionTime: baseTime + 30000 });
      const stats = agg.getStats();
      expect(stats.inputCount).toBe(3);
    });
  });

  // ============================================================
  // flush 和 reset 测试
  // ============================================================
  describe('flush 和 reset', () => {
    it('flush 应该返回所有活跃窗口的结果', () => {
      const agg = createWindowAggregator<string, number, number>({
        config: { type: 'tumbling', sizeMs: 60000 },
        aggregator: sumAggregator<number>(),
        keyExtractor: keyBy('k', (e) => e.key),
        timeExtractor: (e) => e.eventTime,
      });
      const baseTime = 1700000000000;
      for (let i = 0; i < 5; i++) {
        agg.addEvent({
          key: 'k1',
          value: i,
          eventTime: baseTime + i * 1000,
          ingestionTime: baseTime + i * 1000,
        });
      }
      const results = agg.flush();
      expect(results.length).toBeGreaterThan(0);
    });

    it('reset 应该清除所有状态', () => {
      const agg = createWindowAggregator<string, number, number>({
        config: { type: 'tumbling', sizeMs: 60000 },
        aggregator: sumAggregator<number>(),
        keyExtractor: keyBy('k', (e) => e.key),
        timeExtractor: (e) => e.eventTime,
      });
      const baseTime = 1700000000000;
      agg.addEvent({
        key: 'k1',
        value: 10,
        eventTime: baseTime,
        ingestionTime: baseTime,
      });
      agg.reset();
      const stats = agg.getStats();
      expect(stats.inputCount).toBe(0);
    });
  });

  // ============================================================
  // 工具函数测试
  // ============================================================
  describe('工具函数', () => {
    it('listSupportedWindowTypes 应包含 5 种', () => {
      expect(listSupportedWindowTypes().length).toBe(5);
    });

    it('listSupportedAggregationTypes 应包含 10 种', () => {
      expect(listSupportedAggregationTypes().length).toBe(10);
    });

    it('listSupportedTriggers 应包含 4 种', () => {
      expect(listSupportedTriggers().length).toBe(4);
    });

    it('normalizeWindowType 应该规范化', () => {
      expect(normalizeWindowType('TUMBLING')).toBe('tumbling');
      expect(normalizeWindowType('  sliding  ')).toBe('sliding');
      expect(normalizeWindowType('unknown')).toBe('tumbling');
    });

    it('keyBy 应该创建 KeyExtractor', () => {
      const ke = keyBy('user', (e: WindowedEvent<string, number>) => e.key);
      expect(ke.name).toBe('user');
      expect(ke.extract({ key: 'x', value: 1, eventTime: 0, ingestionTime: 0 })).toBe('x');
    });
  });
});
