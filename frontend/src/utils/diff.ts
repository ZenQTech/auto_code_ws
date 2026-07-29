/**
 * # ============================================================
 * # Diff 工具库 (v6.33.0 P0-6)
 * # ============================================================
 * # 核心作用：提供 3 种粒度的文本 diff 能力（行级 / 词级 / 字符级）
 * # 解决问题：当前 DiffView 仅显示 git diff 行级输出，无法突出
 * #         单词/字符级修改，影响代码审查效率
 * # 运行流程：
 * #   1. 基于 diff-match-patch 实现
 * #   2. 提供 lineDiff（行级）/ wordDiff（词级）/ charDiff（字符级）
 * #   3. 提供统一的 DiffSegment[] 输出（前端可直接渲染）
 * #   4. 提供色盲友好的 type 字段（equal/insert/delete）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 15 P0-6 初始化
 * # ============================================================
 */

import DiffMatchPatch from 'diff-match-patch';

// ============================================================
// 类型定义
// ============================================================

/** 单个 diff 片段 */
export interface DiffSegment {
  /** 片段类型 */
  type: 'equal' | 'insert' | 'delete';
  /** 片段文本 */
  text: string;
}

/** diff 粒度 */
export type DiffGranularity = 'line' | 'word' | 'char';

/** diff 统计 */
export interface DiffStats {
  /** 新增行/词/字符数 */
  added: number;
  /** 删除行/词/字符数 */
  removed: number;
  /** 未变行/词/字符数 */
  equal: number;
  /** 总计 */
  total: number;
}

// ============================================================
// diff-match-patch 单例
// ============================================================
const dmp = new DiffMatchPatch();
/** 默认超时 1 秒（防止大文件卡死） */
dmp.Diff_Timeout = 1.0;

// ============================================================
// 行级 diff
// ============================================================

/**
 * 行级 diff：逐行比较两个文本
 * @param oldText 旧文本
 * @param newText 新文本
 * @returns DiffSegment[] 数组
 */
export function lineDiff(oldText: string, newText: string): DiffSegment[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  // 使用 LCS 算法做行级 diff
  const lcs = longestCommonSubsequence(oldLines, newLines);
  const segments: DiffSegment[] = [];
  let i = 0, j = 0;
  for (const [oldI, newI] of lcs) {
    // 删除 oldLines[i..oldI)
    while (i < oldI) {
      segments.push({ type: 'delete', text: oldLines[i] + '\n' });
      i++;
    }
    // 插入 newLines[j..newI)
    while (j < newI) {
      segments.push({ type: 'insert', text: newLines[j] + '\n' });
      j++;
    }
    // 共同部分
    segments.push({ type: 'equal', text: oldLines[i] + '\n' });
    i++;
    j++;
  }
  // 剩余删除
  while (i < oldLines.length) {
    segments.push({ type: 'delete', text: oldLines[i] + '\n' });
    i++;
  }
  // 剩余插入
  while (j < newLines.length) {
    segments.push({ type: 'insert', text: newLines[j] + '\n' });
    j++;
  }
  return segments;
}

// ============================================================
// 词级 diff（基于 diff-match-patch）
// ============================================================

/**
 * 词级 diff：使用 diff-match-patch 的 wordMode
 * @param oldText 旧文本
 * @param newText 新文本
 * @returns DiffSegment[] 数组
 */
export function wordDiff(oldText: string, newText: string): DiffSegment[] {
  // 启用 wordMode（按词分割而非字符）
  dmp.Diff_Timeout = 1.0;
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(diffs);
  return diffs.map(([op, text]) => ({
    type: op === 0 ? 'equal' : op === 1 ? 'insert' : 'delete',
    text,
  }));
}

// ============================================================
// 字符级 diff（基于 diff-match-patch）
// ============================================================

/**
 * 字符级 diff：字符级粒度
 * @param oldText 旧文本
 * @param newText 新文本
 * @returns DiffSegment[] 数组
 */
export function charDiff(oldText: string, newText: string): DiffSegment[] {
  dmp.Diff_Timeout = 1.0;
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupEfficiency(diffs);
  return diffs.map(([op, text]) => ({
    type: op === 0 ? 'equal' : op === 1 ? 'insert' : 'delete',
    text,
  }));
}

// ============================================================
// 统一 diff 函数（按粒度路由）
// ============================================================

/**
 * 按指定粒度计算 diff
 * @param oldText 旧文本
 * @param newText 新文本
 * @param granularity 粒度（行/词/字符）
 * @returns DiffSegment[] 数组
 */
export function computeDiff(
  oldText: string,
  newText: string,
  granularity: DiffGranularity = 'word'
): DiffSegment[] {
  switch (granularity) {
    case 'line':
      return lineDiff(oldText, newText);
    case 'word':
      return wordDiff(oldText, newText);
    case 'char':
      return charDiff(oldText, newText);
    default:
      return wordDiff(oldText, newText);
  }
}

// ============================================================
// diff 统计
// ============================================================

/**
 * 计算 diff 统计
 * @param segments DiffSegment[] 数组
 * @returns 统计信息
 */
export function computeStats(segments: DiffSegment[]): DiffStats {
  let added = 0, removed = 0, equal = 0;
  for (const seg of segments) {
    // 按换行符计数（避免长行/单词重复计数）
    const lines = seg.text.split('\n').length - 1 || 1;
    if (seg.type === 'insert') added += lines;
    else if (seg.type === 'delete') removed += lines;
    else equal += lines;
  }
  return { added, removed, equal, total: added + removed + equal };
}

// ============================================================
// 工具：最长公共子序列（LCS，行级 diff 内部使用）
// ============================================================
function longestCommonSubsequence(
  a: string[],
  b: string[]
): Array<[number, number]> {
  const m = a.length;
  const n = b.length;
  // dp[i][j] = LCS length of a[0..i) and b[0..j)
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  // 回溯
  const result: Array<[number, number]> = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return result;
}

// ============================================================
// 颜色映射（色盲友好：颜色 + 图标 + 形状）
// ============================================================

/** diff 片段的视觉配置 */
export interface SegmentStyle {
  /** 背景色（Tailwind class） */
  bg: string;
  /** 文字色（Tailwind class） */
  text: string;
  /** 图标前缀（色盲模式） */
  icon: string;
}

/**
 * 获取片段视觉样式
 * @param type 片段类型
 * @param colorBlindMode 是否色盲模式
 * @returns 样式
 */
export function getSegmentStyle(
  type: DiffSegment['type'],
  colorBlindMode = false
): SegmentStyle {
  if (colorBlindMode) {
    // 色盲模式：使用图标 + 形状（不依赖颜色）
    switch (type) {
      case 'insert':
        return { bg: 'bg-green-100', text: 'text-green-900', icon: '+' };
      case 'delete':
        return { bg: 'bg-red-100', text: 'text-red-900', icon: '-' };
      case 'equal':
        return { bg: 'bg-transparent', text: 'text-surface-700', icon: ' ' };
    }
  } else {
    // 普通模式：依赖颜色
    switch (type) {
      case 'insert':
        return { bg: 'bg-green-50', text: 'text-green-900', icon: '' };
      case 'delete':
        return { bg: 'bg-red-50', text: 'text-red-900', icon: '' };
      case 'equal':
        return { bg: 'bg-transparent', text: 'text-surface-700', icon: '' };
    }
  }
}
