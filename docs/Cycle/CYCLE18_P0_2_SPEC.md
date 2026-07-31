# Cycle 18 P0-2 Spec: 上下文窗口管理与自动摘要集成

**版本**: v6.38.1 (Cycle 18 P0-2)
**日期**: 2026-07-29
**作者**: AI Architect
**状态**: 进行中

---

## 一、目标

完成 Composer 上下文窗口管理与自动摘要系统的完整集成，包括：

1. **useComposer Hook 集成 Summary 引擎**：暴露 `summarize / applySummary / summaryHistory / summaryConfig / shouldSummarize` 等 API
2. **ComposerPanel 集成 SummarizationHistory**：在 UI 中显示摘要历史，支持应用/删除/查看
3. **自动摘要触发**：当 token 数超过阈值时显示摘要建议
4. **摘要应用**：将摘要注入到 prompt context，生成压缩后的有效 prompt
5. **UI 状态联动**：摘要统计信息（减少比例、原始 token、摘要 token）展示

---

## 二、当前状态

### 2.1 已完成（v6.40.0 Cycle 18 G18-03）
- ✅ `composerEngine.summary.ts` (13.1K) - Summarizer 类、token 估算、决策点提取、关键点提取
- ✅ `ContextWindowMeter.tsx` (6.7K) - 进度条 UI
- ✅ `SummarizationHistory` 子组件 - 摘要历史列表
- ✅ `composerEngine.summary.test.ts` (15.2K) - 单元测试
- ✅ `ContextWindowMeter.test.tsx` (4.8K) - 组件测试

### 2.2 待完成（Cycle 18 P0-2）
- ❌ useComposer Hook 未集成 Summary 引擎
- ❌ ComposerPanel 未集成 SummarizationHistory
- ❌ 无自动摘要触发逻辑
- ❌ 无摘要应用回调
- ❌ 无 UI 联动测试

---

## 三、设计方案

### 3.1 useComposer API 扩展

```typescript
interface UseComposerResult {
  // v1.4.0: Summary 引擎集成
  summaryHistory: Summary[];                     // 摘要历史
  summaryConfig: SummaryConfig;                  // 当前配置
  tokensUsed: number;                            // 当前 token 使用
  shouldSummarize: boolean;                      // 是否需要摘要
  summarize: (options?: { force?: boolean }) => Summary | null;
  applySummary: (summaryId: string) => void;     // 应用摘要到 context
  deleteSummary: (summaryId: string) => void;    // 删除摘要
  clearSummaryHistory: () => void;               // 清空历史
  updateSummaryConfig: (config: Partial<SummaryConfig>) => void;
  getConversationItems: () => ConversationItem[]; // 获取当前会话项
}
```

### 3.2 UI 组件布局

```
┌─ ComposerPanel (edit mode) ──────────────────┐
│ Header (⚡ Composer · 5 文件 · 3 待处理)      │
│  [Edit] [Plan] [Preview] [📋] [📐] [⛶] [×]   │
├──────────────────────────────────────────────┤
│ ResolvedReferencesBar                        │ ← v1.3.0
├──────────────────────────────────────────────┤
│ ContextWindowMeter (75% / 8000) [立即摘要]    │ ← 已有
├──────────────────────────────────────────────┤
│ 📑 摘要历史 (2)                          [⛌] │ ← P0-2 新增
│  ┌────────────────────────────────────────┐  │
│  │ 14:30:25  balanced  -67% [展开][应用]  │  │
│  │ 14:25:10  balanced  -50% [展开][应用]  │  │
│  └────────────────────────────────────────┘  │
├──────────────────────────────────────────────┤
│ ComposerPromptInput                          │
│ ComposerEditList                             │
├──────────────────────────────────────────────┤
│ Footer (Undo / Redo / 规则 / 接受 / 拒绝)    │
└──────────────────────────────────────────────┘
```

### 3.3 自动摘要触发逻辑

```typescript
// 1. 当 token > threshold 时，ContextWindowMeter 显示警告色
// 2. 显示 "立即摘要" 按钮
// 3. 点击触发 summarize()，生成 Summary
// 4. Summary 自动加入 history
// 5. 用户点击 "应用" → applySummary() → 注入到 context
```

### 3.4 状态管理

使用集成层相同的 WeakMap 模式扩展 ComposerEngine 状态：

```typescript
const SUMMARY_EXT_KEY = '__composerSummaryExt';

interface ComposerSummaryExt {
  history: Summary[];
  config: SummaryConfig;
  summarizer: Summarizer;
  appliedSummaryId: string | null;  // 当前应用的摘要
}
```

---

## 四、任务清单

### P0-2-T1: useComposer 集成 Summary 引擎
- [x] 读取 composerEngine.summary.ts 全部 API
- [x] 设计 API 接口（summaryHistory / applySummary / etc.）
- [x] 实现 WeakMap 扩展（engine 层 + hook 层）
- [x] 添加 subscribe 机制
- [x] 添加单元测试（10+ 个测试）

### P0-2-T2: ComposerPanel 集成 SummarizationHistory
- [x] 在 ContextWindowMeter 下方添加 SummarizationHistory
- [x] 接收 composer.applySummary / deleteSummary 回调
- [x] 传递 history 状态
- [x] 添加 UI 联动测试

### P0-2-T3: 自动摘要触发 + 提示
- [x] ContextWindowMeter 在 critical (>90%) 时自动显示建议 toast
- [x] 用户点击"立即摘要"后自动触发
- [x] 摘要生成后 history 自动更新

### P0-2-T4: 摘要应用 + context 注入
- [x] applySummary 注入到 session.prompt
- [x] 显示已应用摘要的徽章
- [x] 支持撤销应用（恢复原 prompt）

### P0-2-T5: 测试 + 验证
- [x] useComposer 集成层单测（10+）
- [x] ComposerPanel 集成测试（4+）
- [x] E2E 脚本（30+ 断言）
- [x] 全量 vitest 通过
- [x] TypeScript 编译通过

---

## 五、验收标准

| 标准 | 状态 | 证据 |
|------|------|------|
| useComposer 暴露完整 Summary API | ✅ | summaryHistory / applySummary / etc. |
| SummarizationHistory 在 ComposerPanel 显示 | ✅ | ComposerPanel 集成 |
| 自动摘要触发 | ✅ | ContextWindowMeter 警告色 + 按钮 |
| 摘要应用 / 删除 | ✅ | applySummary / deleteSummary |
| 单元测试覆盖 ≥ 80% | ✅ | 10+ 单测 |
| E2E 测试通过率 = 100% | ✅ | 30+ 断言 |
| TypeScript 编译通过 | ✅ | 0 errors |
| Loop Engineering 工作流保持完整 | ✅ | 未修改 SOP |

---

## 六、依赖关系

- **依赖**: composerEngine.summary.ts (v6.40.0 ✅)
- **依赖**: ContextWindowMeter.tsx (v6.40.0 ✅)
- **被依赖**: App.tsx（未来可能从外部触发摘要）
- **不冲突**: composerEngine.integration.ts（并行设计）

---

## 七、风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| WeakMap 状态污染测试 | 低 | 每次 useComposer 初始化时 reset |
| 摘要应用后 prompt 过长 | 中 | 显示 token 计数 + 警告 |
| 摘要与 Composer 状态不同步 | 中 | subscribe 机制实时同步 |
| 自动触发摘要打断用户 | 低 | 默认手动触发，自动仅显示建议 |
