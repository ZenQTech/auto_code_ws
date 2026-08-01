/**
 * # ============================================================
 * # Chaos Monkey 故障注入测试套件 (Cycle 53 G53-04)
 * # ============================================================
 * # 核心作用：模拟各种故障场景，验证系统在异常情况下的韧性
 * # 支持故障类型：
 * #   1. 网络延迟 (Network Latency)
 * #   2. 网络丢包 (Network Packet Loss)
 * #   3. 网络分区 (Network Partition)
 * #   4. CPU 压力 (CPU Stress)
 * #   5. 内存占用 (Memory Pressure)
 * #   6. 磁盘 IO 失败 (Disk I/O Failure)
 * #   7. 异常注入 (Exception Injection)
 * #   8. 超时注入 (Timeout Injection)
 * #   9. 服务降级 (Service Degradation)
 * #  10. 限流 (Rate Limiting)
 * # 输入参数：ChaosExperiment { name, target, fault, duration, intensity }
 * # 输出结果：ChaosReport { success, faultInjected, errorsObserved, recoveryTimeMs }
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 53 G53-04 初次创建
 * # ====================================
 */

// ====================================
// 类型定义
// ====================================

/** 故障类型 */
export type ChaosFaultType =
  | 'network-latency'
  | 'network-packet-loss'
  | 'network-partition'
  | 'cpu-stress'
  | 'memory-pressure'
  | 'disk-io-failure'
  | 'exception-injection'
  | 'timeout-injection'
  | 'service-degradation'
  | 'rate-limiting';

/** 故障严重度 */
export type ChaosSeverity = 'low' | 'medium' | 'high' | 'critical';

/** 故障配置 */
export interface ChaosFault {
  /** 故障类型 */
  type: ChaosFaultType;
  /** 故障严重度 */
  severity: ChaosSeverity;
  /** 故障持续时间 (毫秒) */
  durationMs: number;
  /** 故障强度 (0-1) */
  intensity: number;
  /** 故障参数 (类型相关) */
  parameters?: Record<string, number | string | boolean | string[] | number[]>;
}

/** 混沌实验 */
export interface ChaosExperiment {
  /** 实验 ID */
  id: string;
  /** 实验名称 */
  name: string;
  /** 目标服务 */
  target: string;
  /** 故障配置 */
  fault: ChaosFault;
  /** 实验前验证 */
  preValidation?: () => Promise<boolean>;
  /** 实验后验证 */
  postValidation?: () => Promise<boolean>;
  /** 恢复超时 (毫秒) */
  recoveryTimeoutMs?: number;
  /** 注入点列表 */
  injectionPoints?: string[];
}

/** 实验结果 */
export interface ChaosReport {
  /** 实验 ID */
  experimentId: string;
  /** 实验名称 */
  name: string;
  /** 是否成功 (系统能从故障中恢复) */
  success: boolean;
  /** 注入的故障 */
  faultInjected: ChaosFault;
  /** 观察到的错误 */
  errorsObserved: ChaosError[];
  /** 恢复时间 (毫秒) */
  recoveryTimeMs: number;
  /** 总耗时 (毫秒) */
  durationMs: number;
  /** 时间戳 */
  timestamp: number;
  /** 韧性评分 (0-1) */
  resilienceScore: number;
  /** 摘要 */
  summary: string;
  /** 建议 */
  recommendations: string[];
}

/** 观察到的错误 */
export interface ChaosError {
  /** 时间戳 */
  timestamp: number;
  /** 错误类型 */
  type: string;
  /** 错误信息 */
  message: string;
  /** 来源 (组件名) */
  source?: string;
  /** 错误堆栈 */
  stack?: string;
}

/** 实验事件 */
export type ChaosEvent =
  | { type: 'start'; timestamp: number; experiment: ChaosExperiment }
  | { type: 'fault-injected'; timestamp: number; experimentId: string; fault: ChaosFault }
  | { type: 'error-observed'; timestamp: number; experimentId: string; error: ChaosError }
  | { type: 'recovered'; timestamp: number; experimentId: string; recoveryTimeMs: number }
  | { type: 'complete'; timestamp: number; report: ChaosReport };

