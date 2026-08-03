/**
 * # ============================================================
 * # Window Aggregation - 引擎 (Cycle 57 G57-03)
 * # ============================================================
 * # 核心作用：通用窗口聚合引擎
 * # 特性：Tumbling/Sliding/Session + 水位线 + 迟到事件 + 触发器
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 57 G57-03 初次创建
 * # ====================================
 */

import type {
  WindowConfig,
  WindowedEvent,
  WindowState,
  WindowResult,
  WindowAggregationOptions,
  WindowAggregationStats,
  WatermarkEvent,
  LateEventStats,
  AggregatorFunction,
  KeyExtractor,
  AggregationType,
} from './windowingTypes';

// ============================================================
// 聚合器工厂
// ============================================================

/**
 * 创建 count 聚合器
 */
export function countAggregator<V>(): AggregatorFunction<V, number> {
  return {
    type: 'count',
    initializer: () => 0,
    adder: (acc) => acc + 1,
    subtractor: (acc) => acc - 1,
  };
}

/**
 * 创建 sum 聚合器
 */
export function sumAggregator<V = number>(): AggregatorFunction<V, number> {
  return {
    type: 'sum',
    initializer: () => 0,
    adder: (acc, v) => acc + (Number(v) || 0),
    subtractor: (acc, v) => acc - (Number(v) || 0),
  };
}

/**
 * 创建 avg 聚合器（使用 sum + count 组合）
 */
export function avgAggregator<V = number>(): AggregatorFunction<V, { sum: number; count: number; avg: number }> {
  return {
    type: 'avg',
    initializer: () => ({ sum: 0, count: 0, avg: 0 }),
    adder: (acc, v) => {
      const newSum = acc.sum + (Number(v) || 0);
      const newCount = acc.count + 1;
      return { sum: newSum, count: newCount, avg: newCount > 0 ? newSum / newCount : 0 };
    },
    subtractor: (acc, v) => {
      const newSum = acc.sum - (Number(v) || 0);
      const newCount = Math.max(0, acc.count - 1);
      return { sum: newSum, count: newCount, avg: newCount > 0 ? newSum / newCount : 0 };
    },
  };
}

/**
 * 创建 min 聚合器
 */
export function minAggregator<V = number>(): AggregatorFunction<V, number> {
  return {
    type: 'min',
    initializer: () => Infinity,
    adder: (acc, v) => Math.min(acc, Number(v) || 0),
    subtractor: (acc, v) => Math.max(acc, Number(v) || 0),
  };
}

/**
 * 创建 max 聚合器
 */
export function maxAggregator<V = number>(): AggregatorFunction<V, number> {
  return {
    type: 'max',
    initializer: () => -Infinity,
    adder: (acc, v) => Math.max(acc, Number(v) || 0),
    subtractor: (acc, v) => Math.min(acc, Number(v) || 0),
  };
}

/**
 * 创建 first 聚合器
 */
export function firstAggregator<V>(): AggregatorFunction<V, V | undefined> {
  let first: V | undefined;
  let hasFirst = false;
  return {
    type: 'first',
    initializer: () => undefined,
    adder: (_acc, v) => {
      if (!hasFirst) {
        first = v;
        hasFirst = true;
      }
      return first;
    },
  };
}

/**
 * 创建 last 聚合器
 */
export function lastAggregator<V>(): AggregatorFunction<V, V | undefined> {
  return {
    type: 'last',
    initializer: () => undefined,
    adder: (_acc, v) => v,
  };
}

/**
 * 创建 collect 聚合器
 */
export function collectAggregator<V>(): AggregatorFunction<V, V[]> {
  return {
    type: 'collect',
    initializer: () => [],
    adder: (acc, v) => [...acc, v],
    subtractor: (acc, v) => acc.filter((x) => x !== v),
  };
}

/**
 * 工厂函数：根据类型构造聚合器
 */
