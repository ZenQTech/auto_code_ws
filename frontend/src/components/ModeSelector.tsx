/**
 * # ============================================================
 * # 模式选择器组件 - ModeSelector (v2.0.0) - Cycle 60 G60-2.3
 * # ============================================================
 * # 核心作用：首次访问时展示 4 模式入口（Chat / Coding / Vibe Coding / Solo）
 * #           用户选择后进入对应工作区。
 * # 运行流程：
 * #   1. 居中渲染四张卡片（聊天模式 / 编程模式 / Vibe Coding / Solo）
 * #   2. 用户点击任一卡片 → 触发 onSelect(mode) 回调
 * #   3. 父组件（App.tsx）将 mode 写入 localStorage 并进入主界面
 * # 输入参数：
 * #   - onSelect: (mode) => void
 * # 输出结果：纯 UI 组件，无返回值
 * # 修改记录：
 * #   - 2026-06-24 | v1.0.0 | 初始版本：双卡片模式选择器（Hermes 暗色主题）
 * #   - 2026-08-03 | v2.0.0 | 4 模式选择器，新增 Vibe Coding + Solo（NEW 推荐）
 * # ============================================================
 */

import type { FC } from 'react';

/**
 * 模式键：4 种工作模式
 */
export type SelectorMode = 'chat' | 'coding' | 'vibe-coding' | 'solo';

/**
 * ModeSelector 组件 Props
 */
interface ModeSelectorProps {
  /** 用户选择模式后的回调 */
  onSelect: (mode: SelectorMode) => void;
}

/**
 * 内联 SVG 图标渲染器
 * 参数：
 *   - name: 图标键
 *   - className: 尺寸 / 颜色类名
 * 返回值：JSX 元素
 */
function ModeIcon({
  name,
  className = 'w-12 h-12',
}: {
  name: 'chat' | 'coding' | 'vibe' | 'solo';
  className?: string;
}) {
  switch (name) {
    case 'chat':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M8 10h.01M12 10h.01M16 10h.01" />
        </svg>
      );
    case 'coding':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}>
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      );
    case 'vibe':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}>
          <path d="M2 12c0 5.5 4.5 10 10 10s10-4.5 10-10S17.5 2 12 2 2 6.5 2 12z" />
          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
          <path d="M9 9h.01M15 9h.01" />
        </svg>
      );
    case 'solo':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}>
          <path d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
    default:
      return null;
  }
}

/**
 * 4 模式元数据
 */
interface ModeCard {
  key: SelectorMode;
  emoji: string;
  title: string;
  description: string;
  highlight: string;
  iconName: 'chat' | 'coding' | 'vibe' | 'solo';
  featured?: boolean;
  gradient: string;
}

const MODE_CARDS: ModeCard[] = [
  {
    key: 'chat',
    emoji: '💬',
    title: '日常办公闲聊',
    description: '日常对话、翻译、总结、问答等通用办公场景，简单快捷的 AI 助手体验',
    highlight: '通用办公',
    iconName: 'chat',
    gradient: 'from-blue-500/20 to-purple-500/20',
  },
  {
    key: 'coding',
    emoji: '⚡',
    title: '编程模式',
    description: '提示词优化、任务规划、代码生成与调度，面向专业开发的全链路编程工作台',
    highlight: '专业开发',
    iconName: 'coding',
    gradient: 'from-hermes-500/20 to-hermes-600/20',
  },
  {
    key: 'vibe-coding',
    emoji: '🌊',
    title: 'Vibe Coding',
    description: '对标 Codex/Trae Solo 的全流程 vibe coding：Loop 状态机持续可见、Auto-Follow 工具联动、Plan 真正可执行',
    highlight: '经典体验',
    iconName: 'vibe',
    gradient: 'from-fuchsia-500/20 via-purple-500/20 to-cyan-500/20',
  },
  {
    key: 'solo',
    emoji: '🚀',
    title: 'Solo 模式',
    description: '新一代主壳：左会话历史 + 中主舞台 + 右工具矩阵，3 主题切换 + Goal 岛台 + Auto-Follow 全联动',
    highlight: 'NEW · 推荐',
    iconName: 'solo',
    featured: true,
    gradient: 'from-orange-500/20 via-pink-500/20 to-purple-500/20',
  },
];

/**
 * 4 模式选择器组件
 * - 全屏居中，4 卡片网格布局
 * - Solo 模式高亮 + NEW 徽标
 * - 暗色背景（bg-surface-50）+ 渐变光晕
 */
const ModeSelector: FC<ModeSelectorProps> = ({ onSelect }) => {
  return (
    <div className="min-h-screen bg-surface-50 flex flex-col items-center justify-center px-6 py-8">
      {/* 顶部品牌区 */}
      <div className="text-center mb-10 animate-fade-in">
        {/* Hermes Logo */}
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-hermes-500 to-hermes-600
                        flex items-center justify-center shadow-glow-hermes-lg mx-auto mb-5">
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"
               strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
            <path d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">欢迎使用 Hermes 智能调度平台</h1>
        <p className="text-surface-600 text-sm">请选择您的工作模式（推荐 Solo 模式体验完整功能）</p>
      </div>

      {/* 4 模式卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl w-full animate-slide-up">
        {MODE_CARDS.map((mode) => (
          <button
            key={mode.key}
            onClick={() => onSelect(mode.key)}
            data-testid={`mode-card-${mode.key}`}
            className={[
              'group relative p-6 rounded-2xl text-left',
              'bg-gradient-to-br from-surface-100 to-surface-200',
              'border transition-all duration-default ease-expressive',
              mode.featured
                ? 'border-hermes-500 shadow-glow-hermes ring-2 ring-hermes-500/30 hover:ring-hermes-400'
                : 'border-surface-300/50 hover:border-hermes-500/30 hover:shadow-glow-hermes',
              'hover:-translate-y-1',
            ].join(' ')}
            aria-label={`选择${mode.title}模式`}
          >
            {mode.featured && (
              <div className="absolute -top-2 -right-2 px-2 py-0.5 bg-gradient-to-r from-hermes-500 to-fuchsia-500 text-white text-[10px] font-bold rounded-full shadow-lg">
                NEW
              </div>
            )}
            <div className="flex flex-col gap-3">
              {/* 图标容器 */}
              <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${mode.gradient}
                              flex items-center justify-center
                              group-hover:scale-110 transition-transform duration-default`}>
                <ModeIcon name={mode.iconName} className="w-8 h-8 text-white" />
              </div>
              {/* 标题 */}
              <div className="space-y-1.5">
                <div className="text-base font-semibold text-white flex items-center gap-1.5">
                  <span className="text-lg">{mode.emoji}</span>
                  <span>{mode.title}</span>
                </div>
                <p className="text-xs text-surface-600 leading-relaxed line-clamp-3">
                  {mode.description}
                </p>
              </div>
              {/* 标签 */}
              <div className={`text-[11px] font-medium ${mode.featured ? 'text-hermes-400' : 'text-surface-500'}`}>
                {mode.highlight}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* 底部提示 */}
      <div className="mt-6 text-center text-xs text-surface-500">
        提示：所有模式可随时通过侧边栏 / 命令面板 ⌘K 切换
      </div>
    </div>
  );
};

export default ModeSelector;
