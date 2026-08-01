/**
 * # ============================================================
 * # Chaos Monkey 故障注入测试套件 单元测试 (Cycle 53 G53-04)
 * # ============================================================
 * # 核心作用：验证 Chaos Monkey 故障注入功能
 * # 运行流程：
 * #   1. 各类型故障注入器测试
 * #   2. 实验执行 + 报告生成
 * #   3. 错误记录 + 事件订阅
 * #   4. 恢复检测 + 韧性评分
 * #   5. 自定义注入器 + 工厂函数
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 53 G53-04 初次创建
 * # ====================================
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ChaosMonkey,
  NetworkLatencyInjector,
  NetworkPacketLossInjector,
  ExceptionInjector,
  MemoryPressureInjector,
  CpuStressInjector,
  TimeoutInjector,
  RateLimitingInjector,
  createNetworkLatencyExperiment,
  createNetworkPacketLossExperiment,
  createExceptionInjectionExperiment,
  createMemoryPressureExperiment,
  createCpuStressExperiment,
  createTimeoutInjectionExperiment,
  createRateLimitingExperiment,
} from './chaosMonkey';
import type { ChaosExperiment, ChaosFault, ChaosListener, ChaosError } from './chaosMonkey';

describe('ChaosMonkey', () => {
  let chaos: ChaosMonkey;

  beforeEach(() => {
    chaos = new ChaosMonkey();
  });

  afterEach(async () => {
    chaos.reset();
  });

  describe('基础功能', () => {
    it('应该创建 ChaosMonkey 实例', () => {
      expect(chaos).toBeInstanceOf(ChaosMonkey);
    });

    it('应该注册默认注入器', () => {
      const statuses = chaos.getInjectorStatuses();
      expect(statuses.length).toBeGreaterThanOrEqual(7);
    });

    it('应该支持事件订阅', () => {
      const listener = vi.fn();
      const unsubscribe = chaos.subscribe(listener);
      expect(typeof unsubscribe).toBe('function');
    });

    it('应该支持取消订阅', () => {
      const listener = vi.fn();
      const unsubscribe = chaos.subscribe(listener);
      unsubscribe();
      expect(chaos['listeners'].size).toBe(0);
    });
  });

  describe('错误记录', () => {
    it('应该记录错误', () => {
      const error: ChaosError = {
        timestamp: Date.now(),
        type: 'TestError',
        message: 'Test error',
      };
      chaos.recordError(error);
      expect(chaos.getErrorLog()).toHaveLength(1);
    });

    it('应该记录捕获的错误', () => {
      chaos.recordCaughtError(new Error('Test'), 'TestSource');
      const log = chaos.getErrorLog();
      expect(log).toHaveLength(1);
      expect(log[0]!.source).toBe('TestSource');
      expect(log[0]!.message).toBe('Test');
    });

    it('应该处理非 Error 类型的捕获', () => {
      chaos.recordCaughtError('string error', 'Source');
      const log = chaos.getErrorLog();
      expect(log[0]!.type).toBe('Unknown');
      expect(log[0]!.message).toBe('string error');
    });

    it('应该清空错误日志', () => {
      chaos.recordCaughtError(new Error('1'));
      chaos.recordCaughtError(new Error('2'));
      chaos.clearErrorLog();
      expect(chaos.getErrorLog()).toHaveLength(0);
    });
  });

  describe('网络延迟注入器', () => {
    it('应该创建并返回状态', () => {
      const injector = new NetworkLatencyInjector();
      const status = injector.getStatus();
      expect(status.active).toBe(false);
      expect(status.fault).toBeNull();
    });

    it('应该注入延迟', async () => {
      const injector = chaos.getInjector('network-latency')!;
      const fault: ChaosFault = {
        type: 'network-latency',
        severity: 'medium',
        durationMs: 500,
        intensity: 0.5,
        parameters: { delayMs: 50, jitter: 0.1 },
      };
      await injector.inject(fault, 'test-service');
      expect(injector.getStatus().active).toBe(false); // 已停止
    });
  });

  describe('网络丢包注入器', () => {
    it('应该激活和停止', async () => {
      const injector = new NetworkPacketLossInjector();
      const fault: ChaosFault = {
        type: 'network-packet-loss',
        severity: 'high',
        durationMs: 200,
        intensity: 0.5,
      };
      const injectPromise = injector.inject(fault, 'test');
      expect(injector.getStatus().active).toBe(true);
      await injectPromise;
      expect(injector.getStatus().active).toBe(false);
    });
  });

  describe('异常注入器', () => {
    it('应该激活和停止', async () => {
      const injector = new ExceptionInjector();
      const fault: ChaosFault = {
        type: 'exception-injection',
        severity: 'high',
        durationMs: 200,
        intensity: 0.5,
        parameters: { message: 'Test injected', targets: ['fn1', 'fn2'] },
      };
      const injectPromise = injector.inject(fault, 'test');
      expect(injector.shouldThrowAt('fn1')).toBe(true);
      expect(injector.shouldThrowAt('fn3')).toBe(false);
      await injectPromise;
      expect(injector.shouldThrowAt('fn1')).toBe(false);
    });
  });

  describe('内存压力注入器', () => {
    it('应该激活和清理内存', async () => {
      const injector = new MemoryPressureInjector();
      const fault: ChaosFault = {
        type: 'memory-pressure',
        severity: 'critical',
        durationMs: 200,
        intensity: 0.1,
      };
      const injectPromise = injector.inject(fault, 'test');
      expect(injector.getStatus().active).toBe(true);
      await injectPromise;
      expect(injector.getStatus().active).toBe(false);
    });
  });

  describe('CPU 压力注入器', () => {
    it('应该激活和停止', async () => {
      const injector = new CpuStressInjector();
      const fault: ChaosFault = {
        type: 'cpu-stress',
        severity: 'high',
        durationMs: 100,
        intensity: 0.3,
      };
      const injectPromise = injector.inject(fault, 'test');
      expect(injector.getStatus().active).toBe(true);
      await injectPromise;
      expect(injector.getStatus().active).toBe(false);
    });
  });

  describe('超时注入器', () => {
    it('应该支持 withTimeout', async () => {
      const injector = new TimeoutInjector();
      const fault: ChaosFault = {
        type: 'timeout-injection',
        severity: 'medium',
        durationMs: 100,
        intensity: 0.5,
      };
      const injectPromise = injector.inject(fault, 'test');
      // 等待激活
      await new Promise((r) => setTimeout(r, 10));
      try {
        await injector.withTimeout(async () => {
          await new Promise((r) => setTimeout(r, 5000));
          return 'done';
        }, 50);
      } catch (e) {
        expect((e as Error).message).toContain('timed out');
      }
      await injectPromise;
    });
  });

  describe('限流注入器', () => {
    it('应该限制请求速率', async () => {
      const injector = new RateLimitingInjector();
      const fault: ChaosFault = {
        type: 'rate-limiting',
        severity: 'medium',
        durationMs: 500,
        intensity: 0.5,
        parameters: { maxRequestsPerSecond: 3 },
      };
      const injectPromise = injector.inject(fault, 'test');
      await new Promise((r) => setTimeout(r, 10));
      expect(injector.checkRateLimit()).toBe(true);
      expect(injector.checkRateLimit()).toBe(true);
      expect(injector.checkRateLimit()).toBe(true);
      expect(injector.checkRateLimit()).toBe(false);
      await injectPromise;
    });
  });

  describe('运行实验', () => {
    it('应该运行网络延迟实验并生成报告', async () => {
      const experiment = createNetworkLatencyExperiment('test-service', {
        durationMs: 100,
        delayMs: 10,
        intensity: 0.5,
      });
      experiment.preValidation = async () => true;
      experiment.postValidation = async () => true;

      const report = await chaos.runExperiment(experiment);
      expect(report.experimentId).toBe(experiment.id);
      expect(report.faultInjected.type).toBe('network-latency');
      expect(report.resilienceScore).toBeGreaterThanOrEqual(0);
      expect(typeof report.summary).toBe('string');
    });

    it('应该运行网络丢包实验', async () => {
      const experiment = createNetworkPacketLossExperiment('test-service', {
        durationMs: 100,
        intensity: 0.3,
      });
      experiment.preValidation = async () => true;
      experiment.postValidation = async () => true;

      const report = await chaos.runExperiment(experiment);
      expect(report.faultInjected.type).toBe('network-packet-loss');
    });

    it('应该运行异常注入实验', async () => {
      const experiment = createExceptionInjectionExperiment('test-service', {
        durationMs: 100,
        intensity: 0.5,
      });
      experiment.preValidation = async () => true;
      experiment.postValidation = async () => true;

      const report = await chaos.runExperiment(experiment);
      expect(report.faultInjected.type).toBe('exception-injection');
    });

    it('应该运行内存压力实验', async () => {
      const experiment = createMemoryPressureExperiment('test-service', {
        durationMs: 100,
        intensity: 0.1,
      });
      experiment.preValidation = async () => true;
      experiment.postValidation = async () => true;

      const report = await chaos.runExperiment(experiment);
      expect(report.faultInjected.type).toBe('memory-pressure');
    });

    it('应该运行 CPU 压力实验', async () => {
      const experiment = createCpuStressExperiment('test-service', {
        durationMs: 100,
        intensity: 0.2,
      });
      experiment.preValidation = async () => true;
      experiment.postValidation = async () => true;

      const report = await chaos.runExperiment(experiment);
      expect(report.faultInjected.type).toBe('cpu-stress');
    });

    it('应该运行超时实验', async () => {
      const experiment = createTimeoutInjectionExperiment('test-service', {
        durationMs: 100,
        intensity: 0.5,
      });
      experiment.preValidation = async () => true;
      experiment.postValidation = async () => true;

      const report = await chaos.runExperiment(experiment);
      expect(report.faultInjected.type).toBe('timeout-injection');
    });

    it('应该运行限流实验', async () => {
      const experiment = createRateLimitingExperiment('test-service', {
        durationMs: 100,
        maxRequestsPerSecond: 5,
      });
      experiment.preValidation = async () => true;
      experiment.postValidation = async () => true;

      const report = await chaos.runExperiment(experiment);
      expect(report.faultInjected.type).toBe('rate-limiting');
    });

    it('应该处理未注册的故障类型', async () => {
      const experiment: ChaosExperiment = {
        id: 'test-unknown',
        name: 'Unknown',
        target: 'test',
        fault: {
          type: 'network-partition' as ChaosFault['type'],
          severity: 'critical',
          durationMs: 100,
          intensity: 0.5,
        },
      };
      await expect(chaos.runExperiment(experiment)).rejects.toThrow();
    });

    it('应该处理前验证失败', async () => {
      const experiment = createNetworkLatencyExperiment('test', { durationMs: 100, delayMs: 10 });
      experiment.preValidation = async () => false;
      experiment.postValidation = async () => true;

      const report = await chaos.runExperiment(experiment);
      expect(report).toBeDefined();
    });

    it('应该处理后验证失败', async () => {
      const experiment = createNetworkLatencyExperiment('test', { durationMs: 100, delayMs: 10 });
      experiment.preValidation = async () => true;
      experiment.postValidation = async () => false;
      experiment.recoveryTimeoutMs = 200;

      const report = await chaos.runExperiment(experiment);
      expect(report.success).toBe(false);
    });
  });

  describe('批量实验', () => {
    it('应该运行多个实验', async () => {
      const exp1 = createNetworkLatencyExperiment('s1', { durationMs: 50, delayMs: 5 });
      exp1.preValidation = async () => true;
      exp1.postValidation = async () => true;
      const exp2 = createExceptionInjectionExperiment('s2', { durationMs: 50 });
      exp2.preValidation = async () => true;
      exp2.postValidation = async () => true;

      const reports = await chaos.runExperiments([exp1, exp2]);
      expect(reports).toHaveLength(2);
    });
  });

  describe('事件订阅', () => {
    it('应该接收 start 事件', async () => {
      const events: string[] = [];
      chaos.subscribe((e) => events.push(e.type));

      const experiment = createNetworkLatencyExperiment('test', { durationMs: 50, delayMs: 5 });
      experiment.preValidation = async () => true;
      experiment.postValidation = async () => true;
      await chaos.runExperiment(experiment);

      expect(events).toContain('start');
      expect(events).toContain('fault-injected');
      expect(events).toContain('complete');
    });

    it('应该触发 error-observed 事件', () => {
      const events: string[] = [];
      chaos.subscribe((e) => events.push(e.type));
      chaos.recordError({ timestamp: Date.now(), type: 'X', message: 'm' });
      expect(events).toContain('error-observed');
    });

    it('监听器抛错不应中断主流程', () => {
      chaos.subscribe(() => {
        throw new Error('listener error');
      });
      expect(() => chaos.recordError({ timestamp: Date.now(), type: 'X', message: 'm' })).not.toThrow();
    });
  });

  describe('报告管理', () => {
    it('应该返回所有报告', async () => {
      const exp = createNetworkLatencyExperiment('test', { durationMs: 50, delayMs: 5 });
      exp.preValidation = async () => true;
      exp.postValidation = async () => true;
      await chaos.runExperiment(exp);
      const reports = chaos.getReports();
      expect(reports.length).toBeGreaterThanOrEqual(1);
    });

    it('应该按 ID 查询报告', async () => {
      const exp = createNetworkLatencyExperiment('test', { durationMs: 50, delayMs: 5 });
      exp.preValidation = async () => true;
      exp.postValidation = async () => true;
      await chaos.runExperiment(exp);
      const report = chaos.getReport(exp.id);
      expect(report).toBeDefined();
    });

    it('应该返回 undefined 当报告不存在', () => {
      const report = chaos.getReport('non-existent');
      expect(report).toBeUndefined();
    });
  });

  describe('自定义注入器', () => {
    it('应该支持注册自定义注入器', () => {
      const customInjector = new NetworkLatencyInjector();
      customInjector.type = 'network-latency';
      chaos.registerInjector(customInjector);
      const retrieved = chaos.getInjector('network-latency');
      expect(retrieved).toBe(customInjector);
    });
  });

  describe('重置', () => {
    it('应该清空所有状态', async () => {
      const exp = createNetworkLatencyExperiment('test', { durationMs: 50, delayMs: 5 });
      exp.preValidation = async () => true;
      exp.postValidation = async () => true;
      await chaos.runExperiment(exp);
      chaos.recordCaughtError(new Error('test'));

      chaos.reset();
      expect(chaos.getReports()).toHaveLength(0);
      expect(chaos.getErrorLog()).toHaveLength(0);
    });
  });
});

describe('ChaosMonkey 类型验证', () => {
  it('应该导出所有注入器类', () => {
    expect(NetworkLatencyInjector).toBeDefined();
    expect(NetworkPacketLossInjector).toBeDefined();
    expect(ExceptionInjector).toBeDefined();
    expect(MemoryPressureInjector).toBeDefined();
    expect(CpuStressInjector).toBeDefined();
    expect(TimeoutInjector).toBeDefined();
    expect(RateLimitingInjector).toBeDefined();
  });

  it('应该导出所有工厂函数', () => {
    expect(createNetworkLatencyExperiment).toBeDefined();
    expect(createNetworkPacketLossExperiment).toBeDefined();
    expect(createExceptionInjectionExperiment).toBeDefined();
    expect(createMemoryPressureExperiment).toBeDefined();
    expect(createCpuStressExperiment).toBeDefined();
    expect(createTimeoutInjectionExperiment).toBeDefined();
    expect(createRateLimitingExperiment).toBeDefined();
  });

  it('工厂函数应返回有效的实验', () => {
    const exp = createNetworkLatencyExperiment('test');
    expect(exp.id).toBeDefined();
    expect(exp.fault.type).toBe('network-latency');
    expect(exp.target).toBe('test');
  });
});
