/**
 * # ============================================================
 * # CRD Generator - CustomResourceDefinition 生成器 (Cycle 55 G55-03)
 * # ============================================================
 * # 核心作用：声明式构造 CRD 和 Controller 配置
 * # 兼容：apiextensions.k8s.io/v1 + Kubebuilder 规范
 * # 包含：CRD 构建 + 简化 Controller 实现 + Reconcile 引擎
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 55 G55-03 初次创建
 * # ====================================
 */

import type {
  CustomResourceDefinition,
  CRDVersion,
  JSONSchemaProperty,
  CustomResource,
  ControllerConfig,
  ControllerState,
  Reconciler,
  ReconcileContext,
  ReconcileResult,
} from './k8sCrdTypes';
import { buildManifestYaml, buildResourceYaml } from './k8sManifestGenerator';
import type { K8sResource } from './k8sTypes';

// ============================================================
// CRD Builder
// ============================================================

export interface CRDBuilderOptions {
  /** CRD 名称 (例如 mcpagents.mcp.hermes.io) */
  name: string;
  /** API group (例如 mcp.hermes.io) */
  group: string;
  /** 复数名称 (例如 mcpagents) */
  plural: string;
  /** 单数名称 (例如 mcpagent) */
  singular: string;
  /** Kind 名称 (例如 McpAgent) */
  kind: string;
  /** 简称 (例如 mcp) */
  shortNames?: string[];
  /** 命名空间作用域 */
  scope?: 'Namespaced' | 'Cluster';
  /** API 版本 (例如 v1, v1alpha1) */
  version: string;
  /** Spec schema */
  specSchema: JSONSchemaProperty;
  /** Status schema (可选) */
  statusSchema?: JSONSchemaProperty;
  /** 额外打印列 */
  additionalPrinterColumns?: CRDVersion['additionalPrinterColumns'];
  /** 是否启用 status 子资源 */
  enableStatusSubresource?: boolean;
  /** 是否启用 scale 子资源 */
  enableScaleSubresource?: boolean;
  /** Labels */
  labels?: Record<string, string>;
  /** 验证规则 */
  validations?: Array<{ rule: string; message?: string }>;
}

/**
 * 创建 CRD Builder
 */
export function createCRDBuilder(options: CRDBuilderOptions): CustomResourceDefinition {
  // 构建 spec schema
  const specProperties: Record<string, JSONSchemaProperty> = {
    ...(options.specSchema.properties ?? {}),
  };
  const specRequired = options.specSchema.required ?? [];

  const crdSpecSchema: JSONSchemaProperty = {
    type: 'object',
    required: ['spec'],
    properties: {
      spec: {
        type: 'object',
        required: specRequired.length > 0 ? specRequired : undefined,
        properties: specProperties,
      },
    },
  };
  if (options.statusSchema) {
    crdSpecSchema.properties!.status = options.statusSchema;
  }
  if (options.validations) {
    crdSpecSchema['x-kubernetes-validations'] = options.validations;
  }

  const version: CRDVersion = {
    name: options.version,
    served: true,
    storage: true,
    schema: { openAPIV3Schema: crdSpecSchema },
  };
  if (options.additionalPrinterColumns) {
    version.additionalPrinterColumns = options.additionalPrinterColumns;
  }
  if (options.enableStatusSubresource || options.enableScaleSubresource) {
    version.subresources = {};
    if (options.enableStatusSubresource) version.subresources.status = {};
    if (options.enableScaleSubresource) {
      version.subresources.scale = {
        specReplicasPath: '.spec.replicas',
        statusReplicasPath: '.status.replicas',
      };
    }
  }

  const metadata: { name: string; labels?: Record<string, string> } = { name: options.name };
  if (options.labels) metadata.labels = options.labels;

  const crd: CustomResourceDefinition = {
    apiVersion: 'apiextensions.k8s.io/v1',
    kind: 'CustomResourceDefinition',
    metadata,
    spec: {
      group: options.group,
      names: {
        plural: options.plural,
        singular: options.singular,
        kind: options.kind,
        listKind: `${options.kind}List`,
      },
      scope: options.scope ?? 'Namespaced',
      versions: [version],
    },
  };
  if (options.shortNames && options.shortNames.length > 0) {
    crd.spec.names.shortNames = options.shortNames;
  }
  return crd;
}

