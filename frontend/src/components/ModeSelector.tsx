/**
 * # ============================================================
 * # 模式选择器组件 - ModeSelector
 * # ============================================================
 * # 核心作用：首次访问时展示双模式入口，用户选择「日常办公闲聊」
 * #           或「编程模式」后进入对应工作区。
 * # 运行流程：
 * #   1. 居中渲染两张大卡片（聊天模式 / 编程模式）
 * #   2. 用户点击任一卡片 → 触发 onSelect(mode) 回调
 * #   3. 父组件（App.tsx）将 mode 写入 localStorage 并进入主界面
 * # 输入参数：
 * #   - onSelect: (mode: 'chat' | 'coding') => void
 * #     用户选择模式后的回调
 * # 输出结果：纯 UI 组件，无返回值
 * # 复用说明：无复用（全新组件）
 * # 修改记录：
 * #   - 2026-06-24 | v1.0.0 | 初始版本：双卡片模式选择器（Hermes 暗色主题）
 * # ============================================================
 */

import type { FC } from 'react';

/**
 * ModeSelector 组件 Props
 */
interface ModeSelectorProps {
  /** 用户选择模式后的回调 */
  onSelect: (mode: 'chat' | 'coding') => void;
}

/**
 * 内联 SVG 图标渲染器
 * 参数：
 *   - name: 'chat' | 'coding'，图标键
 *   - className: 尺寸 / 颜色类名
 * 返回值：JSX 元素
 */
function ModeIcon({ name, className = 'w-16 h-16' }: { name: 'chat' | 'coding'; className?: string }) {
  switch (name) {
    case 'chat':
      // 聊天气泡 + 火花图标
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M8 10h.01M12 10h.01M16 10h.01" />
        </svg>
      );
    case 'coding':
      // 终端 / 代码图标
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}>
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      );
    default:
      return null;
  }
}

/**
 * 模式选择器组件
 * - 全屏居中，暗色背景（bg-surface-50）
 * - 两张大卡片：聊天模式（蓝紫渐变） / 编程模式（hermes 金橙渐变）
 * - hover 上浮 + 光晕效果
 */
const ModeSelector: FC<ModeSelectorProps> = ({ onSelect }) => {
  return (
    <div className="min-h-screen bg-surface-50 flex flex-col items-center justify-center px-6">
      {/* 顶部品牌区 */}
      <div className="text-center mb-12 animate-fade-in">
        {/* Hermes Logo */}
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-hermes-500 to-hermes-600
                        flex items-center justify-center shadow-glow-hermes-lg mx-auto mb-5">
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"
               strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
            <path d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">欢迎使用 Hermes 智能调度平台</h1>
        <p className="text-surface-600 text-sm">请选择您的工作模式</p>
      </div>

      {/* 双模式卡片 */}
      <div className="flex flex-col md:flex-row gap-6 max-w-2xl w-full animate-slide-up">
        {/* 聊天模式卡片 */}
        <button
          onClick={() => onSelect('chat')}
          className="group flex-1 p-8 rounded-3xl
                     bg-gradient-to-br from-surface-100 to-surface-200
                     border border-surface-300/50
                     shadow-level-2
                     hover:shadow-glow-hermes hover:border-hermes-500/30
                     hover:-translate-y-1
                     transition-all duration-default ease-expressive
                     text-left"
          aria-label="选择日常办公闲聊模式"
        >
          <div className="flex flex-col items-center text-center gap-4">
            {/* 图标容器：蓝紫色调圆角背景 */}
            <div className="w-20 h-20 rounded-2xl
                            bg-gradient-to-br from-blue-500/20 to-purple-500/20
                            flex items-center justify-center
                            group-hover:from-blue-500/30 group-hover:to-purple-500/30
                            transition-colors duration-default">
              <ModeIcon name="chat" className="w-12 h-12 text-blue-400 group-hover:text-blue-300 transition-colors" />
            </div>
            <div className="space-y-2">
              <div className="text-lg font-semibold text-white">
                💬 日常办公闲聊
              </div>
              <p className="text-sm text-surface-600 leading-relaxed">
                日常对话、翻译、总结、问答等通用办公场景，简单快捷的 AI 助手体验
              </p>
            </div>
          </div>
        </button>

        {/* 编程模式卡片 */}
        <button
          onClick={() => onSelect('coding')}
          className="group flex-1 p-8 rounded-3xl
                     bg-gradient-to-br from-surface-100 to-surface-200
                     border border-surface-300/50
                     shadow-level-2
                     hover:shadow-glow-hermes hover:border-hermes-500/30
                     hover:-translate-y-1
                     transition-all duration-default ease-expressive
                     text-left"
          aria-label="选择编程模式"
        >
          <div className="flex flex-col items-center text-center gap-4">
            {/* 图标容器：Hermes 金橙色调圆角背景 */}
            <div className="w-20 h-20 rounded-2xl
                            bg-gradient-to-br from-hermes-500/20 to-hermes-600/20
                            flex items-center justify-center
                            group-hover:from-hermes-500/30 group-hover:to-hermes-600/30
                            transition-colors duration-default">
              <ModeIcon name="coding" className="w-12 h-12 text-hermes-400 group-hover:text-hermes-300 transition-colors" />
            </div>
            <div className="space-y-2">
              <div className="text-lg font-semibold text-white">
                ⚡ 编程模式
              </div>
              <p className="text-sm text-surface-600 leading-relaxed">
                提示词优化、任务规划、代码生成与调度，面向专业开发的全链路编程工作台
              </p>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
};

export default ModeSelector;
