/**
 * # ============================================================
 * # K8s Types - Kubernetes 资源类型定义 (Cycle 55 G55-01)
 * # ============================================================
 * # 核心作用：定义 K8s 资源生成所需的所有 TypeScript 类型
 * # 兼容标准：Kubernetes 1.28+ API + apps/v1 + networking.k8s.io/v1
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 55 G55-01 初次创建
 * # ====================================
 */

/** K8s 标签选择器 */
export interface K8sLabelSelector {
  matchLabels?: Record<string, string>;
  matchExpressions?: Array<{
    key: string;
    operator: 'In' | 'NotIn' | 'Exists' | 'DoesNotExist';
    values?: string[];
  }>;
}

/** K8s 元数据 */
export interface K8sMetadata {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  uid?: string;
  resourceVersion?: string;
  generation?: number;
  creationTimestamp?: string;
}

/** 容器资源限制 */
export interface K8sResourceRequirements {
  limits?: {
    cpu?: string;
    memory?: string;
    'nvidia.com/gpu'?: string;
  };
  requests?: {
    cpu?: string;
    memory?: string;
  };
}

/** 容器端口 */
export interface K8sContainerPort {
  name?: string;
  containerPort: number;
  protocol?: 'TCP' | 'UDP' | 'SCTP';
  hostPort?: number;
}

/** 探针配置 */
export interface K8sProbe {
  httpGet?: {
    path: string;
    port: number | string;
    scheme?: 'HTTP' | 'HTTPS';
  };
  tcpSocket?: {
    port: number | string;
  };
  exec?: {
    command: string[];
  };
  initialDelaySeconds?: number;
  periodSeconds?: number;
  timeoutSeconds?: number;
  successThreshold?: number;
  failureThreshold?: number;
}

/** 环境变量 */
export interface K8sEnvVar {
  name: string;
  value?: string;
  valueFrom?: {
    configMapKeyRef?: { name: string; key: string };
    secretKeyRef?: { name: string; key: string };
    fieldRef?: { fieldPath: string };
  };
}

/** Volume 挂载 */
export interface K8sVolumeMount {
  name: string;
  mountPath: string;
  subPath?: string;
  readOnly?: boolean;
}

/** 容器定义 */
export interface K8sContainer {
  name: string;
  image: string;
  imagePullPolicy?: 'Always' | 'IfNotPresent' | 'Never';
  command?: string[];
  args?: string[];
  env?: K8sEnvVar[];
  ports?: K8sContainerPort[];
  resources?: K8sResourceRequirements;
  volumeMounts?: K8sVolumeMount[];
  livenessProbe?: K8sProbe;
  readinessProbe?: K8sProbe;
  startupProbe?: K8sProbe;
  securityContext?: {
    runAsUser?: number;
    runAsNonRoot?: boolean;
    readOnlyRootFilesystem?: boolean;
    allowPrivilegeEscalation?: boolean;
    capabilities?: {
      add?: string[];
      drop?: string[];
    };
  };
}

/** Pod 模板 */
export interface K8sPodTemplateSpec {
  metadata?: K8sMetadata;
  spec: {
    containers: K8sContainer[];
    initContainers?: K8sContainer[];
    restartPolicy?: 'Always' | 'OnFailure' | 'Never';
    serviceAccountName?: string;
    nodeSelector?: Record<string, string>;
    affinity?: Record<string, unknown>;
    tolerations?: Array<{
      key?: string;
      operator?: 'Equal' | 'Exists';
      value?: string;
      effect?: 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute';
      tolerationSeconds?: number;
    }>;
    volumes?: Array<{
      name: string;
      configMap?: { name: string };
      secret?: { secretName: string };
      persistentVolumeClaim?: { claimName: string };
      emptyDir?: { sizeLimit?: string };
      hostPath?: { path: string; type?: string };
    }>;
  };
}

/** Deployment 规格 */
export interface K8sDeploymentSpec {
  replicas?: number;
  selector: K8sLabelSelector;
  template: K8sPodTemplateSpec;
  strategy?: {
    type?: 'Recreate' | 'RollingUpdate';
    rollingUpdate?: {
      maxSurge?: number | string;
      maxUnavailable?: number | string;
    };
  };
  revisionHistoryLimit?: number;
  progressDeadlineSeconds?: number;
  minReadySeconds?: number;
  paused?: boolean;
}

/** Deployment 资源 */
export interface K8sDeployment {
  apiVersion: 'apps/v1';
  kind: 'Deployment';
  metadata: K8sMetadata;
  spec: K8sDeploymentSpec;
}

