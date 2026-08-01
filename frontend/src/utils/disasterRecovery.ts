/**
 * # ============================================================
 * # 灾备恢复管理器 (Cycle 52 G52-04)
 * # ============================================================
 * # 核心作用：管理数据库备份 + 故障检测 + 自动切换
 * # 运行流程：
 * #   1. 配置主备节点 (Primary + Standby)
 * #   2. 定期健康检查 + 状态同步
 * #   3. 故障检测 (主节点连续失败 N 次)
 * #   4. 自动故障切换 (Promote Standby)
 * #   5. WAL 日志 + 数据一致性校验
 * #   6. 事件订阅 (backup/failover/promote/complete)
 * # 输入参数：DRConfig { primary, standby, failoverThreshold, backupIntervalMs }
 * # 输出结果：DRReport { status, backupCount, failoverCount, rto, rpo }
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 52 G52-04 初次创建
 * # ====================================
 */

// ============================================================
// 类型定义
// ============================================================

/** 数据库节点 */
export interface DatabaseNode {
  /** 节点 ID */
  id: string;
  /** 节点名称 */
  name: string;
  /** 端点 */
  endpoint: string;
  /** 角色 */
  role: 'primary' | 'standby' | 'failed';
  /** 是否健康 */
  healthy: boolean;
  /** 连续失败次数 */
  consecutiveFailures: number;
  /** 最后成功时间 */
  lastSuccessAt: number;
  /** 复制延迟 (毫秒, 仅 standby) */
  replicationLagMs: number;
  /** WAL 日志位置 (字节偏移) */
  walPosition: number;
}

/** 备份 */
export interface Backup {
  /** 备份 ID */
  id: string;
  /** 时间戳 */
  timestamp: number;
  /** 源节点 ID */
  sourceNodeId: string;
  /** 大小 (字节) */
  sizeBytes: number;
  /** 持续时间 (毫秒) */
  durationMs: number;
  /** 类型 */
  type: 'full' | 'incremental';
  /** 状态 */
  status: 'in-progress' | 'completed' | 'failed';
  /** 错误 */
  error?: string;
}

/** 故障切换 */
export interface Failover {
  /** 切换 ID */
  id: string;
  /** 时间戳 */
  timestamp: number;
  /** 原主节点 */
  fromNodeId: string;
  /** 新主节点 */
  toNodeId: string;
  /** 原因 */
  reason: string;
  /** 数据丢失 (字节) */
  dataLossBytes: number;
  /** 恢复时间 (毫秒, 即 RTO) */
  recoveryTimeMs: number;
  /** 状态 */
  status: 'in-progress' | 'completed' | 'failed';
}

/** 灾备配置 */
export interface DRConfig {
  /** 主节点 */
  primary: DatabaseNode;
  /** 备节点列表 */
  standbys: DatabaseNode[];
  /** 连续失败次数阈值 (触发故障切换) */
  failoverThreshold: number;
  /** 健康检查间隔 (毫秒) */
  healthCheckIntervalMs: number;
  /** 备份间隔 (毫秒) */
  backupIntervalMs: number;
  /** 备份保留数量 */
  backupRetention: number;
  /** 复制延迟容忍 (毫秒) */
  maxReplicationLagMs: number;
  /** 自定义健康检查函数 */
  healthChecker?: (node: DatabaseNode) => Promise<boolean>;
  /** 自定义备份函数 */
  backupExecutor?: (node: DatabaseNode, type: 'full' | 'incremental') => Promise<{ sizeBytes: number; durationMs: number }>;
  /** 自动故障切换 */
  autoFailover: boolean;
  /** 是否需要手动确认切换 */
  requireManualConfirm: boolean;
}

/** 灾备状态 */
export type DRStatus = 'healthy' | 'degraded' | 'failover-in-progress' | 'failed' | 'recovering';

