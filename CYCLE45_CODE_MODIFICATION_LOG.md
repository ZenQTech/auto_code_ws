# Cycle 45 代码修改日志

## 周期信息

- **周期**：Cycle 45
- **方向**：MCP × Hermes × RAG 知识库深度融合
- **时间**：2026-07-31
- **任务**：G45-01 / G45-02 / G45-03 / G45-04

## 完成度

| 任务 | 状态 | 提交 |
|------|------|------|
| G45-01 MCP × RAG 融合引擎核心 | ✅ 完成 | fdd4dc2 |
| G45-02 MCP 资源作为 RAG 知识库 | ✅ 完成 | b8cb7e8 |
| G45-03 MCP 工具作为 RAG 检索源 | ✅ 完成 | 1b38853 |
| G45-04 Agent RAG 增强循环 + UI 面板集成 | ✅ 完成 | 8588c06 / 2714f0d |

## 修改详情

### 1. mcpRagEngine.ts (G45-01 + G45-02 增强)

**新增内容**：
- `IndexResourceOptions.preloadedContent`: 支持预加载内容跳过 bridge
- `indexResource()` 双重解析路径（preloaded / bridge）
- `retrieveViaTool()` 工具结果作为临时 RAG 文档
- `assembleContext()` 上下文组装（含来源标记）
- `defaultSystemPrompt()` 默认系统提示词
- `buildUserPrompt()` 用户消息构造

**类型扩展**：
- `IndexResourceOptions` 新增 `preloadedContent` 字段
- `McpRagEngineStats` 完整统计

### 2. mcpRagKnowledgeBase.ts (G45-02)

**核心类**：
- `McpRagKnowledgeBase` 主类
  - 加载器管理（registerLoader / unregisterLoader / getLoaders / selectLoader）
  - 文件索引（addFile / removeFile / clearAllFiles）
  - 目录索引（indexDirectory + 并发 + 进度回调）
  - 搜索（search + 过滤 + 评分）
  - 持久化（export / import / toJSON / fromJSON）
  - 变更检测（detectChanges）
  - 统计（getStats / listFiles / getFile）

**加载器**：
- `CodeLoader`: 支持 .ts/.js/.py/.go/.rs/.java 等
- `KnowledgeBaseMarkdownLoader`: .md
- `KnowledgeBaseJSONLoader`: .json
- `KnowledgeBaseHTMLLoader`: .html
- `KnowledgeBaseTextLoader`: .txt

**类型**：
- `KnowledgeBaseDocumentLoader` 接口
- `IndexedFileInfo` 文件元数据
- `DirectoryIndexResult` 索引结果
- `KnowledgeBaseSearchResult` 搜索结果
- `KnowledgeBaseStats` 统计
- `KnowledgeBaseSnapshot` 持久化快照
- `ChangeReport` 变更报告

### 3. mcpToolRagSource.ts (G45-03)

**核心类**：
- `McpToolRagSource` 主类
  - 缓存管理（TTL + LRU + 按 server 失效）
  - 工具调用（callTool + 类型推断 + JSON 解析）
  - 检索（retrieve + 并发 + 进度 + 临时文档管理）
  - 清理（cleanupAll + getActiveTempDocCount）
  - 统计（getStats + listCache）

**工具函数**：
- `inferContentKind(text, args)`: 内容类型自动推断
- `hashArgs(args)`: 参数哈希（用于缓存键）
- `hashText(text)`: 文本哈希
- `extractToolResultText(rawContent)`: 提取工具结果文本

**类型**：
- `McpToolResult` 工具结果
- `McpToolRagSourceOptions` 源选项
- `McpToolSourceRetrieveOptions` 检索选项
- `McpToolSourceRetrieveResult` 检索结果
- `McpToolRagSourceEvent` 事件类型
- `McpToolRagSourceStats` 统计
- `ToolContentKind` 内容类型枚举

### 4. mcpRagAgent.ts (G45-04)

**核心类**：
- `McpRagAgent` 主类
  - 决策引擎（decide + URL / fetch / query / list 意图检测）
  - 执行流程（analyzing → retrieving-resources → retrieving-tools → assembling → generating → done）
  - Fallback 机制（LLM 不可用时使用摘要）
  - 步骤记录（steps[]）
  - 统计（getStats + resetStats）

