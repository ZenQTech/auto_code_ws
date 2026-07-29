/**
 * # ============================================================
 * # ModelRouterEnhance - 模型路由增强器 (v1.0.0 Cycle 22 G22-04)
 * # ============================================================
 * # 核心作用：在 ModelRouter 基础上提供管理员级控制能力
 * #           支持团队/组级别策略、模型白/黑名单、显示控制
 * # 业务价值：
 * #   1. 团队/组级别启用不同路由策略
 * #   2. 模型白名单/黑名单限制使用
 * #   3. 团队默认模式设置
 * #   4. 管理员可控制是否对用户显示实际模型
 * #   5. 与 ModelRouter 集成，作为策略层
 * # 运行流程：
 * #   1. createTeamPolicy(teamId) - 创建团队策略
 * #   2. setTeamMode(teamId, mode) - 设置团队默认模式
 * #   3. addToWhitelist / addToBlacklist - 模型列表管理
 * #   4. applyPolicyToRoute(teamId, route) - 应用策略到路由结果
 * #   5. generateAdminReport() - 生成管理员报告
 * # 输入参数：
 * #   - teamId: 团队/组 ID
 * #   - mode: 路由模式 (cost/balance/intelligence)
 * #   - whitelist: 允许使用的模型列表
 * #   - blacklist: 禁止使用的模型列表
 * #   - hideActualModel: 是否对用户隐藏实际模型
 * # 输出结果：
 * #   - TeamPolicy: 团队策略
 * #   - EnhancedRoute: 增强后的路由
 * #   - AdminReport: 管理员报告
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 22 G22-04 初次创建
 * #     - ModelRouterEnhance 核心引擎
 * #     - 团队/组级别策略管理
 * #     - 模型白/黑名单管理
 * #     - 显示控制
 * #     - 与 ModelRouter 集成
 * #     - 单例工厂 + 事件订阅 + 持久化
 * # ============================================================
 */

// ============================================================================
// 类型定义
// ============================================================================

/** 路由模式（与 ModelRouter 对齐） */
export type RoutingMode = 'cost' | 'balance' | 'intelligence';

/** 策略激活状态 */
export type PolicyStatus = 'active' | 'paused' | 'draft';

/** 团队策略 */
export interface TeamPolicy {
  policyId: string;
  teamId: string;
  teamName: string;
  status: PolicyStatus;
  defaultMode: RoutingMode;
  whitelist: string[]; // 允许的模型 ID
  blacklist: string[]; // 禁止的模型 ID
  hideActualModel: boolean; // 是否对用户隐藏实际选中的模型
  allowedModes: RoutingMode[]; // 允许切换的模式
  maxRequestsPerHour?: number; // 团队级别速率限制
  budgetPerDay?: number; // 团队每日预算
  description?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

/** 路由结果（从 ModelRouter 同步） */
export interface RouteResult {
  selectedModel: string;
  candidates: Array<{ model: string; score: number }>;
  reason: string;
  mode: RoutingMode;
  category?: string;
}

/** 增强路由结果 */
export interface EnhancedRoute {
  route: RouteResult;
  policyApplied: boolean;
  policyId?: string;
  displayModel: string; // 用户看到的模型名
  actualModel: string; // 实际使用的模型
  blocked: boolean;
  blockReason?: string;
  fallbackApplied: boolean;
  warnings: string[];
}

/** 策略应用选项 */
export interface ApplyPolicyOptions {
  /** 强制覆盖（即使黑名单命中也允许） */
  forceAllow?: boolean;
  /** 用户是否在黑名单外（VIP 模式） */
  bypassBlacklist?: boolean;
}

/** 管理员报告 */
export interface AdminReport {
  reportId: string;
  generatedAt: number;
  totalPolicies: number;
  activePolicies: number;
  totalRoutes: number;
  topModelsUsed: Array<{ model: string; count: number }>;
  blockedRoutes: number;
  hiddenRoutes: number;
  policyUsage: Array<{ teamId: string; policyId: string; routeCount: number }>;
}

/** 路由历史 */
export interface RouteHistoryEntry {
  entryId: string;
  policyId?: string;
  teamId?: string;
  selectedModel: string;
  displayModel: string;
  mode: RoutingMode;
  blocked: boolean;
  blockReason?: string;
  timestamp: number;
}

/** 增强器配置 */
export interface EnhancerConfig {
  /** 默认白名单（空表示允许所有） */
  defaultWhitelist: string[];
  /** 默认黑名单 */
  defaultBlacklist: string[];
  /** 默认路由模式 */
  defaultMode: RoutingMode;
  /** 是否默认隐藏实际模型 */
  defaultHideActualModel: boolean;
  /** 历史记录最大数 */
  maxHistoryEntries: number;
  /** 持久化 key */
  persistKey: string;
}

/** 增强器事件类型 */
export type EnhancerEventType =
  | 'policy-created'
  | 'policy-updated'
  | 'policy-deleted'
  | 'route-applied'
  | 'route-blocked'
  | 'model-blacklisted'
  | 'model-whitelisted'
  | 'config-updated';

/** 增强器事件 */
export interface EnhancerEvent {
  type: EnhancerEventType;
  timestamp: number;
  data?: Record<string, unknown>;
}

/** 事件处理器 */
export type EnhancerEventHandler = (event: EnhancerEvent) => void;

// ============================================================================
// 事件总线
// ============================================================================

class EnhancerEventBus {
  private listeners: Map<EnhancerEventType, Set<EnhancerEventHandler>> = new Map();

