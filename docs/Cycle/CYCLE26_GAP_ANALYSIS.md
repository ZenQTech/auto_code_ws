# Cycle 26 差距分析报告 (Gap Analysis)

**日期**: 2026-07-30
**主题**: 基于 CYCLE26_CODEX_TRAE_RESEARCH.md 的差距识别与优先级排序
**目标**: 确定 Cycle 26 的 P0/P1/P2 功能开发优先级

---

## 一、对齐度总览

| 能力类别 | 当前能力 | Codex 对齐 | TRAE 对齐 | 综合 |
|---|---|---|---|---|
| 终端 / Web UI | 完整 Web + TUI 双模式 | 100% | 100% | ✅ |
| 主题系统 | SettingsPanel + 实时切换 | 95% | 95% | ✅ |
| 语音输入 | VoiceInputAdapter + VoiceButton | 80% | 80% | ✅ |
| Hooks 引擎 | HooksEngine + ChainTracker + PerformanceAnalyzer | 95% | 95% | ✅ |
| 跨会话 Memory | GlobalMemoryEngine | 100% | 100% | ✅ |
| Worktree 隔离 | WorktreePanel + Backend Adapter | 95% | 95% | ✅ |
| 多任务并行 | MultiTaskOrchestrator | 90% | 90% | ✅ |
| 设计 → 代码 | FigmaAdapter + DesignMode | 85% | 85% | ✅ |
| 对话流折叠 | UnifiedTimeline + AgentChatCard | 90% | 90% | ✅ |
| 插件市场 | EnterpriseHubPanel + Marketplace | 80% | 80% | ✅ |
| Slash Commands | SlashCommandPicker + Help | 80% | 80% | ✅ |
| SubAgent 体系 | SubAgent + WorkspacePanel | 85% | 85% | ✅ |
| Auto Code Review | AutoCodeReviewEngine (Cycle 25) | 100% | 100% | ✅ |
| PR Bot | PRBotEngine (Cycle 25) | 100% | 100% | ✅ |
| AI 性能优化 | PerfOptimizerEngine (Cycle 25) | 100% | 100% | ✅ |
| Best-of-N | BestOfN + Coordinator | 100% | ❌ | ✅ |
| 后台任务 | BackgroundTaskEngine | 90% | 80% | ✅ |
| 智能路由 | ModelRouter + 成本统计 | 95% | 80% | ✅ |
| 缓存统计 | CacheStatsPanel | 90% | ❌ | ✅ |
| 流式恢复 | StreamListPanel | 85% | ❌ | ✅ |
| OAuth 2.1 | OAuthConfigPanel | 80% | ❌ | ✅ |
| Session Rollout | SessionRolloutPanel | 85% | ❌ | ✅ |
| Composer | ComposerLauncher + ComposerPanel | 80% | 70% | ✅ |
| 成本预测 | CostPredictionPanel | 85% | ❌ | ✅ |
| 候选学习 | CandidateLearningEngine | 100% | ❌ | ✅ |
| 会话回放 | SessionReplayEngine | 100% | ❌ | ✅ |
| 主动建议 | ProactiveSuggestionEngine | 100% | 80% | ✅ |

## 二、尚未实现的关键能力（按优先级）

### 2.1 P0 优先级（必须实现）

| 能力 | 来源 | 差距 | 价值 |
|---|---|---|---|
| **CSV 批处理智能体** | Codex `spawn_agents_on_csv` v0.105 | MultiTaskOrchestrator 仅支持手工任务列表，**没有 CSV 驱动的批量扇出** | 高 |
| **Smart Approvals** | Codex v0.120+ | API Interceptor 仅做监控，**没有 allow/block/prompt 决策系统** | 高 |
| **MTC 适配器** | TRAE 2026 | 完全缺失，**没有任何非编码任务支持** | 中-高 |

### 2.2 P1 优先级（应当实现）

| 能力 | 来源 | 差距 | 价值 |
|---|---|---|---|
| **Voice Discussion** | TRAE 2026 | VoiceInputAdapter 只支持单向输入，**没有双向语音对话** | 中 |
| **CSV/XLSX/PPTX 处理** | TRAE MTC | 完全没有 | 中 |
| **Brainstorm Mode** | TRAE Mobile | 完全没有 | 中 |
| **Agent Teams JSON 配置** | Codex 增强版 | SubAgent 配置硬编码，**没有团队化 JSON 描述** | 中 |
| **JSONL Inbox** | Codex 增强版 | 任务消息无持久化结构 | 中 |

### 2.3 P2 优先级（可延后）