export function createAggregator<V = number, R = unknown>(type: AggregationType): AggregatorFunction<V, R> {
  switch (type) {
    case 'count':
      return countAggregator<V>() as unknown as AggregatorFunction<V, R>;
    case 'sum':
      return sumAggregator<V>() as unknown as AggregatorFunction<V, R>;
    case 'avg':
      return avgAggregator<V>() as unknown as AggregatorFunction<V, R>;
    case 'min':
      return minAggregator<V>() as unknown as AggregatorFunction<V, R>;
    case 'max':
      return maxAggregator<V>() as unknown as AggregatorFunction<V, R>;
    case 'first':
      return firstAggregator<V>() as unknown as AggregatorFunction<V, R>;
    case 'last':
      return lastAggregator<V>() as unknown as AggregatorFunction<V, R>;
    case 'collect':
      return collectAggregator<V>() as unknown as AggregatorFunction<V, R>;
    default:
      throw new Error(`Unsupported aggregation type: ${type}`);
  }
}

// ============================================================
// 窗口键生成器
// ============================================================

/**
 * 生成 Tumbling 窗口键
 * @param eventTime 事件时间
 * @param sizeMs 窗口大小
 */
export function tumblingWindowKey(eventTime: number, sizeMs: number): { start: number; end: number } {
  const start = Math.floor(eventTime / sizeMs) * sizeMs;
  return { start, end: start + sizeMs };
}

/**
 * 生成所有覆盖事件的 Sliding 窗口键
 * @param eventTime 事件时间
 * @param sizeMs 窗口大小
 * @param slideMs 滑动步长
 */
export function slidingWindowKeys(
  eventTime: number,
  sizeMs: number,
  slideMs: number
): Array<{ start: number; end: number }> {
  const result: Array<{ start: number; end: number }> = [];
  // 找到包含此事件的所有窗口
  const firstStart = Math.floor(eventTime / slideMs) * slideMs;
  let start = firstStart;
  while (start + sizeMs >= eventTime && start <= eventTime) {
    if (start <= eventTime && eventTime < start + sizeMs) {
      result.push({ start, end: start + sizeMs });
    }
    start -= slideMs;
  }
  return result.sort((a, b) => a.start - b.start);
}

/**
 * 生成 Session 窗口键（基于事件时间和间隔）
 */
export function sessionWindowKey(
  eventTime: number,
  gapMs: number,
  existingWindows: Array<{ start: number; end: number }>
): { start: number; end: number } {
  for (const w of existingWindows) {
    if (eventTime >= w.start - gapMs && eventTime <= w.end + gapMs) {
      // 合并到现有窗口
      return {
        start: Math.min(w.start, eventTime),
        end: Math.max(w.end, eventTime),
      };
    }
  }
  // 新窗口
  return { start: eventTime, end: eventTime + gapMs };
}

// ============================================================
// 窗口聚合器
// ============================================================

/**
 * 窗口聚合器类
 */
export class WindowAggregator<K, V, R> {
  private windows = new Map<string, WindowState<K, V, R>>();
  private watermarks: WatermarkEvent[] = [];
  private stats: WindowAggregationStats = {
    inputCount: 0,
    outputCount: 0,
    lateCount: 0,
    watermarkCount: 0,
    activeWindows: 0,
    closedWindows: 0,
    droppedWindows: 0,
    processingTimeMs: 0,
  };
  private lateStats: LateEventStats = {
    total: 0,
    dropped: 0,
    sideOutput: 0,
    withinLateness: 0,
  };

  constructor(private options: WindowAggregationOptions<K, V, R>) {}

