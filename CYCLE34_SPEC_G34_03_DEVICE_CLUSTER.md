# Cycle 34 SPEC: DeviceClusterEngine (设备集群管理引擎)

> **任务编号**：G34-03
> **任务名称**：DeviceClusterEngine - 设备集群管理引擎
> **SPEC 版本**：v1.0.0
> **编写时间**：2026-07-31
> **关联文档**：[CYCLE34_CODEX_TRAE_RESEARCH.md § 4](./CYCLE34_CODEX_TRAE_RESEARCH.md) / [CYCLE34_GAP_ANALYSIS.md § 5.3](./CYCLE34_GAP_ANALYSIS.md)

---

## 1. 任务概述

### 1.1 目标

实现多设备集群管理引擎，覆盖 mDNS / DNS-SD 局域网设备发现、跨子网 Discovery Proxy 抽象、任务三维路由（能力/负载/电量）、心跳监控、故障转移，对标 Trae Solo 三端协同 + Cursor Cluster Agent。

### 1.2 范围

**In-Scope**:
- mDNS / DNS-SD 设备发现（抽象层 + Mock 实现）
- 设备注册（能力画像 + 标签 + 区域）
- 任务分发（能力路由 + 负载均衡 + 电量感知）
- 心跳机制（10-30s 标准 + 超时剔除）
- 故障转移（自动 + 任务重排队 + Saga 模式）
- 设备分组（Label / Tag / 区域）
- 远程命令（设备间消息 + 任务迁移 + 状态广播）
- 设备统计
- 跨子网扩展（Discovery Proxy 抽象层）

**Out-of-Scope**:
- 实际 mDNS 网络协议实现（用 TypeScript 模拟发现流程）
- Bonjour / Avahi 进程管理

---

## 2. 架构设计

### 2.1 类结构

```typescript
class DeviceClusterEngine {
  // 配置
  private config: ClusterConfig;
  
  // 设备注册表
  private devices: Map<string, Device> = new Map();
  
  // 任务注册表
  private tasks: Map<string, ClusterTask> = new Map();
  
  // 设备发现
  private discovery: DeviceDiscovery;
  
  // 任务路由器
  private router: TaskRouter;
  
  // 心跳监控
  private heartbeatMonitor: HeartbeatMonitor;
  
  // 故障转移
  private failover: FailoverManager;
  
  // 远程命令
  private commandBus: RemoteCommandBus;
  
  // 持久化
  private storageKey: string;
  
  // 事件
  private listeners: Map<ClusterEvent, Set<Function>> = new Map();
}
```

### 2.2 核心数据模型

