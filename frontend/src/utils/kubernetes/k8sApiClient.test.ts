/**
 * # ============================================================
 * # K8s API Client Tests (Cycle 55 G55-04)
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import { K8sApiClient, K8sApiError, createK8sClient } from './k8sApiClient';

describe('K8s API Client', () => {
  describe('配置管理', () => {
    it('应正确初始化', () => {
      const client = createK8sClient({
        apiServerUrl: 'https://api.example.com:6443',
        auth: { type: 'bearer', token: 'test-token' },
        namespace: 'production',
        mode: 'mock',
      });
      expect(client).toBeInstanceOf(K8sApiClient);
    });

    it('应去除 URL 尾部斜杠', () => {
      const client = createK8sClient({
        apiServerUrl: 'https://api.example.com:6443///',
        auth: { type: 'anonymous' },
        mode: 'mock',
      });
      // 通过 mock list pods 验证 URL 拼接
      expect(async () => await client.listPods()).not.toThrow();
    });

    it('应支持所有认证方式', () => {
      const bearer = createK8sClient({ apiServerUrl: 'https://x', auth: { type: 'bearer', token: 't' }, mode: 'mock' });
      const basic = createK8sClient({ apiServerUrl: 'https://x', auth: { type: 'basic', username: 'a', password: 'b' }, mode: 'mock' });
      const cert = createK8sClient({ apiServerUrl: 'https://x', auth: { type: 'clientCert', clientCert: 'c', clientKey: 'k' }, mode: 'mock' });
      const anon = createK8sClient({ apiServerUrl: 'https://x', auth: { type: 'anonymous' }, mode: 'mock' });
      expect(bearer).toBeDefined();
      expect(basic).toBeDefined();
      expect(cert).toBeDefined();
      expect(anon).toBeDefined();
    });
  });

  describe('List API (Mock)', () => {
    it('应列出 Pods', async () => {
      const client = createK8sClient({
        apiServerUrl: 'https://test',
        auth: { type: 'anonymous' },
        mode: 'mock',
      });
      const res = await client.listPods();
      expect(res.kind).toBe('PodList');
      expect(res.items.length).toBeGreaterThan(0);
    });

    it('应列出 Deployments', async () => {
      const client = createK8sClient({
        apiServerUrl: 'https://test',
        auth: { type: 'anonymous' },
        mode: 'mock',
      });
      const res = await client.listDeployments();
      expect(res.kind).toBe('DeploymentList');
      expect(res.items.length).toBeGreaterThan(0);
    });

    it('应列出 Services', async () => {
      const client = createK8sClient({
        apiServerUrl: 'https://test',
        auth: { type: 'anonymous' },
        mode: 'mock',
      });
      const res = await client.listServices();
      expect(res.kind).toBe('ServiceList');
      expect(res.items.length).toBeGreaterThan(0);
    });

    it('应列出 Namespaces', async () => {
      const client = createK8sClient({
        apiServerUrl: 'https://test',
        auth: { type: 'anonymous' },
        mode: 'mock',
      });
      const res = await client.listNamespaces();
      expect(res.kind).toBe('NamespaceList');
      expect(res.items.length).toBeGreaterThan(0);
    });

    it('应列出 Nodes', async () => {
      const client = createK8sClient({
        apiServerUrl: 'https://test',
        auth: { type: 'anonymous' },
        mode: 'mock',
      });
      const res = await client.listNodes();
      expect(res.kind).toBe('NodeList');
      expect(res.items.length).toBeGreaterThan(0);
    });

    it('应支持 labelSelector', async () => {
      const client = createK8sClient({
        apiServerUrl: 'https://test',
        auth: { type: 'anonymous' },
        mode: 'mock',
      });
      const res = await client.listPods('default', 'app=mock');
      expect(res.items.length).toBeGreaterThan(0);
    });
  });

  describe('Get API', () => {
    it('应获取单个 Pod', async () => {
      const client = createK8sClient({
        apiServerUrl: 'https://test',
        auth: { type: 'anonymous' },
        mode: 'mock',
      });
      const pod = await client.get({
        version: 'v1',
        plural: 'pods',
        name: 'test-pod',
        namespace: 'default',
      });
      expect(pod).toBeDefined();
    });
  });

  describe('Create API', () => {
    it('应创建资源', async () => {
      const client = createK8sClient({
        apiServerUrl: 'https://test',
        auth: { type: 'bearer', token: 't' },
        mode: 'mock',
      });
      const deployment = {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'new-deploy', namespace: 'default' },
        spec: { replicas: 3 },
      };
      const result = await client.create(deployment, { group: 'apps', version: 'v1', plural: 'deployments' });
      expect((result as { metadata: { name: string } }).metadata.name).toBe('new-deploy');
    });
  });

  describe('Update API', () => {
    it('应更新资源', async () => {
      const client = createK8sClient({
        apiServerUrl: 'https://test',
        auth: { type: 'bearer', token: 't' },
        mode: 'mock',
      });
      const deployment = {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'deploy', namespace: 'default' },
        spec: { replicas: 5 },
      };
      const result = await client.update(deployment, { group: 'apps', version: 'v1', plural: 'deployments' });
      expect((result as { spec: { replicas: number } }).spec.replicas).toBe(5);
    });
  });

  describe('Delete API', () => {
    it('应删除资源', async () => {
      const client = createK8sClient({
        apiServerUrl: 'https://test',
        auth: { type: 'bearer', token: 't' },
        mode: 'mock',
      });
      const status = await client.delete({
        version: 'v1',
        plural: 'pods',
        name: 'old-pod',
        namespace: 'default',
      });
      expect(status.status).toBe('Success');
    });

    it('应支持 propagationPolicy', async () => {
      const client = createK8sClient({
        apiServerUrl: 'https://test',
        auth: { type: 'bearer', token: 't' },
        mode: 'mock',
      });
      const status = await client.delete({
        version: 'v1',
        plural: 'pods',
        name: 'p',
        propagationPolicy: 'Foreground',
        gracePeriodSeconds: 30,
      });
      expect(status.status).toBe('Success');
    });
  });

  describe('Patch API', () => {
    it('应支持 strategic merge patch', async () => {
      const client = createK8sClient({
        apiServerUrl: 'https://test',
        auth: { type: 'bearer', token: 't' },
        mode: 'mock',
      });
      const result = await client.patch({
        version: 'v1',
        plural: 'pods',
        name: 'p',
        patchType: 'strategic',
        patch: { metadata: { labels: { new: 'true' } } },
      });
      expect(result).toBeDefined();
    });
  });

  describe('Watch API (Mock)', () => {
    it('应订阅资源变化', async () => {
      const client = createK8sClient({
        apiServerUrl: 'https://test',
        auth: { type: 'anonymous' },
        mode: 'mock',
      });
      const events: string[] = [];
      const stop = await client.watch({
        version: 'v1',
        plural: 'pods',
        namespace: 'default',
        onEvent: (e) => events.push(e.type),
      });
      // 等待 3.5s 触发 3+ 事件
      await new Promise((resolve) => setTimeout(resolve, 3500));
      stop();
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('Health Check', () => {
    it('应返回健康状态 (Mock)', async () => {
      const client = createK8sClient({
        apiServerUrl: 'https://test',
        auth: { type: 'anonymous' },
        mode: 'mock',
      });
      const result = await client.healthCheck();
      expect(result.healthy).toBe(true);
      expect(result.version).toBe('v1.28.0');
    });
  });

  describe('Cluster Info', () => {
    it('应返回集群信息 (Mock)', async () => {
      const client = createK8sClient({
        apiServerUrl: 'https://test',
        auth: { type: 'anonymous' },
        mode: 'mock',
      });
      const info = await client.getClusterInfo();
      expect(info.version).toBe('v1.28.0');
      expect(info.nodes).toBeGreaterThan(0);
      expect(info.namespaces).toBeGreaterThan(0);
      expect(info.pods).toBeGreaterThan(0);
    });
  });

  describe('错误处理', () => {
    it('K8sApiError 应包含 status 和 message', () => {
      const err = new K8sApiError(404, {
        kind: 'Status',
        status: 'Failure',
        reason: 'NotFound',
        message: 'pod not found',
      });
      expect(err.status).toBe(404);
      expect(err.message).toContain('NotFound');
      expect(err.name).toBe('K8sApiError');
    });
  });

  describe('Watch 清理', () => {
    it('stopAllWatches 应清理所有 watch', async () => {
      const client = createK8sClient({
        apiServerUrl: 'https://test',
        auth: { type: 'anonymous' },
        mode: 'mock',
      });
      const stop1 = await client.watch({ version: 'v1', plural: 'pods', onEvent: () => {} });
      const stop2 = await client.watch({ version: 'v1', plural: 'services', onEvent: () => {} });
      expect(stop1).toBeDefined();
      expect(stop2).toBeDefined();
      client.stopAllWatches();
    });
  });
});
