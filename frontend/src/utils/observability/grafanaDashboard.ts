/**
 * # ============================================================
 * # Grafana 仪表盘 JSON 生成器 (Cycle 53 G53-02)
 * # ============================================================
 * # 核心作用：以编程方式生成 Grafana 仪表盘 JSON
 * # 支持：Panel (Graph/SingleStat/Table/Heatmap) + Variables + Annotations
 * # 输出：可直接导入 Grafana 的 JSON
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 53 G53-02 初次创建
 * # ====================================
 */

import { PromQLBuilder } from './promql';

/** 面板类型 */
export type PanelType = 'graph' | 'stat' | 'gauge' | 'bargauge' | 'table' | 'heatmap' | 'timeseries' | 'piechart';

/** Panel 位置 */
export interface PanelPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Panel 通用属性 */
export interface GrafanaPanel {
  id: number;
  type: PanelType;
  title: string;
  description?: string;
  gridPos: PanelPos;
  datasource: { type: string; uid?: string };
  targets: GrafanaTarget[];
  options: Record<string, unknown>;
  fieldConfig: {
    defaults: Record<string, unknown>;
    overrides?: Array<{
      matcher: { id: string; options: unknown };
      properties: Array<{ id: string; value: unknown }>;
    }>;
  };
  transparent?: boolean;
}

/** Grafana 查询目标 */
export interface GrafanaTarget {
  refId: string;
  query: string;
  legendFormat?: string;
  datasource: { type: string; uid?: string };
  instant?: boolean;
  range?: boolean;
  exemplar?: boolean;
}

/** Grafana 变量 */
export interface GrafanaVariable {
  name: string;
  label?: string;
  type: 'query' | 'custom' | 'interval' | 'datasource';
  query?: string;
  current: { selected: boolean; text: string; value: string };
  options?: Array<{ text: string; value: string; selected?: boolean }>;
  multi?: boolean;
  includeAll?: boolean;
  hide?: number;
}

/** Grafana 仪表盘 */
export interface GrafanaDashboard {
  id?: number;
  uid?: string;
  title: string;
  description?: string;
  tags: string[];
  timezone: string;
  schemaVersion: number;
  version: number;
  refresh: string;
  time: { from: string; to: string };
  templating: { list: GrafanaVariable[] };
  panels: GrafanaPanel[];
  annotations: {
    list: Array<{
      name: string;
      datasource: { type: string; uid?: string };
      enable: boolean;
      iconColor: string;
    }>;
  };
  editable: boolean;
  graphTooltip: number;
  links: Array<{ title: string; url: string; type: string }>;
}

/** 仪表盘创建选项 */
export interface DashboardOptions {
  title: string;
  description?: string;
  tags?: string[];
  uid?: string;
  refreshInterval?: string;
  timeRange?: { from: string; to: string };
}

/** 面板目标查询 */
export interface PanelTargetQuery {
  query: string;
  legendFormat?: string;
  refId?: string;
}

/**
 * Grafana 仪表盘构建器
 */
export class GrafanaDashboardBuilder {
  private dashboard: GrafanaDashboard;
  private panelIdCounter = 1;

  constructor(options: DashboardOptions) {
    this.dashboard = {
      uid: options.uid,
      title: options.title,
      description: options.description ?? '',
      tags: options.tags ?? [],
      timezone: 'browser',
      schemaVersion: 38,
      version: 1,
      refresh: options.refreshInterval ?? '30s',
      time: options.timeRange ?? { from: 'now-1h', to: 'now' },
      templating: { list: [] },
      panels: [],
      annotations: {
        list: [
          {
            name: 'Annotations & Alerts',
            datasource: { type: 'grafana', uid: '-- Grafana --' },
            enable: true,
            iconColor: 'rgba(0, 211, 255, 1)',
          },
        ],
      },
      editable: true,
      graphTooltip: 0,
      links: [],
    };
  }

