/**
 * # ============================================================
 * # Composer Self-Summarization 工具 (v6.40.0 Cycle 18 G18-03)
 * # ============================================================
 * # 核心作用：长 session context 摘要
 * # 设计要点：
 * #   - 启发式 token 估算（中英文字符差异）
 * #   - 三层摘要策略：aggressive / balanced / conservative
 * #   - 决策点提取
 * #   - 摘要历史保留
 * #   - 摘要注入到 prompt
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 18 G18-03 初次创建
 * # ============================================================
 */

// ============================================================
// 类型定义
// ============================================================

export type SummaryStrategy = 'aggressive' | 'balanced' | 'conservative';

/** 摘要配置 */
export interface SummaryConfig {
  /** 触发阈值（tokens） */
  triggerThreshold: number;
  /** 目标阈值（tokens） */
  targetThreshold: number;
  /** 保留最近 N 条原文 */
  keepRecentCount: number;
  /** 保留决策点 */
  preserveDecisionPoints: boolean;
  /** 保留 edit 历史 */
  preserveEdits: boolean;
  /** 摘要策略 */
  strategy: SummaryStrategy;
}

export const DEFAULT_SUMMARY_CONFIG: SummaryConfig = {
  triggerThreshold: 8000,
  targetThreshold: 4000,
  keepRecentCount: 10,
  preserveDecisionPoints: true,
  preserveEdits: true,
  strategy: 'balanced',
};

/** 单个会话项 */
export interface ConversationItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** 已接受的 edit 数量 */
  acceptedEdits?: number;
  /** 决策理由 */
  rationale?: string;
  /** 关联文件 */
  relatedFiles?: string[];
}

/** 决策点 */
export interface DecisionPoint {
  timestamp: number;
  prompt: string;
  editsApplied: number;
  rationale: string;
  files: string[];
}

/** 摘要 */
export interface Summary {
  id: string;
  createdAt: number;
  strategy: SummaryStrategy;
  stats: {
    originalTokens: number;
    summaryTokens: number;
    reductionRatio: number;
  };
  recentCount: number;
  olderCount: number;
  decisions: DecisionPoint[];
  keypoints: string[];
  editsSummary: Array<{ filePath: string; status: string; description: string }>;
  contextSummary: Array<{ type: string; count: number }>;
  text: string;
}

// ============================================================
// Token 估算
// ============================================================

/**
 * 估算文本的 token 数量
 * - 中文字符约 1.5 token (字符级)
 * - 英文单词约 0.75 token (按完整单词)
 * - 其他字符（标点/空格/数字）约 0.25 token
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  const otherChars = text.length - chineseChars - englishChars;
  return Math.ceil(
    chineseChars * 1.5 +
    englishWords * 0.75 +
    otherChars * 0.25
  );
}

/** 估算会话项的 token 总数 */
export function estimateConversationTokens(items: ConversationItem[]): number {
  return items.reduce((sum, item) => sum + estimateTokens(item.content), 0);
}

// ============================================================
// 决策点提取
// ============================================================

/**
 * 从会话中提取决策点
 * 决策点定义：用户 prompt 后接受了 ≥ 1 个 edit
 */
export function extractDecisionPoints(items: ConversationItem[]): DecisionPoint[] {
  return items
    .filter((item) => item.role === 'user' && (item.acceptedEdits ?? 0) > 0)
    .map((item) => ({
      timestamp: item.timestamp,
      prompt: item.content.length > 200 ? item.content.slice(0, 200) + '...' : item.content,
      editsApplied: item.acceptedEdits ?? 0,
      rationale: item.rationale || '(未记录)',
      files: item.relatedFiles || [],
    }));
}

// ============================================================
// 关键点提取
// ============================================================

/**
 * 启发式提取关键点
 * - 用户 prompt 中的动词（实现/添加/修改/修复/重构）
 * - Assistant 响应中的总结句
 */