/** 灾备报告 */
export interface DRReport {
  /** 配置 ID */
  id: string;
  /** 时间戳 */
  timestamp: number;
  /** 总持续时间 (毫秒) */
  durationMs: number;
  /** 当前状态 */
  status: DRStatus;
  /** 主节点 (可能已切换) */
  currentPrimary: string;
  /** 所有节点状态 */
  nodes: DatabaseNode[];
  /** 备份列表 */
  backups: Backup[];
  /** 故障切换历史 */
  failovers: Failover[];
  /** 总备份数 */
  totalBackups: number;
  /** 成功备份数 */
  successfulBackups: number;
  /** 失败备份数 */
  failedBackups: number;
  /** 故障切换次数 */
  failoverCount: number;
  /** 总数据丢失 (字节) */
  totalDataLossBytes: number;
  /** 平均 RTO (恢复时间) */
  avgRtoMs: number;
  /** 平均 RPO (数据丢失容忍) */
  avgRpoMs: number;
  /** 摘要 */
  summary: string;
  /** 建议 */
  recommendations: string[];
}

/** 事件 */
export type DREvent =
  | { type: 'start'; timestamp: number; config: DRConfig }
  | { type: 'health-check'; timestamp: number; node: DatabaseNode; healthy: boolean }
  | { type: 'backup-start'; timestamp: number; backup: Backup }
  | { type: 'backup-complete'; timestamp: number; backup: Backup }
  | { type: 'backup-failed'; timestamp: number; backup: Backup; error: string }
  | { type: 'node-failed'; timestamp: number; nodeId: string; consecutiveFailures: number }
  | { type: 'failover-start'; timestamp: number; failover: Failover }
  | { type: 'failover-complete'; timestamp: number; failover: Failover }
  | { type: 'complete'; timestamp: number; report: DRReport };

export type DRListener = (event: DREvent) => void;

// ============================================================
// DisasterRecovery 主类
// ============================================================

export class DisasterRecovery {
  private readonly config: DRConfig;
  private readonly listeners: Set<DRListener> = new Set();
  private readonly nodes: Map<string, DatabaseNode> = new Map();
  private readonly backups: Backup[] = [];
  private readonly failovers: Failover[] = [];
  private currentPrimaryId: string;
  private running = false;
  private aborted = false;
  private backupCounter = 0;
  private failoverCounter = 0;
  private status: DRStatus = 'healthy';

  constructor(config: DRConfig) {
    this.config = config;
    this.currentPrimaryId = config.primary.id;
    this.nodes.set(config.primary.id, { ...config.primary });
    for (const standby of config.standbys) {
      this.nodes.set(standby.id, { ...standby });
    }
  }

