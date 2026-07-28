# P1-10 Verification Loop - 任务清单

> **关联 Spec**: [./spec.md](./spec.md)
> **执行顺序**: 按依赖关系排序
> **版本**: v1.0.0
> **创建日期**: 2026-07-28

---

## 阶段 1：后端核心服务（预估 5-6h）

### 1.1 数据模型与常量
- [ ] 创建 `backend/app/services/verification.py` 核心服务
- [ ] 定义 `VerificationTask` / `VerificationResult` / `FixAction` 数据类
- [ ] 定义 `DIMENSIONS` 字典（syntax/module/integration/performance）
- [ ] 定义触发源枚举 `TriggerType`（commit/pr/cron/manual）
- [ ] 定义状态枚举（pending/running/passed/failed/cancelled/blocked）
- [ ] 定义错误分类（test_failure/type_error/lint_error/performance_degradation/safety_violation）

### 1.2 验证执行器（4 维度）
- [ ] 实现 `SyntaxVerifier` - mypy / tsc / eslint
  - [ ] 命令白名单（防止注入）
  - [ ] 超时控制
  - [ ] fail_fast 支持
- [ ] 实现 `ModuleVerifier` - pytest / go test / cargo test
  - [ ] 并发运行多个测试目录
  - [ ] coverage 收集
  - [ ] 失败用例解析
- [ ] 实现 `IntegrationVerifier` - E2E tests
  - [ ] 服务健康检查
  - [ ] 多脚本执行
  - [ ] 产物收集（截图、报告）
- [ ] 实现 `PerformanceVerifier` - 基准对比
  - [ ] 读取基线数据
  - [ ] 计算退化率
  - [ ] 告警阈值（默认 5%）

### 1.3 VerificationTask 管理
- [ ] 实现 `VerificationTaskManager` 类
  - [ ] `create_task()` - 创建任务（幂等：同 commit+dims 不重复）
  - [ ] `get_task()` - 查询任务
  - [ ] `list_tasks()` - 列出任务（按状态/触发源/时间过滤）
  - [ ] `update_task_status()` - 状态更新
  - [ ] `cancel_task()` - 取消任务
  - [ ] `retry_task()` - 重试任务（最多 3 次，间隔递增）
  - [ ] 线程安全（RLock）

### 1.4 VerificationResult 管理
- [ ] 实现 `VerificationResultStore` 类
  - [ ] JSONL 存储（`~/.hermes/verification/tasks.jsonl`）
  - [ ] `add_result()` - 追加结果
  - [ ] `get_results()` - 按 task_id 查
  - [ ] `cleanup_old_results()` - 清理过期（> 30 天）

### 1.5 自动修复 Orchestrator
- [ ] 实现 `FixOrchestrator` 类
  - [ ] 错误分类（基于输出模式匹配）
  - [ ] Agent 路由（test_failure → fix agent, type_error → type agent）
  - [ ] 调用 Multi-Agent v2 修复
  - [ ] 重新验证（max 3 次）
  - [ ] 重试退避策略（1s/5s/15s）
  - [ ] 3 次仍失败 → 标记 blocked

### 1.6 性能基线管理
- [ ] 实现 `BaselineStore` 类
  - [ ] `create_baseline()` - 创建基线
  - [ ] `list_baselines()` - 列出基线
  - [ ] `compare_to_baseline()` - 对比当前性能
  - [ ] `update_baseline()` - 更新基线
  - [ ] 基线自动失效（> 7 天提示重新创建）

### 1.7 报告生成器
- [ ] 实现 `ReportGenerator` 类
  - [ ] Markdown 报告（汇总 + 明细 + 修复记录）
  - [ ] JSON 报告（结构化数据）
  - [ ] HTML 报告（带图表的完整页面）
  - [ ] 报告保存路径 `~/.hermes/verification/reports/`

### 1.8 Webhook 触发器
- [ ] 实现 `GitWebhookHandler` 类
  - [ ] 接收 git push / PR 事件
  - [ ] 解析 commit SHA、branch、author
  - [ ] 自动创建 verification task

### 1.9 通知推送（可选）
- [ ] 实现 `Notifier` 类
  - [ ] 邮件通知
  - [ ] 钉钉 webhook
  - [ ] 飞书 webhook

---

## 阶段 2：API 层（预估 2-3h）

### 2.1 Pydantic Schema
- [ ] 创建 `backend/app/api/verification.py` 路由
- [ ] 定义 `CreateTaskRequest` / `TaskResponse` / `ResultResponse` / `FixActionResponse`
- [ ] 定义 `CreateBaselineRequest` / `BaselineResponse`

### 2.2 REST 端点
- [ ] `POST /api/verification/tasks` - 创建验证任务
- [ ] `GET /api/verification/tasks` - 列出任务
- [ ] `GET /api/verification/tasks/{id}` - 任务详情
- [ ] `POST /api/verification/tasks/{id}/run` - 立即执行
- [ ] `POST /api/verification/tasks/{id}/cancel` - 取消任务
- [ ] `POST /api/verification/tasks/{id}/retry` - 重试任务
- [ ] `GET /api/verification/results/{task_id}` - 获取结果
- [ ] `GET /api/verification/baselines` - 性能基线列表
- [ ] `POST /api/verification/baselines` - 创建基线
- [ ] `GET /api/verification/stats` - 统计信息
- [ ] `GET /api/verification/health` - 健康检查
- [ ] `POST /api/verification/webhook/git` - Webhook 触发

### 2.3 路由注册
- [ ] `backend/app/main.py` 注册 `app.include_router(verification_router, prefix="/api/verification", tags=["verification"])`

---

## 阶段 3：测试（预估 3-4h）

