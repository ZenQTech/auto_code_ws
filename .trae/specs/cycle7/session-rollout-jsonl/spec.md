# Cycle 7 P0-9: Session Rollout JSONL Persistence + Pagination

> **版本**: v1.0.0
> **创建日期**: 2026-07-27
> **关联调研**: CYCLE6_RESEARCH_REPORT.md §2.3
> **关联 Codex 规范**: v0.136.0 JSONL rollout + v0.145.0 thread/fork (beforeTurnId) + 分页 thread history
> **状态**: ✅ 已完成（v5.4.0 2026-07-27）

---

## 1. 背景与目标

### 1.1 现状

当前 `SessionForkResumeService` (Cycle 2) 已实现基础的 fork/resume/lineage，但存在以下限制：

1. **消息数据存储在 SQLite 中**：fork 时复制整段 conversation，存储开销大
2. **不支持分页**：长会话的 thread history 一次返回所有消息
3. **fork 粒度只能基于消息 ID**：不支持 v0.145.0 新增的 `beforeTurnId` 切分点
4. **缺少 zstd 压缩**：JSONL rollout 文件未压缩
5. **缺少导出能力**：用户无法导出自己的会话历史

### 1.2 目标

实现 Codex 风格的 Session Rollout JSONL 持久化机制：

- **JSONL 格式**: `~/.codex/sessions/YYYY/MM/DD/rollout-{timestamp}-{uuid}.jsonl[.zst]`
- **5 种 item 类型**:
  1. `SessionMeta` - 会话元数据（id、title、model、cwd）
  2. `TurnContext` - 轮次上下文（user prompt、sandbox、approval_policy）
  3. `ResponseItem` - 单条消息（text / function_call / function_call_output）
  4. `EventMsg` - 事件（user_message / agent_message / token_count / tool_call）
  5. `Compacted` - 压缩后的合并消息
- **分页查询**: `GET /api/sessions/{id}/rollout?limit=50&offset=0`
- **beforeTurnId fork**: `POST /api/sessions/{id}/fork?beforeTurnId=turn-uuid`
- **导出**: `GET /api/sessions/{id}/export` 返回 JSONL 字符串
- **zstd 压缩**: 大于 100KB 的 rollout 自动 zstd 压缩
- **增量持久化**: append-only JSONL 写入

### 1.3 非目标

- 完整 v0.150+ 全部 feature（仅 P0-9 范围内的特性）
- TUI 客户端（CLI 之外的客户端）
- 跨设备 sync（本任务仅持久化，不做实时同步）

---

## 2. 技术选型

### 2.1 核心库

| 库 | 用途 | 版本 |
|----|------|------|
| `zstandard` | zstd 压缩/解压 | ≥0.21.0 |
| `jsonlines` (可选) | JSONL 读写辅助 | ≥0.5.0 |
| 标准库 `json` | 序列化 | 3.10+ |
| 标准库 `gzip` | 备选压缩 | 3.10+ |
| 现有 SQLAlchemy | 索引 + 元数据存储 | 2.0+ |

### 2.2 架构选型

**存储层次**:
- **元数据**（Session 模型）: SQLite → `sessions` 表
- **rollout 文件**: 文件系统 → `data/rollouts/{session_id}.jsonl[.zst]`
- **消息索引**: SQLite → `rollout_items` 表（turn_id, type, offset, length）

**写入策略**: append-only
- 每次新消息/事件 → 追加一行到 .jsonl 文件
- 每次写入 → 同步更新 `rollout_items` 索引

**读取策略**: 范围查询
- 分页参数 → 索引查询 → 文件 offset 读取
- 范围压缩：连续 ResponseItem 合并返回

### 2.3 数据格式

**JSONL 顶层结构** (每行一个 JSON 对象):
```json
{"type":"session_meta","ts":1722000000.123,"payload":{"id":"sess-uuid","title":"...","model":"claude-sonnet-4.5","cwd":"/path","created_at":"2026-07-27T..."}}
{"type":"turn_context","ts":1722000001.234,"payload":{"turn_id":"turn-1","user_prompt":"...","sandbox":"workspace-write","approval_policy":"on-failure"}}
{"type":"event_msg","ts":1722000002.345,"payload":{"event":"user_message","text":"hello"}}
{"type":"response_item","ts":1722000003.456,"payload":{"item_type":"text","text":"hi there"}}
{"type":"response_item","ts":1722000004.567,"payload":{"item_type":"function_call","name":"Bash","arguments":"{...}"}}
{"type":"response_item","ts":1722000005.678,"payload":{"item_type":"function_call_output","output":"..."}}
{"type":"event_msg","ts":1722000006.789,"payload":{"event":"token_count","input":1500,"output":200}}
{"type":"compacted","ts":1722000007.890,"payload":{"range":"turn-1..turn-5","summary":"..."}}
```

