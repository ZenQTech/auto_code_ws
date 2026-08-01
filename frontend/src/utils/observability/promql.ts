/**
 * # ============================================================
 * # PromQL 查询构建器 (Cycle 53 G53-02)
 * # ============================================================
 * # 核心作用：以编程方式构建 Prometheus 查询语句
 * # 支持：函数 (rate, sum, avg, histogram_quantile 等) + 标签匹配
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 53 G53-02 初次创建
 * # ====================================
 */

/** 标签匹配操作符 */
export type LabelMatchOp = '=' | '!=' | '=~' | '!~';

/** 单个标签匹配条件 */
export interface LabelMatcher {
  name: string;
  op: LabelMatchOp;
  value: string;
}

/** PromQL 表达式构建器 */
export class PromQLBuilder {
  private parts: string[] = [];

  /**
   * 添加即时向量 (Instant Vector)
   * @param metric 指标名
   * @param labels 标签匹配
   */
  metric(metric: string, labels?: Record<string, string>): this {
    this.parts.push(this.formatMetric(metric, labels));
    return this;
  }

  /**
   * 添加函数调用
   * @param fn 函数名
   * @param args 参数
   */
  fn(fn: string, ...args: string[]): this {
    this.parts.push(`${fn}(${args.join(', ')})`);
    return this;
  }

  /**
   * 算术运算
   */
  op(operator: '+' | '-' | '*' | '/' | '%' | '^', value: number | string): this {
    if (typeof value === 'number') {
      this.parts.push(operator + value.toString());
    } else {
      this.parts.push(operator, value);
    }
    return this;
  }

  /**
   * 比较运算
   */
  compare(operator: '>' | '>=' | '<' | '<=' | '==' | '!=', value: number): this {
    this.parts.push(operator + value.toString());
    return this;
  }

  /**
   * 添加 by() 子句
   */
  by(...labels: string[]): this {
    this.parts.push(`by (${labels.join(', ')})`);
    return this;
  }

  /**
   * 添加 without() 子句
   */
  without(...labels: string[]): this {
    this.parts.push(`without (${labels.join(', ')})`);
    return this;
  }

  /**
   * 添加 on() 子句 (用于 vector matching)
   */
  on(...labels: string[]): this {
    this.parts.push(`on (${labels.join(', ')})`);
    return this;
  }

  /**
   * 添加 ignoring() 子句
   */
  ignoring(...labels: string[]): this {
    this.parts.push(`ignoring (${labels.join(', ')})`);
    return this;
  }

  /**
   * 添加分组左 (用于 vector matching)
   */
  groupLeft(...labels: string[]): this {
    this.parts.push(`group_left(${labels.join(', ')})`);
    return this;
  }

  /**
   * 添加分组右
   */
  groupRight(...labels: string[]): this {
    this.parts.push(`group_right(${labels.join(', ')})`);
    return this;
  }

  /**
   * 设置时间范围 (如 [5m])
   */
  range(duration: string): this {
    this.parts.push(`[${duration}]`);
    return this;
  }

  /**
   * 设置偏移 (如 offset 5m)
   */
  offset(duration: string): this {
    this.parts.push(`offset ${duration}`);
    return this;
  }

  /**
   * 添加布尔条件 (and, or, unless)
   */
  boolOp(op: 'and' | 'or' | 'unless', builder: PromQLBuilder): this {
    this.parts.push(op, builder.toString());
    return this;
  }

  /**
   * 添加 topk/bottomk
   */
  topk(k: number, expression?: string): this {
    this.parts.push(`topk(${k}${expression ? `, ${expression}` : ''})`);
    return this;
  }

  bottomk(k: number, expression?: string): this {
    this.parts.push(`bottomk(${k}${expression ? `, ${expression}` : ''})`);
    return this;
  }

  /**
   * 添加括号分组
   */
  paren(): this {
    this.parts.push('(');
    return this;
  }

  closeParen(): this {
    this.parts.push(')');
    return this;
  }

  /**
   * 生成最终 PromQL
   */
  toString(): string {
    return this.parts.join(' ');
  }

  /**
   * 重置
   */
  reset(): this {
    this.parts = [];
    return this;
  }

  /**
   * 克隆
   */
  clone(): PromQLBuilder {
    const c = new PromQLBuilder();
    c.parts = [...this.parts];
    return c;
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private formatMetric(metric: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return metric;
    }
    const labelStrs = Object.entries(labels).map(([k, v]) => {
      // 简单字符串直接用 = "value"
      return `${k}="${this.escapeLabelValue(v)}"`;
    });
    return `${metric}{${labelStrs.join(', ')}}`;
  }

  private escapeLabelValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }
}

// ============================================================
// 常用查询模板
// ====================================

/** 常用 PromQL 查询模板 */
export const PromQLTemplates = {
  /** HTTP 请求率 (req/s) */
  httpRequestRate: (service: string) =>
    new PromQLBuilder()
      .metric('http_requests_total', { service, status: '500' })
      .fn('rate', '[5m]')
      .toString(),

  /** HTTP 错误率 (错误数 / 总数) */
  httpErrorRate: (service: string) => {
    const b = new PromQLBuilder();
    return b
      .metric('http_requests_total', { service, status: '500' })
      .fn('rate', '[5m]')
      .op('/', b.clone().reset().metric('http_requests_total', { service }).fn('rate', '[5m]').toString())
      .toString();
  },

  /** P95 延迟 */
  p95Latency: (service: string) =>
    new PromQLBuilder()
      .fn('histogram_quantile', '0.95')
      .paren()
      .fn('rate', '[5m]')
      .paren()
      .metric('http_request_duration_seconds_bucket', { service })
      .toString(),

  /** P99 延迟 */
  p99Latency: (service: string) =>
    new PromQLBuilder()
      .fn('histogram_quantile', '0.99')
      .paren()
      .fn('rate', '[5m]')
      .paren()
      .metric('http_request_duration_seconds_bucket', { service })
      .toString(),

  /** CPU 使用率 */
  cpuUsage: (service: string) =>
    new PromQLBuilder()
      .fn('rate', '[5m]')
      .paren()
      .metric('process_cpu_seconds_total', { service })
      .toString(),

  /** 内存使用量 */
  memoryUsage: (service: string) =>
    new PromQLBuilder()
      .metric('process_resident_memory_bytes', { service })
      .toString(),

  /** QPS */
  qps: (service: string) => {
    const subQuery = new PromQLBuilder()
      .metric('http_requests_total', { service })
      .fn('rate', '[1m]')
      .toString();
    return new PromQLBuilder()
      .fn('sum', subQuery)
      .toString();
  },

  /** 服务可用性 (1 - errorRate) */
  availability: (service: string) => {
    const totalSubQuery = new PromQLBuilder()
      .metric('http_requests_total', { service })
      .fn('rate', '[5m]')
      .toString();
    const errRate = new PromQLBuilder()
      .metric('http_requests_total', { service, status: '500' })
      .fn('rate', '[5m]')
      .op('/', totalSubQuery)
      .toString();
    return `1 - (${errRate})`;
  },
};
