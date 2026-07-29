/**
 * # ============================================================
 * Composer Engine 集成层 (v6.38.0 Cycle 18 P0-1)
 * # ============================================================
 * 核心作用：扩展 ComposerEngine 集成 @codebase/@git/@diff 解析 + 项目级 AI 规则
 * 设计要点：
 *   - 引用解析：解析后自动调用对应 resolver
 *   - 规则管理：load/set/get/inject 四种操作
 *   - UI 联动：暴露 state + 订阅接口
 *   - 错误降级：解析失败不阻塞，错误累积
 * 集成：
 *   - ComposerEngine 内部新增 _resolvedReferences / _projectRules
 *   - 新增 resolveAllReferences / loadProjectRules / injectRules / getProjectRules / setProjectRules API
 *   - 订阅机制复用现有 subscribers
 * 修改记录：
 *   - 2026-07-29 | v1.0.0 | Cycle 18 P0-1 初次创建
 * ============================================================
 */

import type { ComposerEngine } from './composerEngine';
import {
  parseGitRef,
  parseDiffRef,
} from './composerEngine';
import type {
  CodebaseContext,
  GitContext,
  DiffContext,
  ResolverError,
} from './referenceResolvers';
import {
  resolveCodebase,
  resolveGit,
  resolveDiff,
} from './referenceResolvers';
import type { HermesRules } from './hermesRules';
import {
  DEFAULT_RULES,
  injectRulesIntoPrompt,
  validateRules,
  parseYaml,
} from './hermesRules';

// ============================================================
// 类型定义
// ============================================================

/** 已解析引用 */
export interface ResolvedReference {
  /** 原始引用 value（如 @codebase:auth handler） */
  raw: string;
  /** 引用 type（codebase / git / diff） */
  type: 'codebase' | 'git' | 'diff';
  /** 解析后的 value（剥离前缀） */
  value: string;
  /** 解析状态 */
  state: 'pending' | 'resolving' | 'resolved' | 'failed';
  /** 解析结果（按 type 不同） */
  context?: CodebaseContext | GitContext | DiffContext;
  /** 错误信息 */
  error?: ResolverError;
  /** 解析时间戳 */
  resolvedAt?: number;
}

/** 解析错误 */
export interface ResolutionError {
  raw: string;
  type: 'codebase' | 'git' | 'diff';
  error: string;
  timestamp: number;
}

/** Composer 集成扩展（类型层） */
export interface ComposerIntegrationState {
  resolvedReferences: ResolvedReference[];
  resolutionErrors: ResolutionError[];
  projectRules: HermesRules;
  rulesLoaded: boolean;
  lastResolvedAt: number;
}

// ============================================================
// 工具函数
// ============================================================

/** 检测 prompt 中是否包含可解析的扩展引用 */
export function hasResolvableReferences(prompt: string): boolean {
  return /@(codebase|Codebase|git|Git|diff|Diff):/.test(prompt);
}

/** 提取 prompt 中的所有 @codebase / @git / @diff 引用 */
export function extractResolvableRefs(prompt: string): Array<{ type: 'codebase' | 'git' | 'diff'; value: string; raw: string }> {
  const refs: Array<{ type: 'codebase' | 'git' | 'diff'; value: string; raw: string }> = [];
  const re = /@(codebase|Codebase|git|Git|diff|Diff):([^\s,;]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) {
    const typeKey = m[1].toLowerCase() as 'codebase' | 'git' | 'diff';
    refs.push({ type: typeKey, value: m[2], raw: m[0] });
  }
  return refs;
}

