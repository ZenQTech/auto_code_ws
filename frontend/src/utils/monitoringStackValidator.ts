/**
 * # ============================================================
 * # Prometheus 监控栈验证器 (Cycle 51 G51-03)
 * # ============================================================
 * # 核心作用：验证 Prometheus + Grafana 监控集成
 * #           检查 scrape 目标 + 指标存在性 + Grafana 数据源
 * # 运行流程：
 * #   1. 验证 Prometheus 服务可用
 * #   2. 查询活跃 scrape 目标
 * #   3. 查询指标存在性 (Counter / Gauge / Histogram)
 * #   4. 验证 Grafana 服务 + 数据源
 * #   5. 查询 Prometheus 数据源连接状态
 * # 输入参数：prometheusUrl + grafanaUrl + 期望指标
 * # 输出结果：MonitoringReport { prometheus, grafana, metrics, overall }
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 51 G51-03 初次创建
 * # ====================================
 */

// ============================================================
// 类型定义
// ============================================================

/** Prometheus scrape 目标 */
export interface PrometheusTarget {
  job: string;
  instance: string;
  health: 'up' | 'down' | 'unknown';
  lastScrape?: string;
  lastError?: string;
  labels?: Record<string, string>;
}

/** Prometheus 指标信息 */
export interface PrometheusMetricInfo {
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary' | 'untyped';
  help?: string;
}

/** Grafana 数据源 */
export interface GrafanaDataSource {
  id: number;
  name: string;
  type: string;
  url: string;
  isDefault: boolean;
  access: string;
}

/** Prometheus 验证结果 */
export interface PrometheusCheckResult {
  available: boolean;
  version?: string;
  targets: PrometheusTarget[];
  activeTargets: number;
  totalTargets: number;
  expectedMetrics: Array<{
    name: string;
    found: boolean;
    type?: string;
  }>;
  durationMs: number;
  error?: string;
}

/** Grafana 验证结果 */
export interface GrafanaCheckResult {
  available: boolean;
  version?: string;
  dataSources: GrafanaDataSource[];
  prometheusDatasourceFound: boolean;
  durationMs: number;
  error?: string;
}

/** 监控报告 */
export interface MonitoringReport {
  timestamp: number;
  durationMs: number;
  overallPassed: boolean;
  prometheus: PrometheusCheckResult;
  grafana: GrafanaCheckResult;
  summary: string;
  recommendations: string[];
}

// ============================================================
// MonitoringStackValidator 主类
// ============================================================

export class MonitoringStackValidator {
  private readonly prometheusUrl: string;
  private readonly grafanaUrl: string;
  private readonly expectedMetrics: string[];
  private readonly expectedTargets: string[];
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly listeners: Set<MonitoringListener> = new Set();

