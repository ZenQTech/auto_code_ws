/**
 * # ============================================================
 * # CRD Generator Tests (Cycle 55 G55-03)
 * # ============================================================
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createCRDBuilder,
  createMcpAgentCRD,
  createCustomResource,
  ControllerManager,
  createMcpAgentReconciler,
  buildCRDManifest,
  buildCustomResourceYaml,
  generateRBACManifests,
  McpAgentSpecSchema,
  McpAgentStatusSchema,
} from './crdGenerator';
import type { CustomResource, Reconciler } from './k8sCrdTypes';

describe('CRD Generator', () => {
  describe('createCRDBuilder', () => {
    it('应生成基本 CRD', () => {
      const crd = createCRDBuilder({
        name: 'widgets.example.com',
        group: 'example.com',
        plural: 'widgets',
        singular: 'widget',
        kind: 'Widget',
        version: 'v1',
        specSchema: {
          type: 'object',
          required: ['size'],
          properties: {
            size: { type: 'string', enum: ['small', 'medium', 'large'] },
            color: { type: 'string' },
          },
        },
      });
      expect(crd.apiVersion).toBe('apiextensions.k8s.io/v1');
      expect(crd.kind).toBe('CustomResourceDefinition');
      expect(crd.metadata.name).toBe('widgets.example.com');
      expect(crd.spec.group).toBe('example.com');
      expect(crd.spec.names.plural).toBe('widgets');
      expect(crd.spec.names.kind).toBe('Widget');
      expect(crd.spec.versions[0].name).toBe('v1');
      expect(crd.spec.versions[0].served).toBe(true);
      expect(crd.spec.versions[0].storage).toBe(true);
    });

    it('应支持 shortNames', () => {
      const crd = createCRDBuilder({
        name: 'widgets.example.com',
        group: 'example.com',
        plural: 'widgets',
        singular: 'widget',
        kind: 'Widget',
        shortNames: ['w', 'wdg'],
        version: 'v1',
        specSchema: { type: 'object', properties: {} },
      });
      expect(crd.spec.names.shortNames).toEqual(['w', 'wdg']);
    });

    it('应支持 Cluster scope', () => {
      const crd = createCRDBuilder({
        name: 'clusterwidgets.example.com',
        group: 'example.com',
        plural: 'clusterwidgets',
        singular: 'clusterwidget',
        kind: 'ClusterWidget',
        scope: 'Cluster',
        version: 'v1',
        specSchema: { type: 'object', properties: {} },
      });
      expect(crd.spec.scope).toBe('Cluster');
    });

    it('应支持 status 子资源', () => {
      const crd = createCRDBuilder({
        name: 'widgets.example.com',
        group: 'example.com',
        plural: 'widgets',
        singular: 'widget',
        kind: 'Widget',
        version: 'v1',
        specSchema: { type: 'object', properties: {} },
        statusSchema: { type: 'object', properties: { phase: { type: 'string' } } },
        enableStatusSubresource: true,
      });
      expect(crd.spec.versions[0].subresources?.status).toBeDefined();
    });

    it('应支持 scale 子资源', () => {
      const crd = createCRDBuilder({
        name: 'scaledthings.example.com',
        group: 'example.com',
        plural: 'scaledthings',
        singular: 'scaledthing',
        kind: 'ScaledThing',
        version: 'v1',
        specSchema: {
          type: 'object',
          properties: { replicas: { type: 'integer' } },
        },
        enableScaleSubresource: true,
      });
      expect(crd.spec.versions[0].subresources?.scale).toBeDefined();
      expect(crd.spec.versions[0].subresources?.scale?.specReplicasPath).toBe('.spec.replicas');
    });

    it('应支持 printer columns', () => {
      const crd = createCRDBuilder({
        name: 'widgets.example.com',
        group: 'example.com',
        plural: 'widgets',
        singular: 'widget',
        kind: 'Widget',
        version: 'v1',
        specSchema: { type: 'object', properties: {} },
        additionalPrinterColumns: [
          { name: 'phase', type: 'string', jsonPath: '.status.phase' },
          { name: 'age', type: 'date', jsonPath: '.metadata.creationTimestamp' },
        ],
      });
      const cols = crd.spec.versions[0].additionalPrinterColumns!;
      expect(cols.length).toBe(2);
      expect(cols[0].name).toBe('phase');
    });

    it('应支持 validation rules', () => {
      const crd = createCRDBuilder({
        name: 'widgets.example.com',
        group: 'example.com',
        plural: 'widgets',
        singular: 'widget',
        kind: 'Widget',
        version: 'v1',
        specSchema: { type: 'object', properties: { replicas: { type: 'integer' } } },
        validations: [{ rule: 'self.spec.replicas >= 0', message: 'replicas must be non-negative' }],
      });
      const validations = crd.spec.versions[0].schema.openAPIV3Schema['x-kubernetes-validations'];
      expect(validations).toBeDefined();
      expect(validations![0].rule).toBe('self.spec.replicas >= 0');
    });
  });

  describe('createMcpAgentCRD', () => {
    it('应生成 McpAgent CRD', () => {
      const crd = createMcpAgentCRD();
      expect(crd.metadata.name).toBe('mcpagents.mcp.hermes.io');
      expect(crd.spec.group).toBe('mcp.hermes.io');
      expect(crd.spec.names.plural).toBe('mcpagents');
      expect(crd.spec.names.kind).toBe('McpAgent');
      expect(crd.spec.names.shortNames).toContain('mcp');
      expect(crd.spec.versions[0].name).toBe('v1');
    });

    it('应包含完整 spec schema', () => {
      const crd = createMcpAgentCRD();
      const specProps = crd.spec.versions[0].schema.openAPIV3Schema.properties!.spec!.properties!;
      expect(specProps.image).toBeDefined();
      expect(specProps.replicas).toBeDefined();
      expect(specProps.model).toBeDefined();
      expect(specProps.tools).toBeDefined();
      expect(specProps.autoscaling).toBeDefined();
    });

    it('应包含 status 子资源', () => {
      const crd = createMcpAgentCRD();
      expect(crd.spec.versions[0].subresources?.status).toBeDefined();
    });

    it('应包含标准打印列', () => {
      const crd = createMcpAgentCRD();
      const cols = crd.spec.versions[0].additionalPrinterColumns!;
      const colNames = cols.map((c) => c.name);
      expect(colNames).toContain('image');
      expect(colNames).toContain('replicas');
      expect(colNames).toContain('model');
      expect(colNames).toContain('phase');
    });

    it('应支持自定义版本和标签', () => {
      const crd = createMcpAgentCRD({ version: 'v1alpha1', labels: { env: 'dev' } });
      expect(crd.spec.versions[0].name).toBe('v1alpha1');
      expect(crd.metadata.labels?.env).toBe('dev');
    });
  });

  describe('createCustomResource', () => {
    it('应生成 CR 实例', () => {
      const cr = createCustomResource({
        kind: 'McpAgent',
        group: 'mcp.hermes.io',
        version: 'v1',
        name: 'web-agent',
        namespace: 'production',
        spec: { image: 'agent:1.0.0', replicas: 3 },
      });
      expect(cr.apiVersion).toBe('mcp.hermes.io/v1');
      expect(cr.kind).toBe('McpAgent');
      expect(cr.metadata.name).toBe('web-agent');
      expect(cr.metadata.namespace).toBe('production');
      expect(cr.spec.replicas).toBe(3);
    });

    it('应支持 status', () => {
      const cr = createCustomResource({
        kind: 'McpAgent',
        group: 'mcp.hermes.io',
        version: 'v1',
        name: 'agent',
        spec: { image: 'agent:1.0', replicas: 1 },
        status: { phase: 'Running', readyReplicas: 1 },
      });
      expect(cr.status?.phase).toBe('Running');
      expect(cr.status?.readyReplicas).toBe(1);
    });
  });

  describe('ControllerManager', () => {
    let manager: ControllerManager;

    beforeEach(() => {
      manager = new ControllerManager();
    });

    afterEach(() => {
      manager.stopAll();
    });

    it('应注册和注销 Controller', () => {
      const reconciler: Reconciler = async () => ({ requeue: false });
      manager.register(
        {
          name: 'test',
          watchedGroup: 'example.com',
          watchedVersion: 'v1',
          watchedKind: 'Widget',
        },
        reconciler
      );
      expect(manager.getState('test')).toBeDefined();
      manager.unregister('test');
      expect(manager.getState('test')).toBeUndefined();
    });

    it('应启动和停止 Controller', async () => {
      manager.register(
        {
          name: 'test',
          watchedGroup: 'example.com',
          watchedVersion: 'v1',
          watchedKind: 'Widget',
        },
        async () => ({ requeue: false })
      );
      manager.start('test');
      expect(manager.getState('test')?.running).toBe(true);
      manager.stop('test');
      expect(manager.getState('test')?.running).toBe(false);
    });

    it('应入队和 reconcile CR', async () => {
      let reconcileCount = 0;
      manager.register(
        {
          name: 'test',
          watchedGroup: 'example.com',
          watchedVersion: 'v1',
          watchedKind: 'Widget',
        },
        async () => {
          reconcileCount += 1;
          return { requeue: false };
        }
      );
      manager.start('test');
      const cr: CustomResource = {
        apiVersion: 'example.com/v1',
        kind: 'Widget',
        metadata: { name: 'test-cr' },
        spec: { size: 'small' },
      };
      manager.enqueue('test', cr);
      // 等待异步执行
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(reconcileCount).toBeGreaterThanOrEqual(1);
    });

    it('应捕获 reconcile 错误', async () => {
      manager.register(
        {
          name: 'test',
          watchedGroup: 'example.com',
          watchedVersion: 'v1',
          watchedKind: 'Widget',
        },
        async () => {
          throw new Error('Reconcile failed');
        }
      );
      manager.start('test');
      const cr: CustomResource = {
        apiVersion: 'example.com/v1',
        kind: 'Widget',
        metadata: { name: 'test-cr' },
        spec: {},
      };
      manager.enqueue('test', cr);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const state = manager.getState('test');
      expect(state?.errorCount).toBeGreaterThan(0);
      expect(state?.lastError).toContain('Reconcile failed');
    });

    it('应支持 requeue', async () => {
      let calls = 0;
      manager.register(
        {
          name: 'test',
          watchedGroup: 'example.com',
          watchedVersion: 'v1',
          watchedKind: 'Widget',
        },
        async () => {
          calls += 1;
          return { requeue: true, requeueAfterMs: 10 };
        }
      );
      manager.start('test');
      const cr: CustomResource = {
        apiVersion: 'example.com/v1',
        kind: 'Widget',
        metadata: { name: 'test-cr' },
        spec: {},
      };
      manager.enqueue('test', cr);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(calls).toBeGreaterThan(1);
    });

    it('应返回所有 Controllers 状态', () => {
      manager.register({ name: 'a', watchedGroup: 'x', watchedVersion: 'v1', watchedKind: 'A' }, async () => ({ requeue: false }));
      manager.register({ name: 'b', watchedGroup: 'x', watchedVersion: 'v1', watchedKind: 'B' }, async () => ({ requeue: false }));
      const states = manager.getAllStates();
      expect(states.length).toBe(2);
      expect(states.map((s) => s.name).sort()).toEqual(['a', 'b']);
    });
  });

  describe('createMcpAgentReconciler', () => {
    it('应处理有效 spec', async () => {
      const reconciler = createMcpAgentReconciler();
      const cr: CustomResource = {
        apiVersion: 'mcp.hermes.io/v1',
        kind: 'McpAgent',
        metadata: { name: 'test' },
        spec: { image: 'agent:1.0', replicas: 3 },
      };
      const result = await reconciler({
        cr,
        reconcileCount: 0,
        log: () => {},
      });
      expect(result.requeue).toBe(true);
      expect(cr.status?.phase).toBe('Running');
      expect(cr.status?.readyReplicas).toBe(3);
    });

    it('应在缺 image 时返回错误', async () => {
      const reconciler = createMcpAgentReconciler();
      const cr: CustomResource = {
        apiVersion: 'mcp.hermes.io/v1',
        kind: 'McpAgent',
        metadata: { name: 'test' },
        spec: { replicas: 1 },
      };
      const result = await reconciler({
        cr,
        reconcileCount: 0,
        log: () => {},
      });
      expect(result.requeue).toBe(false);
      expect(result.reason).toBe('invalid-spec');
    });
  });

  describe('buildCRDManifest', () => {
    it('应将 CRD 数组序列化为 Manifest', () => {
      const crd = createMcpAgentCRD();
      const yaml = buildCRDManifest([crd]);
      expect(yaml).toContain('kind: CustomResourceDefinition');
      expect(yaml).toContain('group: mcp.hermes.io');
    });
  });

  describe('buildCustomResourceYaml', () => {
    it('应将 CR 序列化为 YAML', () => {
      const cr = createCustomResource({
        kind: 'McpAgent',
        group: 'mcp.hermes.io',
        version: 'v1',
        name: 'web',
        spec: { image: 'agent:1.0', replicas: 2 },
      });
      const yaml = buildCustomResourceYaml(cr);
      expect(yaml).toContain('apiVersion: mcp.hermes.io/v1');
      expect(yaml).toContain('kind: McpAgent');
      expect(yaml).toContain('replicas: 2');
    });
  });

  describe('generateRBACManifests', () => {
    it('应生成 SA + Role + RoleBinding', () => {
      const rbac = generateRBACManifests({
        name: 'mcpagent-controller',
        namespace: 'mcp-system',
        apiGroup: 'mcp.hermes.io',
        resource: 'mcpagents',
        verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
      });
      expect(rbac.serviceAccount.kind).toBe('ServiceAccount');
      expect(rbac.role.kind).toBe('Role');
      expect(rbac.roleBinding.kind).toBe('RoleBinding');
      expect((rbac.roleBinding as { roleRef: { name: string } }).roleRef.name).toBe('mcpagent-controller');
    });

    it('应包含 status/finalizers 子资源权限', () => {
      const rbac = generateRBACManifests({
        name: 'controller',
        apiGroup: 'mcp.hermes.io',
        resource: 'mcpagents',
        verbs: ['*'],
      });
      const rules = (rbac.role as { rules: Array<{ resources: string[] }> }).rules;
      expect(rules[0].resources).toContain('mcpagents/status');
      expect(rules[0].resources).toContain('mcpagents/finalizers');
    });
  });

  describe('CRD 验证', () => {
    it('McpAgent CRD 应能反序列化并保持关键字段', () => {
      const crd = createMcpAgentCRD();
      const yaml = buildCRDManifest([crd]);
      // 通过手动解析检查关键字段
      expect(yaml).toContain('apiVersion: apiextensions.k8s.io/v1');
      expect(yaml).toContain('kind: CustomResourceDefinition');
      expect(yaml).toContain('name: mcpagents.mcp.hermes.io');
      expect(yaml).toContain('group: mcp.hermes.io');
      expect(yaml).toContain('plural: mcpagents');
      expect(yaml).toContain('kind: McpAgent');
      expect(yaml).toContain('scope: Namespaced');
      expect(yaml).toContain('- name: v1');
    });

    it('McpAgentSpecSchema 应包含必需字段', () => {
      expect(McpAgentSpecSchema.required).toContain('image');
      expect(McpAgentSpecSchema.required).toContain('replicas');
      expect(McpAgentSpecSchema.properties!.image).toBeDefined();
      expect(McpAgentSpecSchema.properties!.model).toBeDefined();
    });

    it('McpAgentStatusSchema 应定义 phase 枚举', () => {
      const phase = McpAgentStatusSchema.properties!.phase as { type: string; enum: string[] };
      expect(phase.type).toBe('string');
      expect(phase.enum).toContain('Running');
      expect(phase.enum).toContain('Failed');
    });
  });
});