  /**
   * 添加变量
   */
  addVariable(variable: GrafanaVariable): this {
    this.dashboard.templating.list.push(variable);
    return this;
  }

  /**
   * 添加 Service 变量
   */
  addServiceVariable(label: string = 'Service'): this {
    this.dashboard.templating.list.push({
      name: 'service',
      label,
      type: 'query',
      query: 'label_values(http_requests_total, service)',
      current: { selected: false, text: 'All', value: '$__all' },
      options: [{ text: 'All', value: '$__all', selected: true }],
      multi: true,
      includeAll: true,
    });
    return this;
  }

  /**
   * 添加 Interval 变量
   */
  addIntervalVariable(): this {
    this.dashboard.templating.list.push({
      name: 'interval',
      label: 'Interval',
      type: 'interval',
      query: '1m,5m,15m,30m,1h,3h,6h,12h,1d',
      current: { selected: false, text: '5m', value: '5m' },
      options: [
        { text: '1m', value: '1m', selected: false },
        { text: '5m', value: '5m', selected: true },
        { text: '15m', value: '15m', selected: false },
        { text: '1h', value: '1h', selected: false },
      ],
    });
    return this;
  }

  /**
   * 添加时序图面板 (Graph/Timeseries)
   */
  addTimeSeriesPanel(options: {
    title: string;
    description?: string;
    pos: PanelPos;
    queries: PanelTargetQuery[];
    unit?: string;
    decimals?: number;
    min?: number;
    max?: number;
    legendShow?: boolean;
  }): this {
    const panelId = this.nextPanelId();
    this.dashboard.panels.push({
      id: panelId,
      type: 'timeseries',
      title: options.title,
      description: options.description,
      gridPos: options.pos,
      datasource: { type: 'prometheus', uid: 'PBFA97CFB590B2093' },
      targets: options.queries.map((q, idx) => ({
        refId: q.refId ?? String.fromCharCode(65 + idx),
        query: q.query,
        legendFormat: q.legendFormat,
        datasource: { type: 'prometheus', uid: 'PBFA97CFB590B2093' },
        instant: false,
        range: true,
      })),
      options: {
        legend: { showLegend: options.legendShow ?? true, displayMode: 'list', placement: 'bottom' },
        tooltip: { mode: 'multi', sort: 'desc' },
      },
      fieldConfig: {
        defaults: {
          unit: options.unit ?? 'short',
          decimals: options.decimals ?? 2,
          min: options.min,
          max: options.max,
          custom: {
            drawStyle: 'line',
            lineInterpolation: 'linear',
            lineWidth: 2,
            fillOpacity: 10,
            showPoints: 'never',
            spanNulls: false,
            staircaseLine: false,
          },
          color: { mode: 'palette-classic' },
        },
      },
    });
    return this;
  }

  /**
   * 添加统计面板 (Stat)
   */
  addStatPanel(options: {
    title: string;
    description?: string;
    pos: PanelPos;
    queries: PanelTargetQuery[];
    unit?: string;
    decimals?: number;
    thresholds?: Array<{ value: number; color: string }>;
    colorMode?: 'value' | 'background' | 'border';
    graphMode?: 'area' | 'none';
  }): this {
    const panelId = this.nextPanelId();
    this.dashboard.panels.push({
      id: panelId,
      type: 'stat',
      title: options.title,
      description: options.description,
      gridPos: options.pos,
      datasource: { type: 'prometheus', uid: 'PBFA97CFB590B2093' },
      targets: options.queries.map((q, idx) => ({
        refId: q.refId ?? String.fromCharCode(65 + idx),
        query: q.query,
        legendFormat: q.legendFormat,
        datasource: { type: 'prometheus', uid: 'PBFA97CFB590B2093' },
        instant: true,
      })),
      options: {
        colorMode: options.colorMode ?? 'value',
        graphMode: options.graphMode ?? 'area',
        justifyMode: 'auto',
        textMode: 'auto',
        reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      },
      fieldConfig: {
        defaults: {
          unit: options.unit ?? 'short',
          decimals: options.decimals ?? 2,
          thresholds: {
            mode: 'absolute',
            steps: options.thresholds ?? [
              { value: null, color: 'green' },
              { value: 80, color: 'yellow' },
              { value: 90, color: 'red' },
            ],
          },
        },
      },
    });
    return this;
  }

