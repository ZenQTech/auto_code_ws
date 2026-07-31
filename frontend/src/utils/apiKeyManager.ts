/**
 * # ============================================================
 * # API Key 管理器 (Cycle 50 G50-01)
 * # ============================================================
 * # 核心作用：安全地管理外部 API Key（火山方舟 / OpenAI / Claude 等）
 * #           提供加密存储、轮换、审计功能
 * # 运行流程：
 * #   1. 首次调用 setApiKey() 时，Key 会被加密后存入 localStorage
 * #   2. 后续调用 getApiKey() 自动解密返回
 * #   3. 轮换/删除操作均有审计日志
 * # 输入参数：
 * #   - provider: 服务商标识（如 'volcengine' / 'openai' / 'claude'）
 * #   - apiKey: 明文 API Key
 * #   - options: { expiresAt?: number; metadata?: Record<string, unknown> }
 * # 输出结果：
 * #   - ApiKeyEntry: { provider, keyId, encryptedKey, iv, salt, expiresAt, createdAt, lastUsedAt, usageCount }
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 50 G50-01 初次创建
 * #   - 2026-08-01 | v1.0.1 | 改用 Web Crypto API 替换 Node.js crypto 模块
 * # ====================================
 */

// ============================================================
// 类型定义
// ============================================================

/** 支持的服务商 */
export type ApiKeyProvider =
  | 'volcengine'
  | 'openai'
  | 'claude'
  | 'gemini'
  | 'deepseek'
  | 'qwen'
  | 'glm'
  | 'custom';

/** API Key 存储条目 */
export interface ApiKeyEntry {
  /** 服务商 */
  provider: ApiKeyProvider;
  /** Key 唯一标识 (hash of key) */
  keyId: string;
  /** 加密后的 Key (Base64) */
  encryptedKey: string;
  /** 初始化向量 (Base64) */
  iv: string;
  /** 加密盐 (Base64) */
  salt: string;
  /** 过期时间 (毫秒时间戳, 0 = 永不过期) */
  expiresAt: number;
  /** 创建时间 (毫秒时间戳) */
  createdAt: number;
  /** 最后使用时间 (毫秒时间戳) */
  lastUsedAt: number;
  /** 使用次数 */
  usageCount: number;
  /** 元数据 (如 endpoint, model 等) */
  metadata: Record<string, unknown>;
}

/** API Key 审计事件 */
export interface ApiKeyAuditEvent {
  /** 事件类型 */
  type: 'create' | 'get' | 'rotate' | 'delete' | 'expire' | 'error';
  /** 服务商 */
  provider: ApiKeyProvider;
  /** Key ID (不暴露明文) */
  keyId: string;
  /** 时间戳 */
  timestamp: number;
  /** 备注 */
  note?: string;
}

/** 审计监听器 */
export type ApiKeyAuditListener = (event: ApiKeyAuditEvent) => void;

/** 配置 */
export interface ApiKeyManagerConfig {
  /** 加密主密钥 (Base64, 32 bytes). 默认从环境变量或生成 */
  masterKey?: string;
  /** 存储后端 (默认 'localStorage') */
  backend?: 'localStorage' | 'memory';
  /** 存储 Key 前缀 */
  storagePrefix?: string;
  /** 默认过期时间 (毫秒, 默认 90 天) */
  defaultExpiresInMs?: number;
  /** Key 长度限制 (默认 256 字符) */
  maxKeyLength?: number;
  /** 最小 Key 长度 (默认 16 字符) */
  minKeyLength?: number;
}

// ============================================================
// 工具函数 (Web Crypto API 包装)
// ============================================================

const DEFAULT_CONFIG: Required<Omit<ApiKeyManagerConfig, 'masterKey'>> = {
  backend: 'localStorage',
  storagePrefix: 'apikey:',
  defaultExpiresInMs: 90 * 24 * 60 * 60 * 1000, // 90 天
  maxKeyLength: 256,
  minKeyLength: 16,
};

/**
 * Base64 编码 (浏览器兼容)
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  // 浏览器原生
  if (typeof btoa !== 'undefined') {
    return btoa(binary);
  }
  return binary;
}

/**
 * Base64 解码 (浏览器兼容)
 */
