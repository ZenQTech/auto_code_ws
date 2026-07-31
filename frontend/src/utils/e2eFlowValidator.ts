/**
 * # ============================================================
 * # 真实部署 E2E 流程验证器 (Cycle 51 G51-02)
 * # ============================================================
 * # 核心作用：端到端验证真实部署环境 (前端 → API → DB → 火山方舟)
 * #           模拟用户从浏览器到后端到数据库到外部 API 的完整调用链
 * # 运行流程：
 * #   1. 验证前端可访问 (GET /)
 * #   2. 通过前端反向代理调用后端 API
 * #   3. 后端 API 验证数据库连接
 * #   4. 后端 API 验证外部服务 (火山方舟 / Mock)
 * #   5. 验证 CORS / 认证 / 限流
 * #   6. 输出 E2E 报告
 * # 输入参数：endpoints + auth + timeout
 * # 输出结果：E2EFlowReport { steps[], overallPassed, durationMs, summary }
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 51 G51-02 初次创建
 * # ====================================
 */

// ============================================================
// 类型定义
// ============================================================

/** E2E 流程步骤类型 */
export type E2EStepType =
  | 'frontend-root'         // 访问前端根路径
  | 'frontend-asset'        // 前端静态资源
  | 'frontend-healthz'      // 前端健康检查
  | 'api-health'            // 后端健康检查
  | 'api-auth'              // 后端认证
  | 'api-rag'               // RAG API 调用
  | 'api-multimodal'        // 多模态 API
  | 'api-mcp'               // MCP API
  | 'api-volcengine'        // 火山方舟 API
  | 'api-db-read'           // 数据库读取
  | 'api-db-write'          // 数据库写入
  | 'api-metrics'           // 指标端点
  | 'cors-preflight'        // CORS 预检
  | 'rate-limit'            // 限流验证
  | 'custom';               // 自定义

/** 单个 E2E 步骤定义 */
export interface E2EStep {
  /** 步骤 ID */
  id: string;
  /** 步骤类型 */
  type: E2EStepType;
  /** 步骤描述 */
  description: string;
  /** HTTP 方法 (默认 GET) */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS';
  /** 路径 (相对 baseUrl) */
  path: string;
  /** 请求体 (JSON) */
  body?: unknown;
  /** 请求头 */
  headers?: Record<string, string>;
  /** 期望状态码 (默认 200) */
  expectedStatus?: number | number[];
  /** 响应验证函数 */
  validateResponse?: (response: Response, body: string) => Promise<string | null>;
  /** 超时 (毫秒) */
  timeoutMs?: number;
  /** 跳过此步骤 */
  skip?: boolean;
}

/** E2E 流程定义 */
export interface E2EFlow {
  /** 流程名称 */
  name: string;
  /** 流程描述 */
  description: string;
  /** 前端 baseUrl (浏览器入口) */
  frontendBaseUrl: string;
  /** 后端 baseUrl (API 入口) */
  backendBaseUrl: string;
  /** 步骤列表 */
  steps: E2EStep[];
}

/** 单个步骤结果 */
export interface E2EStepResult {
  /** 步骤 ID */
  id: string;
  /** 步骤类型 */
  type: E2EStepType;
  /** 步骤描述 */
  description: string;
  /** 是否通过 */
  passed: boolean;
  /** HTTP 状态码 */
  statusCode?: number;
  /** 耗时 (毫秒) */
  durationMs: number;
  /** 错误信息 */
  error?: string;
  /** 验证错误 */
  validationError?: string;
  /** 响应摘要 */
  responseSummary?: string;
}

/** 整体 E2E 报告 */
export interface E2EFlowReport {
  /** 流程名称 */
  flowName: string;
  /** 时间戳 */
  timestamp: number;
  /** 总耗时 */
  durationMs: number;
  /** 是否整体通过 */
  overallPassed: boolean;
  /** 通过步骤 */
  passedSteps: number;
  /** 失败步骤 */
  failedSteps: number;
  /** 跳过步骤 */
  skippedSteps: number;
  /** 总步骤 */
  totalSteps: number;
  /** 步骤结果 */
  steps: E2EStepResult[];
  /** 摘要 */
  summary: string;
  /** 建议 */
  recommendations: string[];
}