```typescript
type DeviceStatus = 'online' | 'offline' | 'degraded' | 'busy' | 'draining' | 'failed';
type DeviceCapability = 'cpu' | 'gpu' | 'npu' | 'memory' | 'storage' | 'network' | 'llm-inference' | 'browser' | 'mobile' | 'desktop';
type TaskStatus = 'pending' | 'assigned' | 'running' | 'completed' | 'failed' | 'cancelled' | 'migrated';
type DiscoveryProtocol = 'mdns' | 'dns-sd' | 'discovery-proxy' | 'manual';
type FailoverStrategy = 'requeue' | 'redistribute' | 'saga' | 'abort';
type RoutingStrategy = 'capability' | 'load' | 'battery' | 'hybrid';

interface Device {
  id: string;
  name: string;
  type: 'desktop' | 'mobile' | 'server' | 'browser' | 'edge';
  status: DeviceStatus;
  capabilities: {
    cpu: { cores: number; frequencyMhz: number; usagePercent: number };
    memory: { totalMb: number; availableMb: number; usagePercent: number };
    storage: { totalGb: number; availableGb: number };
    network: { downloadMbps: number; uploadMbps: number; latencyMs: number };
    gpu?: { model: string; vramMb: number; usagePercent: number };
    npu?: { tops: number; usagePercent: number };
    battery?: { level: number; charging: boolean; healthPercent: number };
  };
  llmSupport: {
    models: string[];        // 支持的模型 ID 列表
    maxContextWindow: number;
    avgInferenceMs: number;
  };
  labels: string[];
  region: string;            // 地理或逻辑区域
  endpoint: string;          // mDNS 域名或 IP
  protocol: DiscoveryProtocol;
  lastHeartbeat: number;
  joinedAt: number;
  metadata: Record<string, any>;
}

interface ClusterTask {
  id: string;
  name: string;
  type: string;              // 'code-generation' / 'code-review' / etc.
  priority: number;          // 1-10
  payload: any;
  requirements: {
    minCpuCores?: number;
    minMemoryMb?: number;
    minGpuVramMb?: number;
    minBatteryPercent?: number;
    requiredModels?: string[];
    maxLatencyMs?: number;
    preferredDeviceType?: Device['type'];
    preferredRegion?: string;
  };
  status: TaskStatus;
  assignedDevice?: string;
  attempts: Array<{ deviceId: string; startedAt: number; endedAt?: number; error?: string }>;
  result?: any;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  metadata: Record<string, any>;
}

interface HeartbeatRecord {
  deviceId: string;
  timestamp: number;
  latencyMs: number;
  status: DeviceStatus;
  cpuUsage: number;
  memoryUsage: number;
  batteryLevel?: number;
}

interface FailoverEvent {
  id: string;
  taskId: string;
  fromDeviceId: string;
  reason: 'heartbeat-timeout' | 'device-failed' | 'device-overloaded' | 'manual';
  strategy: FailoverStrategy;
  newDeviceId?: string;
  timestamp: number;
  resolved: boolean;
}

interface RemoteCommand {
  id: string;
  fromDeviceId: string;
  toDeviceId: string;
  type: 'shutdown' | 'restart' | 'migrate-task' | 'broadcast' | 'sync-state' | 'custom';
  payload: any;
  status: 'pending' | 'acknowledged' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
  error?: string;
}

interface ClusterConfig {
  discoveryProtocol: DiscoveryProtocol;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;       // 默认 3 × heartbeatIntervalMs
  failoverStrategy: FailoverStrategy;
  routingStrategy: RoutingStrategy;
  enableAutoFailover: boolean;
  maxTaskRetries: number;
  persist: boolean;
}
```

### 2.3 mDNS / DNS-SD 设备发现（Mock 抽象层）

```typescript
class DeviceDiscovery {
  private protocol: DiscoveryProtocol;
  private discovered: Map<string, Device> = new Map();
  private browseHandles: Map<string, any> = new Map();
  
  // 启动发现
  start(serviceType: string = '_hermes._tcp.local'): void {
    switch (this.protocol) {
      case 'mdns':
        this.startMDNS(serviceType);
        break;
      case 'dns-sd':
        this.startDNSSD(serviceType);
        break;
      case 'discovery-proxy':
        this.startDiscoveryProxy(serviceType);
        break;
      case 'manual':
        // 手动注册模式
        break;
    }
  }
  
  // Mock: 模拟 mDNS 浏览器
  private startMDNS(serviceType: string): void {
    // 实际实现会调用：
    // - Bonjour (macOS/iOS)
    // - Avahi (Linux)
    // - WSL2 + Avahi (Windows)
    // - mdns-sd (Rust 跨平台)
    
    // Mock: 模拟发现 3 个设备
    setTimeout(() => {
      this.emit('device-discovered', this.createMockDevice('desktop-1', 'desktop', '_hermes._tcp.local'));
      this.emit('device-discovered', this.createMockDevice('mobile-1', 'mobile', '_hermes._tcp.local'));
      this.emit('device-discovered', this.createMockDevice('edge-1', 'edge', '_hermes._tcp.local'));
    }, 1000);
  }
  
  private createMockDevice(id: string, type: Device['type'], serviceType: string): Device {
    return {
      id,
      name: id,
      type,
      status: 'online',
      capabilities: this.getMockCapabilities(type),
      llmSupport: this.getMockLLMSupport(type),
      labels: [type, 'mock'],
      region: 'local',
      endpoint: `${id}.local`,
      protocol: 'mdns',
      lastHeartbeat: Date.now(),
      joinedAt: Date.now(),
      metadata: {},
    };
  }
  
  // 解析 DNS-SD 记录
  parseDNSSDRecord(record: {
    name: string;
    type: 'PTR' | 'SRV' | 'TXT' | 'A';
    value: any;
  }): Partial<Device> | null {
    // PTR → 服务实例名
    // SRV → 主机名 + 端口
    // TXT → 元数据
    // A → IP 地址
    return null;
  }
  
  stop(): void;
  listDiscovered(): Device[];
  onDiscover(listener: (device: Device) => void): () => void;
  onLost(listener: (deviceId: string) => void): () => void;
}
```