  /**
   * 添加事件
   */
  addEvent(event: WindowedEvent<K, V>): WindowResult<K, R>[] {
    const start = Date.now();
    this.stats.inputCount++;

    const eventTime = this.options.timeExtractor(event);
    const windowKeys = this.computeWindows(eventTime);

    if (windowKeys.length === 0) {
      // 没有匹配的窗口
      this.handleLateEvent(event, eventTime);
      this.stats.processingTimeMs += Date.now() - start;
      return [];
    }

    const results: WindowResult<K, R>[] = [];
    for (const wk of windowKeys) {
      const state = this.getOrCreateWindow(event.key, wk);
      // 检查水位线
      if (this.isLate(eventTime, state.windowEnd)) {
        this.handleLateEvent(event, eventTime);
        continue;
      }
      state.events.push(event);
      // 更新聚合
      if (this.options.aggregator.adder) {
        state.result = this.options.aggregator.adder(
          state.result ?? (this.options.aggregator.initializer?.() as R),
          event.value
        );
      }
      // 检查窗口是否应该触发
      if (this.shouldFire(state)) {
        const result = this.fireWindow(state);
        if (result) results.push(result);
      }
    }
    this.stats.processingTimeMs += Date.now() - start;
    return results;
  }

  /**
   * 添加水位线
   */
  addWatermark(watermark: WatermarkEvent): WindowResult<K, R>[] {
    this.watermarks.push(watermark);
    this.stats.watermarkCount++;
    if (this.options.onWatermark) this.options.onWatermark(watermark);

    // 关闭所有已通过水位线的窗口
    const results: WindowResult<K, R>[] = [];
    for (const state of this.windows.values()) {
      if (state.status === 'active' && watermark.timestamp >= state.windowEnd) {
        const result = this.fireWindow(state);
        if (result) results.push(result);
      }
    }
    return results;
  }

  /**
   * 获取统计信息
   */
  getStats(): WindowAggregationStats {
    return {
      ...this.stats,
      activeWindows: Array.from(this.windows.values()).filter((w) => w.status === 'active').length,
      closedWindows: Array.from(this.windows.values()).filter((w) => w.status === 'closed').length,
      droppedWindows: Array.from(this.windows.values()).filter((w) => w.status === 'dropped').length,
    };
  }

  /**
   * 获取迟到事件统计
   */
  getLateStats(): LateEventStats {
    return { ...this.lateStats };
  }

