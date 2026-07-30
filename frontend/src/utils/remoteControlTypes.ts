/**
 * # ============================================================
 * # Remote Control Types - 远程控制类型 (v1.0.0 Cycle 27 G27-06)
 * # ============================================================
 * # 核心作用：定义远程控制（设备配对/QR 配对/Thread 迁移）的类型
 * # 参考：Codex v0.130 Remote GA + TRAE SOLO Mobile 跨设备配对
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 27 G27-06 初次创建
 * # ============================================================
 */

/**
 * 设备类型
 */
export type RemoteDeviceType = 'desktop' | 'mobile' | 'tablet' | 'web' | 'server';

/**
 * 设备平台
 */
export type RemotePlatform = 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'web';

/**
 * 设备状态
 */
export type RemoteDeviceStatus = 'pending' | 'paired' | 'connected' | 'disconnected' | 'revoked';

/**
 * 设备权限
 */
export type RemoteDevicePermission =
  | 'view-thread' // 查看 thread
  | 'send-message' // 发送消息
  | 'approve-command' // 批准命令
  | 'view-checkpoint' // 查看 checkpoint
  | 'full-control'; // 完全控制

/**
 * 远程设备
 */
export interface RemoteDevice {
  id: string;
  name: string;
  type: RemoteDeviceType;
  platform: RemotePlatform;
  status: RemoteDeviceStatus;
  permissions: RemoteDevicePermission[];
  pairedAt: number;
  lastConnectedAt?: number;
  ipAddress?: string;
  userAgent?: string;
  /** 配对令牌（用于 mock WebSocket 鉴权） */
  token: string;
  /** 公钥指纹（mock） */
  fingerprint: string;
}

/**
 * 配对会话（QR 码扫描的临时会话）
 */
export interface RemotePairingSession {
  id: string;
  /** 6 位短码（用户友好） */
  shortCode: string;
  /** 完整配对 URL */
  pairingUrl: string;
  /** Base64 QR 内容（mock - 用 canvas 渲染时实际生成） */
  qrPayload: string;
  /** 创建时间 */
  createdAt: number;
  /** 过期时间 */
  expiresAt: number;
  /** 状态 */
  status: 'pending' | 'scanned' | 'paired' | 'expired' | 'cancelled';
  /** 配对成功后关联的设备 */
  deviceId?: string;
  /** 关联的 Thread ID（可选，仅 thread 迁移用） */
  threadId?: string;
}

/**
 * Thread 迁移请求
 */
export interface RemoteThreadHandoff {
  id: string;
  fromDeviceId: string;
  toDeviceId?: string;
  threadId: string;
  threadName: string;
  messageCount: number;
  sizeBytes: number;
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  completedAt?: number;
  error?: string;
}

/**
 * 远程命令（来自移动端的审批/操作）
 */
export interface RemoteCommand {
  id: string;
  deviceId: string;
  type:
    | 'pause-thread'
    | 'resume-thread'
    | 'cancel-thread'
    | 'approve-action'
    | 'reject-action'
    | 'view-checkpoint'
    | 'request-status';
  payload: Record<string, unknown>;
  status: 'pending' | 'sent' | 'acknowledged' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
}

/**
 * 远程连接状态
 */
export interface RemoteConnection {
  id: string;
  deviceId: string;
  status: 'connecting' | 'open' | 'closed' | 'error';
  protocol: 'websocket' | 'sse' | 'mock';
  startedAt: number;
  closedAt?: number;
  bytesSent: number;
  bytesReceived: number;
  messagesSent: number;
  messagesReceived: number;
}

/**
 * 远程控制配置
 */
export interface RemoteControlConfig {
  /** WebSocket 端点（mock URL） */
  wsEndpoint: string;
  /** 配对码有效期（ms） */
  pairingExpiryMs: number;
  /** 短码长度 */
  shortCodeLength: number;
  /** 最大配对设备数 */
  maxDevices: number;
  /** 持久化 */
  persist: boolean;
  /** 模拟网络延迟范围（ms） */
  latencyMinMs: number;
  latencyMaxMs: number;
  /** 模拟失败率（0-1） */
  mockFailureRate: number;
}

