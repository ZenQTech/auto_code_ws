/**
 * # ============================================================
 * # Grafana Cloud 单元测试 (Cycle 54 G54-03)
 * # ====================================
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GrafanaClient,
  toGrafanaDatasourcePayload,
  generateDatasourceProvisioningYaml,
  generateDashboardProviderYaml,
  generateAlertingProvisioningYaml,
  wrapDashboardForUpload,
  createGrafanaCloudEndpoint,
  createSelfHostedGrafanaEndpoint,
  createDefaultDatasourceSet,
} from './grafanaCloud';
import type { GrafanaDatasource } from './grafanaCloud';

describe('toGrafanaDatasourcePayload', () => {
  it('应该转换基本字段', () => {
    const ds: GrafanaDatasource = {
      name: 'Prometheus',
      type: 'prometheus',
      access: 'proxy',
      url: 'http://prometheus:9090',
    };
    const payload = toGrafanaDatasourcePayload(ds);
    expect(payload.name).toBe('Prometheus');
    expect(payload.type).toBe('prometheus');
    expect(payload.url).toBe('http://prometheus:9090');
  });

  it('应该包含可选字段', () => {
    const ds: GrafanaDatasource = {
      name: 'Prometheus',
      type: 'prometheus',
      access: 'proxy',
      url: 'http://prometheus:9090',
      uid: 'my-uid',
      user: 'admin',
      database: 'metrics',
      isDefault: true,
      jsonData: { httpMethod: 'POST' },
    };
    const payload = toGrafanaDatasourcePayload(ds);
    expect(payload.uid).toBe('my-uid');
    expect(payload.user).toBe('admin');
    expect(payload.database).toBe('metrics');
    expect(payload.isDefault).toBe(true);
  });
});

describe('generateDatasourceProvisioningYaml', () => {
  it('应该生成有效 YAML', () => {
    const yaml = generateDatasourceProvisioningYaml('api-key-123', [
      { name: 'Prometheus', type: 'prometheus', access: 'proxy', url: 'http://prom:9090' },
    ]);
    expect(yaml).toContain('apiVersion: 1');
    expect(yaml).toContain('deleteDatasources:');
    expect(yaml).toContain('datasources:');
    expect(yaml).toContain('  - name: Prometheus');
    expect(yaml).toContain('    type: prometheus');
    expect(yaml).toContain('    url: http://prom:9090');
  });

  it('应该包含 secureJsonData 占位符', () => {
    const yaml = generateDatasourceProvisioningYaml('key', [
      {
        name: 'ES',
        type: 'elasticsearch',
        access: 'proxy',
        url: 'http://es:9200',
        secureJsonData: { password: 'secret' },
      },
    ]);
    expect(yaml).toContain('secureJsonData:');
    expect(yaml).toContain('${PASSWORD}');
  });

  it('应该包含 jsonData', () => {
    const yaml = generateDatasourceProvisioningYaml('key', [
      {
        name: 'P',
        type: 'prometheus',
        access: 'proxy',
        url: 'http://p',
        jsonData: { httpMethod: 'POST', timeInterval: '5s' },
      },
    ]);
    expect(yaml).toContain('jsonData:');
    expect(yaml).toContain('"POST"');
  });
});

describe('generateDashboardProviderYaml', () => {
  it('应该生成 file provider', () => {
    const yaml = generateDashboardProviderYaml('key', {
      name: 'default',
      folder: 'Hermes',
      type: 'file',
      updateIntervalSeconds: 30,
    });
    expect(yaml).toContain("name: 'default'");
    expect(yaml).toContain("type: file");
    expect(yaml).toContain('updateIntervalSeconds: 30');
    expect(yaml).toContain('foldersFromFilesStructure: true');
  });

  it('应该生成 http provider', () => {
    const yaml = generateDashboardProviderYaml('key', {
      name: 'remote',
      type: 'http',
      options: { url: 'https://api.example.com/dashboards' },
    });
    expect(yaml).toContain('type: http');
    expect(yaml).toContain('https://api.example.com/dashboards');
  });

  it('应该包含 folderUid', () => {
    const yaml = generateDashboardProviderYaml('key', {
      name: 'x',
      folderUid: 'abc-123',
      type: 'file',
    });
    expect(yaml).toContain("folderUid: 'abc-123'");
  });
});

describe('generateAlertingProvisioningYaml', () => {
  it('应该生成 contactPoints 和 policies', () => {
    const yaml = generateAlertingProvisioningYaml({
      contactPoints: [
        {
          org: 'main',
          name: 'slack-team',
          receivers: [{ type: 'slack', settings: { url: 'https://hooks.slack.com/...' } }],
        },
      ],
      policies: [{ org: 'main', receiver: 'slack-team', groupBy: ['grafana_folder', 'alertname'] }],
    });
    expect(yaml).toContain('contactPoints:');
    expect(yaml).toContain('slack-team');
    expect(yaml).toContain('policies:');
    expect(yaml).toContain('group_by');
  });
});

describe('wrapDashboardForUpload', () => {
  it('应该包装 dashboard', () => {
    const dashboard = { title: 'Test', uid: 'test' };
    const wrapped = wrapDashboardForUpload(dashboard, { folderUid: 'folder1', overwrite: true });
    expect(wrapped.dashboard).toEqual(dashboard);
    expect(wrapped.folderUid).toBe('folder1');
    expect(wrapped.overwrite).toBe(true);
  });

  it('默认值', () => {
    const wrapped = wrapDashboardForUpload({ title: 'Test' });
    expect(wrapped.message).toBe('Uploaded by Hermes');
    expect(wrapped.overwrite).toBe(true);
  });
});

describe('工厂函数', () => {
  it('createGrafanaCloudEndpoint', () => {
    const ep = createGrafanaCloudEndpoint('api-key-123', 'us');
    expect(ep.protocol).toBe('https');
    expect(ep.baseUrl).toContain('grafana.com');
    expect(ep.credentials?.scheme).toBe('bearer');
    expect(ep.credentials?.token).toBe('api-key-123');
  });

  it('createGrafanaCloudEndpoint 区域', () => {
    expect(createGrafanaCloudEndpoint('k', 'eu').baseUrl).toContain('grafana.eu');
    expect(createGrafanaCloudEndpoint('k', 'asia').baseUrl).toContain('grafana.cn');
  });

  it('createSelfHostedGrafanaEndpoint', () => {
    const ep = createSelfHostedGrafanaEndpoint('grafana.local', 3000, { username: 'admin', password: 'admin' });
    expect(ep.baseUrl).toBe('http://grafana.local:3000');
    expect(ep.credentials?.scheme).toBe('basic');
  });

  it('createSelfHostedGrafanaEndpoint 无认证', () => {
    const ep = createSelfHostedGrafanaEndpoint('grafana.local');
    expect(ep.credentials).toBeUndefined();
  });

  it('createDefaultDatasourceSet', () => {
    const set = createDefaultDatasourceSet();
    expect(set.length).toBeGreaterThanOrEqual(3);
    expect(set.find((d) => d.type === 'prometheus')).toBeDefined();
    expect(set.find((d) => d.type === 'loki')).toBeDefined();
    expect(set.find((d) => d.type === 'tempo')).toBeDefined();
  });
});

describe('GrafanaClient', () => {
  let client: GrafanaClient;

  beforeEach(() => {
    client = new GrafanaClient({
      mode: 'mock',
      endpoint: createSelfHostedGrafanaEndpoint('localhost', 3000, { username: 'admin', password: 'admin' }),
      enabled: true,
    });
  });

  it('应该启动和停止', async () => {
    const listener = vi.fn();
    client.subscribe(listener);
    await client.start();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'connected' }));
    await client.shutdown();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'disconnected' }));
  });

  it('应该上传 Dashboard (Mock)', async () => {
    await client.start();
    const result = await client.uploadDashboard({ title: 'Test' });
    expect(result.status).toBe(200);
    expect(result.data.status).toBe('success');
    expect(result.data.uid).toBeDefined();
  });

  it('应该支持 folderUid 选项', async () => {
    await client.start();
    const result = await client.uploadDashboard({ title: 'Test' }, { folderUid: 'folder-1' });
    expect(result.status).toBe(200);
  });

  it('未启动上传应该返回错误', async () => {
    const result = await client.uploadDashboard({ title: 'Test' });
    expect(result.status).toBe(0);
    expect(result.message).toContain('Not started');
  });

  it('应该创建 Datasource (Mock)', async () => {
    await client.start();
    const result = await client.createDatasource({
      name: 'P', type: 'prometheus', access: 'proxy', url: 'http://p',
    });
    expect(result.status).toBe(200);
    expect(result.data.name).toBe('P');
  });

  it('应该列出 Datasources (Mock)', async () => {
    await client.start();
    const result = await client.listDatasources();
    expect(result.status).toBe(200);
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('应该创建 Folder (Mock)', async () => {
    await client.start();
    const result = await client.createFolder({ uid: 'f1', title: 'Folder 1' });
    expect(result.status).toBe(200);
    expect(result.data.uid).toBe('f1');
  });

  it('健康检查 Mock', async () => {
    await client.start();
    const h = await client.healthCheck();
    expect(h.status).toBe('connected');
  });

  it('健康检查禁用', async () => {
    const disabled = new GrafanaClient({
      mode: 'mock',
      endpoint: createSelfHostedGrafanaEndpoint('localhost', 3000),
      enabled: false,
    });
    const h = await disabled.healthCheck();
    expect(h.status).toBe('connected');
  });

  it('测试 Datasource (Mock)', async () => {
    await client.start();
    const result = await client.testDatasource({
      name: 'P', type: 'prometheus', access: 'proxy', url: 'http://p',
    });
    expect(result.status).toBe(200);
    expect(result.data.status).toBe('success');
  });

  it('更新端点', async () => {
    const listener = vi.fn();
    await client.start();
    client.subscribe(listener);
    client.updateEndpoint(createSelfHostedGrafanaEndpoint('new', 3000));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'config-updated' }));
  });

  it('历史记录', async () => {
    await client.start();
    await client.uploadDashboard({ title: 'A' });
    await client.uploadDashboard({ title: 'B' });
    const history = client.getHistory();
    expect(history.length).toBe(2);
  });

  it('defaultFolderUid 应在 uploadDashboard 中使用', async () => {
    const c = new GrafanaClient({
      mode: 'mock',
      endpoint: createSelfHostedGrafanaEndpoint('localhost', 3000),
      defaultFolderUid: 'default-folder',
    });
    await c.start();
    const result = await c.uploadDashboard({ title: 'Test' });
    expect(result.status).toBe(200);
  });
});
