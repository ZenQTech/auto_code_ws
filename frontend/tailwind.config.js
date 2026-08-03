/**
 * # ============================================================
 * # Tailwind CSS 配置文件 - Hermes 风格主题
 * # ============================================================
 * # 核心作用：定义 Hermes 品牌配色方案和深色表面色阶
 * # hermes 色阶：基于金橙色 #f0a030，50-950 全色阶
 * # surface 色阶：响应 [data-theme] 切换，引用 CSS 变量。
 * #               dark 模式使用深色阶，light 模式反转为浅色阶，
 * #               high-contrast 使用纯黑阶。
 * # ============================================================
 * # 修改记录：
 * #   v1.0.0 - 2026-06-17：初始版本，Hermes 主题色扩展
 * #   v1.1.0 - 2026-06-23：扩展 boxShadow / transitionTimingFunction / keyframes / 圆角阶梯
 * #   v1.2.0 - 2026-06-24：字体栈扩展（Inter + PingFang SC + Microsoft YaHei + Hiragino Sans GB） + message-toolbar-in 动画
 * #   v2.0.0 - 2026-08-03：G60-FIX-11 surface 调色板改为 CSS 变量驱动，
 * #                        使 bg-surface-* / text-surface-* / border-surface-* 等类响应主题切换。
 * #                        不再硬编码 dark 颜色，dark/light/high-contrast 三主题自动适配。
 * #   v2.0.1 - 2026-08-03：G60-FIX-17 启用 darkMode: selector 配置，
 * #                        让所有 dark: 修饰符在 [data-theme="dark"|"high-contrast"] 时自动生效，
 * #                        解决 MarketplacePanel/MemoryPanel 等大量 dark: 类失效问题
 * # ====================================
 */

