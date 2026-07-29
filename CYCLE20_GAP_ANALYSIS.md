# Cycle 20 差距分析报告

> **报告日期**: 2026-07-29
> **报告作者**: Hermes AI Agent
> **基础调研**: [CYCLE20_RESEARCH_REPORT.md](CYCLE20_RESEARCH_REPORT.md)
> **前序版本**: v6.44.0 (Cycle 19 Phase 6/7 闭环验证)
> **目标版本**: v6.45.0+ (Cycle 20 P0 三大核心 + P1 三体验优化)

---

## 一、背景

### 1.1 项目现状

Hermes 智能体调度平台经过 Cycle 14-19 的迭代，已经完成：
- 智能体调度核心（Goal Automation / Templates / Auto-Compaction）
- Composer Plan Mode（先计划后执行）
- 三阶段循环工程（Loop Engineering）工作流
- 三件套引擎：Background Tasks / Best-of-N / Design Mode（v6.41.0-v6.43.0）
- 配套基础设施：错误处理 / 加载状态 / 虚拟滚动 / 引用解析 / 规则系统

### 1.2 调研结论

通过对比 Cursor 3.0、Trae Work、Trae SOLO 在 2026 年上半年的新特性，识别出 6 个**关键能力差距**：

| 差距项 | 严重程度 | 竞品实现 | 业务影响 |
|--------|----------|----------|----------|
| **Worktree 隔离** | P0 极高 | Cursor `/worktree`、Trae Worktree | Best-of-N 候选互相干扰、并行任务破坏主分支 |
| **Smart Model Router** | P0 高 | Cursor Router 3 模式 | 任务无差别使用最贵模型，成本失控 |
| **Hooks 系统** | P0 高 | Cursor 7 种 Hook | 团队级自动化/审计/扩展能力缺失 |
| Side-Chats 侧对话 | P1 中 | Cursor `/side`, `/btw` | 探索性问题打断主对话流 |
| Long-running Job Monitor | P1 中 | Cursor Await 工具 | 长时域任务进度不透明 |
| Multi-repo Environment | P1 中 | Cursor / Trae | 多项目协同工作困难 |

### 1.3 本轮目标

完成 **6 项差距** 的完整闭环：
- P0 三件套：Worktree Manager / Smart Model Router / Hooks Engine
- P1 三件套：Side-Chats / Long-running Job Monitor / Multi-repo Environment

每个任务必须达到：
- ✅ 完整中文文件头注释
- ✅ 单元测试覆盖率 ≥ 80%
- ✅ E2E 测试断言 100% 通过
- ✅ TypeScript 零错误
- ✅ Loop Engineering 工作流完整性保留

---

## 二、P0 三大核心能力差距分析

### 2.1 Worktree 隔离（P0-1 极高优先级）

#### 2.1.1 现状

当前 Best-of-N Multi-Model（v6.42.0）虽然支持多模型并行，但所有候选共用**同一工作目录**，存在以下问题：
- 并行写入同一文件导致冲突
- 任一候选失败可能污染主分支
- 用户难以对比候选效果（修改被覆盖）
- 难以回滚单次候选的修改

Background Tasks（v6.41.0）也存在同样问题。

#### 2.1.2 竞品实现要点

**Cursor 3.0 `/worktree` 命令**：
- 调用原生 `git worktree add` 创建隔离目录
- Agent 在 worktree 中执行所有写操作
- 完成后可选择：合并 / 丢弃 / 提 PR
- Best-of-N 强制每个候选独立 worktree

**Trae Work Worktree（2026-05-05）**：
- 不同任务隔离 Git 环境
- 每个任务独立目录、依赖、代码变更
- 主 workspace 保持干净

#### 2.1.3 Hermes 实施方案

**核心抽象**：
```typescript
interface WorktreeInfo {
  id: string;             // 唯一 ID
  path: string;           // worktree 物理路径
  branch: string;         // worktree 分支名
  baseBranch: string;     // 基于哪个分支创建
  taskId?: string;        // 关联任务
  createdAt: number;
  status: 'active' | 'merged' | 'discarded';
}

class WorktreeManager {
  create(opts: CreateWorktreeOptions): Promise<WorktreeInfo>;
  list(): WorktreeInfo[];
  remove(id: string): Promise<void>;
  merge(id: string, options?: MergeOptions): Promise<MergeResult>;
  diff(id: string): Promise<DiffResult>;
  getStatus(id: string): Promise<WorktreeStatus>;
}
```

