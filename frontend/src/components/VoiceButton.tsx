/**
 * # ============================================================
 * # VoiceButton - 语音输入按钮 (v1.0.0 Cycle 24 G24-03)
 * # ============================================================
 * # 核心作用：麦克风按钮 + 实时转写气泡
 * # 主要功能：
 * #   1. 三态：默认 / 监听中（脉冲动画）/ 处理中
 * #   2. 实时显示转写气泡
 * #   3. 切换语言下拉
 * #   4. 命令帮助（长按或点击 ?）
 * #   5. 错误提示
 * #   6. 不支持时自动隐藏
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 24 G24-03 初次创建
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
  defaultLang = 'zh-CN',
  showBubble = true,
  label,
}: VoiceButtonProps) {
  const adapter = useMemo(() => getVoiceInputAdapter({ lang: defaultLang }), [defaultLang]);
  const [state, setState] = useState<VoiceRecognitionState>(adapter.getState());
  const [showHelp, setShowHelp] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const lastTranscriptRef = useRef<string>('');
  const langMenuRef = useRef<HTMLDivElement | null>(null);

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
      adapter.on('error', (p) => { refresh(); onError?.(p.error); }),
      adapter.on('command', (p) => { refresh(); onCommand?.(p.name, p.text); }),
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

  const handleClick = useCallback(async () => {
    if (!adapter.isSupported()) {
      onError?.('当前浏览器不支持语音识别');
      return;
    }
    if (state.isListening) {
      adapter.stop();
    } else {
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
      setShowLangMenu(false);
    },
    [adapter]
  );

  if (!adapter.isSupported()) {
    return null; // 不支持时自动隐藏
  }

  const sizeClass = {
    sm: 'w-7 h-7 text-sm',
    md: 'w-9 h-9 text-base',
    lg: 'w-11 h-11 text-lg',
  }[size];

  return (
    <div className={`relative inline-flex items-center gap-1 ${className}`}>
      {/* 麦克风按钮 */}
      <button
        type="button"
        onClick={handleClick}
        data-testid="voice-button"
        title={state.isListening ? '停止语音输入' : '开始语音输入'}
        className={[
          sizeClass,
          'rounded-full flex items-center justify-center transition relative',
          state.isListening
            ? 'bg-rose-500 text-white animate-pulse'
            : 'bg-surface-800 text-slate-300 hover:bg-surface-700 border border-surface-700',
        ].join(' ')}
        aria-label={state.isListening ? '停止' : '开始语音输入'}
      >
        <span aria-hidden="true">
          {state.isListening ? '🔴' : '🎙️'}
        </span>
        {label && <span className="ml-1 text-xs">{label}</span>}
      </button>

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
            className="absolute right-0 top-full mt-1 z-30 bg-surface-800 border border-surface-700 rounded shadow-lg min-w-[140px] max-h-60 overflow-y-auto"
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

      {/* 实时转写气泡 */}
      {showBubble && state.isListening && (state.transcript || state.interimTranscript) && (
        <div
          data-testid="voice-bubble"
          className="absolute bottom-full mb-2 left-0 z-20 max-w-xs bg-surface-900/95 border border-rose-500/30 rounded-lg shadow-lg p-2 text-xs text-slate-200 animate-in fade-in slide-in-from-bottom-1"
        >
          <div className="text-[10px] text-rose-300 mb-1">🎙️ 正在识别...</div>
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
          className="absolute bottom-full mb-2 left-0 z-20 max-w-xs bg-rose-500/10 border border-rose-500/30 rounded p-2 text-xs text-rose-200"
        >
          {state.error}
        </div>
      )}

      {/* 命令帮助 */}
      {showHelp && (
        <div
          data-testid="voice-help-panel"
          className="absolute right-0 top-full mt-1 z-30 bg-surface-900 border border-surface-700 rounded shadow-lg p-3 min-w-[260px]"
        >
          <div className="text-xs text-white mb-2 font-medium">语音命令</div>
          <ul className="space-y-1">
            {Object.entries(adapter.getConfig().commandShortcuts).map(([name, cmd]) => (
              <li key={name} className="flex justify-between text-[11px]">
                <span className="text-amber-300">{name}</span>
                <span className="text-slate-400">{cmd.description}</span>
              </li>
            ))}
          </ul>
          <div className="text-[10px] text-slate-500 mt-2">
            提示：说"停止"结束录音，"发送"提交文本
          </div>
        </div>
      )}
    </div>
  );
}

export default VoiceButton;