---

## 3. 实施组件

### 3.1 后端服务

**`backend/app/services/rollout_jsonl.py`** (~ 380 行)
- `RolloutItemType` enum: 5 种类型
- `RolloutItem` dataclass: type, ts, payload, turn_id, line_no
- `RolloutWriter` 类: append_item / append_turn / append_event / append_compacted
- `RolloutReader` 类: read_all / read_range / read_paginated / read_around_turn
- zstd 压缩: write_compressed / read_compressed

**`backend/app/services/session_rollout_service.py`** (~ 450 行)
- 整合 RolloutWriter + RolloutReader + SessionForkResumeService
- `record_turn(session_id, turn_context)` - 持久化用户 turn
- `record_event(session_id, event)` - 持久化事件
- `record_response_item(session_id, item)` - 持久化消息项
- `paginate_history(session_id, limit, offset)` - 分页查询
- `fork_at_turn(session_id, before_turn_id, new_title)` - 增强 fork
- `export_session(session_id)` - 导出 JSONL
- `import_session(jsonl_text)` - 导入 JSONL

### 3.2 数据库迁移

**`backend/app/models.py`** 新增 `RolloutItem` 表:
```python
class RolloutItem(Base):
    __tablename__ = "rollout_items"
    id: str (UUID, primary key)
    session_id: str (FK -> sessions.id, indexed)
    turn_id: str (nullable, indexed)
    item_type: str (枚举: session_meta/turn_context/response_item/event_msg/compacted)
    line_no: int (在 .jsonl 文件中的行号)
    byte_offset: int (字节偏移)
    byte_length: int (字节长度)
    ts: float (Unix 时间戳)
    created_at: datetime
```

### 3.3 API 端点（4 个新端点）

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/sessions/{id}/rollout` | GET | 分页查询 rollout（`?limit=50&offset=0`）|
| `/api/sessions/{id}/rollout/turn/{turn_id}` | GET | 查询指定 turn 周围的内容 |
| `/api/sessions/{id}/export` | GET | 导出 JSONL 字符串（可选 ?compressed=true 返回 zstd base64）|
| `/api/sessions/{id}/fork-turn` | POST | 基于 beforeTurnId 分叉（v0.145.0 API）|

### 3.4 前端 UI

**`frontend/src/components/SessionRolloutPanel.tsx`** (~ 450 行)
- 会话详情抽屉/面板
- JSONL 列表（虚拟滚动）
- 分页加载（上滑加载更多）
- beforeTurnId fork 按钮（hover 消息显示分叉点）
- 导出按钮（下载 .jsonl 文件）
- 时间线视图

### 3.5 测试

- `tests/test_rollout_units.py` (~ 400 行): 22+ 单元测试
  - JSONL 写入/读取
  - zstd 压缩/解压
  - 5 种 item 类型处理
  - 分页查询
  - beforeTurnId fork
  - 导出/导入
  - 错误场景（空文件、损坏数据）

- `tests/test_e2e_rollout.sh` (~ 200 行): 12+ E2E 测试
  - 完整 rollout 生命周期
  - 分页 API
  - fork-turn API
  - 导出/导入往返

---

## 4. 接口规范

### 4.1 分页查询

**请求**:
```
GET /api/sessions/{id}/rollout?limit=50&offset=0
```

**响应**:
```json
{
  "success": true,
  "session_id": "sess-uuid",
  "total_items": 234,
  "limit": 50,
  "offset": 0,
  "has_more": true,
  "items": [
    {
      "line_no": 1,
      "type": "session_meta",
      "ts": 1722000000.123,
      "turn_id": null,
      "payload": {...}
    },
    ...
  ]
}
```

### 4.2 beforeTurnId Fork

**请求**:
```
POST /api/sessions/{id}/fork-turn
Content-Type: application/json

