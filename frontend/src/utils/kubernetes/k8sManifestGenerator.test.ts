/**
 * # ============================================================
 * # K8s Manifest Generator Tests (Cycle 55 G55-01)
 * # ============================================================
 * # 测试覆盖：
 * #   - YAML 序列化（标量/对象/数组/嵌套/特殊字符）
 * #   - YAML 反序列化（K8s 标准格式）
 * #   - 9 种 K8s 资源 Builder
 * #   - 完整应用 Stack 一键生成
 * #   - 跨平台 YAML 兼容性
 * # ====================================
 */

import { describe, it, expect } from 'vitest';
import {
  serializeK8sResource,
  serializeK8sManifest,
  parseK8sYaml,
} from './k8sYamlSerializer';
import {
  createDeploymentBuilder,
  createServiceBuilder,
  createIngressBuilder,
  createConfigMapBuilder,
  createSecretBuilder,
  createHPABuilder,
  createPVCBuilder,
  createNamespaceBuilder,
  createServiceAccountBuilder,
  buildManifestYaml,
  buildResourceYaml,
  parseManifestYaml,
  buildApplicationStack,
} from './k8sManifestGenerator';
import type { K8sDeployment, K8sService, K8sIngress, K8sConfigMap, K8sHPA } from './k8sTypes';

describe('K8s YAML Serializer', () => {
  describe('serializeK8sResource', () => {
    it('应序列化简单标量', () => {
      const yaml = serializeK8sResource({ name: 'nginx', port: 80, enabled: true });
      expect(yaml).toContain('name: nginx');
      expect(yaml).toContain('port: 80');
      expect(yaml).toContain('enabled: true');
    });

    it('应处理 null 值', () => {
      const yaml = serializeK8sResource({ value: null });
      expect(yaml).toContain('value: null');
    });

    it('应处理数字', () => {
      const yaml = serializeK8sResource({ int: 42, float: 3.14, negative: -1, zero: 0 });
      expect(yaml).toContain('int: 42');
      expect(yaml).toContain('float: 3.14');
      expect(yaml).toContain('negative: -1');
      expect(yaml).toContain('zero: 0');
    });

    it('应转义特殊字符', () => {
      const yaml = serializeK8sResource({ value: 'hello: world' });
      expect(yaml).toContain('"hello: world"');
    });

    it('应转义引号和反斜杠', () => {
      const yaml = serializeK8sResource({ value: 'say "hi" \\' });
      expect(yaml).toMatch(/"say \\"hi\\" \\\\"/);
    });

    it('应处理多行字符串', () => {
      const yaml = serializeK8sResource({ value: 'line1\nline2' });
      expect(yaml).toContain('\\n');
    });

    it('应序列化嵌套对象', () => {
      const yaml = serializeK8sResource({
        spec: {
          replicas: 3,
          selector: { matchLabels: { app: 'test' } },
        },
      });
      expect(yaml).toContain('spec:');
      expect(yaml).toContain('replicas: 3');
      expect(yaml).toContain('selector:');
      expect(yaml).toContain('matchLabels:');
      expect(yaml).toContain('app: test');
    });

    it('应序列化数组', () => {
      const yaml = serializeK8sResource({ items: ['a', 'b', 'c'] });
      const lines = yaml.split('\n');
      expect(lines.find((l) => l.startsWith('items:'))).toBeDefined();
      expect(yaml).toContain('- a');
      expect(yaml).toContain('- b');
      expect(yaml).toContain('- c');
    });

    it('应序列化对象数组', () => {
      const yaml = serializeK8sResource({
        containers: [
          { name: 'app', image: 'nginx' },
          { name: 'sidecar', image: 'envoy' },
        ],
      });
      expect(yaml).toContain('- name: app');
      expect(yaml).toContain('image: nginx');
      expect(yaml).toContain('- name: sidecar');
      expect(yaml).toContain('image: envoy');
    });

    it('应跳过 undefined 值', () => {
      const yaml = serializeK8sResource({ a: 1, b: undefined, c: 'x' });
      expect(yaml).not.toContain('b:');
      expect(yaml).toContain('a: 1');
      expect(yaml).toContain('c: x');
    });
  });

  describe('serializeK8sManifest', () => {
    it('应使用 --- 分隔多文档', () => {
      const yaml = serializeK8sManifest([
        { kind: 'A', name: 'a' },
        { kind: 'B', name: 'b' },
        { kind: 'C', name: 'c' },
      ]);
      const docs = yaml.split('---').filter((d) => d.trim());
      expect(docs.length).toBe(3);
    });

    it('应处理空数组', () => {
      const yaml = serializeK8sManifest([]);
      expect(yaml).toBe('');
    });
  });

  describe('parseK8sYaml', () => {
    it('应解析单文档', () => {
      const yaml = `name: test
port: 80`;
      const docs = parseK8sYaml(yaml);
      expect(docs.length).toBe(1);
      expect(docs[0].name).toBe('test');
      expect(docs[0].port).toBe(80);
    });

    it('应解析多文档', () => {
      const yaml = `kind: A
name: a
---
kind: B
name: b`;
      const docs = parseK8sYaml(yaml);
      expect(docs.length).toBe(2);
      expect(docs[0].kind).toBe('A');
      expect(docs[1].kind).toBe('B');
    });

    it('应忽略注释行', () => {
      const yaml = `# 注释
name: test
# 另一个注释
port: 80`;
      const docs = parseK8sYaml(yaml);
      expect(docs[0].name).toBe('test');
      expect(docs[0].port).toBe(80);
    });

    it('应解析嵌套对象', () => {
      const yaml = `spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx`;
      const docs = parseK8sYaml(yaml);
      const spec = docs[0].spec as Record<string, unknown>;
      expect(spec.replicas).toBe(3);
      const selector = spec.selector as Record<string, unknown>;
      expect((selector.matchLabels as Record<string, string>).app).toBe('nginx');
    });

    it('应解析对象数组', () => {
      const yaml = `containers:
  - name: app
    image: nginx
  - name: sidecar
    image: envoy`;
      const docs = parseK8sYaml(yaml);
      const containers = docs[0].containers as Array<Record<string, string>>;
      expect(containers.length).toBe(2);
      expect(containers[0].name).toBe('app');
      expect(containers[1].name).toBe('sidecar');
    });

    it('应解析布尔和 null', () => {
      const yaml = `enabled: true
disabled: false
empty: null
tilda: ~`;
      const docs = parseK8sYaml(yaml);
      expect(docs[0].enabled).toBe(true);
      expect(docs[0].disabled).toBe(false);
      expect(docs[0].empty).toBeNull();
      expect(docs[0].tilda).toBeNull();
    });
  });

  describe('round-trip', () => {
    it('应支持序列化 → 反序列化 一致', () => {
      const original = {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'nginx', labels: { app: 'nginx' } },
        spec: { replicas: 3 },
      };
      const yaml = serializeK8sResource(original);
      const docs = parseK8sYaml(yaml);
      expect(docs[0]).toEqual(original);
    });
  });
});

