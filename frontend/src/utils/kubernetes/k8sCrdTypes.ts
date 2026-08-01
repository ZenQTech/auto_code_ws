/**
 * # ============================================================
 * # K8s CRD Types - CustomResourceDefinition 类型定义 (Cycle 55 G55-03)
 * # ============================================================
 * # 核心作用：定义 CRD 和 Controller 相关的 TypeScript 类型
 * # 兼容：apiextensions.k8s.io/v1 + Kubebuilder 规范
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 55 G55-03 初次创建
 * # ====================================
 */

/** OpenAPI v3 Schema 数据类型 */
export type JSONSchemaType =
  | 'object'
  | 'array'
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'null';

/** OpenAPI v3 Property */
export interface JSONSchemaProperty {
  /** 类型 */
  type: JSONSchemaType;
  /** 描述 */
  description?: string;
  /** 默认值 */
  default?: unknown;
  /** 是否必需（仅在 required 数组中标记） */
  // 必需字段在父级的 required 数组中声明
  /** 枚举值 */
  enum?: unknown[];
  /** 字符串格式 */
  format?: 'int32' | 'int64' | 'float' | 'double' | 'byte' | 'binary' | 'date' | 'date-time' | 'password' | 'email' | 'uri' | 'uuid' | 'ipv4' | 'ipv6';
  /** 最小值（数字） */
  minimum?: number;
  /** 最大值（数字） */
  maximum?: number;
  /** 最小长度（字符串/数组） */
  minLength?: number;
  /** 最大长度（字符串/数组） */
  maxLength?: number;
  /** 模式（字符串正则） */
  pattern?: string;
  /** 嵌套对象的属性 */
  properties?: Record<string, JSONSchemaProperty>;
  /** 必需字段列表 */
  required?: string[];
  /** 数组元素 schema */
  items?: JSONSchemaProperty;
  /** 附加属性 */
  additionalProperties?: boolean | JSONSchemaProperty;
  /** x-kubernetes-* 扩展 */
  'x-kubernetes-list-type'?: 'atomic' | 'set' | 'map';
  'x-kubernetes-list-map-keys'?: string[];
  'x-kubernetes-int-or-string'?: boolean;
  'x-kubernetes-validations'?: Array<{
    rule: string;
    message?: string;
    messageExpression?: string;
  }>;
}

/** CRD 版本 */
export interface CRDVersion {
  /** 版本名 (例如 v1, v1alpha1, v1beta1) */
  name: string;
  /** 是否为存储版本（仅一个） */
  served: boolean;
  storage: boolean;
  /** OpenAPI schema */
  schema: {
    openAPIV3Schema: JSONSchemaProperty;
  };
  /** 额外打印列 */
  additionalPrinterColumns?: Array<{
    name: string;
    type: 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'object';
    jsonPath: string;
    description?: string;
    format?: string;
    priority?: number;
  }>;
  /** 子资源 */
  subresources?: {
    status?: {};
    scale?: {
      specReplicasPath: string;
      statusReplicasPath: string;
      labelSelectorPath?: string;
    };
  };
}

/** CRD 元数据 */
export interface CRDMetadata {
  name: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

/** CRD 资源 */
export interface CustomResourceDefinition {
  apiVersion: 'apiextensions.k8s.io/v1';
  kind: 'CustomResourceDefinition';
  metadata: CRDMetadata;
  spec: {
    group: string;
    /** 复数名称 (例如 mcpagents) */
    names: {
      plural: string;
      singular: string;
      kind: string;
      listKind: string;
      shortNames?: string[];
    };
    scope: 'Namespaced' | 'Cluster';
    versions: CRDVersion[];
    conversion?: {
      strategy: 'None' | 'Webhook';
      webhook?: {
        clientConfig: {
          service: { name: string; namespace: string; port: number; path?: string };
          caBundle?: string;
        };
        conversionReviewVersions: string[];
      };
    };
    preserveUnknownFields?: boolean;
  };
}

/** CR 实例的 spec */
export interface CRSpec {
  [key: string]: unknown;
}

/** CR 实例的 status */
export interface CRStatus {
  [key: string]: unknown;
}

/** CR 实例的 metadata */
export interface CRMetadata {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  generation?: number;
  resourceVersion?: string;
  uid?: string;
  creationTimestamp?: string;
}

/** Custom Resource 实例 */
export interface CustomResource {
  apiVersion: string;
  kind: string;
  metadata: CRMetadata;
  spec: CRSpec;
  status?: CRStatus;
}

/** 控制器（Controller）配置 */
export interface ControllerConfig {
  /** Controller 名称 */
  name: string;
  /** 监听的 CRD group/kind */
  watchedGroup: string;
  watchedVersion: string;
  watchedKind: string;
  /** 监听命名空间（空数组 = 全部） */
  namespaces?: string[];
  /** 同步周期（毫秒） */
  resyncPeriodMs?: number;
  /** 最大并发 reconcile 数 */
  maxConcurrentReconciles?: number;
  /** 关联 Owner Reference */
  isLeaderElector?: boolean;
}

/** Reconcile 结果 */
export type ReconcileResult =
  | { requeue: true; requeueAfterMs?: number }
  | { requeue: false; reason?: string };

/** Reconcile 上下文 */
export interface ReconcileContext {
  /** CR 实例 */
  cr: CustomResource;
  /** 上次 reconcile 时间 */
  lastReconcileTime?: number;
  /** 累计 reconcile 次数 */
  reconcileCount: number;
  /** Logger 接口 */
  log: (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;
}

/** Reconciler 函数类型 */
export type Reconciler = (ctx: ReconcileContext) => Promise<ReconcileResult>;

/** Controller 状态 */
export interface ControllerState {
  /** Controller 名称 */
  name: string;
  /** 是否运行中 */
  running: boolean;
  /** 启动时间 */
  startTime?: number;
  /** 已处理 reconcile 次数 */
  reconcileCount: number;
  /** 错误数 */
  errorCount: number;
  /** 队列长度 */
  queueLength: number;
  /** 最后错误 */
  lastError?: string;
}
