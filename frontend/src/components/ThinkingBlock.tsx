/**
 * # ============================================================
 * # 思考过程折叠组件
 * # ============================================================
 * # 核心作用：展示 Hermes 流式思考过程，支持折叠/展开、思考中动画
 * # 运行流程：
 * #   1. 思考中：显示旋转动画图标 + "思考中..."，内容实时追加
 * #   2. 思考完成：显示"思考过程"标题 + 展开/收起按钮
 * #   3. 默认折叠，用户可点击展开
 * # 输入参数：
 * #   - content: string，思考内容
 * #   - isStreaming: boolean，是否正在流式接收
 * # 输出结果：纯 UI 组件
 * # ============================================================
 * # 修改记录：
 * #   v1.0.0 - 2026-06-23：补充文件头注释；折叠展开过渡升级为 .animate-msg-enter；标题栏添加 hover 抬升
 * #   v2.0.0 - 2026-06-30：视觉升级对齐 Trae IDE solo 模式：
 * #     - 左侧紫色渐变边框
 * #     - 标题栏增加图标背景圆形容器
 * #     - 展开内容区背景/边框/文字颜色优化
 * #     - 思考中自动展开、思考完成自动折叠
#   - 2026-06-30 | v2.0.0 | 视觉升级对齐 Trae IDE solo 模式：左侧紫色边框、图标圆形背景、思考中自动展开
# ============================================================
 */

import { useState, useEffect, useRef } from 'react';

interface ThinkingBlockProps {
  content: string;
  isStreaming: boolean;
}

/**
 * 思考过程折叠组件（Trae IDE solo 模式风格）
 * - 思考中：显示旋转动画图标 + "思考中..."，自动展开，内容实时追加
 * - 思考完成：显示"思考过程"标题 + 展开/收起按钮，自动折叠
 * - 左侧紫色渐变竖条标识思考内容区域
 */
export default function ThinkingBlock({ content, isStreaming }: ThinkingBlockProps) {
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

  if (!content && !isStreaming) return null;

  return (
    <div className="mb-3 ml-1 border-l-2 border-purple-500/40 pl-3">
      {/* 标题栏：hover 时整体轻微右移，提示可交互 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm
                   transition-all duration-200 hover:translate-x-0.5
                   w-full text-left group py-0.5"
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
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
          )}
        </span>

        {/* 标题文字 */}
        <span className={`flex-1 font-medium ${
          isStreaming ? 'text-purple-300' : 'text-purple-400/70'
        }`}>
          {isStreaming ? '思考中...' : '思考过程'}
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

      {/* 展开内容 */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          expanded ? 'max-h-96 opacity-100 mt-2' : 'max-h-0 opacity-0'
        }`}
      >
        <div
          ref={contentRef}
          className="bg-purple-500/5 border border-purple-500/15 rounded-lg p-3
                     text-sm text-purple-100/80 leading-relaxed max-h-64 overflow-y-auto
                     font-mono whitespace-pre-wrap"
        >
          {content || (isStreaming ? '...' : '')}
        </div>
      </div>
    </div>
  );
}
