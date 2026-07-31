/**
 * Cycle 34 E2E 集成测试 (v6.97.0+)
 * 验证 G34-01/G34-02/G34-03 三个核心引擎 + UI 组件 + 主应用集成的端到端连通性
 *
 * 覆盖目标：
 * 1. EdgeModelRouterEngine 端云模型路由 + 隐私 Tier + Token 预算 + 路由策略
 * 2. OfflineFirstEngine 离线检测 + 本地队列 + CRDT + 引擎降级
 * 3. DeviceClusterEngine 设备注册 + 任务路由 + 故障转移 + 远程命令
 * 4. 三个 UI 组件可成功导入
 * 5. 三个引擎的事件系统独立工作
 * 6. 三引擎协同工作（端云路由 → 离线执行 → 设备集群）
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';

describe('Cycle 34 E2E 集成测试', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ============ G34-01: EdgeModelRouter 端到端 ============

  describe('G34-01: EdgeModelRouter 端到端', () => {
    it('预置模型加载 + 端云模型注册 + 路由策略激活', async () => {
      const { EdgeModelRouterEngine } = await import('../utils/edgeModelRouterEngine');
      const engine = new EdgeModelRouterEngine({ persist: false });

      // 1. 加载预置模型
      const allModels = engine.listModels();
      expect(allModels.length).toBeGreaterThan(0);
      const edgeModels = engine.listModels({ tier: 'edge' });
      const cloudModels = engine.listModels({ tier: 'cloud' });
      expect(edgeModels.length).toBeGreaterThan(0);
      expect(cloudModels.length).toBeGreaterThan(0);

      // 2. 注册自定义模型
      const customModelId = engine.registerCloudModel({
        name: 'Custom GPT-5.5',
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1',
        contextWindow: 128000,
        avgLatencyMs: 800,
        priority: 7,
        costPerMillionTokens: { input: 10, output: 30 },
        capabilities: { codeGeneration: 0.95, reasoning: 0.95, summarization: 0.9, longContext: 0.9 },
        enabled: true,
      });
      expect(customModelId).toBeDefined();

      const edgeModelId = engine.registerEdgeModel({
        name: 'Custom Llama-3',
        provider: 'ollama',
        endpoint: 'http://localhost:11434',
        contextWindow: 8192,
        avgLatencyMs: 50,
        priority: 6,
        costPerMillionTokens: { input: 0, output: 0 },
        capabilities: { codeGeneration: 0.7, reasoning: 0.65, summarization: 0.7, longContext: 0.5 },
        enabled: true,
      });
      expect(edgeModelId).toBeDefined();

      // 3. 列出策略并激活
      const policies = engine.listPolicies();
      expect(policies.length).toBeGreaterThanOrEqual(3);
      engine.setActivePolicy('policy-balance');
      expect(engine.getActivePolicy().id).toBe('policy-balance');
    });

    it('route 路由决策 - 隐私 Tier 1 强制端侧', async () => {
      const { EdgeModelRouterEngine } = await import('../utils/edgeModelRouterEngine');
      const engine = new EdgeModelRouterEngine({ persist: false });
      engine.setActivePolicy('policy-balance');

      const decision = engine.route({
        taskType: 'general',
        estimatedTokens: 1000,
        estimatedDifficulty: 'easy',
        privacyTier: 1,
        requiresLongContext: false,
        requiresTools: false,
      });
      expect(decision.selectedTier).toBe('edge');
      expect(decision.id).toBeDefined();
      expect(decision.estimatedCost).toBeGreaterThanOrEqual(0);
    });

    it('route 路由决策 - 困难任务优先云端', async () => {
      const { EdgeModelRouterEngine } = await import('../utils/edgeModelRouterEngine');
      const engine = new EdgeModelRouterEngine({ persist: false });
      engine.setActivePolicy('policy-balance');

      const decision = engine.route({
        taskType: 'code-generation',
        estimatedTokens: 5000,
        estimatedDifficulty: 'expert',
        privacyTier: 3,
        requiresLongContext: false,
        requiresTools: true,
      });
      expect(decision.selectedTier).toBe('cloud');
    });

    it('Token 预算管理 - 单次/单日预算', async () => {
      const { EdgeModelRouterEngine } = await import('../utils/edgeModelRouterEngine');
      const engine = new EdgeModelRouterEngine({ persist: false });

      // 1. 获取预算配置
      const cfg = engine.getBudgetConfig();
      expect(cfg.perRequest.maxTokens).toBeGreaterThan(0);
      expect(cfg.perDay.maxCostUsd).toBeGreaterThan(0);

      // 2. 执行路由（使用 expert 难度强制选云端模型，确保产生成本）
      engine.route({
        taskType: 'code-generation',
        estimatedTokens: 50000,  // 足够多以产生可见成本
        estimatedDifficulty: 'expert',
        privacyTier: 3,
        requiresLongContext: false,
        requiresTools: true,
      });

      const dailyUsage = engine.getBudgetUsage('daily');
      // 由于难度 expert 强制云端，且云端模型有非零成本
      expect(dailyUsage.used).toBeGreaterThan(0);
      expect(dailyUsage.remaining).toBeLessThanOrEqual(cfg.perDay.maxCostUsd);

      // 3. 重置单日预算
      engine.resetBudget('daily');
      const afterReset = engine.getBudgetUsage('daily');
      expect(afterReset.used).toBe(0);
    });

    it('事件订阅：route-decided / fallback-triggered', async () => {
      const { EdgeModelRouterEngine } = await import('../utils/edgeModelRouterEngine');
      const engine = new EdgeModelRouterEngine({ persist: false });

      const events: string[] = [];
      engine.on('route-decided', () => events.push('route-decided'));
      engine.on('fallback-triggered', () => events.push('fallback-triggered'));

      engine.route({
        taskType: 'general',
        estimatedTokens: 1000,
        estimatedDifficulty: 'medium',
        privacyTier: 2,
        requiresLongContext: false,
        requiresTools: false,
      });

      expect(events).toContain('route-decided');
    });

    it('routeAndExecute 路由 + Mock 执行 + 统计', async () => {
      const { EdgeModelRouterEngine } = await import('../utils/edgeModelRouterEngine');
      const engine = new EdgeModelRouterEngine({ persist: false });

      const result = await engine.routeAndExecute({
        taskType: 'general',
        estimatedTokens: 1000,
        estimatedDifficulty: 'easy',
        privacyTier: 2,
        requiresLongContext: false,
        requiresTools: false,
      });

      expect(result.decision.selectedModel).toBeDefined();
      expect(result.response).toBeDefined();
      expect(result.response!.content).toContain('Mock response');

      const stats = engine.getStats();
      expect(stats.totalRoutes).toBeGreaterThanOrEqual(1);
    });
  });

  // ============ G34-02: OfflineFirst 端到端 ============

  describe('G34-02: OfflineFirst 端到端', () => {
    it('CRDT 文档 - 4 种类型（counter/register/set/map）', async () => {
      const { OfflineFirstEngine } = await import('../utils/offlineFirstEngine');
      const engine = new OfflineFirstEngine({ persist: false, autoStart: false });

      // 1. Counter CRDT
      const counterDoc = engine.createCRDT('c1', 'stats', 'counter', 0);
      expect(counterDoc.type).toBe('counter');

      // 2. Register CRDT
      const regDoc = engine.createCRDT('r1', 'settings', 'register', 'init');
      expect(regDoc.type).toBe('register');

      // 3. Set CRDT
      const setDoc = engine.createCRDT('s1', 'tags', 'set', ['a', 'b']);
      expect(setDoc.type).toBe('set');

      // 4. Map CRDT
      const mapDoc = engine.createCRDT('m1', 'config', 'map', { key1: 'v1' });
      expect(mapDoc.type).toBe('map');

      // 列表验证
      const all = engine.listCRDTs();
      expect(all).toHaveLength(4);
    });

    it('操作队列 - 入队/取消/重试/同步', async () => {
      const { OfflineFirstEngine } = await import('../utils/offlineFirstEngine');
      const engine = new OfflineFirstEngine({ persist: false, autoStart: false });

      // 1. 入队操作
      const op1 = engine.enqueue({
        type: 'create',
        collection: 'tasks',
        targetId: '1',
        payload: { id: '1', name: 'T1' },
        priority: 5,
        maxAttempts: 3,
        scheduledFor: Date.now(),
      });
      const op2 = engine.enqueue({
        type: 'update',
        collection: 'tasks',
        targetId: '2',
        payload: { id: '2', name: 'T2' },
        priority: 5,
        maxAttempts: 3,
        scheduledFor: Date.now(),
      });
      expect(op1.id).toBeDefined();
      expect(op2.id).toBeDefined();

      // 2. 列出队列
      const queue = engine.listOperations({ status: 'pending' });
      expect(queue).toHaveLength(2);

      // 3. 取消操作 op2
      const cancelled = engine.cancelOperation(op2.id);
      expect(cancelled).toBe(true);

      const afterCancel = engine.listOperations({ status: 'cancelled' });
      expect(afterCancel).toHaveLength(1);

      // 4. 模拟 op1 失败后重试（直接修改内部状态模拟）
      // 找到 op1 并标记为 failed
      const op1FromQueue = engine.listOperations().find((o) => o.id === op1.id);
      expect(op1FromQueue).toBeDefined();
      (op1FromQueue as any).status = 'failed';
      (op1FromQueue as any).error = 'mock failure';

      const retried = engine.retryOperation(op1.id);
      expect(retried).toBe(true);
    });

    it('网络状态检测 + 引擎降级', async () => {
      const { OfflineFirstEngine } = await import('../utils/offlineFirstEngine');
      const engine = new OfflineFirstEngine({ persist: false, autoStart: false });

      // 1. 注册降级链
      engine.registerFallback({
        primaryEngine: 'custom',
        fallbacks: [
          { engine: 'secondary', method: 'execute', condition: 'on-error' },
          { engine: 'tertiary', method: 'execute', condition: 'on-error' },
        ],
        degradedFeatures: ['advanced-search'],
      });
      const chain = engine.getFallbackChain('custom');
      expect(chain).toBeDefined();
      expect(chain!.fallbacks).toHaveLength(2);

      // 2. 执行 with fallback（mock 模式返回 mock 结果）
      const result = await engine.executeWithFallback('custom', 'execute', [1, 2]);
      expect(result).toBeDefined();
      expect(result.degraded).toBe(false);
      expect(result.result).toContain('Mock result');
    });

    it('事件订阅：operation-queued / crdt-updated', async () => {
      const { OfflineFirstEngine } = await import('../utils/offlineFirstEngine');
      const engine = new OfflineFirstEngine({ persist: false, autoStart: false });

      const events: string[] = [];
      engine.on('operation-queued', () => events.push('operation-queued'));
      engine.on('crdt-updated', () => events.push('crdt-updated'));

      engine.enqueue({
        type: 'create',
        collection: 'tasks',
        targetId: '1',
        payload: { id: '1' },
        priority: 5,
        maxAttempts: 3,
        scheduledFor: Date.now(),
      });

      engine.createCRDT('c1', 'stats', 'counter', 5);
      engine.updateCRDT('c1', (state: any) => state);

      expect(events).toContain('operation-queued');
      expect(events).toContain('crdt-updated');
    });

    it('CRDT 合并 - 多节点最终一致', async () => {
      const { OfflineFirstEngine, GCounter } = await import('../utils/offlineFirstEngine');
      const engine = new OfflineFirstEngine({ persist: false, autoStart: false });

      // 节点1 创建
      engine.createCRDT('c1', 'stats', 'counter', 0);
      engine.updateCRDT('c1', (state: InstanceType<typeof GCounter>) => state.increment('node1', 3));

      // 节点2 模拟并发更新
      const otherCounter = new GCounter();
      otherCounter.increment('node2', 5);
      const merged = engine.mergeCRDT('c1', otherCounter, { node2: 1 });
      expect(merged).toBe(true);

      // 验证最终一致
      const final = engine.getCRDT('c1')!;
      const value = (final.state as InstanceType<typeof GCounter>).value();
      expect(value).toBe(8);
    });
  });

  // ============ G34-03: DeviceCluster 端到端 ============

  describe('G34-03: DeviceCluster 端到端', () => {
    it('预置设备加载 + 设备注册 + 设备列表', async () => {
      const { DeviceClusterEngine } = await import('../utils/deviceClusterEngine');
      const engine = new DeviceClusterEngine({ persist: false });

      // 1. 加载预置设备
      const presetDevices = engine.listDevices();
      expect(presetDevices.length).toBeGreaterThan(0);

      // 2. 注册自定义设备（llmSupport 是顶层字段，不在 capabilities 内）
      const deviceId = engine.registerDevice({
        id: 'test-server-1',
        name: 'Test Server',
        type: 'server',
        status: 'online',
        capabilities: {
          cpu: { cores: 16, frequencyMhz: 3000, usagePercent: 20 },
          memory: { totalMb: 32768, availableMb: 16384, usagePercent: 50 },
          storage: { totalGb: 1000, availableGb: 500 },
          network: { downloadMbps: 1000, uploadMbps: 1000, latencyMs: 5 },
          gpu: { model: 'RTX 4090', vramMb: 24576, usagePercent: 30 },
          npu: { tops: 0, usagePercent: 0 },
          battery: { level: 100, charging: true, healthPercent: 100 },
        },
        llmSupport: { models: ['llama3', 'qwen'], maxContextWindow: 8192, avgInferenceMs: 100 },
        labels: ['gpu', 'high-memory'],
        region: 'us-east',
        endpoint: 'test.local:8080',
        protocol: 'mdns',
        metadata: {},
      });
      expect(deviceId).toBeDefined();

      // 3. 列表验证
      const all = engine.listDevices();
      expect(all.length).toBe(presetDevices.length + 1);

      // 4. 按状态过滤
      const online = engine.listDevices({ status: 'online' });
      expect(online.length).toBeGreaterThan(0);
    });

    it('任务提交 + 自动路由 + 任务执行', async () => {
      const { DeviceClusterEngine } = await import('../utils/deviceClusterEngine');
      const engine = new DeviceClusterEngine({ persist: false });

      // 提交任务
      const task = engine.submitTask({
        name: 'E2E Task',
        type: 'code-execution',
        priority: 5,
        payload: { code: 'print("hello")' },
        requirements: { minCpuCores: 4, minMemoryMb: 8192 },
        metadata: { source: 'e2e-test' },
      });
      expect(task.id).toBeDefined();
      expect(task.assignedDevice).toBeDefined();
      expect(task.status).toBe('assigned');

      // 完成任务
      engine.completeTask(task.id, { result: 'success' });
      const completed = engine.getTask(task.id);
      expect(completed!.status).toBe('completed');
    });

    it('故障转移 - redistribute 策略', async () => {
      const { DeviceClusterEngine } = await import('../utils/deviceClusterEngine');
      const engine = new DeviceClusterEngine({ persist: false, failoverStrategy: 'redistribute' });

      const task = engine.submitTask({
        name: 'Failover Test',
        type: 'compute',
        priority: 1,
        payload: {},
        requirements: {},
        metadata: {},
      });
      const originalDevice = task.assignedDevice;
      expect(originalDevice).toBeDefined();

      // 触发故障转移
      const result = await engine.triggerFailover(task.id, 'heartbeat-timeout');
      expect(result).toBe(true);

      // 验证历史
      const history = engine.getFailoverHistory();
      expect(history.length).toBe(1);
      expect(history[0].taskId).toBe(task.id);
    });

    it('远程命令 - 发送 + 接收 + 任务迁移', async () => {
      const { DeviceClusterEngine } = await import('../utils/deviceClusterEngine');
      const engine = new DeviceClusterEngine({ persist: false });

      const devices = engine.listDevices({ status: 'online' });
      expect(devices.length).toBeGreaterThanOrEqual(2);

      // 1. 发送命令（4 参数：from, to, type, payload）
      const commandId = engine.sendCommand(
        'controller',
        devices[0].id,
        'restart',
        { delay: 0 },
      );
      expect(commandId).toBeDefined();

      // 2. 验证命令（使用 listCommands 过滤获取）
      const commands = engine.listCommands({ toDeviceId: devices[0].id });
      expect(commands.length).toBeGreaterThanOrEqual(1);
      const command = commands[0];
      expect(command.type).toBe('restart');
      expect(command.fromDeviceId).toBe('controller');

      // 3. 提交任务并迁移（3 参数：taskId, from, to）
      const task = engine.submitTask({
        name: 'Migration Task',
        type: 'compute',
        priority: 1,
        payload: {},
        requirements: {},
        metadata: {},
      });
      const success = await engine.migrateTask(task.id, task.assignedDevice!, devices[1].id);
      expect(success).toBe(true);

      const afterMigration = engine.getTask(task.id);
      expect(afterMigration!.assignedDevice).toBe(devices[1].id);
    });

    it('事件订阅：device-registered / task-submitted / failover-completed', async () => {
      const { DeviceClusterEngine } = await import('../utils/deviceClusterEngine');
      const engine = new DeviceClusterEngine({ persist: false });

      const events: string[] = [];
      engine.on('device-registered', () => events.push('device-registered'));
      engine.on('task-submitted', () => events.push('task-submitted'));
      engine.on('failover-completed', () => events.push('failover-completed'));

      engine.registerDevice({
        id: 'test-event-device',
        name: 'E',
        type: 'desktop',
        status: 'online',
        capabilities: {
          cpu: { cores: 4, frequencyMhz: 2400, usagePercent: 10 },
          memory: { totalMb: 8192, availableMb: 4096, usagePercent: 50 },
          storage: { totalGb: 256, availableGb: 128 },
          network: { downloadMbps: 100, uploadMbps: 100, latencyMs: 20 },
          gpu: { model: 'integrated', vramMb: 0, usagePercent: 0 },
          npu: { tops: 0, usagePercent: 0 },
          battery: { level: 100, charging: true, healthPercent: 100 },
        },
        llmSupport: { models: ['test-model'], maxContextWindow: 4096, avgInferenceMs: 200 },
        labels: [],
        region: 'local',
        endpoint: 'e.local:80',
        protocol: 'mdns',
        metadata: {},
      });

      const task = engine.submitTask({
        name: 'E', type: 'test', priority: 1, payload: {}, requirements: {}, metadata: {},
      });

      await engine.triggerFailover(task.id, 'manual');

      expect(events).toContain('device-registered');
      expect(events).toContain('task-submitted');
      expect(events).toContain('failover-completed');
    });
  });

  // ============ 三引擎协同 ============

  describe('三引擎协同工作流', () => {
    it('端云路由 → 离线执行 → 设备集群分发', async () => {
      // 1. 端云路由：决定任务使用哪个模型
      const { EdgeModelRouterEngine } = await import('../utils/edgeModelRouterEngine');
      const router = new EdgeModelRouterEngine({ persist: false });
      router.setActivePolicy('policy-cost');

      const decision = router.route({
        taskType: 'code-generation',
        estimatedTokens: 2000,
        estimatedDifficulty: 'medium',
        privacyTier: 2,
        requiresLongContext: false,
        requiresTools: true,
      });
      expect(decision.selectedModel).toBeDefined();
      expect(decision.id).toBeDefined();

      // 2. 离线优先：将路由结果加入本地队列
      const { OfflineFirstEngine } = await import('../utils/offlineFirstEngine');
      const offline = new OfflineFirstEngine({ persist: false, autoStart: false });

      const op = offline.enqueue({
        type: 'execute',
        collection: 'llm-routes',
        targetId: decision.id,
        payload: {
          decisionId: decision.id,
          model: decision.selectedModel.name,
          tier: decision.selectedTier,
          cost: decision.estimatedCost,
        },
        priority: 5,
        maxAttempts: 3,
        scheduledFor: Date.now(),
      });
      expect(op.id).toBeDefined();

      // 3. 设备集群：根据模型特征分发到合适设备
      const { DeviceClusterEngine } = await import('../utils/deviceClusterEngine');
      const cluster = new DeviceClusterEngine({ persist: false });

      const task = cluster.submitTask({
        name: 'Execute LLM Route',
        type: 'llm-inference',
        priority: 5,
        payload: {
          model: decision.selectedModel.name,
          tier: decision.selectedTier,
        },
        requirements: decision.selectedTier === 'edge'
          ? { minCpuCores: 8, minMemoryMb: 16384 }
          : { minCpuCores: 4, minMemoryMb: 8192 },
        metadata: { source: 'edge-router', decisionId: decision.id },
      });
      expect(task.assignedDevice).toBeDefined();
      expect(task.metadata!.decisionId).toBe(decision.id);

      // 4. 三者都工作
      const routerEvents: string[] = [];
      router.on('route-decided', () => routerEvents.push('route'));
      router.route({
        taskType: 'general',
        estimatedTokens: 100,
        estimatedDifficulty: 'easy',
        privacyTier: 2,
        requiresLongContext: false,
        requiresTools: false,
      });
      expect(routerEvents).toContain('route');

      const offlineCrDt = offline.createCRDT('route-counter', 'stats', 'counter', 0);
      expect(offlineCrDt.id).toBeDefined();

      const clusterStats = cluster.getStats();
      expect(clusterStats.tasks.total).toBeGreaterThan(0);
    });

    it('设备离线 + 路由重试 + 故障转移', async () => {
      // 1. 设备集群模拟设备离线
      const { DeviceClusterEngine } = await import('../utils/deviceClusterEngine');
      const cluster = new DeviceClusterEngine({ persist: false, failoverStrategy: 'redistribute' });

      const devices = cluster.listDevices({ status: 'online' });
      expect(devices.length).toBeGreaterThan(0);

      // 提交任务分配到某个设备
      const task = cluster.submitTask({
        name: 'Network Task',
        type: 'compute',
        priority: 5,
        payload: {},
        requirements: {},
        metadata: {},
      });
      const originalDevice = task.assignedDevice;
      expect(originalDevice).toBeDefined();

      // 2. 模拟设备离线
      cluster.updateDeviceStatus(originalDevice!, 'offline');

      // 2. 端云路由：离线场景优先端侧
      const { EdgeModelRouterEngine } = await import('../utils/edgeModelRouterEngine');
      const router = new EdgeModelRouterEngine({ persist: false });
      router.setActivePolicy('policy-balance');

      const decision = router.route({
        taskType: 'general',
        estimatedTokens: 500,
        estimatedDifficulty: 'easy',
        privacyTier: 1, // 强制端侧
        requiresLongContext: false,
        requiresTools: false,
      });
      expect(decision.selectedTier).toBe('edge');

      // 4. 故障转移：任务重新分配
      const result = await cluster.triggerFailover(task.id, 'heartbeat-timeout');
      expect(result).toBe(true);
    });
  });

  // ============ UI 组件导入测试 ============

  describe('UI 组件导入', () => {
    it('EdgeModelRouterPanel 可成功导入', async () => {
      const mod = await import('../components/EdgeModelRouterPanel');
      expect(mod.EdgeModelRouterPanel).toBeDefined();
    });

    it('OfflineFirstPanel 可成功导入', async () => {
      const mod = await import('../components/OfflineFirstPanel');
      expect(mod.OfflineFirstPanel).toBeDefined();
    });

    it('DeviceClusterPanel 可成功导入', async () => {
      const mod = await import('../components/DeviceClusterPanel');
      expect(mod.DeviceClusterPanel).toBeDefined();
    });
  });
});
