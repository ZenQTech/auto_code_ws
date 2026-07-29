/**
 * # ============================================================
 * # 思考过程折叠组件 (v4.0.0 - Cycle 15 P1-10)
 * # ============================================================
 * # 核心作用：展示 Hermes 流式思考过程，支持：
 * #   1. 折叠/展开、思考中动画
 * #   2. 分阶段推理展示（4 阶段：分析/规划/编码/测试）
 * #   3. v4.0.0 阶段标签增强：
 * #      - 标题栏常驻阶段徽章（始终可见）
 * #      - 自动阶段检测（基于思考内容）
 * #      - 阶段切换动画
 * #      - 阶段时长统计
 * #      - 阶段历史时间线
 * # 运行流程：
 * #   1. 思考中：显示旋转动画图标 + 当前阶段徽章 + "思考中..."
 * #   2. 思考完成：显示"思考过程"标题 + 阶段徽章 + 展开/收起按钮
 * #   3. 默认折叠，用户可点击展开
 * #   4. 展开时显示：
 * #      - 4 阶段进度条（分析/规划/编码/测试）
 * #      - 当前阶段进度 + 百分比
 * #      - 阶段历史时间线
 * #      - 思考过程完整内容（按阶段分隔）
 * #   5. "干预"按钮：调用 onIntervene 回调暂停 AI
 * # 输入参数：
 * #   - content: string，思考内容
 * #   - isStreaming: boolean，是否正在流式接收
 * #   - stage?: ReasoningStage，当前推理阶段
 * #   - stageProgress?: number，0-1 进度值
 * #   - onIntervene?: () => void，干预回调
 * #   - autoDetectStage?: boolean，是否启用内容自动检测阶段（v4.0.0 新增）
 * # 输出结果：纯 UI 组件
 * # ============================================================
 * # 修改记录：
 * #   v1.0.0 - 2026-06-23：补充文件头注释；折叠展开过渡升级为 .animate-msg-enter
 * #   v2.0.0 - 2026-06-30：视觉升级对齐 Trae IDE solo 模式
 * #   v3.0.0 - 2026-07-24：Module D - D8 分步推理展示
 * #   v4.0.0 - 2026-07-29：Cycle 15 P1-10 阶段标签增强
 * #     - 标题栏常驻阶段徽章
 * #     - 集成 thinkingStageDetector 自动阶段检测
 * #     - 阶段切换过渡动画
 * #     - 阶段时长统计
 * #     - 阶段历史时间线视图
 * #     - 阶段高亮动效
 * # ============================================================
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  detectStage,
  resolveStage,
  type StageHistoryEntry,
} from '../utils/thinkingStageDetector';

/** 推理阶段枚举 */
export type ReasoningStage = 'analysis' | 'planning' | 'coding' | 'testing' | 'idle';

interface ThinkingBlockProps {
  content: string;
  isStreaming: boolean;
  /** 当前推理阶段 */
  stage?: ReasoningStage;
  /** 0-1 进度值 */
  stageProgress?: number;
  /** 干预回调：用户点击"干预"按钮时触发 */
  onIntervene?: () => void;
  /**
   * v4.0.0 新增：是否启用基于内容的自动阶段检测
   * 当显式 stage='idle' 或未提供时，自动从 content 推断阶段
   * 默认 true
   */
  autoDetectStage?: boolean;
  /**
   * v4.0.0 新增：是否显示阶段历史时间线
   * 展开时显示所有已完成的阶段及其耗时
   * 默认 true
   */
  showStageTimeline?: boolean;
}

/**
 * 推理阶段元数据
 * 描述：每个阶段的显示信息（标签、图标、颜色）
 */
