# CYCLE 68 功能差距分析报告

> **生成日期**: 2026-08-05
> **基础**: codex-trae-solo-research.md (803 行) + Cycle 67 增量分析
> **范围**: 项目代码库索引 + 多文件原子编辑 + 真实 LLM 思考流集成

---

## 一、互联网调研总结

### 1.1 项目代码库索引（Codex rg + Trae BM25+Embedding）

**Codex 实现**（来源：`codex-rs` 内部 `project_index` 模块）：
- 使用 `ripgrep` 增量扫描文件
- 维护文件清单 + 关键符号索引
- 每次 session 启动时 lazy-build

**Trae 实现**：
- 混合 BM25 + Embedding 双索引
- 文件级 + 符号级双粒度
- 实时监听 FS 变化增量更新

**技术架构要点**：
- 索引结构：文件元数据 + 符号提取 + 语义向量
- 查询接口：`search(query, top_k=20)` + `get_file_context(path, line_range)`
- 性能：单 session 索引 <5s，查询 <100ms
- 增量更新：FS Watch → invalidate → rebuild

### 1.2 多文件原子编辑（Codex apply_patch V4A）

**Codex V4A Grammar**（来源：[openai/codex apply_patch.rs](https://github.com/openai/codex)）：
```
*** Begin Patch
*** Update File: path/to/file.py
@@
 context line
-removed line
+added line
*** End Patch
```

**关键特性**：
- 单次 patch 操作多个文件
- 原子性：要么全部应用，要么全部回滚
- Lark grammar 解析
- 增量 hash 验证（避免误改）

**Trae 实现**：
- AST-aware 编辑（tree-sitter）
- Transactional 提交
- Conflict detection before apply

### 1.3 真实 LLM 思考流集成

**关键设计原则**：
- **数据采集点**：LLM streaming response 的 `reasoning_content` 字段
- **事件协议**：OpenAI-compatible `delta.reasoning` token
- **持久化**：每个 step 独立记录（start/delta/end）
- **断点续传**：失败后从最近 step 恢复

---

## 二、当前项目功能差距

### 2.1 已有能力

| 能力 | 实现位置 | 状态 |
|------|---------|------|
| WebSocket 流式 token 推送 | `g62-03` HermesService + ws | ✅ |
| 多源上下文选择器 | `g62-02` ContextSelector | ✅ |
| Hook 事件总线 | SubagentStart/PreToolUse/PostToolUse | ✅ |
| 思考流服务 | `g67-01` ThinkingStreamService | ✅（但未连真实 LLM） |
| Streaming Markdown | `g67-02` useStreamingMarkdown | ✅ |
| FS Watch | `filesystem_watcher.py` | ✅ |
| Sandbox 工具调用 | `sandbox_manager.py` | ✅ |
| Context Manager | `context_manager.py` | ✅ |
| Compaction | `compaction.py` + `compaction_dual.py` | ✅ |
| Plan Mode | `plan_mode.py` + `PlanExecutorPanel` | ✅ |
| Snapshot | `g66-02` SnapshotPanel | ✅ |
| Session Rollout | `rollout_jsonl.py` + `session_rollout_service.py` | ✅ |

### 2.2 缺失能力（Cycle 68 目标）

#### G68-01 项目代码库索引 ❌
- **后端服务**：`CodebaseIndexer` 缺失
- **索引结构**：仅 `multi_context.py` 做基础文本搜索，无符号/向量索引
- **查询接口**：无 `search(query, top_k)` REST API
- **前端组件**：`<CodebaseSearchPanel />` 缺失
- **性能**：每次查询扫描全文件，O(n) 复杂度

#### G68-02 多文件原子编辑 (apply_patch) ❌
- **统一接口**：`apply_patch(v4a_grammar)` API 缺失
- **多文件事务**：当前 `file_storage.py` 仅支持单文件
- **冲突检测**：无 apply 前 hash 校验
- **回滚支持**：失败时无法原子回滚
- **前端组件**：`<ApplyPatchModal />` 缺失

#### G68-03 真实 LLM 思考流集成 ⚠️
- **数据采集点**：`agent_runner.py` 未触发 THINKING_* 事件
- **OpenAI-compatible**：`reasoning_content` 字段未提取
- **端到端验证**：仅单元测试，未与真实 LLM 联调

### 2.3 风险评估

| 模块 | 风险等级 | 理由 |
|------|---------|------|
| CodebaseIndexer | 中 | 文件 IO + 索引构建阻塞主线程 |
| apply_patch 解析 | 高 | Lark grammar 解析错误导致全文件损坏 |
| 真实 LLM 集成 | 中 | API 配额 + 流式中断处理 |

---

## 三、技术选型

### 3.1 G68-01 项目代码库索引

- **后端**：`CodebaseIndexer` 服务
  - 文件元数据索引（path/size/mtime/hash）
  - 符号提取（轻量正则，避免 tree-sitter 依赖）
  - 文本搜索（基于已有 `multi_context` 复用）
  - FS Watch 增量更新（复用 `filesystem_watcher.py`）
- **API**：
  - `GET /api/codebase/search?q=xxx&top_k=20`
  - `GET /api/codebase/file?path=xxx&line_start=&line_end=`
  - `GET /api/codebase/stats`
- **前端**：`<CodebaseSearchPanel />` + `useCodebaseSearch` Hook
- **性能**：单 session 索引 <5s，查询 <200ms

### 3.2 G68-02 多文件原子编辑 (apply_patch)

- **后端**：`ApplyPatchService`
  - V4A grammar 解析（简化版，避免 Lark 依赖）
  - 事务性应用：先校验所有文件 hash，全部成功再 commit
  - 失败回滚：恢复到初始状态
  - 与现有 `file_storage.py` + `snapshot_store.py` 集成
- **API**：
  - `POST /api/apply-patch` 接受 V4A grammar 字符串
  - `POST /api/apply-patch/preview` 预览（不应用）
  - `POST /api/apply-patch/validate` 校验语法
- **前端**：`<ApplyPatchModal />` + 实时 diff 预览
- **集成**：在 `claude_cli.py` 中替换文件写入为 `apply_patch`

### 3.3 G68-03 真实 LLM 思考流集成

- **数据源**：`agent_runner.py` LLM 流式响应
- **事件触发**：检测到 `reasoning_content` 字段时触发 THINKING_DELTA
- **协议扩展**：`agent_role_models.py` 新增 `REASONING_DELTA` 事件
- **端到端测试**：使用 mock LLM + 真实思考流服务

---

## 四、本轮 P0 任务

### G68-01 项目代码库索引
- **影响**：高 - Vibe Coding 上下文感知核心
- **工时**：约 400 行后端 + 350 行前端 + 200 行测试
- **风险**：中 - 大项目性能

### G68-02 多文件原子编辑 (apply_patch)
- **影响**：高 - Claude Code CLI 集成关键
- **工时**：约 500 行后端 + 400 行前端 + 250 行测试
- **风险**：高 - 文件损坏风险

### G68-03 真实 LLM 思考流集成
- **影响**：中 - 完善 G67-01 端到端
- **工时**：约 150 行后端微调 + 100 行测试
- **风险**：低 - 已有服务基础

---

## 五、对标完成度

| 功能 | Codex | Trae | 本项目 Cycle 68 后 |
|------|-------|------|-------------------|
| 代码库索引 | ✅ rg+glob | ✅ BM25+向量 | ✅ G68-01 |
| 多文件原子编辑 | ✅ V4A | ✅ AST-aware | ✅ G68-02 |
| 思考流真实 LLM | ✅ OpenAI | ✅ 流式 | ✅ G68-03 |
| FS Watch 增量 | ✅ | ✅ | ✅ 已有 |
| 回滚/快照 | ✅ | ✅ | ✅ 已有 |

**完成度估算**：Cycle 68 后从 92% → 95%