/** @type {import('tailwindcss').Config} */
export default {
  // v2.0.1 G60-FIX-17: 启用 darkMode: ['selector', '[data-theme="dark"], [data-theme="high-contrast"]']
  // 这样所有 dark: 修饰符在 dark 和 high-contrast 主题下自动生效，修复大量
  // bg-white dark:bg-slate-X 等组件在主题切换后样式不跟随的问题
  darkMode: ['selector', '[data-theme="dark"], [data-theme="high-contrast"]'],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      /** 字体栈 - 中英文混排规范（豆包式） */
      fontFamily: {
        sans: ['Inter', 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', 'system-ui', 'sans-serif'],
      },
      colors: {
        /** Hermes 品牌色系 - 金橙色 */
        hermes: {
          50:  '#fef9f0',
          100: '#fef0d9',
          200: '#fde0b3',
          300: '#fccf8c',
          400: '#fbbf66',
          500: '#f0a030',
          600: '#d4891a',
          700: '#a66a14',
          800: '#784c0e',
          900: '#4a2f09',
          950: '#2d1c05',
        },
        /**
         * v2.0.0 G60-FIX-11 / G60-FIX-15: 主题感知的 surface 调色板
         * 通过 RGB 通道 + CSS 变量驱动，dark/light/high-contrast 三主题自动适配。
         * 索引映射：
         *   50/100  -> --bg-app / --bg-panel  （页面/卡片背景）
         *   200/300 -> --bg-elevated          （抬升层背景）
         *   400/500 -> --border-color 相关色阶
         *   600-950 -> --text-primary/secondary/tertiary 渐变
         *
         * 使用 rgb(var(--surface-N-rgb) / <alpha-value>) 格式：
         *   - 支持 bg-surface-50/30 等 Tailwind 透明度修饰符
         *   - CSS 变量切换主题时颜色自动更新
         *   - SSR/单元测试时（变量未定义）回退到 fallback RGB 值
         */
        surface: {
          50:  'rgb(var(--surface-50-rgb,  10 10 15) / <alpha-value>)',
          100: 'rgb(var(--surface-100-rgb, 18 18 26) / <alpha-value>)',
          200: 'rgb(var(--surface-200-rgb, 26 26 36) / <alpha-value>)',
          300: 'rgb(var(--surface-300-rgb, 34 34 46) / <alpha-value>)',
          400: 'rgb(var(--surface-400-rgb, 42 37 32) / <alpha-value>)',
          500: 'rgb(var(--surface-500-rgb, 58 53 48) / <alpha-value>)',
          600: 'rgb(var(--surface-600-rgb, 74 69 64) / <alpha-value>)',
          700: 'rgb(var(--surface-700-rgb, 90 85 80) / <alpha-value>)',
          800: 'rgb(var(--surface-800-rgb, 106 101 96) / <alpha-value>)',
          900: 'rgb(var(--surface-900-rgb, 122 117 112) / <alpha-value>)',
          950: 'rgb(var(--surface-950-rgb, 138 133 128) / <alpha-value>)',
        },
        /**
         * v2.0.0 G60-FIX-15: 文字 surface 调色板（与 tailwind textSurface 对齐）
         * text-surface-50 → 标题（暗主题时为白色，亮主题时为深色）
         */
        textSurface: {
          50:  'rgb(var(--text-surface-50-rgb,  255 255 255) / <alpha-value>)',
          100: 'rgb(var(--text-surface-100-rgb, 240 240 244) / <alpha-value>)',
          500: 'rgb(var(--text-surface-500-rgb, 163 163 176) / <alpha-value>)',
          700: 'rgb(var(--text-surface-700-rgb, 90 85 80) / <alpha-value>)',
          900: 'rgb(var(--text-surface-900-rgb, 10 10 10) / <alpha-value>)',
        },
      },
      /** 全局过渡动画时长 */
      transitionDuration: {
        DEFAULT: '300ms',
        instant: '100ms',
        fast: '150ms',
        default: '200ms',
        slow: '280ms',
        slower: '400ms',
      },
      /** 全局过渡曲线（cubic-bezier） */
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.4, 0, 0.2, 1)',
        material: 'cubic-bezier(0.4, 0, 0.2, 1)',
        expressive: 'cubic-bezier(0.16, 1, 0.3, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        standard: 'cubic-bezier(0.2, 0, 0, 1)',
      },
      /** 分级阴影 + Hermes 主色调光晕 */
      boxShadow: {
        'level-1': '0 1px 2px 0 rgba(0,0,0,0.25), 0 1px 3px 0 rgba(0,0,0,0.15)',
        'level-2': '0 4px 6px -1px rgba(0,0,0,0.30), 0 2px 4px -1px rgba(0,0,0,0.20)',
        'level-3': '0 10px 15px -3px rgba(0,0,0,0.40), 0 4px 6px -2px rgba(0,0,0,0.20)',
        'level-4': '0 25px 50px -12px rgba(0,0,0,0.60)',
        'glow-hermes': '0 0 24px rgba(240,160,48,0.35)',
        'glow-hermes-lg': '0 0 48px rgba(240,160,48,0.45), 0 0 12px rgba(240,160,48,0.30)',
        'glow-hermes-sm': '0 0 8px rgba(240,160,48,0.25)',
        'inner-hairline': 'inset 0 0 0 1px rgba(255,255,255,0.06)',
      },
      /** 圆角阶梯（保留 Tailwind 默认基础上扩展） */
      borderRadius: {
        xs: '4px',
        sm: '6px',
        md: '10px',
        lg: '16px',
        xl: '24px',
        '2xl': '32px',
      },
      /** 全局动画关键帧 */
      keyframes: {
        'fade-in': {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-down': {
          '0%':   { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-up': {
          '0%':   { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%':   { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.5' },
        },
        'glow-pulse': {
          '0%, 100%': { opacity: '0.6' },
          '50%':      { opacity: '1' },
        },
        'shimmer': {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'lift': {
          '0%':   { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(-2px)' },
        },
        'press': {
          '0%':   { transform: 'scale(1)' },
          '50%':  { transform: 'scale(0.97)' },
          '100%': { transform: 'scale(1)' },
        },
        'collapse-height': {
          '0%':   { maxHeight: '0',    opacity: '0' },
          '100%': { maxHeight: '500px', opacity: '1' },
        },
        'breathing-highlight': {
          '0%':   { boxShadow: '0 0 0 0 rgba(240,160,48,0.0)' },
          '30%':  { boxShadow: '0 0 0 4px rgba(240,160,48,0.35)' },
          '100%': { boxShadow: '0 0 0 0 rgba(240,160,48,0)' },
        },
        'message-toolbar-in': {
          '0%':   { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // 不确定进度条动画：左→右循环
        'progress-indeterminate': {
          '0%':   { transform: 'translateX(-100%)' },
          '50%':  { transform: 'translateX(0%)' },
          '100%': { transform: 'translateX(200%)' },
        },
        // 进度条收缩动画：右→左
        'shrink-width': {
          '0%':   { width: '100%' },
          '100%': { width: '0%' },
        },
      },
      /** 全局动画类 */
      animation: {
        'fade-in':     'fade-in 0.3s ease-out',
        'slide-down':  'slide-down 0.3s ease-out',
        'slide-up':    'slide-up 0.3s ease-out',
        'scale-in':    'scale-in 0.3s ease-out',
        'pulse-glow':  'pulse-glow 2s ease-in-out infinite',
        'glow-pulse':  'glow-pulse 2s ease-in-out infinite',
        'shimmer':     'shimmer 1.6s linear infinite',
        'press':       'press 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        'breathing-highlight': 'breathing-highlight 1.2s ease-out 1',
        'message-toolbar-in': 'message-toolbar-in 150ms cubic-bezier(0.4, 0, 0.2, 1)',
        'progress-indeterminate': 'progress-indeterminate 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