const STAGE_META: Record<ReasoningStage, {
  label: string;
  shortLabel: string;
  icon: string;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  idle: {
    label: '待开始',
    shortLabel: '待',
    icon: '○',
    color: 'text-surface-500',
    bgColor: 'bg-surface-200/50',
    borderColor: 'border-surface-300',
  },
  analysis: {
    label: '需求分析',
    shortLabel: '分析',
    icon: '🔍',
    color: 'text-blue-300',
    bgColor: 'bg-blue-500/15',
    borderColor: 'border-blue-500/30',
  },
  planning: {
    label: '方案规划',
    shortLabel: '规划',
    icon: '📐',
    color: 'text-purple-300',
    bgColor: 'bg-purple-500/15',
    borderColor: 'border-purple-500/30',
  },
  coding: {
    label: '代码生成',
    shortLabel: '编码',
    icon: '⚡',
    color: 'text-emerald-300',
    bgColor: 'bg-emerald-500/15',
    borderColor: 'border-emerald-500/30',
  },
  testing: {
    label: '测试验证',
    shortLabel: '测试',
    icon: '✓',
    color: 'text-hermes-300',
    bgColor: 'bg-hermes-500/15',
    borderColor: 'border-hermes-500/30',
  },
};

/** 阶段显示顺序 */
const STAGE_ORDER: ReasoningStage[] = ['analysis', 'planning', 'coding', 'testing'];

/**
 * 思考过程折叠组件（Trae IDE solo 模式风格）
 * v4.0.0 阶段标签增强版
 */
