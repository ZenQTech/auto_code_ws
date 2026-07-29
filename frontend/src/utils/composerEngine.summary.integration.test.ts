/**
 * # ============================================================
 * # Composer Summary 集成层单元测试 (v1.0.0 Cycle 18 P0-2)
 * # ============================================================
 * # 覆盖：
 * #   1. 状态初始化
 * #   2. 摘要历史管理
 * #   3. 摘要生成 / 应用 / 删除
 * #   4. 配置更新
 * #   5. 订阅机制
 * #   6. 多 engine 隔离
 * #   7. 边缘情况（空 / 重复 / 撤销）
 * # ============================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createComposerEngine } from './composerEngine';
import {
  getSummaryHistory,
  getSummaryConfig,
  getSummaryState,
  getSummarizer,
  buildConversationItems,
  getCurrentTokens,
  shouldSummarize,
  generateSummary,
  applySummary,
  unapplySummary,
  deleteSummary,
  clearSummaryHistory,
  updateSummaryConfig,
  subscribeSummary,
  resetSummaryIntegration,
} from './composerEngine.summary.integration';
import { DEFAULT_SUMMARY_CONFIG } from './composerEngine.summary';

describe('composerEngine.summary.integration - 基础 API', () => {
  let engine: ReturnType<typeof createComposerEngine>;

  beforeEach(() => {
    engine = createComposerEngine();
    resetSummaryIntegration(engine);
  });

  it('getSummaryHistory 初始为空数组', () => {
    expect(getSummaryHistory(engine)).toEqual([]);
  });

  it('getSummaryConfig 初始为 DEFAULT_SUMMARY_CONFIG', () => {
    const config = getSummaryConfig(engine);
    expect(config).toEqual(DEFAULT_SUMMARY_CONFIG);
    expect(config.triggerThreshold).toBe(8000);
  });

  it('getSummaryState 初始状态', () => {
    const state = getSummaryState(engine);
    expect(state.history).toEqual([]);
    expect(state.appliedSummaryId).toBe(null);
    expect(state.originalPrompt).toBe(null);
    expect(state.applyCount).toBe(0);
    expect(state.lastSummarizedAt).toBe(0);
  });

  it('getSummarizer 返回非空实例', () => {
    const summarizer = getSummarizer(engine);
    expect(summarizer).toBeDefined();
    expect(typeof summarizer.summarize).toBe('function');
  });

  it('resetSummaryIntegration 重置所有状态', () => {
    engine.setPrompt('Test prompt');
    const summary = generateSummary(engine, { force: true });
    expect(summary).not.toBeNull();
    expect(getSummaryHistory(engine).length).toBe(1);

    resetSummaryIntegration(engine);
    expect(getSummaryHistory(engine).length).toBe(0);
    expect(getSummaryState(engine).appliedSummaryId).toBe(null);
  });
});

describe('composerEngine.summary.integration - buildConversationItems', () => {
  let engine: ReturnType<typeof createComposerEngine>;

  beforeEach(() => {
    engine = createComposerEngine();
    resetSummaryIntegration(engine);
  });

  it('空 session 返回空数组', () => {
    const items = buildConversationItems(engine);
    expect(items).toEqual([]);
  });

  it('包含 user prompt', () => {
    engine.setPrompt('Test user prompt');
    const items = buildConversationItems(engine);
    const userItems = items.filter((i) => i.role === 'user');
    expect(userItems.length).toBeGreaterThanOrEqual(1);
    expect(userItems[0].content).toBe('Test user prompt');
  });

  it('包含 accepted edits as assistant', () => {
    const edit = engine.addEdit({
      filePath: 'src/test.ts',
      beforeContent: 'old',
      afterContent: 'new',
      description: 'Test edit',
    });
    engine.acceptEdit(edit.id);
    const items = buildConversationItems(engine);
    const assistantItems = items.filter((i) => i.role === 'assistant');
    expect(assistantItems.length).toBe(1);
    expect(assistantItems[0].acceptedEdits).toBe(1);
    expect(assistantItems[0].relatedFiles).toContain('src/test.ts');
  });

  it('包含 file context as system', () => {
    engine.addContext({
      type: 'file',
      path: 'src/foo.ts',
      content: 'foo content',
      language: 'typescript',
    });
    const items = buildConversationItems(engine);
    const systemItems = items.filter((i) => i.role === 'system');
    expect(systemItems.length).toBe(1);
    expect(systemItems[0].relatedFiles).toContain('src/foo.ts');
  });
});

describe('composerEngine.summary.integration - generateSummary', () => {
  let engine: ReturnType<typeof createComposerEngine>;

  beforeEach(() => {
    engine = createComposerEngine();
    resetSummaryIntegration(engine);
  });

  it('force=true 时即使 token 不足也生成', () => {
    engine.setPrompt('Short');
    const summary = generateSummary(engine, { force: true });
    expect(summary).not.toBeNull();
    expect(summary!.id).toBeDefined();
    expect(summary!.text).toBeDefined();
  });

  it('未 force 且 token < threshold 时返回 null', () => {
    engine.setPrompt('Short prompt');
    const summary = generateSummary(engine);
    expect(summary).toBeNull();
  });

  it('force=true 时生成后加入 history', () => {
    generateSummary(engine, { force: true });
    expect(getSummaryHistory(engine).length).toBe(1);
  });

  it('连续生成多个 summary 累积到 history', () => {
    generateSummary(engine, { force: true });
    generateSummary(engine, { force: true });
    generateSummary(engine, { force: true });
    expect(getSummaryHistory(engine).length).toBe(3);
  });

  it('summary stats 包含 originalTokens 和 summaryTokens', () => {
    engine.setPrompt('Test prompt with some content');
    const summary = generateSummary(engine, { force: true });
    expect(summary!.stats.originalTokens).toBeGreaterThan(0);
    expect(summary!.stats.summaryTokens).toBeGreaterThan(0);
  });
});

describe('composerEngine.summary.integration - applySummary / unapplySummary', () => {
  let engine: ReturnType<typeof createComposerEngine>;

  beforeEach(() => {
    engine = createComposerEngine();
    resetSummaryIntegration(engine);
  });

  it('applySummary 修改 prompt 包含 summary', () => {
    engine.setPrompt('Original prompt');
    const summary = generateSummary(engine, { force: true })!;
    const result = applySummary(engine, summary.id);
    expect(result).toBe(true);
    const newPrompt = engine.getSession().prompt;
    expect(newPrompt).toContain('Original prompt');
    expect(newPrompt).toContain('Conversation Context Summary');
  });

  it('applySummary 更新状态', () => {
    engine.setPrompt('Original');
    const summary = generateSummary(engine, { force: true })!;
    applySummary(engine, summary.id);
    const state = getSummaryState(engine);
    expect(state.appliedSummaryId).toBe(summary.id);
    expect(state.originalPrompt).toBe('Original');
    expect(state.applyCount).toBe(1);
  });

  it('applySummary 失败的 ID 返回 false', () => {
    const result = applySummary(engine, 'invalid_id');
    expect(result).toBe(false);
  });

  it('unapplySummary 恢复原始 prompt', () => {
    engine.setPrompt('Original');
    const summary = generateSummary(engine, { force: true })!;
    applySummary(engine, summary.id);
    const result = unapplySummary(engine);
    expect(result).toBe(true);
    expect(engine.getSession().prompt).toBe('Original');
    expect(getSummaryState(engine).appliedSummaryId).toBe(null);
  });

  it('unapplySummary 无应用时返回 false', () => {
    expect(unapplySummary(engine)).toBe(false);
  });
});

describe('composerEngine.summary.integration - deleteSummary', () => {
  let engine: ReturnType<typeof createComposerEngine>;

  beforeEach(() => {
    engine = createComposerEngine();
    resetSummaryIntegration(engine);
  });

  it('删除指定 summary', () => {
    const s1 = generateSummary(engine, { force: true })!;
    const s2 = generateSummary(engine, { force: true })!;
    expect(getSummaryHistory(engine).length).toBe(2);
    deleteSummary(engine, s1.id);
    const remaining = getSummaryHistory(engine);
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe(s2.id);
  });

  it('删除不存在的 ID 返回 false', () => {
    expect(deleteSummary(engine, 'invalid')).toBe(false);
  });

  it('删除当前应用的 summary 自动撤销应用', () => {
    engine.setPrompt('Original');
    const summary = generateSummary(engine, { force: true })!;
    applySummary(engine, summary.id);
    expect(getSummaryState(engine).appliedSummaryId).toBe(summary.id);
    deleteSummary(engine, summary.id);
    expect(getSummaryState(engine).appliedSummaryId).toBe(null);
    expect(engine.getSession().prompt).toBe('Original');
  });
});

describe('composerEngine.summary.integration - clearSummaryHistory', () => {
  let engine: ReturnType<typeof createComposerEngine>;

  beforeEach(() => {
    engine = createComposerEngine();
    resetSummaryIntegration(engine);
  });

  it('清空所有 history', () => {
    generateSummary(engine, { force: true });
    generateSummary(engine, { force: true });
    clearSummaryHistory(engine);
    expect(getSummaryHistory(engine)).toEqual([]);
  });

  it('清空时撤销应用', () => {
    engine.setPrompt('Original');
    const summary = generateSummary(engine, { force: true })!;
    applySummary(engine, summary.id);
    clearSummaryHistory(engine);
    expect(getSummaryState(engine).appliedSummaryId).toBe(null);
    expect(engine.getSession().prompt).toBe('Original');
  });
});

describe('composerEngine.summary.integration - updateSummaryConfig', () => {
  let engine: ReturnType<typeof createComposerEngine>;

  beforeEach(() => {
    engine = createComposerEngine();
    resetSummaryIntegration(engine);
  });

  it('更新 triggerThreshold', () => {
    updateSummaryConfig(engine, { triggerThreshold: 5000 });
    expect(getSummaryConfig(engine).triggerThreshold).toBe(5000);
  });

  it('更新 strategy', () => {
    updateSummaryConfig(engine, { strategy: 'aggressive' });
    expect(getSummaryConfig(engine).strategy).toBe('aggressive');
  });

  it('部分更新不影响其他字段', () => {
    updateSummaryConfig(engine, { triggerThreshold: 1000 });
    const config = getSummaryConfig(engine);
    expect(config.triggerThreshold).toBe(1000);
    expect(config.targetThreshold).toBe(DEFAULT_SUMMARY_CONFIG.targetThreshold);
  });
});

describe('composerEngine.summary.integration - shouldSummarize / getCurrentTokens', () => {
  let engine: ReturnType<typeof createComposerEngine>;

  beforeEach(() => {
    engine = createComposerEngine();
    resetSummaryIntegration(engine);
  });

  it('空 session tokens 为 0', () => {
    expect(getCurrentTokens(engine)).toBe(0);
  });

  it('短 prompt 不触发 shouldSummarize', () => {
    engine.setPrompt('short');
    expect(shouldSummarize(engine)).toBe(false);
  });

  it('长 prompt 触发 shouldSummarize', () => {
    // 设置超长 prompt
    const longContent = '测试'.repeat(5000);
    engine.setPrompt(longContent);
    expect(shouldSummarize(engine)).toBe(true);
  });

  it('降低 threshold 后短 prompt 也触发', () => {
    updateSummaryConfig(engine, { triggerThreshold: 5 });
    engine.setPrompt('稍微长一点的 prompt 内容足够长');
    expect(shouldSummarize(engine)).toBe(true);
  });
});

describe('composerEngine.summary.integration - subscribeSummary', () => {
  let engine: ReturnType<typeof createComposerEngine>;

  beforeEach(() => {
    engine = createComposerEngine();
    resetSummaryIntegration(engine);
  });

  it('订阅立即触发一次', () => {
    const states: any[] = [];
    const unsub = subscribeSummary(engine, (s) => states.push({ ...s, history: [...s.history] }));
    expect(states.length).toBe(1);
    expect(states[0].appliedSummaryId).toBe(null);
    unsub();
  });

  it('generateSummary 触发订阅', () => {
    const states: any[] = [];
    subscribeSummary(engine, (s) => states.push(s.history.length));
    generateSummary(engine, { force: true });
    expect(states.length).toBeGreaterThan(1);
    expect(states[states.length - 1]).toBe(1);
  });

  it('applySummary 触发订阅', () => {
    const states: any[] = [];
    engine.setPrompt('test');
    const summary = generateSummary(engine, { force: true })!;
    subscribeSummary(engine, (s) => states.push(s.appliedSummaryId));
    applySummary(engine, summary.id);
    expect(states[states.length - 1]).toBe(summary.id);
  });

  it('unsubscribe 取消订阅', () => {
    const states: any[] = [];
    const unsub = subscribeSummary(engine, (s) => states.push(s.history.length));
    unsub();
    generateSummary(engine, { force: true });
    // 不会收到新通知
    expect(states.length).toBe(1);
  });
});

describe('composerEngine.summary.integration - 多 engine 隔离', () => {
  it('两个 engine 状态独立', () => {
    const e1 = createComposerEngine();
    const e2 = createComposerEngine();
    resetSummaryIntegration(e1);
    resetSummaryIntegration(e2);

    e1.setPrompt('Test 1');
    generateSummary(e1, { force: true });

    expect(getSummaryHistory(e1).length).toBe(1);
    expect(getSummaryHistory(e2).length).toBe(0);
  });

  it('更新一个 engine 的配置不影响另一个', () => {
    const e1 = createComposerEngine();
    const e2 = createComposerEngine();
    resetSummaryIntegration(e1);
    resetSummaryIntegration(e2);

    updateSummaryConfig(e1, { triggerThreshold: 100 });
    expect(getSummaryConfig(e1).triggerThreshold).toBe(100);
    expect(getSummaryConfig(e2).triggerThreshold).toBe(8000);
  });
});

describe('composerEngine.summary.integration - 边缘情况', () => {
  let engine: ReturnType<typeof createComposerEngine>;

  beforeEach(() => {
    engine = createComposerEngine();
    resetSummaryIntegration(engine);
  });

  it('未应用 summary 时 unapply 不影响 prompt', () => {
    engine.setPrompt('Test');
    unapplySummary(engine);
    expect(engine.getSession().prompt).toBe('Test');
  });

  it('连续 apply/unapply 状态正确', () => {
    engine.setPrompt('Original');
    const s1 = generateSummary(engine, { force: true })!;
    const s2 = generateSummary(engine, { force: true })!;
    applySummary(engine, s1.id);
    expect(getSummaryState(engine).appliedSummaryId).toBe(s1.id);
    applySummary(engine, s2.id);
    expect(getSummaryState(engine).appliedSummaryId).toBe(s2.id);
    expect(getSummaryState(engine).originalPrompt).toBe('Original');
    unapplySummary(engine);
    expect(getSummaryState(engine).appliedSummaryId).toBe(null);
    expect(engine.getSession().prompt).toBe('Original');
  });

  it('subscribe 异常不会影响其他订阅者', () => {
    const states1: any[] = [];
    subscribeSummary(engine, () => {
      throw new Error('test error');
    });
    subscribeSummary(engine, (s) => states1.push(s.history.length));
    // 不会因为第一个订阅者抛错而中断
    generateSummary(engine, { force: true });
    expect(states1.length).toBeGreaterThan(0);
  });

  it('history 最大容量限制', () => {
    // 设置最大容量为 3
    updateSummaryConfig(engine, {}); // 确保初始化
    // 直接添加 60 个 summary 测试上限（默认 50）
    for (let i = 0; i < 60; i++) {
      generateSummary(engine, { force: true });
    }
    const history = getSummaryHistory(engine);
    expect(history.length).toBeLessThanOrEqual(50);
  });
});