export function extractKeypoints(items: ConversationItem[]): string[] {
  const keypoints: string[] = [];
  const actionVerbs = ['实现', '添加', '修改', '修复', '重构', '优化', '删除', '集成', '测试'];
  const summaryKeywords = ['总结', '完成', '已', '总共'];

  for (const item of items) {
    if (item.role === 'user') {
      for (const verb of actionVerbs) {
        if (item.content.includes(verb)) {
          const idx = item.content.indexOf(verb);
          const start = Math.max(0, idx - 20);
          const end = Math.min(item.content.length, idx + 100);
          const snippet = item.content.slice(start, end).trim();
          if (snippet.length >= 4 && !keypoints.includes(snippet)) {
            keypoints.push(snippet);
          }
          break;
        }
      }
    } else if (item.role === 'assistant') {
      for (const kw of summaryKeywords) {
        if (item.content.includes(kw)) {
          const sentences = item.content.split(/[。！？\n]/);
          for (const s of sentences) {
            if (s.includes(kw) && s.length > 10 && s.length < 200) {
              const trimmed = s.trim();
              if (!keypoints.includes(trimmed)) {
                keypoints.push(trimmed);
              }
            }
          }
        }
      }
    }
  }

  return keypoints.slice(0, 20);
}

// ============================================================
// 摘要生成
// ============================================================

let _summaryCounter = 0;
function _genSummaryId(): string {
  _summaryCounter += 1;
  return `sum_${Date.now().toString(36)}_${_summaryCounter.toString(36)}`;
}

/**
 * 摘要生成器
 */
export class Summarizer {
  private config: SummaryConfig;

  constructor(config: Partial<SummaryConfig> = {}) {
    this.config = { ...DEFAULT_SUMMARY_CONFIG, ...config };
  }

  /** 获取配置 */
  getConfig(): SummaryConfig {
    return { ...this.config };
  }

