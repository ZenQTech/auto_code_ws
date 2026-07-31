# CYCLE 41 代码修改日志

> **Cycle**: 41
> **方向**: MCP 高级能力深度集成
> **完成时间**: 2026-07-31
> **总修改**: 12 文件新增 + 6 文件修改

---

## 一、新增文件（12 个）

### 1.1 核心引擎（8 个）

| 文件 | 行数 | 用途 |
|------|------|------|
| `frontend/src/utils/mcpResourceSubscription.ts` | ~260 | 资源订阅管理器（resources/subscribe + 推送通知） |
| `frontend/src/utils/mcpResourceSubscription.test.ts` | ~400 | 资源订阅单元测试 |
| `frontend/src/utils/mcpCompletion.ts` | ~310 | 参数补全引擎（completion/complete） |
| `frontend/src/utils/mcpCompletion.test.ts` | ~350 | 参数补全单元测试 |
| `frontend/src/utils/mcpSampling.ts` | ~370 | 服务器主动 LLM 调用（sampling/createMessage） |
| `frontend/src/utils/mcpSampling.test.ts` | ~300 | 采样单元测试 |
| `frontend/src/utils/mcpRoots.ts` | ~265 | 根目录管理（roots/list + 变更通知） |
| `frontend/src/utils/mcpRoots.test.ts` | ~390 | 根目录单元测试 |

### 1.2 主应用集成（2 个）

| 文件 | 行数 | 用途 |
|------|------|------|
| `frontend/src/components/McpAdvancedPanel.tsx` | ~560 | 4-Tab MCP 高级能力统一面板 |
| `frontend/src/components/McpAdvancedPanel.test.tsx` | ~200 | 面板集成测试 |

### 1.3 文档（2 个）

| 文件 | 用途 |
|------|------|
| `CYCLE41_ACCEPTANCE_REPORT.md` | Cycle 41 验收报告 |
| `CYCLE41_CODE_MODIFICATION_LOG.md` | 本文件 - 代码修改日志 |

## 二、修改文件（6 个）

### 2.1 mcpClient.ts (v1.0.4)

**变更内容**:
- 新增 `subscribeResource(uri: string)` 公共方法
- 新增 `unsubscribeResource(uri: string)` 公共方法
- 新增 `complete(ref, argument)` 参数补全方法
- 新增 `createSamplingMessage(request)` 服务器主动 LLM 调用方法
- 新增 `notify(method, params)` 公共通知方法（从 private 改为 public）

**修改位置**:
```typescript
// G41-01 (line 553-562)
async subscribeResource(uri: string): Promise<void>
async unsubscribeResource(uri: string): Promise<void>

// G41-02 (line 568-573)
async complete(ref, argument)

// G41-03 (line 580-606)
async createSamplingMessage(request)

// 公开 notify (line 785)
async notify(method: string, params?: Record<string, unknown>)
```

### 2.2 useModals.ts (v3.2.0)

**变更内容**:
- `PanelKey` 联合类型新增 `'mcpAdvanced'`
- `INITIAL_STATE` 新增 `mcpAdvanced: false`
- `UseModalsResult` 新增 `mcpAdvanced: PanelController`
- useModals 函数返回对象新增 `mcpAdvanced: makeController('mcpAdvanced')`

**影响**: panel 数量 25→26（含 2 工具方法共 27）

### 2.3 useModals.test.ts

**变更内容**:
- 测试断言更新：26 → 27
- 注释更新：25 panel + 2 utility

### 2.4 BrandHeader.tsx (v2.21.0)

**变更内容**:
- props 类型新增 `onOpenMcpAdvanced?: () => void`
- 组件解构新增 `onOpenMcpAdvanced`
- 菜单渲染新增 "⚡ MCP 高级能力" 项（zap 图标 + 黄色高亮）

**修改位置**:
- 类型 (line 171-172)
- 解构 (line 1089-1090)
- 菜单 (line 1919-1935)

### 2.5 AppLayout.tsx (v6.114.0)

**变更内容**:
- props 类型新增 `onOpenMcpAdvanced: () => void`
- 组件解构新增 `onOpenMcpAdvanced`
- 透传给 BrandHeader: `onOpenMcpAdvanced={onOpenMcpAdvanced}`

**修改位置**:
- 类型 (line 148-149)
- 解构 (line 402)
- 透传 (line 663)

