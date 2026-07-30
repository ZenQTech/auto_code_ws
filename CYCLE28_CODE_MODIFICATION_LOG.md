# Cycle 28 代码修改日志

**周期**：Cycle 28
**版本**：v6.72.0 - v6.76.0
**日期**：2026-07-30
**Git Hash**：待提交
**主题**：Codex Skills / 成本预算 / 用量归因 / 作用域权限 / 斜杠命令面板

---

## 一、修改概述

| 类别 | 新增 | 修改 | 删除 |
|------|------|------|------|
| 源文件 | 25 | 3 | 0 |
| 测试文件 | 11 | 0 | 0 |
| 文档文件 | 4 | 0 | 0 |
| **总计** | **40** | **3** | **0** |

---

## 二、新增文件清单

### 2.1 核心引擎（5 个）

| 文件 | 行数 | 功能 |
|------|------|------|
| [skillTypes.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/skillTypes.ts) | 173 | 技能系统类型定义 + 工具函数（calculateSimilarity/extractTriggerKeywords/truncateDescription/isValidSkillName） |
| [skillBuiltins.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/skillBuiltins.ts) | 175 | 5 个内置技能 SKILL.md 内容（code-review/test-generator/refactor-assistant/doc-generator/security-scanner） |
| [skillEngine.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/skillEngine.ts) | 506 | 技能引擎核心：解析/匹配/调用/启用/禁用/导入/导出/持久化 |
| [costBudgetEngine.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/costBudgetEngine.ts) | 480 | 成本预算引擎：三层预算 + fallback model + 成本计算 + 告警 |
| [usageAttributionEngine.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/usageAttributionEngine.ts) | 280 | 用量归因引擎：多维归因 + 报告生成 + JSON 导出 |
| [scopedPermissionsEngine.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/scopedPermissionsEngine.ts) | 305 | 作用域权限引擎：工具/路径/网络权限 + 继承 |
| [slashCommandEngine.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/slashCommandEngine.ts) | 357 | 斜杠命令引擎：解析/执行/历史/事件 |

### 2.2 UI 组件（5 个）

| 文件 | 行数 | 功能 |
|------|------|------|
| [SkillsPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/SkillsPanel.tsx) | 365 | 技能管理面板：已安装列表 + 匹配测试 + 统计 |
| [CostBudgetPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/CostBudgetPanel.tsx) | 245 | 成本预算面板：总览 + 预算配置 + 模型列表 |
| [UsageAttributionPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/UsageAttributionPanel.tsx) | 197 | 用量归因面板：报告展示 + JSON 导出 + 测试记录添加 |
| [ScopedPermissionsPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ScopedPermissionsPanel.tsx) | 237 | 作用域权限面板：作用域列表 + 创建/查看/删除 |
| [SlashCommandPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/SlashCommandPanel.tsx) | 168 | 斜杠命令面板：命令列表 + 输入执行 + 历史 |

### 2.3 测试文件（11 个）

| 文件 | 测试数 | 覆盖 |
|------|--------|------|
| [skillEngine.test.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/skillEngine.test.ts) | 53 | 解析/匹配/调用/事件/持久化 |
| [costBudgetEngine.test.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/costBudgetEngine.test.ts) | 29 | 预算创建/检查/告警/fallback |
| [usageAttributionEngine.test.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/usageAttributionEngine.test.ts) | 13 | 记录添加/报告生成/导出 |
| [scopedPermissionsEngine.test.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/scopedPermissionsEngine.test.ts) | 24 | 权限创建/检查/继承 |
| [slashCommandEngine.test.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/slashCommandEngine.test.ts) | 22 | 解析/执行/事件 |
| [SkillsPanel.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/SkillsPanel.test.tsx) | 10 | UI 交互 + 渲染 |
| [CostBudgetPanel.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/CostBudgetPanel.test.tsx) | 8 | UI 交互 + 渲染 |
| [UsageAttributionPanel.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/UsageAttributionPanel.test.tsx) | 6 | UI 交互 + 渲染 |
| [ScopedPermissionsPanel.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ScopedPermissionsPanel.test.tsx) | 6 | UI 交互 + 渲染 |
| [SlashCommandPanel.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/SlashCommandPanel.test.tsx) | 9 | UI 交互 + 渲染 |
| [Cycle28E2E.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/Cycle28E2E.test.tsx) | 12 | 端到端集成测试 |

### 2.4 文档文件（4 个）

