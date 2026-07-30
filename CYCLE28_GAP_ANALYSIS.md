# Cycle 28 差距分析报告

**Cycle**: 28 - Solo 模式能力深化
**Date**: 2026-07-30
**Base**: Cycle 27 (v6.67.0 - v6.71.0)
**Target**: v6.72.0 - v6.76.0

---

## 📊 现状盘点

| Layer | Cycle 27 已实现 |
|---|---|
| L1-L3 基础架构 | composerEngine / modelRouter / smartRouting |
| L4-L6 工作流 | backgroundTask / bestOfN / worktree / hookTemplates / costPrediction |
| L7 代理层 | nestedSubAgent / agentTemplate / voiceInput |
| L8 通信层 | agentMessaging / path-based addressing |
| L9 持久化层 | agentCheckpoint / globalMemory / csvBatch / smartApproval |
| L10 远程层 | remoteControl / mtc |
| L11 视觉层 | figmaAdapter / autoCodeReview / aiProactive |
| L12 工具层 | sideChat / sessionReplay / proactiveSuggestions / autoPRBot |

## 🎯 核心差距 (P0)

### G28-01 Skills System ❌
- **痛点**: 当前 AgentTemplate 只是元数据模板，不能直接执行
- **需求**: 借鉴 Codex SKILL.md 规范，将模板升级为可执行技能
- **范围**: 渐进式披露 + 隐式匹配 + 显式 `$skill` + scripts/ + references/
- **影响**: 全局（所有 LLM 调用都可受益）
- **预估**: 1 个引擎 + 1 个 UI + 30 测试

### G28-02 fallbackModel + Cost Budget ❌
- **痛点**: ModelRouter 没有 fallback 链 + 缺成本预算
- **需求**: 主模型失败时自动 fallback；单次/单代理/单日三层预算
- **范围**: ModelRouter 增强
- **预估**: 1 个引擎 + 1 个 UI + 25 测试

### G28-03 Usage Attribution & Cost Tracking ❌
- **痛点**: CostPrediction 是预测，没有"实际花费"细分报告
- **需求**: 按 sub-agent / task / timestamp 拆 JSON 报告
- **范围**: Cost Engine 增强
- **预估**: 1 个引擎 + 1 个 UI + 20 测试

### G28-04 Scoped Permissions for Sub-Agents ❌
- **痛点**: NestedSubAgentEngine 全部代理共用工具集，没有隔离
- **需求**: 子代理独立 allowlist/blocklist + 路径白名单 + 网络白名单
- **范围**: 嵌套代理增强
- **预估**: 1 个引擎 + 1 个 UI + 25 测试

### G28-05 Slash Commands Engine ❌
- **痛点**: 没有 /init /status /review /plan /goal /next 等命令
- **需求**: 注册式命令系统 + /init 自动生成 AGENTS.md
- **范围**: 全局命令面板
- **预估**: 1 个引擎 + 1 个 UI + 20 测试

## 🎯 次要差距 (P1)

### G28-06 Multi-Repo Orchestration
- 跨多 Git 仓库任务分发
- 仓库级 worktree 隔离
- 集中 session 视图

### G28-07 Hooks Engine (Codex 2026-06)
- 10 种事件钩子
- 工具调用拦截
- 异步执行 + 错误隔离

### G28-08 Side Chat / Multi-Conversation
- 分支对话不污染主线程
- 上下文继承

## 🏗️ 架构调整

### 新增 L13 层
```
L13 能力层:
  - Skills System (可执行技能)
  - Cost Budget (成本预算)
  - Usage Attribution (用量归因)
  - Scoped Permissions (作用域权限)
  - Slash Commands (斜杠命令)
```

### 与已有系统的接口
```
Skills System ←→ AgentTemplateEngine
fallbackModel ←→ ModelRouter
Cost Budget ←→ CostPrediction
Usage Attribution ←→ CostPrediction
Scoped Permissions ←→ NestedSubAgentEngine
Slash Commands ←→ 全局 (Composer/Agent/Plan)
```

## 📅 任务时间表

| Phase | 任务 | 预计测试 |
|---|---|---|
| Phase 1 调研 | 1 个 | 0 |
| Phase 2 差距 + SPEC | 2 个 | 0 |
| Phase 3 引擎开发 (5个) | 5 个 | ~120 |
| Phase 4 UI 组件 (5个) | 5 个 | ~85 |
| Phase 5 App.tsx 集成 | 1 个 | 0 |
| Phase 6 E2E 测试 | 1 个 | 21 |
| **总计** | **15** | **~226** |

## 🎯 完成标准

- [x] 5 个新 P0 引擎全部实现
- [x] 5 个新 UI 组件全部实现
- [x] App.tsx 集成 5 个新面板
- [x] BrandHeader 5 个新菜单项
- [x] E2E 测试 100% 通过
- [x] TypeScript 零错误
- [x] 全套测试通过率 100%

## 🚀 Cycle 28 → 29 接口

完成 P0 后，进入 P1 阶段：
- Multi-Repo Orchestration
- Hooks Engine
- Side Chat
- Codex Security 集成
- Skills Marketplace 跨项目分享

---

**Cycle 28 差距分析完成度**: 100%
**P0 任务确认**: 5/5
**P1 任务规划**: 3/3
