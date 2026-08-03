# CYCLE58 SPEC - 5 大 P0 任务规范

> **日期**: 2026-08-03
> **目标**: 对标 codex 0.146 + TRAE Solo 的 5 大 P0 能力
> **代码量**: ~5500 行新代码 + ~150 个新测试

---

## G58-01: VibeCoding 模式入口

### 功能需求
- **目标**: 把 Hermes 从二元模式（chat/coding）升级为三元（chat/coding/vibe-coding）
- **用户场景**: 用户选择 vibe-coding 模式后，进入"Vibe Coding"主舞台
- **使用流程**:
  1. 用户访问首页 → 看到 3 模式卡片
  2. 点击"vibe-coding" → 跳转到 `/vibe-coding` 路由
  3. 进入 VibeCodingPage 页面，含 LoopStatusBar + Composer + 多 panel 网格

### 技术实现
- **前端**: 新增 VibeCodingPage + 3 模式卡片
- **状态**: useMode 扩展 vibe-coding 模式
- **路由**: /vibe-coding
- **依赖**: useModals (新增 vibeCoding / planExecutor / loopState panel)

### 接口设计
```ts
// useMode.ts 扩展
type Mode = 'chat' | 'coding' | 'vibe-coding';

// VibeCodingPage 接收 props
interface VibeCodingPageProps {
  initialSessionId?: string;
  onSessionCreate: (session: VibeSession) => void;
}

// 新增 Hook
function useVibeCoding(): {
  session: VibeSession | null;
  state: VibeState;
  startSession: (prompt: string, model?: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: () => Promise<void>;
}
```

### 数据结构
```ts
interface VibeSession {
  id: string;
  prompt: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  state: 'idle' | 'clarifying' | 'planning' | 'executing' | 'reviewing' | 'done' | 'paused' | 'cancelled' | 'error';
  plan?: Plan;
  steps: VibeStep[];
  metrics: {
    tokens: number;
    duration: number;
    filesChanged: number;
  };
}

interface VibeStep {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  output?: string;
  error?: string;
}
```

### 性能与安全
- 首屏加载 < 2s
- 路由切换 < 300ms
- 用户输入合法性校验（prompt 长度限制 1-10000 字符）
- XSS 防护（所有 LLM 输出经 DOMPurify）

### 验收标准
- [ ] ModeSelectorPage 显示 3 个模式卡片
- [ ] 点击 vibe-coding 进入 VibeCodingPage
- [ ] useMode 支持 vibe-coding 模式切换
- [ ] useModals 注册 vibeCoding / planExecutor / loopState panel
- [ ] 单元测试覆盖率 ≥ 90%
- [ ] 端到端测试：模式切换 → 进入 VibeCodingPage → 显示主舞台

---

## G58-02: ClaudeCodeShell 进程化（高风险）

### 功能需求
- **目标**: 把 Claude Code CLI 从"配置导入层"升级为"真实进程级控制"
- **用户场景**: Hermes 可以像 trae/codex 一样调用 `claude -p "..."` 真正接管 Claude Code
- **使用流程**:
  1. 用户在 VibeCodingPage 输入需求
  2. Hermes 后端调用 ClaudeCodeShell.invoke(prompt)
  3. 启动 `claude -p prompt` 子进程
  4. 流式解析 stdout/stderr
  5. 推送 SSE 事件给前端

### 技术实现
- **后端**: cli_integration/claude_code_shell.py (新)
- **API**: /api/claude-shell/invoke
- **降级**: 若 `claude` 不在 PATH，自动降级为 LLM HTTP 调用
- **沙箱**: 限制 CPU/内存/超时

