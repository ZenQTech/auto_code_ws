/**
 * # ============================================================
 * # 多区域路由器 (Cycle 52 G52-02)
 * # ============================================================
 * # 核心作用：在多个地理区域间智能路由请求
 * # 运行流程：
 * #   1. 注册多个区域 (Region: location + endpoint + health)
 * #   2. 选择路由策略 (latency/round-robin/weighted/geo/active-active)
 * #   3. 实时健康检查 (失败自动降级)
 * #   4. 流量分配 + 重试逻辑
 * #   5. 性能指标收集 (QPS/latency/error rate per region)
 * # 输入参数：Region[] + RoutingStrategy
 * # 输出结果：RoutingReport { selectedRegion, totalRequests, successRate, regionStats }
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 52 G52-02 初次创建
 * # ====================================
 */

// ============================================================
// 类型定义
// ============================================================

/** 区域位置 */
export interface RegionLocation {
  /** 区域代码 (如 cn-north, us-east) */
  code: string;
  /** 区域名称 (如 北京, 弗吉尼亚) */
  name: string;
  /** 纬度 */
  latitude: number;
  /** 经度 */
  longitude: number;
}

/** 区域定义 */
export interface Region {
  /** 区域 ID */
  id: string;
  /** 区域位置 */
  location: RegionLocation;
  /** 端点 URL */
  endpoint: string;
  /** 权重 (1-100) */
  weight: number;
  /** 是否健康 */
  healthy: boolean;
  /** 最大并发数 */
  maxConcurrency: number;
  /** 当前活跃连接数 */
  activeConnections: number;
  /** 平均延迟 (毫秒) */
  avgLatencyMs: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/** 路由策略 */
export type RoutingStrategyType = 'latency' | 'round-robin' | 'weighted' | 'geo' | 'failover';

/** 路由策略 */
export interface RoutingStrategy {
  /** 策略类型 */
  type: RoutingStrategyType;
  /** 客户端位置 (geo 策略需要) */
  clientLocation?: RegionLocation;
  /** 健康阈值 (latency 策略的最大延迟) */
  maxLatencyMs?: number;
  /** 是否启用故障转移 */
  enableFailover: boolean;
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试退避 (毫秒) */
  retryBackoffMs: number;
}

/** 路由请求 */
export interface RoutingRequest {
  /** 请求 ID */
  id: string;
  /** 客户端位置 */
  clientLocation: RegionLocation;
  /** 路径 */
  path: string;
  /** 方法 */
  method: string;
  /** payload */
  payload?: unknown;
  /** 截止时间 */
  deadlineMs?: number;
}

/** 路由结果 */
export interface RoutingResult {
  /** 请求 ID */
  requestId: string;
  /** 选中的区域 */
  selectedRegion: Region;
  /** 是否成功 */
  success: boolean;
  /** 延迟 (毫秒) */
  latencyMs: number;
  /** HTTP 状态码 */
  statusCode?: number;
  /** 错误信息 */
  error?: string;
  /** 重试次数 */
  retries: number;
  /** 响应数据 */
  data?: unknown;
}

/** 区域统计 */
export interface RegionStats {
  /** 区域 ID */
  regionId: string;
  /** 总请求数 */
  totalRequests: number;
  /** 成功数 */
  successfulRequests: number;
  /** 失败数 */
  failedRequests: number;
  /** 平均延迟 */
  avgLatencyMs: number;
  /** P95 延迟 */
  p95LatencyMs: number;
  /** 错误率 */
  errorRate: number;
  /** 当前活跃连接 */
  activeConnections: number;
}

/** 路由报告 */
export interface RoutingReport {
  /** 报告 ID */
  id: string;
  /** 策略类型 */
  strategyType: RoutingStrategyType;
  /** 时间戳 */
  timestamp: number;
  /** 总耗时 */
  durationMs: number;
  /** 总请求数 */
  totalRequests: number;
  /** 成功请求数 */
  successfulRequests: number;
  /** 失败请求数 */
  failedRequests: number;
  /** 整体平均延迟 */
  overallAvgLatencyMs: number;
  /** 整体 P95 延迟 */
  overallP95LatencyMs: number;
  /** 整体错误率 */
  overallErrorRate: number;
  /** 各区域统计 */
  regionStats: RegionStats[];
  /** 选中的区域分布 */
  regionDistribution: Record<string, number>;
  /** 摘要 */
  summary: string;
  /** 建议 */
  recommendations: string[];
}

/** 事件 */
export type RoutingEvent =
  | { type: 'start'; timestamp: number; strategy: RoutingStrategy }
  | { type: 'region-added'; timestamp: number; region: Region }
  | { type: 'request-routed'; timestamp: number; request: RoutingRequest; region: Region }
  | { type: 'request-completed'; timestamp: number; result: RoutingResult }
  | { type: 'region-unhealthy'; timestamp: number; regionId: string; error: string }
  | { type: 'failover'; timestamp: number; fromRegion: string; toRegion: string; reason: string }
  | { type: 'complete'; timestamp: number; report: RoutingReport };

export type RoutingListener = (event: RoutingEvent) => void;

// ============================================================
// 辅助函数
// ====================================

/**
 * 计算两点间的球面距离 (Haversine 公式)
 * @returns 距离 (km)
 */
export function haversineDistance(loc1: RegionLocation, loc2: RegionLocation): number {
  const R = 6371; // 地球半径 (km)
  const dLat = ((loc2.latitude - loc1.latitude) * Math.PI) / 180;
  const dLon = ((loc2.longitude - loc1.longitude) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((loc1.latitude * Math.PI) / 180) *
      Math.cos((loc2.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 计算百分位 (线性插值)
 */
function computePercentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0]!;
  const rank = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;
  if (lower === upper) return sortedValues[lower]!;
  return sortedValues[lower]! * (1 - weight) + sortedValues[upper]! * weight;
}

// ============================================================
// MultiRegionRouter 主类
// ============================================================

export class MultiRegionRouter {
  private readonly regions: Map<string, Region> = new Map();
  private readonly strategy: RoutingStrategy;
  private readonly listeners: Set<RoutingListener> = new Set();
  private readonly latencies: Map<string, number[]> = new Map();
  private readonly successCount: Map<string, number> = new Map();
  private readonly failCount: Map<string, number> = new Map();
  private roundRobinIndex = 0;
  private running = false;
  private aborted = false;

  constructor(strategy: RoutingStrategy) {
    this.strategy = strategy;
  }

  /**
   * 添加区域
   */
  addRegion(region: Region): void {
    this.regions.set(region.id, region);
    this.latencies.set(region.id, []);
    this.successCount.set(region.id, 0);
    this.failCount.set(region.id, 0);
    this.emit({ type: 'region-added', timestamp: Date.now(), region });
  }

  /**
   * 移除区域
   */
  removeRegion(regionId: string): void {
    this.regions.delete(regionId);
    this.latencies.delete(regionId);
    this.successCount.delete(regionId);
    this.failCount.delete(regionId);
  }

  /**
   * 获取所有区域
   */
  getRegions(): Region[] {
    return Array.from(this.regions.values());
  }

  /**
   * 订阅事件
   */
  subscribe(listener: RoutingListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 选择最优区域
   */
  selectRegion(request: RoutingRequest): Region | null {
    const healthyRegions = Array.from(this.regions.values()).filter(
      (r) => r.healthy && r.activeConnections < r.maxConcurrency
    );
    if (healthyRegions.length === 0) return null;

    switch (this.strategy.type) {
      case 'latency':
        return this.selectByLatency(healthyRegions);
      case 'round-robin':
        return this.selectByRoundRobin(healthyRegions);
      case 'weighted':
        return this.selectByWeight(healthyRegions);
      case 'geo':
        return this.selectByGeo(healthyRegions, request.clientLocation);
      case 'failover':
        return this.selectByFailover(healthyRegions);
      default:
        return healthyRegions[0]!;
    }
  }

  /**
   * 路由请求 (含重试)
   */
  async route(request: RoutingRequest): Promise<RoutingResult> {
    let lastError: string | undefined;
    let retries = 0;
    let selectedRegion: Region | null = null;

    for (let attempt = 0; attempt <= this.strategy.maxRetries; attempt++) {
      selectedRegion = this.selectRegion(request);
      if (!selectedRegion) {
        return {
          requestId: request.id,
          selectedRegion: { id: 'none' } as Region,
          success: false,
          latencyMs: 0,
          error: 'No healthy region available',
          retries: attempt,
        };
      }
      this.emit({ type: 'request-routed', timestamp: Date.now(), request, region: selectedRegion });
      selectedRegion.activeConnections++;

      const result = await this.executeRequest(request, selectedRegion);
      selectedRegion.activeConnections--;

      if (result.success) {
        this.recordSuccess(selectedRegion.id, result.latencyMs);
        this.emit({ type: 'request-completed', timestamp: Date.now(), result });
        return { ...result, retries: attempt };
      }

      lastError = result.error;
      this.recordFailure(selectedRegion.id, result.latencyMs);

      // 标记区域不健康 (持续失败)
      if (this.failCount.get(selectedRegion.id)! > 5) {
        selectedRegion.healthy = false;
        this.emit({
          type: 'region-unhealthy',
          timestamp: Date.now(),
          regionId: selectedRegion.id,
          error: result.error ?? 'unknown',
        });
      }

      // 故障转移
      if (this.strategy.enableFailover && attempt < this.strategy.maxRetries) {
        const newRegion = this.selectRegion(request);
        if (newRegion && newRegion.id !== selectedRegion.id) {
          this.emit({
            type: 'failover',
            timestamp: Date.now(),
            fromRegion: selectedRegion.id,
            toRegion: newRegion.id,
            reason: result.error ?? 'request failed',
          });
        }
        retries = attempt + 1;
        await this.sleep(this.strategy.retryBackoffMs);
      } else {
        retries = attempt;
      }
    }

    return {
      requestId: request.id,
      selectedRegion: selectedRegion ?? ({ id: 'none' } as Region),
      success: false,
      latencyMs: 0,
      error: lastError ?? 'Max retries exceeded',
      retries,
    };
  }

  /**
   * 批量路由
   */
  async routeBatch(requests: RoutingRequest[]): Promise<RoutingReport> {
    if (this.running) {
      throw new Error('MultiRegionRouter is already running');
    }
    this.running = true;
    this.aborted = false;

    const start = Date.now();
    this.emit({ type: 'start', timestamp: start, strategy: this.strategy });

    const results: RoutingResult[] = [];
    for (const request of requests) {
      if (this.aborted) break;
      const result = await this.route(request);
      results.push(result);
    }

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    // 计算区域统计
    const regionStats: RegionStats[] = [];
    for (const region of this.regions.values()) {
      const latencies = this.latencies.get(region.id) ?? [];
      const totalReqs = (this.successCount.get(region.id) ?? 0) + (this.failCount.get(region.id) ?? 0);
      const successReqs = this.successCount.get(region.id) ?? 0;
      const failReqs = this.failCount.get(region.id) ?? 0;
      const sortedLatencies = [...latencies].sort((a, b) => a - b);

      regionStats.push({
        regionId: region.id,
        totalRequests: totalReqs,
        successfulRequests: successReqs,
        failedRequests: failReqs,
        avgLatencyMs: sortedLatencies.length > 0 ? sortedLatencies.reduce((s, l) => s + l, 0) / sortedLatencies.length : 0,
        p95LatencyMs: computePercentile(sortedLatencies, 95),
        errorRate: totalReqs > 0 ? failReqs / totalReqs : 0,
        activeConnections: region.activeConnections,
      });
    }

    // 整体统计
    const allLatencies = results.map((r) => r.latencyMs).filter((l) => l > 0).sort((a, b) => a - b);
    const overallAvgLatency = allLatencies.length > 0 ? allLatencies.reduce((s, l) => s + l, 0) / allLatencies.length : 0;
    const overallP95Latency = computePercentile(allLatencies, 95);

    // 区域分布
    const regionDistribution: Record<string, number> = {};
    for (const r of results) {
      regionDistribution[r.selectedRegion.id] = (regionDistribution[r.selectedRegion.id] ?? 0) + 1;
    }

    const report: RoutingReport = {
      id: `report-${Date.now()}`,
      strategyType: this.strategy.type,
      timestamp: start,
      durationMs: Date.now() - start,
      totalRequests: results.length,
      successfulRequests: successful.length,
      failedRequests: failed.length,
      overallAvgLatencyMs: overallAvgLatency,
      overallP95LatencyMs: overallP95Latency,
      overallErrorRate: results.length > 0 ? failed.length / results.length : 0,
      regionStats,
      regionDistribution,
      summary: this.buildSummary(results, regionStats),
      recommendations: this.buildRecommendations(regionStats),
    };

    this.running = false;
    this.emit({ type: 'complete', timestamp: Date.now(), report });
    return report;
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

  private selectByLatency(regions: Region[]): Region {
    const maxLatency = this.strategy.maxLatencyMs ?? 1000;
    const eligible = regions.filter((r) => r.avgLatencyMs <= maxLatency);
    if (eligible.length === 0) return regions.sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)[0]!;
    return eligible.sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)[0]!;
  }

  private selectByRoundRobin(regions: Region[]): Region {
    const region = regions[this.roundRobinIndex % regions.length]!;
    this.roundRobinIndex++;
    return region;
  }

  private selectByWeight(regions: Region[]): Region {
    const totalWeight = regions.reduce((s, r) => s + r.weight, 0);
    let random = Math.random() * totalWeight;
    for (const region of regions) {
      random -= region.weight;
      if (random <= 0) return region;
    }
    return regions[regions.length - 1]!;
  }

  private selectByGeo(regions: Region[], client: RegionLocation): Region {
    return regions.sort((a, b) => {
      const distA = haversineDistance(a.location, client);
      const distB = haversineDistance(b.location, client);
      return distA - distB;
    })[0]!;
  }

  private selectByFailover(regions: Region[]): Region {
    // 优先选择第一个健康区域 (按 ID 顺序)
    return regions.sort((a, b) => a.id.localeCompare(b.id))[0]!;
  }

  private async executeRequest(request: RoutingRequest, region: Region): Promise<RoutingResult> {
    const start = Date.now();
    try {
      // 模拟请求执行 (真实实现应调用 region.endpoint)
      const latency = region.avgLatencyMs > 0 ? region.avgLatencyMs : 50 + Math.random() * 100;
      await this.sleep(latency);
      return {
        requestId: request.id,
        selectedRegion: region,
        success: true,
        latencyMs: Date.now() - start,
        statusCode: 200,
        retries: 0,
        data: { region: region.id, path: request.path },
      };
    } catch (err) {
      return {
        requestId: request.id,
        selectedRegion: region,
        success: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
        retries: 0,
      };
    }
  }

  private recordSuccess(regionId: string, latencyMs: number): void {
    this.successCount.set(regionId, (this.successCount.get(regionId) ?? 0) + 1);
    const latencies = this.latencies.get(regionId) ?? [];
    latencies.push(latencyMs);
    // 保留最近 1000 个样本
    if (latencies.length > 1000) latencies.shift();
    this.latencies.set(regionId, latencies);
    const region = this.regions.get(regionId);
    if (region) {
      region.avgLatencyMs = latencies.reduce((s, l) => s + l, 0) / latencies.length;
    }
  }

  private recordFailure(regionId: string, latencyMs: number): void {
    this.failCount.set(regionId, (this.failCount.get(regionId) ?? 0) + 1);
    const latencies = this.latencies.get(regionId) ?? [];
    latencies.push(latencyMs);
    if (latencies.length > 1000) latencies.shift();
    this.latencies.set(regionId, latencies);
  }

  private buildSummary(results: RoutingResult[], regionStats: RegionStats[]): string {
    const successful = results.filter((r) => r.success).length;
    const total = results.length;
    const successRate = total > 0 ? ((successful / total) * 100).toFixed(1) : '0';
    const healthyRegions = regionStats.filter((s) => s.errorRate < 0.1).length;
    return `✅ ROUTED - ${successful}/${total} requests succeeded (${successRate}%) | ${healthyRegions}/${regionStats.length} regions healthy`;
  }

  private buildRecommendations(regionStats: RegionStats[]): string[] {
    const recs: string[] = [];
    for (const stats of regionStats) {
      if (stats.errorRate > 0.1) {
        recs.push(`[${stats.regionId}] 错误率过高 (${(stats.errorRate * 100).toFixed(1)}%), 检查网络或服务健康`);
      }
      if (stats.p95LatencyMs > 500) {
        recs.push(`[${stats.regionId}] P95 延迟过高 (${stats.p95LatencyMs.toFixed(0)}ms), 考虑扩容或优化`);
      }
      if (stats.activeConnections >= stats.totalRequests) {
        recs.push(`[${stats.regionId}] 活跃连接数接近上限, 考虑扩容`);
      }
    }
    if (recs.length === 0) {
      recs.push('所有区域表现良好, 继续监控');
    }
    return recs;
  }

  private emit(event: RoutingEvent): void {
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

/** 创建默认区域 (预置 3 个示例) */
export function createDefaultRegions(): Region[] {
  return [
    {
      id: 'cn-north-1',
      location: { code: 'cn-north-1', name: '北京', latitude: 39.9042, longitude: 116.4074 },
      endpoint: 'https://cn-north-1.example.com',
      weight: 40,
      healthy: true,
      maxConcurrency: 1000,
      activeConnections: 0,
      avgLatencyMs: 50,
    },
    {
      id: 'cn-east-1',
      location: { code: 'cn-east-1', name: '上海', latitude: 31.2304, longitude: 121.4737 },
      endpoint: 'https://cn-east-1.example.com',
      weight: 30,
      healthy: true,
      maxConcurrency: 1000,
      activeConnections: 0,
      avgLatencyMs: 60,
    },
    {
      id: 'us-east-1',
      location: { code: 'us-east-1', name: 'Virginia', latitude: 38.9072, longitude: -77.0369 },
      endpoint: 'https://us-east-1.example.com',
      weight: 20,
      healthy: true,
      maxConcurrency: 500,
      activeConnections: 0,
      avgLatencyMs: 200,
    },
  ];
}

/** 创建默认路由策略 */
export function createDefaultRoutingStrategy(type: RoutingStrategyType = 'geo'): RoutingStrategy {
  return {
    type,
    maxLatencyMs: 500,
    enableFailover: true,
    maxRetries: 3,
    retryBackoffMs: 100,
  };
}