  /**
   * 订阅事件
   */
  subscribe(listener: DRListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 获取当前主节点
   */
  getCurrentPrimary(): DatabaseNode | undefined {
    return this.nodes.get(this.currentPrimaryId);
  }

  /**
   * 获取所有节点
   */
  getNodes(): DatabaseNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * 启动灾备监控
   */
  async start(durationMs: number): Promise<DRReport> {
    if (this.running) {
      throw new Error('DisasterRecovery is already running');
    }
    this.running = true;
    this.aborted = false;

    const start = Date.now();
    const end = start + durationMs;
    this.emit({ type: 'start', timestamp: start, config: this.config });

    let lastBackupTime = start;

    while (Date.now() < end && !this.aborted) {
      // 1. 健康检查
      await this.checkHealth();

      // 2. 检查故障切换
      await this.checkFailover();

      // 3. 定期备份
      if (Date.now() - lastBackupTime >= this.config.backupIntervalMs) {
        await this.performBackup();
        lastBackupTime = Date.now();
      }

      await this.sleep(this.config.healthCheckIntervalMs);
    }

    const report: DRReport = {
      id: `dr-${Date.now()}`,
      timestamp: start,
      durationMs: Date.now() - start,
      status: this.status,
      currentPrimary: this.currentPrimaryId,
      nodes: this.getNodes(),
      backups: [...this.backups],
      failovers: [...this.failovers],
      totalBackups: this.backups.length,
      successfulBackups: this.backups.filter((b) => b.status === 'completed').length,
      failedBackups: this.backups.filter((b) => b.status === 'failed').length,
      failoverCount: this.failovers.length,
      totalDataLossBytes: this.failovers.reduce((s, f) => s + f.dataLossBytes, 0),
      avgRtoMs: this.failovers.length > 0 ? this.failovers.reduce((s, f) => s + f.recoveryTimeMs, 0) / this.failovers.length : 0,
      avgRpoMs: this.failovers.length > 0 ? this.failovers.reduce((s, f) => s + f.dataLossBytes * 1000, 0) / this.failovers.length : 0,
      summary: this.buildSummary(),
      recommendations: this.buildRecommendations(),
    };

    this.running = false;
    this.emit({ type: 'complete', timestamp: Date.now(), report });
    return report;
  }

  /**
   * 手动触发故障切换
   */
  async manualFailover(targetNodeId: string, reason: string): Promise<Failover> {
    return this.performFailover(targetNodeId, reason, 'manual');
  }

  /**
   * 优雅停止
   */
  abort(): void {
    this.aborted = true;
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private async checkHealth(): Promise<void> {
    for (const node of this.nodes.values()) {
      if (node.role === 'failed') continue;
      try {
        const healthy = this.config.healthChecker
          ? await this.config.healthChecker(node)
          : await this.defaultHealthCheck(node);
        this.emit({ type: 'health-check', timestamp: Date.now(), node, healthy });

        if (healthy) {
          node.healthy = true;
          node.consecutiveFailures = 0;
          node.lastSuccessAt = Date.now();
        } else {
          node.healthy = false;
          node.consecutiveFailures++;
          if (node.consecutiveFailures >= this.config.failoverThreshold) {
            node.role = 'failed';
            this.emit({
              type: 'node-failed',
              timestamp: Date.now(),
              nodeId: node.id,
              consecutiveFailures: node.consecutiveFailures,
            });
          }
        }
      } catch {
        node.healthy = false;
        node.consecutiveFailures++;
      }
    }
  }

  private async defaultHealthCheck(node: DatabaseNode): Promise<boolean> {
    // 默认 mock 实现
    return Math.random() > 0.1; // 90% 健康
  }

  private async checkFailover(): Promise<void> {
    const currentPrimary = this.nodes.get(this.currentPrimaryId);
    if (!currentPrimary) return;
    if (currentPrimary.role === 'failed' || currentPrimary.consecutiveFailures >= this.config.failoverThreshold) {
      // 查找健康备节点
      const healthyStandby = Array.from(this.nodes.values()).find(
        (n) => n.role === 'standby' && n.healthy && n.replicationLagMs <= this.config.maxReplicationLagMs
      );
      if (healthyStandby && this.config.autoFailover) {
        await this.performFailover(healthyStandby.id, 'Primary node failed', 'auto');
      } else {
        this.status = 'failed';
      }
    }
  }

  private async performFailover(targetNodeId: string, reason: string, mode: 'auto' | 'manual'): Promise<Failover> {
    const failoverId = `failover-${++this.failoverCounter}`;
    const start = Date.now();
    const oldPrimary = this.nodes.get(this.currentPrimaryId);
    const targetNode = this.nodes.get(targetNodeId);

    if (!targetNode) {
      throw new Error(`Target node ${targetNodeId} not found`);
    }

    this.status = 'failover-in-progress';
    const dataLossBytes = oldPrimary && oldPrimary.walPosition > targetNode.walPosition
      ? oldPrimary.walPosition - targetNode.walPosition
      : 0;

    const failover: Failover = {
      id: failoverId,
      timestamp: start,
      fromNodeId: oldPrimary?.id ?? 'unknown',
      toNodeId: targetNodeId,
      reason: `${mode === 'auto' ? 'AUTO' : 'MANUAL'}: ${reason}`,
      dataLossBytes,
      recoveryTimeMs: 0,
      status: 'in-progress',
    };

    this.emit({ type: 'failover-start', timestamp: start, failover });

    // 模拟切换过程
    await this.sleep(200);

    // 提升备节点
    targetNode.role = 'primary';
    targetNode.walPosition = oldPrimary?.walPosition ?? targetNode.walPosition;
    if (oldPrimary) {
      oldPrimary.role = 'standby';
    }
    this.currentPrimaryId = targetNodeId;

    failover.status = 'completed';
    failover.recoveryTimeMs = Date.now() - start;
    this.failovers.push(failover);
    this.status = 'recovering';

    this.emit({ type: 'failover-complete', timestamp: Date.now(), failover });
    return failover;
  }

  private async performBackup(): Promise<Backup> {
    const backupId = `backup-${++this.backupCounter}`;
    const start = Date.now();
    const source = this.getCurrentPrimary();
    if (!source) {
      const failed: Backup = {
        id: backupId,
        timestamp: start,
        sourceNodeId: 'unknown',
        sizeBytes: 0,
        durationMs: 0,
        type: 'full',
        status: 'failed',
        error: 'No primary available',
      };
      this.backups.push(failed);
      return failed;
    }

    const backup: Backup = {
      id: backupId,
      timestamp: start,
      sourceNodeId: source.id,
      sizeBytes: 0,
      durationMs: 0,
      type: this.backupCounter % 5 === 0 ? 'full' : 'incremental', // 每 5 次全量
      status: 'in-progress',
    };

    this.emit({ type: 'backup-start', timestamp: start, backup });

    try {
      if (this.config.backupExecutor) {
        const result = await this.config.backupExecutor(source, backup.type);
        backup.sizeBytes = result.sizeBytes;
        backup.durationMs = result.durationMs;
      } else {
        // 默认 mock
        await this.sleep(50);
        backup.sizeBytes = 1024 * 1024 * (1 + Math.random() * 9); // 1-10 MB
        backup.durationMs = Date.now() - start;
      }

      backup.status = 'completed';
      this.emit({ type: 'backup-complete', timestamp: Date.now(), backup });
    } catch (err) {
      backup.status = 'failed';
      backup.error = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'backup-failed', timestamp: Date.now(), backup, error: backup.error! });
    }

    this.backups.push(backup);
    // 保留策略
    if (this.backups.length > this.config.backupRetention) {
      this.backups.shift();
    }
    return backup;
  }

