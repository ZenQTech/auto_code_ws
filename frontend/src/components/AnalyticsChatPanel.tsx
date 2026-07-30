/**
 * # ============================================================
 * # AnalyticsChatPanel - 分析聊天面板 (v1.0.0 Cycle 29 G29-03)
 * # ============================================================
 * # 核心作用：提供自然语言查询用量数据的 UI
 * # 运行流程：
 * #   1. 打开面板，初始化 AnalyticsChat 引擎
 * #   2. 用户在输入框输入自然语言问题
 * #   3. 提交后调用 engine.query(question)
 * #   4. 展示回答 + 图表（bar/line/pie）
 * #   5. 支持 follow-up 追问、导出 CSV/JSON、清空历史
 * # 输入参数：isOpen (面板显示), onClose (关闭回调)
 * # 输出结果：分析对话 UI
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 29 G29-03 初次创建
 * # ============================================================
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { getDefaultAnalyticsChat } from '../utils/analyticsChatEngine';
import type { QueryResult, ChartSpec, ChatTurn } from '../utils/analyticsChatTypes';
import { QUERY_TYPE_LABELS } from '../utils/analyticsChatTypes';

export interface AnalyticsChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 简单图表渲染组件
 * - bar: 横向条形图
 * - line: 折线图
 * - pie: 饼图（简化为水平条形）
 */
