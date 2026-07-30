/**
 * # ============================================================
 * # Remote Control Engine - 远程控制引擎 (v1.0.0 Cycle 27 G27-06)
 * # ============================================================
 * # 核心作用：实现远程控制能力（QR 配对、Thread 迁移、远程命令、连接管理）
 * # 参考：Codex v0.130 Remote GA + TRAE SOLO Mobile 跨设备
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 27 G27-06 初次创建
 * # ============================================================
 */

import {
  DEFAULT_REMOTE_CONTROL_CONFIG,
  RemoteCommand,
  RemoteConnection,
  RemoteControlConfig,
  RemoteControlEvent,
  RemoteControlEventType,
  RemoteDevice,
  RemoteDevicePermission,
  RemoteDeviceStatus,
  RemotePairingSession,
  RemotePlatform,
  RemoteThreadHandoff,
  generateFingerprint,
  generatePairingId,
  generateShortCode,
  generateToken,
} from './remoteControlTypes';

/**
 * 远程控制引擎
 */
export class RemoteControlEngine {
  private config: RemoteControlConfig;
  private devices: Map<string, RemoteDevice> = new Map();
  private pairings: Map<string, RemotePairingSession> = new Map();
  private handoffs: Map<string, RemoteThreadHandoff> = new Map();
  private commands: Map<string, RemoteCommand> = new Map();
  private connections: Map<string, RemoteConnection> = new Map();
  private listeners: Map<RemoteControlEventType, Set<(e: RemoteControlEvent) => void>> = new Map();
  private storageKey = 'hermes.remoteControl';
  /** 模拟模式开关 */
  private mockMode: boolean = true;

