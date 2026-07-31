# 代码修改日志 - Cycle 31

**周期**：Cycle 31 (v6.86.0 - v6.88.0)
**日期**：2026-07-30
**范围**：成本归因 + 远程 Worktree + Worktree 状态同步

---

## 一、新增文件

### 1.1 核心引擎

#### `src/utils/costAttributionEngine.ts` (v1.0.0)
- **功能**：org/team/project/repo/user 五维成本归因引擎
- **核心类**：`CostAttributionEngine`
- **方法数**：30+ (5 维注册 + 归因 + 5 维聚合 + 跨维查询 + 异常 + 3 格式导出)
- **事件数**：8 种 (attribution-recorded / org/team/project/repo/user-registered / anomaly-detected / export-completed)
- **持久化**：localStorage (`hermes.costAttribution`)

#### `src/utils/remoteWorktreeAdapter.ts` (v1.0.0)
- **功能**：抽象 local/remote/hybrid 三种 Worktree 后端
- **核心类**：`RemoteWorktreeAdapter` + 3 个 Backend 实现
- **方法数**：25+ (后端管理 + Worktree CRUD + 3 种迁移 + 健康检查 + 指标)
- **事件数**：8 种
- **持久化**：localStorage

#### `src/utils/worktreeSyncEngine.ts` (v1.0.0)
- **功能**：Worktree 状态快照 + 跨设备同步 + 冲突检测/解决
- **核心类**：`WorktreeSyncEngine`
- **方法数**：25+ (快照 + 状态广播 + 同步会话 + 冲突 + 设备)
- **事件数**：6 种
- **持久化**：localStorage

### 1.2 单元测试（3 个）

| 文件 | 测试数 | 状态 |
|------|--------|------|
| `src/utils/costAttributionEngine.test.ts` | 39 | ✅ |
| `src/utils/remoteWorktreeAdapter.test.ts` | 33 | ✅ |
| `src/utils/worktreeSyncEngine.test.ts` | 40 | ✅ |

### 1.3 UI 组件（3 个）

| 文件 | Tab 数 | 状态 |
|------|--------|------|
| `src/components/CostAttributionPanel.tsx` | 4 | ✅ |
| `src/components/RemoteWorktreePanel.tsx` | 3 | ✅ |
| `src/components/WorktreeSyncPanel.tsx` | 3 | ✅ |

### 1.4 E2E 测试（1 个）

| 文件 | 测试数 | 状态 |
|------|--------|------|
| `src/components/Cycle31E2E.test.tsx` | 21 | ✅ |

### 1.5 调研与设计文档（7 个）

| 文件 | 行数 |
|------|------|
| `CYCLE31_CODEX_TRAE_RESEARCH.md` | ~480 |
| `CYCLE31_GAP_ANALYSIS.md` | ~280 |
| `CYCLE31_SPEC_G31_01_COST_ATTRIBUTION.md` | ~210 |
| `CYCLE31_SPEC_G31_02_REMOTE_WORKTREE.md` | ~230 |
| `CYCLE31_SPEC_G31_03_WORKTREE_SYNC.md` | ~220 |
| `CYCLE31_STARTUP.md` | ~140 |
| `CYCLE31_ACCEPTANCE_REPORT.md` | ~280 |

---

## 二、修改文件

### 2.1 `src/App.tsx` (v6.86.0+)

**新增 imports** (3 个)：
```typescript
import { CostAttributionPanel } from './components/CostAttributionPanel';
import { RemoteWorktreePanel } from './components/RemoteWorktreePanel';
import { WorktreeSyncPanel } from './components/WorktreeSyncPanel';
```

**新增 state** (3 个)：
- `costAttributionOpen` - CostAttributionPanel 显隐
- `remoteWorktreeOpen` - RemoteWorktreePanel 显隐
- `worktreeSyncOpen` - WorktreeSyncPanel 显隐

**新增 handler** (3 个)：
- `handleOpenCostAttribution` - 切换 costAttributionOpen
- `handleOpenRemoteWorktree` - 切换 remoteWorktreeOpen
- `handleOpenWorktreeSync` - 切换 worktreeSyncOpen

**新增 prop 传递** (3 个)：
- `onOpenCostAttribution={handleOpenCostAttribution}`
- `onOpenRemoteWorktree={handleOpenRemoteWorktree}`
- `onOpenWorktreeSync={handleOpenWorktreeSync}`

**新增面板渲染** (3 个)：
- `<CostAttributionPanel isOpen={costAttributionOpen} onClose={...} />` + ErrorBoundary
- `<RemoteWorktreePanel isOpen={remoteWorktreeOpen} onClose={...} />` + ErrorBoundary
- `<WorktreeSyncPanel isOpen={worktreeSyncOpen} onClose={...} />` + ErrorBoundary

### 2.2 `src/components/AppLayout.tsx` (v6.86.0)

**新增 Props** (3 个)：
- `onOpenCostAttribution?: () => void`
- `onOpenRemoteWorktree?: () => void`
- `onOpenWorktreeSync?: () => void`

**新增解构** (3 个)：
- `onOpenCostAttribution` 透传 BrandHeader
- `onOpenRemoteWorktree` 透传 BrandHeader
- `onOpenWorktreeSync` 透传 BrandHeader

**新增 JSX 透传** (3 个)：
- `onOpenCostAttribution={onOpenCostAttribution}`
- `onOpenRemoteWorktree={onOpenRemoteWorktree}`
- `onOpenWorktreeSync={onOpenWorktreeSync}`