// ============================================================
// McpAgent CRD 模板（MCP × Hermes 平台专用）
// ============================================================

/**
 * McpAgent CRD 预制 schema
 */
export const McpAgentSpecSchema: JSONSchemaProperty = {
  type: 'object',
  required: ['image', 'replicas'],
  properties: {
    image: {
      type: 'string',
      description: '容器镜像 (例如 mcp-hermes/agent:1.0.0)',
      pattern: '^[a-z0-9]+([._-][a-z0-9]+)*(/[a-z0-9]+([._-][a-z0-9]+)*)*(:[a-z0-9._-]+)?(@sha256:[a-f0-9]{64})?$',
    },
    replicas: {
      type: 'integer',
      description: '副本数',
      minimum: 0,
      maximum: 100,
      default: 1,
    },
    model: {
      type: 'string',
      description: 'LLM 模型名称',
      enum: ['claude-sonnet-4.5', 'gpt-4o', 'gpt-4-turbo', 'gemini-2.0-flash', 'doubao-pro-32k', 'qwen-max'],
    },
    tools: {
      type: 'array',
      description: 'MCP 工具列表',
      items: { type: 'string' },
      'x-kubernetes-list-type': 'set',
    },
    resources: {
      type: 'object',
      properties: {
        cpu: { type: 'string', description: 'CPU 资源', default: '500m' },
        memory: { type: 'string', description: '内存资源', default: '512Mi' },
      },
    },
    env: {
      type: 'object',
      description: '环境变量',
      additionalProperties: { type: 'string' },
    },
    autoscaling: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: false },
        minReplicas: { type: 'integer', minimum: 1, default: 1 },
        maxReplicas: { type: 'integer', minimum: 1, default: 10 },
        targetCPUUtilization: { type: 'integer', minimum: 1, maximum: 100, default: 80 },
      },
    },
  },
};

export const McpAgentStatusSchema: JSONSchemaProperty = {
  type: 'object',
  properties: {
    phase: {
      type: 'string',
      enum: ['Pending', 'Running', 'Failed', 'Succeeded'],
    },
    readyReplicas: { type: 'integer' },
    availableReplicas: { type: 'integer' },
    message: { type: 'string' },
    lastUpdated: { type: 'string', format: 'date-time' },
  },
};

/**
 * 一键创建 McpAgent CRD
 */
export function createMcpAgentCRD(options: { version?: string; labels?: Record<string, string> } = {}): CustomResourceDefinition {
  return createCRDBuilder({
    name: 'mcpagents.mcp.hermes.io',
    group: 'mcp.hermes.io',
    plural: 'mcpagents',
    singular: 'mcpagent',
    kind: 'McpAgent',
    shortNames: ['mcp', 'mcpa'],
    scope: 'Namespaced',
    version: options.version ?? 'v1',
    specSchema: McpAgentSpecSchema,
    statusSchema: McpAgentStatusSchema,
    enableStatusSubresource: true,
    additionalPrinterColumns: [
      { name: 'image', type: 'string', jsonPath: '.spec.image' },
      { name: 'replicas', type: 'integer', jsonPath: '.spec.replicas' },
      { name: 'model', type: 'string', jsonPath: '.spec.model' },
      { name: 'phase', type: 'string', jsonPath: '.status.phase' },
      { name: 'age', type: 'date', jsonPath: '.metadata.creationTimestamp' },
    ],
    validations: [
      {
        rule: 'self.spec.replicas >= 0',
        message: 'replicas must be non-negative',
      },
    ],
    ...(options.labels ? { labels: options.labels } : {}),
  });
}

// ============================================================
// CustomResource 实例生成器
// ============================================================