/** 解析单个引用（用于增量解析） */
export async function resolveOneReference(
  ref: { type: 'codebase' | 'git' | 'diff'; value: string; raw: string },
  options?: { codebaseTopK?: number; gitLimit?: number; apiBase?: string }
): Promise<ResolvedReference> {
  const start = Date.now();
  try {
    if (ref.type === 'codebase') {
      const ctx = await resolveCodebase(ref.value, {
        topK: options?.codebaseTopK,
        apiBase: options?.apiBase,
      });
      return {
        raw: ref.raw,
        type: 'codebase',
        value: ref.value,
        state: 'resolved',
        context: ctx,
        resolvedAt: Date.now(),
      };
    } else if (ref.type === 'git') {
      const parsed = parseGitRef(ref.value);
      const ctx = await resolveGit(parsed.ref, {
        filePath: parsed.file,
        line: parsed.line,
        limit: options?.gitLimit,
        apiBase: options?.apiBase,
      });
      return {
        raw: ref.raw,
        type: 'git',
        value: ref.value,
        state: 'resolved',
        context: ctx,
        resolvedAt: Date.now(),
      };
    } else if (ref.type === 'diff') {
      const diffRef = parseDiffRef(ref.value);
      const ctx = await resolveDiff(diffRef, { apiBase: options?.apiBase });
      return {
        raw: ref.raw,
        type: 'diff',
        value: ref.value,
        state: 'resolved',
        context: ctx,
        resolvedAt: Date.now(),
      };
    }
    return {
      raw: ref.raw,
      type: ref.type,
      value: ref.value,
      state: 'failed',
      error: { type: 'unknown', message: `Unknown ref type: ${ref.type}` },
      resolvedAt: Date.now(),
    };
  } catch (err) {
    return {
      raw: ref.raw,
      type: ref.type,
      value: ref.value,
      state: 'failed',
      error: {
        type: 'unknown',
        message: err instanceof Error ? err.message : String(err),
      },
      resolvedAt: Date.now(),
    };
  }
  // 用于类型收窄
  void start;
}

/** 解析所有引用（并发） */
export async function resolveAllReferencesCore(
  prompt: string,
  options?: { codebaseTopK?: number; gitLimit?: number; apiBase?: string }
): Promise<{
  references: ResolvedReference[];
  errors: ResolutionError[];
}> {
  const refs = extractResolvableRefs(prompt);
  const resolved = await Promise.all(refs.map((r) => resolveOneReference(r, options)));
  const errors: ResolutionError[] = resolved
    .filter((r) => r.state === 'failed' && r.error)
    .map((r) => ({
      raw: r.raw,
      type: r.type,
      error: r.error!.message,
      timestamp: Date.now(),
    }));
  return { references: resolved, errors };
}

// ============================================================
// 规则管理
// ============================================================