### 2.6 App.tsx (v2.4.0)

**变更内容**:
- import 新增 `McpAdvancedPanel`
- useModals 解构新增 `mcpAdvanced: mcpAdvancedModal`
- onOpen 透传：`onOpenMcpAdvanced={() => mcpAdvancedModal.onOpen()}`
- 弹窗渲染：新增 `McpAdvancedPanel` 模态弹窗（max-w-5xl, max-h-90vh）

**修改位置**:
- import (line 208-209)
- 解构 (line 593)
- 透传 (line 3133)
- 弹窗 (line 3280-3297)

## 三、技术决策

### 3.1 notify 公开化

**原因**: G41-04 RootsManager 需要调用 `client.notify('notifications/roots/list_changed', {})` 通知服务器

**方案**: 将 `McpClient.notify` 从 private 改为 public，并保留所有现有能力

**影响**:
- 允许外部代码主动发送通知
- 保留 PendingRequestManager 的状态检查
- 与 subscribe/unsubscribe/notify 流程对齐

### 3.2 SamplingHandler.createMessage 重构

**原因**: 原实现直接调用 `client.request()` 私有方法，TypeScript 报错

**方案**: 改用 `client.createSamplingMessage()` 公共方法，并通过类型适配器转换 SamplingMessage.content

**影响**:
- 消除私有方法访问
- 改善类型安全性
- 提升可维护性

### 3.3 CompletionProvider 适配器模式

**原因**: McpClient.complete 公共方法签名与 CompletionProvider 期望的 CompletionClient 接口不匹配

**方案**: 在 McpAdvancedPanel 中创建适配器，包装 `client.complete` 公共方法

**影响**:
- 不修改底层 API
- 保持 McpClient API 稳定性
- 提供清晰的适配边界

### 3.4 McpAdvancedPanel 4-Tab 设计

**原因**: 4 大高级能力独立但相关，统一面板提供一致 UX

**方案**: 使用 useState 管理当前 Tab，每个 Tab 独立 useEffect 初始化

**影响**:
- 降低组件复杂度
- 支持独立测试
- 提供切换无副作用的体验

## 四、关键指标

| 指标 | Cycle 40 | Cycle 41 | 增量 |
|------|----------|----------|------|
| 总测试数 | 5,584 | 5,715 | +131 |
| 测试文件 | 194 | 199 | +5 |
| 核心引擎数 | 14 | 18 | +4 |
| UI 面板数 | 4 | 5 | +1 |
| 单元测试通过率 | 100% | 100% | ✓ |
| TypeScript 错误 | 0 | 0 | ✓ |
| 协议能力覆盖 | 8 | 12 | +4 |

## 五、待优化项（不阻塞交付）

1. **SubscriptionEvent 缺少 error 分支**：当前实现仅支持 subscribed/unsubscribed/updated/cleared，可扩展 error 事件
2. **CompletionProvider 缓存淘汰策略**：当前 LRU 截断简单实现，可改用 LFU 或基于时间的精细淘汰
3. **SamplingHandler 持久化**：当前 history 仅在内存中，刷新页面后丢失
4. **RootsManager 持久化**：当前 roots 仅在内存中，可扩展 localStorage 支持

## 六、关联文件

- CYCLE 41 启动文档：[CYCLE41_STARTUP.md](file:///home/qizheng/auto_code_ws/CYCLE41_STARTUP.md)
- CYCLE 41 验收报告：[CYCLE41_ACCEPTANCE_REPORT.md](file:///home/qizheng/auto_code_ws/CYCLE41_ACCEPTANCE_REPORT.md)
- CYCLE 40 验收报告：[CYCLE40_ACCEPTANCE_REPORT.md](file:///home/qizheng/auto_code_ws/CYCLE40_ACCEPTANCE_REPORT.md)
- MCP 客户端核心：[mcpClient.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/mcpClient.ts)
- MCP 资源订阅：[mcpResourceSubscription.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/mcpResourceSubscription.ts)
- MCP 参数补全：[mcpCompletion.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/mcpCompletion.ts)
- MCP 服务器采样：[mcpSampling.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/mcpSampling.ts)
- MCP 根目录：[mcpRoots.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/mcpRoots.ts)
- MCP 高级面板：[McpAdvancedPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/McpAdvancedPanel.tsx)