| 能力 | 来源 | 差距 | 价值 |
|---|---|---|---|
| **多端点同步** | TRAE Mobile | 移动端 + 远程控制 | 低（不在目标） |
| **视频生成** | TRAE Work | 无 | 低（不在目标） |
| **/fast 快速层** | Codex v0.131 | 仅有 CustomModelsPanel | 低 |
| **设计系统管理** | TRAE Design Mode | 无 | 中 |
| **批量自然语言编辑** | TRAE Design Mode | 无 | 中 |

---

## 三、Cycle 26 三大 P0 详细规划

### 3.1 G26-01: CSV Batch Agent Engine

**业务价值**：补齐 Hermes 在批量扇出场景的能力
**技术架构**：
- **核心引擎** `csvBatchEngine.ts`：CSV 解析 + 模板渲染 + 子智能体调度
- **类型定义** `csvBatchEngineTypes.ts`：Job/Item/Result/Progress 数据模型
- **规则/策略** `csvBatchEngineRules.ts`：模板占位符语法、并发限制、错误恢复策略
- **持久化** `csvBatchEngineStore.ts`：基于 localStorage 的状态恢复
- **UI 组件** `CsvBatchPanel.tsx`：上传 CSV + 指令模板 + 进度监控 + 结果下载

**与现有能力的关系**：
- 复用 `MultiTaskOrchestrator` 的任务管理
- 复用 `Worktree` 的隔离机制
- 复用 `SubAgent` 的子智能体抽象
- 复用 `BestOfN` 的多模型对比（每个工作项可选用不同模型）

**验收指标**：
- 支持 1-100 个工作项
- 并发可配置（1-10）
- 模板占位符 `{column_name}` 正确渲染
- 进度实时更新 + ETA 准确率 ≥80%
- 失败项可重试，可导出成功/失败明细
- 30+ 单元测试 + 20+ 组件测试 + 5+ 集成测试

**预估工作量**：500-700 行核心代码 + 200 行 UI + 200 行测试

### 3.2 G26-02: Smart Approval Engine

**业务价值**：解决 Hermes 平台命令/工具执行的安全审批问题
**技术架构**：
- **核心引擎** `smartApprovalEngine.ts`：规则解析 + 决策 + 审计
- **类型定义** `smartApprovalTypes.ts`：Rule/Decision/AuditLog 数据模型
- **规则库** `smartApprovalRules.ts`：内置 40+ 安全规则（shell/file/network/api）
- **DSL 设计**：基于 JSON Schema 的表达式系统（prefix/contains/regex/length/cmd-in-cmd）
- **持久化** `smartApprovalStore.ts`：基于 localStorage 的规则持久化
- **UI 组件** `SmartApprovalPanel.tsx`：规则管理 + 审计日志 + 决策预览

**DSL 示例**（JSON 化，简化 Starlark）：
```json
{
  "id": "rule-git-safe",
  "name": "Git 只读操作",
  "match": {
    "all": [
      { "type": "prefix", "value": "git " },
      { "type": "not", "expr": { "type": "contains", "value": "push --force" } },
      { "type": "not", "expr": { "type": "contains", "value": "reset --hard" } }
    ]
  },
  "decision": "allow",
  "reason": "Git 只读操作"
}
```

**与现有能力的关系**：
- 复用 `API Interceptor` 的拦截能力
- 复用 `GlobalErrorHandler` 的错误处理
- 复用 `HooksEngine` 的事件触发机制
- 复用 `HookChainTracker` 的链路追踪

**验收指标**：
- 支持 prefix/contains/regex/length/cmd-in-cmd 5 种匹配类型
- 支持 all/any/not 三种组合逻辑
- 三种决策：allow / block / prompt
- 规则可启用/禁用/优先级排序
- 完整审计日志（时间戳、命令、决策、原因、规则 ID）
- 40+ 单元测试 + 20+ 组件测试 + 5+ 集成测试

**预估工作量**：600-800 行核心代码 + 250 行 UI + 250 行测试

### 3.3 G26-03: MTC Adapter (More Than Coding)

**业务价值**：扩展 Hermes 平台能力到非编码场景
**技术架构**：
- **核心引擎** `mtcAdapter.ts`：文件类型检测 + 任务路由 + 结果整合
- **类型定义** `mtcAdapterTypes.ts`：FileType/Task/Result 数据模型
- **处理器** `mtcAdapterHandlers.ts`：CSV/JSON/TXT/MD/MARKDOWN 5 种文件处理策略
- **结果整合** `mtcAdapterAggregator.ts`：多任务结果合并、摘要、导出
- **UI 组件** `MTCPanel.tsx`：文件上传 + 任务选择 + 结果预览 + 导出

**支持的任务类型**：
- 总结（Summarize）：提取关键信息
- 翻译（Translate）：中英互译
- 重写（Rewrite）：风格调整
- 分析（Analyze）：数据洞察 + 可视化建议
- 转换（Convert）：CSV → JSON、MD → HTML 等

