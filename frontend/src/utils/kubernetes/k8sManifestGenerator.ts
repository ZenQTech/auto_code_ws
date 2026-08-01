/**
 * # ============================================================
 * # K8s Manifest Generator - Kubernetes 资源清单生成器 (Cycle 55 G55-01)
 * # ============================================================
 * # 核心作用：声明式构造 K8s 资源并序列化为 YAML
 * # 支持资源：Deployment/Service/Ingress/ConfigMap/Secret/HPA/PVC/Namespace/ServiceAccount
 * # 输出格式：标准 K8s YAML (含 --- 分隔符)
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 55 G55-01 初次创建
 * # ====================================
 */

import type {
  K8sDeployment,
  K8sService,
  K8sIngress,
  K8sConfigMap,
  K8sSecret,
  K8sHPA,
  K8sPVC,
  K8sNamespace,
  K8sServiceAccount,
  K8sResource,
  K8sContainer,
  K8sProbe,
  K8sLabelSelector,
  K8sEnvVar,
  K8sVolumeMount,
  K8sMetadata,
} from './k8sTypes';
import { serializeK8sManifest, serializeK8sResource, parseK8sYaml } from './k8sYamlSerializer';

// ============================================================
// 通用 Builder 模式辅助
// ============================================================

/**
 * 设置 metadata 的 namespace（如果未指定）
 */
function ensureNamespace(metadata: K8sMetadata, defaultNamespace = 'default'): K8sMetadata {
  return {
    ...metadata,
    namespace: metadata.namespace ?? defaultNamespace,
  };
}

/**
 * 合并标签（应用级 + 资源级）
 */
function mergeLabels(...labelSets: Array<Record<string, string> | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const labels of labelSets) {
    if (labels) {
      Object.assign(result, labels);
    }
  }
  return result;
}

// ============================================================
// Deployment Builder
// ============================================================

export interface DeploymentBuilderOptions {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  replicas?: number;
  image: string;
  imagePullPolicy?: 'Always' | 'IfNotPresent' | 'Never';
  containerName?: string;
  ports?: Array<{ name?: string; containerPort: number; protocol?: 'TCP' | 'UDP' }>;
  env?: K8sEnvVar[];
  command?: string[];
  args?: string[];
  resources?: {
    cpu?: { request?: string; limit?: string };
    memory?: { request?: string; limit?: string };
  };
  livenessProbe?: K8sProbe;
  readinessProbe?: K8sProbe;
  startupProbe?: K8sProbe;
  volumeMounts?: K8sVolumeMount[];
  serviceAccountName?: string;
  selectorMatchLabels?: Record<string, string>;
  strategy?: {
    type?: 'Recreate' | 'RollingUpdate';
    maxSurge?: number | string;
    maxUnavailable?: number | string;
  };
}

/**
 * 创建 Deployment Builder
 */