  /**
   * 强制关闭所有窗口
   */
  flush(): WindowResult<K, R>[] {
    const results: WindowResult<K, R>[] = [];
    for (const state of this.windows.values()) {
      if (state.status === 'active') {
        const result = this.fireWindow(state);
        if (result) results.push(result);
      }
    }
    return results;
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.windows.clear();
    this.watermarks = [];
    this.stats = {
      inputCount: 0,
      outputCount: 0,
      lateCount: 0,
      watermarkCount: 0,
      activeWindows: 0,
      closedWindows: 0,
      droppedWindows: 0,
      processingTimeMs: 0,
    };
    this.lateStats = { total: 0, dropped: 0, sideOutput: 0, withinLateness: 0 };
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private computeWindows(eventTime: number): Array<{ start: number; end: number }> {
    const cfg = this.options.config;
    switch (cfg.type) {
      case 'tumbling':
        if (!cfg.sizeMs) throw new Error('Tumbling window requires sizeMs');
        return [tumblingWindowKey(eventTime, cfg.sizeMs)];
      case 'sliding':
        if (!cfg.sizeMs || !cfg.slideMs) throw new Error('Sliding window requires sizeMs and slideMs');
        return slidingWindowKeys(eventTime, cfg.sizeMs, cfg.slideMs);
      case 'global':
        return [{ start: -Infinity, end: Infinity }];
      case 'session':
        if (!cfg.gapMs) throw new Error('Session window requires gapMs');
        // Session 窗口：与现有窗口合并或创建新窗口
        return [sessionWindowKey(eventTime, cfg.gapMs, this.getWindowStarts())];
      case 'count':
        return [{ start: eventTime, end: eventTime }];
      default:
        return [];
    }
  }

  private getWindowStarts(): Array<{ start: number; end: number }> {
    return Array.from(this.windows.values())
      .filter((w) => w.status === 'active')
      .map((w) => ({ start: w.windowStart, end: w.windowEnd }));
  }

  private getOrCreateWindow(key: K, winKey: { start: number; end: number }): WindowState<K, V, R> {
    const id = `${String(key)}-${winKey.start}`;
    let state = this.windows.get(id);
    if (!state) {
      state = {
        key,
        windowStart: winKey.start,
        windowEnd: winKey.end,
        events: [],
        firedCount: 0,
        status: 'active',
      };
      if (this.options.aggregator.initializer) {
        state.result = this.options.aggregator.initializer();
      }
      this.windows.set(id, state);
    }
    return state;
  }

  private shouldFire(state: WindowState<K, V, R>): boolean {
    const trigger = this.options.config.trigger ?? 'on-watermark';
    switch (trigger) {
      case 'on-element':
        return true;
      case 'on-count':
        return state.events.length >= ((this.options.config.triggerParams?.count as number) ?? 1);
      case 'on-time':
        return state.events.length > 0;
      case 'on-watermark':
      default:
        return false; // 由水位线或 flush 触发
    }
  }

  private fireWindow(state: WindowState<K, V, R>): WindowResult<K, R> | null {
    if (state.status !== 'active') return null;
    state.status = 'closed';
    state.firedCount++;
    this.stats.closedWindows++;
    this.stats.outputCount++;
    return {
      key: state.key,
      windowStart: state.windowStart,
      windowEnd: state.windowEnd,
      result: state.result as R,
      eventCount: state.events.length,
      isLate: false,
      firedAt: Date.now(),
    };
  }

  private isLate(eventTime: number, windowEnd: number): boolean {
    if (this.watermarks.length === 0) return false;
    const lastWatermark = this.watermarks[this.watermarks.length - 1]!.timestamp;
    if (eventTime < lastWatermark) {
      const latenessMs = lastWatermark - eventTime;
      const allowedLateness = this.options.config.allowedLatenessMs ?? 0;
      if (latenessMs > allowedLateness) return true;
    }
    return false;
  }

  private handleLateEvent(event: WindowedEvent<K, V>, eventTime: number): void {
    if (!this.options.handleLateEvents) return;
    this.stats.lateCount++;
    this.lateStats.total++;
    const allowedLateness = this.options.config.allowedLatenessMs ?? 0;
    const lastWatermark = this.watermarks[this.watermarks.length - 1]?.timestamp ?? 0;
    if (eventTime + allowedLateness < lastWatermark) {
      if (this.options.config.lateDataOutputTag && this.options.onLateEvent) {
        this.lateStats.sideOutput++;
        this.options.onLateEvent(event);
      } else {
        this.lateStats.dropped++;
      }
    } else {
      this.lateStats.withinLateness++;
    }
  }
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建窗口聚合器
 */
export function createWindowAggregator<K, V, R>(
  options: WindowAggregationOptions<K, V, R>
): WindowAggregator<K, V, R> {
  return new WindowAggregator(options);
}

// ============================================================
// 工具函数
// ============================================================

/** 支持的窗口类型 */
export function listSupportedWindowTypes(): WindowConfig['type'][] {
  return ['tumbling', 'sliding', 'session', 'global', 'count'];
}

/** 支持的聚合类型 */
export function listSupportedAggregationTypes(): AggregationType[] {
  return ['count', 'sum', 'avg', 'min', 'max', 'first', 'last', 'collect', 'reduce', 'aggregate'];
}

/** 支持的触发条件 */
export function listSupportedTriggers(): WindowConfig['trigger'][] {
  return ['on-element', 'on-time', 'on-punctuation', 'on-count'];
}

/** 规范化窗口类型 */
export function normalizeWindowType(input: string): WindowConfig['type'] {
  const v = input.trim().toLowerCase();
  if (['tumbling', 'sliding', 'session', 'global', 'count'].includes(v)) {
    return v as WindowConfig['type'];
  }
  return 'tumbling';
}

/** 简单 key 提取器（按字段） */
export function keyBy<K, V>(name: string, extract: (event: WindowedEvent<K, V>) => K): KeyExtractor<WindowedEvent<K, V>, K> {
  return { name, extract };
}
