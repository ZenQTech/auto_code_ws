/**
 * # ============================================================
 * # 需求澄清卡片组件 - ClarificationCard
 * # ============================================================
 * # 核心作用：在需求澄清阶段，以交互式选择卡片呈现澄清问题。
 * #           每个问题渲染候选选项按钮（单选/多选），并始终提供
 * #           "其他（自由输入）"项，用户选择/填写后汇总提交。
 * #           对齐 Trae IDE solo 模式 AskUserQuestion 的交互形态。
 * # 运行流程：
 * #   1. 接收澄清数据（summary / questions / roundNumber / maxRounds / isComplete）
 * #   2. 渲染进度指示器（第 N/M 轮）
 * #   3. 渲染 AI 需求理解总结（summary）
 * #   4. 逐题渲染：维度标签 + 重要性 + 候选选项按钮 + "其他"自由输入项
 * #   5. 底部"提交回答"按钮：汇总所有问题的选择/输入为结构化文本，回调 onSubmit
 * #   6. isComplete=true 时显示"确认进入架构设计 / 继续补充信息"操作按钮
 * # 输入参数：
 * #   - summary: AI 对需求的理解总结
 * #   - questions: 澄清问题列表，每项含 dimension/question/importance/options/allowMultiple
 * #   - roundNumber / maxRounds: 当前轮次 / 最大轮次
 * #   - isComplete: 澄清是否完成
 * #   - onSubmit: 提交结构化回答回调（参数为汇总后的文本）
 * #   - onConfirm: 确认需求文档回调
 * #   - onContinueAdd: 继续补充信息回调
 * # 输出结果：交互式澄清问题卡片 DOM
 * # 修改记录：
 * #   - 2026-06-29 | v1.0.0 | 初始版本，纯文本展示澄清问题
 * #   - 2026-06-30 | v2.0.0 | 改造为交互式选择卡片：候选选项按钮（单选/多选）
 * #     + "其他"自由输入项 + 提交汇总，对齐 AskUserQuestion 形态
#   - 2026-06-30 | v2.1.0 | 新增 useEffect 监听 roundNumber 变化时重置 submitted/selections/otherInputs
#   - 2026-07-01 | v3.0.0 | roundNumber >= 6 时显示"跳过不确定项，进入架构设计"按钮
#   - 2026-07-01 | v3.1.0 | summary 区域从纯文本改为 Markdown 渲染（renderMarkdown）
#   - 2026-07-01 | v3.2.0 | questions=0 && !isComplete && round>=3 时显示跳过按钮作为逃生出口
#   - 2026-07-02 | v3.3.0 | handleSubmit 检测选中项含"跳过不确定项"关键词时改走 onConfirm
#     确认推进路径，修复选项路径提交后工作流停留在 clarifying 无法推进到架构设计的 Bug；
#     跳过选项按钮单击即时触发 onConfirm，无需再点"提交回答"
# ============================================================
 */

import React, { useState, useEffect, useMemo } from 'react';
import { renderMarkdown } from '../utils/markdown';

/**
 * 单条澄清问题的数据结构
 * - dimension: 所属维度（如"功能边界"、"性能要求"）
 * - question: 具体澄清问题文本
 * - importance: 重要性等级（high=重要 / medium=一般 / low=可选）
 * - options: 候选选项列表（2-4 个具体方案，可为空）
 * - allowMultiple: 是否允许多选
 */
export interface ClarificationQuestion {
  dimension: string;
  question: string;
  importance: 'high' | 'medium' | 'low' | string;
  options?: string[];
  allowMultiple?: boolean;
}

/**
 * ClarificationCard 组件 Props
 */
interface ClarificationCardProps {
  summary: string;
  questions: ClarificationQuestion[];
  roundNumber: number;
  maxRounds: number;
  isComplete: boolean;
  workflowId?: string;
  onSubmit?: (answersText: string) => void;
  onConfirm?: (workflowId?: string) => void;
  onContinueAdd?: () => void;
}

/**
 * 重要性 → Tailwind 边框+背景色映射
 */
const IMPORTANCE_COLORS: Record<string, string> = {
  high: 'border-red-400 bg-red-500/5',
  medium: 'border-yellow-400 bg-yellow-500/5',
  low: 'border-blue-400 bg-blue-500/5',
};

/**
 * 重要性 → 中文标签映射
 */
const IMPORTANCE_LABELS: Record<string, string> = {
  high: '重要',
  medium: '一般',
  low: '可选',
};

/** 自由输入选项的内部标识值 */
const OTHER_VALUE = '__other__';

/**
 * 需求澄清卡片组件（交互式选择）
 */