### 2.4 任务路由器

```typescript
class TaskRouter {
  constructor(private strategy: RoutingStrategy) {}
  
  // 选择最佳设备
  selectDevice(task: ClusterTask, candidates: Device[]): Device | null {
    if (candidates.length === 0) return null;
    
    switch (this.strategy) {
      case 'capability':
        return this.routeByCapability(task, candidates);
      case 'load':
        return this.routeByLoad(task, candidates);
      case 'battery':
        return this.routeByBattery(task, candidates);
      case 'hybrid':
        return this.routeHybrid(task, candidates);
    }
  }
  
  private routeByCapability(task: ClusterTask, candidates: Device[]): Device | null {
    // 1. 过滤满足 requirements 的设备
    const eligible = candidates.filter((d) => this.meetsRequirements(d, task));
    if (eligible.length === 0) return null;
    
    // 2. 按能力评分排序
    const scored = eligible.map((d) => ({
      device: d,
      score: this.scoreCapability(d, task),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0].device;
  }
  
  private routeByLoad(task: ClusterTask, candidates: Device[]): Device {
    // 选择当前负载最低的设备
    const eligible = candidates.filter((d) => this.meetsRequirements(d, task));
    const sorted = eligible.sort((a, b) => {
      const aLoad = a.capabilities.cpu.usagePercent + a.capabilities.memory.usagePercent;
      const bLoad = b.capabilities.cpu.usagePercent + b.capabilities.memory.usagePercent;
      return aLoad - bLoad;
    });
    return sorted[0] || candidates[0];
  }
  
  private routeByBattery(task: ClusterTask, candidates: Device[]): Device {
    // 移动端电量优先 > 桌面
    const eligible = candidates.filter((d) => {
      if (d.type === 'mobile' && d.capabilities.battery) {
        return d.capabilities.battery.level >= (task.requirements.minBatteryPercent || 20);
      }
      return true;
    });
    return this.routeByLoad(task, eligible);
  }
  
  private routeHybrid(task: ClusterTask, candidates: Device[]): Device {
    // 综合评分 = 能力 0.4 + 负载 0.4 + 电量 0.2
    const eligible = candidates.filter((d) => this.meetsRequirements(d, task));
    const scored = eligible.map((d) => {
      const capScore = this.scoreCapability(d, task);
      const loadScore = 1 - (d.capabilities.cpu.usagePercent + d.capabilities.memory.usagePercent) / 200;
      const batteryScore = d.capabilities.battery ? d.capabilities.battery.level / 100 : 1;
      return { device: d, score: capScore * 0.4 + loadScore * 0.4 + batteryScore * 0.2 };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.device || candidates[0];
  }
  
  private meetsRequirements(device: Device, task: ClusterTask): boolean {
    const r = task.requirements;
    if (r.minCpuCores && device.capabilities.cpu.cores < r.minCpuCores) return false;
    if (r.minMemoryMb && device.capabilities.memory.availableMb < r.minMemoryMb) return false;
    if (r.minGpuVramMb && (!device.capabilities.gpu || device.capabilities.gpu.vramMb < r.minGpuVramMb)) return false;
    if (r.minBatteryPercent && device.type === 'mobile' && device.capabilities.battery) {
      if (device.capabilities.battery.level < r.minBatteryPercent) return false;
    }
    if (r.requiredModels) {
      const hasAll = r.requiredModels.every((m) => device.llmSupport.models.includes(m));
      if (!hasAll) return false;
    }
    if (r.preferredDeviceType && device.type !== r.preferredDeviceType) return false;
    if (r.preferredRegion && device.region !== r.preferredRegion) return false;
    if (device.status !== 'online' && device.status !== 'degraded') return false;
    return true;
  }
  
  private scoreCapability(device: Device, task: ClusterTask): number {
    // 综合评分 CPU 0.2 + Memory 0.2 + GPU 0.3 + LLM 0.3
    const cpuScore = (1 - device.capabilities.cpu.usagePercent / 100) * 0.2;
    const memScore = (device.capabilities.memory.availableMb / device.capabilities.memory.totalMb) * 0.2;
    const gpuScore = device.capabilities.gpu
      ? (1 - device.capabilities.gpu.usagePercent / 100) * 0.3
      : 0.1;
    const llmScore = device.llmSupport.models.length > 0 ? 0.3 : 0;
    return cpuScore + memScore + gpuScore + llmScore;
  }
}
```

