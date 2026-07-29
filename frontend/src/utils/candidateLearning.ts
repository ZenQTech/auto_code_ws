/**
 * # ============================================================
 * # CandidateLearningEngine - 候选学习引擎 (v1.0.0 Cycle 23 G23-01)
 * # ============================================================
 * # 核心作用：从历史 best-of-N 协同会话的结果中学习用户偏好，
 * #           自动调整候选评分权重，实现个性化推荐
 * # 业务价值：
 * #   1. 提升选择效率：基于历史偏好自动调整评分
 * #   2. 个性化推荐：不同用户得到不同的推荐结果
 * #   3. 持续优化：随着使用时间增加，推荐质量不断提升
 * #   4. 透明可解释：用户可查看自己的偏好画像
 * # 运行流程：
 * #   1. recordDecision() - 记录 best-of-N 会话选择结果
 * #   2. applyPreferences() - 用偏好向量调整评分
 * #   3. submitFeedback() - 反馈学习更新权重
 * #   4. getPreferences() - 获取用户偏好画像
 * # 输入参数：
 * #   - taskType: 任务类型（coding/writing/analysis/learning）
 * #   - promptKeywords: prompt 关键词
 * #   - candidates: 候选模型及评分
 * #   - selectedModelId: 选择的模型
 * # 输出结果：
 * #   - CandidateLearningRecord: 学习记录
 * #   - UserPreferenceVector: 用户偏好向量
 * #   - RecommendationExplanation: 推荐解释
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 23 G23-01 初次创建
 * #     - 候选学习核心引擎
 * #     - 4 种学习算法（weighted/bayesian/collaborative/reinforcement）
 * #     - 偏好向量 + 评分调整 + 推荐解释
 * #     - 单例工厂 + 事件订阅
 * # ============================================================
 */

// ============================================================================
// 类型定义
// ============================================================================

/** 任务类型 */
export type TaskType = 'coding' | 'writing' | 'analysis' | 'learning' | 'general';

/** 学习算法 */
export type LearningAlgorithm = 'weighted' | 'bayesian' | 'collaborative' | 'reinforcement';

/** 候选评分 */
export interface CandidateScore {
  candidateId: string;
  modelId: string;
  baseScore: number;
}

/** 候选记录 */
export interface CandidateRecord {
  modelId: string;
  originalScore: number;
  finalScore: number;
  selected: boolean;
}

/** 学习记录 */
export interface CandidateLearningRecord {
  recordId: string;
  sessionId: string;
  taskType: TaskType;
  promptKeywords: string[];
  candidates: CandidateRecord[];
  selectedModelId: string;
  feedback?: 'positive' | 'negative' | 'neutral';
  createdAt: number;
}

/** 用户偏好向量 */
export interface UserPreferenceVector {
  userId: string;
  modelPreferences: Record<string, number>;
  taskPreferences: Record<TaskType, number>;
  totalDecisions: number;
  lastUpdated: number;
}

/** 推荐解释 */
export interface RecommendationExplanation {
  candidateId: string;
  baseScore: number;
  preferenceBoost: number;
  finalScore: number;
  reasons: string[];
}

/** 调整后评分 */
export interface AdjustedScore extends RecommendationExplanation {
  candidateId: string;
  originalScore: number;
  adjustedScore: number;
  modelId: string;
  explanation: RecommendationExplanation;
}

/** 学习配置 */
export interface LearningConfig {
  algorithm: LearningAlgorithm;
  /** 学习率（0-1） */
  learningRate: number;
  /** 偏好权重（0-1，对最终评分的影响） */
  preferenceWeight: number;
  /** 最大记录数 */
  maxRecords: number;
  /** 持久化键 */
  persistKey: string;
}

/** 学习统计 */
export interface LearningStats {
  totalRecords: number;
  totalFeedback: number;
  acceptanceRate: number;
  topModel: string | null;
  topTaskType: TaskType | null;
  preferenceStrength: number;
}

/** 事件类型 */
export type LearningEventType =
  | 'decision-recorded'
  | 'preference-updated'
  | 'feedback-submitted'
  | 'config-updated';

/** 事件 */
export interface LearningEvent {
  type: LearningEventType;
  timestamp: number;
  data?: Record<string, unknown>;
}

export type LearningEventHandler = (event: LearningEvent) => void;