export default function ClarificationCard({
  summary,
  questions,
  roundNumber,
  maxRounds,
  isComplete,
  workflowId,
  onSubmit,
  onConfirm,
  onContinueAdd,
}: ClarificationCardProps) {
  // 每个问题的已选选项：questionIndex -> 选中的选项值集合
  const [selections, setSelections] = useState<Record<number, Set<string>>>({});
  // 每个问题的"其他"自由输入文本：questionIndex -> text
  const [otherInputs, setOtherInputs] = useState<Record<number, string>>({});
  // 是否已提交（提交后禁用，避免重复提交）
  const [submitted, setSubmitted] = useState(false);

  // 轮次变化时重置提交状态和选择（防御性，配合 key={roundNumber} 重挂载）
  useEffect(() => {
    setSubmitted(false);
    setSelections({});
    setOtherInputs({});
  }, [roundNumber]);

  /**
   * 使用 useMemo 缓存 summary 的 Markdown 渲染结果
   * renderMarkdown 内部已做 HTML 转义（XSS 防护），可安全使用 dangerouslySetInnerHTML
   */
  const renderedSummary = useMemo(
    () => renderMarkdown(summary || ''),
    [summary]
  );

  /**
   * 切换某个问题的某个选项的选中状态
   * 单选：替换；多选：增删
   */
  const toggleOption = (qIndex: number, value: string, allowMultiple: boolean) => {
    setSelections((prev) => {
      const next = { ...prev };
      const cur = new Set(next[qIndex] ?? []);
      if (allowMultiple) {
        if (cur.has(value)) cur.delete(value);
        else cur.add(value);
      } else {
        // 单选：若已选中则取消，否则替换为唯一值
        if (cur.has(value)) {
          cur.clear();
        } else {
          cur.clear();
          cur.add(value);
        }
      }
      next[qIndex] = cur;
      return next;
    });
  };

  /**
   * 汇总所有问题的回答为结构化文本并提交
   * 作用：将各问题的选中项 / 自由输入汇总为结构化文本。
   *       v3.3.0 新增：若任一选中项文本包含"跳过不确定项"关键词，则识别为
   *       用户显式跳过意图，改走确认推进路径（onConfirm），避免作为普通答案
   *       提交到 chat/stream 导致工作流停留在 clarifying 阶段无法推进到架构设计。
   * 调用方：提交回答按钮 onClick。
   * 被调用方：onConfirm（跳过意图）或 onSubmit（普通回答）。
   * 内部变量：
   *   - lines: string[]，逐题结构化文本行
   *   - hasSkipIntent: boolean，是否命中"跳过不确定项"意图
   *   - picked: string[]，单题所有选中/输入的答案
   * 输入参数：无（读取组件 state：selections/otherInputs/questions）
   * 输出返回值：无（副作用：触发 onConfirm 或 onSubmit 回调）
   */
  const handleSubmit = () => {
    const lines: string[] = [];
    // 是否命中"跳过不确定项"意图：任一问题的选中项文本包含关键词即视为跳过
    let hasSkipIntent = false;
    questions.forEach((q, i) => {
      const sel = selections[i] ?? new Set<string>();
      const picked: string[] = [];
      sel.forEach((v) => {
        if (v === OTHER_VALUE) {
          const txt = (otherInputs[i] ?? '').trim();
          if (txt) picked.push(txt);
        } else {
          picked.push(v);
        }
      });
      // 检测选中的选项文本是否包含"跳过不确定项"关键词
      if (picked.some((p) => p.includes('跳过不确定项'))) {
        hasSkipIntent = true;
      }
      // 即使没选，也带上问题，标注"（未选择）"，便于 AI 理解
      const answer = picked.length > 0 ? picked.join('、') : '（未选择/跳过）';
      lines.push(`【${q.dimension}】${q.question}\n→ ${answer}`);
    });
    // 跳过意图：走确认推进路径（/clarify/confirm → advance_stage → 架构设计），
    // 不设 submitted、不调用 onSubmit，避免触发新一轮 chat/stream 澄清
    if (hasSkipIntent && onConfirm) {
      onConfirm(workflowId);
      return;
    }
    const answersText = lines.join('\n\n');
    setSubmitted(true);
    onSubmit?.(answersText);
  };

  return (
    <div className="clarification-card my-4 rounded-xl border border-purple-500/20 bg-[#1a1a2e]/80 p-5">
      {/* 进度指示器 */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-full bg-purple-500/10 px-3 py-1 text-sm text-purple-300">
          <span className="h-2 w-2 rounded-full bg-purple-400 animate-pulse" />
          需求澄清 · 第 {roundNumber}/{maxRounds} 轮
        </div>
      </div>

      {/* AI 需求理解总结 - Markdown 渲染 */}
      {summary && (
        <div
          className="mb-4 text-sm text-gray-300 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderedSummary }}
        />
      )}

      {/* 交互式问题列表 */}
      {questions.length > 0 && (
        <div className="space-y-4">
          <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">
            请选择或补充以下信息
          </div>
          {questions.map((q, i) => {
            const sel = selections[i] ?? new Set<string>();
            const allowMultiple = !!q.allowMultiple;
            const opts = q.options ?? [];
            return (
              <div
                key={i}
                className={`rounded-lg border-l-4 p-3 ${IMPORTANCE_COLORS[q.importance] || 'border-gray-500 bg-gray-500/5'}`}
              >
                {/* 维度名 + 重要性 + 多选提示 */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium text-gray-400">【{q.dimension}】</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    q.importance === 'high' ? 'bg-red-500/20 text-red-300' :
                    q.importance === 'medium' ? 'bg-yellow-500/20 text-yellow-300' :
                    'bg-blue-500/20 text-blue-300'
                  }`}>
                    {IMPORTANCE_LABELS[q.importance] || q.importance}
                  </span>
                  {allowMultiple && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">
                      可多选
                    </span>
                  )}
                </div>

                {/* 问题正文 */}
                <div className="text-sm text-gray-200 mb-2">{q.question}</div>

                {/* 候选选项按钮 */}
                <div className="flex flex-wrap gap-2">
                  {opts.map((opt, oi) => {
                    const active = sel.has(opt);
                    // v3.3.0 新增：跳过选项即时触发 —— 当选项文本包含"跳过不确定项"时，
                    // 单击直接走确认推进路径（onConfirm），无需再点"提交回答"按钮，
                    // 解决用户习惯性以为按钮点击即生效的 UX 问题
                    const isSkipOption = opt.includes('跳过不确定项');
                    return (
                      <button
                        key={oi}
                        disabled={submitted}
                        onClick={() => {
                          if (isSkipOption && onConfirm) {
                            onConfirm(workflowId);
                          } else {
                            toggleOption(i, opt, allowMultiple);
                          }
                        }}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                          active
                            ? 'border-purple-400 bg-purple-500/20 text-purple-200'
                            : 'border-gray-600 bg-transparent text-gray-300 hover:border-purple-400/60'
                        } ${submitted ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        {active ? '✓ ' : ''}{opt}
                      </button>
                    );
                  })}
                  {/* "其他（自由输入）"项始终提供 */}
                  <button
                    disabled={submitted}
                    onClick={() => toggleOption(i, OTHER_VALUE, allowMultiple)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      sel.has(OTHER_VALUE)
                        ? 'border-purple-400 bg-purple-500/20 text-purple-200'
                        : 'border-dashed border-gray-600 bg-transparent text-gray-400 hover:border-purple-400/60'
                    } ${submitted ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    {sel.has(OTHER_VALUE) ? '✓ ' : ''}其他（自由输入）
                  </button>
                </div>

                {/* "其他"选中时展示输入框 */}
                {sel.has(OTHER_VALUE) && (
                  <input
                    type="text"
                    disabled={submitted}
                    value={otherInputs[i] ?? ''}
                    onChange={(e) =>
                      setOtherInputs((prev) => ({ ...prev, [i]: e.target.value }))
                    }
                    placeholder="请输入您的补充内容..."
                    className="mt-2 w-full text-sm bg-[#0d0d1a] border border-gray-700 rounded-lg px-3 py-2 text-gray-200 focus:border-purple-400 focus:outline-none disabled:opacity-60"
                  />
                )}
              </div>
            );
          })}

          {/* 提交回答按钮 */}
          {!isComplete && (
            <div className="flex gap-3">
              <button
                onClick={handleSubmit}
                disabled={submitted}
                className={`mt-1 rounded-lg px-4 py-2 text-sm text-white transition-colors ${
                  submitted
                    ? 'bg-gray-600 cursor-not-allowed'
                    : 'bg-purple-600 hover:bg-purple-500'
                }`}
              >
                {submitted ? '已提交，等待下一轮...' : '提交回答'}
              </button>
              {/* v3.0.0 新增：6 轮后显示"跳过不确定项"按钮 */}
              {roundNumber >= 6 && onConfirm && (
                <button
                  onClick={() => onConfirm?.(workflowId)}
                  className="mt-1 rounded-lg border border-yellow-500/50 px-4 py-2 text-sm text-yellow-300 hover:bg-yellow-500/10 transition-colors"
                >
                  跳过不确定项，进入架构设计
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 空状态：无问题且未完成 */}
      {questions.length === 0 && !isComplete && (
        <div className="text-sm text-gray-500 text-center py-4">
          {/* v3.2.0 修复：澄清卡住时（>=3 轮仍无新问题）提供逃生出口 */}
          {roundNumber >= 3 && onConfirm ? (
            <div className="space-y-3">
              <p>AI 未能生成新的澄清问题，您可以跳过剩余不确定项直接进入架构设计。</p>
              <button
                onClick={() => onConfirm?.(workflowId)}
                className="rounded-lg border border-yellow-500/50 px-4 py-2 text-sm text-yellow-300 hover:bg-yellow-500/10 transition-colors"
              >
                跳过不确定项，进入架构设计
              </button>
            </div>
          ) : (
            <p>正在分析您的需求...</p>
          )}
        </div>
      )}

      {/* 完成时的操作按钮区 */}
      {isComplete && (
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => onConfirm?.(workflowId)}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm text-white hover:bg-purple-500 transition-colors"
          >
            确认需求文档，进入架构设计
          </button>
          <button
            onClick={onContinueAdd}
            className="rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-300 hover:border-gray-400 transition-colors"
          >
            继续补充信息
          </button>
        </div>
      )}
    </div>
  );
}
