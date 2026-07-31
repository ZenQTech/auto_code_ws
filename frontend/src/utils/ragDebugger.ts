/**
 * # ============================================================
 * # RAGDebugger - RAG 调试器与回放系统 (v1.0.0 Cycle 46 G46-03)
 * # ============================================================
 * # 核心作用：记录 RAG 执行的完整 trace，支持步骤回放和中间结果可视化
 * #           - 阶段追踪：retrieval / prompting / llm-call / streaming / parsing
 * #           - 中间结果：每个阶段的输入、输出、耗时
 * #           - 时间线视图：按时间顺序展示所有事件
 * #           - 回放支持：可暂停/继续/快进/单步执行
 * #           - Trace 导出：JSON / Markdown / Mermaid
 * #           - 性能分析：各阶段耗时占比、瓶颈识别
 * #           - 多 Session 管理：同时跟踪多个 RAG 会话
 * # 对标产品：LangSmith Trace / LangFuse / Arize Phoenix
 * # ============================================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 46 G46-03 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/**
 * RAG 阶段
 */
export type RAGStageType =
  | 'query-input'        // 查询输入
  | 'decision-making'    // 决策（资源/工具/混合）
  | 'retrieval'          // 检索
  | 'rerank'             // 重排
  | 'prompt-assembly'    // Prompt 组装
  | 'llm-call'           // LLM 调用
  | 'streaming'          // 流式响应
  | 'citation-extract'   // 引用提取
  | 'output'             // 输出
  | 'error'              // 错误
  | 'custom';            // 自定义

/**
 * Trace 事件
 */
export interface TraceEvent {
  /** 事件 ID */
  id: string;
  /** Session ID */
  sessionId: string;
  /** 阶段 */
  stage: RAGStageType;
  /** 事件名称 */
  name: string;
  /** 时间戳 */
  timestamp: number;
  /** 耗时（毫秒） */
  durationMs?: number;
  /** 输入 */
  input?: unknown;
  /** 输出 */
  output?: unknown;
  /** 元数据 */
  metadata?: Record<string, unknown>;
  /** 父事件 ID（用于嵌套） */
  parentId?: string;
  /** 标签 */
  tags?: string[];
  /** 错误 */
  error?: { message: string; stack?: string };
}

/**
 * RAG Session
 */
export interface RAGSession {
  /** Session ID */
  id: string;
  /** 用户查询 */
  query: string;
  /** 开始时间 */
  startTime: number;
  /** 结束时间 */
  endTime?: number;
  /** 总耗时 */
  totalDurationMs?: number;
  /** Session 状态 */
  status: 'running' | 'completed' | 'failed' | 'paused';
  /** 事件列表 */
  events: TraceEvent[];
  /** 最终答案 */
  finalAnswer?: string;
  /** 引用数 */
  citationCount?: number;
  /** Token 用量 */
  tokens?: { input: number; output: number; total: number };
  /** 元数据 */
  metadata?: Record<string, unknown>;
  /** 标签 */
  tags?: string[];
}

/**
 * 回放控制
 */
export interface ReplayControl {
  /** 当前时间（毫秒，从 session 开始） */
  currentTimeMs: number;
  /** 播放速度（1.0 = 正常，2.0 = 2x） */
  speed: number;
  /** 暂停 */
  paused: boolean;
  /** 当前事件索引 */
  currentEventIndex: number;
}

/**
 * 阶段耗时分析
 */
export interface StageAnalysis {
  /** 阶段 */
  stage: RAGStageType;
  /** 事件数 */
  eventCount: number;
  /** 总耗时 */
  totalDurationMs: number;
  /** 平均耗时 */
  avgDurationMs: number;
  /** 最大耗时 */
  maxDurationMs: number;
  /** 占比 */
  percentage: number;
}

// ============ 工具函数 ============

