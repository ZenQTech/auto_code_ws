/**
 * # ============================================================
 * # Window Aggregation - 类型定义 (Cycle 57 G57-03)
 * # ============================================================
 * # 核心作用：通用窗口聚合类型（Tumbling / Sliding / Session）
 * # 特性：水印 / 迟到事件 / 自定义触发器 / 自定义驱逐器
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 57 G57-03 初次创建
 * # ====================================
 */

/** 窗口类型 */
export type WindowType = 'tumbling' | 'sliding' | 'session' | 'global' | 'count';

/** 聚合函数类型 */
export type AggregationType =
  | 'count'         // 计数
  | 'sum'           // 求和
  | 'avg'           // 平均
  | 'min'           // 最小
  | 'max'           // 最大
  | 'first'         // 第一个
  | 'last'          // 最后一个
  | 'collect'       // 收集
  | 'reduce'        // 自定义归约
  | 'aggregate';    // 自定义聚合

/** 触发条件 */
export type TriggerCondition = 'on-element' | 'on-time' | 'on-punctuation' | 'on-count';

/** 驱逐策略 */
export type EvictionStrategy = 'time' | 'count' | 'delta' | 'none';

/** 窗口配置 */
export interface WindowConfig {
  /** 窗口类型 */
  type: WindowType;
  /** 窗口大小（毫秒，仅 tumbling/sliding/session） */
  sizeMs?: number;
  /** 滑动步长（毫秒，仅 sliding） */
  slideMs?: number;
  /** 会话间隔（毫秒，仅 session） */
  gapMs?: number;
  /** 计数窗口（仅 count） */
  count?: number;
  /** 允许延迟（毫秒） */
  allowedLatenessMs?: number;
  /** 侧输出标签（用于迟到事件） */
  lateDataOutputTag?: string;
  /** 触发条件 */
  trigger?: TriggerCondition;
  /** 驱逐策略 */
  eviction?: EvictionStrategy;
  /** 触发/驱逐参数 */
  triggerParams?: Record<string, unknown>;
}

/** 输入事件 */
export interface WindowedEvent<K, V> {
  /** 事件键 */
  key: K;
  /** 事件值 */
  value: V;
  /** 事件时间戳（毫秒） */
  eventTime: number;
  /** 摄入时间戳（毫秒） */
  ingestionTime: number;
  /** 水位线时间戳（毫秒） */
  watermark?: number;
  /** 序列号（用于去重） */
  sequence?: number;
}

/** 窗口状态 */
export interface WindowState<K, V, R> {
  /** 窗口键 */
  key: K;
  /** 窗口开始时间（毫秒） */
  windowStart: number;
  /** 窗口结束时间（毫秒） */
  windowEnd: number;
  /** 窗口内事件 */
  events: Array<WindowedEvent<K, V>>;
  /** 当前聚合结果 */
  result?: R;
  /** 触发次数 */
  firedCount: number;
  /** 状态（active / closed / dropped） */
  status: 'active' | 'closed' | 'merged' | 'dropped';
}

/** 窗口结果 */
export interface WindowResult<K, R> {
  /** 窗口键 */
  key: K;
  /** 窗口开始时间（毫秒） */
  windowStart: number;
  /** 窗口结束时间（毫秒） */
  windowEnd: number;
  /** 聚合结果 */
  result: R;
  /** 事件数 */
  eventCount: number;
  /** 是否迟到 */
  isLate: boolean;
  /** 触发时间戳（毫秒） */
  firedAt: number;
}

/** 水位线事件 */
export interface WatermarkEvent {
  /** 水位线时间戳（毫秒） */
  timestamp: number;
  /** 来源 */
  source: string;
  /** 序列号 */
  id: number;
}

/** 聚合器函数 */
export interface AggregatorFunction<V, R> {
  /** 类型 */
  type: AggregationType;
  /** 初始值构造器 */
  initializer?: () => R;
  /** 累加器 */
  adder: (accumulator: R, value: V) => R;
  /** 减法器（可选，用于撤回） */
  subtractor?: (accumulator: R, value: V) => R;
  /** 合并器（用于 session 窗口） */
  merger?: (a: R, b: R) => R;
}

/** 窗口键提取器 */
export interface KeyExtractor<T, K> {
  /** 提取函数名（用于调试） */
  name?: string;
  /** 提取函数 */
  extract: (event: T) => K;
}

/** 迟到事件统计 */
export interface LateEventStats {
  /** 总数 */
  total: number;
  /** 被丢弃的 */
  dropped: number;
  /** 路由到侧输出的 */
  sideOutput: number;
  /** 仍在允许延迟内的 */
  withinLateness: number;
}

/** 窗口聚合选项 */
export interface WindowAggregationOptions<K, V, R> {
  /** 窗口配置 */
  config: WindowConfig;
  /** 聚合器 */
  aggregator: AggregatorFunction<V, R>;
  /** 键提取器 */
  keyExtractor: KeyExtractor<WindowedEvent<K, V>, K>;
  /** 时间提取器 */
  timeExtractor: (event: WindowedEvent<K, V>) => number;
  /** 是否开启迟到事件处理 */
  handleLateEvents?: boolean;
  /** 侧输出回调 */
  onLateEvent?: (event: WindowedEvent<K, V>) => void;
  /** 水位线回调 */
  onWatermark?: (watermark: WatermarkEvent) => void;
}

/** 窗口聚合统计 */
export interface WindowAggregationStats {
  /** 输入事件数 */
  inputCount: number;
  /** 输出窗口结果数 */
  outputCount: number;
  /** 迟到事件数 */
  lateCount: number;
  /** 水位线数 */
  watermarkCount: number;
  /** 活跃窗口数 */
  activeWindows: number;
  /** 已关闭窗口数 */
  closedWindows: number;
  /** 丢弃窗口数 */
  droppedWindows: number;
  /** 处理耗时（毫秒） */
  processingTimeMs: number;
}
