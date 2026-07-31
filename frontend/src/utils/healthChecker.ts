/**
 * # ============================================================
 * # 部署健康检查器 (Cycle 51 G51-01)
 * # ============================================================
 * # 核心作用：验证 Docker Compose 完整服务栈的可用性
 * #           支持多服务并行检查 + 重试 + 详细报告
 * # 运行流程：
 * #   1. 并行检查所有服务 (frontend/backend/postgres/prometheus/grafana)
 * #   2. 每个服务验证 HTTP 端点 + 关键健康指标
 * #   3. 失败时自动重试, 最终输出可执行报告
 * #   4. 支持 JSON / Markdown 导出
 * # 输入参数：services (URL + type + checks)
 * # 输出结果：HealthCheckReport { overall, services[], durationMs, summary }
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 51 G51-01 初次创建
 * # ====================================
 */

// ============================================================
// 类型定义
// ============================================================

/** 服务类型 */
export type ServiceType = 'frontend' | 'backend' | 'database' | 'monitoring' | 'cache' | 'custom';

/** 服务健康检查定义 */
export interface ServiceHealthCheck {
  /** 服务名称 */
  name: string;
  /** 服务类型 */
  type: ServiceType;
  /** 基础 URL */
  baseUrl: string;
  /** 健康检查端点 (相对路径) */
  healthPath?: string;
  /** 关键端点 (必须返回 2xx) */
  criticalPaths?: string[];
  /** 自定义检查函数 */
  customChecks?: HealthCheckStep[];
  /** 超时 (毫秒) */
  timeoutMs?: number;
  /** 重试次数 */
  retries?: number;
  /** 重试间隔 (毫秒) */
  retryDelayMs?: number;
  /** 必选服务 (失败时整体失败) */
  required?: boolean;
  /** 服务元数据 */
  metadata?: Record<string, unknown>;
}

/** 单个检查步骤 */
export interface HealthCheckStep {
  /** 步骤名称 */
  name: string;
  /** 步骤描述 */
  description: string;
  /** 执行函数 */
  check: (ctx: HealthCheckContext) => Promise<HealthCheckStepResult>;
}

/** 检查步骤上下文 */
export interface HealthCheckContext {
  /** 服务定义 */
  service: ServiceHealthCheck;
  /** fetch 函数 (可注入) */
  fetchImpl: typeof fetch;
  /** AbortSignal 工厂 */
  signal: (timeoutMs: number) => AbortSignal;
  /** 临时存储 (跨步骤共享数据) */
  state: Map<string, unknown>;
}

/** 单个步骤结果 */
export interface HealthCheckStepResult {
  /** 是否通过 */
  passed: boolean;
  /** 耗时 (毫秒) */
  durationMs: number;
  /** 详细信息 */
  details?: Record<string, unknown>;
  /** 错误信息 */
  error?: string;
}

/** 单个服务检查结果 */
export interface ServiceCheckResult {
  /** 服务名称 */
  name: string;
  /** 服务类型 */
  type: ServiceType;
  /** 是否通过 */
  passed: boolean;
  /** 是否必选 */
  required: boolean;
  /** 端点检查结果 */
  endpointChecks: Array<{
    path: string;
    passed: boolean;
    statusCode?: number;
    durationMs: number;
    error?: string;
  }>;
  /** 自定义检查结果 */
  customCheckResults: Array<{
    name: string;
    passed: boolean;
    durationMs: number;
    error?: string;
    details?: Record<string, unknown>;
  }>;
  /** 总耗时 */
  durationMs: number;
  /** 错误信息 */
  error?: string;
}

/** 整体健康检查报告 */
export interface HealthCheckReport {
  /** 时间戳 */
  timestamp: number;
  /** 总耗时 */
  durationMs: number;
  /** 是否整体通过 */
  overallPassed: boolean;
  /** 服务数 */
  totalServices: number;
  /** 通过服务数 */
  passedServices: number;
  /** 失败服务数 */
  failedServices: number;
  /** 必选失败服务数 */
  criticalFailures: number;
  /** 服务结果 */
  services: ServiceCheckResult[];
  /** 摘要 (人类可读) */
  summary: string;
  /** 建议 */
  recommendations: string[];
}

// ============================================================
// HealthChecker 主类
// ============================================================

export class HealthChecker {
  private readonly services: ServiceHealthCheck[];
  private readonly defaultTimeoutMs: number;
  private readonly defaultRetries: number;
  private readonly defaultRetryDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly listeners: Set<HealthCheckListener> = new Set();