describe('K8s Manifest Generator', () => {
  describe('createDeploymentBuilder', () => {
    it('应生成基本 Deployment', () => {
      const d = createDeploymentBuilder({
        name: 'nginx',
        image: 'nginx:1.25',
        ports: [{ containerPort: 80 }],
      });
      expect(d.apiVersion).toBe('apps/v1');
      expect(d.kind).toBe('Deployment');
      expect(d.metadata.name).toBe('nginx');
      expect(d.spec.replicas).toBe(1);
      expect(d.spec.template.spec.containers[0].image).toBe('nginx:1.25');
    });

    it('应支持 namespace', () => {
      const d = createDeploymentBuilder({
        name: 'nginx',
        namespace: 'production',
        image: 'nginx:1.25',
      });
      expect(d.metadata.namespace).toBe('production');
    });

    it('应支持环境变量', () => {
      const d = createDeploymentBuilder({
        name: 'app',
        image: 'app:1.0',
        env: [
          { name: 'LOG_LEVEL', value: 'info' },
          { name: 'DB_HOST', valueFrom: { configMapKeyRef: { name: 'db-config', key: 'host' } } },
        ],
      });
      const env = d.spec.template.spec.containers[0].env!;
      expect(env.length).toBe(2);
      expect(env[0].value).toBe('info');
      expect(env[1].valueFrom?.configMapKeyRef?.name).toBe('db-config');
    });

    it('应支持资源限制', () => {
      const d = createDeploymentBuilder({
        name: 'app',
        image: 'app:1.0',
        resources: {
          cpu: { request: '100m', limit: '500m' },
          memory: { request: '128Mi', limit: '512Mi' },
        },
      });
      const res = d.spec.template.spec.containers[0].resources!;
      expect(res.requests?.cpu).toBe('100m');
      expect(res.limits?.cpu).toBe('500m');
      expect(res.requests?.memory).toBe('128Mi');
      expect(res.limits?.memory).toBe('512Mi');
    });

    it('应支持探针', () => {
      const d = createDeploymentBuilder({
        name: 'app',
        image: 'app:1.0',
        livenessProbe: {
          httpGet: { path: '/health', port: 8080 },
          initialDelaySeconds: 30,
          periodSeconds: 10,
        },
        readinessProbe: {
          tcpSocket: { port: 8080 },
          periodSeconds: 5,
        },
      });
      const c = d.spec.template.spec.containers[0];
      expect(c.livenessProbe?.httpGet?.path).toBe('/health');
      expect(c.readinessProbe?.tcpSocket?.port).toBe(8080);
    });

    it('应支持滚动升级策略', () => {
      const d = createDeploymentBuilder({
        name: 'app',
        image: 'app:1.0',
        strategy: { type: 'RollingUpdate', maxSurge: '25%', maxUnavailable: 0 },
      });
      expect(d.spec.strategy?.type).toBe('RollingUpdate');
      expect(d.spec.strategy?.rollingUpdate?.maxSurge).toBe('25%');
      expect(d.spec.strategy?.rollingUpdate?.maxUnavailable).toBe(0);
    });

    it('应支持多副本', () => {
      const d = createDeploymentBuilder({
        name: 'app',
        image: 'app:1.0',
        replicas: 5,
      });
      expect(d.spec.replicas).toBe(5);
    });

    it('应正确生成标签', () => {
      const d = createDeploymentBuilder({
        name: 'app',
        image: 'app:1.0',
        labels: { tier: 'frontend', env: 'prod' },
      });
      expect(d.metadata.labels?.app).toBe('app');
      expect(d.metadata.labels?.tier).toBe('frontend');
    });
  });

  describe('createServiceBuilder', () => {
    it('应生成 ClusterIP Service', () => {
      const s = createServiceBuilder({
        name: 'nginx',
        selector: { app: 'nginx' },
        ports: [{ port: 80, targetPort: 80 }],
      });
      expect(s.apiVersion).toBe('v1');
      expect(s.kind).toBe('Service');
      expect(s.spec.type).toBe('ClusterIP');
      expect(s.spec.selector.app).toBe('nginx');
    });

    it('应支持 LoadBalancer', () => {
      const s = createServiceBuilder({
        name: 'web',
        selector: { app: 'web' },
        ports: [{ port: 80, targetPort: 8080 }],
        type: 'LoadBalancer',
      });
      expect(s.spec.type).toBe('LoadBalancer');
    });

    it('应支持 NodePort', () => {
      const s = createServiceBuilder({
        name: 'web',
        selector: { app: 'web' },
        ports: [{ port: 80, targetPort: 8080, nodePort: 30080 }],
        type: 'NodePort',
      });
      expect(s.spec.ports[0].nodePort).toBe(30080);
    });

    it('应支持多端口', () => {
      const s = createServiceBuilder({
        name: 'app',
        selector: { app: 'app' },
        ports: [
          { name: 'http', port: 80, targetPort: 8080 },
          { name: 'https', port: 443, targetPort: 8443 },
        ],
      });
      expect(s.spec.ports.length).toBe(2);
    });
  });

  describe('createIngressBuilder', () => {
    it('应生成基本 Ingress', () => {
      const i = createIngressBuilder({
        name: 'web',
        rules: [
          {
            host: 'example.com',
            paths: [{ path: '/', backendService: 'web', backendPort: 80 }],
          },
        ],
      });
      expect(i.apiVersion).toBe('networking.k8s.io/v1');
      expect(i.kind).toBe('Ingress');
      expect(i.spec.rules?.[0].host).toBe('example.com');
    });

    it('应支持 TLS', () => {
      const i = createIngressBuilder({
        name: 'web',
        rules: [{ paths: [{ path: '/', backendService: 'web', backendPort: 80 }] }],
        tls: [{ hosts: ['example.com'], secretName: 'web-tls' }],
      });
      expect(i.spec.tls?.[0].secretName).toBe('web-tls');
    });

    it('应支持多路径', () => {
      const i = createIngressBuilder({
        name: 'web',
        rules: [
          {
            host: 'example.com',
            paths: [
              { path: '/api', backendService: 'api', backendPort: 8080 },
              { path: '/web', backendService: 'web', backendPort: 80 },
            ],
          },
        ],
      });
      expect(i.spec.rules?.[0].http?.paths.length).toBe(2);
    });
  });

  describe('createConfigMapBuilder', () => {
    it('应生成 ConfigMap', () => {
      const cm = createConfigMapBuilder({
        name: 'app-config',
        data: { 'app.properties': 'debug=true' },
      });
      expect(cm.kind).toBe('ConfigMap');
      expect(cm.data?.['app.properties']).toBe('debug=true');
    });

    it('应支持 immutable', () => {
      const cm = createConfigMapBuilder({
        name: 'app-config',
        data: { k: 'v' },
        immutable: true,
      });
      expect(cm.immutable).toBe(true);
    });
  });

  describe('createSecretBuilder', () => {
    it('应使用 stringData 并自动编码 data', () => {
      const s = createSecretBuilder({
        name: 'app-secret',
        stringData: { password: 'mysecret' },
      });
      expect(s.stringData?.password).toBe('mysecret');
      expect(s.data?.password).toBeDefined();
      // base64('mysecret') = 'bXlzZWNyZXQ='
      expect(s.data?.password).toBe('bXlzZWNyZXQ=');
    });

    it('应支持直接提供 data（base64 编码）', () => {
      const s = createSecretBuilder({
        name: 'app-secret',
        data: { token: 'YWJjMTIz' }, // base64('abc123')
      });
      expect(s.data?.token).toBe('YWJjMTIz');
    });
  });

  describe('createHPABuilder', () => {
    it('应生成基本 HPA', () => {
      const h = createHPABuilder({
        name: 'web-hpa',
        scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'web' },
        minReplicas: 2,
        maxReplicas: 10,
        metrics: [{ type: 'cpu', targetUtilization: 70 }],
      });
      expect(h.kind).toBe('HorizontalPodAutoscaler');
      expect(h.apiVersion).toBe('autoscaling/v2');
      expect(h.spec.minReplicas).toBe(2);
      expect(h.spec.maxReplicas).toBe(10);
    });

    it('应支持 memory 指标', () => {
      const h = createHPABuilder({
        name: 'web-hpa',
        scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'web' },
        minReplicas: 1,
        maxReplicas: 5,
        metrics: [{ type: 'memory', targetAverageValue: '512Mi' }],
      });
      expect(h.spec.metrics?.[0]).toMatchObject({
        type: 'Resource',
        resource: { name: 'memory' },
      });
    });

    it('应支持 Pods 自定义指标', () => {
      const h = createHPABuilder({
        name: 'web-hpa',
        scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'web' },
        minReplicas: 1,
        maxReplicas: 10,
        metrics: [{ type: 'Pods', metricName: 'http_requests_per_second', targetAverageValue: '1000' }],
      });
      expect(h.spec.metrics?.[0]).toMatchObject({
        type: 'Pods',
        pods: { metric: { name: 'http_requests_per_second' } },
      });
    });
  });

  describe('createPVCBuilder', () => {
    it('应生成 PVC', () => {
      const p = createPVCBuilder({
        name: 'data-pvc',
        accessModes: ['ReadWriteOnce'],
        storage: '10Gi',
      });
      expect(p.kind).toBe('PersistentVolumeClaim');
      expect(p.spec.resources.requests.storage).toBe('10Gi');
    });

    it('应支持 storageClassName', () => {
      const p = createPVCBuilder({
        name: 'data-pvc',
        accessModes: ['ReadWriteMany'],
        storage: '100Gi',
        storageClassName: 'fast-ssd',
      });
      expect(p.spec.storageClassName).toBe('fast-ssd');
    });
  });

  describe('createNamespaceBuilder', () => {
    it('应生成 Namespace', () => {
      const ns = createNamespaceBuilder({ name: 'production' });
      expect(ns.kind).toBe('Namespace');
      expect(ns.metadata.name).toBe('production');
    });
  });

  describe('createServiceAccountBuilder', () => {
    it('应生成 ServiceAccount', () => {
      const sa = createServiceAccountBuilder({
        name: 'app-sa',
        namespace: 'default',
        automountServiceAccountToken: false,
      });
      expect(sa.kind).toBe('ServiceAccount');
      expect(sa.automountServiceAccountToken).toBe(false);
    });
  });

  describe('buildManifestYaml', () => {
    it('应将资源数组序列化为 Manifest', () => {
      const d = createDeploymentBuilder({ name: 'a', image: 'a:1' });
      const s = createServiceBuilder({ name: 'a', selector: { app: 'a' }, ports: [{ port: 80, targetPort: 80 }] });
      const yaml = buildManifestYaml([d, s]);
      expect(yaml).toContain('kind: Deployment');
      expect(yaml).toContain('kind: Service');
      expect(yaml).toContain('---');
    });
  });

  describe('parseManifestYaml', () => {
    it('应解析 K8s YAML 字符串', () => {
      const yaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  replicas: 3`;
      const docs = parseManifestYaml(yaml) as K8sDeployment[];
      expect(docs[0].kind).toBe('Deployment');
      expect(docs[0].spec.replicas).toBe(3);
    });
  });

  describe('buildApplicationStack', () => {
    it('应一键生成完整应用 Stack', () => {
      const stack = buildApplicationStack({
        name: 'web',
        image: 'nginx:1.25',
        ports: [{ containerPort: 80 }],
        enableHPA: true,
        hpaMin: 2,
        hpaMax: 10,
        enableIngress: true,
        ingressHost: 'web.example.com',
        configMapData: { LOG_LEVEL: 'info' },
      });
      // Namespace(0 if exists) + ConfigMap + Deployment + Service + HPA + Ingress
      const kinds = stack.map((r) => r.kind);
      expect(kinds).toContain('ConfigMap');
      expect(kinds).toContain('Deployment');
      expect(kinds).toContain('Service');
      expect(kinds).toContain('HorizontalPodAutoscaler');
      expect(kinds).toContain('Ingress');
    });

    it('应自动注入 ConfigMap 环境变量', () => {
      const stack = buildApplicationStack({
        name: 'app',
        image: 'app:1.0',
        ports: [{ containerPort: 8080 }],
        configMapData: { 'log-level': 'info' },
      });
      const deployment = stack.find((r) => r.kind === 'Deployment') as K8sDeployment;
      const env = deployment.spec.template.spec.containers[0].env!;
      const logLevel = env.find((e) => e.name === 'LOG_LEVEL');
      expect(logLevel?.valueFrom?.configMapKeyRef?.name).toBe('app-config');
      expect(logLevel?.valueFrom?.configMapKeyRef?.key).toBe('log-level');
    });

    it('应最小化配置时不生成可选资源', () => {
      const stack = buildApplicationStack({
        name: 'app',
        image: 'app:1.0',
        ports: [{ containerPort: 8080 }],
      });
      const kinds = stack.map((r) => r.kind);
      expect(kinds).not.toContain('HorizontalPodAutoscaler');
      expect(kinds).not.toContain('Ingress');
      expect(kinds).not.toContain('ConfigMap');
    });
  });

  describe('YAML 输出验证', () => {
    it('Deployment YAML 应可被反序列化', () => {
      const d = createDeploymentBuilder({
        name: 'nginx',
        image: 'nginx:1.25',
        replicas: 3,
        ports: [{ containerPort: 80 }],
        env: [{ name: 'ENV', value: 'production' }],
      });
      const yaml = buildResourceYaml(d);
      const docs = parseManifestYaml(yaml);
      expect(docs[0].kind).toBe('Deployment');
      const parsed = docs[0] as K8sDeployment;
      expect(parsed.spec.replicas).toBe(3);
      expect(parsed.metadata.name).toBe('nginx');
    });

    it('Service YAML 应可被反序列化', () => {
      const s = createServiceBuilder({
        name: 'web',
        selector: { app: 'web' },
        ports: [{ name: 'http', port: 80, targetPort: 8080 }],
      });
      const yaml = buildResourceYaml(s);
      const docs = parseManifestYaml(yaml);
      const parsed = docs[0] as K8sService;
      expect(parsed.spec.ports[0].name).toBe('http');
    });

    it('Ingress YAML 应可被反序列化', () => {
      const i = createIngressBuilder({
        name: 'web',
        rules: [
          {
            host: 'example.com',
            paths: [{ path: '/', backendService: 'web', backendPort: 80 }],
          },
        ],
      });
      const yaml = buildResourceYaml(i);
      const docs = parseManifestYaml(yaml);
      const parsed = docs[0] as K8sIngress;
      expect(parsed.spec.rules?.[0].host).toBe('example.com');
    });

    it('ConfigMap YAML 应可被反序列化', () => {
      const cm = createConfigMapBuilder({
        name: 'config',
        data: { key1: 'value1', key2: 'value2' },
      });
      const yaml = buildResourceYaml(cm);
      const docs = parseManifestYaml(yaml);
      const parsed = docs[0] as K8sConfigMap;
      expect(parsed.data?.key1).toBe('value1');
    });

    it('HPA YAML 应可被反序列化', () => {
      const h = createHPABuilder({
        name: 'hpa',
        scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'app' },
        minReplicas: 1,
        maxReplicas: 5,
        metrics: [{ type: 'cpu', targetUtilization: 75 }],
      });
      const yaml = buildResourceYaml(h);
      const docs = parseManifestYaml(yaml);
      const parsed = docs[0] as K8sHPA;
      expect(parsed.spec.maxReplicas).toBe(5);
    });
  });
});
