/**
 * # ============================================================
 * MobileSoloSheet 单元测试 (v1.0.0)
 * Cycle 60 G60-5.3
 * # ============================================================
 * 核心作用：验证 MobileSoloSheet 移动端适配组件的渲染与交互
 * 测试覆盖：
 *   - 基础渲染（5 个 Tab 存在）
 *   - Tab 切换（点击切换 active 状态）
 *   - Stage Tab 输入与启动
 *   - Auto-Follow 切换
 *   - 错误浮层显示
 *   - 错误重试回调
 *   - 返回按钮回调
 *   - 子组件挂载（VibeCodingStage / ToolsMatrixPanel / SessionHistorySidebar）
 * ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 60 G60-5.3 初次创建
 * ====================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import MobileSoloSheet from './MobileSoloSheet';
import type { UseVibeCodingResult } from '../hooks/useVibeCoding';
import type { UseAutoFollowResult } from '../hooks/useAutoFollow';
import type { UseModalsResult } from '../hooks/useModals';

// ============================================================
// Mock 依赖
// ====================================

// 1. Mock LoopStatusBar（避免拉取 SSE 副作用）
vi.mock('./LoopStatusBar', () => ({
  default: () => <div data-testid="mock-loop-status-bar" />,
}));

// 2. Mock VibeCodingStage（避免渲染内部表单逻辑）
vi.mock('./VibeCodingStage', () => ({
  default: () => <div data-testid="mock-vibe-coding-stage" />,
}));

// 3. Mock SessionHistorySidebar
vi.mock('./SessionHistorySidebar', () => ({
  default: () => <div data-testid="mock-session-history" />,
}));

// 4. Mock ToolsMatrixPanel
vi.mock('./ToolsMatrixPanel', () => ({
  default: () => <div data-testid="mock-tools-matrix" />,
}));

// 5. Mock AutoFollowController
vi.mock('./AutoFollowController', () => ({
  default: () => <div data-testid="mock-auto-follow-controller" />,
}));

// 6. Mock PlanExecutorPanel
vi.mock('./PlanExecutorPanel', () => ({
  default: () => <div data-testid="mock-plan-executor" />,
}));

// 7. Mock LoopStateMachineView
vi.mock('./LoopStateMachineView', () => ({
  default: () => <div data-testid="mock-loop-state" />,
}));

// 8. Mock ThemeSwitcher
vi.mock('./ThemeSwitcher', () => ({
  ThemeSwitcher: () => <div data-testid="mock-theme-switcher" />,
}));

// 9. Mock IconButton
vi.mock('./ui/IconButton', () => ({
  IconButton: ({ icon, onClick, tooltip, ...rest }: any) => (
    <button onClick={onClick} title={tooltip} data-testid={rest['data-testid']}>
      {icon}
    </button>
  ),
}));

// 10. Mock useLoopState（避免 SSE 订阅）
vi.mock('../hooks/useLoopState', () => ({
  useLoopState: () => ({
    state: { stage: 'idle', progress: 0, eta_seconds: 0, session_id: '', sub_state: {} },
    progress: 0,
    eta: 0,
    history: [],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

// 11. Mock react-router-dom useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// ============================================================
// Mock 工厂
// ====================================

const makeMockVibeCoding = (overrides: Partial<UseVibeCodingResult> = {}): UseVibeCodingResult =>
  ({
    session: null,
    state: 'idle',
    isLoading: false,
    error: null,
    startSession: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    clearSession: vi.fn(),
    resumeSession: vi.fn(),
    retryStep: vi.fn(),
    completedSteps: [],
    ...overrides,
  } as unknown as UseVibeCodingResult);

const makeMockAutoFollow = (overrides: Partial<UseAutoFollowResult> = {}): UseAutoFollowResult =>
  ({
    enabled: true,
    setEnabled: vi.fn(),
    follow: vi.fn(),
    lastFollowed: null,
    history: [],
    ...overrides,
  } as unknown as UseAutoFollowResult);

const makeMockModals = (overrides: Partial<UseModalsResult> = {}): UseModalsResult => {
  const make = (open = false) => ({ open, onOpen: vi.fn(), onClose: vi.fn(), onToggle: vi.fn() });
  return {
    settings: make(),
    mcp: make(),
    compaction: make(),
    skills: make(),
    agentsMd: make(),
    cycle3: make(),
    dualCompaction: make(),
    rules: make(),
    usage: make(),
    fileExplorer: make(),
    loopV7: make(),
    planEditor: make(),
    hooks: make(),
    subagentMemory: make(),
    hookChain: make(),
    cacheStats: make(),
    streamList: make(),
    oauthConfig: make(),
    sessionRollout: make(),
    multiAgentTree: make(),
    traceRule: make(),
    slashCommand: make(),
    customModels: make(),
    mcpRegistry: make(),
    mcpAdvanced: make(),
    mcpIntegrated: make(),
    mcpE2E: make(),
    mcpMultimodal: make(),
    mcpRag: make(),
    mcpRagRealLLM: make(),
    mcpRagPerformance: make(),
    mcpMultimodalRag: make(),
    mcpMultimodalProvider: make(),
    mcpE2EProduction: make(),
    mcpDeploymentValidation: make(),
    mcpProductionEnhancement: make(),
    mcpObservability: make(),
    mcpPlatformIntegration: make(),
    mcpKubernetes: make(),
    mcpServerless: make(),
    mcpStreamProcessing: make(),
    vibeCoding: make(),
    planExecutor: make(),
    loopState: make(),
    autoFollow: make(),
    closeAll: vi.fn(),
    openMulti: vi.fn(),
    ...overrides,
  } as unknown as UseModalsResult;
};

const renderWithRouter = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

// ============================================================
// 测试套件
// ============================================================

describe('MobileSoloSheet - 基础渲染', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染主壳 + 5 个底部 Tab', () => {
    renderWithRouter(
      <MobileSoloSheet
        vibeCoding={makeMockVibeCoding()}
        autoFollow={makeMockAutoFollow()}
        modals={makeMockModals()}
        prompt=""
        setPrompt={vi.fn()}
        model="claude-sonnet-4-20250514"
        setModel={vi.fn()}
        onStart={vi.fn()}
        onClear={vi.fn()}
      />
    );

    // 主壳
    expect(screen.getByTestId('mobile-solo-sheet')).toBeInTheDocument();
    // 顶部 header
    expect(screen.getByTestId('mobile-header')).toBeInTheDocument();
    // 主内容区
    expect(screen.getByTestId('mobile-main-content')).toBeInTheDocument();
    // 底部 Tab Bar
    expect(screen.getByTestId('mobile-tab-bar')).toBeInTheDocument();

    // 5 个 Tab
    expect(screen.getByTestId('mobile-tab-stage')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-tab-tools')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-tab-history')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-tab-plan')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-tab-auto-follow')).toBeInTheDocument();
  });

  it('默认 active tab 为 stage', () => {
    renderWithRouter(
      <MobileSoloSheet
        vibeCoding={makeMockVibeCoding()}
        autoFollow={makeMockAutoFollow()}
        modals={makeMockModals()}
        prompt=""
        setPrompt={vi.fn()}
        model="claude-sonnet-4-20250514"
        setModel={vi.fn()}
        onStart={vi.fn()}
        onClear={vi.fn()}
      />
    );

    const stageTab = screen.getByTestId('mobile-tab-stage');
    expect(stageTab).toHaveAttribute('aria-selected', 'true');
  });
});

describe('MobileSoloSheet - Tab 切换', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('点击 Tools Tab → 切换到 tools', () => {
    renderWithRouter(
      <MobileSoloSheet
        vibeCoding={makeMockVibeCoding()}
        autoFollow={makeMockAutoFollow()}
        modals={makeMockModals()}
        prompt=""
        setPrompt={vi.fn()}
        model="claude-sonnet-4-20250514"
        setModel={vi.fn()}
        onStart={vi.fn()}
        onClear={vi.fn()}
      />
    );

    const toolsTab = screen.getByTestId('mobile-tab-tools');
    fireEvent.click(toolsTab);

    expect(toolsTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('mock-tools-matrix')).toBeInTheDocument();
  });

  it('点击 History Tab → 切换到 history', () => {
    renderWithRouter(
      <MobileSoloSheet
        vibeCoding={makeMockVibeCoding()}
        autoFollow={makeMockAutoFollow()}
        modals={makeMockModals()}
        prompt=""
        setPrompt={vi.fn()}
        model="claude-sonnet-4-20250514"
        setModel={vi.fn()}
        onStart={vi.fn()}
        onClear={vi.fn()}
      />
    );

    const historyTab = screen.getByTestId('mobile-tab-history');
    fireEvent.click(historyTab);

    expect(historyTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('mock-session-history')).toBeInTheDocument();
  });

  it('点击 Auto-Follow Tab → 切换到 auto-follow', () => {
    renderWithRouter(
      <MobileSoloSheet
        vibeCoding={makeMockVibeCoding()}
        autoFollow={makeMockAutoFollow()}
        modals={makeMockModals()}
        prompt=""
        setPrompt={vi.fn()}
        model="claude-sonnet-4-20250514"
        setModel={vi.fn()}
        onStart={vi.fn()}
        onClear={vi.fn()}
      />
    );

    const afTab = screen.getByTestId('mobile-tab-auto-follow');
    fireEvent.click(afTab);

    expect(afTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('mobile-autofollow-card')).toBeInTheDocument();
  });

  it('点击 Plan Tab → 切换到 plan（无 session 显示空状态）', () => {
    renderWithRouter(
      <MobileSoloSheet
        vibeCoding={makeMockVibeCoding()}
        autoFollow={makeMockAutoFollow()}
        modals={makeMockModals()}
        prompt=""
        setPrompt={vi.fn()}
        model="claude-sonnet-4-20250514"
        setModel={vi.fn()}
        onStart={vi.fn()}
        onClear={vi.fn()}
      />
    );

    const planTab = screen.getByTestId('mobile-tab-plan');
    fireEvent.click(planTab);

    expect(planTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('mobile-plan-empty')).toBeInTheDocument();
  });
});

describe('MobileSoloSheet - Stage 输入交互', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('无 session 时显示输入框与启动按钮', () => {
    renderWithRouter(
      <MobileSoloSheet
        vibeCoding={makeMockVibeCoding()}
        autoFollow={makeMockAutoFollow()}
        modals={makeMockModals()}
        prompt="test prompt"
        setPrompt={vi.fn()}
        model="claude-sonnet-4-20250514"
        setModel={vi.fn()}
        onStart={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(screen.getByTestId('mobile-prompt-textarea')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-start-btn')).toBeInTheDocument();
  });

  it('点击启动按钮 → 触发 onStart', () => {
    const onStart = vi.fn();
    renderWithRouter(
      <MobileSoloSheet
        vibeCoding={makeMockVibeCoding()}
        autoFollow={makeMockAutoFollow()}
        modals={makeMockModals()}
        prompt="test"
        setPrompt={vi.fn()}
        model="claude-sonnet-4-20250514"
        setModel={vi.fn()}
        onStart={onStart}
        onClear={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('mobile-start-btn'));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('空 prompt 时启动按钮禁用', () => {
    renderWithRouter(
      <MobileSoloSheet
        vibeCoding={makeMockVibeCoding()}
        autoFollow={makeMockAutoFollow()}
        modals={makeMockModals()}
        prompt=""
        setPrompt={vi.fn()}
        model="claude-sonnet-4-20250514"
        setModel={vi.fn()}
        onStart={vi.fn()}
        onClear={vi.fn()}
      />
    );

    const startBtn = screen.getByTestId('mobile-start-btn');
    expect(startBtn).toBeDisabled();
  });

  it('输入 prompt → setPrompt 被调用', () => {
    const setPrompt = vi.fn();
    renderWithRouter(
      <MobileSoloSheet
        vibeCoding={makeMockVibeCoding()}
        autoFollow={makeMockAutoFollow()}
        modals={makeMockModals()}
        prompt=""
        setPrompt={setPrompt}
        model="claude-sonnet-4-20250514"
        setModel={vi.fn()}
        onStart={vi.fn()}
        onClear={vi.fn()}
      />
    );

    const textarea = screen.getByTestId('mobile-prompt-textarea');
    fireEvent.change(textarea, { target: { value: 'new value' } });
    expect(setPrompt).toHaveBeenCalledWith('new value');
  });
});

describe('MobileSoloSheet - Auto-Follow 切换', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Auto-Follow 头部按钮 → 触发 setEnabled 切换', () => {
    const setEnabled = vi.fn();
    renderWithRouter(
      <MobileSoloSheet
        vibeCoding={makeMockVibeCoding()}
        autoFollow={makeMockAutoFollow({ setEnabled })}
        modals={makeMockModals()}
        prompt=""
        setPrompt={vi.fn()}
        model="claude-sonnet-4-20250514"
        setModel={vi.fn()}
        onStart={vi.fn()}
        onClear={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('mobile-autofollow-header-btn'));
    expect(setEnabled).toHaveBeenCalledWith(false);
  });

  it('Auto-Follow disabled 时按钮不显示激活样式', () => {
    renderWithRouter(
      <MobileSoloSheet
        vibeCoding={makeMockVibeCoding()}
        autoFollow={makeMockAutoFollow({ enabled: false })}
        modals={makeMockModals()}
        prompt=""
        setPrompt={vi.fn()}
        model="claude-sonnet-4-20250514"
        setModel={vi.fn()}
        onStart={vi.fn()}
        onClear={vi.fn()}
      />
    );

    const headerBtn = screen.getByTestId('mobile-autofollow-header-btn');
    expect(headerBtn).toHaveAttribute('aria-label', 'Auto-Follow OFF');
  });
});

describe('MobileSoloSheet - 错误浮层', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('vibeCoding.error 非空时显示错误浮层', () => {
    renderWithRouter(
      <MobileSoloSheet
        vibeCoding={makeMockVibeCoding({ error: '网络错误' })}
        autoFollow={makeMockAutoFollow()}
        modals={makeMockModals()}
        prompt=""
        setPrompt={vi.fn()}
        model="claude-sonnet-4-20250514"
        setModel={vi.fn()}
        onStart={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(screen.getByTestId('mobile-error-toast')).toBeInTheDocument();
    expect(screen.getByText('网络错误')).toBeInTheDocument();
  });

  it('vibeCoding.error 为空时不显示错误浮层', () => {
    renderWithRouter(
      <MobileSoloSheet
        vibeCoding={makeMockVibeCoding({ error: null })}
        autoFollow={makeMockAutoFollow()}
        modals={makeMockModals()}
        prompt=""
        setPrompt={vi.fn()}
        model="claude-sonnet-4-20250514"
        setModel={vi.fn()}
        onStart={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(screen.queryByTestId('mobile-error-toast')).not.toBeInTheDocument();
  });

  it('错误浮层重试按钮 → 触发 onStart', () => {
    const onStart = vi.fn();
    renderWithRouter(
      <MobileSoloSheet
        vibeCoding={makeMockVibeCoding({ error: '错误' })}
        autoFollow={makeMockAutoFollow()}
        modals={makeMockModals()}
        prompt=""
        setPrompt={vi.fn()}
        model="claude-sonnet-4-20250514"
        setModel={vi.fn()}
        onStart={onStart}
        onClear={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('mobile-error-retry'));
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});

describe('MobileSoloSheet - 返回按钮', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('点击返回按钮 → 跳转到 /select-mode', () => {
    renderWithRouter(
      <MobileSoloSheet
        vibeCoding={makeMockVibeCoding()}
        autoFollow={makeMockAutoFollow()}
        modals={makeMockModals()}
        prompt=""
        setPrompt={vi.fn()}
        model="claude-sonnet-4-20250514"
        setModel={vi.fn()}
        onStart={vi.fn()}
        onClear={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('mobile-back-btn'));
    expect(mockNavigate).toHaveBeenCalledWith('/select-mode');
  });
});

describe('MobileSoloSheet - Session 状态展示', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有 session 时显示 session ID 与进度', () => {
    const mockSession = {
      id: 'vibe-12345678abcdefgh',
      prompt: '测试需求',
      model: 'claude-sonnet-4-20250514',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      state: 'executing' as const,
      planId: undefined,
      steps: [
        { id: 's1', name: 'step 1', status: 'completed' as const },
        { id: 's2', name: 'step 2', status: 'running' as const },
      ],
      metrics: { tokens: 0, duration: 0, filesChanged: 0 },
    };

    renderWithRouter(
      <MobileSoloSheet
        vibeCoding={makeMockVibeCoding({
          session: mockSession,
          state: 'executing',
          completedSteps: [mockSession.steps[0]],
        })}
        autoFollow={makeMockAutoFollow()}
        modals={makeMockModals()}
        prompt=""
        setPrompt={vi.fn()}
        model="claude-sonnet-4-20250514"
        setModel={vi.fn()}
        onStart={vi.fn()}
        onClear={vi.fn()}
      />
    );

    // 应该显示 session id 前 12 位（在 font-mono span 内）
    const allText = document.body.textContent ?? '';
    expect(allText).toContain('vibe-1234567');
    // 显示 EXECUTING 状态
    expect(screen.getByText('EXECUTING')).toBeInTheDocument();
    // 显示 step 列表
    const stepsList = screen.getByTestId('mobile-steps-list');
    expect(within(stepsList).getByTestId('mobile-step-s1')).toBeInTheDocument();
    expect(within(stepsList).getByTestId('mobile-step-s2')).toBeInTheDocument();
  });
});

describe('MobileSoloSheet - Session 控制按钮', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executing 状态显示 pause 与 cancel 按钮', () => {
    const mockSession = {
      id: 'vibe-1',
      prompt: 't',
      model: 'm',
      createdAt: '',
      updatedAt: '',
      state: 'executing' as const,
      steps: [],
      metrics: { tokens: 0, duration: 0, filesChanged: 0 },
    };
    const pause = vi.fn();
    const cancel = vi.fn();
    const onClear = vi.fn();

    renderWithRouter(
      <MobileSoloSheet
        vibeCoding={makeMockVibeCoding({ session: mockSession, state: 'executing', pause, cancel })}
        autoFollow={makeMockAutoFollow()}
        modals={makeMockModals()}
        prompt=""
        setPrompt={vi.fn()}
        model="claude-sonnet-4-20250514"
        setModel={vi.fn()}
        onStart={vi.fn()}
        onClear={onClear}
      />
    );

    expect(screen.getByTestId('mobile-pause-btn')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-cancel-btn')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-clear-btn')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mobile-pause-btn'));
    fireEvent.click(screen.getByTestId('mobile-cancel-btn'));
    fireEvent.click(screen.getByTestId('mobile-clear-btn'));

    expect(pause).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('paused 状态显示 resume 按钮', () => {
    const mockSession = {
      id: 'vibe-1',
      prompt: 't',
      model: 'm',
      createdAt: '',
      updatedAt: '',
      state: 'paused' as const,
      steps: [],
      metrics: { tokens: 0, duration: 0, filesChanged: 0 },
    };
    const resume = vi.fn();

    renderWithRouter(
      <MobileSoloSheet
        vibeCoding={makeMockVibeCoding({ session: mockSession, state: 'paused', resume })}
        autoFollow={makeMockAutoFollow()}
        modals={makeMockModals()}
        prompt=""
        setPrompt={vi.fn()}
        model="claude-sonnet-4-20250514"
        setModel={vi.fn()}
        onStart={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(screen.getByTestId('mobile-resume-btn')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mobile-resume-btn'));
    expect(resume).toHaveBeenCalledTimes(1);
  });
});