  /** 更新配置 */
  setConfig(config: Partial<SummaryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** 检查是否需要摘要 */
  shouldSummarize(items: ConversationItem[]): boolean {
    const tokens = estimateConversationTokens(items);
    return tokens > this.config.triggerThreshold;
  }

  /**
   * 生成摘要
   * @param items 完整会话列表
   * @param options 强制选项
   */
  summarize(
    items: ConversationItem[],
    options?: { force?: boolean }
  ): Summary | null {
    if (!options?.force && !this.shouldSummarize(items)) {
      return null;
    }

    // 按时间排序
    const sorted = [...items].sort((a, b) => a.timestamp - b.timestamp);

    // 分层：最近 vs 更早
    const keepCount = this.config.keepRecentCount;
    const recent = sorted.slice(-keepCount);
    const older = sorted.slice(0, Math.max(0, sorted.length - keepCount));

    // 提取决策点
    const decisions = this.config.preserveDecisionPoints
      ? extractDecisionPoints(older)
      : [];

    // 提取关键点
    const keypoints = extractKeypoints(older);

    // 摘要 edit 历史
    const editsSummary: Summary['editsSummary'] = [];
    for (const item of older) {
      if (item.relatedFiles && item.relatedFiles.length > 0) {
        for (const file of item.relatedFiles) {
          editsSummary.push({
            filePath: file,
            status: 'accepted',
            description: item.content.slice(0, 100),
          });
        }
      }
    }

    // 摘要 context
    const contextSummary: Summary['contextSummary'] = [];
    const fileMap = new Map<string, number>();
    for (const item of older) {
      if (item.relatedFiles) {
        for (const f of item.relatedFiles) {
          fileMap.set(f, (fileMap.get(f) ?? 0) + 1);
        }
      }
    }
    contextSummary.push({ type: 'files', count: fileMap.size });

    // 计算统计
    const originalTokens = estimateConversationTokens(items);
    const summaryText = this.generateSummaryText({
      decisions,
      keypoints,
      editsSummary,
      recentCount: recent.length,
      olderCount: older.length,
      strategy: this.config.strategy,
    });
    const summaryTokens = estimateTokens(summaryText);
    const reductionRatio =
      originalTokens > 0
        ? (originalTokens - summaryTokens) / originalTokens
        : 0;

    return {
      id: _genSummaryId(),
      createdAt: Date.now(),
      strategy: this.config.strategy,
      stats: {
        originalTokens,
        summaryTokens,
        reductionRatio,
      },
      recentCount: recent.length,
      olderCount: older.length,
      decisions,
      keypoints,
      editsSummary: editsSummary.slice(0, 50),
      contextSummary,
      text: summaryText,
    };
  }

  /** 生成摘要文本 */
  private generateSummaryText(data: {
    decisions: DecisionPoint[];
    keypoints: string[];
    editsSummary: Summary['editsSummary'];
    recentCount: number;
    olderCount: number;
    strategy: SummaryStrategy;
  }): string {
    const lines: string[] = [];
    lines.push(`# Conversation Summary (strategy: ${data.strategy})`);
    lines.push('');
    lines.push(`## Overview`);
    lines.push(`- Total items: ${data.recentCount + data.olderCount}`);
    lines.push(`- Older summarized: ${data.olderCount}`);
    lines.push(`- Recent kept: ${data.recentCount}`);
    lines.push('');

    if (data.decisions.length > 0) {
      lines.push(`## Key Decisions (${data.decisions.length})`);
      for (const d of data.decisions.slice(0, 10)) {
        const ts = new Date(d.timestamp).toISOString().slice(0, 16);
        lines.push(`- [${ts}] ${d.prompt}`);
        lines.push(`  - Applied ${d.editsApplied} edits${d.files.length > 0 ? ` in ${d.files.join(', ')}` : ''}`);
      }
      lines.push('');
    }

    if (data.keypoints.length > 0) {
      lines.push(`## Key Points (${data.keypoints.length})`);
      for (const kp of data.keypoints.slice(0, 10)) {
        lines.push(`- ${kp}`);
      }
      lines.push('');
    }

    if (data.editsSummary.length > 0) {
      lines.push(`## Edits Summary (${data.editsSummary.length})`);
      for (const e of data.editsSummary.slice(0, 20)) {
        lines.push(`- ${e.filePath}: ${e.status}`);
        lines.push(`  - ${e.description}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

// ============================================================
// 摘要历史管理
// ============================================================

export class SummaryHistory {
  private summaries: Summary[] = [];
  private maxSize: number;
  private listeners: Set<(summaries: Summary[]) => void> = new Set();

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  /** 添加摘要 */
  add(summary: Summary): void {
    this.summaries.push(summary);
    if (this.summaries.length > this.maxSize) {
      this.summaries.shift();
    }
    this.notify();
  }

  /** 获取所有摘要 */
  getAll(): Summary[] {
    return [...this.summaries];
  }

  /** 获取最新摘要 */
  getLatest(): Summary | null {
    return this.summaries[this.summaries.length - 1] ?? null;
  }

  /** 清空 */
  clear(): void {
    this.summaries = [];
    this.notify();
  }

  /** 订阅 */
  subscribe(callback: (summaries: Summary[]) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** 获取数量 */
  get size(): number {
    return this.summaries.length;
  }

  private notify(): void {
    for (const cb of this.listeners) {
      try {
        cb(this.getAll());
      } catch (err) {
        console.error('SummaryHistory listener error:', err);
      }
    }
  }
}

// ============================================================
// 注入到 Prompt
// ============================================================

/**
 * 注入摘要到 prompt
 */
export function injectSummaryIntoPrompt(
  prompt: string,
  summary: Summary,
  options?: { prefix?: string }
): string {
  if (!summary) return prompt;
  const prefix = options?.prefix ?? 'Conversation Context Summary';
  return `[${prefix}]\n${summary.text}\n\n[User Prompt]\n${prompt}`;
}

/**
 * 合并多个摘要为单个
 */
export function mergeSummaries(summaries: Summary[]): string {
  if (summaries.length === 0) return '';
  if (summaries.length === 1) return summaries[0].text;

  const lines: string[] = [];
  lines.push(`# Combined Summary (${summaries.length} parts)`);
  lines.push('');
  for (let i = 0; i < summaries.length; i++) {
    lines.push(`## Part ${i + 1} (${new Date(summaries[i].createdAt).toISOString()})`);
    lines.push(summaries[i].text);
    lines.push('');
  }
  return lines.join('\n');
}