### 3.1 单元测试（80+ 用例）
- [ ] `tests/test_verification_units.py`
  - [ ] TestDataClasses (8)：VerificationTask/Result/FixAction
  - [ ] TestSyntaxVerifier (8)：mypy / tsc / eslint / 超时 / fail_fast
  - [ ] TestModuleVerifier (8)：pytest / 并发 / coverage
  - [ ] TestIntegrationVerifier (8)：E2E / 健康检查 / 产物
  - [ ] TestPerformanceVerifier (8)：基线对比 / 退化告警
  - [ ] TestTaskManager (10)：CRUD / 幂等 / 状态流转
  - [ ] TestFixOrchestrator (10)：错误分类 / agent 路由 / 重试
  - [ ] TestBaselineStore (8)：CRUD / 对比 / 失效
  - [ ] TestReportGenerator (8)：Markdown / JSON / HTML
  - [ ] TestWebhookHandler (5)：git push / PR 解析
  - [ ] TestSecurity (5)：命令白名单 / 路径越界 / 注入拦截

### 3.2 E2E 测试（10+ 模块）
- [ ] `tests/test_e2e_verification.sh`
  - [ ] 健康检查
  - [ ] 创建验证任务（4 种 trigger）
  - [ ] 列出任务（按状态过滤）
  - [ ] 任务详情
  - [ ] 立即执行
  - [ ] 取消任务
  - [ ] 重试任务
  - [ ] 结果查询
  - [ ] 性能基线
  - [ ] Webhook 触发
  - [ ] 统计信息
  - [ ] 异常路径

### 3.3 验证运行
- [ ] 单元测试 100% 通过
- [ ] E2E 测试 100% 通过
- [ ] 测试覆盖率 ≥ 90%

---

## 阶段 4：前端 UI（预估 3-4h）

### 4.1 API Hook
- [ ] `frontend/src/hooks/useVerificationApi.ts`（250 行）
  - [ ] 类型定义：VerificationTask / VerificationResult / FixAction / Baseline
  - [ ] fetchHealth / fetchStats
  - [ ] listTasks / getTask / createTask / cancelTask / retryTask / runTask
  - [ ] getResults
  - [ ] listBaselines / createBaseline
  - [ ] triggerWebhook

### 4.2 组件开发
- [ ] `frontend/src/components/VerificationPanel.tsx`（700 行）
  - [ ] 任务列表（按状态/触发源过滤）
  - [ ] 任务详情（维度结果 + 修复记录）
  - [ ] 创建任务对话框
  - [ ] 实时进度展示（轮询）
  - [ ] 报告查看器（Markdown / JSON / HTML 切换）
  - [ ] 性能基线管理
- [ ] `frontend/src/components/VerificationStatusBadge.tsx`（80 行）
  - [ ] 状态徽章（pending / running / passed / failed / blocked）

### 4.3 路由与菜单
- [ ] `frontend/src/pages/VerificationPage.tsx` - 独立访问页
- [ ] `frontend/src/router/router.tsx` - 添加 /verification 路由
- [ ] `frontend/src/components/BrandHeader.tsx` - 菜单项"✅ 验证闭环"
- [ ] `frontend/src/components/AppLayout.tsx` - 透传 onOpenVerification
- [ ] `frontend/src/App.tsx` - 跳转逻辑

### 4.4 SPA 路由兜底
- [ ] `backend/app/main.py` 确认 `/verification` 路由可访问

### 4.5 验证
- [ ] TypeScript 编译 0 errors
- [ ] 前端生产构建成功
- [ ] 浏览器端 5 个核心场景实测通过

---

## 阶段 5：集成验证（预估 2-3h）

### 5.1 与现有系统联动
- [ ] CommitHookHandler 触发 → Verification Task
- [ ] Verification Task 完成 → AtomicTaskAggregator 通知
- [ ] Verification 失败 → Memory System 写入 pattern
- [ ] Multi-Agent v2 调用 fix agent
- [ ] WorkflowEngine 验证完成推进

### 5.2 集成测试
- [ ] `tests/test_verification_integration.py`
  - [ ] 完整链路：commit → verification → fix → retry → passed
  - [ ] 性能退化告警链路
  - [ ] 安全零容忍链路（高风险模块）
  - [ ] Webhook 触发链路

### 5.3 性能压测
- [ ] `tests/benchmarks/verification_load.py`
  - [ ] 100 并发任务创建 < 30s
  - [ ] 4 维度并行执行 < 30min
  - [ ] 1000 任务存储 < 100MB

---

## 阶段 6：文档与交付（预估 1-2h）

- [ ] 创建 `CYCLE10_P1_10_SUMMARY.md`
- [ ] 更新 `代码修改日志.md`（v6.10.0）
- [ ] 创建 `CYCLE10_P1_10_UI_SUMMARY.md`（UI 集成后）
- [ ] 清理测试脚本与临时文件

---

## 总预估工时

| 阶段 | 工时 |
|---|---|
| 阶段 1：后端核心 | 5-6h |
| 阶段 2：API 层 | 2-3h |
| 阶段 3：测试 | 3-4h |
| 阶段 4：前端 UI | 3-4h |
| 阶段 5：集成验证 | 2-3h |
| 阶段 6：文档 | 1-2h |
| **总计** | **16-22h** |

---

## 风险与回退

### 高风险点
- **命令注入**：所有验证命令必须经过白名单校验
- **路径越界**：项目路径限制在 4 个工作区
- **并发死锁**：后台 worker 数量限制（max 4 维度）
- **存储膨胀**：定期清理过期任务

### 回退策略
- 单个维度失败不影响其他维度
- 重试 3 次仍失败 → 标记 blocked → 人工接管
- 存储损坏 → 告警 + 跳过损坏行
- Worker 崩溃 → 自动重启 + 任务重试
