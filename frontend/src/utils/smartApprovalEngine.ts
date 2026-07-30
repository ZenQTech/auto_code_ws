/**
 * # ============================================================
 * # Smart Approval Engine - 智能审批引擎核心实现 (v1.0.0 Cycle 26 G26-02)
 * # ============================================================
 * # 核心作用：基于 JSON DSL 的细粒度命令/操作审批系统
 * # 运行流程：
 * #   1. 引擎维护 rules Map<id, SmartApprovalRule>
 * #   2. 加载内置规则库（40+ 安全规则）
 * #   3. request() 提交操作 -> 匹配 -> 决策 -> 审计
 * #   4. 决策支持 allow / block / prompt 三种
 * #   5. 人工 override 可覆盖决策
 * #   6. 完整审计日志 + 持久化
 * # 输入参数：addRule(), request(), override()
 * # 输出结果：ApprovalDecision + AuditLog + Event
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 26 G26-02 初次创建
 * # ============================================================
 */

import {
  SmartApprovalConfig,
  SmartApprovalRule,
  ApprovalRequest,
  ApprovalDecision,
  AuditLog,
  Decision,
  ActionType,
  MatchExpr,
  CompositeExpr,
  SmartApprovalEvent,
  SmartApprovalEventType,
  DEFAULT_SMART_APPROVAL_CONFIG,
  generateRuleId,
  generateRequestId,
  generateAuditId,
} from './smartApprovalTypes';
import { BUILTIN_SAFETY_RULES, BUILTIN_GIT_RULES, BUILTIN_FILE_RULES, BUILTIN_NETWORK_RULES, BUILTIN_TOOL_RULES } from './smartApprovalRules';

// ============ 表达式求值 ============

/**
 * 求值组合表达式
 */
export function evaluateExpression(expr: CompositeExpr, payload: string, actionType: ActionType): boolean {
  // 简单表达式
  if ('type' in expr && !('all' in expr) && !('any' in expr) && !('not' in expr)) {
    return evaluateSimple(expr, payload);
  }

  // all：全部匹配
  if ('all' in expr) {
    return (expr.all as CompositeExpr[]).every((e: CompositeExpr) => evaluateExpression(e, payload, actionType));
  }

  // any：任一匹配
  if ('any' in expr) {
    return (expr.any as CompositeExpr[]).some((e: CompositeExpr) => evaluateExpression(e, payload, actionType));
  }

  // not：不匹配
  if ('not' in expr) {
    return !evaluateExpression(expr.not as CompositeExpr, payload, actionType);
  }

  return false;
}

/**
 * 求值简单表达式
 */
export function evaluateSimple(expr: MatchExpr, payload: string): boolean {
  const caseSensitive = expr.caseSensitive ?? true;
  const value = caseSensitive ? payload : payload.toLowerCase();
  const target = caseSensitive ? expr.value : expr.value.toLowerCase();

  switch (expr.type) {
    case 'prefix':
      return value.startsWith(target);
    case 'contains':
      return value.includes(target);
    case 'regex': {
      try {
        const re = new RegExp(expr.value, expr.flags || (caseSensitive ? '' : 'i'));
        return re.test(payload);
      } catch {
        return false;
      }
    }
    case 'exact':
      return value === target;
    case 'length': {
      const len = parseInt(expr.value, 10);
      if (isNaN(len)) return false;
      return payload.length === len;
    }
    case 'cmd-in-cmd': {
      // 检查 payload 中是否嵌套了 target 命令（基于 shell 风格）
      // 简单实现：检查 target 是否作为独立 token 出现
      const tokens = payload.split(/[\s|&;()<>]+/);
      return tokens.includes(target);
    }
    default:
      return false;
  }
}

// ============ 核心引擎类 ============

/**
 * 智能审批引擎
 */
export class SmartApprovalEngine {
  private config: SmartApprovalConfig;
  private rules: Map<string, SmartApprovalRule> = new Map();
  private auditLog: AuditLog[] = [];
  private listeners: Map<string, Set<Function>> = new Map();
  private stats = { rules: 0, enabled: 0, allow: 0, block: 0, prompt: 0, overrides: 0 };
  private storageKey = 'hermes.smartApprovalEngine';
  /** 当前活动请求（用于 override） */
  private pendingRequests: Map<string, ApprovalRequest> = new Map();

  constructor(config: Partial<SmartApprovalConfig> = {}) {
    this.config = { ...DEFAULT_SMART_APPROVAL_CONFIG, ...config };
    this.loadBuiltinRules();
    if (this.config.persist) {
      this.load();
    }
  }

  // ============ 内置规则加载 ============