  /**
   * 添加仪表盘面板 (Gauge)
   */
  addGaugePanel(options: {
    title: string;
    description?: string;
    pos: PanelPos;
    queries: PanelTargetQuery[];
    unit?: string;
    min: number;
    max: number;
    thresholds?: Array<{ value: number; color: string }>;
  }): this {
    const panelId = this.nextPanelId();
    this.dashboard.panels.push({
      id: panelId,
      type: 'gauge',
      title: options.title,
      description: options.description,
      gridPos: options.pos,
      datasource: { type: 'prometheus', uid: 'PBFA97CFB590B2093' },
      targets: options.queries.map((q, idx) => ({
        refId: q.refId ?? String.fromCharCode(65 + idx),
        query: q.query,
        legendFormat: q.legendFormat,
        datasource: { type: 'prometheus', uid: 'PBFA97CFB590B2093' },
        instant: true,
      })),
      options: {
        showThresholdLabels: false,
        showThresholdMarkers: true,
      },
      fieldConfig: {
        defaults: {
          unit: options.unit ?? 'short',
          min: options.min,
          max: options.max,
          thresholds: {
            mode: 'absolute',
            steps: options.thresholds ?? [
              { value: null, color: 'green' },
              { value: 70, color: 'yellow' },
              { value: 90, color: 'red' },
            ],
          },
        },
      },
    });
    return this;
  }

  /**
   * 添加表格面板 (Table)
   */
  addTablePanel(options: {
    title: string;
    description?: string;
    pos: PanelPos;
    queries: PanelTargetQuery[];
  }): this {
    const panelId = this.nextPanelId();
    this.dashboard.panels.push({
      id: panelId,
      type: 'table',
      title: options.title,
      description: options.description,
      gridPos: options.pos,
      datasource: { type: 'prometheus', uid: 'PBFA97CFB590B2093' },
      targets: options.queries.map((q, idx) => ({
        refId: q.refId ?? String.fromCharCode(65 + idx),
        query: q.query,
        legendFormat: q.legendFormat,
        datasource: { type: 'prometheus', uid: 'PBFA97CFB590B2093' },
        instant: true,
      })),
      options: {
        showHeader: true,
        cellHeight: 'sm',
        sortBy: [{ displayName: 'Value', desc: true }],
      },
      fieldConfig: {
        defaults: {
          custom: {
            align: 'auto',
            cellOptions: { type: 'auto' },
            inspect: false,
          },
        },
      },
    });
    return this;
  }

  /**
   * 添加热力图面板
   */
  addHeatmapPanel(options: {
    title: string;
    description?: string;
    pos: PanelPos;
    queries: PanelTargetQuery[];
  }): this {
    const panelId = this.nextPanelId();
    this.dashboard.panels.push({
      id: panelId,
      type: 'heatmap',
      title: options.title,
      description: options.description,
      gridPos: options.pos,
      datasource: { type: 'prometheus', uid: 'PBFA97CFB590B2093' },
      targets: options.queries.map((q, idx) => ({
        refId: q.refId ?? String.fromCharCode(65 + idx),
        query: q.query,
        legendFormat: q.legendFormat,
        datasource: { type: 'prometheus', uid: 'PBFA97CFB590B2093' },
        instant: false,
        range: true,
      })),
      options: {
        calculate: false,
        yAxis: { axisPlacement: 'left', unit: 's', reverse: false, decimals: 0 },
        color: { mode: 'scheme', scheme: 'Spectral', exponent: 0.5, fill: 'dark-orange', scale: 'exponential' },
        cellGap: 2,
        cellRadius: 0,
        cellValues: { decimals: 0 },
        showValue: 'never',
        tooltip: { show: true, yHistogram: true },
        legend: { show: true },
      },
      fieldConfig: {
        defaults: {
          custom: {},
        },
      },
    });
    return this;
  }

