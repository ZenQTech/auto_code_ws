/**
 * # ============================================================
 * MobileSoloSheet - Solo 模式移动端适配组件 (v1.0.0)
 * Cycle 60 G60-5.1
 * # ============================================================
 * 核心作用：移动端 (< 768px) Solo 模式专用壳组件
 *           对标 Codex Mobile / Trae Solo 移动端体验
 * 运行流程：
 *   1. 顶部 LoopStatusBar（含 Goal mode 岛台）+ 主题切换器
 *   2. 主体：垂直 Tab 切换 + 全屏内容区（Stage/历史/工具/状态）
 *   3. 底部 Tab Bar：5 个底部入口（Stage/工具/历史/Plan/Auto-Follow）
 *   4. 全屏 Modal 形式打开 PlanExecutor / LoopState 浮层
 *   5. 错误浮层与重试
 * 设计要点：
 *   - 移动端单列布局
 *   - 底部 Tab Bar 始终可见（flex-1 主体内容区滚动）
 *   - 顶部操作按钮在 Stage Tab 可见，简化展示
 *   - 适配 notch / home indicator（safe-area-inset-*）
 *   - touch 优化：按钮最小 44x44px
 *   - 暗色/亮色/高对比度三主题感知
 * 输入参数：{ vibeCoding, autoFollow, modals, prompt, setPrompt, model, setModel, onStart, onClear }
 * 输出结果：移动端 Solo 模式完整 UI
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 60 G60-5.1 初次创建
 *     - 移动端单列布局 + 底部 Tab Bar
 *     - 4 个主 Tab：Stage / 工具 / 历史 / 状态
 *     - 集成 SessionHistorySidebar / ToolsMatrixPanel / VibeCodingStage
 *     - 全屏 PlanExecutor / LoopState 模态
 *     - Auto-Follow 状态卡片
 * ====================================
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import type { UseVibeCodingResult } from '../hooks/useVibeCoding';
import type { UseAutoFollowResult } from '../hooks/useAutoFollow';
import type { UseModalsResult, PanelKey } from '../hooks/useModals';
import { useLoopState } from '../hooks/useLoopState';

import LoopStatusBar from './LoopStatusBar';
import VibeCodingStage from './VibeCodingStage';
import SessionHistorySidebar from './SessionHistorySidebar';
import ToolsMatrixPanel from './ToolsMatrixPanel';
import AutoFollowController from './AutoFollowController';
import PlanExecutorPanel from './PlanExecutorPanel';
import LoopStateMachineView from './LoopStateMachineView';
import { ThemeSwitcher } from './ThemeSwitcher';
import { IconButton } from './ui/IconButton';

// ============================================================
// 类型
// ============================================================

export interface MobileSoloSheetProps {
  vibeCoding: UseVibeCodingResult;
  autoFollow: UseAutoFollowResult;
  modals: UseModalsResult;
  prompt: string;
  setPrompt: (s: string) => void;
  model: string;
  setModel: (s: string) => void;
  onStart: () => Promise<void>;
  onClear: () => void;
}

/** 移动端 Tab 枚举（底部 Tab Bar） */
type MobileTab = 'stage' | 'tools' | 'history' | 'plan' | 'auto-follow';

/** Tab 元数据 */
const TAB_META: Record<MobileTab, { label: string; emoji: string; testid: string }> = {
  stage: { label: 'Stage', emoji: '🌊', testid: 'mobile-tab-stage' },
  tools: { label: '工具', emoji: '🧰', testid: 'mobile-tab-tools' },
  history: { label: '历史', emoji: '🕘', testid: 'mobile-tab-history' },
  plan: { label: 'Plan', emoji: '📋', testid: 'mobile-tab-plan' },
  'auto-follow': { label: '跟随', emoji: '🎯', testid: 'mobile-tab-auto-follow' },
};

/** Tab 顺序（底部 Tab Bar 从左到右） */
const TAB_ORDER: MobileTab[] = ['stage', 'tools', 'history', 'plan', 'auto-follow'];

// ============================================================
// 工具函数
// ============================================================

/** 简化版 VibeState 颜色徽章（移动端） */
const STATE_DOT: Record<string, string> = {
  idle: 'bg-slate-400',
  clarifying: 'bg-amber-400',
  planning: 'bg-purple-400',
  executing: 'bg-emerald-400',
  reviewing: 'bg-cyan-400',
  done: 'bg-green-500',
  paused: 'bg-gray-400',
  cancelled: 'bg-gray-400',
  error: 'bg-red-500',
};

