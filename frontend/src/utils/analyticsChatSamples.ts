/**
 * # ============================================================
 * # Analytics Chat Samples - 示例数据 (v1.0.0 Cycle 29 G29-03)
 * # ============================================================
 * # 核心作用：提供 AnalyticsChat 使用的示例用量数据
 * # 包含 30 天跨 4 团队 / 6 模型 / 8 技能 / 50 项目的 1000+ 记录
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 29 G29-03 初次创建
 * # ============================================================
 */

import type { UsageRecord, BudgetStatus } from './analyticsChatTypes';

const teams = ['frontend-team', 'backend-team', 'devops-team', 'data-team'];
const models = [
  'claude-opus-4.5',
  'claude-sonnet-4',
  'gpt-4o',
  'gpt-4o-mini',
  'gemini-2.0-pro',
  'qwen2.5-coder-32b',
];
const skills = [
  'chat',
  'code-review',
  'refactor-assistant',
  'test-generator',
  'doc-generator',
  'security-scanner',
  'ci-cd-pipeline',
  'api-design',
];
const projects = [
  'frontend-app',
  'backend-api',
  'mobile-app',
  'data-pipeline',
  'ml-platform',
  'infra-terraform',
];
const statuses: Array<'success' | 'error' | 'timeout'> = [
  'success',
  'success',
  'success',
  'success',
  'success',
  'success',
  'success',
  'success',
  'success',
  'error',
  'timeout',
];

function pseudoRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/**
 * 生成示例用量数据
 */
export function generateSampleUsageData(count: number = 1200): UsageRecord[] {
  const rand = pseudoRandom(42);
  const now = Date.now();
  const records: UsageRecord[] = [];

  for (let i = 0; i < count; i++) {
    const dayOffset = Math.floor(rand() * 30);
    const timestamp = now - dayOffset * 24 * 60 * 60 * 1000 - Math.floor(rand() * 86400000);
    const model = models[Math.floor(rand() * models.length)];
    const skill = skills[Math.floor(rand() * skills.length)];
    const team = teams[Math.floor(rand() * teams.length)];
    const project = projects[Math.floor(rand() * projects.length)];
    const status = statuses[Math.floor(rand() * statuses.length)];

    // 模型 token 单价（每 1K tokens）
    const pricing: Record<string, { prompt: number; completion: number }> = {
      'claude-opus-4.5': { prompt: 0.015, completion: 0.075 },
      'claude-sonnet-4': { prompt: 0.003, completion: 0.015 },
      'gpt-4o': { prompt: 0.0025, completion: 0.01 },
      'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
      'gemini-2.0-pro': { prompt: 0.00125, completion: 0.005 },
      'qwen2.5-coder-32b': { prompt: 0.0007, completion: 0.0007 },
    };
    const p = pricing[model];

    const promptTokens = Math.floor(500 + rand() * 8000);
    const completionTokens = Math.floor(200 + rand() * 4000);
    const cost = (promptTokens / 1000) * p.prompt + (completionTokens / 1000) * p.completion;

    records.push({
      id: 'rec-' + (10000 + i),
      timestamp,
      model,
      agentPath: '/' + team + '/' + skill,
      team,
      project,
      skill,
      sessionId: 'sess-' + Math.floor(rand() * 500),
      promptTokens,
      completionTokens,
      cost,
      status,
    });
  }
  return records;
}

/**
 * 默认预算状态
 */
export const SAMPLE_BUDGETS: BudgetStatus[] = [
  {
    budgetId: 'budget-daily',
    scope: 'daily',
    limit: 100,
    used: 78.42,
    remaining: 21.58,
    utilizationPercent: 78.4,
    periodStart: Date.now() - 24 * 60 * 60 * 1000,
    periodEnd: Date.now() + 0,
    alertLevel: 'warning',
  },
  {
    budgetId: 'budget-monthly-frontend',
    scope: 'agent',
    limit: 500,
    used: 312.18,
    remaining: 187.82,
    utilizationPercent: 62.4,
    periodStart: Date.now() - 30 * 24 * 60 * 60 * 1000,
    periodEnd: Date.now() + 0,
    alertLevel: 'normal',
  },
  {
    budgetId: 'budget-request-limits',
    scope: 'request',
    limit: 5,
    used: 1.24,
    remaining: 3.76,
    utilizationPercent: 24.8,
    periodStart: Date.now(),
    periodEnd: Date.now(),
    alertLevel: 'normal',
  },
];
