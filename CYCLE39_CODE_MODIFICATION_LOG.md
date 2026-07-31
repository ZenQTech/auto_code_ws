# CYCLE 39 代码修改日志

> **Cycle**: 39 - MCP 协议深度集成  
> **日期**: 2026-07-31  
> **修改人**: Hermes Loop Engineering Agent  

---

## 1. 新增文件 (8 个)

### 1.1 G39-01 MCP 客户端核心

| 文件 | 行数 | 字节 | 用途 |
|------|------|------|------|
| `frontend/src/utils/mcpTypes.ts` | ~250 | 7,405 | MCP 协议类型定义 |
| `frontend/src/utils/mcpErrors.ts` | ~200 | 5,634 | 错误类层次 |
| `frontend/src/utils/mcpTransport.ts` | ~120 | 3,607 | 传输抽象接口 |
| `frontend/src/utils/mcpTransportStdio.ts` | ~250 | 8,631 | Stdio 传输实现 |
| `frontend/src/utils/mcpTransportSse.ts` | ~200 | 7,020 | SSE 传输实现 |
| `frontend/src/utils/mcpClient.ts` | ~500 | 18,402 | MCP 客户端主类 |

### 1.2 G39-02 服务器注册表

| 文件 | 行数 | 字节 | 用途 |
|------|------|------|------|
| `frontend/src/utils/mcpRegistry.ts` | ~530 | - | 注册表 + 5 内置服务器 |

### 1.3 G39-03 UI 面板

| 文件 | 行数 | 字节 | 用途 |
|------|------|------|------|
| `frontend/src/components/McpRegistryPanel.tsx` | ~700 | - | 管理面板 UI |

### 1.4 G39-04 Marketplace + Bridge

| 文件 | 行数 | 字节 | 用途 |
|------|------|------|------|
| `frontend/src/utils/mcpMarketplace.ts` | ~480 | - | 12 个市场服务器 + Bridge |

### 1.5 文档

| 文件 | 用途 |
|------|------|
| `CYCLE39_STARTUP.md` | 启动文档 |
| `CYCLE39_SPEC_G39_01_MCP_CLIENT.md` | 详细设计规范 |
| `CYCLE39_ACCEPTANCE_REPORT.md` | 验收报告 |
| `CYCLE39_CODE_MODIFICATION_LOG.md` | 本文件 |

## 2. 修改文件 (4 个)

### 2.1 `frontend/src/hooks/useModals.ts` (v3.0.0 → v3.1.0)

**修改内容**：
- 新增 `mcpRegistry` PanelKey
- 新增 `mcpRegistry: PanelController` 字段
- 新增默认状态 `mcpRegistry: false`
- 新增 controller `mcpRegistry: makeController('mcpRegistry')`

**修改行数**：~10 行

### 2.2 `frontend/src/components/BrandHeader.tsx` (v2.11.0 → v2.12.0)

**修改内容**：
- 新增 `onOpenMcpRegistry?: () => void` 回调属性
- 透传 `onOpenMcpRegistry` 到 props
- 新增菜单项"🔌 MCP 服务器注册表"（Icon: plug）

**修改行数**：~20 行

### 2.3 `frontend/src/components/AppLayout.tsx` (v6.24.0 → v6.111.0)

**修改内容**：
- 新增 `onOpenMcpRegistry: () => void` 属性
- 透传 `onOpenMcpRegistry` 到 BrandHeader

**修改行数**：~5 行

### 2.4 `frontend/src/App.tsx` (v2.2.0 → v2.3.0)

**修改内容**：
- 新增 `McpRegistryPanel` 导入
- 从 `useModals` 解构 `mcpRegistry: mcpRegistryModal`
- 别名 `mcpRegistryPanelOpen / setMcpRegistryPanelOpen / closeMcpRegistryPanel`
- BrandHeader 回调 `onOpenMcpRegistry={() => mcpRegistryModal.onOpen()}`
- 新增 MCP 注册表面板弹窗渲染（max-w-6xl）

**修改行数**：~30 行

### 2.5 `frontend/src/hooks/useModals.test.ts`

**修改内容**：
- 修正 panel 数量断言：23 → 24
- 更新注释：v3.1.0 G39-03 新增 mcpRegistry

**修改行数**：~3 行

## 3. 测试文件 (6 个)

| 文件 | 测试数 | 通过 | 状态 |
|------|--------|------|------|
| `frontend/src/utils/mcpClient.test.ts` | 53 | 53 | ✅ |
| `frontend/src/utils/mcpErrors.test.ts` | 25 | 25 | ✅ |
| `frontend/src/utils/mcpTransportStdio.test.ts` | 8 | 8 | ✅ |
| `frontend/src/utils/mcpTransportSse.test.ts` | 9 | 9 | ✅ |
| `frontend/src/utils/mcpRegistry.test.ts` | 49 | 49 | ✅ |
| `frontend/src/utils/mcpMarketplace.test.ts` | 30 | 30 | ✅ |
| **合计** | **174** | **174** | **100%** |

## 4. 关键修复

### 4.1 McpServerError 范围判断反向

**问题**：
```typescript
if (code < JSON_RPC_SERVER_ERROR_END || code > JSON_RPC_SERVER_ERROR_START) {
  code = JSON_RPC_SERVER_ERROR_START;  // 错误重置
}
```

由于 `JSON_RPC_SERVER_ERROR_START = -32099`（更小）而 `JSON_RPC_SERVER_ERROR_END = -32000`（更大），原条件几乎总是触发重置。

**修复**：
```typescript
if (code < JSON_RPC_SERVER_ERROR_START || code > JSON_RPC_SERVER_ERROR_END) {
  code = JSON_RPC_SERVER_ERROR_START;
}
```

### 4.2 McpClient.request 状态检查过严

**问题**：`request()` 仅允许 `state === 'ready'`，但 `connect()` 内部就需要在 `connecting` 状态发送 initialize 请求。

**修复**：允许 `state === 'ready' || state === 'connecting'`

### 4.3 McpClient 测试 transport 替换丢失事件

**问题**：测试中 `(client as any).transport = mockTransport` 直接替换，但 listener 已绑定到旧 transport。

**修复**：新增公共方法 `setTransport(transport)`，内部重新绑定 listener。

### 4.4 useModals 测试断言过期

**问题**：新增 mcpRegistry 后未更新 `controllers.length` 预期。

**修复**：从 25 → 26（24 panels + 2 tools）。

## 5. 已完成任务

- [x] **G39-01**: MCP 客户端核心引擎（JSON-RPC + Stdio + SSE）
- [x] **G39-02**: MCP 服务器注册表 + 5 个内置服务器
- [x] **G39-03**: MCP UI 面板 + 主应用集成
- [x] **G39-04**: MCP Marketplace / Bridge
- [x] **测试覆盖**: 174 个 MCP 单元测试 100% 通过
- [x] **TypeScript**: 0 错误
- [x] **全量回归**: 5,383/5,383 通过
- [x] **验收文档**: CYCLE39_ACCEPTANCE_REPORT.md

## 6. 未完成任务

无。Cycle 39 全部 4 大 P0 任务均已完成。

## 7. 影响范围统计

| 维度 | 数值 |
|------|------|
| 新增文件 | 8 |
| 修改文件 | 5 |
| 新增测试 | 174 |
| 新增代码行 | ~3,500 |
| TypeScript 错误 | 0 |
| 全量测试通过率 | 100% (5,383/5,383) |
| 新增菜单项 | 1（MCP 服务器注册表） |
| 新增 Modal | 1（mcpRegistry） |
| 内置 MCP 服务器 | 5 |
| Marketplace 目录 | 12 |