/** 加载项目级规则（模拟从 .hermesrules.yaml 读取） */
export async function loadProjectRulesCore(
  rulesYaml?: string
): Promise<{ rules: HermesRules; loaded: boolean; error: string | null }> {
  if (!rulesYaml) {
    return { rules: DEFAULT_RULES, loaded: true, error: null };
  }
  try {
    const parsed = parseYaml(rulesYaml);
    const validation = validateRules(parsed);
    if (!validation.valid) {
      return {
        rules: DEFAULT_RULES,
        loaded: false,
        error: validation.errors.join('; '),
      };
    }
    return { rules: validation.rules!, loaded: true, error: null };
  } catch (err) {
    return {
      rules: DEFAULT_RULES,
      loaded: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 注入规则到 prompt（包装 hermesRules.injectRulesIntoPrompt） */
export function injectRulesCore(rules: HermesRules, prompt: string): string {
  // hermesRules.injectRulesIntoPrompt 签名是 (prompt, rules, options)
  return injectRulesIntoPrompt(prompt, rules);
}

/** 统计规则数量 */
export function countRules(rules: HermesRules): {
  total: number;
  categories: Record<string, number>;
} {
  const categories: Record<string, number> = {};
  let total = 0;
  for (const [k, v] of Object.entries(rules.rules)) {
    if (typeof v === 'object' && v !== null) {
      const sub = Object.keys(v as object).length;
      categories[k] = sub;
      total += sub;
    } else {
      categories[k] = 1;
      total += 1;
    }
  }
  categories['custom'] = rules.custom_rules.length;
  total += rules.custom_rules.length;
  return { total, categories };
}

// ============================================================
// Composer 引擎扩展（通过 WeakMap 注入，不修改原类）
// ============================================================

const _integrationState = new WeakMap<ComposerEngine, ComposerIntegrationState>();
const _integrationSubscribers = new WeakMap<ComposerEngine, Set<(state: ComposerIntegrationState) => void>>();

/** 获取集成的内部状态 */
export function getIntegrationState(engine: ComposerEngine): ComposerIntegrationState {
  let state = _integrationState.get(engine);
  if (!state) {
    state = {
      resolvedReferences: [],
      resolutionErrors: [],
      projectRules: DEFAULT_RULES,
      rulesLoaded: false,
      lastResolvedAt: 0,
    };
    _integrationState.set(engine, state);
  }
  return state;
}

/** 订阅集成状态变化 */
export function subscribeIntegration(
  engine: ComposerEngine,
  callback: (state: ComposerIntegrationState) => void
): () => void {
  let subs = _integrationSubscribers.get(engine);
  if (!subs) {
    subs = new Set();
    _integrationSubscribers.set(engine, subs);
  }
  subs.add(callback);
  return () => {
    subs!.delete(callback);
  };
}

function _notifyIntegration(engine: ComposerEngine, state: ComposerIntegrationState): void {
  const subs = _integrationSubscribers.get(engine);
  if (subs) {
    for (const cb of subs) {
      try {
        cb(state);
      } catch (err) {
        console.error('Integration subscriber error:', err);
      }
    }
  }
}

// ============================================================
// 公开 API（高阶函数，避免修改 ComposerEngine 类）
// ============================================================

/** 解析所有引用（核心 API） */
export async function resolveAllReferences(
  engine: ComposerEngine,
  prompt: string,
  options?: { codebaseTopK?: number; gitLimit?: number; apiBase?: string }
): Promise<ResolvedReference[]> {
  const state = getIntegrationState(engine);

  // 标记所有解析中
  const refs = extractResolvableRefs(prompt);
  state.resolvedReferences = refs.map((r) => ({
    raw: r.raw,
    type: r.type,
    value: r.value,
    state: 'resolving',
  }));
  state.resolutionErrors = [];
  _notifyIntegration(engine, state);

  const { references, errors } = await resolveAllReferencesCore(prompt, options);
  state.resolvedReferences = references;
  state.resolutionErrors = errors;
  state.lastResolvedAt = Date.now();
  _notifyIntegration(engine, state);
  return references;
}

/** 加载项目规则 */
export async function loadProjectRules(
  engine: ComposerEngine,
  rulesYaml?: string
): Promise<{ success: boolean; error: string | null }> {
  const state = getIntegrationState(engine);
  const result = await loadProjectRulesCore(rulesYaml);
  state.projectRules = result.rules;
  state.rulesLoaded = result.loaded;
  _notifyIntegration(engine, state);
  return { success: result.loaded, error: result.error };
}

/** 设置项目规则（直接覆盖） */
export function setProjectRules(engine: ComposerEngine, rules: HermesRules): void {
  const state = getIntegrationState(engine);
  state.projectRules = rules;
  state.rulesLoaded = true;
  _notifyIntegration(engine, state);
}

/** 获取项目规则 */
export function getProjectRules(engine: ComposerEngine): HermesRules {
  return getIntegrationState(engine).projectRules;
}

/** 获取已解析引用 */
export function getResolvedReferences(engine: ComposerEngine): ResolvedReference[] {
  return [...getIntegrationState(engine).resolvedReferences];
}

/** 获取解析错误 */
export function getResolutionErrors(engine: ComposerEngine): ResolutionError[] {
  return [...getIntegrationState(engine).resolutionErrors];
}

/** 注入规则到 prompt（基于当前引擎状态） */
export function injectRules(engine: ComposerEngine, prompt: string): string {
  return injectRulesCore(getIntegrationState(engine).projectRules, prompt);
}

/** 重置集成状态（用于测试或 reset） */
export function resetIntegration(engine: ComposerEngine): void {
  _integrationState.delete(engine);
  const subs = _integrationSubscribers.get(engine);
  if (subs) subs.clear();
}

// ============================================================
// 工厂函数 + 辅助
// ============================================================

/** 创建集成状态快照（用于调试 / 序列化） */
export function snapshotIntegration(engine: ComposerEngine): ComposerIntegrationState {
  return { ...getIntegrationState(engine) };
}

/** 计算当前规则的元数据（用于 UI 展示） */
export interface RulesMetadata {
  total: number;
  categories: Record<string, number>;
  isDefault: boolean;
}

export function getRulesMetadata(engine: ComposerEngine): RulesMetadata {
  const state = getIntegrationState(engine);
  const { total, categories } = countRules(state.projectRules);
  return {
    total,
    categories,
    isDefault: !state.rulesLoaded,
  };
}
