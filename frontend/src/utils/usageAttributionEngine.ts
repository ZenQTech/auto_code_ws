/**
 * # ============================================================
 * # Usage Attribution Engine - 用量归因引擎 (v1.0.0 Cycle 28 G28-03)
 * # ============================================================
 * # 核心作用：按 sub-agent / task / timestamp 拆分用量
 * # 输出：JSON 报告用于计费 chargeback
 * # 参考：Claude Code 2026-06 #4 Usage Attribution
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 28 G28-03 初次创建
 * # ============================================================
 */

export type AttributionDimension = 'agent' | 'task' | 'model' | 'session' | 'project';

export interface UsageRecord {
  id: string;
  timestamp: number;
  agentPath: string;
  taskId?: string;
  sessionId: string;
  projectId?: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface AttributionReport {
  schemaVersion: string;
  sessionId?: string;
  projectId?: string;
  generatedAt: number;
  periodStart: number;
  periodEnd: number;
  summary: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    recordCount: number;
  };
  byAgent: Array<{ agentPath: string; costUsd: number; tokens: number; recordCount: number }>;
  byTask: Array<{ taskId: string; costUsd: number; tokens: number; recordCount: number }>;
  byModel: Array<{ modelId: string; costUsd: number; tokens: number; recordCount: number }>;
  bySession: Array<{ sessionId: string; costUsd: number; tokens: number; recordCount: number }>;
  byProject: Array<{ projectId: string; costUsd: number; tokens: number; recordCount: number }>;
  byTimestamp: Array<{ timestamp: number; costUsd: number; tokens: number }>;
}

export const ATTRIBUTION_SCHEMA_VERSION = '1.0';

export type UsageAttributionEventType =
  | 'record-added'
  | 'report-generated'
  | 'project-tagged';

export interface UsageAttributionEvent {
  type: UsageAttributionEventType;
  timestamp: number;
  data?: Record<string, unknown>;
}

export class UsageAttributionEngine {
  private records: UsageRecord[] = [];
  private listeners: Map<UsageAttributionEventType, Set<(e: UsageAttributionEvent) => void>> = new Map();
  private storageKey = 'hermes.usageAttribution';
  private persistFlag: boolean;

  constructor(options: { persist?: boolean } = {}) {
    this.persistFlag = options.persist ?? true;
    if (this.persistFlag) {
      this.load();
    }
  }

