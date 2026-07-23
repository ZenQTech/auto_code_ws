/**
 * # ============================================================
 * # 共享缺陷严重程度颜色映射工具
 * # ============================================================
 * # 核心作用：将缺陷严重程度（DefectSeverity）映射为对应的
 * #           Tailwind 颜色类名和中文标签
 * # 输入参数：
 * #   - severity: DefectSeverity，缺陷严重程度枚举值
 * # 返回值：{ bg, text, label } 颜色样式对象
 * # 修改记录：
 * #   - 2026-06-25 | v1.0.0 | 从 ArchitectureViewer.tsx / EvaluationReport.tsx 提取合并
 * # ============================================================
 */

import type { DefectSeverity } from '../types';

/**
 * 缺陷严重程度颜色映射
 * 作用：将缺陷严重程度映射为对应的 Tailwind 颜色类名和中文标签
 * critical=红色严重，major=橙色主要，minor=黄色次要，suggestion=蓝色建议
 */
export const severityColorMap: Record<DefectSeverity, { bg: string; text: string; label: string }> = {
  critical:   { bg: 'bg-red-500/20', text: 'text-red-400', label: '严重' },
  major:      { bg: 'bg-orange-500/20', text: 'text-orange-400', label: '主要' },
  minor:      { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: '次要' },
  suggestion: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: '建议' },
};
