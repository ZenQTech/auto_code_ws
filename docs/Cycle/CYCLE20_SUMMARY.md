# Cycle 20 任务总结

> **Cycle**: 20
> **日期**: 2026-07-29
> **负责人**: Hermes AI Agent
> **目标**: 整合 Cursor 3.0 + Trae Work 新特性（Worktree 隔离、智能模型路由、Hooks 系统），达到生产可用级别
> **测试通过率**: 100% (165 引擎单测 + 24 面板集成 + 115 E2E 断言 = 304 个测试点)

---

## 一、需求背景

### 1.1 来源

基于 [Cycle 20 调研报告](./CYCLE20_RESEARCH_REPORT.md) 对 Cursor 3.0（Agents Window / Design Mode / /worktree / /best-of-n / Cursor Router）和 Trae Work（Design Mode / Global Memory / Worktree / Hooks）的技术分析，识别 Hermes 平台相对头部产品仍存在的三大功能差距：

| # | 功能差距 | Cursor 3.0 实现 | Hermes 现状 | 影响 |
|---|---------|----------------|-----------|------|
| 1 | Worktree 隔离 | `/worktree` 斜杠命令 + Git Worktree | 缺失 | Best-of-N 候选互相污染主分支 |
| 2 | Model Router | Cursor Router 自动选模型 | 缺失 | 用户需手动选模型，无法 cost/intelligence 权衡 |
| 3 | Hooks 系统 | 7 种 Hook 类型（beforeSubmit 等） | 基础 hooks 框架不完整 | vibe coding 过程无法扩展 |

### 1.3 完成标准

- ✅ 三大功能模块均独立交付（引擎 + UI + 测试）
- ✅ 集成到 App.tsx 主界面 + BrandHeader 菜单
- ✅ 自动化测试 100% 通过（165 引擎 + 24 集成 + 115 E2E）
- ✅ TypeScript 零错误
- ✅ Loop Engineering 工作流无回归
- ✅ UI/UX 优化达到生产可用级别（渐变背景 + 渐入动画 + Esc 关闭）

---

## 二、交付清单

### 2.1 核心引擎 (3 个)

| 文件 | 行数 | 功能 |
|------|------|------|
| `frontend/src/utils/worktreeManager.ts` | 22K (~700) | Worktree 隔离管理：7 状态 + 5 类型 + CRUD + 持久化 + 事件总线 |
| `frontend/src/utils/modelRouter.ts` | 18K (~580) | 智能模型路由：11 任务分类 + 3 路由模式 + 5 预置模型 + 决策日志 |
| `frontend/src/utils/hooksEngine.ts` | 21K (~680) | 事件钩子引擎：10 事件类型 + 4 Action 类型 + 执行历史 + 事件总线 |

### 2.2 UI 组件 (3 个)

| 文件 | 行数 | 功能 |
|------|------|------|
| `frontend/src/components/WorktreePanel.tsx` | 530 | Worktree 隔离管理面板：网格/列表视图 + 创建/合并/丢弃/Diff |
| `frontend/src/components/ModelRouterPanel.tsx` | 380 | 智能模型路由面板：路由测试 + 模型库 + 决策历史 |
| `frontend/src/components/HooksManagerPanel.tsx` | 470 | 事件钩子管理面板：10 类型 + 4 Action + 触发 + 执行历史 |

### 2.3 单元测试 (3 个)

| 文件 | 测试数 | 状态 |
|------|--------|------|
| `frontend/src/utils/worktreeManager.test.ts` | 58 | ✅ 100% |
| `frontend/src/utils/modelRouter.test.ts` | 65 | ✅ 100% |
| `frontend/src/utils/hooksEngine.test.ts` | 42 | ✅ 100% |

### 2.4 集成测试 (3 个)

| 文件 | 测试数 | 状态 |
|------|--------|------|
| `frontend/src/components/WorktreePanel.test.tsx` | 7 | ✅ 100% |
| `frontend/src/components/ModelRouterPanel.test.tsx` | 8 | ✅ 100% |
| `frontend/src/components/HooksManagerPanel.test.tsx` | 9 | ✅ 100% |

### 2.5 E2E 测试 (1 个)

| 文件 | 断言数 | 状态 |
|------|--------|------|
| `tests/test_e2e_cycle20.sh` | 115 | ✅ 100% |

### 2.6 SPEC 文档 (3 个)

| 文件 | 用途 |
|------|------|
| `CYCLE20_SPEC_WORKTREE.md` | Worktree 隔离技术规范 |
| `CYCLE20_SPEC_MODEL_ROUTER.md` | 智能模型路由技术规范 |
| `CYCLE20_SPEC_HOOKS.md` | 事件钩子系统技术规范 |

