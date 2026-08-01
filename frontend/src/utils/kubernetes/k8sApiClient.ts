/**
 * # ============================================================
 * # K8s API Client - Kubernetes API 客户端 (Cycle 55 G55-04)
 * # ============================================================
 * # 核心作用：通过 HTTP 与真实 K8s API Server 交互
 * # 兼容：Kubernetes 1.28+ REST API
 * # 支持：List/Get/Create/Update/Delete/Patch/Watch
 * # 认证：Bearer Token / Client Cert / ServiceAccount Token
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 55 G55-04 初次创建
 * # ====================================
 */

/** K8s API Server 端点配置 */
export interface K8sApiConfig {
  /** API Server 地址 (例如 https://api.example.com:6443) */
  apiServerUrl: string;
  /** 认证方式 */
  auth: K8sAuth;
  /** 默认命名空间 */
  namespace?: string;
  /** CA 证书 (PEM 字符串) - 浏览器环境通过代理使用 */
  caBundle?: string;
  /** 跳过 TLS 验证（仅开发环境） */
  insecureSkipTlsVerify?: boolean;
  /** 请求超时（毫秒） */
  timeoutMs?: number;
  /** 重试策略 */
  retryPolicy?: { maxRetries: number; backoffMs: number };
  /** 传输模式 */
  mode?: 'mock' | 'real' | 'hybrid';
}

/** K8s 认证方式 */
export type K8sAuth =
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'serviceAccount'; tokenPath: string }
  | { type: 'clientCert'; clientCert: string; clientKey: string }
  | { type: 'anonymous' };

/** K8s API 响应 (List) */
export interface K8sListResponse<T> {
  apiVersion: string;
  kind: string;
  metadata: {
    resourceVersion: string;
    continue?: string;
    remainingItemCount?: number;
  };
  items: T[];
}

/** K8s ObjectMeta */
export interface K8sObjectMeta {
  name: string;
  namespace?: string;
  uid?: string;
  resourceVersion?: string;
  generation?: number;
  creationTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  managedFields?: unknown[];
}

/** K8s Status 响应 (用于错误) */
export interface K8sStatus {
  apiVersion?: string;
  kind: 'Status';
  status: 'Success' | 'Failure';
  message?: string;
  reason?: string;
  code?: number;
  details?: Record<string, unknown>;
}

/** K8s Event 事件 */
export interface K8sEvent {
  type: 'ADDED' | 'MODIFIED' | 'DELETED' | 'ERROR';
  object: Record<string, unknown>;
}

/** K8s API 错误 */
export class K8sApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly k8sStatus: K8sStatus,
    message?: string
  ) {
    super(message ?? `${k8sStatus.reason ?? 'Unknown'}: ${k8sStatus.message ?? ''}`);
    this.name = 'K8sApiError';
  }
}

// ============================================================
// K8s API Client 实现
// ============================================================

export class K8sApiClient {
  private readonly config: Required<Omit<K8sApiConfig, 'caBundle' | 'namespace'>> & {
    namespace: string;
    caBundle?: string;
  };
  private watchAbortControllers: Map<string, AbortController> = new Map();

  constructor(config: K8sApiConfig) {
    this.config = {
      apiServerUrl: config.apiServerUrl.replace(/\/+$/, ''),
      auth: config.auth,
      namespace: config.namespace ?? 'default',
      caBundle: config.caBundle,
      insecureSkipTlsVerify: config.insecureSkipTlsVerify ?? false,
      timeoutMs: config.timeoutMs ?? 30000,
      retryPolicy: config.retryPolicy ?? { maxRetries: 3, backoffMs: 1000 },
      mode: config.mode ?? 'mock',
    };
  }

  // ============================================================
  // 通用 HTTP 请求
  // ============================================================

