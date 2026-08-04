/**
 * # ============================================================
 * # StageDetectorBadge 阶段检测器徽章组件 (v1.0.0)
 * # Cycle 63 G63-03
 * # ====================================
 * # 核心作用：在 UI 中显示当前工作阶段，支持 Auto-Follow 控制
 * # 运行流程：
 * #   1. 通过 useStage Hook 订阅阶段状态
 * #   2. 显示当前阶段徽章（带颜色 + emoji）
 * #   3. 置信度指示
 * #   4. Auto-Follow 开关
 * #   5. 手动切换阶段（下拉菜单）
 * #   6. 最近阶段变更事件流
 * # 设计要点：
 * #   - 主题感知：bg-[var(--bg-panel)] / text-[var(--text-primary)]
 * #   - 紧凑徽章 + 展开详情
 * #   - 6 阶段：idle / prd / coding / preview / deploy / done
 * #   - WebSocket 实时更新
 * # 输入参数：
 * #   - sessionId: string
 * #   - compact?: boolean 紧凑模式（仅徽章）
 * #   - wsUrl?: string WebSocket URL
 * #   - onStageChange?: (stage) => void 阶段变更回调（用于 Auto-Follow）
 * #   - onAutoFollowChange?: (enabled) => void Auto-Follow 变更回调
 * # 输出结果：UI 组件
 * # 对标：Trae SOLO Auto-Follow
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 63 G63-03 初次创建
 * # ====================================
 */

import React, { useEffect, useState } from 'react';
import { useStage, type StageId, type StageState } from '../hooks/useStage';

// ============================================================
// 类型
// ====================================

export interface StageDetectorBadgeProps {
  sessionId: string;
  compact?: boolean;
  wsUrl?: string;
  testId?: string;
  onStageChange?: (stage: StageId, state: StageState) => void;
  onAutoFollowChange?: (enabled: boolean) => void;
}

// ============================================================
// 阶段视觉配置
// ====================================

interface StageVisual {
  label: string;
  emoji: string;
  color: string; // hex color for background
  description: string;
  /** 默认关联的工具面板 tab */
  linkedTab: string | null;
}

const STAGE_VISUALS: Record<StageId, StageVisual> = {
  idle: {
    label: '空闲',
    emoji: '⏸️',
    color: '#6b7280',
    description: '等待开始',
    linkedTab: null,
  },
  prd: {
    label: '需求分析',
    emoji: '📋',
    color: '#3b82f6',
    description: '正在生成 PRD / 需求文档',
    linkedTab: 'context',
  },
  coding: {
    label: '编码',
    emoji: '💻',
    color: '#10b981',
    description: '正在编写代码',
    linkedTab: 'editor',
  },
  preview: {
    label: '预览',
    emoji: '👀',
    color: '#f59e0b',
    description: '正在预览 / 测试',
    linkedTab: 'browser',
  },
  deploy: {
    label: '部署',
    emoji: '🚀',
    color: '#ef4444',
    description: '正在部署 / 发布',
    linkedTab: 'terminal',
  },
  done: {
    label: '完成',
    emoji: '✅',
    color: '#8b5cf6',
    description: '任务已完成',
    linkedTab: 'metrics',
  },
};

const ALL_STAGES: StageId[] = ['idle', 'prd', 'coding', 'preview', 'deploy', 'done'];

// ============================================================
// 紧凑徽章（只显示当前阶段）
// ====================================