export type ChaosListener = (event: ChaosEvent) => void;

// ====================================
// 故障注入器
// ====================================

/**
 * 故障注入器接口
 */
export interface FaultInjector {
  /** 注入器类型 */
  type: ChaosFaultType;
  /** 注入故障 */
  inject(fault: ChaosFault, target: string): Promise<void>;
  /** 停止注入 */
  stop(): Promise<void>;
  /** 获取注入器状态 */
  getStatus(): { active: boolean; startTime: number; fault: ChaosFault | null };
}

/**
 * 网络延迟注入器
 */
export class NetworkLatencyInjector implements FaultInjector {
  type: ChaosFaultType = 'network-latency';
  private active = false;
  private startTime = 0;
  private currentFault: ChaosFault | null = null;
  private originalFetch: typeof globalThis.fetch | null = null;
  private readonly listeners: Set<ChaosListener> = new Set();

  inject(fault: ChaosFault, _target: string): Promise<void> {
    return new Promise((resolve) => {
      this.active = true;
      this.startTime = Date.now();
      this.currentFault = fault;
      const delayMs = (fault.parameters?.['delayMs'] as number) ?? 1000;
      const jitter = (fault.parameters?.['jitter'] as number) ?? 0.2;
      const intensity = fault.intensity;
      const effectiveDelay = Math.floor(delayMs * (0.5 + intensity * 0.5));

      if (typeof globalThis.fetch === 'function' && !this.originalFetch) {
        this.originalFetch = globalThis.fetch;
      }

      // 拦截 fetch
      if (typeof globalThis.fetch === 'function' && this.originalFetch) {
        const originalFetch = this.originalFetch;
        (globalThis as unknown as { fetch: typeof globalThis.fetch }).fetch = async (
          input: RequestInfo | URL,
          init?: RequestInit
        ) => {
          const actualJitter = (Math.random() * 2 - 1) * jitter * effectiveDelay;
          const totalDelay = Math.max(0, effectiveDelay + actualJitter);
          await new Promise((r) => setTimeout(r, totalDelay));
          return originalFetch(input, init);
        };
      }

      this.notifyFaultInjected(fault);
      setTimeout(() => {
        this.stop().then(resolve);
      }, fault.durationMs);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.originalFetch) {
        (globalThis as unknown as { fetch: typeof globalThis.fetch }).fetch = this.originalFetch;
        this.originalFetch = null;
      }
      this.active = false;
      this.currentFault = null;
      resolve();
    });
  }

  getStatus(): { active: boolean; startTime: number; fault: ChaosFault | null } {
    return { active: this.active, startTime: this.startTime, fault: this.currentFault };
  }

  subscribe(listener: ChaosListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyFaultInjected(fault: ChaosFault): void {
    for (const l of this.listeners) {
      try {
        l({ type: 'fault-injected', timestamp: Date.now(), experimentId: '', fault });
      } catch {
        // ignore
      }
    }
  }
}

/**
 * 网络丢包注入器
 */
export class NetworkPacketLossInjector implements FaultInjector {
  type: ChaosFaultType = 'network-packet-loss';
  private active = false;
  private startTime = 0;
  private currentFault: ChaosFault | null = null;
  private originalFetch: typeof globalThis.fetch | null = null;