const SimpleChart: React.FC<{ spec: ChartSpec }> = ({ spec }) => {
  if (!spec.xAxis || !spec.yAxis) return null;
  const max = Math.max(...spec.yAxis.values, 1);
  const colors = ['#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  if (spec.type === 'bar') {
    return (
      <div className="space-y-2" data-testid="chart-bar">
        {spec.xAxis.values.map((label, i) => {
          const value = spec.yAxis!.values[i] ?? 0;
          const pct = (value / max) * 100;
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <div className="w-24 truncate text-slate-600 dark:text-slate-300" title={label}>
                {label}
              </div>
              <div className="flex-1 bg-slate-100 dark:bg-slate-800 rounded h-5 overflow-hidden">
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: colors[i % colors.length],
                  }}
                />
              </div>
              <div className="w-20 text-right text-slate-700 dark:text-slate-200 tabular-nums">
                {value.toFixed(2)}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (spec.type === 'line') {
    const w = 400;
    const h = 160;
    const padding = 30;
    const n = spec.xAxis.values.length;
    if (n === 0) return null;
    const xs = (i: number) => padding + (i * (w - 2 * padding)) / Math.max(n - 1, 1);
    const ys = (v: number) => h - padding - (v / max) * (h - 2 * padding);
    const points = spec.yAxis.values.map((v, i) => `${xs(i)},${ys(v)}`).join(' ');

    return (
      <div data-testid="chart-line" className="bg-white dark:bg-slate-900 rounded p-2">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-40">
          {/* 坐标轴 */}
          <line x1={padding} y1={h - padding} x2={w - padding} y2={h - padding} stroke="#cbd5e1" />
          <line x1={padding} y1={padding} x2={padding} y2={h - padding} stroke="#cbd5e1" />
          {/* 折线 */}
          <polyline fill="none" stroke="#4f46e5" strokeWidth={2} points={points} />
          {/* 节点 */}
          {spec.yAxis.values.map((v, i) => (
            <circle key={i} cx={xs(i)} cy={ys(v)} r={3} fill="#4f46e5" />
          ))}
          {/* 标签 */}
          {spec.xAxis.values
            .filter((_, i) => i % Math.max(Math.floor(n / 5), 1) === 0)
            .map((label, i) => {
              const idx = i * Math.max(Math.floor(n / 5), 1);
              return (
                <text
                  key={i}
                  x={xs(idx)}
                  y={h - 10}
                  textAnchor="middle"
                  className="text-[10px] fill-slate-500"
                >
                  {label.slice(5)}
                </text>
              );
            })}
        </svg>
      </div>
    );
  }

  if (spec.type === 'pie') {
    const total = spec.yAxis.values.reduce((a, b) => a + b, 0) || 1;
    return (
      <div className="space-y-1" data-testid="chart-pie">
        {spec.xAxis.values.map((label, i) => {
          const value = spec.yAxis!.values[i] ?? 0;
          const pct = (value / total) * 100;
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <div
                className="w-3 h-3 rounded-sm"
                style={{ backgroundColor: colors[i % colors.length] }}
              />
              <div className="flex-1 text-slate-600 dark:text-slate-300 truncate">{label}</div>
              <div className="text-slate-700 dark:text-slate-200 tabular-nums">
                {pct.toFixed(1)}%
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return null;
};

export const AnalyticsChatPanel: React.FC<AnalyticsChatPanelProps> = ({ isOpen, onClose }) => {
  const chat = useMemo(() => getDefaultAnalyticsChat(), []);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentResult, setCurrentResult] = useState<QueryResult | null>(null);
  const [history, setHistory] = useState<ChatTurn[]>([]);
  // 触发 UI 重新渲染的 key（订阅 query-executed 时自增）
  const [, setRefreshKey] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 订阅事件 + 加载历史
  useEffect(() => {
    if (!isOpen) return;
    setHistory(chat.getHistory());
    const unsub = chat.on('query-executed', () => {
      setHistory(chat.getHistory());
      setRefreshKey((k) => k + 1);
    });
    return () => unsub();
  }, [isOpen, chat]);

  // 滚动到底部
  useEffect(() => {
    if (isOpen && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [history, isOpen, currentResult]);

  if (!isOpen) return null;

  const handleSubmit = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q) return;
    setInput('');
    setLoading(true);
    try {
      const result = await chat.query(q);
      setCurrentResult(result);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleFollowUp = (q: string) => {
    handleSubmit(q);
  };

  const handleClear = () => {
    if (confirm('确定要清空所有对话历史吗？')) {
      chat.clearHistory();
      setCurrentResult(null);
      setRefreshKey((k) => k + 1);
    }
  };

  const handleExport = (format: 'json' | 'csv') => {
    if (!currentResult) return;
    const data = chat.exportData(currentResult, format);
    const blob = new Blob([data], { type: format === 'json' ? 'application/json' : 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-${currentResult.queryType}-${Date.now()}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const suggestions = chat.getSuggestedQueries();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="analytics-chat-panel"
    >
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-[min(96vw,1100px)] h-[min(92vh,820px)] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              分析聊天
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              用自然语言查询用量数据 · {history.length} 条历史
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClear}
              className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
              data-testid="clear-history-btn"
            >
              清空历史
            </button>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-500"
              data-testid="close-btn"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Messages Area */}
        <div
          className="flex-1 overflow-y-auto p-6 space-y-4"
          data-testid="messages-area"
        >
          {history.length === 0 && !currentResult && (
            <div className="text-center py-12">
              <div className="text-5xl mb-3">📊</div>
              <h3 className="text-lg font-medium text-slate-700 dark:text-slate-200 mb-1">
                开始你的分析对话
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                试试以下问题，或输入你关心的指标
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-w-2xl mx-auto">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => handleSubmit(s)}
                    className="text-left px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                    data-testid={`suggestion-${i}`}
                  >
                    💡 {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {history.map((turn) => (
            <div key={turn.id} className="space-y-2" data-testid={`turn-${turn.id}`}>
              <div className="flex justify-end">
                <div className="max-w-[80%] bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm">
                  {turn.question}
                </div>
              </div>
              <div className="flex justify-start">
                <div className="max-w-[85%] bg-slate-50 dark:bg-slate-800 rounded-lg px-4 py-3 text-sm text-slate-800 dark:text-slate-100">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-slate-500">
                      {QUERY_TYPE_LABELS[turn.result.queryType] ?? turn.result.queryType}
                    </span>
                    <span className="text-xs text-slate-400">
                      {turn.result.executionTimeMs}ms
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap mb-2">{turn.result.answer}</p>
                  {turn.result.chartSpec && (
                    <div className="mt-2 bg-white dark:bg-slate-900 rounded p-3">
                      <SimpleChart spec={turn.result.chartSpec} />
                    </div>
                  )}
                  {turn.result.followUpQuestions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {turn.result.followUpQuestions.map((q, i) => (
                        <button
                          key={i}
                          onClick={() => handleFollowUp(q)}
                          className="text-xs px-2 py-1 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
                          data-testid={`followup-${i}`}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg px-4 py-2 text-sm text-slate-500">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></div>
                  <div
                    className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"
                    style={{ animationDelay: '0.1s' }}
                  ></div>
                  <div
                    className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"
                    style={{ animationDelay: '0.2s' }}
                  ></div>
                  <span>分析中...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-slate-200 dark:border-slate-700 p-4">
          {currentResult && history.length > 0 && (
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs text-slate-500">导出最新结果:</span>
              <button
                onClick={() => handleExport('json')}
                className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded hover:bg-slate-200"
                data-testid="export-json-btn"
              >
                📥 JSON
              </button>
              <button
                onClick={() => handleExport('csv')}
                className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded hover:bg-slate-200"
                data-testid="export-csv-btn"
              >
                📥 CSV
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="输入自然语言问题，例如：上个季度哪个团队用了最多 token？"
              className="flex-1 px-4 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900"
              data-testid="question-input"
            />
            <button
              onClick={() => handleSubmit()}
              disabled={!input.trim() || loading}
              className="px-5 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium disabled:opacity-50 hover:bg-indigo-700"
              data-testid="submit-btn"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsChatPanel;