**集成点**：
- `BestOfNPanel`：每个候选使用独立 worktree
- `BackgroundTasksPanel`：支持 worktree 模式切换
- 新增 `WorktreesPanel`：独立管理 worktree 列表

**前端实现**（避免调用真实 git，使用模拟数据接口）：
- 抽象 `WorktreeBackend` 接口
- 提供 `MockWorktreeBackend`（开发环境）
- 预留 `GitWorktreeBackend`（生产环境，调用后端 API）

#### 2.1.4 验收标准

- ✅ WorktreeManager 引擎可创建/列出/删除/合并 worktree
- ✅ 单元测试 ≥ 20 项，覆盖所有核心方法
- ✅ BestOfNPanel 集成 worktree 选项 UI
- ✅ 新增 WorktreesPanel 独立管理界面
- ✅ E2E 测试覆盖：创建→修改→预览→合并/丢弃 全流程

---

### 2.2 Smart Model Router（P0-2 高优先级）

#### 2.2.1 现状

当前 Best-of-N Multi-Model 依赖**用户手动选择**模型组合，缺少：
- 任务类型自动识别
- 任务复杂度评估
- 自动成本优化（Cost/Balance/Intelligence 三模式）
- 路由决策日志与可解释性

#### 2.2.2 竞品实现要点

**Cursor Router（2026-07-22 发布）**：
- 模式：Intelligence（顶级）/ Balance（主流）/ Cost（高性价比）
- 自动按任务类型和复杂度分类
- 管理员可设置默认模式 + 模型允许/阻止列表
- 桌面、Web、iOS、CLI、SDK 全平台支持

#### 2.2.3 Hermes 实施方案

**核心抽象**：
```typescript
type RouterMode = 'cost' | 'balance' | 'intelligence';

interface RouteRequest {
  prompt: string;
  context?: Record<string, unknown>;
  userPreference?: RouterMode;
  constraints?: {
    maxCost?: number;
    minQuality?: number;
    maxLatency?: number;
  };
}

interface RouteDecision {
  selectedModel: ModelInfo;
  reasoning: string;        // 可解释性
  taskCategory: string;     // 任务分类
  complexity: 'low' | 'medium' | 'high';
  estimatedCost: number;
  estimatedTokens: number;
  alternatives: ModelInfo[];
}

class SmartModelRouter {
  route(request: RouteRequest): RouteDecision;
  configureMode(mode: RouterMode): void;
  setModelBlacklist(modelIds: string[]): void;
  setModelWhitelist(modelIds: string[]): void;
  getDecisionHistory(): RouteDecision[];
}
```

**任务分类器**：
- 代码生成：含代码块、`function`/`class` 关键字
- 文档生成：含"文档"、"README"、"注释"等
- 调试修复：含"bug"、"error"、"fix"等
- 解释分析：含"解释"、"为什么"、"分析"等
- 翻译转换：含"翻译"、"转换"等
- 通用对话：fallback

**复杂度评估**：
- 简单：prompt < 100 字 / 单一意图
- 中等：100-500 字 / 多步骤
- 复杂：> 500 字 / 多文件 / 嵌套逻辑

**模型白名单/黑名单**：
- 默认模型：Claude Sonnet 4.5 / GPT-4o / DeepSeek V3.2 / Gemini 2.0 Flash
- Cost 模式：DeepSeek / Gemini Flash
- Balance 模式：GPT-4o / Claude Sonnet
- Intelligence 模式：Claude Opus / GPT-5

#### 2.2.4 验收标准

- ✅ SmartModelRouter 引擎支持三种模式 + 自动分类
- ✅ 任务分类器准确率 ≥ 80%（基于测试集）
- ✅ 决策日志可追溯 + 可解释
- ✅ 单元测试 ≥ 25 项
- ✅ 新增 ModelRouterPanel 设置界面
- ✅ BestOfNPanel 集成"自动选择"模式
- ✅ E2E 测试覆盖：三种模式 + 决策日志 + 白黑名单

---

### 2.3 Hooks Engine（P0-3 高优先级）

#### 2.3.1 现状

Hermes 当前 Hook 系统（仅后端用于代码生成完成通知）过于简单，缺少 vibe coding 场景需要的 7 种 Hook 类型。

#### 2.3.2 竞品实现要点

**Cursor Cloud Agent Hooks（2026-07）**：
7 种 Hook 类型：
1. **Prompts** - 用户输入
2. **Responses** - AI 回复
3. **Thinking** - 思考过程
4. **Subagents** - 子智能体调用
5. **Compaction** - 会话压缩
6. **Turn Completion** - 轮次完成
7. **Tool Execution** - 工具执行