### 2.5 心跳监控

```typescript
class HeartbeatMonitor {
  private records: Map<string, HeartbeatRecord[]> = new Map();
  private timer: any = null;
  
  start(): void {
    this.timer = setInterval(() => {
      this.checkHeartbeats();
    }, this.config.heartbeatIntervalMs);
  }
  
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
  
  record(deviceId: string): void;
  
  private checkHeartbeats(): void {
    const now = Date.now();
    for (const device of this.devices.values()) {
      const elapsed = now - device.lastHeartbeat;
      if (elapsed > this.config.heartbeatTimeoutMs && device.status !== 'offline') {
        this.markOffline(device, 'heartbeat-timeout');
      } else if (elapsed > this.config.heartbeatTimeoutMs * 0.5 && device.status === 'online') {
        this.markDegraded(device);
      }
    }
  }
  
  private markOffline(device: Device, reason: string): void {
    device.status = 'offline';
    this.emit('device-offline', { deviceId: device.id, reason });
    this.failover.handleDeviceFailure(device.id);
  }
  
  private markDegraded(device: Device): void {
    device.status = 'degraded';
    this.emit('device-degraded', { deviceId: device.id });
  }
}
```

### 2.6 故障转移

```typescript
class FailoverManager {
  async handleDeviceFailure(deviceId: string): Promise<void> {
    // 找到该设备上运行的所有任务
    const affectedTasks = this.tasks.list({ assignedDevice: deviceId, status: 'running' });
    
    for (const task of affectedTasks) {
      await this.failoverTask(task, 'heartbeat-timeout');
    }
  }
  
  async failoverTask(task: ClusterTask, reason: FailoverEvent['reason']): Promise<void> {
    const attempt = task.attempts.length;
    if (attempt >= this.config.maxTaskRetries) {
      task.status = 'failed';
      this.emit('task-failed-permanently', { taskId: task.id });
      return;
    }
    
    const event: FailoverEvent = {
      id: generateId('fo-'),
      taskId: task.id,
      fromDeviceId: task.assignedDevice,
      reason,
      strategy: this.config.failoverStrategy,
      timestamp: Date.now(),
      resolved: false,
    };
    
    switch (this.config.failoverStrategy) {
      case 'requeue':
        // 重新入队
        task.status = 'pending';
        task.assignedDevice = undefined;
        this.emit('task-requeued', { taskId: task.id, event });
        break;
      case 'redistribute':
        // 立即重新分配
        const newDevice = this.router.selectDevice(task, this.devices.list({ status: 'online' }));
        if (newDevice) {
          task.assignedDevice = newDevice.id;
          task.status = 'assigned';
          event.newDeviceId = newDevice.id;
          this.emit('task-redistributed', { taskId: task.id, newDevice: newDevice.id, event });
        } else {
          task.status = 'pending';
          this.emit('task-no-device-available', { taskId: task.id, event });
        }
        break;
      case 'saga':
        // Saga 模式：补偿事务
        await this.executeSaga(task, event);
        break;
      case 'abort':
        task.status = 'failed';
        task.error = `Device failed: ${reason}`;
        this.emit('task-aborted', { taskId: task.id, event });
        break;
    }
    
    event.resolved = true;
    this.failoverEvents.push(event);
  }
  
  private async executeSaga(task: ClusterTask, event: FailoverEvent): Promise<void> {
    // 1. 保存当前状态
    const savedState = { ...task };
    
    // 2. 尝试在新设备上恢复
    const newDevice = this.router.selectDevice(task, this.devices.list({ status: 'online' }));
    if (newDevice) {
      try {
        // 模拟在新设备上恢复
        task.assignedDevice = newDevice.id;
        task.status = 'assigned';
        event.newDeviceId = newDevice.id;
        this.emit('task-saga-recovered', { taskId: task.id, newDevice: newDevice.id, event });
      } catch (err) {
        // 恢复失败，回滚到原始状态
        Object.assign(task, savedState);
        task.status = 'failed';
        task.error = `Saga recovery failed: ${err.message}`;
        this.emit('task-saga-failed', { taskId: task.id, event });
      }
    } else {
      task.status = 'pending';
      this.emit('task-saga-pending', { taskId: task.id, event });
    }
  }
}
```