/** Service 规格 */
export interface K8sServiceSpec {
  selector: Record<string, string>;
  ports: Array<{
    name?: string;
    port: number;
    targetPort: number | string;
    protocol?: 'TCP' | 'UDP' | 'SCTP';
    nodePort?: number;
  }>;
  type?: 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'ExternalName';
  clusterIP?: string;
  externalIPs?: string[];
  sessionAffinity?: 'ClientIP' | 'None';
  publishNotReadyAddresses?: boolean;
}

/** Service 资源 */
export interface K8sService {
  apiVersion: 'v1';
  kind: 'Service';
  metadata: K8sMetadata;
  spec: K8sServiceSpec;
}

/** Ingress 规则 */
export interface K8sIngressRule {
  host?: string;
  http?: {
    paths: Array<{
      path: string;
      pathType?: 'Exact' | 'Prefix' | 'ImplementationSpecific';
      backend: {
        service: {
          name: string;
          port: { number?: number; name?: string };
        };
      };
    }>;
  };
}

/** Ingress TLS 配置 */
export interface K8sIngressTLS {
  hosts?: string[];
  secretName?: string;
}

/** Ingress 资源 */
export interface K8sIngress {
  apiVersion: 'networking.k8s.io/v1';
  kind: 'Ingress';
  metadata: K8sMetadata;
  spec: {
    ingressClassName?: string;
    defaultBackend?: {
      service: { name: string; port: { number?: number; name?: string } };
    };
    rules?: K8sIngressRule[];
    tls?: K8sIngressTLS[];
  };
}

/** ConfigMap 资源 */
export interface K8sConfigMap {
  apiVersion: 'v1';
  kind: 'ConfigMap';
  metadata: K8sMetadata;
  data?: Record<string, string>;
  binaryData?: Record<string, string>;
  immutable?: boolean;
}

/** Secret 资源 */
export interface K8sSecret {
  apiVersion: 'v1';
  kind: 'Secret';
  metadata: K8sMetadata;
  type?: 'Opaque' | 'kubernetes.io/tls' | 'kubernetes.io/dockerconfigjson' | 'kubernetes.io/service-account-token';
  data?: Record<string, string>; // base64 编码
  stringData?: Record<string, string>;
  immutable?: boolean;
}

/** HPA 资源 */
export interface K8sHPA {
  apiVersion: 'autoscaling/v2';
  kind: 'HorizontalPodAutoscaler';
  metadata: K8sMetadata;
  spec: {
    scaleTargetRef: {
      apiVersion: string;
      kind: string;
      name: string;
    };
    minReplicas: number;
    maxReplicas: number;
    metrics?: Array<
      | {
          type: 'Resource';
          resource: {
            name: 'cpu' | 'memory';
            target: {
              type: 'Utilization' | 'AverageValue';
              averageUtilization?: number;
              averageValue?: string;
            };
          };
        }
      | {
          type: 'Pods';
          pods: {
            metric: { name: string };
            target: { type: 'AverageValue'; averageValue: string };
          };
        }
    >;
    behavior?: {
      scaleUp?: { stabilizationWindowSeconds?: number; policies?: unknown[] };
      scaleDown?: { stabilizationWindowSeconds?: number; policies?: unknown[] };
    };
  };
}

/** PVC 资源 */
export interface K8sPVC {
  apiVersion: 'v1';
  kind: 'PersistentVolumeClaim';
  metadata: K8sMetadata;
  spec: {
    accessModes: Array<'ReadWriteOnce' | 'ReadOnlyMany' | 'ReadWriteMany' | 'ReadWriteOncePod'>;
    resources: {
      requests: { storage: string };
    };
    storageClassName?: string;
    volumeName?: string;
    selector?: K8sLabelSelector;
  };
}

/** Namespace 资源 */
export interface K8sNamespace {
  apiVersion: 'v1';
  kind: 'Namespace';
  metadata: K8sMetadata;
  spec?: { finalizers?: string[] };
}

/** ServiceAccount 资源 */
export interface K8sServiceAccount {
  apiVersion: 'v1';
  kind: 'ServiceAccount';
  metadata: K8sMetadata;
  automountServiceAccountToken?: boolean;
  imagePullSecrets?: Array<{ name: string }>;
  secrets?: Array<{ name: string }>;
}

/** 通用 K8s 资源类型 */
export type K8sResource =
  | K8sDeployment
  | K8sService
  | K8sIngress
  | K8sConfigMap
  | K8sSecret
  | K8sHPA
  | K8sPVC
  | K8sNamespace
  | K8sServiceAccount;
