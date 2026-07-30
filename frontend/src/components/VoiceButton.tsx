/**
 * # ============================================================
 * # VoiceButton - 语音输入按钮 (v1.1.0 Cycle 24 P2-2)
 * # ============================================================
 * # 核心作用：麦克风按钮 + 实时转写气泡
 * # 主要功能：
 * #   1. 三态：默认 / 监听中（脉冲动画 + 录音时长）/ 处理中
 * #   2. 实时显示转写气泡
 * #   3. 切换语言下拉
 * #   4. 命令帮助（点击 ? 按钮）
 * #   5. 错误提示与自动重试
 * #   6. 不支持时自动隐藏
 * #   7. 键盘快捷键 Cmd/Ctrl+Shift+V 切换
 * #   8. 语言偏好持久化 + 录音时长显示 + 命令反馈动画
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 24 G24-03 初次创建
 * #   - 2026-07-30 | v1.1.0 | P2-2 UI/UX 一致性增强
 * # ============================================================
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  getVoiceInputAdapter,
  SUPPORTED_LANGUAGES,
  type VoiceRecognitionState,
} from '../utils/voiceInputAdapter';

interface VoiceButtonProps {
  /** 转写文本变化回调 */
  onTranscriptChange?: (text: string, isFinal: boolean) => void;
  /** 完整转写完成时回调（识别结束） */
  onFinalTranscript?: (text: string) => void;
  /** 命令触发回调 */
  onCommand?: (name: string, text: string) => void;
  /** 错误回调 */
  onError?: (error: string) => void;
  /** 监听开始回调 */
  onListenStart?: () => void;
  /** 监听停止回调 */
  onListenEnd?: () => void;
  /** 大小 */
  size?: 'sm' | 'md' | 'lg';
  /** 类名 */
  className?: string;
  /** 默认语言 */
  defaultLang?: string;
  /** 显示转写气泡 */
  showBubble?: boolean;
  /** 自定义按钮 label */
  label?: string;
  /** 持久化 storage key */
  storageKey?: string;
  /** 启用键盘快捷键（Cmd/Ctrl+Shift+V） */
  enableShortcut?: boolean;
  /** 自动重试次数 */
  autoRetryCount?: number;
}

const STORAGE_KEY_DEFAULT = 'hermes.voiceButton';

function safeGet<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

/** 格式化录音时长 */
function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