### 2.7 集成修改 (5 个)

| 文件 | 改动 |
|------|------|
| `frontend/src/App.tsx` | 3 状态 + 3 handler + 3 panel 渲染 + 3 ErrorBoundary |
| `frontend/src/components/AppLayout.tsx` | 3 透传 prop |
| `frontend/src/components/BrandHeader.tsx` | 3 菜单项 + 4 SVG 图标 + 3 prop |
| `frontend/src/components/HooksPanel.tsx` | 恢复（从 git 恢复） |
| `frontend/src/utils/worktreeManager-test-utils.ts` | MemoryWorktreeStorage 独立导出 |

---

## 三、核心功能特性

### 3.1 G20-01 Worktree Manager

**生命周期**：
```
创建 (create)
  ↓
Creating
  ↓
Ready → In-use → Modified
  ↓
Merged / Discarded / Error
  ↓
Cleanup (auto / manual)
```

**核心能力**：
- ✅ CRUD：create / list / get / remove / merge / diff / discard
- ✅ 5 种类型：local / isolated / review / experiment
- ✅ 7 种状态：creating / ready / in-use / modified / merged / discarded / error
- ✅ Backend 抽象：MockWorktreeBackend（默认）+ GitWorktreeBackend（预留）
- ✅ Storage 抽象：MemoryWorktreeStorage（测试）+ LocalStorageWorktreeStorage（持久化）
- ✅ 事件总线：created / status-changed / removed / merged / discarded / error
- ✅ 6 事件类型 + 订阅机制
- ✅ Cleanup 机制：autoCleanupDays + 数量上限（maxWorktrees）
- ✅ 单例工厂：getWorktreeManager() / resetWorktreeManager() / setWorktreeManager()

### 3.2 G20-02 Smart Model Router

**核心能力**：
- ✅ 11 任务分类：code_generation / code_review / debugging / documentation / translation / refactoring / testing / analysis / explanation / brainstorm / unknown
- ✅ 3 路由模式：cost（成本优先）/ balance（平衡）/ intelligence（质量优先）
- ✅ 5 预置模型：Claude Sonnet 4.5 / GPT-5 / GPT-4o / DeepSeek V3.2 / Gemini 2.0 Flash
- ✅ 复杂度评估（1-10 评分）
- ✅ 评分算法：capability + specialty + speed + cost
- ✅ 决策日志：可追溯每次路由选择
- ✅ 事件订阅：mode-changed / model-registered / model-unregistered / route-decided
- ✅ 单例工厂：getModelRouter() / resetModelRouter()

**评分公式**：
```typescript
score = (capability × 10) + (specialty === category ? 20 : 0) + (speed × 5)
cost 模式: score = score × 0.3 + (100 - cost) × 0.7
```

### 3.3 G20-03 Hooks Engine

**核心能力**：
- ✅ 10 事件类型：before_prompt / after_prompt / before_response / after_response / thinking / subagent_start / subagent_end / compaction / turn_complete / tool_execution
- ✅ 4 Action 类型：callback / webhook / command / script（javascript/python）
- ✅ 6 执行状态：success / failed / timeout / pending / running / cancelled
- ✅ 3 Scope：user / project / team
- ✅ Fallback 策略：ignore / warn / block / retry
- ✅ 优先级排序：priority 字段
- ✅ 超时控制：timeoutMs + retries
- ✅ 事件订阅：hook-registered / hook-unregistered / hook-triggered / hook-completed / hook-failed
- ✅ 便捷触发函数：triggerBeforePrompt / triggerAfterResponse / triggerThinking
- ✅ 单例工厂：getHooksEngine() / resetHooksEngine()

---

## 四、UI 组件特性

### 4.1 WorktreePanel

- ✅ 渐变背景（from-surface-900 to-surface-950）
- ✅ 渐入动画（animate-in fade-in duration-200）
- ✅ 状态过滤（全部/活跃/已合并/已丢弃）
- ✅ 类型过滤（所有类型/本地/隔离/审查/实验）
- ✅ 视图切换（网格/列表）
- ✅ 创建按钮（+ 隔离/+ 审查/+ 实验）
- ✅ 操作按钮（Diff / 合并 / 丢弃）
- ✅ Diff 模态预览
- ✅ 清理过期按钮
- ✅ Esc 键关闭
- ✅ 背景点击关闭
- ✅ ErrorBoundary 嵌套

### 4.2 ModelRouterPanel

