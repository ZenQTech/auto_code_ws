/**
 * # ============================================================
 * LoopStateMachineView - Loop 状态机可视化 (v1.0.1)
 * Cycle 58 G58-03
 * # ============================================================
 * 核心作用：可视化展示 Loop 状态机迁移历史
 * 运行流程：
 *   1. 接收 state + history
 *   2. 显示当前状态 + 进度
 *   3. 绘制状态机迁移图（节点 + 箭头）
 *   4. 显示最近 N 条迁移记录
 * 设计要点：
 *   - SVG 渲染迁移图
 *   - 状态节点颜色编码
 *   - 迁移历史时间线
 *   - v1.0.1 主题感知：bg-white 替换为 var(--bg-panel)，
 *     文字颜色使用 CSS 变量，节点填充使用 var(--bg-elevated)
 * 输入参数：{ state, history, onClose }
 * 输出结果：Loop 状态机可视化 UI
 * ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 58 G58-03 初次创建
 * #   - 2026-08-03 | v1.0.1 | G60-FIX-16 修复主题感知
 * ====================================
 */

import React from 'react';

import type { LoopState, LoopTransition } from '../hooks/useLoopState';

// ============================================================
// 类型
// ====================================

export interface LoopStateMachineViewProps {
  state: LoopState | null;
  history: LoopTransition[];
  onClose: () => void;
}

// ============================================================
// 状态节点
// ====================================

const STAGES = [
  { key: 'idle', label: 'Idle', x: 50, y: 50, color: '#94a3b8' },
  { key: 'clarifying', label: 'Clarifying', x: 200, y: 50, color: '#f59e0b' },
  { key: 'designing', label: 'Designing', x: 350, y: 50, color: '#a855f7' },
  { key: 'prompting', label: 'Prompting', x: 350, y: 150, color: '#3b82f6' },
  { key: 'executing', label: 'Executing', x: 200, y: 150, color: '#10b981' },
  { key: 'reviewing', label: 'Reviewing', x: 50, y: 150, color: '#06b6d4' },
  { key: 'done', label: 'Done', x: 50, y: 250, color: '#22c55e' },
];

// ============================================================
// 组件
// ============================================================

const LoopStateMachineView: React.FC<LoopStateMachineViewProps> = ({
  state,
  history,
  onClose,
}) => {
  const currentStage = state?.stage ?? 'idle';
  const recentHistory = history.slice(-10).reverse();

  return (
    <div
      className="bg-[var(--bg-panel)] rounded-2xl border border-surface-200 p-4 shadow-sm"
      data-testid="loop-state-machine-view"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <span>🔁</span> Loop State Machine
        </h3>
        <button
          onClick={onClose}
          className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      {/* 当前状态 */}
      <div className="mb-3 p-3 bg-surface-50 rounded-lg">
        <div className="text-xs text-[var(--text-secondary)] mb-1">当前阶段</div>
        <div className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full animate-pulse"
            style={{ backgroundColor: STAGES.find((s) => s.key === currentStage)?.color ?? '#94a3b8' }}
          />
          {currentStage}
        </div>
        {state && (
          <div className="mt-2 text-xs text-[var(--text-secondary)]">
            progress: {(state.progress * 100).toFixed(0)}% · ETA: {state.eta_seconds}s
          </div>
        )}
      </div>

      {/* 状态机迁移图 */}
      <div className="mb-3 border border-surface-200 rounded-lg p-2 bg-[var(--bg-elevated)]">
        <svg viewBox="0 0 400 300" className="w-full h-48">
          {/* 边 */}
          {STAGES.map((from, i) =>
            STAGES.slice(i + 1).map((to) => (
              <line
                key={`${from.key}-${to.key}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="#cbd5e1"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
            ))
          )}
          {/* 节点 */}
          {STAGES.map((stage) => {
            const isCurrent = stage.key === currentStage;
            return (
              <g key={stage.key} transform={`translate(${stage.x}, ${stage.y})`}>
                <circle
                  r={isCurrent ? 22 : 18}
                  fill={isCurrent ? stage.color : 'var(--bg-elevated, #1a1a24)'}
                  stroke={stage.color}
                  strokeWidth={isCurrent ? 3 : 2}
                  className={isCurrent ? 'animate-pulse' : ''}
                />
                <text
                  textAnchor="middle"
                  dy="0.35em"
                  fontSize="9"
                  fontWeight={isCurrent ? 'bold' : 'normal'}
                  fill={isCurrent ? '#fff' : stage.color}
                >
                  {stage.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* 迁移历史 */}
      <div>
        <div className="text-xs font-medium text-[var(--text-primary)] mb-2">最近迁移</div>
        {recentHistory.length === 0 ? (
          <div className="text-xs text-[var(--text-secondary)]">无迁移记录</div>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto" data-testid="loop-history">
            {recentHistory.map((t, i) => (
              <div
                key={i}
                className="flex items-center gap-2 p-1.5 bg-surface-50 rounded text-xs"
              >
                <span className="text-[var(--text-secondary)] font-mono w-6">{history.length - i}</span>
                <span className="text-[var(--text-secondary)]">{t.from_state}</span>
                <span className="text-[var(--text-secondary)]">→</span>
                <span className="text-[var(--text-primary)] font-medium">{t.to_state}</span>
                <span className="ml-auto text-[var(--text-secondary)] font-mono">
                  {new Date(t.at).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default LoopStateMachineView;