  /**
   * 添加链接
   */
  addLink(title: string, url: string, type: string = 'link'): this {
    this.dashboard.links.push({ title, url, type });
    return this;
  }

  /**
   * 设置 Tags
   */
  setTags(tags: string[]): this {
    this.dashboard.tags = tags;
    return this;
  }

  /**
   * 设置描述
   */
  setDescription(description: string): this {
    this.dashboard.description = description;
    return this;
  }

  /**
   * 设置刷新间隔
   */
  setRefreshInterval(interval: string): this {
    this.dashboard.refresh = interval;
    return this;
  }

  /**
   * 渲染为 JSON
   */
  toJSON(): GrafanaDashboard {
    return JSON.parse(JSON.stringify(this.dashboard));
  }

  /**
   * 渲染为 JSON 字符串
   */
  toString(): string {
    return JSON.stringify(this.toJSON(), null, 2);
  }

  /**
   * 获取面板数
   */
  getPanelCount(): number {
    return this.dashboard.panels.length;
  }

  /**
   * 私有方法 - 下一个面板 ID
   */
  private nextPanelId(): number {
    return this.panelIdCounter++;
  }
}

// ============================================================
// 预制仪表盘模板
// ====================================

/**
 * 创建标准应用监控仪表盘
 */
export function createApplicationMonitoringDashboard(
  serviceName: string = '$service'
): GrafanaDashboardBuilder {
  const builder = new GrafanaDashboardBuilder({
    title: `${serviceName} - Application Monitoring`,
    description: 'Standard application monitoring dashboard with RED metrics (Rate, Errors, Duration)',
    tags: ['mcp', 'monitoring', 'auto-generated', 'cycle53'],
    refreshInterval: '30s',
  });

  // 变量
  builder.addServiceVariable();
  builder.addIntervalVariable();

  // Row 1: 顶部状态 (Stat panels)
  builder.addStatPanel({
    title: '请求率 (req/s)',
    pos: { x: 0, y: 0, w: 6, h: 4 },
    queries: [{ refId: 'A', query: `sum(rate(http_requests_total{service="$service"}[$interval]))` }],
    unit: 'reqps',
    decimals: 1,
  });

  builder.addStatPanel({
    title: '错误率 (%)',
    pos: { x: 6, y: 0, w: 6, h: 4 },
    queries: [
      {
        refId: 'A',
        query: `sum(rate(http_requests_total{service="$service",status=~"5.."}[$interval])) / sum(rate(http_requests_total{service="$service"}[$interval])) * 100`,
      },
    ],
    unit: 'percent',
    decimals: 2,
    thresholds: [
      { value: 0, color: 'green' },
      { value: 1, color: 'yellow' },
      { value: 5, color: 'red' },
    ],
  });

  builder.addStatPanel({
    title: 'P95 延迟',
    pos: { x: 12, y: 0, w: 6, h: 4 },
    queries: [
      {
        refId: 'A',
        query: `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{service="$service"}[$interval])) by (le))`,
      },
    ],
    unit: 's',
    decimals: 3,
  });

  builder.addStatPanel({
    title: 'P99 延迟',
    pos: { x: 18, y: 0, w: 6, h: 4 },
    queries: [
      {
        refId: 'A',
        query: `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{service="$service"}[$interval])) by (le))`,
      },
    ],
    unit: 's',
    decimals: 3,
  });

  // Row 2: 时序图
  builder.addTimeSeriesPanel({
    title: '请求率 (按状态码)',
    pos: { x: 0, y: 4, w: 12, h: 8 },
    queries: [
      {
        refId: 'A',
        query: `sum by (status) (rate(http_requests_total{service="$service"}[$interval]))`,
        legendFormat: '{{status}}',
      },
    ],
    unit: 'reqps',
  });

  builder.addTimeSeriesPanel({
    title: '延迟百分位 (P50/P95/P99)',
    pos: { x: 12, y: 4, w: 12, h: 8 },
    queries: [
      {
        refId: 'A',
        query: `histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket{service="$service"}[$interval])) by (le))`,
        legendFormat: 'P50',
      },
      {
        refId: 'B',
        query: `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{service="$service"}[$interval])) by (le))`,
        legendFormat: 'P95',
      },
      {
        refId: 'C',
        query: `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{service="$service"}[$interval])) by (le))`,
        legendFormat: 'P99',
      },
    ],
    unit: 's',
  });

  // Row 3: 资源
  builder.addTimeSeriesPanel({
    title: 'CPU 使用率',
    pos: { x: 0, y: 12, w: 12, h: 6 },
    queries: [
      {
        refId: 'A',
        query: `rate(process_cpu_seconds_total{service="$service"}[$interval]) * 100`,
        legendFormat: 'CPU %',
      },
    ],
    unit: 'percent',
  });

  builder.addTimeSeriesPanel({
    title: '内存使用量',
    pos: { x: 12, y: 12, w: 12, h: 6 },
    queries: [
      {
        refId: 'A',
        query: `process_resident_memory_bytes{service="$service"}`,
        legendFormat: 'Memory',
      },
    ],
    unit: 'bytes',
  });

  return builder;
}

