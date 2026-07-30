# Cycle 31 启动文档

**周期**：Cycle 31
**日期**：2026-07-30
**主题**：AI 研发协作平台深度进化 - 团队/项目维度治理 + Worktree-as-a-Service + 跨会话学习
**前置周期**：Cycle 30 ✅ 已完成
**状态**：🚀 启动准备

---

## 一、Cycle 30 复盘

### 1.1 完成情况

| 任务 | 状态 | 关键产出 |
|------|------|---------|
| G30-01 CostThresholdAlert | ✅ 完成 | 51 单元测试 + 51 引擎代码 + 1 面板 |
| G30-02 DynamicWorkflow | ✅ 完成 | 36 单元测试 + 1 引擎 + 1 面板 |
| G30-03 OrchestratedAgent | ✅ 完成 | 76 单元测试 + 1 引擎 + 1 面板 |
| 主应用集成 | ✅ 完成 | BrandHeader 3 菜单项 + AppLayout 透传 + App.tsx 渲染 |
| 文档与日志 | ✅ 完成 | 5 份调研/SPEC + 验收报告 + 修改日志 |

### 1.2 关键指标

- 5 个 Git commit 全部成功
- Cycle 30 全部 180 个测试通过
- 全量测试 3727 个 100% 通过
- TypeScript 严格模式 0 错误

---

## 二、Cycle 31 调研方向

### 2.1 调研目标

基于已完成的 30 个 Cycle 经验，下一阶段应聚焦于：

1. **团队/项目维度治理**
   - 多团队成本归因与跨团队结算
   - 项目级 Worktree 隔离策略
   - 团队级权限与配额管理

2. **Worktree-as-a-Service**
   - 云端 Worktree 抽象层
   - 远程 Worktree Backend 适配
   - Worktree 状态同步与冲突检测

3. **跨会话学习**
   - 全局记忆引擎（已实现）的深度应用
   - 候选学习的跨 cycle 推广
   - AI 主动建议的智能化升级

### 2.2 候选调研主题

| 主题 | 优先级 | 调研目标 |
|------|--------|---------|
| Cursor Composer 2.0 | P0 | 多文件并行编辑、Undo Tree、Project Index |
| Codex Multi-Workspace | P0 | 跨 workspace 协同、共享 Memory Layer |
| Claude Code Multi-Repo | P1 | 跨仓库 PR、Monorepo 感知 |
| Trae SOLO 3.0 (预测) | P1 | Loop Engineering 增强、Agent Fleet |
| Codex Agent Marketplace | P1 | 社区 Agent 共享、Skill Federation |
| Linear / Jira 集成 | P2 | 任务编排与开发工作流对接 |

### 2.3 待确认主题

**Cycle 31 主推方向**（候选）：
- A. 团队/项目治理 + Worktree 远程化
- B. Cursor Composer 2.0 对齐
- C. 跨会话学习与 AI 主动建议增强
- D. 继续完善已有功能（Cycle 30 引擎的 UI/UX 优化）

> **建议**：本 Cycle 优先推进 A 方向（团队/项目治理 + Worktree 远程化），这是 Hermes 从"个人开发助手"向"团队研发平台"演进的关键一步。

---

## 三、Cycle 31 任务规划（草案）

### 3.1 P0 任务（候选）

| 任务 | 目标 | 预计产出 |
|------|------|---------|
| G31-01 团队/项目维度成本归因 | 跨团队/项目的成本拆解 | CostAttributionEngine + UI |
| G31-02 远程 Worktree Backend | 云端 Worktree 抽象 | RemoteWorktreeAdapter + UI |
| G31-03 Worktree 状态同步 | 跨设备/跨工作区状态同步 | WorktreeSyncEngine + UI |

### 3.2 集成规划

- BrandHeader：新增 3 个菜单项
- AppLayout：透传 3 个新 prop
- App.tsx：渲染 3 个新面板
- 单元测试：~150+ 测试
- E2E 集成测试：~15+ 测试

### 3.3 文档规划

- CYCLE31_CODEX_TRAE_RESEARCH.md
- CYCLE31_GAP_ANALYSIS.md
- CYCLE31_SPEC_G31_01_COST_ATTRIBUTION.md
- CYCLE31_SPEC_G31_02_REMOTE_WORKTREE.md
- CYCLE31_SPEC_G31_03_WORKTREE_SYNC.md
- CYCLE31_ACCEPTANCE_REPORT.md
- CYCLE31_CODE_MODIFICATION_LOG.md

---

## 四、循环重启机制

### 4.1 循环约束

- 任务范围：基于 Cycle 30 已实现的"企业级成本治理 + 动态工作流 + 多代理编排"基础，向上构建"团队治理 + 远程化"层
- 目标完成标准：功能达到生产可用级别，通过自动化测试且测试通过率 100%
- 提交规范：分多个原子 commit，commit message 包含 cycle 标识

### 4.2 循环工作流

1. **互联网调研阶段**：基于 Cycle 31 调研方向开展深度调研
2. **功能分析与 spec 任务创建阶段**：基于调研结果形成差距分析，创建 SPEC 文档
3. **功能开发与完善阶段**：根据 SPEC 文档编程实现
4. **测试验证阶段**：单元测试 + 组件测试 + E2E 集成测试
5. **UI/UX 优化阶段**：参考主流产品（Cursor、Codex、Trae）优化 UI
6. **验收 + Git 提交 + 循环重启准备**

### 4.3 验收标准

- ✅ 所有 P0 任务完成
- ✅ 所有测试通过（单元 + 组件 + E2E）
- ✅ TypeScript 类型检查 0 错误
- ✅ 主应用集成完成（BrandHeader + AppLayout + App.tsx + ErrorBoundary）
- ✅ 调研/差距分析/SPEC 文档齐备
- ✅ Git commit 历史清晰可追溯

---

## 五、风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 远程 Worktree 涉及网络/认证复杂性 | 初期实现本地适配器 + Mock 远程，接口预留扩展点 |
| 跨团队成本归因可能涉及隐私 | 提供数据脱敏 + 聚合粒度可配置 |
| 跨会话学习的冷启动问题 | 借助 GlobalMemoryEngine 已有数据预热 |
| 调研信息源质量参差 | 严格遵循用户偏好：仅 .gov / .edu / 学术数据库 |

---

## 六、启动检查清单

- [x] Cycle 30 全部任务完成
- [x] Cycle 30 全部测试通过
- [x] Cycle 30 Git 提交完成
- [x] 验收报告与修改日志完成
- [x] 当前工作区干净
- [ ] Cycle 31 调研方向确认（待用户输入）
- [ ] Cycle 31 主推方向确认（待用户输入）

---

## 七、待用户确认

**Cycle 31 启动问题**：

1. **调研方向**：是否同意按 §2.1 调研目标开展（团队/项目治理 + Worktree 远程化 + 跨会话学习）？
2. **主推方向**：是否同意按 §2.3 建议优先推进 A 方向（团队/项目治理 + Worktree 远程化）？
3. **任务数量**：是否维持 P0 = 3 个任务的节奏？

---

**Cycle 31 启动文档结束。等待用户确认后进入正式调研阶段。**