  constructor(config: HealthCheckerConfig = {}) {
    this.services = config.services ?? [];
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 5000;
    this.defaultRetries = config.defaultRetries ?? 3;
    this.defaultRetryDelayMs = config.defaultRetryDelayMs ?? 1000;
    this.fetchImpl = config.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : (() => { throw new Error('fetch not available'); }) as unknown as typeof fetch);
  }

  /**
   * 添加服务
   */
  addService(service: ServiceHealthCheck): void {
    this.services.push(service);
  }

  /**
   * 订阅事件
   */
  subscribe(listener: HealthCheckListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 执行完整健康检查
   */
  async checkAll(): Promise<HealthCheckReport> {
    const start = Date.now();
    this.emit({ type: 'start', timestamp: start, totalServices: this.services.length });

    // 并行执行所有服务检查
    const serviceResults = await Promise.all(
      this.services.map((s) => this.checkService(s))
    );

    const totalServices = serviceResults.length;
    const passedServices = serviceResults.filter((r) => r.passed).length;
    const failedServices = totalServices - passedServices;
    const criticalFailures = serviceResults.filter((r) => r.required && !r.passed).length;
    const overallPassed = criticalFailures === 0;

    const report: HealthCheckReport = {
      timestamp: start,
      durationMs: Date.now() - start,
      overallPassed,
      totalServices,
      passedServices,
      failedServices,
      criticalFailures,
      services: serviceResults,
      summary: this.buildSummary(serviceResults, overallPassed),
      recommendations: this.buildRecommendations(serviceResults),
    };

    this.emit({ type: 'complete', timestamp: Date.now(), report });
    return report;
  }

  /**
   * 检查单个服务 (带重试)
   */
  async checkService(service: ServiceHealthCheck): Promise<ServiceCheckResult> {
    const start = Date.now();
    const timeoutMs = service.timeoutMs ?? this.defaultTimeoutMs;
    const maxRetries = service.retries ?? this.defaultRetries;
    const retryDelayMs = service.retryDelayMs ?? this.defaultRetryDelayMs;

    let lastError: string | undefined;
    let lastResult: ServiceCheckResult | undefined;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.checkServiceOnce(service, timeoutMs);
        lastResult = result;
        if (result.passed) {
          this.emit({ type: 'service-pass', timestamp: Date.now(), service: service.name, attempt });
          return result;
        }
        lastError = result.error;
        if (attempt < maxRetries) {
          await this.sleep(retryDelayMs);
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < maxRetries) {
          await this.sleep(retryDelayMs);
        }
      }
    }

    // 所有重试失败 - 保留最后一次结果（含 endpointChecks 和 customCheckResults）
    this.emit({ type: 'service-fail', timestamp: Date.now(), service: service.name, error: lastError });
    return {
      name: service.name,
      type: service.type,
      passed: false,
      required: service.required ?? true,
      endpointChecks: lastResult?.endpointChecks ?? [],
      customCheckResults: lastResult?.customCheckResults ?? [],
      durationMs: Date.now() - start,
      error: lastError ?? lastResult?.error ?? 'Unknown error',
    };
  }

  /**
   * 单次服务检查 (无重试)
   */
  private async checkServiceOnce(service: ServiceHealthCheck, timeoutMs: number): Promise<ServiceCheckResult> {
    const start = Date.now();
    const endpointChecks: ServiceCheckResult['endpointChecks'] = [];
    const customCheckResults: ServiceCheckResult['customCheckResults'] = [];
    const state = new Map<string, unknown>();
    const ctx: HealthCheckContext = {
      service,
      fetchImpl: this.fetchImpl,
      signal: (ms) => AbortSignal.timeout(ms),
      state,
    };

    // 1. 健康检查端点
    if (service.healthPath) {
      const result = await this.checkEndpoint(service.baseUrl, service.healthPath, timeoutMs);
      endpointChecks.push(result);
      if (!result.passed) {
        return {
          name: service.name,
          type: service.type,
          passed: false,
          required: service.required ?? true,
          endpointChecks,
          customCheckResults,
          durationMs: Date.now() - start,
          error: `Health endpoint failed: ${result.error ?? 'status ' + result.statusCode}`,
        };
      }
    }

    // 2. 关键端点
    if (service.criticalPaths) {
      for (const path of service.criticalPaths) {
        const result = await this.checkEndpoint(service.baseUrl, path, timeoutMs);
        endpointChecks.push(result);
      }
    }

    // 3. 自定义检查
    if (service.customChecks) {
      for (const step of service.customChecks) {
        const stepStart = Date.now();
        try {
          const result = await step.check(ctx);
          customCheckResults.push({
            name: step.name,
            passed: result.passed,
            durationMs: result.durationMs ?? Date.now() - stepStart,
            error: result.error,
            details: result.details,
          });
        } catch (err) {
          customCheckResults.push({
            name: step.name,
            passed: false,
            durationMs: Date.now() - stepStart,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // 判定: 所有 endpoint 和 custom check 都通过
    const allEndpointsPassed = endpointChecks.every((c) => c.passed);
    const allCustomsPassed = customCheckResults.every((c) => c.passed);
    const passed = allEndpointsPassed && allCustomsPassed;

    return {
      name: service.name,
      type: service.type,
      passed,
      required: service.required ?? true,
      endpointChecks,
      customCheckResults,
      durationMs: Date.now() - start,
    };
  }

  /**
   * 检查单个端点
   */
  private async checkEndpoint(baseUrl: string, path: string, timeoutMs: number): Promise<ServiceCheckResult['endpointChecks'][number]> {
    const start = Date.now();
    const url = `${baseUrl.replace(/\/$/, '')}${path}`;
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const passed = response.ok;
      return {
        path,
        passed,
        statusCode: response.status,
        durationMs: Date.now() - start,
        error: passed ? undefined : `HTTP ${response.status}`,
      };
    } catch (err) {
      return {
        path,
        passed: false,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 构建摘要
   */
  private buildSummary(results: ServiceCheckResult[], overallPassed: boolean): string {
    const status = overallPassed ? '✅ HEALTHY' : '❌ UNHEALTHY';
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    const summary = `${status} - ${passed}/${results.length} services healthy`;
    if (failed > 0) {
      const failedNames = results.filter((r) => !r.passed).map((r) => r.name).join(', ');
      return `${summary}, failed: [${failedNames}]`;
    }
    return summary;
  }

  /**
   * 构建建议
   */
  private buildRecommendations(results: ServiceCheckResult[]): string[] {
    const recs: string[] = [];
    for (const r of results) {
      if (r.passed) continue;
      if (r.type === 'frontend') {
        recs.push(`[${r.name}] Frontend 服务不可用, 检查 Nginx 容器状态: docker ps | grep frontend`);
      } else if (r.type === 'backend') {
        recs.push(`[${r.name}] Backend 服务不可用, 检查 FastAPI 日志: docker logs backend`);
      } else if (r.type === 'database') {
        recs.push(`[${r.name}] Database 服务不可用, 检查 PostgreSQL: docker logs postgres && docker exec -it postgres pg_isready`);
      } else if (r.type === 'monitoring') {
        recs.push(`[${r.name}] 监控服务不可用 (非关键), 可启动: docker compose --profile monitoring up -d`);
      } else {
        recs.push(`[${r.name}] 服务不可用, 检查容器: docker ps | grep ${r.name}`);
      }
      if (r.endpointChecks.some((e) => !e.passed)) {
        const failed = r.endpointChecks.filter((e) => !e.passed).map((e) => e.path).join(', ');
        recs.push(`  - 失败端点: ${failed}`);
      }
    }
    return recs;
  }

  /**
   * 触发事件
   */
  private emit(event: HealthCheckEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略 listener 错误
      }
    }
  }

  /**
   * 睡眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================
// 事件和配置
// ============================================================

export interface HealthCheckerConfig {
  services?: ServiceHealthCheck[];
  defaultTimeoutMs?: number;
  defaultRetries?: number;
  defaultRetryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

export type HealthCheckEvent =
  | { type: 'start'; timestamp: number; totalServices: number }
  | { type: 'service-pass'; timestamp: number; service: string; attempt: number }
  | { type: 'service-fail'; timestamp: number; service: string; error?: string }
  | { type: 'complete'; timestamp: number; report: HealthCheckReport };

export type HealthCheckListener = (event: HealthCheckEvent) => void;

// ============================================================
// 报告导出
// ============================================================

/**
 * 导出为 Markdown
 */
export function exportHealthReportMarkdown(report: HealthCheckReport): string {
  const lines: string[] = [];
  const status = report.overallPassed ? '✅ HEALTHY' : '❌ UNHEALTHY';
  lines.push(`# 部署健康检查报告`);
  lines.push('');
  lines.push(`**状态**: ${status}`);
  lines.push(`**时间**: ${new Date(report.timestamp).toISOString()}`);
  lines.push(`**耗时**: ${report.durationMs}ms`);
  lines.push(`**总服务**: ${report.totalServices} | **通过**: ${report.passedServices} | **失败**: ${report.failedServices} | **关键失败**: ${report.criticalFailures}`);
  lines.push('');
  lines.push(`## 摘要`);
  lines.push(report.summary);
  lines.push('');
  lines.push(`## 服务详情`);
  for (const s of report.services) {
    const icon = s.passed ? '✅' : '❌';
    const req = s.required ? '(关键)' : '(可选)';
    lines.push(`### ${icon} ${s.name} ${req}`);
    lines.push(`- **类型**: ${s.type}`);
    lines.push(`- **耗时**: ${s.durationMs}ms`);
    if (s.error) lines.push(`- **错误**: ${s.error}`);
    if (s.endpointChecks.length > 0) {
      lines.push(`- **端点检查**:`);
      for (const e of s.endpointChecks) {
        const eIcon = e.passed ? '✓' : '✗';
        const status = e.statusCode !== undefined ? `HTTP ${e.statusCode}` : '';
        lines.push(`  - ${eIcon} \`${e.path}\` (${e.durationMs}ms) ${status} ${e.error ?? ''}`);
      }
    }
    if (s.customCheckResults.length > 0) {
      lines.push(`- **自定义检查**:`);
      for (const c of s.customCheckResults) {
        const cIcon = c.passed ? '✓' : '✗';
        lines.push(`  - ${cIcon} ${c.name} (${c.durationMs}ms) ${c.error ?? ''}`);
      }
    }
    lines.push('');
  }
  if (report.recommendations.length > 0) {
    lines.push(`## 修复建议`);
    for (const rec of report.recommendations) {
      lines.push(`- ${rec}`);
    }
  }
  return lines.join('\n');
}

// ============================================================
// 预定义服务配置 (Docker Compose production stack)
// ============================================================

/**
 * 创建默认的 Docker Compose 生产栈健康检查配置
 */
export function createDefaultStackConfig(baseHost: string = 'localhost'): ServiceHealthCheck[] {
  return [
    {
      name: 'frontend',
      type: 'frontend',
      baseUrl: `http://${baseHost}:8080`,
      healthPath: '/healthz',
      criticalPaths: ['/'],
      required: true,
      timeoutMs: 5000,
      retries: 3,
    },
    {
      name: 'backend',
      type: 'backend',
      baseUrl: `http://${baseHost}:8000`,
      healthPath: '/health',
      criticalPaths: ['/api/v1/health', '/api/v1/metrics'],
      required: true,
      timeoutMs: 5000,
      retries: 3,
      customChecks: [
        {
          name: 'api-docs',
          description: 'OpenAPI 文档可用',
          check: async (ctx) => {
            const start = Date.now();
            try {
              const res = await ctx.fetchImpl(`${ctx.service.baseUrl}/openapi.json`, { signal: ctx.signal(3000) });
              return { passed: res.ok, durationMs: Date.now() - start, error: res.ok ? undefined : `HTTP ${res.status}` };
            } catch (err) {
              return { passed: false, durationMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
            }
          },
        },
      ],
    },
    {
      name: 'postgres',
      type: 'database',
      baseUrl: `http://${baseHost}:5432`,
      required: false, // 数据库无 HTTP, 跳过端点检查
      timeoutMs: 3000,
      retries: 2,
      customChecks: [
        {
          name: 'connection',
          description: 'PostgreSQL 连接测试 (通过 backend)',
          check: async (ctx) => {
            const start = Date.now();
            try {
              const res = await ctx.fetchImpl(`http://${baseHost}:8000/api/v1/health/db`, { signal: ctx.signal(3000) });
              return { passed: res.ok, durationMs: Date.now() - start, error: res.ok ? undefined : `HTTP ${res.status}` };
            } catch (err) {
              return { passed: false, durationMs: Date.now() - start, error: 'Backend health/db endpoint not available (expected for mock backend)' };
            }
          },
        },
      ],
    },
    {
      name: 'prometheus',
      type: 'monitoring',
      baseUrl: `http://${baseHost}:9090`,
      healthPath: '/-/healthy',
      required: false,
      timeoutMs: 5000,
      retries: 2,
    },
    {
      name: 'grafana',
      type: 'monitoring',
      baseUrl: `http://${baseHost}:3000`,
      healthPath: '/api/health',
      required: false,
      timeoutMs: 5000,
      retries: 2,
    },
  ];
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建 HealthChecker 实例
 */
export function createHealthChecker(config: HealthCheckerConfig = {}): HealthChecker {
  return new HealthChecker(config);
}