- ✅ 渐变背景 + 渐入动画
- ✅ 3 路由模式切换（成本/平衡/质量）
- ✅ 路由测试器：输入 prompt → 自动分类 + 评估复杂度 + 推荐模型
- ✅ 模型库：能力/速度/上下文/价格/特长
- ✅ 启停模型按钮
- ✅ 决策历史（最近 5 次）
- ✅ 清空决策日志
- ✅ Esc 键关闭
- ✅ ErrorBoundary 嵌套

### 4.3 HooksManagerPanel

- ✅ 渐变背景 + 渐入动画
- ✅ 10 事件类型切换标签
- ✅ 4 Action 类型注册表单
- ✅ 优先级 + 超时 + 重试 + Fallback 可视化
- ✅ 启停 / 删除按钮
- ✅ 触发按钮
- ✅ 执行历史（最近 20 条，状态/耗时/错误）
- ✅ 清空执行日志
- ✅ Esc 键关闭
- ✅ ErrorBoundary 嵌套

---

## 五、集成架构

### 5.1 组件树

```
App
├── AppLayout
│   └── BrandHeader
│       ├── 菜单项：🌳 Worktree 隔离 (G20-01)
│       ├── 菜单项：🧠 智能模型路由 (G20-02)
│       └── 菜单项：🪝 事件钩子 (G20-03)
├── ErrorBoundary (Worktree)
│   └── WorktreePanel
├── ErrorBoundary (ModelRouter)
│   └── ModelRouterPanel
└── ErrorBoundary (Hooks20)
    └── HooksManagerPanel
```

### 5.2 状态管理

```typescript
// App.tsx
const [worktreeOpen, setWorktreeOpen] = useState(false);
const [modelRouterOpen, setModelRouterOpen] = useState(false);
const [hooks20Open, setHooks20Open] = useState(false);

const handleOpenWorktree = useCallback(() => setWorktreeOpen((p) => !p), []);
const handleOpenModelRouter = useCallback(() => setModelRouterOpen((p) => !p), []);
const handleOpenHooks20 = useCallback(() => setHooks20Open((p) => !p), []);
```

---

## 六、测试结果

### 6.1 单元测试

```
✓ worktreeManager.test.ts: 58/58
✓ modelRouter.test.ts: 65/65
✓ hooksEngine.test.ts: 42/42
小计: 165/165
```

### 6.2 集成测试

```
✓ WorktreePanel.test.tsx: 7/7
✓ ModelRouterPanel.test.tsx: 8/8
✓ HooksManagerPanel.test.tsx: 9/9
小计: 24/24
```

### 6.3 E2E 断言

```
总断言: 115
通过: 115 (100%)

- Section 1: WorktreeManager 引擎 (15 项)
- Section 2: ModelRouter 引擎 (20 项)
- Section 3: HooksEngine 引擎 (20 项)
- Section 4: UI 组件存在性 (10 项)
- Section 5: App.tsx 集成 (7 项)
- Section 6: BrandHeader 菜单项 (9 项)
- Section 7: TypeScript 编译 (1 项)
- Section 8: 自动化测试 (4 项)
- Section 9: Loop Engineering 无回归 (29 项)
```

### 6.4 全量测试

```
Test Files: 80
Tests: 1588
通过: 1588 (100%)
TypeScript 错误: 0
```

---

## 七、Loop Engineering 工作流验证

### 7.1 端到端流程

1. **需求输入** → 用户点击 BrandHeader 三点菜单
2. **菜单选择** → 三个新菜单项可见
3. **面板打开** → 对应 panel 渲染（Worktree/ModelRouter/HooksManager）
4. **交互操作** → Esc 关闭 / 背景点击 / 关闭按钮
5. **状态保持** → 引擎状态独立于 panel 显隐
6. **错误恢复** → ErrorBoundary 捕获崩溃

### 7.2 工作流保留

- ✅ Loop Engineering 9 阶段工作流未受影响
- ✅ Composer 多文件编辑（Cycle 16-18）共存
- ✅ Plan Mode / Preview Mode / Edit Mode 互不干扰
- ✅ Background Tasks / Best-of-N / Design Mode（Cycle 19）共存
- ✅ GlobalErrorHandler 兜底
- ✅ useToast 提示保持

---

## 八、依赖与配置

### 8.1 新增依赖

无新增 npm 依赖，所有功能使用现有工具库：
- React 18 Hooks (useState, useEffect, useCallback, useMemo, useRef)
- Tailwind CSS (Surface 主题系统)
- @testing-library/react (组件测试)
- vitest (测试运行器)
- crypto.randomUUID (UUID v4)

