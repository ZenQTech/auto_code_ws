# Code Modification Log - Cycle 67

## Cycle 67: 思考过程实时可视化 + 渐进式回答渲染 (G67-01/02)

> 对标 Codex PR #6006 reasoning stream + Trae SOLO 实时回答流渲染

### 修改概述

- **G67-01 思考过程实时可视化**：后端实现 ThinkingStreamService 管理 LLM 推理步骤生命周期，前端 useThinkingStream Hook + ThinkingStreamView 组件实时可视化
- **G67-02 渐进式回答渲染**：前端 useStreamingMarkdown Hook 按块级解析流式 Markdown，StreamingMarkdownView 组件渐进式渲染并支持代码高亮
- **EmbeddedTools 集成**：新增 `thinking` 和 `stream` 两个 Tab (12→14 tabs)

### 文件变更清单

#### 后端新增 (3)

| 文件 | 行数 | 说明 |
| --- | --- | --- |
| `backend/app/services/thinking_stream.py` | ~520 | 思考流服务：步骤生命周期管理、LRU 淘汰、订阅机制、并发锁 |
| `backend/app/api/thinking.py` | ~250 | 思考流 REST API：列表/当前/统计/导出/清空 |
| `backend/tests/test_thinking_stream.py` | ~450 | 思考流服务单元测试（28 用例） |
| `backend/tests/test_thinking_api.py` | ~330 | 思考流 API 测试（29 用例） |

#### 后端修改 (2)

| 文件 | 说明 |
| --- | --- |
| `backend/app/services/agent_role_models.py` | 扩展 Hook 事件类型，新增 `THINKING_START/DELTA/END` |
| `backend/app/main.py` | 注册思考流 API 路由 |

#### 前端新增 (6)

| 文件 | 行数 | 说明 |
| --- | --- | --- |
| `frontend/src/hooks/useThinkingStream.ts` | ~430 | 思考流 Hook：状态管理 + WebSocket 订阅 + REST 加载 |
| `frontend/src/hooks/useThinkingStream.test.ts` | ~440 | Hook 单元测试（14 用例） |
| `frontend/src/hooks/useStreamingMarkdown.ts` | ~390 | 流式 Markdown Hook：块级解析 + 节流 + 错误恢复 |
| `frontend/src/hooks/useStreamingMarkdown.test.ts` | ~310 | Hook 单元测试（20 用例） |
| `frontend/src/components/ThinkingStreamView.tsx` | ~480 | 思考流视图组件：当前步骤 + 历史 + 统计 + 导出 |
| `frontend/src/components/ThinkingStreamView.test.tsx` | ~370 | 组件测试（19 用例） |
| `frontend/src/components/StreamingMarkdownView.tsx` | ~420 | 流式 Markdown 视图：自动滚动 + 代码高亮 + 进度条 |
| `frontend/src/components/StreamingMarkdownView.test.tsx` | ~340 | 组件测试（17 用例） |

#### 前端修改 (2)

| 文件 | 说明 |
| --- | --- |
| `frontend/src/components/EmbeddedTools.tsx` | v1.5.0：新增 `thinking` 和 `stream` Tab（12→14），导入新增组件 |
| `frontend/src/__tests__/EmbeddedTools.test.tsx` | 同步更新 tab 数量断言（12→14） |

### 核心算法

#### 1. 思考步骤 LRU 淘汰

```
触发：session 内步骤数达到 MAX_STEPS_PER_SESSION (50)
操作：淘汰最旧 step，从 _step_map 中移除
复杂度：O(1)（使用 deque + dict）
```

#### 2. 块级 Markdown 解析

```
输入：累积的 buffer 字符串
算法：状态机扫描，遇 ```xxx 开始/结束代码块，遇 \n\n 段落分隔
输出：{ completed: Block[], pending: string }
复杂度：O(n)（n = buffer 长度）
```

#### 3. WebSocket 增量节流

```
触发：收到 thinking_delta 事件
操作：写入 pendingDeltaRef，按 throttleMs (默认 50ms) 合并推送
目的：避免高频 delta 导致 React 重渲染卡顿
```

### 数据结构

```typescript
// 思考步骤
interface ThinkingStep {
  step_id: string;
  session_id: string;
  agent_id: string;
  step_index: number;
  model: string;
  content: string;
  status: 'running' | 'completed' | 'failed';
  started_at: number;
  ended_at?: number;
  tokens: number;
  summary: string;
  metadata: Record<string, any>;
}

// Markdown 块
interface MarkdownBlock {
  id: string;
  type: 'code' | 'heading' | 'paragraph' | 'list' | 'table' | 'hr';
  content: string;
  language?: string;
  level?: number;
  complete: boolean;
  tokens: number;
}
```

### 接口规范

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/thinking/{session_id}` | 列出 session 所有思考步骤（最多 200 条） |
| GET | `/api/thinking/{session_id}/current` | 获取当前运行中的步骤 |
| GET | `/api/thinking/{session_id}/stats` | 思考统计（步骤数、tokens、耗时） |
| GET | `/api/thinking/{session_id}/export?format=json\|markdown` | 导出（JSON / Markdown） |
| DELETE | `/api/thinking/{session_id}` | 清空 session 所有步骤 |

### 测试结果

#### 后端 (57 用例)

- `tests/test_thinking_stream.py` — 28/28 PASS
- `tests/test_thinking_api.py` — 29/29 PASS

#### 前端 (102 用例)

- `useThinkingStream.test.ts` — 14/14 PASS
- `useStreamingMarkdown.test.ts` — 20/20 PASS
- `ThinkingStreamView.test.tsx` — 19/19 PASS
- `StreamingMarkdownView.test.tsx` — 17/17 PASS
- `__tests__/EmbeddedTools.test.tsx` — 32/32 PASS（更新 12→14 断言）

**总计：159 用例 100% 通过**

### Bug 修复记录

1. **regex→pattern deprecation**：`app/api/thinking.py:182` 使用 `pattern=` 替换 `regex=` (FastAPI/Pydantic 2.x 兼容)
2. **测试环境缺失**：4 个新测试文件均添加 `// @vitest-environment happy-dom` 头部声明
3. **EmbeddedTools tab 断言**：原 12 tabs 断言更新为 14 tabs（新增 thinking/stream）

### 任务完成状态

| 任务 | 状态 |
| --- | --- |
| G67-01 思考过程实时可视化 | ✅ 完成 |
| G67-02 渐进式回答渲染 | ✅ 完成 |
| EmbeddedTools 集成 (12→14 tabs) | ✅ 完成 |
| 后端测试 100% 通过 | ✅ 57/57 |
| 前端测试 100% 通过 | ✅ 102/102 |
| 接口设计规范 | ✅ REST API + WebSocket 双通道 |

### 下一周期 (Cycle 68) 候选任务

- G68-01: Agent 多轮对话上下文压缩（ContextCompactor 服务）
- G68-02: 工具调用链路追踪（ToolCallTrace + 可视化时序图）
- G68-03: Session 导出与回放（Export & Replay）
- G68-04: 提示词模板市场（Prompt Marketplace）
