/**
 * # ============================================================
 * # Composer Summary 集成层 (v1.0.0 Cycle 18 P0-2)
 * # ============================================================
 * # 核心作用：通过 WeakMap 扩展 ComposerEngine，桥接 summary 引擎
 * # 解决的问题：
 * #   1. 避免直接修改 composerEngine.ts 的复杂状态
 * #   2. 为 useComposer Hook 提供 Summary 相关状态和 API
 * #   3. 支持跨组件共享 Summary 状态
 * # 设计要点：
 * #   - WeakMap 存储（避免内存泄漏）
 * #   - 订阅机制（实时同步）
 * #   - resetIntegration 函数（测试隔离）
 * #   - 与 v1.0.0 composerEngine.integration 保持一致风格
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 18 P0-2 初次创建
 * #     - WeakMap 扩展 ComposerEngine
 * #     - SummaryHistory + Summarizer 实例
 * #     - subscribe 机制
 * #     - 8 个核心 API: getSummaryHistory / addSummary / applySummary / deleteSummary / clearSummaryHistory / updateSummaryConfig / getSummaryConfig / getSummarizer / getSummaryState / subscribeSummary / resetSummaryIntegration
 * # ============================================================
 */

// ============================================================
// 类型定义
// ============================================================

import {
  type ConversationItem,
  type Summary,
  type SummaryConfig,
  type SummaryStrategy,
  DEFAULT_SUMMARY_CONFIG,
  Summarizer,
  SummaryHistory,
  injectSummaryIntoPrompt,
  estimateConversationTokens,
} from './composerEngine.summary';
import type { ComposerEngine } from './composerEngine';

export type { ConversationItem, Summary, SummaryConfig, SummaryStrategy };

/** Summary 扩展状态 */
export interface ComposerSummaryState {
  /** 摘要历史（按时间正序） */
  history: Summary[];
  /** 配置 */
  config: SummaryConfig;
  /** 当前应用的摘要 ID（null = 未应用） */
  appliedSummaryId: string | null;
  /** 已应用摘要的 prompt 原文（用于撤销） */
  originalPrompt: string | null;
  /** 最近一次摘要时间 */
  lastSummarizedAt: number;
  /** 已应用次数 */
  applyCount: number;
}

// ============================================================
// WeakMap 存储
// ============================================================

const SUMMARY_WEAK_MAP = new WeakMap<ComposerEngine, ComposerEngineSummaryExt>();

interface ComposerEngineSummaryExt {
  state: ComposerSummaryState;
  summarizer: Summarizer;
  history: SummaryHistory;
  listeners: Set<(state: ComposerSummaryState) => void>;
}

// ============================================================
// 内部辅助函数
// ====================================

function getOrCreateExt(engine: ComposerEngine): ComposerEngineSummaryExt {
  let ext = SUMMARY_WEAK_MAP.get(engine);
  if (!ext) {
    const summarizer = new Summarizer();
    const history = new SummaryHistory(50);
    ext = {
      state: {
        history: [],
        config: { ...DEFAULT_SUMMARY_CONFIG },
        appliedSummaryId: null,
        originalPrompt: null,
        lastSummarizedAt: 0,
        applyCount: 0,
      },
      summarizer,
      history,
      listeners: new Set(),
    };
    SUMMARY_WEAK_MAP.set(engine, ext);

    // 订阅 history 变化
    history.subscribe((summaries) => {
      ext!.state.history = [...summaries];
      notifyListeners(ext!);
    });
  }
  return ext;
}

function notifyListeners(ext: ComposerEngineSummaryExt): void {
  for (const listener of ext.listeners) {
    try {
      listener({ ...ext.state, history: [...ext.state.history] });
    } catch (err) {
      console.error('Summary listener error:', err);
    }
  }
}

// ============================================================
// 核心 API
// ============================================================

/** 获取摘要历史 */
export function getSummaryHistory(engine: ComposerEngine): Summary[] {
  const ext = getOrCreateExt(engine);
  return ext.history.getAll();
}

/** 获取当前配置 */
export function getSummaryConfig(engine: ComposerEngine): SummaryConfig {
  const ext = getOrCreateExt(engine);
  return ext.summarizer.getConfig();
}

/** 获取完整状态 */
export function getSummaryState(engine: ComposerEngine): ComposerSummaryState {
  const ext = getOrCreateExt(engine);
  return { ...ext.state, history: [...ext.state.history] };
}

/** 获取 Summarizer 实例（高级用法） */
export function getSummarizer(engine: ComposerEngine): Summarizer {
  return getOrCreateExt(engine).summarizer;
}

/**
 * 将 Composer session 转换为 ConversationItem 列表
 * 用于 token 估算和摘要生成
 */
export function buildConversationItems(engine: ComposerEngine): ConversationItem[] {
  const session = engine.getSession();
  const items: ConversationItem[] = [];

  // 1. User prompt
  if (session.prompt) {
    items.push({
      id: 'prompt',
      role: 'user',
      content: session.prompt,
      timestamp: session.createdAt,
    });
  }

  // 2. Accepted edits as assistant messages
  for (const edit of session.edits) {
    items.push({
      id: edit.id,
      role: 'assistant',
      content: `${edit.filePath}\n${edit.description}\n\n${edit.afterContent}`,
      timestamp: edit.createdAt,
      acceptedEdits: edit.status === 'accepted' ? 1 : 0,
      relatedFiles: [edit.filePath],
    });
  }

  // 3. Context entries as system messages
  for (const file of session.context.files) {
    items.push({
      id: `file-${file.path}`,
      role: 'system',
      content: `[File: ${file.path}]\n${file.content}`,
      timestamp: session.createdAt,
      relatedFiles: [file.path],
    });
  }

  return items;
}