export function createDeploymentBuilder(options: DeploymentBuilderOptions): K8sDeployment {
  const appLabels = mergeLabels({ app: options.name }, options.labels);
  const selectorLabels = options.selectorMatchLabels ?? { app: options.name };
  const containerName = options.containerName ?? options.name;

  const container: K8sContainer = {
    name: containerName,
    image: options.image,
    imagePullPolicy: options.imagePullPolicy ?? 'IfNotPresent',
  };
  if (options.command) container.command = options.command;
  if (options.args) container.args = options.args;
  if (options.env && options.env.length > 0) container.env = options.env;
  if (options.ports && options.ports.length > 0) {
    container.ports = options.ports.map((p) => ({
      name: p.name,
      containerPort: p.containerPort,
      protocol: p.protocol ?? 'TCP',
    }));
  }
  if (options.resources) {
    container.resources = {
      requests: {
        cpu: options.resources.cpu?.request,
        memory: options.resources.memory?.request,
      },
      limits: {
        cpu: options.resources.cpu?.limit,
        memory: options.resources.memory?.limit,
      },
    };
    // 清理 undefined
    if (!container.resources.requests?.cpu && !container.resources.requests?.memory) {
      delete (container.resources as { requests?: unknown }).requests;
    }
    if (!container.resources.limits?.cpu && !container.resources.limits?.memory) {
      delete (container.resources as { limits?: unknown }).limits;
    }
  }
  if (options.livenessProbe) container.livenessProbe = options.livenessProbe;
  if (options.readinessProbe) container.readinessProbe = options.readinessProbe;
  if (options.startupProbe) container.startupProbe = options.startupProbe;
  if (options.volumeMounts && options.volumeMounts.length > 0) {
    container.volumeMounts = options.volumeMounts;
  }

  const metadata = ensureNamespace({
    name: options.name,
    namespace: options.namespace,
    labels: appLabels,
  });

  if (options.annotations) {
    metadata.annotations = options.annotations;
  }

  const deployment: K8sDeployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata,
    spec: {
      replicas: options.replicas ?? 1,
      selector: { matchLabels: selectorLabels },
      template: {
        metadata: { labels: appLabels },
        spec: {
          containers: [container],
        },
      },
    },
  };

  if (options.serviceAccountName) {
    deployment.spec.template.spec.serviceAccountName = options.serviceAccountName;
  }

  if (options.strategy) {
    deployment.spec.strategy = {
      type: options.strategy.type ?? 'RollingUpdate',
    };
    if (options.strategy.type === 'RollingUpdate' || !options.strategy.type) {
      const rolling: { maxSurge?: number | string; maxUnavailable?: number | string } = {};
      if (options.strategy.maxSurge !== undefined) rolling.maxSurge = options.strategy.maxSurge;
      if (options.strategy.maxUnavailable !== undefined) rolling.maxUnavailable = options.strategy.maxUnavailable;
      if (Object.keys(rolling).length > 0) {
        deployment.spec.strategy.rollingUpdate = rolling;
      }
    }
  }

  return deployment;
}

// ============================================================
// Service Builder
// ============================================================

export interface ServiceBuilderOptions {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  selector: Record<string, string>;
  ports: Array<{
    name?: string;
    port: number;
    targetPort: number | string;
    protocol?: 'TCP' | 'UDP' | 'SCTP';
    nodePort?: number;
  }>;
  type?: 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'ExternalName';
  sessionAffinity?: 'ClientIP' | 'None';
  annotations?: Record<string, string>;
}

/**
 * 创建 Service Builder
 */
export function createServiceBuilder(options: ServiceBuilderOptions): K8sService {
  const metadata = ensureNamespace({
    name: options.name,
    namespace: options.namespace,
    labels: mergeLabels({ app: options.name }, options.labels),
  });
  if (options.annotations) metadata.annotations = options.annotations;

  const service: K8sService = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata,
    spec: {
      selector: options.selector,
      ports: options.ports.map((p) => ({
        name: p.name,
        port: p.port,
        targetPort: p.targetPort,
        protocol: p.protocol ?? 'TCP',
        nodePort: p.nodePort,
      })),
      type: options.type ?? 'ClusterIP',
    },
  };
  if (options.sessionAffinity) service.spec.sessionAffinity = options.sessionAffinity;
  return service;
}

// ============================================================
// Ingress Builder
// ============================================================

export interface IngressBuilderOptions {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  ingressClassName?: string;
  annotations?: Record<string, string>;
  rules: Array<{
    host?: string;
    paths: Array<{
      path: string;
      pathType?: 'Exact' | 'Prefix' | 'ImplementationSpecific';
      backendService: string;
      backendPort: number | string;
    }>;
  }>;
  tls?: Array<{ hosts?: string[]; secretName?: string }>;
}

/**
 * 创建 Ingress Builder
 */
