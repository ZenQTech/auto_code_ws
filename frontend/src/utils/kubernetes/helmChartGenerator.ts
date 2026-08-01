/**
 * # ============================================================
 * # Helm Chart Generator - Helm Chart 模板生成器 (Cycle 55 G55-02)
 * # ============================================================
 * # 核心作用：生成符合 Helm 3 规范的 Chart 包
 * # 输出：完整 Chart 目录结构 (Chart.yaml + values.yaml + templates/)
 * # 兼容：Helm 3.14+, Kubernetes 1.28+
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 55 G55-02 初次创建
 * # ====================================
 */

import type { K8sResource } from './k8sTypes';
import { buildManifestYaml, buildApplicationStack, type ApplicationStackOptions } from './k8sManifestGenerator';

// ============================================================
// 类型定义
// ============================================================

export interface HelmChartMetadata {
  /** Chart 名称 */
  name: string;
  /** Chart 版本 (SemVer) */
  version: string;
  /** 应用版本 */
  appVersion: string;
  /** 描述 */
  description?: string;
  /** 类型 (默认 application) */
  type?: 'application' | 'library';
  /** 主页 URL */
  home?: string;
  /** 源 URL */
  sources?: string[];
  /** 维护者列表 */
  maintainers?: Array<{
    name: string;
    email?: string;
    url?: string;
  }>;
  /** 关键字 */
  keywords?: string[];
  /** 图标 URL */
  icon?: string;
  /** API 版本 */
  apiVersion: 'v1' | 'v2';
  /** 依赖项 */
  dependencies?: Array<{
    name: string;
    version: string;
    repository: string;
    condition?: string;
    tags?: string[];
  }>;
}

/** Helm values.yaml 字段 */
export type HelmValue = string | number | boolean | null | HelmValue[] | { [key: string]: HelmValue };

/** Helm Template 文件 */
export interface HelmTemplateFile {
  /** 文件名（含路径，相对 templates/） */
  filename: string;
  /** 模板内容（含 Go template 变量） */
  content: string;
  /** 注释 */
  notes?: string[];
}

/** 完整 Chart 包 */
export interface HelmChartPackage {
  /** Chart.yaml 内容 */
  chartYaml: string;
  /** values.yaml 内容 */
  valuesYaml: string;
  /** _helpers.tpl 内容 */
  helpersTpl: string;
  /** NOTES.txt 内容 */
  notesTxt: string;
  /** templates/ 下的文件 */
  templates: HelmTemplateFile[];
  /** 其他顶层文件 (.helmignore, README.md) */
  extraFiles: Record<string, string>;
}

// ============================================================
// YAML 序列化（基础实现）
// ============================================================

/** 缩进字符 */
const INDENT = '  ';

/**
 * 序列化 Helm values.yaml
 * 复用 K8s YAML 序列化逻辑（兼容）
 */
