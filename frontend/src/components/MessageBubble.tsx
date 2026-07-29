/**
 * # ============================================================
 * # 消息气泡组件 - MessageBubble
 * # ============================================================
 * # 核心作用：渲染用户 / AI 消息气泡，支持 hover 工具栏与错误卡片
 * # 运行流程：
 * #   1. role=user：右对齐 + 暖橙渐变背景 + 圆角 + 浅边框
 * #   2. role=assistant：左对齐 + 白色 + 左侧 4px Hermes 竖条
 * #   3. hover 工具栏：复制 / 重新生成 / 点赞 / 点踩 / 朗读（仅 assistant 全部展示，user 仅复制）
 * #   4. error 字段非空时：渲染 error-card + 重新发送按钮
 * # 输入参数：role / content / thinking / isStreaming / error / onRetry
 * # 输出结果：消息气泡 DOM
 * # ============================================================
 * # 修改记录：
 * #   - 2026-06-24 | v1.0.0 | 初始版本：用户/AI 两种样式 + hover 工具栏 + 错误卡片（豆包风格）
 * #   - 2026-07-29 | v6.33.0 | Cycle 15 P0 修复：4 个无功能按钮接入真实回调
 * #     - 新增 onRegenerate/onLike/onDislike/onReadAloud 回调 props
 * #     - 点赞/点踩支持 visual state（aria-pressed + 背景色）
 * #     - 朗读按钮未提供回调时回退到内置 Web Speech API
 * #     - 全部按钮增加 disabled 态视觉反馈
 * #   - 2026-07-29 | v6.33.1 | Cycle 15 P1-4 接入 MarkdownContent
 * #     - AI 消息正文由纯文本替换为 MarkdownContent
 * #     - 代码块自动 shiki 高亮
 * # ============================================================
 */

import type { CSSProperties } from 'react';
import MarkdownContent from './MarkdownContent';

// ============================================================
// inline SVG 图标组件
// 作用：避免引入 lucide-react 依赖；保持 14×14 viewBox 24×24 描边风格
// ============================================================

/** 复制图标（双矩形） */
const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

/** 重新生成图标（环形箭头） */
const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

/** 点赞图标（竖起大拇指） */
const ThumbsUpIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
  </svg>
);

/** 点踩图标（拇指向下） */
const ThumbsDownIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
  </svg>
);

/** 朗读图标（喇叭 + 声波） */
const VolumeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);

// ============================================================
// Props 定义
// ============================================================

/**
 * MessageBubble 组件 Props
 * - role: 消息角色（user=用户 / assistant=Hermes/AI）
 * - content: 消息正文
 * - thinking: 思考过程内容（仅 assistant 角色）
 * - isStreaming: 是否处于流式输出中
 * - error: 流式错误时显示的错误内容
 * - onRetry: 错误卡片中的"重新发送"回调
 * - messageId: 消息唯一 ID（用于操作回调）
 * - feedback: 用户对消息的反馈状态（none=无 / like=赞 / dislike=踩）
 * - onRegenerate: 重新生成回调（v6.33.0 新增：P0 修复无功能按钮）
 * - onLike: 点赞回调
 * - onDislike: 点踩回调
 * - onReadAloud: 朗读回调（调用 Web Speech API）
 */
export interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  isStreaming?: boolean;
  error?: string;
  onRetry?: () => void;
  messageId?: string;
  feedback?: 'none' | 'like' | 'dislike';
  onRegenerate?: (messageId: string) => void;
  onLike?: (messageId: string) => void;
  onDislike?: (messageId: string) => void;
  onReadAloud?: (messageId: string, text: string) => void;
}

// ============================================================
// ThinkingBlock 内部子组件
// 作用：折叠展示思考过程（豆包式 thinking 折叠）
// ============================================================

/**
 * 思考内容折叠块
 * 参数：
 *   - content: 思考过程全文
 *   - isStreaming: 是否处于思考中（流式接收）
 * 返回值：折叠 / 展开的 DOM
 */