| 文件 | 内容 |
|------|------|
| [CYCLE28_CODEX_TRAE_RESEARCH.md](file:///home/qizheng/auto_code_ws/CYCLE28_CODEX_TRAE_RESEARCH.md) | Codex/Claude Code/TRAE 2026-07 新特性调研 |
| [CYCLE28_GAP_ANALYSIS.md](file:///home/qizheng/auto_code_ws/CYCLE28_GAP_ANALYSIS.md) | 差距分析 + P0/P1 任务清单 |
| [CYCLE28_SPEC_G28_01_SKILLS.md](file:///home/qizheng/auto_code_ws/CYCLE28_SPEC_G28_01_SKILLS.md) | G28-01 技能系统 SPEC 详细规格 |
| [CYCLE28_ACCEPTANCE_REPORT.md](file:///home/qizheng/auto_code_ws/CYCLE28_ACCEPTANCE_REPORT.md) | 验收报告 |

---

## 三、修改文件清单

### 3.1 [AppLayout.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/AppLayout.tsx)

**修改原因**：透传 5 个新回调给 BrandHeader
**变更点**：
- L109-124: 新增 5 个 prop 声明（onOpenSkillSystem/onOpenCostBudget/onOpenUsageAttribution/onOpenScopedPermissions/onOpenCommandPalette）
- L310, L325: 删除原 Cycle 2 的 onOpenSkills/onOpenSlashCommand 重复定义
- L358-362: 替换为新 prop 名称
- L584-588: BrandHeader 透传 5 个新 prop

**关键代码变更**：
```typescript
// 旧（重复）
onOpenSkills,
onOpenSlashCommand,

// 新
onOpenSkillSystem,
onOpenCostBudget,
onOpenUsageAttribution,
onOpenScopedPermissions,
onOpenCommandPalette,
```

### 3.2 [BrandHeader.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/BrandHeader.tsx)

**修改原因**：添加 5 个新菜单项 + 透传 5 个新 prop
**变更点**：
- L202-211: BrandHeaderProps 接口新增 5 个 prop
- L815-824: 函数解构新增 5 个 prop
- L2033-2091: 新增 5 个菜单项（带 data-testid）

**新增菜单项**：
| 菜单 | 图标 | data-testid |
|------|------|-------------|
| 🎯 技能系统 | target | menu-skill-system |
| 💰 成本预算 | dollar | menu-cost-budget |
| 📊 用量归因 | chart | menu-usage-attribution |
| 🔒 作用域权限 | lock | menu-scoped-permissions |
| ⌨️ 斜杠命令 | command | menu-command-palette |

### 3.3 [App.tsx](file:///home/qizheng/auto_code_ws/frontend/src/App.tsx)

**修改原因**：集成 5 个新面板到主应用
**变更点**：
- 新增 5 个 useState 控制面板开关
- 新增 5 个 handler 函数
- 新增 5 个 ErrorBoundary + 组件渲染

---

## 四、任务完成状态

| 任务 | 状态 | 备注 |
|------|------|------|
| 互联网调研 | ✅ | CYCLE28_CODEX_TRAE_RESEARCH.md |
| 差距分析 | ✅ | CYCLE28_GAP_ANALYSIS.md |
| G28-01 技能系统 | ✅ | 引擎 + UI + 53+10 测试 |
| G28-02 成本预算 | ✅ | 引擎 + UI + 29+8 测试 |
| G28-03 用量归因 | ✅ | 引擎 + UI + 13+6 测试 |
| G28-04 作用域权限 | ✅ | 引擎 + UI + 24+6 测试 |
| G28-05 斜杠命令面板 | ✅ | 引擎 + UI + 22+9 测试 |
| AppLayout 透传 | ✅ | 5 个 prop |
| BrandHeader 菜单 | ✅ | 5 个新菜单项 |
| App.tsx 集成 | ✅ | 5 个面板 |
| TypeScript 检查 | ✅ | 0 错误 |
| 单元测试 | ✅ | 180/180 |
| E2E 集成测试 | ✅ | 12/12 |
| 整体回归测试 | ✅ | 3357/3357 |
| 文档 | ✅ | 4 份文档 |
| Git 提交 | 🔄 | 待执行 |

---

## 五、待提交文件

```
modified:   frontend/src/App.tsx
modified:   frontend/src/components/AppLayout.tsx
modified:   frontend/src/components/BrandHeader.tsx

new file:   CYCLE28_CODEX_TRAE_RESEARCH.md
new file:   CYCLE28_GAP_ANALYSIS.md
new file:   CYCLE28_SPEC_G28_01_SKILLS.md
new file:   CYCLE28_ACCEPTANCE_REPORT.md
new file:   CYCLE28_CODE_MODIFICATION_LOG.md
new file:   frontend/src/utils/skillTypes.ts
new file:   frontend/src/utils/skillBuiltins.ts
new file:   frontend/src/utils/skillEngine.ts
new file:   frontend/src/utils/skillEngine.test.ts
new file:   frontend/src/utils/costBudgetEngine.ts
new file:   frontend/src/utils/costBudgetEngine.test.ts
new file:   frontend/src/utils/usageAttributionEngine.ts
new file:   frontend/src/utils/usageAttributionEngine.test.ts
new file:   frontend/src/utils/scopedPermissionsEngine.ts
new file:   frontend/src/utils/scopedPermissionsEngine.test.ts
new file:   frontend/src/utils/slashCommandEngine.ts
new file:   frontend/src/utils/slashCommandEngine.test.ts
new file:   frontend/src/components/SkillsPanel.tsx
new file:   frontend/src/components/SkillsPanel.test.tsx
new file:   frontend/src/components/CostBudgetPanel.tsx
new file:   frontend/src/components/CostBudgetPanel.test.tsx
new file:   frontend/src/components/UsageAttributionPanel.tsx
new file:   frontend/src/components/UsageAttributionPanel.test.tsx
new file:   frontend/src/components/ScopedPermissionsPanel.tsx
new file:   frontend/src/components/ScopedPermissionsPanel.test.tsx
new file:   frontend/src/components/SlashCommandPanel.tsx
new file:   frontend/src/components/SlashCommandPanel.test.tsx
new file:   frontend/src/components/Cycle28E2E.test.tsx
```

---

## 六、循环日志更新

Cycle 28 完成，准备进入 **Cycle 29**。

**Cycle 29 主题**（待规划）：
- Skills Marketplace
- Cost Analytics Dashboard
- Usage Heatmap
- Permission Request Dialog
- Command History Search

**目标**：继续保持 100% 测试通过率，扩展 Codex/Claude Code 高级能力覆盖。
