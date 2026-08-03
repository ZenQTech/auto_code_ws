# CYCLE60_SPEC.md — Solo 模式技术规范

> **Cycle**: 60
> **日期**: 2026-08-03
> **主题**: 前端 Solo 模式 + 主题系统 + 移动端适配
> **版本**: v1.0

---

## 1. 架构总览

### 1.1 分层架构

```
┌────────────────────────────────────────────────────────────┐
│ Pages (页面层)                                              │
│  ├─ /solo → VibeSoloShell (主壳，三栏布局)                  │
│  ├─ /vibe-coding → VibeCodingPage (旧版，保留兼容)           │
│  └─ /select-mode → ModeSelectorPage (含 Solo 卡片)         │
├────────────────────────────────────────────────────────────┤
│ Components (组件层)                                         │
│  ├─ Layout: LoopStatusBar / ThreePanelLayout                │
│  ├─ Solo 专用: SessionHistorySidebar / ToolsMatrixPanel    │
│  ├─ Mobile 专用: MobileSoloSheet                            │
│  └─ UI 基础: Button / Card / IconButton / ThemeSwitcher     │
├────────────────────────────────────────────────────────────┤
│ Hooks (业务逻辑层)                                          │
│  ├─ useVibeCoding (状态机 + SSE)                            │
│  ├─ useAutoFollow (联动 + 15 事件映射)                      │
│  ├─ useLoopState (Loop 状态机客户端)                        │
│  ├─ useModals (47 panel 集中管理)                            │
│  ├─ useResponsive (useIsMobile/useIsTablet/...)              │
│  └─ useDesignTokens (主题切换)                              │
├────────────────────────────────────────────────────────────┤
│ Backend API (FastAPI)                                       │
│  ├─ /api/vibe-coding/session* (CRUD + SSE)                  │
│  ├─ /api/vibe-coding/sessions (列表)                        │
│  └─ /api/auto-follow/* (联动配置 + 模拟)                    │
└────────────────────────────────────────────────────────────┘
```

### 1.2 数据流

```
[User Input]
     ↓
[useVibeCoding.startSession(prompt)]
     ↓
[POST /api/vibe-coding/session]
     ↓
[VibeSession 对象 + initial state = CLARIFYING]
     ↓
[EventSource /session/{id}/events]
     ↓
[SSE: vibe_state_changed / vibe_step_started / vibe_step_completed]
     ↓
[useVibeCoding reducer 同步本地状态]
     ↓
[useAutoFollow 监听 → 触发 panel 切换]
     ↓
[ToolsMatrixPanel / SessionHistorySidebar 自动高亮]
     ↓
[UI 重渲染（仅订阅部分）]
```

---

## 2. 核心类型定义

### 2.1 Vibe Coding

```typescript
// frontend/src/hooks/useVibeCoding.ts

export type VibeState =
  | 'idle' | 'clarifying' | 'planning' | 'executing'
  | 'reviewing' | 'done' | 'paused' | 'cancelled' | 'error';

export interface VibeSession {
  id: string;
  prompt: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  state: VibeState;
  planId?: string;
  steps: VibeStep[];
  metrics: { tokens: number; duration: number; filesChanged: number; };
}
```

### 2.2 Auto-Follow 扩展事件

```typescript
// frontend/src/hooks/useAutoFollow.ts (v1.1.0 G60-4.1)

export type AutoFollowEventType =
  // v1.0.0 既有 (9)
  | 'vibe_step_started' | 'vibe_plan_generated' | 'vibe_code_writing'
  | 'vibe_test_running' | 'vibe_step_completed' | 'vibe_step_failed'
  | 'vibe_plan_completed' | 'loop_state_changed' | 'claude_shell_output'
  // v1.1.0 新增 (6)
  | 'spec_review_requested' | 'goal_progress_updated' | 'subagent_spawned'
  | 'subagent_completed' | 'diff_preview_ready' | 'test_results_ready';

const STAGE_TO_PANEL: Record<AutoFollowEventType, PanelKey | null> = {
  vibe_step_started: 'planExecutor',
  // ...
  spec_review_requested: 'loopState',
  goal_progress_updated: 'loopV7',
  subagent_spawned: 'multiAgentTree',
  subagent_completed: 'multiAgentTree',
  diff_preview_ready: 'planEditor',
  test_results_ready: 'planExecutor',
};
```

### 2.3 主题系统

