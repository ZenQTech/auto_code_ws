/**
 * # ============================================================
 * # useVoiceInput - 浏览器端 Web Speech API 语音识别 Hook
 * # ============================================================
 * # 核心作用：封装 Web Speech API 提供实时语音转文字能力
 * # 设计要点：
 * #   1. 复用浏览器原生 SpeechRecognition（webkit 前缀兼容）
 * #   2. 支持连续识别（continuous）+ 临时结果（interimResults）
 * #   3. 9 种语言：zh-CN / zh-HK / en-US / en-GB / ja-JP / ko-KR / es-ES / fr-FR / de-DE
 * #   4. 提供 start/stop/reset/error 完整生命周期
 * #   5. 不支持时降级到静默 noop
 * # 运行流程：
 * #   1. 组件调用 start() 启动识别
 * #   2. 浏览器回调 → 更新 transcript / interimTranscript
 * #   3. 组件调用 stop() 停止识别
 * #   4. 不支持时返回 supported=false
 * # 输入参数：options: { language, continuous, interimResults, onFinal }
 * # 输出结果：{ isListening, transcript, interimTranscript, start, stop, reset, error, supported }
 * # 对标：Trae SOLO VoiceInput + Web Speech API
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 69 G69-03 初次创建
 * # ============================================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================
// 类型定义
// ============================================================

export type VoiceLanguage =
  | 'zh-CN'
  | 'zh-HK'
  | 'en-US'
  | 'en-GB'
  | 'ja-JP'
  | 'ko-KR'
  | 'es-ES'
  | 'fr-FR'
  | 'de-DE';

export const SUPPORTED_LANGUAGES: Record<VoiceLanguage, string> = {
  'zh-CN': '中文（普通话）',
  'zh-HK': '中文（粤语）',
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
  'es-ES': 'Español',
  'fr-FR': 'Français',
  'de-DE': 'Deutsch',
};

export interface VoiceInputOptions {
  /** 识别语言，默认 zh-CN */
  language?: VoiceLanguage;
  /** 是否连续识别，默认 true */
  continuous?: boolean;
  /** 是否返回临时结果，默认 true */
  interimResults?: boolean;
  /** 最终结果回调 */
  onFinal?: (text: string) => void;
  /** 错误回调 */
  onError?: (error: string) => void;
  /** 启动时回调 */
  onStart?: () => void;
  /** 停止时回调 */
  onEnd?: () => void;
}

export interface VoiceInputState {
  /** 是否正在识别 */
  isListening: boolean;
  /** 最终结果（已提交） */
  transcript: string;
  /** 临时结果（未提交） */
  interimTranscript: string;
  /** 错误信息 */
  error: string | null;
  /** 当前语言 */
  language: VoiceLanguage;
  /** 浏览器是否支持 Web Speech API */
  supported: boolean;
  /** 操作函数 */
  start: () => void;
  stop: () => void;
  reset: () => void;
  /** 设置语言 */
  setLanguage: (lang: VoiceLanguage) => void;
}

// ============================================================
// 浏览器 API 类型（webkit + 标准）
// ============================================================

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: {
      transcript: string;
      confidence: number;
    };
    length: number;
  }>;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  onstart: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

// ============================================================
// 检测浏览器支持
// ============================================================

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.SpeechRecognition === 'function') {
    return w.SpeechRecognition as SpeechRecognitionConstructor;
  }
  if (typeof w.webkitSpeechRecognition === 'function') {
    return w.webkitSpeechRecognition as SpeechRecognitionConstructor;
  }
  return null;
}

// ============================================================
// Hook 实现
// ============================================================

export function useVoiceInput(options: VoiceInputOptions = {}): VoiceInputState {
  const {
    language: initialLanguage = 'zh-CN',
    continuous = true,
    interimResults = true,
    onFinal,
    onError,
    onStart,
    onEnd,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<VoiceLanguage>(initialLanguage);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onFinalRef = useRef(onFinal);
  const onErrorRef = useRef(onError);
  const onStartRef = useRef(onStart);
  const onEndRef = useRef(onEnd);

  // 同步 callback refs
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    onStartRef.current = onStart;
  }, [onStart]);
  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  // 检测支持
  const supported = getSpeechRecognitionCtor() !== null;

  // 创建/重置 recognition 实例
  const buildRecognition = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.continuous = continuous;
    rec.interimResults = interimResults;
    rec.lang = language;

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result || !result[0]) continue;
        const text = result[0].transcript;
        if (result.isFinal) {
          final += text;
        } else {
          interim += text;
        }
      }
      if (interim) {
        setInterimTranscript(interim);
      }
      if (final) {
        setTranscript((prev) => {
          const next = prev ? `${prev} ${final}` : final;
          return next;
        });
        setInterimTranscript('');
        onFinalRef.current?.(final);
      }
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      const errMsg = event.error || 'unknown';
      setError(errMsg);
      onErrorRef.current?.(errMsg);
    };

    rec.onend = () => {
      setIsListening(false);
      onEndRef.current?.();
    };

    rec.onstart = () => {
      setIsListening(true);
      onStartRef.current?.();
    };

    return rec;
  }, [continuous, interimResults, language]);

  // 启动识别
  const start = useCallback(() => {
    if (!supported) {
      const msg = 'Web Speech API is not supported in this browser';
      setError(msg);
      onErrorRef.current?.(msg);
      return;
    }
    try {
      // 清理之前的实例
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }
      const rec = buildRecognition();
      if (!rec) return;
      recognitionRef.current = rec;
      rec.start();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      onErrorRef.current?.(msg);
    }
  }, [supported, buildRecognition]);

  // 停止识别
  const stop = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
  }, []);

  // 重置转写
  const reset = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
    setError(null);
  }, []);

  // 清理
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  return {
    isListening,
    transcript,
    interimTranscript,
    error,
    language,
    supported,
    start,
    stop,
    reset,
    setLanguage,
  };
}

export default useVoiceInput;
