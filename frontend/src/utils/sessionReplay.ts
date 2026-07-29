/**
 * # ============================================================
 * # SessionReplayEngine - 会话回放引擎 (v1.0.0 Cycle 23 G23-02)
 * # ============================================================
 * # 核心作用：录制/回放完整对话流程，支持调试、复盘、分享、教程制作
 * # 主要功能：
 * #   1. 自动录制（消息/工具调用/思考/工作流状态）
 * #   2. 时间轴回放（拖动跳转/速度控制/暂停/上下帧）
 * #   3. 关键节点高亮（用户干预/错误/工具调用/阶段变更）
 * #   4. 多种导出格式（JSON/HTML/Markdown）
 * #   5. 分享链接生成
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 23 G23-02 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/** 回放帧类型 */
export type ReplayFrameType =
  | 'message'
  | 'tool-call'
  | 'thinking'
  | 'workflow-stage'
  | 'user-action';

/** 高亮类型 */
export type ReplayHighlight =
  | 'user-action'
  | 'error'
  | 'tool-call'
  | 'stage-change';

/** 角色类型 */
export type ReplayRole = 'user' | 'assistant' | 'system' | 'tool';

/** 消息帧数据 */
export interface MessageFrameData {
  role: ReplayRole;
  content: string;
  messageId?: string;
  model?: string;
  tokens?: { input: number; output: number };
}

/** 工具调用帧数据 */
export interface ToolCallFrameData {
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs: number;
  callId?: string;
}

/** 思考帧数据 */
export interface ThinkingFrameData {
  content: string;
  durationMs: number;
  model?: string;
}

/** 工作流阶段帧数据 */
export interface WorkflowStageFrameData {
  stage: string;
  previousStage?: string;
  status: 'enter' | 'exit' | 'complete';
  metadata?: Record<string, unknown>;
}

/** 用户操作帧数据 */
export interface UserActionFrameData {
  action:
    | 'edit'
    | 'regenerate'
    | 'stop'
    | 'approve'
    | 'reject'
    | 'submit-feedback'
    | 'switch-mode';
  details?: Record<string, unknown>;
}

/** 回放帧 */
export interface ReplayFrame {
  frameId: string;
  type: ReplayFrameType;
  timestamp: number;
  durationMs: number;
  data: MessageFrameData | ToolCallFrameData | ThinkingFrameData | WorkflowStageFrameData | UserActionFrameData;
  highlight?: ReplayHighlight;
  description?: string;
}

/** 会话元数据 */
export interface ReplayMetadata {
  totalMessages: number;
  totalToolCalls: number;
  totalErrors: number;
  totalThinking: number;
  totalUserActions: number;
  duration: number;
  models: string[];
  tools: string[];
}

/** 回放会话 */
export interface ReplaySession {
  replayId: string;
  sessionId: string;
  title: string;
  startedAt: number;
  endedAt: number;
  frames: ReplayFrame[];
  metadata: ReplayMetadata;
  createdAt: number;
}

/** 回放状态 */
export interface ReplayState {
  currentReplayId: string | null;
  currentFrameIndex: number;
  isPlaying: boolean;
  playbackSpeed: number;
  totalFrames: number;
  currentTime: number;
  totalDuration: number;
}

/** 录制输入会话数据 */
export interface SessionData {
  sessionId: string;
  title?: string;
  startedAt?: number;
  endedAt?: number;
  frames?: ReplayFrame[];
}

/** 导出格式 */
export type ReplayExportFormat = 'json' | 'html' | 'markdown';

/** 分享链接配置 */
export interface ShareConfig {
  baseUrl: string;
  expiresInDays: number;
  readonly: boolean;
}

/** 分享信息 */
export interface ShareInfo {
  shareId: string;
  url: string;
  expiresAt: number;
  readonly: boolean;
}

/** 事件类型 */
export type ReplayEventType =
  | 'replay-created'
  | 'frame-added'
  | 'play'
  | 'pause'
  | 'seek'
  | 'ended'
  | 'exported'
  | 'shared';

type ReplayEventHandler = (data?: unknown) => void;

// ============ 工具函数 ============