### 8.2 修改文件统计

| 文件 | 行数变化 | 类型 |
|------|---------|------|
| `frontend/src/App.tsx` | +60 | 集成 |
| `frontend/src/components/AppLayout.tsx` | +18 | 透传 |
| `frontend/src/components/BrandHeader.tsx` | +90 | UI（菜单+图标） |
| `frontend/src/components/WorktreePanel.tsx` | +530 (new) | UI 组件 |
| `frontend/src/components/ModelRouterPanel.tsx` | +380 (new) | UI 组件 |
| `frontend/src/components/HooksManagerPanel.tsx` | +470 (new) | UI 组件 |
| `frontend/src/utils/worktreeManager.ts` | +700 (new) | 引擎 |
| `frontend/src/utils/modelRouter.ts` | +580 (new) | 引擎 |
| `frontend/src/utils/hooksEngine.ts` | +680 (new) | 引擎 |
| 测试文件 (6 个) | +1800 (new) | 测试 |
| SPEC 文档 (3 个) | +30K (new) | 规范 |

---

## 九、使用说明

### 9.1 启动 Worktree 隔离

```typescript
import { getWorktreeManager } from './utils/worktreeManager';

const manager = getWorktreeManager();
const wt = await manager.create({ type: 'isolated', label: '实验一' });
await manager.diff(wt.id);
const result = await manager.merge(wt.id);
```

### 9.2 智能路由

```typescript
import { getModelRouter, classifyTask, estimateComplexity } from './utils/modelRouter';

const router = getModelRouter();
router.setMode('cost'); // 切到成本模式
const route = router.route('请帮我实现 React 组件');
console.log(route.model); // 'claude-sonnet-4.5' 或其他
```

### 9.3 钩子注册与触发

```typescript
import { getHooksEngine, triggerBeforePrompt } from './utils/hooksEngine';

const engine = getHooksEngine();
engine.registerHook({
  id: 'audit-log',
  type: 'before_prompt',
  name: '审计日志',
  scope: 'user',
  enabled: true,
  action: { type: 'webhook', url: 'https://api.example.com/audit', method: 'POST' },
  createdAt: Date.now(),
  createdBy: 'admin',
  priority: 100,
  timeoutMs: 5000,
  retries: 1,
  fallback: 'warn',
});

// 触发钩子
await triggerBeforePrompt({ userId: 'u-001', text: 'hello' });
```

---

## 十、下一步计划（Cycle 21）

### 10.1 候选 Gap

| Gap | 描述 | 优先级 |
|---|---|---|
| 多模型路由与 Worktree 协同 | Best-of-N 候选使用独立 Worktree 隔离 | 极高 |
| 钩子可视化 | 钩子执行链路图（hook chain viewer） | 高 |
| 模型路由成本看板 | 实时统计路由成本/命中率 | 高 |
| Worktree 远程支持 | GitWorktreeBackend 接入后端 API | 中 |
| 钩子模板市场 | 预置常用钩子模板（lint/test/format） | 中 |

### 10.2 优先级

1. **P0-1**: 多模型路由 × Worktree 隔离协同
2. **P0-2**: 钩子执行链路可视化
3. **P1-1**: 模型路由成本统计

---

## 附录 A：关键文件清单

| 路径 | 用途 |
|------|------|
| `frontend/src/utils/worktreeManager.ts` | Worktree 隔离引擎 |
| `frontend/src/utils/modelRouter.ts` | 智能模型路由引擎 |
| `frontend/src/utils/hooksEngine.ts` | 事件钩子引擎 |
| `frontend/src/components/WorktreePanel.tsx` | Worktree 管理面板 |
| `frontend/src/components/ModelRouterPanel.tsx` | 模型路由面板 |
| `frontend/src/components/HooksManagerPanel.tsx` | 钩子管理面板 |
| `tests/test_e2e_cycle20.sh` | Cycle 20 E2E 验证 |
| `CYCLE20_RESEARCH_REPORT.md` | 调研报告 |
| `CYCLE20_GAP_ANALYSIS.md` | 差距分析 |
| `CYCLE20_SPEC_WORKTREE.md` | Worktree 规范 |
| `CYCLE20_SPEC_MODEL_ROUTER.md` | 模型路由规范 |
| `CYCLE20_SPEC_HOOKS.md` | 钩子规范 |

---

**更新日期**: 2026-07-29 15:10
**Cycle**: 20 ✅ 已完成
**下一 Cycle**: 21 启动准备
**负责人**: Hermes AI Agent