function serializeHelmValue(value: unknown, indent: number): string {
  const prefix = INDENT.repeat(indent);
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'null';
  }
  if (typeof value === 'string') {
    if (value === '') return '""';
    if (/[:#@&*!|>'"%`,{}\[\]\n\r\t]/.test(value) || /^(true|false|null|yes|no|on|off|~)$/i.test(value) || /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value) || /^\s|\s$/.test(value)) {
      const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
      return `"${escaped}"`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const lines: string[] = [];
    for (const item of value) {
      if (item === null || item === undefined) {
        lines.push(`${prefix}- null`);
      } else if (typeof item === 'object' && !Array.isArray(item)) {
        const objStr = serializeHelmObject(item as Record<string, unknown>, indent + 1);
        const [first, ...rest] = objStr.split('\n');
        lines.push(`${prefix}- ${first}`);
        for (const r of rest) {
          lines.push(`${INDENT}${r}`);
        }
      } else {
        lines.push(`${prefix}- ${serializeHelmValue(item, indent + 1)}`);
      }
    }
    return lines.join('\n');
  }
  if (typeof value === 'object') {
    return serializeHelmObject(value as Record<string, unknown>, indent);
  }
  return JSON.stringify(value);
}

function serializeHelmObject(obj: Record<string, unknown>, indent: number): string {
  const prefix = INDENT.repeat(indent);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (value === null) {
      lines.push(`${prefix}${key}: null`);
    } else if (Array.isArray(value)) {
      const itemLines: string[] = [];
      for (const item of value) {
        if (item === null || item === undefined) {
          itemLines.push(`${prefix}- null`);
        } else if (typeof item === 'object' && !Array.isArray(item)) {
          const objStr = serializeHelmObject(item as Record<string, unknown>, indent + 1);
          const [first, ...rest] = objStr.split('\n');
          itemLines.push(`${prefix}- ${first}`);
          for (const r of rest) {
            itemLines.push(`${INDENT}${r}`);
          }
        } else {
          itemLines.push(`${prefix}- ${serializeHelmValue(item, indent + 1)}`);
        }
      }
      if (itemLines.length === 0) {
        lines.push(`${prefix}${key}: []`);
      } else {
        lines.push(`${prefix}${key}:`);
        for (const l of itemLines) lines.push(l);
      }
    } else if (typeof value === 'object') {
      const nested = serializeHelmObject(value as Record<string, unknown>, indent + 1);
      if (nested) {
        lines.push(`${prefix}${key}:`);
        for (const l of nested.split('\n')) lines.push(l);
      } else {
        lines.push(`${prefix}${key}: {}`);
      }
    } else {
      lines.push(`${prefix}${key}: ${serializeHelmValue(value, indent + 1)}`);
    }
  }
  return lines.join('\n');
}

// ============================================================
// Chart.yaml 生成
// ============================================================

/**
 * 生成 Chart.yaml 内容
 */