**Trae Hooks（2026-06-12）**：
- 团队级配置
- 适合自动化工作流

#### 2.3.3 Hermes 实施方案

**核心抽象**：
```typescript
type HookType =
  | 'prompt'
  | 'response'
  | 'thinking'
  | 'subagent'
  | 'compaction'
  | 'turn-completion'
  | 'tool-execution';

interface HookHandler {
  id: string;
  name: string;
  type: HookType;
  scope: 'user' | 'project' | 'team';
  enabled: boolean;
  handler: (payload: HookPayload) => Promise<HookResult> | HookResult;
  config?: Record<string, unknown>;
}

interface HookPayload {
  type: HookType;
  timestamp: number;
  sessionId: string;
  data: Record<string, unknown>;
}

class HooksEngine {
  register(hook: HookHandler): void;
  unregister(id: string): void;
  trigger(type: HookType, data: Record<string, unknown>): Promise<void>;
  getConfig(scope: 'user' | 'project' | 'team'): HookHandler[];
  updateConfig(scope: 'user' | 'project' | 'team', hooks: HookHandler[]): void;
}
```

**三层配置**：
- `user` 用户级（localStorage 持久化）
- `project` 项目级（项目配置文件）
- `team` 团队级（远程 API）

**触发时序**：
- user → project → team（按优先级合并）
- 异步执行不影响主流程
- 错误降级（hook 失败不影响主流程）

#### 2.3.4 验收标准

- ✅ HooksEngine 支持 7 种 Hook 类型
- ✅ 三层配置隔离 + 优先级合并
- ✅ 异步执行 + 错误降级
- ✅ 单元测试 ≥ 30 项
- ✅ 新增 HooksPanel 设置界面
- ✅ App.tsx 集成 Hook 触发点
- ✅ E2E 测试覆盖：注册/触发/合并/错误降级

---

## 三、P1 三大体验优化差距分析

### 3.1 Side-Chats 侧对话（P1-1 中优先级）

#### 3.1.1 竞品实现

**Cursor Side-Chats（2026-07-10）**：
- 通过 `/side`、`/btw` 或加号按钮开启
- 提问/探索/跟踪支线主题
- **不打断**主对话流
- 包含 Agent transcript 搜索

#### 3.1.2 实施方案

**核心抽象**：
```typescript
interface SideChat {
  id: string;
  parentSessionId: string;  // 关联主会话
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  archivedAt?: number;
}

class SideChatManager {
  create(parentSessionId: string, prompt: string): SideChat;
  list(parentSessionId: string): SideChat[];
  archive(id: string): void;
  link(id: string, messageId: string): void;  // 链接到主会话
}
```

**UI 设计**：
- 右侧抽屉式侧边栏
- 输入框支持 `/side` 命令触发
- 主对话中显示"🔗 已链接到侧对话"标记
- 侧对话可一键"发送回主对话"

#### 3.1.3 验收标准

- ✅ SideChatManager + 抽屉 UI
- ✅ `/side` 命令触发 + 加号按钮
- ✅ 链接到主对话
- ✅ 单元测试 ≥ 15 项 + E2E 验证

---

### 3.2 Long-running Job Monitor（P1-2 中优先级）

#### 3.2.1 竞品实现

**Cursor Await 工具**：
- Agent 等待后台 shell 命令和子智能体完成
- 等待特定输出（如 "Ready" 或 "Error"）
- 适合长时域任务编排

#### 3.2.2 实施方案

**核心抽象**：
```typescript
interface JobPhase {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  startedAt?: number;
  finishedAt?: number;
  estimatedDurationMs?: number;
}

interface LongRunningJob {
  id: string;
  name: string;
  phases: JobPhase[];
  startedAt: number;
  eta?: number;
  progress: number;  // 0-1
}

class LongRunningJobMonitor {
  createJob(name: string, phases: Omit<JobPhase, 'id' | 'status'>[]): LongRunningJob;
  updatePhase(jobId: string, phaseId: string, status: JobPhase['status']): void;
  estimateETA(jobId: string): number;
  getJobs(): LongRunningJob[];
}
```

**UI 增强**：
- 现有 `BackgroundTasksPanel` 升级
- 阶段划分 + ETA 显示
- 历史耗时分析（基于相似任务）

#### 3.2.3 验收标准

