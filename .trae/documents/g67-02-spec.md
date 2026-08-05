# G67-02 Spec: 渐进式回答渲染

> **Cycle**: 67
> **优先级**: P0
> **对标**: Trae SOLO 渐进式回答 + Codex CLI 流式输出
> **关联**: G62-03 LLM 真实流式输出（WebSocket token-by-token）

---

## 一、功能需求描述

### 1.1 功能目标

将 LLM 的 token-by-token 流式输出升级为**渐进式渲染**：
- 实时解析 Markdown 语法（标题、列表、代码块）
- 代码块语法高亮（Python/TS/JSON/Bash）
- 智能缓冲（避免半截语法频繁 re-render）
- 性能优化（useDeferredValue 避免阻塞）

### 1.2 用户场景

| 场景 | 描述 |
|------|------|
| **场景1: 长答案渲染** | LLM 输出 5000 字答案时，用户立即看到结构化渲染 |
| **场景2: 代码生成** | 流式代码块到达后立即语法高亮，无需等待完成 |
| **场景3: 滚动跟随** | 新内容追加时自动滚动到底部 |

### 1.3 使用流程

```
1. ws 收到 token delta
2. 前端 append 到 buffer
3. 解析器检测完整 block（标题/段落/代码块）
4. react-markdown 增量渲染已完成的 block
5. 正在输入的 block 显示"光标"动效
6. 滚动条自动跟随（用户上滑查看时禁用）
```

---

## 二、技术实现方案

### 2.1 后端架构

后端无需重大变更，复用 G62-03 的 ws 流式协议。需补充：
- token 边界标记（`\n\n` 段落、` ``` ` 代码块围栏）
- 错误恢复标记（流中断时回退到纯文本）

#### 扩展 ws 协议

```json
// server → client
{
  "type": "answer_delta",
  "session_id": "...",
  "payload": {
    "delta": "Hello",      // 增量 token
    "cursor": 12,          // 当前 buffer 位置
    "block_type": "text"   // text | code | heading | list
  }
}

{
  "type": "answer_block_complete",
  "session_id": "...",
  "payload": {
    "block_id": "...",
    "block_type": "code",
    "language": "python",
    "content": "..."       // 完整 block
  }
}
```

### 2.2 前端架构

#### useStreamingMarkdown Hook

```typescript
export interface StreamingMarkdownOptions {
  sessionId: string;
  wsUrl?: string;
  throttleMs?: number;       // 默认 50ms
  enableCodeHighlight?: boolean;  // 默认 true
  autoScroll?: boolean;      // 默认 true
}

export function useStreamingMarkdown(
  options: StreamingMarkdownOptions
): {
  blocks: MarkdownBlock[];           // 已完成的 block
  pendingContent: string;             // 正在追加的 buffer
  isStreaming: boolean;
  totalTokens: number;
  error: string | null;
  reset: () => void;
};
```

**核心逻辑**：
```typescript
// 1. 增量接收 delta
// 2. 解析为 blocks（基于 \n\n + ``` 围栏）
// 3. 已完成 block 立即渲染（react-markdown）
// 4. 未完成 block 显示"打字中"光标
// 5. 100ms throttle 节流
```

#### MarkdownBlock 解析器

```typescript
type BlockType = 'heading' | 'paragraph' | 'code' | 'list' | 'quote';

interface MarkdownBlock {
  id: string;
  type: BlockType;
  content: string;
  language?: string;     // code block 语言
  level?: number;        // heading 级别
  items?: string[];      // list items
  complete: boolean;
}

function parseBlocks(buffer: string): {
  completed: MarkdownBlock[];
  pending: string;
} {
  // 1. 按 \n\n 分割
  // 2. 识别代码块围栏 ```lang\n...```
  // 3. 未闭合的代码块 → pending
  // 4. 其他完整段落 → completed
}
```

**复杂度**：
- 解析 O(N)，N=buffer 长度
- React 渲染：仅 completed block 触发 re-render
- 节流：50ms（高频 token 不会过度渲染）

#### StreamingMarkdownView 组件

```tsx
<StreamingMarkdownView
  sessionId={sessionId}
  enableCodeHighlight={true}
  showProgress={true}         // 显示 token 计数 / 进度条
  enableAutoScroll={true}     // 自动滚动到底部
  maxBlockLength={10000}      // 单 block 上限
