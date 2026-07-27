/**
 * # ============================================================
 * 消息格式化工具函数
 * # ============================================================
 * 核心作用：从 App.tsx 抽离的纯函数工具（无 React 依赖）
# 抽取日期：2026-07-27
# 模块版本：v6.4.0 - P0-2 App.tsx 拆分第一阶段
 * 修改记录：
 *   - 2026-07-27 | v6.4.0 | 从 App.tsx 抽离 formatTokens / extractSummary / extractQuestions
 */

/**
 * 格式化 Token 数量，使用 K/M 后缀
 * @param n - Token 数量
 * @returns 格式化后的字符串（如 "1.5K" / "2.3M"）
 */
export function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

/**
 * v3.1.0：从澄清消息内容中提取 AI 需求总结部分
 * 提取 "### 需要您补充以下信息" 之前的所有内容作为 summary
 * 参数：
 *   - content: 完整的澄清消息 Markdown 文本
 * 返回值：提取的 summary 文本（不含澄清问题部分）
 */
export function extractSummary(content: string): string {
  const idx = content.indexOf('### 需要您补充以下信息');
  if (idx > 0) return content.substring(0, idx).trim();
  // 兼容纯文本格式：查找 "需要您补充以下信息"
  const idx2 = content.indexOf('需要您补充以下信息');
  if (idx2 > 0) return content.substring(0, idx2).trim();
  return '';
}

/**
 * v3.1.0：从澄清消息内容中解析结构化问题列表
 * 支持的格式：
 *   - Markdown: "- **【维度名】** 问题描述（重要性：high/medium/low）"
 *   - 纯文本: "- 【维度名】 问题描述（重要性：high/medium/low）"
 * 参数：
 *   - content: 完整的澄清消息文本
 * 返回值：解析后的问题数组，每项含 dimension/question/importance
 */
export function extractQuestions(
  content: string,
): Array<{ dimension: string; question: string; importance: 'high' | 'medium' | 'low' }> {
  const questions: Array<{ dimension: string; question: string; importance: 'high' | 'medium' | 'low' }> = [];
  // 匹配 Markdown 格式：- **【维度名】** 描述（重要性：xxx）
  const mdRegex = /- \*\*【(.+?)】\*\*\s*(.+?)（重要性：(\w+)）/g;
  let match;
  while ((match = mdRegex.exec(content)) !== null) {
    questions.push({
      dimension: match[1],
      question: match[2].trim(),
      importance: match[3] as 'high' | 'medium' | 'low',
    });
  }
  // 若 Markdown 格式未匹配到，尝试纯文本格式
  if (questions.length === 0) {
    const txtRegex = /- 【(.+?)】\s*(.+?)（重要性：(\w+)）/g;
    while ((match = txtRegex.exec(content)) !== null) {
      questions.push({
        dimension: match[1],
        question: match[2].trim(),
        importance: match[3] as 'high' | 'medium' | 'low',
      });
    }
  }
  return questions;
}

/**
 * 对话消息类型定义（与 App.tsx 保持一致）
 */
export interface ChatMessage {
  /** 消息唯一标识 */
  id: string;
  /** 消息角色：user（用户）或 hermes（Hermes） */
  role: 'user' | 'hermes';
  /** 消息文本内容 */
  content: string;
  /** 消息时间戳（毫秒） */
  timestamp: number;
  /** 思考过程内容（仅 hermes 消息有值） */
  thinking?: string;
  /** 流式错误信息（非空时表示该消息处理失败） */
  error?: string;
}

/**
 * localStorage 键常量
 */
export const LS_CURRENT_SESSION_ID = 'current_session_id';
export const LS_APP_MODE = 'app_mode';