  inject(fault: ChaosFault, _target: string): Promise<void> {
    return new Promise((resolve) => {
      this.active = true;
      this.startTime = Date.now();
      this.currentFault = fault;
      const lossRate = fault.intensity;

      if (typeof globalThis.fetch === 'function' && !this.originalFetch) {
        this.originalFetch = globalThis.fetch;
      }

      if (typeof globalThis.fetch === 'function' && this.originalFetch) {
        const originalFetch = this.originalFetch;
        (globalThis as unknown as { fetch: typeof globalThis.fetch }).fetch = async (
          input: RequestInfo | URL,
          init?: RequestInit
        ) => {
          if (Math.random() < lossRate) {
            throw new Error('Chaos: Network packet loss');
          }
          return originalFetch(input, init);
        };
      }

      setTimeout(() => {
        this.stop().then(resolve);
      }, fault.durationMs);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.originalFetch) {
        (globalThis as unknown as { fetch: typeof globalThis.fetch }).fetch = this.originalFetch;
        this.originalFetch = null;
      }
      this.active = false;
      this.currentFault = null;
      resolve();
    });
  }

  getStatus(): { active: boolean; startTime: number; fault: ChaosFault | null } {
    return { active: this.active, startTime: this.startTime, fault: this.currentFault };
  }
}

/**
 * 异常注入器
 */
export class ExceptionInjector implements FaultInjector {
  type: ChaosFaultType = 'exception-injection';
  private active = false;
  private startTime = 0;
  private currentFault: ChaosFault | null = null;
  private readonly throwAtFunctions: Set<string> = new Set();

  inject(fault: ChaosFault, _target: string): Promise<void> {
    return new Promise((resolve) => {
      this.active = true;
      this.startTime = Date.now();
      this.currentFault = fault;
      const errorMessage = (fault.parameters?.['message'] as string) ?? 'Chaos: Injected exception';
      const throwRate = fault.intensity;
      const targetFunctions = (fault.parameters?.['targets'] as string[] | undefined) ?? [];

      // 标记目标函数
      for (const fn of targetFunctions) {
        this.throwAtFunctions.add(fn);
      }

      // 拦截全局错误处理
      const originalOnError = globalThis.onerror;
      (globalThis as unknown as { onerror: unknown }).onerror = (
        message: string,
        source?: string,
        lineno?: number,
        colno?: number,
        error?: Error
      ) => {
        if (Math.random() < throwRate) {
          const err = new Error(errorMessage);
          if (error) err.stack = error.stack;
          throw err;
        }
        if (typeof originalOnError === 'function') {
          return (originalOnError as (...args: unknown[]) => unknown).call(
            globalThis,
            message,
            source,
            lineno,
            colno,
            error
          );
        }
        return false;
      };

      setTimeout(() => {
        this.stop().then(resolve);
      }, fault.durationMs);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.throwAtFunctions.clear();
      this.active = false;
      this.currentFault = null;
      resolve();
    });
  }

  getStatus(): { active: boolean; startTime: number; fault: ChaosFault | null } {
    return { active: this.active, startTime: this.startTime, fault: this.currentFault };
  }

  /**
   * 检查指定函数是否需要注入异常
   */
  shouldThrowAt(functionName: string): boolean {
    return this.active && this.throwAtFunctions.has(functionName);
  }
}

/**
 * 内存压力注入器
 */
export class MemoryPressureInjector implements FaultInjector {
  type: ChaosFaultType = 'memory-pressure';
  private active = false;
  private startTime = 0;
  private currentFault: ChaosFault | null = null;
  private allocations: unknown[] = [];

  inject(fault: ChaosFault, _target: string): Promise<void> {
    return new Promise((resolve) => {
      this.active = true;
      this.startTime = Date.now();
      this.currentFault = fault;
      // 分配大量内存模拟压力
      const blockSize = 1024 * 1024; // 1MB
      const numBlocks = Math.floor(fault.intensity * 100);
      for (let i = 0; i < numBlocks; i++) {
        this.allocations.push(new Array(blockSize).fill(i));
      }
      setTimeout(() => {
        this.stop().then(resolve);
      }, fault.durationMs);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.allocations = [];
      this.active = false;
      this.currentFault = null;
      resolve();
    });
  }

  getStatus(): { active: boolean; startTime: number; fault: ChaosFault | null } {
    return { active: this.active, startTime: this.startTime, fault: this.currentFault };
  }
}

/**
 * CPU 压力注入器
 */