function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  return (
    <details className="mb-3 group/thinking">
      <summary
        className="flex items-center gap-1.5 cursor-pointer text-xs font-medium
                   text-hermes-500 hover:text-hermes-400 select-none
                   transition-colors duration-fast ease-material
                   list-none"
      >
        <svg
          className="w-3 h-3 transition-transform duration-default ease-material
                     group-open/thinking:rotate-90"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span>{isStreaming ? '正在思考...' : '思考过程'}</span>
      </summary>
      <div
        className="mt-2 pl-4 border-l-2 border-hermes-300/60
                   text-caption text-surface-600 whitespace-pre-wrap break-words
                   italic"
      >
        {content}
      </div>
    </details>
  );
}

// ============================================================
// 工具栏：复制按钮点击处理
// 作用：调用 navigator.clipboard.writeText 写入剪贴板，失败 console.warn
// ============================================================

/**
 * 复制到剪贴板
 * 参数：
 *   - text: 待复制的文本内容
 * 返回值：void
 */
function copyToClipboard(text: string): void {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard
      .writeText(text)
      .catch((e) => console.warn('复制到剪贴板失败：', e));
  }
}

// ============================================================
// 朗读辅助：调用 Web Speech API
// 作用：speechSynthesis.speak + 中文语音优先
// 失败回退：console.warn，不抛错
// ============================================================

/**
 * 朗读文本（调用浏览器 Web Speech API）
 * 参数：
 *   - text: 待朗读内容
 * 返回值：void（失败仅 console.warn）
 */
function readAloud(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    console.warn('当前浏览器不支持 Web Speech API');
    return;
  }
  // 取消之前的朗读，避免重叠
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'zh-CN';
  utter.rate = 1.0;
  utter.pitch = 1.0;
  utter.volume = 1.0;
  window.speechSynthesis.speak(utter);
}

// ============================================================
// MessageBubble 主组件
// ============================================================

/**
 * 消息气泡组件
 * 核心逻辑：
 *   - 错误优先：error 字段非空时直接渲染错误卡片
 *   - 用户消息：右对齐 + 暖橙渐变 + hover 工具栏（仅复制）
 *   - AI 消息：左对齐 + 白色 + 左侧 4px Hermes 竖条 + hover 工具栏（5 个按钮）
 *   - 流式光标：isStreaming && !error 时显示
 */
