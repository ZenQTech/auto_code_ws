/**
 * # ============================================================
 * # VoiceInputAdapter - 语音输入适配器 (v1.0.0 Cycle 24 G24-03)
 * # ============================================================
 * # 核心作用：基于浏览器 Web Speech API 提供语音输入能力
 * # 运行流程：
 * #   1. 构造时检测 Web Speech API 支持
 * #   2. start() 启动 SpeechRecognition
 * #   3. 监听 onresult 累积转写文本
 * #   4. 监听 onerror / onend 状态变化
 * #   5. stop() 主动停止
 * #   6. abort() 强制中断
 * # 输入参数：updateConfig({lang, continuous, interimResults, ...})
 * # 输出结果：实时转写 + 事件流
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 24 G24-03 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/**
 * 语音命令动作
 */
export type VoiceCommandAction = 'send' | 'clear' | 'stop' | 'undo' | 'newline' | 'custom';

/**
 * 语音命令
 */
export interface VoiceCommand {
  pattern: string | RegExp;
  action: VoiceCommandAction;
  description: string;
  callback?: (matched: string) => void;
}

/**
 * 语音输入配置
 */
export interface VoiceInputConfig {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  silenceTimeoutMs: number;
  commandShortcuts: Record<string, VoiceCommand>;
  autoStopOnSilence: boolean;
}

/**
 * 语音识别状态
 */
export interface VoiceRecognitionState {
  isListening: boolean;
  isSupported: boolean;
  transcript: string;
  interimTranscript: string;
  confidence: number;
  language: string;
  error: string | null;
  startedAt: number | null;
  durationMs: number;
  commandMatched: string | null;
}

/**
 * 事件类型
 */
export type VoiceEventType =
  | 'start'
  | 'result'
  | 'interim'
  | 'end'
  | 'error'
  | 'command'
  | 'silence'
  | 'config-updated'
  | 'engine-reset';

export type VoiceEventHandler = (payload: any) => void;

/**
 * 默认配置
 */
export const DEFAULT_VOICE_CONFIG: VoiceInputConfig = {
  lang: 'zh-CN',
  continuous: true,
  interimResults: true,
  maxAlternatives: 1,
  silenceTimeoutMs: 2000,
  autoStopOnSilence: true,
  commandShortcuts: {
    send: { pattern: /(发送|submit|send)/i, action: 'send', description: '提交当前输入' },
    stop: { pattern: /(停止|stop|停止录音)/i, action: 'stop', description: '停止语音输入' },
    clear: { pattern: /(清空|清除|clear|delete all)/i, action: 'clear', description: '清空输入' },
    undo: { pattern: /(撤销|undo|回退)/i, action: 'undo', description: '撤销上一步' },
    newline: { pattern: /(换行|newline|new line)/i, action: 'newline', description: '插入换行' },
  },
};

export const SUPPORTED_LANGUAGES = [
  { code: 'zh-CN', label: '中文（简体）' },
  { code: 'zh-TW', label: '中文（繁体）' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'ja-JP', label: '日本語' },
  { code: 'ko-KR', label: '한국어' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'de-DE', label: 'Deutsch' },
];

// ============ 事件总线 ============

export class VoiceEventBus {
  private listeners: Map<VoiceEventType, Set<VoiceEventHandler>> = new Map();

  on(type: VoiceEventType, handler: VoiceEventHandler): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
    return () => this.listeners.get(type)?.delete(handler);
  }

  emit(type: VoiceEventType, payload: any): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        // swallow
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }

  listenerCount(type?: VoiceEventType): number {
    if (type) return this.listeners.get(type)?.size ?? 0;
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }
}

// ============ 类型接口（Web Speech API 简化） ============

export interface SpeechRecognitionResult {
  readonly length: number;
  item(i: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

export interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognitionResultList {
  readonly length: number;
  item(i: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

export interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

export interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

export interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionEvent) => any) | null;
  onerror: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionErrorEvent) => any) | null;
  onend: ((this: SpeechRecognitionInstance, ev: Event) => any) | null;
  onstart: ((this: SpeechRecognitionInstance, ev: Event) => any) | null;
}

export interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

// ============ 适配器 ============

export class VoiceInputAdapter {
  private config: VoiceInputConfig;
  private state: VoiceRecognitionState;
  private eventBus: VoiceEventBus = new VoiceEventBus();
  private recognition: SpeechRecognitionInstance | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private speechRecognitionCtor: SpeechRecognitionConstructor | null = null;

  constructor(
    config?: Partial<VoiceInputConfig>,
    speechRecognitionCtor?: SpeechRecognitionConstructor
  ) {
    this.config = { ...DEFAULT_VOICE_CONFIG, ...(config || {}) };
    if (config?.commandShortcuts) {
      this.config.commandShortcuts = {
        ...DEFAULT_VOICE_CONFIG.commandShortcuts,
        ...config.commandShortcuts,
      };
    }
    this.speechRecognitionCtor = speechRecognitionCtor || this.detectSpeechRecognition();

    this.state = {
      isListening: false,
      isSupported: this.speechRecognitionCtor !== null,
      transcript: '',
      interimTranscript: '',
      confidence: 0,
      language: this.config.lang,
      error: null,
      startedAt: null,
      durationMs: 0,
      commandMatched: null,
    };
  }

  // ============== 浏览器检测 ==============

  private detectSpeechRecognition(): SpeechRecognitionConstructor | null {
    if (typeof window === 'undefined') return null;
    const w = window as any;
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
  }

  // ============== 状态查询 ==============

  isSupported(): boolean {
    return this.state.isSupported;
  }

  getState(): VoiceRecognitionState {
    if (this.state.isListening && this.state.startedAt) {
      this.state.durationMs = Date.now() - this.state.startedAt;
    }
    return { ...this.state };
  }

  getConfig(): VoiceInputConfig {
    return {
      ...this.config,
      commandShortcuts: { ...this.config.commandShortcuts },
    };
  }

  // ============== 控制 ==============

  async start(): Promise<void> {
    if (this.state.isListening) return;
    if (!this.state.isSupported) {
      this.state.error = '当前浏览器不支持语音识别';
      this.eventBus.emit('error', { error: this.state.error });
      throw new Error(this.state.error);
    }

    try {
      const Ctor = this.speechRecognitionCtor!;
      this.recognition = new Ctor();
      this.recognition.lang = this.config.lang;
      this.recognition.continuous = this.config.continuous;
      this.recognition.interimResults = this.config.interimResults;
      this.recognition.maxAlternatives = this.config.maxAlternatives;

      this.recognition.onstart = () => this.handleStart();
      this.recognition.onresult = (ev) => this.handleResult(ev);
      this.recognition.onerror = (ev) => this.handleError(ev);
      this.recognition.onend = () => this.handleEnd();

      this.recognition.start();
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : '启动语音识别失败';
      this.eventBus.emit('error', { error: this.state.error });
      throw err;
    }
  }

  stop(): void {
    if (!this.recognition) return;
    try {
      this.recognition.stop();
    } catch {
      // ignore
    }
  }

  abort(): void {
    if (!this.recognition) return;
    try {
      this.recognition.abort();
    } catch {
      // ignore
    }
    this.clearSilenceTimer();
    this.state.isListening = false;
    this.state.startedAt = null;
    this.state.interimTranscript = '';
    this.eventBus.emit('end', { aborted: true });
  }

  reset(): void {
    this.abort();
    this.state.transcript = '';
    this.state.interimTranscript = '';
    this.state.confidence = 0;
    this.state.error = null;
    this.state.durationMs = 0;
    this.state.commandMatched = null;
    this.eventBus.emit('engine-reset', {});
  }

  // ============== 内部回调 ==============

  private handleStart(): void {
    this.state.isListening = true;
    this.state.startedAt = Date.now();
    this.state.error = null;
    this.state.commandMatched = null;
    this.eventBus.emit('start', { timestamp: this.state.startedAt });
    this.resetSilenceTimer();
  }

