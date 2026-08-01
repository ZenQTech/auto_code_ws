/**
 * # ============================================================
 * # Knative Serving - 资源类型定义 (Cycle 56 G56-01)
 * # ============================================================
 * # 核心作用：定义 Knative Serving 资源类型
 * # 资源：Service / Configuration / Revision / Route
 * # 规范：serving.knative.dev/v1
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 56 G56-01 初次创建
 * # ====================================
 */

/** Knative 资源 API 版本 */
export type KnativeApiVersion = 'serving.knative.dev/v1';

/** 流量切分目标 */
export interface TrafficTarget {
  /** 流量切分百分比 0-100 */
  percent: number;
  /** 目标 Revision 名称 */
  revisionName?: string;
  /** 目标 Configuration 名称（latest 关键字） */
  latestRevision?: boolean;
  /** 标签（蓝绿部署） */
  tag?: string;
}

/** Revision 模板 */
export interface RevisionTemplate {
  /** Revision 元数据 */
  metadata?: {
    name?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  /** Pod 规格 */
  spec: {
    /** 容器配置 */
    containers: Array<{
      name?: string;
      image: string;
      ports?: Array<{ name?: string; containerPort: number; protocol?: 'TCP' | 'UDP' }>;
      env?: Array<{ name: string; value?: string; valueFrom?: Record<string, unknown> }>;
      resources?: {
        requests?: { cpu?: string; memory?: string; ephemeralStorage?: string };
        limits?: { cpu?: string; memory?: string; ephemeralStorage?: string };
      };
      command?: string[];
      args?: string[];
      imagePullPolicy?: 'Always' | 'IfNotPresent' | 'Never';
    }>;
    /** 容器并发数（Knative 关键特性） */
    containerConcurrency?: number;
    /** 响应超时（秒） */
    timeoutSeconds?: number;
    /** 单实例请求限制 */
    maxRequestsPerSecond?: number;
  };
}

/** Knative Configuration Spec */
export interface KnativeConfigurationSpec {
  /** Revision 模板 */
  template: RevisionTemplate;
  /** 是否自动创建 Revision（默认 true） */
  enableAutoScaling?: boolean;
}

/** Knative Configuration 状态 */
export interface KnativeConfigurationStatus {
  /** 状态：True/False/Unknown */
  conditions?: Array<{
    type: string;
    status: 'True' | 'False' | 'Unknown';
    reason?: string;
    message?: string;
    lastTransitionTime?: string;
  }>;
  /** 当前最新 Revision */
  latestReadyRevisionName?: string;
  /** 最新创建的 Revision */
  latestCreatedRevisionName?: string;
}

/** Knative Configuration 资源 */
export interface KnativeConfiguration {
  apiVersion: 'serving.knative.dev/v1';
  kind: 'Configuration';
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    uid?: string;
    generation?: number;
  };
  spec: KnativeConfigurationSpec;
  status?: KnativeConfigurationStatus;
}

/** Knative Route Spec */
export interface KnativeRouteSpec {
  /** 流量切分 */
  traffic: TrafficTarget[];
  /** 透传其他 Knative 服务的头部 */
  additionalAudience?: boolean;
}

/** Knative Route 状态 */
export interface KnativeRouteStatus {
  conditions?: Array<{
    type: string;
    status: 'True' | 'False' | 'Unknown';
    reason?: string;
    message?: string;
  }>;
  /** 路由 URL */
  url?: string;
  /** 可访问地址 */
  address?: { url: string };
  /** 流量分配详情 */
  traffic?: Array<{
    percent: number;
    revisionName?: string;
    tag?: string;
    url?: string;
  }>;
}

/** Knative Route 资源 */
export interface KnativeRoute {
  apiVersion: 'serving.knative.dev/v1';
  kind: 'Route';
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    uid?: string;
  };
  spec: KnativeRouteSpec;
  status?: KnativeRouteStatus;
}

/** Knative Revision Spec */
export interface KnativeRevisionSpec {
  /** 来自 Configuration */
  configurationRef?: {
    apiVersion: string;
    kind: 'Configuration';
    name: string;
  };
  /** 实际 Pod 规格（生成后不可变） */
  containerConcurrency?: number;
  timeoutSeconds?: number;
}