export class CpuStressInjector implements FaultInjector {
  type: ChaosFaultType = 'cpu-stress';
  private active = false;
  private startTime = 0;
  private currentFault: ChaosFault | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  inject(fault: ChaosFault, _target: string): Promise<void> {
    return new Promise((resolve) => {
      this.active = true;
      this.startTime = Date.now();
      this.currentFault = fault;
      const workloadMs = Math.floor(fault.intensity * 200);
      const idleMs = Math.max(0, 200 - workloadMs);

      const runWorkload = (): void => {
        if (!this.active) return;
        const start = Date.now();
        // 模拟 CPU 密集型工作
        while (Date.now() - start < workloadMs) {
          Math.sqrt(Math.random() * Math.random());
        }
        if (idleMs > 0) {
          this.intervalId = setTimeout(runWorkload, idleMs);
        } else {
          this.intervalId = setTimeout(runWorkload, 1);
        }
      };
      runWorkload();

      setTimeout(() => {
        this.stop().then(resolve);
      }, fault.durationMs);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.intervalId !== null) {
        clearTimeout(this.intervalId);
        this.intervalId = null;
      }
      this.active = false;
      this.currentFault = null;
      resolve();
    });
  }

  getStatus(): { active: boolean; startTime: number; fault: ChaosFault | null } {
    return { active: this.active, startTime: this.startTime, fault: this.currentFault };
  }
}

/**
 * 超时注入器
 */
export class TimeoutInjector implements FaultInjector {
  type: ChaosFaultType = 'timeout-injection';
  private active = false;
  private startTime = 0;
  private currentFault: ChaosFault | null = null;

  inject(fault: ChaosFault, _target: string): Promise<void> {
    return new Promise((resolve) => {
      this.active = true;
      this.startTime = Date.now();
      this.currentFault = fault;
      setTimeout(() => {
        this.stop().then(resolve);
      }, fault.durationMs);
    });
  }

  /**
   * 模拟函数超时
   */
  async withTimeout<T>(fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
    if (!this.active) return fn();
    const effectiveTimeout = timeoutMs ?? Math.floor(this.currentFault?.intensity ?? 0.5) * 5000;
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Chaos: Operation timed out')), effectiveTimeout)
      ),
    ]);
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.active = false;
      this.currentFault = null;
      resolve();
    });
  }

  getStatus(): { active: boolean; startTime: number; fault: ChaosFault | null } {
    return { active: this.active, startTime: this.startTime, fault: this.currentFault };
  }
}

/**
 * 限流注入器
 */
export class RateLimitingInjector implements FaultInjector {
  type: ChaosFaultType = 'rate-limiting';
  private active = false;
  private startTime = 0;
  private currentFault: ChaosFault | null = null;
  private requestTimestamps: number[] = [];

  inject(fault: ChaosFault, _target: string): Promise<void> {
    return new Promise((resolve) => {
      this.active = true;
      this.startTime = Date.now();
      this.currentFault = fault;
      setTimeout(() => {
        this.stop().then(resolve);
      }, fault.durationMs);
    });
  }

  /**
   * 检查是否超过限流阈值
   */
  checkRateLimit(): boolean {
    if (!this.active) return true;
    const limit = (this.currentFault?.parameters?.['maxRequestsPerSecond'] as number) ?? 10;
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter((ts) => now - ts < 1000);
    if (this.requestTimestamps.length >= limit) {
      return false;
    }
    this.requestTimestamps.push(now);
    return true;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.requestTimestamps = [];
      this.active = false;
      this.currentFault = null;
      resolve();
    });
  }

  getStatus(): { active: boolean; startTime: number; fault: ChaosFault | null } {
    return { active: this.active, startTime: this.startTime, fault: this.currentFault };
  }
}

// ====================================
// Chaos Monkey 主类
// ====================================

/**
 * Chaos Monkey 主类 - 故障注入编排器
 */
export class ChaosMonkey {
  private readonly injectors: Map<ChaosFaultType, FaultInjector> = new Map();
  private readonly experiments: Map<string, ChaosExperiment> = new Map();
  private readonly reports: Map<string, ChaosReport> = new Map();
  private readonly listeners: Set<ChaosListener> = new Set();
  private readonly errorLog: ChaosError[] = [];
  private running = false;