/**
 * 事件类型
 */
export type RemoteControlEventType =
  | 'pairing-started'
  | 'pairing-scanned'
  | 'pairing-completed'
  | 'pairing-expired'
  | 'pairing-cancelled'
  | 'device-paired'
  | 'device-connected'
  | 'device-disconnected'
  | 'device-revoked'
  | 'command-received'
  | 'command-acknowledged'
  | 'command-completed'
  | 'command-failed'
  | 'handoff-started'
  | 'handoff-completed'
  | 'handoff-failed'
  | 'connection-opened'
  | 'connection-closed';

/**
 * 事件
 */
export interface RemoteControlEvent {
  type: RemoteControlEventType;
  timestamp: number;
  deviceId?: string;
  sessionId?: string;
  data?: Record<string, unknown>;
}

/**
 * 默认配置
 */
export const DEFAULT_REMOTE_CONTROL_CONFIG: RemoteControlConfig = {
  wsEndpoint: 'wss://remote.hermes.local/mock',
  pairingExpiryMs: 5 * 60 * 1000, // 5 分钟
  shortCodeLength: 6,
  maxDevices: 10,
  persist: true,
  latencyMinMs: 50,
  latencyMaxMs: 200,
  mockFailureRate: 0,
};

/**
 * 设备类型元数据
 */
export const DEVICE_TYPE_METADATA: Record<RemoteDeviceType, { label: string; icon: string }> = {
  desktop: { label: '桌面', icon: '🖥️' },
  mobile: { label: '手机', icon: '📱' },
  tablet: { label: '平板', icon: '📱' },
  web: { label: 'Web', icon: '🌐' },
  server: { label: '服务器', icon: '🗄️' },
};

export const PLATFORM_METADATA: Record<RemotePlatform, { label: string; icon: string }> = {
  ios: { label: 'iOS', icon: '🍎' },
  android: { label: 'Android', icon: '🤖' },
  macos: { label: 'macOS', icon: '💻' },
  windows: { label: 'Windows', icon: '🪟' },
  linux: { label: 'Linux', icon: '🐧' },
  web: { label: 'Web', icon: '🌐' },
};

export const DEVICE_STATUS_METADATA: Record<RemoteDeviceStatus, { label: string; color: string }> = {
  pending: { label: '待配对', color: 'text-yellow-500' },
  paired: { label: '已配对', color: 'text-blue-500' },
  connected: { label: '已连接', color: 'text-green-500' },
  disconnected: { label: '已断开', color: 'text-slate-500' },
  revoked: { label: '已撤销', color: 'text-red-500' },
};

export const PERMISSION_METADATA: Record<RemoteDevicePermission, { label: string; icon: string; risk: 'low' | 'medium' | 'high' }> = {
  'view-thread': { label: '查看 Thread', icon: '👁️', risk: 'low' },
  'send-message': { label: '发送消息', icon: '💬', risk: 'medium' },
  'approve-command': { label: '批准命令', icon: '✅', risk: 'high' },
  'view-checkpoint': { label: '查看 Checkpoint', icon: '📸', risk: 'low' },
  'full-control': { label: '完全控制', icon: '🔓', risk: 'high' },
};

/**
 * 生成配对 ID
 */
export function generatePairingId(): string {
  return 'pair-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * 生成设备 ID
 */
export function generateDeviceId(): string {
  return 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * 生成短码（数字字母，排除容易混淆的字符）
 */
export function generateShortCode(length: number = 6): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[Math.floor(Math.random() * charset.length)];
  }
  return result;
}

/**
 * 生成配对 token
 */
export function generateToken(): string {
  return 'tok-' + Math.random().toString(36).slice(2, 18) + Math.random().toString(36).slice(2, 18);
}

/**
 * 生成公钥指纹（mock）
 */
export function generateFingerprint(): string {
  const chars = '0123456789ABCDEF';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
    if (i > 0 && i % 4 === 3) result += ':';
  }
  return result.slice(0, 23);
}
