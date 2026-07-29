/**
 * # ============================================================
 * Design Tokens - 类型定义（v6.34.0 P1-3 新增）
 * # ============================================================
 * 集中导出所有设计 token 的 TypeScript 类型，供 IDE 自动补全与运行时校验
 * 设计原则：
 *   - 与 tailwind.config.ts 颜色变量一一对应
 *   - 与 index.css CSS 变量一一对应
 *   - 全部 TypeScript 类型化
 * 配套文件：
 *   - designTokens.ts（值导出）
 *   - useDesignTokens.ts（运行时 hook，含主题切换）
 * ============================================================
 */

/** Hermes 品牌色阶 50-950 */
export type HermesColorScale = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;
export type HermesColorMap = Record<HermesColorScale, string>;

/** 深色表面色阶 */
export type SurfaceColorScale = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;
export type SurfaceColorMap = Record<SurfaceColorScale, string>;

/** 语义色（success/error/warning/info） */
export interface SemanticColorMap {
  success: string;
  error: string;
  warning: string;
  info: string;
}

/** 颜色 token 总集 */
export interface ColorTokens {
  hermes: HermesColorMap;
  surface: SurfaceColorMap;
  semantic: SemanticColorMap;
}

/** 间距 token（基于 4px 网格） */
export interface SpacingTokens {
  0: string;
  px: string;
  0.5: string;
  1: string;
  1.5: string;
  2: string;
  2.5: string;
  3: string;
  4: string;
  5: string;
  6: string;
  8: string;
  10: string;
  12: string;
  16: string;
  20: string;
  24: string;
}

/** 圆角 token */
export interface RadiusTokens {
  none: string;
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  '2xl': string;
  full: string;
}

/** 阴影 token */
export interface ShadowTokens {
  'level-1': string;
  'level-2': string;
  'level-3': string;
  'level-4': string;
  'glow-hermes-sm': string;
  'glow-hermes': string;
  'glow-hermes-lg': string;
  'inner-hairline': string;
}

/** 缓动曲线 token */
export interface EasingTokens {
  linear: string;
  material: string;
  expressive: string;
  spring: string;
  standard: string;
  easeIn: string;
  easeOut: string;
  easeInOut: string;
}

/** 字号 token */
export interface FontSizeTokens {
  xs: string;
  sm: string;
  base: string;
  lg: string;
  xl: string;
  '2xl': string;
  '3xl': string;
  '4xl': string;
}

/** 字重 token */
export interface FontWeightTokens {
  thin: number;
  extralight: number;
  light: number;
  regular: number;
  medium: number;
  semibold: number;
  bold: number;
  extrabold: number;
}

/** 动画时长（毫秒） */
export interface DurationTokens {
  instant: number;
  fast: number;
  default: number;
  slow: number;
  slower: number;
  500: number;
  700: number;
  1000: number;
}

/** z-index 层级 */
export interface ZIndexTokens {
  base: number;
  dropdown: number;
  sticky: number;
  fixed: number;
  modalBackdrop: number;
  modal: number;
  popover: number;
  tooltip: number;
  toast: number;
  notification: number;
}

/** 断点（像素） */
export interface BreakpointTokens {
  sm: number;
  md: number;
  lg: number;
  xl: number;
  '2xl': number;
}

/** 全部 token 聚合 */
export interface AllTokens {
  colors: ColorTokens;
  spacing: SpacingTokens;
  radius: RadiusTokens;
  shadows: ShadowTokens;
  easings: EasingTokens;
  fontSize: FontSizeTokens;
  fontWeight: FontWeightTokens;
  durations: DurationTokens;
  zIndex: ZIndexTokens;
  breakpoints: BreakpointTokens;
}

/** 主题名 */
export type ThemeName = 'dark' | 'light' | 'high-contrast';

/** 主题映射 */
export type ThemeMap = Record<ThemeName, Partial<AllTokens>>;
