# T9: Compaction 双触发机制 - 规格说明

## 1. 功能需求描述

### 1.1 功能目标
实现 Codex v0.139+ 的双触发点 Compaction 机制，支持 pre-turn 和 mid-turn 两个触发点。

### 1.2 用户场景
- 用户进行长会话，对话累积超过 token 阈值
- 用户希望无感压缩上下文，无需手动操作
- 用户希望长工具调用链也能保持上下文健康

### 1.3 使用流程
1. **Pre-turn**: 用户发送消息 → 后端检测 token 数 → 超阈值则自动压缩 → 用户无感
2. **Mid-turn**: 工具调用链循环中 → loop 边界检测 → 超阈值则压缩 + replay pending request
3. 前端显示触发类型 + 压缩前/后 token 数
4. 压缩历史可查询

## 2. 技术实现方案

### 2.1 技术选型
- **Token 计数**: 已有 `TokenCounter` 扩展
- **触发器**: 中间件 + 装饰器
- **上下文快照**: `pickle` 序列化（不可变）
- **回放**: 已有 `SummaryGenerator` 扩展

### 2.2 双触发架构

```
用户输入 → pre-turn 触发器检查 → token 超阈值？
                                      ↓
                                  Compaction.pre_turn()
                                      ↓
                                  用户消息注入
                                      ↓
                                  模型推理 + 工具调用
                                      ↓
                                  mid-turn 触发器检查 → token 超阈值？
                                                          ↓
                                                      Compaction.mid_turn()
                                                          ↓
                                                      压缩 + 回放
```

### 2.3 双路径压缩

**Local 路径**:
- 客户端 LLM 调用本地模型生成摘要
- 适配任何 provider
- 延迟：5-15s

**Remote 路径**:
- 调用 `POST /v1/responses/compact`（OpenAI 专有）
- 返回 AES 加密的压缩表示
- 延迟：2-5s

### 2.4 核心算法
- **pre_turn**: `session.tokens > max_tokens` → `compact('pre_turn', strategy='hybrid')`
- **mid_turn**: `iteration.tokens > max_tokens` 且 `pending_request` 存在 → `compact('mid_turn', preserve_request=True)`
- **回放**: `pending_user_request` + `compacted_context` → 重新注入

## 3. 接口设计规范

### 3.1 数据模型

```python
class CompactionTrigger(str, Enum):
    MANUAL = "manual"           # 手动触发
    PRE_TURN = "pre_turn"       # 用户消息前
    MID_TURN = "mid_turn"       # 工具链循环边界

class CompactionPath(str, Enum):
    LOCAL = "local"             # 客户端 LLM 摘要
    REMOTE = "remote"           # 服务端压缩 API

class CompactionConfig(BaseModel):
    enabled: bool = True
    auto_trigger: bool = True
    max_tokens: int = 15000
    max_messages: int = 50
    keep_recent: int = 10
    strategy: str = "hybrid"    # hybrid/sliding/full
    path: CompactionPath = CompactionPath.LOCAL
    pre_turn_enabled: bool = True
    mid_turn_enabled: bool = True
    mid_turn_threshold_ratio: float = 0.85  # 达到 85% 触发 mid-turn
```

### 3.2 REST API 端点

```http
# 获取压缩配置
GET /api/compaction/config

# 更新压缩配置
PUT /api/compaction/config
Body: { "max_tokens": 20000, "pre_turn_enabled": true, "mid_turn_enabled": true }

# 手动触发压缩
POST /api/sessions/{id}/compact
Body: { "trigger": "manual", "strategy": "hybrid", "path": "local" }

# 查询压缩历史
GET /api/sessions/{id}/compaction-history
Response: { "history": [{ "trigger": "pre_turn", "before": 20000, "after": 8000, "ts": "..." }] }

# 获取会话 token 状态
GET /api/sessions/{id}/tokens
Response: { "token_count": 15000, "message_count": 50, "compacted_count": 30 }

# 检查是否需要压缩
GET /api/sessions/{id}/should-compact
Response: { "should_compact": true, "trigger": "pre_turn", "reason": "tokens > max" }
```

## 4. 数据结构定义

### 4.1 数据库表

```sql
-- 会话压缩历史
CREATE TABLE compaction_history (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    trigger TEXT NOT NULL,         -- manual/pre_turn/mid_turn
    path TEXT NOT NULL,            -- local/remote
    strategy TEXT NOT NULL,
    before_tokens INTEGER NOT NULL,
    after_tokens INTEGER NOT NULL,
    compacted_count INTEGER NOT NULL,
    kept_count INTEGER NOT NULL,
    summary TEXT,
    pending_request TEXT,          -- mid_turn 时保留
    duration_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 5. 性能与安全要求

### 5.1 性能指标
- Pre-turn 触发延迟 < 100ms
- Local 压缩 5-15s
- Remote 压缩 2-5s
- 压缩后 token 数 < 8000

### 5.2 安全要求
- 压缩过程不丢失关键决策点
- Pending request 完整保留
- 摘要包含决策点 + 工具调用 + 用户意图

## 6. 验收标准

### 6.1 功能验收
- Pre-turn trigger 静默触发，用户无感
- Mid-turn trigger 准确率 ≥ 95%
- Local/remote 双路径可切换
- Pending request 完整回放

### 6.2 测试用例
- **正常场景**: 长会话压缩、工具链压缩
- **异常场景**: 压缩失败、pending request 缺失
- **边界场景**: 0 消息、10000 消息、token 临界值

### 6.3 通过条件
- 自动化测试通过率 100%
- 浏览器 E2E 测试通过
- 性能指标全部达标
