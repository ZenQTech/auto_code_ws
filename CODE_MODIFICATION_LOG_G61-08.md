# Code Modification Log - Cycle 61 G61-08

> 本文件记录 Cycle 61 G61-08（对话流自动折叠）专项修改。遵循"全程可追溯"原则。
> 每条修改包含：时间戳、模块、Task ID、角色、操作内容。

## 2026-08-04 | v1.0.0 | G61-08 对话流自动折叠（LLM 摘要 + 状态持久化）

| 字段 | 内容 |
|------|------|
| **时间戳** | 2026-08-04 17:36:00 |
| **模块** | `backend/app/services/conversation_folding.py`、`backend/app/api/conversation_folding.py`、`backend/tests/test_conversation_folding.py`、`backend/app/main.py` |
| **Task ID** | CYCLE61-G61-08 |
| **角色** | 全栈工程师 |
| **目标** | 实现长对话流自动管理，支持 LLM 摘要生成 + 多种折叠策略 + 磁盘持久化 + REST API |
| **提交** | `36563ee feat(cycle61 G61-08): 对话流自动折叠（LLM 摘要 + 状态持久化）` |

### 1. 核心组件 (1 个新服务模块)

#### 1.1 `backend/app/services/conversation_folding.py` (647 行)

**功能**：
- **数据模型**：`FoldConfig`（配置）、`FoldedMessage`（折叠占位符）、`ConversationMessage`（消息）、`FoldResult`（结果）
- **摘要生成器**：
  - `SummaryGenerator`（抽象基类）
  - `SimpleSummaryGenerator`（fallback，无 LLM 时使用）
  - `LLMSummaryGenerator`（可注入 LLM 调用，失败时降级到 Simple）
- **管理器** `ConversationFoldingManager`：
  - 多 session 隔离（`_sessions` / `_folds` / `_configs`）
  - asyncio 锁（per-session）
  - 消息管理：`add_message` / `get_messages` / `get_active_messages` / `get_total_tokens`
  - 触发判断：`should_fold`（count + token 阈值）
  - 折叠操作：`fold`（5 种策略）/ `auto_fold_if_needed`
  - 查询：`list_folds` / `get_fold` / `get_folded_messages` / `restore_fold`
  - 统计：`get_session_stats`
  - 持久化：`set_storage_dir` + `_save_session` / `_save_folds` / `_load_all`
- **全局单例**：`get_manager` / `reset_manager`

**5 种折叠策略**：
| 策略 | 行为 |
|------|------|
| `LLM_SUMMARY` | 调用 LLM 生成对话流摘要（降级到 Simple） |
| `TRUNCATE` | "已折叠 N 条消息（简单截断）" |
| `KEEP_HEAD` | 保留整个 active 对话流的第一条（最早消息） |
| `KEEP_TAIL` | 保留整个 active 对话流的最后一条（最新消息） |
| `KEEP_BOTH` | 保留整个 active 对话流的首尾两条 |

**4 种触发方式**：
| Trigger | 场景 |
|---------|------|
| `AUTO` | 消息数/token 超阈值自动触发 |
| `MANUAL` | 用户手动触发 |
| `TOKEN_LIMIT` | 达到 token 上限 |
| `TIME_BASED` | 定时清理 |

### 2. REST API (1 个新端点模块)

#### 2.1 `backend/app/api/conversation_folding.py` (216 行)