/** 获取当前 token 使用量 */
export function getCurrentTokens(engine: ComposerEngine): number {
  const items = buildConversationItems(engine);
  return estimateConversationTokens(items);
}

/** 检查是否需要摘要 */
export function shouldSummarize(engine: ComposerEngine): boolean {
  const ext = getOrCreateExt(engine);
  const items = buildConversationItems(engine);
  return ext.summarizer.shouldSummarize(items);
}

/**
 * 生成摘要
 * @returns 生成的 Summary，如果不需要摘要且未强制则返回 null
 */
export function generateSummary(
  engine: ComposerEngine,
  options?: { force?: boolean }
): Summary | null {
  const ext = getOrCreateExt(engine);
  const items = buildConversationItems(engine);
  const summary = ext.summarizer.summarize(items, { force: options?.force });
  if (summary) {
    ext.history.add(summary);
    ext.state.lastSummarizedAt = summary.createdAt;
    notifyListeners(ext);
  }
  return summary;
}

/**
 * 应用摘要到 prompt
 * @param summaryId 摘要 ID
 * @returns true 表示成功应用
 */
export function applySummary(engine: ComposerEngine, summaryId: string): boolean {
  const ext = getOrCreateExt(engine);
  const summary = ext.history.getAll().find((s) => s.id === summaryId);
  if (!summary) return false;

  const session = engine.getSession();
  // 保存原始 prompt（首次应用时）
  if (ext.state.appliedSummaryId === null) {
    ext.state.originalPrompt = session.prompt;
  }

  const newPrompt = injectSummaryIntoPrompt(session.prompt, summary);
  engine.setPrompt(newPrompt);

  ext.state.appliedSummaryId = summaryId;
  ext.state.applyCount += 1;
  notifyListeners(ext);
  return true;
}

/**
 * 撤销摘要应用
 * @returns true 表示成功撤销
 */
export function unapplySummary(engine: ComposerEngine): boolean {
  const ext = getOrCreateExt(engine);
  if (ext.state.appliedSummaryId === null) return false;

  if (ext.state.originalPrompt !== null) {
    engine.setPrompt(ext.state.originalPrompt);
  }
  ext.state.appliedSummaryId = null;
  ext.state.originalPrompt = null;
  notifyListeners(ext);
  return true;
}

/** 删除摘要 */
export function deleteSummary(engine: ComposerEngine, summaryId: string): boolean {
  const ext = getOrCreateExt(engine);
  const summaries = ext.history.getAll();
  const idx = summaries.findIndex((s) => s.id === summaryId);
  if (idx === -1) return false;

  // 从 history 中删除（SummaryHistory 没有按 ID 删除，重建一个）
  const remaining = summaries.filter((s) => s.id !== summaryId);
  ext.history.clear();
  remaining.forEach((s) => ext.history.add(s));

  // 如果删除的是当前应用的摘要，撤销应用
  if (ext.state.appliedSummaryId === summaryId) {
    unapplySummary(engine);
  }

  notifyListeners(ext);
  return true;
}

/** 清空摘要历史 */
export function clearSummaryHistory(engine: ComposerEngine): void {
  const ext = getOrCreateExt(engine);
  // 如果有应用的摘要，先撤销
  if (ext.state.appliedSummaryId !== null) {
    unapplySummary(engine);
  }
  ext.history.clear();
  notifyListeners(ext);
}

/** 更新配置 */
export function updateSummaryConfig(
  engine: ComposerEngine,
  config: Partial<SummaryConfig>
): void {
  const ext = getOrCreateExt(engine);
  ext.summarizer.setConfig(config);
  ext.state.config = ext.summarizer.getConfig();
  notifyListeners(ext);
}

/** 订阅状态变化 */
export function subscribeSummary(
  engine: ComposerEngine,
  listener: (state: ComposerSummaryState) => void
): () => void {
  const ext = getOrCreateExt(engine);
  ext.listeners.add(listener);
  // 立即触发一次，传递当前状态
  try {
    listener({ ...ext.state, history: [...ext.state.history] });
  } catch (err) {
    console.error('Summary listener initial call error:', err);
  }
  return () => {
    ext.listeners.delete(listener);
  };
}

/** 重置集成状态（用于测试） */
export function resetSummaryIntegration(engine: ComposerEngine): void {
  const ext = getOrCreateExt(engine);
  // 撤销应用
  if (ext.state.appliedSummaryId !== null && ext.state.originalPrompt !== null) {
    engine.setPrompt(ext.state.originalPrompt);
  }
  ext.history.clear();
  ext.summarizer.setConfig({});
  ext.state = {
    history: [],
    config: { ...DEFAULT_SUMMARY_CONFIG },
    appliedSummaryId: null,
    originalPrompt: null,
    lastSummarizedAt: 0,
    applyCount: 0,
  };
  notifyListeners(ext);
}
