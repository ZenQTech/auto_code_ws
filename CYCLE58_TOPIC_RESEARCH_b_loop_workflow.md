# CYCLE58 - 主题 b 调研：循环工作流设计与实现

> **调研日期**: 2026-08-03
> **调研者**: 总架构师 + MCP 抓取
> **来源**: codex TUI / Goal mode + TRAE 任务管理 + Hermes Loop V7

---

## 1. Codex 的循环与持续运行机制

### 1.1 Goal Mode（v0.519+, 2026-05-21）
**定义**：以目标驱动，可让 Codex 自主工作数小时甚至数天。

**核心特征**：
- 不再是"一次性对话"
- 持续推进目标直到完成或被中断
- 支持 `pause` / `resume`
- 可显示 progress / blocked / usage-limited 状态
- 跨会话保留上下文
- 自动检测子任务失败 → 自动重试

**来源**: 
- https://developers.openai.com/codex/changelog/ (2026-05-21)
- https://chatgpt.com/codex

### 1.2 循环触发条件
1. **显式 Goal mode 启动**：用户在 composer 中 `/goal <objective>`
2. **任务失败重试**：当子任务达到最大重试次数仍失败
3. **沙箱环境完成**：Codex 在沙箱中完成一批操作
4. **用户中断恢复**：用户暂停后恢复
5. **Plan 自动执行**：用户确认 Plan 后，AI 自动执行直到完成

### 1.3 状态管理
- **Local SQLite**：Codex 使用 SQLite 存储会话状态、对话历史、token 活动
- **Resume across reconnects**（2026-06-15）：跨重连保留线程状态
- **Cross-host pairing**（2026-06-15）：跨主机配对保留状态
- **Computer Use locked**（2026-05-21）：Mac 锁定后仍可使用，受限沙箱

### 1.4 异常处理
- **Rate limit reset banking**（2026-06-11）：Plus/Pro 用户可累积 reset
- **Goals resume from blocked/usage-limited**（2026-07-20）：从阻塞状态恢复
- **Fixed task resumption**（2026-07-09）：修复任务恢复
- **PR Chat**（2026-07-09）：PR 聊天中恢复上下文

### 1.5 中断恢复策略
- **Local SQLite 会话持久化** + **重连重试** + **状态机迁移**
- **Usage limits and credit details**（2026-07-06）：任务菜单显示使用限制
- **Stuck thread recovery**（2026-07-06）：修复卡死线程恢复
- **Task handoff between local and remote hosts**（2026-06-18）：本地/远程主机间任务交接

---

## 2. TRAE 的任务管理与并行

### 2.1 任务管理（Task Management）
**来源**: https://docs.trae.ai/ide/manage-tasks

**核心能力**：
- 单项目多任务并行执行
- 突破传统串行任务执行限制
- 任务状态可视化
- 任务优先级管理
- 任务间依赖关系

### 2.2 多任务并行模式
- AI 自主生成多个子任务
- 并行执行（最多 N 个）
- 任务状态实时同步
- 失败任务可重试或回滚

### 2.3 状态展示
- 进行中 / 已完成 / 已暂停 / 失败
- 任务进度百分比
- 预计剩余时间
- 资源占用（CPU/内存/网络）

---

## 3. Hermes Loop V7 现状

### 3.1 已实现
- ✅ 15 步 SOP 完整工作流
- ✅ 阶段化状态机（clarifying → designing → prompting → executing → reviewing）
- ✅ Hook 机制（10 类事件）
- ✅ Git 自动化（per-module worktree + bare remote push）
- ✅ 多 CLI Worker 并行
- ✅ 质量保障 + 批判反思智能体
- ✅ 原子任务清单 + 高风险标记

### 3.2 待加固
- ❌ 持续可见的 Loop 状态机 UI（只有弹窗）
- ❌ 任务并行可视化
- ❌ 中断恢复 UI 入口
- ❌ 长时间运行（数小时-数天）的稳定性保障

---

## 4. 三方对比

| 维度 | Codex Goal mode | TRAE 任务管理 | Hermes Loop V7 |
|------|-----------------|----------------|-----------------|
| 触发 | `/goal` 命令 | 模式切换 | 用户输入需求 |
| 持续时间 | 数小时-数天 | 单次任务 | 完整 15 步 SOP |
| 并行 | 多 sub-agent | 多任务 | 多 CLI Worker |
| 状态展示 | 活动视图 + 进度 | 任务管理面板 | LoopV7Runner 弹窗 |
| 中断恢复 | 跨会话/跨主机 | 任务暂停/恢复 | Hook + SQLite |
| 异常处理 | Rate limit / Stuck recovery | 失败重试 | Hook + 自动重提 |

---

## 5. 实施建议

### P0 - Loop Engineering 状态机持续可见 UI
- **LoopStatusBar**：顶部持续可见的状态条
- **LoopStateMachineView**：可视化状态机迁移
- **`/loop status` / `/loop pause` / `/loop resume`** 命令

### P1 - 多任务并行 UI
- **ParallelTasksPanel**：并行任务面板
- **TaskDependencyGraph**：任务依赖图

### P2 - Goal mode 完整支持
- 长时间运行优化（资源限制 / 自动保存点 / 跨重启恢复）
- 用户可控的目标追踪