### 2.7 远程命令总线

```typescript
class RemoteCommandBus {
  private commands: Map<string, RemoteCommand> = new Map();
  
  send(from: string, to: string, type: RemoteCommand['type'], payload: any): RemoteCommand;
  
  broadcast(from: string, type: RemoteCommand['type'], payload: any): RemoteCommand[];
  
  acknowledge(commandId: string): void;
  complete(commandId: string, result?: any): void;
  fail(commandId: string, error: string): void;
  
  // 任务迁移
  async migrateTask(taskId: string, fromDeviceId: string, toDeviceId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.assignedDevice !== fromDeviceId) return false;
    
    const command = this.send(fromDeviceId, toDeviceId, 'migrate-task', {
      taskId,
      taskState: { ...task },
    });
    
    // 等待确认（带超时）
    const success = await this.waitForCompletion(command.id, 30000);
    if (success) {
      task.assignedDevice = toDeviceId;
      task.status = 'migrated';
      this.emit('task-migrated', { taskId, from: fromDeviceId, to: toDeviceId });
    }
    return success;
  }
  
  private async waitForCompletion(commandId: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const cmd = this.commands.get(commandId);
        if (cmd && (cmd.status === 'completed' || cmd.status === 'failed')) {
          resolve(cmd.status === 'completed');
        } else if (Date.now() - start > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }
}
```

### 2.8 核心 API

```typescript
class DeviceClusterEngine {
  constructor(config?: Partial<ClusterConfig>);
  
  // 设备管理
  registerDevice(device: Omit<Device, 'joinedAt'> & { id?: string }): Device;
  unregisterDevice(deviceId: string): boolean;
  getDevice(deviceId: string): Device | undefined;
  listDevices(filter?: { status?: DeviceStatus; type?: Device['type']; label?: string; region?: string }): Device[];
  updateDeviceStatus(deviceId: string, status: DeviceStatus): void;
  recordHeartbeat(deviceId: string, data?: Partial<HeartbeatRecord>): void;
  
  // 设备发现
  startDiscovery(serviceType?: string): void;
  stopDiscovery(): void;
  onDeviceDiscovered(listener: (device: Device) => void): () => void;
  onDeviceLost(listener: (deviceId: string) => void): () => void;
  
  // 任务管理
  submitTask(task: Omit<ClusterTask, 'id' | 'status' | 'attempts' | 'createdAt'>): ClusterTask;
  cancelTask(taskId: string): boolean;
  retryTask(taskId: string): boolean;
  getTask(taskId: string): ClusterTask | undefined;
  listTasks(filter?: { status?: TaskStatus; assignedDevice?: string; limit?: number }): ClusterTask[];
  completeTask(taskId: string, result: any): void;
  failTask(taskId: string, error: string): void;
  
  // 任务路由
  assignTask(taskId: string): Device | null;
  redistributeTask(taskId: string): Device | null;
  
  // 故障转移
  triggerFailover(deviceId: string, reason?: FailoverEvent['reason']): Promise<void>;
  getFailoverHistory(filter?: { deviceId?: string; since?: number }): FailoverEvent[];
  
  // 远程命令
  sendCommand(from: string, to: string, type: RemoteCommand['type'], payload: any): RemoteCommand;
  broadcastCommand(from: string, type: RemoteCommand['type'], payload: any): RemoteCommand[];
  listCommands(filter?: { status?: RemoteCommand['status']; toDeviceId?: string }): RemoteCommand[];
  
  // 设备分组
  addLabel(deviceId: string, label: string): void;
  removeLabel(deviceId: string, label: string): void;
  listByLabel(label: string): Device[];
  listByRegion(region: string): Device[];
  
  // 统计
  getStats(): {
    devices: { total: number; online: number; offline: number; degraded: number; byType: Record<Device['type'], number> };
    tasks: { total: number; pending: number; running: number; completed: number; failed: number; byType: Record<string, number> };
    failover: { total: number; byReason: Record<FailoverEvent['reason'], number> };
    commands: { total: number; byStatus: Record<RemoteCommand['status'], number> };
  };
  
  // 事件订阅
  on(event: ClusterEvent, listener: (e: any) => void): () => void;
  emit(event: ClusterEvent, data: any): void;
  
  // 生命周期
  start(): void;
  stop(): void;
}

type ClusterEvent =
  | 'device-registered'
  | 'device-unregistered'
  | 'device-online'
  | 'device-offline'
  | 'device-degraded'
  | 'device-discovered'
  | 'device-lost'
  | 'heartbeat-received'
  | 'task-submitted'
  | 'task-assigned'
  | 'task-started'
  | 'task-completed'
  | 'task-failed'
  | 'task-cancelled'
  | 'task-migrated'
  | 'failover-triggered'
  | 'failover-completed'
  | 'command-sent'
  | 'command-acknowledged'
  | 'command-completed'
  | 'command-failed';
```