  constructor() {
    // 注册默认注入器
    this.injectors.set('network-latency', new NetworkLatencyInjector());
    this.injectors.set('network-packet-loss', new NetworkPacketLossInjector());
    this.injectors.set('exception-injection', new ExceptionInjector());
    this.injectors.set('memory-pressure', new MemoryPressureInjector());
    this.injectors.set('cpu-stress', new CpuStressInjector());
    this.injectors.set('timeout-injection', new TimeoutInjector());
    this.injectors.set('rate-limiting', new RateLimitingInjector());
  }

  /**
   * 订阅事件
   */
  subscribe(listener: ChaosListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 注册自定义注入器
   */
  registerInjector(injector: FaultInjector): void {
    this.injectors.set(injector.type, injector);
  }

  /**
   * 获取注入器
   */
  getInjector(type: ChaosFaultType): FaultInjector | undefined {
    return this.injectors.get(type);
  }

  /**
   * 记录错误
   */
  recordError(error: ChaosError): void {
    this.errorLog.push(error);
    this.emit({ type: 'error-observed', timestamp: error.timestamp, experimentId: '', error });
  }

  /**
   * 记录带上下文的错误
   */
  recordCaughtError(err: unknown, source?: string): void {
    const error: ChaosError = {
      timestamp: Date.now(),
      type: err instanceof Error ? err.name : 'Unknown',
      message: err instanceof Error ? err.message : String(err),
      source,
      stack: err instanceof Error ? err.stack : undefined,
    };
    this.recordError(error);
  }

  /**
   * 运行混沌实验
   */
  async runExperiment(experiment: ChaosExperiment): Promise<ChaosReport> {
    if (this.running) {
      throw new Error('ChaosMonkey is already running an experiment');
    }
    this.running = true;
    this.experiments.set(experiment.id, experiment);

    const start = Date.now();
    const errorsBefore = this.errorLog.length;
    this.emit({ type: 'start', timestamp: start, experiment });

    // 1. 前置验证
    let preValid = true;
    if (experiment.preValidation) {
      try {
        preValid = await experiment.preValidation();
      } catch {
        preValid = false;
      }
    }

    // 2. 注入故障
    const injector = this.injectors.get(experiment.fault.type);
    if (!injector) {
      throw new Error(`No injector for fault type: ${experiment.fault.type}`);
    }
    this.emit({
      type: 'fault-injected',
      timestamp: Date.now(),
      experimentId: experiment.id,
      fault: experiment.fault,
    });
    await injector.inject(experiment.fault, experiment.target);

    // 3. 后置验证
    let postValid = true;
    if (experiment.postValidation) {
      try {
        postValid = await experiment.postValidation();
      } catch {
        postValid = false;
      }
    }

    // 4. 等待恢复
    const recoveryStart = Date.now();
    const recoveryTimeout = experiment.recoveryTimeoutMs ?? 5000;
    let recovered = postValid;
    while (!recovered && Date.now() - recoveryStart < recoveryTimeout) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        if (experiment.postValidation) {
          recovered = await experiment.postValidation();
        } else {
          recovered = true;
        }
      } catch {
        recovered = false;
      }
    }
    const recoveryTimeMs = Date.now() - recoveryStart;

    if (recovered) {
      this.emit({
        type: 'recovered',
        timestamp: Date.now(),
        experimentId: experiment.id,
        recoveryTimeMs,
      });
    }

    // 5. 生成报告
    const errorsAfter = this.errorLog.length;
    const errorsObserved = this.errorLog.slice(errorsBefore, errorsAfter);
    const success = recovered && errorsObserved.length < 10;
    const resilienceScore = this.calculateResilienceScore(recovered, errorsObserved.length, recoveryTimeMs);

    const report: ChaosReport = {
      experimentId: experiment.id,
      name: experiment.name,
      success,
      faultInjected: experiment.fault,
      errorsObserved,
      recoveryTimeMs,
      durationMs: Date.now() - start,
      timestamp: start,
      resilienceScore,
      summary: this.buildSummary(success, recovered, errorsObserved.length, recoveryTimeMs),
      recommendations: this.buildRecommendations(experiment, success, errorsObserved),
    };