function genId(prefix: string = 'rag'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============ RAGDebugger 主类 ============

/**
 * RAG 调试器
 */
export class RAGDebugger {
  /** 所有 Session */
  private readonly sessions: Map<string, RAGSession> = new Map();
  /** 当前 Session ID */
  private currentSessionId: string | null = null;
  /** 回放控制 */
  private replayState: Map<string, ReplayControl> = new Map();
  /** 事件监听器 */
  private readonly listeners: Map<string, Set<RAGDebuggerListener>> = new Map();
  /** 最大 Session 数 */
  private readonly maxSessions: number;

  constructor(maxSessions: number = 100) {
    this.maxSessions = maxSessions;
  }

  // ============ 事件订阅 ============

  on(event: string, listener: RAGDebuggerListener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  private emit(event: string, data: unknown): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const listener of set) {
        try {
          listener(data);
        } catch (err) {
          // ignore
        }
      }
    }
  }

  // ============ Session 管理 ============

  /**
   * 开始新 Session
   */
  startSession(query: string, metadata?: Record<string, unknown>): RAGSession {
    const id = genId('session');
    const session: RAGSession = {
      id,
      query,
      startTime: Date.now(),
      status: 'running',
      events: [],
      metadata,
    };
    this.sessions.set(id, session);
    this.currentSessionId = id;

    // 超过上限，淘汰最旧
    if (this.sessions.size > this.maxSessions) {
      const firstKey = this.sessions.keys().next().value;
      if (firstKey) this.sessions.delete(firstKey);
    }

    // 自动记录 query-input 事件
    this.addEvent({
      stage: 'query-input',
      name: 'User Query',
      input: { query },
      metadata,
    });

    this.emit('session-started', session);
    return session;
  }

  /**
   * 结束 Session
   */
  endSession(sessionId?: string, finalAnswer?: string, tokens?: { input: number; output: number; total: number }): RAGSession | undefined {
    const id = sessionId ?? this.currentSessionId;
    if (!id) return undefined;
    const session = this.sessions.get(id);
    if (!session) return undefined;

    session.endTime = Date.now();
    session.totalDurationMs = session.endTime - session.startTime;
    session.status = session.status === 'failed' ? 'failed' : 'completed';
    if (finalAnswer) session.finalAnswer = finalAnswer;
    if (tokens) session.tokens = tokens;
    if (this.currentSessionId === id) this.currentSessionId = null;

    this.emit('session-ended', session);
    return session;
  }

  /**
   * 标记 Session 失败
   */
  failSession(error: Error, sessionId?: string): RAGSession | undefined {
    const id = sessionId ?? this.currentSessionId;
    if (!id) return undefined;
    const session = this.sessions.get(id);
    if (!session) return undefined;

    this.addEvent({
      stage: 'error',
      name: 'Session Failed',
      error: { message: error.message, stack: error.stack },
    }, id);

    session.endTime = Date.now();
    session.totalDurationMs = session.endTime - session.startTime;
    session.status = 'failed';

    this.emit('session-failed', { session, error });
    return session;
  }

  // ============ 事件记录 ============

  /**
   * 添加 trace 事件
   */
  addEvent(event: Omit<TraceEvent, 'id' | 'timestamp' | 'sessionId'>, sessionId?: string): TraceEvent {
    const id = sessionId ?? this.currentSessionId;
    if (!id) throw new Error('No active session');
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);

    const fullEvent: TraceEvent = {
      id: genId('event'),
      sessionId: id,
      timestamp: Date.now(),
      ...event,
    };
    session.events.push(fullEvent);
    this.emit('event-added', fullEvent);
    return fullEvent;
  }

  /**
   * 同步执行并记录（自动计算耗时）
   */
  async trace<T>(
    stage: RAGStageType,
    name: string,
    fn: () => Promise<T> | T,
    options: { input?: unknown; tags?: string[]; parentId?: string; sessionId?: string } = {}
  ): Promise<T> {
    const startTime = Date.now();
    let result: T;
    let error: Error | undefined;
    try {
      result = await fn();
    } catch (err) {
      error = err as Error;
      this.addEvent({
        stage,
        name,
        input: options.input,
        output: undefined,
        durationMs: Date.now() - startTime,
        tags: options.tags,
        parentId: options.parentId,
        error: { message: error.message, stack: error.stack },
      }, options.sessionId);
      throw error;
    }
    this.addEvent({
      stage,
      name,
      input: options.input,
      output: result,
      durationMs: Date.now() - startTime,
      tags: options.tags,
      parentId: options.parentId,
    }, options.sessionId);
    return result;
  }

  // ============ 查询 / 检索 ============

  /**
   * 获取 Session
   */
  getSession(id: string): RAGSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * 获取所有 Session
   */
  getAllSessions(): RAGSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 获取最近的 N 个 Session
   */
  getRecentSessions(n: number = 10): RAGSession[] {
    const all = Array.from(this.sessions.values());
    return all.slice(-n);
  }

  /**
   * 获取 Session 的事件
   */
  getSessionEvents(sessionId: string, stage?: RAGStageType): TraceEvent[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    if (stage) {
      return session.events.filter((e) => e.stage === stage);
    }
    return [...session.events];
  }

  /**
   * 获取当前 Session
   */
  getCurrentSession(): RAGSession | undefined {
    return this.currentSessionId ? this.sessions.get(this.currentSessionId) : undefined;
  }

  // ============ 分析 ============

  /**
   * 阶段耗时分析
   */
  analyzeStages(sessionId: string): StageAnalysis[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    const totalMs = session.totalDurationMs ?? session.events.reduce((s, e) => s + (e.durationMs ?? 0), 0);
    const stageMap = new Map<RAGStageType, { count: number; total: number; max: number }>();

    for (const event of session.events) {
      if (event.durationMs === undefined) continue;
      const existing = stageMap.get(event.stage) ?? { count: 0, total: 0, max: 0 };
      existing.count += 1;
      existing.total += event.durationMs;
      existing.max = Math.max(existing.max, event.durationMs);
      stageMap.set(event.stage, existing);
    }

    return Array.from(stageMap.entries()).map(([stage, data]) => ({
      stage,
      eventCount: data.count,
      totalDurationMs: data.total,
      avgDurationMs: data.total / data.count,
      maxDurationMs: data.max,
      percentage: totalMs > 0 ? (data.total / totalMs) * 100 : 0,
    }));
  }

  /**
   * 识别瓶颈（耗时最长的阶段）
   */
  identifyBottleneck(sessionId: string): StageAnalysis | undefined {
    const analyses = this.analyzeStages(sessionId);
    if (analyses.length === 0) return undefined;
    return analyses.reduce((max, cur) => (cur.totalDurationMs > max.totalDurationMs ? cur : max));
  }

  // ============ 回放 ============

  /**
   * 开始回放 Session
   */
  startReplay(sessionId: string, speed: number = 1.0): ReplayControl {
    const control: ReplayControl = {
      currentTimeMs: 0,
      speed,
      paused: false,
      currentEventIndex: 0,
    };
    this.replayState.set(sessionId, control);
    this.emit('replay-started', { sessionId, control });
    return control;
  }

  /**
   * 推进回放
   */
  advanceReplay(sessionId: string, deltaMs?: number): ReplayControl | undefined {
    const control = this.replayState.get(sessionId);
    const session = this.sessions.get(sessionId);
    if (!control || !session) return undefined;

    if (deltaMs === undefined) {
      // 推进到下一个事件
      const nextEvent = session.events[control.currentEventIndex + 1];
      if (nextEvent) {
        control.currentTimeMs = nextEvent.timestamp - session.startTime;
        control.currentEventIndex += 1;
      }
    } else {
      control.currentTimeMs += deltaMs * control.speed;
      // 更新事件索引
      const startTime = session.startTime;
      control.currentEventIndex = session.events.findIndex(
        (e) => e.timestamp - startTime > control.currentTimeMs
      );
      if (control.currentEventIndex === -1) control.currentEventIndex = session.events.length;
    }

    this.emit('replay-advanced', { sessionId, control });
    return control;
  }

  /**
   * 暂停回放
   */
  pauseReplay(sessionId: string): void {
    const control = this.replayState.get(sessionId);
    if (control) {
      control.paused = true;
      this.emit('replay-paused', { sessionId, control });
    }
  }

  /**
   * 继续回放
   */
  resumeReplay(sessionId: string): void {
    const control = this.replayState.get(sessionId);
    if (control) {
      control.paused = false;
      this.emit('replay-resumed', { sessionId, control });
    }
  }

  /**
   * 获取回放控制
   */
  getReplayControl(sessionId: string): ReplayControl | undefined {
    return this.replayState.get(sessionId);
  }

  /**
   * 获取当前回放可见事件
   */
  getVisibleEvents(sessionId: string): TraceEvent[] {
    const control = this.replayState.get(sessionId);
    const session = this.sessions.get(sessionId);
    if (!control || !session) return [];
    return session.events.slice(0, control.currentEventIndex + 1);
  }

  // ============ 导出 ============

  /**
   * 导出 Session 为 JSON
   */
  exportSession(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return '{}';
    return JSON.stringify(
      {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        session,
        analysis: this.analyzeStages(sessionId),
        bottleneck: this.identifyBottleneck(sessionId),
      },
      null,
      2
    );
  }

  /**
   * 导出 Session 为 Markdown
   */
  exportSessionAsMarkdown(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return '';

    const analyses = this.analyzeStages(sessionId);
    const bottleneck = this.identifyBottleneck(sessionId);

    const lines: string[] = [];
    lines.push(`# RAG Session ${session.id}`);
    lines.push('');
    lines.push(`**Query**: ${session.query}`);
    lines.push(`**Status**: ${session.status}`);
    lines.push(`**Duration**: ${session.totalDurationMs ?? 0}ms`);
    lines.push(`**Start**: ${new Date(session.startTime).toISOString()}`);
    if (session.endTime) lines.push(`**End**: ${new Date(session.endTime).toISOString()}`);
    lines.push('');

    if (session.finalAnswer) {
      lines.push('## Final Answer');
      lines.push('');
      lines.push(session.finalAnswer);
      lines.push('');
    }

    lines.push('## Stage Analysis');
    lines.push('');
    lines.push('| Stage | Count | Total (ms) | Avg (ms) | Max (ms) | % |');
    lines.push('|-------|-------|-----------|----------|----------|---|');
    for (const a of analyses) {
      lines.push(`| ${a.stage} | ${a.eventCount} | ${a.totalDurationMs.toFixed(0)} | ${a.avgDurationMs.toFixed(1)} | ${a.maxDurationMs.toFixed(0)} | ${a.percentage.toFixed(1)}% |`);
    }
    lines.push('');

    if (bottleneck) {
      lines.push(`**Bottleneck**: ${bottleneck.stage} (${bottleneck.totalDurationMs}ms, ${bottleneck.percentage.toFixed(1)}%)`);
      lines.push('');
    }

    lines.push('## Trace Events');
    lines.push('');
    for (const event of session.events) {
      lines.push(`### ${event.stage}: ${event.name}`);
      lines.push(`- **Time**: ${new Date(event.timestamp).toISOString()}`);
      if (event.durationMs !== undefined) lines.push(`- **Duration**: ${event.durationMs}ms`);
      if (event.input !== undefined) {
        lines.push(`- **Input**: \`\`\`json\n${JSON.stringify(event.input, null, 2)}\n\`\`\``);
      }
      if (event.output !== undefined) {
        lines.push(`- **Output**: \`\`\`json\n${JSON.stringify(event.output, null, 2)}\n\`\`\``);
      }
      if (event.error) {
        lines.push(`- **Error**: ${event.error.message}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 导出 Session 为 Mermaid 时序图
   */
  exportSessionAsMermaid(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return '';

    const lines: string[] = [];
    lines.push('```mermaid');
    lines.push('sequenceDiagram');
    lines.push('    participant User');
    lines.push('    participant RAG');
    lines.push('    participant LLM');

    for (const event of session.events) {
      const actor = event.stage === 'llm-call' || event.stage === 'streaming' ? 'LLM' : 'RAG';
      const dur = event.durationMs !== undefined ? ` (${event.durationMs}ms)` : '';
      lines.push(`    User->>${actor}: ${event.name}${dur}`);
    }

    if (session.finalAnswer) {
      lines.push(`    ${actor('RAG')}->>User: Final Answer`);
    }

    lines.push('```');
    return lines.join('\n');
  }

  // ============ 清理 ============

  /**
   * 清空所有 Session
   */
  clearAll(): void {
    this.sessions.clear();
    this.replayState.clear();
    this.currentSessionId = null;
    this.emit('cleared', { at: Date.now() });
  }
}

// ============ 类型重导出 ============

function actor(_name: string): string {
  return _name;
}

export type RAGDebuggerListener = (data: unknown) => void;

export default RAGDebugger;
