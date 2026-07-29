/**
 * # ============================================================
 * # ProactiveSuggestionEngine - AI 主动建议引擎 (v1.0.0 Cycle 23 G23-04)
 * # ============================================================
 * # 核心作用：基于上下文主动提示用户下一步操作，提升交互效率
 * # 主要功能：
 * #   1. 上下文分析（对话状态/任务类型/历史模式）
 * #   2. 4 种建议类型（next-action/related-feature/faq/optimization）
 * #   3. 2 种生成方式（基于规则 + 基于LLM）
 * #   4. 智能去重（5分钟窗口/接受拒绝记录）
 * #   5. 反馈学习（权重动态调整）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 23 G23-04 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/** 建议类型 */
export type SuggestionType =
  | 'next-action'
  | 'related-feature'
  | 'faq'
  | 'optimization';

/** 对话状态 */
export type ConversationState = 'idle' | 'active' | 'workflow' | 'error';

/** 任务类型 */
export type TaskType = 'coding' | 'writing' | 'analysis' | 'learning' | 'general';

/** 建议反馈 */
export type SuggestionFeedbackType = 'accepted' | 'dismissed' | 'ignored';

/** 建议 */
export interface Suggestion {
  suggestionId: string;
  type: SuggestionType;
  title: string;
  description: string;
  action?: {
    label: string;
    callbackKey: string; // 动作键，由调用方决定如何处理
  };
  reason: string;
  confidence: number;
  context: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
  source: 'rule' | 'llm';
}

/** 建议反馈记录 */
export interface SuggestionFeedbackRecord {
  suggestionId: string;
  feedback: SuggestionFeedbackType;
  durationMs: number;
  timestamp: number;
  type: SuggestionType;
  title: string;
}

/** 建议配置 */
export interface SuggestionConfig {
  maxActiveSuggestions: number;
  dedupWindowMs: number;
  enabledTypes: SuggestionType[];
  enableLLMGeneration: boolean;
  showOnIdle: boolean;
  idleThresholdMs: number;
  defaultTtlMs: number;
}

/** 会话上下文 */
export interface SessionContext {
  conversationState: ConversationState;
  taskType: TaskType;
  appMode?: string;
  projectType?: string;
  recentActions?: string[];
  messageCount?: number;
  hasError?: boolean;
  hasPendingTasks?: boolean;
  costSoFar?: number;
  budgetLimit?: number;
  customSignals?: Record<string, unknown>;
}

/** 建议统计 */
export interface SuggestionStats {
  totalGenerated: number;
  totalAccepted: number;
  totalDismissed: number;
  totalIgnored: number;
  acceptanceRate: number;
  byType: Record<SuggestionType, { generated: number; accepted: number; dismissed: number }>;
  activeCount: number;
}

/** 事件类型 */
export type SuggestionEventType =
  | 'suggestion-generated'
  | 'suggestion-accepted'
  | 'suggestion-dismissed'
  | 'suggestion-expired'
  | 'config-updated';

type SuggestionEventHandler = (data?: unknown) => void;

// ============ 工具函数 ============

function generateId(prefix: string = 's'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const DEFAULT_CONFIG: SuggestionConfig = {
  maxActiveSuggestions: 5,
  dedupWindowMs: 5 * 60 * 1000,
  enabledTypes: ['next-action', 'related-feature', 'faq', 'optimization'],
  enableLLMGeneration: false,
  showOnIdle: true,
  idleThresholdMs: 30 * 1000,
  defaultTtlMs: 10 * 60 * 1000,
};

const DEFAULT_TYPE_WEIGHTS: Record<SuggestionType, number> = {
  'next-action': 1.0,
  'related-feature': 1.0,
  faq: 0.8,
  optimization: 1.2,
};

// ============ 事件总线 ============

class SuggestionEventBus {
  private listeners: Map<SuggestionEventType, Set<SuggestionEventHandler>> = new Map();

  on(type: SuggestionEventType, handler: SuggestionEventHandler): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
    return () => {
      this.listeners.get(type)?.delete(handler);
    };
  }

  emit(type: SuggestionEventType, data?: unknown): void {
    this.listeners.get(type)?.forEach((h) => {
      try {
        h(data);
      } catch {
        // 静默
      }
    });
  }
}

