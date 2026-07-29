/**
 * # ============================================================
 * Fuzzy Search - 模糊搜索工具（v6.34.0 P1-5 新增）
 * # ============================================================
 * 核心作用：实现轻量级模糊搜索（无外部依赖），用于：
 *   - Cmd+I / Ctrl+P 命令面板
 *   - @ mention 触发的人/Agent/技能搜索
 *   - 文件名快速跳转
 * 算法：
 *   1. 大小写不敏感匹配
 *   2. 字符连续匹配加分
 *   3. 单词起始字符匹配加分
 *   4. 完全匹配返回最高分
 * 性能：O(n*m)，n 为查询长度，m 为候选项长度
 * ============================================================
 */

export interface FuzzyItem {
  /** 唯一 ID */
  id: string;
  /** 主标题（高匹配权重） */
  title: string;
  /** 副标题（低匹配权重） */
  subtitle?: string;
  /** 关键词列表（用于 @ mention 触发） */
  keywords?: string[];
  /** 图标或 emoji */
  icon?: string;
  /** 任意附加数据 */
  meta?: Record<string, unknown>;
}

export interface FuzzyResult<T extends FuzzyItem = FuzzyItem> {
  item: T;
  /** 匹配分数 0-1，1 为完全匹配 */
  score: number;
  /** 高亮的字符位置（用于前端展示） */
  matches: number[];
}

/**
 * 计算单个候选项的匹配分数
 * @returns 0-1 之间的分数；0 表示不匹配
 */
function scoreItem(query: string, item: FuzzyItem): { score: number; matches: number[] } {
  if (!query) {
    return { score: 1, matches: [] };
  }

  const q = query.toLowerCase();
  const title = item.title.toLowerCase();
  const subtitle = item.subtitle?.toLowerCase() ?? '';
  const keywords = (item.keywords ?? []).map((k) => k.toLowerCase());

  // 完全相等
  if (title === q || subtitle === q) {
    return { score: 1, matches: Array.from({ length: title.length }, (_, i) => i) };
  }

  // 标题起始
  if (title.startsWith(q)) {
    return {
      score: 0.95,
      matches: Array.from({ length: q.length }, (_, i) => i),
    };
  }

  let bestScore = 0;
  let bestMatches: number[] = [];

  // 标题字符连续匹配
  const titleScore = continuousMatch(q, title);
  if (titleScore.score > bestScore) {
    bestScore = titleScore.score * 0.9;
    bestMatches = titleScore.matches;
  }

  // 副标题字符连续匹配（权重 0.6）
  if (subtitle) {
    const subScore = continuousMatch(q, subtitle);
    if (subScore.score * 0.6 > bestScore) {
      bestScore = subScore.score * 0.6;
      bestMatches = subScore.matches;
    }
  }

  // 关键词完全匹配（权重 0.7）
  for (const kw of keywords) {
    if (kw === q) {
      bestScore = Math.max(bestScore, 0.7);
      break;
    }
    if (kw.startsWith(q)) {
      bestScore = Math.max(bestScore, 0.65);
    }
  }

  return { score: bestScore, matches: bestMatches };
}

/**
 * 字符连续匹配：查找 query 中所有字符在 target 中的连续匹配位置
 * 允许中间有间隔，但连续匹配加分
 */
function continuousMatch(query: string, target: string): { score: number; matches: number[] } {
  if (!query) return { score: 0, matches: [] };
  if (target.includes(query)) {
    const idx = target.indexOf(query);
    return {
      score: 1,
      matches: Array.from({ length: query.length }, (_, i) => idx + i),
    };
  }

  const matches: number[] = [];
  let targetIdx = 0;
  let consecutive = 0;
  let consecutiveBonus = 0;

  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    let foundIdx = -1;
    // 从 targetIdx 之后查找
    for (let j = targetIdx; j < target.length; j++) {
      if (target[j] === ch) {
        foundIdx = j;
        break;
      }
    }
    if (foundIdx === -1) {
      // 字符未找到，重置连续计数
      consecutive = 0;
      continue;
    }
    matches.push(foundIdx);
    if (foundIdx === targetIdx) {
      // 与上一个匹配连续
      consecutive++;
      consecutiveBonus += consecutive * 5;
    } else {
      consecutive = 1;
    }
    targetIdx = foundIdx + 1;
  }

  // 全部字符都匹配上才算命中
  if (matches.length !== query.length) {
    return { score: 0, matches: [] };
  }

  // 基础分 = 匹配字符数 / query 长度
  const base = 0.5;
  // 单词起始字符加分（target[i] 前面是空格或起始）
  let wordStartBonus = 0;
  for (const m of matches) {
    if (m === 0 || target[m - 1] === ' ' || target[m - 1] === '-' || target[m - 1] === '_') {
      wordStartBonus += 0.1;
    }
  }
  // 连续字符加分
  const totalScore = Math.min(1, base + wordStartBonus + consecutiveBonus / 100);
  return { score: totalScore, matches };
}

/**
 * 在候选列表中执行模糊搜索
 * @param query 搜索关键词
 * @param items 候选项
 * @param limit 返回数量上限
 */
export function fuzzySearch<T extends FuzzyItem>(
  query: string,
  items: T[],
  limit: number = 10
): FuzzyResult<T>[] {
  if (!query) {
    return items.slice(0, limit).map((item) => ({ item, score: 1, matches: [] }));
  }

  const results: FuzzyResult<T>[] = [];
  for (const item of items) {
    const { score, matches } = scoreItem(query, item);
    if (score > 0) {
      results.push({ item, score, matches });
    }
  }

  // 按分数降序
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * 提取 @ mention 触发关键词
 * 输入 "Hello @age how are you @file"
 * 输出 ["age", "file"]
 */
export function extractMentions(text: string): string[] {
  const matches = text.match(/@([\w\u4e00-\u9fff-]+)/g) ?? [];
  return matches.map((m) => m.slice(1));
}

/**
 * 高亮匹配字符（用于前端展示）
 * @param text 原始文本
 * @param matches 高亮位置数组
 * @returns HTML 字符串（带 <mark> 标签）
 */
export function highlightMatches(text: string, matches: number[]): string {
  if (matches.length === 0) return escapeHtml(text);
  const set = new Set(matches);
  let result = '';
  for (let i = 0; i < text.length; i++) {
    if (set.has(i)) {
      result += `<mark>${escapeHtml(text[i])}</mark>`;
    } else {
      result += escapeHtml(text[i]);
    }
  }
  return result;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default fuzzySearch;