/**
 * 创建 RAG 系统专用仪表盘
 */
export function createRAGSystemDashboard(): GrafanaDashboardBuilder {
  const builder = new GrafanaDashboardBuilder({
    title: 'RAG System - Performance Dashboard',
    description: 'RAG system monitoring with vector retrieval, cache hit rate, embedding latency',
    tags: ['mcp', 'rag', 'monitoring', 'auto-generated', 'cycle53'],
    refreshInterval: '30s',
  });

  builder.addServiceVariable();
  builder.addIntervalVariable();

  // RAG 特定指标
  builder.addStatPanel({
    title: '向量检索 P95 延迟',
    pos: { x: 0, y: 0, w: 6, h: 4 },
    queries: [
      {
        refId: 'A',
        query: `histogram_quantile(0.95, sum(rate(rag_vector_search_duration_seconds_bucket{service="$service"}[$interval])) by (le))`,
      },
    ],
    unit: 'ms',
    decimals: 1,
  });

  builder.addStatPanel({
    title: '缓存命中率 (%)',
    pos: { x: 6, y: 0, w: 6, h: 4 },
    queries: [
      {
        refId: 'A',
        query: `sum(rate(rag_cache_hits_total{service="$service"}[$interval])) / (sum(rate(rag_cache_hits_total{service="$service"}[$interval])) + sum(rate(rag_cache_misses_total{service="$service"}[$interval]))) * 100`,
      },
    ],
    unit: 'percent',
    decimals: 1,
  });

  builder.addStatPanel({
    title: 'Embedding 平均耗时',
    pos: { x: 12, y: 0, w: 6, h: 4 },
    queries: [
      {
        refId: 'A',
        query: `sum(rate(rag_embedding_duration_seconds_sum{service="$service"}[$interval])) / sum(rate(rag_embedding_duration_seconds_count{service="$service"}[$interval]))`,
      },
    ],
    unit: 's',
    decimals: 4,
  });

  builder.addStatPanel({
    title: 'LLM Token 速率 (tok/s)',
    pos: { x: 18, y: 0, w: 6, h: 4 },
    queries: [
      {
        refId: 'A',
        query: `sum(rate(rag_llm_tokens_total{service="$service"}[$interval]))`,
      },
    ],
    unit: 'short',
  });

  return builder;
}