export function createIngressBuilder(options: IngressBuilderOptions): K8sIngress {
  const metadata = ensureNamespace({
    name: options.name,
    namespace: options.namespace,
    labels: mergeLabels({ app: options.name }, options.labels),
  });
  if (options.ingressClassName) metadata.annotations = { 'kubernetes.io/ingress.class': options.ingressClassName };
  if (options.annotations) {
    metadata.annotations = { ...(metadata.annotations ?? {}), ...options.annotations };
  }

  const ingress: K8sIngress = {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata,
    spec: {
      rules: options.rules.map((rule) => ({
        host: rule.host,
        http: {
          paths: rule.paths.map((p) => ({
            path: p.path,
            pathType: p.pathType ?? 'Prefix',
            backend: {
              service: {
                name: p.backendService,
                port: typeof p.backendPort === 'number' ? { number: p.backendPort } : { name: p.backendPort },
              },
            },
          })),
        },
      })),
    },
  };
  if (options.ingressClassName) ingress.spec.ingressClassName = options.ingressClassName;
  if (options.tls && options.tls.length > 0) ingress.spec.tls = options.tls;
  return ingress;
}

// ============================================================
// ConfigMap Builder
// ============================================================

export interface ConfigMapBuilderOptions {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  data?: Record<string, string>;
  binaryData?: Record<string, string>;
  immutable?: boolean;
}

/**
 * 创建 ConfigMap Builder
 */
export function createConfigMapBuilder(options: ConfigMapBuilderOptions): K8sConfigMap {
  const metadata = ensureNamespace({
    name: options.name,
    namespace: options.namespace,
    labels: options.labels,
  });
  const configMap: K8sConfigMap = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata,
  };
  if (options.data) configMap.data = options.data;
  if (options.binaryData) configMap.binaryData = options.binaryData;
  if (options.immutable !== undefined) configMap.immutable = options.immutable;
  return configMap;
}

// ============================================================
// Secret Builder
// ============================================================

export interface SecretBuilderOptions {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  type?: 'Opaque' | 'kubernetes.io/tls' | 'kubernetes.io/dockerconfigjson';
  stringData?: Record<string, string>;
  data?: Record<string, string>;
  immutable?: boolean;
}

/**
 * 简单 Base64 编码（浏览器环境）
 */
function base64Encode(input: string): string {
  if (typeof btoa === 'function') {
    // 处理 UTF-8
    const bytes = new TextEncoder().encode(input);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  return Buffer.from(input).toString('base64');
}

/**
 * 创建 Secret Builder
 */
export function createSecretBuilder(options: SecretBuilderOptions): K8sSecret {
  const metadata = ensureNamespace({
    name: options.name,
    namespace: options.namespace,
    labels: options.labels,
  });
  const secret: K8sSecret = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata,
    type: options.type ?? 'Opaque',
  };
  if (options.stringData) {
    secret.stringData = options.stringData;
    // 自动编码为 data
    secret.data = {};
    for (const [k, v] of Object.entries(options.stringData)) {
      secret.data[k] = base64Encode(v);
    }
  }
  if (options.data) secret.data = options.data;
  if (options.immutable !== undefined) secret.immutable = options.immutable;
  return secret;
}

// ============================================================
// HPA Builder
// ============================================================

export interface HPABuilderOptions {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  scaleTargetRef: {
    apiVersion: string;
    kind: string;
    name: string;
  };
  minReplicas: number;
  maxReplicas: number;
  metrics?: Array<
    | {
        type: 'cpu' | 'memory';
        targetUtilization?: number;
        targetAverageValue?: string;
      }
    | {
        type: 'Pods';
        metricName: string;
        targetAverageValue: string;
      }
  >;
  behavior?: {
    scaleUpStabilizationSeconds?: number;
    scaleDownStabilizationSeconds?: number;
  };
}

/**
 * 创建 HPA Builder
 */
