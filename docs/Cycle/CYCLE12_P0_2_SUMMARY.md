# Cycle 12 P0-2 /goal 长时域模式 - 总结报告

## 概述

完成 Hermes 智能体调度平台的 **/goal 长时域模式**（Cycle 12 P0-2），实现 Codex v0.128+ 风格的持久化目标系统，支持 **Three-File Trust 架构**（GOAL.md / VERIFY.md / PROGRESS.md）。

## 版本

**v6.19.0** - 2026-07-28

## 核心能力

### 1. 数据模型 (`app/core/goal/base.py`)
- **Goal**: 主实体（id/title/objective/acceptance_criteria/constraints/token_budget/status/tags）
- **AcceptanceCriterion**: 验收标准（id/title/description/status/priority/verify_items）
- **TokenBudget**: Token 预算（soft_limit/hard_limit/used/warning_threshold）+ 状态判定（warning/soft_stop/hard_stop）
- **GoalStatus**: 状态机（draft/active/paused/completed/failed/abandoned）
- **AcceptanceStatus**: AC 状态（pending/in_progress/passed/failed/skipped）
- **VerifyType**: 验证类型（test/command/file_exists/file_contains/custom）

### 2. 验证项 (`app/core/goal/verify_item.py`)
- **VerifyItem**: 单个验证项（id/title/description/verify_type/target/expected/timeout/retry_count/status）
- **VerifyResult**: 单次执行结果（exit_code/stdout/stderr/duration_ms/error_message）
- **VerifyReport**: 批量验证报告（total/passed/failed/skipped/errored/pass_rate）

### 3. 进度跟踪 (`app/core/goal/progress.py`)
- **ProgressEntry**: 进度条目（timestamp/status/ac_id/action/tokens_used/duration_ms/notes）
- **ProgressAction**: 单个动作（description/target/result）
- **ProgressLog**: 进度日志（entries 列表 + 过滤方法）
- **ProgressStatus**: 11 种状态（info/started/in_progress/completed/failed/blocked/retry/paused/resumed/warning/error）

### 4. 目标管理 (`app/core/goal/manager.py`)
- **GoalManager**: 核心服务
  - CRUD: create/get/list/update/delete
  - 状态机: transition/start/pause/resume/complete/fail/abandon（含 ALLOWED_TRANSITIONS 规则）
  - AC 管理: add/update
  - 验证项管理: add/list/update
  - 进度管理: add/get
  - Token 预算: add_tokens/check_budget
  - 统计: get_stats
  - 持久化: JSONL 索引 + 独立文件
  - 线程安全: RLock 保护

### 5. 验证执行器 (`app/core/goal/verifier.py`)
- **Verifier**: 5 种验证类型
  - COMMAND: shell 命令执行（带白名单）
  - TEST: pytest 测试
  - FILE_EXISTS: 文件存在
  - FILE_CONTAINS: 文件包含
  - CUSTOM: 自定义（默认跳过）
- **安全性**: 路径白名单（9 规则）+ 命令白名单（19 规则）
- **特性**: 超时控制、错误捕获、报告生成

### 6. Markdown 渲染 (`app/core/goal/markdown.py`)
- **render_goal_md()**: 渲染 GOAL.md
- **render_verify_md()**: 渲染 VERIFY.md（按 AC 分组）
- **render_progress_md()**: 渲染 PROGRESS.md（带 emoji）
- **parse_goal_md()**: 解析 GOAL.md

### 7. REST API (`app/api/goal.py`) - 24 个端点
- `GET /api/goal/health` - 健康检查
- `POST /api/goal/goals` - 创建 Goal
- `GET /api/goal/goals` - 列出 Goal（status/tag/owner 过滤）
- `GET /api/goal/goals/{goal_id}` - Goal 详情
- `PUT /api/goal/goals/{goal_id}` - 更新 Goal
- `DELETE /api/goal/goals/{goal_id}` - 删除 Goal
- `POST /api/goal/goals/{goal_id}/start` - 启动
- `POST /api/goal/goals/{goal_id}/pause` - 暂停
- `POST /api/goal/goals/{goal_id}/resume` - 恢复
- `POST /api/goal/goals/{goal_id}/complete` - 完成（需所有 AC 通过）
- `POST /api/goal/goals/{goal_id}/fail` - 失败
- `POST /api/goal/goals/{goal_id}/abandon` - 放弃
- `POST /api/goal/goals/{goal_id}/tokens` - 添加 token
- `GET /api/goal/goals/{goal_id}/budget` - 预算状态
- `POST /api/goal/goals/{goal_id}/acceptance` - 添加 AC
- `PUT /api/goal/goals/{goal_id}/acceptance/{ac_id}` - 更新 AC
- `GET /api/goal/goals/{goal_id}/verify` - 列出验证项
- `POST /api/goal/goals/{goal_id}/verify` - 添加验证项
- `POST /api/goal/goals/{goal_id}/verify/run` - 执行所有验证
- `PUT /api/goal/goals/{goal_id}/verify/{item_id}` - 更新验证项
- `GET /api/goal/goals/{goal_id}/progress` - 获取进度
- `POST /api/goal/goals/{goal_id}/progress` - 添加进度
- `GET /api/goal/goals/{goal_id}/markdown/{file_type}` - 渲染 Markdown
- `GET /api/goal/stats` - 统计信息

## Three-File Trust 架构

