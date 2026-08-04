/**
 * # ============================================================
 * VibeSoloShell - Solo 模式主壳组件 (v2.1.0) 完全重写
 * Cycle 60+ Solo 重构 - 对标 Codex/Trae Solo
 * # ============================================================
 * 核心作用：Solo 模式（对标 Codex/Trae Solo）的统一整合壳
 *
 * 完整功能清单（v2.1.0 重写）：
 *   1. 顶部多任务并行 Tab Bar（对标 Trae 多任务并行）
 *   2. LoopStatusBar（Goal 岛台 + Plan Mode 开关 + AutoFollow 联动）
 *   3. 三栏布局：
 *      - 左：会话历史 + 任务列表
 *      - 中：主舞台（VibeCoding + Composer + Loop 状态可视化）
 *      - 右：内嵌工具矩阵（编辑器/终端/浏览器/代码变更/内存/指标）
 *   4. 全局命令面板 ⌘K（导航 + 工具 + 动作）
 *   5. 快捷键帮助面板 ⌘/（Codex 风格 7 contexts）
 *   6. SoloOnboarding 入门引导（首次进入显示）
 *   7. 移动端：自动切换到 MobileSoloSheet
 *
 * 设计要点：
 *   - 复用既有 useVibeCoding / useAutoFollow / useModals
 *   - 多任务并行 tab 状态（独立 session）
 *   - localStorage 持久化布局宽度
 *   - 错误兜底 + 重试机制
 *   - 7 个 Codex 风格快捷键 contexts
 *   - 全局命令面板（对标 Codex ⌘K / Trae Solo ⌘P）
 *   - v2.1.0 布局优化：
 *     - 顶部 4 层（LoopStatusBar / TaskTabs / 工具栏）总高 84px，更紧凑
 *     - 工具栏 h-8 单行布局，三段式：左 Plan Mode / 中状态 / 右快捷键
 *     - 浮动按钮精确定位：左下 ⌘K + 入门，右上 ← 模式选择（更隐蔽）
 *     - 错误 toast 右下角，符合系统通知位置
 *
 * 输入参数：无（通过 useLocation / useParams 可选扩展）
 * 输出结果：Solo 模式完整 UI
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 60 G60-2.2 初次创建
 *   - 2026-08-03 | v1.1.0 | Cycle 60 G60-3.2 集成 CommandPalette + ⌘K 快捷键
 *   - 2026-08-03 | v1.1.1 | Cycle 60 G60-FIX-2 修复：session 为空时不再强制关闭 panel
 *   - 2026-08-04 | v2.0.0 | Solo 完全重写
 *   - 2026-08-04 | v2.1.0 | G60-FIX-17 布局与样式对齐优化：
 *                                  - 工具栏高度 py-1.5 → h-8 (32px)，单行三段布局
 *                                  - 浮动按钮位置调整：模式选择移到右下角（更不显眼）
 *                                  - 状态指示器字号统一 11px，与 LoopStatusBar 一致
 *                                  - 错误 toast 使用主题色（替代硬编码 red-100）
 *                                  - 三段式工具栏分隔：左 Plan / 中状态 / 右快捷键
 *                                  - 优化 Plan 模式显示 + 状态文本对齐
 * ============================================================
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { useVibeCoding } from '../hooks/useVibeCoding';
import { useAutoFollow } from '../hooks/useAutoFollow';
import { useModals } from '../hooks/useModals';
import { useLoopState } from '../hooks/useLoopState';
import { useIsMobile } from '../hooks/useResponsive';
import { useDesignTokens } from '../hooks/useDesignTokens';
import {
  useShortcut,
  setActiveShortcutContext,
  subscribeShortcutContext,
} from '../hooks/useShortcut';

import LoopStatusBar from '../components/LoopStatusBar';
import VibeCodingStage from '../components/VibeCodingStage';
import AutoFollowController from '../components/AutoFollowController';
import ThreePanelLayout from '../components/ThreePanelLayout';
import SessionHistorySidebar from '../components/SessionHistorySidebar';
import ToolsMatrixPanel from '../components/ToolsMatrixPanel';
import MobileSoloSheet from '../components/MobileSoloSheet';
import CommandPalette from '../components/CommandPalette';
import SoloPanelsContainer from '../components/SoloPanelsContainer';
import PlanModeToggle, { getPlanMode, setPlanModeGlobal } from '../components/PlanModeToggle';
import TaskTabs, { type TaskTab, type TaskStatus } from '../components/TaskTabs';
import EmbeddedTools from '../components/EmbeddedTools';
import ShortcutHelpPanel from '../components/ShortcutHelpPanel';
import SoloOnboarding, { resetSoloOnboarding } from '../components/SoloOnboarding';

// ============================================================
// 多任务并行 Tab 状态管理
// ====================================

const TABS_STORAGE_KEY = 'hermes.solo.tabs.v1';
const ACTIVE_TAB_STORAGE_KEY = 'hermes.solo.activeTab.v1';

interface TabStorage {
  tabs: TaskTab[];
  activeId: string | null;
}

function readTabsState(): TabStorage {
  if (typeof window === 'undefined') return { tabs: [], activeId: null };
  try {
    const raw = window.localStorage.getItem(TABS_STORAGE_KEY);
    const activeId = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TaskTab[];
      return { tabs: Array.isArray(parsed) ? parsed : [], activeId };
    }
  } catch {
    // 忽略
  }
  return { tabs: [], activeId: null };
}

function writeTabsState(tabs: TaskTab[], activeId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs));
    if (activeId) {
      window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeId);
    } else {
      window.localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
    }
  } catch {
    // 忽略
  }
}

// ============================================================
// 组件
// ====================================

export const VibeSoloShell: React.FC = () => {
  const navigate = useNavigate();
  const modals = useModals();
  const vibeCoding = useVibeCoding();
  const autoFollow = useAutoFollow(modals);
  const loopState = useLoopState({ sessionId: vibeCoding.session?.id });
  const isMobile = useIsMobile();
  const { cycleTheme, setTheme, theme } = useDesignTokens();

  // ========== UI 状态 ==========
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  // 输入区本地 state
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-20250514');

  // ========== 多任务并行 Tab 状态 ==========
  const [{ tabs, activeId }, setTabsState] = useState<TabStorage>(() => readTabsState());

  useEffect(() => {
    writeTabsState(tabs, activeId);
  }, [tabs, activeId]);

  // 同步 session → tab 状态
  useEffect(() => {
    if (!vibeCoding.session) return;
    const sessionId = vibeCoding.session.id;
    setTabsState((prev) => {
      // 若 tab 列表中无此 session，添加
      const exists = prev.tabs.find((t) => t.id === sessionId);
      if (!exists) {
        const newTab: TaskTab = {
          id: sessionId,
          title: vibeCoding.session!.prompt.slice(0, 20) || `任务 ${prev.tabs.length + 1}`,
          status: mapVibeStateToTaskStatus(vibeCoding.state),
          progress: 0,
          model: vibeCoding.session!.model,
          createdAt: new Date().toISOString(),
        };
        return { tabs: [...prev.tabs, newTab], activeId: sessionId };
      }
      // 已有 → 更新 status
      return {
        tabs: prev.tabs.map((t) =>
          t.id === sessionId
            ? { ...t, status: mapVibeStateToTaskStatus(vibeCoding.state) }
            : t
        ),
        activeId: prev.activeId ?? sessionId,
      };
    });
  }, [vibeCoding.session, vibeCoding.state]);

  // 启动 session
  const handleStart = useCallback(async () => {
    if (!prompt.trim()) return;
    const planMode = getPlanMode();
    await vibeCoding.startSession(prompt, model);
    // 简单 toast
    // eslint-disable-next-line no-console
    console.log(`[Solo] Plan mode: ${planMode}`);
  }, [prompt, model, vibeCoding]);

  // 清空
  const handleClear = useCallback(() => {
    if (window.confirm('确认清空当前 session？')) {
      vibeCoding.clearSession();
      setPrompt('');
    }
  }, [vibeCoding]);

  // ========== Tab 操作 ==========
  const handleNewTask = useCallback(() => {
    setPrompt('');
    vibeCoding.clearSession();
    setCommandPaletteOpen(true);
  }, [vibeCoding]);

  const handleSelectTab = useCallback((id: string) => {
    setTabsState((prev) => ({ ...prev, activeId: id }));
    // TODO: 恢复 session
  }, []);

  const handleCloseTab = useCallback((id: string) => {
    setTabsState((prev) => {
      const remaining = prev.tabs.filter((t) => t.id !== id);
      const newActive =
        prev.activeId === id
          ? remaining.length > 0
            ? remaining[remaining.length - 1].id
            : null
          : prev.activeId;
      return { tabs: remaining, activeId: newActive };
    });
  }, []);

  // ========== 快捷键注册 ==========

  // 全局：⌘K 命令面板
  useShortcut('solo-command-palette', 'mod+k', () => {
    setCommandPaletteOpen((prev) => !prev);
  }, { context: 'global' });

  // 全局：⌘/ 快捷键帮助
  useShortcut('solo-shortcut-help', 'mod+/', () => {
    setShortcutHelpOpen(true);
  }, { context: 'global' });

  // 全局：⌘⇧T 主题循环
  useShortcut('solo-cycle-theme', 'mod+shift+t', () => {
    cycleTheme();
  }, { context: 'global' });

  // 全局：⌘B 切换左面板（SessionHistorySidebar）
  const [leftVisible, setLeftVisible] = useState(true);
  useShortcut('solo-toggle-left', 'mod+1', () => {
    setLeftVisible((v) => !v);
  }, { context: 'global' });

  // 全局：⌘2 切换右面板
  const [rightVisible, setRightVisible] = useState(true);
  useShortcut('solo-toggle-right', 'mod+2', () => {
    setRightVisible((v) => !v);
  }, { context: 'global' });

  // 全局：⌘T 新建任务
  useShortcut('solo-new-task', 'mod+t', (e) => {
    e.preventDefault();
    handleNewTask();
  }, { context: 'global' });

  // 全局：⌘W 关闭当前 tab
  useShortcut('solo-close-tab', 'mod+w', (e) => {
    e.preventDefault();
    if (activeId) handleCloseTab(activeId);
  }, { context: 'global' });

  // 全局：⌘⇧P Plan 模式循环切换
  useShortcut('solo-toggle-plan', 'mod+shift+p', (e) => {
    e.preventDefault();
    const order: Array<'off' | 'plan-only' | 'plan-then-execute'> = [
      'plan-only',
      'plan-then-execute',
      'off',
    ];
    const cur = getPlanMode();
    const idx = order.indexOf(cur);
    const next = order[(idx + 1) % order.length];
    setPlanModeGlobal(next);
  }, { context: 'global' });

  // 全局：⌘⇧F Auto-Follow 切换
  useShortcut('solo-toggle-auto-follow', 'mod+shift+f', (e) => {
    e.preventDefault();
    autoFollow.setEnabled(!autoFollow.enabled);
  }, { context: 'global' });

  // 移动端：MobileSoloSheet
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

  // 桌面端：完整 Solo 模式
  return (
    <div
      className="h-screen flex flex-col bg-[var(--bg-app)] text-[var(--text-primary)]"
      data-testid="vibe-solo-shell"
    >
      {/* 1. 顶部 LoopStatusBar（Goal 岛台 + Plan Mode + Auto-Follow） */}
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

      {/* 2. 多任务并行 Tab Bar */}
      <TaskTabs
        tabs={tabs}
        activeId={activeId}
        onSelect={handleSelectTab}
        onClose={handleCloseTab}
        onNew={handleNewTask}
      />

      {/* 3. Plan 模式开关栏（v2.1.0: h-8 单行三段式，对齐 11px 字号） */}
      <div
        className="flex items-center gap-3 h-8 px-3
                   border-b border-[var(--border-color)]
                   bg-[var(--bg-panel)]/80"
        data-testid="solo-toolbar"
      >
        {/* 左段：Plan Mode + 标签 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider font-semibold">
            Plan
          </span>
          <PlanModeToggle showLabel={true} />
        </div>

        {/* 分隔线 */}
        <div className="h-4 w-px bg-[var(--border-color)]" />

        {/* 中段：当前状态指示 */}
        <div className="flex-1 flex items-center gap-2 min-w-0">
          {vibeCoding.session ? (
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] truncate">
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  vibeCoding.state === 'executing'
                    ? 'bg-emerald-500 animate-pulse'
                    : vibeCoding.state === 'error'
                    ? 'bg-red-500'
                    : 'bg-[var(--text-tertiary)]'
                }`}
              />
              <span className="truncate">
                <span className="text-[var(--text-tertiary)]">状态:</span>{' '}
                <span className="font-medium text-[var(--text-primary)]">
                  {vibeCoding.state}
                </span>
              </span>
              <span className="text-[var(--text-tertiary)] opacity-50">·</span>
              <span className="font-mono whitespace-nowrap">
                步骤 {vibeCoding.session.steps.length}
              </span>
            </div>
          ) : (
            <div className="text-[11px] text-[var(--text-tertiary)] truncate">
              等待输入任务...
            </div>
          )}
        </div>

        {/* 右段：快捷键按钮组 */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setShortcutHelpOpen(true)}
            className="px-2 h-6 text-[11px] rounded
                       hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)]
                       hover:text-[var(--text-primary)]
                       flex items-center gap-1 transition-colors"
            title="查看快捷键帮助（⌘/）"
            data-testid="solo-open-shortcut-help"
          >
            <kbd className="px-1 py-0.5 rounded bg-[var(--bg-app)] text-[10px] font-mono border border-[var(--border-color)]">
              ⌘/
            </kbd>
            <span>快捷键</span>
          </button>
        </div>
      </div>

      {/* 4. 主区域：三栏布局 */}
      <div className="flex-1 min-h-0 relative">
        {leftVisible && (
          <ThreePanelLayout
            left={
              <SessionHistorySidebar vibeCoding={vibeCoding} />
            }
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
            right={
              rightVisible ? (
                <EmbeddedTools
                  sessionId={vibeCoding.session?.id}
                  defaultTab="overview"
                />
              ) : (
                <ToolsMatrixPanel modals={modals} autoFollow={autoFollow} />
              )
            }
            defaultLeftWidth={260}
            defaultRightWidth={340}
            minPanelWidth={220}
            maxLeftWidth={380}
            maxRightWidth={520}
            storageKey="hermes.solo.layout.v2"
          />
        )}
        {!leftVisible && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--text-secondary)]">
            左面板已隐藏，按 ⌘1 显示
          </div>
        )}
      </div>

      {/* 5. Auto-Follow 联动（无 UI 纯逻辑） */}
      <AutoFollowController autoFollow={autoFollow} vibeCoding={vibeCoding} />

      {/* 6. 错误提示 + 重试 - v2.1.0 主题色统一 */}
      {vibeCoding.error && (
        <div
          className="fixed bottom-4 right-4 max-w-md p-3 rounded-lg shadow-lg border
                     bg-[var(--bg-elevated)] border-red-500/40 backdrop-blur z-20"
          data-testid="solo-error-toast"
        >
          <div className="font-semibold mb-1 flex items-center gap-2 text-sm text-red-500">
            <span>⚠️</span>
            <span>错误</span>
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] mb-2">
            {vibeCoding.error}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => handleStart()}
              className="text-[11px] px-2.5 py-1 rounded
                         bg-red-500/15 hover:bg-red-500/25
                         text-red-600 dark:text-red-400 transition-colors"
              data-testid="solo-error-retry"
            >
              重试
            </button>
            <button
              onClick={() => navigate('/select-mode')}
              className="text-[11px] px-2.5 py-1 rounded
                         bg-[var(--bg-app)] text-[var(--text-secondary)]
                         hover:text-[var(--text-primary)] transition-colors"
            >
              返回选择
            </button>
          </div>
        </div>
      )}

      {/* 7. 底部操作条：v2.1.0 移至左中位置，避开左栏底部按钮 */}
      <div
        className="fixed bottom-3 left-[276px] flex items-center gap-1.5 z-20"
        data-testid="solo-bottom-actions"
      >
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="h-7 px-2.5 text-[11px] bg-[var(--bg-elevated)]/90 backdrop-blur
                     border border-[var(--border-color)] rounded-md
                     hover:border-hermes-500 transition-colors
                     flex items-center gap-1.5 shadow-sm"
          data-testid="solo-open-command-palette"
          title="打开命令面板（⌘K）"
        >
          <span>🔍</span>
          <span className="font-medium">命令</span>
          <kbd className="px-1 py-0.5 rounded bg-[var(--bg-app)] text-[10px] font-mono border border-[var(--border-color)]">
            ⌘K
          </kbd>
        </button>
        <button
          onClick={() => {
            resetSoloOnboarding();
            setOnboardingOpen(true);
          }}
          className="h-7 w-7 text-[11px] bg-[var(--bg-elevated)]/90 backdrop-blur
                     border border-[var(--border-color)] rounded-md
                     hover:border-hermes-500 transition-colors
                     flex items-center justify-center shadow-sm"
          data-testid="solo-show-onboarding"
          title="重看入门引导"
          aria-label="入门引导"
        >
          ❓
        </button>
        <button
          onClick={() => navigate('/select-mode')}
          className="h-7 px-2 text-[11px] bg-transparent
                     text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]
                     transition-colors flex items-center gap-1
                     border border-transparent hover:border-[var(--border-color)] rounded-md"
          data-testid="solo-back-to-mode"
          title="返回模式选择"
        >
          <span>↩</span>
          <span className="hidden xl:inline">模式</span>
        </button>
      </div>

      {/* 8. CommandPalette 全局命令面板 */}
      <CommandPalette
        modals={modals}
        navigate={navigate}
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onCycleTheme={cycleTheme}
        onClearSession={handleClear}
        onToggleAutoFollow={() => autoFollow.setEnabled(!autoFollow.enabled)}
        autoFollowEnabled={autoFollow.enabled}
      />

      {/* 9. ShortcutHelpPanel 快捷键帮助面板 */}
      <ShortcutHelpPanel
        open={shortcutHelpOpen}
        onClose={() => setShortcutHelpOpen(false)}
      />

      {/* 10. SoloOnboarding 引导（首次显示） */}
      {onboardingOpen && (
        <SoloOnboarding
          onDismiss={() => setOnboardingOpen(false)}
          onStartChat={() => {
            // 焦点移到输入框
            const input = document.querySelector(
              '[data-testid="vibe-coding-composer-input"] textarea, [data-testid="vibe-coding-composer"] textarea'
            ) as HTMLTextAreaElement | null;
            input?.focus();
          }}
          onOpenPalette={() => {
            setOnboardingOpen(false);
            setCommandPaletteOpen(true);
          }}
        />
      )}

      {/* 11. SoloPanelsContainer 统一面板容器 */}
      <SoloPanelsContainer
        modals={modals}
        currentSessionId={vibeCoding.session?.id ?? null}
        currentPlanId={vibeCoding.session?.planId ?? null}
        loopState={loopState.state}
        loopHistory={loopState.history}
      />
    </div>
  );
};

// ============================================================
// 工具函数
// ====================================

function mapVibeStateToTaskStatus(state: string): TaskStatus {
  switch (state) {
    case 'executing':
    case 'clarifying':
    case 'planning':
    case 'reviewing':
      return 'running';
    case 'paused':
      return 'paused';
    case 'error':
      return 'error';
    case 'done':
      return 'done';
    default:
      return 'idle';
  }
}

export default VibeSoloShell;