export function generateChartYaml(metadata: HelmChartMetadata): string {
  const lines: string[] = [];
  lines.push(`apiVersion: ${metadata.apiVersion}`);
  lines.push(`name: ${metadata.name}`);
  lines.push(`version: ${metadata.version}`);
  lines.push(`appVersion: "${metadata.appVersion}"`);
  if (metadata.description) {
    lines.push(`description: ${serializeHelmValue(metadata.description, 0)}`);
  }
  if (metadata.type) {
    lines.push(`type: ${metadata.type}`);
  }
  if (metadata.home) {
    lines.push(`home: ${metadata.home}`);
  }
  if (metadata.sources && metadata.sources.length > 0) {
    lines.push('sources:');
    for (const s of metadata.sources) {
      lines.push(`  - ${s}`);
    }
  }
  if (metadata.maintainers && metadata.maintainers.length > 0) {
    lines.push('maintainers:');
    for (const m of metadata.maintainers) {
      lines.push(`  - name: ${m.name}`);
      if (m.email) lines.push(`    email: ${m.email}`);
      if (m.url) lines.push(`    url: ${m.url}`);
    }
  }
  if (metadata.keywords && metadata.keywords.length > 0) {
    lines.push('keywords:');
    for (const k of metadata.keywords) {
      lines.push(`  - ${k}`);
    }
  }
  if (metadata.icon) {
    lines.push(`icon: ${metadata.icon}`);
  }
  if (metadata.dependencies && metadata.dependencies.length > 0) {
    lines.push('dependencies:');
    for (const d of metadata.dependencies) {
      lines.push(`  - name: ${d.name}`);
      lines.push(`    version: ${d.version}`);
      lines.push(`    repository: ${d.repository}`);
      if (d.condition) lines.push(`    condition: ${d.condition}`);
      if (d.tags) {
        lines.push('    tags:');
        for (const t of d.tags) lines.push(`      - ${t}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

// ============================================================
// values.yaml 生成
// ============================================================

/**
 * 默认 values.yaml（基于 application stack 选项）
 */
export function generateDefaultValues(stackOptions: ApplicationStackOptions): Record<string, HelmValue> {
  const values: Record<string, HelmValue> = {
    replicaCount: stackOptions.replicas ?? 1,
    image: {
      repository: stackOptions.image.split(':')[0],
      tag: stackOptions.image.split(':')[1] ?? 'latest',
      pullPolicy: 'IfNotPresent',
    },
    imagePullSecrets: [],
    nameOverride: '',
    fullnameOverride: '',
    serviceAccount: {
      create: true,
      annotations: {},
      name: '',
    },
    podAnnotations: {},
    podSecurityContext: {
      fsGroup: 2000,
    },
    securityContext: {
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
      runAsNonRoot: true,
      runAsUser: 1000,
    },
    service: {
      type: 'ClusterIP',
      port: stackOptions.ports[0]?.containerPort ?? 80,
    },
    ingress: {
      enabled: stackOptions.enableIngress ?? false,
      className: stackOptions.ingressClassName ?? 'nginx',
      annotations: {},
      hosts: stackOptions.ingressHost
        ? [{ host: stackOptions.ingressHost, paths: [{ path: '/', pathType: 'Prefix' }] }]
        : [],
      tls: [],
    },
    resources: {
      limits: {
        cpu: stackOptions.resources?.cpu?.limit ?? '500m',
        memory: stackOptions.resources?.memory?.limit ?? '512Mi',
      },
      requests: {
        cpu: stackOptions.resources?.cpu?.request ?? '100m',
        memory: stackOptions.resources?.memory?.request ?? '128Mi',
      },
    },
    autoscaling: {
      enabled: stackOptions.enableHPA ?? false,
      minReplicas: stackOptions.hpaMin ?? 1,
      maxReplicas: stackOptions.hpaMax ?? 10,
      targetCPUUtilizationPercentage: 80,
    },
    nodeSelector: {},
    tolerations: [],
    affinity: {},
  };

  if (stackOptions.configMapData) {
    values.configMap = stackOptions.configMapData;
  }

  return values;
}

/**
 * 序列化 values 为 YAML
 */
export function generateValuesYaml(values: Record<string, HelmValue>): string {
  return serializeHelmObject(values, 0) + '\n';
}

// ============================================================
// _helpers.tpl 生成
// ============================================================

/**
 * 生成 _helpers.tpl 模板（Chart 标准辅助函数）
 */
export function generateHelpersTpl(chartName: string): string {
  return `{{/*
Expand the name of the chart.
*/}}
{{- define "${chartName}.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "${chartName}.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "${chartName}.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "${chartName}.labels" -}}
helm.sh/chart: {{ include "${chartName}.chart" . }}
{{ include "${chartName}.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "${chartName}.selectorLabels" -}}
app.kubernetes.io/name: {{ include "${chartName}.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "${chartName}.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "${chartName}.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
`;
}

// ============================================================
// NOTES.txt 生成
// ============================================================

/**
 * 生成 NOTES.txt（Helm install 后的提示）
 */
export function generateNotesTxt(chartName: string, options: { enableIngress: boolean; ingressHost?: string; port: number }): string {
  const lines: string[] = [];
  lines.push(`Thank you for installing {{ .Chart.Name }}.`);
  lines.push(`Your release is named {{ .Release.Name }}.`);
  lines.push('');
  lines.push('To learn more about the release, try:');
  lines.push(`  $ helm status {{ .Release.Name }}`);
  lines.push(`  $ helm get all {{ .Release.Name }}`);
  lines.push('');
  if (options.enableIngress && options.ingressHost) {
    lines.push('The application is accessible at:');
    lines.push(`  http{{ if .Values.ingress.tls }}s{{ end }}://${options.ingressHost}/`);
  } else {
    lines.push('The application is accessible via port forwarding:');
    lines.push(`  $ kubectl port-forward svc/{{ include "${chartName}.fullname" . }} 8080:${options.port}`);
    lines.push('Then visit http://127.0.0.1:8080/');
  }
  return lines.join('\n') + '\n';
}

// ============================================================
// templates/ 生成
// ============================================================

/**
 * 生成 deployment.yaml template
 * 直接构造 Helm YAML，集成 .Values 引用
 */
export function generateDeploymentTemplate(stackOptions: ApplicationStackOptions, valuePrefix = '.Values'): string {
  const name = stackOptions.name;
  const port = stackOptions.ports[0]?.containerPort ?? 80;
  const hasIngress = stackOptions.enableIngress ?? false;

  const env = (stackOptions.env ?? []).map((e) => {
    if (e.value) {
      return `              - name: ${e.name}\n                value: ${e.value}`;
    } else if (e.valueFrom?.configMapKeyRef) {
      return `              - name: ${e.name}\n                valueFrom:\n                  configMapKeyRef:\n                    name: ${e.valueFrom.configMapKeyRef.name}\n                    key: ${e.valueFrom.configMapKeyRef.key}`;
    } else if (e.valueFrom?.secretKeyRef) {
      return `              - name: ${e.name}\n                valueFrom:\n                  secretKeyRef:\n                    name: ${e.valueFrom.secretKeyRef.name}\n                    key: ${e.valueFrom.secretKeyRef.key}`;
    }
    return `              - name: ${e.name}`;
  });
  const envBlock = env.length > 0 ? `            env:\n${env.join('\n')}\n` : '';

  const ports = stackOptions.ports.map((p) => {
    return `              - name: ${p.name ?? 'http'}\n                containerPort: ${p.containerPort}\n                protocol: ${p.protocol ?? 'TCP'}`;
  });
  const portsBlock = ports.length > 0 ? `            ports:\n${ports.join('\n')}\n` : '';

  const probes = (probe: { httpGet?: { path: string; port: number | string }; tcpSocket?: { port: number | string }; initialDelaySeconds?: number; periodSeconds?: number } | undefined, name: string) => {
    if (!probe) return '';
    let probeSpec = '';
    if (probe.httpGet) {
      probeSpec = `                httpGet:\n                  path: ${probe.httpGet.path}\n                  port: ${probe.httpGet.port}`;
    } else if (probe.tcpSocket) {
      probeSpec = `                tcpSocket:\n                  port: ${probe.tcpSocket.port}`;
    }
    return `              ${name}:\n${probeSpec}\n                initialDelaySeconds: ${probe.initialDelaySeconds ?? 0}\n                periodSeconds: ${probe.periodSeconds ?? 10}\n`;
  };

  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "${name}.fullname" . }}
  labels:
    {{- include "${name}.labels" . | nindent 4 }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ ${valuePrefix}.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "${name}.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "${name}.selectorLabels" . | nindent 8 }}
    spec:
      serviceAccountName: {{ include "${name}.serviceAccountName" . }}
      {{- with ${valuePrefix}.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      securityContext:
        {{- toYaml ${valuePrefix}.podSecurityContext | nindent 8 }}
      containers:
        - name: {{ .Chart.Name }}
          securityContext:
            {{- toYaml ${valuePrefix}.securityContext | nindent 12 }}
          image: "{{ ${valuePrefix}.image.repository }}:{{ ${valuePrefix}.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ ${valuePrefix}.image.pullPolicy }}
${portsBlock}${envBlock}          resources:
            {{- toYaml ${valuePrefix}.resources | nindent 12 }}
      {{- with ${valuePrefix}.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with ${valuePrefix}.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with ${valuePrefix}.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
`;
}

/**
 * 生成 service.yaml template
 */
export function generateServiceTemplate(stackOptions: ApplicationStackOptions): string {
  const name = stackOptions.name;
  const port = stackOptions.ports[0]?.containerPort ?? 80;
  return `apiVersion: v1
kind: Service
metadata:
  name: {{ include "${name}.fullname" . }}
  labels:
    {{- include "${name}.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: http
      protocol: TCP
      name: http
  selector:
    {{- include "${name}.selectorLabels" . | nindent 4 }}
`;
}

/**
 * 生成 ingress.yaml template
 */
export function generateIngressTemplate(stackOptions: ApplicationStackOptions, chartName: string): string {
  if (!stackOptions.enableIngress) return '';
  return `{{- if .Values.ingress.enabled -}}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "${chartName}.fullname" . }}
  labels:
    {{- include "${chartName}.labels" . | nindent 4 }}
  {{- with .Values.ingress.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  {{- if .Values.ingress.className }}
  ingressClassName: {{ .Values.ingress.className }}
  {{- end }}
  {{- if .Values.ingress.tls }}
  tls:
    {{- range .Values.ingress.tls }}
    - hosts:
        {{- range .hosts }}
        - {{ . | quote }}
        {{- end }}
      secretName: {{ .secretName }}
    {{- end }}
  {{- end }}
  rules:
    {{- range .Values.ingress.hosts }}
    - host: {{ .host | quote }}
      http:
        paths:
          {{- range .paths }}
          - path: {{ .path }}
            pathType: {{ .pathType }}
            backend:
              service:
                name: {{ include "${chartName}.fullname" $ }}
                port:
                  number: {{ $.Values.service.port }}
          {{- end }}
    {{- end }}
{{- end }}
`;
}

/**
 * 生成 hpa.yaml template
 */
export function generateHPATemplate(stackOptions: ApplicationStackOptions, chartName: string): string {
  if (!stackOptions.enableHPA) return '';
  return `{{- if .Values.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "${chartName}.fullname" . }}
  labels:
    {{- include "${chartName}.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "${chartName}.fullname" . }}
  minReplicas: {{ .Values.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}
  metrics:
    {{- if .Values.autoscaling.targetCPUUtilizationPercentage }}
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
    {{- end }}
{{- end }}
`;
}

/**
 * 生成 serviceaccount.yaml template
 */
export function generateServiceAccountTemplate(chartName: string): string {
  return `{{- if .Values.serviceAccount.create -}}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "${chartName}.serviceAccountName" . }}
  labels:
    {{- include "${chartName}.labels" . | nindent 4 }}
  {{- with .Values.serviceAccount.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
automountServiceAccountToken: false
{{- end }}
`;
}

// ============================================================
// .helmignore 生成
// ============================================================

/**
 * 生成 .helmignore
 */
export function generateHelmIgnore(): string {
  return `# Patterns to ignore when building packages.
# This supports shell glob matching, relative path matching, and
# negation (prefixed with !). Only one pattern per line.
.DS_Store
# Common VCS dirs
.git/
.gitignore
.bzr/
.bzrignore
.hg/
.hgignore
.svn/
# Common backup files
*.swp
*.bak
*.tmp
*.orig
*~
# Various IDEs
.project
.idea/
*.tmproj
.vscode/
# Helm-related
OWNERS
# OS junk
Thumbs.db
`;
}

// ============================================================
// README.md 生成
// ============================================================

/**
 * 生成 README.md（Chart 自带文档）
 */
export function generateReadme(metadata: HelmChartMetadata, options: ApplicationStackOptions): string {
  return `# ${metadata.name}

${metadata.description ?? 'A Helm chart for Kubernetes'}

## Chart Version

\`${metadata.version}\`

## App Version

\`${metadata.appVersion}\`

## Installation

\`\`\`bash
helm install my-release ./${metadata.name}
\`\`\`

## Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| \`replicaCount\` | Number of replicas | \`${options.replicas ?? 1}\` |
| \`image.repository\` | Image repository | \`${options.image.split(':')[0]}\` |
| \`image.tag\` | Image tag | \`${options.image.split(':')[1] ?? 'latest'}\` |
| \`image.pullPolicy\` | Image pull policy | \`IfNotPresent\` |
| \`service.type\` | Service type | \`ClusterIP\` |
| \`service.port\` | Service port | \`${options.ports[0]?.containerPort ?? 80}\` |
| \`ingress.enabled\` | Enable ingress | \`${options.enableIngress ?? false}\` |
| \`ingress.className\` | Ingress class name | \`${options.ingressClassName ?? 'nginx'}\` |
| \`autoscaling.enabled\` | Enable HPA | \`${options.enableHPA ?? false}\` |
| \`autoscaling.minReplicas\` | Min replicas | \`${options.hpaMin ?? 1}\` |
| \`autoscaling.maxReplicas\` | Max replicas | \`${options.hpaMax ?? 10}\` |
| \`resources.limits.cpu\` | CPU limit | \`${options.resources?.cpu?.limit ?? '500m'}\` |
| \`resources.limits.memory\` | Memory limit | \`${options.resources?.memory?.limit ?? '512Mi'}\` |

## Usage Example

\`\`\`bash
helm install my-release ./${metadata.name} \\
  --set replicaCount=3 \\
  --set image.tag=1.1.0 \\
  --set autoscaling.enabled=true \\
  --set autoscaling.maxReplicas=20
\`\`\`
`;
}

// ============================================================
// 一键生成完整 Chart 包
// ============================================================

export interface BuildChartOptions extends ApplicationStackOptions {
  chartVersion?: string;
  chartDescription?: string;
  maintainers?: Array<{ name: string; email?: string; url?: string }>;
  keywords?: string[];
  home?: string;
  sources?: string[];
}

/**
 * 一键生成完整 Helm Chart 包
 */
export function buildHelmChart(options: BuildChartOptions): HelmChartPackage {
  const chartName = options.name;
  const chartVersion = options.chartVersion ?? '0.1.0';
  const appVersion = options.image.split(':')[1] ?? '1.0.0';

  const metadata: HelmChartMetadata = {
    apiVersion: 'v2',
    name: chartName,
    version: chartVersion,
    appVersion,
    description: options.chartDescription ?? `${chartName} Helm chart for MCP × Hermes`,
    type: 'application',
    home: options.home,
    sources: options.sources,
    maintainers: options.maintainers ?? [{ name: 'MCP × Hermes Team', email: 'team@mcp-hermes.io' }],
    keywords: options.keywords ?? ['mcp', 'hermes', 'kubernetes'],
  };

  const values = generateDefaultValues(options);
  const chartYaml = generateChartYaml(metadata);
  const valuesYaml = generateValuesYaml(values);
  const helpersTpl = generateHelpersTpl(chartName);
  const notesTxt = generateNotesTxt(chartName, {
    enableIngress: options.enableIngress ?? false,
    ingressHost: options.ingressHost,
    port: options.ports[0]?.containerPort ?? 80,
  });

  const templates: HelmTemplateFile[] = [
    {
      filename: 'deployment.yaml',
      content: generateDeploymentTemplate(options, `.Values`),
      notes: ['主 Deployment 模板'],
    },
    {
      filename: 'service.yaml',
      content: generateServiceTemplate(options),
      notes: ['Service 模板'],
    },
    {
      filename: 'serviceaccount.yaml',
      content: generateServiceAccountTemplate(chartName),
      notes: ['ServiceAccount 模板'],
    },
    {
      filename: 'ingress.yaml',
      content: generateIngressTemplate(options, chartName),
      notes: ['Ingress 模板（条件渲染）'],
    },
    {
      filename: 'hpa.yaml',
      content: generateHPATemplate(options, chartName),
      notes: ['HPA 模板（条件渲染）'],
    },
  ];

  // 过滤空模板
  const filteredTemplates = templates.filter((t) => t.content.trim() !== '');

  const extraFiles: Record<string, string> = {
    '.helmignore': generateHelmIgnore(),
    'README.md': generateReadme(metadata, options),
  };

  return {
    chartYaml,
    valuesYaml,
    helpersTpl,
    notesTxt,
    templates: filteredTemplates,
    extraFiles,
  };
}

/**
 * 将 Chart 包打包为文件路径字典
 */
export function packChartFiles(pkg: HelmChartPackage, chartName: string): Record<string, string> {
  const files: Record<string, string> = {};
  files[`${chartName}/Chart.yaml`] = pkg.chartYaml;
  files[`${chartName}/values.yaml`] = pkg.valuesYaml;
  files[`${chartName}/templates/_helpers.tpl`] = pkg.helpersTpl;
  files[`${chartName}/templates/NOTES.txt`] = pkg.notesTxt;
  for (const t of pkg.templates) {
    files[`${chartName}/templates/${t.filename}`] = t.content;
  }
  for (const [name, content] of Object.entries(pkg.extraFiles)) {
    files[`${chartName}/${name}`] = content;
  }
  return files;
}
