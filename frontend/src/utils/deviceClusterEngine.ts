/**
 * # ============================================================
 * # Device Cluster Engine - 设备集群管理引擎 (v1.0.0 Cycle 34 G34-03)
 * # ============================================================
 * # 核心作用：实现多设备发现、任务分发、心跳监控、故障转移
 * # 对标 mDNS / DNS-SD (IETF RFC 6762/6763) + Trae Solo 三端协同
 * # 运行流程：
 * #   1. 初始化引擎 + 启动心跳监控
 * #   2. startDiscovery() 启动 mDNS/DNS-SD 设备发现（Mock 抽象层）
 * #   3. registerDevice() 手动注册设备
 * #   4. submitTask() 提交任务
 * #   5. assignTask() 路由器选择最佳设备（能力/负载/电量/混合）
 * #   6. recordHeartbeat() 接收心跳 + 超时检测
 * #   7. triggerFailover() 设备故障时自动任务重分配
 * #   8. sendCommand() / migrateTask() 设备间通信
 * # 输入参数：
 * #   - config: ClusterConfig（可选）
 * #   - device: Device
 * #   - task: ClusterTask
 * # 输出结果：
 * #   - 设备列表、任务列表、心跳记录、故障事件、远程命令
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 34 G34-03 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

export type DeviceStatus = 'online' | 'offline' | 'degraded' | 'busy' | 'draining' | 'failed';
export type DeviceType = 'desktop' | 'mobile' | 'server' | 'browser' | 'edge';
export type TaskStatus = 'pending' | 'assigned' | 'running' | 'completed' | 'failed' | 'cancelled' | 'migrated';
export type DiscoveryProtocol = 'mdns' | 'dns-sd' | 'discovery-proxy' | 'manual';
export type FailoverStrategy = 'requeue' | 'redistribute' | 'saga' | 'abort';
export type RoutingStrategy = 'capability' | 'load' | 'battery' | 'hybrid';

export interface DeviceCPU { cores: number; frequencyMhz: number; usagePercent: number }
export interface DeviceMemory { totalMb: number; availableMb: number; usagePercent: number }
export interface DeviceStorage { totalGb: number; availableGb: number }
export interface DeviceNetwork { downloadMbps: number; uploadMbps: number; latencyMs: number }
export interface DeviceGPU { model: string; vramMb: number; usagePercent: number }
export interface DeviceNPU { tops: number; usagePercent: number }
export interface DeviceBattery { level: number; charging: boolean; healthPercent: number }
export interface DeviceLLMSupport { models: string[]; maxContextWindow: number; avgInferenceMs: number }

export interface DeviceCapabilities {
  cpu: DeviceCPU;
  memory: DeviceMemory;
  storage: DeviceStorage;
  network: DeviceNetwork;
  gpu?: DeviceGPU;
  npu?: DeviceNPU;
  battery?: DeviceBattery;
}

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  status: DeviceStatus;
  capabilities: DeviceCapabilities;
  llmSupport: DeviceLLMSupport;
  labels: string[];
  region: string;
  endpoint: string;
  protocol: DiscoveryProtocol;
  lastHeartbeat: number;
  joinedAt: number;
  metadata: Record<string, any>;
}

export interface ClusterTask {
  id: string;
  name: string;
  type: string;
  priority: number;
  payload: any;
  requirements: {
    minCpuCores?: number;
    minMemoryMb?: number;
    minGpuVramMb?: number;
    minBatteryPercent?: number;
    requiredModels?: string[];
    maxLatencyMs?: number;
    preferredDeviceType?: DeviceType;
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

export interface HeartbeatRecord {
  deviceId: string;
  timestamp: number;
  latencyMs: number;
  status: DeviceStatus;
  cpuUsage: number;
  memoryUsage: number;
  batteryLevel?: number;
}

export interface FailoverEvent {
  id: string;
  taskId: string;
  fromDeviceId: string;
  reason: 'heartbeat-timeout' | 'device-failed' | 'device-overloaded' | 'manual';
  strategy: FailoverStrategy;
  newDeviceId?: string;
  timestamp: number;
  resolved: boolean;
}

export interface RemoteCommand {
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

export interface ClusterConfig {
  discoveryProtocol: DiscoveryProtocol;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  failoverStrategy: FailoverStrategy;
  routingStrategy: RoutingStrategy;
  enableAutoFailover: boolean;
  maxTaskRetries: number;
  maxHeartbeatHistory: number;
  persist: boolean;
}

export type ClusterEvent =
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

// ============ 默认配置 ============

export const DEFAULT_CLUSTER_CONFIG: ClusterConfig = {
  discoveryProtocol: 'manual',
  heartbeatIntervalMs: 10000,
  heartbeatTimeoutMs: 30000,
  failoverStrategy: 'redistribute',
  routingStrategy: 'hybrid',
  enableAutoFailover: true,
  maxTaskRetries: 3,
  maxHeartbeatHistory: 100,
  persist: true,
};

// ============ 工具函数 ============

export function generateDeviceId(): string {
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateCommandId(): string {
  return `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateFailoverId(): string {
  return `fo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ============ 预置设备 ============

export const PRESET_DEVICES: Omit<Device, 'joinedAt' | 'lastHeartbeat'>[] = [
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
    metadata: {},
  },
];

// ============ 任务路由器 ============

class TaskRouter {
  constructor(private strategy: RoutingStrategy) {}

  selectDevice(task: ClusterTask, candidates: Device[]): Device | null {
    if (candidates.length === 0) return null;
    const eligible = candidates.filter((d) => this.meetsRequirements(d, task));
    if (eligible.length === 0) return null;

    switch (this.strategy) {
      case 'capability':
        return this.routeByCapability(eligible, task);
      case 'load':
        return this.routeByLoad(eligible);
      case 'battery':
        return this.routeByBattery(eligible, task);
      case 'hybrid':
      default:
        return this.routeHybrid(eligible, task);
    }
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

  private routeByCapability(candidates: Device[], _task: ClusterTask): Device {
    const scored = candidates.map((d) => ({
      device: d,
      score: d.llmSupport.models.length * 0.4 + d.capabilities.cpu.cores / 32 * 0.2 + (d.capabilities.gpu ? 0.2 : 0) + (d.capabilities.memory.availableMb / d.capabilities.memory.totalMb) * 0.2,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0].device;
  }

  private routeByLoad(candidates: Device[]): Device {
    const sorted = [...candidates].sort((a, b) => {
      const aLoad = a.capabilities.cpu.usagePercent + a.capabilities.memory.usagePercent;
      const bLoad = b.capabilities.cpu.usagePercent + b.capabilities.memory.usagePercent;
      return aLoad - bLoad;
    });
    return sorted[0];
  }

  private routeByBattery(candidates: Device[], _task: ClusterTask): Device {
    const mobile = candidates.filter((d) => d.type === 'mobile');
    if (mobile.length === 0) return this.routeByLoad(candidates);
    return this.routeByLoad(mobile);
  }

  private routeHybrid(candidates: Device[], _task: ClusterTask): Device {
    const scored = candidates.map((d) => {
      const capScore = (d.llmSupport.models.length / 5) * 0.4;
      const loadScore = (1 - (d.capabilities.cpu.usagePercent + d.capabilities.memory.usagePercent) / 200) * 0.4;
      const batteryScore = d.capabilities.battery ? d.capabilities.battery.level / 100 : 1;
      return { device: d, score: capScore + loadScore * 0.4 + batteryScore * 0.2 };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].device;
  }
}

// ============ 引擎主类 ============

export class DeviceClusterEngine {
  private config: ClusterConfig;
  private devices: Map<string, Device> = new Map();
  private tasks: Map<string, ClusterTask> = new Map();
  private commands: Map<string, RemoteCommand> = new Map();
  private failoverHistory: FailoverEvent[] = [];
  private heartbeatHistory: HeartbeatRecord[] = [];
  private router: TaskRouter;
  private listeners: Map<ClusterEvent, Set<(e: any) => void>> = new Map();
  private heartbeatTimer: any = null;
  private discoverySimulator: any = null;
  private storageKey = 'hermes.deviceCluster';

  constructor(config: Partial<ClusterConfig> = {}) {
    this.config = { ...DEFAULT_CLUSTER_CONFIG, ...config };
    this.router = new TaskRouter(this.config.routingStrategy);
    if (this.config.persist) {
      this.load();
    } else {
      this.loadPresetDevices();
    }
    if (typeof setInterval !== 'undefined') {
      this.heartbeatTimer = setInterval(() => this.checkHeartbeats(), this.config.heartbeatIntervalMs);
    }
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
      if (raw) {
        const state = JSON.parse(raw);
        if (state.devices) {
          for (const d of state.devices) this.devices.set(d.id, d);
        }
        if (state.tasks) {
          for (const t of state.tasks) this.tasks.set(t.id, t);
        }
      }
    } catch (e) {
      console.warn('DeviceClusterEngine: failed to load state', e);
    }
    if (this.devices.size === 0) {
      this.loadPresetDevices();
    }
  }

  private save(): void {
    if (!this.config.persist) return;
    try {
      const state = {
        devices: Array.from(this.devices.values()),
        tasks: Array.from(this.tasks.values()),
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(state));
      }
    } catch (e) {
      console.warn('DeviceClusterEngine: failed to save state', e);
    }
  }

  private loadPresetDevices(): void {
    for (const d of PRESET_DEVICES) {
      if (!this.devices.has(d.id)) {
        this.devices.set(d.id, { ...d, joinedAt: Date.now(), lastHeartbeat: Date.now() });
      }
    }
    if (this.config.persist) this.save();
  }

  // ============ 事件订阅 ============

  on(event: ClusterEvent, listener: (e: any) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  private emit(event: ClusterEvent, data: any): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const fn of listeners) {
        try { fn(data); } catch (e) { console.error('Listener error:', e); }
      }
    }
  }

  // ============ 设备管理 ============

  registerDevice(device: Omit<Device, 'joinedAt' | 'lastHeartbeat'> & { id?: string }): Device {
    const id = device.id || generateDeviceId();
    const fullDevice: Device = {
      ...device,
      id,
      joinedAt: Date.now(),
      lastHeartbeat: Date.now(),
    };
    this.devices.set(id, fullDevice);
    if (this.config.persist) this.save();
    this.emit('device-registered', { device: fullDevice });
    return fullDevice;
  }

  unregisterDevice(deviceId: string): boolean {
    const removed = this.devices.delete(deviceId);
    if (removed) {
      if (this.config.persist) this.save();
      this.emit('device-unregistered', { deviceId });
    }
    return removed;
  }

  getDevice(deviceId: string): Device | undefined {
    return this.devices.get(deviceId);
  }

  listDevices(filter?: { status?: DeviceStatus; type?: DeviceType; label?: string; region?: string }): Device[] {
    let list = Array.from(this.devices.values());
    if (filter?.status) list = list.filter((d) => d.status === filter.status);
    if (filter?.type) list = list.filter((d) => d.type === filter.type);
    if (filter?.label) list = list.filter((d) => d.labels.includes(filter.label!));
    if (filter?.region) list = list.filter((d) => d.region === filter.region);
    return list;
  }

  updateDeviceStatus(deviceId: string, status: DeviceStatus): void {
    const device = this.devices.get(deviceId);
    if (!device) return;
    const prev = device.status;
    device.status = status;
    if (this.config.persist) this.save();
    if (prev !== status) {
      if (status === 'online') this.emit('device-online', { deviceId });
      else if (status === 'offline') this.emit('device-offline', { deviceId });
      else if (status === 'degraded') this.emit('device-degraded', { deviceId });
    }
  }

  recordHeartbeat(deviceId: string, data?: Partial<HeartbeatRecord>): void {
    const device = this.devices.get(deviceId);
    if (!device) return;
    device.lastHeartbeat = Date.now();
    if (device.status === 'offline') {
      device.status = 'online';
      this.emit('device-online', { deviceId });
    }
    const record: HeartbeatRecord = {
      deviceId,
      timestamp: Date.now(),
      latencyMs: data?.latencyMs || 0,
      status: device.status,
      cpuUsage: device.capabilities.cpu.usagePercent,
      memoryUsage: device.capabilities.memory.usagePercent,
      batteryLevel: device.capabilities.battery?.level,
    };
    this.heartbeatHistory.push(record);
    if (this.heartbeatHistory.length > this.config.maxHeartbeatHistory) {
      this.heartbeatHistory = this.heartbeatHistory.slice(-this.config.maxHeartbeatHistory);
    }
    this.emit('heartbeat-received', { deviceId, record });
  }

  private checkHeartbeats(): void {
    const now = Date.now();
    for (const device of this.devices.values()) {
      const elapsed = now - device.lastHeartbeat;
      if (elapsed > this.config.heartbeatTimeoutMs && device.status !== 'offline') {
        this.updateDeviceStatus(device.id, 'offline');
        if (this.config.enableAutoFailover) {
          this.handleDeviceFailure(device.id);
        }
      } else if (elapsed > this.config.heartbeatTimeoutMs * 0.5 && device.status === 'online') {
        this.updateDeviceStatus(device.id, 'degraded');
      }
    }
  }

  // ============ 设备发现 ============

  startDiscovery(_serviceType: string = '_hermes._tcp.local'): void {
    if (this.config.discoveryProtocol === 'manual') return;

    // Mock 设备发现：模拟 3 个设备
    if (this.discoverySimulator) clearTimeout(this.discoverySimulator);
    this.discoverySimulator = setTimeout(() => {
      for (const preset of PRESET_DEVICES) {
        if (!this.devices.has(preset.id)) {
          const device: Device = {
            ...preset,
            joinedAt: Date.now(),
            lastHeartbeat: Date.now(),
          };
          this.devices.set(device.id, device);
          this.emit('device-discovered', { device });
        }
      }
    }, 1000);
  }

  stopDiscovery(): void {
    if (this.discoverySimulator) {
      clearTimeout(this.discoverySimulator);
      this.discoverySimulator = null;
    }
  }

  onDeviceDiscovered(listener: (device: Device) => void): () => void {
    return this.on('device-discovered', listener);
  }

  onDeviceLost(listener: (deviceId: string) => void): () => void {
    return this.on('device-lost', listener);
  }

  // ============ 任务管理 ============

  submitTask(task: Omit<ClusterTask, 'id' | 'status' | 'attempts' | 'createdAt'>): ClusterTask {
    const id = generateTaskId();
    const fullTask: ClusterTask = {
      ...task,
      id,
      status: 'pending',
      attempts: [],
      createdAt: Date.now(),
    };
    this.tasks.set(id, fullTask);
    this.emit('task-submitted', { task: fullTask });
    // 自动分配
    this.assignTask(id);
    return fullTask;
  }

  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    task.status = 'cancelled';
    task.completedAt = Date.now();
    this.emit('task-cancelled', { taskId });
    return true;
  }

  retryTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'failed') return false;
    task.status = 'pending';
    task.assignedDevice = undefined;
    this.assignTask(taskId);
    return true;
  }

  getTask(taskId: string): ClusterTask | undefined {
    return this.tasks.get(taskId);
  }

  listTasks(filter?: { status?: TaskStatus; assignedDevice?: string; limit?: number }): ClusterTask[] {
    let list = Array.from(this.tasks.values());
    if (filter?.status) list = list.filter((t) => t.status === filter.status);
    if (filter?.assignedDevice) list = list.filter((t) => t.assignedDevice === filter.assignedDevice);
    if (filter?.limit) list = list.slice(-filter.limit);
    return list;
  }

  completeTask(taskId: string, result: any): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'completed';
    task.result = result;
    task.completedAt = Date.now();
    if (task.assignedDevice) {
      const attempt = task.attempts[task.attempts.length - 1];
      if (attempt) attempt.endedAt = Date.now();
    }
    this.emit('task-completed', { taskId, result });
  }

  failTask(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'failed';
    task.completedAt = Date.now();
    if (task.assignedDevice) {
      const attempt = task.attempts[task.attempts.length - 1];
      if (attempt) {
        attempt.endedAt = Date.now();
        attempt.error = error;
      }
    }
    this.emit('task-failed', { taskId, error });
  }

  // ============ 任务路由 ============

  assignTask(taskId: string): Device | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    const candidates = this.listDevices({ status: 'online' });
    const device = this.router.selectDevice(task, candidates);
    if (!device) return null;

    task.assignedDevice = device.id;
    task.status = 'assigned';
    task.startedAt = Date.now();
    task.attempts.push({ deviceId: device.id, startedAt: Date.now() });
    this.emit('task-assigned', { taskId, deviceId: device.id });
    return device;
  }

  redistributeTask(taskId: string): Device | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    task.assignedDevice = undefined;
    task.status = 'pending';
    return this.assignTask(taskId);
  }

  // ============ 故障转移 ============

  private async handleDeviceFailure(deviceId: string): Promise<void> {
    const affectedTasks = this.listTasks({ assignedDevice: deviceId }).filter((t) => t.status === 'assigned' || t.status === 'running');
    for (const task of affectedTasks) {
      await this.triggerFailover(task.id, 'heartbeat-timeout');
    }
  }

  async triggerFailover(taskId: string, reason: FailoverEvent['reason'] = 'manual'): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || !task.assignedDevice) return false;
    if (task.attempts.length >= this.config.maxTaskRetries) {
      this.failTask(taskId, 'Max retries exceeded');
      return false;
    }

    const event: FailoverEvent = {
      id: generateFailoverId(),
      taskId,
      fromDeviceId: task.assignedDevice,
      reason,
      strategy: this.config.failoverStrategy,
      timestamp: Date.now(),
      resolved: false,
    };

    this.emit('failover-triggered', { event });

    switch (this.config.failoverStrategy) {
      case 'requeue': {
        task.status = 'pending';
        task.assignedDevice = undefined;
        break;
      }
      case 'redistribute': {
        const newDevice = this.router.selectDevice(task, this.listDevices({ status: 'online' }));
        if (newDevice) {
          task.assignedDevice = newDevice.id;
          task.status = 'assigned';
          task.attempts.push({ deviceId: newDevice.id, startedAt: Date.now() });
          event.newDeviceId = newDevice.id;
        } else {
          task.status = 'pending';
        }
        break;
      }
      case 'saga': {
        const savedState = { ...task };
        const newDevice = this.router.selectDevice(task, this.listDevices({ status: 'online' }));
        if (newDevice) {
          try {
            task.assignedDevice = newDevice.id;
            task.status = 'assigned';
            task.attempts.push({ deviceId: newDevice.id, startedAt: Date.now() });
            event.newDeviceId = newDevice.id;
          } catch {
            Object.assign(task, savedState);
            task.status = 'failed';
          }
        } else {
          task.status = 'pending';
        }
        break;
      }
      case 'abort': {
        task.status = 'failed';
        task.completedAt = Date.now();
        break;
      }
    }

    event.resolved = true;
    this.failoverHistory.push(event);
    this.emit('failover-completed', { event });
    return event.resolved;
  }

  getFailoverHistory(filter?: { deviceId?: string; since?: number }): FailoverEvent[] {
    let history = [...this.failoverHistory];
    if (filter?.deviceId) {
      history = history.filter((e) => e.fromDeviceId === filter.deviceId);
    }
    if (filter?.since) {
      history = history.filter((e) => e.timestamp >= filter.since!);
    }
    return history;
  }

  // ============ 远程命令 ============

  sendCommand(from: string, to: string, type: RemoteCommand['type'], payload: any): RemoteCommand {
    const cmd: RemoteCommand = {
      id: generateCommandId(),
      fromDeviceId: from,
      toDeviceId: to,
      type,
      payload,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.commands.set(cmd.id, cmd);
    this.emit('command-sent', { command: cmd });
    return cmd;
  }

  broadcastCommand(from: string, type: RemoteCommand['type'], payload: any): RemoteCommand[] {
    const cmds: RemoteCommand[] = [];
    for (const device of this.devices.values()) {
      if (device.id !== from) {
        cmds.push(this.sendCommand(from, device.id, type, payload));
      }
    }
    return cmds;
  }

  acknowledgeCommand(commandId: string): void {
    const cmd = this.commands.get(commandId);
    if (!cmd) return;
    cmd.status = 'acknowledged';
    this.emit('command-acknowledged', { commandId });
  }

  completeCommand(commandId: string): void {
    const cmd = this.commands.get(commandId);
    if (!cmd) return;
    cmd.status = 'completed';
    cmd.completedAt = Date.now();
    this.emit('command-completed', { commandId });
  }

  failCommand(commandId: string, error: string): void {
    const cmd = this.commands.get(commandId);
    if (!cmd) return;
    cmd.status = 'failed';
    cmd.completedAt = Date.now();
    cmd.error = error;
    this.emit('command-failed', { commandId, error });
  }

  listCommands(filter?: { status?: RemoteCommand['status']; toDeviceId?: string }): RemoteCommand[] {
    let list = Array.from(this.commands.values());
    if (filter?.status) list = list.filter((c) => c.status === filter.status);
    if (filter?.toDeviceId) list = list.filter((c) => c.toDeviceId === filter.toDeviceId);
    return list;
  }

  async migrateTask(taskId: string, fromDeviceId: string, toDeviceId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.assignedDevice !== fromDeviceId) return false;
    if (!this.devices.has(toDeviceId)) return false;

    const cmd = this.sendCommand(fromDeviceId, toDeviceId, 'migrate-task', {
      taskId,
      taskState: { ...task },
    });

    // Mock 立即完成
    this.acknowledgeCommand(cmd.id);
    this.completeCommand(cmd.id);

    task.assignedDevice = toDeviceId;
    task.status = 'migrated';
    task.attempts.push({ deviceId: toDeviceId, startedAt: Date.now() });
    this.emit('task-migrated', { taskId, from: fromDeviceId, to: toDeviceId });
    return true;
  }

  // ============ 设备分组 ============

  addLabel(deviceId: string, label: string): void {
    const device = this.devices.get(deviceId);
    if (!device) return;
    if (!device.labels.includes(label)) {
      device.labels.push(label);
      if (this.config.persist) this.save();
    }
  }

  removeLabel(deviceId: string, label: string): void {
    const device = this.devices.get(deviceId);
    if (!device) return;
    device.labels = device.labels.filter((l) => l !== label);
    if (this.config.persist) this.save();
  }

  listByLabel(label: string): Device[] {
    return this.listDevices({ label });
  }

  listByRegion(region: string): Device[] {
    return this.listDevices({ region });
  }

  // ============ 统计 ============

  getStats(): {
    devices: { total: number; online: number; offline: number; degraded: number; byType: Record<DeviceType, number> };
    tasks: { total: number; pending: number; assigned: number; running: number; completed: number; failed: number; byType: Record<string, number> };
    failover: { total: number; byReason: Record<FailoverEvent['reason'], number> };
    commands: { total: number; byStatus: Record<RemoteCommand['status'], number> };
    heartbeats: { total: number; latest?: HeartbeatRecord };
  } {
    const deviceStats = {
      total: this.devices.size,
      online: 0,
      offline: 0,
      degraded: 0,
      byType: { desktop: 0, mobile: 0, server: 0, browser: 0, edge: 0 } as Record<DeviceType, number>,
    };
    for (const d of this.devices.values()) {
      if (d.status === 'online') deviceStats.online++;
      else if (d.status === 'offline') deviceStats.offline++;
      else if (d.status === 'degraded') deviceStats.degraded++;
      deviceStats.byType[d.type]++;
    }

    const taskStats = {
      total: this.tasks.size,
      pending: 0,
      assigned: 0,
      running: 0,
      completed: 0,
      failed: 0,
      byType: {} as Record<string, number>,
    };
    for (const t of this.tasks.values()) {
      if (t.status === 'pending') taskStats.pending++;
      else if (t.status === 'assigned') taskStats.assigned++;
      else if (t.status === 'running') taskStats.running++;
      else if (t.status === 'completed') taskStats.completed++;
      else if (t.status === 'failed') taskStats.failed++;
      taskStats.byType[t.type] = (taskStats.byType[t.type] || 0) + 1;
    }

    const failoverStats = {
      total: this.failoverHistory.length,
      byReason: { 'heartbeat-timeout': 0, 'device-failed': 0, 'device-overloaded': 0, manual: 0 } as Record<FailoverEvent['reason'], number>,
    };
    for (const f of this.failoverHistory) {
      failoverStats.byReason[f.reason]++;
    }

    const commandStats = {
      total: this.commands.size,
      byStatus: { pending: 0, acknowledged: 0, completed: 0, failed: 0 } as Record<RemoteCommand['status'], number>,
    };
    for (const c of this.commands.values()) {
      commandStats.byStatus[c.status]++;
    }

    return {
      devices: deviceStats,
      tasks: taskStats,
      failover: failoverStats,
      commands: commandStats,
      heartbeats: {
        total: this.heartbeatHistory.length,
        latest: this.heartbeatHistory[this.heartbeatHistory.length - 1],
      },
    };
  }

  // ============ 生命周期 ============

  start(): void {
    if (typeof setInterval !== 'undefined' && !this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => this.checkHeartbeats(), this.config.heartbeatIntervalMs);
    }
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.stopDiscovery();
  }

  // ============ 单例 ============

  private static defaultInstance: DeviceClusterEngine | null = null;

  static getDefault(): DeviceClusterEngine {
    if (!DeviceClusterEngine.defaultInstance) {
      DeviceClusterEngine.defaultInstance = new DeviceClusterEngine();
    }
    return DeviceClusterEngine.defaultInstance;
  }

  static resetDefault(): void {
    if (DeviceClusterEngine.defaultInstance) {
      DeviceClusterEngine.defaultInstance.stop();
    }
    DeviceClusterEngine.defaultInstance = null;
  }
}

export function getDefaultDeviceClusterEngine(): DeviceClusterEngine {
  return DeviceClusterEngine.getDefault();
}

export function resetDefaultDeviceClusterEngine(): void {
  DeviceClusterEngine.resetDefault();
}