const CompactBadge: React.FC<{
  state: StageState | null;
  connected: boolean;
  onClick: () => void;
  testId: string;
}> = ({ state, connected, onClick, testId }) => {
  const stage = state?.stage || 'idle';
  const visual = STAGE_VISUALS[stage];
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md
                 bg-[var(--bg-elevated)] border border-[var(--border-color)]
                 hover:border-hermes-500 transition-colors"
      title={`当前阶段: ${visual.label} - 点击展开`}
    >
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: visual.color }}
        aria-hidden="true"
      />
      <span className="text-sm leading-none">{visual.emoji}</span>
      <span className="text-xs text-[var(--text-primary)] font-medium">
        {visual.label}
      </span>
      {state && state.confidence > 0 && (
        <span
          data-testid={`${testId}-confidence`}
          className="text-[10px] text-[var(--text-secondary)] tabular-nums"
        >
          {Math.round(state.confidence * 100)}%
        </span>
      )}
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          connected ? 'bg-green-500' : 'bg-gray-400'
        }`}
        title={connected ? 'WebSocket 已连接' : 'WebSocket 未连接'}
        aria-label={connected ? '已连接' : '未连接'}
      />
    </button>
  );
};

// ============================================================
// 详情面板
// ====================================

const DetailPanel: React.FC<{
  state: StageState | null;
  recentEvents: ReturnType<typeof useStage>['recentEvents'];
  connected: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  detect: (text: string, useLlm?: boolean) => Promise<StageState | null>;
  forceStage: (stage: StageId, reason?: string) => Promise<StageState | null>;
  setAutoFollow: (enabled: boolean) => Promise<void>;
  onClose: () => void;
  testId: string;
}> = ({
  state,
  recentEvents,
  connected,
  loading,
  error,
  refresh,
  forceStage,
  setAutoFollow,
  onClose,
  testId,
}) => {
  const stage = state?.stage || 'idle';
  const visual = STAGE_VISUALS[stage];
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div
      data-testid={testId}
      className="absolute top-full right-0 mt-1 w-80
                 bg-[var(--bg-panel)] border border-[var(--border-color)]
                 rounded-lg shadow-xl z-50 overflow-hidden"
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--border-color)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm">🎯</span>
          <h3 className="text-xs font-semibold text-[var(--text-primary)]">
            阶段检测器
          </h3>
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              connected ? 'bg-green-500' : 'bg-gray-400'
            }`}
            title={connected ? 'WebSocket 已连接' : 'WebSocket 未连接'}
          />
        </div>
        <button
          data-testid={`${testId}-close`}
          onClick={onClose}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      {/* 当前阶段 */}
      <div
        data-testid={`${testId}-current`}
        className="px-3 py-3 border-b border-[var(--border-color)]"
        style={{ backgroundColor: `${visual.color}15` }}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl leading-none">{visual.emoji}</span>
          <div className="flex-1">
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              {visual.label}
            </div>
            <div className="text-[10px] text-[var(--text-secondary)]">
              {visual.description}
            </div>
          </div>
          {state && state.confidence > 0 && (
            <div className="text-right">
              <div
                data-testid={`${testId}-confidence-big`}
                className="text-lg font-bold tabular-nums"
                style={{ color: visual.color }}
              >
                {Math.round(state.confidence * 100)}%
              </div>
              <div className="text-[10px] text-[var(--text-secondary)]">置信度</div>
            </div>
          )}
        </div>
        {state && (
          <div className="text-[10px] text-[var(--text-secondary)] mt-1">
            {state.source === 'rule' && '🔍 规则匹配'}
            {state.source === 'llm' && '🤖 LLM 分类'}
            {state.source === 'manual' && '✋ 手动设置'}
            {state.reason && ` · ${state.reason}`}
          </div>
        )}
      </div>

      {/* Auto-Follow 开关 */}
      <div
        data-testid={`${testId}-autofollow`}
        className="px-3 py-2 border-b border-[var(--border-color)] flex items-center justify-between"
      >
        <div>
          <div className="text-xs font-medium text-[var(--text-primary)]">
            Auto-Follow 自动跟随
          </div>
          <div className="text-[10px] text-[var(--text-secondary)]">
            阶段变更时自动切换工具面板
          </div>
        </div>
        <button
          data-testid={`${testId}-autofollow-toggle`}
          onClick={() => state && setAutoFollow(!state.auto_follow)}
          className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
            state?.auto_follow ? 'bg-hermes-500' : 'bg-gray-400/40'
          }`}
          role="switch"
          aria-checked={state?.auto_follow || false}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
              state?.auto_follow ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {/* 手动切换阶段 */}
      <div
        data-testid={`${testId}-manual`}
        className="px-3 py-2 border-b border-[var(--border-color)]"
      >
        <div className="text-[10px] text-[var(--text-secondary)] mb-1.5">
          手动设置阶段
        </div>
        <div className="grid grid-cols-3 gap-1">
          {ALL_STAGES.map((s) => {
            const v = STAGE_VISUALS[s];
            const active = s === stage;
            return (
              <button
                key={s}
                data-testid={`${testId}-stage-${s}`}
                onClick={() => forceStage(s, 'manual override from UI')}
                className={`flex items-center gap-1 px-1.5 py-1 rounded text-[10px] transition-colors ${
                  active
                    ? 'bg-hermes-500/20 text-hermes-400 font-semibold'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                title={v.description}
              >
                <span>{v.emoji}</span>
                <span>{v.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 最近事件 / 历史切换 */}
      <div className="px-3 py-1.5 border-b border-[var(--border-color)] flex items-center gap-1">
        <button
          data-testid={`${testId}-tab-recent`}
          onClick={() => setShowHistory(false)}
          className={`text-[10px] px-2 py-0.5 rounded ${
            !showHistory
              ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          最近事件 ({recentEvents.length})
        </button>
        <button
          data-testid={`${testId}-tab-history`}
          onClick={() => setShowHistory(true)}
          className={`text-[10px] px-2 py-0.5 rounded ${
            showHistory
              ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          阶段历史
        </button>
        <div className="flex-1" />
        <button
          data-testid={`${testId}-refresh`}
          onClick={refresh}
          disabled={loading}
          className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          🔄
        </button>
      </div>

      {/* 事件列表 */}
      <div
        data-testid={showHistory ? `${testId}-history` : `${testId}-recent`}
        className="max-h-48 overflow-y-auto"
      >
        {showHistory ? (
          <div className="p-2 text-[10px] text-[var(--text-secondary)]">
            <div>当前阶段: {visual.label}</div>
            <div>来源: {state?.source || '-'}</div>
            <div>进入时间: {state ? new Date(state.entered_at * 1000).toLocaleTimeString('zh-CN') : '-'}</div>
            <div className="mt-1">关联工具: {visual.linkedTab || '无'}</div>
          </div>
        ) : recentEvents.length === 0 ? (
          <div className="p-3 text-[10px] text-[var(--text-tertiary)] text-center">
            暂无阶段变更事件
          </div>
        ) : (
          recentEvents.map((evt, i) => {
            const toStage = evt.to_stage || 'idle';
            const v = STAGE_VISUALS[toStage];
            return (
              <div
                key={evt.event_id || i}
                data-testid={`${testId}-event-${i}`}
                className="px-2 py-1 border-b border-[var(--border-color)] last:border-b-0"
              >
                <div className="flex items-center gap-1.5">
                  {evt.from_stage && (
                    <>
                      <span className="text-[10px] text-[var(--text-secondary)]">
                        {STAGE_VISUALS[evt.from_stage].emoji}
                      </span>
                      <span className="text-[10px] text-[var(--text-secondary)]">→</span>
                    </>
                  )}
                  <span className="text-xs">{v.emoji}</span>
                  <span className="text-[10px] font-medium text-[var(--text-primary)]">
                    {v.label}
                  </span>
                  <div className="flex-1" />
                  <span className="text-[9px] text-[var(--text-tertiary)] tabular-nums">
                    {new Date(evt.timestamp * 1000).toLocaleTimeString('zh-CN')}
                  </span>
                </div>
                {evt.reason && (
                  <div className="text-[9px] text-[var(--text-secondary)] truncate ml-4">
                    {evt.reason}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 错误 */}
      {error && (
        <div
          data-testid={`${testId}-error`}
          className="px-3 py-1.5 bg-red-500/10 text-red-400 text-[10px] border-t border-red-500/20"
        >
          ⚠️ {error}
        </div>
      )}
    </div>
  );
};

// ============================================================
// 主组件
// ====================================

export const StageDetectorBadge: React.FC<StageDetectorBadgeProps> = ({
  sessionId,
  compact = true,
  wsUrl,
  testId = 'stage-detector-badge',
  onStageChange,
  onAutoFollowChange,
}) => {
  const stage = useStage({ sessionId, wsUrl, autoConnect: true });
  const { state, history, recentEvents, loading, error, connected, refresh, detect, forceStage, setAutoFollow } = stage;
  const [expanded, setExpanded] = useState(false);

  // 通知父组件阶段变化
  useEffect(() => {
    if (state && onStageChange) {
      onStageChange(state.stage, state);
    }
  }, [state?.stage, state, onStageChange]);

  // 通知父组件 Auto-Follow 变化
  useEffect(() => {
    if (state && onAutoFollowChange) {
      onAutoFollowChange(state.auto_follow);
    }
  }, [state?.auto_follow, onAutoFollowChange]);

  return (
    <div className="relative inline-block">
      {compact || !expanded ? (
        <CompactBadge
          state={state}
          connected={connected}
          onClick={() => setExpanded((v) => !v)}
          testId={testId}
        />
      ) : null}

      {expanded && (
        <>
          {/* 点击外部关闭 */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setExpanded(false)}
            aria-hidden="true"
          />
          <DetailPanel
            state={state}
            recentEvents={recentEvents}
            connected={connected}
            loading={loading}
            error={error}
            refresh={refresh}
            detect={detect}
            forceStage={forceStage}
            setAutoFollow={setAutoFollow}
            onClose={() => setExpanded(false)}
            testId={`${testId}-panel`}
          />
        </>
      )}
    </div>
  );
};

export default StageDetectorBadge;