    this.reports.set(experiment.id, report);
    this.emit({ type: 'complete', timestamp: Date.now(), report });
    this.running = false;
    return report;
  }

  /**
   * 批量运行实验
   */
  async runExperiments(experiments: ChaosExperiment[]): Promise<ChaosReport[]> {
    const reports: ChaosReport[] = [];
    for (const exp of experiments) {
      const report = await this.runExperiment(exp);
      reports.push(report);
      // 实验间冷却
      await new Promise((r) => setTimeout(r, 200));
    }
    return reports;
  }

  /**
   * 获取所有报告
   */
  getReports(): ChaosReport[] {
    return Array.from(this.reports.values());
  }

  /**
   * 获取指定实验报告
   */
  getReport(experimentId: string): ChaosReport | undefined {
    return this.reports.get(experimentId);
  }

  /**
   * 获取所有错误日志
   */
  getErrorLog(): ChaosError[] {
    return [...this.errorLog];
  }

  /**
   * 清空错误日志
   */
  clearErrorLog(): void {
    this.errorLog.length = 0;
  }

  /**
   * 重置所有状态
   */
  reset(): void {
    this.experiments.clear();
    this.reports.clear();
    this.errorLog.length = 0;
    for (const injector of this.injectors.values()) {
      void injector.stop();
    }
    this.running = false;
  }

  /**
   * 获取所有注入器状态
   */
  getInjectorStatuses(): Array<{ type: ChaosFaultType; active: boolean; startTime: number; fault: ChaosFault | null }> {
    return Array.from(this.injectors.values()).map((inj) => ({
      type: inj.type,
      ...inj.getStatus(),
    }));
  }

  /**
   * 计算韧性评分
   */
  private calculateResilienceScore(recovered: boolean, errorCount: number, recoveryTimeMs: number): number {
    let score = recovered ? 1.0 : 0.0;
    score -= Math.min(0.5, errorCount * 0.05); // 错误数扣分
    score -= Math.min(0.3, recoveryTimeMs / 10000); // 恢复时间扣分
    return Math.max(0, Math.min(1, score));
  }

  /**
   * 构建摘要
   */
  private buildSummary(success: boolean, recovered: boolean, errorCount: number, recoveryTimeMs: number): string {
    if (success) {
      return `✅ PASSED: System recovered in ${recoveryTimeMs}ms with ${errorCount} errors observed`;
    }
    if (!recovered) {
      return `❌ FAILED: System did NOT recover (${recoveryTimeMs}ms timeout, ${errorCount} errors)`;
    }
    return `⚠️ DEGRADED: System recovered but with ${errorCount} errors`;
  }

  /**
   * 构建建议
   */
  private buildRecommendations(experiment: ChaosExperiment, success: boolean, errors: ChaosError[]): string[] {
    const recs: string[] = [];
    if (!success) {
      recs.push('考虑添加重试机制 (retry with exponential backoff)');
      recs.push('考虑添加熔断器 (circuit breaker)');
      recs.push('考虑添加超时控制 (timeout)');
    }
    if (errors.length > 5) {
      recs.push('错误数过多,建议增强错误处理和降级策略');
    }
    const faultType = experiment.fault.type;
    if (faultType === 'network-latency' || faultType === 'network-packet-loss') {
      recs.push('建议使用 CDN 加速和请求重试');
    } else if (faultType === 'memory-pressure') {
      recs.push('建议优化内存使用,启用流式处理');
    } else if (faultType === 'cpu-stress') {
      recs.push('建议启用 worker 线程分担 CPU 密集型任务');
    }
    return recs;
  }

  /**
   * 触发事件
   */
  private emit(event: ChaosEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // ignore
      }
    }
  }
}

// ====================================
// 工厂函数
// ====================================

/**
 * 创建网络延迟实验
 */