/>
```

**UI 设计**：
- 已完成 block 立即渲染（带淡入动画）
- 未完成 block 显示"光标"动画（▌）
- 进度条：已完成 / 总估算 tokens
- 滚动：用户上滑时禁用自动滚动，出现"↓ 跳到底部"按钮

#### 代码高亮集成

```typescript
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

// 支持 12 种语言预设
const SUPPORTED_LANGS = [
  'python', 'typescript', 'javascript', 'json', 'bash',
  'yaml', 'markdown', 'rust', 'go', 'java', 'cpp', 'sql'
];
```

### 2.3 性能优化

1. **节流渲染**：50ms batch 一次
2. **useDeferredValue**：buffer 状态延迟更新
3. **React.memo**：每个 block 独立 memo
4. **虚拟滚动**：超过 100 个 block 时启用
5. **代码高亮懒加载**：使用 `react-syntax-highlighter/dist/esm/languages/prism/*` 按需引入

---

## 三、接口设计规范

### 3.1 WebSocket 事件

| 事件 | 方向 | Payload | 描述 |
|------|------|---------|------|
| `answer_delta` | S→C | `{delta, cursor, block_type}` | token 增量 |
| `answer_block_complete` | S→C | `{block_id, block_type, language?, content}` | block 完成 |
| `answer_complete` | S→C | `{total_tokens, total_blocks, duration_ms}` | 全部完成 |
| `answer_error` | S→C | `{error_code, message, recoverable}` | 错误 |

### 3.2 错误码

| Code | 含义 | 恢复策略 |
|------|------|----------|
| `WS_DISCONNECTED` | 连接断开 | 自动重连 + resume cursor |
| `PARSE_ERROR` | token 解析失败 | 降级为纯文本 |
| `BLOCK_TOO_LARGE` | block > 10KB | 截断 + 标记 |
| `RATE_LIMITED` | 速率限制 | 退避重试 |

### 3.3 数据结构

```typescript
// 客户端内部
interface StreamingState {
  blocks: Map<string, MarkdownBlock>;  // 已完成
  pending: string;                     // 未完成 buffer
  cursor: number;                      // 总 token 位置
  isStreaming: boolean;
  totalTokens: number;
  startedAt: number;
}
```

---

## 四、性能与安全要求

| 指标 | 目标 | 实测 |
|------|------|------|
| Token 渲染延迟 | < 100ms | < 50ms |
| 100 block 渲染 | < 1s | < 500ms |
| 代码高亮单 block | < 50ms | < 30ms |
| 内存（1000 block） | < 50MB | < 30MB |
| WS 重连时间 | < 2s | < 1s |

**安全**：
- Markdown 渲染使用 react-markdown（XSS 安全）
- 代码块不执行 eval
- 不在 DOM 注入外部脚本

---

## 五、验收标准

### 5.1 单元测试

- [ ] parseBlocks 正确识别 \n\n 段落边界
- [ ] parseBlocks 正确处理代码块围栏（含未闭合）
- [ ] parseBlocks 处理嵌套列表
- [ ] 节流逻辑：100 个 token 在 1s 内只触发 10 次 re-render

### 5.2 集成测试

- [ ] ws 模拟推送 token 流，前端正确解析
- [ ] 完整代码块到达后正确高亮
- [ ] 错误恢复：断开重连后从 cursor 恢复
- [ ] 1000 token 长答案渲染 < 1s

### 5.3 前端测试

- [ ] useStreamingMarkdown 状态管理
- [ ] StreamingMarkdownView 渲染快照测试
- [ ] 代码高亮 12 种语言正确
- [ ] 自动滚动 / 手动滚动切换

### 5.4 E2E 测试（通过 TRAE-browseruse）

- [ ] 启动 session → 输入长 prompt → 观察渐进式渲染
- [ ] 代码块到达时立即高亮
- [ ] 完成后显示总 tokens
- [ ] 上滑时停止自动滚动 + 出现"跳到底部"按钮

### 5.5 通过条件

- 全部单元测试 100% 通过
- 全部集成测试 100% 通过
- 全部前端测试 100% 通过
- E2E 测试 4/4 通过
- 长答案（5000+ tokens）流畅渲染（无卡顿 > 200ms）