### 接口设计
```python
# ClaudeCodeShell API
class ClaudeCodeShell:
    def __init__(self, workdir: str, timeout: int = 300):
        self.workdir = workdir
        self.timeout = timeout

    async def invoke(self, prompt: str, args: list[str] | None = None) -> AsyncIterator[str]:
        """流式调用 claude CLI"""

    async def cancel(self) -> None:
        """取消正在运行的子进程"""

    @property
    def is_available(self) -> bool:
        """检测 claude CLI 是否在 PATH"""

# REST 端点
POST /api/claude-shell/invoke
Body: {prompt: str, args?: list[str]}
Response: {stream_id: str}

GET /api/claude-shell/invoke/{stream_id}/events  (SSE)
Events: claude_shell_output / claude_shell_done / claude_shell_error
```

### 数据结构
```python
@dataclass
class ClaudeShellStream:
    stream_id: str
    prompt: str
    args: list[str]
    status: Literal['running', 'done', 'error', 'cancelled']
    chunks: list[ClaudeShellChunk]
    started_at: datetime
    completed_at: datetime | None
    exit_code: int | None
    error: str | None
```

### 性能与安全
- 单次调用超时 300s
- 最大并发 3 个
- 路径净化（防越界）
- 用户确认弹窗（高风险操作）
- 沙箱执行（chroot 或类似机制）
- 资源限制（CPU/内存）

### 验收标准
- [ ] ClaudeCodeShell 类支持 invoke / cancel / is_available
- [ ] /api/claude-shell/invoke 端点工作
- [ ] SSE 流式推送 chunk
- [ ] claude CLI 不在 PATH 时自动降级
- [ ] 超时熔断
- [ ] 路径净化
- [ ] 单元测试覆盖率 ≥ 90%
- [ ] 端到端测试：模拟用户输入 → ClaudeCodeShell 调用 → 看到输出

---

## G58-03: LoopStateMachine 持续可见 UI

### 功能需求
- **目标**: 把 Loop V7 15 步 SOP 从"弹窗式"升级为"持续可见"
- **用户场景**: 用户在 VibeCoding 模式下，顶部始终显示当前阶段、进度、ETA
- **使用流程**:
  1. Loop V7 启动 → 推送 loop_state_changed 事件
  2. 前端 LoopStatusBar 接收事件 → 更新状态
  3. LoopStateMachineView 可视化状态机迁移

### 技术实现
- **后端**: backend/app/services/loop_state_machine.py (新) + /api/loop-state/machine
- **前端**: LoopStatusBar (新) + LoopStateMachineView (新)
- **集成**: AppLayout 顶部插入 LoopStatusBar

### 接口设计
```python
# 后端
class LoopStateMachine:
    @property
    def current_state(self) -> LoopState
    @property
    def history(self) -> list[LoopTransition]

# REST 端点
GET /api/loop-state/machine
Response: {
  state: {
    stage: 'clarifying' | 'designing' | 'prompting' | 'executing' | 'reviewing' | 'done',
    progress: 0.0-1.0,
    eta_seconds: int,
    session_id: str
  },
  history: [
    {from: 'clarifying', to: 'designing', at: '2026-08-03T10:00:00Z'}
  ]
}

# SSE 事件
event: loop_state_changed
data: {"from": "clarifying", "to": "designing", "progress": 0.2}
```

```ts
// 前端 Hook
function useLoopState(): {
  state: LoopState;
  progress: number;
  eta: number;
  history: LoopTransition[];
  isLoading: boolean;
  error: string | null;
}
```

### 数据结构
```python
@dataclass
class LoopState:
    stage: Literal['idle', 'clarifying', 'designing', 'prompting', 'executing', 'reviewing', 'done', 'error', 'paused']
    progress: float
    eta_seconds: int
    session_id: str
    sub_state: dict  # 子状态细节

@dataclass
class LoopTransition:
    from_state: str
    to_state: str
    at: datetime
    metadata: dict
```

### 性能与安全
- SSE 心跳 30s
- 状态更新节流 1s
- 历史保留最近 100 条
- WebSocket 鉴权

