/**
 * # ============================================================
 * # 思考过程折叠组件
 * # ============================================================
 * # 核心作用：展示 Hermes 流式思考过程，支持折叠/展开、思考中动画、
 * #           分阶段推理展示（v3.0.0 Module D D8 新增）。
 * # 运行流程：
 * #   1. 思考中：显示旋转动画图标 + "思考中..."，内容实时追加
 * #   2. 思考完成：显示"思考过程"标题 + 展开/收起按钮
 * #   3. 默认折叠，用户可点击展开
 * #   4. v3.0.0 新增分阶段展示：
 * #      - 渲染 4 个推理阶段（分析 / 规划 / 编码 / 测试）
 * #      - 当前阶段高亮 + 进度条
 * #      - 每阶段有图标 + 标签 + 完成状态
 * #      - "干预"按钮：调用 onIntervene 回调暂停 AI
 * # 输入参数：
 * #   - content: string，思考内容
 * #   - isStreaming: boolean，是否正在流式接收
 * #   - stage?: ReasoningStage，当前推理阶段（v3.0.0 新增）
 * #     取值：'analysis' | 'planning' | 'coding' | 'testing'
 * #   - stageProgress?: number，0-1 进度值（v3.0.0 新增）
 * #   - onIntervene?: () => void，干预回调（v3.0.0 新增）
 * # 输出结果：纯 UI 组件
 * # ============================================================
 * # 修改记录：
 * #   v1.0.0 - 2026-06-23：补充文件头注释；折叠展开过渡升级为 .animate-msg-enter；标题栏添加 hover 抬升
 * #   v2.0.0 - 2026-06-30：视觉升级对齐 Trae IDE solo 模式：
 * #     - 左侧紫色渐变边框
 * #     - 标题栏增加图标背景圆形容器
 * #     - 展开内容区背景/边框/文字颜色优化
 * #     - 思考中自动展开、思考完成自动折叠
 * #   v3.0.0 - 2026-07-24：Module D - D8 分步推理展示
 * #     - 新增 stage / stageProgress / onIntervene 三个可选 Props
 * #     - 渲染 4 阶段进度条（分析/规划/编码/测试）
 * #     - 每阶段有图标 + 标签 + 完成/进行中/待执行状态
 * #     - "干预"按钮：调用 onIntervene 回调通知父组件
 * ============================================================
 */

import { useState, useEffect, useRef } from 'react';

/** 推理阶段枚举（v3.0.0 新增 - Module D D8） */
export type ReasoningStage = 'analysis' | 'planning' | 'coding' | 'testing' | 'idle';

interface ThinkingBlockProps {
  content: string;
  isStreaming: boolean;
  /** 当前推理阶段（v3.0.0 新增 - Module D D8） */
  stage?: ReasoningStage;
  /** 0-1 进度值（v3.0.0 新增 - Module D D8） */
  stageProgress?: number;
  /** 干预回调：用户点击"干预"按钮时触发（v3.0.0 新增 - Module D D8） */
  onIntervene?: () => void;
}

/**
 * 推理阶段元数据（v3.0.0 新增）
 * 描述：每个阶段的显示信息（标签、图标、颜色）
 */
const STAGE_META: Record<ReasoningStage, { label: string; icon: string; color: string }> = {
  idle:     { label: '待开始',   icon: '○', color: 'text-surface-500' },
  analysis: { label: '需求分析', icon: '🔍', color: 'text-blue-400' },
  planning: { label: '方案规划', icon: '📐', color: 'text-purple-400' },
  coding:   { label: '代码生成', icon: '⚡', color: 'text-emerald-400' },
  testing:  { label: '测试验证', icon: '✓', color: 'text-hermes-400' },
};

/** 阶段显示顺序（v3.0.0 新增） */
const STAGE_ORDER: ReasoningStage[] = ['analysis', 'planning', 'coding', 'testing'];

