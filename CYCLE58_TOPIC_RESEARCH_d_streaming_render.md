# CYCLE58 - 主题 d 调研：渐进式呈现（流式输出）

> **调研日期**: 2026-08-03
> **来源**: Codex Realtime V2 + TRAE 实时跟随 + Hermes StreamingBuffer

---

## 1. Codex Realtime V2 流式输出

### 1.1 核心架构
**来源**: https://vibe-coding.academy/blog/cursor-3-claude-code-codex-hybrid-stack-vibe-coding-2026/

```
LLM Provider -> [Realtime V2 Backend] -> [Token Stream] -> [TUI/IDE] -> [渲染]
                  ↓
            [Backpressure Control]
                  ↓
            [Resume Token]
```

**关键特性**：
- 后台 Agent 任务流式增量结果到终端
- 用户可在前台继续工作（不阻塞）
- 增量渲染（incremental render）
- Token 级别增量（不是 chunk 级别）
- 自动背压控制

### 1.2 流式恢复
**2026-07-30**: Browser upgrades 增强
**2026-06-15**: Browser Developer mode 加速 2x
- 错误恢复机制
- 流中断后从上次 token 续传
- 跨网络切换保持流

### 1.3 性能优化
- **CDP and DOM snapshot optimizations**（2026-06-11）：浏览器响应 2x 速度
- **Memory-efficient streaming**：流式不爆内存
- **Backpressure handling**：LLM 输出快于渲染时降速

---

## 2. TRAE 渐进式呈现

### 2.1 编辑器工具
**来源**: https://docs.trae.ai/ide/tool-panels

- 代码生成时**逐行/逐 token**显示
- 完成后自动接受（用户可关闭）
- 可手动编辑或选中发回 AI

### 2.2 文档工具
- 文档生成时实时显示
- 用户可手动修改
- 选中内容可发回 AI

### 2.3 终端工具
- 命令执行过程和结果实时显示
- 选中输出 → "添加到对话" → 发给 AI

### 2.4 浏览器工具
- Web 应用最终成果展示
- "选择元素"模式：点击元素 → 发送给 AI
- 静态文字可直接编辑

---

## 3. Hermes StreamingBuffer 现状

### 3.1 后端实现
**文件**: [backend/app/services/streaming_buffer.py](file:///home/qizheng/auto_code_ws/backend/app/services/streaming_buffer.py)

**已实现**：
- ✅ SQLite 持久化流
- ✅ 顺序 chunk 索引
- ✅ 断点续传（resume_token）
- ✅ TTL 清理

### 3.2 API 端点
**文件**: [backend/app/api/streaming.py](file:///home/qizheng/auto_code_ws/backend/app/api/streaming.py)

- `/api/stream/register`
- `/api/stream/append`
- `/api/stream/subscribe`
- `/api/stream/ack`
- `/api/stream/chunks`
- `/api/stream/resumable`

### 3.3 前端 SSE 重连
**文件**: [frontend/src/hooks/useSSEReconnect.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useSSEReconnect.ts) (23.8k)

- ✅ 自动重连
- ✅ 指数退避
- ✅ 心跳保持

### 3.4 组件
- `MessageBubble` v6.33.0：流式光标
- `CodeBlock`：代码块实时渲染
- `StreamingResponse`：流式响应组件

---

## 4. 三方对比

| 维度 | Codex Realtime V2 | TRAE | Hermes |
|------|-------------------|------|--------|
| 增量粒度 | Token 级别 | 行/token 级别 | Chunk 级别 |
| 断点续传 | ✅ | ❌ | ✅ |
| 后台非阻塞 | ✅ | ✅ | ✅ |
| 背压控制 | ✅ | N/A | ⚠️ 需优化 |
| 浏览器工具 | ✅ | ✅ | PreviewPanel |
| Token 级 | ✅ | ⚠️ | ❌ |

---

## 5. 实施建议

### P0 - Token 级流式（部分已有）
- **Token-by-token 渲染**：替换 chunk 级
- **FlowingCursor 优化**：光标动画
- **Backpressure handling**：LLM 快于渲染时排队

### P1 - 渐进式增强
- **Markdown 渐进式渲染**：分块解析而非整篇
- **代码块占位符**：未渲染完成前显示骨架屏
- **图片懒加载**：流式输出中的图片

### P2 - 性能监控
- **FPS 监控**：流式渲染帧率
- **Token 速率**：tokens/second 显示