// ============ 主引擎 ============

export class ProactiveSuggestionEngine {
  /** 活跃建议 */
  private active: Suggestion[] = [];
  /** 历史建议（接受/拒绝/忽略记录） */
  private feedbackRecords: SuggestionFeedbackRecord[] = [];
  /** 类型权重（用于反馈学习） */
  private typeWeights: Record<SuggestionType, number> = { ...DEFAULT_TYPE_WEIGHTS };
  /** 配置 */
  private config: SuggestionConfig;
  /** 事件总线 */
  private readonly eventBus: SuggestionEventBus = new SuggestionEventBus();
  /** 最近生成时间（用于去重） */
  private recentGenTimestamps: Map<string, number> = new Map();
  /** 已展示时长（suggestionId -> 展示起始时间） */
  private displayStartTimes: Map<string, number> = new Map();
  /** 统计 */
  private stats: SuggestionStats = {
    totalGenerated: 0,
    totalAccepted: 0,
    totalDismissed: 0,
    totalIgnored: 0,
    acceptanceRate: 0,
    byType: {
      'next-action': { generated: 0, accepted: 0, dismissed: 0 },
      'related-feature': { generated: 0, accepted: 0, dismissed: 0 },
      faq: { generated: 0, accepted: 0, dismissed: 0 },
      optimization: { generated: 0, accepted: 0, dismissed: 0 },
    },
    activeCount: 0,
  };