**类型**：
- `RagDecision` 决策类型
- `McpRagAgentOptions` 选项
- `McpRagAgentStep` 步骤
- `McpRagAgentResult` 结果
- `McpRagAgentEvent` 事件
- `McpRagAgentStats` 统计
- `AgentPhase` 阶段枚举

### 5. McpRagPanel.tsx (G45-04 UI)

**结构**：
- 4 Tab 布局（智能对话 / 资源索引 / 工具检索 / 历史记录）
- 决策策略选择（auto / resource-only / tool-only / hybrid）
- 实时统计栏
- 完整执行步骤可视化
- 资源命中 / 工具调用 / 引用分块展示

**Props**：
- `onClose: () => void`
- `llmProviderName?: string`

### 6. 主应用集成 (G45-04)

**useModals.ts**:
- `PanelKey` 联合类型新增 `mcpRag`
- `INITIAL_STATE` 新增 `mcpRag: false`
- `UseModalsResult` 新增 `mcpRag: PanelController`
- 控制器 `mcpRag: makeController('mcpRag')`

**App.tsx**:
- 导入 `McpRagPanel`
- `useModals` 解构新增 `mcpRag: mcpRagModal`
- 透传 `onOpenMcpRag={() => mcpRagModal.onOpen()}`
- 渲染 `{mcpRagModal.open && <McpRagPanel ... />}`
- 版本号: v2.8.0 (Cycle 45 G45-04)

**BrandHeader.tsx**:
- `BrandHeaderProps` 新增 `onOpenMcpRag?: () => void`
- 解构新增 `onOpenMcpRag`
- 新增菜单项 "📚 MCP × RAG 智能体"
- 图标: book (emerald)
- 版本号: v2.25.0

**AppLayout.tsx**:
- `AppLayoutProps` 新增 `onOpenMcpRag: () => void`
- 解构新增 `onOpenMcpRag`
- 透传给 BrandHeader
- 版本号: v6.119.0

## 测试覆盖

### 单元测试

- `mcpRagEngine.test.ts`: 41 tests
- `mcpRagKnowledgeBase.test.ts`: 40 tests
- `mcpToolRagSource.test.ts`: 49 tests
- `mcpRagAgent.test.ts`: 21 tests
- **合计**: 151 tests / 100% pass

### 测试维度

- 工厂 / 初始化
- 核心功能（CRUD + 检索）
- 边界条件（空 / null / 不存在）
- 异常处理（错误恢复 / 监听器异常）
- 事件系统
- 缓存机制
- 并发控制
- 统计准确性

## Git 提交记录

| Commit | 描述 | 文件 |
|--------|------|------|
| fdd4dc2 | feat(cycle45 G45-01): MCP × RAG 融合引擎核心 - mcpRagEngine | mcpRagEngine.ts |
| b8cb7e8 | feat(cycle45 G45-02): MCP 资源作为 RAG 知识库 - mcpRagKnowledgeBase | mcpRagKnowledgeBase.ts / mcpRagEngine.ts |
| 1b38853 | feat(cycle45 G45-03): MCP 工具作为 RAG 检索源 - mcpToolRagSource | mcpToolRagSource.ts |
| 8588c06 | feat(cycle45 G45-04): Agent RAG 增强循环 - mcpRagAgent | mcpRagAgent.ts |
| 2714f0d | feat(cycle45 G45-04): MCP × RAG 智能体面板主应用集成 - McpRagPanel | McpRagPanel.tsx + 主应用集成 |

## 兼容性说明

- ✅ 与 Cycle 39-44 的 MCP 工具链完全兼容
- ✅ 与 MockProvider / 火山方舟 / DeepSeek LLM 兼容
- ✅ 与现有 RAGEngine 复用
- ✅ 不影响其他功能

## 任务执行情况

- [x] G45-01: MCP × RAG 融合引擎核心
- [x] G45-02: MCP 资源作为 RAG 知识库
- [x] G45-03: MCP 工具作为 RAG 检索源
- [x] G45-04: Agent RAG 增强循环 + UI 面板集成
- [x] 主应用集成 + TypeScript 0 错误 + 100% 测试 + Vite 构建
- [x] Git 提交（5 个原子提交）