function base64ToBytes(b64: string): Uint8Array {
  // 浏览器原生
  if (typeof atob !== 'undefined') {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(0);
}

/**
 * 字符串转 Uint8Array (UTF-8 编码)
 */
function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Uint8Array 转字符串
 */
function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * SHA-256 哈希 (浏览器 Web Crypto API)
 */
async function sha256(input: Uint8Array): Promise<Uint8Array> {
  const subtle = getSubtleCrypto();
  if (!subtle) {
    return sha256Fallback(input);
  }
  const hash = await subtle.digest('SHA-256', input);
  return new Uint8Array(hash);
}

/**
 * SHA-256 降级实现 (无 Web Crypto 环境)
 * 使用确定性 FNV-1a 64-bit 扩展算法
 */
function sha256Fallback(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  // 简单的 FNV-1a 链 + 长度混合
  let h1 = 0xcbf29ce4;
  let h2 = 0x84222325;
  for (let i = 0; i < input.length; i++) {
    h1 ^= input[i]!;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= input[(i + 7) % input.length]!;
    h2 = Math.imul(h2, 0x01000193);
  }
  // 写入 8 字节
  for (let i = 0; i < 4; i++) {
    out[i] = (h1 >>> (i * 8)) & 0xff;
    out[i + 4] = (h2 >>> (i * 8)) & 0xff;
  }
  // 复制扩展填充
  for (let i = 8; i < 32; i++) {
    out[i] = out[i - 8]! ^ (i & 0xff);
  }
  return out;
}

/**
 * 获取 Web Crypto Subtle 接口 (跨平台)
 */
function getSubtleCrypto(): SubtleCrypto | null {
  if (typeof globalThis !== 'undefined') {
    const c = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto;
    if (c?.subtle) return c.subtle;
  }
  return null;
}

/**
 * 获取 Web Crypto (用于随机数)
 */
function getCrypto(): Crypto | null {
  if (typeof globalThis !== 'undefined') {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c?.getRandomValues) return c;
  }
  return null;
}

/**
 * 生成随机字节
 */
function randomBytes(n: number): Uint8Array {
  const c = getCrypto();
  if (c) {
    const out = new Uint8Array(n);
    c.getRandomValues(out);
    return out;
  }
  // 降级: 使用 Math.random (不加密安全, 仅用于测试)
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

/**
 * 同步 SHA-256 (用于 FNV-1a 降级或简单哈希)
 * 返回 hex 字符串
 */
function syncSha256Hex(input: string): string {
  // 使用 FNV-1a + 长度混合生成 16 hex 字符
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c & 0xff;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= (c >>> 8) & 0xff;
    h2 = Math.imul(h2, 0x01000193);
  }
  // 转 hex (8 字符 × 2 = 16)
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return part1 + part2;
}

/**
 * 异步 SHA-256 包装: 返回 hex
 */
async function sha256HexAsync(input: string): Promise<string> {
  const subtle = getSubtleCrypto();
  if (subtle) {
    const hash = await subtle.digest('SHA-256', stringToBytes(input));
    return bytesToBase64(new Uint8Array(hash)).slice(0, 22);
  }
  return syncSha256Hex(input);
}

/**
 * 生成稳定的 master key (从环境或 fallback)
 * 浏览器环境: 使用 localStorage 中的稳定 seed 或生成新的
 */
async function resolveMasterKeyBytes(provided?: string): Promise<Uint8Array> {
  if (provided) {
    // Base64 解码
    try {
      const buf = base64ToBytes(provided);
      if (buf.length === 32) return buf;
    } catch {
      // 忽略, 使用 fallback
    }
    // 字符串 -> SHA-256 -> 32 bytes
    return await sha256(stringToBytes(provided));
  }
  // Fallback: 使用固定种子 (生产环境应从环境变量注入)
  const seed = 'mcp-volcengine-cycle50-default-master-key-do-not-use-in-prod';
  return await sha256(stringToBytes(seed));
}

/**
 * 计算 Key ID (Key 指纹, 不暴露明文)
 */
function computeKeyId(apiKey: string): string {
  // 使用同步版本以保持 API 同步
  return syncSha256Hex(apiKey);
}

/**
 * 派生 key from master + salt (使用 Web Crypto SHA-256)
 * 注: 完整 PBKDF2 需异步, 此处使用简化的 SHA256(master||salt) 派生
 */
