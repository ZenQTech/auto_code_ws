/**
 * # ============================================================
 * VibeSoloShell - Solo 模式主壳组件 (v1.0.0)
 * Cycle 60 G60-2.2
 * # ============================================================
 * 核心作用：Solo 模式（对标 Codex/Trae Solo）的统一整合壳
 * 运行流程：
 *   1. 顶部：LoopStatusBar（含 Goal mode 岛台）
 *   2. 主体：ThreePanelLayout（左历史 / 中主舞台 / 右工具矩阵）
 *   3. 底部：AutoFollowController 联动
 *   4. 错误状态：右下角浮层 + 重试
 * 设计要点：
 *   - 复用既有 useVibeCoding / useAutoFollow / useModals
 *   - 移动端自动切换到 MobileSoloSheet
 *   - localStorage 持久化布局宽度
 *   - 错误兜底 + 重试机制
 * 输入参数：无（通过 useLocation / useParams 可选扩展）
 * 输出结果：Solo 模式完整 UI
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 60 G60-2.2 初次创建
 * ============================================================
 */

import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useVibeCoding } from '../hooks/useVibeCoding';
import { useAutoFollow } from '../hooks/useAutoFollow';
import { useModals } from '../hooks/useModals';
import { useLoopState } from '../hooks/useLoopState';
import { useIsMobile } from '../hooks/useResponsive';

import LoopStatusBar from '../components/LoopStatusBar';
import VibeCodingStage from '../components/VibeCodingStage';
import PlanExecutorPanel from '../components/PlanExecutorPanel';
import LoopStateMachineView from '../components/LoopStateMachineView';
import AutoFollowController from '../components/AutoFollowController';
import ThreePanelLayout from '../components/ThreePanelLayout';
import SessionHistorySidebar from '../components/SessionHistorySidebar';
import ToolsMatrixPanel from '../components/ToolsMatrixPanel';
import MobileSoloSheet from '../components/MobileSoloSheet';

// ============================================================
// 组件
// ============================================================

export const VibeSoloShell: React.FC = () => {
  const navigate = useNavigate();
  const modals = useModals();
  const vibeCoding = useVibeCoding();
  const autoFollow = useAutoFollow(modals);
  const loopState = useLoopState({ sessionId: vibeCoding.session?.id });
  const isMobile = useIsMobile();

  // 输入区本地 state
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-20250514');

  // 启动
  const handleStart = useCallback(async () => {
    if (!prompt.trim()) return;
    await vibeCoding.startSession(prompt, model);
  }, [prompt, model, vibeCoding]);

  // 清空
  const handleClear = useCallback(() => {
    if (window.confirm('确认清空当前 session？')) {
      vibeCoding.clearSession();
      setPrompt('');
    }
  }, [vibeCoding]);

  // 移动端使用 MobileSoloSheet
  if (isMobile) {
    return (
      <MobileSoloSheet
        vibeCoding={vibeCoding}
        autoFollow={autoFollow}
        modals={modals}
        prompt={prompt}
        setPrompt={setPrompt}
        model={model}
        setModel={setModel}
        onStart={handleStart}
        onClear={handleClear}
      />
    );
  }

  // 桌面端：完整 Solo 模式（Codex/Trae Solo 标志性三栏）
  return (
    <div
      className="h-screen flex flex-col bg-[var(--bg-app)] text-[var(--text-primary)]"
      data-testid="vibe-solo-shell"
    >
      {/* 1. 顶部 Goal 岛台 */}
      <LoopStatusBar
        loopState={loopState.state}
        progress={loopState.progress}
        eta={loopState.eta}
        history={loopState.history}
        vibeState={vibeCoding.state}
        sessionActive={!!vibeCoding.session}
        onPause={vibeCoding.pause}
        onResume={vibeCoding.resume}
        onCancel={vibeCoding.cancel}
        onClear={handleClear}
        onToggleAutoFollow={() => autoFollow.setEnabled(!autoFollow.enabled)}
        autoFollowEnabled={autoFollow.enabled}
      />

      {/* 2. 主区域：三栏布局 */}
      <div className="flex-1 min-h-0 relative">
        <ThreePanelLayout
          left={<SessionHistorySidebar vibeCoding={vibeCoding} />}
          center={
            <div className="h-full overflow-y-auto p-4">
              <VibeCodingStage
                prompt={prompt}
                setPrompt={setPrompt}
                model={model}
                setModel={setModel}
                vibeCoding={vibeCoding}
                onStart={handleStart}
              />
            </div>
          }
          right={<ToolsMatrixPanel modals={modals} autoFollow={autoFollow} />}
          defaultLeftWidth={260}
          defaultRightWidth={320}
          minPanelWidth={220}
          maxLeftWidth={380}
          maxRightWidth={500}
          storageKey="hermes.solo.layout"
        />

        {/* Plan Executor 浮层（在中央上方叠加，不占主舞台空间） */}
        {modals.planExecutor.open && vibeCoding.session?.planId && (
          <div
            className="absolute top-2 left-1/2 -translate-x-1/2 z-20 w-[640px] max-w-[90vw] glass-themed rounded-xl shadow-[var(--shadow-md)] animate-lift-in"
            data-testid="plan-executor-overlay"
          >
            <PlanExecutorPanel
              planId={vibeCoding.session.planId}
              sessionId={vibeCoding.session.id}
              onClose={modals.planExecutor.onClose}
            />
          </div>
        )}

        {/* Loop 状态机浮层 */}
        {modals.loopState.open && (
          <div
            className="absolute top-2 right-2 z-20 w-[420px] max-w-[90vw] glass-themed rounded-xl shadow-[var(--shadow-md)] animate-lift-in"
            data-testid="loop-state-overlay"
          >
            <LoopStateMachineView
              state={loopState.state}
              history={loopState.history}
              onClose={modals.loopState.onClose}
            />
          </div>
        )}
      </div>

      {/* 3. Auto-Follow 联动（无 UI 纯逻辑） */}
      <AutoFollowController autoFollow={autoFollow} vibeCoding={vibeCoding} />

      {/* 4. 错误提示 + 重试 */}
      {vibeCoding.error && (
        <div
          className="fixed bottom-4 right-4 max-w-md p-4 error-card-themed shadow-lg animate-lift-in"
          data-testid="solo-error-toast"
        >
          <div className="font-semibold mb-1 flex items-center gap-2">
            <span>⚠️</span>
            <span>错误</span>
          </div>
          <div className="text-sm">{vibeCoding.error}</div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => handleStart()}
              className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200"
              data-testid="solo-error-retry"
            >
              重试
            </button>
            <button
              onClick={() => navigate('/select-mode')}
              className="text-xs px-2 py-1 bg-[var(--bg-elevated)] rounded text-[var(--text-secondary)]"
            >
              返回选择
            </button>
          </div>
        </div>
      )}

      {/* 5. 返回模式选择 */}
      <button
        onClick={() => navigate('/select-mode')}
        className="fixed top-20 left-4 px-3 py-1.5 text-sm bg-[var(--bg-elevated)]/80 backdrop-blur
                   border border-[var(--border-color)] rounded-lg
                   hover:border-hermes-500 transition-colors z-10"
        data-testid="solo-back-to-mode"
      >
        ← 模式选择
      </button>
    </div>
  );
};

export default VibeSoloShell;