/**
 * 思考过程折叠组件（Trae IDE solo 模式风格）
 * - 思考中：显示旋转动画图标 + "思考中..."，自动展开，内容实时追加
 * - 思考完成：显示"思考过程"标题 + 展开/收起按钮，自动折叠
 * - 左侧紫色渐变竖条标识思考内容区域
 * - v3.0.0：分阶段推理展示 + 干预按钮
 */
export default function ThinkingBlock({
  content,
  isStreaming,
  stage = 'idle',
  stageProgress = 0,
  onIntervene,
}: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

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
  const currentStageMeta = STAGE_META[stage] || STAGE_META.idle;
  // 阶段索引（用于计算"已完成阶段"）
  const currentStageIndex = STAGE_ORDER.indexOf(stage);

  /**
   * 渲染阶段进度条（v3.0.0 新增）
   * 展示 4 个推理阶段，当前阶段高亮，已完成阶段打勾
   */
  const renderStages = () => {
    if (stage === 'idle' && !isStreaming) return null;

    return (
      <div className="mb-3">
        {/* 阶段标签行 */}
        <div className="grid grid-cols-4 gap-1.5 mb-2">
          {STAGE_ORDER.map((s, idx) => {
            const meta = STAGE_META[s];
            const isPast = currentStageIndex > idx;
            const isCurrent = stage === s;
            return (
              <div
                key={s}
                className={`flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-md transition-colors ${
                  isCurrent
                    ? 'bg-purple-500/15 border border-purple-500/30'
                    : isPast
                      ? 'bg-emerald-500/10 border border-emerald-500/20'
                      : 'bg-surface-200/30 border border-surface-300'
                }`}
                title={meta.label}
              >
                {/* 阶段图标 / 状态 */}
                <span className={`text-sm ${isCurrent ? meta.color : isPast ? 'text-emerald-400' : 'text-surface-500'}`}>
                  {isPast ? '✓' : isCurrent ? '●' : '○'}
                </span>
                {/* 阶段标签 */}
                <span className={`text-[10px] leading-tight text-center truncate w-full ${
                  isCurrent
                    ? 'text-purple-200 font-medium'
                    : isPast
                      ? 'text-emerald-300/70'
                      : 'text-surface-500'
                }`}>
                  {meta.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* 当前阶段进度条（v3.0.0 新增） */}
        {isStreaming && currentStageIndex >= 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-purple-300/70 flex-shrink-0">{currentStageMeta.label}</span>
            <div className="flex-1 h-1 bg-surface-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-hermes-400 transition-all duration-300 ease-out"
                style={{ width: `${Math.max(5, Math.min(100, stageProgress * 100))}%` }}
              />
            </div>
            <span className="text-[10px] text-purple-300/70 flex-shrink-0 font-mono">
              {Math.round(stageProgress * 100)}%
            </span>
          </div>
        )}
      </div>
    );
  };

  /**
   * 渲染"干预"按钮（v3.0.0 新增）
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
      {/* 标题栏：hover 时整体轻微右移，提示可交互 */}
      <div className="flex items-center gap-2 w-full group py-0.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm
                     transition-all duration-200 hover:translate-x-0.5
                     text-left flex-1"
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

          {/* 标题文字 */}
          <span className={`flex-1 font-medium ${
            isStreaming ? 'text-purple-300' : 'text-purple-400/70'
          }`}>
            {isStreaming ? `${currentStageMeta.label}中...` : '思考过程'}
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
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* 干预按钮（v3.0.0 新增） */}
        {renderInterveneButton()}
      </div>

      {/* 展开内容 */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          expanded ? 'max-h-[36rem] opacity-100 mt-2' : 'max-h-0 opacity-0'
        }`}
      >
        <div
          className="bg-purple-500/5 border border-purple-500/15 rounded-lg p-3
                     text-sm text-purple-100/80 leading-relaxed
                     font-mono whitespace-pre-wrap overflow-y-auto"
        >
          {/* 阶段进度条（v3.0.0 新增） */}
          {renderStages()}

          {/* 思考内容 */}
          <div ref={contentRef} className="max-h-64 overflow-y-auto">
            {content || (isStreaming ? '...' : '')}
          </div>
        </div>
      </div>
    </div>
  );
}
