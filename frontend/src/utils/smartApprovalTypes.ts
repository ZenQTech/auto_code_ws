/**
 * # ============================================================
 * # Smart Approval Engine Types - 智能审批引擎类型定义 (v1.0.0 Cycle 26 G26-02)
 * # ============================================================
 * # 核心作用：定义智能审批引擎的所有类型、决策、规则、审计
 * # 主要功能：
 * #   1. 10 种操作类型（shell/file/api/network/tool/subagent）
 * #   2. 6 种匹配类型（prefix/contains/regex/exact/length/cmd-in-cmd）
 * #   3. 4 种组合逻辑（all/any/not/simple）
 * #   4. 3 种决策（allow/block/prompt）
 * #   5. 完整审计日志 + 人工覆盖
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 26 G26-02 初次创建
 * # ============================================================
 */

// ============ 决策与操作类型 ============

/** 决策类型 */
export type Decision = 'allow' | 'block' | 'prompt';

/** 操作类型 */
export type ActionType =
  | 'shell'        // shell 命令
  | 'file:read'    // 读文件
  | 'file:write'   // 写文件
  | 'file:delete'  // 删文件
  | 'api:get'      // GET 请求
  | 'api:post'     // POST 请求
  | 'api:delete'   // DELETE 请求
  | 'network'      // 网络请求
  | 'tool'         // 工具调用
  | 'subagent';    // 子智能体派发

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  'shell': 'Shell 命令',
  'file:read': '文件读取',
  'file:write': '文件写入',
  'file:delete': '文件删除',
  'api:get': 'API GET',
  'api:post': 'API POST',
  'api:delete': 'API DELETE',
  'network': '网络请求',
  'tool': '工具调用',
  'subagent': '子智能体',
};

export const ACTION_TYPE_ICONS: Record<ActionType, string> = {
  'shell': '💻',
  'file:read': '📖',
  'file:write': '✏️',
  'file:delete': '🗑️',
  'api:get': '⬇️',
  'api:post': '⬆️',
  'api:delete': '❌',
  'network': '🌐',
  'tool': '🔧',
  'subagent': '🤖',
};

// ============ 匹配类型 ============

/** 匹配类型 */
export type MatchType =
  | 'prefix'       // 前缀匹配
  | 'contains'     // 包含
  | 'regex'        // 正则
  | 'exact'        // 完全相等
  | 'length'       // 长度
  | 'cmd-in-cmd';  // 命令嵌套

export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  prefix: '前缀匹配',
  contains: '包含',
  regex: '正则',
  exact: '完全相等',
  length: '长度',
  'cmd-in-cmd': '命令嵌套',
};

// ============ 表达式 ============

/** 简单匹配表达式 */
export interface MatchExpr {
  type: MatchType;
  value: string;
  flags?: string;
  caseSensitive?: boolean;
}

/** 组合表达式 */
export type CompositeExpr =
  | { all: CompositeExpr[] }
  | { any: CompositeExpr[] }
  | { not: CompositeExpr }
  | (MatchExpr & { type: MatchType });

// ============ 规则 ============

/** 智能审批规则 */
export interface SmartApprovalRule {
  id: string;
  name: string;
  description: string;
  /** 适用操作类型 */
  actionTypes: ActionType[];
  /** 匹配表达式 */
  match: CompositeExpr;
  /** 决策 */
  decision: Decision;
  /** 原因 */
  reason: string;
  /** 优先级（数字越大越优先） */
  priority: number;
  /** 启用 */
  enabled: boolean;
  /** 创建时间 */
  createdAt: number;
  /** 修改时间 */
  updatedAt: number;
  /** 标签（分类用） */
  tags: string[];
  /** 作者（系统/用户） */
  author: 'system' | 'user';
}

export const DECISION_LABELS: Record<Decision, string> = {
  allow: '放行',
  block: '阻断',
  prompt: '询问',
};

export const DECISION_ICONS: Record<Decision, string> = {
  allow: '✅',
  block: '🚫',
  prompt: '⚠️',
};

export const DECISION_COLORS: Record<Decision, string> = {
  allow: '#10b981',
  block: '#ef4444',
  prompt: '#f59e0b',
};

// ============ 请求与决策 ============

/** 审批请求 */
export interface ApprovalRequest {
  id: string;
  actionType: ActionType;
  payload: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
  source: 'user' | 'agent' | 'system';
}

/** 审批决策 */
export interface ApprovalDecision {
  requestId: string;
  decision: Decision;
  ruleId?: string;
  reason: string;
  duration: number;
  overridden: boolean;
  overrideReason?: string;
}

// ============ 审计日志 ============

/** 审计日志条目 */
export interface AuditLog {
  id: string;
  request: ApprovalRequest;
  decision: ApprovalDecision;
  timestamp: number;
}

// ============ 配置 ============

/** 引擎配置 */
export interface SmartApprovalConfig {
  /** 缺省决策 */
  defaultDecision: Decision;
  /** 启用审计 */
  enableAudit: boolean;
  /** 审计最大条数 */
  maxAuditLogs: number;
  /** 持久化 */
  persist: boolean;
}

export const DEFAULT_SMART_APPROVAL_CONFIG: SmartApprovalConfig = {
  defaultDecision: 'prompt',
  enableAudit: true,
  maxAuditLogs: 1000,
  persist: true,
};

// ============ 事件 ============

export type SmartApprovalEventType =
  | 'rule-added'
  | 'rule-updated'
  | 'rule-removed'
  | 'rule-toggled'
  | 'request-submitted'
  | 'decision-made'
  | 'override';

export type SmartApprovalEvent =
  | { type: 'rule-added'; rule: SmartApprovalRule }
  | { type: 'rule-updated'; rule: SmartApprovalRule }
  | { type: 'rule-removed'; ruleId: string }
  | { type: 'rule-toggled'; ruleId: string; enabled: boolean }
  | { type: 'request-submitted'; request: ApprovalRequest }
  | { type: 'decision-made'; request: ApprovalRequest; decision: ApprovalDecision }
  | { type: 'override'; requestId: string; reason: string };

// ============ 工具函数 ============

export function generateRuleId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function generateRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function generateAuditId(): string {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}