export interface CRInstanceOptions {
  /** Kind 名称 */
  kind: string;
  /** API group (例如 mcp.hermes.io) */
  group: string;
  /** API 版本 */
  version: string;
  /** CR 名称 */
  name: string;
  /** 命名空间 */
  namespace?: string;
  /** Spec */
  spec: Record<string, unknown>;
  /** Status (可选) */
  status?: Record<string, unknown>;
  /** Labels */
  labels?: Record<string, string>;
}

/**
 * 创建 CR 实例
 */
export function createCustomResource(options: CRInstanceOptions): CustomResource {
  const metadata: CustomResource['metadata'] = { name: options.name };
  if (options.namespace) metadata.namespace = options.namespace;
  if (options.labels) metadata.labels = options.labels;

  const cr: CustomResource = {
    apiVersion: `${options.group}/${options.version}`,
    kind: options.kind,
    metadata,
    spec: options.spec,
  };
  if (options.status) cr.status = options.status;
  return cr;
}

// ============================================================
// 简化版 Controller 实现（前端模拟）
// ============================================================

/**
 * Controller Manager - 简化版 K8s Controller 实现
 * 在前端环境模拟 Controller 行为（生产环境会替换为真实 K8s Controller）
 */
export class ControllerManager {
  private controllers: Map<string, { config: ControllerConfig; reconciler: Reconciler; state: ControllerState; queue: CustomResource[] }> = new Map();
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();

  /**
   * 注册一个 Controller
   */
  register(config: ControllerConfig, reconciler: Reconciler): void {
    this.controllers.set(config.name, {
      config,
      reconciler,
      state: {
        name: config.name,
        running: false,
        reconcileCount: 0,
        errorCount: 0,
        queueLength: 0,
      },
      queue: [],
    });
  }

  /**
   * 注销一个 Controller
   */
  unregister(name: string): void {
    this.stop(name);
    this.controllers.delete(name);
  }

  /**
   * 启动所有 Controllers
   */
  startAll(): void {
    for (const name of this.controllers.keys()) {
      this.start(name);
    }
  }

  /**
   * 停止所有 Controllers
   */
  stopAll(): void {
    for (const name of Array.from(this.controllers.keys())) {
      this.stop(name);
    }
  }

  /**
   * 启动单个 Controller
   */
  start(name: string): void {
    const entry = this.controllers.get(name);
    if (!entry) throw new Error(`Controller ${name} not found`);
    if (entry.state.running) return;

    entry.state.running = true;
    entry.state.startTime = Date.now();

    // 启动定时 reconcile 循环
    const interval = entry.config.resyncPeriodMs ?? 30000;
    const timer = setInterval(() => this.tick(name), interval);
    this.timers.set(name, timer);
  }

  /**
   * 停止单个 Controller
   */
  stop(name: string): void {
    const entry = this.controllers.get(name);
    if (!entry) return;
    const timer = this.timers.get(name);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(name);
    }
    entry.state.running = false;
  }

  /**
   * 入队一个 CR（触发 reconcile）
   */
  enqueue(name: string, cr: CustomResource): void {
    const entry = this.controllers.get(name);
    if (!entry) throw new Error(`Controller ${name} not found`);
    entry.queue.push(cr);
    entry.state.queueLength = entry.queue.length;
    // 立即触发一次 tick
    this.tick(name);
  }

  /**
   * 获取 Controller 状态
   */
  getState(name: string): ControllerState | undefined {
    return this.controllers.get(name)?.state;
  }

  /**
   * 获取所有 Controllers 状态
   */
  getAllStates(): ControllerState[] {
    return Array.from(this.controllers.values()).map((e) => ({ ...e.state }));
  }

  /**
   * Reconcile tick
   */
  private async tick(name: string): Promise<void> {
    const entry = this.controllers.get(name);
    if (!entry || !entry.state.running) return;

    // 处理队列中的所有 CR
    while (entry.queue.length > 0) {
      const cr = entry.queue.shift()!;
      entry.state.queueLength = entry.queue.length;
      await this.reconcileOne(name, cr);
    }
  }

  /**
   * Reconcile 单个 CR
   */
  private async reconcileOne(name: string, cr: CustomResource): Promise<void> {
    const entry = this.controllers.get(name);
    if (!entry) return;

    const ctx: ReconcileContext = {
      cr,
      reconcileCount: entry.state.reconcileCount,
      lastReconcileTime: Date.now(),
      log: (level, message, meta) => {
        if (level === 'error') {
          // eslint-disable-next-line no-console
          console.error(`[${name}] ${message}`, meta ?? '');
        }
      },
    };

    try {
      const result: ReconcileResult = await entry.reconciler(ctx);
      entry.state.reconcileCount += 1;
      entry.state.lastError = undefined;

      if (result.requeue && result.requeueAfterMs) {
        setTimeout(() => this.enqueue(name, cr), result.requeueAfterMs);
      }
    } catch (err) {
      entry.state.errorCount += 1;
      entry.state.lastError = err instanceof Error ? err.message : String(err);
    }
  }
}