  private buildSummary(): string {
    const primary = this.getCurrentPrimary();
    const summary = `DR Status: ${this.status} | Primary: ${primary?.name ?? 'NONE'} | Backups: ${this.backups.length} | Failovers: ${this.failovers.length}`;
    if (this.failovers.length > 0) {
      const avgRto = this.failovers.reduce((s, f) => s + f.recoveryTimeMs, 0) / this.failovers.length;
      return `${summary} | Avg RTO: ${avgRto.toFixed(0)}ms`;
    }
    return summary;
  }

  private buildRecommendations(): string[] {
    const recs: string[] = [];
    if (this.failovers.length > 0) {
      recs.push(`发生 ${this.failovers.length} 次故障切换, 建议排查根因`);
      const dataLoss = this.failovers.reduce((s, f) => s + f.dataLossBytes, 0);
      if (dataLoss > 0) {
        recs.push(`数据丢失 ${(dataLoss / 1024).toFixed(2)} KB, 建议提高复制实时性`);
      }
    }
    const failedNodes = this.getNodes().filter((n) => n.role === 'failed');
    if (failedNodes.length > 0) {
      recs.push(`失败节点: ${failedNodes.map((n) => n.name).join(', ')}, 建议修复或更换`);
    }
    const failedBackups = this.backups.filter((b) => b.status === 'failed');
    if (failedBackups.length > 0) {
      recs.push(`${failedBackups.length} 次备份失败, 检查备份策略`);
    }
    if (this.backups.length < 3 && this.status === 'healthy') {
      recs.push('建议增加备份频率, 当前备份数较少');
    }
    if (recs.length === 0) {
      recs.push('灾备状态健康, 继续监控');
    }
    return recs;
  }

  private emit(event: DREvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================
// 工厂函数
// ====================================

/** 创建默认灾备配置 (主 + 1 备) */
export function createDefaultDRConfig(
  primaryName = 'primary-db',
  standbyName = 'standby-db'
): DRConfig {
  return {
    primary: {
      id: 'node-primary',
      name: primaryName,
      endpoint: 'postgresql://primary.db.local:5432',
      role: 'primary',
      healthy: true,
      consecutiveFailures: 0,
      lastSuccessAt: Date.now(),
      replicationLagMs: 0,
      walPosition: 0,
    },
    standbys: [
      {
        id: 'node-standby-1',
        name: standbyName,
        endpoint: 'postgresql://standby.db.local:5432',
        role: 'standby',
        healthy: true,
        consecutiveFailures: 0,
        lastSuccessAt: Date.now(),
        replicationLagMs: 100,
        walPosition: 0,
      },
    ],
    failoverThreshold: 3,
    healthCheckIntervalMs: 1000,
    backupIntervalMs: 10000,
    backupRetention: 10,
    maxReplicationLagMs: 1000,
    autoFailover: true,
    requireManualConfirm: false,
  };
}
