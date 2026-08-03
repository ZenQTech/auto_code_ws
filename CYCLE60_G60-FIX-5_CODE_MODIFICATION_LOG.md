# CYCLE60 G60-FIX-3/4/5 代码修改日志

## 修改概览

本次 G60-FIX 系列共 3 个提交，集中在 Solo 模式下面板渲染的完整性和稳定性：

| 提交 | 范围 | 修改文件数 | 行数 |
|------|------|-----------|------|
| `aa0c9df` | G60-FIX-3: SoloPanelsContainer 单测 + Doctor API 路径修复 | 2 | +147/-3 |
| `d37d83d` | G60-FIX-4: Plan/Loop/Auto-Follow 3 个 Solo 特有 panel 完整渲染 | 3 | +101/-31 |
| `43dc4b7` | G60-FIX-5: 补齐 mcpObservability panel + 6 个新单测 | 2 | +137/-2 |

## 修改详情

### 提交 1: `43dc4b7` (G60-FIX-5 最新)

#### `frontend/src/components/SoloPanelsContainer.tsx` (v1.1.0 → v1.2.0)

**核心作用**: 补齐之前遗漏的 McpObservabilityPanel 渲染，让 ToolsMatrixPanel 中所有 41 个面板都能在 Solo 模式下正常打开。

**修改原因**:
- ToolsMatrixPanel 中定义了 41 个 panel 按钮
- `mcpObservability` 按钮（"MCP 可观测性"，emoji: 📡）已经存在并可点击
- 但 SoloPanelsContainer 没有对应的 Modal 渲染，点击后只 toggle 状态无内容
- 这是一个完整的可用性缺陷

**修改内容**:
1. **新增 import**: `import McpObservabilityPanel from './McpObservabilityPanel';`
2. **新增 Modal**: 在 mcpStreamProcessing 后追加 McpObservabilityPanel 渲染块
3. **更新文件头注释**:
   - 版本号: v1.1.0 → v1.2.0
   - 修改记录追加: 2026-08-03 | v1.2.0 | G60-FIX-5 补齐 mcpObservability 面板

**核心代码**:
```tsx
<SoloModal open={modals.mcpObservability.open} onClose={modals.mcpObservability.onClose} maxWidth="max-w-5xl">
  <McpObservabilityPanel onClose={modals.mcpObservability.onClose} />
</SoloModal>
```

**修改前 vs 修改后**:
| 项 | 修改前 | 修改后 |
|---|---|---|
| Solo 模式 mcpObservability 面板 | ❌ 不可见 | ✅ 可打开 |
| ToolsMatrixPanel 41 个按钮覆盖 | 40/41 | 41/41 (100%) |
| SoloPanelsContainer 版本 | v1.1.0 | v1.2.0 |

#### `frontend/src/components/SoloPanelsContainer.test.tsx` (14 → 20 tests)

**新增 Mock**:
```tsx
vi.mock('./McpObservabilityPanel', () => ({
  default: () => <div data-testid="mock-mcp-observability">McpObservability</div>,
}));

vi.mock('./PlanExecutorPanel', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="mock-plan-executor">
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

vi.mock('./LoopStateMachineView', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="mock-loop-state-machine">
      <button onClick={onClose}>close</button>
    </div>
  ),
}));
```

**新增 6 个测试用例**:

| 测试 ID | 名称 | 验证内容 |
|---------|------|---------|
| G60-FIX-4-T15 | planExecutor + currentPlanId 渲染 | 提供 planId 时渲染 PlanExecutorPanel |
| G60-FIX-4-T16 | planExecutor 无 planId 显示提示 | 缺失 planId 时显示"暂无 Plan 数据" |
| G60-FIX-4-T17 | loopState 渲染 LoopStateMachineView | 提供 state 时正确渲染 |
| G60-FIX-4-T18 | autoFollow 面板文本 | 验证 Auto-Follow 联动面板文案 |
| G60-FIX-5-T19 | mcpObservability 渲染 | 验证新增的 mcpObservability panel |
| G60-FIX-5-T20 | 全部 41 个 panel 完整遍历 | 遍历 ToolsMatrixPanel 全部 41 个 key |

**测试结果**: 20/20 通过 (640ms)

### 提交 2: `d37d83d` (G60-FIX-4)

#### `frontend/src/components/SoloPanelsContainer.tsx` (v1.0.1 → v1.1.0)

**修改原因**:
- Solo 模式下点击 Plan 执行 / Loop 状态 / Auto-Follow 按钮时无内容显示
- 这 3 个 panel 是 Vibe Coding Solo 模式的核心功能，必须能正常显示
- 但 VibeSoloShell 中原来使用 overlay 浮层渲染，与 SoloPanelsContainer 不统一

**修改内容**:
1. **新增 3 个 Modal 渲染块**:
   - PlanExecutorPanel（当 planId 存在时显示，否则显示空状态）
   - LoopStateMachineView（始终可显示）
   - Auto-Follow 联动面板（v1.1.0 新增独立 modal）
2. **新增 Props**: `currentPlanId` / `loopState` / `loopHistory`
3. **类型导入**: `import { type LoopState, type LoopTransition } from '../hooks/useLoopState';`

