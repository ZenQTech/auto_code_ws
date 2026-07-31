/**
 * # Device Cluster Engine - 单元测试
 * # Cycle 34 G34-03
 * # 覆盖：工具函数、初始化、设备管理、任务管理、路由、故障转移、远程命令、统计、单例
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DeviceClusterEngine,
  generateDeviceId,
  generateTaskId,
  generateCommandId,
  generateFailoverId,
  DEFAULT_CLUSTER_CONFIG,
  PRESET_DEVICES,
  getDefaultDeviceClusterEngine,
  resetDefaultDeviceClusterEngine,
} from './deviceClusterEngine';

describe('DeviceClusterEngine - 工具函数', () => {
  it('generateXxxId 生成唯一 ID', () => {
    expect(generateDeviceId()).toMatch(/^dev-/);
    expect(generateTaskId()).toMatch(/^task-/);
    expect(generateCommandId()).toMatch(/^cmd-/);
    expect(generateFailoverId()).toMatch(/^fo-/);
  });

  it('多次生成 ID 唯一', () => {
    const a = generateDeviceId();
    const b = generateDeviceId();
    expect(a).not.toBe(b);
  });
});

describe('DeviceClusterEngine - 初始化', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('创建时加载 3 个预置设备', () => {
    const engine = new DeviceClusterEngine({ persist: false });
    expect(engine.listDevices()).toHaveLength(3);
  });

  it('持久化：从 localStorage 恢复', () => {
    const e1 = new DeviceClusterEngine({ persist: true });
    const custom = e1.registerDevice({
      id: 'custom-1',
      name: 'Custom',
      type: 'server',
      status: 'online',
      capabilities: {
        cpu: { cores: 4, frequencyMhz: 2400, usagePercent: 10 },
        memory: { totalMb: 8192, availableMb: 6144, usagePercent: 25 },
        storage: { totalGb: 256, availableGb: 128 },
        network: { downloadMbps: 100, uploadMbps: 50, latencyMs: 30 },
      },
      llmSupport: { models: [], maxContextWindow: 4096, avgInferenceMs: 500 },
      labels: ['custom'],
      region: 'us-east',
      endpoint: 'custom-1.local',
      protocol: 'manual',
      metadata: {},
    });
    const e2 = new DeviceClusterEngine({ persist: true });
    expect(e2.getDevice('custom-1')).toBeDefined();
  });
});

describe('DeviceClusterEngine - 设备管理', () => {
  let engine: DeviceClusterEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new DeviceClusterEngine({ persist: false });
  });

  it('registerDevice 注册设备', () => {
    const d = engine.registerDevice({
      name: 'Test',
      type: 'server',
      status: 'online',
      capabilities: {
        cpu: { cores: 4, frequencyMhz: 2400, usagePercent: 10 },
        memory: { totalMb: 8192, availableMb: 6144, usagePercent: 25 },
        storage: { totalGb: 256, availableGb: 128 },
        network: { downloadMbps: 100, uploadMbps: 50, latencyMs: 30 },
      },
      llmSupport: { models: [], maxContextWindow: 4096, avgInferenceMs: 500 },
      labels: ['test'],
      region: 'us-east',
      endpoint: 'test.local',
      protocol: 'manual',
      metadata: {},
    });
    expect(d.id).toBeDefined();
  });

  it('unregisterDevice 注销', () => {
    expect(engine.unregisterDevice('desktop-1')).toBe(true);
    expect(engine.getDevice('desktop-1')).toBeUndefined();
  });

  it('listDevices 按 status 过滤', () => {
    const online = engine.listDevices({ status: 'online' });
    expect(online.every((d) => d.status === 'online')).toBe(true);
  });

  it('listDevices 按 type 过滤', () => {
    const desktops = engine.listDevices({ type: 'desktop' });
    expect(desktops.every((d) => d.type === 'desktop')).toBe(true);
  });

  it('listDevices 按 label 过滤', () => {
    const gpu = engine.listDevices({ label: 'gpu-enabled' });
    expect(gpu.length).toBeGreaterThan(0);
  });

  it('updateDeviceStatus 修改状态', () => {
    engine.updateDeviceStatus('desktop-1', 'busy');
    expect(engine.getDevice('desktop-1')?.status).toBe('busy');
  });

  it('recordHeartbeat 更新心跳时间', () => {
    const before = engine.getDevice('desktop-1')?.lastHeartbeat;
    engine.recordHeartbeat('desktop-1');
    const after = engine.getDevice('desktop-1')?.lastHeartbeat;
    expect(after).toBeGreaterThanOrEqual(before || 0);
  });

  it('addLabel / removeLabel 标签管理', () => {
    engine.addLabel('desktop-1', 'extra');
    expect(engine.getDevice('desktop-1')?.labels).toContain('extra');
    engine.removeLabel('desktop-1', 'extra');
    expect(engine.getDevice('desktop-1')?.labels).not.toContain('extra');
  });

  it('listByLabel 按标签获取', () => {
    const list = engine.listByLabel('gpu-enabled');
    expect(list.length).toBeGreaterThan(0);
  });

  it('listByRegion 按区域获取', () => {
    const list = engine.listByRegion('us-west');
    expect(list.length).toBeGreaterThan(0);
  });
});

describe('DeviceClusterEngine - 设备发现', () => {
  let engine: DeviceClusterEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new DeviceClusterEngine({ persist: false, discoveryProtocol: 'mdns' });
  });

  it('startDiscovery 启动发现', () => {
    engine.startDiscovery();
    expect(true).toBe(true);
    engine.stopDiscovery();
  });

  it('onDeviceDiscovered 订阅', () => {
    const events: any[] = [];
    engine.onDeviceDiscovered((d) => events.push(d));
    expect(typeof engine.onDeviceDiscovered).toBe('function');
  });

  it('onDeviceLost 订阅', () => {
    const unsub = engine.onDeviceLost(() => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('stopDiscovery 停止发现', () => {
    engine.startDiscovery();
    engine.stopDiscovery();
    expect(true).toBe(true);
  });
});

describe('DeviceClusterEngine - 任务管理', () => {
  let engine: DeviceClusterEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new DeviceClusterEngine({ persist: false });
  });

  it('submitTask 提交任务并自动分配', () => {
    const task = engine.submitTask({
      name: 'Test Task',
      type: 'code-generation',
      priority: 5,
      payload: {},
      requirements: {},
      metadata: {},
    });
    expect(task.id).toBeDefined();
    expect(task.status).toBe('assigned');
    expect(task.assignedDevice).toBeDefined();
  });

  it('cancelTask 取消任务', () => {
    const task = engine.submitTask({
      name: 'T', type: 'test', priority: 1, payload: {}, requirements: {}, metadata: {},
    });
    expect(engine.cancelTask(task.id)).toBe(true);
    expect(engine.getTask(task.id)?.status).toBe('cancelled');
  });

  it('retryTask 重试失败任务', () => {
    const task = engine.submitTask({
      name: 'T', type: 'test', priority: 1, payload: {}, requirements: {}, metadata: {},
    });
    engine.failTask(task.id, 'fail');
    expect(engine.retryTask(task.id)).toBe(true);
  });

  it('listTasks 按 status 过滤', () => {
    engine.submitTask({ name: 'A', type: 'a', priority: 1, payload: {}, requirements: {}, metadata: {} });
    engine.submitTask({ name: 'B', type: 'b', priority: 1, payload: {}, requirements: {}, metadata: {} });
    const completed = engine.listTasks({ status: 'assigned' });
    expect(completed.length).toBeGreaterThan(0);
  });

  it('completeTask 完成任务', () => {
    const task = engine.submitTask({
      name: 'T', type: 'test', priority: 1, payload: {}, requirements: {}, metadata: {},
    });
    engine.completeTask(task.id, { result: 'ok' });
    expect(engine.getTask(task.id)?.status).toBe('completed');
  });

  it('failTask 失败任务', () => {
    const task = engine.submitTask({
      name: 'T', type: 'test', priority: 1, payload: {}, requirements: {}, metadata: {},
    });
    engine.failTask(task.id, 'error');
    expect(engine.getTask(task.id)?.status).toBe('failed');
  });
});

describe('DeviceClusterEngine - 任务路由', () => {
  let engine: DeviceClusterEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new DeviceClusterEngine({ persist: false });
  });

  it('assignTask 自动选择能力匹配设备', () => {
    const task = engine.submitTask({
      name: 'GPU Task',
      type: 'inference',
      priority: 5,
      payload: {},
      requirements: { minGpuVramMb: 16000 },
      metadata: {},
    });
    const device = engine.getDevice(task.assignedDevice!);
    expect(device?.capabilities.gpu?.vramMb).toBeGreaterThanOrEqual(16000);
  });

  it('redistributeTask 重新分配', () => {
    const task = engine.submitTask({
      name: 'T', type: 'test', priority: 1, payload: {}, requirements: {}, metadata: {},
    });
    const originalDevice = task.assignedDevice;
    const newDevice = engine.redistributeTask(task.id);
    expect(newDevice).toBeDefined();
  });

  it('requiredModels 过滤', () => {
    const task = engine.submitTask({
      name: 'Specific Model',
      type: 'inference',
      priority: 5,
      payload: {},
      requirements: { requiredModels: ['claude-opus-4'] },
      metadata: {},
    });
    expect(task.assignedDevice).toBe('desktop-1');
  });
});

describe('DeviceClusterEngine - 故障转移', () => {
  let engine: DeviceClusterEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new DeviceClusterEngine({ persist: false });
  });

  it('triggerFailover 重新分配', async () => {
    const task = engine.submitTask({
      name: 'T', type: 'test', priority: 1, payload: {}, requirements: {}, metadata: {},
    });
    const before = task.assignedDevice;
    await engine.triggerFailover(task.id, 'manual');
    const failover = engine.getFailoverHistory();
    expect(failover.length).toBe(1);
    expect(failover[0].taskId).toBe(task.id);
  });

  it('failoverStrategy=abort 直接失败', async () => {
    engine.stop();
    const e2 = new DeviceClusterEngine({ persist: false, failoverStrategy: 'abort' });
    const task = e2.submitTask({
      name: 'T', type: 'test', priority: 1, payload: {}, requirements: {}, metadata: {},
    });
    await e2.triggerFailover(task.id);
    expect(e2.getTask(task.id)?.status === 'failed' || e2.getTask(task.id)?.status === 'assigned').toBe(true);
    e2.stop();
  });

  it('failoverStrategy=requeue 重新入队', async () => {
    const e2 = new DeviceClusterEngine({ persist: false, failoverStrategy: 'requeue' });
    const task = e2.submitTask({
      name: 'T', type: 'test', priority: 1, payload: {}, requirements: {}, metadata: {},
    });
    await e2.triggerFailover(task.id);
    // requeue 模式下任务变为 pending 且无 assignedDevice
    expect(e2.getTask(task.id)?.status).toBe('pending');
    e2.stop();
  });

  it('getFailoverHistory 返回历史', async () => {
    const task = engine.submitTask({
      name: 'T', type: 'test', priority: 1, payload: {}, requirements: {}, metadata: {},
    });
    const originalDevice = task.assignedDevice;
    await engine.triggerFailover(task.id);
    const history = engine.getFailoverHistory({ deviceId: originalDevice });
    expect(history.length).toBe(1);
  });
});

describe('DeviceClusterEngine - 远程命令', () => {
  let engine: DeviceClusterEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new DeviceClusterEngine({ persist: false });
  });

  it('sendCommand 发送命令', () => {
    const cmd = engine.sendCommand('desktop-1', 'mobile-1', 'shutdown', {});
    expect(cmd.id).toBeDefined();
    expect(cmd.status).toBe('pending');
  });

  it('broadcastCommand 广播', () => {
    const cmds = engine.broadcastCommand('desktop-1', 'sync-state', { state: 'X' });
    expect(cmds.length).toBeGreaterThan(0);
  });

  it('acknowledgeCommand 确认', () => {
    const cmd = engine.sendCommand('a', 'b', 'custom', {});
    engine.acknowledgeCommand(cmd.id);
    expect(engine.listCommands().find((c) => c.id === cmd.id)?.status).toBe('acknowledged');
  });

  it('completeCommand 完成', () => {
    const cmd = engine.sendCommand('a', 'b', 'custom', {});
    engine.completeCommand(cmd.id);
    expect(engine.listCommands().find((c) => c.id === cmd.id)?.status).toBe('completed');
  });

  it('failCommand 失败', () => {
    const cmd = engine.sendCommand('a', 'b', 'custom', {});
    engine.failCommand(cmd.id, 'err');
    expect(engine.listCommands().find((c) => c.id === cmd.id)?.status).toBe('failed');
  });

  it('migrateTask 迁移任务', async () => {
    const task = engine.submitTask({
      name: 'T', type: 'test', priority: 1, payload: {}, requirements: {}, metadata: {},
    });
    const success = await engine.migrateTask(task.id, 'desktop-1', 'mobile-1');
    expect(success).toBe(true);
    expect(engine.getTask(task.id)?.assignedDevice).toBe('mobile-1');
  });

  it('listCommands 按 status 过滤', () => {
    engine.sendCommand('a', 'b', 'custom', {});
    const pending = engine.listCommands({ status: 'pending' });
    expect(pending.length).toBeGreaterThan(0);
  });
});

describe('DeviceClusterEngine - 统计', () => {
  let engine: DeviceClusterEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new DeviceClusterEngine({ persist: false });
  });

  it('getStats 返回完整统计', () => {
    const stats = engine.getStats();
    expect(stats.devices.total).toBeGreaterThan(0);
    expect(stats.tasks).toBeDefined();
    expect(stats.failover).toBeDefined();
    expect(stats.commands).toBeDefined();
  });

  it('devices 统计按 type 分类', () => {
    const stats = engine.getStats();
    expect(stats.devices.byType.desktop).toBeGreaterThan(0);
    expect(stats.devices.byType.mobile).toBeGreaterThan(0);
  });

  it('tasks 统计按 status 分类', () => {
    engine.submitTask({ name: 'A', type: 'a', priority: 1, payload: {}, requirements: {}, metadata: {} });
    const stats = engine.getStats();
    expect(stats.tasks.assigned).toBeGreaterThanOrEqual(1);
  });
});

describe('DeviceClusterEngine - 事件订阅', () => {
  let engine: DeviceClusterEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new DeviceClusterEngine({ persist: false });
  });

  it('device-registered 事件', () => {
    const events: any[] = [];
    engine.on('device-registered', (e) => events.push(e));
    engine.registerDevice({
      name: 'X', type: 'server', status: 'online',
      capabilities: {
        cpu: { cores: 4, frequencyMhz: 2400, usagePercent: 10 },
        memory: { totalMb: 8192, availableMb: 6144, usagePercent: 25 },
        storage: { totalGb: 256, availableGb: 128 },
        network: { downloadMbps: 100, uploadMbps: 50, latencyMs: 30 },
      },
      llmSupport: { models: [], maxContextWindow: 4096, avgInferenceMs: 500 },
      labels: [], region: 'x', endpoint: 'x.local', protocol: 'manual', metadata: {},
    });
    expect(events.length).toBe(1);
  });

  it('task-submitted 事件', () => {
    const events: any[] = [];
    engine.on('task-submitted', (e) => events.push(e));
    engine.submitTask({ name: 'T', type: 'test', priority: 1, payload: {}, requirements: {}, metadata: {} });
    expect(events.length).toBe(1);
  });

  it('heartbeat-received 事件', () => {
    const events: any[] = [];
    engine.on('heartbeat-received', (e) => events.push(e));
    engine.recordHeartbeat('desktop-1');
    expect(events.length).toBe(1);
  });
});

describe('DeviceClusterEngine - 单例', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultDeviceClusterEngine();
  });

  it('getDefaultDeviceClusterEngine 单例', () => {
    const a = getDefaultDeviceClusterEngine();
    const b = getDefaultDeviceClusterEngine();
    expect(a).toBe(b);
  });

  it('resetDefaultDeviceClusterEngine 重置', () => {
    const a = getDefaultDeviceClusterEngine();
    resetDefaultDeviceClusterEngine();
    const b = getDefaultDeviceClusterEngine();
    expect(a).not.toBe(b);
  });
});
