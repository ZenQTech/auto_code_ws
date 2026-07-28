# P1-10 Verification Loop - 验证闭环机制

> **任务 ID**: P1-10
> **关联阶段**: Cycle 10 - Loop Engineering 闭环
> **版本**: v1.0.0
> **日期**: 2026-07-28
> **来源**: Codex v0.145+ Verification Loop + TRAE Solo v3.5.79+ Auto-Verify + 自主开发需求

---

## 一、功能需求

### 1.1 目标

实现代码修改后自动验证闭环机制，确保：
- 每次代码变更（commit / push / PR）后自动触发多维度验证
- 失败自动分析根因 + 调用对应 Agent 修复 + 重新验证
- 验证通过前不允许合并到主分支
- 支持安全 / 功能 / 性能 / 兼容性四类验证维度
- 与现有 WorkflowEngine、AtomicTaskAggregator、CommitHookHandler 深度集成

### 1.2 用户场景

**场景 1：commit 触发自动验证**
- 开发者完成代码修改后执行 `git commit`
- CommitHook 接收事件 → 触发 Verification Loop
- 自动运行：unit tests + e2e tests + type check + lint
- 全部通过 → 允许 commit
- 任一失败 → 自动调用对应 agent 修复 + re-verify（最多 3 次）
- 3 次仍失败 → 人工接管 + 通知

**场景 2：PR 创建触发集成验证**
- 开发者创建 PR
- Verification Loop 启动：跨模块集成测试 + 性能基准 + 安全扫描
- 集成问题 → 调用 fix agent 重新设计
- 性能退化 > 5% → 调用 optimize agent 优化
- 安全漏洞 → 强制修复（高风险模块零容忍）

**场景 3：定时全量回归**
- 夜间 cron 触发 → Verification Loop 全量回归
- 跨项目全链路测试（E2E + 性能 + 安全）
- 生成回归报告
- 异常自动创建 issue 跟踪

### 1.3 核心特性

| 特性 | 描述 | 优先级 |
|------|------|--------|
| **4 维度验证矩阵** | syntax / module / integration / performance | P0 |
| **失败自动修复** | 错误分类 + agent 路由 + retry 循环 | P0 |
| **安全零容忍** | 高风险模块 safety verification 强制通过 | P0 |
| **性能基准对比** | 基线对比 + 退化告警 | P1 |
| **定时回归** | cron + 手动触发 | P1 |
| **报告生成** | Markdown / JSON / HTML 多格式 | P1 |
| **钉钉/飞书通知** | 验证完成/失败实时推送 | P2 |

---

## 二、技术实现方案

### 2.1 架构

```
                  ┌─────────────────────────────────┐
                  │   Verification Loop Controller  │
                  │   (FastAPI 后端服务)              │
                  └─────────────┬───────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
  ┌──────────┐           ┌──────────┐           ┌──────────┐
  │ Trigger  │           │ Verifier │           │ Reporter │
  │ Manager  │           │ Pool     │           │          │
  └──────────┘           └──────────┘           └──────────┘
        │                       │                       │
   ┌────┴────┐                  │                  ┌────┴────┐
   │ commit  │                  │                  │  Markdown│
   │ PR cron │                  │                  │  JSON   │
   │ manual  │                  │                  │  HTML   │
   └─────────┘                  │                  └─────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   ┌─────────┐            ┌─────────┐            ┌─────────┐
   │Syntax   │            │Module   │            │Integration│
   │Verifier │            │Verifier │            │ Verifier │
   └─────────┘            └─────────┘            └─────────┘
        │                       │                       │
   - tsc --noEmit        - pytest                 - e2e test
   - eslint              - go test                - perf test
   - mypy                - cargo test             - safety
```

### 2.2 核心数据模型

```python
# VerificationTask 验证任务
@dataclass
class VerificationTask:
    task_id: str                     # 任务ID
    trigger: str                     # 触发源: commit / pr / cron / manual
    commit_sha: str                  # commit hash
    project_path: str                # 项目路径
    dimensions: List[str]            # 验证维度列表
    status: str                      # pending / running / passed / failed
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    retry_count: int = 0
    error_message: Optional[str] = None

# VerificationResult 单维度验证结果
@dataclass
class VerificationResult:
    dimension: str                   # syntax / module / integration / performance
    status: str                      # passed / failed / skipped
    duration_seconds: float
    total_checks: int
    passed_checks: int
    failed_checks: int
    output: str                      # 完整输出
    error_details: List[str]         # 失败详情
    artifacts: List[str]             # 产物（报告、截图等）

# FixAction 自动修复动作
@dataclass
class FixAction:
    action_id: str
    error_type: str                  # test_failure / type_error / lint_error
    error_signature: str             # 错误签名（用于去重）
    agent_invoked: str               # 调用的 agent 名称
    fix_strategy: str                # 修复策略
    status: str                      # running / succeeded / failed
    result_summary: str
```

