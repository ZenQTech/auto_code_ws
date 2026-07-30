/**
 * # ============================================================
 * # PRBotEngine - PR 自动机器人引擎 (v1.0.0 Cycle 25 G25-02)
 * # ============================================================
 * # 核心作用：模拟 PR 事件流，自动触发代码评审，生成结构化 review
 * # 依赖：G25-01 AutoCodeReviewEngine
 * # 主要功能：
 * #   1. Mock PR 注册/更新/关闭
 * #   2. PR 事件触发（opened/synchronize/reopened）
 * #   3. 自动 review 生成（summary + line comments）
 * #   4. 审计日志（所有 bot 行为完整记录）
 * #   5. 状态序列化/反序列化
 * #   6. 事件订阅
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 25 G25-02 初次创建
 * # ============================================================
 */

import { AutoCodeReviewEngine } from './autoCodeReview';
import type {
  ReviewReport,
  ReviewFinding,
  Severity,
} from './autoCodeReviewTypes';
import { SEVERITY_ICONS } from './autoCodeReviewTypes';
import {
  DEFAULT_BOT_CONFIG,
  decideReviewType,
  generateLogId,
  generateReviewId,
  generateLineCommentId,
} from './prBotEngineTypes';
import type {
  BotActionLog,
  BotConfig,
  BotState,
  LineComment,
  PREvent,
  PRReviewComment,
  PullRequest,
  ReviewType,
} from './prBotEngineTypes';

// ============================================================================
// 事件类型
// ============================================================================

export type PRBotEventMap = {
  'pr-opened': (pr: PullRequest) => void;
  'pr-synchronize': (pr: PullRequest) => void;
  'pr-reopened': (pr: PullRequest) => void;
  'pr-closed': (pr: PullRequest) => void;
  'review-posted': (review: PRReviewComment) => void;
  error: (err: Error) => void;
};

// ============================================================================
// 引擎
// ============================================================================

export class PRBotEngine {
  private config: BotConfig;
  private pullRequests: Map<number, PullRequest> = new Map();
  private reviews: PRReviewComment[] = [];
  private auditLog: BotActionLog[] = [];
  private lastReport?: ReviewReport;
  private listeners: Map<string, Set<Function>> = new Map();
  private reviewEngine: AutoCodeReviewEngine;

  constructor(config: Partial<BotConfig> = {}, reviewEngine?: AutoCodeReviewEngine) {
    this.config = { ...DEFAULT_BOT_CONFIG, ...config };
    this.reviewEngine = reviewEngine ?? new AutoCodeReviewEngine();
  }

  // ============ 配置管理 ============

  configure(config: Partial<BotConfig>): void {
    const oldEnabled = this.config.enabled;
    this.config = { ...this.config, ...config };
    this.log({
      action: 'config-updated',
      details: `Bot config updated: ${Object.keys(config).join(', ')}`,
      success: true,
    });
    if (oldEnabled !== this.config.enabled) {
      this.log({
        action: 'config-updated',
        details: `Bot ${this.config.enabled ? 'enabled' : 'disabled'}`,
        success: true,
      });
    }
  }

  getConfig(): BotConfig {
    return { ...this.config };
  }

  resetConfig(): void {
    this.config = { ...DEFAULT_BOT_CONFIG };
  }

  // ============ PR 管理 ============

