# Cycle 18 Spec: Self-Summarization 长 session 控制（G18-03）

> **任务编号**: G18-03
> **优先级**: P1
> **工作量**: 3 人天
> **负责人**: Hermes AI Agent
> **日期**: 2026-07-29

---

## 一、功能需求

### 1.1 用户场景

用户进行长 session Composer 任务时：
- context 持续累积
- 超过窗口后需要丢弃
- 缺少渐进式摘要机制
- 重要决策和修改可能被遗忘

### 1.2 核心需求

1. **自动摘要触发**：
   - context tokens > 8000 时自动触发
   - 用户可手动触发"立即摘要"
   - 摘要历史可查看

2. **摘要内容**：
   - 已应用的 edits 概要（accepted / rejected / modified）
   - context 概要（已使用 files / symbols / docs）
   - 决策点（用户接受的关键修改）
   - 关键 prompt 摘要

3. **摘要注入**：
   - 作为 system message 前置
   - 原文 + 摘要分层（最近 N 条原文 + 更早的摘要）

4. **可视化**：
   - ContextWindowMeter 显示当前 token 使用量
   - SummarizationHistory 展示摘要历史
   - 手动触发按钮

---

## 二、技术实现方案

### 2.1 摘要策略

```typescript
// 三层摘要策略
type SummaryStrategy = 'aggressive' | 'balanced' | 'conservative';

interface SummaryConfig {
  triggerThreshold: number;        // 触发阈值（tokens）
  targetThreshold: number;         // 目标阈值（tokens）
  keepRecentCount: number;         // 保留最近 N 条原文
  preserveDecisionPoints: boolean; // 保留决策点
  preserveEdits: boolean;          // 保留 edit 历史
}

const DEFAULT_CONFIG: SummaryConfig = {
  triggerThreshold: 8000,
  targetThreshold: 4000,
  keepRecentCount: 10,
  preserveDecisionPoints: true,
  preserveEdits: true,
};
```

### 2.2 摘要算法

