/**
 * # ============================================================
 * # PRBotEngine Types - PR 自动机器人引擎类型定义 (v1.0.0 Cycle 25 G25-02)
 * # ============================================================
 * # 核心作用：定义 PR bot 引擎的所有类型、事件、review 类型
 * # 依赖：G25-01 AutoCodeReviewEngine 的 ReviewReport / Severity
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 25 G25-02 初次创建
 * # ============================================================
 */

import type { ReviewReport, Severity } from './autoCodeReviewTypes';

// ============ PR 信息 ============

export interface PRFile {
  path: string;
  content: string;
  additions: number;
  deletions: number;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

export interface PullRequest {
  number: number;
  title: string;
  description: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  files: PRFile[];
  status: 'open' | 'closed' | 'merged';
  createdAt: number;
  updatedAt: number;
  headSha: string;
  baseSha: string;
}

// ============ 事件 ============

export type PREventType = 'opened' | 'synchronize' | 'reopened' | 'closed';

export type PRTrigger = 'webhook' | 'manual' | 'auto-trigger';

export interface PREvent {
  type: PREventType;
  pr: PullRequest;
  timestamp: number;
  trigger: PRTrigger;
  metadata?: Record<string, unknown>;
}

// ============ Bot 配置 ============

export type ReviewType = 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE';

export interface BotConfig {
  name: string;
  avatar: string;
  autoReviewTriggers: PREventType[];
  defaultReviewType: ReviewType;
  blockOnSeverity: Severity;
  signature: string;
  enabled: boolean;
}

export const DEFAULT_BOT_CONFIG: BotConfig = {
  name: 'Hermes Code Review Bot',
  avatar: '🤖',
  autoReviewTriggers: ['opened', 'synchronize', 'reopened'],
  defaultReviewType: 'COMMENT',
  blockOnSeverity: 'high',
  signature: 'Hermes Auto Code Review Bot v1.0.0',
  enabled: true,
};

// ============ Review 评论 ============

export interface LineComment {
  id: string;
  file: string;
  line: number;
  body: string;
  findingId: string;
  severity: Severity;
}

export interface PRReviewComment {
  id: string;
  prNumber: number;
  type: ReviewType;
  author: string;
  body: string;
  lineComments: LineComment[];
  reportId?: string;
  createdAt: number;
  delivered: boolean;
}

// ============ 审计日志 ============

export type BotActionType =
  | 'pr-opened'
  | 'pr-synchronize'
  | 'pr-reopened'
  | 'review-posted'
  | 'comment-posted'
  | 'config-updated'
  | 'pr-closed'
  | 'error';

export interface BotActionLog {
  id: string;
  action: BotActionType;
  prNumber?: number;
  details: string;
  timestamp: number;
  success: boolean;
  error?: string;
}

// ============ 状态 ============

export interface BotState {
  config: BotConfig;
  pullRequests: PullRequest[];
  reviews: PRReviewComment[];
  auditLog: BotActionLog[];
  lastReport?: ReviewReport;
}

// ============ 工具函数 ============

export function generateLogId(): string {
  return `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function generateReviewId(): string {
  return `review_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function generateLineCommentId(): string {
  return `lc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 根据严重度决策 review 类型
 */
export function decideReviewType(
  report: ReviewReport,
  policy: Pick<BotConfig, 'blockOnSeverity' | 'defaultReviewType'>
): ReviewType {
  if (policy.defaultReviewType !== 'COMMENT') {
    return policy.defaultReviewType;
  }

  // COMMENT 模式下，根据严重度决定
  if (report.summary.critical > 0 || report.summary.high >= 3) {
    return 'REQUEST_CHANGES';
  }

  const sevRank: Record<Severity, number> = {
    critical: 5,
    high: 4,
    medium: 3,
    low: 2,
    info: 1,
  };
  const policyRank = sevRank[policy.blockOnSeverity];

  // 找到最高严重度
  let maxRank = 0;
  for (const f of report.findings) {
    const r = sevRank[f.severity];
    if (r > maxRank) maxRank = r;
  }

  if (maxRank >= policyRank) {
    return 'REQUEST_CHANGES';
  }

  return 'COMMENT';
}