export function createHPABuilder(options: HPABuilderOptions): K8sHPA {
  const metadata = ensureNamespace({
    name: options.name,
    namespace: options.namespace,
    labels: options.labels,
  });

  const hpa: K8sHPA = {
    apiVersion: 'autoscaling/v2',
    kind: 'HorizontalPodAutoscaler',
    metadata,
    spec: {
      scaleTargetRef: options.scaleTargetRef,
      minReplicas: options.minReplicas,
      maxReplicas: options.maxReplicas,
    },
  };

  if (options.metrics && options.metrics.length > 0) {
    hpa.spec.metrics = options.metrics.map((m) => {
      if ('type' in m && (m.type === 'cpu' || m.type === 'memory')) {
        return {
          type: 'Resource' as const,
          resource: {
            name: m.type,
            target: m.targetAverageValue
              ? { type: 'AverageValue' as const, averageValue: m.targetAverageValue }
              : { type: 'Utilization' as const, averageUtilization: m.targetUtilization ?? 80 },
          },
        };
      }
      const podMetric = m as { type: 'Pods'; metricName: string; targetAverageValue: string };
      return {
        type: 'Pods' as const,
        pods: {
          metric: { name: podMetric.metricName },
          target: { type: 'AverageValue' as const, averageValue: podMetric.targetAverageValue },
        },
      };
    });
  }

  if (options.behavior) {
    hpa.spec.behavior = {};
    if (options.behavior.scaleUpStabilizationSeconds !== undefined) {
      hpa.spec.behavior.scaleUp = { stabilizationWindowSeconds: options.behavior.scaleUpStabilizationSeconds };
    }
    if (options.behavior.scaleDownStabilizationSeconds !== undefined) {
      hpa.spec.behavior.scaleDown = { stabilizationWindowSeconds: options.behavior.scaleDownStabilizationSeconds };
    }
  }

  return hpa;
}

// ============================================================
// PVC Builder
// ============================================================

export interface PVCBuilderOptions {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  accessModes: Array<'ReadWriteOnce' | 'ReadOnlyMany' | 'ReadWriteMany' | 'ReadWriteOncePod'>;
  storage: string;
  storageClassName?: string;
  volumeName?: string;
  selector?: K8sLabelSelector;
}

/**
 * 创建 PVC Builder
 */
export function createPVCBuilder(options: PVCBuilderOptions): K8sPVC {
  const metadata = ensureNamespace({
    name: options.name,
    namespace: options.namespace,
    labels: options.labels,
  });
  const pvc: K8sPVC = {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata,
    spec: {
      accessModes: options.accessModes,
      resources: { requests: { storage: options.storage } },
    },
  };
  if (options.storageClassName) pvc.spec.storageClassName = options.storageClassName;
  if (options.volumeName) pvc.spec.volumeName = options.volumeName;
  if (options.selector) pvc.spec.selector = options.selector;
  return pvc;
}

// ============================================================
// Namespace Builder
// ============================================================

export interface NamespaceBuilderOptions {
  name: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  finalizers?: string[];
}

/**
 * 创建 Namespace Builder
 */
export function createNamespaceBuilder(options: NamespaceBuilderOptions): K8sNamespace {
  const metadata: K8sMetadata = {
    name: options.name,
  };
  if (options.labels) metadata.labels = options.labels;
  if (options.annotations) metadata.annotations = options.annotations;

  const ns: K8sNamespace = {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata,
  };
  if (options.finalizers && options.finalizers.length > 0) {
    ns.spec = { finalizers: options.finalizers };
  }
  return ns;
}

// ============================================================
// ServiceAccount Builder
// ============================================================

export interface ServiceAccountBuilderOptions {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  automountServiceAccountToken?: boolean;
  imagePullSecrets?: Array<{ name: string }>;
}

/**
 * 创建 ServiceAccount Builder
 */
export function createServiceAccountBuilder(options: ServiceAccountBuilderOptions): K8sServiceAccount {
  const metadata = ensureNamespace({
    name: options.name,
    namespace: options.namespace,
    labels: options.labels,
  });
  if (options.annotations) metadata.annotations = options.annotations;

  const sa: K8sServiceAccount = {
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata,
  };
  if (options.automountServiceAccountToken !== undefined) sa.automountServiceAccountToken = options.automountServiceAccountToken;
  if (options.imagePullSecrets && options.imagePullSecrets.length > 0) sa.imagePullSecrets = options.imagePullSecrets;
  return sa;
}

// ============================================================
// 组合 Manifest 工具
// ============================================================

/**
 * 将多个 K8s 资源序列化为完整 Manifest YAML
 */