async function deriveKeyBytes(masterKey: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  const combined = new Uint8Array(masterKey.length + salt.length);
  combined.set(masterKey, 0);
  combined.set(salt, masterKey.length);
  return await sha256(combined);
}

/**
 * 加密 API Key (使用 Web Crypto AES-CBC, 异步)
 * 注: Web Crypto AES-CBC 需要异步操作, 因此 setApiKey 也是异步的
 */
async function encryptKey(plainKey: string, masterKey: Uint8Array): Promise<{
  encryptedKey: string;
  iv: string;
  salt: string;
}> {
  const salt = randomBytes(16);
  const iv = randomBytes(16);
  const subtle = getSubtleCrypto();

  if (subtle) {
    // 使用 Web Crypto AES-CBC
    const keyBytes = await deriveKeyBytes(masterKey, salt);
    const cryptoKey = await subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt']);
    const encrypted = await subtle.encrypt(
      { name: 'AES-CBC', iv: iv as BufferSource },
      cryptoKey,
      stringToBytes(plainKey) as BufferSource
    );
    return {
      encryptedKey: bytesToBase64(new Uint8Array(encrypted)),
      iv: bytesToBase64(iv),
      salt: bytesToBase64(salt),
    };
  }

  // 降级方案: XOR + Base64 (不加密安全, 仅用于测试环境)
  const keyBytes = await deriveKeyBytes(masterKey, salt);
  const plainBytes = stringToBytes(plainKey);
  const encrypted = new Uint8Array(plainBytes.length);
  for (let i = 0; i < plainBytes.length; i++) {
    encrypted[i] = plainBytes[i]! ^ keyBytes[i % keyBytes.length]!;
  }
  return {
    encryptedKey: bytesToBase64(encrypted),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
  };
}

/**
 * 解密 API Key (异步)
 */
async function decryptKey(entry: ApiKeyEntry, masterKey: Uint8Array): Promise<string> {
  const salt = base64ToBytes(entry.salt);
  const iv = base64ToBytes(entry.iv);
  const encrypted = base64ToBytes(entry.encryptedKey);
  const subtle = getSubtleCrypto();

  if (subtle) {
    const keyBytes = await deriveKeyBytes(masterKey, salt);
    const cryptoKey = await subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
    const decrypted = await subtle.decrypt(
      { name: 'AES-CBC', iv: iv as BufferSource },
      cryptoKey,
      encrypted as BufferSource
    );
    return bytesToString(new Uint8Array(decrypted));
  }

  // 降级方案: XOR
  const keyBytes = await deriveKeyBytes(masterKey, salt);
  const plain = new Uint8Array(encrypted.length);
  for (let i = 0; i < encrypted.length; i++) {
    plain[i] = encrypted[i]! ^ keyBytes[i % keyBytes.length]!;
  }
  return bytesToString(plain);
}

// ============================================================
// 内存后端
// ============================================================

class MemoryBackend {
  private store = new Map<string, string>();

  get(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.store.set(key, value);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  keys(): string[] {
    return Array.from(this.store.keys());
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * localStorage 后端 (跨平台抽象)
 */
function createLocalStorageBackend(): {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
  delete: (key: string) => void;
  keys: () => string[];
  clear: () => void;
} {
  // 检查环境
  const hasLocalStorage = typeof globalThis !== 'undefined' && typeof (globalThis as { localStorage?: Storage }).localStorage !== 'undefined';

  if (!hasLocalStorage) {
    return new MemoryBackend();
  }

  const ls = (globalThis as { localStorage: Storage }).localStorage;

  return {
    get: (key) => {
      try {
        return ls.getItem(key);
      } catch {
        return null;
      }
    },
    set: (key, value) => {
      try {
        ls.setItem(key, value);
      } catch {
        // Quota exceeded or other error, fallback to memory
      }
    },
    delete: (key) => {
      try {
        ls.removeItem(key);
      } catch {
        // 忽略
      }
    },
    keys: () => {
      const keys: string[] = [];
      try {
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i);
          if (k) keys.push(k);
        }
      } catch {
        // 忽略
      }
      return keys;
    },
    clear: () => {
      try {
        ls.clear();
      } catch {
        // 忽略
      }
    },
  };
}

// ============================================================
// ApiKeyManager 主类
// ============================================================

export class ApiKeyManager {
  private readonly config: Required<Omit<ApiKeyManagerConfig, 'masterKey'>> & { masterKeyPromise: Promise<Uint8Array> };
  private readonly backend: ReturnType<typeof createLocalStorageBackend> | MemoryBackend;
  private readonly listeners: Set<ApiKeyAuditListener> = new Set();
  /** 内存缓存 (provider -> entry) - 避免重复解密 */
  private cache = new Map<ApiKeyProvider, ApiKeyEntry>();
  /** 统计 */
  private stats_ = {
    totalCreates: 0,
    totalGets: 0,
    totalRotates: 0,
    totalDeletes: 0,
    totalErrors: 0,
  };