```
┌─────────────┐
│  GOAL.md    │  目标定义：Objective + Acceptance Criteria + Constraints + Token Budget
└──────┬──────┘
       ↓ 每个 AC 对应一个 verify item
┌─────────────┐
│  VERIFY.md  │  验证清单：test/command/file_exists/file_contains + expected
└──────┬──────┘
       ↓ 每次执行产生一条 Progress Entry
┌─────────────┐
│ PROGRESS.md │  进度记录：时间线 + 状态 + Token 消耗 + 备注
└─────────────┘
```

**核心原则**：任何要求都可以从 GOAL 通过 VERIFY 中对应检查追溯到 PROGRESS 中记录的结果。

## 测试结果

### 单元测试
- 文件: `tests/test_goal_units.py`
- 数量: 60 个测试用例
- 覆盖: 数据模型/TokenBudget/AC/GoalManager/状态机/VerifyItem/Verifier/Markdown/Progress
- 通过率: 100% (60/60)

### E2E 测试
- 文件: `tests/test_e2e_goal.sh`
- 数量: 76 个断言
- 覆盖: health/CRUD/状态机/Token/AC/Verify/Progress/Markdown/错误处理/完整流程
- 通过率: 100% (76/76)

### 总计
- 单元测试: 60/60 ✓
- E2E 测试: 76/76 ✓
- 总断言: 136/136 ✓
- 通过率: 100%

## 关键设计

### 1. 状态机严格性
- 6 个状态 + ALLOWED_TRANSITIONS 规则
- 禁止跳跃式转移（如 DRAFT → COMPLETED）
- 失败状态可重试（FAILED → ACTIVE）

### 2. Token 预算
- 三级阈值：warning（35K）/ soft stop（40K）/ hard stop（60K）
- 软停止：记录警告但允许继续
- 硬停止：触发警告，建议暂停
- 自动写入 PROGRESS.md

### 3. 独立验证器
- 与主 Agent 独立上下文
- 自动 AC 状态更新（PASSED → AC 标记 in_progress）
- 报告自动写 PROGRESS

### 4. 持久化
- 索引：JSONL（启动快速加载）
- Goal：单文件 JSON
- Progress：JSONL append-only
- Verify items：单文件 JSON
- 存储位置：`~/.hermes/goals/`

### 5. 安全性
- 路径白名单：9 规则
- 命令白名单：19 规则
- 超时控制：默认 60s
- 错误隔离：单 verify 失败不影响整体

## 依赖与版本变化

### 新增文件
- `backend/app/core/goal/__init__.py`
- `backend/app/core/goal/base.py` (5.5KB)
- `backend/app/core/goal/verify_item.py` (4KB)
- `backend/app/core/goal/progress.py` (3.5KB)
- `backend/app/core/goal/manager.py` (15KB)
- `backend/app/core/goal/verifier.py` (8KB)
- `backend/app/core/goal/markdown.py` (6KB)
- `backend/app/api/goal.py` (450 行)
- `tests/test_goal_units.py` (60 用例)
- `tests/test_e2e_goal.sh` (76 断言)

### 修改文件
- `backend/app/api/__init__.py` - 添加 /goal 路由注册 v6.19.0

## 使用方法

### 创建 Goal

```bash
curl -X POST http://localhost:8765/api/goal/goals \
    -H "Content-Type: application/json" \
    -d '{
        "title": "实现用户认证模块",
        "objective": "JWT 签发、刷新令牌、密码重置",
        "constraints": ["使用 bcrypt 哈希", "HTTP-only cookie"],
        "token_budget": {"soft_limit": 40000, "hard_limit": 60000},
        "acceptance_criteria": [
            {"title": "AC1: 用户注册", "priority": 5},
            {"title": "AC2: JWT 签发", "priority": 5}
        ]
    }'
```

### 启动并执行

```bash
# 启动
curl -X POST http://localhost:8765/api/goal/goals/$GOAL_ID/start

# 添加 token
curl -X POST http://localhost:8765/api/goal/goals/$GOAL_ID/tokens \
    -d '{"count": 5000}'

# 添加验证项
curl -X POST http://localhost:8765/api/goal/goals/$GOAL_ID/verify \
    -d '{"title": "AC1 verify", "verify_type": "test", "target": "pytest tests/auth/test_register.py"}'

# 执行验证
curl -X POST http://localhost:8765/api/goal/goals/$GOAL_ID/verify/run

# 标记 AC 通过
curl -X PUT http://localhost:8765/api/goal/goals/$GOAL_ID/acceptance/$AC_ID \
    -d '{"status": "passed"}'

# 完成
curl -X POST http://localhost:8765/api/goal/goals/$GOAL_ID/complete
```

### 渲染 Markdown

```bash
# GOAL.md
curl http://localhost:8765/api/goal/goals/$GOAL_ID/markdown/goal

# VERIFY.md
curl http://localhost:8765/api/goal/goals/$GOAL_ID/markdown/verify

# PROGRESS.md
curl http://localhost:8765/api/goal/goals/$GOAL_ID/markdown/progress
```

## 后续计划

### Cycle 12 P1-7: Plugin 市场 UI
- 前端 Plugin 管理面板
- 启用/禁用开关
- 详细信息展示
- 安装向导

### Cycle 12 P1-8: /goal 前端 UI
- Goal 管理面板
- 状态切换按钮
- Token 预算仪表盘
- Three-File Trust 可视化

### Cycle 12 P1-9: Goal Checkpoint 机制
- 自动检查点（每 N tokens）
- 恢复机制
- 时间旅行调试