/** Knative Revision 状态 */
export interface KnativeRevisionStatus {
  conditions?: Array<{
    type: string;
    status: 'True' | 'False' | 'Unknown';
    reason?: string;
    message?: string;
  }>;
  /** 实际镜像摘要 */
  imageDigest?: string;
  /** Revision 日志 URL */
  logUrl?: string;
}

/** Knative Revision 资源 */
export interface KnativeRevision {
  apiVersion: 'serving.knative.dev/v1';
  kind: 'Revision';
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    uid?: string;
    generation?: number;
  };
  spec: KnativeRevisionSpec;
  status?: KnativeRevisionStatus;
}

/** Knative Service Spec（聚合 Configuration + Route） */
export interface KnativeServiceSpec {
  /** 流量切分 */
  traffic?: TrafficTarget[];
  /** Revision 模板 */
  template: RevisionTemplate;
}

/** Knative Service 状态 */
export interface KnativeServiceStatus {
  conditions?: Array<{
    type: string;
    status: 'True' | 'False' | 'Unknown';
    reason?: string;
    message?: string;
  }>;
  /** Service URL */
  url?: string;
  /** 最新 Ready Revision */
  latestReadyRevisionName?: string;
  /** 最新 Created Revision */
  latestCreatedRevisionName?: string;
  /** 流量分配详情 */
  traffic?: Array<{
    percent: number;
    revisionName?: string;
    tag?: string;
    url?: string;
  }>;
}

/** Knative Service 资源（顶层 CRD） */
export interface KnativeService {
  apiVersion: 'serving.knative.dev/v1';
  kind: 'Service';
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    uid?: string;
    generation?: number;
  };
  spec: KnativeServiceSpec;
  status?: KnativeServiceStatus;
}

/** 自动扩缩容配置（Knative 注解） */
export interface AutoScalingAnnotations {
  /** 最小副本数 */
  minScale?: number;
  /** 最大副本数 */
  maxScale?: number;
  /** 目标并发数（每实例） */
  target?: number;
  /** 目标 CPU 利用率 */
  targetUtilizationPercentage?: number;
  /** 缩容到 0 允许 */
  allowZero?: boolean;
  /** 冷启动窗口（秒） */
  initialScale?: number;
  /** 扩缩容窗口（秒） */
  window?: string;
  /** 恐慌模式阈值 */
  panicThresholdPercentage?: number;
  /** 恐慌模式窗口 */
  panicWindow?: string;
}

/** 流量切分配置 */
export interface TrafficSplitConfig {
  /** 100% 流量到 latest */
  allToLatest?: boolean;
  /** 自定义切分：revision -> percent */
  customSplit?: Record<string, number>;
  /** 带标签切分：tag -> { revision, percent } */
  tagSplit?: Record<string, { revisionName: string; percent: number }>;
  /** 蓝绿部署：旧版本百分比 */
  blueGreen?: { bluePercent: number; greenPercent: number };
}

/** Knative 部署策略 */
export type KnativeDeployStrategy = 'rolling' | 'blue-green' | 'canary';

/** 部署选项 */
export interface KnativeDeployOptions {
  /** Service 名称 */
  name: string;
  /** 命名空间 */
  namespace?: string;
  /** 容器镜像 */
  image: string;
  /** 镜像标签 */
  imageTag?: string;
  /** 端口 */
  ports?: Array<{ name?: string; containerPort: number; protocol?: 'TCP' | 'UDP' }>;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 部署策略 */
  strategy?: KnativeDeployStrategy;
  /** 自动扩缩容 */
  autoScaling?: AutoScalingAnnotations;
  /** 流量切分 */
  traffic?: TrafficSplitConfig;
  /** 容器并发 */
  containerConcurrency?: number;
  /** 超时（秒） */
  timeoutSeconds?: number;
  /** 资源限制 */
  resources?: {
    requests?: { cpu?: string; memory?: string };
    limits?: { cpu?: string; memory?: string };
  };
  /** 标签 */
  labels?: Record<string, string>;
}