// ============================================================
// 子组件
// ============================================================

/** 移动端 Stage 卡片（紧凑版 VibeCodingStage） */
const MobileStageCard: React.FC<{
  vibeCoding: UseVibeCodingResult;
  prompt: string;
  setPrompt: (s: string) => void;
  model: string;
  setModel: (s: string) => void;
  onStart: () => Promise<void>;
}> = ({ vibeCoding, prompt, setPrompt, model, setModel, onStart }) => {
  const { session, state, isLoading, error, completedSteps } = vibeCoding;
  const dot = STATE_DOT[state] ?? STATE_DOT.idle;
  const isActive =
    state === 'clarifying' || state === 'planning' || state === 'executing' || state === 'reviewing';

  return (
    <div className="space-y-3" data-testid="mobile-stage-card">
      {/* 状态头 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${dot} ${isActive ? 'animate-pulse' : ''}`} />
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {state.toUpperCase()}
            </span>
          </div>
          {session && (
            <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
              {session.id.slice(0, 12)}
            </span>
          )}
        </div>

        {session ? (
          <div className="text-xs text-[var(--text-secondary)] space-y-1">
            <div className="truncate">
              <span className="text-[var(--text-tertiary)]">需求：</span>
              {session.prompt}
            </div>
            <div className="flex items-center gap-3">
              <span>
                <span className="text-[var(--text-tertiary)]">步骤：</span>
                {completedSteps.length} / {session.steps.length}
              </span>
              <span>
                <span className="text-[var(--text-tertiary)]">模型：</span>
                {session.model.replace('claude-', '').replace('-20250514', '')}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-xs text-[var(--text-tertiary)]">未启动 session</div>
        )}

        {error && (
          <div className="mt-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-md p-2">
            ⚠️ {error}
          </div>
        )}
      </div>

      {/* 输入区（无 session 时显示） */}
      {!session && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">描述你的需求</h3>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如：创建一个 React TODO 应用..."
            rows={4}
            className="w-full px-3 py-2 text-sm border border-[var(--border-color)] rounded-lg
                       bg-[var(--bg-app)] text-[var(--text-primary)]
                       focus:outline-none focus:ring-2 focus:ring-hermes-400 resize-none"
            disabled={isLoading}
            data-testid="mobile-prompt-textarea"
          />
          <div className="mt-2 flex items-center gap-2">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="flex-shrink-0 px-2 py-2 text-xs border border-[var(--border-color)]
                         rounded-lg bg-[var(--bg-app)] text-[var(--text-primary)]
                         focus:outline-none focus:ring-2 focus:ring-hermes-400"
              data-testid="mobile-model-select"
            >
              <option value="claude-sonnet-4-20250514">Sonnet 4</option>
              <option value="claude-opus-4-20250514">Opus 4</option>
              <option value="gpt-5.6-terra">GPT-5.6 Terra</option>
              <option value="gpt-5.6-luna">GPT-5.6 Luna</option>
            </select>
            <button
              type="button"
              onClick={onStart}
              disabled={!prompt.trim() || isLoading}
              className="flex-1 px-3 py-2 text-sm font-medium text-white
                         bg-gradient-to-r from-fuchsia-500 via-purple-500 to-cyan-500
                         rounded-lg hover:opacity-90 disabled:opacity-50 transition-all
                         min-h-[44px]"
              data-testid="mobile-start-btn"
            >
              {isLoading ? '启动中...' : '🌊 启动'}
            </button>
          </div>
        </div>
      )}

      {/* Steps 列表（紧凑版） */}
      {session && session.steps.length > 0 && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">执行步骤</h3>
          <div className="space-y-1.5" data-testid="mobile-steps-list">
            {session.steps.map((step, idx) => {
              const isCompleted = step.status === 'completed';
              const isFailed = step.status === 'failed';
              const isRunning = step.status === 'running';
              return (
                <div
                  key={step.id}
                  className="flex items-center gap-2 text-xs"
                  data-testid={`mobile-step-${step.id}`}
                >
                  <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                    {isCompleted ? (
                      <span className="text-emerald-500">✓</span>
                    ) : isFailed ? (
                      <span className="text-red-500">✗</span>
                    ) : isRunning ? (
                      <div className="w-3 h-3 border-2 border-hermes-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <span className="text-[var(--text-tertiary)]">{idx + 1}</span>
                    )}
                  </div>
                  <span
                    className={
                      isCompleted
                        ? 'text-[var(--text-tertiary)] line-through'
                        : isFailed
                          ? 'text-red-500'
                          : isRunning
                            ? 'text-[var(--text-primary)] font-medium'
                            : 'text-[var(--text-secondary)]'
                    }
                  >
                    {step.name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 完整 Stage 组件（高级视图） */}
      <details className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
        <summary className="px-4 py-2 text-xs text-[var(--text-tertiary)] cursor-pointer hover:text-[var(--text-primary)]">
          高级视图（完整 Stage）
        </summary>
        <div className="p-2">
          <VibeCodingStage
            prompt={prompt}
            setPrompt={setPrompt}
            model={model}
            setModel={setModel}
            vibeCoding={vibeCoding}
            onStart={onStart}
          />
        </div>
      </details>
    </div>
  );
};

/** 移动端 Auto-Follow 状态卡片 */
const MobileAutoFollowCard: React.FC<{
  autoFollow: UseAutoFollowResult;
  vibeCoding: UseVibeCodingResult;
}> = ({ autoFollow, vibeCoding }) => {
  return (
    <div className="space-y-3" data-testid="mobile-autofollow-card">
      {/* 状态卡 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎯</span>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Auto-Follow</h3>
          </div>
          <button
            type="button"
            onClick={() => autoFollow.setEnabled(!autoFollow.enabled)}
            className={[
              'px-3 py-1.5 text-xs font-medium rounded-md transition-colors min-h-[36px]',
              autoFollow.enabled
                ? 'bg-hermes-500 text-white'
                : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-color)]',
            ].join(' ')}
            data-testid="mobile-autofollow-toggle"
            aria-pressed={autoFollow.enabled}
          >
            {autoFollow.enabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <p className="text-xs text-[var(--text-tertiary)] leading-relaxed">
          {autoFollow.enabled
            ? 'AI 阶段变化时自动跳转到对应面板并滚动到最新内容。'
            : '当前禁用，手动控制面板切换。'}
        </p>
      </div>

      {/* 最近 follow 记录 */}
      {autoFollow.lastFollowed && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-4 shadow-sm">
          <h4 className="text-xs font-medium text-[var(--text-tertiary)] mb-2">最近跟随</h4>
          <div className="flex items-center justify-between text-xs">
            <div>
              <div className="text-[var(--text-primary)] font-medium">
                {autoFollow.lastFollowed.panelId}
              </div>
              <div className="text-[var(--text-tertiary)] mt-0.5">
                {autoFollow.lastFollowed.reason}
              </div>
            </div>
            <span className="text-[10px] text-[var(--text-tertiary)] font-mono">
              {new Date(autoFollow.lastFollowed.at).toLocaleTimeString()}
            </span>
          </div>
        </div>
      )}

      {/* 历史列表 */}
      {autoFollow.history.length > 0 && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-4 shadow-sm">
          <h4 className="text-xs font-medium text-[var(--text-tertiary)] mb-2">
            跟随历史（{autoFollow.history.length}）
          </h4>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {autoFollow.history
              .slice()
              .reverse()
              .map((rec, idx) => (
                <div
                  key={`${rec.at.getTime()}-${idx}`}
                  className="flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--text-secondary)]">{rec.panelId}</span>
                    <span className="text-[var(--text-tertiary)]">·</span>
                    <span className="text-[var(--text-tertiary)]">{rec.reason}</span>
                  </div>
                  <span className="text-[10px] text-[var(--text-tertiary)] font-mono">
                    {rec.at.toLocaleTimeString()}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 联动控制器（无 UI 纯逻辑组件） */}
      <AutoFollowController autoFollow={autoFollow} vibeCoding={vibeCoding} />
    </div>
  );
};

/** 移动端 Plan 视图 */
const MobilePlanView: React.FC<{
  vibeCoding: UseVibeCodingResult;
  onClose: () => void;
}> = ({ vibeCoding, onClose }) => {
  const planId = vibeCoding.session?.planId;

  if (!planId) {
    return (
      <div
        className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-6 shadow-sm text-center"
        data-testid="mobile-plan-empty"
      >
        <div className="text-3xl mb-2">📋</div>
        <p className="text-sm text-[var(--text-primary)] font-medium">暂无 Plan</p>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          启动 Vibe Session 后将自动生成 Plan
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm overflow-hidden"
      data-testid="mobile-plan-executor"
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <span>📋</span>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Plan 执行</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2 py-1 text-[var(--text-tertiary)]
                     hover:text-[var(--text-primary)] min-h-[36px] min-w-[36px]"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>
      <div className="p-2">
        <PlanExecutorPanel
          planId={planId}
          sessionId={vibeCoding.session!.id}
          onClose={onClose}
        />
      </div>
    </div>
  );
};

/** 移动端 Loop 状态机视图 */
const MobileLoopStateView: React.FC<{
  loopState: ReturnType<typeof useLoopState>;
  onClose: () => void;
}> = ({ loopState, onClose }) => {
  return (
    <div
      className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm overflow-hidden"
      data-testid="mobile-loop-state"
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <span>⚙️</span>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Loop 状态机</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2 py-1 text-[var(--text-tertiary)]
                     hover:text-[var(--text-primary)] min-h-[36px] min-w-[36px]"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>
      <div className="p-2">
        <LoopStateMachineView
          state={loopState.state}
          history={loopState.history}
          onClose={onClose}
        />
      </div>
    </div>
  );
};

// ============================================================
// 主组件
// ============================================================

export const MobileSoloSheet: React.FC<MobileSoloSheetProps> = ({
  vibeCoding,
  autoFollow,
  modals,
  prompt,
  setPrompt,
  model,
  setModel,
  onStart,
  onClear,
}) => {
  const navigate = useNavigate();
  const loopState = useLoopState({ sessionId: vibeCoding.session?.id });
  const [activeTab, setActiveTab] = useState<MobileTab>('stage');

  // 当前 session 变化时自动跳转到 stage
  useEffect(() => {
    if (vibeCoding.session) {
      setActiveTab('stage');
    }
  }, [vibeCoding.session?.id]);

  // Tab 切换
  const handleTabChange = useCallback((tab: MobileTab) => {
    setActiveTab(tab);
  }, []);

  // 返回模式选择
  const handleBack = useCallback(() => {
    navigate('/select-mode');
  }, [navigate]);

  // 渲染主内容
  const renderContent = useCallback(() => {
    switch (activeTab) {
      case 'stage':
        return (
          <MobileStageCard
            vibeCoding={vibeCoding}
            prompt={prompt}
            setPrompt={setPrompt}
            model={model}
            setModel={setModel}
            onStart={onStart}
          />
        );
      case 'tools':
        return <ToolsMatrixPanel modals={modals} autoFollow={autoFollow} />;
      case 'history':
        return <SessionHistorySidebar vibeCoding={vibeCoding} />;
      case 'plan':
        return (
          <MobilePlanView
            vibeCoding={vibeCoding}
            onClose={() => setActiveTab('stage')}
          />
        );
      case 'auto-follow':
        return <MobileAutoFollowCard autoFollow={autoFollow} vibeCoding={vibeCoding} />;
      default:
        return null;
    }
  }, [activeTab, vibeCoding, autoFollow, modals, prompt, model, onStart, setPrompt, setModel]);

  return (
    <div
      className="h-screen flex flex-col bg-[var(--bg-app)] text-[var(--text-primary)]
                 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      data-testid="mobile-solo-sheet"
    >
      {/* ============================================================
       * 顶部 Header
       * ============================================================ */}
      <header
        className="flex-shrink-0 border-b border-[var(--border-color)]
                   bg-[var(--bg-elevated)]/90 backdrop-blur"
        data-testid="mobile-header"
      >
        <div className="flex items-center gap-2 px-3 py-2">
          {/* 返回按钮 */}
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center justify-center w-9 h-9 rounded-md
                       text-[var(--text-secondary)] hover:bg-[var(--bg-panel)]
                       transition-colors min-w-[44px] min-h-[44px]"
            aria-label="返回模式选择"
            data-testid="mobile-back-btn"
          >
            ←
          </button>

          {/* Logo + Title */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div
              className="w-7 h-7 rounded-md bg-gradient-to-br from-fuchsia-500 via-purple-500
                            to-cyan-500 flex items-center justify-center text-white text-sm font-bold"
            >
              🌊
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">Vibe Coding</div>
              <div className="text-[10px] text-[var(--text-tertiary)] truncate">
                {vibeCoding.state} · {vibeCoding.session ? 'Active' : 'Idle'}
              </div>
            </div>
          </div>

          {/* 进度条（小尺寸） */}
          {vibeCoding.session && (
            <div className="hidden xs:flex items-center gap-1.5 px-2">
              <div className="w-16 h-1.5 bg-[var(--bg-panel)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-fuchsia-500 to-cyan-500
                             transition-all duration-500"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(
                        0,
                        ((vibeCoding.completedSteps?.length ?? 0) /
                          Math.max(1, vibeCoding.session.steps.length)) *
                          100,
                      ),
                    )}%`,
                  }}
                />
              </div>
              <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
                {vibeCoding.completedSteps?.length ?? 0}/{vibeCoding.session.steps.length}
              </span>
            </div>
          )}

          {/* Goal mode 操作按钮 */}
          {vibeCoding.session && (
            <div className="flex items-center gap-0.5">
              {(vibeCoding.state === 'executing' || vibeCoding.state === 'planning') && (
                <IconButton
                  icon={<span>⏸</span>}
                  tooltip="暂停"
                  size="sm"
                  onClick={vibeCoding.pause}
                  data-testid="mobile-pause-btn"
                />
              )}
              {vibeCoding.state === 'paused' && (
                <IconButton
                  icon={<span>▶️</span>}
                  tooltip="恢复"
                  size="sm"
                  onClick={vibeCoding.resume}
                  data-testid="mobile-resume-btn"
                />
              )}
              {(vibeCoding.state === 'executing' ||
                vibeCoding.state === 'planning' ||
                vibeCoding.state === 'paused') && (
                <IconButton
                  icon={<span>✖️</span>}
                  tooltip="取消"
                  size="sm"
                  variant="danger"
                  onClick={vibeCoding.cancel}
                  data-testid="mobile-cancel-btn"
                />
              )}
              <IconButton
                icon={<span>🗑️</span>}
                tooltip="清空"
                size="sm"
                onClick={onClear}
                data-testid="mobile-clear-btn"
              />
            </div>
          )}

          {/* Auto-Follow 开关 */}
          <button
            type="button"
            onClick={() => autoFollow.setEnabled(!autoFollow.enabled)}
            className={[
              'flex items-center justify-center w-9 h-9 rounded-md transition-colors min-w-[44px] min-h-[44px]',
              autoFollow.enabled
                ? 'bg-hermes-500/15 text-hermes-600'
                : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-panel)]',
            ].join(' ')}
            aria-label={`Auto-Follow ${autoFollow.enabled ? 'ON' : 'OFF'}`}
            data-testid="mobile-autofollow-header-btn"
          >
            🎯
          </button>

          {/* 主题切换器 */}
          <ThemeSwitcher />
        </div>
      </header>

      {/* ============================================================
       * 主内容区（滚动）
       * ============================================================ */}
      <main
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3"
        data-testid="mobile-main-content"
      >
        {renderContent()}
      </main>

      {/* ============================================================
       * 错误浮层
       * ============================================================ */}
      {vibeCoding.error && (
        <div
          className="fixed bottom-20 left-3 right-3 z-40
                     p-3 rounded-xl error-card-themed shadow-lg animate-lift-in
                     border border-red-300"
          data-testid="mobile-error-toast"
        >
          <div className="flex items-start gap-2">
            <span className="text-lg">⚠️</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-red-700">错误</div>
              <div className="text-xs text-red-600 mt-0.5 line-clamp-2">{vibeCoding.error}</div>
            </div>
            <button
              type="button"
              onClick={onStart}
              className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded
                         hover:bg-red-200 min-h-[36px]"
              data-testid="mobile-error-retry"
            >
              重试
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
       * 底部 Tab Bar（始终可见）
       * ============================================================ */}
      <nav
        className="flex-shrink-0 border-t border-[var(--border-color)]
                   bg-[var(--bg-elevated)]/95 backdrop-blur
                   pb-[env(safe-area-inset-bottom)]"
        data-testid="mobile-tab-bar"
        role="tablist"
        aria-label="Solo 模式导航"
      >
        <div className="flex items-stretch justify-around">
          {TAB_ORDER.map((tab) => {
            const meta = TAB_META[tab];
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => handleTabChange(tab)}
                className={[
                  'flex-1 flex flex-col items-center justify-center gap-0.5',
                  'min-h-[56px] py-1.5 px-1 transition-colors',
                  isActive
                    ? 'text-hermes-600'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
                ].join(' ')}
                data-testid={meta.testid}
              >
                <span
                  className={[
                    'text-xl transition-transform',
                    isActive ? 'scale-110' : 'scale-100',
                  ].join(' ')}
                >
                  {meta.emoji}
                </span>
                <span className="text-[10px] font-medium leading-none">
                  {meta.label}
                </span>
                {isActive && (
                  <div className="absolute top-0 w-8 h-0.5 bg-hermes-500 rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

export default MobileSoloSheet;
