# CYCLE 41 启动文档

> **Cycle**: 41  
> **状态**: 🟡 调研方向待用户确认  
> **完成时间**: 待定

---

## 一、Cycle 40 回顾

✅ **Cycle 40 已完成（4 大 P0 任务）**：
- G40-01: Mock Subprocess + Stdio 端到端测试
- G40-02: MCP 资源 UI 面板
- G40-03: MCP 提示词集成
- G40-04: 集成测试 + 性能基准

**关键指标**：
- 5584 测试通过（100%）
- TypeScript 严格模式 0 错误
- 生产构建 23.54s 成功
- +141 个 MCP 相关测试

## 二、Cycle 41 候选方向

### 方向 A: MCP 高级能力 + 资源订阅（推荐 ⭐⭐⭐⭐⭐）

**调研主题**：
- `resources/subscribe`：服务器推送资源变化（文件监听场景）
- `resources/unsubscribe`：取消订阅
- `completion/complete`：参数补全（基于上下文）
- `roots/list`：客户端根目录列表
- `sampling/createMessage`：服务器向 LLM 发起采样请求
- `elicitation/create`：服务器向用户请求输入

**核心价值**：
- 完整支持 MCP 2024-11-05 协议全部能力
- 资源订阅是文件、数据库等动态场景的核心需求
- 补全能力能极大提升 Agent 工具调用准确率

**预计任务**：
- G41-01: 资源订阅（subscribe/unsubscribe + UI）
- G41-02: 补全能力（complete + 集成到工具调用）
- G41-03: Sampling（服务器主动 LLM 调用）
- G41-04: Roots 根目录管理

**预计交付**：
- 4 个新文件 + 2 个修改
- 约 150 个新测试
- 完整 MCP 协议覆盖

### 方向 B: 跨服务数据流编排 ⭐⭐⭐⭐

**调研主题**：
- Resource → Tool → Prompt 联动
- 工作流引擎（条件分支、循环、错误恢复）
- 多 MCP 服务器协调（fan-out/fan-in）
- 缓存层 + 失效策略

**核心价值**：
- 让 MCP 能力真正编排为复杂任务
- 从单点能力到工作流能力

**预计任务**：
- G41-01: 数据流引擎（节点 + 边）
- G41-02: 多服务器协调器
- G41-03: 缓存层
- G41-04: 编排 UI

### 方向 C: LLM 性能优化 ⭐⭐⭐

**调研主题**：
- 批处理（多请求合并）
- 流式响应（chunked + TTFT）
- 提示词压缩（语义保留）
- 缓存（语义相似度匹配）

**核心价值**：
- 提升 Hermes 整体响应速度
- 降低成本

### 方向 D: AGI 评估框架 ⭐⭐⭐

**调研主题**：
- 任务成功率基准
- 工具调用准确率
- 多步推理能力
- 错误恢复能力

**核心价值**：
- 为平台能力建立量化基线
- 指导后续优化方向

## 三、推荐决策

**强烈推荐方向 A**：
- ✅ 完整 MCP 协议覆盖（生态完整）
- ✅ 高级能力是真实生产需求
- ✅ 与 Cycle 39-40 紧密衔接
- ✅ 可立即落地为 4 大 P0

## 四、任务节奏选项

**A**: 维持 3 大 P0（保守）
- G41-01: 资源订阅
- G41-02: 补全能力
- G41-03: Sampling

**B**: 扩展到 4 大 P0（推荐，平衡）
- G41-01: 资源订阅
- G41-02: 补全能力
- G41-03: Sampling
- G41-04: Roots + 集成

**C**: 缩减到 2 大 P0（精品）
- G41-01: 资源订阅 + UI
- G41-02: 补全 + 集成

## 五、API 对接选项

**是否需要真实 LLM API 对接？**
- A. 是，DeepSeek（已配置）
- B. 是，火山方舟 Coding Plan（已配置）
- C. 是，两者都对接
- D. 否，继续 mock 模式

## 六、用户决策点

请确认：
1. **调研方向**: A / B / C / D
2. **任务节奏**: 3 / 4 / 2 P0
3. **API 对接**: A / B / C / D
4. **主应用集成** (Cycle 40 残余): 是否在本周期完成

## 七、关键技术参考

### 7.1 MCP 资源订阅协议

```typescript
// 客户端 → 服务器
{ jsonrpc: '2.0', id: 1, method: 'resources/subscribe', params: { uri: 'file:///x.txt' } }

// 服务器 → 客户端（推送）
{ jsonrpc: '2.0', method: 'notifications/resources/updated', params: { uri: 'file:///x.txt' } }
```

### 7.2 MCP 补全协议

```typescript
// 客户端 → 服务器
{
  jsonrpc: '2.0',
  id: 1,
  method: 'completion/complete',
  params: {
    ref: { type: 'ref/prompt', name: 'code_review' },
    argument: { name: 'language', value: 'py' }
  }
}

// 服务器 → 客户端
{ jsonrpc: '2.0', id: 1, result: { completion: { values: ['python', 'pypy'], total: 2 } } }
```

### 7.3 MCP Sampling 协议

```typescript
// 服务器 → 客户端
{
  jsonrpc: '2.0',
  id: 1,
  method: 'sampling/createMessage',
  params: {
    messages: [{ role: 'user', content: { type: 'text', text: '...' } }],
    maxTokens: 1000
  }
}
```

## 八、预计工作量

| 方向 | 任务数 | 代码行数 | 测试数 | 工期 |
|------|--------|----------|--------|------|
| A 高级能力 | 4 P0 | +3000 | +180 | 1 周期 |
| B 数据流 | 4 P0 | +3500 | +200 | 1 周期 |
| C 性能优化 | 3 P0 | +2000 | +120 | 1 周期 |
| D 评估框架 | 2 P0 | +1500 | +80 | 1 周期 |

---

**等待用户确认方向后启动 Phase 2 需求分解。**
