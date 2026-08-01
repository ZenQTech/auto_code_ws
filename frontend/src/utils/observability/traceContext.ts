/**
 * # ============================================================
 * # W3C Trace Context 传播器 (Cycle 53 G53-01)
 * # ============================================================
 * # 核心作用：实现 W3C Trace Context 标准的 traceparent/tracestate 头解析与生成
 * # 参考：https://www.w3.org/TR/trace-context/
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 53 G53-01 初次创建
 * # ====================================
 */

import type { TraceContext, TraceId, SpanId, Attributes } from './traceTypes';
import { TRACE_FLAG_SAMPLED } from './traceTypes';

/** 字符表 (hex) */
const HEX_CHARS = '0123456789abcdef';

/**
 * 生成随机 hex 字符串
 * @param bytes 字节数
 */
function randomHex(bytes: number): string {
  let result = '';
  for (let i = 0; i < bytes * 2; i++) {
    result += HEX_CHARS[Math.floor(Math.random() * 16)];
  }
  return result;
}

/**
 * 生成新的 Trace ID (16 字节 = 32 hex 字符)
 */
export function generateTraceId(): TraceId {
  return randomHex(16);
}

/**
 * 生成新的 Span ID (8 字节 = 16 hex 字符)
 */
export function generateSpanId(): SpanId {
  return randomHex(8);
}

/**
 * 验证 Trace ID 格式
 */
export function isValidTraceId(traceId: string): boolean {
  return /^[0-9a-f]{32}$/.test(traceId) && traceId !== '0'.repeat(32);
}

/**
 * 验证 Span ID 格式
 */
export function isValidSpanId(spanId: string): boolean {
  return /^[0-9a-f]{16}$/.test(spanId) && spanId !== '0'.repeat(16);
}

/**
 * 序列化 Trace Context 为 traceparent 头格式
 * 格式: {version}-{trace-id}-{parent-id}-{trace-flags}
 * 示例: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 */
export function serializeTraceparent(context: TraceContext): string {
  if (!isValidTraceId(context.traceId)) {
    throw new Error(`Invalid traceId: ${context.traceId}`);
  }
  if (!isValidSpanId(context.spanId)) {
    throw new Error(`Invalid spanId: ${context.spanId}`);
  }
  const flags = context.traceFlags.toString(16).padStart(2, '0');
  return `00-${context.traceId}-${context.spanId}-${flags}`;
}

/**
 * 反序列化 traceparent 头为 Trace Context
 */
export function deserializeTraceparent(traceparent: string): TraceContext | null {
  if (!traceparent) return null;
  const parts = traceparent.split('-');
  if (parts.length !== 4) return null;
  const [version, traceId, spanId, flags] = parts;
  if (version !== '00') return null;
  if (!traceId || !isValidTraceId(traceId)) return null;
  if (!spanId || !isValidSpanId(spanId)) return null;
  const flagValue = parseInt(flags ?? '00', 16);
  if (isNaN(flagValue)) return null;
  return {
    traceId,
    spanId,
    traceFlags: flagValue,
  };
}

/**
 * 序列化 tracestate 头格式
 * 格式: key1=value1,key2=value2
 */
export function serializeTracestate(state: Record<string, string>): string {
  return Object.entries(state)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join(',');
}

/**
 * 反序列化 tracestate 头
 */
export function deserializeTracestate(tracestate: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!tracestate) return result;
  const pairs = tracestate.split(',');
  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (key && value) {
      try {
        result[decodeURIComponent(key)] = decodeURIComponent(value);
      } catch {
        // 忽略无效对
      }
    }
  }
  return result;
}

/**
 * 创建新的根 Trace Context
 */
export function createRootContext(sampled: boolean = true): TraceContext {
  return {
    traceId: generateTraceId(),
    spanId: generateSpanId(),
    traceFlags: sampled ? TRACE_FLAG_SAMPLED : 0,
  };
}

/**
 * 基于父 Context 创建子 Span Context
 */
export function createChildContext(parent: TraceContext): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: generateSpanId(),
    traceFlags: parent.traceFlags,
    traceState: parent.traceState,
  };
}

/**
 * 将 Span Context 注入到 HTTP 头
 */
export function injectContextIntoHeaders(
  context: TraceContext,
  headers: Record<string, string> = {}
): Record<string, string> {
  const result = { ...headers };
  result['traceparent'] = serializeTraceparent(context);
  if (context.traceState) {
    result['tracestate'] = context.traceState;
  }
  return result;
}

/**
 * 从 HTTP 头中提取 Span Context
 */
export function extractContextFromHeaders(
  headers: Record<string, string>
): TraceContext | null {
  const traceparent = headers['traceparent'] ?? headers['Traceparent'];
  if (!traceparent) return null;
  const context = deserializeTraceparent(traceparent);
  if (!context) return null;
  const tracestate = headers['tracestate'] ?? headers['Tracestate'];
  if (tracestate) {
    context.traceState = serializeTracestate(deserializeTracestate(tracestate));
  }
  return context;
}

/**
 * 格式化 Trace Context 为可读字符串
 */
export function formatContext(context: TraceContext): string {
  const flags = context.traceFlags.toString(16).padStart(2, '0');
  return `${context.traceId.slice(0, 8)}…${context.traceId.slice(-4)}/${context.spanId.slice(0, 4)}…${context.spanId.slice(-4)} (flags=${flags})`;
}

/**
 * 创建属性映射 (辅助函数)
 */
export function attrs(values: Record<string, string | number | boolean>): Attributes {
  return { ...values };
}

/**
 * 默认工厂函数
 */
export const ContextFactory = {
  generateTraceId,
  generateSpanId,
  createRootContext,
  createChildContext,
  isValidTraceId,
  isValidSpanId,
  serializeTraceparent,
  deserializeTraceparent,
  injectContextIntoHeaders,
  extractContextFromHeaders,
  formatContext,
};
