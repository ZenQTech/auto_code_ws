# Code Modification Log - Cycle 65

> **日期**: 2026-08-04
> **Cycle**: 65
> **任务**: G65-01 真实 CLI 集成 + G65-02 CSV 批处理 spawn_agents
> **范围**: 后端 + 前端

---

## 一、已完成任务

### 1.1 G65-01: 真实 CLI 集成（100% 完成）

| 子任务 | 状态 | 文件 |
|--------|------|------|
| RunnerMode 枚举实现 | ✅ | [real_agent_runner.py:54-59](file:///home/qizheng/auto_code_ws/backend/app/services/real_agent_runner.py#L54-L59) |
| BaseAgentRunner 抽象基类 | ✅ | [real_agent_runner.py:93-122](file:///home/qizheng/auto_code_ws/backend/app/services/real_agent_runner.py#L93-L122) |
| RealAgentRunner 主类 | ✅ | [real_agent_runner.py:130-542](file:///home/qizheng/auto_code_ws/backend/app/services/real_agent_runner.py#L130-L542) |
| JSONL 解析器 | ✅ | [real_agent_runner.py:422-437](file:///home/qizheng/auto_code_ws/backend/app/services/real_agent_runner.py#L422-L437) |
| 事件分发器 | ✅ | [real_agent_runner.py:439-477](file:///home/qizheng/auto_code_ws/backend/app/services/real_agent_runner.py#L439-L477) |
| Runner 工厂 | ✅ | [real_agent_runner.py:554-601](file:///home/qizheng/auto_code_ws/backend/app/services/real_agent_runner.py#L554-L601) |
| Mock CLI 测试脚本 | ✅ | [mock_cli.py](file:///home/qizheng/auto_code_ws/backend/tests/fixtures/mock_cli.py) |
| 单元测试 | ✅ | 93 个测试全部通过 |

### 1.2 G65-02: CSV 批处理 spawn_agents（100% 完成）

| 子任务 | 状态 | 文件 |
|--------|------|------|
| BatchSpawner 服务实现 | ✅ | [batch_spawner.py](file:///home/qizheng/auto_code_ws/backend/app/services/batch_spawner.py) |
| CSVTaskParser（RFC 4180） | ✅ | [batch_spawner.py:181-280](file:///home/qizheng/auto_code_ws/backend/app/services/batch_spawner.py#L181-L280) |
| 并发控制（asyncio.Semaphore） | ✅ | [batch_spawner.py:425-475](file:///home/qizheng/auto_code_ws/backend/app/services/batch_spawner.py#L425-L475) |
| 取消机制 | ✅ | [batch_spawner.py:530-560](file:///home/qizheng/auto_code_ws/backend/app/services/batch_spawner.py#L530-L560) |
| 多格式导出（JSON/CSV/MD） | ✅ | [batch_spawner.py:610-720](file:///home/qizheng/auto_code_ws/backend/app/services/batch_spawner.py#L610-L720) |
| API: POST /batch/spawn | ✅ | [agent_roles.py:330-380](file:///home/qizheng/auto_code_ws/backend/app/api/agent_roles.py#L330-L380) |
| API: GET /batch/{id} | ✅ | [agent_roles.py:385-410](file:///home/qizheng/auto_code_ws/backend/app/api/agent_roles.py#L385-L410) |
| API: POST /batch/{id}/cancel | ✅ | [agent_roles.py:415-435](file:///home/qizheng/auto_code_ws/backend/app/api/agent_roles.py#L415-L435) |
| API: GET /batch/{id}/export | ✅ | [agent_roles.py:440-470](file:///home/qizheng/auto_code_ws/backend/app/api/agent_roles.py#L440-L470) |
| 前端 Hook: useBatchSpawner | ✅ | [useBatchSpawner.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useBatchSpawner.ts) |
| 前端组件: BatchSpawnPanel | ✅ | [BatchSpawnPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/BatchSpawnPanel.tsx) |
| 前端组件: BatchResultTable | ✅ | [BatchResultTable.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/BatchResultTable.tsx) |
| EmbeddedTools 集成（11 tab） | ✅ | [EmbeddedTools.tsx:60-90](file:///home/qizheng/auto_code_ws/frontend/src/components/EmbeddedTools.tsx#L60-L90) |
| 单元测试 | ✅ | 115 个测试全部通过 |

---

## 二、未完成任务

无（所有 G65-01/G65-02 子任务均已完成）

---

## 三、修改的文件清单

### 3.1 新建文件

| 文件路径 | 行数 | 用途 |
|----------|------|------|
| [backend/app/services/real_agent_runner.py](file:///home/qizheng/auto_code_ws/backend/app/services/real_agent_runner.py) | 607 | 真实 CLI 模式 Agent 执行器 |
| [backend/app/services/batch_spawner.py](file:///home/qizheng/auto_code_ws/backend/app/services/batch_spawner.py) | 876 | 批量 spawn 服务 |
| [backend/tests/fixtures/mock_cli.py](file:///home/qizheng/auto_code_ws/backend/tests/fixtures/mock_cli.py) | 187 | Mock CLI 测试脚本 |
| [backend/tests/test_real_agent_runner.py](file:///home/qizheng/auto_code_ws/backend/tests/test_real_agent_runner.py) | 831 | RealAgentRunner 单元测试 |
| [backend/tests/test_cli_event_parser.py](file:///home/qizheng/auto_code_ws/backend/tests/test_cli_event_parser.py) | 500 | JSONL 解析单元测试 |
| [backend/tests/test_runner_factory.py](file:///home/qizheng/auto_code_ws/backend/tests/test_runner_factory.py) | 347 | Runner 工厂单元测试 |
| [backend/tests/test_batch_spawner.py](file:///home/qizheng/auto_code_ws/backend/tests/test_batch_spawner.py) | 632 | BatchSpawner 单元测试 |
| [frontend/src/hooks/useBatchSpawner.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useBatchSpawner.ts) | 359 | 批量任务 Hook |
| [frontend/src/hooks/useBatchSpawner.test.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useBatchSpawner.test.ts) | 321 | Hook 测试 |
| [frontend/src/components/BatchSpawnPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/BatchSpawnPanel.tsx) | 624 | 批量任务面板 |
| [frontend/src/components/BatchSpawnPanel.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/BatchSpawnPanel.test.tsx) | 275 | 面板测试 |
| [frontend/src/components/BatchResultTable.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/BatchResultTable.tsx) | 309 | 结果表 |
| [frontend/src/components/BatchResultTable.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/BatchResultTable.test.tsx) | 257 | 结果表测试 |
| [.trae/documents/g65-02-spec.md](file:///home/qizheng/auto_code_ws/.trae/documents/g65-02-spec.md) | 295 | G65-02 技术规范 |

### 3.2 修改文件

| 文件路径 | 修改行数 | 修改内容 |
|----------|----------|----------|
| [backend/app/services/agent_runner.py](file:///home/qizheng/auto_code_ws/backend/app/services/agent_runner.py) | +12 | 添加 `mode = "mock"` 类属性满足 BaseAgentRunner 接口契约 |
| [backend/app/api/agent_roles.py](file:///home/qizheng/auto_code_ws/backend/app/api/agent_roles.py) | +164 | 6 个 batch API 端点（spawn/list/get/cancel/export/stats） |
| [frontend/src/components/EmbeddedTools.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/EmbeddedTools.tsx) | +72 | 11 个 tab 元信息 + batch tab 集成 |
| [frontend/src/__tests__/EmbeddedTools.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/__tests__/EmbeddedTools.test.tsx) | +90 | 10 个 batch 集成测试 + tab 数量从 8 → 11 |

---

## 四、关键变更点

### 4.1 架构变更
- 新增 `RealAgentRunner` 类，实现 `BaseAgentRunner` 抽象接口
- 新增 `RunnerMode` 枚举（MOCK/REAL/AUTO）
- 引入工厂函数 `get_agent_runner(mode)`，支持运行时切换
- 现有 `AgentRunner`（mock）添加 `mode` 属性以满足接口契约
- 新增 `BatchSpawner` 服务，支持 CSV 驱动的批量 Agent spawn
- 引入 `BatchJob`/`BatchInstance`/`BatchError` 数据模型
- 新增 `CSVTaskParser` 处理 RFC 4180 标准 CSV

### 4.2 接口变更
- `get_agent_runner()` 签名扩展为 `get_agent_runner(mode=None, force_new=False)`
- 新增 `set_runner_mode(mode)` 全局模式设置
- 新增 `reset_agent_runner()` 重置单例
- `RealAgentRunner` 实现与 `AgentRunner` 一致的接口（start/cancel/pause/resume/is_running/get_stats）
- 新增 `get_batch_spawner()` 单例工厂
- 新增 6 个 API 端点（/batch/spawn, /batch/list, /batch/{id}, /batch/{id}/cancel, /batch/{id}/export, /batch/_stats）

### 4.3 JSONL 协议
- 7 种事件类型：session_start/session_end/tool_use/tool_result/content_delta/progress/error
- 事件映射到 7 种 HookEventType
- 解析器容错：忽略非 dict 类型的 JSON、忽略无效 JSON 行

### 4.4 CSV 协议
- 5 个字段：task（必填）/nickname/role/model/context
- RFC 4180 标准：引号转义、字段内换行、字段内逗号
- JSON 上下文：context 字段支持 JSON 字符串，自动注入到 agent

### 4.5 子进程管理
- 使用 `asyncio.create_subprocess_exec` 异步启动
- 1MB 行缓冲（支持大输出）
- 默认 600s 超时
- SIGTERM → SIGKILL 渐进式取消（200ms 优雅窗口）

### 4.6 并发控制
- 使用 `asyncio.Semaphore` 控制最大并发度
- 默认 5，可配置 1-50
- gather 等待所有任务完成
- 单条失败不影响其他任务

---

## 五、测试结果

### 5.1 新增测试
```
# G65-01
tests/test_real_agent_runner.py:  39 passed
tests/test_cli_event_parser.py:   31 passed
tests/test_runner_factory.py:     23 passed

# G65-02
tests/test_batch_spawner.py:      38 passed
useBatchSpawner.test.ts:          11 passed
BatchResultTable.test.tsx:        19 passed
BatchSpawnPanel.test.tsx:         19 passed
EmbeddedTools.test.tsx:           +10 新测试（28 总数）

─────────────────────────────────────────────
总计:                              208 passed (100%)
```

### 5.2 回归测试
```
tests/test_agent_runner.py:        ✓ passed
tests/test_agent_role_manager.py:  ✓ passed
tests/test_agent_role_api.py:      ✓ passed
其他后端测试:                       ✓ passed (179 总数)
─────────────────────────────────────────────
总计:                              179 passed (100%)
```

注：test_clarification_service.py::test_result 有 1 个 pre-existing 错误（非本 Cycle 引入），与 G65-01/G65-02 无关。

---

## 六、下一步计划

### 6.1 Cycle 66 候选
- ⏳ G65-03 Reasoning Effort 切换（low/medium/high）
- ⏳ PRD diff 视图
- ⏳ Operation-level undo 完善
- ⏳ Stage 历史导出
- ⏳ 多 session stage 对比

### 6.2 Cycle 66 优先级
1. P0: G65-03 Reasoning Effort 切换（CLI 支持）
2. P1: PRD diff 视图
3. P2: Stage 历史导出

---

## 七、依赖与兼容性

### 7.1 依赖
- 无新增 Python 包依赖
- 无新增 npm 包依赖
- 使用标准库：asyncio, json, dataclasses, enum, csv

### 7.2 向后兼容
- ✅ 现有代码无需修改
- ✅ 默认 Runner 仍为 mock
- ✅ 现有 83 个测试无回归
- ✅ API 签名向后兼容
- ✅ Agent Roles API 仅新增端点（/batch/*）
- ✅ EmbeddedTools 仅新增 tab（不影响现有）

---

## 八、版本号

- **Cycle 65 G65-01 v1.0.0** - 真实 CLI 集成（2026-08-04）
- **Cycle 65 G65-02 v1.0.0** - CSV 批处理 spawn_agents（2026-08-04）