```typescript
// ComposerEngine 新增 summarize 方法
class ComposerEngine {
  async summarize(options?: { force?: boolean }): Promise<Summary> {
    const currentTokens = this.estimateTokens();
    
    // 检查是否需要摘要
    if (!options?.force && currentTokens < this.config.triggerThreshold) {
      return null;
    }
    
    // 1. 收集待摘要内容
    const candidates = this.collectSummaryCandidates();
    
    // 2. 分层：最近 vs 更早
    const { recent, older } = this.splitByRecency(
      candidates,
      this.config.keepRecentCount
    );
    
    // 3. 提取决策点
    const decisions = this.extractDecisionPoints(older);
    
    // 4. 生成摘要（启发式 + LLM 模拟）
    const summary = {
      id: generateId(),
      createdAt: Date.now(),
      strategy: this.config.summaryStrategy,
      stats: {
        originalTokens: currentTokens,
        summaryTokens: 0, // 将在生成后计算
        reductionRatio: 0,
      },
      recentCount: recent.length,
      olderCount: older.length,
      decisions,
      keypoints: this.extractKeypoints(older),
      editsSummary: this.summarizeEdits(older),
      contextSummary: this.summarizeContext(older),
    };
    
    // 5. 推入摘要历史
    this.summaryHistory.push(summary);
    
    // 6. 替换 context 中的旧内容
    this.replaceOldWithSummary(older, summary);
    
    // 7. 计算统计
    summary.stats.summaryTokens = this.estimateTokens();
    summary.stats.reductionRatio = 
      (summary.stats.originalTokens - summary.stats.summaryTokens) / 
      summary.stats.originalTokens;
    
    return summary;
  }
  
  // 提取决策点
  private extractDecisionPoints(items: ConversationItem[]): DecisionPoint[] {
    return items
      .filter(item => item.role === 'user' && item.acceptedEdits?.length > 0)
      .map(item => ({
        timestamp: item.createdAt,
        prompt: item.content.slice(0, 200),
        editsApplied: item.acceptedEdits.length,
        rationale: this.inferRationale(item),
      }));
  }
  
  // 生成摘要文本
  generateSummaryText(summary: Summary): string {
    const lines: string[] = [];
    lines.push(`# Conversation Summary (${new Date(summary.createdAt).toISOString()})`);
    lines.push('');
    lines.push(`## Stats`);
    lines.push(`- Original: ${summary.stats.originalTokens} tokens`);
    lines.push(`- Summary: ${summary.stats.summaryTokens} tokens`);
    lines.push(`- Reduction: ${(summary.stats.reductionRatio * 100).toFixed(1)}%`);
    lines.push('');
    if (summary.decisions.length > 0) {
      lines.push(`## Key Decisions (${summary.decisions.length})`);
      for (const d of summary.decisions) {
        lines.push(`- [${d.timestamp}] ${d.prompt}`);
        lines.push(`  - Applied ${d.editsApplied} edits`);
      }
      lines.push('');
    }
    if (summary.editsSummary.length > 0) {
      lines.push(`## Edits Summary`);
      for (const e of summary.editsSummary) {
        lines.push(`- ${e.filePath}: ${e.status} (${e.description.slice(0, 100)})`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }
}
```

### 2.3 Token 估算

```typescript
// 简单的 token 估算（实际可接入 tiktoken）
export function estimateTokens(text: string): number {
  // 中文字符约 1.5 token
  // 英文单词约 0.75 token
  // 标点和空格约 0.25 token
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  const otherChars = text.length - chineseChars - englishWords;
  
  return Math.ceil(
    chineseChars * 1.5 + 
    englishWords * 0.75 + 
    otherChars * 0.25
  );
}
```

### 2.4 UI 组件

```typescript
// ContextWindowMeter.tsx
export function ContextWindowMeter({ engine }: Props) {
  const { tokens, threshold, summaryHistory } = useEngineState(engine);
  const percent = (tokens / threshold) * 100;
  
  return (
    <div data-testid="context-window-meter">
      <div className="meter">
        <div className="fill" style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <span>{tokens} / {threshold} tokens</span>
      {percent > 80 && <button onClick={() => engine.summarize({ force: true })}>立即摘要</button>}
    </div>
  );
}

// SummarizationHistory.tsx
export function SummarizationHistory({ summaries }: Props) {
  return (
    <div data-testid="summarization-history">
      {summaries.map(s => (
        <SummaryCard key={s.id} summary={s} />
      ))}
    </div>
  );
}
```

### 2.5 ComposerPanel 集成

```typescript
// 在 ComposerPanel 添加 ContextWindowMeter
<ComposerHeader mode={mode} onModeChange={setInternalMode} />
<ContextWindowMeter engine={composer.engine} />
{mode === 'plan' ? <PlanViewer ... /> : ...}
```

---

## 三、接口设计

### 3.1 ComposerEngine API

```typescript
export interface Summary {
  id: string;
  createdAt: number;
  strategy: SummaryStrategy;
  stats: {
    originalTokens: number;
    summaryTokens: number;
    reductionRatio: number;
  };
  recentCount: number;
  olderCount: number;
  decisions: DecisionPoint[];
  keypoints: string[];
  editsSummary: Array<{ filePath: string; status: string; description: string }>;
  contextSummary: Array<{ type: string; count: number }>;
  text: string;
}

export interface DecisionPoint {
  timestamp: number;
  prompt: string;
  editsApplied: number;
  rationale: string;
}

export interface SummaryConfig {
  triggerThreshold: number;
  targetThreshold: number;
  keepRecentCount: number;
  preserveDecisionPoints: boolean;
  preserveEdits: boolean;
  strategy: SummaryStrategy;
}

export interface ComposerEngine {
  // 现有 API...
  summarize(options?: { force?: boolean }): Promise<Summary | null>;
  estimateContextTokens(): number;
  getSummaryHistory(): Summary[];
  clearSummaryHistory(): void;
  getConfig(): SummaryConfig;
  setConfig(config: Partial<SummaryConfig>): void;
}
```

### 3.2 useComposer Hook 扩展

```typescript
export function useComposer() {
  // 现有 API...
  const summarize = useCallback(async (force?: boolean) => {
    return engine.summarize({ force });
  }, [engine]);
  
  const summaryHistory = useSyncExternalStore(
    (cb) => engine.subscribeSummary(cb),
    () => engine.getSummaryHistory()
  );
  
  return { ...existing, summarize, summaryHistory };
}
```

---

## 四、数据结构

### 4.1 Summary 数据结构

```typescript
{
  id: "sum_1234567890",
  createdAt: 1690623600000,
  strategy: "balanced",
  stats: {
    originalTokens: 8500,
    summaryTokens: 4200,
    reductionRatio: 0.506
  },
  recentCount: 10,
  olderCount: 23,
  decisions: [
    {
      timestamp: 1690623500000,
      prompt: "Add user authentication to the API",
      editsApplied: 3,
      rationale: "Implemented JWT-based auth flow"
    }
  ],
  keypoints: [
    "Implemented JWT authentication in 3 files",
    "Added 5 unit tests for auth middleware",
    "Refactored error handling to use Result type"
  ],
  editsSummary: [
    { filePath: "src/auth/UserService.ts", status: "accepted", description: "Add JWT generation" },
    { filePath: "src/middleware/auth.ts", status: "accepted", description: "Add auth middleware" }
  ],
  contextSummary: [
    { type: "file", count: 8 },
    { type: "symbol", count: 15 },
    { type: "docs", count: 3 }
  ],
  text: "# Conversation Summary (2026-07-29 12:00:00)\n..."
}
```

---

## 五、性能与安全要求

### 5.1 性能
- 摘要生成 ≤ 500ms（启发式）+ 异步 LLM（可选）
- 触发检查 ≤ 10ms（每次 sendPrompt 前）
- 历史加载 ≤ 50ms

### 5.2 安全
- 摘要中不暴露敏感信息（密钥/凭据）
- 摘要文本大小限制 ≤ 2000 tokens
- 历史最多保留 50 条摘要

### 5.3 错误处理
- 摘要失败时降级为"不摘要"+ 提示
- LLM 调用失败时使用启发式摘要
- 摘要注入失败时跳过注入

---

## 六、验收标准

### 6.1 功能测试

- [ ] 单元测试 ≥ 10 个
  - estimateTokens（3 个）
  - summarize 触发逻辑（3 个）
  - 摘要生成（2 个）
  - 决策点提取（2 个）
- [ ] 集成测试 ≥ 4 个（端到端长 session 摘要）
- [ ] E2E 断言 ≥ 6 个

### 6.2 UI 测试

- [ ] ContextWindowMeter 显示正确
- [ ] 摘要历史可展开
- [ ] 手动摘要按钮可用
- [ ] 摘要文本可读

### 6.3 验收条件

- 所有测试通过率 100%
- TypeScript 编译 0 错误
- Composer 集成测试 100% 通过
- 摘要减少率 ≥ 40%

---

**Spec 完成日期**: 2026-07-29
**负责人**: Hermes AI Agent
**下一步**: 实现 frontend/src/utils/composerEngine.summary.ts + ContextWindowMeter 组件