  registerPR(pr: PullRequest): void {
    this.pullRequests.set(pr.number, { ...pr });
    this.log({
      action: 'pr-opened',
      prNumber: pr.number,
      details: `PR #${pr.number} registered: ${pr.title}`,
      success: true,
    });
    this.emit('pr-opened', pr);

    // 如果 bot 启用且 auto review 触发器包含 'opened'，则自动 review
    if (this.config.enabled && this.config.autoReviewTriggers.includes('opened')) {
      this.reviewPR(pr.number).catch((err) => {
        this.log({
          action: 'error',
          prNumber: pr.number,
          details: 'Auto review failed',
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      });
    }
  }

  updatePR(prNumber: number, updates: Partial<PullRequest>): void {
    const pr = this.pullRequests.get(prNumber);
    if (!pr) return;
    const updated: PullRequest = { ...pr, ...updates, updatedAt: Date.now() };
    this.pullRequests.set(prNumber, updated);
    this.log({
      action: 'pr-synchronize',
      prNumber,
      details: `PR #${prNumber} updated: ${Object.keys(updates).join(', ')}`,
      success: true,
    });
    this.emit('pr-synchronize', updated);
  }

  closePR(prNumber: number): void {
    const pr = this.pullRequests.get(prNumber);
    if (!pr) return;
    const updated: PullRequest = { ...pr, status: 'closed', updatedAt: Date.now() };
    this.pullRequests.set(prNumber, updated);
    this.log({
      action: 'pr-closed',
      prNumber,
      details: `PR #${prNumber} closed`,
      success: true,
    });
    this.emit('pr-closed', updated);
  }

  getPR(prNumber: number): PullRequest | undefined {
    const pr = this.pullRequests.get(prNumber);
    return pr ? { ...pr } : undefined;
  }

  getAllPRs(): PullRequest[] {
    return Array.from(this.pullRequests.values()).map((p) => ({ ...p }));
  }

  // ============ 事件触发 ============

  async triggerEvent(event: PREvent): Promise<PRReviewComment | null> {
    if (!this.config.enabled) return null;

    // 更新 PR 状态
    this.pullRequests.set(event.pr.number, { ...event.pr, updatedAt: event.timestamp });

    // 触发对应事件处理
    switch (event.type) {
      case 'opened':
        return await this.onPROpen(event.pr);
      case 'synchronize':
        return await this.onPRSynchronize(event.pr);
      case 'reopened':
        return await this.onPRReopened(event.pr);
      case 'closed':
        this.closePR(event.pr.number);
        return null;
    }
  }

  async onPROpen(pr: PullRequest): Promise<PRReviewComment | null> {
    this.pullRequests.set(pr.number, pr);
    this.log({
      action: 'pr-opened',
      prNumber: pr.number,
      details: `PR opened event: ${pr.title}`,
      success: true,
    });
    this.emit('pr-opened', pr);

    if (this.config.autoReviewTriggers.includes('opened')) {
      return await this.reviewPR(pr.number);
    }
    return null;
  }

  async onPRSynchronize(pr: PullRequest): Promise<PRReviewComment | null> {
    this.pullRequests.set(pr.number, { ...pr, updatedAt: Date.now() });
    this.log({
      action: 'pr-synchronize',
      prNumber: pr.number,
      details: `PR synchronize event`,
      success: true,
    });
    this.emit('pr-synchronize', pr);

    if (this.config.autoReviewTriggers.includes('synchronize')) {
      return await this.reviewPR(pr.number);
    }
    return null;
  }

  async onPRReopened(pr: PullRequest): Promise<PRReviewComment | null> {
    this.pullRequests.set(pr.number, { ...pr, status: 'open', updatedAt: Date.now() });
    this.log({
      action: 'pr-reopened',
      prNumber: pr.number,
      details: `PR reopened`,
      success: true,
    });
    this.emit('pr-reopened', pr);

    if (this.config.autoReviewTriggers.includes('reopened')) {
      return await this.reviewPR(pr.number);
    }
    return null;
  }

  // ============ Review 生成 ============

  async reviewPR(
    prNumber: number,
    options?: { type?: ReviewType }
  ): Promise<PRReviewComment> {
    const pr = this.pullRequests.get(prNumber);
    if (!pr) {
      throw new Error(`PR #${prNumber} not found`);
    }

    // 准备文件
    const files: Record<string, string> = {};
    for (const f of pr.files) {
      files[f.path] = f.content;
    }

    // 调用 review 引擎
    const report = await this.reviewEngine.review({ files });
    this.lastReport = report;

    // 决策 review 类型
    const reviewType: ReviewType = options?.type ?? decideReviewType(report, this.config);

    // 生成 line comments
    const lineComments = this.generateLineComments(report);

    // 生成 summary body
    const body = this.generateSummaryBody(report, pr, reviewType);

    const review: PRReviewComment = {
      id: generateReviewId(),
      prNumber,
      type: reviewType,
      author: this.config.name,
      body,
      lineComments,
      reportId: report.id,
      createdAt: Date.now(),
      delivered: true,
    };

    this.reviews.push(review);
    this.log({
      action: 'review-posted',
      prNumber,
      details: `Review posted: ${reviewType} (${report.findings.length} findings)`,
      success: true,
    });
    this.emit('review-posted', review);

    return review;
  }

  generateLineComments(report: ReviewReport): LineComment[] {
    return report.findings
      .filter((f) => f.line !== undefined)
      .map((f) => this.findingToLineComment(f));
  }

  private findingToLineComment(finding: ReviewFinding): LineComment {
    const body = this.formatLineCommentBody(finding);
    return {
      id: generateLineCommentId(),
      file: finding.file,
      line: finding.line!,
      body,
      findingId: finding.id,
      severity: finding.severity,
    };
  }

  private formatLineCommentBody(finding: ReviewFinding): string {
    const lines: string[] = [];
    const icon = SEVERITY_ICONS[finding.severity];
    const sev = finding.severity.toUpperCase();
    lines.push(`**${icon} [${sev} · ${finding.category}]** \`${finding.file}:${finding.line}\``);
    lines.push('');
    lines.push(finding.title);
    lines.push('');
    lines.push(finding.message);
    if (finding.existingCode) {
      lines.push('');
      lines.push('**Current:**');
      lines.push('```');
      lines.push(finding.existingCode);
      lines.push('```');
    }
    if (finding.suggestedPatch) {
      lines.push('');
      lines.push('**Suggested:**');
      lines.push('```');
      lines.push(finding.suggestedPatch);
      lines.push('```');
    }
    if (finding.why) {
      lines.push('');
      lines.push(`**Why**: ${finding.why}`);
    }
    if (finding.ruleId) {
      lines.push('');
      lines.push(`<sub>Rule: \`${finding.ruleId}\` · Confidence: ${(finding.confidence * 100).toFixed(0)}%</sub>`);
    }
    return lines.join('\n');
  }

  generateSummaryBody(
    report: ReviewReport,
    pr: PullRequest,
    reviewType: ReviewType
  ): string {
    const lines: string[] = [];
    const verdictIcon =
      report.verdict === 'BLOCK'
        ? '🔴'
        : reviewType === 'REQUEST_CHANGES' || report.verdict === 'REQUEST_CHANGES'
        ? '🟠'
        : '🟢';
    lines.push(`## ${this.config.avatar} ${this.config.name}`);
    lines.push('');
    lines.push(`**PR**: #${pr.number} · ${pr.title}`);
    lines.push(`**Author**: @${pr.author}`);
    lines.push(`**Verdict**: ${verdictIcon} **${reviewType}**`);
    lines.push(`**Files reviewed**: ${report.fileCount}`);
    lines.push(`**Duration**: ${report.duration}ms`);
    lines.push('');
    lines.push('### Summary');
    lines.push('');
    lines.push(`| Severity | Count |`);
    lines.push(`|----------|-------|`);
    lines.push(`| 🔴 CRITICAL | ${report.summary.critical} |`);
    lines.push(`| 🟠 HIGH | ${report.summary.high} |`);
    lines.push(`| 🟡 MEDIUM | ${report.summary.medium} |`);
    lines.push(`| 🟢 LOW | ${report.summary.low} |`);
    lines.push(`| 💡 INFO | ${report.summary.info} |`);
    lines.push(`| **Total** | **${report.findings.length}** |`);
    lines.push('');

    // Top 5 by severity
    const top5 = [...report.findings]
      .sort((a, b) => this.severityRank(b.severity) - this.severityRank(a.severity))
      .slice(0, 5);
    if (top5.length > 0) {
      lines.push('### Top Priority Issues');
      lines.push('');
      for (let i = 0; i < top5.length; i++) {
        const f = top5[i];
        const icon = SEVERITY_ICONS[f.severity];
        lines.push(
          `${i + 1}. **${icon} [${f.severity.toUpperCase()}]** \`${f.file}${f.line ? `:${f.line}` : ''}\` — ${f.title}`
        );
      }
      lines.push('');
    }

    // 折叠详情
    if (report.findings.length > 5) {
      lines.push('<details>');
      lines.push(`<summary>View all ${report.findings.length} findings</summary>`);
      lines.push('');
      lines.push('| Severity | Category | Location | Title |');
      lines.push('|----------|----------|----------|-------|');
      for (const f of report.findings) {
        const icon = SEVERITY_ICONS[f.severity];
        const loc = f.line ? `${f.file}:${f.line}` : f.file;
        lines.push(`| ${icon} ${f.severity} | ${f.category} | \`${loc}\` | ${f.title} |`);
      }
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }

    lines.push('---');
    lines.push(`<sub>${this.config.signature}</sub>`);
    return lines.join('\n');
  }

  private severityRank(s: Severity): number {
    return { critical: 5, high: 4, medium: 3, low: 2, info: 1 }[s];
  }

  // ============ 审计日志 ============

  getAuditLog(filter?: {
    action?: BotActionLog['action'];
    prNumber?: number;
  }): BotActionLog[] {
    let result = [...this.auditLog];
    if (filter?.action) {
      result = result.filter((l) => l.action === filter.action);
    }
    if (filter?.prNumber !== undefined) {
      result = result.filter((l) => l.prNumber === filter.prNumber);
    }
    return result;
  }

  clearAuditLog(): void {
    this.auditLog = [];
  }

  private log(entry: Omit<BotActionLog, 'id' | 'timestamp'>): void {
    this.auditLog.push({
      ...entry,
      id: generateLogId(),
      timestamp: Date.now(),
    });
  }

  // ============ 状态查询 ============

  getState(): BotState {
    return {
      config: { ...this.config },
      pullRequests: this.getAllPRs(),
      reviews: [...this.reviews],
      auditLog: [...this.auditLog],
      lastReport: this.lastReport,
    };
  }

  getStats(): {
    prs: number;
    reviews: number;
    actions: number;
    bySeverity: Record<Severity, number>;
  } {
    const bySeverity: Record<Severity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    if (this.lastReport) {
      for (const f of this.lastReport.findings) {
        bySeverity[f.severity]++;
      }
    }
    return {
      prs: this.pullRequests.size,
      reviews: this.reviews.length,
      actions: this.auditLog.length,
      bySeverity,
    };
  }

  // ============ 事件订阅 ============

  on<K extends keyof PRBotEventMap>(event: K, listener: PRBotEventMap[K]): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }

  off<K extends keyof PRBotEventMap>(event: K, listener: PRBotEventMap[K]): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit<K extends keyof PRBotEventMap>(
    event: K,
    ...args: Parameters<PRBotEventMap[K]>
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        (fn as any)(...args);
      } catch {
        // ignore listener errors
      }
    }
  }

  // ============ 序列化 ============

  exportState(): string {
    return JSON.stringify(this.getState(), null, 2);
  }

  importState(json: string): void {
    const state = JSON.parse(json) as BotState;
    this.config = state.config;
    this.pullRequests.clear();
    for (const pr of state.pullRequests) {
      this.pullRequests.set(pr.number, pr);
    }
    this.reviews = state.reviews;
    this.auditLog = state.auditLog;
    this.lastReport = state.lastReport;
  }

  clear(): void {
    this.pullRequests.clear();
    this.reviews = [];
    this.auditLog = [];
    this.lastReport = undefined;
    this.listeners.clear();
    this.config = { ...DEFAULT_BOT_CONFIG };
  }
}

// ============================================================================
// 单例工厂
// ============================================================================

let defaultEngine: PRBotEngine | null = null;

export function getDefaultPRBotEngine(): PRBotEngine {
  if (!defaultEngine) {
    defaultEngine = new PRBotEngine();
  }
  return defaultEngine;
}

export function resetDefaultPRBotEngine(): void {
  defaultEngine?.clear();
  defaultEngine = null;
}