// ============================================================
// McpAgent 预制 Controller 逻辑
// ============================================================

/**
 * McpAgent Controller 的默认 Reconciler
 * 简化版：更新 status.phase 模拟 K8s Controller 行为
 */
export function createMcpAgentReconciler(): Reconciler {
  return async (ctx: ReconcileContext): Promise<ReconcileResult> => {
    const { cr } = ctx;
    const replicas = (cr.spec.replicas as number) ?? 1;
    const image = (cr.spec.image as string) ?? '';

    // 模拟 reconcile 逻辑
    if (!image) {
      ctx.log('error', 'Missing image in spec');
      return { requeue: false, reason: 'invalid-spec' };
    }

    // 模拟状态更新（实际生产环境会通过 K8s API 更新 status 子资源）
    cr.status = {
      ...cr.status,
      phase: 'Running',
      readyReplicas: replicas,
      availableReplicas: replicas,
      lastUpdated: new Date().toISOString(),
    };

    return { requeue: true, requeueAfterMs: 30000 };
  };
}

// ============================================================
// 输出工具
// ============================================================

/**
 * 将 CRD 序列化为 K8s YAML Manifest
 */
export function buildCRDManifest(crds: CustomResourceDefinition[]): string {
  return buildManifestYaml(crds as unknown as K8sResource[]);
}

/**
 * 将 CR 实例序列化为 YAML
 */
export function buildCustomResourceYaml(cr: CustomResource): string {
  return buildResourceYaml(cr as unknown as K8sResource);
}

/**
 * 创建 CRD 的 RBAC Manifest (ServiceAccount/Role/RoleBinding)
 */
export interface RBACOptions {
  /** 名称 */
  name: string;
  /** 命名空间 */
  namespace?: string;
  /** API group (例如 mcp.hermes.io) */
  apiGroup: string;
  /** 资源 (例如 mcpagents) */
  resource: string;
  /** 动词列表 (例如 get/list/watch/create/update/patch/delete) */
  verbs: string[];
}

export function generateRBACManifests(options: RBACOptions): {
  serviceAccount: Record<string, unknown>;
  role: Record<string, unknown>;
  roleBinding: Record<string, unknown>;
} {
  const namespace = options.namespace ?? 'default';
  return {
    serviceAccount: {
      apiVersion: 'v1',
      kind: 'ServiceAccount',
      metadata: { name: options.name, namespace },
    },
    role: {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'Role',
      metadata: { name: options.name, namespace },
      rules: [
        {
          apiGroups: [options.apiGroup],
          resources: [options.resource, `${options.resource}/status`, `${options.resource}/finalizers`],
          verbs: options.verbs,
        },
      ],
    },
    roleBinding: {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: { name: options.name, namespace },
      subjects: [
        {
          kind: 'ServiceAccount',
          name: options.name,
          namespace,
        },
      ],
      roleRef: {
        kind: 'Role',
        name: options.name,
        apiGroup: 'rbac.authorization.k8s.io',
      },
    },
  };
}