### 验收标准
- [ ] LoopStateMachine 服务可工作
- [ ] /api/loop-state/machine 返回状态
- [ ] SSE 推送 loop_state_changed
- [ ] LoopStatusBar 持续显示
- [ ] LoopStateMachineView 可视化迁移
- [ ] 单元测试覆盖率 ≥ 90%
- [ ] 端到端测试：Loop V7 启动 → 看到状态条更新

---

## G58-04: Auto-Follow 联动

### 功能需求
- **目标**: 监听 SSE 事件，根据阶段自动 open/聚焦 panel（对标 TRAE 实时跟随）
- **用户场景**: AI 进入"编码"阶段时，自动打开编辑器 panel；进入"测试"阶段时，自动打开终端 panel
- **使用流程**:
  1. AutoFollowController 订阅 SSE 事件
  2. 检测事件类型（vibe_step_started / plan_executing / etc.）
  3. 根据映射表找到目标 panel
  4. 调用 openPanel(target_panel) + scrollToBottom()
  5. AI 处理时 panel 只读（只读属性）
  6. 用户双击/滚动退出实时跟随

### 技术实现
- **后端**: backend/app/api/auto_follow.py (新) + 状态推送
- **前端**: AutoFollowController (新) + useAutoFollow (新)
- **集成**: VibeCodingPage 嵌入 AutoFollowController

### 接口设计
```ts
// 阶段到 panel 的映射
const STAGE_TO_PANEL: Record<VibeState['state'], string> = {
  clarifying: 'clarification',
  planning: 'planExecutor',
  executing: 'editor',
  reviewing: 'diffView',
  done: 'preview',
};

// Hook
function useAutoFollow(): {
  enabled: boolean;
  follow: (event: SSEEvent) => void;
  setEnabled: (b: boolean) => void;
  lastFollowed: { panelId: string; at: Date } | null;
}

// 后端 API
POST /api/auto-follow/enable
Body: { panel_id: string }
Response: { success: true }

POST /api/auto-follow/disable
Response: { success: true }
```

### 数据结构
```ts
interface AutoFollowConfig {
  enabled: boolean;
  stageToPanel: Record<string, string>;
  scrollBehavior: 'smooth' | 'instant';
  debounceMs: number;
}

interface FollowEvent {
  type: 'vibe_step_started' | 'plan_generated' | 'code_writing' | 'test_running';
  panelId: string;
  reason: string;
  timestamp: Date;
}
```

### 性能与安全
- 防抖 500ms
- 状态机只读属性
- 用户可关闭
- 不影响 chat/coding 模式

### 验收标准
- [ ] AutoFollowController 订阅 SSE
- [ ] STAGE_TO_PANEL 映射表完整
- [ ] 阶段变更时自动 open panel
- [ ] 关闭开关后不再 follow
- [ ] 单元测试覆盖率 ≥ 90%
- [ ] 端到端测试：AI 进入编码阶段 → 自动打开编辑器 panel

---

## G58-05: ComposerPlan 真正可执行

### 功能需求
- **目标**: 把 ComposerPanel plan 模式从"文档展示"升级为"真正驱动 LLM 持续生成"
- **用户场景**: 用户在 ComposerPlan 中确认 Plan 后，AI 自动按 step 持续生成代码
- **使用流程**:
  1. 用户在 ComposerPanel 切换到 plan 模式
  2. AI 生成 Plan（多 step 列表）
  3. 用户确认 Plan
  4. 后端 VibeCodingOrchestrator 按 step 调用 LLM
  5. 每完成一步推送 vibe_step_completed 事件
  6. ComposerPanel 实时更新
  7. 用户可 pause / resume / cancel

### 技术实现
- **后端**: backend/app/services/vibe_coding_orchestrator.py (新)
- **前端**: PlanExecutorPanel (新) + VibeCodingPage 嵌入
- **集成**: ComposerPanel plan mode + VibeCodingOrchestrator

