/**
 * # ============================================================
 * # StageDetectorView 阶段检测器全屏视图 (v1.0.0)
 * # Cycle 63 G63-03
 * # ====================================
 * # 核心作用：作为 EmbeddedTools 的 stage tab 内容
 * #           展示完整的阶段状态、Auto-Follow 配置、最近事件
 * # 运行流程：
 * #   1. 接收 sessionId，订阅阶段状态
 * #   2. 展示大尺寸当前阶段卡片
 * #   3. Auto-Follow 开关
 * #   4. 手动阶段切换按钮组
 * #   5. 最近阶段变更事件流
 * # 设计要点：
 * #   - 适配 EmbeddedTools 容器宽度
 * #   - 主题感知
 * #   - 支持从文本手动触发检测
 * 输入参数：
 * #   - sessionId?: string | null
 * #   - onTabSwitch?: (tab: string) => void  Auto-Follow 切换面板时回调
 * # 输出结果：UI 组件
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 63 G63-03 初次创建
 * # ====================================
 */

import React, { useState } from 'react';
import { useStage, type StageId, type StageState } from '../hooks/useStage';

// ============================================================
// 阶段视觉配置（与 StageDetectorBadge 同步）
// ====================================

interface StageVisual {
  label: string;
  emoji: string;
  color: string;
  description: string;
  linkedTab: string | null;
}

const STAGE_VISUALS: Record<StageId, StageVisual> = {
  idle: { label: '空闲', emoji: '⏸️', color: '#6b7280', description: '等待开始', linkedTab: null },
  prd: { label: '需求分析', emoji: '📋', color: '#3b82f6', description: '正在生成 PRD / 需求文档', linkedTab: 'context' },
  coding: { label: '编码', emoji: '💻', color: '#10b981', description: '正在编写代码', linkedTab: 'editor' },
  preview: { label: '预览', emoji: '👀', color: '#f59e0b', description: '正在预览 / 测试', linkedTab: 'browser' },
  deploy: { label: '部署', emoji: '🚀', color: '#ef4444', description: '正在部署 / 发布', linkedTab: 'terminal' },
  done: { label: '完成', emoji: '✅', color: '#8b5cf6', description: '任务已完成', linkedTab: 'metrics' },
};

const ALL_STAGES: StageId[] = ['idle', 'prd', 'coding', 'preview', 'deploy', 'done'];

export interface StageDetectorViewProps {
  sessionId?: string | null;
  wsUrl?: string;
  testId?: string;
  onTabSwitch?: (tab: string) => void;
}

