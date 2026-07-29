/**
 * # ============================================================
 * Composer Plan 引擎 (v6.37.0 Cycle 17 P0-1)
 * # ============================================================
 * 核心作用：实现 Composer 的 Plan Mode（先计划后执行）
 * 运行流程：
 *   1. generatePlan(prompt, context) → 基于规则引擎生成执行计划
 *   2. 用户对每个 PlanStep 进行 approve / reject / modify 操作
 *   3. executePlan(planId) → 批量创建 Edits 关联到 Steps
 *   4. 沿用原 Composer 的 accept/reject 工作流
 * 输入参数：prompt + ComposerContext
 * 输出结果：Plan（含多个 PlanStep）+ Edit 数组
 * 设计要点：
 *   - 完全独立模块，通过 ComposerEngine 组合
 *   - Plan 数据结构独立于 Session（避免污染）
 *   - 状态机：idle → analyzing → planned → approved → executing → completed
 * ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 17 P0-1 初次创建
 * ============================================================
 */

// ============================================================
// 类型定义
// ============================================================

/** Plan 阶段状态机 */
export type PlanStage =
  | 'idle'        // 初始
  | 'analyzing'   // 分析中
  | 'planned'     // 已生成计划
  | 'approved'    // 用户已批准
  | 'executing'   // 执行中
  | 'completed'   // 完成
  | 'rejected';   // 拒绝

/** 单个计划步骤的操作类型 */
export type PlanStepOperation = 'create' | 'modify' | 'delete' | 'rename';

/** 单个计划步骤的风险等级 */
export type PlanStepRisk = 'low' | 'medium' | 'high';

/** 单个计划步骤的状态 */
export type PlanStepStatus = 'pending' | 'approved' | 'rejected' | 'modified';

/** 单个计划步骤 */
export interface PlanStep {
  /** 唯一 ID */
  id: string;
  /** 目标文件路径 */
  filePath: string;
  /** 操作类型 */
  operation: PlanStepOperation;
  /** 计划描述（人类可读） */
  description: string;
  /** 预估修改行数 */
  estimatedLines: number;
  /** 风险等级 */
  riskLevel: PlanStepRisk;
  /** 步骤状态 */
  status: PlanStepStatus;
  /** 用户修改后的描述（modified 时） */
  modifiedDescription?: string;
  /** 拒绝原因（rejected 时） */
  rejectionReason?: string;
  /** 关联的 Edit ID（executePlan 后填充） */
  editId?: string;
  /** 修改前内容（仅 modify/rename 操作） */
  beforeContent?: string;
  /** 修改后内容（仅 modify/create/rename 操作） */
  afterContent?: string;
}

/** 完整执行计划 */
export interface Plan {
  /** 唯一 ID */
  id: string;
  /** 触发该计划的 prompt */
  prompt: string;
  /** 计划摘要（人类可读） */
  summary: string;
  /** 步骤列表 */
  steps: PlanStep[];
  /** 预估执行时间（ms） */
  estimatedDurationMs: number;
  /** 总修改行数 */
  totalLines: number;
  /** 风险评估说明 */
  riskAssessment: string;
  /** 创建时间戳 */
  createdAt: number;
}

/** Plan Stage 变更订阅回调 */
export type PlanStageListener = (plan: Plan | null, stage: PlanStage) => void;

// ============================================================
// 常量
// ============================================================

/** 单个 Plan 的最大步骤数（防止误用） */
export const MAX_PLAN_STEPS = 100;

/** 默认每步预估时间（ms） */
export const DEFAULT_STEP_DURATION_MS = 500;

// ============================================================
// 错误类型
// ============================================================

/** Plan 引擎错误 */
export class PlanEngineError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'PlanEngineError';
  }
}

// ============================================================
// ID 生成
// ============================================================

let _planIdCounter = 0;