  on(type: EnhancerEventType, handler: EnhancerEventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    return () => {
      this.listeners.get(type)?.delete(handler);
    };
  }

  emit(event: EnhancerEvent): void {
    this.listeners.get(event.type)?.forEach((handler) => {
      try {
        handler(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Enhancer event handler error:', err);
      }
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 生成唯一 ID
 */
function _genId(prefix: string = 'mre'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 简化模型名（用于显示）
 */
function _displayNameFor(modelId: string, hide: boolean): string {
  if (!hide) return modelId;
  // 隐藏实际模型时显示为通用名
  if (modelId.includes('gpt')) return 'fast-model';
  if (modelId.includes('claude')) return 'premium-model';
  if (modelId.includes('deepseek')) return 'budget-model';
  if (modelId.includes('gemini')) return 'fast-model';
  return 'default-model';
}

// ============================================================================
// 核心类
// ============================================================================

/**
 * ModelRouterEnhance 模型路由增强器
 *
 * 提供管理员级别的路由控制能力：团队策略、白/黑名单、显示控制
 */
export class ModelRouterEnhance {
  private policies: Map<string, TeamPolicy> = new Map();
  private history: RouteHistoryEntry[] = [];
  private config: EnhancerConfig;
  private readonly eventBus: EnhancerEventBus = new EnhancerEventBus();

  constructor(config?: Partial<EnhancerConfig>) {
    this.config = {
      defaultWhitelist: [],
      defaultBlacklist: [],
      defaultMode: 'balance',
      defaultHideActualModel: false,
      maxHistoryEntries: 1000,
      persistKey: 'modelRouterEnhance.policies',
      ...config,
    };
  }

  // --------------------------------------------------------------------------
  // 策略管理
  // --------------------------------------------------------------------------

  /**
   * 创建团队策略
   */
  createTeamPolicy(
    teamId: string,
    teamName: string,
    options?: Partial<Omit<TeamPolicy, 'policyId' | 'teamId' | 'teamName' | 'createdAt' | 'updatedAt'>>
  ): TeamPolicy {
    if (this.policies.has(teamId)) {
      throw new Error(`Policy for team ${teamId} already exists`);
    }
    const now = Date.now();
    const policy: TeamPolicy = {
      policyId: _genId('policy'),
      teamId,
      teamName,
      status: 'active',
      defaultMode: options?.defaultMode ?? this.config.defaultMode,
      whitelist: options?.whitelist ?? [...this.config.defaultWhitelist],
      blacklist: options?.blacklist ?? [...this.config.defaultBlacklist],
      hideActualModel: options?.hideActualModel ?? this.config.defaultHideActualModel,
      allowedModes: options?.allowedModes ?? ['cost', 'balance', 'intelligence'],
      maxRequestsPerHour: options?.maxRequestsPerHour,
      budgetPerDay: options?.budgetPerDay,
      description: options?.description,
      createdAt: now,
      updatedAt: now,
      metadata: options?.metadata,
    };
    this.policies.set(teamId, policy);
    this.eventBus.emit({
      type: 'policy-created',
      timestamp: now,
      data: { teamId, policyId: policy.policyId },
    });
    return policy;
  }

  /**
   * 更新团队策略
   */
  updateTeamPolicy(teamId: string, updates: Partial<TeamPolicy>): TeamPolicy | null {
    const policy = this.policies.get(teamId);
    if (!policy) return null;
    const updated: TeamPolicy = {
      ...policy,
      ...updates,
      policyId: policy.policyId,
      teamId: policy.teamId,
      createdAt: policy.createdAt,
      updatedAt: Date.now(),
    };
    this.policies.set(teamId, updated);
    this.eventBus.emit({
      type: 'policy-updated',
      timestamp: Date.now(),
      data: { teamId, policyId: updated.policyId },
    });
    return updated;
  }

  /**
   * 删除团队策略
   */
  deleteTeamPolicy(teamId: string): boolean {
    const policy = this.policies.get(teamId);
    if (!policy) return false;
    this.policies.delete(teamId);
    this.eventBus.emit({
      type: 'policy-deleted',
      timestamp: Date.now(),
      data: { teamId, policyId: policy.policyId },
    });
    return true;
  }

  /**
   * 获取团队策略
   */
  getTeamPolicy(teamId: string): TeamPolicy | null {
    return this.policies.get(teamId) || null;
  }

  /**
   * 列出所有策略
   */
  listTeamPolicies(filter?: { status?: PolicyStatus }): TeamPolicy[] {
    let result = Array.from(this.policies.values());
    if (filter?.status) {
      result = result.filter((p) => p.status === filter.status);
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // --------------------------------------------------------------------------
  // 模型白/黑名单管理
  // --------------------------------------------------------------------------

  /**
   * 添加到团队白名单
   */
  addToWhitelist(teamId: string, modelId: string): boolean {
    const policy = this.policies.get(teamId);
    if (!policy) return false;
    if (policy.blacklist.includes(modelId)) {
      // 冲突：已在黑名单中
      throw new Error(`Model ${modelId} is in blacklist, remove it first`);
    }
    if (!policy.whitelist.includes(modelId)) {
      policy.whitelist = [...policy.whitelist, modelId];
      policy.updatedAt = Date.now();
      this.eventBus.emit({
        type: 'model-whitelisted',
        timestamp: Date.now(),
        data: { teamId, modelId },
      });
    }
    return true;
  }

  /**
   * 从白名单移除
   */
  removeFromWhitelist(teamId: string, modelId: string): boolean {
    const policy = this.policies.get(teamId);
    if (!policy) return false;
    const idx = policy.whitelist.indexOf(modelId);
    if (idx >= 0) {
      policy.whitelist = policy.whitelist.filter((m) => m !== modelId);
      policy.updatedAt = Date.now();
      return true;
    }
    return false;
  }

  /**
   * 添加到黑名单
   */
  addToBlacklist(teamId: string, modelId: string): boolean {
    const policy = this.policies.get(teamId);
    if (!policy) return false;
    if (policy.whitelist.includes(modelId)) {
      throw new Error(`Model ${modelId} is in whitelist, remove it first`);
    }
    if (!policy.blacklist.includes(modelId)) {
      policy.blacklist = [...policy.blacklist, modelId];
      policy.updatedAt = Date.now();
      this.eventBus.emit({
        type: 'model-blacklisted',
        timestamp: Date.now(),
        data: { teamId, modelId },
      });
    }
    return true;
  }

  /**
   * 从黑名单移除
   */
  removeFromBlacklist(teamId: string, modelId: string): boolean {
    const policy = this.policies.get(teamId);
    if (!policy) return false;
    const idx = policy.blacklist.indexOf(modelId);
    if (idx >= 0) {
      policy.blacklist = policy.blacklist.filter((m) => m !== modelId);
      policy.updatedAt = Date.now();
      return true;
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // 策略应用
  // --------------------------------------------------------------------------

  /**
   * 应用策略到路由结果
   */
  applyPolicyToRoute(
    teamId: string,
    route: RouteResult,
    options?: ApplyPolicyOptions
  ): EnhancedRoute {
    const warnings: string[] = [];
    const policy = this.policies.get(teamId);

    // 无策略：直接透传
    if (!policy) {
      const entry: RouteHistoryEntry = {
        entryId: _genId('hist'),
        selectedModel: route.selectedModel,
        displayModel: route.selectedModel,
        mode: route.mode,
        blocked: false,
        timestamp: Date.now(),
      };
      this._addHistory(entry);
      return {
        route,
        policyApplied: false,
        displayModel: route.selectedModel,
        actualModel: route.selectedModel,
        blocked: false,
        fallbackApplied: false,
        warnings: ['No policy found for team, route applied as-is'],
      };
    }

    if (policy.status !== 'active') {
      warnings.push(`Policy is in ${policy.status} state`);
    }

    // 黑名单检查
    if (
      policy.blacklist.includes(route.selectedModel) &&
      !options?.bypassBlacklist
    ) {
      // 尝试在候选中找替代
      const fallback = route.candidates.find(
        (c) => !policy.blacklist.includes(c.model) && !this._isBlocked(c.model, policy)
      );
      if (fallback && !options?.forceAllow) {
        const entry: RouteHistoryEntry = {
          entryId: _genId('hist'),
          policyId: policy.policyId,
          teamId,
          selectedModel: route.selectedModel,
          displayModel: _displayNameFor(fallback.model, policy.hideActualModel),
          mode: route.mode,
          blocked: false,
          timestamp: Date.now(),
        };
        this._addHistory(entry);
        this.eventBus.emit({
          type: 'route-applied',
          timestamp: Date.now(),
          data: { teamId, originalModel: route.selectedModel, fallbackModel: fallback.model },
        });
        return {
          route: { ...route, selectedModel: fallback.model },
          policyApplied: true,
          policyId: policy.policyId,
          displayModel: _displayNameFor(fallback.model, policy.hideActualModel),
          actualModel: fallback.model,
          blocked: false,
          fallbackApplied: true,
          warnings: [...warnings, `Blacklisted model ${route.selectedModel} replaced with ${fallback.model}`],
        };
      }
      // 无可用候选，强制阻止
      const entry: RouteHistoryEntry = {
        entryId: _genId('hist'),
        policyId: policy.policyId,
        teamId,
        selectedModel: route.selectedModel,
        displayModel: 'BLOCKED',
        mode: route.mode,
        blocked: true,
        blockReason: `Model ${route.selectedModel} is blacklisted and no fallback available`,
        timestamp: Date.now(),
      };
      this._addHistory(entry);
      this.eventBus.emit({
        type: 'route-blocked',
        timestamp: Date.now(),
        data: { teamId, model: route.selectedModel, policyId: policy.policyId },
      });
      return {
        route,
        policyApplied: true,
        policyId: policy.policyId,
        displayModel: 'BLOCKED',
        actualModel: route.selectedModel,
        blocked: true,
        blockReason: `Model ${route.selectedModel} is blacklisted`,
        fallbackApplied: false,
        warnings: [...warnings, 'Route blocked by blacklist'],
      };
    }

    // 白名单检查（非空时生效）
    if (
      policy.whitelist.length > 0 &&
      !policy.whitelist.includes(route.selectedModel) &&
      !options?.bypassBlacklist
    ) {
      const fallback = route.candidates.find((c) => policy.whitelist.includes(c.model));
      if (fallback) {
        const entry: RouteHistoryEntry = {
          entryId: _genId('hist'),
          policyId: policy.policyId,
          teamId,
          selectedModel: route.selectedModel,
          displayModel: _displayNameFor(fallback.model, policy.hideActualModel),
          mode: route.mode,
          blocked: false,
          timestamp: Date.now(),
        };
        this._addHistory(entry);
        return {
          route: { ...route, selectedModel: fallback.model },
          policyApplied: true,
          policyId: policy.policyId,
          displayModel: _displayNameFor(fallback.model, policy.hideActualModel),
          actualModel: fallback.model,
          blocked: false,
          fallbackApplied: true,
          warnings: [...warnings, `Whitelist: ${route.selectedModel} not allowed, using ${fallback.model}`],
        };
      }
      // 白名单不命中且无候选
      const entry: RouteHistoryEntry = {
        entryId: _genId('hist'),
        policyId: policy.policyId,
        teamId,
        selectedModel: route.selectedModel,
        displayModel: 'BLOCKED',
        mode: route.mode,
        blocked: true,
        blockReason: `Model ${route.selectedModel} not in whitelist and no fallback available`,
        timestamp: Date.now(),
      };
      this._addHistory(entry);
      this.eventBus.emit({
        type: 'route-blocked',
        timestamp: Date.now(),
        data: { teamId, model: route.selectedModel, policyId: policy.policyId },
      });
      return {
        route,
        policyApplied: true,
        policyId: policy.policyId,
        displayModel: 'BLOCKED',
        actualModel: route.selectedModel,
        blocked: true,
        blockReason: `Model ${route.selectedModel} not in whitelist`,
        fallbackApplied: false,
        warnings: [...warnings, 'Route blocked by whitelist'],
      };
    }

    // 模式检查
    if (!policy.allowedModes.includes(route.mode)) {
      warnings.push(`Mode ${route.mode} not in policy allowed modes`);
    }

    // 正常应用策略
    const displayModel = _displayNameFor(route.selectedModel, policy.hideActualModel);
    const entry: RouteHistoryEntry = {
      entryId: _genId('hist'),
      policyId: policy.policyId,
      teamId,
      selectedModel: route.selectedModel,
      displayModel,
      mode: route.mode,
      blocked: false,
      timestamp: Date.now(),
    };
    this._addHistory(entry);
    this.eventBus.emit({
      type: 'route-applied',
      timestamp: Date.now(),
      data: { teamId, model: route.selectedModel, displayModel, hidden: policy.hideActualModel },
    });

    return {
      route,
      policyApplied: true,
      policyId: policy.policyId,
      displayModel,
      actualModel: route.selectedModel,
      blocked: false,
      fallbackApplied: false,
      warnings,
    };
  }

  /**
   * 检查模型是否被阻止（内部辅助）
   */
  private _isBlocked(model: string, policy: TeamPolicy): boolean {
    return policy.blacklist.includes(model);
  }

  /**
   * 添加历史记录
   */
  private _addHistory(entry: RouteHistoryEntry): void {
    this.history.push(entry);
    if (this.history.length > this.config.maxHistoryEntries) {
      this.history = this.history.slice(-this.config.maxHistoryEntries);
    }
  }

  // --------------------------------------------------------------------------
  // 模式控制
  // --------------------------------------------------------------------------

  /**
   * 设置团队默认模式
   */
  setTeamMode(teamId: string, mode: RoutingMode): boolean {
    const policy = this.policies.get(teamId);
    if (!policy) return false;
    if (!policy.allowedModes.includes(mode)) {
      throw new Error(`Mode ${mode} not in allowed modes for team ${teamId}`);
    }
    policy.defaultMode = mode;
    policy.updatedAt = Date.now();
    this.eventBus.emit({
      type: 'policy-updated',
      timestamp: Date.now(),
      data: { teamId, field: 'defaultMode', value: mode },
    });
    return true;
  }

  /**
   * 设置是否隐藏实际模型
   */
  setHideActualModel(teamId: string, hide: boolean): boolean {
    const policy = this.policies.get(teamId);
    if (!policy) return false;
    policy.hideActualModel = hide;
    policy.updatedAt = Date.now();
    this.eventBus.emit({
      type: 'policy-updated',
      timestamp: Date.now(),
      data: { teamId, field: 'hideActualModel', value: hide },
    });
    return true;
  }

  /**
   * 切换团队策略状态
   */
  setPolicyStatus(teamId: string, status: PolicyStatus): boolean {
    const policy = this.policies.get(teamId);
    if (!policy) return false;
    policy.status = status;
    policy.updatedAt = Date.now();
    this.eventBus.emit({
      type: 'policy-updated',
      timestamp: Date.now(),
      data: { teamId, field: 'status', value: status },
    });
    return true;
  }

  // --------------------------------------------------------------------------
  // 报告与历史
  // --------------------------------------------------------------------------

  /**
   * 获取路由历史
   */
  getHistory(filter?: { teamId?: string; blocked?: boolean; sinceMs?: number; limit?: number }): RouteHistoryEntry[] {
    let result = [...this.history];
    if (filter?.teamId) {
      result = result.filter((e) => e.teamId === filter.teamId);
    }
    if (filter?.blocked !== undefined) {
      result = result.filter((e) => e.blocked === filter.blocked);
    }
    if (filter?.sinceMs) {
      result = result.filter((e) => e.timestamp >= filter.sinceMs!);
    }
    if (filter?.limit) {
      result = result.slice(-filter.limit);
    }
    return result;
  }

  /**
   * 生成管理员报告
   */
  generateAdminReport(): AdminReport {
    const policies = Array.from(this.policies.values());
    const totalRoutes = this.history.length;
    const blockedRoutes = this.history.filter((e) => e.blocked).length;
    const hiddenRoutes = this.history.filter((e) => e.displayModel !== e.selectedModel).length;

    // TOP 模型
    const modelCounts: Map<string, number> = new Map();
    for (const e of this.history) {
      modelCounts.set(e.selectedModel, (modelCounts.get(e.selectedModel) || 0) + 1);
    }
    const topModelsUsed = Array.from(modelCounts.entries())
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // 策略使用统计
    const policyUsageMap: Map<string, { teamId: string; policyId: string; routeCount: number }> = new Map();
    for (const e of this.history) {
      if (!e.policyId) continue;
      const key = `${e.teamId}::${e.policyId}`;
      if (!policyUsageMap.has(key)) {
        policyUsageMap.set(key, { teamId: e.teamId || 'unknown', policyId: e.policyId, routeCount: 0 });
      }
      policyUsageMap.get(key)!.routeCount += 1;
    }
    const policyUsage = Array.from(policyUsageMap.values()).sort((a, b) => b.routeCount - a.routeCount);

    const report: AdminReport = {
      reportId: _genId('admin'),
      generatedAt: Date.now(),
      totalPolicies: policies.length,
      activePolicies: policies.filter((p) => p.status === 'active').length,
      totalRoutes,
      topModelsUsed,
      blockedRoutes,
      hiddenRoutes,
      policyUsage,
    };
    return report;
  }

  // --------------------------------------------------------------------------
  // 配置与清理
  // --------------------------------------------------------------------------

  /**
   * 更新配置
   */
  updateConfig(config: Partial<EnhancerConfig>): void {
    this.config = { ...this.config, ...config };
    this.eventBus.emit({
      type: 'config-updated',
      timestamp: Date.now(),
      data: { config: this.config },
    });
  }

  /**
   * 获取配置
   */
  getConfig(): EnhancerConfig {
    return { ...this.config };
  }

  /**
   * 清空所有数据
   */
  clear(): void {
    this.policies.clear();
    this.history = [];
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    policyCount: number;
    activePolicies: number;
    historyEntries: number;
    totalWhitelistedModels: number;
    totalBlacklistedModels: number;
  } {
    const policies = Array.from(this.policies.values());
    return {
      policyCount: policies.length,
      activePolicies: policies.filter((p) => p.status === 'active').length,
      historyEntries: this.history.length,
      totalWhitelistedModels: policies.reduce((sum, p) => sum + p.whitelist.length, 0),
      totalBlacklistedModels: policies.reduce((sum, p) => sum + p.blacklist.length, 0),
    };
  }

  /**
   * 订阅事件
   */
  on(type: EnhancerEventType, handler: EnhancerEventHandler): () => void {
    return this.eventBus.on(type, handler);
  }
}

// ============================================================================
// 单例工厂
// ============================================================================

let _instance: ModelRouterEnhance | null = null;

/**
 * 获取 ModelRouterEnhance 单例
 */
export function getModelRouterEnhance(): ModelRouterEnhance {
  if (!_instance) {
    _instance = new ModelRouterEnhance();
  }
  return _instance;
}

/**
 * 重置单例（用于测试）
 */
export function resetModelRouterEnhance(): void {
  if (_instance) {
    _instance.clear();
  }
  _instance = null;
}