  constructor(config: Partial<RemoteControlConfig> = {}) {
    this.config = { ...DEFAULT_REMOTE_CONTROL_CONFIG, ...config };
    if (this.config.persist) {
      this.load();
    }
    // 启动后台清理过期配对
    this.startExpirySweep();
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.devices)) {
        for (const d of data.devices) {
          this.devices.set(d.id, d);
        }
      }
      if (data && Array.isArray(data.pairings)) {
        for (const p of data.pairings) {
          this.pairings.set(p.id, p);
        }
      }
      if (data && Array.isArray(data.handoffs)) {
        for (const h of data.handoffs) {
          this.handoffs.set(h.id, h);
        }
      }
      if (data && Array.isArray(data.commands)) {
        for (const c of data.commands) {
          this.commands.set(c.id, c);
        }
      }
    } catch (e) {
      console.warn('RemoteControlEngine: failed to load', e);
    }
  }

  private save(): void {
    if (!this.config.persist) return;
    try {
      const data = {
        devices: Array.from(this.devices.values()),
        pairings: Array.from(this.pairings.values()),
        handoffs: Array.from(this.handoffs.values()),
        commands: Array.from(this.commands.values()).slice(-100), // 只保留最近 100 条
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
      }
    } catch (e) {
      console.warn('RemoteControlEngine: failed to save', e);
    }
  }

  // ============ 事件系统 ============

  on(event: RemoteControlEventType, listener: (e: RemoteControlEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: RemoteControlEventType, listener: (e: RemoteControlEvent) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: RemoteControlEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(event);
        } catch (err) {
          console.error('RemoteControlEngine: error in handler', err);
        }
      }
    }
  }

  // ============ 配对流程 ============

  /**
   * 启动配对会话
   */
  startPairing(options: {
    threadId?: string;
    permissions?: RemoteDevicePermission[];
  } = {}): RemotePairingSession {
    const id = generatePairingId();
    const now = Date.now();
    const shortCode = generateShortCode(this.config.shortCodeLength);
    const pairingUrl = `${this.config.wsEndpoint}/pair?code=${shortCode}&session=${id}`;
    const session: RemotePairingSession = {
      id,
      shortCode,
      pairingUrl,
      qrPayload: pairingUrl,
      createdAt: now,
      expiresAt: now + this.config.pairingExpiryMs,
      status: 'pending',
      threadId: options.threadId,
    };
    this.pairings.set(id, session);
    this.save();
    this.emit({
      type: 'pairing-started',
      timestamp: now,
      sessionId: id,
      data: { shortCode, expiresAt: session.expiresAt },
    });
    return session;
  }

  /**
   * 完成配对（模拟移动端扫描 QR 后提交）
   */
  async completePairing(
    sessionId: string,
    deviceInfo: {
      name: string;
      type: RemoteDevice['type'];
      platform: RemotePlatform;
    }
  ): Promise<RemoteDevice> {
    const session = this.pairings.get(sessionId);
    if (!session) throw new Error(`Pairing session not found: ${sessionId}`);
    if (session.status !== 'pending') {
      throw new Error(`Pairing session is ${session.status}`);
    }
    if (Date.now() > session.expiresAt) {
      session.status = 'expired';
      this.save();
      throw new Error('Pairing session expired');
    }

    // 模拟网络延迟
    await this.mockDelay();

    session.status = 'paired';
    session.deviceId = `dev-${Date.now().toString(36)}`;

    // 检查设备数量上限
    if (this.devices.size >= this.config.maxDevices) {
      throw new Error('Max devices limit reached');
    }

    // 创建设备
    const device: RemoteDevice = {
      id: session.deviceId,
      name: deviceInfo.name,
      type: deviceInfo.type,
      platform: deviceInfo.platform,
      status: 'paired',
      permissions: ['view-thread', 'send-message'],
      pairedAt: Date.now(),
      token: generateToken(),
      fingerprint: generateFingerprint(),
    };
    this.devices.set(device.id, device);
    this.save();

    this.emit({
      type: 'pairing-completed',
      timestamp: Date.now(),
      sessionId,
      deviceId: device.id,
      data: { name: device.name, platform: device.platform },
    });
    this.emit({
      type: 'device-paired',
      timestamp: Date.now(),
      deviceId: device.id,
    });

    return device;
  }

  /**
   * 模拟扫描（仅触发事件，便于 UI 演示）
   */
  markScanned(sessionId: string): void {
    const session = this.pairings.get(sessionId);
    if (!session) return;
    if (session.status !== 'pending') return;
    session.status = 'scanned';
    this.save();
    this.emit({
      type: 'pairing-scanned',
      timestamp: Date.now(),
      sessionId,
    });
  }

  /**
   * 取消配对
   */
  cancelPairing(sessionId: string): void {
    const session = this.pairings.get(sessionId);
    if (!session) return;
    if (session.status === 'paired' || session.status === 'expired') return;
    session.status = 'cancelled';
    this.save();
    this.emit({
      type: 'pairing-cancelled',
      timestamp: Date.now(),
      sessionId,
    });
  }

  // ============ 设备管理 ============

  /**
   * 列出所有设备
   */
  listDevices(filter?: { status?: RemoteDeviceStatus }): RemoteDevice[] {
    let result = Array.from(this.devices.values());
    if (filter?.status) {
      result = result.filter((d) => d.status === filter.status);
    }
    return result.sort((a, b) => b.pairedAt - a.pairedAt);
  }

  /**
   * 获取设备
   */
  getDevice(deviceId: string): RemoteDevice | undefined {
    return this.devices.get(deviceId);
  }

  /**
   * 更新设备权限
   */
  updateDevicePermissions(deviceId: string, permissions: RemoteDevicePermission[]): RemoteDevice {
    const d = this.devices.get(deviceId);
    if (!d) throw new Error(`Device not found: ${deviceId}`);
    const updated: RemoteDevice = { ...d, permissions };
    this.devices.set(deviceId, updated);
    this.save();
    return updated;
  }

  /**
   * 撤销设备
   */
  revokeDevice(deviceId: string): boolean {
    const d = this.devices.get(deviceId);
    if (!d) return false;
    const updated: RemoteDevice = { ...d, status: 'revoked' };
    this.devices.set(deviceId, updated);
    // 关闭连接
    for (const conn of this.connections.values()) {
      if (conn.deviceId === deviceId && conn.status === 'open') {
        conn.status = 'closed';
        conn.closedAt = Date.now();
      }
    }
    this.save();
    this.emit({
      type: 'device-revoked',
      timestamp: Date.now(),
      deviceId,
    });
    return true;
  }

  /**
   * 模拟设备连接
   */
  async simulateConnect(deviceId: string): Promise<RemoteConnection> {
    const d = this.devices.get(deviceId);
    if (!d) throw new Error(`Device not found: ${deviceId}`);
    if (d.status === 'revoked') throw new Error('Device has been revoked');

    await this.mockDelay();

    const conn: RemoteConnection = {
      id: 'conn-' + Date.now().toString(36),
      deviceId,
      status: 'open',
      protocol: this.mockMode ? 'mock' : 'websocket',
      startedAt: Date.now(),
      bytesSent: 0,
      bytesReceived: 0,
      messagesSent: 0,
      messagesReceived: 0,
    };
    this.connections.set(conn.id, conn);

    // 更新设备状态
    const updated: RemoteDevice = { ...d, status: 'connected', lastConnectedAt: Date.now() };
    this.devices.set(deviceId, updated);
    this.save();
    this.emit({
      type: 'connection-opened',
      timestamp: Date.now(),
      deviceId,
      data: { connectionId: conn.id },
    });
    this.emit({
      type: 'device-connected',
      timestamp: Date.now(),
      deviceId,
    });
    return conn;
  }

  /**
   * 模拟设备断开
   */
  async simulateDisconnect(deviceId: string): Promise<void> {
    const d = this.devices.get(deviceId);
    if (!d) return;
    await this.mockDelay();
    const updated: RemoteDevice = { ...d, status: 'disconnected' };
    this.devices.set(deviceId, updated);
    for (const conn of this.connections.values()) {
      if (conn.deviceId === deviceId && conn.status === 'open') {
        conn.status = 'closed';
        conn.closedAt = Date.now();
      }
    }
    this.save();
    this.emit({
      type: 'device-disconnected',
      timestamp: Date.now(),
      deviceId,
    });
  }

  // ============ Thread 迁移 ============

  /**
   * 启动 Thread 迁移
   */
  startHandoff(options: {
    fromDeviceId: string;
    toDeviceId?: string;
    threadId: string;
    threadName: string;
    messageCount: number;
    sizeBytes: number;
  }): RemoteThreadHandoff {
    const from = this.devices.get(options.fromDeviceId);
    if (!from) throw new Error(`Source device not found: ${options.fromDeviceId}`);
    if (options.toDeviceId) {
      const to = this.devices.get(options.toDeviceId);
      if (!to) throw new Error(`Target device not found: ${options.toDeviceId}`);
    }
    const handoff: RemoteThreadHandoff = {
      id: 'hof-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      fromDeviceId: options.fromDeviceId,
      toDeviceId: options.toDeviceId,
      threadId: options.threadId,
      threadName: options.threadName,
      messageCount: options.messageCount,
      sizeBytes: options.sizeBytes,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.handoffs.set(handoff.id, handoff);
    this.save();
    this.emit({
      type: 'handoff-started',
      timestamp: handoff.createdAt,
      deviceId: options.fromDeviceId,
      data: { handoffId: handoff.id, threadId: options.threadId },
    });
    return handoff;
  }

  /**
   * 执行迁移
   */
  async executeHandoff(handoffId: string): Promise<boolean> {
    const h = this.handoffs.get(handoffId);
    if (!h) return false;
    if (h.status !== 'pending') return false;
    h.status = 'in-progress';
    this.save();

    try {
      // 模拟分块传输
      const chunkCount = Math.max(1, Math.ceil(h.sizeBytes / 65536));
      for (let i = 0; i < chunkCount; i++) {
        await this.mockDelay(10, 30);
        if (this.shouldMockFail()) {
          throw new Error('Mock network failure');
        }
      }

      h.status = 'completed';
      h.completedAt = Date.now();
      this.save();
      this.emit({
        type: 'handoff-completed',
        timestamp: h.completedAt,
        deviceId: h.fromDeviceId,
        data: { handoffId, messageCount: h.messageCount },
      });
      return true;
    } catch (err) {
      h.status = 'failed';
      h.error = err instanceof Error ? err.message : String(err);
      h.completedAt = Date.now();
      this.save();
      this.emit({
        type: 'handoff-failed',
        timestamp: h.completedAt,
        deviceId: h.fromDeviceId,
        data: { handoffId, error: h.error },
      });
      return false;
    }
  }

  // ============ 远程命令 ============

  /**
   * 接收远程命令
   */
  receiveCommand(options: {
    deviceId: string;
    type: RemoteCommand['type'];
    payload: Record<string, unknown>;
  }): RemoteCommand {
    const d = this.devices.get(options.deviceId);
    if (!d) throw new Error(`Device not found: ${options.deviceId}`);
    // 权限校验
    if (options.type === 'approve-action' || options.type === 'reject-action') {
      if (!d.permissions.includes('approve-command')) {
        throw new Error('Device does not have approve-command permission');
      }
    }
    const cmd: RemoteCommand = {
      id: 'cmd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      deviceId: options.deviceId,
      type: options.type,
      payload: options.payload,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.commands.set(cmd.id, cmd);
    this.save();
    this.emit({
      type: 'command-received',
      timestamp: cmd.createdAt,
      deviceId: options.deviceId,
      data: { commandId: cmd.id, type: cmd.type },
    });
    return cmd;
  }

  /**
   * 确认命令
   */
  acknowledgeCommand(commandId: string): boolean {
    const cmd = this.commands.get(commandId);
    if (!cmd) return false;
    if (cmd.status !== 'pending') return false;
    cmd.status = 'acknowledged';
    this.save();
    this.emit({
      type: 'command-acknowledged',
      timestamp: Date.now(),
      deviceId: cmd.deviceId,
      data: { commandId },
    });
    return true;
  }

  /**
   * 标记命令完成
   */
  completeCommand(commandId: string, success: boolean = true): boolean {
    const cmd = this.commands.get(commandId);
    if (!cmd) return false;
    cmd.status = success ? 'completed' : 'failed';
    cmd.completedAt = Date.now();
    this.save();
    this.emit({
      type: success ? 'command-completed' : 'command-failed',
      timestamp: cmd.completedAt,
      deviceId: cmd.deviceId,
      data: { commandId },
    });
    return true;
  }

  /**
   * 列出命令
   */
  listCommands(filter?: { deviceId?: string; status?: RemoteCommand['status'] }): RemoteCommand[] {
    let result = Array.from(this.commands.values());
    if (filter?.deviceId) result = result.filter((c) => c.deviceId === filter.deviceId);
    if (filter?.status) result = result.filter((c) => c.status === filter.status);
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }

  // ============ 配对会话查询 ============

  /**
   * 获取配对会话
   */
  getPairing(sessionId: string): RemotePairingSession | undefined {
    return this.pairings.get(sessionId);
  }

  /**
   * 列出配对会话
   */
  listPairings(filter?: { status?: RemotePairingSession['status'] }): RemotePairingSession[] {
    let result = Array.from(this.pairings.values());
    if (filter?.status) result = result.filter((p) => p.status === filter.status);
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 列出迁移记录
   */
  listHandoffs(): RemoteThreadHandoff[] {
    return Array.from(this.handoffs.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  // ============ 工具方法 ============

  /**
   * 模拟网络延迟
   */
  private mockDelay(min?: number, max?: number): Promise<void> {
    const lo = min ?? this.config.latencyMinMs;
    const hi = max ?? this.config.latencyMaxMs;
    const ms = lo + Math.random() * (hi - lo);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 模拟失败判定
   */
  private shouldMockFail(): boolean {
    return this.mockMode && Math.random() < this.config.mockFailureRate;
  }

  /**
   * 启动后台过期清理
   */
  private startExpirySweep(): void {
    setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const p of this.pairings.values()) {
        if (p.status === 'pending' && now > p.expiresAt) {
          p.status = 'expired';
          changed = true;
          this.emit({
            type: 'pairing-expired',
            timestamp: now,
            sessionId: p.id,
          });
        }
      }
      if (changed) this.save();
    }, 30 * 1000);
  }

  /**
   * 设置 mock 模式
   */
  setMockMode(enabled: boolean): void {
    this.mockMode = enabled;
  }

  /**
   * 获取统计
   */
  getStats(): {
    totalDevices: number;
    activeDevices: number;
    pendingPairings: number;
    activeHandoffs: number;
    pendingCommands: number;
  } {
    return {
      totalDevices: this.devices.size,
      activeDevices: Array.from(this.devices.values()).filter(
        (d) => d.status === 'paired' || d.status === 'connected'
      ).length,
      pendingPairings: Array.from(this.pairings.values()).filter((p) => p.status === 'pending').length,
      activeHandoffs: Array.from(this.handoffs.values()).filter(
        (h) => h.status === 'pending' || h.status === 'in-progress'
      ).length,
      pendingCommands: Array.from(this.commands.values()).filter((c) => c.status === 'pending').length,
    };
  }

  /**
   * 清空（保留设备列表）
   */
  clear(): void {
    this.pairings.clear();
    this.handoffs.clear();
    this.commands.clear();
    this.connections.clear();
    this.save();
  }
}

// ============ 单例 ============

let defaultInstance: RemoteControlEngine | null = null;

export function getDefaultRemoteControlEngine(): RemoteControlEngine {
  if (!defaultInstance) {
    defaultInstance = new RemoteControlEngine();
  }
  return defaultInstance;
}

export function resetDefaultRemoteControlEngine(): void {
  if (defaultInstance) {
    defaultInstance.clear();
  }
  defaultInstance = null;
}
