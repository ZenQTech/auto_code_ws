/**
 * # ============================================================
 * # PlanViewer 计划文档展示组件
 * # ============================================================
 * # 核心作用：接收 Markdown 格式的任务计划文本，渲染为格式化
 * #           HTML 展示，并提供"确认执行"按钮供用户确认
 * # 运行流程：
 * #   1. 接收 markdown 文本（计划.md 内容）
 * #   2. 将 Markdown 解析为 HTML（支持标题、列表、代码块、粗体）
 * #   3. 渲染格式化后的计划内容
 * #   4. 底部显示"确认执行"按钮，点击后触发 onConfirm 回调
 * # 输入参数：
 * #   - content: string，Markdown 格式的计划文本
 * #   - visible: boolean，控制组件显示/隐藏
 * #   - onConfirm: () => void，用户确认执行的回调
 * #   - onClose: () => void，关闭组件的回调
 * # 输出结果：无返回值，纯 UI 组件
 * # 修改记录：
 * #   - 2026-06-17 | v1.0.0 | 初始创建，实现计划文档 Markdown 渲染
 * #   - 2026-06-17 | v1.1.0 | 优化模态弹窗体验：添加关闭动画、内容区渐变淡出效果、确认按钮过渡动画
 * #   - 2026-06-23 | v1.2.0 | 模态框主面板升级为 .glass-strong；背景遮罩使用 .glass；按钮替换为 .btn-primary/.btn-ghost
 * #   - 2026-06-25 | v1.3.0 | renderMarkdown 提取到 ../utils/markdown.ts 共享
 * # ============================================================
 */

import { useMemo, useState, useEffect } from 'react';
import { renderMarkdown } from '../utils/markdown';

interface Props {
  /** Markdown 格式的计划文本 */
  content: string;
  /** 控制组件显示/隐藏 */
  visible: boolean;
  /** 用户确认执行的回调 */
  onConfirm: () => void;
  /** 关闭组件的回调 */
  onClose: () => void;
}

export default function PlanViewer({ content, visible, onConfirm, onClose }: Props) {
  /**
   * 关闭动画状态：true 时播放淡出动画，动画结束后触发实际 onClose
   */
  const [isClosing, setIsClosing] = useState(false);

  /**
   * 使用 useMemo 缓存 Markdown 渲染结果
   * 仅在 content 变化时重新渲染，避免不必要的 DOM 操作
   */
  const htmlContent = useMemo(() => renderMarkdown(content), [content]);

  // visible 变为 true 时重置关闭动画状态
  useEffect(() => {
    if (visible) {
      setIsClosing(false);
    }
  }, [visible]);

  /**
   * 带关闭动画的关闭处理
   * 先触发 isClosing 状态播放淡出动画，250ms 后执行实际 onClose
   */
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 250);
  };

  // 不可见且不在关闭动画中时不渲染
  if (!visible && !isClosing) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm glass">
      {/* 模态弹窗主体：Hermes 深色风格 + 玻璃拟态（强） */}
      <div className={`glass-strong rounded-xl
                      w-full max-w-3xl max-h-[85vh] flex flex-col mx-4
                      ${isClosing ? 'animate-modal-out' : 'animate-modal-in'}`}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-300">
          <div className="flex items-center gap-3">
            {/* Hermes 图标 */}
            <div className="w-8 h-8 rounded-lg bg-hermes-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-surface-950">任务执行计划</h2>
          </div>
          {/* 关闭按钮 */}
          <button
            onClick={handleClose}
            className="icon-btn"
            aria-label="关闭计划"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 计划内容区域：可滚动，顶部/底部渐变淡出效果 */}
        <div className="relative flex-1 overflow-hidden">
          {/* 顶部渐变遮罩 */}
          <div className="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-surface-100 to-transparent z-10 pointer-events-none" />
          <div className="h-full overflow-y-auto px-6 py-4">
            {content ? (
              <div
                className="prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />
            ) : (
              <div className="empty-state">
                <span className="empty-icon">📝</span>
                <span>暂无计划内容</span>
              </div>
            )}
          </div>
          {/* 底部渐变遮罩 */}
          <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-surface-100 to-transparent z-10 pointer-events-none" />
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-surface-300">
          <button
            onClick={handleClose}
            className="btn-ghost"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="btn-primary"
          >
            确认执行
          </button>
        </div>
      </div>
    </div>
  );
}