/** 生成 Plan 专用 ID */
function _genPlanId(prefix: string): string {
  _planIdCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${_planIdCounter.toString(36)}`;
}

// ============================================================
// PlanEngine 实现
// ============================================================

/**
 * Plan 引擎：独立管理 Plan 生命周期
 * 与 ComposerEngine 解耦，通过回调/订阅方式交互
 */
export class PlanEngine {
  private currentPlan: Plan | null = null;
  private stage: PlanStage = 'idle';
  private listeners: Set<PlanStageListener> = new Set();

  // ============================================================
  // 查询
  // ============================================================

  /** 获取当前 Plan */
  getCurrentPlan(): Plan | null {
    return this.currentPlan ? { ...this.currentPlan, steps: [...this.currentPlan.steps] } : null;
  }

  /** 获取当前阶段 */
  getStage(): PlanStage {
    return this.stage;
  }

  /** 是否有活跃 Plan */
  hasActivePlan(): boolean {
    return this.currentPlan !== null;
  }

  // ============================================================
  // Plan 生成
  // ============================================================

  /**
   * 生成执行计划
   * @param prompt 用户 prompt
   * @param context Composer 上下文（FileContext[]）
   * @param generator 可选的自定义 plan 生成器（默认使用规则引擎）
   * @returns 生成的 Plan
   * @throws PlanEngineError 当已有 plan 或 prompt 为空时
   */
  async generatePlan(
    prompt: string,
    context: Array<{ path: string; content: string; language: string }>,
    generator?: (prompt: string, context: Array<{ path: string; content: string; language: string }>) => Promise<Omit<Plan, 'id' | 'createdAt'>>
  ): Promise<Plan> {
    if (this.currentPlan !== null) {
      throw new PlanEngineError(
        '已有活跃 Plan，请先拒绝或执行当前 Plan',
        'PLAN_ALREADY_EXISTS'
      );
    }
    if (!prompt || !prompt.trim()) {
      throw new PlanEngineError('Prompt 不能为空', 'EMPTY_PROMPT');
    }

    // 进入 analyzing 阶段
    this.stage = 'analyzing';
    this._notify();

    try {
      // 异步生成
      const raw = generator
        ? await generator(prompt, context)
        : await this._defaultPlanGenerator(prompt, context);

      // 校验步骤数
      if (raw.steps.length > MAX_PLAN_STEPS) {
        throw new PlanEngineError(
          `计划步骤数（${raw.steps.length}）超过最大限制（${MAX_PLAN_STEPS}），请拆分需求`,
          'TOO_MANY_STEPS'
        );
      }

      // 构造 Plan
      this.currentPlan = {
        ...raw,
        id: _genPlanId('plan'),
        createdAt: Date.now(),
      };
      this.stage = 'planned';
      this._notify();
      return this.getCurrentPlan()!;
    } catch (err) {
      this.stage = 'idle';
      this._notify();
      throw err;
    }
  }

  /**
   * 默认 Plan 生成器（基于规则引擎）
   * 解析 prompt 中的关键词，匹配受影响文件并生成 PlanStep
   */
  private async _defaultPlanGenerator(
    prompt: string,
    context: Array<{ path: string; content: string; language: string }>
  ): Promise<Omit<Plan, 'id' | 'createdAt'>> {
    // 模拟异步
    await new Promise((resolve) => setTimeout(resolve, 50));

    const lowerPrompt = prompt.toLowerCase();
    const steps: PlanStep[] = [];

    // 规则 1: 重命名
    const renameMatch = lowerPrompt.match(/rename\s+(\w+)\s+(?:to|as)\s+(\w+)/);
    if (renameMatch) {
      const fromName = renameMatch[1];
      const toName = renameMatch[2];
      // 使用 case-insensitive 比较
      for (const file of context) {
        const lowerContent = file.content.toLowerCase();
        if (lowerContent.includes(fromName)) {
          steps.push({
            id: _genPlanId('step'),
            filePath: file.path,
            operation: 'modify',
            description: `在 ${file.path} 中将 ${fromName} 重命名为 ${toName}`,
            estimatedLines: this._countOccurrencesIgnoreCase(file.content, fromName),
            riskLevel: 'medium',
            status: 'pending',
          });
        }
      }
    }

    // 规则 2: 添加 / 实现功能
    if (lowerPrompt.includes('add') || lowerPrompt.includes('implement')) {
      for (const file of context) {
        steps.push({
          id: _genPlanId('step'),
          filePath: file.path,
          operation: 'modify',
          description: `在 ${file.path} 中添加新功能`,
          estimatedLines: 20,
          riskLevel: 'low',
          status: 'pending',
        });
      }
    }

    // 规则 3: 重构
    if (lowerPrompt.includes('refactor') || lowerPrompt.includes('重构')) {
      for (const file of context) {
        steps.push({
          id: _genPlanId('step'),
          filePath: file.path,
          operation: 'modify',
          description: `重构 ${file.path}`,
          estimatedLines: Math.min(50, file.content.split('\n').length),
          riskLevel: 'high',
          status: 'pending',
        });
      }
    }

    // 规则 4: 修复 bug
    if (lowerPrompt.includes('fix') || lowerPrompt.includes('修复')) {
      for (const file of context) {
        steps.push({
          id: _genPlanId('step'),
          filePath: file.path,
          operation: 'modify',
          description: `修复 ${file.path} 中的问题`,
          estimatedLines: 5,
          riskLevel: 'low',
          status: 'pending',
        });
      }
    }

    // 默认：没有匹配规则或 context 为空时，生成一个 generic step
    if (steps.length === 0) {
      const targetFile = context.length > 0 ? context[0].path : 'untitled.ts';
      steps.push({
        id: _genPlanId('step'),
        filePath: targetFile,
        operation: 'modify',
        description: context.length > 0
          ? `应用变更到 ${targetFile}`
          : `根据 prompt "${prompt}" 创建新文件`,
        estimatedLines: 10,
        riskLevel: 'low',
        status: 'pending',
      });
    }

    const totalLines = steps.reduce((sum, s) => sum + s.estimatedLines, 0);
    const highRiskCount = steps.filter((s) => s.riskLevel === 'high').length;

    return {
      prompt,
      summary: this._generateSummary(steps, context.length),
      steps,
      estimatedDurationMs: steps.length * DEFAULT_STEP_DURATION_MS,
      totalLines,
      riskAssessment: highRiskCount > 0
        ? `包含 ${highRiskCount} 个高风险步骤，建议逐个审阅`
        : '整体风险可控',
    };
  }

  /** 生成计划摘要 */
  private _generateSummary(steps: PlanStep[], fileCount: number): string {
    const createCount = steps.filter((s) => s.operation === 'create').length;
    const modifyCount = steps.filter((s) => s.operation === 'modify').length;
    const deleteCount = steps.filter((s) => s.operation === 'delete').length;
    const parts: string[] = [];
    if (modifyCount > 0) parts.push(`修改 ${modifyCount} 个文件`);
    if (createCount > 0) parts.push(`创建 ${createCount} 个文件`);
    if (deleteCount > 0) parts.push(`删除 ${deleteCount} 个文件`);
    if (parts.length === 0) return `影响 ${fileCount} 个文件`;
    return parts.join('，');
  }

  /** 统计子串出现次数 */
  private _countOccurrences(str: string, sub: string): number {
    if (!sub) return 0;
    let count = 0;
    let idx = 0;
    while ((idx = str.indexOf(sub, idx)) !== -1) {
      count += 1;
      idx += sub.length;
    }
    return count;
  }

  /** 统计子串出现次数（忽略大小写） */
  private _countOccurrencesIgnoreCase(str: string, sub: string): number {
    if (!sub) return 0;
    const lowerStr = str.toLowerCase();
    const lowerSub = sub.toLowerCase();
    return this._countOccurrences(lowerStr, lowerSub);
  }

  // ============================================================
  // Plan 步骤操作
  // ============================================================

  /**
   * 批准单个步骤
   */
  approveStep(stepId: string): void {
    this._checkPlanExists();
    const step = this.currentPlan!.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new PlanEngineError(`步骤不存在: ${stepId}`, 'STEP_NOT_FOUND');
    }
    step.status = 'approved';
    this._notify();
  }

  /**
   * 拒绝单个步骤
   */
  rejectStep(stepId: string, reason?: string): void {
    this._checkPlanExists();
    const step = this.currentPlan!.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new PlanEngineError(`步骤不存在: ${stepId}`, 'STEP_NOT_FOUND');
    }
    step.status = 'rejected';
    step.rejectionReason = reason;
    this._notify();
  }

  /**
   * 修改单个步骤
   */
  modifyStep(stepId: string, modifiedDescription: string): void {
    this._checkPlanExists();
    const step = this.currentPlan!.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new PlanEngineError(`步骤不存在: ${stepId}`, 'STEP_NOT_FOUND');
    }
    if (!modifiedDescription || !modifiedDescription.trim()) {
      throw new PlanEngineError('修改描述不能为空', 'EMPTY_MODIFICATION');
    }
    step.status = 'modified';
    step.modifiedDescription = modifiedDescription.trim();
    this._notify();
  }

  /**
   * 批准所有 pending 步骤
   */
  approveAll(): void {
    this._checkPlanExists();
    for (const step of this.currentPlan!.steps) {
      if (step.status === 'pending') {
        step.status = 'approved';
      }
    }
    this._notify();
  }

  /**
   * 拒绝所有 pending 步骤
   * 注意：如果所有步骤都被拒绝，stage 自动转为 rejected
   */
  rejectAll(): void {
    this._checkPlanExists();
    for (const step of this.currentPlan!.steps) {
      if (step.status === 'pending') {
        step.status = 'rejected';
      }
    }
    // 检查是否所有步骤都已 rejected/modified
    const allResolved = this.currentPlan!.steps.every(
      (s) => s.status === 'rejected' || s.status === 'approved' || s.status === 'modified'
    );
    if (allResolved) {
      const hasApproved = this.currentPlan!.steps.some(
        (s) => s.status === 'approved' || s.status === 'modified'
      );
      this.stage = hasApproved ? 'planned' : 'rejected';
    }
    this._notify();
  }

  // ============================================================
  // Plan 整体操作
  // ============================================================

  /**
   * 批准整个 Plan（所有步骤视为已批准）
   */
  approvePlan(): void {
    this._checkPlanExists();
    if (this.stage !== 'planned') {
      throw new PlanEngineError(
        `当前阶段（${this.stage}）不允许批准 Plan`,
        'INVALID_STAGE'
      );
    }
    for (const step of this.currentPlan!.steps) {
      if (step.status === 'pending') {
        step.status = 'approved';
      }
    }
    this.stage = 'approved';
    this._notify();
  }

  /**
   * 拒绝整个 Plan
   */
  rejectPlan(reason?: string): void {
    if (!this.currentPlan) return;
    for (const step of this.currentPlan!.steps) {
      if (step.status === 'pending' || step.status === 'modified') {
        step.status = 'rejected';
        if (reason && !step.rejectionReason) {
          step.rejectionReason = reason;
        }
      }
    }
    this.stage = 'rejected';
    this._notify();
  }

  /**
   * 执行 Plan：为所有 approved/modified 步骤生成 Edit 草稿
   * @param editGenerator 根据 PlanStep 生成 Edit 内容
   * @returns 生成的 Edit 数组
   */
  async executePlan(
    editGenerator: (step: PlanStep) => Promise<{
      beforeContent: string;
      afterContent: string;
    }>
  ): Promise<Array<{ stepId: string; editId: string }>> {
    this._checkPlanExists();
    if (this.stage !== 'planned' && this.stage !== 'approved') {
      throw new PlanEngineError(
        `当前阶段（${this.stage}）不允许执行 Plan`,
        'INVALID_STAGE'
      );
    }

    this.stage = 'executing';
    this._notify();

    try {
      const result: Array<{ stepId: string; editId: string }> = [];
      const approvedSteps = this.currentPlan!.steps.filter(
        (s) => s.status === 'approved' || s.status === 'modified'
      );

      for (const step of approvedSteps) {
        const { beforeContent, afterContent } = await editGenerator(step);
        step.beforeContent = beforeContent;
        step.afterContent = afterContent;
        step.editId = _genPlanId('edit');
        result.push({ stepId: step.id, editId: step.editId });
      }

      this.stage = 'completed';
      this._notify();
      return result;
    } catch (err) {
      this.stage = 'planned';
      this._notify();
      throw err;
    }
  }

  /**
   * 清除当前 Plan
   */
  clearPlan(): void {
    this.currentPlan = null;
    this.stage = 'idle';
    this._notify();
  }

  // ============================================================
  // 订阅
  // ============================================================

  /**
   * 订阅 Plan 变化
   */
  subscribe(callback: PlanStageListener): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  // ============================================================
  // 序列化
  // ============================================================

  /**
   * 序列化 Plan 为 JSON
   */
  serializePlan(): string {
    return JSON.stringify({
      plan: this.currentPlan,
      stage: this.stage,
    });
  }

  /**
   * 从 JSON 恢复 Plan
   */
  deserializePlan(json: string): boolean {
    try {
      const data = JSON.parse(json);
      if (data && data.plan && data.stage) {
        this.currentPlan = data.plan;
        this.stage = data.stage;
        this._notify();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // ============================================================
  // 内部
  // ============================================================

  private _checkPlanExists(): void {
    if (!this.currentPlan) {
      throw new PlanEngineError('当前没有活跃 Plan', 'NO_ACTIVE_PLAN');
    }
  }

  private _notify(): void {
    const plan = this.getCurrentPlan();
    const stage = this.stage;
    for (const cb of this.listeners) {
      try {
        cb(plan, stage);
      } catch (err) {
        console.error('PlanEngine listener error:', err);
      }
    }
  }
}

// ============================================================
// 工厂函数
// ============================================================

/** 创建 PlanEngine */
export function createPlanEngine(): PlanEngine {
  return new PlanEngine();
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 计算计划的总体风险等级
 */
export function calculateOverallRisk(plan: Plan): PlanStepRisk {
  const highCount = plan.steps.filter((s) => s.riskLevel === 'high').length;
  if (highCount > 0) return 'high';
  const mediumCount = plan.steps.filter((s) => s.riskLevel === 'medium').length;
  if (mediumCount > plan.steps.length / 2) return 'medium';
  return 'low';
}

/**
 * 提取已批准步骤
 */
export function getApprovedSteps(plan: Plan): PlanStep[] {
  return plan.steps.filter((s) => s.status === 'approved' || s.status === 'modified');
}

/**
 * 提取已拒绝步骤
 */
export function getRejectedSteps(plan: Plan): PlanStep[] {
  return plan.steps.filter((s) => s.status === 'rejected');
}

export default PlanEngine;