export function VoiceButton({
  onTranscriptChange,
  onFinalTranscript,
  onCommand,
  onError,
  onListenStart,
  onListenEnd,
  size = 'md',
  className = '',
  defaultLang,
  showBubble = true,
  label,
  storageKey = STORAGE_KEY_DEFAULT,
  enableShortcut = true,
  autoRetryCount = 1,
}: VoiceButtonProps) {
  // 恢复语言偏好
  const initialLang = useMemo(() => {
    if (defaultLang) return defaultLang;
    return safeGet<string>(storageKey, 'zh-CN');
  }, [defaultLang, storageKey]);

  const adapter = useMemo(() => getVoiceInputAdapter({ lang: initialLang }), [initialLang]);
  const [state, setState] = useState<VoiceRecognitionState>(adapter.getState());
  const [showHelp, setShowHelp] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [commandFlash, setCommandFlash] = useState<{ name: string; ts: number } | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [tick, setTick] = useState(0);
  const lastTranscriptRef = useRef<string>('');
  const langMenuRef = useRef<HTMLDivElement | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    setState(adapter.getState());
  }, [adapter]);

  useEffect(() => {
    if (!adapter.isSupported()) return;
    const offs = [
      adapter.on('start', () => { refresh(); onListenStart?.(); }),
      adapter.on('interim', (p) => { refresh(); onTranscriptChange?.(p.interim, false); }),
      adapter.on('result', (p) => {
        refresh();
        onTranscriptChange?.(p.transcript, true);
        lastTranscriptRef.current = p.transcript;
      }),
      adapter.on('end', () => {
        refresh();
        if (lastTranscriptRef.current) onFinalTranscript?.(lastTranscriptRef.current);
        onListenEnd?.();
      }),
      adapter.on('error', (p) => {
        refresh();
        onError?.(p.error);
      }),
      adapter.on('command', (p) => {
        refresh();
        setCommandFlash({ name: p.name, ts: Date.now() });
        // 命令反馈动画 1.5s 后清除
        setTimeout(() => setCommandFlash((cur) => (cur && cur.ts === p.ts ? null : cur)), 1500);
        onCommand?.(p.name, p.text);
      }),
      adapter.on('config-updated', () => { refresh(); }),
    ];
    return () => { offs.forEach((off) => off()); };
  }, [adapter, refresh, onTranscriptChange, onFinalTranscript, onError, onCommand, onListenStart, onListenEnd]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setShowLangMenu(false);
      }
    };
    if (showLangMenu) {
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }
  }, [showLangMenu]);

  // 录音中每秒更新一次时长
  useEffect(() => {
    if (!state.isListening) return;
    const interval = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(interval);
  }, [state.isListening]);

  // 命令反馈动画自动清除
  useEffect(() => {
    if (!commandFlash) return;
    const t = setTimeout(() => setCommandFlash(null), 1500);
    return () => clearTimeout(t);
  }, [commandFlash]);

  // 错误提示自动清除
  useEffect(() => {
    if (!state.error) return;
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => {
      // 不直接清 state.error，状态由 adapter 自身管理
    }, 4000);
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, [state.error]);

  // 自动重试
  useEffect(() => {
    if (!state.error || retryAttempt >= autoRetryCount) return;
    if (state.isListening) return;
    // 简单的网络错误或瞬时错误才重试
    const retryable = ['network', 'aborted', 'no-speech'];
    if (!retryable.some((e) => state.error?.includes(e))) return;
    const t = setTimeout(() => {
      setRetryAttempt((c) => c + 1);
      adapter.start().catch(() => {
        // 静默失败
      });
    }, 800);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.error, retryAttempt, autoRetryCount]);

  const handleClick = useCallback(async () => {
    if (!adapter.isSupported()) {
      onError?.('当前浏览器不支持语音识别');
      return;
    }
    if (state.isListening) {
      adapter.stop();
    } else {
      setRetryAttempt(0);
      try {
        await adapter.start();
      } catch (err) {
        onError?.(err instanceof Error ? err.message : '启动失败');
      }
    }
  }, [adapter, state.isListening, onError]);

  const handleLanguageChange = useCallback(
    (lang: string) => {
      adapter.setLanguage(lang);
      safeSet(storageKey, lang);
      setShowLangMenu(false);
    },
    [adapter, storageKey]
  );

  // 键盘快捷键 Cmd/Ctrl+Shift+V
  useEffect(() => {
    if (!enableShortcut || !adapter.isSupported()) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        e.preventDefault();
        handleClick();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [enableShortcut, adapter, handleClick]);

  if (!adapter.isSupported()) {
    return null; // 不支持时自动隐藏
  }

  const sizeClass = {
    sm: 'w-7 h-7 text-sm',
    md: 'w-9 h-9 text-base',
    lg: 'w-11 h-11 text-lg',
  }[size];

  // 计算当前录音时长（避免未使用的 tick 警告）
  const currentDuration = state.isListening && state.startedAt
    ? Date.now() - state.startedAt
    : state.durationMs;
  // 显式使用 tick 以触发重渲染
  void tick;

  return (
    <div className={`relative inline-flex items-center gap-1 ${className}`} data-testid="voice-container">
      {/* 麦克风按钮 + 脉冲波纹 */}
      <div className="relative">
        {/* 录音中脉冲环 */}
        {state.isListening && (
          <>
            <span
              data-testid="voice-pulse-ring-1"
              className="absolute inset-0 rounded-full bg-rose-500/30 animate-ping"
              style={{ animationDuration: '1.5s' }}
            />
            <span
              data-testid="voice-pulse-ring-2"
              className="absolute inset-0 rounded-full bg-rose-500/20 animate-ping"
              style={{ animationDuration: '2.5s', animationDelay: '0.5s' }}
            />
          </>
        )}
        <button
          type="button"
          onClick={handleClick}
          data-testid="voice-button"
          title={state.isListening ? '停止语音输入' : '开始语音输入 (Cmd/Ctrl+Shift+V)'}
          className={[
            sizeClass,
            'rounded-full flex items-center justify-center transition relative z-10',
            state.isListening
              ? 'bg-rose-500 text-white animate-pulse'
              : 'bg-surface-800 text-slate-300 hover:bg-surface-700 border border-surface-700',
            commandFlash ? 'ring-2 ring-amber-400' : '',
          ].join(' ')}
          aria-label={state.isListening ? '停止' : '开始语音输入'}
          aria-pressed={state.isListening}
        >
          <span aria-hidden="true">
            {state.isListening ? '🔴' : '🎙️'}
          </span>
          {label && <span className="ml-1 text-xs">{label}</span>}
        </button>
        {/* 录音时长标签 */}
        {state.isListening && (
          <span
            data-testid="voice-duration"
            className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] text-rose-300 font-mono whitespace-nowrap"
          >
            {formatDuration(currentDuration)}
          </span>
        )}
      </div>

      {/* 语言切换 */}
      <div className="relative" ref={langMenuRef}>
        <button
          type="button"
          onClick={() => setShowLangMenu(!showLangMenu)}
          data-testid="voice-lang"
          title="切换语言"
          className="px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-white border border-surface-700 rounded bg-surface-800"
        >
          {state.language}
        </button>
        {showLangMenu && (
          <div
            data-testid="voice-lang-menu"
            className="absolute right-0 top-full mt-1 z-30 bg-surface-800 border border-surface-700 rounded shadow-lg min-w-[140px] max-h-60 overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-200"
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <button
                key={l.code}
                onClick={() => handleLanguageChange(l.code)}
                data-testid={`voice-lang-${l.code}`}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-700 ${
                  state.language === l.code ? 'bg-primary-500/20 text-primary-200' : 'text-slate-200'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 帮助按钮 */}
      <button
        type="button"
        onClick={() => setShowHelp(!showHelp)}
        data-testid="voice-help"
        title="语音命令帮助"
        className="w-5 h-5 text-[10px] text-slate-500 hover:text-white border border-surface-700 rounded-full bg-surface-800"
      >
        ?
      </button>

      {/* 命令反馈动画 */}
      {commandFlash && (
        <div
          data-testid="voice-command-flash"
          className="absolute top-full mt-2 left-0 z-20 px-2 py-1 bg-amber-500/20 border border-amber-500/50 rounded text-[10px] text-amber-200 animate-in fade-in slide-in-from-top-1 duration-200"
        >
          ⚡ {commandFlash.name}
        </div>
      )}

      {/* 实时转写气泡 */}
      {showBubble && state.isListening && (state.transcript || state.interimTranscript) && (
        <div
          data-testid="voice-bubble"
          className="absolute bottom-full mb-2 left-0 z-20 max-w-xs bg-surface-900/95 border border-rose-500/30 rounded-lg shadow-lg p-2 text-xs text-slate-200 animate-in fade-in slide-in-from-bottom-1"
        >
          <div className="text-[10px] text-rose-300 mb-1 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse" />
            🎙️ 正在识别...
            <span className="ml-auto text-slate-500">{formatDuration(currentDuration)}</span>
          </div>
          {state.transcript && <div className="mb-1">{state.transcript}</div>}
          {state.interimTranscript && (
            <div className="text-slate-400 italic">{state.interimTranscript}</div>
          )}
          {state.commandMatched && (
            <div className="mt-1 text-amber-300 text-[10px]">命令: {state.commandMatched}</div>
          )}
        </div>
      )}

      {/* 错误提示气泡 */}
      {state.error && !state.isListening && (
        <div
          data-testid="voice-error"
          className="absolute bottom-full mb-2 left-0 z-20 max-w-xs bg-rose-500/10 border border-rose-500/30 rounded p-2 text-xs text-rose-200 animate-in fade-in slide-in-from-bottom-1"
        >
          <div className="flex items-start gap-2">
            <span className="flex-1">{state.error}</span>
            {autoRetryCount > 0 && retryAttempt < autoRetryCount && (
              <button
                onClick={handleClick}
                data-testid="voice-retry"
                className="px-1.5 py-0.5 bg-rose-500/30 hover:bg-rose-500/40 text-rose-100 text-[10px] rounded"
              >
                🔄 重试 {retryAttempt > 0 && `(${retryAttempt})`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 命令帮助 */}
      {showHelp && (
        <div
          data-testid="voice-help-panel"
          className="absolute right-0 top-full mt-1 z-30 bg-surface-900 border border-surface-700 rounded shadow-lg p-3 min-w-[260px] animate-in fade-in slide-in-from-top-1 duration-200"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-white font-medium">语音命令</span>
            <button
              onClick={() => setShowHelp(false)}
              data-testid="voice-help-close"
              className="text-slate-400 hover:text-white text-xs w-4 h-4"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
          <ul className="space-y-1">
            {Object.entries(adapter.getConfig().commandShortcuts).map(([name, cmd]) => (
              <li key={name} className="flex justify-between text-[11px]">
                <span className="text-amber-300">{name}</span>
                <span className="text-slate-400">{cmd.description}</span>
              </li>
            ))}
          </ul>
          <div className="text-[10px] text-slate-500 mt-2 pt-2 border-t border-surface-700">
            <div>提示：说"停止"结束录音，"发送"提交文本</div>
            <div className="mt-1">快捷键：<kbd className="px-1 bg-surface-800 border border-surface-700 rounded">⌘/Ctrl+Shift+V</kbd></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default VoiceButton;