### 2.9 预置设备配置

```typescript
const PRESET_DEVICES: Omit<Device, 'joinedAt'>[] = [
  {
    id: 'desktop-1',
    name: 'Desktop Workstation',
    type: 'desktop',
    status: 'online',
    capabilities: {
      cpu: { cores: 16, frequencyMhz: 3600, usagePercent: 30 },
      memory: { totalMb: 32768, availableMb: 24576, usagePercent: 25 },
      storage: { totalGb: 1024, availableGb: 512 },
      network: { downloadMbps: 1000, uploadMbps: 500, latencyMs: 5 },
      gpu: { model: 'RTX 4090', vramMb: 24576, usagePercent: 20 },
    },
    llmSupport: { models: ['claude-opus-4', 'gpt-5'], maxContextWindow: 200000, avgInferenceMs: 800 },
    labels: ['workstation', 'gpu-enabled'],
    region: 'us-west',
    endpoint: 'desktop-1.local',
    protocol: 'mdns',
    lastHeartbeat: Date.now(),
    metadata: {},
  },
  {
    id: 'mobile-1',
    name: 'iPhone 17 Pro',
    type: 'mobile',
    status: 'online',
    capabilities: {
      cpu: { cores: 8, frequencyMhz: 3200, usagePercent: 20 },
      memory: { totalMb: 8192, availableMb: 6144, usagePercent: 25 },
      storage: { totalGb: 512, availableGb: 256 },
      network: { downloadMbps: 200, uploadMbps: 100, latencyMs: 20 },
      npu: { tops: 35, usagePercent: 10 },
      battery: { level: 85, charging: false, healthPercent: 98 },
    },
    llmSupport: { models: ['apple-foundation-4b'], maxContextWindow: 8192, avgInferenceMs: 100 },
    labels: ['mobile', 'apple'],
    region: 'us-west',
    endpoint: 'mobile-1.local',
    protocol: 'mdns',
    lastHeartbeat: Date.now(),
    metadata: {},
  },
  {
    id: 'edge-1',
    name: 'Jetson Orin Edge',
    type: 'edge',
    status: 'online',
    capabilities: {
      cpu: { cores: 12, frequencyMhz: 2200, usagePercent: 40 },
      memory: { totalMb: 32768, availableMb: 16384, usagePercent: 50 },
      storage: { totalGb: 512, availableGb: 256 },
      network: { downloadMbps: 500, uploadMbps: 250, latencyMs: 10 },
      gpu: { model: 'Orin GPU', vramMb: 16384, usagePercent: 30 },
    },
    llmSupport: { models: ['llama-3-8b', 'qwen-2-5-7b'], maxContextWindow: 32768, avgInferenceMs: 250 },
    labels: ['edge', 'gpu-enabled', 'jetson'],
    region: 'us-west',
    endpoint: 'edge-1.local',
    protocol: 'mdns',
    lastHeartbeat: Date.now(),
    metadata: {},
  },
];
```