export function buildManifestYaml(resources: K8sResource[]): string {
  return serializeK8sManifest(resources as Array<Record<string, unknown>>);
}

/**
 * 将单个资源序列化为 YAML
 */
export function buildResourceYaml(resource: K8sResource): string {
  return serializeK8sResource(resource as Record<string, unknown>);
}

/**
 * 解析 K8s YAML 字符串为资源列表
 */
export function parseManifestYaml(yaml: string): K8sResource[] {
  return parseK8sYaml(yaml) as K8sResource[];
}

// ============================================================
// 应用打包：一键生成完整应用 Stack
// ============================================================

export interface ApplicationStackOptions {
  /** 应用名称 */
  name: string;
  /** 命名空间（默认 default） */
  namespace?: string;
  /** 镜像 */
  image: string;
  /** 副本数 */
  replicas?: number;
  /** 容器端口 */
  ports: Array<{ name?: string; containerPort: number }>;
  /** 环境变量 */
  env?: K8sEnvVar[];
  /** 资源限制 */
  resources?: DeploymentBuilderOptions['resources'];
  /** 是否启用 HPA */
  enableHPA?: boolean;
  hpaMin?: number;
  hpaMax?: number;
  /** 是否创建 Ingress */
  enableIngress?: boolean;
  ingressHost?: string;
  ingressClassName?: string;
  /** ConfigMap 数据 */
  configMapData?: Record<string, string>;
  /** 通用标签 */
  labels?: Record<string, string>;
}

/**
 * 一键创建完整应用 Stack（Namespace + ConfigMap + Deployment + Service + HPA + Ingress）
 */
export function buildApplicationStack(options: ApplicationStackOptions): K8sResource[] {
  const resources: K8sResource[] = [];
  const namespace = options.namespace ?? 'default';

  // 1. ConfigMap（如果提供）
  if (options.configMapData && Object.keys(options.configMapData).length > 0) {
    resources.push(
      createConfigMapBuilder({
        name: `${options.name}-config`,
        namespace,
        labels: options.labels,
        data: options.configMapData,
      })
    );
  }

  // 2. Deployment
  const env = options.env ?? [];
  if (options.configMapData) {
    // 自动注入 ConfigMap 环境变量
    for (const key of Object.keys(options.configMapData)) {
      env.push({
        name: key.toUpperCase().replace(/-/g, '_'),
        valueFrom: {
          configMapKeyRef: { name: `${options.name}-config`, key },
        },
      });
    }
  }

  resources.push(
    createDeploymentBuilder({
      name: options.name,
      namespace,
      labels: options.labels,
      replicas: options.replicas,
      image: options.image,
      env: env.length > 0 ? env : undefined,
      ports: options.ports,
      resources: options.resources,
      selectorMatchLabels: { app: options.name },
    })
  );

  // 3. Service
  resources.push(
    createServiceBuilder({
      name: options.name,
      namespace,
      labels: options.labels,
      selector: { app: options.name },
      ports: options.ports.map((p) => ({
        name: p.name,
        port: p.containerPort,
        targetPort: p.containerPort,
      })),
    })
  );

  // 4. HPA（如果启用）
  if (options.enableHPA) {
    resources.push(
      createHPABuilder({
        name: `${options.name}-hpa`,
        namespace,
        labels: options.labels,
        scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: options.name },
        minReplicas: options.hpaMin ?? 1,
        maxReplicas: options.hpaMax ?? 10,
        metrics: [{ type: 'cpu', targetUtilization: 80 }],
      })
    );
  }

  // 5. Ingress（如果启用）
  if (options.enableIngress && options.ingressHost) {
    resources.push(
      createIngressBuilder({
        name: options.name,
        namespace,
        labels: options.labels,
        ingressClassName: options.ingressClassName ?? 'nginx',
        rules: [
          {
            host: options.ingressHost,
            paths: [
              {
                path: '/',
                pathType: 'Prefix',
                backendService: options.name,
                backendPort: options.ports[0]?.containerPort ?? 80,
              },
            ],
          },
        ],
      })
    );
  }

  return resources;
}