**文件头修改记录**：
- 新增 `- 2026-07-30 | v6.86.0 | Cycle 31 G31-01/02/03 新增 onOpenCostAttribution/onOpenRemoteWorktree/onOpenWorktreeSync 透传`

### 2.3 `src/components/BrandHeader.tsx` (v2.13.0)

**新增 Props** (3 个)：
- `onOpenCostAttribution?: () => void`
- `onOpenRemoteWorktree?: () => void`
- `onOpenWorktreeSync?: () => void`

**新增解构** (3 个)：
- `onOpenCostAttribution`
- `onOpenRemoteWorktree`
- `onOpenWorktreeSync`

**新增菜单项** (3 个)：
- 成本归因（📊）- `data-testid="menu-cost-attribution"`
- 远程 Worktree（☁️）- `data-testid="menu-remote-worktree"`
- Worktree 状态同步（🔄）- `data-testid="menu-worktree-sync"`

**新增 Icon** (3 个)：
- `'attribution'` - 饼图分布（Path d="M21 12a9 9 0 1 1-9-9v9h9z"）
- `'cloud'` - 云端（Path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"）
- `'sync'` - 双向箭头（polyline + path M3.51 9...M1 14...）

**Icon 类型扩展**：
- 原类型增加 `'attribution' | 'cloud' | 'sync'` 三个新值

**文件头修改记录**：
- 新增 `- 2026-07-30 | v2.13.0 | Cycle 31 新增：菜单项 成本归因 / 远程 Worktree / Worktree 状态同步`

---

## 三、TypeScript 错误修复（同时进行）

### 3.1 `src/components/CostAttributionPanel.tsx`
- **问题**：未使用的 type imports (OrgRef/TeamRef/ProjectRef/RepoRef/UserRef)
- **修复**：保留 AttributionRecord/AttributionReport/AnomalyAlert/Period，删除未使用的

### 3.2 `src/utils/costAttributionEngine.ts`
- **问题**：`buildTopN` 返回类型 `Array<{ [k: string]: string; cost: number }>` 与 `topUsers`/`topRepos` 类型不匹配
- **修复**：返回类型改为 `Array<{ [k: string]: string | number; cost: number }>` + 调用处加 `as` 断言

### 3.3 `src/utils/worktreeSyncEngine.ts`
- **问题1**：`snapshot()` 中 `device` 变量未使用
- **修复**：删除该变量
- **问题2**：`publishChange` 中 `Omit` 类型不包含 `worktreeId`，导致 `worktreeId` 在 spread 后被覆盖
- **修复**：将 `worktreeId` 添加到 `Omit` 列表，并在 spread 后单独设置

### 3.4 `src/utils/remoteWorktreeAdapter.ts`
- **问题1**：`RemoteWorktreeBackend.latencyMs` 字段未使用
- **修复**：删除该字段
- **问题2**：`updateMetricsOnFailure` 中 `to` 参数未使用
- **修复**：改名为 `_to`（下划线前缀表示未使用）
- **问题3**：`setLatency` 方法引用了已删除的 `latencyMs` 字段
- **修复**：删除 `setLatency` 方法

### 3.5 `src/utils/costAttributionEngine.test.ts`
- **问题**：`now` 变量声明但未使用
- **修复**：删除该变量

### 3.6 `src/utils/worktreeSyncEngine.test.ts`
- **问题**：3 处 `localSnap` 变量声明但未使用
- **修复**：删除所有 `localSnap` 变量声明

---

## 四、测试结果

### 4.1 Cycle 31 新增测试

```
✓ src/utils/costAttributionEngine.test.ts       (39 tests)
✓ src/utils/remoteWorktreeAdapter.test.ts       (33 tests)
✓ src/utils/worktreeSyncEngine.test.ts          (40 tests)
✓ src/components/Cycle31E2E.test.tsx            (21 tests)
```

**新增测试合计**：133 个，100% 通过

### 4.2 整体测试统计

| 项目 | 数量 |
|------|------|
| Test Files | 155 |
| Tests | 3860 |
| 失败 | 0 |
| 通过率 | 100% |

### 4.3 TypeScript 类型检查

- 严格模式：✅ **0 错误**

---

## 五、版本历史

| 版本 | 文件 | 内容 |
|------|------|------|
| v1.0.0 | costAttributionEngine.ts | Cycle 31 G31-01 初次创建 |
| v1.0.0 | remoteWorktreeAdapter.ts | Cycle 31 G31-02 初次创建 |
| v1.0.0 | worktreeSyncEngine.ts | Cycle 31 G31-03 初次创建 |
| v6.86.0 | App.tsx | Cycle 31 G31-01/02/03 集成 |
| v6.86.0 | AppLayout.tsx | Cycle 31 G31-01/02/03 prop 透传 |
| v2.13.0 | BrandHeader.tsx | Cycle 31 G31-01/02/03 菜单项 + 图标 |

---

## 六、对应 SPEC

- `CYCLE31_SPEC_G31_01_COST_ATTRIBUTION.md` - 5 维归因详细设计
- `CYCLE31_SPEC_G31_02_REMOTE_WORKTREE.md` - 3 后端适配器详细设计
- `CYCLE31_SPEC_G31_03_WORKTREE_SYNC.md` - 跨设备同步详细设计

---

## 七、对应调研

- `CYCLE31_CODEX_TRAE_RESEARCH.md` - Cursor 3 / Codex App / TRAE SOLO 3.0 调研

---

**Cycle 31 总结**：3 大核心引擎 + 3 UI 组件 + 21 E2E 测试 + 完整 TypeScript 类型修复 + 完整文档。所有任务 100% 完成，进入 Cycle 32 准备阶段。