### 2.3 API 设计

#### 2.3.1 REST 端点

| Method | Path | 描述 |
|--------|------|------|
| POST | `/api/verification/tasks` | 创建验证任务 |
| GET | `/api/verification/tasks` | 列出任务 |
| GET | `/api/verification/tasks/{id}` | 任务详情 |
| POST | `/api/verification/tasks/{id}/run` | 立即执行 |
| POST | `/api/verification/tasks/{id}/cancel` | 取消任务 |
| POST | `/api/verification/tasks/{id}/retry` | 重试 |
| GET | `/api/verification/results/{task_id}` | 获取结果 |
| GET | `/api/verification/baselines` | 性能基线列表 |
| POST | `/api/verification/baselines` | 创建基线 |
| GET | `/api/verification/stats` | 统计信息 |
| GET | `/api/verification/health` | 健康检查 |

#### 2.3.2 Webhook 触发

```json
POST /api/verification/webhook/git
Headers: X-Git-Event: push
Body: {
  "repository": "hermes-platform",
  "commit": "abc123def",
  "branch": "main",
  "author": "user@example.com",
  "message": "fix: handle memory edge case"
}
```

### 2.4 验证执行流程

```
1. 接收触发事件 (commit / PR / cron / manual)
   ↓
2. 创建 VerificationTask (status: pending)
   ↓
3. 启动后台 worker
   ↓
4. 并行执行 4 维度验证:
   - syntax: tsc --noEmit / eslint / mypy
   - module: pytest --cov / go test / cargo test
   - integration: e2e tests
   - performance: bench + compare baseline
   ↓
5. 收集结果 → 生成 VerificationResult
   ↓
6. 判断总体状态:
   - 全部通过 → status: passed → 触发 push / merge
   - 任一失败 → status: failed → 触发自动修复流程
   ↓
7. 自动修复流程 (最多 3 次):
   - 解析错误 → 分类 (test / type / lint / perf)
   - 调用对应 agent (fix / type / lint / optimize)
   - 等待 agent 完成 → 重新执行验证
   ↓
8. 重试 3 次仍失败 → 标记 blocked → 通知人工
   ↓
9. 生成最终报告 (Markdown + JSON + HTML)
   ↓
10. 发送通知 (邮件 / 钉钉 / 飞书)
```

### 2.5 与现有系统集成

| 系统 | 集成方式 |
|------|----------|
| **WorkflowEngine** | 验证完成触发工作流推进 |
| **CommitHookHandler** | 接收 commit 事件 → 触发验证 |
| **AtomicTaskAggregator** | 验证任务作为原子任务加入清单 |
| **Memory System (P1-8)** | 验证失败模式自动写入记忆（self-improvement） |
| **Multi-Agent v2** | 调用 fix/type/lint agent 修复 |
| **L4Singleflight** | 相同 commit SHA 的验证去重 |
| **Custom Models** | 错误分析使用大模型辅助分类 |

---

## 三、接口设计规范

### 3.1 创建验证任务请求

```json
POST /api/verification/tasks
{
  "trigger": "commit",
  "commit_sha": "abc123def456",
  "project_path": "/home/qizheng/auto_code_ws",
  "dimensions": ["syntax", "module", "integration"],
  "priority": "high",
  "metadata": {
    "author": "user@example.com",
    "branch": "main",
    "message": "fix: handle memory edge case"
  }
}
```

### 3.2 验证任务响应

```json
{
  "success": true,
  "task_id": "vt_20260728_abc123def",
  "status": "pending",
  "created_at": "2026-07-28T12:00:00.000000+00:00",
  "estimated_duration_seconds": 120
}
```

### 3.3 任务详情响应

```json
{
  "success": true,
  "task": {
    "task_id": "vt_20260728_abc123def",
    "trigger": "commit",
    "commit_sha": "abc123def456",
    "status": "running",
    "created_at": "2026-07-28T12:00:00.000000+00:00",
    "started_at": "2026-07-28T12:00:01.000000+00:00",
    "retry_count": 0,
    "results": [
      {
        "dimension": "syntax",
        "status": "passed",
        "duration_seconds": 5.2,
        "total_checks": 100,
        "passed_checks": 100,
        "failed_checks": 0
      },
      {
        "dimension": "module",
        "status": "running",
        ...
      }
    ],
    "fix_actions": []
  }
}
```

### 3.4 错误码

| 状态码 | 含义 |
|--------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 404 | 任务不存在 |
| 409 | 任务已存在（幂等冲突） |
| 500 | 内部错误 |
| 503 | 验证 worker 不可用 |

