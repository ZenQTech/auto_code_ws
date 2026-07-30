/**
 * # ============================================================
 * Stacked Skill Engine - 堆叠技能引擎 (v1.0.0 Cycle 29 G29-01)
 * # ============================================================
 * 核心作用：实现 Claude Code v2.1.199+ 风格的 Stacked Skills 能力
 * 支持一次调用最多 5 个技能的堆叠编排
 *
 * 运行流程：
 *   1. parseStackedCommand 解析 "/a /b /c arg1 arg2" 格式命令
 *   2. validateComposition 验证技能组合（工具冲突/权限冲突）
 *   3. executeStack 并行或串行执行所有技能
 *   4. 聚合所有技能的输出为单一结果
 *   5. 事件总线实时通知每个阶段
 *
 * 输入参数：
 *   - input: 形如 "/code-review /security-scanner src/foo.ts" 的命令字符串
 *   - options: { sharedContext, parallelExecution, stopOnFirstFailure }
 *
 * 输出结果：StackedExecutionResult (聚合多个技能结果)
 *
 * 修改记录：
 *   - 2026-07-30 | v1.0.0 | Cycle 29 G29-01 初次创建
 * # ============================================================
 */

import { SkillEngine, getDefaultSkillEngine } from './skillEngine';
import { SkillExecutionResult } from './skillTypes';

// ============ 类型定义 ============

/**
 * 堆叠命令
 */
export interface StackedCommand {
  /** 技能名称列表（最多 5 个） */
  skillNames: string[];
  /** 共享的命令参数 */
  args: string;
  /** 是否共享上下文（默认 false） */
  sharedContext: boolean;
  /** 解析时间戳 */
  parsedAt: number;
}

/**
 * 技能冲突
 */
export interface SkillConflict {
  type: 'tool-overlap' | 'context-incompatible' | 'permission-conflict' | 'skill-disabled' | 'skill-not-found';
  skills: string[];
  details: string;
}

/**
 * 组合检查结果
 */
export interface CompositionCheckResult {
  valid: boolean;
  conflicts: SkillConflict[];
  warnings: string[];
  effectiveTools: string[];
}

/**
 * 单个技能执行结果（堆叠上下文）
 */
export interface StackedSkillResult {
  skillName: string;
  result: SkillExecutionResult;
  durationMs: number;
  order: number;
}

/**
 * 整体执行结果
 */
export interface StackedExecutionResult {
  command: StackedCommand;
  results: StackedSkillResult[];
  aggregatedOutput: string;
  totalDurationMs: number;
  conflicts: SkillConflict[];
  successCount: number;
  failureCount: number;
}

/**
 * 引擎配置
 */
export interface StackedSkillConfig {
  /** 最大堆叠数量（默认 5） */
  maxStackSize: number;
  /** 是否允许共享上下文 */
  allowSharedContext: boolean;
  /** 默认并行执行 */
  parallelExecution: boolean;
  /** 失败时是否停止 */
  stopOnFirstFailure: boolean;
  /** 是否持久化执行历史 */
  persist: boolean;
}

export const DEFAULT_STACKED_SKILL_CONFIG: StackedSkillConfig = {
  maxStackSize: 5,
  allowSharedContext: true,
  parallelExecution: true,
  stopOnFirstFailure: false,
  persist: true,
};

/**
 * 事件类型
 */
export type StackedSkillEventType =
  | 'stack-parsed'
  | 'stack-validated'
  | 'stack-started'
  | 'skill-started'
  | 'skill-completed'
  | 'skill-failed'
  | 'stack-completed';

/**
 * 事件
 */
export interface StackedSkillEvent {
  type: StackedSkillEventType;
  timestamp: number;
  data: Record<string, unknown>;
}

// ============ 工具函数 ============