/** 生成唯一 ID */
function generateId(prefix: string = 'r'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 默认存储 */
export interface ReplayStorage {
  saveReplay(replay: ReplaySession): void;
  loadReplay(replayId: string): ReplaySession | null;
  listReplays(): ReplaySession[];
  deleteReplay(replayId: string): void;
  saveShare(share: ShareInfo & { replayId: string }): void;
  loadShare(shareId: string): { share: ShareInfo; replayId: string } | null;
}

/** 内存存储实现 */
export class MemoryReplayStorage implements ReplayStorage {
  private replays: Map<string, ReplaySession> = new Map();
  private shares: Map<string, { share: ShareInfo; replayId: string }> = new Map();

  saveReplay(replay: ReplaySession): void {
    this.replays.set(replay.replayId, replay);
  }

  loadReplay(replayId: string): ReplaySession | null {
    return this.replays.get(replayId) || null;
  }

  listReplays(): ReplaySession[] {
    return Array.from(this.replays.values()).sort(
      (a, b) => b.createdAt - a.createdAt
    );
  }

  deleteReplay(replayId: string): void {
    this.replays.delete(replayId);
  }

  saveShare(share: ShareInfo & { replayId: string }): void {
    this.shares.set(share.shareId, { share, replayId: share.replayId });
  }

  loadShare(shareId: string): { share: ShareInfo; replayId: string } | null {
    return this.shares.get(shareId) || null;
  }
}

// ============ 事件总线 ============

class ReplayEventBus {
  private listeners: Map<ReplayEventType, Set<ReplayEventHandler>> = new Map();

  on(type: ReplayEventType, handler: ReplayEventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    return () => {
      this.listeners.get(type)?.delete(handler);
    };
  }

  emit(type: ReplayEventType, data?: unknown): void {
    this.listeners.get(type)?.forEach((h) => {
      try {
        h(data);
      } catch (err) {
        // 静默处理监听器异常
      }
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}

// ============ 主引擎 ============

export class SessionReplayEngine {
  /** 录制器（当前正在录制的会话） */
  private currentRecording: {
    sessionId: string;
    title: string;
    startedAt: number;
    frames: ReplayFrame[];
  } | null = null;

  /** 回放状态 */
  private state: ReplayState = {
    currentReplayId: null,
    currentFrameIndex: 0,
    isPlaying: false,
    playbackSpeed: 1,
    totalFrames: 0,
    currentTime: 0,
    totalDuration: 0,
  };

  /** 当前回放的会话 */
  private currentReplay: ReplaySession | null = null;

  /** 播放定时器 */
  private playTimer: ReturnType<typeof setTimeout> | null = null;

  /** 存储 */
  private storage: ReplayStorage;

  /** 事件总线 */
  private readonly eventBus: ReplayEventBus = new ReplayEventBus();

  /** 分享配置 */
  private shareConfig: ShareConfig = {
    baseUrl: typeof window !== 'undefined' ? window.location.origin : 'https://hermes.example.com',
    expiresInDays: 7,
    readonly: true,
  };

  constructor(storage?: ReplayStorage) {
    this.storage = storage || new MemoryReplayStorage();
  }

  // ============ 录制 API ============

  /** 开始录制会话 */
  startRecording(sessionId: string, title?: string): void {
    this.currentRecording = {
      sessionId,
      title: title || `Session ${sessionId.slice(0, 8)}`,
      startedAt: Date.now(),
      frames: [],
    };
  }

  /** 添加录制帧 */
  addFrame(
    type: ReplayFrameType,
    data: ReplayFrame['data'],
    options?: { highlight?: ReplayHighlight; description?: string; durationMs?: number }
  ): ReplayFrame | null {
    if (!this.currentRecording) return null;
    const frame: ReplayFrame = {
      frameId: generateId('f'),
      type,
      timestamp: Date.now() - this.currentRecording.startedAt,
      durationMs: options?.durationMs ?? 0,
      data,
      highlight: options?.highlight,
      description: options?.description,
    };
    this.currentRecording.frames.push(frame);
    this.eventBus.emit('frame-added', frame);
    return frame;
  }

  /** 停止录制并生成回放 */
  stopRecording(): ReplaySession | null {
    if (!this.currentRecording) return null;
    const endedAt = Date.now();
    const replay = this.buildReplayFromRecording(this.currentRecording, endedAt);
    this.storage.saveReplay(replay);
    this.currentRecording = null;
    this.eventBus.emit('replay-created', replay);
    return replay;
  }

  /** 取消录制（不保存） */
  cancelRecording(): void {
    this.currentRecording = null;
  }

  /** 当前是否在录制 */
  isRecording(): boolean {
    return this.currentRecording !== null;
  }

  // ============ 回放管理 ============

  /** 从会话数据直接创建回放（不通过录制） */
  createReplay(sessionData: SessionData): ReplaySession {
    const now = Date.now();
    const frames = sessionData.frames || [];
    const replay: ReplaySession = {
      replayId: generateId('replay'),
      sessionId: sessionData.sessionId,
      title: sessionData.title || `Session ${sessionData.sessionId.slice(0, 8)}`,
      startedAt: sessionData.startedAt || now,
      endedAt: sessionData.endedAt || now,
      frames,
      metadata: this.computeMetadata(frames),
      createdAt: now,
    };
    this.storage.saveReplay(replay);
    this.eventBus.emit('replay-created', replay);
    return replay;
  }

  /** 加载回放 */
  loadReplay(replayId: string): ReplaySession | null {
    const replay = this.storage.loadReplay(replayId);
    if (replay) {
      this.currentReplay = replay;
      this.state.currentReplayId = replayId;
      this.state.currentFrameIndex = 0;
      this.state.totalFrames = replay.frames.length;
      this.state.totalDuration = replay.metadata.duration;
      this.state.currentTime = 0;
      this.state.isPlaying = false;
    }
    return replay;
  }

  /** 列出所有回放 */
  listReplays(): ReplaySession[] {
    return this.storage.listReplays();
  }

  /** 删除回放 */
  deleteReplay(replayId: string): void {
    this.storage.deleteReplay(replayId);
    if (this.state.currentReplayId === replayId) {
      this.stop();
      this.currentReplay = null;
      this.state.currentReplayId = null;
      this.state.currentFrameIndex = 0;
      this.state.totalFrames = 0;
      this.state.currentTime = 0;
      this.state.totalDuration = 0;
    }
  }

  /** 加载当前回放 */
  getCurrentReplay(): ReplaySession | null {
    return this.currentReplay;
  }

  // ============ 播放控制 ============

  /** 开始播放 */
  play(): void {
    if (!this.currentReplay || this.currentReplay.frames.length === 0) return;
    if (this.state.currentFrameIndex >= this.currentReplay.frames.length - 1) {
      // 已经到末尾，从头开始
      this.state.currentFrameIndex = 0;
      this.state.currentTime = 0;
    }
    this.state.isPlaying = true;
    this.eventBus.emit('play');
    this.scheduleNextFrame();
  }

  /** 暂停 */
  pause(): void {
    this.state.isPlaying = false;
    this.clearTimer();
    this.eventBus.emit('pause');
  }

  /** 停止（重置到开头） */
  stop(): void {
    this.state.isPlaying = false;
    this.state.currentFrameIndex = 0;
    this.state.currentTime = 0;
    this.clearTimer();
    this.eventBus.emit('pause');
  }

  /** 跳转到指定帧 */
  seekTo(frameIndex: number): ReplayFrame | null {
    if (!this.currentReplay) return null;
    const idx = Math.max(0, Math.min(frameIndex, this.currentReplay.frames.length - 1));
    this.state.currentFrameIndex = idx;
    this.state.currentTime = this.currentReplay.frames[idx]?.timestamp || 0;
    this.eventBus.emit('seek', { frameIndex: idx });
    if (this.state.isPlaying) {
      this.clearTimer();
      this.scheduleNextFrame();
    }
    return this.currentReplay.frames[idx] || null;
  }

  /** 跳转到指定时间（毫秒） */
  seekToTime(timeMs: number): ReplayFrame | null {
    if (!this.currentReplay) return null;
    const frames = this.currentReplay.frames;
    let targetIdx = 0;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].timestamp <= timeMs) {
        targetIdx = i;
      } else {
        break;
      }
    }
    return this.seekTo(targetIdx);
  }

  /** 设置播放速度 */
  setSpeed(speed: number): void {
    const validSpeed = Math.max(0.25, Math.min(speed, 8));
    this.state.playbackSpeed = validSpeed;
    if (this.state.isPlaying) {
      this.clearTimer();
      this.scheduleNextFrame();
    }
  }

  /** 下一帧 */
  next(): ReplayFrame | null {
    if (!this.currentReplay) return null;
    if (this.state.currentFrameIndex >= this.currentReplay.frames.length - 1) {
      this.pause();
      this.eventBus.emit('ended');
      return null;
    }
    return this.seekTo(this.state.currentFrameIndex + 1);
  }

  /** 上一帧 */
  prev(): ReplayFrame | null {
    if (!this.currentReplay) return null;
    return this.seekTo(this.state.currentFrameIndex - 1);
  }

  /** 获取当前帧 */
  getCurrentFrame(): ReplayFrame | null {
    if (!this.currentReplay) return null;
    return this.currentReplay.frames[this.state.currentFrameIndex] || null;
  }

  /** 获取状态 */
  getState(): ReplayState {
    return { ...this.state };
  }

  // ============ 导出 ============

  /** 导出回放 */
  exportReplay(
    replayId: string,
    format: ReplayExportFormat,
    options?: { includeMetadata?: boolean }
  ): string {
    const replay = this.storage.loadReplay(replayId);
    if (!replay) throw new Error(`回放不存在: ${replayId}`);

    const includeMetadata = options?.includeMetadata !== false;
    const content =
      format === 'json'
        ? this.exportAsJson(replay, includeMetadata)
        : format === 'html'
        ? this.exportAsHtml(replay, includeMetadata)
        : this.exportAsMarkdown(replay, includeMetadata);

    this.eventBus.emit('exported', { replayId, format, size: content.length });
    return content;
  }

  // ============ 分享 ============

  /** 生成分享链接 */
  createShareLink(replayId: string, config?: Partial<ShareConfig>): ShareInfo {
    const replay = this.storage.loadReplay(replayId);
    if (!replay) throw new Error(`回放不存在: ${replayId}`);

    const cfg = { ...this.shareConfig, ...config };
    const shareId = generateId('share');
    const now = Date.now();
    const share: ShareInfo & { replayId: string } = {
      shareId,
      replayId,
      url: `${cfg.baseUrl}/replay/${shareId}`,
      expiresAt: now + cfg.expiresInDays * 24 * 60 * 60 * 1000,
      readonly: cfg.readonly,
    };
    this.storage.saveShare(share);
    this.eventBus.emit('shared', share);
    return {
      shareId,
      url: share.url,
      expiresAt: share.expiresAt,
      readonly: share.readonly,
    };
  }

  /** 通过分享 ID 获取回放 */
  getReplayByShare(shareId: string): ReplaySession | null {
    const entry = this.storage.loadShare(shareId);
    if (!entry) return null;
    if (Date.now() > entry.share.expiresAt) return null;
    return this.storage.loadReplay(entry.replayId);
  }

  /** 设置分享默认配置 */
  setShareConfig(config: Partial<ShareConfig>): void {
    this.shareConfig = { ...this.shareConfig, ...config };
  }

  // ============ 事件订阅 ============

  /** 订阅事件 */
  on(type: ReplayEventType, handler: ReplayEventHandler): () => void {
    return this.eventBus.on(type, handler);
  }

  // ============ 内部方法 ============

  /** 从录制构建回放 */
  private buildReplayFromRecording(
    recording: NonNullable<typeof this.currentRecording>,
    endedAt: number
  ): ReplaySession {
    const frames = recording.frames;
    return {
      replayId: generateId('replay'),
      sessionId: recording.sessionId,
      title: recording.title,
      startedAt: recording.startedAt,
      endedAt,
      frames,
      metadata: this.computeMetadata(frames),
      createdAt: Date.now(),
    };
  }

  /** 计算元数据 */
  private computeMetadata(frames: ReplayFrame[]): ReplayMetadata {
    const meta: ReplayMetadata = {
      totalMessages: 0,
      totalToolCalls: 0,
      totalErrors: 0,
      totalThinking: 0,
      totalUserActions: 0,
      duration: 0,
      models: [],
      tools: [],
    };
    const modelSet = new Set<string>();
    const toolSet = new Set<string>();
    for (const f of frames) {
      switch (f.type) {
        case 'message': {
          meta.totalMessages++;
          const d = f.data as MessageFrameData;
          if (d.model) modelSet.add(d.model);
          break;
        }
        case 'tool-call': {
          meta.totalToolCalls++;
          const d = f.data as ToolCallFrameData;
          toolSet.add(d.toolName);
          if (d.error) meta.totalErrors++;
          break;
        }
        case 'thinking': {
          meta.totalThinking++;
          const d = f.data as ThinkingFrameData;
          if (d.model) modelSet.add(d.model);
          break;
        }
        case 'user-action': {
          meta.totalUserActions++;
          break;
        }
        case 'workflow-stage': {
          break;
        }
      }
      if (f.highlight === 'error') meta.totalErrors++;
      if (f.timestamp > meta.duration) meta.duration = f.timestamp;
    }
    meta.models = Array.from(modelSet);
    meta.tools = Array.from(toolSet);
    return meta;
  }

  /** 调度下一帧 */
  private scheduleNextFrame(): void {
    if (!this.currentReplay || !this.state.isPlaying) return;
    const frames = this.currentReplay.frames;
    const idx = this.state.currentFrameIndex;
    if (idx >= frames.length - 1) {
      this.pause();
      this.eventBus.emit('ended');
      return;
    }
    const current = frames[idx];
    const next = frames[idx + 1];
    if (!next) {
      this.pause();
      this.eventBus.emit('ended');
      return;
    }
    const delta = Math.max(100, next.timestamp - current.timestamp);
    const adjusted = delta / this.state.playbackSpeed;
    this.playTimer = setTimeout(() => {
      this.seekTo(idx + 1);
      if (this.state.isPlaying) this.scheduleNextFrame();
    }, adjusted);
  }

  /** 清理定时器 */
  private clearTimer(): void {
    if (this.playTimer) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
  }

  // ============ 导出格式实现 ============

  private exportAsJson(replay: ReplaySession, includeMetadata: boolean): string {
    const data = includeMetadata ? replay : { ...replay, metadata: undefined };
    return JSON.stringify(data, null, 2);
  }

  private exportAsHtml(replay: ReplaySession, includeMetadata: boolean): string {
    const meta = replay.metadata;
    const framesHtml = replay.frames
      .map((f, i) => {
        const time = new Date(replay.startedAt + f.timestamp).toISOString();
        const highlight = f.highlight ? ` highlight-${f.highlight}` : '';
        let body = '';
        switch (f.type) {
          case 'message': {
            const d = f.data as MessageFrameData;
            body = `<div class="role">${this.escapeHtml(d.role)}</div><div class="content">${this.escapeHtml(d.content)}</div>`;
            break;
          }
          case 'tool-call': {
            const d = f.data as ToolCallFrameData;
            body = `<div class="tool">🔧 ${this.escapeHtml(d.toolName)} (${d.durationMs}ms)</div><pre>${this.escapeHtml(JSON.stringify(d.args, null, 2))}</pre>`;
            if (d.result) body += `<pre class="result">${this.escapeHtml(JSON.stringify(d.result, null, 2))}</pre>`;
            if (d.error) body += `<div class="error">❌ ${this.escapeHtml(d.error)}</div>`;
            break;
          }
          case 'thinking': {
            const d = f.data as ThinkingFrameData;
            body = `<div class="thinking">💭 ${this.escapeHtml(d.content)}</div>`;
            break;
          }
          case 'workflow-stage': {
            const d = f.data as WorkflowStageFrameData;
            body = `<div class="stage">📍 ${this.escapeHtml(d.stage)} (${d.status})</div>`;
            break;
          }
          case 'user-action': {
            const d = f.data as UserActionFrameData;
            body = `<div class="action">👆 ${this.escapeHtml(d.action)}</div>`;
            break;
          }
        }
        return `<div class="frame${highlight}" id="frame-${i}"><div class="meta">#${i + 1} · ${time} · ${f.type}</div>${body}</div>`;
      })
      .join('\n');

    const metaHtml = includeMetadata
      ? `<div class="meta-block">
        <h2>元数据</h2>
        <ul>
          <li>总消息数: ${meta.totalMessages}</li>
          <li>工具调用: ${meta.totalToolCalls}</li>
          <li>错误数: ${meta.totalErrors}</li>
          <li>思考数: ${meta.totalThinking}</li>
          <li>用户操作: ${meta.totalUserActions}</li>
          <li>时长: ${(meta.duration / 1000).toFixed(2)}s</li>
          <li>模型: ${meta.models.join(', ') || '-'}</li>
          <li>工具: ${meta.tools.join(', ') || '-'}</li>
        </ul>
      </div>`
      : '';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>${this.escapeHtml(replay.title)}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #0f172a; color: #e2e8f0; }
h1 { color: #38bdf8; }
h2 { color: #a78bfa; }
.meta-block { background: #1e293b; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
.frame { background: #1e293b; padding: 12px; border-radius: 6px; margin-bottom: 10px; border-left: 3px solid #475569; }
.frame.highlight-error { border-left-color: #f43f5e; }
.frame.highlight-user-action { border-left-color: #facc15; }
.frame.highlight-tool-call { border-left-color: #22d3ee; }
.frame.highlight-stage-change { border-left-color: #a78bfa; }
.meta { font-size: 12px; color: #94a3b8; margin-bottom: 6px; }
.role { font-weight: 600; color: #38bdf8; margin-bottom: 4px; }
.content { white-space: pre-wrap; }
.tool { color: #22d3ee; font-weight: 500; }
.thinking { color: #a78bfa; font-style: italic; }
.stage { color: #facc15; }
.action { color: #facc15; }
pre { background: #0f172a; padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 12px; }
.error { color: #f43f5e; }
</style>
</head>
<body>
<h1>${this.escapeHtml(replay.title)}</h1>
<p>Session ID: ${replay.sessionId} · 回放 ID: ${replay.replayId}</p>
${metaHtml}
<h2>回放帧 (${replay.frames.length})</h2>
${framesHtml}
</body>
</html>`;
  }

  private exportAsMarkdown(replay: ReplaySession, includeMetadata: boolean): string {
    const lines: string[] = [];
    lines.push(`# ${replay.title}`);
    lines.push('');
    lines.push(`- Session ID: \`${replay.sessionId}\``);
    lines.push(`- 回放 ID: \`${replay.replayId}\``);
    lines.push(`- 开始时间: ${new Date(replay.startedAt).toISOString()}`);
    lines.push(`- 结束时间: ${new Date(replay.endedAt).toISOString()}`);
    lines.push('');

    if (includeMetadata) {
      const meta = replay.metadata;
      lines.push('## 元数据');
      lines.push('');
      lines.push(`- 总消息数: ${meta.totalMessages}`);
      lines.push(`- 工具调用: ${meta.totalToolCalls}`);
      lines.push(`- 错误数: ${meta.totalErrors}`);
      lines.push(`- 思考数: ${meta.totalThinking}`);
      lines.push(`- 用户操作: ${meta.totalUserActions}`);
      lines.push(`- 时长: ${(meta.duration / 1000).toFixed(2)}s`);
      lines.push(`- 模型: ${meta.models.join(', ') || '-'}`);
      lines.push(`- 工具: ${meta.tools.join(', ') || '-'}`);
      lines.push('');
    }

    lines.push(`## 回放帧 (${replay.frames.length})`);
    lines.push('');
    replay.frames.forEach((f, i) => {
      const time = new Date(replay.startedAt + f.timestamp).toISOString();
      const badge = f.highlight ? ` **[${f.highlight}]**` : '';
      lines.push(`### #${i + 1} · ${time} · ${f.type}${badge}`);
      lines.push('');
      switch (f.type) {
        case 'message': {
          const d = f.data as MessageFrameData;
          lines.push(`**${d.role}**${d.model ? ` (${d.model})` : ''}:`);
          lines.push('');
          lines.push(d.content);
          break;
        }
        case 'tool-call': {
          const d = f.data as ToolCallFrameData;
          lines.push(`🔧 **${d.toolName}** (${d.durationMs}ms)`);
          lines.push('');
          lines.push('**参数**:');
          lines.push('```json');
          lines.push(JSON.stringify(d.args, null, 2));
          lines.push('```');
          if (d.result) {
            lines.push('**结果**:');
            lines.push('```json');
            lines.push(JSON.stringify(d.result, null, 2));
            lines.push('```');
          }
          if (d.error) {
            lines.push(`**错误**: ${d.error}`);
          }
          break;
        }
        case 'thinking': {
          const d = f.data as ThinkingFrameData;
          lines.push(`💭 ${d.content}`);
          break;
        }
        case 'workflow-stage': {
          const d = f.data as WorkflowStageFrameData;
          lines.push(`📍 ${d.stage} (${d.status})`);
          break;
        }
        case 'user-action': {
          const d = f.data as UserActionFrameData;
          lines.push(`👆 ${d.action}`);
          break;
        }
      }
      lines.push('');
    });
    return lines.join('\n');
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

// ============ 单例 ============

let _instance: SessionReplayEngine | null = null;

/** 获取全局单例 */
export function getSessionReplayEngine(): SessionReplayEngine {
  if (!_instance) {
    _instance = new SessionReplayEngine();
  }
  return _instance;
}

/** 重置单例（测试用） */
export function resetSessionReplayEngine(): void {
  if (_instance) {
    _instance.stop();
  }
  _instance = null;
}