  private handleResult(ev: SpeechRecognitionEvent): void {
    let interim = '';
    let finalText = '';
    let maxConfidence = 0;
    let isFinal = false;

    for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
      const result = ev.results[i];
      const alt = result[0];
      if (result.isFinal) {
        finalText += alt.transcript;
        maxConfidence = Math.max(maxConfidence, alt.confidence);
        isFinal = true;
      } else {
        interim += alt.transcript;
        maxConfidence = Math.max(maxConfidence, alt.confidence);
      }
    }

    if (finalText) {
      this.state.transcript = (this.state.transcript + ' ' + finalText).trim();
      this.state.confidence = maxConfidence;
      this.checkCommands(this.state.transcript);
      this.eventBus.emit('result', { transcript: this.state.transcript, isFinal: true, confidence: maxConfidence });
    }

    if (interim) {
      this.state.interimTranscript = interim;
      this.eventBus.emit('interim', { interim });
    }

    this.resetSilenceTimer();

    if (isFinal && !this.config.continuous) {
      this.stop();
    }
  }

  private handleError(ev: SpeechRecognitionErrorEvent): void {
    this.state.error = ev.error;
    this.state.isListening = false;
    this.clearSilenceTimer();
    this.eventBus.emit('error', { error: ev.error, message: ev.message });
  }

  private handleEnd(): void {
    this.state.isListening = false;
    this.state.interimTranscript = '';
    this.clearSilenceTimer();
    this.eventBus.emit('end', { timestamp: Date.now() });
  }

  // ============== 静音检测 ==============

  private resetSilenceTimer(): void {
    this.clearSilenceTimer();
    if (!this.config.autoStopOnSilence) return;
    this.silenceTimer = setTimeout(() => {
      this.eventBus.emit('silence', { durationMs: this.config.silenceTimeoutMs });
      this.stop();
    }, this.config.silenceTimeoutMs);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  // ============== 命令匹配 ==============

  private checkCommands(text: string): void {
    for (const [name, command] of Object.entries(this.config.commandShortcuts)) {
      const pattern = command.pattern;
      const matches = typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
      if (matches) {
        this.state.commandMatched = name;
        this.eventBus.emit('command', { name, command, text });
        if (command.callback) {
          try {
            command.callback(text);
          } catch {
            // swallow
          }
        }
        // 单次识别只触发一次
        break;
      }
    }
  }

  // ============== 配置管理 ==============

  updateConfig(patch: Partial<VoiceInputConfig>): void {
    this.config = { ...this.config, ...patch };
    if (patch.commandShortcuts) {
      this.config.commandShortcuts = {
        ...this.config.commandShortcuts,
        ...patch.commandShortcuts,
      };
    }
    this.state.language = this.config.lang;
    this.eventBus.emit('config-updated', { config: this.config });
  }

  setLanguage(lang: string): void {
    this.updateConfig({ lang });
  }

  addCommand(name: string, command: VoiceCommand): void {
    this.config.commandShortcuts[name] = command;
    this.eventBus.emit('config-updated', { config: this.config });
  }

  removeCommand(name: string): boolean {
    if (name in this.config.commandShortcuts) {
      delete this.config.commandShortcuts[name];
      this.eventBus.emit('config-updated', { config: this.config });
      return true;
    }
    return false;
  }

  // ============== 事件 ==============

  on(type: VoiceEventType, handler: VoiceEventHandler): () => void {
    return this.eventBus.on(type, handler);
  }

  // ============== 销毁 ==============

  destroy(): void {
    this.abort();
    this.eventBus.clear();
  }
}

// ============ 单例 ============

let _instance: VoiceInputAdapter | null = null;

export function getVoiceInputAdapter(
  config?: Partial<VoiceInputConfig>,
  speechRecognitionCtor?: SpeechRecognitionConstructor
): VoiceInputAdapter {
  if (!_instance) {
    _instance = new VoiceInputAdapter(config, speechRecognitionCtor);
  }
  return _instance;
}

export function resetVoiceInputAdapter(): void {
  if (_instance) {
    _instance.destroy();
    _instance = null;
  }
}