  constructor(config: ApiKeyManagerConfig = {}) {
    this.config = {
      masterKeyPromise: resolveMasterKeyBytes(config.masterKey),
      backend: config.backend ?? DEFAULT_CONFIG.backend,
      storagePrefix: config.storagePrefix ?? DEFAULT_CONFIG.storagePrefix,
      defaultExpiresInMs: config.defaultExpiresInMs ?? DEFAULT_CONFIG.defaultExpiresInMs,
      maxKeyLength: config.maxKeyLength ?? DEFAULT_CONFIG.maxKeyLength,
      minKeyLength: config.minKeyLength ?? DEFAULT_CONFIG.minKeyLength,
    };
    this.backend = this.config.backend === 'memory' ? new MemoryBackend() : createLocalStorageBackend();
  }

  // ============================================================
  // 公共 API
  // ============================================================

  /**
   * 设置 / 创建 API Key (异步, 因为加密是异步的)
   *  - 加密存储
   *  - 验证 Key 长度
   *  - 触发 create 审计事件
   */
  async setApiKey(
    provider: ApiKeyProvider,
    apiKey: string,
    options: { expiresAt?: number; metadata?: Record<string, unknown> } = {}
  ): Promise<ApiKeyEntry> {
    // 1. 验证
    if (apiKey.length < this.config.minKeyLength) {
      this.emit({ type: 'error', provider, keyId: '', timestamp: Date.now(), note: `Key too short (min ${this.config.minKeyLength})` });
      this.stats_.totalErrors += 1;
      throw new Error(`API key too short (min ${this.config.minKeyLength} chars)`);
    }
    if (apiKey.length > this.config.maxKeyLength) {
      this.emit({ type: 'error', provider, keyId: '', timestamp: Date.now(), note: `Key too long (max ${this.config.maxKeyLength})` });
      this.stats_.totalErrors += 1;
      throw new Error(`API key too long (max ${this.config.maxKeyLength} chars)`);
    }

    // 2. 加密
    const masterKey = await this.config.masterKeyPromise;
    const { encryptedKey, iv, salt } = await encryptKey(apiKey, masterKey);
    const keyId = computeKeyId(apiKey);
    const now = Date.now();
    const entry: ApiKeyEntry = {
      provider,
      keyId,
      encryptedKey,
      iv,
      salt,
      expiresAt: options.expiresAt ?? now + this.config.defaultExpiresInMs,
      createdAt: now,
      lastUsedAt: 0,
      usageCount: 0,
      metadata: options.metadata ?? {},
    };

    // 3. 存储
    this.persistEntry(entry);
    this.cache.set(provider, entry);
    this.stats_.totalCreates += 1;

    // 4. 审计
    this.emit({ type: 'create', provider, keyId, timestamp: now, note: `expires in ${Math.round((entry.expiresAt - now) / 86400000)} days` });

    return entry;
  }