### 接口设计
```python
# 后端
class VibeCodingOrchestrator:
    async def execute_plan(self, session_id: str, plan: Plan) -> AsyncIterator[VibeStepEvent]:
        """按 step 持续执行 Plan"""

# REST 端点
POST /api/vibe-coding/plan/execute
Body: {session_id: str, plan_id: str}
Response: {execution_id: str}

GET /api/vibe-coding/plan/execute/{execution_id}/events  (SSE)
Events: vibe_step_started / vibe_step_completed / vibe_step_failed / vibe_plan_completed
```

```ts
// 前端 Hook
function usePlanExecutor(): {
  plan: Plan | null;
  currentStep: number;
  isExecuting: boolean;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: () => Promise<void>;
}
```

### 数据结构
```ts
interface Plan {
  id: string;
  sessionId: string;
  title: string;
  description: string;
  steps: PlanStep[];
  status: 'draft' | 'confirmed' | 'executing' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
}

interface PlanStep {
  id: string;
  order: number;
  name: string;
  description: string;
  estimatedDuration: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: { filesChanged: string[]; tokensUsed: number };
}
```

### 性能与安全
- 单 step 超时 60s
- 最大 step 数 50
- 失败重试 3 次
- pause/resume 持久化
- 防死循环（最大累计时长 1h）

### 验收标准
- [ ] VibeCodingOrchestrator.execute_plan 工作
- [ ] PlanExecutorPanel 显示 step 列表
- [ ] 每 step 完成时实时更新
- [ ] pause / resume / cancel 工作
- [ ] 失败重试机制
- [ ] 单元测试覆盖率 ≥ 90%
- [ ] 端到端测试：确认 Plan → 自动按 step 执行 → 全部完成

---

## G58-INTEGRATION: 主面板集成 + 端到端验证

### 功能需求
- **目标**: 把 5 大 P0 任务集成到主舞台 + 端到端验证
- **使用流程**:
  1. 用户进入 VibeCodingPage
  2. LoopStatusBar 持续显示
  3. Composer 接收输入
  4. 总架构师澄清 → Plan 生成
  5. 用户确认 Plan
  6. PlanExecutorPanel 开始执行
  7. Auto-Follow 自动切换 panel
  8. ClaudeCodeShell 真实调用
  9. 完成后显示结果

### 验收标准
- [ ] VibeCodingPage 集成 5 大组件
- [ ] 端到端测试：完整 Vibe Coding 流程
- [ ] TRAE-browseruse 实测通过
- [ ] TypeScript 编译 0 错误
- [ ] Vite 构建成功
- [ ] 项目实运行（`npm run dev` + 端口探测）
- [ ] 推 main 分支

---

## 全局接口与依赖

### 新增 REST 端点（11 个）
- POST /api/vibe-coding/session
- GET /api/vibe-coding/session/{id}
- POST /api/vibe-coding/session/{id}/pause
- POST /api/vibe-coding/session/{id}/resume
- POST /api/vibe-coding/plan/execute
- GET /api/loop-state/machine
- GET /api/loop-state/machine/events (SSE)
- POST /api/auto-follow/enable
- POST /api/auto-follow/disable
- POST /api/claude-shell/invoke
- GET /api/claude-shell/invoke/{id}/events (SSE)

### 新增 SSE 事件（7 类）
- vibe_session_started
- vibe_plan_generated
- vibe_step_started / completed / failed
- auto_follow_panel_opened
- loop_state_changed
- claude_shell_output / done / error

### 新增 npm 包
- 无新增外部包

### 新增 pip 包
- pexpect>=4.9.0

### 新增 React 组件（17 个）
- VibeCodingPage, LoopStatusBar, AutoFollowController, VibeCodingStage, PlanExecutorPanel, LoopStateMachineView
- 11 个相关 utils + hooks

---

**SPEC 完成，进入任务分解与实施。**