  private load(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.records)) {
        this.records = data.records;
      }
    } catch (e) {
      console.warn('UsageAttributionEngine: failed to load', e);
    }
  }

  private save(): void {
    if (!this.persistFlag) return;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify({ records: this.records.slice(-1000) }));
      }
    } catch (e) {
      console.warn('UsageAttributionEngine: failed to save', e);
    }
  }

  on(event: UsageAttributionEventType, listener: (e: UsageAttributionEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: UsageAttributionEventType, listener: (e: UsageAttributionEvent) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: UsageAttributionEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(event);
        } catch (err) {
          console.error('UsageAttributionEngine: error in handler', err);
        }
      }
    }
  }

  // ============ 记录管理 ============

  addRecord(record: Omit<UsageRecord, 'id'>): UsageRecord {
    const full: UsageRecord = {
      ...record,
      id: 'usage-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    };
    this.records.push(full);
    this.save();
    this.emit({ type: 'record-added', timestamp: Date.now(), data: { id: full.id } });
    return full;
  }

  listRecords(filter?: {
    agentPath?: string;
    taskId?: string;
    sessionId?: string;
    modelId?: string;
    projectId?: string;
    since?: number;
    until?: number;
  }): UsageRecord[] {
    let result = [...this.records];
    if (filter?.agentPath) result = result.filter((r) => r.agentPath === filter.agentPath);
    if (filter?.taskId) result = result.filter((r) => r.taskId === filter.taskId);
    if (filter?.sessionId) result = result.filter((r) => r.sessionId === filter.sessionId);
    if (filter?.modelId) result = result.filter((r) => r.modelId === filter.modelId);
    if (filter?.projectId) result = result.filter((r) => r.projectId === filter.projectId);
    if (filter?.since) result = result.filter((r) => r.timestamp >= filter.since!);
    if (filter?.until) result = result.filter((r) => r.timestamp <= filter.until!);
    return result;
  }

  tagProject(agentPath: string, projectId: string): number {
    let count = 0;
    for (const r of this.records) {
      if (r.agentPath === agentPath && !r.projectId) {
        r.projectId = projectId;
        count++;
      }
    }
    this.save();
    this.emit({ type: 'project-tagged', timestamp: Date.now(), data: { agentPath, projectId, count } });
    return count;
  }

  // ============ 报告生成 ============

  generateReport(options: {
    sessionId?: string;
    projectId?: string;
    since?: number;
    until?: number;
  } = {}): AttributionReport {
    const records = this.listRecords(options);
    const periodStart = options.since ?? (records[0]?.timestamp ?? Date.now());
    const periodEnd = options.until ?? Date.now();
    const summary = {
      totalInputTokens: records.reduce((s, r) => s + r.inputTokens, 0),
      totalOutputTokens: records.reduce((s, r) => s + r.outputTokens, 0),
      totalTokens: records.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0),
      totalCostUsd: records.reduce((s, r) => s + r.costUsd, 0),
      recordCount: records.length,
    };
    const byAgent = this.aggregate(records, 'agentPath');
    const byTask = this.aggregate(records, 'taskId');
    const byModel = this.aggregate(records, 'modelId');
    const bySession = this.aggregate(records, 'sessionId');
    const byProject = this.aggregate(records, 'projectId');
    const byTimestamp = this.aggregateByTimestamp(records);
    const report: AttributionReport = {
      schemaVersion: ATTRIBUTION_SCHEMA_VERSION,
      sessionId: options.sessionId,
      projectId: options.projectId,
      generatedAt: Date.now(),
      periodStart,
      periodEnd,
      summary,
      byAgent,
      byTask,
      byModel,
      bySession,
      byProject,
      byTimestamp,
    };
    this.emit({ type: 'report-generated', timestamp: Date.now(), data: { recordCount: records.length } });
    return report;
  }

  private aggregate(
    records: UsageRecord[],
    field: 'agentPath' | 'taskId' | 'modelId' | 'sessionId' | 'projectId'
  ): Array<{ agentPath: string; taskId: string; modelId: string; sessionId: string; projectId: string; costUsd: number; tokens: number; recordCount: number }> {
    const map = new Map<string, { costUsd: number; tokens: number; recordCount: number }>();
    for (const r of records) {
      const key = (r[field] as string) || 'unknown';
      if (!map.has(key)) {
        map.set(key, { costUsd: 0, tokens: 0, recordCount: 0 });
      }
      const v = map.get(key)!;
      v.costUsd += r.costUsd;
      v.tokens += r.inputTokens + r.outputTokens;
      v.recordCount++;
    }
    return Array.from(map.entries()).map(([key, v]) => ({
      agentPath: field === 'agentPath' ? key : '',
      taskId: field === 'taskId' ? key : '',
      modelId: field === 'modelId' ? key : '',
      sessionId: field === 'sessionId' ? key : '',
      projectId: field === 'projectId' ? key : '',
      ...v,
    }));
  }

  private aggregateByTimestamp(records: UsageRecord[]): Array<{ timestamp: number; costUsd: number; tokens: number }> {
    const sorted = [...records].sort((a, b) => a.timestamp - b.timestamp);
    return sorted.map((r) => ({
      timestamp: r.timestamp,
      costUsd: r.costUsd,
      tokens: r.inputTokens + r.outputTokens,
    }));
  }

  exportJson(options: { sessionId?: string; projectId?: string; since?: number; until?: number } = {}): string {
    const report = this.generateReport(options);
    return JSON.stringify(report, null, 2);
  }
}

let defaultEngine: UsageAttributionEngine | null = null;
export function getDefaultUsageAttributionEngine(): UsageAttributionEngine {
  if (!defaultEngine) {
    defaultEngine = new UsageAttributionEngine();
  }
  return defaultEngine;
}
export function resetDefaultUsageAttributionEngine(): void {
  defaultEngine = null;
}