**支持的输入类型**（前端能力范围内）：
- 文本：`.txt`, `.md`, `.json`
- 数据：`.csv`（轻量解析）
- 代码：`.ts`, `.tsx`, `.js`, `.py`
- 不支持：`.docx`, `.pdf`, `.pptx`, `.xlsx`（二进制文件，提示用户转换）

**与现有能力的关系**：
- 复用 `FileExplorer` 的文件操作
- 复用 `FigmaAdapter` 的多模态架构
- 复用 `MultiModelExecutor` 的模型调用
- 复用 `ComposerPanel` 的导出能力

**验收指标**：
- 支持 5+ 文件类型检测
- 5+ 任务类型全部可用
- 处理时间 < 5 秒（10KB 文件）
- 结果可导出为 JSON / Markdown
- 25+ 单元测试 + 15+ 组件测试 + 5+ 集成测试

**预估工作量**：400-500 行核心代码 + 200 行 UI + 200 行测试

---

## 四、整体收益评估

### 4.1 战略收益

| 维度 | Cycle 26 前 | Cycle 26 后 |
|---|---|---|
| 批处理能力 | 手工任务列表 | CSV 驱动批量扇出（百级工作项） |
| 安全审批 | 简单拦截 | Starlark-lite DSL 细粒度决策 |
| 任务边界 | 编码任务为主 | 编码 + 文档/数据双轨 |
| 用户群体 | 开发者 | 开发者 + 数据分析师 + 产品经理 |
| 与 codex 对齐度 | ~85% | ~92% |
| 与 TRAE 对齐度 | ~85% | ~90% |

### 4.2 技术收益

- **引擎数量**：20+ → 23+（+15%）
- **UI 组件数量**：170+ → 173+（+2%）
- **测试用例数**：预估 +250
- **代码行数**：预估 +2000 行核心 + 1000 行测试

### 4.3 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| CSV 解析兼容性 | 中 | 充分测试 BOM/换行/引号 |
| DSL 设计过度复杂 | 中 | 限制为 5 种基础匹配类型 |
| MTC 任务执行时间 | 中 | 限制文件大小 < 1MB |
| 智能审批误判 | 高 | 缺省全部 prompt，提供 dry-run |
| 测试执行时间增长 | 低 | 单元测试 < 100ms/例 |
| 引擎间循环依赖 | 中 | 严格分层：核心 → 适配 → UI |

---

## 五、迭代计划

### 5.1 Cycle 26 时间线

| 阶段 | 内容 | 交付物 |
|---|---|---|
| Phase 1 (调研) | codex/trae 深度调研 | CYCLE26_CODEX_TRAE_RESEARCH.md ✅ |
| Phase 2 (差距) | 差距分析与优先级 | CYCLE26_GAP_ANALYSIS.md ✅（本文档）|
| Phase 3 (SPEC) | 三大功能详细规格 | 3 份 SPEC 文档 |
| Phase 4 (开发) | 三大引擎 + UI + 测试 | 12-15 个新文件 |
| Phase 5 (UI/UX) | UI 优化 + 快捷键 + 持久化 | UI 增强补丁 |
| Phase 6 (集成) | 端到端集成测试 | cycle26-integration.test.ts |
| Phase 7 (重启) | 迭代日志 + Git 提交 | ITERATION_LOG.md 更新 |

### 5.2 关键里程碑

- **M1**（Phase 3 完成）：3 份 SPEC 文档 + 风险评审
- **M2**（Phase 4 中点）：3 个核心引擎可独立运行
- **M3**（Phase 4 完成）：3 个 UI 组件 + 测试通过率 100%
- **M4**（Phase 6 完成）：集成测试通过，BrandHeader 菜单集成
- **M5**（Phase 7 完成）：Cycle 26 验收报告 + Git 提交

### 5.3 与代码库约束的对齐

- ✅ TypeScript + React + Vite 前端栈
- ✅ 函数必须有完整中文注释
- ✅ 自动化测试覆盖率 ≥ 80%
- ✅ 全局接口变更需走标准流程
- ✅ 任务总结 + 验收报告
- ✅ Git 提交规范

---

## 六、参考文档

- CYCLE26_CODEX_TRAE_RESEARCH.md — 详细技术调研
- CYCLE25_ACCEPTANCE_REPORT.md — 上一个 Cycle 交付参考
- CYCLE25_GAP_ANALYSIS.md — 上一个 Cycle 差距分析参考

---

**结论**：Cycle 26 三大 P0 功能（CSV 批处理 / 智能审批 / MTC 适配器）填补 Hermes 平台三大战略空白，对齐 codex/TRAE 最新能力至 90%+，技术风险可控，预期收益显著。建议立即进入 Phase 3 SPEC 文档编写阶段。