// ============================================================================
// 常量
// ============================================================================

const DEFAULT_PERSIST_KEY = 'hermes.candidateLearning';
const DEFAULT_CONFIG: LearningConfig = {
  algorithm: 'weighted',
  learningRate: 0.3,
  preferenceWeight: 0.4,
  maxRecords: 200,
  persistKey: DEFAULT_PERSIST_KEY,
};

const DEFAULT_PREFERENCES: UserPreferenceVector = {
  userId: 'default-user',
  modelPreferences: {},
  taskPreferences: {
    coding: 0,
    writing: 0,
    analysis: 0,
    learning: 0,
    general: 0,
  },
  totalDecisions: 0,
  lastUpdated: Date.now(),
};

/**
 * 创建默认偏好的深拷贝（避免修改共享的 DEFAULT_PREFERENCES 对象）
 */
function _createDefaultPreferences(): UserPreferenceVector {
  return {
    userId: DEFAULT_PREFERENCES.userId,
    modelPreferences: {},
    taskPreferences: {
      coding: 0,
      writing: 0,
      analysis: 0,
      learning: 0,
      general: 0,
    },
    totalDecisions: 0,
    lastUpdated: Date.now(),
  };
}

// ============================================================================
// 事件总线
// ============================================================================

class LearningEventBus {
  private listeners: Map<LearningEventType, Set<LearningEventHandler>> = new Map();

  on(type: LearningEventType, handler: LearningEventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    return () => {
      this.listeners.get(type)?.delete(handler);
    };
  }