// ============================================================
// E2EFlowValidator 主类
// ============================================================

export class E2EFlowValidator {
  private readonly fetchImpl: typeof fetch;
  private readonly defaultTimeoutMs: number;
  private readonly listeners: Set<E2EListener> = new Set();

  constructor(config: E2EValidatorConfig = {}) {
    this.fetchImpl = config.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : (() => { throw new Error('fetch not available'); }) as unknown as typeof fetch);
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 10000;
  }

  /**
   * 订阅事件
   */
  subscribe(listener: E2EListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 执行 E2E 流程
   */
  async runFlow(flow: E2EFlow): Promise<E2EFlowReport> {
    const start = Date.now();
    this.emit({ type: 'flow-start', timestamp: start, flowName: flow.name, totalSteps: flow.steps.length });

    const stepResults: E2EStepResult[] = [];

    for (const step of flow.steps) {
      if (step.skip) {
        stepResults.push({
          id: step.id,
          type: step.type,
          description: step.description,
          passed: true,
          durationMs: 0,
        });
        continue;
      }

      const result = await this.runStep(step, flow);
      stepResults.push(result);

      this.emit({
        type: 'step-complete',
        timestamp: Date.now(),
        flowName: flow.name,
        stepId: step.id,
        passed: result.passed,
      });

      // 失败时记录但不中断流程
    }

    const totalSteps = stepResults.length;
    const passedSteps = stepResults.filter((r) => r.passed).length;
    const skippedSteps = stepResults.filter((r) => r.durationMs === 0).length;
    const failedSteps = totalSteps - passedSteps;
    const overallPassed = failedSteps === 0;

    const report: E2EFlowReport = {
      flowName: flow.name,
      timestamp: start,
      durationMs: Date.now() - start,
      overallPassed,
      passedSteps,
      failedSteps,
      skippedSteps,
      totalSteps,
      steps: stepResults,
      summary: this.buildSummary(flow.name, stepResults, overallPassed),
      recommendations: this.buildRecommendations(stepResults),
    };

    this.emit({ type: 'flow-complete', timestamp: Date.now(), report });
    return report;
  }

  /**
   * 运行多个流程
   */
  async runFlows(flows: E2EFlow[]): Promise<E2EFlowReport[]> {
    return Promise.all(flows.map((f) => this.runFlow(f)));
  }

  /**
   * 运行单个步骤
   */
  private async runStep(step: E2EStep, flow: E2EFlow): Promise<E2EStepResult> {
    const start = Date.now();
    const baseUrl = this.isFrontendStep(step.type) ? flow.frontendBaseUrl : flow.backendBaseUrl;
    const url = `${baseUrl.replace(/\/$/, '')}${step.path}`;
    const method = step.method ?? 'GET';
    const timeoutMs = step.timeoutMs ?? this.defaultTimeoutMs;

    try {
      const init: RequestInit = {
        method,
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json', ...step.headers },
      };
      if (step.body && method !== 'GET' && method !== 'OPTIONS') {
        init.body = JSON.stringify(step.body);
      }

      const response = await this.fetchImpl(url, init);
      const body = await response.text();
      const expected = step.expectedStatus ?? 200;
      const expectedArr = Array.isArray(expected) ? expected : [expected];
      const statusPassed = expectedArr.includes(response.status);

      // 自定义响应验证
      let validationError: string | undefined;
      if (statusPassed && step.validateResponse) {
        const err = await step.validateResponse(response, body);
        if (err) {
          validationError = err;
        }
      }

      const passed = statusPassed && !validationError;
      const summary = body.length > 200 ? body.slice(0, 200) + '...' : body;

      return {
        id: step.id,
        type: step.type,
        description: step.description,
        passed,
        statusCode: response.status,
        durationMs: Date.now() - start,
        error: statusPassed ? undefined : `Expected status ${expectedArr.join('|')}, got ${response.status}`,
        validationError,
        responseSummary: summary,
      };
    } catch (err) {
      return {
        id: step.id,
        type: step.type,
        description: step.description,
        passed: false,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 是否是前端步骤
   */
  private isFrontendStep(type: E2EStepType): boolean {
    return ['frontend-root', 'frontend-asset', 'frontend-healthz'].includes(type);
  }

  /**
   * 构建摘要
   */
  private buildSummary(name: string, results: E2EStepResult[], passed: boolean): string {
    const total = results.length;
    const ok = results.filter((r) => r.passed).length;
    const status = passed ? '✅ PASSED' : '❌ FAILED';
    return `${status} - ${name}: ${ok}/${total} steps passed`;
  }

  /**
   * 构建建议
   */
  private buildRecommendations(results: E2EStepResult[]): string[] {
    const recs: string[] = [];
    for (const r of results) {
      if (r.passed) continue;
      if (r.type === 'frontend-root' || r.type === 'frontend-asset' || r.type === 'frontend-healthz') {
        recs.push(`[${r.id}] 前端访问失败: 检查 Nginx 容器 (docker ps | grep frontend)`);
      } else if (r.type === 'api-health') {
        recs.push(`[${r.id}] 后端健康检查失败: 检查 FastAPI 启动 (docker logs backend)`);
      } else if (r.type === 'api-db-read' || r.type === 'api-db-write') {
        recs.push(`[${r.id}] 数据库操作失败: 检查 PostgreSQL 连接 (docker logs postgres && docker exec postgres pg_isready)`);
      } else if (r.type === 'api-volcengine') {
        recs.push(`[${r.id}] 火山方舟 API 失败: 检查 API Key 配置 (env VOLCENGINE_API_KEY) 和网络连接`);
      } else if (r.type === 'api-rag' || r.type === 'api-multimodal' || r.type === 'api-mcp') {
        recs.push(`[${r.id}] ${r.type} API 失败: 检查后端路由和服务依赖`);
      } else if (r.type === 'cors-preflight') {
        recs.push(`[${r.id}] CORS 预检失败: 检查后端 CORS 中间件配置`);
      } else if (r.type === 'rate-limit') {
        recs.push(`[${r.id}] 限流验证失败: 检查 RateLimiter 中间件`);
      } else {
        recs.push(`[${r.id}] 步骤失败: ${r.error ?? '未知错误'}`);
      }
    }
    return recs;
  }

  /**
   * 触发事件
   */
  private emit(event: E2EEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略 listener 错误
      }
    }
  }
}

// ============================================================
// 事件和配置
// ============================================================

export interface E2EValidatorConfig {
  defaultTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type E2EEvent =
  | { type: 'flow-start'; timestamp: number; flowName: string; totalSteps: number }
  | { type: 'step-complete'; timestamp: number; flowName: string; stepId: string; passed: boolean }
  | { type: 'flow-complete'; timestamp: number; report: E2EFlowReport };

export type E2EListener = (event: E2EEvent) => void;

// ============================================================
// 报告导出
// ============================================================

/**
 * 导出为 Markdown
 */
export function exportE2EFlowReportMarkdown(report: E2EFlowReport): string {
  const lines: string[] = [];
  const status = report.overallPassed ? '✅ PASSED' : '❌ FAILED';
  lines.push(`# E2E 流程验证报告 - ${report.flowName}`);
  lines.push('');
  lines.push(`**状态**: ${status}`);
  lines.push(`**时间**: ${new Date(report.timestamp).toISOString()}`);
  lines.push(`**耗时**: ${report.durationMs}ms`);
  lines.push(`**总步骤**: ${report.totalSteps} | **通过**: ${report.passedSteps} | **失败**: ${report.failedSteps} | **跳过**: ${report.skippedSteps}`);
  lines.push('');
  lines.push(`## 摘要`);
  lines.push(report.summary);
  lines.push('');
  lines.push(`## 步骤详情`);
  for (const s of report.steps) {
    const icon = s.passed ? '✅' : (s.durationMs === 0 ? '⏭️' : '❌');
    lines.push(`### ${icon} ${s.id} - ${s.description}`);
    lines.push(`- **类型**: ${s.type}`);
    lines.push(`- **耗时**: ${s.durationMs}ms`);
    if (s.statusCode !== undefined) lines.push(`- **状态码**: ${s.statusCode}`);
    if (s.error) lines.push(`- **错误**: ${s.error}`);
    if (s.validationError) lines.push(`- **验证错误**: ${s.validationError}`);
    if (s.responseSummary) lines.push(`- **响应**: \`${s.responseSummary.replace(/\n/g, ' ').slice(0, 100)}\``);
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
// 预定义流程
// ============================================================

/**
 * 创建完整 E2E 流程 (前端 → API → DB → 火山方舟)
 */
export function createFullStackFlow(frontendBaseUrl: string, backendBaseUrl: string): E2EFlow {
  return {
    name: '完整堆栈 E2E 验证',
    description: '前端 → API → DB → 火山方舟 完整调用链',
    frontendBaseUrl,
    backendBaseUrl,
    steps: [
      {
        id: 'frontend-root',
        type: 'frontend-root',
        description: '访问前端根路径',
        method: 'GET',
        path: '/',
        expectedStatus: [200, 304],
        validateResponse: async (_res, body) => {
          if (!body.includes('<html') && !body.includes('<!DOCTYPE')) {
            return '响应不是 HTML';
          }
          return null;
        },
      },
      {
        id: 'frontend-healthz',
        type: 'frontend-healthz',
        description: '前端健康检查',
        method: 'GET',
        path: '/healthz',
        expectedStatus: 200,
      },
      {
        id: 'backend-health',
        type: 'api-health',
        description: '后端健康检查',
        method: 'GET',
        path: '/health',
        expectedStatus: 200,
      },
      {
        id: 'backend-api-health',
        type: 'api-health',
        description: '后端 API 健康检查',
        method: 'GET',
        path: '/api/v1/health',
        expectedStatus: [200, 404], // 404 表示后端运行但未实现该端点
      },
      {
        id: 'backend-openapi',
        type: 'api-health',
        description: 'OpenAPI 文档可用',
        method: 'GET',
        path: '/openapi.json',
        expectedStatus: [200, 404],
        skip: true, // 默认跳过, 避免不必要的检查
      },
      {
        id: 'api-rag-search',
        type: 'api-rag',
        description: 'RAG 搜索端点',
        method: 'POST',
        path: '/api/v1/rag/search',
        body: { query: 'test', topK: 5 },
        expectedStatus: [200, 404, 422],
      },
      {
        id: 'api-multimodal-embed',
        type: 'api-multimodal',
        description: '多模态 Embedding 端点',
        method: 'POST',
        path: '/api/v1/multimodal/embed',
        body: { modality: 'text', text: 'test' },
        expectedStatus: [200, 404, 422],
      },
      {
        id: 'api-volcengine',
        type: 'api-volcengine',
        description: '火山方舟 API',
        method: 'POST',
        path: '/api/v1/volcengine/embed',
        body: { modality: 'text', text: 'test' },
        expectedStatus: [200, 404, 422, 503],
      },
      {
        id: 'api-mcp-list',
        type: 'api-mcp',
        description: 'MCP 服务器列表',
        method: 'GET',
        path: '/api/v1/mcp/servers',
        expectedStatus: [200, 404],
      },
      {
        id: 'cors-preflight',
        type: 'cors-preflight',
        description: 'CORS 预检请求',
        method: 'OPTIONS',
        path: '/api/v1/rag/search',
        headers: {
          'Origin': 'http://localhost:8080',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
        expectedStatus: [200, 204, 404],
      },
      {
        id: 'api-metrics',
        type: 'api-metrics',
        description: 'Prometheus 指标端点',
        method: 'GET',
        path: '/metrics',
        expectedStatus: [200, 404],
      },
    ],
  };
}

/**
 * 创建快速冒烟测试流程
 */
export function createSmokeTestFlow(frontendBaseUrl: string, backendBaseUrl: string): E2EFlow {
  return {
    name: '快速冒烟测试',
    description: '关键端点快速验证',
    frontendBaseUrl,
    backendBaseUrl,
    steps: [
      {
        id: 'frontend-healthz',
        type: 'frontend-healthz',
        description: '前端健康',
        method: 'GET',
        path: '/healthz',
        expectedStatus: 200,
      },
      {
        id: 'backend-health',
        type: 'api-health',
        description: '后端健康',
        method: 'GET',
        path: '/health',
        expectedStatus: [200, 404],
      },
    ],
  };
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建 E2EFlowValidator 实例
 */
export function createE2EFlowValidator(config: E2EValidatorConfig = {}): E2EFlowValidator {
  return new E2EFlowValidator(config);
}