**端点清单**（prefix `/api/conversation-fold`）：

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/sessions/{id}/messages` | 添加消息 |
| GET | `/sessions/{id}/messages` | 列出消息 |
| POST | `/sessions/{id}/fold` | 触发折叠（可指定 trigger / strategy / keep_recent） |
| POST | `/sessions/{id}/auto-fold` | 自动判断并折叠 |
| GET | `/sessions/{id}/folds` | 折叠历史 |
| GET | `/sessions/{id}/folds/{fold_id}` | 单个折叠详情 |
| GET | `/sessions/{id}/folds/{fold_id}/messages` | 折叠范围内的原始消息 |
| POST | `/sessions/{id}/folds/{fold_id}/restore` | 恢复折叠 |
| GET | `/sessions/{id}/stats` | session 统计 |
| PUT | `/sessions/{id}/config` | 更新配置 |
| GET | `/sessions` | 列出所有 session |

**Pydantic 数据模型**：`AddMessageRequest`、`FoldRequest`、`RestoreRequest`、`ConfigUpdateRequest`、`MessageListResponse`、`FoldListResponse`、`SessionStatsResponse`

### 3. 主应用注册（1 处修改）

#### 3.1 `backend/app/main.py`（新增 3 行）

```python
# v6.32.3 Cycle 61 G61-08：注册 Conversation Folding API 路由（对话流自动折叠）
from .api.conversation_folding import router as conversation_fold_router
app.include_router(conversation_fold_router, prefix="/api", tags=["conversation-fold"])
```

### 4. 单元测试（1 个新测试文件，36/36 通过）

#### 4.1 `backend/tests/test_conversation_folding.py` (469 行)

**测试覆盖**：

| 测试类 | 测试数 | 覆盖范围 |
|--------|--------|----------|
| `TestFoldConfig` | 2 | 默认值 / to_dict 序列化 |
| `TestFoldedMessage` | 2 | 默认值 / to_dict 序列化 |
| `TestConversationMessage` | 2 | 默认值 / to_dict 序列化 |
| `TestFoldResult` | 2 | 默认值 / to_dict 序列化 |
| `TestSimpleSummaryGenerator` | 3 | 用户/助手消息统计 / 空消息处理 |
| `TestLLMSummaryGenerator` | 3 | 无 LLM fallback / LLM 注入 / 异常降级 |
| `TestConversationFoldingManager` | 6 | add_message / get_active / get_total_tokens / should_fold 三种触发条件 |
| `TestFoldOperation` | 6 | 消息过少 / LLM 摘要 / 截断 / KEEP_HEAD / KEEP_TAIL / KEEP_BOTH / keep_recent 行为 |
| `TestAutoFold` | 2 | 自动触发条件 |
| `TestFoldHistory` | 4 | 列出 / 恢复 / 折叠消息查询 / fold 不存在 |
| `TestSessionStats` | 1 | 完整统计字段验证 |
| `TestPersistence` | 1 | save/load roundtrip |
| `TestGlobalManager` | 1 | 单例验证 |
| **合计** | **36** | **全部通过** |

### 5. 关键修复

#### 5.1 KEEP_HEAD/KEEP_TAIL/KEEP_BOTH 策略语义修复

**问题**：`test_fold_with_keep_tail` 期望摘要包含 `m4`（整个对话流的最后一条），但原实现 `to_fold[-1]` 取到的是折叠范围的尾部 `m2`。

**根因**：原实现以 `to_fold`（要折叠的范围）为锚点，与测试期望（以整个 `active` 对话流为锚点）不一致。

**修复**：改为基于整个 `active` 对话流首尾消息生成摘要锚点：
```python
# 修复前
elif cfg.strategy == FoldStrategy.KEEP_TAIL:
    summary = to_fold[-1].content[:cfg.summary_max_tokens * 4]

# 修复后
elif cfg.strategy == FoldStrategy.KEEP_TAIL:
    # 保留整个对话的最后一条（最新消息）作为摘要锚点
    summary = active[-1].content[:cfg.summary_max_tokens * 4]
```

**语义说明**：
- `LLM_SUMMARY` / `TRUNCATE`：基于 `to_fold`（折叠范围）生成摘要
- `KEEP_HEAD` / `KEEP_TAIL` / `KEEP_BOTH`：基于整个 `active` 对话流边界（首/尾）作为摘要锚点

**验证**：`pytest tests/test_conversation_folding.py::TestFoldOperation -v` → 7/7 通过

### 6. 接口示例

**添加消息 + 触发折叠**：
```bash
curl -X POST http://localhost:8000/api/conversation-fold/sessions/sess-001/messages \
  -H "Content-Type: application/json" \
  -d '{"role":"user","content":"hello","tokens":10}'

curl -X POST http://localhost:8000/api/conversation-fold/sessions/sess-001/fold \
  -H "Content-Type: application/json" \
  -d '{"trigger":"manual","keep_recent":5,"strategy":"llm_summary"}'