```typescript
// frontend/src/hooks/useDesignTokens.ts

export type ThemeName = 'dark' | 'light' | 'high-contrast';

export interface DesignTokens {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  cycleTheme: () => void;
  tokens: Record<string, string>;
}
```

### 2.4 后端 API

```python
# backend/app/api/vibe_coding.py

class ListSessionsResponse(BaseModel):
    """v1.0.1 G60-3.1 新增：Session 列表响应"""
    sessions: List[VibeSession]
    total: int

@router.get("/sessions", response_model=ListSessionsResponse)
async def list_all_sessions(limit: int = 20):
    """列出全部 sessions（按 createdAt 倒序，limit 默认 20）"""
    sessions = await get_registry().list_all()
    sessions_sorted = sorted(sessions, key=lambda s: s.createdAt, reverse=True)
    limited = sessions_sorted[: max(1, min(limit, 100))]
    return ListSessionsResponse(sessions=limited, total=len(sessions))
```

---

## 3. 组件规范

### 3.1 VibeSoloShell（Solo 主壳）

**文件**：[VibeSoloShell.tsx](file:///home/qizheng/auto_code_ws/frontend/src/pages/VibeSoloShell.tsx)
**职责**：Solo 模式统一整合壳
**布局**：

```
┌──────────────────────────────────────────────────────┐
│ LoopStatusBar (Goal 岛台)                              │
├──────────┬──────────────────────────┬───────────────┤
│ 历史     │                          │               │
│ 260px    │   主舞台                  │   工具 320px   │
│ Session  │   VibeCodingStage         │   Tools       │
│ History  │   (prompt + steps)        │   Matrix      │
│          │                          │               │
└──────────┴──────────────────────────┴───────────────┘
```

**Props**：无（自包含所有 hook）
**响应式**：`isMobile=true` 时切换到 `MobileSoloSheet`

### 3.2 MobileSoloSheet（移动端适配）

**文件**：[MobileSoloSheet.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/MobileSoloSheet.tsx)
**职责**：< 768px 移动端 Solo 模式
**布局**：

```
┌─────────────────────┐
│ Header              │  ← 顶部 (logo + 进度 + 控制)
├─────────────────────┤
│                     │
│ Main Content        │  ← 主体（按 activeTab 切换）
│ (Stage/Tools/       │
│  History/Plan/      │
│  Auto-Follow)        │
│                     │
├─────────────────────┤
│ [🌊][🧰][🕘][📋][🎯]  │  ← 底部 5 Tab Bar
└─────────────────────┘
```

**Props**：
```typescript
interface MobileSoloSheetProps {
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
```

**关键设计**：
- safe-area-inset-* 适配 notch / home indicator
- 按钮最小 44x44px（触屏友好）
- 主题感知（dark/light/high-contrast）
- touch 优化

### 3.3 SessionHistorySidebar

**文件**：[SessionHistorySidebar.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/SessionHistorySidebar.tsx)
**职责**：Solo 模式左侧会话历史侧边栏
**数据源**：`GET /api/vibe-coding/sessions?limit=20`
**特性**：
- 5s 内不重复拉取（缓存）
- localStorage 持久化
- 当前 active session 高亮
- 错误兜底（网络错误时显示缓存）

### 3.4 ToolsMatrixPanel

**文件**：[ToolsMatrixPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ToolsMatrixPanel.tsx)
**职责**：Solo 模式右侧工具矩阵
**工具分类**：
- Vibe 工具（vibeCoding/planExecutor）
- Loop 工具（loopState/loopV7）
- Multi-Agent 工具（multiAgentTree/subagentMemory）
- MCP 工具（mcpAdvanced/mcpIntegrated 等 20+）
- 设置工具（settings/rules/skills/agentsMd）

**特性**：
- 47 panel 集中入口
- 核心工具高亮（🌊/📋）
- Auto-Follow 状态指示器
- 一键关闭所有 panel

### 3.5 ThemeSwitcher

**文件**：[ThemeSwitcher.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ThemeSwitcher.tsx)
**职责**：3 主题切换器
**主题**：
- 🌙 dark（深色，默认）
- ☀️ light（浅色）
- ⊙ high-contrast（高对比度）

**特性**：
- 内联 SVG（无第三方依赖）
- 持久化到 localStorage
- 当前主题高亮
- 支持快捷键 cycleTheme

---

## 4. 后端 API 规范

### 4.1 Vibe Coding API

| Method | Path | 描述 |
|--------|------|------|
| POST | `/api/vibe-coding/session` | 创建 session |
| GET | `/api/vibe-coding/session` | 列出最新 session（兼容） |
| GET | `/api/vibe-coding/sessions` | **G60-3.1** 列出全部 session |
| GET | `/api/vibe-coding/session/{id}` | 查询 session |
| POST | `/api/vibe-coding/session/{id}/pause` | 暂停 |
| POST | `/api/vibe-coding/session/{id}/resume` | 恢复 |
| POST | `/api/vibe-coding/session/{id}/cancel` | 取消 |
| GET | `/api/vibe-coding/session/{id}/events` | SSE 事件流 |

### 4.2 Auto-Follow 联动

| Method | Path | 描述 |
|--------|------|------|
| GET | `/api/auto-follow/config` | 读取配置 |
| POST | `/api/auto-follow/config` | 更新配置 |
| GET | `/api/auto-follow/mapping` | 读取映射表 |
| GET | `/api/auto-follow/history` | 读取历史 |
| POST | `/api/auto-follow/simulate` | 模拟触发 |
| GET | `/api/auto-follow/events` | SSE 事件流 |

---

## 5. 路由规范

```typescript
// frontend/src/router/router.tsx

// v1.0.0 (Cycle 60 G60-2.3) 新增：Solo 模式主壳
const VibeSoloShell = lazy(() => import('../pages/VibeSoloShell'));

<Route path="solo" element={lazyPage(VibeSoloShell)} />
```

**访问路径**：
- `/` → 根路由（包含模式选择）
- `/select-mode` → 模式选择页（含 Solo 卡片）
- `/solo` → Solo 模式主壳（新增）
- `/vibe-coding` → Vibe Coding 旧版（保留兼容）
- `/chat/*` → 聊天路由
- `/coding/*` → 编程路由

---

## 6. 主题 CSS 变量规范

```css
/* frontend/src/index.css */

:root {
  /* 深色主题（默认） */
  --bg-app: #0a0a14;
  --bg-panel: #15151f;
  --bg-elevated: #1f1f2e;
  --text-primary: #f5f5fa;
  --text-secondary: #a0a0b0;
  --text-tertiary: #6a6a7a;
  --border-color: rgba(255, 255, 255, 0.08);
  --accent: #f0a030;
  --accent-hover: #fbbf66;
}

[data-theme="light"] {
  --bg-app: #ffffff;
  --bg-panel: #f8f8fa;
  --bg-elevated: #ffffff;
  --text-primary: #0a0a0a;
  --text-secondary: #525260;
  --text-tertiary: #737380;
  --border-color: rgba(0, 0, 0, 0.08);
  --accent: #f0a030;
  --accent-hover: #fbbf66;
}

[data-theme="high-contrast"] {
  --bg-app: #000000;
  --bg-panel: #0a0a0a;
  --bg-elevated: #1a1a1a;
  --text-primary: #ffffff;
  --text-secondary: #f0f0f0;
  --text-tertiary: #d0d0d0;
  --border-color: #ffffff;
  --accent: #ffd700;
  --accent-hover: #ffec80;
}
```

---

## 7. 测试规范

### 7.1 单元测试（vitest）

**位置**：`src/components/*.test.tsx` / `src/hooks/*.test.ts`

**要求**：
- 所有新增组件必须有 `.test.tsx`
- Mock 依赖（useModals / useVibeCoding / useAutoFollow）
- 覆盖：基础渲染 / 交互 / 错误处理
- 覆盖率 ≥ 80%

### 7.2 E2E 测试（vitest + TRAE-browseruse）

**位置**：`tests/e2e/g60-*.e2e.test.ts`

**要求**：
- 真实 HTTP 请求（fetch + BACKEND_URL）
- 覆盖：完整流程 / 错误处理 / SSE / 并发
- 不依赖 happy-dom 的 AbortSignal.timeout（使用 AbortController）

---

## 8. 部署规范

### 8.1 前端构建

```bash
cd /home/qizheng/auto_code_ws/frontend
source ~/.nvm/nvm.sh && nvm use v24.15.0
npm run build
```

### 8.2 后端启动

```bash
cd /home/qizheng/auto_code_ws/backend
source ~/.nvm/nvm.sh && nvm use v24.15.0
uvicorn app.main:app --reload --port 8765
```

### 8.3 访问入口

- Solo 模式：<http://localhost:5173/solo>
- 旧 Vibe Coding：<http://localhost:5173/vibe-coding>
- 模式选择：<http://localhost:5173/select-mode>

---

**文档版本**: v1.0
**创建时间**: 2026-08-03
**维护者**: 前端总架构师
