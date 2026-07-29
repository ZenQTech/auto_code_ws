# Cycle 18 功能差距分析（Gap Analysis）

> **日期**: 2026-07-29
> **Cycle**: Cycle 18
> **基于**: CYCLE17_RESEARCH_REPORT.md + CYCLE17_GAP_ANALYSIS.md
> **目标**: 识别 Cycle 17 后剩余的 P1 差距，制定 Cycle 18 任务计划

---

## 一、差距总览

| 编号 | 差距名称 | 优先级 | 影响范围 | 工作量 |
|---|---|---|---|---|
| G18-01 | @ 引用类型扩展（@codebase / @git / @diff） | P1 | Composer 引擎 | 3 人天 |
| G18-02 | 项目级 AI 规则系统（.hermesrules 风格） | P1 | Composer 引擎 + 后端 | 4 人天 |
| G18-03 | Self-Summarization 长 session 控制 | P1 | Composer 引擎 | 3 人天 |

---

## 二、详细差距分析

### G18-01: @ 引用类型扩展（P1）

**现状**:
- 已实现：@file / @folder / @code / @docs / @web（5 种）
- 缺少：@codebase（语义搜索）/ @git（git 历史）/ @diff（差异引用）

**期望**:
- @codebase - 语义搜索整个代码库（隐式 + 显式）
- @git - 引用 git 历史（commits / branches / blame / current changes）
- @diff - 引用未提交或已提交的 diff

**技术方案**:
```
1. 扩展 parseReferences 正则表达式
2. 新增 ContextSource 抽象：
   - FileContextSource（已存在）
   - CodebaseContextSource（语义搜索 + LRU 缓存）
   - GitContextSource（git log/blame API）
   - DiffContextSource（unified diff 解析）
3. 后端 API：
   - POST /api/search/semantic（codebase 向量检索）
   - GET /api/git/history?file=...&limit=20
   - GET /api/git/diff?ref=...&base=...
4. 前端 resolvers：异步解析 + 进度展示
```

**验收标准**:
- 单元测试 ≥ 12 个（parseReferences + 4 种 resolver）
- 集成测试 ≥ 4 个（端到端引用解析 + 注入）
- E2E 断言 ≥ 8 个

**工作量**: 3 人天

---

### G18-02: 项目级 AI 规则系统（P1）

**现状**:
- 仅有 AGENTS.md 静态规则（人工阅读）
- 缺少项目级 AI 行为定制
- AI 不知道项目的代码风格、安全约束、命名规范

**期望**:
- 用户可在项目根目录创建 `.hermesrules.yaml` / `.cursorrules`
- AI 在处理该项目时自动加载并应用规则
- 规则支持：type_safety / error_handling / framework / import_order / naming / testing
- 5 套预置模板：TypeScript Strict / Python PEP8 / React Best / Vue Best / Generic

**技术方案**:
```
1. 新增 HermesRules schema（zod 定义）
2. 后端：
   - GET /api/projects/{id}/rules（读取）
   - PUT /api/projects/{id}/rules（更新）
   - POST /api/projects/{id}/rules/validate（验证）
3. 前端：
   - RulesEditor 模态（可视化编辑 + 实时预览）
   - RulesTemplates 模板选择
   - Composer 集成：发送 prompt 时附加 rules 上下文
4. 规则注入：system prompt 中插入 rules 摘要
```

**验收标准**:
- 后端单测 ≥ 10 个
- 前端单测 ≥ 12 个
- E2E 断言 ≥ 6 个

**工作量**: 4 人天

---

### G18-03: Self-Summarization 长 session 控制（P1）

**现状**:
- Composer 长 session context 持续累积
- 超过窗口后需要丢弃早期信息
- 缺少渐进式摘要机制

**期望**:
- 类似 Cursor Composer 1.5 自动摘要
- context tokens 超过阈值时自动生成摘要
- 保留关键信息：edit 历史、context 概要、决策点
- 摘要插入到 prompt 头部
- 用户可手动触发"立即摘要"

**技术方案**:
```
1. ComposerEngine 新增 summarize() 方法
2. 触发条件：context tokens > 8000
3. 摘要内容：
   - edits 概要（已接受/拒绝/待定）
   - context 概要（已使用文件/符号/文档）
   - 决策点（用户接受的关键修改）
4. 摘要策略：分层摘要（最近 N 条原文 + 之前的摘要）
5. 摘要注入：作为 system message 前置
6. 摘要历史：可展开查看历史摘要链
```

**验收标准**:
- 单元测试 ≥ 10 个（summarize 算法 + 触发逻辑 + 注入）
- 集成测试 ≥ 4 个
- E2E 断言 ≥ 6 个

**工作量**: 3 人天

---

## 三、Cycle 18 任务清单

### P1（应做，目标 ≥ 90% 完成）

| 任务 | 关联 Spec | 工作量 |
|---|---|---|
| G18-01: @ 引用扩展 | CYCLE18_SPEC_REFERENCES.md | 3 人天 |
| G18-02: 项目级 AI 规则 | CYCLE18_SPEC_PROJECT_RULES.md | 4 人天 |
| G18-03: Self-Summarization | CYCLE18_SPEC_SUMMARIZATION.md | 3 人天 |

---

## 四、风险评估

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| 语义搜索性能 | 中 | 向量索引 + LRU 缓存 + 异步加载 |
| Git API 兼容性 | 中 | 兼容 local/remote/sparse 三种模式 |
| 摘要质量 | 中 | 多 prompt 优化 + 保留原文回退 |
| 规则文件解析失败 | 低 | 严格 zod 验证 + 错误降级 |

---

## 五、依赖关系

```
G18-01 引用扩展（独立）
G18-02 项目规则（独立）
G18-03 Self-Summarization（依赖 G18-01 的 context 抽象）
```

执行顺序：G18-01 → G18-02 → G18-03

---

**更新日期**: 2026-07-29
**负责人**: Hermes AI Agent
**下一步**: 创建 3 个 P1 Spec 文档