export default function ThinkingBlock({
  content,
  isStreaming,
  stage = 'idle',
  stageProgress = 0,
  onIntervene,
  autoDetectStage = true,
  showStageTimeline = true,
}: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [previousStage, setPreviousStage] = useState<ReasoningStage>('idle');
  const [stageTransitionKey, setStageTransitionKey] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const stageStartTimeRef = useRef<number>(Date.now());
  const [stageDurations, setStageDurations] = useState<Record<Exclude<ReasoningStage, 'idle'>, number>>({
    analysis: 0,
    planning: 0,
    coding: 0,
    testing: 0,
  });

  // v4.0.0：自动检测阶段
  const detectedStage = useMemo<ReasoningStage>(() => {
    if (!autoDetectStage) return stage;
    if (stage && stage !== 'idle') return stage;
    return resolveStage(stage, content, stageProgress);
  }, [autoDetectStage, stage, content, stageProgress]);

  // v4.0.0：检测阶段历史
  const stageHistory = useMemo<StageHistoryEntry[]>(() => {
    if (!autoDetectStage) return [];
    return detectStage(content).history;
  }, [autoDetectStage, content]);

  // v4.0.0：阶段切换时记录持续时间 + 触发动画
  useEffect(() => {
    if (detectedStage !== previousStage && detectedStage !== 'idle') {
      const now = Date.now();
      const elapsed = now - stageStartTimeRef.current;
      if (previousStage !== 'idle') {
        setStageDurations((prev) => ({
          ...prev,
          [previousStage]: prev[previousStage] + elapsed,
        }));
      }
      stageStartTimeRef.current = now;
      setPreviousStage(detectedStage);
      setStageTransitionKey((k) => k + 1); // 触发动画 key
    }
  }, [detectedStage, previousStage]);

  // 思考完成时记录最后一个阶段的时长
  useEffect(() => {
    if (!isStreaming && previousStage !== 'idle') {
      const now = Date.now();
      const elapsed = now - stageStartTimeRef.current;
      setStageDurations((prev) => ({
        ...prev,
        [previousStage]: prev[previousStage] + elapsed,
      }));
      stageStartTimeRef.current = now;
    }
  }, [isStreaming, previousStage]);

  // 思考中时自动展开并滚动到底部
  useEffect(() => {
    if (isStreaming) {
      setExpanded(true);
    }
  }, [isStreaming]);

  // 思考中时内容自动滚动到底部
  useEffect(() => {
    if (isStreaming && expanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, isStreaming, expanded]);

  // 思考完成时自动折叠
  useEffect(() => {
    if (!isStreaming && content) {
      setExpanded(false);
    }
  }, [isStreaming, content]);

  if (!content && !isStreaming && stage === 'idle') return null;

  // 当前激活阶段元数据
  const currentStageMeta = STAGE_META[detectedStage] || STAGE_META.idle;
  // 阶段索引（用于计算"已完成阶段"）
  const currentStageIndex = STAGE_ORDER.indexOf(detectedStage);

  /**
   * v4.0.0：渲染阶段时间线（增强版）
   * 展示 4 个推理阶段 + 阶段耗时统计
   */
  const renderStageTimeline = () => {
    if (detectedStage === 'idle' && !isStreaming) return null;
    return (
      <div className="mb-3">
        {/* 阶段标签行 */}
        <div className="grid grid-cols-4 gap-1.5 mb-2">
          {STAGE_ORDER.map((s, idx) => {
            const meta = STAGE_META[s];
            const isPast = currentStageIndex > idx;
            const isCurrent = detectedStage === s;
            const duration = s !== 'idle' ? stageDurations[s] : 0;
            return (
              <div
                key={s}
                className={`relative flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-md transition-all duration-300 ${
                  isCurrent
                    ? `${meta.bgColor} ${meta.borderColor} border shadow-sm scale-105`
                    : isPast
                      ? 'bg-emerald-500/10 border border-emerald-500/20'
                      : 'bg-surface-200/30 border border-surface-300'
                }`}
                title={`${meta.label}${duration > 0 ? ` - 耗时 ${(duration / 1000).toFixed(1)}s` : ''}`}
              >
                {/* 阶段图标 / 状态 */}
                <span className={`text-sm transition-all ${
                  isCurrent ? meta.color : isPast ? 'text-emerald-400' : 'text-surface-500'
                }`}>
                  {isPast ? '✓' : isCurrent ? meta.icon : '○'}
                </span>
                {/* 阶段标签 */}
                <span className={`text-[10px] leading-tight text-center truncate w-full ${
                  isCurrent
                    ? `${meta.color} font-medium`
                    : isPast
                      ? 'text-emerald-300/70'
                      : 'text-surface-500'
                }`}>
                  {meta.shortLabel}
                </span>
                {/* v4.0.0：当前阶段脉冲指示器 */}
                {isCurrent && isStreaming && (
                  <span className="absolute top-0.5 right-0.5 flex h-1.5 w-1.5">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${meta.color.replace('text-', 'bg-')} opacity-75`} />
                    <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${meta.color.replace('text-', 'bg-')}`} />
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* 当前阶段进度条 */}
        {isStreaming && currentStageIndex >= 0 && (
          <div
            key={`progress-${stageTransitionKey}`}
            className="flex items-center gap-2 animate-msg-enter"
          >
            <span className={`text-[10px] flex-shrink-0 ${currentStageMeta.color}`}>
              {currentStageMeta.label}
            </span>
            <div className="flex-1 h-1 bg-surface-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ease-out bg-gradient-to-r ${
                  detectedStage === 'analysis' ? 'from-blue-500 to-blue-400' :
                  detectedStage === 'planning' ? 'from-purple-500 to-purple-400' :
                  detectedStage === 'coding' ? 'from-emerald-500 to-emerald-400' :
                  'from-hermes-500 to-hermes-400'
                }`}
                style={{ width: `${Math.max(5, Math.min(100, stageProgress * 100))}%` }}
              />
            </div>
            <span className={`text-[10px] flex-shrink-0 font-mono ${currentStageMeta.color}`}>
              {Math.round(stageProgress * 100)}%
            </span>
          </div>
        )}
      </div>
    );
  };

  /**
   * v4.0.0：渲染阶段历史（已完成的阶段时间线）
   */
  const renderStageHistory = () => {
    if (!showStageTimeline || stageHistory.length === 0) return null;
    return (
      <div className="mb-3 pt-2 border-t border-purple-500/10">
        <div className="text-[10px] text-purple-300/60 mb-1.5 flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          阶段历史
        </div>
        <div className="space-y-1">
          {stageHistory.map((entry, idx) => {
            const meta = STAGE_META[entry.stage];
            return (
              <div
                key={`${entry.stage}-${idx}`}
                className="flex items-start gap-2 text-[11px] group/history"
              >
                <span className={`${meta.color} flex-shrink-0 mt-0.5`}>{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className={`font-medium ${meta.color}`}>{meta.label}</div>
                  <div className="text-surface-400/70 truncate group-hover/history:whitespace-normal group-hover/history:overflow-visible">
                    {entry.summary}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  /**
   * 渲染"干预"按钮
   * 仅在流式接收中 + 有回调时显示
   */
  const renderInterveneButton = () => {
    if (!isStreaming || !onIntervene) return null;
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onIntervene();
        }}
        className="ml-auto px-2 py-0.5 text-[10px] font-medium rounded
                   bg-amber-500/15 hover:bg-amber-500/25
                   text-amber-300 border border-amber-500/30
                   transition-colors"
        title="干预：暂停 AI 思考"
      >
        ⏸ 干预
      </button>
    );
  };

  return (
    <div className="mb-3 ml-1 border-l-2 border-purple-500/40 pl-3">
      {/* 标题栏：含 v4.0.0 常驻阶段徽章 */}
      <div className="flex items-center gap-2 w-full group py-0.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm
                     transition-all duration-200 hover:translate-x-0.5
                     text-left flex-1 min-w-0"
          aria-expanded={expanded}
          aria-label={expanded ? '收起思考过程' : '展开思考过程'}
        >
          {/* 状态图标容器（圆形背景） */}
          <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0
            ${isStreaming ? 'bg-purple-500/20' : 'bg-purple-500/10'}`}>
            {isStreaming ? (
              <svg
                className="animate-spin w-3 h-3 text-purple-400"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            ) : (
              <svg
                className="w-3 h-3 text-purple-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
            )}
          </span>

          {/* v4.0.0 标题文字：含常驻阶段徽章 */}
          <span className="flex items-center gap-1.5 min-w-0">
            <span className={`font-medium flex-shrink-0 ${
              isStreaming ? 'text-purple-300' : 'text-purple-400/70'
            }`}>
              {isStreaming ? '思考中' : '思考过程'}
            </span>
            {detectedStage !== 'idle' && (
              <span
                key={`stage-badge-${stageTransitionKey}`}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium
                  animate-msg-enter
                  ${currentStageMeta.bgColor} ${currentStageMeta.color}
                  ${currentStageMeta.borderColor} border
                  ${isStreaming ? 'shadow-sm' : ''}`}
                title={`当前阶段: ${currentStageMeta.label}`}
                aria-label={`当前阶段: ${currentStageMeta.label}`}
              >
                <span className="text-[10px]">{currentStageMeta.icon}</span>
                <span className="whitespace-nowrap">{currentStageMeta.shortLabel}</span>
              </span>
            )}
          </span>

          {/* 展开/收起箭头 */}
          <svg
            className={`w-3.5 h-3.5 flex-shrink-0 transition-transform duration-300 text-purple-400/50 ${
              expanded ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* 干预按钮 */}
        {renderInterveneButton()}
      </div>

      {/* 展开内容 */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          expanded ? 'max-h-[40rem] opacity-100 mt-2' : 'max-h-0 opacity-0'
        }`}
      >
        <div
          className="bg-purple-500/5 border border-purple-500/15 rounded-lg p-3
                     text-sm text-purple-100/80 leading-relaxed
                     font-mono whitespace-pre-wrap overflow-y-auto"
        >
          {/* 阶段进度条 */}
          {renderStageTimeline()}

          {/* v4.0.0 阶段历史 */}
          {renderStageHistory()}

          {/* 思考内容 */}
          <div ref={contentRef} className="max-h-64 overflow-y-auto">
            {content || (isStreaming ? '...' : '')}
          </div>
        </div>
      </div>
    </div>
  );
}
