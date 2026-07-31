# CYCLE44_SPEC

## 主题
**MCP × Hermes × 多模态深度融合**

## 调研背景

### 上一周期成果 (Cycle 43)
- ✅ filesystem / git / fetch 三个真实 MCP 服务器连接
- ✅ 火山方舟 Coding Plan LLM Provider（真实 + Mock）
- ✅ 5 大 E2E 测试场景
- ✅ McpE2EPanel 主应用集成

### 本周期核心问题
Cycle 36 已实现多模态处理器（MultiModalProcessor），但未与 MCP 工具集成。本周期需要：
1. 让 MCP 工具能够处理和返回多模态内容（图像/音频/视频）
2. Agent 推理链中支持多模态输入输出
3. 多模态资源的 URI 解析和缓存
4. 多模态提示词的模板化生成

### 关键风险
| 风险 | 等级 | 缓解 |
|------|------|------|
| 多模态数据体积大 | 中 | base64 压缩 + 懒加载 |
| 模型支持差异 | 中 | 能力声明 + 降级策略 |
| 协议兼容性 | 低 | 复用现有 MCP 协议 |
| 沙箱环境 | 中 | mock 多模态数据 |

---

## 任务清单

### G44-01: 多模态 MCP 工具桥接
**目标**: 扩展 McpToolBridge 支持图像/音频/视频工具结果

**核心交付**:
1. `mcpMultimodalToolBridge.ts` - 多模态工具桥接
2. `mcpMultimodalToolBridge.test.ts` - 工具多模态测试
3. ToolCallResult 扩展 image/audio/file 类型

**核心能力**:
- MCP 工具返回 image 类型 → 转 base64 + MIME 注入 Hermes
- MCP 工具返回 audio 类型 → 波形数据 + 转写文本
- MCP 工具返回 file 类型 → 文件元数据 + 内容预览
- 工具结果自动注入 LLM 多模态上下文

### G44-02: 图像处理 MCP 集成
**目标**: 集成图像处理 MCP 工具（OCR / 描述 / 转换）

**核心交付**:
1. `mcpImageProcessor.ts` - 图像处理工具集
2. `mcpImageProcessor.test.ts` - 图像处理测试
3. 支持 JPEG/PNG/WebP/GIF 输入输出

**核心能力**:
- `image_ocr`: 从图像提取文字（mock + 真实 API 接入）
- `image_describe`: 图像内容描述（mock + 真实 API 接入）
- `image_resize`: 图像尺寸调整
- `image_convert`: 图像格式转换
- `image_to_base64`: 转 base64

### G44-03: 音频处理 MCP 集成
**目标**: 集成音频处理 MCP 工具（ASR / TTS / 转换）

**核心交付**:
1. `mcpAudioProcessor.ts` - 音频处理工具集
2. `mcpAudioProcessor.test.ts` - 音频处理测试
3. 支持 WAV/MP3/OGG 输入输出

**核心能力**:
- `audio_transcribe`: 语音转文字（mock + 真实 API 接入）
- `audio_synthesize`: 文字转语音
- `audio_convert`: 格式转换
- `audio_metadata`: 提取元数据
- `audio_clip`: 音频片段提取

### G44-04: Agent 多模态推理链
**目标**: 端到端多模态 Agent Loop（图像输入 → 工具调用 → 多模态输出）

**核心交付**:
1. `multimodalAgentLoop.ts` - 多模态 Agent 循环
2. `multimodalAgentLoop.test.ts` - 推理链测试
3. McpMultimodalPanel UI 面板

**核心能力**:
- 接收多模态输入（图像/音频/文件）
- 智能路由到对应处理工具
- 多模态上下文压缩（base64 优化）
- 流式多模态响应
- 5 大场景 E2E 测试

---

## 文件结构

```
frontend/src/utils/
├── mcpMultimodalToolBridge.ts       # G44-01 多模态工具桥接
├── mcpMultimodalToolBridge.test.ts
├── mcpImageProcessor.ts             # G44-02 图像处理
├── mcpImageProcessor.test.ts
├── mcpAudioProcessor.ts             # G44-03 音频处理
├── mcpAudioProcessor.test.ts
├── multimodalAgentLoop.ts           # G44-04 多模态 Agent
└── multimodalAgentLoop.test.ts

frontend/src/components/
├── McpMultimodalPanel.tsx           # 多模态面板
└── McpMultimodalPanel.test.tsx
```

---

## 验收标准

### 功能验收
- [x] MCP 工具支持多模态输入输出
- [x] 图像处理工具集（5 个工具）可调用
- [x] 音频处理工具集（5 个工具）可调用
- [x] 多模态 Agent Loop 端到端工作
- [x] 多模态 UI 面板展示图像/音频/文件

### 质量验收
- [x] TypeScript 严格模式 0 错误
- [x] 单元测试 100% 通过
- [x] 沙箱兼容：mock 数据完整
- [x] 多模态数据 base64 压缩 ≥ 30%

### 文档验收
- [x] CYCLE44_ACCEPTANCE_REPORT.md
- [x] CYCLE44_CODE_MODIFICATION_LOG.md
- [x] CYCLE45_STARTUP.md

---

## 沙箱兼容性策略

所有多模态工具实现 **mock + 真实 API 双模式**：
- mock 模式：返回预定义多模态 fixture
- 真实模式：调用 OpenAI Vision API / Anthropic Claude Vision

---

**Cycle 44 启动 - MCP × Hermes × 多模态深度融合** 🚀
