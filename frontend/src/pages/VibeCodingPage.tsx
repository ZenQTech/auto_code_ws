/**
 * # ============================================================
 * VibeCodingPage - Vibe Coding 一等页面 (v1.0.1)
 * Cycle 58 G58-01
 * # ============================================================
 * 核心作用：Vibe Coding 模式的主入口页面
 * 运行流程：
 *   1. 用户点击 ModeSelectorPage 的 vibe-coding 卡片 → 跳转 /vibe-coding
 *   2. 顶部显示 LoopStatusBar（持续可见状态条）
 *   3. 主舞台显示 VibeCodingStage（输入 + 进度）
 *   4. 右侧浮动 panel（PlanExecutor / LoopState / AutoFollow）
 *   5. 底部输入区接收用户需求
 *   6. AutoFollowController 自动切换 panel
 * 设计要点：
 *   - 使用 useVibeCoding Hook 管理会话
 *   - 集成 5 大 P0 组件
 *   - 响应式布局
 *   - v1.0.1 主题感知：背景渐变改为 var(--bg-app) 驱动，按钮 bg-white 替换为 var(--bg-panel)
 * 输入参数：无（通过路由参数）
 * 输出结果：完整 Vibe Coding 体验
 * ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 58 G58-01 初次创建
 * #   - 2026-08-03 | v1.0.1 | G60-FIX-16 修复主题感知：硬编码 bg-white/light 渐变替换为 CSS 变量
 * ====================================
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useVibeCoding } from '../hooks/useVibeCoding';
import { useModals } from '../hooks/useModals';
import { useLoopState } from '../hooks/useLoopState';
import { useAutoFollow } from '../hooks/useAutoFollow';

import LoopStatusBar from '../components/LoopStatusBar';
import VibeCodingStage from '../components/VibeCodingStage';
import PlanExecutorPanel from '../components/PlanExecutorPanel';
import LoopStateMachineView from '../components/LoopStateMachineView';
import AutoFollowController from '../components/AutoFollowController';

const VibeCodingPage: React.FC = () => {
  const navigate = useNavigate();
  const modals = useModals();
  const vibeCoding = useVibeCoding();
  const loopState = useLoopState({ sessionId: vibeCoding.session?.id });
  const autoFollow = useAutoFollow(modals);

  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-20250514');

  const handleStart = async () => {
    if (!prompt.trim()) return;
    await vibeCoding.startSession(prompt, model);
  };

  return (
    <div className="min-h-screen bg-[var(--bg-app)] flex flex-col" data-testid="vibe-coding-page">
      {/* 顶部 LoopStatusBar 持续可见 */}
      <LoopStatusBar
        loopState={loopState.state}
        progress={loopState.progress}
        eta={loopState.eta}
        history={loopState.history}
        vibeState={vibeCoding.state}
        sessionActive={!!vibeCoding.session}
      />

      {/* Auto-Follow 联动控制器（无 UI） */}
      <AutoFollowController
        autoFollow={autoFollow}
        vibeCoding={vibeCoding}
      />

      {/* 主区域 */}
      <main className="flex-1 container mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 左：Vibe Coding 主舞台 */}
        <section className="lg:col-span-2 space-y-4">
          <VibeCodingStage
            prompt={prompt}
            setPrompt={setPrompt}
            model={model}
            setModel={setModel}
            vibeCoding={vibeCoding}
            onStart={handleStart}
          />
        </section>

        {/* 右：辅助 panel */}
        <aside className="space-y-4">
          {/* Plan Executor */}
          {modals.planExecutor.open && (
            <PlanExecutorPanel
              planId={vibeCoding.session?.planId}
              sessionId={vibeCoding.session?.id}
              onClose={modals.planExecutor.onClose}
            />
          )}

          {/* Loop 状态机可视化 */}
          {modals.loopState.open && (
            <LoopStateMachineView
              state={loopState.state}
              history={loopState.history}
              onClose={modals.loopState.onClose}
            />
          )}

          {/* panel 控制按钮 - v1.0.1 G60-FIX-16 主题感知 */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={modals.planExecutor.onToggle}
              className="px-3 py-1.5 text-sm bg-[var(--bg-panel)] text-[var(--text-primary)]
                         border border-surface-200 rounded-lg
                         hover:border-hermes-400 transition-colors"
              data-testid="toggle-plan-executor"
            >
              📋 Plan Executor
            </button>
            <button
              onClick={modals.loopState.onToggle}
              className="px-3 py-1.5 text-sm bg-[var(--bg-panel)] text-[var(--text-primary)]
                         border border-surface-200 rounded-lg
                         hover:border-hermes-400 transition-colors"
              data-testid="toggle-loop-state"
            >
              🔁 Loop State
            </button>
            <button
              onClick={modals.vibeCoding.onToggle}
              className="px-3 py-1.5 text-sm bg-[var(--bg-panel)] text-[var(--text-primary)]
                         border border-surface-200 rounded-lg
                         hover:border-hermes-400 transition-colors"
            >
              🌊 Vibe Coding
            </button>
            <button
              onClick={() => autoFollow.setEnabled(!autoFollow.enabled)}
              className={`px-3 py-1.5 text-sm border rounded-lg transition-colors ${
                autoFollow.enabled
                  ? 'bg-hermes-100 border-hermes-400 text-hermes-700'
                  : 'bg-[var(--bg-panel)] border-surface-200 text-[var(--text-primary)]'
              }`}
              data-testid="toggle-auto-follow"
            >
              🎯 Auto-Follow: {autoFollow.enabled ? 'ON' : 'OFF'}
            </button>
          </div>
        </aside>
      </main>

      {/* 底部：错误提示 */}
      {vibeCoding.error && (
        <div className="fixed bottom-4 right-4 max-w-md p-4 bg-red-50 border border-red-200
                        rounded-lg text-red-700 text-sm shadow-lg">
          <div className="font-semibold mb-1">错误</div>
          <div>{vibeCoding.error}</div>
          <button
            onClick={() => vibeCoding.startSession(prompt, model)}
            className="mt-2 text-xs underline"
          >
            重试
          </button>
        </div>
      )}

      {/* 返回按钮 - v1.0.1 G60-FIX-16 主题感知 */}
      <button
        onClick={() => navigate('/select-mode')}
        className="fixed top-20 right-4 px-3 py-1.5 text-sm bg-[var(--bg-panel)]/80 backdrop-blur
                   text-[var(--text-primary)] border border-surface-200 rounded-lg
                   hover:border-hermes-400 transition-colors"
        data-testid="back-to-mode-selector"
      >
        ← 返回模式选择
      </button>
    </div>
  );
};

export default VibeCodingPage;