  constructor(config?: Partial<SuggestionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) };
  }

  // ============ 建议生成 ============

  /** 生成建议（基于规则） */
  generateSuggestions(context: SessionContext): Suggestion[] {
    // 清理过期
    this.cleanupExpired();

    // 限制最大活跃数
    if (this.active.length >= this.config.maxActiveSuggestions) {
      return this.active;
    }

    const candidates: Suggestion[] = [];

    // 1. 规则生成
    candidates.push(...this.generateFromRules(context));

    // 2. 可选 LLM 生成
    if (this.config.enableLLMGeneration) {
      candidates.push(...this.generateFromLLMStub(context));
    }

    // 3. 去重（按 title+type 在窗口内去重）
    const newSuggestions: Suggestion[] = [];
    const now = Date.now();
    for (const c of candidates) {
      if (this.isDuplicate(c, now)) continue;
      if (!this.config.enabledTypes.includes(c.type)) continue;
      this.recentGenTimestamps.set(this.getDedupKey(c), now);
      newSuggestions.push(c);
      this.stats.totalGenerated++;
      this.stats.byType[c.type].generated++;
    }

    // 4. 排序（按 confidence × typeWeight）
    newSuggestions.sort((a, b) => {
      const sa = a.confidence * (this.typeWeights[a.type] || 1);
      const sb = b.confidence * (this.typeWeights[b.type] || 1);
      return sb - sa;
    });

    // 5. 截断到最大活跃数
    const slotsLeft = this.config.maxActiveSuggestions - this.active.length;
    const toAdd = newSuggestions.slice(0, slotsLeft);

    for (const s of toAdd) {
      this.active.push(s);
      this.displayStartTimes.set(s.suggestionId, now);
      this.eventBus.emit('suggestion-generated', s);
    }
    this.stats.activeCount = this.active.length;
    return toAdd;
  }

  /** 接受建议 */
  acceptSuggestion(suggestionId: string): Suggestion | null {
    const idx = this.active.findIndex((s) => s.suggestionId === suggestionId);
    if (idx === -1) return null;
    const s = this.active[idx];
    this.active.splice(idx, 1);
    this.displayStartTimes.delete(suggestionId);

    // 记录反馈
    this.recordFeedback(suggestionId, s, 'accepted');
    this.stats.totalAccepted++;
    this.stats.byType[s.type].accepted++;
    this.stats.acceptanceRate = this.computeAcceptanceRate();

    // 反馈学习：增加该类型权重
    this.adjustWeight(s.type, +0.1);

    this.eventBus.emit('suggestion-accepted', s);
    this.stats.activeCount = this.active.length;
    return s;
  }

  /** 拒绝建议 */
  dismissSuggestion(suggestionId: string): Suggestion | null {
    const idx = this.active.findIndex((s) => s.suggestionId === suggestionId);
    if (idx === -1) return null;
    const s = this.active[idx];
    this.active.splice(idx, 1);
    this.displayStartTimes.delete(suggestionId);

    this.recordFeedback(suggestionId, s, 'dismissed');
    this.stats.totalDismissed++;
    this.stats.byType[s.type].dismissed++;

    // 反馈学习：降低该类型权重
    this.adjustWeight(s.type, -0.15);

    this.eventBus.emit('suggestion-dismissed', s);
    this.stats.activeCount = this.active.length;
    return s;
  }

  /** 标记为忽略（自动过期） */
  markIgnored(suggestionId: string): void {
    const idx = this.active.findIndex((s) => s.suggestionId === suggestionId);
    if (idx === -1) return;
    const s = this.active[idx];
    this.active.splice(idx, 1);
    this.displayStartTimes.delete(suggestionId);

    this.recordFeedback(suggestionId, s, 'ignored');
    this.stats.totalIgnored++;

    this.eventBus.emit('suggestion-expired', s);
    this.stats.activeCount = this.active.length;
  }

  /** 获取活跃建议 */
  getActiveSuggestions(): Suggestion[] {
    this.cleanupExpired();
    return [...this.active];
  }

  /** 获取所有建议历史 */
  getHistory(limit?: number): SuggestionFeedbackRecord[] {
    const sorted = [...this.feedbackRecords].sort((a, b) => b.timestamp - a.timestamp);
    return limit ? sorted.slice(0, limit) : sorted;
  }

  /** 清空所有建议 */
  clearAll(): void {
    this.active.forEach((s) => this.markIgnored(s.suggestionId));
    this.active = [];
    this.stats.activeCount = 0;
  }

  /** 重置 */
  reset(): void {
    this.clearAll();
    this.feedbackRecords = [];
    this.typeWeights = { ...DEFAULT_TYPE_WEIGHTS };
    this.recentGenTimestamps.clear();
    this.displayStartTimes.clear();
    this.stats = {
      totalGenerated: 0,
      totalAccepted: 0,
      totalDismissed: 0,
      totalIgnored: 0,
      acceptanceRate: 0,
      byType: {
        'next-action': { generated: 0, accepted: 0, dismissed: 0 },
        'related-feature': { generated: 0, accepted: 0, dismissed: 0 },
        faq: { generated: 0, accepted: 0, dismissed: 0 },
        optimization: { generated: 0, accepted: 0, dismissed: 0 },
      },
      activeCount: 0,
    };
  }

  // ============ 配置 ============

  /** 更新配置 */
  updateConfig(config: Partial<SuggestionConfig>): void {
    this.config = { ...this.config, ...config };
    this.eventBus.emit('config-updated', this.config);
  }

  /** 获取配置 */
  getConfig(): SuggestionConfig {
    return { ...this.config };
  }

  /** 获取类型权重 */
  getTypeWeights(): Record<SuggestionType, number> {
    return { ...this.typeWeights };
  }

  /** 获取统计 */
  getStats(): SuggestionStats {
    return {
      ...this.stats,
      byType: { ...this.stats.byType },
      activeCount: this.active.length,
      acceptanceRate: this.computeAcceptanceRate(),
    };
  }

  // ============ 事件订阅 ============

  /** 订阅事件 */
  on(type: SuggestionEventType, handler: SuggestionEventHandler): () => void {
    return this.eventBus.on(type, handler);
  }

  // ============ 内部方法 ============

  /** 基于规则生成 */
  private generateFromRules(context: SessionContext): Suggestion[] {
    const out: Suggestion[] = [];
    const now = Date.now();
    const ttl = this.config.defaultTtlMs;

    // 1. 错误状态下建议
    if (context.hasError) {
      out.push({
        suggestionId: generateId('sg'),
        type: 'next-action',
        title: '查看错误详情',
        description: '检测到错误，建议查看错误日志获取详细堆栈信息',
        action: { label: '查看错误', callbackKey: 'view-error' },
        reason: '当前会话存在错误',
        confidence: 0.9,
        context: { hasError: true },
        createdAt: now,
        expiresAt: now + ttl,
        source: 'rule',
      });
    }

    // 2. 空闲状态 + 长对话
    if (
      context.conversationState === 'idle' &&
      (context.messageCount || 0) > 10
    ) {
      out.push({
        suggestionId: generateId('sg'),
        type: 'optimization',
        title: '压缩会话以节省成本',
        description: '当前对话较长，启用压缩可节省 30-50% Token 消耗',
        action: { label: '启用压缩', callbackKey: 'enable-compaction' },
        reason: `对话已超过 ${context.messageCount} 轮`,
        confidence: 0.75,
        context: { messageCount: context.messageCount },
        createdAt: now,
        expiresAt: now + ttl,
        source: 'rule',
      });
    }

    // 3. 编码任务 + 工作流中
    if (context.taskType === 'coding' && context.conversationState === 'workflow') {
      out.push({
        suggestionId: generateId('sg'),
        type: 'related-feature',
        title: '启用 Best-of-N 多模型对比',
        description: '同时调用多个 LLM 模型对比结果，提升代码质量',
        action: { label: '打开 Best-of-N', callbackKey: 'open-bestofn' },
        reason: '检测到编码工作流',
        confidence: 0.7,
        context: { taskType: 'coding' },
        createdAt: now,
        expiresAt: now + ttl,
        source: 'rule',
      });
    }

    // 4. 成本接近预算
    if (
      typeof context.costSoFar === 'number' &&
      typeof context.budgetLimit === 'number' &&
      context.budgetLimit > 0
    ) {
      const ratio = context.costSoFar / context.budgetLimit;
      if (ratio > 0.8) {
        out.push({
          suggestionId: generateId('sg'),
          type: 'optimization',
          title: '成本接近预算上限',
          description: `当前已消耗 ${(ratio * 100).toFixed(0)}% 预算，建议开启成本预测`,
          action: { label: '查看成本预测', callbackKey: 'open-cost-prediction' },
          reason: '成本接近预算',
          confidence: 0.95,
          context: { ratio },
          createdAt: now,
          expiresAt: now + ttl,
          source: 'rule',
        });
      }
    }

    // 5. 写作任务 + 长对话
    if (context.taskType === 'writing' && (context.messageCount || 0) > 5) {
      out.push({
        suggestionId: generateId('sg'),
        type: 'related-feature',
        title: '尝试 Composer 多文件编辑',
        description: 'Composer 可同时编辑多个文件，适合长篇写作',
        action: { label: '打开 Composer', callbackKey: 'open-composer' },
        reason: '检测到写作任务',
        confidence: 0.65,
        context: { taskType: 'writing' },
        createdAt: now,
        expiresAt: now + ttl,
        source: 'rule',
      });
    }

    // 6. 待办任务
    if (context.hasPendingTasks) {
      out.push({
        suggestionId: generateId('sg'),
        type: 'next-action',
        title: '查看待办任务',
        description: '有未完成的后台任务，可点击查看进度',
        action: { label: '查看任务', callbackKey: 'open-background-tasks' },
        reason: '存在挂起任务',
        confidence: 0.85,
        context: { hasPendingTasks: true },
        createdAt: now,
        expiresAt: now + ttl,
        source: 'rule',
      });
    }

    // 7. 分析任务
    if (context.taskType === 'analysis') {
      out.push({
        suggestionId: generateId('sg'),
        type: 'faq',
        title: '如何提升分析准确性？',
        description: '开启多模型对比 + 提供上下文文档可显著提升分析质量',
        action: { label: '查看指南', callbackKey: 'view-analysis-guide' },
        reason: '检测到分析任务',
        confidence: 0.6,
        context: { taskType: 'analysis' },
        createdAt: now,
        expiresAt: now + ttl,
        source: 'rule',
      });
    }

    // 8. 通用：首次使用提示
    if ((context.messageCount || 0) === 0) {
      out.push({
        suggestionId: generateId('sg'),
        type: 'faq',
        title: '欢迎使用 Hermes',
        description: '输入 /help 可查看所有可用命令，使用 @code / @git 引用项目内容',
        action: { label: '查看帮助', callbackKey: 'open-help' },
        reason: '新会话',
        confidence: 0.8,
        context: { isNew: true },
        createdAt: now,
        expiresAt: now + ttl,
        source: 'rule',
      });
    }

    return out;
  }

  /** 基于 LLM 生成（stub 实现，实际可对接 LLM） */
  private generateFromLLMStub(_context: SessionContext): Suggestion[] {
    // 此处为占位实现，未来可对接真实 LLM
    // 当前返回空数组，由规则引擎主导
    return [];
  }

  /** 检查是否重复（窗口内同 type+title） */
  private isDuplicate(c: Suggestion, now: number): boolean {
    const key = this.getDedupKey(c);
    const lastTime = this.recentGenTimestamps.get(key);
    if (!lastTime) return false;
    return now - lastTime < this.config.dedupWindowMs;
  }

  /** 获取去重 key */
  private getDedupKey(s: Suggestion): string {
    return `${s.type}:${s.title}`;
  }

  /** 清理过期建议 */
  private cleanupExpired(): void {
    const now = Date.now();
    const before = this.active.length;
    this.active = this.active.filter((s) => {
      if (s.expiresAt < now) {
        this.markIgnored(s.suggestionId);
        return false;
      }
      return true;
    });
    if (this.active.length !== before) {
      this.stats.activeCount = this.active.length;
    }
  }

  /** 记录反馈 */
  private recordFeedback(
    suggestionId: string,
    s: Suggestion,
    feedback: SuggestionFeedbackType
  ): void {
    const startTime = this.displayStartTimes.get(suggestionId) || s.createdAt;
    this.feedbackRecords.push({
      suggestionId,
      feedback,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
      type: s.type,
      title: s.title,
    });
    // 限制历史记录长度
    if (this.feedbackRecords.length > 500) {
      this.feedbackRecords = this.feedbackRecords.slice(-500);
    }
  }

  /** 调整类型权重 */
  private adjustWeight(type: SuggestionType, delta: number): void {
    const w = this.typeWeights[type] || 1;
    this.typeWeights[type] = Math.max(0.1, Math.min(w + delta, 2.0));
  }

  /** 计算接受率 */
  private computeAcceptanceRate(): number {
    const total = this.stats.totalAccepted + this.stats.totalDismissed + this.stats.totalIgnored;
    if (total === 0) return 0;
    return this.stats.totalAccepted / total;
  }
}

// ============ 单例 ============

let _instance: ProactiveSuggestionEngine | null = null;

/** 获取全局单例 */
export function getProactiveSuggestionEngine(): ProactiveSuggestionEngine {
  if (!_instance) {
    _instance = new ProactiveSuggestionEngine();
  }
  return _instance;
}

/** 重置单例（测试用） */
export function resetProactiveSuggestionEngine(): void {
  if (_instance) {
    _instance.reset();
  }
  _instance = null;
}