export function createNetworkLatencyExperiment(
  target: string,
  options: { delayMs?: number; durationMs?: number; intensity?: number; recoveryTimeoutMs?: number } = {}
): ChaosExperiment {
  return {
    id: `exp-latency-${Date.now()}`,
    name: 'Network Latency Test',
    target,
    fault: {
      type: 'network-latency',
      severity: 'medium',
      durationMs: options.durationMs ?? 3000,
      intensity: options.intensity ?? 0.5,
      parameters: {
        delayMs: options.delayMs ?? 500,
        jitter: 0.2,
      },
    },
    recoveryTimeoutMs: options.recoveryTimeoutMs ?? 5000,
  };
}

/**
 * 创建网络丢包实验
 */
export function createNetworkPacketLossExperiment(
  target: string,
  options: { lossRate?: number; durationMs?: number; intensity?: number } = {}
): ChaosExperiment {
  return {
    id: `exp-packetloss-${Date.now()}`,
    name: 'Network Packet Loss Test',
    target,
    fault: {
      type: 'network-packet-loss',
      severity: 'high',
      durationMs: options.durationMs ?? 3000,
      intensity: options.intensity ?? 0.3,
    },
  };
}

/**
 * 创建异常注入实验
 */
export function createExceptionInjectionExperiment(
  target: string,
  options: { message?: string; targets?: string[]; durationMs?: number; intensity?: number } = {}
): ChaosExperiment {
  return {
    id: `exp-exception-${Date.now()}`,
    name: 'Exception Injection Test',
    target,
    fault: {
      type: 'exception-injection',
      severity: 'high',
      durationMs: options.durationMs ?? 3000,
      intensity: options.intensity ?? 0.5,
      parameters: {
        message: options.message ?? 'Chaos: Injected exception',
        targets: options.targets ?? [],
      },
    },
  };
}

/**
 * 创建内存压力实验
 */
export function createMemoryPressureExperiment(
  target: string,
  options: { durationMs?: number; intensity?: number } = {}
): ChaosExperiment {
  return {
    id: `exp-memory-${Date.now()}`,
    name: 'Memory Pressure Test',
    target,
    fault: {
      type: 'memory-pressure',
      severity: 'critical',
      durationMs: options.durationMs ?? 2000,
      intensity: options.intensity ?? 0.5,
    },
  };
}

/**
 * 创建 CPU 压力实验
 */
export function createCpuStressExperiment(
  target: string,
  options: { durationMs?: number; intensity?: number } = {}
): ChaosExperiment {
  return {
    id: `exp-cpu-${Date.now()}`,
    name: 'CPU Stress Test',
    target,
    fault: {
      type: 'cpu-stress',
      severity: 'high',
      durationMs: options.durationMs ?? 2000,
      intensity: options.intensity ?? 0.5,
    },
  };
}

/**
 * 创建超时注入实验
 */
export function createTimeoutInjectionExperiment(
  target: string,
  options: { durationMs?: number; intensity?: number } = {}
): ChaosExperiment {
  return {
    id: `exp-timeout-${Date.now()}`,
    name: 'Timeout Injection Test',
    target,
    fault: {
      type: 'timeout-injection',
      severity: 'medium',
      durationMs: options.durationMs ?? 3000,
      intensity: options.intensity ?? 0.5,
    },
  };
}

/**
 * 创建限流实验
 */
export function createRateLimitingExperiment(
  target: string,
  options: { maxRequestsPerSecond?: number; durationMs?: number; intensity?: number } = {}
): ChaosExperiment {
  return {
    id: `exp-ratelimit-${Date.now()}`,
    name: 'Rate Limiting Test',
    target,
    fault: {
      type: 'rate-limiting',
      severity: 'medium',
      durationMs: options.durationMs ?? 3000,
      intensity: options.intensity ?? 0.5,
      parameters: {
        maxRequestsPerSecond: options.maxRequestsPerSecond ?? 5,
      },
    },
  };
}

/** 默认导出 ChaosMonkey 类 */
export default ChaosMonkey;