  constructor(config: MonitoringValidatorConfig) {
    if (!config.prometheusUrl) throw new Error('prometheusUrl is required');
    this.prometheusUrl = config.prometheusUrl.replace(/\/$/, '');
    this.grafanaUrl = (config.grafanaUrl ?? '').replace(/\/$/, '');
    this.expectedMetrics = config.expectedMetrics ?? [];
    this.expectedTargets = config.expectedTargets ?? [];
    this.fetchImpl = config.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : (() => { throw new Error('fetch not available'); }) as unknown as typeof fetch);
    this.timeoutMs = config.timeoutMs ?? 5000;
  }

  /**
   * 订阅事件
   */
  subscribe(listener: MonitoringListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 执行完整监控验证
   */
  async validate(): Promise<MonitoringReport> {
    const start = Date.now();
    this.emit({ type: 'start', timestamp: start });

    // 并行检查 Prometheus 和 Grafana
    const [prometheus, grafana] = await Promise.all([
      this.checkPrometheus(),
      this.grafanaUrl ? this.checkGrafana() : Promise.resolve(this.emptyGrafanaResult()),
    ]);

    const overallPassed = prometheus.available && (grafana.available || !this.grafanaUrl);

    const report: MonitoringReport = {
      timestamp: start,
      durationMs: Date.now() - start,
      overallPassed,
      prometheus,
      grafana,
      summary: this.buildSummary(prometheus, grafana, overallPassed),
      recommendations: this.buildRecommendations(prometheus, grafana),
    };

    this.emit({ type: 'complete', timestamp: Date.now(), report });
    return report;
  }

  /**
   * 检查 Prometheus
   */
  async checkPrometheus(): Promise<PrometheusCheckResult> {
    const start = Date.now();
    try {
      // 1. 健康检查
      const healthyRes = await this.fetchImpl(`${this.prometheusUrl}/-/healthy`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!healthyRes.ok) {
        return {
          available: false,
          targets: [],
          activeTargets: 0,
          totalTargets: 0,
          expectedMetrics: [],
          durationMs: Date.now() - start,
          error: `Prometheus health check failed: HTTP ${healthyRes.status}`,
        };
      }

      // 2. 版本
      let version: string | undefined;
      try {
        const versionRes = await this.fetchImpl(`${this.prometheusUrl}/api/v1/status/runtimeinfo`, {
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (versionRes.ok) {
          const data = await versionRes.json() as { data?: { version?: string } };
          version = data.data?.version;
        }
      } catch {
        // 忽略版本获取失败
      }

      // 3. Scrape 目标
      const targets = await this.fetchTargets();
      const activeTargets = targets.filter((t) => t.health === 'up').length;
      const totalTargets = targets.length;

      // 4. 期望指标检查
      const expectedMetrics = await this.checkExpectedMetrics();

      return {
        available: true,
        version,
        targets,
        activeTargets,
        totalTargets,
        expectedMetrics,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        available: false,
        targets: [],
        activeTargets: 0,
        totalTargets: 0,
        expectedMetrics: [],
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 检查 Grafana
   */
  async checkGrafana(): Promise<GrafanaCheckResult> {
    const start = Date.now();
    try {
      // 1. 健康检查
      const healthyRes = await this.fetchImpl(`${this.grafanaUrl}/api/health`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!healthyRes.ok) {
        return {
          available: false,
          dataSources: [],
          prometheusDatasourceFound: false,
          durationMs: Date.now() - start,
          error: `Grafana health check failed: HTTP ${healthyRes.status}`,
        };
      }

      // 2. 数据源
      const dataSources = await this.fetchDataSources();
      const prometheusDatasourceFound = dataSources.some((ds) => ds.type === 'prometheus');

      return {
        available: true,
        dataSources,
        prometheusDatasourceFound,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        available: false,
        dataSources: [],
        prometheusDatasourceFound: false,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 获取 scrape 目标
   */
  private async fetchTargets(): Promise<PrometheusTarget[]> {
    try {
      const res = await this.fetchImpl(`${this.prometheusUrl}/api/v1/targets`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return [];
      const data = await res.json() as { data?: { activeTargets?: Array<{ labels: Record<string, string>; health: string; lastScrape?: string; lastError?: string }> } };
      return (data.data?.activeTargets ?? []).map((t) => ({
        job: t.labels.job ?? 'unknown',
        instance: t.labels.instance ?? 'unknown',
        health: (t.health as 'up' | 'down' | 'unknown') ?? 'unknown',
        lastScrape: t.lastScrape,
        lastError: t.lastError,
        labels: t.labels,
      }));
    } catch {
      return [];
    }
  }

  /**
   * 检查期望指标
   */
  private async checkExpectedMetrics(): Promise<PrometheusCheckResult['expectedMetrics']> {
    const results: PrometheusCheckResult['expectedMetrics'] = [];
    for (const metric of this.expectedMetrics) {
      try {
        const res = await this.fetchImpl(`${this.prometheusUrl}/api/v1/metadata`, {
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) {
          results.push({ name: metric, found: false });
          continue;
        }
        const data = await res.json() as { data?: Record<string, { type?: string; help?: string }> };
        const meta = data.data?.[metric];
        results.push({
          name: metric,
          found: !!meta,
          type: meta?.type,
        });
      } catch {
        results.push({ name: metric, found: false });
      }
    }
    return results;
  }

  /**
   * 获取 Grafana 数据源
   */
  private async fetchDataSources(): Promise<GrafanaDataSource[]> {
    try {
      const res = await this.fetchImpl(`${this.grafanaUrl}/api/datasources`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return [];
      const data = await res.json() as Array<{ id: number; name: string; type: string; url: string; isDefault: boolean; access: string }>;
      return data.map((ds) => ({
        id: ds.id,
        name: ds.name,
        type: ds.type,
        url: ds.url,
        isDefault: ds.isDefault,
        access: ds.access,
      }));
    } catch {
      return [];
    }
  }

  /**
   * 空 Grafana 结果
   */
  private emptyGrafanaResult(): GrafanaCheckResult {
    return {
      available: false,
      dataSources: [],
      prometheusDatasourceFound: false,
      durationMs: 0,
      error: 'Grafana URL not configured',
    };
  }

  /**
   * 构建摘要
   */
  private buildSummary(p: PrometheusCheckResult, g: GrafanaCheckResult, passed: boolean): string {
    const status = passed ? '✅ MONITORING OK' : '❌ MONITORING ISSUES';
    const lines = [status];
    if (p.available) {
      lines.push(`Prometheus v${p.version ?? 'unknown'}: ${p.activeTargets}/${p.totalTargets} targets up`);
      const found = p.expectedMetrics.filter((m) => m.found).length;
      lines.push(`Metrics: ${found}/${p.expectedMetrics.length} expected metrics found`);
    } else {
      lines.push(`Prometheus: unavailable (${p.error})`);
    }
    if (this.grafanaUrl) {
      if (g.available) {
        lines.push(`Grafana: ${g.dataSources.length} datasources, prometheus=${g.prometheusDatasourceFound}`);
      } else {
        lines.push(`Grafana: unavailable (${g.error})`);
      }
    }
    return lines.join(' | ');
  }

  /**
   * 构建建议
   */
  private buildRecommendations(p: PrometheusCheckResult, g: GrafanaCheckResult): string[] {
    const recs: string[] = [];
    if (!p.available) {
      recs.push(`Prometheus 不可用: docker compose --profile monitoring up -d prometheus`);
    } else {
      const downTargets = p.targets.filter((t) => t.health === 'down');
      if (downTargets.length > 0) {
        recs.push(`${downTargets.length} 个 scrape 目标 down: ${downTargets.map((t) => t.job + '/' + t.instance).join(', ')}`);
        for (const t of downTargets) {
          if (t.lastError) {
            recs.push(`  - ${t.instance}: ${t.lastError}`);
          }
        }
      }
      const missingMetrics = p.expectedMetrics.filter((m) => !m.found);
      if (missingMetrics.length > 0) {
        recs.push(`期望指标未找到: ${missingMetrics.map((m) => m.name).join(', ')}`);
        recs.push(`  - 检查后端 /metrics 端点是否暴露这些指标`);
      }
    }
    if (this.grafanaUrl && !g.available) {
      recs.push(`Grafana 不可用: docker compose --profile monitoring up -d grafana`);
    } else if (this.grafanaUrl && g.available && !g.prometheusDatasourceFound) {
      recs.push(`Grafana 未配置 Prometheus 数据源: 检查 provisioning 配置`);
    }
    return recs;
  }

  /**
   * 触发事件
   */
  private emit(event: MonitoringEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略
      }
    }
  }
}

// ============================================================
// 事件和配置
// ============================================================

export interface MonitoringValidatorConfig {
  prometheusUrl: string;
  grafanaUrl?: string;
  expectedMetrics?: string[];
  expectedTargets?: string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type MonitoringEvent =
  | { type: 'start'; timestamp: number }
  | { type: 'complete'; timestamp: number; report: MonitoringReport };

export type MonitoringListener = (event: MonitoringEvent) => void;

// ============================================================
// 报告导出
// ============================================================

/**
 * 导出为 Markdown
 */
export function exportMonitoringReportMarkdown(report: MonitoringReport): string {
  const lines: string[] = [];
  const status = report.overallPassed ? '✅ MONITORING OK' : '❌ MONITORING ISSUES';
  lines.push(`# 监控栈验证报告`);
  lines.push('');
  lines.push(`**状态**: ${status}`);
  lines.push(`**时间**: ${new Date(report.timestamp).toISOString()}`);
  lines.push(`**耗时**: ${report.durationMs}ms`);
  lines.push('');
  lines.push(`## 摘要`);
  lines.push(report.summary);
  lines.push('');
  lines.push(`## Prometheus`);
  if (report.prometheus.available) {
    lines.push(`- **版本**: ${report.prometheus.version ?? 'unknown'}`);
    lines.push(`- **Scrape 目标**: ${report.prometheus.activeTargets}/${report.prometheus.totalTargets} up`);
    if (report.prometheus.targets.length > 0) {
      lines.push(`- **目标详情**:`);
      for (const t of report.prometheus.targets) {
        const icon = t.health === 'up' ? '✓' : '✗';
        lines.push(`  - ${icon} ${t.job} (${t.instance}): ${t.health}${t.lastError ? ' - ' + t.lastError : ''}`);
      }
    }
    if (report.prometheus.expectedMetrics.length > 0) {
      lines.push(`- **指标检查**:`);
      for (const m of report.prometheus.expectedMetrics) {
        const icon = m.found ? '✓' : '✗';
        lines.push(`  - ${icon} ${m.name}${m.type ? ` (${m.type})` : ''}`);
      }
    }
  } else {
    lines.push(`- **不可用**: ${report.prometheus.error}`);
  }
  lines.push('');
  lines.push(`## Grafana`);
  if (report.grafana.available) {
    lines.push(`- **数据源数**: ${report.grafana.dataSources.length}`);
    lines.push(`- **Prometheus 数据源**: ${report.grafana.prometheusDatasourceFound ? '已配置' : '未配置'}`);
    for (const ds of report.grafana.dataSources) {
      lines.push(`  - ${ds.name} (${ds.type}): ${ds.url}${ds.isDefault ? ' [默认]' : ''}`);
    }
  } else if (report.grafana.error) {
    lines.push(`- ${report.grafana.error}`);
  }
  if (report.recommendations.length > 0) {
    lines.push('');
    lines.push(`## 修复建议`);
    for (const rec of report.recommendations) {
      lines.push(`- ${rec}`);
    }
  }
  return lines.join('\n');
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建 MonitoringStackValidator 实例
 */
export function createMonitoringStackValidator(config: MonitoringValidatorConfig): MonitoringStackValidator {
  return new MonitoringStackValidator(config);
}