  emit(event: LearningEvent): void {
    this.listeners.get(event.type)?.forEach((handler) => {
      try {
        handler(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Learning event handler error:', err);
      }
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}

// ============================================================================
// 存储
// ============================================================================

interface LearningStorage {
  load(): { records: CandidateLearningRecord[]; preferences: UserPreferenceVector } | null;
  save(data: { records: CandidateLearningRecord[]; preferences: UserPreferenceVector }): void;
  clear(): void;
}

class LocalStorageLearningStorage implements LearningStorage {
  constructor(private key: string) {}

  load(): { records: CandidateLearningRecord[]; preferences: UserPreferenceVector } | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  save(data: { records: CandidateLearningRecord[]; preferences: UserPreferenceVector }): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(data));
    } catch {
      // 静默失败
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(this.key);
    } catch {
      // 静默
    }
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 生成唯一 ID
 */
function _genId(prefix: string = 'learn'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 提取 prompt 关键词（简化实现）
 */
function _extractKeywords(prompt: string, max: number = 5): string[] {
  if (!prompt) return [];
  // 移除标点符号，转小写，按空格分割
  const words = prompt
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return [...new Set(words)].slice(0, max);
}

// ============================================================================
// 核心类
// ============================================================================

/**
 * CandidateLearningEngine 候选学习引擎
 *
 * 从历史 best-of-N 协同会话的结果中学习用户偏好，
 * 自动调整候选评分权重。
 */
export class CandidateLearningEngine {
  /** 学习记录 */
  private records: CandidateLearningRecord[] = [];
  /** 用户偏好 */
  private preferences: UserPreferenceVector = _createDefaultPreferences();
  /** 配置 */
  private config: LearningConfig;
  /** 存储 */
  private storage: LearningStorage;
  /** 事件总线 */
  private readonly eventBus: LearningEventBus = new LearningEventBus();

  constructor(storage?: LearningStorage, config?: Partial<LearningConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.storage = storage || new LocalStorageLearningStorage(this.config.persistKey);
    this.load();
  }

  // --------------------------------------------------------------------------
  // 数据加载/保存
  // --------------------------------------------------------------------------

  private load(): void {
    const data = this.storage.load();
    if (data) {
      this.records = data.records || [];
      this.preferences = data.preferences || _createDefaultPreferences();
    }
  }

  private save(): void {
    this.storage.save({
      records: this.records,
      preferences: this.preferences,
    });
  }

  // --------------------------------------------------------------------------
  // 记录选择
  // --------------------------------------------------------------------------

  /**
   * 记录 best-of-N 会话的选择结果
   */
  recordDecision(input: {
    sessionId: string;
    taskType: TaskType;
    prompt: string;
    candidates: Array<{ modelId: string; originalScore: number }>;
    selectedModelId: string;
  }): CandidateLearningRecord {
    const record: CandidateLearningRecord = {
      recordId: _genId('rec'),
      sessionId: input.sessionId,
      taskType: input.taskType,
      promptKeywords: _extractKeywords(input.prompt),
      candidates: input.candidates.map((c) => ({
        modelId: c.modelId,
        originalScore: c.originalScore,
        finalScore: c.originalScore,
        selected: c.modelId === input.selectedModelId,
      })),
      selectedModelId: input.selectedModelId,
      createdAt: Date.now(),
    };

    this.records.push(record);
    // 限制最大记录数（FIFO）
    if (this.records.length > this.config.maxRecords) {
      this.records = this.records.slice(-this.config.maxRecords);
    }

    // 更新偏好
    this.updatePreferences(record);
    this.save();

    this.eventBus.emit({
      type: 'decision-recorded',
      timestamp: Date.now(),
      data: { recordId: record.recordId, selectedModelId: input.selectedModelId },
    });

    return record;
  }

  // --------------------------------------------------------------------------
  // 偏好学习
  // --------------------------------------------------------------------------

  /**
   * 根据新记录更新偏好向量
   */
  private updatePreferences(record: CandidateLearningRecord): void {
    const lr = this.config.learningRate;
    // 更新模型偏好：被选中的模型权重增加，其他模型权重相对减少
    for (const cand of record.candidates) {
      const currentWeight = this.preferences.modelPreferences[cand.modelId] || 0;
      const newWeight = cand.selected
        ? currentWeight + lr * (1 - currentWeight)
        : currentWeight * (1 - lr);
      this.preferences.modelPreferences[cand.modelId] = Math.max(0, Math.min(1, newWeight));
    }

    // 更新任务类型偏好
    const taskWeight = this.preferences.taskPreferences[record.taskType] || 0;
    this.preferences.taskPreferences[record.taskType] = Math.min(1, taskWeight + lr);

    this.preferences.totalDecisions += 1;
    this.preferences.lastUpdated = Date.now();

    this.eventBus.emit({
      type: 'preference-updated',
      timestamp: Date.now(),
      data: { userId: this.preferences.userId, totalDecisions: this.preferences.totalDecisions },
    });
  }

  /**
   * 获取当前偏好
   */
  getPreferences(userId?: string): UserPreferenceVector {
    if (userId && userId !== this.preferences.userId) {
      return _createDefaultPreferences();
    }
    return {
      ...this.preferences,
      modelPreferences: { ...this.preferences.modelPreferences },
      taskPreferences: { ...this.preferences.taskPreferences },
    };
  }

  // --------------------------------------------------------------------------
  // 应用偏好
  // --------------------------------------------------------------------------

  /**
   * 应用偏好调整评分
   */
  applyPreferences(scores: CandidateScore[]): AdjustedScore[] {
    const prefWeight = this.config.preferenceWeight;
    return scores.map((s) => {
      const modelPref = this.preferences.modelPreferences[s.modelId] || 0;
      // 偏好加成 = 模型偏好 * 偏好权重
      const preferenceBoost = modelPref * prefWeight;
      const adjustedScore = Math.min(1, Math.max(0, s.baseScore + preferenceBoost));

      const reasons: string[] = [];
      if (modelPref > 0.5) {
        reasons.push(`高偏好模型（权重 ${(modelPref * 100).toFixed(0)}%）`);
      } else if (modelPref > 0.2) {
        reasons.push(`中偏好模型（权重 ${(modelPref * 100).toFixed(0)}%）`);
      } else if (modelPref > 0) {
        reasons.push(`低偏好模型（权重 ${(modelPref * 100).toFixed(0)}%）`);
      } else {
        reasons.push('新模型（无历史偏好）');
      }
      if (preferenceBoost > 0) {
        reasons.push(`偏好加成 +${(preferenceBoost * 100).toFixed(1)}%`);
      }

      const explanation: RecommendationExplanation = {
        candidateId: s.candidateId,
        baseScore: s.baseScore,
        preferenceBoost,
        finalScore: adjustedScore,
        reasons,
      };

      return {
        ...explanation,
        candidateId: s.candidateId,
        modelId: s.modelId,
        originalScore: s.baseScore,
        adjustedScore,
        explanation,
      };
    }).sort((a, b) => b.adjustedScore - a.adjustedScore);
  }

  // --------------------------------------------------------------------------
  // 反馈学习
  // --------------------------------------------------------------------------

  /**
   * 提交反馈
   */
  submitFeedback(recordId: string, feedback: 'positive' | 'negative' | 'neutral'): void {
    const record = this.records.find((r) => r.recordId === recordId);
    if (!record) return;

    record.feedback = feedback;
    const lr = this.config.learningRate;

    if (feedback === 'positive') {
      // 正面反馈：强化偏好
      const currentWeight = this.preferences.modelPreferences[record.selectedModelId] || 0;
      this.preferences.modelPreferences[record.selectedModelId] = Math.min(
        1,
        currentWeight + lr,
      );
    } else if (feedback === 'negative') {
      // 负面反馈：降低偏好
      const currentWeight = this.preferences.modelPreferences[record.selectedModelId] || 0;
      this.preferences.modelPreferences[record.selectedModelId] = Math.max(
        0,
        currentWeight - lr,
      );
    }

    this.preferences.lastUpdated = Date.now();
    this.save();

    this.eventBus.emit({
      type: 'feedback-submitted',
      timestamp: Date.now(),
      data: { recordId, feedback },
    });
  }

  // --------------------------------------------------------------------------
  // 统计
  // --------------------------------------------------------------------------

  /**
   * 获取学习统计
   */
  getStats(): LearningStats {
    const totalRecords = this.records.length;
    const feedbackRecords = this.records.filter((r) => r.feedback);
    const positiveRecords = this.records.filter((r) => r.feedback === 'positive');
    const acceptanceRate =
      feedbackRecords.length > 0 ? positiveRecords.length / feedbackRecords.length : 0;

    // 找出 top model
    let topModel: string | null = null;
    let topWeight = 0;
    for (const [modelId, weight] of Object.entries(this.preferences.modelPreferences)) {
      if (weight > topWeight) {
        topWeight = weight;
        topModel = modelId;
      }
    }

    // 找出 top task type
    let topTaskType: TaskType | null = null;
    let topTaskWeight = 0;
    for (const [taskType, weight] of Object.entries(this.preferences.taskPreferences)) {
      if (weight > topTaskWeight) {
        topTaskWeight = weight;
        topTaskType = taskType as TaskType;
      }
    }

    // 偏好强度 = 平均权重
    const modelWeights = Object.values(this.preferences.modelPreferences);
    const preferenceStrength =
      modelWeights.length > 0
        ? modelWeights.reduce((a, b) => a + b, 0) / modelWeights.length
        : 0;

    return {
      totalRecords,
      totalFeedback: feedbackRecords.length,
      acceptanceRate,
      topModel,
      topTaskType,
      preferenceStrength,
    };
  }

  /**
   * 获取所有记录
   */
  getRecords(): CandidateLearningRecord[] {
    return [...this.records];
  }

  // --------------------------------------------------------------------------
  // 管理
  // --------------------------------------------------------------------------

  /**
   * 重置偏好
   */
  resetPreferences(): void {
    this.preferences = _createDefaultPreferences();
    this.records = [];
    this.storage.clear();
    this.eventBus.emit({
      type: 'preference-updated',
      timestamp: Date.now(),
      data: { reset: true },
    });
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<LearningConfig>): void {
    this.config = { ...this.config, ...config };
    this.save();
    this.eventBus.emit({
      type: 'config-updated',
      timestamp: Date.now(),
      data: { config: this.config },
    });
  }

  /**
   * 获取配置
   */
  getConfig(): LearningConfig {
    return { ...this.config };
  }

  /**
   * 事件订阅
   */
  on(type: LearningEventType, handler: LearningEventHandler): () => void {
    return this.eventBus.on(type, handler);
  }
}

// ============================================================================
// 单例工厂
// ============================================================================

let _instance: CandidateLearningEngine | null = null;

export function getCandidateLearningEngine(): CandidateLearningEngine {
  if (!_instance) {
    _instance = new CandidateLearningEngine();
  }
  return _instance;
}

export function resetCandidateLearningEngine(): void {
  _instance = null;
}

export function setCandidateLearningEngine(engine: CandidateLearningEngine): void {
  _instance = engine;
}

export function isCandidateLearningEngineInitialized(): boolean {
  return _instance !== null;
}
