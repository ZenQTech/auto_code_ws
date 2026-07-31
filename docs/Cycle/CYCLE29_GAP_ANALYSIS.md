# Cycle 29 差距分析报告

**周期**：Cycle 29 (v6.77.0 - v6.82.0)
**日期**：2026-07-30
**基于**：[CYCLE29_CODEX_TRAE_RESEARCH.md](file:///home/qizheng/auto_code_ws/CYCLE29_CODEX_TRAE_RESEARCH.md)
**状态**：✅ 差距分析完成

---

## 一、与当前 Hermes 系统对比

### 1.1 已实现能力 (Cycle 1-28 累积)

| 能力 | 来源 | 文件 |
|------|------|------|
| 单技能调用 | Cycle 28 G28-01 | [skillEngine.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/skillEngine.ts) |
| 成本预算 + Fallback Model | Cycle 28 G28-02 | [costBudgetEngine.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/costBudgetEngine.ts) |
| 多维用量归因 | Cycle 28 G28-03 | [usageAttributionEngine.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/usageAttributionEngine.ts) |
| 作用域权限 | Cycle 28 G28-04 | [scopedPermissionsEngine.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/scopedPermissionsEngine.ts) |
| 斜杠命令面板 | Cycle 28 G28-05 | [slashCommandEngine.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/slashCommandEngine.ts) |
| 后台任务 | Cycle 19 P0-1 | BackgroundTaskEngine |
| 多任务编排 | Cycle 24 P1-1 | MultiTaskOrchestrator |
| 嵌套子代理 (3 层) | Cycle 27 G27-01 | NestedSubAgentEngine |
| 代理检查点 | Cycle 27 G27-02 | AgentCheckpointEngine |
| 远程控制 | Cycle 27 G27-06 | RemoteControlEngine |
| 5 个内置技能 | Cycle 28 G28-01 | code-review/test-generator/refactor-assistant/doc-generator/security-scanner |

### 1.2 缺失能力 (Cycle 29 待实现)

| 能力 | 目标 | 优先级 |
|------|------|--------|
| 多技能堆叠调用 | Stacked Skills | P0 |
| 技能市场 | Skills Marketplace | P0 |
| 自然语言查询 | Analytics Chat | P0 |
| 阈值告警 | Cost Threshold Alert | P1 |
| 工具自动编排 | Flow Mode | P1 |
| REST API 暴露 | Admin Analytics API | P1 |
| 工作流录制 | Record & Replay | P2 |
| $ARGUMENTS 替换 | Skill Argument Variables | P2 |
| 技能级钩子 | Per-skill Lifecycle Hooks | P2 |

---

## 二、P0 任务详细规格

### G29-01: Stacked Skills Engine

**目标**：实现一次调用最多 5 个技能的堆叠编排能力

**核心 API**：
```typescript
class StackedSkillEngine {
  // 解析堆叠技能命令
  parseStackedCommand(input: string): StackedCommand | null;

  // 执行堆叠技能
  async executeStack(
    input: string,
    options?: { maxStack?: number; sharedContext?: boolean }
  ): Promise<StackedExecutionResult>;

  // 技能组合验证（检查 allowedTools 冲突）
  validateComposition(skillNames: string[]): CompositionCheckResult;
}
```

**数据结构**：
```typescript
interface StackedCommand {
  skillNames: string[]; // ['code-review', 'security-scanner', 'refactor']
  args: string;
  sharedContext: boolean;
}

interface StackedExecutionResult {
  results: SkillExecutionResult[];
  aggregatedOutput: string;
  totalDurationMs: number;
  conflicts: SkillConflict[];
}
```

**测试覆盖**：
- 解析 1-5 个技能
- 拒绝超过 5 个技能
- 技能间上下文共享
- 工具权限冲突检测

### G29-02: Skills Marketplace

**目标**：提供技能市场（浏览/安装/评分/评论）

**核心 API**：
```typescript
class SkillsMarketplace {
  // 列出所有可用技能
  listSkills(filter?: { category?: string; sortBy?: 'installs' | 'rating' | 'newest' }): MarketplaceSkill[];

  // 安装技能
  async installSkill(skillId: string): Promise<Skill>;

  // 评分
  rateSkill(skillId: string, rating: 1 | 2 | 3 | 4 | 5): void;

  // 评论
  commentOnSkill(skillId: string, comment: string): void;

  // 搜索
  searchSkills(query: string): MarketplaceSkill[];
}
```

**数据来源**：
- skills-hub.ai API（模拟）
- 内置 6 个示例技能（code-review / refactor / ci-cd / security-audit / api-design / quickstart）

**UI 组件**：
- MarketplacePanel.tsx（列表 + 详情 + 安装按钮 + 评分/评论）

### G29-03: Analytics Chat

**目标**：自然语言查询用量数据 + 图表生成

**核心 API**：
```typescript
class AnalyticsChat {
  // 自然语言查询
  async query(question: string): Promise<QueryResult>;

  // 生成图表
  generateChart(data: QueryResult, type: 'bar' | 'line' | 'pie'): ChartSpec;

  // 导出数据
  exportData(result: QueryResult, format: 'json' | 'csv'): string;
}

interface QueryResult {
  answer: string;
  data: Record<string, unknown>;
  chartSpec?: ChartSpec;
  followUpQuestions: string[];
}
```

**示例查询**：
- "上个季度哪个团队用了最多 token？"
- "code-review 技能累计调用次数？"
- "哪个模型成本最高？"
- "今天的预算使用率？"

---

## 三、P1 任务详细规格

### G29-04: Cost Threshold Alert

**目标**：实现 75% / 90% / 100% 预算阈值告警

**数据结构**：
```typescript
interface ThresholdAlert {
  id: string;
  budgetId: string;
  threshold: 0.75 | 0.90 | 1.0;
  triggeredAt: number;
  currentUsage: number;
  budgetLimit: number;
  acknowledged: boolean;
}
```

**核心 API**：
```typescript
class ThresholdAlertEngine {
  checkThresholds(budget: BudgetLimit): ThresholdAlert[];
  acknowledgeAlert(alertId: string): void;
  listAlerts(filter?: { acknowledged?: boolean; since?: number }): ThresholdAlert[];
}
```

### G29-05: Flow Mode Orchestrator

**目标**：根据 Agent 当前工作阶段自动切换工具

**核心 API**：
```typescript
class FlowModeOrchestrator {
  // 阶段定义
  defineStage(stage: 'planning' | 'coding' | 'testing' | 'preview', tools: string[]): void;

  // Agent 报告当前阶段
  reportStage(agentId: string, stage: string): void;

  // 获取应激活的工具
  getActiveTools(agentId: string): string[];

  // 订阅工具切换事件
  onToolSwitch(callback: (event: ToolSwitchEvent) => void): () => void;
}
```

### G29-06: Admin Analytics API

**目标**：暴露 REST API 端点供外部系统集成

**API 端点**（模拟）：
- `GET /api/analytics/usage?since=X&until=Y&groupBy=model`
- `GET /api/analytics/cost?dimension=team&period=monthly`
- `GET /api/analytics/skills?sortBy=installs`
- `POST /api/analytics/export?format=json|csv`

---

## 四、任务排期

### Phase 2: 差距分析 + SPEC 文档 (今日)
- ✅ CYCLE29_CODEX_TRAE_RESEARCH.md
- ✅ CYCLE29_GAP_ANALYSIS.md (本文档)
- 🔄 CYCLE29_SPEC_G29_01_STACKED_SKILLS.md (下一步)
- 🔄 CYCLE29_SPEC_G29_02_SKILLS_MARKETPLACE.md
- 🔄 CYCLE29_SPEC_G29_03_ANALYTICS_CHAT.md

### Phase 3: 核心引擎开发
- 预计 3 个新引擎：StackedSkillEngine / SkillsMarketplace / AnalyticsChat
- 每个引擎 20-30 个单元测试
- 预计 60-90 个测试

### Phase 4: UI 组件开发
- 预计 3 个新面板：StackedSkillsPanel / MarketplacePanel / AnalyticsChatPanel
- 每个组件 8-10 个组件测试
- 预计 24-30 个测试

### Phase 5: AppLayout/BrandHeader/App.tsx 集成
- 3 个新菜单项 + 3 个新 prop 透传

### Phase 6: E2E 集成测试
- 预计 15-20 个 E2E 测试

### Phase 7: Git 提交 + Cycle 30 准备
- 4-5 个语义化版本提交
- 验收报告 + 代码修改日志

---

## 五、风险评估

### 5.1 技术风险

| 风险 | 可能性 | 影响 | 缓解策略 |
|------|--------|------|---------|
| Stacked Skills 上下文管理复杂 | 中 | 中 | 限制 maxStack=5 + sharedContext 选项 |
| Marketplace 数据源真实性 | 低 | 低 | 使用模拟数据 + 标注"示例" |
| Analytics Chat LLM 调用成本 | 中 | 中 | 使用本地规则引擎 + 可选 LLM 增强 |
| 阈值告警触发风暴 | 低 | 中 | 添加告警抑制窗口（同一预算 5 分钟内只触发 1 次） |

### 5.2 时间风险

| 风险 | 可能性 | 影响 | 缓解策略 |
|------|--------|------|---------|
| 6 个任务超过 1 个 cycle | 中 | 中 | P0 必须完成，P1 可拆分到 Cycle 30 |
| Skills Marketplace 数据构造耗时 | 低 | 低 | 使用固定的 6 个示例技能 |

---

## 六、成功标准

### 6.1 功能完成度
- ✅ 3 个 P0 引擎 + UI 100% 完成
- 🟡 3 个 P1 任务至少完成 2 个
- ✅ 整体测试通过率 100%
- ✅ TypeScript 严格模式 0 错误

### 6.2 代码质量
- 新增测试 100+ 个
- 所有引擎遵循统一接口（on/off/emit/load/save）
- 所有 UI 组件遵循统一布局（fixed inset-0 + bg-black/40）

### 6.3 集成完整度
- 顶部菜单 3 个新入口
- AppLayout 透传 3 个新 prop
- App.tsx 集成 3 个新面板
- E2E 测试覆盖整体流程

---

## 七、参考资料

详见 [CYCLE29_CODEX_TRAE_RESEARCH.md](file:///home/qizheng/auto_code_ws/CYCLE29_CODEX_TRAE_RESEARCH.md) 第六章。

---

**结论**：Cycle 29 计划完成 3 个 P0 任务 + 2-3 个 P1 任务，确保整体测试通过率保持 100%，进入 Cycle 30 时具备更强的 Skills 生态能力。
