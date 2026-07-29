/**
 * # ============================================================
 * Design Tokens - 统一设计系统入口（v6.34.0 P1-3 新增）
 * # ============================================================
 * 核心作用：集中导出所有设计 token（颜色/间距/圆角/动画/阴影），
 *           供 JS/TS 代码使用，与 Tailwind config + index.css 保持一一对应
 * 设计原则：
 *   - 与 tailwind.config.ts 颜色变量一一对应
 *   - 与 index.css CSS 变量一一对应
 *   - 全部 TypeScript 类型化（IDE 自动补全）
 *   - 支持深色/浅色主题切换
 * 使用场景：
 *   - JS 动态计算颜色（不再硬编码 hex）
 *   - 编程式生成主题样式
 *   - 单元测试中对比/校验
 * 依赖：与 tailwind.config + index.css 同步
 * ============================================================
 */

import type {
  ColorTokens,
  SpacingTokens,
  RadiusTokens,
  ShadowTokens,
  EasingTokens,
  FontSizeTokens,
  FontWeightTokens,
  DurationTokens,
  ZIndexTokens,
  BreakpointTokens,
} from './designTokens.types';

// ============================================================
// 品牌色（Hermes 金橙主题）
// ============================================================
export const colors: ColorTokens = {
  hermes: {
    50: '#fef9f0',
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
  surface: {
    50: '#0a0a0f',
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
  semantic: {
    success: '#10b981',
    error: '#f43f5e',
    warning: '#f59e0b',
    info: '#0ea5e9',
  },
} as const;

// ============================================================
// 语义色（按用途）
// ============================================================
export const semanticColors: {
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  borderHover: string;
  accent: string;
  accentHover: string;
} = {
  bgPrimary: colors.surface[100],
  bgSecondary: colors.surface[200],
  bgTertiary: colors.surface[300],
  textPrimary: '#e5e5e5',
  textSecondary: '#a3a3a3',
  textTertiary: '#737373',
  border: 'rgba(255,255,255,0.08)',
  borderHover: 'rgba(240,160,48,0.4)',
  accent: colors.hermes[500],
  accentHover: colors.hermes[400],
};

// ============================================================
// 间距阶梯（基于 4px 网格）
// ============================================================
export const spacing: SpacingTokens = {
  0: '0px',
  px: '1px',
  0.5: '2px',
  1: '4px',
  1.5: '6px',
  2: '8px',
  2.5: '10px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
  24: '96px',
} as const;

// ============================================================
// 圆角阶梯
// ============================================================
export const radius: RadiusTokens = {
  none: '0px',
  xs: '4px',
  sm: '6px',
  md: '10px',
  lg: '16px',
  xl: '24px',
  '2xl': '32px',
  full: '9999px',
} as const;

// ============================================================
// 阴影阶梯
// ============================================================
export const shadows: ShadowTokens = {
  'level-1': '0 1px 2px 0 rgba(0,0,0,0.25), 0 1px 3px 0 rgba(0,0,0,0.15)',
  'level-2': '0 4px 6px -1px rgba(0,0,0,0.30), 0 2px 4px -1px rgba(0,0,0,0.20)',
  'level-3': '0 10px 15px -3px rgba(0,0,0,0.40), 0 4px 6px -2px rgba(0,0,0,0.20)',
  'level-4': '0 25px 50px -12px rgba(0,0,0,0.60)',
  'glow-hermes-sm': '0 0 8px rgba(240,160,48,0.25)',
  'glow-hermes': '0 0 24px rgba(240,160,48,0.35)',
  'glow-hermes-lg': '0 0 48px rgba(240,160,48,0.45), 0 0 12px rgba(240,160,48,0.30)',
  'inner-hairline': 'inset 0 0 0 1px rgba(255,255,255,0.06)',
} as const;

// ============================================================
// 缓动曲线
// ============================================================
export const easings: EasingTokens = {
  linear: 'linear',
  material: 'cubic-bezier(0.4, 0, 0.2, 1)',
  expressive: 'cubic-bezier(0.16, 1, 0.3, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
  easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
  easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

// ============================================================
// 字号阶梯
// ============================================================
export const fontSize: FontSizeTokens = {
  xs: '12px',
  sm: '14px',
  base: '16px',
  lg: '18px',
  xl: '24px',
  '2xl': '32px',
  '3xl': '48px',
  '4xl': '64px',
} as const;

// ============================================================
// 字重阶梯
// ============================================================
export const fontWeight: FontWeightTokens = {
  thin: 100,
  extralight: 200,
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
} as const;

// ============================================================
// 动画时长（毫秒）
// ============================================================
export const durations: DurationTokens = {
  instant: 100,
  fast: 150,
  default: 200,
  slow: 280,
  slower: 400,
  500: 500,
  700: 700,
  1000: 1000,
} as const;

// ============================================================
// z-index 层级
// ============================================================
export const zIndex: ZIndexTokens = {
  base: 0,
  dropdown: 1000,
  sticky: 1100,
  fixed: 1200,
  modalBackdrop: 1300,
  modal: 1400,
  popover: 1500,
  tooltip: 1600,
  toast: 1700,
  notification: 1800,
} as const;

// ============================================================
// 断点（像素）
// ============================================================
export const breakpoints: BreakpointTokens = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

// ============================================================
// 工具函数
// ============================================================

/**
 * 颜色加深（用于 hover 态）
 * - 简单实现：与黑色按比例混合
 * - 注：仅作为 fallback，生产场景建议使用 Tailwind 的 hover: 前缀
 */
export function darken(hex: string, amount: number = 0.1): string {
  // 期望 #RRGGBB
  const match = hex.match(/^#([0-9a-f]{6})$/i);
  if (!match) return hex;
  const num = parseInt(match[1], 16);
  const r = Math.max(0, Math.floor(((num >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.floor(((num >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.floor((num & 0xff) * (1 - amount)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * 颜色变亮
 */
export function lighten(hex: string, amount: number = 0.1): string {
  const match = hex.match(/^#([0-9a-f]{6})$/i);
  if (!match) return hex;
  const num = parseInt(match[1], 16);
  const r = Math.min(255, Math.floor(((num >> 16) & 0xff) + 255 * amount));
  const g = Math.min(255, Math.floor(((num >> 8) & 0xff) + 255 * amount));
  const b = Math.min(255, Math.floor((num & 0xff) + 255 * amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * rgba 转换（hex + alpha）
 */
export function withAlpha(hex: string, alpha: number): string {
  const match = hex.match(/^#([0-9a-f]{6})$/i);
  if (!match) return hex;
  const r = (parseInt(match[1].slice(0, 2), 16));
  const g = (parseInt(match[1].slice(2, 4), 16));
  const b = (parseInt(match[1].slice(4, 6), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 全部 token 聚合
 */
export const tokens = {
  colors,
  semanticColors,
  spacing,
  radius,
  shadows,
  easings,
  fontSize,
  fontWeight,
  durations,
  zIndex,
  breakpoints,
} as const;

export default tokens;