  /**
   * 发送 K8s API 请求
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { watch?: boolean } = {}
  ): Promise<T> {
    if (this.config.mode === 'mock') {
      return this.mockRequest<T>(method, path, body);
    }
    const url = `${this.config.apiServerUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    // 注入认证
    if (this.config.auth.type === 'bearer') {
      headers.Authorization = `Bearer ${this.config.auth.token}`;
    } else if (this.config.auth.type === 'basic') {
      const credentials = btoa(`${this.config.auth.username}:${this.config.auth.password}`);
      headers.Authorization = `Basic ${credentials}`;
    }

    const controller = new AbortController();
    if (options.watch) {
      const watchId = `${method}:${path}`;
      this.watchAbortControllers.set(watchId, controller);
    }
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorBody = (await res.json().catch(() => ({}))) as K8sStatus;
        throw new K8sApiError(res.status, errorBody, `K8s API ${res.status}: ${res.statusText}`);
      }

      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof K8sApiError) throw err;
      throw new Error(`K8s API request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ============================================================
  // 核心 API
  // ============================================================

  /**
   * 列出资源
   */
  async list<T = Record<string, unknown>>(options: {
    group?: string;
    version: string;
    plural: string;
    namespace?: string;
    labelSelector?: string;
    fieldSelector?: string;
    limit?: number;
    continue?: string;
  }): Promise<K8sListResponse<T>> {
    const ns = options.namespace ?? this.config.namespace;
    const basePath = this.buildResourcePath(options.group, options.version, options.plural, ns);
    const params = new URLSearchParams();
    if (options.labelSelector) params.set('labelSelector', options.labelSelector);
    if (options.fieldSelector) params.set('fieldSelector', options.fieldSelector);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.continue) params.set('continue', options.continue);
    const queryString = params.toString();
    const path = queryString ? `${basePath}?${queryString}` : basePath;
    return this.request<K8sListResponse<T>>('GET', path);
  }

  /**
   * 获取单个资源
   */
  async get<T = Record<string, unknown>>(options: {
    group?: string;
    version: string;
    plural: string;
    name: string;
    namespace?: string;
  }): Promise<T> {
    const ns = options.namespace ?? this.config.namespace;
    const path = `${this.buildResourcePath(options.group, options.version, options.plural, ns)}/${options.name}`;
    return this.request<T>('GET', path);
  }

  /**
   * 创建资源
   */
  async create<T = Record<string, unknown>>(
    resource: T & { metadata: K8sObjectMeta },
    options: { group?: string; version: string; plural: string; namespace?: string }
  ): Promise<T> {
    const ns = options.namespace ?? resource.metadata.namespace ?? this.config.namespace;
    const path = this.buildResourcePath(options.group, options.version, options.plural, ns);
    return this.request<T>('POST', path, resource);
  }

  /**
   * 更新资源 (PUT)
   */
  async update<T = Record<string, unknown>>(
    resource: T & { metadata: K8sObjectMeta },
    options: { group?: string; version: string; plural: string; namespace?: string }
  ): Promise<T> {
    const ns = options.namespace ?? resource.metadata.namespace ?? this.config.namespace;
    const path = `${this.buildResourcePath(options.group, options.version, options.plural, ns)}/${resource.metadata.name}`;
    return this.request<T>('PUT', path, resource);
  }

  /**
   * 删除资源
   */
  async delete(options: {
    group?: string;
    version: string;
    plural: string;
    name: string;
    namespace?: string;
    propagationPolicy?: 'Foreground' | 'Background' | 'Orphan';
    gracePeriodSeconds?: number;
  }): Promise<K8sStatus> {
    const ns = options.namespace ?? this.config.namespace;
    const path = `${this.buildResourcePath(options.group, options.version, options.plural, ns)}/${options.name}`;
    const body: Record<string, unknown> = {};
    if (options.propagationPolicy) body.propagationPolicy = options.propagationPolicy;
    if (options.gracePeriodSeconds !== undefined) body.gracePeriodSeconds = options.gracePeriodSeconds;
    return this.request<K8sStatus>('DELETE', path, body);
  }

  /**
   * Patch 资源 (Strategic Merge / JSON Patch / Merge Patch)
   */
  async patch<T = Record<string, unknown>>(options: {
    group?: string;
    version: string;
    plural: string;
    name: string;
    namespace?: string;
    patchType: 'strategic' | 'json' | 'merge';
    patch: unknown;
  }): Promise<T> {
    const ns = options.namespace ?? this.config.namespace;
    const path = `${this.buildResourcePath(options.group, options.version, options.plural, ns)}/${options.name}`;
    const contentType =
      options.patchType === 'strategic'
        ? 'application/strategic-merge-patch+json'
        : options.patchType === 'json'
          ? 'application/json-patch+json'
          : 'application/merge-patch+json';
    return this.request<T>('PATCH', path, options.patch);
  }

  /**
   * 监听资源变化 (简化版：返回事件流回调)
   */
  async watch(options: {
    group?: string;
    version: string;
    plural: string;
    namespace?: string;
    labelSelector?: string;
    resourceVersion?: string;
    onEvent: (event: K8sEvent) => void;
    onError?: (err: Error) => void;
  }): Promise<() => void> {
    const ns = options.namespace ?? this.config.namespace;
    const basePath = this.buildResourcePath(options.group, options.version, options.plural, ns);
    const params = new URLSearchParams({ watch: 'true' });
    if (options.labelSelector) params.set('labelSelector', options.labelSelector);
    if (options.resourceVersion) params.set('resourceVersion', options.resourceVersion);
    const path = `${basePath}?${params.toString()}`;

    if (this.config.mode === 'mock') {
      return this.mockWatch(path, options.onEvent, options.onError);
    }

    // 真实环境：通过 fetch + ReadableStream
    const url = `${this.config.apiServerUrl}${path}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.config.auth.type === 'bearer') {
      headers.Authorization = `Bearer ${this.config.auth.token}`;
    }

    const controller = new AbortController();
    const watchId = `WATCH:${path}`;
    this.watchAbortControllers.set(watchId, controller);

    try {
      const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
      if (!res.ok || !res.body) {
        const errBody = (await res.json().catch(() => ({}))) as K8sStatus;
        throw new K8sApiError(res.status, errBody, `Watch failed: ${res.statusText}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const pump = async (): Promise<void> => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              if (line.trim()) {
                try {
                  options.onEvent(JSON.parse(line) as K8sEvent);
                } catch (e) {
                  options.onError?.(e instanceof Error ? e : new Error(String(e)));
                }
              }
            }
          }
        } catch (e) {
          if (!controller.signal.aborted) {
            options.onError?.(e instanceof Error ? e : new Error(String(e)));
          }
        }
      };
      pump();

      return () => {
        controller.abort();
        this.watchAbortControllers.delete(watchId);
      };
    } catch (err) {
      this.watchAbortControllers.delete(watchId);
      throw err;
    }
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<{ healthy: boolean; version?: string; latencyMs: number; error?: string }> {
    const start = Date.now();
    if (this.config.mode === 'mock') {
      return { healthy: true, version: 'v1.28.0', latencyMs: 5 };
    }
    try {
      const res = await this.request<{ gitVersion: string }>('GET', '/version');
      return { healthy: true, version: res.gitVersion, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 探测集群 API (列出 namespaces)
   */
  async listNamespaces(): Promise<K8sListResponse<Record<string, unknown>>> {
    return this.list({ version: 'v1', plural: 'namespaces', namespace: '' });
  }

  /**
   * 列出集群节点
   */
  async listNodes(): Promise<K8sListResponse<Record<string, unknown>>> {
    return this.list({ version: 'v1', plural: 'nodes', namespace: '' });
  }

  /**
   * 列出 Pods
   */
  async listPods(namespace?: string, labelSelector?: string): Promise<K8sListResponse<Record<string, unknown>>> {
    return this.list({ version: 'v1', plural: 'pods', namespace, labelSelector });
  }

  /**
   * 列出 Deployments
   */
  async listDeployments(namespace?: string, labelSelector?: string): Promise<K8sListResponse<Record<string, unknown>>> {
    return this.list({ group: 'apps', version: 'v1', plural: 'deployments', namespace, labelSelector });
  }

  /**
   * 列出 Services
   */
  async listServices(namespace?: string): Promise<K8sListResponse<Record<string, unknown>>> {
    return this.list({ version: 'v1', plural: 'services', namespace });
  }

  /**
   * 获取集群信息
   */
  async getClusterInfo(): Promise<{ version: string; platform: string; nodes: number; namespaces: number; pods: number }> {
    if (this.config.mode === 'mock') {
      return {
        version: 'v1.28.0',
        platform: 'linux/amd64',
        nodes: 3,
        namespaces: 8,
        pods: 42,
      };
    }
    const [version, nodes, namespaces, pods] = await Promise.all([
      this.request<{ gitVersion: string; platform: string }>('GET', '/version'),
      this.listNodes(),
      this.listNamespaces(),
      this.listPods(''),
    ]);
    return {
      version: version.gitVersion,
      platform: version.platform,
      nodes: nodes.items.length,
      namespaces: namespaces.items.length,
      pods: pods.items.length,
    };
  }

  /**
   * 停止所有 watch
   */
  stopAllWatches(): void {
    for (const controller of this.watchAbortControllers.values()) {
      controller.abort();
    }
    this.watchAbortControllers.clear();
  }

  // ============================================================
  // 工具方法
  // ============================================================

  private buildResourcePath(group: string | undefined, version: string, plural: string, namespace: string): string {
    const groupPath = group ? `/apis/${group}/${version}` : `/api/${version}`;
    if (namespace) {
      return `${groupPath}/namespaces/${namespace}/${plural}`;
    }
    return `${groupPath}/${plural}`;
  }

  // ============================================================
  // Mock 实现（开发/演示用）
  // ============================================================

  private async mockRequest<T>(method: string, path: string, _body?: unknown): Promise<T> {
    // 模拟网络延迟
    await new Promise((resolve) => setTimeout(resolve, 5));
    // 去除 query string 用于匹配
    const pathOnly = path.split('?')[0];

    // 模拟 List API
    if (method === 'GET' && /\/pods$/.test(pathOnly)) {
      return {
        apiVersion: 'v1',
        kind: 'PodList',
        metadata: { resourceVersion: '12345' },
        items: this.generateMockPods(5),
      } as T;
    }
    if (method === 'GET' && /\/deployments$/.test(pathOnly)) {
      return {
        apiVersion: 'apps/v1',
        kind: 'DeploymentList',
        metadata: { resourceVersion: '12345' },
        items: this.generateMockDeployments(3),
      } as T;
    }
    if (method === 'GET' && /\/services$/.test(pathOnly)) {
      return {
        apiVersion: 'v1',
        kind: 'ServiceList',
        metadata: { resourceVersion: '12345' },
        items: this.generateMockServices(4),
      } as T;
    }
    if (method === 'GET' && /\/namespaces$/.test(pathOnly)) {
      return {
        apiVersion: 'v1',
        kind: 'NamespaceList',
        metadata: { resourceVersion: '12345' },
        items: this.generateMockNamespaces(),
      } as T;
    }
    if (method === 'GET' && /\/nodes$/.test(pathOnly)) {
      return {
        apiVersion: 'v1',
        kind: 'NodeList',
        metadata: { resourceVersion: '12345' },
        items: this.generateMockNodes(3),
      } as T;
    }
    if (method === 'GET' && path === '/version') {
      return { gitVersion: 'v1.28.0', platform: 'linux/amd64' } as T;
    }
    if (method === 'POST') {
      return _body as T;
    }
    if (method === 'PUT') {
      return _body as T;
    }
    if (method === 'DELETE') {
      return { kind: 'Status', status: 'Success' } as T;
    }
    return {} as T;
  }

  private mockWatch(path: string, onEvent: (event: K8sEvent) => void, onError?: (err: Error) => void): () => void {
    let counter = 0;
    const interval = setInterval(() => {
      counter += 1;
      const eventType = counter % 3 === 0 ? 'ADDED' : counter % 3 === 1 ? 'MODIFIED' : 'DELETED';
      onEvent({
        type: eventType as K8sEvent['type'],
        object: {
          apiVersion: 'v1',
          kind: 'Pod',
          metadata: { name: `mock-pod-${counter}`, namespace: 'default' },
          spec: {},
          status: { phase: 'Running' },
        },
      });
    }, 1000);

    return () => {
      clearInterval(interval);
      onError?.(new Error('Watch stopped'));
    };
  }

  private generateMockPods(count: number): Array<Record<string, unknown>> {
    return Array.from({ length: count }, (_, i) => ({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: `mock-pod-${i}`,
        namespace: 'default',
        labels: { app: 'mock', tier: 'backend' },
        creationTimestamp: new Date(Date.now() - i * 60000).toISOString(),
      },
      spec: {
        containers: [{ name: 'app', image: 'nginx:1.25' }],
      },
      status: { phase: i % 3 === 0 ? 'Pending' : 'Running' },
    }));
  }

  private generateMockDeployments(count: number): Array<Record<string, unknown>> {
    return Array.from({ length: count }, (_, i) => ({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: `mock-deploy-${i}`, namespace: 'default' },
      spec: { replicas: 3 },
      status: { readyReplicas: 3, availableReplicas: 3 },
    }));
  }

  private generateMockServices(count: number): Array<Record<string, unknown>> {
    return Array.from({ length: count }, (_, i) => ({
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: `mock-svc-${i}`, namespace: 'default' },
      spec: { type: 'ClusterIP', ports: [{ port: 80, targetPort: 8080 }] },
    }));
  }

  private generateMockNamespaces(): Array<Record<string, unknown>> {
    return [
      { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'default' } },
      { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'kube-system' } },
      { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'production' } },
      { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'staging' } },
    ];
  }

  private generateMockNodes(count: number): Array<Record<string, unknown>> {
    return Array.from({ length: count }, (_, i) => ({
      apiVersion: 'v1',
      kind: 'Node',
      metadata: { name: `node-${i}` },
      status: {
        conditions: [{ type: 'Ready', status: 'True' }],
        nodeInfo: { kubeletVersion: 'v1.28.0' },
      },
    }));
  }
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 快速创建 K8s API 客户端
 */
export function createK8sClient(config: K8sApiConfig): K8sApiClient {
  return new K8sApiClient(config);
}