{"before_turn_id": "turn-uuid-3", "title": "新标题"}
```

**响应**:
```json
{
  "success": true,
  "session": {
    "id": "new-sess-uuid",
    "title": "新标题",
    "parent_session_id": "sess-uuid",
    "fork_turn_id": "turn-uuid-3",
    "items_copied": 12,
    "created_at": "..."
  }
}
```

### 4.3 导出

**请求**:
```
GET /api/sessions/{id}/export?compressed=true
```

**响应**: `text/plain`
- `?compressed=true`: zstd 压缩 + base64 编码
- 默认: 原始 JSONL 文本

---

## 5. 性能与安全

### 5.1 性能目标

- 单次写入（append + 索引更新）< 5ms
- 单次分页查询（50 项）< 50ms
- 导出（1000 项会话）< 500ms
- zstd 压缩（100KB JSONL）< 50ms

### 5.2 安全要求

- 会话所有权验证：只能访问自己的 session
- 导出文件大小限制：≤ 50MB
- 导入文件大小限制：≤ 50MB
- JSONL 行长度限制：≤ 1MB
- 损坏文件容错：跳过损坏行，记录到 `rollout_errors` 表

---

## 6. 验收标准

### 6.1 功能验收

- ✅ 5 种 item 类型（session_meta/turn_context/response_item/event_msg/compacted）可写入和读取
- ✅ append-only 写入无锁
- ✅ 分页查询（limit/offset）准确返回
- ✅ beforeTurnId fork 复制该 turn 之前的所有内容
- ✅ zstd 压缩可逆（解压后内容一致）
- ✅ 导出 JSONL 可被导入
- ✅ 损坏文件跳过损坏行不崩溃

### 6.2 测试验收

- ✅ 单元测试 ≥ 20 个
- ✅ E2E 测试 ≥ 10 个
- ✅ 测试通过率 100%

### 6.3 集成验收

- ✅ TypeScript 编译 0 错误
- ✅ Vite 构建成功
- ✅ 浏览器验证：UI 正常显示，分页加载，导出按钮可点击
- ✅ 与现有 SessionForkResumeService 无冲突

---

## 7. 修改关键文件

```
backend/app/services/rollout_jsonl.py            (新建: 380 行)
backend/app/services/session_rollout_service.py  (新建: 450 行)
backend/app/api/session_rollout.py               (新建: 200 行)
backend/app/main.py                              (修改: 注册新路由)
backend/app/models.py                            (修改: 新增 RolloutItem 表)
frontend/src/components/SessionRolloutPanel.tsx  (新建: 450 行)
frontend/src/hooks/useRolloutApi.ts              (新建: 200 行)
frontend/src/App.tsx                             (修改: 集成面板)
tests/test_rollout_units.py                      (新建: 400 行)
tests/test_e2e_rollout.sh                        (新建: 200 行)
.trae/specs/cycle7/session-rollout-jsonl/spec.md (本文件)
CYCLE7_P0_9_SUMMARY.md                           (新建: 总结报告)
```

---

## 8. 复用声明

- ✅ `SessionForkResumeService` (Cycle 2) - 复用 fork/resume 逻辑，扩展 beforeTurnId 支持
- ✅ `Session` 模型 (现有) - 复用 session 元数据
- ✅ `Conversation` 模型 (现有) - 可并存（双写）or 迁移
- ✅ SQLAlchemy AsyncSession (现有) - 数据库访问
- ✅ useModals Hook (Cycle 6) - 面板状态管理
- ✅ BrandHeader 菜单 (现有) - 添加 "Session Rollout" 菜单项
- ❌ 无外部代码直接复制（纯新增实现）

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 文件系统故障导致 .jsonl 损坏 | 中 | 损坏检测 + 跳过损坏行 + 备份到 .bak |
| 并发写入冲突 | 低 | append-only + 行级文件锁（fcntl）|
| zstd 库未安装 | 中 | 降级为 gzip 压缩 |
| 大文件（>10MB）读取慢 | 中 | 流式读取 + 范围查询 |
| 现有 Conversation 表与 Rollout 双写不一致 | 高 | Phase 1 期间双写，Phase 2 切换读取 |
