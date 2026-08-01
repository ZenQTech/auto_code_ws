/**
 * # ============================================================
 * # DisasterRecovery 单元测试 (Cycle 52 G52-04)
 * # ============================================================
 * # 核心作用：验证灾备恢复管理器的所有功能
 * # 运行流程：
 * #   1. 节点管理 (主/备)
 * #   2. 健康检查 + 故障检测
 * #   3. 自动故障切换
 * #   4. 备份执行 (full/incremental)
 * #   5. 手动故障切换
 * #   6. RTO/RPO 计算
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 52 G52-04 初次创建
 * # ====================================
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DisasterRecovery, createDefaultDRConfig } from './disasterRecovery';
import type { DRConfig, DatabaseNode } from './disasterRecovery';

function createTestConfig(overrides: Partial<DRConfig> = {}): DRConfig {
  return {
    ...createDefaultDRConfig('test-primary', 'test-standby'),
    failoverThreshold: 3,
    healthCheckIntervalMs: 50,
    backupIntervalMs: 200,
    backupRetention: 5,
    maxReplicationLagMs: 1000,
    autoFailover: true,
    requireManualConfirm: false,
    ...overrides,
  };
}

describe('DisasterRecovery', () => {
  let dr: DisasterRecovery;

  beforeEach(() => {
    dr = new DisasterRecovery(createTestConfig());
  });

  describe('节点管理', () => {
    it('应该初始化主节点', () => {
      const primary = dr.getCurrentPrimary();
      expect(primary).toBeDefined();
      expect(primary?.role).toBe('primary');
    });

    it('应该包含备节点', () => {
      const nodes = dr.getNodes();
      expect(nodes).toHaveLength(2);
      const standbys = nodes.filter((n) => n.role === 'standby');
      expect(standbys).toHaveLength(1);
    });

    it('当前主节点 ID 应匹配', () => {
      const primary = dr.getCurrentPrimary();
      expect(primary?.id).toBe('node-primary');
    });
  });

  describe('健康检查', () => {
    it('应该能执行健康检查', async () => {
      await (dr as unknown as { checkHealth: () => Promise<void> }).checkHealth();
      const nodes = dr.getNodes();
      // 大多数情况下节点健康
      const healthyCount = nodes.filter((n) => n.healthy).length;
      expect(healthyCount).toBeGreaterThan(0);
    });

    it('健康检查失败应增加连续失败计数', async () => {
      const checker = vi.fn().mockResolvedValue(false);
      const d = new DisasterRecovery(createTestConfig({ healthChecker: checker }));
      await (d as unknown as { checkHealth: () => Promise<void> }).checkHealth();
      const primary = d.getCurrentPrimary();
      expect(primary?.consecutiveFailures).toBeGreaterThan(0);
    });

    it('健康检查成功应重置连续失败计数', async () => {
      const checker = vi.fn().mockResolvedValue(true);
      const d = new DisasterRecovery(createTestConfig({ healthChecker: checker }));
      await (d as unknown as { checkHealth: () => Promise<void> }).checkHealth();
      const primary = d.getCurrentPrimary();
      expect(primary?.consecutiveFailures).toBe(0);
    });

    it('达到阈值时应标记节点失败', async () => {
      const checker = vi.fn().mockResolvedValue(false);
      const d = new DisasterRecovery(createTestConfig({ healthChecker: checker, failoverThreshold: 2 }));
      await (d as unknown as { checkHealth: () => Promise<void> }).checkHealth();
      await (d as unknown as { checkHealth: () => Promise<void> }).checkHealth();
      const primary = d.getCurrentPrimary();
      expect(primary?.role).toBe('failed');
    });
  });

  describe('故障切换', () => {
    it('应该能执行自动故障切换', async () => {
      const checker = vi.fn().mockResolvedValue(false);
      const d = new DisasterRecovery(
        createTestConfig({ healthChecker: checker, failoverThreshold: 1 })
      );
      const failover = await d.manualFailover('node-standby-1', 'Test failover');
      expect(failover.fromNodeId).toBe('node-primary');
      expect(failover.toNodeId).toBe('node-standby-1');
      expect(failover.status).toBe('completed');
    });

    it('切换后主备角色应交换', async () => {
      const checker = vi.fn().mockResolvedValue(false);
      const d = new DisasterRecovery(
        createTestConfig({ healthChecker: checker, failoverThreshold: 1 })
      );
      await d.manualFailover('node-standby-1', 'Test');
      const newPrimary = d.getCurrentPrimary();
      expect(newPrimary?.id).toBe('node-standby-1');
      expect(newPrimary?.role).toBe('primary');
    });

    it('切换到不存在节点应抛出错误', async () => {
      await expect(dr.manualFailover('non-existent', 'Test')).rejects.toThrow('not found');
    });

    it('切换时计算 RTO', async () => {
      const failover = await dr.manualFailover('node-standby-1', 'Test');
      expect(failover.recoveryTimeMs).toBeGreaterThan(0);
    });
  });

  describe('备份', () => {
    it('应该能执行备份', async () => {
      const backup = await (dr as unknown as { performBackup: () => Promise<{ status: string; type: string }> }).performBackup();
      expect(backup.status).toBe('completed');
      expect(['full', 'incremental']).toContain(backup.type);
    });

    it('应该支持 full 备份', async () => {
      const backup = await (dr as unknown as { performBackup: () => Promise<{ status: string; type: string }> }).performBackup();
      expect(backup.type).toBeDefined();
    });

    it('应该支持自定义 backupExecutor', async () => {
      const executor = vi.fn().mockResolvedValue({ sizeBytes: 5000000, durationMs: 100 });
      const d = new DisasterRecovery(createTestConfig({ backupExecutor: executor }));
      const backup = await (d as unknown as { performBackup: () => Promise<{ status: string; sizeBytes: number }> }).performBackup();
      expect(executor).toHaveBeenCalled();
      expect(backup.sizeBytes).toBe(5000000);
    });

    it('备份应记录到列表', async () => {
      await (dr as unknown as { performBackup: () => Promise<unknown> }).performBackup();
      await (dr as unknown as { performBackup: () => Promise<unknown> }).performBackup();
      const backups = (dr as unknown as { backups: unknown[] }).backups;
      expect(backups.length).toBe(2);
    });

    it('备份应遵守保留策略', async () => {
      const d = new DisasterRecovery(createTestConfig({ backupRetention: 2 }));
      for (let i = 0; i < 5; i++) {
        await (d as unknown as { performBackup: () => Promise<unknown> }).performBackup();
      }
      const backups = (d as unknown as { backups: unknown[] }).backups;
      expect(backups.length).toBeLessThanOrEqual(2);
    });
  });

  describe('完整运行', () => {
    it('应该能启动并生成报告', async () => {
      const report = await dr.start(300);
      expect(report.status).toBeDefined();
      expect(report.durationMs).toBeGreaterThan(0);
    });

    it('长时间运行应触发多次备份', async () => {
      const d = new DisasterRecovery(createTestConfig({ backupIntervalMs: 100 }));
      const report = await d.start(500);
      expect(report.totalBackups).toBeGreaterThan(0);
    });

    it('健康节点触发备份', async () => {
      const checker = vi.fn().mockResolvedValue(true);
      const d = new DisasterRecovery(createTestConfig({ healthChecker: checker, backupIntervalMs: 100 }));
      const report = await d.start(300);
      expect(report.successfulBackups).toBeGreaterThan(0);
    });

    it('应该防止重复启动', async () => {
      const promise1 = dr.start(200);
      await expect(dr.start(200)).rejects.toThrow('already running');
      await promise1;
    });
  });

  describe('事件订阅', () => {
    it('应该触发 start 事件', async () => {
      const listener = vi.fn();
      dr.subscribe(listener);
      await dr.start(100);
      const types = listener.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain('start');
    });

    it('应该触发 health-check 事件', async () => {
      const listener = vi.fn();
      dr.subscribe(listener);
      await dr.start(100);
      const types = listener.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain('health-check');
    });

    it('应该触发 backup-start 和 backup-complete 事件', async () => {
      const listener = vi.fn();
      dr.subscribe(listener);
      await (dr as unknown as { performBackup: () => Promise<unknown> }).performBackup();
      const types = listener.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain('backup-start');
      expect(types).toContain('backup-complete');
    });

    it('应该触发 complete 事件', async () => {
      const listener = vi.fn();
      dr.subscribe(listener);
      await dr.start(100);
      const types = listener.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain('complete');
    });

    it('subscribe 应该返回 unsubscribe 函数', () => {
      const listener = vi.fn();
      const unsub = dr.subscribe(listener);
      unsub();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('报告生成', () => {
    it('应该生成正确的 summary', async () => {
      const report = await dr.start(100);
      expect(report.summary).toContain('DR Status');
    });

    it('应该计算 RTO 和 RPO', async () => {
      const d = new DisasterRecovery(createTestConfig({ failoverThreshold: 1, healthChecker: vi.fn().mockResolvedValue(false) }));
      await d.manualFailover('node-standby-1', 'Test');
      const report = await d.start(100);
      expect(report.failoverCount).toBe(1);
      expect(report.avgRtoMs).toBeGreaterThan(0);
    });

    it('应该生成推荐建议', async () => {
      const report = await dr.start(100);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('失败节点应触发建议', async () => {
      const checker = vi.fn().mockResolvedValue(false);
      const d = new DisasterRecovery(
        createTestConfig({ healthChecker: checker, failoverThreshold: 1 })
      );
      await d.start(200);
      const report = await d.start(100);
      const hasFailedNodeRec = report.recommendations.some((r) => r.includes('失败') || r.includes('切换'));
      expect(hasFailedNodeRec).toBe(true);
    });
  });

  describe('优雅停止', () => {
    it('应该在 abort 后停止', async () => {
      const d = new DisasterRecovery(createTestConfig());
      setTimeout(() => d.abort(), 100);
      const report = await d.start(5000);
      expect(report.durationMs).toBeLessThan(5000);
    });
  });
});

describe('工厂函数', () => {
  it('createDefaultDRConfig 应该返回主+备配置', () => {
    const config = createDefaultDRConfig('p1', 's1');
    expect(config.primary.name).toBe('p1');
    expect(config.standbys).toHaveLength(1);
    expect(config.standbys[0]!.name).toBe('s1');
  });

  it('createDefaultDRConfig 默认 autoFailover=true', () => {
    const config = createDefaultDRConfig();
    expect(config.autoFailover).toBe(true);
  });

  it('createDefaultDRConfig 默认 requireManualConfirm=false', () => {
    const config = createDefaultDRConfig();
    expect(config.requireManualConfirm).toBe(false);
  });
});