---

## 四、数据结构定义

### 4.1 存储

- **JSONL 文件**: `~/.hermes/verification/tasks.jsonl`
- **SQLite**: 验证结果索引 + 报告元数据
- **对象存储**: 大型测试产物（截图、coverage 报告）

### 4.2 关键字段

```python
# 维度定义
DIMENSIONS = {
    "syntax": {
        "description": "代码语法与类型检查",
        "commands": {
            "python": ["python -m mypy backend/"],
            "typescript": ["cd frontend && npx tsc --noEmit"],
            "rust": ["cargo check"],
        },
        "timeout_seconds": 300,
        "fail_fast": True,  # 失败立即停止
    },
    "module": {
        "description": "模块独立单元测试",
        "commands": {
            "python": ["python -m pytest tests/ -v --cov=app --cov-report=xml"],
            "typescript": ["cd frontend && npm test"],
        },
        "timeout_seconds": 600,
        "fail_fast": False,
    },
    "integration": {
        "description": "跨模块集成 + E2E",
        "commands": {
            "python": ["bash tests/test_e2e_*.sh"],
        },
        "timeout_seconds": 1800,
        "fail_fast": False,
    },
    "performance": {
        "description": "性能基准 + 退化检测",
        "commands": {
            "python": ["python -m pytest tests/benchmarks/ --benchmark-json=output.json"],
        },
        "timeout_seconds": 600,
        "fail_fast": False,
        "baseline_required": True,
    },
}
```

---

## 五、性能与安全要求

### 5.1 性能指标

- **创建任务 P99 延迟**: < 100ms
- **syntax 验证 P99 延迟**: < 30s
- **module 验证 P99 延迟**: < 5min
- **integration 验证 P99 延迟**: < 20min
- **report 生成 P99 延迟**: < 5s
- **存储 1000 任务**: < 100MB 磁盘

### 5.2 安全要求

- **验证命令白名单**: 仅允许预定义命令（防止命令注入）
- **项目路径白名单**: 限制在 4 个工作区目录
- **commit SHA 验证**: 必须为 40 字符 hex
- **结果完整性**: SHA-256 校验和存储
- **敏感信息过滤**: 自动脱敏 API Key / token / 密码

### 5.3 可靠性要求

- **后台 worker 故障**: 自动重启 + 任务重试
- **存储损坏检测**: JSONL 解析失败回退 + 告警
- **超时保护**: 每个维度都有 timeout_seconds 上限
- **幂等性**: 相同 commit SHA + dimensions 不重复执行

---

## 六、验收标准

### 6.1 功能验收

| 维度 | 标准 |
|------|------|
| 任务创建 | 100% 成功（4 种 trigger） |
| 并行执行 | 4 维度同时执行，总时间 ≤ max(各维度时间) |
| 失败自动修复 | 错误分类准确率 ≥ 80% |
| 重试机制 | 最多 3 次 + 间隔递增（1s/5s/15s） |
| 报告生成 | Markdown/JSON/HTML 三种格式均可用 |
| Webhook 集成 | commit 事件触发延迟 < 5s |
| 通知推送 | 失败任务实时推送（5s 内） |

### 6.2 测试要求

- **单元测试覆盖率**: ≥ 90%
- **E2E 测试**: 完整触发 → 验证 → 修复 → 报告链路
- **集成测试**: 与 CommitHook / WorkflowEngine / Memory System 联动
- **性能测试**: 100 任务并发 + 4 维度并行 < 30min
- **安全测试**: 命令注入 / 路径越界 / 越权访问 全部拦截

### 6.3 验收用例

#### 用例 1：commit 触发 syntax 验证
1. 在 backend 修改任意 Python 文件
2. 执行 `git commit -m "test"`
3. 等待 10s
4. 验证：verification task 创建成功 + syntax 通过
5. 期望：`status: passed`、`syntax.duration_seconds < 30`

#### 用例 2：失败自动修复
1. 在某个模块故意引入 type error
2. 执行 `git commit`
3. 等待验证失败
4. 验证：fix agent 被调用 + 修复后重新验证
5. 期望：`retry_count: 1` + `status: passed`（如果修复成功）

#### 用例 3：性能基线对比
1. 创建性能基线
2. 在某个热路径加 100ms 延迟
3. 触发性能验证
4. 验证：性能退化 > 5% → 失败
5. 期望：`dimension: performance` + `status: failed` + 退化告警

#### 用例 4：定时全量回归
1. 配置 cron 任务（每日 02:00）
2. 等待触发
3. 验证：所有项目全量验证
4. 期望：生成完整回归报告 + 通知管理员

