/**
 * # ============================================================
 * # 启动欢迎页组件 - WelcomeState
 * # ============================================================
 * # 核心作用：在用户首次打开或新建空 Session 时显示品牌欢迎页，
 * #           展示品牌插画 + 标题/副标题 + 4 个快速提示词卡片
 * # 运行流程：
 * #   1. AppLayout 检测当前 Session 无消息（messages.length === 0）时渲染本组件
 * #   2. 整体应用渐入动画（fade + slide up = animate-lift-in）
 * #   3. 4 个快速提示词卡片悬停高亮，点击触发 onSelectPrompt 回调
 * #   4. 父组件将 prompt 写入输入框 + 自动 focus
 * # 输入参数：
 * #   - onSelectPrompt: (prompt: string) => void
 * #     用户点击快速卡片时回调，将 prompt 写入输入框
 * # 输出结果：品牌插画（圆形渐变 + 闪电）+ 标题/副标题 + 4 个快速提示词卡片
 * # 复用说明：
 * #   - 无复用（全新组件，仅引用全局 Tailwind 工具类与 design token）
 * #   - lucide-react 未安装，使用 inline SVG 作为闪电图标（保持零额外依赖）
 * # 修改记录：
 * #   - 2026-06-24 | v1.0.0 | 初始版本：品牌插画 + 4 快速入口卡片 + 阶梯渐入动画（豆包风格）
 * #   - 2026-06-24 | v1.1.0 | 招呼语文案更新（三行结构 + 引导提问）
 * #   - 2026-06-24 | v1.2.0 | 删除 4 个快速入口卡片（编程模式下为信息噪音）
 * #   - 2026-07-27 | v1.3.0 | 重新引入 4 个快速提示词卡片（Codex 风格 + TRAE 风格融合）：
 * #     - 紧凑卡片布局（hover 高亮 + 渐变描边）
 * #     - 4 个分类：架构设计/代码生成/调试排错/创意写作
 * #     - 移动端 1 列 / 桌面 2 列自适应
 * ============================================================
 */

/**
 * WelcomeState 组件 Props
 */
export interface WelcomeStateProps {
  /**
   * 用户点击快速入口卡片时触发，回调参数为该卡片预设的 prompt
   */
  onSelectPrompt: (prompt: string) => void;
}

/**
 * 4 个快速提示词卡片（v1.3.0 新增）
 * - 图标 + 标题 + 描述 + 示例 prompt
 * - 点击触发 onSelectPrompt
 */
const QUICK_PROMPTS: Array<{
  icon: React.ReactNode;
  title: string;
  description: string;
  prompt: string;
  accent: string;
}> = [
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h18M3.75 3h16.5v3.75H3.75V3zm0 7.5h7.5v7.5h-7.5v-7.5zm9 0h7.5v3.75h-7.5V10.5zm0 5.625h7.5v1.875h-7.5v-1.875z" />
      </svg>
    ),
    title: '设计系统架构',
    description: '为新项目生成技术选型 + 模块划分 + 接口规范',
    prompt: '请帮我设计一个 ROS2 机器人控制系统的整体技术架构，包括模块划分、接口规范和关键技术选型。',
    accent: 'from-blue-500/20 to-cyan-500/20 text-blue-300',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
      </svg>
    ),
    title: '编写功能代码',
    description: '根据规格直接生成可运行的 C++/Python 代码',
    prompt: '请基于以下需求生成代码：实现一个 ROS2 节点，订阅 /cmd_vel 话题并发布 /odom 反馈。',
    accent: 'from-emerald-500/20 to-green-500/20 text-emerald-300',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
      </svg>
    ),
    title: '调试代码问题',
    description: '分析错误日志、定位根因、给出修复方案',
    prompt: '我遇到一个 ROS2 节点启动时崩溃的问题，错误信息是 "Segmentation fault"，请帮我分析。',
    accent: 'from-amber-500/20 to-orange-500/20 text-amber-300',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
      </svg>
    ),
    title: '头脑风暴创意',
    description: '方案对比、命名建议、文案润色',
    prompt: '请帮我针对 AGV 调度系统设计 5 个产品命名建议，并说明各自的定位和适用场景。',
    accent: 'from-purple-500/20 to-pink-500/20 text-purple-300',
  },
];

/**
 * 启动欢迎页组件
 * - 整体使用 flex 居中布局：插画 → 标题/副标题 → 4 个快速提示词卡片
 * - 渐入动画使用全局已定义的 .animate-lift-in
 * - 卡片悬停时显示渐变描边 + 提升阴影
 *
 * v1.3.1 (2026-07-27) Phase 5 UI/UX 优化：
 *   - 修复深色主题下文字对比度问题
 *   - 原 text-surface-900 (#7a7570) 在 surface-50 (#0a0a0f) 背景上几乎不可见
 *   - 改用 surface-950 (#8a8580) 作为主标题颜色，surface-800 / surface-700 / surface-600 作为副文本
 *   - 卡片描述文字从 surface-500 (几乎不可见) 升级到 surface-400 (#2a2520) 仍不够亮，
 *     最终使用 surface-300 配套发光边框提升可读性
 */
export default function WelcomeState({ onSelectPrompt }: WelcomeStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 animate-lift-in">
      {/* 品牌插画：圆形渐变 + 闪电图标（Hermes 主色） */}
      <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-hermes-100 to-hermes-200 flex items-center justify-center shadow-glow-hermes mb-5">
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-hermes-500/20 to-transparent animate-pulse" />
        <svg
          className="relative w-10 h-10 text-hermes-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
        >
          {/* 闪电 - 品牌主图标（zap 保留） */}
          <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      </div>

      {/* 标题与副标题（v1.3.1: 升级对比度 - surface-950 主标题，surface-700 副标题） */}
      <h1 className="text-2xl md:text-3xl font-semibold text-surface-950 mb-1.5 tracking-tight">
        你好，我是智能体调度平台
      </h1>
      <p className="text-xs text-surface-700 mb-1 tracking-wide">基于 Hermes 内核</p>
      <p className="text-sm text-surface-600 mb-8">今天需要我为你做些什么吗？</p>

      {/* v1.3.1：4 个快速提示词卡片（提升对比度：标题 text-surface-950，描述 text-surface-700） */}
      <div className="w-full max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p.title}
            type="button"
            onClick={() => onSelectPrompt(p.prompt)}
            className={`group relative flex items-start gap-3 p-3.5 rounded-xl
                        bg-surface-200/60 border border-surface-400/60
                        hover:border-hermes-400/80 hover:bg-surface-300/80
                        hover:shadow-md
                        text-left transition-all duration-200 ease-out
                        hover:-translate-y-0.5`}
          >
            {/* 图标容器（带渐变背景） */}
            <div
              className={`flex-shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br ${p.accent}
                          flex items-center justify-center
                          group-hover:scale-110 transition-transform duration-200`}
            >
              {p.icon}
            </div>

            {/* 文本内容 */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-surface-950 group-hover:text-hermes-500 transition-colors">
                {p.title}
              </div>
              <div className="text-xs text-surface-600 mt-0.5 line-clamp-1">
                {p.description}
              </div>
            </div>

            {/* 右侧箭头（悬停时显示） */}
            <svg
              className="flex-shrink-0 w-4 h-4 text-surface-700 group-hover:text-hermes-400 group-hover:translate-x-0.5 transition-all duration-200 mt-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