- ✅ LongRunningJobMonitor + 阶段 UI
- ✅ ETA 估算 + 进度可视化
- ✅ 单元测试 ≥ 15 项 + E2E 验证

---

### 3.3 Multi-repo Environment（P1-3 中优先级）

#### 3.3.1 竞品实现

**Cursor Multi-repo（2026）**：
- 本地/Worktree/云端/SSH 四种环境并行
- 多 Repo 环境协同工作

**Trae Work 三列布局**：
- Web/Desktop/Mobile 三列统一工作流

#### 3.3.2 实施方案

**核心抽象**：
```typescript
interface RepoEnvironment {
  id: string;
  name: string;
  type: 'local' | 'worktree' | 'cloud' | 'ssh';
  path?: string;        // local/worktree
  remote?: string;      // cloud/ssh
  currentBranch?: string;
  isActive: boolean;
}

class RepoEnvironmentManager {
  add(env: Omit<RepoEnvironment, 'id'>): RepoEnvironment;
  remove(id: string): void;
  switchTo(id: string): void;
  getActive(): RepoEnvironment | null;
  list(): RepoEnvironment[];
  search(query: string): RepoEnvironment[];
}
```

**UI 设计**：
- 顶部 Repo 切换器
- 跨仓库全局搜索
- 统一上下文管理

#### 3.3.3 验收标准

- ✅ RepoEnvironmentManager + 切换 UI
- ✅ 跨仓库搜索
- ✅ 单元测试 ≥ 12 项 + E2E 验证

---

## 四、任务计划

### 4.1 任务优先级与依赖

```
P0-1 Worktree Manager ──┐
                         ├──> P0-2 Smart Model Router (依赖 Worktree)
P0-3 Hooks Engine ──────┘

P1-1 Side-Chats ───────┐
P1-2 Long-running Job ─┼──> 独立，可并行
P1-3 Multi-repo Env ───┘
```

### 4.2 执行顺序

1. **P0-1 Worktree Manager**（最高优先级，独立可先行）
2. **P0-2 Smart Model Router**（依赖 Worktree）
3. **P0-3 Hooks Engine**（独立）
4. **P1-1/2/3** 体验优化（可并行）

### 4.3 版本规划

| 版本 | 内容 | 目标 |
|------|------|------|
| v6.45.0 | Cycle 20 P0-1 Worktree Manager | BestOfN 隔离 |
| v6.46.0 | Cycle 20 P0-2 Smart Model Router | 成本优化 |
| v6.47.0 | Cycle 20 P0-3 Hooks Engine | 自动化扩展 |
| v6.48.0 | Cycle 20 P1-1 Side-Chats | 探索不打断 |
| v6.49.0 | Cycle 20 P1-2 Long-running Job Monitor | 进度透明 |
| v6.50.0 | Cycle 20 P1-3 Multi-repo Environment | 多仓协同 |
| v6.51.0 | Cycle 20 Phase 6/7 闭环验证 | E2E + Loop Engineering |

---

## 五、风险与缓解

### 5.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Worktree 真实 git 集成复杂 | 进度延期 | 前端先做 MockWorktreeBackend，后端接口预留 |
| Model Router 分类准确率 | 路由错误 | 保留用户手动覆盖 + 决策可解释 |
| Hooks 性能开销 | 主流程变慢 | 严格异步 + 错误降级 |
| 浏览器文件系统权限 | Worktree 不可用 | 使用后端 API 代理 |

### 5.2 业务风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 改动过大影响现有功能 | 回归失败 | 每个 P0 独立 PR + 完整测试 |
| 三个面板同时上线 UI 拥挤 | 用户困惑 | 统一菜单入口 + 渐进式展示 |
| Loop Engineering 完整性 | 工作流破坏 | 严格保留 9 阶段流程 |

---

## 六、总结

Cycle 20 是 Hermes 平台对标 Cursor 3.0 的**关键补齐**：

1. **Worktree 隔离**让 Best-of-N 从"可能冲突"变为"完全隔离"
2. **Smart Model Router**让平台从"手动选模型"升级为"智能路由"
3. **Hooks Engine**让平台具备"团队级扩展能力"
4. **三个 P1 优化**让用户体验更顺畅

本轮完成后，Hermes 在 vibe coding 工具赛道将达到**与 Cursor 3.0 持平、超越 Trae SOLO** 的水平。

---

**报告完成**: 2026-07-29
**下一阶段**: 创建 P0-1 Worktree Manager SPEC
