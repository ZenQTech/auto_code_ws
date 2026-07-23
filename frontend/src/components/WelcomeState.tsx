/**
 * # ============================================================
 * # 启动欢迎页组件 - WelcomeState
 * # ============================================================
 * # 核心作用：在用户首次打开或新建空 Session 时显示品牌欢迎页，
 * #           仅展示三行招呼语（品牌插画 + 标题/副标题 + 引导提问），
 * #           4 个快速入口卡片已在 v1.2.0 删除（编程模式下为信息噪音）。
 * # 运行流程：
 * #   1. App.tsx 检测当前 Session 无消息（messages.length === 0）时渲染本组件
 * #   2. 整体应用渐入动画（fade + slide up = animate-lift-in）
 * #   3. 父组件传入 onSelectPrompt 回调（v1.2.0 保留接口，但暂不触发，
 * #      因为不再渲染快速入口卡片，预留未来扩展能力）
 * # 输入参数：
 * #   - onSelectPrompt: (prompt: string) => void
 * #     预留快速入口回调（v1.2.0 起未使用，但保留签名以便未来扩展）
 * # 输出结果：品牌插画（圆形渐变 + 闪电）+ 标题/副标题 + 引导提问
 * # 复用说明：
 * #   - 无复用（全新组件，仅引用全局 Tailwind 工具类与 design token）
 * #   - lucide-react 未安装，使用 inline SVG 作为闪电图标（保持零额外依赖）
 * # 修改记录：
 * #   - 2026-06-24 | v1.0.0 | 初始版本：品牌插画 + 4 快速入口卡片 + 阶梯渐入动画（豆包风格）
 * #   - 2026-06-24 | v1.1.0 | 招呼语文案更新（三行结构 + 引导提问）
 * #   - 2026-06-24 | v1.2.0 | 删除 4 个快速入口卡片（编程模式下为信息噪音）
 * # ============================================================
 */

/**
 * WelcomeState 组件 Props
 */
export interface WelcomeStateProps {
  /**
   * 用户点击快速入口卡片时触发，回调参数为该卡片预设的 prompt
   * v1.2.0 状态：保留接口签名，但组件内已不渲染快速入口卡片
   * 当前未使用，使用下划线前缀避免未使用变量警告
   */
  onSelectPrompt: (prompt: string) => void;
}

/**
 * 启动欢迎页组件
 * - 整体使用 flex 居中布局：插画 → 标题/副标题 → 引导提问
 * - 渐入动画使用全局已定义的 .animate-lift-in（等价于 fade-in-up）
 * - v1.2.0：删除 4 个快速入口卡片，仅保留品牌招呼语
 * - 引导提问 `mb-0`（不再为已删除的卡片预留空间）
 */
export default function WelcomeState({ onSelectPrompt: _onSelectPrompt }: WelcomeStateProps) {
  // _onSelectPrompt 暂未使用，预留接口（保留 props 签名以备未来扩展）
  void _onSelectPrompt;
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 animate-lift-in">
      {/* 品牌插画：圆形渐变 + 闪电图标（Hermes 主色） */}
      <div className="w-24 h-24 rounded-full bg-gradient-to-br from-hermes-100 to-hermes-200 flex items-center justify-center shadow-glow-hermes mb-6">
        <svg
          className="w-12 h-12 text-hermes-500"
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

      {/* 标题与副标题（v1.1.0 三行结构：主标题 / 副标题 / 引导提问） */}
      <h1 className="text-h1 text-surface-900 mb-2">你好，我是智能体调度平台</h1>
      <p className="text-caption text-surface-500 mb-3">基于 Hermes 内核</p>
      <p className="text-body text-surface-600 mb-0">今天需要我为你做些什么吗？</p>
    </div>
  );
}