export default function MessageBubble({
  role,
  content,
  thinking,
  isStreaming = false,
  error,
  onRetry,
  messageId,
  feedback = 'none',
  onRegenerate,
  onLike,
  onDislike,
  onReadAloud,
}: MessageBubbleProps) {
  // ============================================================
  // 错误态：error 字段非空时优先渲染错误卡片
  // ============================================================
  if (error) {
    return (
      <div className="flex justify-start mb-6">
        <div className="max-w-3xl w-full">
          <div className="error-card">
            <div className="text-body font-medium mb-1">处理失败</div>
            <div className="text-caption mb-3">{error}</div>
            {onRetry && (
              <button
                onClick={onRetry}
                className="text-sm text-red-700 hover:text-red-800 underline
                           transition-colors duration-fast ease-material
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded"
              >
                重新发送
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // 用户消息气泡（role === 'user'）
  // ============================================================
  if (role === 'user') {
    return (
      <div className="flex justify-end mb-6 group">
        <div className="max-w-2xl relative">
          <div
            className="bg-gradient-to-br from-hermes-50 to-hermes-100
                       border border-hermes-200/60 rounded-2xl px-5 py-3
                       shadow-level-1 group-hover:shadow-level-2
                       transition-all duration-200"
          >
            <div className="text-body text-surface-900 whitespace-pre-wrap break-words">
              {content}
            </div>
          </div>
          {/* hover 工具栏：仅复制按钮 */}
          <div
            className="absolute -top-3 right-4
                       opacity-0 group-hover:opacity-100
                       transition-opacity duration-150
                       pointer-events-none group-hover:pointer-events-auto
                       z-10"
          >
            <div
              className="bg-white rounded-full shadow-level-2
                         border border-surface-200 px-1.5 py-1
                         flex items-center gap-0.5
                         animate-message-toolbar-in"
            >
              <button
                onClick={() => copyToClipboard(content)}
                title="复制"
                aria-label="复制"
                className="w-7 h-7 rounded-full hover:bg-surface-100
                           flex items-center justify-center
                           text-surface-600 hover:text-hermes-500
                           transition-colors duration-fast ease-material
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-hermes-400"
              >
                <CopyIcon />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // AI 消息气泡（role === 'assistant'）
  // ============================================================
  return (
    <div className="flex justify-start mb-6 group">
      <div className="max-w-3xl relative w-full">
        <div
          className="bg-white border border-surface-200
                     border-l-4 border-l-hermes-400
                     rounded-2xl px-5 py-3
                     shadow-level-1 group-hover:shadow-level-2
                     transition-all duration-200"
        >
          {/* 思考内容（如有） */}
          {thinking && (
            <ThinkingBlock content={thinking} isStreaming={isStreaming} />
          )}
          {/* 主体内容（v6.33.1 P1-4：使用 MarkdownContent，代码块 shiki 高亮） */}
          <div className="text-body text-surface-800">
            <MarkdownContent
              content={content}
              theme="dark"
              streamingBatchSize={isStreaming ? 30 : 0}
              streamingBatchIntervalMs={isStreaming ? 80 : 0}
            />
            {/* 流式光标：仅在 streaming 状态显示 */}
            {isStreaming && (
              <span
                className="inline-block w-1.5 h-4 bg-hermes-400 ml-0.5 align-text-bottom animate-pulse"
                style={{ verticalAlign: 'text-bottom' } as CSSProperties}
              />
            )}
          </div>
        </div>
        {/* hover 工具栏：5 个图标按钮（仅在有内容时显示，避免流式空态浮出） */}
        {content && (
          <div
            className="absolute -top-3 right-4
                       opacity-0 group-hover:opacity-100
                       transition-opacity duration-150
                       pointer-events-none group-hover:pointer-events-auto
                       z-10"
          >
            <div
              className="bg-white rounded-full shadow-level-2
                         border border-surface-200 px-1.5 py-1
                         flex items-center gap-0.5
                         animate-message-toolbar-in"
            >
              <button
                onClick={() => copyToClipboard(content)}
                title="复制"
                aria-label="复制"
                className="w-7 h-7 rounded-full hover:bg-surface-100
                           flex items-center justify-center
                           text-surface-600 hover:text-hermes-500
                           transition-colors duration-fast ease-material
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-hermes-400"
              >
                <CopyIcon />
              </button>
              <button
                onClick={() => messageId && onRegenerate?.(messageId)}
                disabled={!messageId || !onRegenerate}
                title="重新生成"
                aria-label="重新生成"
                className="w-7 h-7 rounded-full hover:bg-surface-100
                           flex items-center justify-center
                           text-surface-600 hover:text-hermes-500
                           transition-colors duration-fast ease-material
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-hermes-400
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshIcon />
              </button>
              <button
                onClick={() => messageId && onLike?.(messageId)}
                disabled={!messageId || !onLike}
                title="点赞"
                aria-label="点赞"
                aria-pressed={feedback === 'like'}
                className={`w-7 h-7 rounded-full hover:bg-surface-100
                           flex items-center justify-center
                           transition-colors duration-fast ease-material
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-hermes-400
                           disabled:opacity-40 disabled:cursor-not-allowed ${
                             feedback === 'like'
                               ? 'text-hermes-500 bg-hermes-50'
                               : 'text-surface-600 hover:text-hermes-500'
                           }`}
              >
                <ThumbsUpIcon />
              </button>
              <button
                onClick={() => messageId && onDislike?.(messageId)}
                disabled={!messageId || !onDislike}
                title="点踩"
                aria-label="点踩"
                aria-pressed={feedback === 'dislike'}
                className={`w-7 h-7 rounded-full hover:bg-surface-100
                           flex items-center justify-center
                           transition-colors duration-fast ease-material
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-hermes-400
                           disabled:opacity-40 disabled:cursor-not-allowed ${
                             feedback === 'dislike'
                               ? 'text-red-500 bg-red-50'
                               : 'text-surface-600 hover:text-hermes-500'
                           }`}
              >
                <ThumbsDownIcon />
              </button>
              <button
                onClick={() => {
                  if (messageId && onReadAloud) {
                    onReadAloud(messageId, content);
                  } else {
                    // v6.33.0：未提供回调时使用内置 Web Speech API
                    readAloud(content);
                  }
                }}
                disabled={!content}
                title="朗读"
                aria-label="朗读"
                className="w-7 h-7 rounded-full hover:bg-surface-100
                           flex items-center justify-center
                           text-surface-600 hover:text-hermes-500
                           transition-colors duration-fast ease-material
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-hermes-400
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <VolumeIcon />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