export const StageDetectorView: React.FC<StageDetectorViewProps> = ({
  sessionId,
  wsUrl,
  testId = 'stage-detector-view',
  onTabSwitch,
}) => {
  const [detectText, setDetectText] = useState('');
  const sid = sessionId || 'default';
  const stage = useStage({ sessionId: sid, wsUrl, autoConnect: !!sessionId });
  const { state, recentEvents, loading, error, connected, refresh, detect, forceStage, setAutoFollow, history } = stage;
  const cur = state?.stage || 'idle';
  const visual = STAGE_VISUALS[cur];

  const handleForce = async (s: StageId) => {
    const newState = await forceStage(s, 'manual override from view');
    if (newState && onTabSwitch) {
      const v = STAGE_VISUALS[s];
      if (v.linkedTab) onTabSwitch(v.linkedTab);
    }
  };

  const handleAutoFollow = async () => {
    if (state) {
      await setAutoFollow(!state.auto_follow);
    }
  };

  return (
    <div
      data-testid={testId}
      className="flex flex-col h-full p-3 gap-3 text-sm text-[var(--text-primary)]"
    >
      {/* 顶部状态条 */}
      <div
        data-testid={`${testId}-header`}
        className="flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">🎯</span>
          <h2 className="text-sm font-semibold">阶段检测器</h2>
          <span
            data-testid={`${testId}-connection`}
            className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              connected
                ? 'bg-green-500/20 text-green-400'
                : 'bg-gray-500/20 text-gray-400'
            }`}
          >
            {connected ? '已连接' : '未连接'}
          </span>
        </div>
        <button
          data-testid={`${testId}-refresh`}
          onClick={refresh}
          disabled={loading}
          className="text-[10px] px-2 py-1 rounded
                     bg-[var(--bg-elevated)] text-[var(--text-secondary)]
                     hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          🔄 刷新
        </button>
      </div>

      {/* 大尺寸当前阶段卡片 */}
      <div
        data-testid={`${testId}-current`}
        className="rounded-lg p-3 border"
        style={{
          backgroundColor: `${visual.color}15`,
          borderColor: `${visual.color}40`,
        }}
      >
        <div className="flex items-center gap-3">
          <span
            data-testid={`${testId}-emoji`}
            className="text-3xl leading-none"
          >
            {visual.emoji}
          </span>
          <div className="flex-1 min-w-0">
            <div
              data-testid={`${testId}-label`}
              className="text-base font-bold"
              style={{ color: visual.color }}
            >
              {visual.label}
            </div>
            <div className="text-[10px] text-[var(--text-secondary)]">
              {visual.description}
            </div>
            {state && (
              <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                来源: {state.source} · {state.reason || '-'}
              </div>
            )}
          </div>
          {state && state.confidence > 0 && (
            <div className="text-right">
              <div
                data-testid={`${testId}-confidence`}
                className="text-2xl font-bold tabular-nums"
                style={{ color: visual.color }}
              >
                {Math.round(state.confidence * 100)}%
              </div>
              <div className="text-[9px] text-[var(--text-secondary)]">置信度</div>
            </div>
          )}
        </div>
      </div>

      {/* Auto-Follow 开关 */}
      <div
        data-testid={`${testId}-autofollow`}
        className="flex items-center justify-between p-2.5 rounded
                   bg-[var(--bg-elevated)] border border-[var(--border-color)]"
      >
        <div>
          <div className="text-xs font-medium">🔄 Auto-Follow 自动跟随</div>
          <div className="text-[10px] text-[var(--text-secondary)]">
            阶段变化时联动工具面板切换
          </div>
        </div>
        <button
          data-testid={`${testId}-autofollow-toggle`}
          onClick={handleAutoFollow}
          className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
            state?.auto_follow ? 'bg-hermes-500' : 'bg-gray-400/40'
          }`}
          role="switch"
          aria-checked={state?.auto_follow || false}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
              state?.auto_follow ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {/* 阶段切换网格 */}
      <div data-testid={`${testId}-stages`}>
        <div className="text-[10px] text-[var(--text-secondary)] mb-1.5">
          手动设置阶段（联动工具面板）
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {ALL_STAGES.map((s) => {
            const v = STAGE_VISUALS[s];
            const active = s === cur;
            return (
              <button
                key={s}
                data-testid={`${testId}-stage-${s}`}
                onClick={() => handleForce(s)}
                className={`flex flex-col items-center gap-0.5 p-2 rounded transition-all ${
                  active
                    ? 'text-white shadow-sm'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                style={active ? { backgroundColor: v.color } : {}}
                title={`${v.label} → ${v.linkedTab || '无'}`}
              >
                <span className="text-lg leading-none">{v.emoji}</span>
                <span className="text-[10px] font-medium">{v.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 文本检测 */}
      <div data-testid={`${testId}-detect`} className="space-y-1.5">
        <div className="text-[10px] text-[var(--text-secondary)]">
          从文本检测阶段（用于调试）
        </div>
        <textarea
          data-testid={`${testId}-detect-input`}
          value={detectText}
          onChange={(e) => setDetectText(e.target.value)}
          placeholder='例如：让我写一个 function foo() { ... }'
          className="w-full h-12 px-2 py-1 text-xs rounded
                     bg-[var(--bg-elevated)] border border-[var(--border-color)]
                     focus:outline-none focus:border-hermes-500 resize-none"
        />
        <div className="flex items-center gap-1">
          <button
            data-testid={`${testId}-detect-btn`}
            onClick={async () => {
              if (detectText.trim()) {
                await detect(detectText, false);
                setDetectText('');
              }
            }}
            disabled={!detectText.trim()}
            className="text-[10px] px-2 py-1 rounded
                       bg-hermes-500 text-white hover:opacity-90
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            🔍 规则检测
          </button>
          <button
            data-testid={`${testId}-detect-llm-btn`}
            onClick={async () => {
              if (detectText.trim()) {
                await detect(detectText, true);
                setDetectText('');
              }
            }}
            disabled={!detectText.trim()}
            className="text-[10px] px-2 py-1 rounded
                       bg-purple-500 text-white hover:opacity-90
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            🤖 LLM 检测
          </button>
        </div>
      </div>

      {/* 最近事件 */}
      <div data-testid={`${testId}-events`} className="flex-1 min-h-0 flex flex-col">
        <div className="text-[10px] text-[var(--text-secondary)] mb-1 flex items-center justify-between">
          <span>最近事件 ({recentEvents.length})</span>
          <span>历史 ({history.length})</span>
        </div>
        <div className="flex-1 overflow-y-auto rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
          {recentEvents.length === 0 ? (
            <div
              data-testid={`${testId}-empty`}
              className="p-3 text-[10px] text-[var(--text-tertiary)] text-center"
            >
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
                  className="px-2 py-1.5 border-b border-[var(--border-color)] last:border-b-0"
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
                    <span className="text-sm">{v.emoji}</span>
                    <span className="text-[10px] font-medium">{v.label}</span>
                    {evt.confidence !== null && evt.confidence !== undefined && (
                      <span className="text-[9px] text-[var(--text-secondary)]">
                        {Math.round(evt.confidence * 100)}%
                      </span>
                    )}
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
      </div>

      {/* 错误显示 */}
      {error && (
        <div
          data-testid={`${testId}-error`}
          className="px-2 py-1.5 rounded bg-red-500/10 text-red-400 text-[10px]
                     border border-red-500/20"
        >
          ⚠️ {error}
        </div>
      )}
    </div>
  );
};

export default StageDetectorView;