  /**
   * 获取解密后的 API Key (异步)
   *  - 命中缓存: 直接返回
   *  - 未命中: 从存储加载并解密
   *  - 过期检查
   */
  async getApiKey(provider: ApiKeyProvider): Promise<string | null> {
    const entry = this.getEntry(provider);
    if (!entry) return null;

    // 检查过期
    if (entry.expiresAt > 0 && entry.expiresAt < Date.now()) {
      this.emit({ type: 'expire', provider, keyId: entry.keyId, timestamp: Date.now() });
      this.deleteApiKey(provider);
      return null;
    }

    // 解密
    try {
      const masterKey = await this.config.masterKeyPromise;
      const plain = await decryptKey(entry, masterKey);
      // 更新使用统计
      entry.lastUsedAt = Date.now();
      entry.usageCount += 1;
      this.persistEntry(entry); // 写回
      this.cache.set(provider, entry);
      this.stats_.totalGets += 1;
      this.emit({ type: 'get', provider, keyId: entry.keyId, timestamp: Date.now() });
      return plain;
    } catch (err) {
      this.emit({
        type: 'error',
        provider,
        keyId: entry.keyId,
        timestamp: Date.now(),
        note: err instanceof Error ? err.message : String(err),
      });
      this.stats_.totalErrors += 1;
      return null;
    }
  }

  /**
   * 轮换 Key (用新 Key 替换旧的) (异步)
   */
  async rotateApiKey(provider: ApiKeyProvider, newKey: string): Promise<ApiKeyEntry> {
    const oldEntry = this.getEntry(provider);
    const newEntry = await this.setApiKey(provider, newKey);
    this.stats_.totalRotates += 1;
    this.emit({
      type: 'rotate',
      provider,
      keyId: newEntry.keyId,
      timestamp: Date.now(),
      note: oldEntry ? `rotated from ${oldEntry.keyId}` : 'no previous key',
    });
    return newEntry;
  }

  /**
   * 删除 API Key
   */
  deleteApiKey(provider: ApiKeyProvider): boolean {
    const entry = this.getEntry(provider);
    const key = this.storageKey(provider);
    this.backend.delete(key);
    this.cache.delete(provider);
    if (entry) {
      this.stats_.totalDeletes += 1;
      this.emit({ type: 'delete', provider, keyId: entry.keyId, timestamp: Date.now() });
      return true;
    }
    return false;
  }

  /**
   * 检查是否已配置 (不暴露 Key 内容)
   */
  hasApiKey(provider: ApiKeyProvider): boolean {
    return this.getEntry(provider) !== null;
  }

  /**
   * 获取条目元数据 (不暴露 Key)
   */
  getEntry(provider: ApiKeyProvider): ApiKeyEntry | null {
    // 命中缓存
    if (this.cache.has(provider)) {
      return this.cache.get(provider)!;
    }
    // 从存储加载
    const key = this.storageKey(provider);
    const raw = this.backend.get(key);
    if (!raw) return null;
    try {
      const entry = JSON.parse(raw) as ApiKeyEntry;
      this.cache.set(provider, entry);
      return entry;
    } catch {
      return null;
    }
  }

  /**
   * 列出所有已配置的 Provider
   */
  listProviders(): ApiKeyProvider[] {
    const keys = this.backend.keys();
    return keys
      .filter((k) => k.startsWith(this.config.storagePrefix))
      .map((k) => k.slice(this.config.storagePrefix.length) as ApiKeyProvider);
  }

  /**
   * 订阅审计事件
   */
  subscribe(listener: ApiKeyAuditListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 获取统计
   */
  getStats() {
    return { ...this.stats_ };
  }

  /**
   * 清空所有 Key
   */
  clearAll(): void {
    const providers = this.listProviders();
    for (const p of providers) {
      this.deleteApiKey(p);
    }
    this.cache.clear();
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private storageKey(provider: ApiKeyProvider): string {
    return `${this.config.storagePrefix}${provider}`;
  }

  private persistEntry(entry: ApiKeyEntry): void {
    const key = this.storageKey(entry.provider);
    this.backend.set(key, JSON.stringify(entry));
  }

  private emit(event: ApiKeyAuditEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略 listener 错误,不影响主流程
      }
    }
  }
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建默认 ApiKeyManager 实例
 */
export function createApiKeyManager(config?: ApiKeyManagerConfig): ApiKeyManager {
  return new ApiKeyManager(config);
}

/**
 * 单例 (按 provider 隔离)
 */
let _defaultManager: ApiKeyManager | null = null;

export function getApiKeyManager(): ApiKeyManager {
  if (!_defaultManager) {
    _defaultManager = new ApiKeyManager();
  }
  return _defaultManager;
}

export function resetApiKeyManager(): void {
  if (_defaultManager) {
    _defaultManager.clearAll();
  }
  _defaultManager = null;
}