#### 用例 5：高风险模块零容忍
1. 在 motion_control 模块（高风险）引入未通过 safety verification 的代码
2. 触发验证
3. 验证：safety 维度失败 → 强制阻止 commit
4. 期望：`status: failed` + `error: "high_risk_blocked"`

### 6.4 完整测试项目

| 测试类型 | 项目 | 通过标准 |
|----------|------|----------|
| **单元测试** | `tests/test_verification_units.py` | 80+ 用例 100% 通过 |
| **E2E 测试** | `tests/test_e2e_verification.sh` | 10+ 测试模块 100% 通过 |
| **集成测试** | `tests/test_verification_integration.py` | 4 个系统联动 100% 通过 |
| **浏览器测试** | 通过 MCP 浏览器访问 /verification 页面 | 完整可视化操作 |
| **性能压测** | `tests/benchmarks/verification_load.py` | 100 并发 < 30min |
| **安全扫描** | 手工验证命令注入 / 路径越界 | 100% 拦截 |

---

## 七、实施任务清单

| ID | 任务 | 预估行数 | 依赖 |
|----|------|----------|------|
| 1 | 后端核心服务 `verification.py` | 800 | - |
| 2 | 后端 API 路由 `verification_api.py` | 350 | 1 |
| 3 | Webhook 触发器 | 200 | 1, 2 |
| 4 | 自动修复 orchestrator | 400 | 1, Multi-Agent v2 |
| 5 | 性能基线管理 | 300 | 1 |
| 6 | 报告生成器 (MD/JSON/HTML) | 350 | 1 |
| 7 | 单元测试 | 600 | 1, 2 |
| 8 | E2E 测试 | 500 | 1, 2, 3, 4 |
| 9 | 集成测试（联动现有系统） | 400 | 1, 2, 3, 4, 5 |
| 10 | 前端 VerificationPanel 组件 | 600 | 1, 2 |
| 11 | 前端 VerificationPage 页面 | 100 | 10 |
| 12 | 前端 hook `useVerificationApi` | 200 | 1, 2 |
| 13 | 路由集成 + BrandHeader 菜单 | 50 | 11 |
| 14 | 性能基线 seed 数据 | 100 | 5 |
| 15 | 文档（spec / task / checklist / summary） | 800 | - |

**总预估**: 5750 行 + 文档

---

## 八、风险与依赖

### 8.1 依赖项

- **P1-8 Memory System**: 验证失败模式写入记忆（self-improvement skill）
- **P0-10 Multi-Agent v2**: 调用 fix / type / lint agent
- **P0-11 TRACE**: 规则校验集成
- **L4Singleflight**: 任务去重
- **CommitHookHandler**: 接收 commit 事件
- **WorkflowEngine**: 验证完成触发工作流推进

### 8.2 风险

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 验证执行阻塞主线程 | 中 | 后台 worker 池 + 异步 |
| 长时间运行的 task 内存泄漏 | 中 | 每个 task 独立进程 + 超时强制 kill |
| 自动修复引入新问题 | 高 | 最多 3 次 + 失败降级到人工 |
| 性能基线漂移 | 中 | 定期重置 + 滑动窗口 |
| 安全命令注入 | 高 | 严格白名单 + 参数化执行 |

### 8.3 性能开销

- 每个 task 平均增加 2-3 分钟（CI 时间）
- 报告生成 < 5s
- 存储 1000 task < 100MB

---

## 九、参考资料

1. **Codex v0.145+ Verification Loop**: https://github.com/openai/codex
2. **TRAE Solo v3.5.79+ Auto-Verify**: TRAE 内部规范
3. **GitLab CI Verification Pattern**: https://docs.gitlab.com/ee/ci/
4. **GitHub Actions Required Checks**: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
5. **Hermes 现有 CommitHookHandler**: `/home/qizheng/auto_code_ws/backend/app/services/commit_hook_handler.py`
6. **Hermes 现有 WorkflowEngine**: `/home/qizheng/auto_code_ws/backend/app/services/workflow_engine.py`
7. **Hermes P1-8 Memory System (self-improvement skill)**: 本轮已实现

---

**任务完成标准**:
- 4 维度验证全部实现 + 单元测试 ≥ 80 用例 100% 通过
- E2E 测试 ≥ 10 测试模块 100% 通过
- 前端完整可视化（任务列表 / 详情 / 报告 / 实时状态）
- 与 CommitHook / WorkflowEngine / Memory / Multi-Agent 集成测试通过
- 性能压测达标（100 并发 < 30min）
- 安全扫描（命令注入 / 路径越界）100% 拦截
- CYCLE10_P1_10_SUMMARY.md 完整总结
- 代码修改日志更新 v6.10.0