/**
 * 解析堆叠命令字符串
 * 输入："/code-review /security-scanner --strict /refactor src/foo.ts"
 * 输出：{ skillNames: ['code-review', 'security-scanner', 'refactor'], args: '--strict src/foo.ts' }
 */
export function parseStackedCommandString(input: string): { skillNames: string[]; args: string } | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const tokens = trimmed.split(/\s+/);
  const skillNames: string[] = [];
  const args: string[] = [];
  let foundNonSkill = false;

  for (const token of tokens) {
    if (token.startsWith('/') && !foundNonSkill) {
      // 技能名（去掉 / 前缀）
      const name = token.slice(1);
      if (name) {
        skillNames.push(name);
      }
    } else {
      // 一旦遇到非 / 开头的 token，后续都视为 args
      foundNonSkill = true;
      args.push(token);
    }
  }

  if (skillNames.length === 0) return null;
  return { skillNames, args: args.join(' ') };
}

/**
 * 工具冲突信息
 */
export interface ToolConflict {
  tool: string;
  skills: string[];
  modes: string[];
}

// ============ 引擎类 ============

/**
 * 堆叠技能引擎
 */
export class StackedSkillEngine {
  private config: StackedSkillConfig;
  private listeners: Map<StackedSkillEventType, Set<(e: StackedSkillEvent) => void>> = new Map();
  private history: Array<{ command: StackedCommand; result: StackedExecutionResult; timestamp: number }> = [];
  private storageKey = 'hermes.stackedSkills';