**核心代码**:
```tsx
{/* Plan Executor Panel */}
<SoloModal open={modals.planExecutor.open} onClose={modals.planExecutor.onClose} maxWidth="max-w-5xl">
  {currentPlanId ? (
    <PlanExecutorPanel
      planId={currentPlanId}
      sessionId={currentSessionId ?? undefined}
      onClose={modals.planExecutor.onClose}
    />
  ) : (
    <div className="p-6">...暂无 Plan 数据提示...</div>
  )}
</SoloModal>

{/* Loop State Machine Panel */}
<SoloModal open={modals.loopState.open} onClose={modals.loopState.onClose} maxWidth="max-w-4xl">
  <LoopStateMachineView
    state={loopState ?? null}
    history={loopHistory ?? []}
    onClose={modals.loopState.onClose}
  />
</SoloModal>
```

#### `frontend/src/pages/VibeSoloShell.tsx`

**修改原因**:
- VibeSoloShell 中原本使用绝对定位的浮层渲染 Plan/Loop panel
- 与新创建的 SoloPanelsContainer 形成重复渲染，导致关闭按钮事件冲突
- 必须移除重复，统一由 SoloPanelsContainer 渲染

**修改内容**:
1. **移除重复渲染**:
   - 删除 PlanExecutorPanel 的 overlay 浮层
   - 删除 LoopStateMachineView 的 overlay 浮层
2. **移除冗余 import**:
   - 移除 `import PlanExecutorPanel from '../components/PlanExecutorPanel';`
   - 移除 `import LoopStateMachineView from '../components/LoopStateMachineView';`
3. **透传 Props 给 SoloPanelsContainer**:
   - `currentPlanId={vibeCoding.session?.planId ?? null}`
   - `loopState={loopState.state}`
   - `loopHistory={loopState.history}`

**修改前 vs 修改后**:
| 项 | 修改前 | 修改后 |
|---|---|---|
| Plan panel 渲染位置 | VibeSoloShell overlay + SoloPanelsContainer（重复）| SoloPanelsContainer 单点 |
| Loop panel 渲染位置 | VibeSoloShell overlay + SoloPanelsContainer（重复）| SoloPanelsContainer 单点 |
| 关闭按钮 | 点击无效（事件冲突）| 正常关闭 |
| Props 数据流 | 分散两处 | 统一由 SoloPanelsContainer 接收 |

#### `frontend/src/components/SoloPanelsContainer.test.tsx`

**修改内容**:
- `allKeys` 数组新增 3 个 Solo 特有 panel key
- `'planExecutor'`, `'loopState'`, `'autoFollow'`
- 配合新增的 4 个 G60-FIX-4 测试用例

## 已完成 vs 剩余

### 已完成 ✅
- [x] Solo 模式支持所有 40+ 面板渲染 (G60-FIX-3)
- [x] Plan/Loop/Auto-Follow 3 个 Solo 特有 panel 完整渲染 (G60-FIX-4)
- [x] 补齐 mcpObservability panel (G60-FIX-5)
- [x] 重复渲染导致关闭按钮事件冲突修复 (G60-FIX-4)
- [x] SoloPanelsContainer 单测 20/20 通过
- [x] 全套单测 8032/8032 通过
- [x] TRAE-browseruse 真实浏览器验证:
  - Solo 模式工具矩阵 45 个按钮
  - 命令面板 ⌘K 打开和搜索
  - 3 主题切换 (dark/light/high-contrast)
  - Coding / Chat / Vibe Coding 模式核心功能
  - Settings / Memory 等独立页面
- [x] 修复后端 Doctor API 路径 (useDoctorApi.ts 中 DOCTOR_BASE 加 /api 前缀)

### 剩余 / 后续
- [ ] Solo 模式移动端适配深度测试
- [ ] Cycle 61 进一步 UI 优化（自定义主题、面板尺寸记忆、键盘导航）
- [ ] E2E 测试覆盖所有 panel × 模式组合
- [ ] Vibe Coding 启动 LLM 调用的真实端到端测试

## 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| 修改 SoloPanelsContainer 影响 40+ panel 渲染 | 中 | 8032 单测 + TRAE-browseruse 真实浏览器双重验证 |
| 重复渲染导致事件冲突 | 已解决 | G60-FIX-4 移除重复渲染 |
| mcpObservability 组件复杂度 | 低 | 现有组件无修改，只调整 import 和渲染 |
| 后端服务依赖 | 中 | Coding/Vibe 模式核心功能验证已通过 |

## 修改追溯

完整文件头修改记录 (SoloPanelsContainer.tsx):
```
修改记录：
  - 2026-08-03 | v1.0.0 | Cycle 60 G60-FIX-3 初次创建
  - 2026-08-03 | v1.0.1 | 修复 props 兼容性（McpAdvancedPanel/McpRegistryPanel 不接受 onClose）
  - 2026-08-03 | v1.1.0 | G60-FIX-4 新增 planExecutor/loopState/autoFollow 3 个 Solo 特有 panel
  - 2026-08-03 | v1.2.0 | G60-FIX-5 补齐 mcpObservability 面板（之前遗漏）
```