```

**响应**：
```json
{
  "success": true,
  "result": {
    "success": true,
    "session_id": "sess-001",
    "folded_count": 3,
    "fold_id": "fold-abc123",
    "summary": "AI 生成的对话摘要...",
    "strategy": "llm_summary",
    "tokens_before": 150,
    "tokens_after": 40
  }
}
```

### 7. 复用声明

- **可复用片段**：
  - `SimpleSummaryGenerator` 启发式摘要生成（提取用户问题数 + 助手回复数）—— 适用于任何对话系统
  - `ConversationFoldingManager` 多 session 隔离 + 锁机制 —— 可复用到任何需要"长对话压缩"功能的系统
  - 5 种折叠策略的 trait-based 设计 —— 可适配其他 RAG / 上下文管理场景
- **触发条件**：当对话流超过 LLM context 长度、或用户希望查看"长对话精华"时启用
- **适配建议**：在生产环境中需注入真实 LLM 调用函数（通过 `LLMSummaryGenerator.set_llm_call`）

### 8. 依赖与集成

- **无新增 Python 依赖**：仅使用 `asyncio` / `dataclasses` / `enum` / `uuid` / `json`（项目已有）
- **前端集成**：通过 `/api/conversation-fold/*` REST 端点，前端可独立开发
- **数据库集成**：当前使用 JSON 文件持久化（`set_storage_dir`），生产环境可替换为 SQLAlchemy ORM（接口已预留）

### 9. 测试报告

```text
============================= test session starts ==============================
platform linux -- Python 3.10.12, pytest-9.1.0, pluggy-1.6.0
collected 36 items

tests/test_conversation_folding.py::TestFoldConfig::test_default_values PASSED
tests/test_conversation_folding.py::TestFoldConfig::test_to_dict PASSED
tests/test_conversation_folding.py::TestFoldedMessage::test_default_values PASSED
tests/test_conversation_folding.py::TestFoldedMessage::test_to_dict PASSED
tests/test_conversation_folding.py::TestConversationMessage::test_default_values PASSED
tests/test_conversation_folding.py::TestConversationMessage::test_to_dict PASSED
tests/test_conversation_folding.py::TestFoldResult::test_default_values PASSED
tests/test_conversation_folding.py::TestFoldResult::test_to_dict PASSED
tests/test_conversation_folding.py::TestSimpleSummaryGenerator::test_summarize_user_messages PASSED
tests/test_conversation_folding.py::TestSimpleSummaryGenerator::test_summarize_assistant_messages PASSED
tests/test_conversation_folding.py::TestSimpleSummaryGenerator::test_summarize_empty PASSED
tests/test_conversation_folding.py::TestLLMSummaryGenerator::test_fallback_when_no_llm PASSED
tests/test_conversation_folding.py::TestLLMSummaryGenerator::test_uses_llm_when_set PASSED
tests/test_conversation_folding.py::TestLLMSummaryGenerator::test_fallback_on_llm_error PASSED
tests/test_conversation_folding.py::TestConversationFoldingManager::test_add_message PASSED
tests/test_conversation_folding.py::TestConversationFoldingManager::test_get_active_messages PASSED
tests/test_conversation_folding.py::TestConversationFoldingManager::test_get_total_tokens PASSED
tests/test_conversation_folding.py::TestConversationFoldingManager::test_should_fold_by_count PASSED
tests/test_conversation_folding.py::TestConversationFoldingManager::test_should_fold_by_tokens PASSED
tests/test_conversation_folding.py::TestConversationFoldingManager::test_should_not_fold_when_disabled PASSED
tests/test_conversation_folding.py::TestFoldOperation::test_fold_too_few_messages PASSED
tests/test_conversation_folding.py::TestFoldOperation::test_fold_with_llm_summary PASSED
tests/test_conversation_folding.py::TestFoldOperation::test_fold_with_truncate PASSED
tests/test_conversation_folding.py::TestFoldOperation::test_fold_with_keep_head PASSED
tests/test_conversation_folding.py::TestFoldOperation::test_fold_with_keep_tail PASSED
tests/test_conversation_folding.py::TestFoldOperation::test_fold_with_keep_both PASSED
tests/test_conversation_folding.py::TestFoldOperation::test_fold_keeps_recent PASSED
tests/test_conversation_folding.py::TestAutoFold::test_auto_fold_when_needed PASSED
tests/test_conversation_folding.py::TestAutoFold::test_auto_fold_not_needed PASSED
tests/test_conversation_folding.py::TestFoldHistory::test_list_folds PASSED
tests/test_conversation_folding.py::TestFoldHistory::test_restore_fold PASSED
tests/test_conversation_folding.py::TestFoldHistory::test_get_folded_messages PASSED
tests/test_conversation_folding.py::TestFoldHistory::test_get_fold_not_found PASSED
tests/test_conversation_folding.py::TestSessionStats::test_stats PASSED
tests/test_conversation_folding.py::TestPersistence::test_save_and_load PASSED
tests/test_conversation_folding.py::TestGlobalManager::test_singleton PASSED

============================== 36 passed in 0.30s ==============================
```

### 10. 状态

- ✅ **代码实现** - 647 + 216 + 469 = 1332 行（含注释）
- ✅ **单元测试** - 36/36 通过
- ✅ **接口注册** - main.py 已挂载
- ✅ **Git 提交** - `36563ee` 推送到 `feature/g61-01-claude-cli-subprocess`
- 🟡 **端到端验证** - 等待 Phase F.3 TRAE-browseruse 验证
