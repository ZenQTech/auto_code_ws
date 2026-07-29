/**
 * # ============================================================
 * # Tailwind CSS 配置文件 - Hermes 风格主题
 * # ============================================================
 * # 核心作用：定义 Hermes 品牌配色方案和深色表面色阶
 * # hermes 色阶：基于金橙色 #f0a030，50-950 全色阶
 * # surface 色阶：深色表面色阶，用于卡片、面板等组件
 * # ============================================================
 * # 修改记录：
 * #   v1.0.0 - 2026-06-17：初始版本，Hermes 主题色扩展
 * #   v1.1.0 - 2026-06-23：扩展 boxShadow / transitionTimingFunction / keyframes / 圆角阶梯
 * #   v1.2.0 - 2026-06-24：字体栈扩展（Inter + PingFang SC + Microsoft YaHei + Hiragino Sans GB） + message-toolbar-in 动画
 * # ============================================================
 */

/** @type {import('tailwindcss').Config} */
export default {
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
        /** 深色表面色系 */
        surface: {
          50:  '#0a0a0f',
          100: '#12121a',
          200: '#1a1a24',
          300: '#22222e',
          400: '#2a2520',
          500: '#3a3530',
          600: '#4a4540',
          700: '#5a5550',
          800: '#6a6560',
          900: '#7a7570',
          950: '#8a8580',
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
