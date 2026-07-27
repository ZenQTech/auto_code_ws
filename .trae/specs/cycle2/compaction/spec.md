# 长会话压缩 (Compaction) - Spec

## 1. 功能需求

### 1.1 目标
实现 LLM 长会话自动压缩机制，解决 Codex 文档中提到的 "Quadratic Growth Problem"，避免上下文窗口溢出。

### 1.2 用户场景
1. **场景 A：长对话自动压缩**
   - 用户与 LLM 进行 100+ 轮对话
   - 当 token 超过阈值时自动触发压缩
   - 用户无感知，继续对话

2. **场景 B：手动压缩**
   - 用户点击"压缩历史"按钮
   - 系统立即压缩历史消息
   - 保留关键信息，丢弃冗余上下文

### 1.3 使用流程
```
检测 token 数 → 超过阈值 → 调用 LLM 摘要历史 → 替换原始消息 →
保留最近 N 条 + 摘要 + 系统消息
```

## 2. 技术实现方案

### 2.1 压缩策略

**核心算法**：
```
1. 计算当前消息总 token 数
2. 若 < 阈值（默认 50K），跳过
3. 保留：system prompt + 最近 10 条消息
4. 对中间消息生成 LLM 摘要
5. 压缩结构：[system] + [摘要] + [最近 10 条]
```

### 2.2 架构设计

```
┌──────────────────────────────────────────────────┐
│              Compressor Service                   │
│  ┌──────────────────┐  ┌─────────────────────┐  │
│  │ TokenCounter     │  │ SummaryGenerator    │  │
│  │ (tiktoken)       │  │ (调用 LLM)          │  │
│  └──────────────────┘  └─────────────────────┘  │
│  ┌─────────────────────────────────────────────┐ │
│  │ CompactionStrategy                          │ │
│  │ - SlidingWindow（滑动窗口）                 │ │
│  │ - HierarchicalSummary（层级摘要）           │ │
│  │ - Hybrid（混合：滑动 + 摘要）               │ │
│  └─────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### 2.3 触发条件
- 自动触发：消息数 > 50 OR token 数 > 50K
- 手动触发：用户点击"压缩历史"按钮
- 预触发：单条消息超过 10K token

## 3. 接口设计规范

### 3.1 后端 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/sessions/{id}/compact` | POST | 手动触发压缩 |
| `/api/sessions/{id}/tokens` | GET | 查询当前 token 数 |
| `/api/compaction/config` | GET/PUT | 获取/更新压缩配置 |

### 3.2 请求/响应格式

```json
// POST /api/sessions/{id}/compact
{
  "strategy": "hybrid",  // optional, default=hybrid
  "keep_recent": 10  // optional, default=10
}

// 响应
{
  "success": true,
  "before": {
    "messages": 87,
    "tokens": 52340
  },
  "after": {
    "messages": 11,
    "tokens": 8200,
    "summary_tokens": 4500
  },
  "summary": "用户与助手讨论了..."
}
```

## 4. 数据结构定义

### 4.1 CompactionConfig
```python
class CompactionConfig(BaseModel):
    enabled: bool = True
    auto_trigger: bool = True
    max_tokens: int = 50_000
    max_messages: int = 50
    keep_recent: int = 10
    strategy: str = "hybrid"  # sliding | summary | hybrid
```

### 4.2 CompactionResult
```python
class CompactionResult(BaseModel):
    success: bool
    before_tokens: int
    after_tokens: int
    summary: str
    compressed_at: datetime
```

### 4.3 Message 模型扩展
```python
class Message(Base):
    # 已有字段...
    is_compacted: bool = False  # 是否被压缩
    compacted_at: Optional[datetime] = None
    compacted_into: Optional[str] = None  # 指向 summary 消息 ID
```

## 5. 性能与安全要求

### 5.1 性能指标
- 压缩延迟：< 5s（含 LLM 摘要调用）
- 压缩比：≥ 70%（即 50K → 15K）
- 摘要质量：保留 90% 关键信息（人工评估）

### 5.2 安全要求
- 压缩不能删除用户可见的消息
- 压缩摘要必须包含关键决策点
- 原始消息保留在数据库（标记 is_compacted=true）

## 6. 验收标准

### 6.1 功能验证
- [ ] 创建 100 条消息的会话 → 自动触发压缩
- [ ] 压缩后 token 数 < 15K
- [ ] 压缩后能继续正常对话
- [ ] 手动压缩按钮工作
- [ ] 压缩配置可读写

### 6.2 测试项目

#### 6.2.1 脚本自动测试
```python
def test_token_counter():
    """验证 token 计数准确（误差 < 5%）"""

def test_auto_trigger():
    """验证自动触发条件"""

def test_hybrid_strategy():
    """验证混合策略压缩"""

def test_summary_quality():
    """验证摘要包含关键信息（关键词匹配）"""

def test_recent_messages_preserved():
    """验证最近消息保留"""
```

#### 6.2.2 前端 E2E 测试
- [ ] 发送 60 条消息 → 验证自动压缩通知
- [ ] 点击"压缩历史"按钮 → 验证压缩成功
- [ ] 压缩后继续对话 → 验证上下文连贯

## 7. 实施步骤

1. **M1: Token 计数 + 配置**（1h）
2. **M2: 摘要生成器**（2h）
3. **M3: 压缩策略**（2h）
4. **M4: API 端点**（1h）
5. **M5: 前端集成**（1.5h）
6. **M6: 端到端测试**（1h）
