# CYCLE 62 功能差距分析报告

> **生成日期**: 2026-08-04
> **基础**: cycle62-research-report.md
> **范围**: Solo 模式核心功能 + 循环工作流

---

## 一、差距矩阵（vs Codex CLI + Trae SOLO）

| # | 功能 | 优先级 | 状态 | 期望标准 | 实施复杂度 | 备注 |
|---|------|--------|------|----------|------------|------|
| 1 | **多任务并行** | 🔴 P0 | ❌ 缺失 | 支持 ≥4 个并行任务 | 中 | 关键差距，参考 Codex 8 个并行子智能体 |
| 2 | **多源上下文选择器** | 🔴 P0 | ❌ 缺失 | 7 种上下文源（文件/代码/终端/仓库/文档/网页/截图） | 高 | 对标 Trae 工具面板 |
| 3 | **WebSocket 真实流式输出** | 🔴 P0 | 🟡 部分 | LLM token-level 实时推送 | 中 | 当前仅 SSE 模拟 |
| 4 | **AGENTS.md 加载机制** | 🔴 P0 | ❌ 缺失 | 项目级指令自动加载 | 低 | Codex 提速 28.64% |
| 5 | **阶段检测器（PRD/编码/部署）** | 🟡 P1 | ❌ 缺失 | 自动识别 AI 工作阶段 | 中 | Trae 实时跟随依赖 |
| 6 | **文件系统 watch** | 🟡 P1 | ❌ 缺失 | chokidar / inotify 集成 | 中 | Trae 编辑器实时同步 |
| 7 | **Monaco diff viewer** | 🟡 P1 | 🟡 部分 | 多文件 diff + 树形展示 | 中 | 当前 DiffViewer 基础版 |
| 8 | **语音输入** | 🟡 P1 | ❌ 缺失 | Web Speech API 集成 | 低 | 对标 Trae |
| 9 | **Figma 集成** | 🟢 P2 | ❌ 缺失 | 设计稿 → 代码 | 高 | 长期目标 |
| 10 | **部署集成** | 🟢 P2 | ❌ 缺失 | Vercel / Netlify | 高 | 长期目标 |

---

## 二、已对齐功能（无需改动）

| 功能 | 实现位置 | 状态 |
|------|----------|------|
| Vibe Coding 触发机制 | VibeSoloShell + ClaudeCLI Workbench | ✅ |
| Plan-Step 状态机 | PlanExecutor + Goal mode | ✅ |
| 一键回退 | RollbackManager (G61-07) | ✅ |
| 对话流自动折叠 | ConversationFoldingManager (G61-08) | ✅ |
| 自动验证四维度 | StepVerifier (G61-02) | ✅ |
| LLM 摘要生成 | LLMSummaryGenerator (G61-08) | ✅ |
| MCP 集成 | backend/app/api/mcp.py | ✅ |
| 主题系统 | G60-FIX-16 (15 组件) | ✅ |
| Solo Shell | VibeSoloShell v2.1.0 | ✅ |

---

## 三、P0 功能实施计划

### 3.1 多任务并行（G62-01）

**目标**: 支持 ≥4 个 SOLO 任务同时运行

**核心组件**:
- `MultiTaskManager`: 任务调度 + 状态隔离
- `TaskSlot`: 单个任务容器（独立的 plan/executor/状态）
- `TaskTabs`: UI 任务标签页组件
- WebSocket 多路复用: 每个任务独立 channel

**接口设计**:
```python
# 后端
POST /api/multi-task/create       # 创建新任务
GET  /api/multi-task/list         # 列出所有任务
GET  /api/multi-task/{id}/status  # 单个任务状态
POST /api/multi-task/{id}/pause   # 暂停
POST /api/multi-task/{id}/resume  # 恢复
POST /api/multi-task/{id}/cancel  # 取消
WS   /api/multi-task/ws/{id}      # 任务专属 WebSocket
```

**验收标准**:
- 至少 4 个并行任务不互相干扰
- 资源限制：CPU 50% / MEM 1GB / 任务超时 30min
- UI 显示任务标签页 + 状态徽章
- 100% 单元测试覆盖

### 3.2 多源上下文选择器（G62-02）

**目标**: 支持 7 种上下文源

**上下文类型**:
1. 文件（单文件）
2. 文件夹（递归）
3. 代码片段（多选 + 行号范围）
4. 终端输出（最近 N 条）
5. Git 仓库（commit / branch / diff）
6. 文档（Markdown / PDF / URL）
7. 网页（URL + 选择器）

**接口设计**:
```python
POST /api/context/add        # 添加上下文
GET  /api/context/list       # 列出当前 session 上下文
DELETE /api/context/{id}     # 移除上下文
POST /api/context/preview    # 预览上下文内容
```

**前端**: ContextSelector 组件（多 Tab + 拖拽 + 实时预览）

### 3.3 WebSocket 真实流式输出（G62-03）

**目标**: LLM token-level 实时推送

**协议**:
```python
WS /api/llm/stream
# Client → Server
{"type": "start", "prompt": "...", "model": "gpt-4"}
# Server → Client
{"type": "token", "content": "..."}
{"type": "token", "content": "..."}
{"type": "done", "usage": {...}}
```

**前端**: useStreaming Hook + 增量渲染组件

### 3.4 AGENTS.md 加载机制（G62-04）

**目标**: 自动加载项目级指令文件

**实现**:
- 后端: 任务创建时扫描项目根目录
- 加载顺序: `.trae/AGENTS.md` > `AGENTS.md` > `CLAUDE.md` > 默认
- 注入到 system prompt
- 支持热更新（文件变更时自动重载）

---

## 四、风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 多任务并发导致资源耗尽 | 高 | 资源限制 + 任务队列 |
| WebSocket 连接稳定性 | 中 | 心跳检测 + 自动重连 |
| 上下文爆炸（context overflow） | 高 | token 计数 + 自动截断 |
| AGENTS.md 注入 prompt 冲突 | 中 | 分层 system prompt |

---

## 五、下一步

1. 创建 G62-01 spec 任务文档（多任务并行）
2. 创建 G62-02 spec 任务文档（多源上下文）
3. 创建 G62-03 spec 任务文档（WebSocket 流式）
4. 创建 G62-04 spec 任务文档（AGENTS.md）
5. 启动 P0 实施，按依赖顺序：G62-04 → G62-03 → G62-01 → G62-02
