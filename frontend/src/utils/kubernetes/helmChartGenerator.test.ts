/**
 * # ============================================================
 * # Helm Chart Generator Tests (Cycle 55 G55-02)
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import {
  generateChartYaml,
  generateDefaultValues,
  generateValuesYaml,
  generateHelpersTpl,
  generateNotesTxt,
  generateDeploymentTemplate,
  generateServiceTemplate,
  generateIngressTemplate,
  generateHPATemplate,
  generateServiceAccountTemplate,
  generateHelmIgnore,
  generateReadme,
  buildHelmChart,
  packChartFiles,
  type HelmChartMetadata,
} from './helmChartGenerator';
import type { ApplicationStackOptions } from './k8sManifestGenerator';

describe('Helm Chart Generator', () => {
  describe('generateChartYaml', () => {
    it('应生成基本 Chart.yaml', () => {
      const meta: HelmChartMetadata = {
        apiVersion: 'v2',
        name: 'myapp',
        version: '1.0.0',
        appVersion: '1.0.0',
        description: 'Test app',
      };
      const yaml = generateChartYaml(meta);
      expect(yaml).toContain('apiVersion: v2');
      expect(yaml).toContain('name: myapp');
      expect(yaml).toContain('version: 1.0.0');
      expect(yaml).toContain('appVersion: "1.0.0"');
      expect(yaml).toContain('description: Test app');
    });

    it('应支持 maintainers', () => {
      const meta: HelmChartMetadata = {
        apiVersion: 'v2',
        name: 'myapp',
        version: '1.0.0',
        appVersion: '1.0.0',
        maintainers: [
          { name: 'Alice', email: 'alice@example.com' },
          { name: 'Bob', url: 'https://bob.example.com' },
        ],
      };
      const yaml = generateChartYaml(meta);
      expect(yaml).toContain('maintainers:');
      expect(yaml).toContain('- name: Alice');
      expect(yaml).toContain('email: alice@example.com');
      expect(yaml).toContain('- name: Bob');
      expect(yaml).toContain('url: https://bob.example.com');
    });

    it('应支持 keywords', () => {
      const meta: HelmChartMetadata = {
        apiVersion: 'v2',
        name: 'myapp',
        version: '1.0.0',
        appVersion: '1.0.0',
        keywords: ['web', 'mcp', 'hermes'],
      };
      const yaml = generateChartYaml(meta);
      expect(yaml).toContain('keywords:');
      expect(yaml).toContain('- web');
      expect(yaml).toContain('- mcp');
    });

    it('应支持 dependencies', () => {
      const meta: HelmChartMetadata = {
        apiVersion: 'v2',
        name: 'myapp',
        version: '1.0.0',
        appVersion: '1.0.0',
        dependencies: [
          { name: 'postgresql', version: '12.0.0', repository: 'https://charts.bitnami.com/bitnami', condition: 'postgresql.enabled' },
        ],
      };
      const yaml = generateChartYaml(meta);
      expect(yaml).toContain('dependencies:');
      expect(yaml).toContain('name: postgresql');
      expect(yaml).toContain('version: 12.0.0');
      expect(yaml).toContain('condition: postgresql.enabled');
    });
  });

  describe('generateDefaultValues', () => {
    const baseOptions: ApplicationStackOptions = {
      name: 'web',
      image: 'nginx:1.25',
      ports: [{ containerPort: 80 }],
    };

    it('应生成完整 values 结构', () => {
      const values = generateDefaultValues(baseOptions);
      expect(values.replicaCount).toBe(1);
      expect((values.image as { repository: string }).repository).toBe('nginx');
      expect((values.image as { tag: string }).tag).toBe('1.25');
      expect((values.service as { type: string }).type).toBe('ClusterIP');
      expect((values.service as { port: number }).port).toBe(80);
    });

    it('应支持自定义副本数', () => {
      const values = generateDefaultValues({ ...baseOptions, replicas: 5 });
      expect(values.replicaCount).toBe(5);
    });

    it('应支持自定义资源', () => {
      const values = generateDefaultValues({
        ...baseOptions,
        resources: {
          cpu: { request: '200m', limit: '1000m' },
          memory: { request: '256Mi', limit: '1Gi' },
        },
      });
      const resources = values.resources as { limits: { cpu: string; memory: string }; requests: { cpu: string; memory: string } };
      expect(resources.limits.cpu).toBe('1000m');
      expect(resources.requests.cpu).toBe('200m');
    });

    it('应支持 HPA 配置', () => {
      const values = generateDefaultValues({
        ...baseOptions,
        enableHPA: true,
        hpaMin: 2,
        hpaMax: 20,
      });
      const autoscaling = values.autoscaling as { enabled: boolean; minReplicas: number; maxReplicas: number };
      expect(autoscaling.enabled).toBe(true);
      expect(autoscaling.minReplicas).toBe(2);
      expect(autoscaling.maxReplicas).toBe(20);
    });

    it('应支持 Ingress 配置', () => {
      const values = generateDefaultValues({
        ...baseOptions,
        enableIngress: true,
        ingressHost: 'app.example.com',
      });
      const ingress = values.ingress as { enabled: boolean; hosts: Array<{ host: string }> };
      expect(ingress.enabled).toBe(true);
      expect(ingress.hosts[0].host).toBe('app.example.com');
    });

    it('应支持 ConfigMap data', () => {
      const values = generateDefaultValues({
        ...baseOptions,
        configMapData: { LOG_LEVEL: 'info', PORT: '8080' },
      });
      expect(values.configMap).toEqual({ LOG_LEVEL: 'info', PORT: '8080' });
    });
  });

  describe('generateValuesYaml', () => {
    it('应将 values 序列化为 YAML', () => {
      const values = {
        replicaCount: 3,
        image: { repository: 'nginx', tag: 'latest' },
        enabled: true,
      };
      const yaml = generateValuesYaml(values);
      expect(yaml).toContain('replicaCount: 3');
      expect(yaml).toContain('repository: nginx');
      expect(yaml).toContain('tag: latest');
      expect(yaml).toContain('enabled: true');
    });

    it('应处理嵌套对象', () => {
      const values = {
        resources: {
          limits: { cpu: '500m', memory: '512Mi' },
          requests: { cpu: '100m', memory: '128Mi' },
        },
      };
      const yaml = generateValuesYaml(values);
      expect(yaml).toContain('resources:');
      expect(yaml).toContain('limits:');
      expect(yaml).toContain('cpu: 500m');
      expect(yaml).toContain('memory: 512Mi');
      expect(yaml).toContain('requests:');
    });

    it('应处理空对象和数组', () => {
      const yaml = generateValuesYaml({ empty: {}, list: [] });
      expect(yaml).toContain('empty: {}');
      expect(yaml).toContain('list: []');
    });
  });

  describe('generateHelpersTpl', () => {
    it('应生成标准 _helpers.tpl', () => {
      const tpl = generateHelpersTpl('myapp');
      expect(tpl).toContain('{{- define "myapp.name"');
      expect(tpl).toContain('{{- define "myapp.fullname"');
      expect(tpl).toContain('{{- define "myapp.labels"');
      expect(tpl).toContain('{{- define "myapp.selectorLabels"');
      expect(tpl).toContain('{{- define "myapp.serviceAccountName"');
    });
  });

  describe('generateNotesTxt', () => {
    it('应生成 NOTES.txt', () => {
      const notes = generateNotesTxt('myapp', { enableIngress: false, port: 80 });
      expect(notes).toContain('Thank you for installing');
      expect(notes).toContain('helm status');
      expect(notes).toContain('port-forward');
    });

    it('Ingress 启用时应显示 URL', () => {
      const notes = generateNotesTxt('myapp', { enableIngress: true, ingressHost: 'app.example.com', port: 80 });
      expect(notes).toContain('app.example.com');
    });
  });

  describe('Template 生成', () => {
    const opts: ApplicationStackOptions = {
      name: 'web',
      image: 'nginx:1.25',
      ports: [{ containerPort: 80 }],
    };

    it('generateDeploymentTemplate 应生成 deployment.yaml', () => {
      const tpl = generateDeploymentTemplate(opts);
      expect(tpl).toContain('apiVersion: apps/v1');
      expect(tpl).toContain('kind: Deployment');
      expect(tpl).toContain('.Values.replicaCount');
      expect(tpl).toContain('.Values.image.repository');
    });

    it('generateServiceTemplate 应生成 service.yaml', () => {
      const tpl = generateServiceTemplate(opts);
      expect(tpl).toContain('apiVersion: v1');
      expect(tpl).toContain('kind: Service');
    });

    it('generateServiceAccountTemplate 应生成 serviceaccount.yaml', () => {
      const tpl = generateServiceAccountTemplate('web');
      expect(tpl).toContain('apiVersion: v1');
      expect(tpl).toContain('kind: ServiceAccount');
      expect(tpl).toContain('serviceAccountName');
    });

    it('generateIngressTemplate 未启用时应返回空', () => {
      const tpl = generateIngressTemplate(opts, 'web');
      expect(tpl).toBe('');
    });

    it('generateIngressTemplate 启用时应生成完整模板', () => {
      const tpl = generateIngressTemplate(
        { ...opts, enableIngress: true, ingressHost: 'app.example.com' },
        'web'
      );
      expect(tpl).toContain('kind: Ingress');
      expect(tpl).toContain('{{- if .Values.ingress.enabled');
      expect(tpl).toContain('ingressClassName');
    });

    it('generateHPATemplate 未启用时应返回空', () => {
      const tpl = generateHPATemplate(opts, 'web');
      expect(tpl).toBe('');
    });

    it('generateHPATemplate 启用时应生成完整模板', () => {
      const tpl = generateHPATemplate({ ...opts, enableHPA: true, hpaMin: 2, hpaMax: 10 }, 'web');
      expect(tpl).toContain('kind: HorizontalPodAutoscaler');
      expect(tpl).toContain('autoscaling.minReplicas');
      expect(tpl).toContain('autoscaling.maxReplicas');
    });
  });

  describe('generateHelmIgnore', () => {
    it('应生成标准 .helmignore', () => {
      const content = generateHelmIgnore();
      expect(content).toContain('.git/');
      expect(content).toContain('.DS_Store');
      expect(content).toContain('.idea/');
    });
  });

  describe('generateReadme', () => {
    it('应生成 README.md', () => {
      const meta: HelmChartMetadata = {
        apiVersion: 'v2',
        name: 'web',
        version: '1.0.0',
        appVersion: '1.0.0',
        description: 'Web app',
      };
      const readme = generateReadme(meta, {
        name: 'web',
        image: 'nginx:1.25',
        ports: [{ containerPort: 80 }],
      });
      expect(readme).toContain('# web');
      expect(readme).toContain('Chart Version');
      expect(readme).toContain('App Version');
      expect(readme).toContain('replicaCount');
      expect(readme).toContain('helm install');
    });
  });

  describe('buildHelmChart', () => {
    it('应一键生成完整 Chart 包', () => {
      const pkg = buildHelmChart({
        name: 'web',
        image: 'nginx:1.25',
        ports: [{ containerPort: 80 }],
        enableHPA: true,
        hpaMin: 2,
        hpaMax: 10,
        enableIngress: true,
        ingressHost: 'app.example.com',
        configMapData: { LOG_LEVEL: 'info' },
        chartVersion: '1.2.3',
        chartDescription: 'Test chart',
        maintainers: [{ name: 'Alice', email: 'alice@example.com' }],
        keywords: ['mcp', 'hermes'],
      });

      // Chart.yaml
      expect(pkg.chartYaml).toContain('name: web');
      expect(pkg.chartYaml).toContain('version: 1.2.3');
      expect(pkg.chartYaml).toContain('Test chart');
      expect(pkg.chartYaml).toContain('Alice');

      // values.yaml
      expect(pkg.valuesYaml).toContain('replicaCount');
      expect(pkg.valuesYaml).toContain('image:');
      expect(pkg.valuesYaml).toContain('autoscaling:');
      expect(pkg.valuesYaml).toContain('LOG_LEVEL');

      // helpers
      expect(pkg.helpersTpl).toContain('define "web.name"');

      // NOTES
      expect(pkg.notesTxt).toContain('app.example.com');

      // templates
      const tplNames = pkg.templates.map((t) => t.filename);
      expect(tplNames).toContain('deployment.yaml');
      expect(tplNames).toContain('service.yaml');
      expect(tplNames).toContain('serviceaccount.yaml');
      expect(tplNames).toContain('ingress.yaml');
      expect(tplNames).toContain('hpa.yaml');

      // extra files
      expect(pkg.extraFiles['.helmignore']).toBeDefined();
      expect(pkg.extraFiles['README.md']).toBeDefined();
    });

    it('应支持最小配置（不启用可选资源）', () => {
      const pkg = buildHelmChart({
        name: 'app',
        image: 'app:1.0',
        ports: [{ containerPort: 8080 }],
      });
      const tplNames = pkg.templates.map((t) => t.filename);
      expect(tplNames).toContain('deployment.yaml');
      expect(tplNames).toContain('service.yaml');
      expect(tplNames).toContain('serviceaccount.yaml');
      expect(tplNames).not.toContain('ingress.yaml');
      expect(tplNames).not.toContain('hpa.yaml');
    });
  });

  describe('packChartFiles', () => {
    it('应将 Chart 打包为文件路径字典', () => {
      const pkg = buildHelmChart({
        name: 'web',
        image: 'nginx:1.25',
        ports: [{ containerPort: 80 }],
      });
      const files = packChartFiles(pkg, 'web');
      expect(files['web/Chart.yaml']).toBeDefined();
      expect(files['web/values.yaml']).toBeDefined();
      expect(files['web/templates/_helpers.tpl']).toBeDefined();
      expect(files['web/templates/NOTES.txt']).toBeDefined();
      expect(files['web/templates/deployment.yaml']).toBeDefined();
      expect(files['web/templates/service.yaml']).toBeDefined();
      expect(files['web/.helmignore']).toBeDefined();
      expect(files['web/README.md']).toBeDefined();
    });

    it('文件路径应包含 chart 名称作为前缀', () => {
      const pkg = buildHelmChart({
        name: 'my-chart',
        image: 'app:1.0',
        ports: [{ containerPort: 8080 }],
      });
      const files = packChartFiles(pkg, 'my-chart');
      expect(Object.keys(files).every((k) => k.startsWith('my-chart/'))).toBe(true);
    });
  });

  describe('Chart 完整性验证', () => {
    it('Chart.yaml 包含必需字段', () => {
      const pkg = buildHelmChart({
        name: 'web',
        image: 'nginx:1.25',
        ports: [{ containerPort: 80 }],
      });
      expect(pkg.chartYaml).toMatch(/^apiVersion: v2/m);
      expect(pkg.chartYaml).toMatch(/^name: web/m);
      expect(pkg.chartYaml).toMatch(/^version: /m);
      expect(pkg.chartYaml).toMatch(/^appVersion: /m);
    });

    it('values.yaml 应包含所有可配置项', () => {
      const pkg = buildHelmChart({
        name: 'web',
        image: 'nginx:1.25',
        ports: [{ containerPort: 80 }],
        enableHPA: true,
        enableIngress: true,
        ingressHost: 'app.example.com',
      });
      const requiredKeys = [
        'replicaCount',
        'image',
        'imagePullSecrets',
        'serviceAccount',
        'service',
        'ingress',
        'resources',
        'autoscaling',
        'nodeSelector',
        'tolerations',
        'affinity',
      ];
      for (const key of requiredKeys) {
        expect(pkg.valuesYaml).toContain(key);
      }
    });

    it('deployment template 应使用 .Values 引用而非硬编码', () => {
      const pkg = buildHelmChart({
        name: 'web',
        image: 'nginx:1.25',
        ports: [{ containerPort: 80 }],
        replicas: 5,
      });
      const deployTpl = pkg.templates.find((t) => t.filename === 'deployment.yaml')!;
      expect(deployTpl.content).toContain('.Values.replicaCount');
      expect(deployTpl.content).toContain('.Values.image.repository');
      // 不应硬编码副本数
      expect(deployTpl.content).not.toMatch(/replicas: 5[^0-9]/);
    });
  });
});
