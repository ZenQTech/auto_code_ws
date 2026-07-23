/**
 * # ============================================================
 * # EvaluationReport 系统评测报告查看器组件
 * # ============================================================
 * # 核心作用：展示系统评测报告，包含 8 个可折叠章节、
 * #           通过/不通过/有条件通过结论、结构化问题列表
 * # 运行流程：
 * #   1. 接收报告类型参数，通过 useEvaluationReport(type) 拉取数据
 * #   2. 渲染总体结论（通过/不通过/有条件通过）
 * #   3. 渲染 8 个可折叠章节，每章显示评测结论
 * #   4. 渲染结构化问题列表（带严重程度）
 * #   5. 显示总评分
 * # 输入参数：
 * #   - type: string，报告类型（architecture / code / integration / security）
 * # 输出结果：评测报告查看器 UI
 * # 修改记录：
 * #   - 2026-06-24 | v1.0.0 | 初始创建，实现评测报告查看器
 * #   - 2026-06-25 | v1.1.0 | severityColorMap 提取到 ../utils/severity.ts 共享
 * # ============================================================
 */

import { useState } from 'react';
import { useEvaluationReport } from '../hooks/useApi';
import type { EvaluationConclusion, DefectSeverity } from '../types';
import { severityColorMap } from '../utils/severity';

interface Props {
  /** 报告类型：architecture / code / integration / security */
  type: string;
}

/**
 * 评测结论颜色映射
 * 作用：将评测结论映射为对应的 Tailwind 颜色类名和中文标签
 * pass=绿色通过，fail=红色不通过，conditional_pass=黄色有条件通过
 */
const conclusionColorMap: Record<EvaluationConclusion, { bg: string; text: string; border: string; label: string; icon: string }> = {
  pass:             { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30', label: '通过', icon: '✅' },
  fail:             { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30', label: '不通过', icon: '❌' },
  conditional_pass: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30', label: '有条件通过', icon: '⚠️' },
};

/**
 * 报告类型中文标签映射
 * 作用：将报告类型枚举值映射为中文显示文本
 */
const reportTypeLabels: Record<string, string> = {
  architecture: '架构评测',
  code: '代码评测',
  integration: '集成评测',
  security: '安全评测',
};

export default function EvaluationReport({ type }: Props) {
  /** 评测报告数据 */
  const { report, loading } = useEvaluationReport(type);
  /** 展开的章节索引集合（Set 用于高效查找） */
  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(new Set());

  /**
   * 切换章节展开/收起状态
   * 作用：点击章节标题时切换该章节的展开状态
   * @param index - 章节编号
   */
  const toggleChapter = (index: number) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // ============================================================
  // 加载态
  // ============================================================
  if (loading && !report) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in">
        <div className="skeleton h-6 w-40 rounded mb-4" />
        <div className="skeleton h-16 rounded-lg mb-3" />
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="skeleton h-10 rounded" />
          ))}
        </div>
      </div>
    );
  }

  // ============================================================
  // 空数据态
  // ============================================================
  if (!report) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in">
        <div className="empty-state">
          <span className="empty-icon">📊</span>
          <span>暂无{reportTypeLabels[type] || type}报告</span>
        </div>
      </div>
    );
  }

  const conclusionStyle = conclusionColorMap[report.conclusion];

  return (
    <div className="glass rounded-xl p-5 animate-fade-in flex flex-col max-h-[70vh]">
      {/* ============================================================
       * 标题栏：图标 + 报告类型 + 总评分
       * ============================================================ */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-surface-300">
        <div className="flex items-center gap-3">
          {/* 报告图标 */}
          <div className="w-8 h-8 rounded-lg bg-hermes-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-surface-950">
            {reportTypeLabels[report.type] || report.type}
          </h3>
        </div>

        {/* 总评分 */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-surface-500">评分</span>
          <span className={`text-lg font-bold ${
            report.score >= 80 ? 'text-emerald-400' :
            report.score >= 60 ? 'text-yellow-400' :
            'text-red-400'
          }`}>
            {report.score}
          </span>
          <span className="text-xs text-surface-500">/ 100</span>
        </div>
      </div>

      {/* ============================================================
       * 总体结论卡片
       * ============================================================ */}
      <div className={`rounded-lg p-4 mb-4 border ${conclusionStyle.border} ${conclusionStyle.bg}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">{conclusionStyle.icon}</span>
          <span className={`text-sm font-semibold ${conclusionStyle.text}`}>
            总体结论：{conclusionStyle.label}
          </span>
        </div>
        {/* 问题统计 */}
        {report.issues && report.issues.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {(['critical', 'major', 'minor', 'suggestion'] as DefectSeverity[]).map(sev => {
              const count = report.issues.filter(i => i.severity === sev).length;
              if (count === 0) return null;
              const sevStyle = severityColorMap[sev];
              return (
                <span key={sev} className={`px-2 py-0.5 rounded text-xs font-medium ${sevStyle.bg} ${sevStyle.text}`}>
                  {sevStyle.label}：{count}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* ============================================================
       * 可折叠章节列表
       * ============================================================ */}
      <div className="flex-1 overflow-y-auto pr-2 min-h-0 space-y-2">
        {report.chapters.map((chapter) => {
          const isExpanded = expandedChapters.has(chapter.index);
          const chConclusion = conclusionColorMap[chapter.conclusion];

          return (
            <div key={chapter.index} className="border border-surface-300 rounded-lg overflow-hidden">
              {/* 章节标题栏（可点击展开/收起） */}
              <button
                onClick={() => toggleChapter(chapter.index)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-surface-100/50 hover:bg-surface-100/70 transition-colors text-left"
              >
                {/* 展开箭头 */}
                <span className={`text-surface-500 transition-transform duration-200 text-xs ${isExpanded ? 'rotate-90' : ''}`}>
                  ▶
                </span>
                {/* 章节编号 + 标题 */}
                <span className="text-sm font-medium text-surface-900 flex-1">
                  第 {chapter.index} 章：{chapter.title}
                </span>
                {/* 章节结论徽章 */}
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${chConclusion.bg} ${chConclusion.text}`}>
                  {chConclusion.label}
                </span>
              </button>

              {/* 章节内容（展开时显示） */}
              {isExpanded && (
                <div className="px-4 pb-4 animate-fade-in">
                  {/* 章节内容（Markdown 纯文本渲染） */}
                  <div className="text-sm text-surface-700 leading-relaxed whitespace-pre-wrap">
                    {chapter.content}
                  </div>

                  {/* 本章相关问题列表 */}
                  {report.issues.filter(i => i.chapter === chapter.index).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-surface-300">
                      <span className="text-xs font-medium text-surface-600 mb-2 block">本章问题</span>
                      <div className="space-y-2">
                        {report.issues
                          .filter(i => i.chapter === chapter.index)
                          .map(issue => {
                            const sevStyle = severityColorMap[issue.severity];
                            return (
                              <div key={issue.id} className="bg-surface-100/50 rounded p-2.5 border border-surface-300">
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <span className="text-xs font-medium text-surface-900">{issue.title}</span>
                                  <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${sevStyle.bg} ${sevStyle.text}`}>
                                    {sevStyle.label}
                                  </span>
                                </div>
                                <p className="text-xs text-surface-600 mb-1">{issue.description}</p>
                                <p className="text-xs text-hermes-400">建议：{issue.suggestion}</p>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ============================================================
       * 底部：生成时间
       * ============================================================ */}
      <div className="mt-4 pt-3 border-t border-surface-300 text-xs text-surface-500">
        生成时间：{new Date(report.generated_at).toLocaleString('zh-CN')}
      </div>
    </div>
  );
}