---

## 3. 实施步骤

### Phase 1: 数据模型 + 设备注册（30 分钟）
- 定义所有接口
- `registerDevice` / `unregisterDevice` / `listDevices`
- 单元测试：12 个

### Phase 2: 设备发现（Mock）（20 分钟）
- `DeviceDiscovery` Mock 抽象层
- `startDiscovery` / `onDeviceDiscovered`
- 单元测试：8 个

### Phase 3: 心跳监控（20 分钟）
- `HeartbeatMonitor` + 状态机
- `recordHeartbeat` + 超时检测
- 单元测试：10 个

### Phase 4: 任务路由（30 分钟）
- `TaskRouter` 4 种策略
- `submitTask` / `assignTask` / `redistributeTask`
- 单元测试：12 个

### Phase 5: 故障转移（30 分钟）
- `FailoverManager` 4 种策略
- `triggerFailover` + Saga 模式
- 单元测试：12 个

### Phase 6: 远程命令（20 分钟）
- `RemoteCommandBus` + 任务迁移
- 单元测试：8 个

### Phase 7: 统计 + 事件 + 单例（20 分钟）
- `getStats` + 事件订阅完整 + 单例
- 单元测试：8 个

**预计总测试数**：约 70-80 个

---

## 4. 验收标准

### 4.1 功能验收
- ✅ 设备注册 + 能力画像 + 标签管理
- ✅ Mock 设备发现（mDNS / DNS-SD 抽象）
- ✅ 4 种任务路由策略
- ✅ 心跳超时检测 + 自动剔除
- ✅ 4 种故障转移策略（requeue / redistribute / saga / abort）
- ✅ 远程命令 + 任务迁移
- ✅ 设备统计完整

### 4.2 质量验收
- ✅ TypeScript 0 错误
- ✅ 单元测试 100% 通过
- ✅ 与 RemoteWorktree (C31) / WorktreeSync (C31) 接口兼容

### 4.3 性能验收
- ✅ 设备发现 < 1s
- ✅ 任务路由 < 5ms
- ✅ 支持 100+ 设备 + 10000+ 任务

---

## 5. 风险与缓解

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| mDNS 实际实现复杂 | 🟡 中 | 抽象层 + Mock 实现 + 接口清晰 |
| 心跳误判 | 🟡 中 | 三次超时 + Degraded 过渡状态 |
| 任务迁移数据丢失 | 🟡 中 | Saga 模式 + 状态保存 + 回滚 |
| 设备能力动态变化 | 🟢 低 | 每次心跳更新 + 重新评估 |

---

## 6. 与现有模块集成点

```typescript
// RemoteWorktree (C31) - 设备绑定
RemoteWorktreeEngine.bind → DeviceClusterEngine.registerDevice

// WorktreeSync (C31) - 状态广播
WorktreeSyncEngine.broadcast → DeviceClusterEngine.broadcastCommand

// BackgroundTask (C4) - 分布式任务
BackgroundTask.execute → DeviceClusterEngine.submitTask

// AgentMessaging (C22) - 设备间消息
AgentMessagingEngine.send → DeviceClusterEngine.sendCommand
```

---

## 7. 文件结构

```
frontend/src/utils/
  deviceClusterEngine.ts            # 核心引擎 (~1000 行)
  deviceClusterEngine.test.ts       # 单元测试 (~75 用例)
  deviceClusterTypes.ts             # 类型定义 (可选)
```

---

## SPEC 结束

> **下一步**：基于本 SPEC 实现 `deviceClusterEngine.ts` + 单元测试
