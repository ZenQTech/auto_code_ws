/**
 * # 思考阶段检测工具 (Cycle 15 P1-10)
 * # ============================================================
 * # 核心作用：根据 AI 思考过程的文本内容自动推断当前所处的推理阶段
 * #           支持 4 个阶段：分析(analysis) → 规划(planning) → 编码(coding) → 测试(testing)
 * # 运行流程：
 * #   1. 接收完整思考过程文本
 * #   2. 使用高效的字符串扫描找出阶段边界
 * #   3. 使用关键词列表扫描各阶段位置
 * #   4. 综合位置 + 关键词数量计算各阶段得分
 * #   5. 返回当前应该处于的阶段 + 阶段历史
 * # 输入参数：
 * #   - content: 完整的思考过程文本
 * # 输出结果：
 * #   - currentStage: 当前应该处于的阶段
 * #   - confidence: 置信度 0-1
 * #   - history: 阶段历史
 * #   - currentStartPos: 当前阶段在原文中的起始位置
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 15 P1-10 初始版本
 * #   - 2026-07-29 | v1.1.0 | 性能优化：限制文本扫描长度 + 简单字符串搜索
 * # ============================================================
 */

import type { ReasoningStage } from '../components/ThinkingBlock';

/** 阶段历史条目 */
export interface StageHistoryEntry {
  stage: Exclude<ReasoningStage, 'idle'>;
  startPos: number;
  endPos: number;
  summary: string;
}

/** 阶段检测结果 */
export interface DetectStageResult {
  currentStage: ReasoningStage;
  confidence: number;
  history: StageHistoryEntry[];
  currentStartPos: number;
}

/** 阶段顺序 */
const STAGE_ORDER: Array<Exclude<ReasoningStage, 'idle'>> = ['analysis', 'planning', 'coding', 'testing'];

/**
 * 阶段关键词列表（每个阶段一个字符串数组）
 * 性能：使用 indexOf 单次扫描，O(n*m)，n=文本长度，m=关键词数量
 *       对于常规 AI 思考文本（< 10K 字符），完全够用
 */
const STAGE_KEYWORDS: Record<Exclude<ReasoningStage, 'idle'>, string[]> = {
  analysis: [
    '需求分析', '理解需求', '需求理解', 'analyzing', 'analysis',
    'understand', 'analyze', '分析', '理解', '需求',
  ],
  planning: [
    '设计方案', '实现方案', '设计思路', '实现思路', '设计架构',
    'my plan', 'my approach', 'the plan', 'planning', 'design',
    'architecture', '规划', '设计', '方案', '计划', '策略', '思路', '架构', '步骤',
  ],
  coding: [
    '编写代码', '写代码', '实现函数', '实现类', '实现接口', '实现方法',
    'here is the code', 'write the function', 'write the code',
    'let me write', 'now let me write', 'implement', 'function',
    'interface', '编写', '实现', '代码', '函数', '方法', '类', '接口',
  ],
  testing: [
    '测试一下', '验证一下', '检查一下', '测试结果', '运行测试',
    'let me test', 'let me verify', 'i will test', 'test the',
    'verify the', 'check the', 'run the test', 'testing', 'verify',
    'verification', 'debug', '测试', '验证', '检查', '调试',
  ],
};

/** 阶段边界关键词（用于高置信度的阶段切换检测） */
const STAGE_BOUNDARY_KEYWORDS: Record<Exclude<ReasoningStage, 'idle'>, string[]> = {
  analysis: ['分析', '需求', '理解', 'analyze', 'analysis', 'understanding'],
  planning: ['规划', '设计', '方案', '计划', 'plan', 'planning', 'design', 'approach'],
  coding: ['实现', '代码', '编写', 'coding', 'implementation', 'code'],
  testing: ['测试', '验证', '检查', 'test', 'testing', 'verify'],
};

/** 性能限制：超过此长度的文本仅扫描尾部 */
const MAX_SCAN_LENGTH = 4000;

/** 从文本中提取第一行非空内容（用于阶段摘要） */
function extractFirstLine(text: string): string {
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed.length > 60 ? trimmed.slice(0, 57) + '...' : trimmed;
    }
  }
  return '';
}

/**
 * 在文本中查找关键词列表的最后一个匹配位置
 * 性能：O(n*m)，n=文本长度，m=关键词数量
 */
function findLastMatch(content: string, keywords: string[]): number {
  let bestPos = -1;
  let bestKeywordLen = 0;
  for (const keyword of keywords) {
    const pos = content.lastIndexOf(keyword);
    if (pos > bestPos || (pos === bestPos && keyword.length > bestKeywordLen)) {
      bestPos = pos;
      bestKeywordLen = keyword.length;
    }
  }
  return bestPos;
}

/**
 * 检测阶段边界（按 "## xxx:" 格式）
 * 性能：使用 indexOf 简单扫描
 */