  constructor(
    private skillEngine: SkillEngine,
    config: Partial<StackedSkillConfig> = {}
  ) {
    this.config = { ...DEFAULT_STACKED_SKILL_CONFIG, ...config };
    if (this.config.persist) {
      this.load();
    }
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.history)) {
        this.history = data.history.slice(-50);
      }
    } catch (e) {
      console.warn('StackedSkillEngine: failed to load', e);
    }
  }

  private save(): void {
    if (!this.config.persist) return;
    try {
      const data = { history: this.history.slice(-50) };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
      }
    } catch (e) {
      console.warn('StackedSkillEngine: failed to save', e);
    }
  }

  // ============ 事件系统 ============

  on(event: StackedSkillEventType, listener: (e: StackedSkillEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: StackedSkillEventType, listener: (e: StackedSkillEvent) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: StackedSkillEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(event);
        } catch (e) {
          console.warn('StackedSkillEngine: handler error', e);
        }
      }
    }
  }

  // ============ 解析 ============

  /**
   * 解析堆叠技能命令
   */
  parseStackedCommand(input: string): StackedCommand | null {
    const parsed = parseStackedCommandString(input);
    if (!parsed) return null;

    // 限制最大堆叠数量
    if (parsed.skillNames.length > this.config.maxStackSize) {
      return null;
    }

    const command: StackedCommand = {
      skillNames: parsed.skillNames,
      args: parsed.args,
      sharedContext: false,
      parsedAt: Date.now(),
    };

    this.emit({
      type: 'stack-parsed',
      timestamp: Date.now(),
      data: { command },
    });

    return command;
  }

  // ============ 验证 ============

  /**
   * 验证技能组合是否合法
   */
  validateComposition(skillNames: string[]): CompositionCheckResult {
    const conflicts: SkillConflict[] = [];
    const warnings: string[] = [];
    const toolMap = new Map<string, { skills: string[]; modes: string[] }>();

    // 检查技能数量
    if (skillNames.length > this.config.maxStackSize) {
      conflicts.push({
        type: 'context-incompatible',
        skills: skillNames,
        details: `堆叠技能数量 ${skillNames.length} 超过最大限制 ${this.config.maxStackSize}`,
      });
    }

    // 检查每个技能
    for (const name of skillNames) {
      const skill = this.skillEngine.getSkillByName(name);
      if (!skill) {
        conflicts.push({
          type: 'skill-not-found',
          skills: [name],
          details: `技能不存在: ${name}`,
        });
        continue;
      }
      if (!skill.enabled) {
        conflicts.push({
          type: 'skill-disabled',
          skills: [name],
          details: `技能已禁用: ${name}`,
        });
      }
      // 收集 allowedTools
      for (const tool of skill.allowedTools) {
        if (!toolMap.has(tool)) {
          toolMap.set(tool, { skills: [], modes: [] });
        }
        const entry = toolMap.get(tool)!;
        entry.skills.push(name);
        entry.modes.push('allow');
      }
    }

    // 检测工具冲突（多个技能同时声明同一工具）
    for (const [tool, info] of toolMap) {
      if (info.skills.length > 1) {
        // 这只是警告，不是冲突（因为都是 allow 模式）
        warnings.push(
          `工具 ${tool} 被多个技能共享: ${info.skills.join(', ')}`
        );
      }
    }

    // 收集所有工具
    const effectiveTools = Array.from(toolMap.keys());

    const result: CompositionCheckResult = {
      valid: conflicts.length === 0,
      conflicts,
      warnings,
      effectiveTools,
    };

    this.emit({
      type: 'stack-validated',
      timestamp: Date.now(),
      data: { result, skillNames },
    });

    return result;
  }

  // ============ 工具冲突检测 ============

  /**
   * 检测技能间 allowedTools 冲突
   */
  detectToolConflicts(skillNames: string[]): ToolConflict[] {
    const toolMap = new Map<string, { skills: string[]; modes: string[] }>();
    for (const name of skillNames) {
      const skill = this.skillEngine.getSkillByName(name);
      if (!skill) continue;
      for (const tool of skill.allowedTools) {
        if (!toolMap.has(tool)) {
          toolMap.set(tool, { skills: [], modes: [] });
        }
        const entry = toolMap.get(tool)!;
        entry.skills.push(name);
        entry.modes.push('allow');
      }
    }
    const conflicts: ToolConflict[] = [];
    for (const [tool, info] of toolMap) {
      if (info.skills.length > 1) {
        conflicts.push({ tool, skills: info.skills, modes: info.modes });
      }
    }
    return conflicts;
  }

  // ============ 执行 ============

  /**
   * 执行堆叠技能
   */
  async executeStack(
    input: string,
    options?: {
      sharedContext?: boolean;
      parallelExecution?: boolean;
      stopOnFirstFailure?: boolean;
    }
  ): Promise<StackedExecutionResult> {
    const command = this.parseStackedCommand(input);
    if (!command) {
      throw new Error('无法解析堆叠命令');
    }
    if (options?.sharedContext !== undefined) {
      command.sharedContext = options.sharedContext;
    }
    return this.executeParsed(command, {
      parallelExecution: options?.parallelExecution,
      stopOnFirstFailure: options?.stopOnFirstFailure,
    });
  }

  /**
   * 执行已解析的命令
   */
  async executeParsed(
    command: StackedCommand,
    options?: {
      parallelExecution?: boolean;
      stopOnFirstFailure?: boolean;
    }
  ): Promise<StackedExecutionResult> {
    const startTime = Date.now();
    const parallel = options?.parallelExecution ?? this.config.parallelExecution;
    const stopOnFail = options?.stopOnFirstFailure ?? this.config.stopOnFirstFailure;

    // 验证组合
    const composition = this.validateComposition(command.skillNames);

    this.emit({
      type: 'stack-started',
      timestamp: Date.now(),
      data: { command, composition },
    });

    const results: StackedSkillResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    const executeOne = async (name: string, order: number): Promise<StackedSkillResult> => {
      const skillStart = Date.now();
      this.emit({
        type: 'skill-started',
        timestamp: skillStart,
        data: { skillName: name, order },
      });
      try {
        const args = command.args ? { target: command.args } : {};
        const result = await this.skillEngine.invokeSkill(name, args);
        const duration = Date.now() - skillStart;
        if (result.success) {
          this.emit({
            type: 'skill-completed',
            timestamp: Date.now(),
            data: { skillName: name, duration },
          });
        } else {
          this.emit({
            type: 'skill-failed',
            timestamp: Date.now(),
            data: { skillName: name, error: result.error, duration },
          });
        }
        return { skillName: name, result, durationMs: duration, order };
      } catch (error) {
        const duration = Date.now() - skillStart;
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.emit({
          type: 'skill-failed',
          timestamp: Date.now(),
          data: { skillName: name, error: errorMsg, duration },
        });
        // 构造失败结果
        return {
          skillName: name,
          result: {
            success: false,
            output: '',
            error: errorMsg,
            durationMs: duration,
            skillId: name,
          },
          durationMs: duration,
          order,
        };
      }
    };

    if (parallel) {
      const promises = command.skillNames.map((name, i) => executeOne(name, i));
      const parallelResults = await Promise.all(promises);
      for (const r of parallelResults) {
        results.push(r);
        if (r.result.success) successCount++;
        else failureCount++;
      }
    } else {
      // 串行
      for (let i = 0; i < command.skillNames.length; i++) {
        const name = command.skillNames[i];
        const r = await executeOne(name, i);
        results.push(r);
        if (r.result.success) {
          successCount++;
        } else {
          failureCount++;
          if (stopOnFail) break;
        }
      }
    }

    // 按 order 排序
    results.sort((a, b) => a.order - b.order);

    const totalDurationMs = Date.now() - startTime;
    const aggregatedOutput = results
      .map((r) => `[${r.skillName}]\n${r.result.output}`)
      .join('\n\n---\n\n');

    const executionResult: StackedExecutionResult = {
      command,
      results,
      aggregatedOutput,
      totalDurationMs,
      conflicts: composition.conflicts,
      successCount,
      failureCount,
    };

    // 保存到历史
    this.history.push({
      command,
      result: executionResult,
      timestamp: Date.now(),
    });
    this.history = this.history.slice(-50);
    this.save();

    this.emit({
      type: 'stack-completed',
      timestamp: Date.now(),
      data: { executionResult },
    });

    return executionResult;
  }

  // ============ 历史与统计 ============

  /**
   * 获取执行历史
   */
  getHistory(limit: number = 20): Array<{ command: StackedCommand; result: StackedExecutionResult; timestamp: number }> {
    return this.history.slice(-limit);
  }

  /**
   * 清空历史
   */
  clearHistory(): void {
    this.history = [];
    this.save();
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalExecutions: number;
    successRate: number;
    avgDurationMs: number;
    topCombinations: Array<{ names: string; count: number }>;
  } {
    const total = this.history.length;
    if (total === 0) {
      return {
        totalExecutions: 0,
        successRate: 0,
        avgDurationMs: 0,
        topCombinations: [],
      };
    }
    let totalSuccess = 0;
    let totalDuration = 0;
    const comboMap = new Map<string, number>();

    for (const h of this.history) {
      if (h.result.failureCount === 0) totalSuccess++;
      totalDuration += h.result.totalDurationMs;
      const key = h.command.skillNames.slice().sort().join('+');
      comboMap.set(key, (comboMap.get(key) ?? 0) + 1);
    }

    const topCombinations = Array.from(comboMap.entries())
      .map(([names, count]) => ({ names, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalExecutions: total,
      successRate: totalSuccess / total,
      avgDurationMs: totalDuration / total,
      topCombinations,
    };
  }
}

// ============ 默认单例 ============

let defaultEngine: StackedSkillEngine | null = null;

export function getDefaultStackedSkillEngine(): StackedSkillEngine {
  if (!defaultEngine) {
    const skillEngine = getDefaultSkillEngine();
    defaultEngine = new StackedSkillEngine(skillEngine);
  }
  return defaultEngine;
}

export function resetDefaultStackedSkillEngine(): void {
  defaultEngine = null;
}