  private loadBuiltinRules(): void {
    const allBuiltins = [
      ...BUILTIN_SAFETY_RULES,
      ...BUILTIN_GIT_RULES,
      ...BUILTIN_FILE_RULES,
      ...BUILTIN_NETWORK_RULES,
      ...BUILTIN_TOOL_RULES,
    ];
    for (const r of allBuiltins) {
      this.rules.set(r.id, r);
    }
    this.stats.rules = this.rules.size;
    this.stats.enabled = Array.from(this.rules.values()).filter((r) => r.enabled).length;
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.rules)) {
          for (const r of data.rules) {
            if (r.author === 'user') {
              this.rules.set(r.id, r);
            }
          }
        }
        if (Array.isArray(data.auditLog)) {
          this.auditLog = data.auditLog;
        }
      }
    } catch (e) {
      console.warn('SmartApprovalEngine: failed to load from localStorage', e);
    }
  }

  private save(): void {
    if (!this.config.persist) return;
    try {
      // 仅保存用户规则
      const userRules = Array.from(this.rules.values()).filter((r) => r.author === 'user');
      const data = {
        rules: userRules,
        auditLog: this.auditLog.slice(-this.config.maxAuditLogs),
      };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (e) {
      console.warn('SmartApprovalEngine: failed to save to localStorage', e);
    }
  }

  // ============ 事件系统 ============

  on(event: SmartApprovalEventType, listener: (e: SmartApprovalEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: SmartApprovalEventType, listener: Function): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: SmartApprovalEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(event);
        } catch (err) {
          console.error(`SmartApprovalEngine: error in event handler for ${event.type}`, err);
        }
      }
    }
  }

  // ============ 规则管理 ============

  /**
   * 添加规则
   */
  addRule(input: Omit<SmartApprovalRule, 'id' | 'createdAt' | 'updatedAt'>): SmartApprovalRule {
    const now = Date.now();
    const rule: SmartApprovalRule = {
      ...input,
      id: generateRuleId(),
      createdAt: now,
      updatedAt: now,
    };
    this.rules.set(rule.id, rule);
    this.stats.rules = this.rules.size;
    this.stats.enabled = this.getEnabledRules().length;
    this.save();
    this.emit({ type: 'rule-added', rule });
    return rule;
  }

  /**
   * 更新规则
   */
  updateRule(ruleId: string, updates: Partial<SmartApprovalRule>): SmartApprovalRule | undefined {
    const rule = this.rules.get(ruleId);
    if (!rule) return undefined;
    const updated: SmartApprovalRule = {
      ...rule,
      ...updates,
      id: rule.id, // 防止修改 ID
      updatedAt: Date.now(),
    };
    this.rules.set(ruleId, updated);
    this.stats.enabled = this.getEnabledRules().length;
    this.save();
    this.emit({ type: 'rule-updated', rule: updated });
    return updated;
  }

  /**
   * 删除规则
   */
  removeRule(ruleId: string): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule) return false;
    // 不允许删除内置规则
    if (rule.author === 'system') return false;
    const removed = this.rules.delete(ruleId);
    if (removed) {
      this.stats.rules = this.rules.size;
      this.stats.enabled = this.getEnabledRules().length;
      this.save();
      this.emit({ type: 'rule-removed', ruleId });
    }
    return removed;
  }

  /**
   * 切换规则启用状态
   */
  toggleRule(ruleId: string, enabled: boolean): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule) return false;
    const updated = this.updateRule(ruleId, { enabled });
    if (updated) {
      this.emit({ type: 'rule-toggled', ruleId, enabled });
    }
    return !!updated;
  }

  /**
   * 获取规则
   */
  getRule(ruleId: string): SmartApprovalRule | undefined {
    return this.rules.get(ruleId);
  }

  /**
   * 获取所有规则
   */
  getAllRules(): SmartApprovalRule[] {
    return Array.from(this.rules.values()).sort((a, b) => b.priority - a.priority);
  }

  /**
   * 获取启用的规则
   */
  getEnabledRules(): SmartApprovalRule[] {
    return this.getAllRules().filter((r) => r.enabled);
  }

  // ============ 请求与决策 ============

  /**
   * 提交审批请求
   */
  request(actionType: ActionType, payload: string, metadata?: Record<string, unknown>, source: 'user' | 'agent' | 'system' = 'agent'): ApprovalDecision {
    const request: ApprovalRequest = {
      id: generateRequestId(),
      actionType,
      payload,
      metadata,
      timestamp: Date.now(),
      source,
    };
    this.pendingRequests.set(request.id, request);
    this.emit({ type: 'request-submitted', request });

    const startedAt = performance.now();
    const matchedRule = this.matchRequest(request);
    let decision: Decision;
    let reason: string;
    let ruleId: string | undefined;

    if (matchedRule) {
      decision = matchedRule.decision;
      reason = matchedRule.reason;
      ruleId = matchedRule.id;
    } else {
      decision = this.config.defaultDecision;
      reason = `未匹配任何规则，使用默认决策（${decision}）`;
    }

    const duration = performance.now() - startedAt;
    const approvalDecision: ApprovalDecision = {
      requestId: request.id,
      decision,
      ruleId,
      reason,
      duration,
      overridden: false,
    };

    this.recordDecision(request, approvalDecision);
    this.pendingRequests.delete(request.id);
    this.emit({ type: 'decision-made', request, decision: approvalDecision });
    return approvalDecision;
  }

  /**
   * 批量请求
   */
  requestBatch(requests: Array<{ actionType: ActionType; payload: string; metadata?: Record<string, unknown> }>): ApprovalDecision[] {
    return requests.map((r) => this.request(r.actionType, r.payload, r.metadata));
  }

  /**
   * 人工覆盖决策
   */
  override(requestId: string, decision: Decision, reason: string): boolean {
    // 在 auditLog 中查找该 request
    const log = this.auditLog.find((l) => l.request.id === requestId);
    if (!log) return false;
    log.decision.decision = decision;
    log.decision.overridden = true;
    log.decision.overrideReason = reason;
    this.stats.overrides++;
    this.save();
    this.emit({ type: 'override', requestId, reason });
    return true;
  }

  /**
   * 匹配请求到规则
   */
  matchRequest(request: ApprovalRequest): SmartApprovalRule | undefined {
    const candidates = this.getEnabledRules().filter((r) => r.actionTypes.includes(request.actionType));
    for (const rule of candidates) {
      try {
        if (evaluateExpression(rule.match, request.payload, request.actionType)) {
          return rule;
        }
      } catch (err) {
        console.error(`SmartApprovalEngine: error evaluating rule ${rule.id}`, err);
      }
    }
    return undefined;
  }

  // ============ 审计 ============

  private recordDecision(request: ApprovalRequest, decision: ApprovalDecision): void {
    if (this.config.enableAudit) {
      const log: AuditLog = {
        id: generateAuditId(),
        request,
        decision,
        timestamp: Date.now(),
      };
      this.auditLog.push(log);
      // 环形覆盖
      if (this.auditLog.length > this.config.maxAuditLogs) {
        this.auditLog.shift();
      }
    }
    this.stats[decision.decision]++;
    this.save();
  }

  /**
   * 获取审计日志
   */
  getAuditLog(filters?: { ruleId?: string; decision?: Decision; since?: number }): AuditLog[] {
    let logs = this.auditLog;
    if (filters?.ruleId) {
      logs = logs.filter((l) => l.decision.ruleId === filters.ruleId);
    }
    if (filters?.decision) {
      logs = logs.filter((l) => l.decision.decision === filters.decision);
    }
    if (filters?.since) {
      logs = logs.filter((l) => l.timestamp >= filters.since!);
    }
    return logs;
  }

  /**
   * 清空审计日志
   */
  clearAuditLog(): void {
    this.auditLog = [];
    this.save();
  }

  /**
   * 导出审计日志为 JSON
   */
  exportAuditLog(): string {
    return JSON.stringify(this.auditLog, null, 2);
  }

  // ============ 工具 ============

  /**
   * 解析规则 DSL
   */
  parseRuleDSL(dsl: string): Omit<SmartApprovalRule, 'id' | 'createdAt' | 'updatedAt'> {
    const obj = JSON.parse(dsl);
    return {
      name: obj.name,
      description: obj.description ?? '',
      actionTypes: obj.actionTypes,
      match: obj.match,
      decision: obj.decision,
      reason: obj.reason,
      priority: obj.priority ?? 50,
      enabled: obj.enabled ?? true,
      tags: obj.tags ?? [],
      author: 'user',
    };
  }

  /**
   * 序列化规则为 DSL
   */
  serializeRule(rule: SmartApprovalRule): string {
    return JSON.stringify(rule, null, 2);
  }

  /**
   * 获取统计
   */
  getStats() {
    return { ...this.stats, totalAuditLogs: this.auditLog.length };
  }

  /**
   * 重置为内置规则（清空用户规则）
   */
  resetToBuiltins(): void {
    this.rules.clear();
    this.loadBuiltinRules();
    this.save();
  }
}

// ============ 单例 ============

let _defaultEngine: SmartApprovalEngine | undefined;

export function getDefaultSmartApprovalEngine(): SmartApprovalEngine {
  if (!_defaultEngine) {
    _defaultEngine = new SmartApprovalEngine();
  }
  return _defaultEngine;
}

export function resetDefaultSmartApprovalEngine(): void {
  if (_defaultEngine) {
    _defaultEngine.resetToBuiltins();
  }
  _defaultEngine = undefined;
}
