# Cycle 60 — 前端 Solo 模式重做 + 3 主题 + TRAE-browseruse 验证

**版本**: v1.0
**日期**: 2026-08-03
**作者**: 智能体调度平台（前端总架构师视角）
**目标**: 对标 Codex / Trae Solo 模式体验，重做前端 Vibe Coding 入口为 Solo 主壳，集成 3 主题切换器、TRAE-browseruse 真实浏览器验证

---

## 1. Context（背景与目标）

### 1.1 现状评估（Phase 1 探索结论）

通过 `ls` + `Read` 关键文件，定位当前前端能力与缺失：

| 模块 | 现状 | 评估 |
|------|------|------|
| [router.tsx](file:///home/qizheng/auto_code_ws/frontend/src/router/router.tsx) | 已注册 `/vibe-coding` 路由 + `/select-mode` 入口 | ✅ 基础可用 |
| [VibeCodingPage.tsx](file:///home/qizheng/auto_code_ws/frontend/src/pages/VibeCodingPage.tsx) | 简单 3 列 grid：左 2/3 主舞台 + 右 1/3 panel 列表 | 🟠 基础布局，缺少 Solo 模式核心要素 |
| [VibeCodingStage.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/VibeCodingStage.tsx) | prompt + model + 步骤列表 | ✅ 完整，但样式需优化 |
| [PlanExecutorPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/PlanExecutorPanel.tsx) | 拉取 /api/composer-plan + SSE 订阅 | ✅ 后端对接完整 |
| [LoopStatusBar.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/LoopStatusBar.tsx) | 顶部状态条（loop stage + progress + ETA） | 🟠 缺 pause/resume/cancel/clear 操作按钮（Goal 岛台） |
| [useAutoFollow.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useAutoFollow.ts) | STAGE_TO_PANEL 映射 + 防抖 500ms | ✅ 可用 |
| [useModals.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useModals.ts) | 47 个 panel 集中管理 | ✅ 性能优化完成 |
| [useDesignTokens.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useDesignTokens.ts) | dark/light/high-contrast 切换 + localStorage | ✅ 基础完成，但缺 UI 入口 |
| [ThreePanelLayout.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ThreePanelLayout.tsx) | 左/中/右可拖拽 + 折叠 + localStorage 持久化 | ✅ 完整 |
| [useResponsive.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useResponsive.ts) | matchMedia + 4 档断点 | ✅ 完整 |
| 后端 `vibe_coding.py` | SSE + 状态机 + start/pause/resume/cancel | ✅ 完整 |

### 1.2 关键缺失（P0）

1. 🔴 **VibeSoloShell 整合壳** — 当前 VibeCodingPage 缺少 Solo 模式核心：左 session 历史侧边栏 + 中主舞台 + 右 tools 矩阵的统一壳
2. 🔴 **UI 基础组件库** — 无 `Button`/`Card`/`Dialog` 等统一组件，47 个 panel 各自写 Tailwind 类
3. 🔴 **ThemeSwitcher 切换器** — 主题机制在后端 Hook 完整，但前端无任何入口触发
4. 🔴 **Goal mode 岛台** — LoopStatusBar 缺 pause/resume/cancel/clear/auto-follow 开关
5. 🟠 **会话历史侧边栏** — Solo 模式应支持快速切回历史 session
6. 🟠 **index.css 主题 CSS 变量** — `data-theme="light"` / `data-theme="high-contrast"` 变量未完整定义（仅有 token 逻辑）
7. 🟠 **TRAE-browseruse 真实验证** — 前端 UI 需用浏览器实际验证，而非纯单元测试

### 1.3 目标完成度

- **Solo 模式体验**：对标 Codex / Trae Solo，左历史 + 中主舞台 + 右工具矩阵
- **主题系统**：3 套（dark/light/high-contrast）+ 持久化 + 一键切换
- **微交互**：ripple / shake / check / lift 等增强 Codex/Trae 同款细节
- **响应式**：移动端 sheet 抽屉、平板双栏、桌面三栏
- **验证**：TRAE-browseruse 真实浏览器自动化测试（截图 + 交互）
- **不破坏向后兼容**：原 `/vibe-coding`、`/chat/*`、`/coding/*` 路由全部保留

---

## 2. 总体方案

### 2.1 6 阶段路线图

```
阶段 1: 基础设施（CSS 主题 + UI 组件库 + 切换器）     → 2 任务
阶段 2: Solo 主壳 + Goal 岛台（核心页面）              → 3 任务
阶段 3: 会话历史侧边栏（Codex/Trae Solo 必备）          → 1 任务
阶段 4: Auto-Follow 深度集成（事件扩展）               → 1 任务
阶段 5: 响应式 + 移动端适配（3 档断点）                → 1 任务
阶段 6: TRAE-browseruse E2E 验证 + 文档               → 2 任务
─────────────────────────────────────────────────────
总: 10 任务 / 6 阶段
```

### 2.2 不破坏向后兼容

- 保留原 [VibeCodingPage.tsx](file:///home/qizheng/auto_code_ws/frontend/src/pages/VibeCodingPage.tsx) 与 `/vibe-coding` 路由（继续工作）
- 新增 `/solo` 路由 + [VibeSoloShell.tsx](file:///home/qizheng/auto_code_ws/frontend/src/pages/VibeSoloShell.tsx) 为新主壳
- 根路由 `/` 增加"进入 Solo"卡片（不替换原 chat/coding 选择）
- 所有现有 47 panel 全部继续工作，仅部分样式微调

---

## 3. 详细任务分解

### 阶段 1：基础设施

#### 任务 1.1：扩展 `index.css` 主题 CSS 变量（3 主题完整落地）

**文件**：[index.css](file:///home/qizheng/auto_code_ws/frontend/src/index.css)（追加）
**位置**：在现有 `:root` 之后追加 `[data-theme="light"]` / `[data-theme="high-contrast"]` 块
**Why**：`useDesignTokens` 已能在 JS 端切换 token，但 CSS 变量未在 `index.css` 定义，导致部分直接用 CSS 变量（`var(--bg-app)`）的组件无效果

**关键 CSS 块**：
```css
[data-theme="light"] {
  --bg-app: #ffffff;
  --bg-panel: #f8f8fa;
  --bg-elevated: #ffffff;
  --text-primary: #0a0a0a;
  --text-secondary: #525260;
  --text-tertiary: #737380;
  --border-color: rgba(0,0,0,0.08);
  --border-hover: rgba(240,160,48,0.6);
  --accent: #f0a030;
  --accent-hover: #fbbf66;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.07);
  --code-bg: #f8f8fa;
  --scrollbar-thumb: rgba(0,0,0,0.2);
  --scrollbar-thumb-hover: rgba(0,0,0,0.4);
}

[data-theme="high-contrast"] {
  --bg-app: #000000;
  --bg-panel: #0a0a0a;
  --bg-elevated: #141414;
  --text-primary: #ffffff;
  --text-secondary: #b2b2b2;
  --text-tertiary: #828282;
  --border-color: rgba(255,255,180,0.3);
  --border-hover: #ffb84d;
  --accent: #ffb84d;
  --accent-hover: #ff9a1a;
  --shadow-sm: 0 0 0 1px rgba(255,180,77,0.3);
  --shadow-md: 0 0 0 2px rgba(255,180,77,0.5);
  --code-bg: #141414;
  --scrollbar-thumb: rgba(255,180,77,0.5);
  --scrollbar-thumb-hover: rgba(255,180,77,0.8);
}

/* 默认 dark 主题继承 :root */
[data-theme="dark"] {
  --bg-app: #0a0a0f;
  --bg-panel: #12121a;
  --bg-elevated: #1a1a24;
  --text-primary: #ffffff;
  --text-secondary: #a3a3b0;
  --text-tertiary: #737380;
  --border-color: rgba(255,255,255,0.08);
  --border-hover: rgba(240,160,48,0.6);
  --accent: #f0a030;
  --accent-hover: #fbbf66;
  --shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.25);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.30);
  --code-bg: #1a1a24;
  --scrollbar-thumb: rgba(255,255,255,0.15);
  --scrollbar-thumb-hover: rgba(255,255,255,0.3);
}

/* 全局 body 应用主题 */
body {
  background: var(--bg-app);
  color: var(--text-primary);
  transition: background-color 0.3s ease, color 0.3s ease;
}

/* 微交互工具类 */
.ripple { position: relative; overflow: hidden; }
.ripple::after {
  content: ''; position: absolute; inset: 0;
  background: radial-gradient(circle, var(--accent) 0%, transparent 70%);
  opacity: 0; transform: scale(0);
  transition: transform 0.5s, opacity 0.5s;
}
.ripple:active::after { opacity: 0.3; transform: scale(2); transition: 0s; }

.shake { animation: shake 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97) both; }
@keyframes shake {
  10%, 90% { transform: translateX(-1px); }
  20%, 80% { transform: translateX(2px); }
  30%, 50%, 70% { transform: translateX(-4px); }
  40%, 60% { transform: translateX(4px); }
}

.check-pulse { animation: check-pulse 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
@keyframes check-pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.2); }
  100% { transform: scale(1); }
}
```

**验证**：浏览器 `document.documentElement.dataset.theme` 切换后，body 背景、文本颜色、border 立即响应（≤ 300ms 过渡）

---

#### 任务 1.2：创建 UI 基础组件库

**新文件**：
- [frontend/src/components/ui/Button.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ui/Button.tsx)
- [frontend/src/components/ui/Card.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ui/Card.tsx)
- [frontend/src/components/ui/Dialog.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ui/Dialog.tsx)
- [frontend/src/components/ui/IconButton.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ui/IconButton.tsx)
- [frontend/src/components/ui/index.ts](file:///home/qizheng/auto_code_ws/frontend/src/components/ui/index.ts)（统一导出）

**Button 关键代码**（其他组件依此模式）：
```tsx
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'icon' | 'danger' | 'gradient';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  icon?: React.ReactNode;
  ripple?: boolean;
}

const variants = {
  primary: 'bg-hermes-500 text-white hover:bg-hermes-600 focus:ring-hermes-500',
  ghost: 'bg-transparent text-surface-700 hover:bg-surface-100 focus:ring-surface-300',
  icon: 'p-2 rounded-full bg-surface-100 text-surface-700 hover:bg-surface-200',
  danger: 'bg-red-500 text-white hover:bg-red-600 focus:ring-red-500',
  gradient: 'bg-gradient-to-r from-fuchsia-500 via-purple-500 to-cyan-500 text-white hover:opacity-90',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', isLoading, icon, children, ripple, className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-medium rounded-md',
          'transition-all focus:outline-none focus:ring-2 focus:ring-offset-2',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          variants[variant], sizes[size],
          ripple && 'ripple',
          className
        )}
        disabled={isLoading || props.disabled}
        {...props}
      >
        {isLoading ? <Spinner size="sm" className="mr-2" /> : icon && <span className="mr-2">{icon}</span>}
        {children}
      </button>
    );
  }
);
```

**Why**：47 个 panel 各自手写 Tailwind 类导致不一致；建立基础组件库后所有 panel 统一

**单元测试**：[Button.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ui/Button.test.tsx)、[Dialog.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ui/Dialog.test.tsx) 等

---

#### 任务 1.3：创建 ThemeSwitcher 切换器组件

**新文件**：[ThemeSwitcher.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ThemeSwitcher.tsx)
**Why**：`useDesignTokens` 完整，但前端无任何 UI 入口；Codex/Trae Solo 顶部导航栏均有快速切换器

**关键代码**：
```tsx
import { Sun, Moon, Contrast } from 'lucide-react';
import { useDesignTokens } from '../hooks/useDesignTokens';

const ICONS = { dark: Moon, light: Sun, 'high-contrast': Contrast };
const LABELS = { dark: '深色', light: '浅色', 'high-contrast': '高对比度' };
const CYCLE: ThemeName[] = ['dark', 'light', 'high-contrast'];

export const ThemeSwitcher: React.FC = () => {
  const { theme, cycleTheme, setTheme } = useDesignTokens();
  const Icon = ICONS[theme];
  return (
    <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-100" data-testid="theme-switcher">
      {CYCLE.map((t) => {
        const TIcon = ICONS[t];
        return (
          <button
            key={t}
            onClick={() => setTheme(t)}
            className={cn(
              'p-1.5 rounded-md transition-all',
              theme === t
                ? 'bg-hermes-500 text-white shadow-sm'
                : 'text-surface-500 hover:text-surface-700 hover:bg-surface-200'
            )}
            aria-label={`切换到 ${LABELS[t]} 主题`}
            data-testid={`theme-${t}`}
          >
            <TIcon className="w-4 h-4" />
          </button>
        );
      })}
    </div>
  );
};
```

**单元测试**：[ThemeSwitcher.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ThemeSwitcher.test.tsx)
- 点击切换按钮触发 `setTheme`
- data-theme 属性同步到 `<html>`
- localStorage 持久化

---

### 阶段 2：Solo 主壳 + Goal 岛台

#### 任务 2.1：增强 LoopStatusBar 为 Goal mode 岛台

**文件**：[LoopStatusBar.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/LoopStatusBar.tsx)（修改）
**Why**：当前仅显示状态，缺操作按钮；Codex/Trae Solo 顶部有 ⏸▶️✖️🗑️ 一组操作

**新增 Props**：
```tsx
export interface LoopStatusBarProps {
  // ... 既有
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onClear?: () => void;
  onToggleAutoFollow?: () => void;
  autoFollowEnabled?: boolean;
}
```

**新增 UI**（追加到 header 右侧）：
```tsx
{/* Goal mode 操作岛台 */}
<div className="flex items-center gap-1 ml-auto" data-testid="goal-island">
  <IconButton onClick={onPause} disabled={state !== 'executing'} icon="⏸" testid="status-pause-btn" />
  <IconButton onClick={onResume} disabled={state !== 'paused'} icon="▶️" testid="status-resume-btn" />
  <IconButton onClick={onCancel} disabled={!['executing', 'paused'].includes(state)} icon="✖️" testid="status-cancel-btn" variant="danger" />
  <IconButton onClick={onClear} icon="🗑️" testid="status-clear-btn" />
  <div className="h-6 w-px bg-surface-200 mx-1" />
  <IconButton
    onClick={onToggleAutoFollow}
    icon="🎯"
    testid="status-auto-follow-btn"
    active={autoFollowEnabled}
  />
  <ThemeSwitcher />
</div>
```

**联动**：通过 props 接收回调，由父组件 [VibeSoloShell](file:///home/qizheng/auto_code_ws/frontend/src/pages/VibeSoloShell.tsx) 注入 `vibeCoding.pause/resume/cancel/clear` + `autoFollow.toggle`

**不破坏向后兼容**：所有新 props 可选；现有 [VibeCodingPage](file:///home/qizheng/auto_code_ws/frontend/src/pages/VibeCodingPage.tsx) 不传新 props 仍正常工作

---

#### 任务 2.2：创建 VibeSoloShell 主壳组件

**新文件**：[VibeSoloShell.tsx](file:///home/qizheng/auto_code_ws/frontend/src/pages/VibeSoloShell.tsx)
**Why**：对标 Codex/Trae Solo，左历史 + 中主舞台 + 右工具矩阵；当前 [VibeCodingPage](file:///home/qizheng/auto_code_ws/frontend/src/pages/VibeCodingPage.tsx) 是简单 grid

**结构**（3 段）：
```tsx
export const VibeSoloShell: React.FC = () => {
  const vibeCoding = useVibeCoding();
  const autoFollow = useAutoFollow();
  const modals = useModals();
  const { isMobile, isTablet } = useResponsive();
  const { theme } = useDesignTokens();

  // 移动端：使用 Bottom Sheet 替代三栏
  if (isMobile) {
    return <MobileSoloSheet vibeCoding={vibeCoding} autoFollow={autoFollow} modals={modals} />;
  }

  return (
    <div className="h-screen flex flex-col bg-surface-50" data-testid="vibe-solo-shell">
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
        onClear={vibeCoding.clearSession}
        onToggleAutoFollow={() => autoFollow.setEnabled(!autoFollow.enabled)}
        autoFollowEnabled={autoFollow.enabled}
      />

      {/* 2. 三栏布局（Codex/Trae Solo 标志性布局） */}
      <div className="flex-1 min-h-0">
        <ThreePanelLayout
          left={<SessionHistorySidebar vibeCoding={vibeCoding} />}
          center={<VibeCodingStage vibeCoding={vibeCoding} />}
          right={<ToolsMatrixPanel modals={modals} autoFollow={autoFollow} />}
          defaultLeftWidth={280}
          defaultRightWidth={360}
          minPanelWidth={240}
          maxLeftWidth={400}
          maxRightWidth={500}
          storageKey="hermes.solo.layout"
        />
      </div>

      {/* 3. Auto-Follow 联动（无 UI 纯逻辑） */}
      <AutoFollowController autoFollow={autoFollow} vibeCoding={vibeCoding} />
    </div>
  );
};
```

**集成点**：
- 接收 `useVibeCoding`（已有）+ `useAutoFollow`（已有）+ `useModals`（已有）
- 使用 [ThreePanelLayout](file:///home/qizheng/auto_code_ws/frontend/src/components/ThreePanelLayout.tsx)（已有）+ 持久化 storageKey

---

#### 任务 2.3：注册 `/solo` 路由 + 修改 ModeSelectorPage 入口

**文件 1**：[router.tsx](file:///home/qizheng/auto_code_ws/frontend/src/router/router.tsx)
- 新增 `const VibeSoloShell = lazy(() => import('../pages/VibeSoloShell'))`
- 新增 `<Route path="solo" element={lazyPage(VibeSoloShell)} />`

**文件 2**：[ModeSelectorPage.tsx](file:///home/qizheng/auto_code_ws/frontend/src/pages/ModeSelectorPage.tsx)
- 在 3 个模式卡片之上新增"Solo 模式"高亮卡片
- 点击 → `navigate('/solo')`
- 加 `data-testid="mode-card-solo"`

**Why**：让用户从主入口一键进入新 Solo 模式；同时 `/vibe-coding` 旧路由继续可用

---

### 阶段 3：会话历史侧边栏

#### 任务 3.1：创建 SessionHistorySidebar

**新文件**：[SessionHistorySidebar.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/SessionHistorySidebar.tsx)
**Why**：Solo 模式必备 — 用户需快速切回历史 session；当前 Sidebar 是 chat 模式专用，不显示 vibe sessions

**关键代码**：
```tsx
export interface SessionHistoryItem {
  id: string;
  prompt: string;
  state: VibeState;
  model: string;
  createdAt: string;
  stepsCompleted: number;
  stepsTotal: number;
}

export const SessionHistorySidebar: React.FC<{ vibeCoding: UseVibeCodingResult }> = ({ vibeCoding }) => {
  const [history, setHistory] = useState<SessionHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  // 拉取历史 session
  useEffect(() => {
    fetch('/api/vibe-coding/sessions')
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data) => setHistory(data.sessions || []))
      .catch(() => setHistory([]));
  }, [vibeCoding.session?.id]); // 当前 session 变化时刷新

  return (
    <aside className="h-full flex flex-col bg-surface-100" data-testid="session-history-sidebar">
      <header className="px-4 py-3 border-b border-surface-200">
        <h3 className="text-sm font-semibold text-surface-800">会话历史</h3>
        <p className="text-xs text-surface-500 mt-0.5">最近 20 个 Vibe Session</p>
      </header>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {history.length === 0 ? (
          <div className="text-xs text-surface-500 text-center py-8">暂无历史</div>
        ) : history.map((s) => (
          <button
            key={s.id}
            onClick={() => vibeCoding.resumeSession?.(s.id)}
            className={cn(
              'w-full text-left p-2 rounded-md text-xs transition-colors',
              'hover:bg-surface-200',
              s.id === vibeCoding.session?.id && 'bg-hermes-500/15 text-hermes-700'
            )}
            data-testid={`history-item-${s.id}`}
          >
            <div className="font-medium truncate">{s.prompt.slice(0, 40)}</div>
            <div className="flex items-center gap-2 mt-1 text-surface-500">
              <span>{s.state}</span>
              <span>·</span>
              <span>{s.stepsCompleted}/{s.stepsTotal} steps</span>
            </div>
          </button>
        ))}
      </div>
      <footer className="p-2 border-t border-surface-200">
        <Button variant="ghost" size="sm" className="w-full" onClick={() /* 新建 */}>
          + 新建 Session
        </Button>
      </footer>
    </aside>
  );
};
```

**后端依赖**：需后端提供 `GET /api/vibe-coding/sessions` 返回历史 session 列表
- 检查 [vibe_coding.py](file:///home/qizheng/auto_code_ws/backend/app/api/vibe_coding.py) 是否有 `list_all` — ✅ 已有 `list_all()` 方法，但缺少路由
- **后端补充**：[vibe_coding.py](file:///home/qizheng/auto_code_ws/backend/app/api/vibe_coding.py) 新增 `GET /sessions` 端点（≤ 10 行代码）

**单元测试**：[SessionHistorySidebar.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/SessionHistorySidebar.test.tsx)

---

### 阶段 4：Auto-Follow 深度集成

#### 任务 4.1：扩展 useAutoFollow 事件类型 + 映射表

**文件**：[useAutoFollow.ts](file:///home/qzheng/auto_code_ws/frontend/src/hooks/useAutoFollow.ts)（修改）
**Why**：当前仅 9 个事件类型，Codex/Trae Solo 支持更多（spec review、goal progress、subagent spawn）

**扩展**：
```ts
// 追加事件类型
export type AutoFollowEventType =
  | ... // 既有 9 个
  | 'spec_review_requested'      // 新增：规格审核
  | 'goal_progress_updated'      // 新增：goal 进度
  | 'subagent_spawned'           // 新增：subagent 启动
  | 'subagent_completed'         // 新增：subagent 完成
  | 'diff_preview_ready'         // 新增：diff 预览就绪
  | 'test_results_ready';        // 新增：测试结果就绪

// 扩展映射表
const STAGE_TO_PANEL: Record<AutoFollowEventType, PanelKey | null> = {
  ...,
  spec_review_requested: 'loopState',
  goal_progress_updated: 'goalAutomation',
  subagent_spawned: 'multiAgentTree',
  subagent_completed: 'multiAgentTree',
  diff_preview_ready: 'planEditor',
  test_results_ready: 'planExecutor',
};
```

**Why 不破坏向后兼容**：纯追加事件类型，老调用方无感；映射表用 Record 必填所有 key，新增时 TS 编译报错保证完整

**测试**：[useAutoFollow.test.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useAutoFollow.test.ts) 已有，新增 6 个新事件类型测试用例

---

### 阶段 5：响应式 + 移动端适配

#### 任务 5.1：MobileSoloSheet 移动端适配组件

**新文件**：[MobileSoloSheet.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/MobileSoloSheet.tsx)
**Why**：当前 [ThreePanelLayout](file:///home/qizheng/auto_code_ws/frontend/src/components/ThreePanelLayout.tsx) 在移动端无法使用（最小宽度 240px 仍超出视口）

**关键设计**：
- 移动端 (< 768px)：单列布局 + 底部 Tab Bar（5 个入口：聊天 / 工具 / Stage / Plan / Auto-Follow）
- 平板 (768-1024px)：双栏（左历史 + 中主舞台），右侧工具用 sheet 抽屉
- 桌面 (≥ 1024px)：完整三栏

**复用 useResponsive**：[useResponsive.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useResponsive.ts) 已有 `useIsMobile`/`useIsTablet`/`useIsDesktop`

**移动端 Tab Bar 关键代码**：
```tsx
{isMobile && (
  <nav className="fixed bottom-0 inset-x-0 bg-surface-100 border-t border-surface-200 z-40">
    <div className="grid grid-cols-5 gap-1 p-1">
      <TabButton icon="🏠" label="主页" active={activeTab === 'home'} onClick={() => setActiveTab('home')} />
      <TabButton icon="📋" label="Stage" active={activeTab === 'stage'} onClick={() => setActiveTab('stage')} />
      <TabButton icon="🗂️" label="Plan" active={activeTab === 'plan'} onClick={() => setActiveTab('plan')} />
      <TabButton icon="🛠️" label="工具" active={activeTab === 'tools'} onClick={() => setActiveTab('tools')} />
      <TabButton icon="📚" label="历史" active={activeTab === 'history'} onClick={() => setActiveTab('history')} />
    </div>
  </nav>
)}
```

---

### 阶段 6：TRAE-browseruse E2E 验证 + 文档

#### 任务 6.1：TRAE-browseruse 端到端验证脚本

**新文件**：[frontend/tests/e2e/cycle60-solo-mode.spec.ts](file:///home/qizheng/auto_code_ws/frontend/tests/e2e/cycle60-solo-mode.spec.ts)
**Why**：必须用真实浏览器验证（不是 happy-dom 单元测试），TRAE-browseruse 是项目指定的工具

**关键测试场景**：
1. ✅ 访问 `/solo` → 页面加载 + LoopStatusBar + 三栏可见
2. ✅ 点击主题切换 dark → light → high-contrast，验证 `<html data-theme="...">` 变化
3. ✅ 在 textarea 输入 prompt + 点击启动 → VibeSession 创建 + 状态徽章变化
4. ✅ Auto-Follow toggle ON → 执行中自动 open PlanExecutor panel
5. ✅ 移动端 viewport (375x667) → 显示 Bottom Tab Bar，隐藏三栏
6. ✅ 平板 viewport (768x1024) → 显示双栏
7. ✅ 拖拽中间分隔条 → 调整宽度，刷新后保持
8. ✅ 关闭面板 → localStorage 持久化
9. ✅ 错误状态：网络断开时显示错误卡片 + 重试按钮
10. ✅ 截图对比：与 Codex/Trae Solo 视觉风格对比（用 `page.screenshot()`）

**调用方式**（TRAE-browseruse）：
```ts
import { test, expect } from '@playwright/test';

test('C60-SOLO-01: 主题切换 dark → light', async ({ page }) => {
  await page.goto('/solo');
  await expect(page.locator('[data-testid="vibe-solo-shell"]')).toBeVisible();
  await page.click('[data-testid="theme-light"]');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: 'screenshots/cycle60-light-theme.png', fullPage: true });
});
```

#### 任务 6.2：Cycle 60 完整文档

**新文件**：
- [CYCLE60_STARTUP.md](file:///home/qizheng/auto_code_ws/CYCLE60_STARTUP.md) — 启动文档（背景、目标、任务列表）
- [CYCLE60_SPEC.md](file:///home/qizheng/auto_code_ws/CYCLE60_SPEC.md) — 详细规范
- [CYCLE60_CODE_MODIFICATION_LOG.md](file:///home/qizheng/auto_code_ws/CYCLE60_CODE_MODIFICATION_LOG.md) — 代码修改日志（任务完成/未完成）
- [CYCLE60_ACCEPTANCE_REPORT.md](file:///home/qizheng/auto_code_ws/CYCLE60_ACCEPTANCE_REPORT.md) — 验收报告（含 TRAE-browseruse 截图）

---

## 4. 关键文件变更清单

### 4.1 新增文件（11 个）

| 路径 | 任务 | 行数估计 |
|------|------|----------|
| [frontend/src/components/ui/Button.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ui/Button.tsx) | 1.2 | ~80 |
| [frontend/src/components/ui/Card.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ui/Card.tsx) | 1.2 | ~50 |
| [frontend/src/components/ui/Dialog.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ui/Dialog.tsx) | 1.2 | ~120 |
| [frontend/src/components/ui/IconButton.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ui/IconButton.tsx) | 1.2 | ~60 |
| [frontend/src/components/ui/index.ts](file:///home/qizheng/auto_code_ws/frontend/src/components/ui/index.ts) | 1.2 | ~10 |
| [frontend/src/components/ThemeSwitcher.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ThemeSwitcher.tsx) | 1.3 | ~80 |
| [frontend/src/components/SessionHistorySidebar.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/SessionHistorySidebar.tsx) | 3.1 | ~150 |
| [frontend/src/components/ToolsMatrixPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ToolsMatrixPanel.tsx) | 2.2 | ~120 |
| [frontend/src/components/MobileSoloSheet.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/MobileSoloSheet.tsx) | 5.1 | ~200 |
| [frontend/src/pages/VibeSoloShell.tsx](file:///home/qizheng/auto_code_ws/frontend/src/pages/VibeSoloShell.tsx) | 2.2 | ~150 |
| [frontend/tests/e2e/cycle60-solo-mode.spec.ts](file:///home/qizheng/auto_code_ws/frontend/tests/e2e/cycle60-solo-mode.spec.ts) | 6.1 | ~250 |

### 4.2 修改文件（6 个）

| 路径 | 任务 | 变更 |
|------|------|------|
| [frontend/src/index.css](file:///home/qizheng/auto_code_ws/frontend/src/index.css) | 1.1 | +150 行（3 主题 CSS 变量 + 微交互） |
| [frontend/src/components/LoopStatusBar.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/LoopStatusBar.tsx) | 2.1 | +40 行（Goal 岛台操作按钮） |
| [frontend/src/hooks/useAutoFollow.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useAutoFollow.ts) | 4.1 | +20 行（6 个新事件类型） |
| [frontend/src/router/router.tsx](file:///home/qizheng/auto_code_ws/frontend/src/router/router.tsx) | 2.3 | +5 行（`/solo` 路由） |
| [frontend/src/pages/ModeSelectorPage.tsx](file:///home/qizheng/auto_code_ws/frontend/src/pages/ModeSelectorPage.tsx) | 2.3 | +30 行（Solo 模式卡片） |
| [backend/app/api/vibe_coding.py](file:///home/qizheng/auto_code_ws/backend/app/api/vibe_coding.py) | 3.1 | +15 行（`GET /sessions` 端点） |

### 4.3 新增测试文件（4 个）

| 路径 | 任务 |
|------|------|
| [frontend/src/components/ui/Button.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ui/Button.test.tsx) | 1.2 |
| [frontend/src/components/ThemeSwitcher.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ThemeSwitcher.test.tsx) | 1.3 |
| [frontend/src/components/SessionHistorySidebar.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/SessionHistorySidebar.test.tsx) | 3.1 |
| [frontend/src/components/LoopStatusBar.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/LoopStatusBar.test.tsx) | 2.1 |

### 4.4 新增文档（4 个）

- [CYCLE60_STARTUP.md](file:///home/qizheng/auto_code_ws/CYCLE60_STARTUP.md)
- [CYCLE60_SPEC.md](file:///home/qizheng/auto_code_ws/CYCLE60_SPEC.md)
- [CYCLE60_CODE_MODIFICATION_LOG.md](file:///home/qizheng/auto_code_ws/CYCLE60_CODE_MODIFICATION_LOG.md)
- [CYCLE60_ACCEPTANCE_REPORT.md](file:///home/qizheng/auto_code_ws/CYCLE60_ACCEPTANCE_REPORT.md)

---

## 5. 实施策略

### 5.1 执行顺序

```
1.1 (index.css) ──┐
                  ├─→ 1.2 (UI 组件库) ─→ 1.3 (ThemeSwitcher) ─┐
1.3 依赖 useDesignTokens（已有）                                │
                                                               ├─→ 2.1 (LoopStatusBar)
                                                               │     依赖 1.2 IconButton
                                                               │     依赖 1.3 ThemeSwitcher
                                                               │
                                                               ├─→ 2.2 (VibeSoloShell)
                                                               │     依赖 2.1 LoopStatusBar
                                                               │     依赖 3.1 SessionHistorySidebar
                                                               │
                                                               ├─→ 3.1 (SessionHistorySidebar)
                                                               │     依赖 1.2 Button
                                                               │     依赖 4.1 useAutoFollow
                                                               │
                                                               └─→ 5.1 (MobileSoloSheet)
                                                                     依赖 1.2 Button/IconButton

并行：
- 2.3 (router + ModeSelectorPage)  ── 在 2.2 完成后
- 4.1 (useAutoFollow 扩展)         ── 与 1.x 并行（独立模块）
- 6.1 (TRAE-browseruse 测试)       ── 在所有 2/3/5 完成后
- 6.2 (文档)                       ── 持续
```

### 5.2 验证节点

| 节点 | 验证内容 | 工具 |
|------|----------|------|
| 1.1 完成 | 浏览器切换主题背景色实时变化 | 手动 + 截图 |
| 1.2 完成 | Button 5 个 variant 渲染正确 | vitest + happy-dom |
| 1.3 完成 | ThemeSwitcher 点击切换 data-theme | vitest |
| 2.1 完成 | LoopStatusBar 操作按钮根据 state 启用/禁用 | vitest |
| 2.2 完成 | /solo 路由可访问 + 三栏布局正常 | TRAE-browseruse |
| 3.1 完成 | SessionHistorySidebar 列表渲染 + 点击切换 | vitest + TRAE-browseruse |
| 4.1 完成 | 6 个新事件类型触发正确 panel | vitest |
| 5.1 完成 | 移动端 viewport 切换到 Tab Bar 布局 | TRAE-browseruse |
| 6.1 完成 | 10 个 E2E 用例全部通过 | TRAE-browseruse |
| 6.2 完成 | 4 个文档齐全且内容准确 | 人工 review |

### 5.3 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 引入 lucide-react icon 库导致 bundle +50KB | 🟡 | 使用按需 import（`import { Sun } from 'lucide-react'`） |
| 修改 LoopStatusBar 破坏 VibeCodingPage | 🟠 | 所有新 Props 可选，CI 跑 47 个 panel 测试验证 |
| TRAE-browseruse 安装失败 | 🟠 | 准备 fallback：手动浏览器测试 + 截图 |
| SessionHistorySidebar 拉取 API 性能差 | 🟢 | 加缓存（5s 内不重复拉取）+ loading 状态 |
| 后端 GET /sessions 缺失 | 🟢 | 同步修改 vibe_coding.py（≤ 15 行） |

---

## 6. 完成标准（DoD）

- [ ] 10 个任务全部完成
- [ ] 所有新组件单元测试覆盖率 ≥ 80%
- [ ] TRAE-browseruse 10 个 E2E 用例 100% 通过
- [ ] 3 主题 + 切换器在真实浏览器验证
- [ ] 移动端 (375px) / 平板 (768px) / 桌面 (1024px) 三档断点正确
- [ ] 47 个既有 panel 全部继续工作（无 regression）
- [ ] `/vibe-coding` 老路由继续可用
- [ ] 4 个 Cycle 60 文档全部完成
- [ ] CYCLE60_CODE_MODIFICATION_LOG.md 准确记录所有变更
- [ ] `npm run dev` 启动 + 端口 5173 可访问 + 无 console error

---

## 7. 不在本周期范围

- 真实后端 LLM 调用（保留 mock）
- 多用户协作（Solo 单用户）
- 离线 PWA（仅在线模式）
- i18n 多语言（仅中文）
- 性能深度优化（>3s 加载不优化，Cycle 61 再做）
- 完整 a11y 审计（基础 ARIA 已加，深度 WCAG 留给 Cycle 61）