function findStageBoundaries(content: string): Array<{ stage: Exclude<ReasoningStage, 'idle'>; pos: number }> {
  const boundaries: Array<{ stage: Exclude<ReasoningStage, 'idle'>; pos: number }> = [];
  // 扫描所有可能的边界起始位置
  let pos = 0;
  while (pos < content.length) {
    // 查找换行符
    const lineStart = pos === 0 ? 0 : pos;
    const lineEnd = content.indexOf('\n', lineStart);
    const line = content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
    // 检查是否是阶段边界行（包含 "## xxx:" 格式）
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#')) {
      // 提取 # 后面的内容
      const afterHash = trimmed.replace(/^#+\s*/, '');
      // 检查是否包含冒号
      const colonIdx = afterHash.search(/[:：]/);
      if (colonIdx > 0 && colonIdx < 20) {
        // 提取标题关键词
        const title = afterHash.slice(0, colonIdx).toLowerCase();
        for (const stage of STAGE_ORDER) {
          const keywords = STAGE_BOUNDARY_KEYWORDS[stage];
          for (const kw of keywords) {
            if (title.includes(kw.toLowerCase())) {
              boundaries.push({ stage, pos: lineStart });
              break;
            }
          }
          if (boundaries.length > 0 && boundaries[boundaries.length - 1].pos === lineStart) {
            break; // 已为该行找到一个阶段
          }
        }
      }
    }
    if (lineEnd === -1) break;
    pos = lineEnd + 1;
  }
  return boundaries;
}

/**
 * 推断当前阶段
 */
export function detectStage(content: string): DetectStageResult {
  if (!content || content.trim().length === 0) {
    return {
      currentStage: 'idle',
      confidence: 0,
      history: [],
      currentStartPos: 0,
    };
  }

  // 1. 检测阶段边界
  const boundaries = findStageBoundaries(content);

  // 2. 构建阶段历史
  const history: StageHistoryEntry[] = [];
  if (boundaries.length > 0) {
    for (let i = 0; i < boundaries.length; i++) {
      const boundary = boundaries[i];
      const nextBoundary = boundaries[i + 1];
      const endPos = nextBoundary ? nextBoundary.pos : content.length;
      const stageContent = content.slice(boundary.pos, endPos);
      history.push({
        stage: boundary.stage,
        startPos: boundary.pos,
        endPos,
        summary: extractFirstLine(stageContent),
      });
    }
  }

  // 3. 确定当前阶段
  let currentStage: ReasoningStage = 'idle';
  let currentStartPos = 0;
  let confidence = 0;

  if (history.length > 0) {
    const lastBoundary = boundaries[boundaries.length - 1];
    currentStage = lastBoundary.stage;
    currentStartPos = lastBoundary.pos;
    confidence = 1.0;
  } else {
    // 扫描关键词（仅扫描尾部以提升性能）
    const scanContent = content.length > MAX_SCAN_LENGTH
      ? content.slice(-MAX_SCAN_LENGTH)
      : content;
    const offset = content.length - scanContent.length;

    const stageBestPos: Record<Exclude<ReasoningStage, 'idle'>, number> = {
      analysis: -1,
      planning: -1,
      coding: -1,
      testing: -1,
    };
    for (const stage of STAGE_ORDER) {
      const pos = findLastMatch(scanContent, STAGE_KEYWORDS[stage]);
      if (pos !== -1) {
        stageBestPos[stage] = pos + offset;
      }
    }

    const matched = STAGE_ORDER.filter((s) => stageBestPos[s] !== -1);
    if (matched.length > 0) {
      // 取最靠后的阶段
      let winnerStage: Exclude<ReasoningStage, 'idle'> = matched[0];
      let winnerPos = stageBestPos[winnerStage];
      for (const s of matched) {
        if (stageBestPos[s] > winnerPos) {
          winnerStage = s;
          winnerPos = stageBestPos[s];
        }
      }
      currentStage = winnerStage;
      currentStartPos = winnerPos;
      // 置信度：靠近末尾 + 多个阶段都匹配 → 高置信度
      const distanceToEnd = content.length - winnerPos;
      const proximityBonus = distanceToEnd < 200 ? 0.2 : 0;
      const matchedCount = matched.length;
      const countBonus = matchedCount > 1 ? 0.1 : 0;
      confidence = Math.min(0.85, 0.5 + proximityBonus + countBonus);
    } else {
      currentStage = 'analysis';
      currentStartPos = 0;
      confidence = 0.2;
    }
  }

  return {
    currentStage,
    confidence,
    history,
    currentStartPos,
  };
}

/**
 * 根据阶段进度（0-1）推断当前应该处于的阶段
 */
export function inferStageFromProgress(progress: number): Exclude<ReasoningStage, 'idle'> {
  if (progress < 0.25) return 'analysis';
  if (progress < 0.5) return 'planning';
  if (progress < 0.8) return 'coding';
  return 'testing';
}

/**
 * 合并显式阶段和检测阶段
 * 优先级：显式阶段 > 检测阶段 > 进度推断阶段
 */
export function resolveStage(
  explicitStage: ReasoningStage | undefined,
  content: string,
  progress: number
): Exclude<ReasoningStage, 'idle'> {
  if (explicitStage && explicitStage !== 'idle') {
    return explicitStage;
  }
  const detected = detectStage(content);
  if (detected.confidence >= 0.5) {
    return detected.currentStage as Exclude<ReasoningStage, 'idle'>;
  }
  return inferStageFromProgress(progress);
}
